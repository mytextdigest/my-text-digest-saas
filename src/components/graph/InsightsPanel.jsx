'use client'
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Loader2, Sparkles, RefreshCw, Lightbulb, FileText, ChevronDown, ChevronRight, Crosshair, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { categoryStyle } from './insightStyles';

// Right-side slide-over panel for the "Insights" feature — same visual shell
// as EntityDetailModal (backdrop + fixed right-0 top-0 max-w-md panel,
// z-70/z-80 so it layers correctly over a fullscreen graph) so the two read
// as one system, but they're mutually exclusive: the parent (GraphView /
// ProjectGraphView) closes this whenever an entity node is clicked and vice
// versa, since both occupy the same slot on screen.
//
// docId set = document-scope insights; projectId (with docId omitted) =
// project-scope. Owns its own fetch, mirroring EntityDetailModal's own
// self-contained data loading — the parent only tracks whether the panel is
// open and which insight (if any) is currently highlighted on the graph.
export default function InsightsPanel({ open, docId, projectId, activeInsightId, onClose, onShowOnGraph }) {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [insights, setInsights] = useState([]);
  const [error, setError] = useState(null);
  const [expandedEvidence, setExpandedEvidence] = useState(null);

  const fetchInsights = async () => {
    const url = docId ? `/api/documents/${docId}/graph/insights` : `/api/projects/${projectId}/graph/insights`;
    const res = await fetch(url, { credentials: 'include' }).then((r) => r.json());
    if (res?.success) setInsights(res.insights || []);
    return res;
  };

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetchInsights().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, docId, projectId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const url = docId
        ? `/api/documents/${docId}/graph/insights/generate`
        : `/api/projects/${projectId}/graph/insights/generate`;
      const res = await fetch(url, { method: 'POST', credentials: 'include' }).then((r) => r.json());
      if (res?.success) {
        setInsights(res.insights || []);
      } else {
        setError(res?.error || 'Failed to generate insights');
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-70 bg-black/30"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.2 }}
            className="fixed right-0 top-0 z-80 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-lg flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                <Lightbulb className="h-4 w-4 text-amber-500" /> Insights
              </span>
              <div className="flex items-center gap-1">
                {insights.length > 0 && (
                  <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating} className="flex items-center gap-1.5 h-7 px-2 text-xs">
                    {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Regenerate
                  </Button>
                )}
                <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <X className="h-4 w-4 text-gray-500" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 text-gray-400 animate-spin" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center text-center py-12 space-y-3">
                  <p className="text-sm text-gray-500 dark:text-gray-400 max-w-64">{error}</p>
                  <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating} className="flex items-center gap-2">
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Try again
                  </Button>
                </div>
              ) : generating ? (
                <div className="flex flex-col items-center text-center py-12 space-y-3">
                  <Loader2 className="h-8 w-8 text-gray-300 dark:text-gray-600 animate-spin" />
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Analyzing the graph…</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 max-w-64">
                    Looking across the extracted entities, metrics, and relationships for the connections worth knowing.
                  </p>
                </div>
              ) : insights.length === 0 ? (
                <div className="flex flex-col items-center text-center py-12 space-y-3">
                  <Lightbulb className="h-10 w-10 text-gray-300 dark:text-gray-600" />
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No insights yet</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 max-w-64">
                    Generate a short list of the highest-value, document-grounded insights from this graph — growth,
                    financial, operational, and risk patterns worth calling out.
                  </p>
                  <Button size="sm" onClick={handleGenerate} className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5" /> Generate Insights
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {insights.map((insight) => {
                    const isActive = activeInsightId === insight.id;
                    const style = categoryStyle(insight.category);
                    const evidenceOpen = expandedEvidence === insight.id;
                    return (
                      <div
                        key={insight.id}
                        className={`rounded-lg border p-3 transition-colors ${
                          isActive
                            ? 'border-primary-400 dark:border-primary-500 bg-primary-50/50 dark:bg-primary-950/20'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-1.5 ${style.badge}`}>
                          {insight.category}
                        </span>
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">{insight.title}</h4>
                        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{insight.explanation}</p>

                        {insight.evidence?.length > 0 && (
                          <div className="mt-2">
                            <button
                              onClick={() => setExpandedEvidence(evidenceOpen ? null : insight.id)}
                              className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                            >
                              {evidenceOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              Evidence ({insight.evidence.length})
                            </button>
                            {evidenceOpen && (
                              <ul className="mt-1.5 space-y-1.5">
                                {insight.evidence.map((ev, i) => (
                                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 rounded px-2 py-1.5">
                                    <FileText className="h-3 w-3 mt-0.5 text-gray-400 shrink-0" />
                                    <span>
                                      <span className="text-gray-600 dark:text-gray-300">"{ev.quote}"</span>
                                      {' — '}{ev.filename}{ev.pageNumber != null ? `, page ${ev.pageNumber}` : ''}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        <Button
                          size="sm"
                          variant={isActive ? 'default' : 'outline'}
                          onClick={() => onShowOnGraph(isActive ? null : insight)}
                          className="mt-2.5 flex items-center gap-1.5 h-7 px-2.5 text-xs"
                        >
                          {isActive ? <XCircle className="h-3.5 w-3.5" /> : <Crosshair className="h-3.5 w-3.5" />}
                          {isActive ? 'Clear highlight' : 'Show on graph'}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
