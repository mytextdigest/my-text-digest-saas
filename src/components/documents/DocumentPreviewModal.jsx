'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import mammoth from 'mammoth';
import { X, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import DocumentPreviewBody from '@/components/documents/DocumentPreviewBody';

export default function DocumentPreviewModal({ documentId, onClose }) {
  const router = useRouter();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [docxHtml, setDocxHtml] = useState(null);
  const [spreadsheetData, setSpreadsheetData] = useState(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [imageZoom, setImageZoom] = useState(1);

  useEffect(() => {
    if (!documentId) return;
    setLoading(true);
    fetch(`/api/documents/${documentId}`)
      .then((r) => r.json())
      .then(setDoc)
      .catch((err) => console.error('Error loading document preview:', err))
      .finally(() => setLoading(false));
  }, [documentId]);

  useEffect(() => {
    if (doc?.filename?.endsWith('.docx') && doc?.fileUrl) {
      fetch(doc.fileUrl)
        .then((res) => res.arrayBuffer())
        .then((buffer) => mammoth.convertToHtml({ arrayBuffer: buffer }))
        .then((result) => setDocxHtml(result.value))
        .catch((err) => console.error('DOCX render error:', err));
    }
  }, [doc]);

  useEffect(() => {
    const ext = doc?.filename?.split('.').pop()?.toLowerCase();
    if (!doc?.id || !['xlsx', 'xls', 'csv'].includes(ext)) return;
    fetch(`/api/spreadsheet-data?documentId=${doc.id}`)
      .then((r) => r.json())
      .then((res) => res?.success && setSpreadsheetData(res.sheets))
      .catch((err) => console.error('Spreadsheet preview error:', err));
  }, [doc?.id]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleOpenFullView = () => {
    if (!doc) return;
    router.push(`/document?id=${doc.id}`);
    onClose?.();
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={handleBackdropClick}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative w-full max-w-4xl h-[85vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {doc?.filename || 'Loading…'}
            </h3>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenFullView}
                disabled={!doc}
                className="flex items-center space-x-2"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Open Document View</span>
              </Button>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 p-4">
            {loading ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
                  <p className="text-gray-400 dark:text-gray-500 text-sm">Loading preview…</p>
                </div>
              </div>
            ) : (
              <DocumentPreviewBody
                doc={doc}
                docxHtml={docxHtml}
                spreadsheetData={spreadsheetData}
                activeSheetIndex={activeSheetIndex}
                onActiveSheetChange={setActiveSheetIndex}
                imageZoom={imageZoom}
                onImageZoomChange={setImageZoom}
              />
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
