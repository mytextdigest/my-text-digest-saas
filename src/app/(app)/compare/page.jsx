'use client'
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, GitCompare, RefreshCw, Trash2, Loader2, AlertCircle,
  Equal, Pencil, Plus, Minus, FileText, Lightbulb, History, ListFilter, BookOpen,
  Sparkles, Download,
} from 'lucide-react';
import Layout from '@/components/layout/Layout';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import DeleteConfirmationModal from '@/components/modals/DeleteConfirmationModal';
import { InsightView } from '@/components/insights/InsightView';
import { cn, formatDate } from '@/lib/utils';

// Poll interval for the 'generating' status — same pattern as
// GraphView.jsx/FiguresGallery.jsx's own polling.
const POLL_INTERVAL_MS = 3000;
const IN_PROGRESS_STATUSES = ['generating'];

// Text-size control (excludes the h1 title and header — only the body
// content below it scales). CSS `zoom` scales an entire subtree (fonts,
// padding, gaps, line-height) exactly like a browser zoom, which is far
// more reliable here than juggling per-element Tailwind size classes across
// a dozen different components. "Normal" is the original sizing — kept as
// the floor, not the default, after client feedback that it read too small;
// "Large" starts selected instead.
const TEXT_SIZE_LEVELS = [
  { key: 'normal', label: 'Normal', zoom: 1 },
  { key: 'large', label: 'Large', zoom: 1.15 },
  { key: 'larger', label: 'Larger', zoom: 1.3 },
  { key: 'largest', label: 'Largest', zoom: 1.45 },
];
const DEFAULT_TEXT_SIZE = 'large';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'same', label: 'Same' },
  { key: 'changed', label: 'Changed' },
  { key: 'added', label: 'Added' },
  { key: 'removed', label: 'Removed' },
];

