'use client'
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, Network, Sparkles, RefreshCw, Maximize2, X, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import EntityDetailModal from './EntityDetailModal';
import InsightsPanel from './InsightsPanel';

// Client-only — the canvas measures real DOM node sizes to run its force
// layout, which isn't possible during SSR.
const EntityGraphCanvas = dynamic(() => import('./EntityGraphCanvas'), { ssr: false });

const POLL_INTERVAL_MS = 3000;

// Cross-document view: every entity resolved within this project, and every
// relationship extracted from any of its documents. Generation is entirely
// manual — the "Generate" button below kicks off the graph-batch worker job,
// which processes every document in the project that doesn't already have a
// ready graph. There is no automatic trigger anywhere in the pipeline.
//
// Unlike the desktop app (which pushed progress over IPC as
// 'project-graph-generation-update'), this codebase has no server-push
// mechanism, so progress is polled from GET .../graph instead — the same
// documentsTotal/documentsProcessed counts drive the same "Generating
// (2/5)"-style label, just pulled rather than pushed.
export default function ProjectGraphView({ projectId }) {
  const [graph, setGraph] = useState({ nodes: [], edges: [], documentsTotal: 0, documentsProcessed: 0, documentsFailed: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  // { entityIds: Set<string>, relationshipIds: Set<string>, insightId } | null
  const [highlight, setHighlight] = useState(null);
  const pollRef = useRef(null);

  // Insights panel and the entity-detail panel occupy the same slot on
  // screen — opening one closes the other, and closing Insights also drops
  // whatever highlight it was showing.
  const openInsights = () => { setSelectedEntityId(null); setInsightsOpen(true); };
  const closeInsights = () => { setInsightsOpen(false); setHighlight(null); };
  const handleNodeClick = (id) => { setInsightsOpen(false); setSelectedEntityId(id); };
  const handleShowOnGraph = (insight) => {
    if (!insight) { setHighlight(null); return; }
    setHighlight({
      entityIds: new Set(insight.entityIds),
      relationshipIds: new Set(insight.relationshipIds),
      insightId: insight.id,
    });
  };

  const fetchGraph = async () => {
    const res = await fetch(`/api/projects/${projectId}/graph`, { credentials: 'include' }).then((r) => r.json());
    if (res?.success) setGraph(res);
    return res;
  };

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetchGraph().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Every document has reached a terminal state (ready or error) once
  // processed+failed catches up to total — the signal to stop polling, since
  // an errored document would otherwise keep documentsProcessed permanently
  // below documentsTotal with no further progress ever coming.
  const remaining = Math.max(0, (graph.documentsTotal || 0) - (graph.documentsProcessed || 0) - (graph.documentsFailed || 0));

  useEffect(() => {
    clearInterval(pollRef.current);
    if (generating) {
      pollRef.current = setInterval(async () => {
        const res = await fetchGraph();
        if (res?.success) {
          const stillRemaining = Math.max(0, (res.documentsTotal || 0) - (res.documentsProcessed || 0) - (res.documentsFailed || 0));
          if (stillRemaining === 0) setGenerating(false);
        }
      }, POLL_INTERVAL_MS);
    }
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  const handleGenerate = async () => {
    if (!projectId) return;
    setGenerating(true);
    const res = await fetch(`/api/projects/${projectId}/graph/generate`, { method: 'POST', credentials: 'include' })
      .then((r) => r.json());
    if (res?.success && res.documentsQueued === 0) {
      // Nothing needed processing (already generated, or no documents at all).
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-12">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (generating && graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
        <Loader2 className="h-8 w-8 text-gray-300 dark:text-gray-600 animate-spin" />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Building project graph…</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-72">
          {graph.documentsTotal
            ? `Processing document ${Math.min(graph.documentsProcessed + graph.documentsFailed + 1, graph.documentsTotal)} of ${graph.documentsTotal}. This can take a while for larger projects.`
            : 'Starting up…'}
        </p>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
        <Network className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No knowledge graph yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-72">
          {graph.documentsTotal > 0
            ? `Generate graphs for ${graph.documentsTotal === 1 ? 'the document' : `all ${graph.documentsTotal} documents`} in this project to see the people, organizations, and other entities they mention — linked across documents where they overlap.`
            : "This project doesn't have any documents yet."}
        </p>
        <Button size="sm" onClick={handleGenerate} className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" /> Generate
        </Button>
      </div>
    );
  }

  const mergeCandidates = graph.nodes.map((n) => ({ id: n.id, name: n.name, type: n.type }));

  return (
    <div className={fullscreen ? "fixed inset-0 z-60 bg-gray-50 dark:bg-gray-900" : "relative w-full h-full min-h-[420px]"}>
      {!generating && remaining > 0 && (
        <div className="absolute top-3 left-3 z-10 max-w-xs text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2 shadow-sm">
          Showing {graph.documentsProcessed} of {graph.documentsTotal} documents — {remaining} not generated yet.
        </div>
      )}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {generating && graph.documentsTotal
            ? `Generating (${graph.documentsProcessed + graph.documentsFailed}/${graph.documentsTotal})`
            : remaining > 0
              ? `Generate (${remaining} remaining)`
              : 'Regenerate'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={openInsights}
          className="flex items-center gap-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm"
        >
          <Lightbulb className="h-3.5 w-3.5" /> Insights
        </Button>
        {fullscreen ? (
          <Button size="sm" onClick={() => setFullscreen(false)} className="flex items-center gap-2">
            <X className="h-3.5 w-3.5" /> Close
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFullscreen(true)}
            className="flex items-center gap-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm"
          >
            <Maximize2 className="h-3.5 w-3.5" /> Fullscreen
          </Button>
        )}
      </div>
      <EntityGraphCanvas nodes={graph.nodes} edges={graph.edges} onNodeClick={handleNodeClick} highlight={highlight} />
      <EntityDetailModal
        entityId={selectedEntityId}
        mergeCandidates={mergeCandidates}
        onClose={() => setSelectedEntityId(null)}
        onChanged={fetchGraph}
      />
      <InsightsPanel
        open={insightsOpen}
        projectId={projectId}
        activeInsightId={highlight?.insightId}
        onClose={closeInsights}
        onShowOnGraph={handleShowOnGraph}
      />
    </div>
  );
}
