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
 * Forward links are smooth curves. "Chưa đạt" links leave a checking step from its top and run back
 * over the row into the top of the step that has to redo the work, each in its own lane (short loops
 * close to the cards, long ones higher up) so they never cross cards or each other.
 */
export function FlowEdge(props: EdgeProps<Edge<{ lane?: number; ceiling?: number }>>) {
  const { source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, data, sourceHandleId, label } = props;
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  let path: string;
  let labelX: number | undefined;
  let labelY: number | undefined;
  if (sourceHandleId === 'fail' && s && t) {
    const lane = data?.lane ?? 0;
    // over the top of the row: underneath hang the steps' checklist trees
    // ceiling: the top of the item columns, so the loop never cuts through them
    const y = Math.min(s.internals.positionAbsolute.y, t.internals.positionAbsolute.y, sourceY, targetY, data?.ceiling ?? Infinity) - 34 - lane * 22;
    path = rounded([
      [sourceX, sourceY],
      [sourceX, y],
      [targetX, y],
      [targetX, targetY],
    ], 14);
    labelX = (sourceX + targetX) / 2;
    labelY = y;
  } else {
    [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 });
  }
  return (
    <BaseEdge
      path={path}
      style={style}
      markerEnd={markerEnd}
      label={labelX !== undefined ? label : undefined}
      labelX={labelX}
      labelY={labelY}
      labelStyle={{ fill: 'var(--err)', fontSize: 10.5, fontWeight: 600 }}
      labelShowBg
      labelBgStyle={{ fill: 'var(--bg)' }}
      labelBgPadding={[6, 2]}
      labelBgBorderRadius={4}
    />
  );
}

export const edgeTypes = { flow: FlowEdge };

/** Give each "chưa đạt" link its own lane over the row: the shorter the loop, the closer to the cards. */
export function assignLanes(edges: Edge[], nodes: { id: string; position: { x: number } }[]): Edge[] {
  const x = (id: string) => nodes.find((n) => n.id === id)?.position.x ?? 0;
  const span = (e: Edge) => Math.abs(x(e.source) - x(e.target));
  const loops = edges.filter((e) => e.sourceHandle === 'fail').sort((a, b) => span(a) - span(b));
  const lanes = new Map<string, number>();
  for (const e of loops) {
    // lowest lane not used by a loop that overlaps this one horizontally
    const [a, b] = [Math.min(x(e.source), x(e.target)), Math.max(x(e.source), x(e.target))];
    let lane = 0;
    while (
      loops.some((o) => {
        if (!lanes.has(o.id) || lanes.get(o.id) !== lane) return false;
        const [c, d] = [Math.min(x(o.source), x(o.target)), Math.max(x(o.source), x(o.target))];
        return c < b && a < d;
      })
    )
      lane++;
    lanes.set(e.id, lane);
  }
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
  const COL = 360;
  const ROW = 300;
  // a column holding a standard step leaves room for its items and the points under them, on its right
  const ITEMS = 620;
  const left: number[] = [];
  let x = 0;
  for (let l = 0; l <= maxLevel; l++) {
    left[l] = x;
    x += COL + ((cols.get(l) ?? []).some((n) => n.type === 'agent' && !!n.data.stage) ? ITEMS : 0);
  }
  for (const [l, list] of cols) {
    list.forEach((n, i) => {
      const y = (i - (list.length - 1) / 2) * ROW;
      // small nodes (Task/Done) sit on the agents' centre line
      pos[n.id] = { x: left[l], y: n.type === 'agent' ? y : y + 80 };
    });
  }
  return pos;
}
