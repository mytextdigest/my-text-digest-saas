'use client'
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileText, GitCompare, AlertCircle, Check } from 'lucide-react';
import { Modal, ModalHeader, ModalTitle, ModalDescription, ModalContent, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn, formatDate } from '@/lib/utils';

// A focused picker rather than in-card checkboxes elsewhere — the task is
// always "pick exactly two," so a dedicated list with a running selection
// count reads more clearly than scattering checkboxes across a document
// grid. Ported from the desktop app's ComparePickerModal, replacing
// window.api calls with fetch().
export default function ComparePickerModal({ isOpen, onClose, projectId, documents = [], onCreated }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]); // [{id, filename}]
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  // Only fully-processed documents can be compared — the compare worker
  // needs embedded chunks on both sides, which isn't guaranteed until a
  // document reaches "ready".
  const comparable = useMemo(
    () => documents.filter((d) => d.status === 'ready'),
    [documents]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return comparable;
    return comparable.filter((d) => (d.filename || '').toLowerCase().includes(q));
  }, [comparable, search]);

  const reset = () => {
    setSearch('');
    setSelected([]);
    setError(null);
    setCreating(false);
  };

  const handleClose = () => {
    if (creating) return;
    reset();
    onClose?.();
  };

  const toggle = (doc) => {
    setError(null);
    setSelected((prev) => {
      const already = prev.some((d) => d.id === doc.id);
      if (already) return prev.filter((d) => d.id !== doc.id);
      if (prev.length >= 2) return prev; // exactly-two picker
      return [...prev, { id: doc.id, filename: doc.filename }];
    });
  };

  const handleCompare = async () => {
    if (selected.length !== 2) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/comparisons`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentAId: selected[0].id, documentBId: selected[1].id }),
      }).then((r) => r.json());
      if (res?.success) {
        reset();
        onCreated?.(res.comparisonId);
      } else {
        setError(res?.error || 'Comparison failed. Please try again.');
        setCreating(false);
      }
    } catch (err) {
      console.error('Failed to create comparison:', err);
      setError('Comparison failed. Please try again.');
      setCreating(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg" showCloseButton={!creating}>
      <ModalHeader>
        <ModalTitle className="flex items-center gap-2">
          <GitCompare className="h-5 w-5 text-primary-600" />
          Compare Documents
        </ModalTitle>
        <ModalDescription>
          Pick two documents to see what's the same, changed, added, or removed between them.
        </ModalDescription>
      </ModalHeader>

      <ModalContent>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
            disabled={creating}
          />
        </div>

        <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
              {comparable.length === 0 ? 'No documents ready to compare yet.' : 'No documents match your search.'}
            </div>
          ) : (
            filtered.map((doc) => {
              const isChecked = selected.some((d) => d.id === doc.id);
              const disabled = creating || (!isChecked && selected.length >= 2);
              return (
                <button
                  type="button"
                  key={doc.id}
                  onClick={() => !disabled && toggle(doc)}
                  disabled={disabled}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                    disabled && !isChecked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60',
                    isChecked && 'bg-primary-50 dark:bg-primary-900/20'
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0 h-5 w-5 rounded-md border flex items-center justify-center transition-colors',
                      isChecked
                        ? 'bg-primary-600 border-primary-600 text-white'
                        : 'border-gray-300 dark:border-gray-600'
                    )}
                  >
                    {isChecked && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {doc.filename}
                    </span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">
                      {formatDate(doc.createdAt || doc.created_at)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mt-3 flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
          {selected.length === 0 && 'Select two documents to compare.'}
          {selected.length === 1 && `1 selected — pick one more (${selected[0].filename}).`}
          {selected.length === 2 && (creating
            ? 'Starting the comparison…'
            : `Ready to compare "${selected[0].filename}" and "${selected[1].filename}".`)}
        </p>
      </ModalContent>

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose} disabled={creating}>
          Cancel
        </Button>
        <Button onClick={handleCompare} disabled={selected.length !== 2 || creating} loading={creating}>
          {!creating && <GitCompare className="h-4 w-4 mr-2" />}
          {creating ? 'Starting…' : 'Compare'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
