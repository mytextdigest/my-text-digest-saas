// src/lib/tables/export.js
// File exports (FR-19–22): XLSX with typed numeric cells, CSV, Markdown,
// JSON; one workbook for all of a document's tables; a Sources sheet for
// derived tables. Returns Buffers/strings — main.js writes them to disk.
import * as XLSX from "xlsx";
import { headerLabels, toCSV, toMarkdown, toJSON, cellText } from "./serialize.js";

function sanitiseSheetName(name, used = new Set()) {
  let base = String(name || "Sheet").replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Sheet";
  base = base.slice(0, 31);
  let cand = base;
  let n = 2;
  while (used.has(cand.toLowerCase())) {
    const suffix = ` (${n++})`;
    cand = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(cand.toLowerCase());
  return cand;
}

function headerWithUnit(table, j, labels) {
  const col = table.columns[j];
  const unit = col && col.type !== "text" ? col.unit || table.tableUnit : null;
  return unit && unit !== "%" ? `${labels[j]} (${unit})` : labels[j];
}

// Canonical table → worksheet. Numeric columns become real numbers
// (percent columns as their displayed value, e.g. 12.5 for 12.5%).
function tableToSheet(table) {
  const labels = headerLabels(table);
  const aoa = [table.columns.map((_, j) => headerWithUnit(table, j, labels))];
  for (const r of table.rows || []) {
    aoa.push(r.cells.map((c, j) => {
      const col = table.columns[j];
      if (col && col.type !== "text" && typeof c.v === "number") return c.v;
      return cellText(c);
    }));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = aoa[0].map((_, j) => ({
    wch: Math.min(60, Math.max(8, ...aoa.map((row) => String(row[j] ?? "").length + 2))),
  }));
  return ws;
}

function workbookBuffer(wb) {
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

// meta: { title, description }
function exportTable(table, format, meta = {}) {
  switch (format) {
    case "csv": return { data: "﻿" + toCSV(table), ext: "csv" };
    case "md": return { data: toMarkdown(table, { title: meta.title }), ext: "md" };
    case "json": return { data: toJSON(table, meta), ext: "json" };
    case "xlsx": {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, tableToSheet(table), sanitiseSheetName(meta.title || "Table"));
      return { data: workbookBuffer(wb), ext: "xlsx" };
    }
    default: throw new Error(`Unsupported export format: ${format}`);
  }
}

// items: [{ table, title, description, pageStart, pageEnd, sheetName, edited }]
function exportAll(items, { docName = "" } = {}) {
  const wb = XLSX.utils.book_new();
  const used = new Set(["index"]);
  const names = items.map((it, i) => sanitiseSheetName(`${i + 1} ${it.title || "Table"}`, used));
  const index = [["No", "Title", "Sheet", "Page(s)", "Rows × Cols", "Description", "Edited"]];
  items.forEach((it, i) => {
    const pages = it.sheetName ? `Sheet ${it.sheetName}` : it.pageStart ? (it.pageEnd && it.pageEnd !== it.pageStart ? `${it.pageStart}–${it.pageEnd}` : String(it.pageStart)) : "";
    index.push([i + 1, it.title || "", names[i], pages, `${it.table.rows.length} × ${it.table.columns.length}`, it.description || "", it.edited ? "Yes" : ""]);
  });
  const indexSheet = XLSX.utils.aoa_to_sheet(docName ? [[`Tables extracted from ${docName}`], [], ...index] : index);
  indexSheet["!cols"] = [{ wch: 5 }, { wch: 40 }, { wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 60 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, indexSheet, "Index");
  items.forEach((it, i) => XLSX.utils.book_append_sheet(wb, tableToSheet(it.table), names[i]));
  return workbookBuffer(wb);
}

// Derived table (chat comparison) with its provenance.
// sources: [{ cell, document, table, page }]
function exportDerived(table, format, meta = {}) {
  if (format !== "xlsx") return exportTable(table, format, meta);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, tableToSheet(table), sanitiseSheetName(meta.title || "Comparison"));
  const rows = [["Row", "Column", "Value", "Document", "Table", "Page"]];
  const labels = headerLabels(table);
  for (const r of table.rows || []) {
    r.cells.forEach((c, j) => {
      if (!c.src) return;
      rows.push([cellText(r.cells[0]), labels[j], typeof c.v === "number" ? c.v : cellText(c), c.src.documentName || "", c.src.tableTitle || "", c.src.page ?? ""]);
    });
  }
  if (meta.warnings?.length) {
    rows.push([], ["Warnings"]);
    for (const w of meta.warnings) rows.push([w.message || String(w)]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sources");
  return { data: workbookBuffer(wb), ext: "xlsx" };
}

export { sanitiseSheetName, tableToSheet, exportTable, exportAll, exportDerived };
