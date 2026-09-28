// src/lib/tables/stats.js
// Column statistics. computeSpreadsheetStats moved here from main.js
// unchanged (spreadsheet behaviour is identical); computeTableStats is the
// same idea over a canonical table (FR-23), skipping total/subtotal rows so
// aggregates aren't double-counted.
import { colLabel } from "./clean.js";

/**
 * Compute per-column statistics over every row of every sheet.
 * Categorical columns get value-count tables; numeric columns get
 * count/min/max/avg/sum. Result is a plain-text block that is stored
 * in documents.spreadsheet_stats and prepended to LLM context so the
 * model can answer aggregation queries (counts, totals, averages) without
 * needing to scan all chunks.
 */
function computeSpreadsheetStats(sheets, workbookName) {
  const lines = ["=== SPREADSHEET STATISTICS ==="];
  const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
  lines.push(`Workbook: ${workbookName} | Sheets: ${sheets.map(s => s.name).join(", ")} | Total rows: ${totalRows.toLocaleString()}`);

  for (const sheet of sheets) {
    if (sheet.rows.length === 0) continue;
    lines.push("");
    lines.push(`--- Sheet: ${sheet.name} (${sheet.rows.length.toLocaleString()} rows, ${sheet.headers.length} columns) ---`);

    for (const header of sheet.headers) {
      const rawValues = sheet.rows.map(r => r[header]).filter(v => String(v).trim() !== "");
      if (rawValues.length === 0) continue;

      // Determine column type: numeric if >80 % of non-empty values parse as numbers
      const numericValues = rawValues
        .map(v => parseFloat(String(v).replace(/,/g, "")))
        .filter(v => !isNaN(v));
      const isNumeric = numericValues.length / rawValues.length > 0.8;

      if (isNumeric && numericValues.length > 0) {
        const sum = numericValues.reduce((a, b) => a + b, 0);
        const avg = sum / numericValues.length;
        const min = Math.min(...numericValues);
        const max = Math.max(...numericValues);
        lines.push(`[${header}] numeric | ${rawValues.length.toLocaleString()} values | min=${min} max=${max} avg=${avg.toFixed(2)} sum=${sum.toLocaleString()}`);
      } else {
        const freq = {};
        for (const v of rawValues) {
          const key = String(v).trim();
          freq[key] = (freq[key] || 0) + 1;
        }
        const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
        const total = rawValues.length;
        const uniqueCount = sorted.length;
        lines.push(`[${header}] categorical | ${total.toLocaleString()} values | ${uniqueCount} unique`);
        const topN = sorted.slice(0, 30);
        for (const [val, count] of topN) {
          lines.push(`  ${val} = ${count.toLocaleString()} (${(count / total * 100).toFixed(1)}%)`);
        }
        if (sorted.length > 30) {
          lines.push(`  ... and ${sorted.length - 30} more unique values`);
        }
      }
    }
  }

  return lines.join("\n");
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

// Returns { columns: [{ id, label, type, unit, count, min, max, sum, mean,
// median, distinct?, top? }], rowCount, excludedRows } — all computed from
// cell `v` values, never re-read from text.
function computeTableStats(table) {
  const rows = (table.rows || []).filter((r) => r.kind === "data" || !r.kind);
  const excludedRows = (table.rows || []).length - rows.length;
  const columns = (table.columns || []).map((col, j) => {
    const base = { id: col.id, label: colLabel(col, j), type: col.type || "text", unit: col.unit || table.tableUnit || null };
    if (col.type && col.type !== "text") {
      const vals = rows.map((r) => r.cells[j]?.v).filter((v) => typeof v === "number" && Number.isFinite(v));
      if (!vals.length) return { ...base, count: 0 };
      const sorted = [...vals].sort((a, b) => a - b);
      const sum = vals.reduce((a, b) => a + b, 0);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const labelCol = table.columns.findIndex((c) => c.type === "text");
      const byValue = (v) => {
        const r = rows.find((row) => row.cells[j]?.v === v);
        return r && labelCol >= 0 ? String(r.cells[labelCol]?.raw || "") : null;
      };
      return {
        ...base,
        count: vals.length,
        min: round(sorted[0]),
        max: round(sorted[sorted.length - 1]),
        minLabel: byValue(sorted[0]),
        maxLabel: byValue(sorted[sorted.length - 1]),
        sum: round(sum),
        mean: round(sum / vals.length),
        median: round(median),
      };
    }
    const values = rows.map((r) => String(r.cells[j]?.raw || "").trim()).filter(Boolean);
    const freq = {};
    for (const v of values) freq[v] = (freq[v] || 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, count]) => ({ value, count }));
    return { ...base, count: values.length, distinct: Object.keys(freq).length, top };
  });
  return { rowCount: rows.length, excludedRows, columns };
}

// Compact text version for the chat context.
function tableStatsText(stats, title) {
  const lines = [`=== TABLE STATISTICS: ${title || "Table"} (${stats.rowCount} data rows; totals excluded) ===`];
  for (const c of stats.columns) {
    if (c.type !== "text" && c.count) {
      lines.push(`[${c.label}] ${c.type}${c.unit ? ` (${c.unit})` : ""} | n=${c.count} min=${c.min}${c.minLabel ? ` (${c.minLabel})` : ""} max=${c.max}${c.maxLabel ? ` (${c.maxLabel})` : ""} sum=${c.sum} mean=${c.mean} median=${c.median}`);
    }
  }
  return lines.join("\n");
}

export { computeSpreadsheetStats, computeTableStats, tableStatsText };
