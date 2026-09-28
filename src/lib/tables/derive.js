// src/lib/tables/derive.js
// Builds a derived (cross-document) comparison table (FR-30, FR-31). Every
// value cell is copied from a source cell (with provenance) or converted by
// a known scale factor; every computed cell (Change, Change %) is arithmetic
// here — never from an LLM.
import config from "./config.js";
import { parsePeriod, periodSortKey, unitParts } from "./clean.js";
import { alignRows, rowDescriptors, periodColumns, normLabel, jaccard } from "./align.js";

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function decimalsOf(raw) {
  const m = String(raw || "").match(/[.,](\d+)\D*$/);
  if (!m) return 0;
  // "1,234" is a thousands separator, not 3 decimals.
  if (m[1].length === 3 && /,\d{3}\D*$/.test(String(raw))) return 0;
  return Math.min(4, m[1].length);
}

function fmt(v, decimals = 1) {
  if (!isNum(v)) return "";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return v < 0 ? `-${s}` : s;
}

function fmtSigned(v, decimals = 1, suffix = "") {
  if (!isNum(v)) return "";
  const s = fmt(v, decimals);
  return (v > 0 ? "+" : "") + s + suffix;
}

// Converts `v` from unit `from` to unit `to` when both are known and share a
// currency (or both have none). Returns { v, converted, mismatch }.
function convertUnit(v, from, to) {
  if (!isNum(v)) return { v, converted: false, mismatch: false };
  if ((from || "") === (to || "")) return { v, converted: false, mismatch: false };
  const f = unitParts(from), t = unitParts(to);
  if (!f.known || !t.known || f.percent !== t.percent) return { v, converted: false, mismatch: true };
  if (f.currency !== t.currency) return { v, converted: false, mismatch: true };
  if (f.scale === t.scale) return { v, converted: false, mismatch: false };
  return { v: (v * f.scale) / t.scale, converted: true, mismatch: false };
}

function columnUnit(table, colIdx) {
  const c = table.columns[colIdx];
  return (c && (c.unit || table.tableUnit)) || null;
}

