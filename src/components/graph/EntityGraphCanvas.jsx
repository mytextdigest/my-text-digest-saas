'use client'
import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, MarkerType, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TYPE_LABELS, fillForType } from './entityStyles';
import { computeForceLayout } from './graphLayout';
import EntityNode from './EntityNode';
import FloatingEdge from './FloatingEdge';

const NODE_TYPES = { entity: EntityNode };
const EDGE_TYPES = { floating: FloatingEdge };

const EDGE_LABEL_STYLE = {
  fontSize: 10,
  fontWeight: 500,
  color: 'var(--kg-edge-label-color, #52514e)',
  background: 'var(--kg-edge-label-bg, rgba(252,252,251,0.9))',
  padding: '1px 5px',
  borderRadius: 4,
  border: '1px solid var(--kg-edge-label-border, rgba(11,11,11,0.08))',
};

// highlightEntityIds: Set<string> | undefined — when set (an Insights panel
// card's "Show on graph" is active), every node NOT in the set is pushed to
// near-invisible and every node IN it is forced to full opacity with a glow
// ring, regardless of the normal degree-based sizing/opacity below. When
// undefined, behavior is unchanged from before insights existed.
//
// Entity ids here are cuid strings (this app's Prisma ids), unlike the
// desktop app's SQLite integer ids — the desktop source compared with
// Number(n.id); this port compares the strings directly instead.
function buildFlowNodes(laidOutNodes, highlightEntityIds) {
  const highlightActive = !!highlightEntityIds;
  return laidOutNodes.map((n) => {
    const highlighted = highlightActive && highlightEntityIds.has(n.id);
    return {
      id: n.id,
      type: 'entity',
      position: { x: n.x, y: n.y },
      data: {
        label: n.entity.name.length > 42 ? `${n.entity.name.slice(0, 40)}…` : n.entity.name,
        fullLabel: n.entity.name,
        type: n.entity.type,
        value: n.entity.value,
        unit: n.entity.unit,
        size: n.radius * 2,
        // Degree-0 nodes (no relationship touches them) get visually pushed
        // back rather than hidden — still findable, but they don't compete
        // with the connected part of the graph that actually tells a story.
        degree: n.degree,
        highlighted,
        dimmed: highlightActive && !highlighted,
      },
      draggable: true,
    };
  });
}

// Inferred edges (is_inferred=true, produced by the document-level synthesis
// pass in src/lib/graph/insights.js) render dashed rather than solid — the
// same color, so the CVD-safe stated-edge contrast fix still applies, with
// dash-vs-solid as the accessible secondary channel (the dataviz skill's
// "texture" pattern for line marks) distinguishing "the document states
// this" from "we connected this across the document" without a new color.
//
// highlightRelationshipIds mirrors highlightEntityIds above, for edges.
function buildFlowEdges(relationships, highlightRelationshipIds) {
  const highlightActive = !!highlightRelationshipIds;
  return relationships.map((r) => {
    const highlighted = highlightActive && highlightRelationshipIds.has(r.id);
    const dimmed = highlightActive && !highlighted;
    return {
      id: String(r.id),
      source: String(r.source_entity_id),
      target: String(r.target_entity_id),
      type: 'floating',
      label: r.is_inferred ? `Insight: ${r.relation}` : r.relation,
      labelStyle: {
        ...(r.is_inferred ? { ...EDGE_LABEL_STYLE, fontStyle: 'italic' } : EDGE_LABEL_STYLE),
        opacity: dimmed ? 0.2 : 1,
      },
      style: {
        strokeWidth: highlighted ? 2.5 : 1.75,
        stroke: 'var(--kg-edge-color, #6b6a63)',
        strokeDasharray: r.is_inferred ? '6 4' : undefined,
        opacity: dimmed ? 0.12 : 1,
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--kg-edge-color, #6b6a63)' },
    };
  });
}

function Legend({ types, hasInferredEdges }) {
  if (!types.length) return null;
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1.5 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 shadow-sm max-w-xs">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {types.map((type) => (
          <span key={type} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: fillForType(type).fill }}
            />
            {TYPE_LABELS[type] || type}
          </span>
        ))}
      </div>
      {hasInferredEdges && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-gray-200 dark:border-gray-700">
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <svg width="16" height="2" className="shrink-0"><line x1="0" y1="1" x2="16" y2="1" stroke="currentColor" strokeWidth="1.5" /></svg>
            Stated in document
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <svg width="16" height="2" className="shrink-0"><line x1="0" y1="1" x2="16" y2="1" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" /></svg>
            Inferred insight
          </span>
        </div>
      )}
    </div>
  );
}

// highlight: { entityIds: Set<string>, relationshipIds: Set<string> } | null
// — set when an Insights panel card's "Show on graph" is active.
export default function EntityGraphCanvas({ nodes: entities, edges: relationships, onNodeClick, highlight }) {
  const laidOut = useMemo(() => computeForceLayout(entities, relationships), [entities, relationships]);
  const nodes = useMemo(() => buildFlowNodes(laidOut, highlight?.entityIds), [laidOut, highlight]);
  const edges = useMemo(() => buildFlowEdges(relationships, highlight?.relationshipIds), [relationships, highlight]);
  const presentTypes = useMemo(
    () => [...new Set(entities.map((e) => e.type))].sort(),
    [entities]
  );
  const hasInferredEdges = useMemo(() => relationships.some((r) => r.is_inferred), [relationships]);

  return (
    <div className="relative w-full h-full min-h-[420px]">
      <style>{`
        .kg-canvas .react-flow__attribution { display: none; }
        .dark .kg-canvas {
          --kg-edge-color: #9c9b93;
          --kg-edge-label-bg: rgba(26,26,25,0.9);
          --kg-edge-label-border: rgba(255,255,255,0.1);
          --kg-edge-label-color: #c3c2b7;
        }
      `}</style>
      <ReactFlowProvider>
        <ReactFlow
          className="kg-canvas"
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClick={(_, node) => onNodeClick?.(node.id)}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          edgesFocusable={false}
          minZoom={0.1}
        >
          <Background gap={20} className="opacity-40" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            className="!bg-white dark:!bg-gray-800 !border !border-gray-200 dark:!border-gray-700"
            nodeColor={(n) => fillForType(n.data?.type).fill}
          />
        </ReactFlow>
      </ReactFlowProvider>
      <Legend types={presentTypes} hasInferredEdges={hasInferredEdges} />
    </div>
  );
}
