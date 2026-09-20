'use client'
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { GitCompare, Plus, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn, formatDate } from '@/lib/utils';
import ComparePickerModal from './ComparePickerModal';

const STATUS_STYLE = {
  ready: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  generating: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

// Project-page entry point for Document Comparison: lists every past
// comparison in the project, newest first, with a "New Comparison" button
// that opens a two-document picker. Ported from the desktop app's
// ComparisonsView, adapted to fetch its own documents (this repo's
// ChatInterface.jsx only receives a projectId, not a documents list).
export default function ComparisonsView({ projectId }) {
  const router = useRouter();
  const [comparisons, setComparisons] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [comparisonsRes, documentsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/comparisons`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`/api/documents?projectId=${projectId}`, { credentials: 'include' }).then((r) => r.json()),
      ]);
      if (comparisonsRes?.success) setComparisons(comparisonsRes.comparisons);
      setDocuments(Array.isArray(documentsRes) ? documentsRes : documentsRes?.documents || []);
    } catch (err) {
      console.error('Failed to load comparisons:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const handleCreated = (comparisonId) => {
    setShowPicker(false);
    router.push(`/compare?id=${comparisonId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-12">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Comparisons</h3>
        <Button
          size="sm"
          onClick={() => setShowPicker(true)}
          disabled={documents.length < 2}
          className="flex items-center gap-1.5"
          title={documents.length < 2 ? 'Upload at least two documents to compare' : undefined}
        >
          <Plus className="h-3.5 w-3.5" /> New Comparison
        </Button>
      </div>

      {comparisons.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
          <GitCompare className="h-10 w-10 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No comparisons yet</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 max-w-64">
            Compare two documents to see what's the same, changed, added, or removed between them.
          </p>
        </div>
      ) : (
        <AnimatePresence>
          <div className="space-y-2">
            {comparisons.map((c) => (
              <motion.button
                key={c.id}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => router.push(`/compare?id=${c.id}`)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                  <span className="text-sm text-gray-700 dark:text-gray-200 truncate">
                    {c.documentAFilename} <span className="text-gray-400">vs</span> {c.documentBFilename}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{formatDate(c.createdAt)}</span>
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', STATUS_STYLE[c.status] || STATUS_STYLE.generating)}>
                    {c.status}
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
        </AnimatePresence>
      )}

      <ComparePickerModal
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        projectId={projectId}
        documents={documents}
        onCreated={handleCreated}
      />
    </div>
  );
}
