'use client'
import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { fillForType } from './entityStyles';

// Filled circular node, sized by graph degree and colored by entity type —
// matches the reference look (Neo4j Bloom-style: solid color blobs with a
// centered label, not outlined pills). Four invisible, center-anchored
// handles feed FloatingEdge, which computes the actual line/circle
// intersection so edges radiate toward whichever node they connect to
// instead of all leaving from one fixed side.
function EntityNode({ data, selected }) {
  const { fill, text } = fillForType(data.type);
  const size = data.size;
  const fontSize = Math.max(9, Math.min(13, size / 5.2));
  const isMetric = data.type === 'metric' && data.value;
  // Nodes no relationship touches (degree 0) recede rather than compete for
  // attention with the part of the graph that actually connects — they're
  // still findable (already the smallest size, per graphLayout's degree-based
  // sizing) and clicking still works, just visually quieter.
  const isIsolated = data.degree === 0;

  // An Insights panel card's "Show on graph" overrides the isolated-node
  // dimming above: this node is either a cited supporter (full opacity + a
  // glow ring) or not part of this insight (pushed to near-invisible),
  // regardless of its normal degree-based treatment.
  let opacity = isIsolated ? 0.55 : 1;
  let highlightRing = null;
  if (data.highlighted) {
    opacity = 1;
    highlightRing = '0 0 0 3px rgba(245,158,11,0.75), 0 2px 10px rgba(0,0,0,0.4)';
  } else if (data.dimmed) {
    opacity = 0.12;
  }

  const handleStyle = {
    opacity: 0,
    pointerEvents: 'none',
    width: 1,
    height: 1,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  };

  return (
    <div
      title={data.fullLabel}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: fill,
        color: text,
        opacity,
        transition: 'opacity 150ms ease',
        border: selected ? '3px solid #ffffff' : '2.5px solid rgba(255,255,255,0.85)',
        boxShadow: highlightRing || (selected
          ? '0 0 0 2px rgba(37,99,235,0.6), 0 2px 8px rgba(0,0,0,0.35)'
          : '0 1px 4px rgba(0,0,0,0.3)'),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 6,
        cursor: 'pointer',
        boxSizing: 'border-box',
      }}
    >
      {isMetric && (
        <span
          style={{
            fontSize: Math.max(11, Math.min(16, size / 4)),
            fontWeight: 700,
            lineHeight: 1.05,
          }}
        >
          {data.value}{data.unit || ''}
        </span>
      )}
      <span
        style={{
          fontSize: isMetric ? Math.max(8, fontSize - 1) : fontSize,
          fontWeight: isMetric ? 500 : 600,
          opacity: isMetric ? 0.85 : 1,
          lineHeight: 1.15,
          display: '-webkit-box',
          WebkitLineClamp: isMetric ? 2 : 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          wordBreak: 'break-word',
        }}
      >
        {data.label}
      </span>
      <Handle type="source" position={Position.Top} id="top" style={handleStyle} />
      <Handle type="target" position={Position.Top} id="top-t" style={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={handleStyle} />
      <Handle type="target" position={Position.Bottom} id="bottom-t" style={handleStyle} />
    </div>
  );
}

export default memo(EntityNode);