const CATEGORY_STYLE = {
  same:    { label: 'Same',    icon: Equal,  className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  changed: { label: 'Changed', icon: Pencil, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  added:   { label: 'Added',   icon: Plus,   className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  removed: { label: 'Removed', icon: Minus,  className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

const SUMMARY_CATEGORY_STYLE = {
  'Key Difference': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'Key Similarity': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  'Notable Risk':   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  'Other':          'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

function CategoryBadge({ category }) {
  const style = CATEGORY_STYLE[category] || CATEGORY_STYLE.same;
  const Icon = style.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full', style.className)}>
      <Icon className="h-3 w-3" />
      {style.label}
    </span>
  );
}

function FindingCard({ finding, onOpenDocument }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <Card className="overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {finding.sectionLabel || 'Untitled section'}
            </h4>
            <CategoryBadge category={finding.category} />
          </div>

          {finding.explanation && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{finding.explanation}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={cn(
              'rounded-lg border p-3 text-xs leading-relaxed',
              finding.documentAExcerpt
                ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300'
                : 'border-dashed border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-600 italic'
            )}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-gray-500 dark:text-gray-400">Document A</span>
                {finding.documentAChunkId && (
                  <button
                    onClick={() => onOpenDocument('a')}
                    className="text-primary-600 dark:text-primary-400 hover:underline text-[11px]"
                  >
                    View source
                  </button>
                )}
              </div>
              {finding.documentAExcerpt ? `"${finding.documentAExcerpt.slice(0, 280)}${finding.documentAExcerpt.length > 280 ? '…' : ''}"` : 'Not present in this document.'}
            </div>

            <div className={cn(
              'rounded-lg border p-3 text-xs leading-relaxed',
              finding.documentBExcerpt
                ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-300'
                : 'border-dashed border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-600 italic'
            )}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-gray-500 dark:text-gray-400">Document B</span>
                {finding.documentBChunkId && (
                  <button
                    onClick={() => onOpenDocument('b')}
                    className="text-primary-600 dark:text-primary-400 hover:underline text-[11px]"
                  >
                    View source
                  </button>
                )}
              </div>
              {finding.documentBExcerpt ? `"${finding.documentBExcerpt.slice(0, 280)}${finding.documentBExcerpt.length > 280 ? '…' : ''}"` : 'Not present in this document.'}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function DocumentCell({ side, text, present, accent, onOpenDocument, chunkId }) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 text-sm leading-relaxed',
        !present
          ? 'border-dashed border-gray-200 dark:border-gray-800'
          : accent === 'red'
          ? 'bg-red-50/60 dark:bg-red-900/10 border-red-100 dark:border-red-900/60'
          : accent === 'green'
          ? 'bg-green-50/60 dark:bg-green-900/10 border-green-100 dark:border-green-900/60'
          : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700'
      )}
    >
      {present ? (
        <>
          <span
            className={cn(
              'text-gray-800 dark:text-gray-200',
              accent === 'red' && 'line-through decoration-red-300 dark:decoration-red-700 decoration-2 text-gray-500 dark:text-gray-400',
              accent === 'green' && 'underline decoration-green-400 dark:decoration-green-600 decoration-2 underline-offset-2'
            )}
          >
            {text}
          </span>
          {chunkId && (
            <button
              onClick={() => onOpenDocument(side)}
              className="block mt-1.5 no-underline text-primary-600 dark:text-primary-400 hover:underline text-[11px]"
            >
              View source
            </button>
          )}
        </>
      ) : (
        <span className="italic text-gray-300 dark:text-gray-600">Not present in this document.</span>
      )}
    </div>
  );
}

// Side-by-side reading mode (as an alternative to the Findings tabs' triage
// list): every finding becomes one row in a two-column grid, Document A on
// the left and Document B on the right, in original reading order — same
// underlying data as the Findings tab, just laid out and sorted like a diff
// viewer instead of a categorized card list. A React.Fragment (not a div)
// keeps its children as direct grid items so they land in the same grid row
// as their neighbor without an extra wrapper breaking the column tracks.
function SideBySideRow({ finding, isFirst, onOpenDocument }) {
  return (
    <>
      <div className={cn('md:col-span-2 flex items-center gap-2', isFirst ? 'pt-1' : 'pt-4 mt-4 border-t border-gray-100 dark:border-gray-800')}>
        <CategoryBadge category={finding.category} />
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {finding.sectionLabel || 'Untitled section'}
        </h4>
      </div>
      {finding.explanation && (
        <p className="md:col-span-2 text-xs text-gray-500 dark:text-gray-400 italic -mt-1.5 mb-0.5">{finding.explanation}</p>
      )}
      <DocumentCell
        side="a"
        text={finding.documentAExcerpt}
        present={!!finding.documentAExcerpt}
        accent={finding.category === 'removed' || finding.category === 'changed' ? 'red' : null}
        chunkId={finding.documentAChunkId}
        onOpenDocument={onOpenDocument}
      />
      <DocumentCell
        side="b"
        text={finding.documentBExcerpt}
        present={!!finding.documentBExcerpt}
        accent={finding.category === 'added' || finding.category === 'changed' ? 'green' : null}
        chunkId={finding.documentBChunkId}
        onOpenDocument={onOpenDocument}
      />
    </>
  );
}

function CompareContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const comparisonId = searchParams.get('id');

  const [comparison, setComparison] = useState(null);
  const [findings, setFindings] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [viewMode, setViewMode] = useState('findings'); // 'findings' | 'document' | 'insight'
  const [insightStyle, setInsightStyle] = useState('compact'); // 'compact' | 'descriptive'
  const [generatingInsight, setGeneratingInsight] = useState(false);
  const [insightError, setInsightError] = useState(null);
  const [downloadingInsight, setDownloadingInsight] = useState(null); // style currently downloading, or null
  const [textSize, setTextSize] = useState(DEFAULT_TEXT_SIZE);
  const [regenerating, setRegenerating] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async (id, { silent = false } = {}) => {
    if (!id) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/comparisons/${id}`, { credentials: 'include' }).then((r) => r.json());
      if (!res?.success) {
        setError(res?.error || 'Comparison not found.');
        setComparison(null);
        setFindings([]);
        return;
      }
      setComparison(res.comparison);
      setFindings(res.findings || []);

      const historyRes = await fetch(`/api/projects/${res.comparison.projectId}/comparisons`, { credentials: 'include' }).then((r) => r.json());
      if (historyRes?.success) {
        const { documentAId: a, documentBId: b } = res.comparison;
        setHistory(
          historyRes.comparisons
            .filter((c) => c.id !== res.comparison.id &&
              ((c.documentAId === a && c.documentBId === b) || (c.documentAId === b && c.documentBId === a)))
        );
      }
    } catch (err) {
      console.error('Failed to load comparison:', err);
      setError('Failed to load comparison.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(comparisonId); }, [comparisonId, load]);

  // Poll while the comparison is still generating — same pattern as
  // GraphView.jsx/FiguresGallery.jsx.
  useEffect(() => {
    if (!comparisonId || !IN_PROGRESS_STATUSES.includes(comparison?.status)) return;
    const interval = setInterval(() => load(comparisonId, { silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [comparisonId, comparison?.status, load]);

  const handleRegenerate = async () => {
    if (!comparisonId) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/comparisons/${comparisonId}/regenerate`, { method: 'POST', credentials: 'include' }).then((r) => r.json());
      if (res?.success) {
        router.replace(`/compare?id=${res.comparisonId}`);
        await load(res.comparisonId);
      } else {
        setError(res?.error || 'Regeneration failed.');
      }
    } finally {
      setRegenerating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!comparisonId) return;
    setIsDeleting(true);
    try {
      await fetch(`/api/comparisons/${comparisonId}`, { method: 'DELETE', credentials: 'include' });
      router.push(comparison?.projectId ? `/project?id=${comparison.projectId}` : '/');
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const openDocument = (side) => {
    if (!comparison) return;
    const docId = side === 'a' ? comparison.documentAId : comparison.documentBId;
    router.push(`/document?id=${docId}`);
  };

  const handleSelectInsightStyle = async (style) => {
    setInsightStyle(style);
    setInsightError(null);
    // Compact is normally generated with the comparison itself, and
    // Descriptive is generated lazily the first time someone asks for it —
    // but either can be missing (an older comparison from before this
    // feature existed, or a one-off generation failure), so both fall back
    // to generating on demand here when not already present.
    const field = style === 'descriptive' ? 'insightDescriptive' : 'insightCompact';
    if (!comparison?.[field] && comparisonId) {
      setGeneratingInsight(true);
      try {
        const res = await fetch(`/api/comparisons/${comparisonId}/insight`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ style }),
        }).then((r) => r.json());
        if (res?.success) {
          setComparison((prev) => (prev ? { ...prev, [field]: res.insight } : prev));
        } else {
          setInsightError(res?.error || 'Failed to generate this insight.');
        }
      } finally {
        setGeneratingInsight(false);
      }
    }
  };

  const handleDownloadInsight = (style) => {
    if (!comparisonId) return;
    setDownloadingInsight(style);
    setInsightError(null);
    // The route returns the PDF file directly with Content-Disposition:
    // attachment — no client-side blob handling needed, a plain navigation
    // triggers the browser's own download UI.
    window.open(`/api/comparisons/${comparisonId}/insight-pdf?style=${style}`, '_blank');
    setDownloadingInsight(null);
  };

  const filteredFindings = activeTab === 'all' ? findings : findings.filter((f) => f.category === activeTab);
  const counts = findings.reduce((acc, f) => { acc[f.category] = (acc[f.category] || 0) + 1; return acc; }, {});
  const orderKey = (f) => f.documentAChunkIndex ?? f.documentBChunkIndex ?? Number.MAX_SAFE_INTEGER;
  const orderedFindings = [...findings].sort((a, b) => orderKey(a) - orderKey(b));
  const bodyZoom = TEXT_SIZE_LEVELS.find((l) => l.key === textSize)?.zoom || 1;

  return (
    <Layout>
      <div className={cn('mx-auto pt-2.5 pb-10 space-y-6 transition-[max-width]', viewMode === 'document' ? 'max-w-7xl' : 'max-w-4xl')}>
        <Button
          variant="ghost"
          onClick={() => router.push(comparison?.projectId ? `/project?id=${comparison.projectId}` : '/')}
          className="flex items-center space-x-2 text-gray-600 dark:text-gray-400"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Project</span>
        </Button>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 text-gray-400 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-2">
            <AlertCircle className="h-10 w-10 text-red-300 dark:text-red-800" />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{error}</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center shrink-0">
                    <GitCompare className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {comparison.documentAFilename} <span className="text-gray-400 font-normal">vs</span> {comparison.documentBFilename}
                    </h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Generated {formatDate(comparison.createdAt)}
                      {comparison.status === 'error' && <span className="text-red-500 ml-2">· generation failed</span>}
                      {comparison.status === 'generating' && <span className="text-blue-500 ml-2">· generating…</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Text size control — scales everything below this header. "Normal"
                      stays the floor (the original sizing), never smaller; default is
                      bumped up a notch since the original size read too small. */}
                  <div className="flex items-center px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                    <label htmlFor="compare-text-size" className="sr-only">Text size</label>
                    <select
                      id="compare-text-size"
                      value={textSize}
                      onChange={(e) => setTextSize(e.target.value)}
                      className="text-sm outline-none cursor-pointer rounded px-1 bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600"
                      title="Text size"
                    >
                      {TEXT_SIZE_LEVELS.map((lvl) => (
                        <option key={lvl.key} value={lvl.key} className="bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                          {lvl.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />
                  <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={regenerating} className="flex items-center gap-1.5">
                    {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Regenerate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowDeleteModal(true)}
                    className="flex items-center gap-1.5 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>

            {/* Everything below the title/actions header scales with the text-size
                control above — the h1 title itself stays fixed. */}
            <div style={{ zoom: bodyZoom }} className="space-y-6">
            {comparison.status === 'generating' ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                <Loader2 className="h-8 w-8 text-gray-300 dark:text-gray-600 animate-spin" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Comparing documents…</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 max-w-64">
                  Aligning sections and generating findings. This can take a minute for long documents.
                </p>
              </div>
            ) : comparison.status === 'error' ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                <AlertCircle className="h-10 w-10 text-red-300 dark:text-red-800" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Comparison failed</p>
                {comparison.errorMessage && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md">{comparison.errorMessage}</p>
                )}
                <Button size="sm" onClick={handleRegenerate} disabled={regenerating} className="flex items-center gap-2">
                  {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Try again
                </Button>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                {comparison.summary?.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {comparison.summary.map((s, i) => (
                      <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                        <Card>
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                                <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                {s.title}
                              </h3>
                              <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0', SUMMARY_CATEGORY_STYLE[s.category] || SUMMARY_CATEGORY_STYLE.Other)}>
                                {s.category}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-300">{s.explanation}</p>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* View mode toggle — Findings (triage, filterable by category) vs
                    Document View (read in original order, redline-style inline) */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  {viewMode === 'findings' ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      {TABS.map((tab) => (
                        <Button
                          key={tab.key}
                          variant={activeTab === tab.key ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => setActiveTab(tab.key)}
                          className={cn(
                            'flex items-center space-x-1.5',
                            activeTab === tab.key ? 'text-white dark:text-gray-200' : 'text-gray-600 dark:text-gray-400'
                          )}
                        >
                          <span>{tab.label}</span>
                          {tab.key !== 'all' && counts[tab.key] > 0 && (
                            <span className="text-[10px] opacity-70">{counts[tab.key]}</span>
                          )}
                        </Button>
                      ))}
                    </div>
                  ) : viewMode === 'document' ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Document A on the left, Document B on the right, in original reading order — struck-through is removed, underlined is added.
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
                        <button
                          onClick={() => handleSelectInsightStyle('compact')}
                          className={cn(
                            'text-xs px-2.5 py-1 rounded transition-colors',
                            insightStyle === 'compact'
                              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
                              : 'text-gray-400 hover:text-gray-600'
                          )}
                        >
                          Compact
                        </button>
                        <button
                          onClick={() => handleSelectInsightStyle('descriptive')}
                          className={cn(
                            'text-xs px-2.5 py-1 rounded transition-colors',
                            insightStyle === 'descriptive'
                              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
                              : 'text-gray-400 hover:text-gray-600'
                          )}
                        >
                          Descriptive
                        </button>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadInsight(insightStyle)}
                        disabled={
                          downloadingInsight === insightStyle ||
                          (insightStyle === 'compact' ? !comparison.insightCompact?.sections?.length : !comparison.insightDescriptive?.sections?.length)
                        }
                        className="flex items-center gap-1.5"
                        title="Download this version as a PDF"
                      >
                        {downloadingInsight === insightStyle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                        Download PDF
                      </Button>
                      {insightError && <span className="text-xs text-red-500">{insightError}</span>}
                    </div>
                  )}

                  <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg p-1 shrink-0">
                    <button
                      onClick={() => setViewMode('findings')}
                      className={cn(
                        'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors',
                        viewMode === 'findings'
                          ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
                          : 'text-gray-400 hover:text-gray-600'
                      )}
                    >
                      <ListFilter className="w-3.5 h-3.5" /> Findings
                    </button>
                    <button
                      onClick={() => setViewMode('document')}
                      className={cn(
                        'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors',
                        viewMode === 'document'
                          ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
                          : 'text-gray-400 hover:text-gray-600'
                      )}
                    >
                      <BookOpen className="w-3.5 h-3.5" /> Document View
                    </button>
                    <button
                      onClick={() => { setViewMode('insight'); handleSelectInsightStyle(insightStyle); }}
                      className={cn(
                        'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors',
                        viewMode === 'insight'
                          ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400'
                          : 'text-gray-400 hover:text-gray-600'
                      )}
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Insights
                    </button>
                  </div>
                </div>

                {/* Document View column headers — sit above the side-by-side grid below */}
                {viewMode === 'document' && (
                  <div className="hidden md:grid grid-cols-2 gap-x-6">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 truncate">
                      Document A — {comparison.documentAFilename}
                    </p>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 truncate">
                      Document B — {comparison.documentBFilename}
                    </p>
                  </div>
                )}

                {/* Findings / Document View / Insights content */}
                <div className="space-y-3">
                  <AnimatePresence mode="wait">
                    {viewMode === 'findings' ? (
                      filteredFindings.length === 0 ? (
                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                          No findings in this category.
                        </motion.div>
                      ) : (
                        <motion.div key={`findings-${activeTab}`} className="space-y-3">
                          {filteredFindings.map((finding) => (
                            <FindingCard key={finding.id} finding={finding} onOpenDocument={openDocument} />
                          ))}
                        </motion.div>
                      )
                    ) : viewMode === 'document' ? (
                      <motion.div
                        key="document-view"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 items-start"
                      >
                        {orderedFindings.map((finding, i) => (
                          <SideBySideRow key={finding.id} finding={finding} isFirst={i === 0} onOpenDocument={openDocument} />
                        ))}
                      </motion.div>
                    ) : (
                      <motion.div key={`insight-${insightStyle}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        {generatingInsight ? (
                          <div className="flex flex-col items-center justify-center py-16 gap-2">
                            <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
                            <p className="text-xs text-gray-400 dark:text-gray-500">Writing the detailed version…</p>
                          </div>
                        ) : (
                          <InsightView
                            insight={insightStyle === 'compact' ? comparison.insightCompact : comparison.insightDescriptive}
                            documentAName={comparison.documentAFilename}
                            documentBName={comparison.documentBFilename}
                            emptyHint={
                              insightStyle === 'compact'
                                ? 'No compact insight is available for this comparison.'
                                : 'No detailed insight yet — switch to this tab to generate one.'
                            }
                          />
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* History */}
                {history.length > 0 && (
                  <div className="pt-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                      <History className="h-3.5 w-3.5" /> Past comparisons
                    </h3>
                    <div className="space-y-1.5">
                      {history.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => router.push(`/compare?id=${h.id}`)}
                          className="w-full flex items-center justify-between text-left px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60 text-xs"
                        >
                          <span className="text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 text-gray-400" />
                            {formatDate(h.createdAt)}
                          </span>
                          <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium',
                            h.status === 'ready' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                              : h.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300')}>
                            {h.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            </div>
          </>
        )}
      </div>

      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Comparison"
        message="Are you sure you want to delete this comparison? This action cannot be undone."
        confirmText="Delete Comparison"
        cancelText="Cancel"
        isLoading={isDeleting}
      />
    </Layout>
  );
}

function CompareLoading() {
  return (
    <Layout>
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 text-gray-400 animate-spin" />
      </div>
    </Layout>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<CompareLoading />}>
      <CompareContent />
    </Suspense>
  );
}
