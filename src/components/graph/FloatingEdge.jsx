'use client'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useInternalNode } from '@xyflow/react';

// Standard React Flow "floating edge" pattern (reactflow.dev/examples/edges/
// floating-edges), specialized for circular nodes: rather than connecting to
// a Handle fixed at one side of the node (which makes every edge leave from
// the same point regardless of the other node's direction — the messy-arrow
// look in the previous circular layout), this computes where the straight
// line between the two node CENTERS crosses each node's circle boundary, so
// edges visually radiate toward whichever node they actually connect to.
function getNodeCenter(node) {
  const { x, y } = node.internals.positionAbsolute;
  const width = node.measured?.width ?? 0;
  const height = node.measured?.height ?? 0;
  return { x: x + width / 2, y: y + height / 2 };
}

function pointOnCircle(fromCenter, towardCenter, radius) {
  const dx = towardCenter.x - fromCenter.x;
  const dy = towardCenter.y - fromCenter.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: fromCenter.x + (dx / dist) * radius,
    y: fromCenter.y + (dy / dist) * radius,
  };
}

export default function FloatingEdge({ id, source, target, markerEnd, style, label, labelStyle }) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!sourceNode || !targetNode) return null;

  const sourceCenter = getNodeCenter(sourceNode);
  const targetCenter = getNodeCenter(targetNode);
  const sourceRadius = (sourceNode.measured?.width ?? 0) / 2;
  const targetRadius = (targetNode.measured?.width ?? 0) / 2;

  const sourcePoint = pointOnCircle(sourceCenter, targetCenter, sourceRadius);
  const targetPoint = pointOnCircle(targetCenter, sourceCenter, targetRadius);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              ...labelStyle,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
