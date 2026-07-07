'use client';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import PdfViewer from '@/components/documents/PdfViewer';

// Per-file-type preview rendering shared by the full document page and the
// chat citation preview modal. Scroll/page-detection props (scrollRef,
// onScroll, onPdfPageChange, onPdfTotalPages) are optional — only the
// document page's Reading Guide feature needs them; the modal renders a
// plain scroll body.
export default function DocumentPreviewBody({
  doc,
  docxHtml,
  spreadsheetData,
  activeSheetIndex,
  onActiveSheetChange,
  imageZoom,
  onImageZoomChange,
  scrollRef,
  onScroll,
  onPdfPageChange,
  onPdfTotalPages,
}) {
  if (!doc) return null;

  const ext = doc.filename.split('.').pop().toLowerCase();

  if (ext === 'txt') {
    return (
      <div ref={scrollRef} onScroll={onScroll} className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto">
        <pre className="whitespace-pre-wrap text-gray-900 dark:text-gray-100 p-6 font-mono text-sm leading-relaxed max-w-5xl mx-auto">
          {doc.content}
        </pre>
      </div>
    );
  }

  if (ext === 'pdf') {
    return (
      <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <PdfViewer fileUrl={doc.fileUrl} onPageChange={onPdfPageChange} onTotalPages={onPdfTotalPages} />
      </div>
    );
  }

  if (ext === 'docx') {
    return (
      <div ref={scrollRef} onScroll={onScroll} className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto">
        <div
          className="prose prose-gray dark:prose-invert max-w-none p-6"
          dangerouslySetInnerHTML={{ __html: docxHtml || '<p>Loading...</p>' }}
        />
      </div>
    );
  }

  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    if (!spreadsheetData) {
      return (
        <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
            <p className="text-gray-400 dark:text-gray-500 text-sm">Loading spreadsheet…</p>
          </div>
        </div>
      );
    }

    const activeSheet = spreadsheetData[activeSheetIndex];

    return (
      <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
        {/* Sheet tabs — only for multi-sheet workbooks */}
        {spreadsheetData.length > 1 && (
          <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto shrink-0">
            {spreadsheetData.map((sheet, i) => (
              <button
                key={i}
                onClick={() => onActiveSheetChange?.(i)}
                className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  i === activeSheetIndex
                    ? "border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {activeSheet?.headers?.length > 0 ? (
            <table className="min-w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-b border-r border-gray-200 dark:border-gray-700 w-10 shrink-0">
                    #
                  </th>
                  {activeSheet.headers.map((h, i) => (
                    <th
                      key={i}
                      className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 border-b border-r border-gray-200 dark:border-gray-700 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeSheet.rows.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className={rowIdx % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800/50"}
                  >
                    <td className="px-3 py-1.5 text-gray-400 dark:text-gray-500 border-r border-gray-100 dark:border-gray-800 text-right select-none">
                      {rowIdx + 2}
                    </td>
                    {activeSheet.headers.map((h, colIdx) => (
                      <td
                        key={colIdx}
                        className="px-3 py-1.5 text-gray-800 dark:text-gray-200 border-r border-gray-100 dark:border-gray-800 whitespace-nowrap max-w-xs truncate"
                        title={String(row[h] ?? "")}
                      >
                        {String(row[h] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-400 dark:text-gray-500 text-sm">This sheet is empty</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center gap-3">
          <span>{activeSheet?.headers?.length ?? 0} columns</span>
          <span>·</span>
          <span>
            {activeSheet?.totalRows ?? 0} rows
            {activeSheet?.totalRows > 1000 ? " (showing first 1,000)" : ""}
          </span>
        </div>
      </div>
    );
  }

  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
    return (
      <div className="relative w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-auto flex items-center justify-center">
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 shadow-sm">
          <button
            onClick={() => onImageZoomChange?.(Math.max(0.25, +(imageZoom - 0.25).toFixed(2)))}
            disabled={imageZoom <= 0.25}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </button>
          <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-10 text-center select-none">
            {Math.round(imageZoom * 100)}%
          </span>
          <button
            onClick={() => onImageZoomChange?.(Math.min(4, +(imageZoom + 0.25).toFixed(2)))}
            disabled={imageZoom >= 4}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </button>
          <div className="w-px h-4 bg-gray-200 dark:bg-gray-600 mx-0.5" />
          <button
            onClick={() => onImageZoomChange?.(1)}
            disabled={imageZoom === 1}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Reset zoom"
          >
            <RotateCcw className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>
        <div className="p-6 min-w-full min-h-full flex items-center justify-center">
          <img
            src={doc.fileUrl}
            alt={doc.filename}
            style={{ transform: `scale(${imageZoom})`, transformOrigin: 'center center', transition: 'transform 0.15s ease' }}
            className="max-w-none rounded shadow-sm"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center">
      <p className="text-gray-500 dark:text-gray-400">Unsupported file type: {ext}</p>
    </div>
  );
}