// sources: [{ documentId, documentName, createdAt, tableId, tableTitle,
//             pageStart, table (effective canonical JSON) }]  (≥ 2)
// request: { periods?: string[], rowFilter?: string[], title? }
async function deriveComparison(sources, request = {}, { openai = null, useLLM = true } = {}) {
  if (!Array.isArray(sources) || sources.length < 2) throw new Error("A comparison needs tables from at least two documents.");
  const warnings = [];

  // ---- Periods -----------------------------------------------------------
  const perSource = sources.map((s) => ({ ...s, periods: periodColumns(s.table) }));
  const requested = (request.periods || []).map((p) => parsePeriod(p) || String(p).trim()).filter(Boolean);

  // Each output column is either a period (taken from whichever source has
  // it, newest source preferred) or — when tables have no period columns —
  // one column per source, labelled by document.
  let outCols = [];
  const havePeriods = perSource.every((s) => s.periods.length);
  const newestFirst = [...perSource].sort((a, b) =>
    (periodSortKey(b.periods[0]?.period) - periodSortKey(a.periods[0]?.period)) ||
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  if (havePeriods) {
    let wanted = requested.length ? requested : [...new Set(perSource.map((s) => s.periods[0].period))];
    if (!requested.length && wanted.length === 1) {
      // Every document's latest period is the same (e.g. both restate 2025):
      // compare that period plus the one before it from the older document.
      const second = perSource.flatMap((s) => s.periods.map((p) => p.period)).filter((p) => p !== wanted[0])
        .sort((a, b) => periodSortKey(b) - periodSortKey(a))[0];
      if (second) wanted = [second, wanted[0]];
    }
    wanted = [...new Set(wanted)].sort((a, b) => periodSortKey(a) - periodSortKey(b));
    for (const period of wanted) {
      const holders = newestFirst.filter((s) => s.periods.some((p) => p.period === period));
      if (!holders.length) {
        warnings.push({ type: "missing_period", message: `No selected table has a ${period} column.` });
        continue;
      }
      const chosen = holders[0];
      outCols.push({ key: period, label: period, period, source: chosen, colIdx: chosen.periods.find((p) => p.period === period).j, others: holders.slice(1) });
    }
  } else {
    for (const s of perSource) {
      const colIdx = s.table.columns.findIndex((c) => c.type !== "text");
      if (colIdx < 0) { warnings.push({ type: "no_numbers", message: `"${s.tableTitle}" in ${s.documentName} has no numeric column.` }); continue; }
      outCols.push({ key: `d${s.documentId}`, label: s.documentName, period: null, source: s, colIdx, others: [] });
    }
  }
  if (outCols.length < 1) throw new Error("None of the matched tables have comparable numeric columns.");

  // ---- Units -------------------------------------------------------------
  const target = columnUnit(outCols[outCols.length - 1].source.table, outCols[outCols.length - 1].colIdx);

  // ---- Rows: align every source to a base (the source of the latest column)
  const base = outCols[outCols.length - 1].source;
  const baseDesc = rowDescriptors(base.table);
  const alignedBy = new Map(); // documentId → Map(baseRowId → row)
  const extraRows = []; // rows present only in other sources
  for (const s of perSource) {
    if (s === base || s.documentId === base.documentId && s.tableId === base.tableId) continue;
    const desc = rowDescriptors(s.table);
    const { pairs, unmatchedA, unmatchedB } = await alignRows(baseDesc.rows, desc.rows, { openai, useLLM });
    const map = new Map(pairs.map((p) => [p.a.id, p.b]));
    alignedBy.set(`${s.documentId}:${s.tableId}`, map);
    for (const r of unmatchedB) if (r.kind === "data") extraRows.push({ source: s, row: r });
    const onlyBase = unmatchedA.filter((r) => r.kind === "data").map((r) => r.label);
    if (onlyBase.length) warnings.push({ type: "unmatched_rows", message: `Only in ${base.documentName}: ${onlyBase.join(", ")}.` });
    const onlyOther = unmatchedB.filter((r) => r.kind === "data").map((r) => r.label);
    if (onlyOther.length) warnings.push({ type: "unmatched_rows", message: `Only in ${s.documentName}: ${onlyOther.join(", ")}.` });
  }

  const rowFor = (col, baseRow) => {
    const s = col.source;
    if (s.documentId === base.documentId && s.tableId === base.tableId) return baseRow.row;
    const hit = alignedBy.get(`${s.documentId}:${s.tableId}`)?.get(baseRow.id);
    return hit ? hit.row : null;
  };

  let rowsOut = baseDesc.rows.filter((r) => r.kind !== "subtotal").map((r) => ({ label: r.label, kind: r.kind, baseRow: r }));
  for (const e of extraRows) rowsOut.push({ label: e.row.label, kind: "data", extra: e });
  // Totals last.
  rowsOut = [...rowsOut.filter((r) => r.kind !== "total"), ...rowsOut.filter((r) => r.kind === "total")];

  if (Array.isArray(request.rowFilter) && request.rowFilter.length) {
    const filters = request.rowFilter.map(normLabel).filter(Boolean);
    rowsOut = rowsOut.filter((r) => {
      const n = normLabel(r.label);
      return filters.some((f) => n === f || n.includes(f) || f.includes(n) || jaccard(n, f) >= 0.6);
    });
  }

  // ---- Values ------------------------------------------------------------
  // Converted values use the decimal places of the column they join.
  const targetCol = outCols[outCols.length - 1];
  const targetDecimals = Math.max(0, ...base.table.rows.map((r) => decimalsOf(r.cells[targetCol.colIdx]?.raw)).slice(0, 50));
  const unitWarned = new Set();
  const convertedNote = new Set();
  const valueCell = (col, srcRow) => {
    if (!srcRow) return { raw: "", v: null };
    const cell = srcRow.cells[col.colIdx];
    if (!cell) return { raw: "", v: null };
    const from = columnUnit(col.source.table, col.colIdx);
    const conv = convertUnit(cell.v, from, target);
    if (conv.mismatch && !unitWarned.has(col.source.documentId)) {
      unitWarned.add(col.source.documentId);
      warnings.push({ type: "unit_mismatch", message: `${col.source.documentName} reports ${from || "unspecified units"} but the comparison uses ${target || "unspecified units"}; values were not converted.` });
    }
    if (conv.converted && !convertedNote.has(col.source.documentId)) {
      convertedNote.add(col.source.documentId);
      warnings.push({ type: "unit_converted", message: `Converted ${col.source.documentName} values from ${from} to ${target}.` });
    }
    const out = {
      raw: conv.converted ? fmt(conv.v, targetDecimals) : cell.raw,
      v: isNum(conv.v) ? conv.v : null,
      src: {
        documentId: col.source.documentId,
        documentName: col.source.documentName,
        tableId: col.source.tableId,
        tableTitle: col.source.tableTitle,
        rowId: srcRow.id,
        colId: col.source.table.columns[col.colIdx]?.id,
        page: col.source.pageStart ?? null,
        raw: cell.raw,
      },
    };
    if (conv.converted) out.calc = `convert(${from} → ${target})`;
    return out;
  };

  const changeCols = havePeriods && outCols.length >= 2;
  const firstCol = outCols[0], lastCol = outCols[outCols.length - 1];
  const decimalsFor = new Map();

  const rows = rowsOut.map((r, i) => {
    const values = outCols.map((col) => {
      let srcRow = null;
      if (r.extra) srcRow = r.extra.source === col.source ? r.extra.row.row : null;
      else srcRow = rowFor(col, r.baseRow);
      return valueCell(col, srcRow);
    });
    // Restatements: another document reports the same period differently.
    outCols.forEach((col, k) => {
      for (const other of col.others) {
        if (r.extra) continue;
        const map = alignedBy.get(`${other.documentId}:${other.tableId}`);
        const otherRow = other === base ? r.baseRow.row : map?.get(r.baseRow.id)?.row;
        if (!otherRow) continue;
        const oj = other.periods.find((p) => p.period === col.period)?.j;
        const ov = convertUnit(otherRow.cells[oj]?.v, columnUnit(other.table, oj), target).v;
        const v = values[k].v;
        if (isNum(ov) && isNum(v) && Math.abs(ov - v) > Math.max(1e-9, Math.abs(v) * 0.0005)) {
          values[k].restated = { documentName: other.documentName, v: ov, raw: otherRow.cells[oj]?.raw };
          warnings.push({ type: "restatement", message: `${r.label} ${col.period}: ${col.source.documentName} reports ${values[k].raw}, ${other.documentName} reported ${otherRow.cells[oj]?.raw} — using the newer figure.` });
        }
      }
    });
    const cells = [{ raw: r.label, v: r.label }, ...values];
    if (changeCols) {
      const a = values[0].v, b = values[values.length - 1].v;
      const dec = Math.max(decimalsOf(values[0].raw), decimalsOf(values[values.length - 1].raw));
      decimalsFor.set(i, dec);
      const change = isNum(a) && isNum(b) ? b - a : null;
      const pct = isNum(a) && isNum(b) && a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null;
      cells.push({ raw: fmtSigned(change, dec), v: isNum(change) ? Math.round(change * 1e9) / 1e9 : null, calc: `change(${firstCol.key},${lastCol.key})` });
      cells.push({ raw: isNum(pct) ? fmtSigned(pct, 1, "%") : "", v: isNum(pct) ? Math.round(pct * 1e6) / 1e6 : null, calc: `pct_change(${firstCol.key},${lastCol.key})` });
    }
    return { id: `r${i}`, kind: r.kind === "total" ? "total" : "data", cells };
  });

  // Totals: check the source total against the sum of the rows shown.
  rows.forEach((row) => {
    if (row.kind !== "total") return;
    outCols.forEach((col, k) => {
      const cell = row.cells[k + 1];
      if (!isNum(cell.v)) return;
      const sum = rows.filter((r) => r.kind === "data").map((r) => r.cells[k + 1].v).filter(isNum).reduce((x, y) => x + y, 0);
      if (Math.abs(sum - cell.v) > Math.max(Math.abs(cell.v) * config.TOTAL_TOLERANCE, 0.5)) {
        cell.flag = "total_mismatch";
        warnings.push({ type: "total_mismatch", message: `The ${col.label} total (${cell.raw}) differs from the sum of the rows shown (${fmt(sum, Math.max(1, decimalsOf(cell.raw)))}).` });
      }
    });
  });

  const labelHeader = (baseDesc.labelCol >= 0 && base.table.columns[baseDesc.labelCol]?.label) || "Item";
  const valueType = base.table.columns[outCols[outCols.length - 1].colIdx]?.type || "number";
  const columns = [
    { id: "c0", label: labelHeader, headerPath: [labelHeader], type: "text", unit: null },
    ...outCols.map((col, k) => ({
      id: `c${k + 1}`,
      label: col.label,
      headerPath: [col.label],
      type: valueType === "percent" ? "percent" : valueType === "currency" ? "currency" : "number",
      unit: target,
      ...(col.period ? { period: col.period } : {}),
      source: { documentId: col.source.documentId, documentName: col.source.documentName, tableId: col.source.tableId },
    })),
  ];
  if (changeCols) {
    columns.push({ id: `c${outCols.length + 1}`, label: "Change", headerPath: ["Change"], type: "number", unit: target, computed: true });
    columns.push({ id: `c${outCols.length + 2}`, label: "Change %", headerPath: ["Change %"], type: "percent", unit: "%", computed: true });
  }

  const table = { columns, rows, tableUnit: target || undefined, notes: [] };
  const baseTitle = request.title || base.tableTitle || "Comparison";
  const title = havePeriods && outCols.length >= 2 ? `${baseTitle}: ${firstCol.label} vs ${lastCol.label}` : `${baseTitle} across documents`;
  return {
    title,
    table,
    warnings: dedupeWarnings(warnings),
    sourceTableIds: [...new Set(sources.map((s) => s.tableId))],
  };
}

function dedupeWarnings(ws) {
  const seen = new Set();
  return ws.filter((w) => {
    if (seen.has(w.message)) return false;
    seen.add(w.message);
    return true;
  });
}

// Compact Markdown the chat model answers from.
function derivedToText(result) {
  const { table, title, warnings } = result;
  const headers = table.columns.map((c) => c.label);
  const lines = [`**${title}**${table.tableUnit ? ` (${table.tableUnit})` : ""}`, "", `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of table.rows) lines.push(`| ${r.cells.map((c) => String(c.raw ?? "")).join(" | ")} |`);
  const sources = [...new Map(table.columns.filter((c) => c.source).map((c) => [`${c.source.documentId}`, c.source.documentName])).values()];
  lines.push("", `Sources: ${sources.join("; ")}`);
  if (warnings.length) lines.push("", "Warnings:", ...warnings.map((w) => `- ${w.message}`));
  return lines.join("\n");
}

export { deriveComparison, derivedToText, convertUnit, fmt, fmtSigned };
