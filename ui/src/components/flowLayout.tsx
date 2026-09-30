import { BaseEdge, getBezierPath, useInternalNode, type Edge, type EdgeProps } from '@xyflow/react';
import type { PEdge, PNode } from '../../../shared/types.ts';

/** Polyline with rounded corners. */
function rounded(points: [number, number][], r = 12): string {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const d1 = Math.hypot(x - px, y - py);
    const d2 = Math.hypot(nx - x, ny - y);
    const k = Math.min(r, d1 / 2, d2 / 2);
    const ax = x - ((x - px) / (d1 || 1)) * k;
    const ay = y - ((y - py) / (d1 || 1)) * k;
    const bx = x + ((nx - x) / (d2 || 1)) * k;
    const by = y + ((ny - y) / (d2 || 1)) * k;
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  const last = points[points.length - 1];
  return d + ` L ${last[0]} ${last[1]}`;
}

/**
 * Forward links are smooth curves; links that go back (Review → Plan on fail) loop over the top of
 * both nodes in their own lane, so they never cut through cards or pile on each other.
 */
export function FlowEdge(props: EdgeProps<Edge<{ lane?: number }>>) {
  const { source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data } = props;
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const backwards = targetX < sourceX + 20;
  let path: string;
  if (backwards && s && t) {
    const lane = data?.lane ?? 0;
    const top = Math.min(s.internals.positionAbsolute.y, t.internals.positionAbsolute.y) - 28 - lane * 16;
    const out = sourceX + 18 + lane * 6;
    const into = targetX - 18 - lane * 6;
    path = rounded([
      [sourceX, sourceY],
      [out, sourceY],
      [out, top],
      [into, top],
      [into, targetY],
      [targetX, targetY],
    ]);
  } else {
    [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  }
  return <BaseEdge path={path} style={style} markerEnd={markerEnd} />;
}

export const edgeTypes = { flow: FlowEdge };

/** Give each backward link its own lane so loops that overlap in x stack neatly. */
export function assignLanes(edges: Edge[], nodes: { id: string; position: { x: number } }[]): Edge[] {
  const x = (id: string) => nodes.find((n) => n.id === id)?.position.x ?? 0;
  let lane = 0;
  const back = edges.filter((e) => x(e.target) < x(e.source)).sort((a, b) => x(a.source) - x(a.target) - (x(b.source) - x(b.target)));
  const lanes = new Map(back.map((e) => [e.id, lane++]));
  return edges.map((e) => (lanes.has(e.id) ? { ...e, data: { ...e.data, lane: lanes.get(e.id) } } : e));
}

/**
 * Left-to-right layered layout: each node sits one column after the furthest node that leads to it
 * (loop-back links are ignored), nodes sharing a column are stacked and centred.
 */
export function autoLayout(nodes: PNode[], edges: PEdge[]): Record<string, { x: number; y: number }> {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) || []), e.target]);
  const start = nodes.find((n) => n.type === 'task')?.id ?? nodes[0]?.id;
  // find loop-back edges with a DFS from the start node
  const back = new Set<string>();
  const onStack = new Set<string>();
  const seen = new Set<string>();
  const dfs = (id: string) => {
    seen.add(id);
    onStack.add(id);
    for (const e of edges.filter((e) => e.source === id)) {
      if (onStack.has(e.target)) back.add(e.id);
      else if (!seen.has(e.target)) dfs(e.target);
    }
    onStack.delete(id);
  };
  if (start) dfs(start);
  for (const n of nodes) if (!seen.has(n.id)) dfs(n.id);

  const fwd = edges.filter((e) => !back.has(e.id));
  const level = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (let i = 0; i < nodes.length; i++)
    for (const e of fwd) level.set(e.target, Math.max(level.get(e.target)!, level.get(e.source)! + 1));
  // Done nodes go in the last column
  const maxLevel = Math.max(0, ...level.values());
  for (const n of nodes) if (n.type === 'end') level.set(n.id, maxLevel);

  const cols = new Map<number, PNode[]>();
  for (const n of nodes) cols.set(level.get(n.id)!, [...(cols.get(level.get(n.id)!) || []), n]);
  const pos: Record<string, { x: number; y: number }> = {};
  const COL = 320;
  const ROW = 190;
  for (const [l, list] of cols) {
    list.forEach((n, i) => {
      const y = (i - (list.length - 1) / 2) * ROW;
      // small nodes (Task/Done) sit on the agents' centre line
      pos[n.id] = { x: l * COL, y: n.type === 'agent' ? y : y + 30 };
    });
  }
  return pos;
}
