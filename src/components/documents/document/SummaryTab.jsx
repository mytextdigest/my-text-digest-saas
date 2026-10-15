"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, BarChart3, Clock, FileType, Calendar, Copy, Check, Printer, Sheet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { printHtml } from "@/lib/printDocument";

// Summary tab of the document page: document info, per-sheet breakdown for
// spreadsheets, overview + key points, and copy/print/regenerate actions.
// sheets: [{ sheetName, rowSpan, columnHeaders }] derived from chunk metadata.
export default function SummaryTab({ doc, summary, isGeneratingSummary, isSpreadsheet, sheets = [], onRegenerate }) {
  const [copiedSummary, setCopiedSummary] = useState(false);

  const handleCopySummary = () => {
    if (!summary) return;
    const lines = [
      'DOCUMENT INFORMATION',
      '====================',
      `Type:      ${summary.documentType}`,
      `Words:     ${summary.wordCount}`,
      `Read Time: ${summary.estimatedReadTime} min`,
      `Modified:  ${summary.lastModified}`,
      '',
      'SUMMARY',
      '=======',
      summary.overview,
    ];
    if (summary.keyPoints.length > 0) {
      lines.push('', 'KEY POINTS', '==========');
      summary.keyPoints.forEach((p) => lines.push(`• ${p}`));
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
    });
  };

  const handlePrintSummary = () => {
    if (!summary) return;
    const keyPointsHtml = summary.keyPoints.length > 0
      ? `<section>
          <h2>Key Points</h2>
          <ul>${summary.keyPoints.map(p => `<li>${p}</li>`).join('')}</ul>
        </section>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Summary — ${summary.title}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; color: #111; line-height: 1.7; }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    .meta { font-size: 0.85rem; color: #555; margin-bottom: 2rem; }
    section { margin-bottom: 1.8rem; }
    h2 { font-size: 1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 0.75rem; }
    p { margin: 0; }
    ul { padding-left: 1.25rem; margin: 0; }
    li { margin-bottom: 0.4rem; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 1.5rem; font-size: 0.9rem; }
    .info-grid span.label { color: #555; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <h1>${summary.title}</h1>
  <p class="meta">Printed on ${new Date().toLocaleDateString()}</p>
  <section>
    <h2>Document Information</h2>
    <div class="info-grid">
      <div><span class="label">Type:</span> ${summary.documentType}</div>
      <div><span class="label">Words:</span> ${summary.wordCount}</div>
      <div><span class="label">Read Time:</span> ${summary.estimatedReadTime} min</div>
      <div><span class="label">Modified:</span> ${summary.lastModified}</div>
    </div>
  </section>
  <section>
    <h2>Summary</h2>
    <p>${summary.overview}</p>
  </section>
  ${keyPointsHtml}
</body>
</html>`;

    printHtml(html);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900/50 custom-scrollbar">
      {/* CASE 1: Generating */}
      {doc?.status === "summarizing" || isGeneratingSummary ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">
              Generating summary please wait
              {/* Generating summary in background... */}
            </p>
          </div>
        </div>
      ) : /* CASE 2: Ready */ summary ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          {/* Document Info */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Document Information
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center space-x-2">
                <FileType className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600 dark:text-gray-400">
                  Type:
                </span>
                <span className="font-medium">
                  {summary.documentType}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <BarChart3 className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600 dark:text-gray-400">
                  Words:
                </span>
                <span className="font-medium">{summary.wordCount}</span>
              </div>
              <div className="flex items-center space-x-2">
                <Clock className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600 dark:text-gray-400">
                  Read Time:
                </span>
                <span className="font-medium">
                  {summary.estimatedReadTime} min
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600 dark:text-gray-400">
                  Modified:
                </span>
                <span className="font-medium">
                  {summary.lastModified}
                </span>
              </div>
            </div>
          </div>

          {/* Sheets Breakdown (spreadsheet documents only) */}
          {isSpreadsheet && sheets.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center space-x-2">
                <Sheet className="h-4 w-4 text-gray-500" />
                <span>Sheets ({sheets.length})</span>
              </h3>
              <div className="space-y-3">
                {sheets.map((sheet) => (
                  <div
                    key={sheet.sheetName}
                    className="rounded-md border border-gray-200 dark:border-gray-700 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                        {sheet.sheetName}
                      </span>
                      {sheet.rowSpan && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Rows {sheet.rowSpan}
                        </span>
                      )}
                    </div>
                    {sheet.columnHeaders.length > 0 && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 truncate">
                        Columns: {sheet.columnHeaders.join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overview */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Summary
            </h3>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              {summary.overview}
            </p>
          </div>

          {/* Key Points */}
          {summary.keyPoints.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Key Points
              </h3>
              <ul className="space-y-2">
                {summary.keyPoints.map((point, index) => (
                  <li
                    key={index}
                    className="flex items-start space-x-2"
                  >
                    <div className="w-2 h-2 bg-primary-600 rounded-full mt-2 flex-shrink-0"></div>
                    <span className="text-gray-700 dark:text-gray-300 text-sm">
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopySummary}
              className="flex items-center space-x-2"
            >
              {copiedSummary ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              <span>{copiedSummary ? 'Copied!' : 'Copy'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrintSummary}
              className="flex items-center space-x-2"
            >
              <Printer className="h-4 w-4" />
              <span>Print</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRegenerate}
              className="flex items-center space-x-2"
            >
              <BarChart3 className="h-4 w-4" />
              <span>Regenerate</span>
            </Button>
          </div>
        </motion.div>
      ) : /* CASE 3: Error */ doc?.status === "error" ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Failed to generate summary
            </p>
            <Button
              onClick={onRegenerate}
              className="flex items-center space-x-2"
            >
              <BarChart3 className="h-4 w-4" />
              <span>Try Again</span>
            </Button>
          </div>
        </div>
      ) : (
        /* CASE 4: No summary yet */
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              No summary available
            </p>
            <Button
              onClick={onRegenerate}
              className="flex items-center space-x-2"
            >
              <BarChart3 className="h-4 w-4" />
              <span>Generate Summary</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
