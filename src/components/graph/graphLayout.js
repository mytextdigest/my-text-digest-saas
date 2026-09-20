import { forceSimulation, forceManyBody, forceLink, forceCollide, forceCenter, forceX, forceY } from 'd3-force';

const MIN_RADIUS = 26;
const MAX_RADIUS = 60;
const TICKS = 300;

// Node "importance" (and therefore size) is its degree in THIS graph — how
// many relationships touch it — the same signal Neo4j Bloom uses to size
// nodes, not raw mention_count (a date mentioned twice but connected to
// nothing shouldn't visually dominate a well-connected entity mentioned once).
function computeDegrees(relationships) {
  const degree = new Map();
  for (const r of relationships) {
    degree.set(r.source_entity_id, (degree.get(r.source_entity_id) || 0) + 1);
    degree.set(r.target_entity_id, (degree.get(r.target_entity_id) || 0) + 1);
  }
  return degree;
}

// Runs a d3-force simulation to completion (synchronously, fixed tick count
// — no need to keep it alive/animating for a knowledge graph that doesn't
// change shape after load) and returns nodes with x/y/radius set, plus the
// links in the {source, target} id-string shape d3-force expects.
export function computeForceLayout(entities, relationships) {
  const degree = computeDegrees(relationships);

  const nodes = entities.map((e) => {
    const d = degree.get(e.id) || 0;
    return {
      id: String(e.id),
      entity: e,
      degree: d,
      radius: Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, MIN_RADIUS + d * 6)),
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links = relationships
    .filter((r) => nodeIds.has(String(r.source_entity_id)) && nodeIds.has(String(r.target_entity_id)))
    .map((r) => ({ ...r, source: String(r.source_entity_id), target: String(r.target_entity_id) }));

  const width = Math.max(900, Math.sqrt(nodes.length) * 260);
  const height = Math.max(700, Math.sqrt(nodes.length) * 200);

  const simulation = forceSimulation(nodes)
    .force('link', forceLink(links).id((d) => d.id).distance(130).strength(0.4))
    .force('charge', forceManyBody().strength(-320))
    .force('collide', forceCollide().radius((d) => d.radius + 18).iterations(2))
    .force('center', forceCenter(width / 2, height / 2))
    .force('x', forceX(width / 2).strength(0.03))
    .force('y', forceY(height / 2).strength(0.03))
    .stop();

  for (let i = 0; i < TICKS; i++) simulation.tick();

  return nodes;
}
