// src/lib/compareInsightPdf.js
// Renders a comparison Insight (compact or descriptive) to a PDF buffer for
// download. @react-pdf/renderer's renderToBuffer runs fine in plain Node —
// no DOM needed — so this executes directly in a Next.js Route Handler's
// Node runtime, replacing the desktop app's native save-dialog + fs.writeFileSync
// with a Response carrying Content-Disposition headers.
//
// Ported near-verbatim from the desktop app's electron/compare/insightPdf.js.
import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#1f2937" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  badge: { fontSize: 9, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" },
  meta: { fontSize: 9, color: "#9ca3af", marginBottom: 20 },
  heading: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  body: { fontSize: 11, lineHeight: 1.5, marginBottom: 8 },
  bulletRow: { flexDirection: "row", marginBottom: 4, paddingRight: 8 },
  bulletMark: { width: 12, fontSize: 11, lineHeight: 1.5 },
  bulletText: { flex: 1, fontSize: 11, lineHeight: 1.5 },
  quoteBlock: { borderLeftWidth: 2, borderLeftColor: "#d1d5db", paddingLeft: 10, marginBottom: 8 },
  quoteText: { fontSize: 10.5, fontStyle: "italic", color: "#4b5563", lineHeight: 1.45 },
  table: { marginBottom: 10, borderWidth: 1, borderColor: "#e5e7eb" },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f3f4f6" },
  tableRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  tableCellLabel: { width: "28%", fontSize: 9.5, fontFamily: "Helvetica-Bold", padding: 6 },
  tableCellA: { width: "36%", fontSize: 9.5, padding: 6, borderLeftWidth: 1, borderLeftColor: "#e5e7eb" },
  tableCellB: { width: "36%", fontSize: 9.5, padding: 6, borderLeftWidth: 1, borderLeftColor: "#e5e7eb" },
  empty: { fontSize: 11, color: "#9ca3af", fontStyle: "italic" },
});

function renderTable(table, documentAName, documentBName, key) {
  if (!table?.rows?.length) return null;
  return React.createElement(
    View,
    { key, style: styles.table },
    React.createElement(
      View,
      { style: styles.tableHeaderRow },
      React.createElement(Text, { style: styles.tableCellLabel }, ""),
      React.createElement(Text, { style: styles.tableCellA }, documentAName || "Document A"),
      React.createElement(Text, { style: styles.tableCellB }, documentBName || "Document B")
    ),
    ...table.rows.map((r, i) =>
      React.createElement(
        View,
        { key: `row${i}`, style: styles.tableRow },
        React.createElement(Text, { style: styles.tableCellLabel }, r.label),
        React.createElement(Text, { style: styles.tableCellA }, r.a || "—"),
        React.createElement(Text, { style: styles.tableCellB }, r.b || "—")
      )
    )
  );
}

export function renderInsightPdf({ comparison, insight, style }) {
  const sections = insight?.sections || [];

  const el = React.createElement(
    Document,
    {},
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      React.createElement(Text, { style: styles.title }, `${comparison.documentAFilename} vs ${comparison.documentBFilename}`),
      React.createElement(Text, { style: styles.badge }, style === "descriptive" ? "Detailed Insight" : "Compact Insight"),
      React.createElement(Text, { style: styles.meta }, `Generated ${new Date(comparison.createdAt).toLocaleString()}`),
      sections.length === 0
        ? React.createElement(Text, { style: styles.empty }, "No insight was generated for this comparison.")
        : sections.map((s, i) =>
            React.createElement(
              View,
              { key: String(i) },
              s.heading ? React.createElement(Text, { style: styles.heading }, s.heading) : null,
              s.body ? React.createElement(Text, { style: styles.body }, s.body) : null,
              s.quote
                ? React.createElement(
                    View,
                    { style: styles.quoteBlock },
                    React.createElement(Text, { style: styles.quoteText }, `"${s.quote}"`)
                  )
                : null,
              ...(s.bullets || []).map((b, j) =>
                React.createElement(
                  View,
                  { key: `b${j}`, style: styles.bulletRow },
                  React.createElement(Text, { style: styles.bulletMark }, "•"),
                  React.createElement(Text, { style: styles.bulletText }, b)
                )
              ),
              renderTable(s.table, comparison.documentAFilename, comparison.documentBFilename, `t${i}`)
            )
          )
    )
  );

  return renderToBuffer(el);
}
