'use client'
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, Network, AlertCircle, Sparkles, RefreshCw, Maximize2, X, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import EntityDetailModal from '@/components/graph/EntityDetailModal';
import InsightsPanel from '@/components/graph/InsightsPanel';

// The canvas measures real DOM node sizes to run its force layout, which
// can't happen during SSR — dynamic-import it client-only to avoid a
// hydration mismatch between the server-rendered (unmeasured) markup and
// the client's actual layout.
const EntityGraphCanvas = dynamic(() => import('@/components/graph/EntityGraphCanvas'), { ssr: false });

const POLL_INTERVAL_MS = 3000;
// 'pending' is the server's fallback when no GraphExtractionLog row exists
// yet — i.e. generation has never been triggered for this document, not an
// in-flight state. Real in-flight states are 'extracting'/'resolving'.
const IN_PROGRESS_STATUSES = ['extracting', 'resolving'];

export default function GraphView({ docId }) {
  const [graph, setGraph] = useState({ nodes: [], edges: [], status: 'pending', errorMessage: null });
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  // { entityIds: Set<string>, relationshipIds: Set<string>, insightId } | null
  // — set by an Insights panel card's "Show on graph" action.
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
    const res = await fetch(`/api/documents/${docId}/graph`, { credentials: 'include' }).then((r) => r.json());
    if (res?.success) setGraph(res);
  };

  useEffect(() => {
    if (!docId) return;
    setLoading(true);
    fetchGraph().finally(() => setLoading(false));
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const inProgress = IN_PROGRESS_STATUSES.includes(graph.status) || triggering;

  useEffect(() => {
    clearInterval(pollRef.current);
    if (inProgress) {
      pollRef.current = setInterval(fetchGraph, POLL_INTERVAL_MS);
    }
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgress]);

  // Once the server confirms the job actually started (status flips away
  // from 'pending'), drop the optimistic flag and let graph.status drive.
  useEffect(() => {
    if (triggering && graph.status !== 'pending') setTriggering(false);
  }, [triggering, graph.status]);

  const handleGenerate = async () => {
    if (!docId) return;
    setTriggering(true);
    setGraph((g) => ({ ...g, status: 'extracting', errorMessage: null }));
    try {
      await fetch(`/api/documents/${docId}/graph/generate`, { method: 'POST', credentials: 'include' });
    } finally {
      // First poll tick (below) will pick up the real status regardless.
      fetchGraph();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-12">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (graph.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
        <AlertCircle className="h-10 w-10 text-red-300 dark:text-red-800" />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Graph generation failed</p>
        {graph.errorMessage && (
          <p className="text-xs text-gray-400 dark:text-gray-500 max-w-64">{graph.errorMessage}</p>
        )}
        <Button size="sm" variant="outline" onClick={handleGenerate} className="flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      </div>
    );
  }

  if (inProgress && graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
        <Loader2 className="h-8 w-8 text-gray-300 dark:text-gray-600 animate-spin" />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Building knowledge graph…</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-64">
          Extracting entities and relationships from this document. This can take a minute or two.
        </p>
      </div>
    );
  }

  if (graph.status === 'pending' && graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
        <Network className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No knowledge graph yet</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-64">
          Generate a graph of the people, organizations, and other entities this document mentions,
          and how they relate to each other.
        </p>
        <Button size="sm" onClick={handleGenerate} className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" /> Generate Graph
        </Button>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-12 space-y-3">
        <Network className="h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No entities found</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-64">
          We couldn't identify any clear people, organizations, or other entities in this document.
        </p>
        <Button size="sm" variant="outline" onClick={handleGenerate} className="flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Regenerate
        </Button>
      </div>
    );
  }

  return (
    <div className={fullscreen ? "fixed inset-0 z-60 bg-gray-50 dark:bg-gray-900" : "relative w-full h-full"}>
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleGenerate}
          disabled={inProgress}
          className="flex items-center gap-2 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm"
        >
          {inProgress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Regenerate
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
          <Button
            size="sm"
            onClick={() => setFullscreen(false)}
            className="flex items-center gap-2"
          >
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
        onClose={() => setSelectedEntityId(null)}
        onChanged={fetchGraph}
      />
      <InsightsPanel
        open={insightsOpen}
        docId={docId}
        activeInsightId={highlight?.insightId}
        onClose={closeInsights}
        onShowOnGraph={handleShowOnGraph}
      />
    </div>
  );
}
