import dagre from "dagre";
import type { NavEdge, Screen } from "../types";

export const NODE_W = 240;
export const NODE_H = 184;

export interface Pos {
  x: number;
  y: number;
}

/** Wrap screens into a grid ordered by `order` — used when there are no edges. */
export function gridLayout(
  screens: Pick<Screen, "id" | "order">[],
  perRow = 4,
  gap = 48,
): Record<string, Pos> {
  const sorted = [...screens].sort((a, b) => a.order - b.order);
  const out: Record<string, Pos> = {};
  sorted.forEach((s, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    out[s.id] = { x: col * (NODE_W + gap), y: row * (NODE_H + gap) };
  });
  return out;
}

/** Flow layout (left→right) driven by the navigation graph. */
export function dagreLayout(
  screens: Pick<Screen, "id">[],
  edges: Pick<NavEdge, "fromScreenId" | "toScreenId">[],
): Record<string, Pos> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 96, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const s of screens) g.setNode(s.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) {
    if (g.hasNode(e.fromScreenId) && g.hasNode(e.toScreenId)) {
      g.setEdge(e.fromScreenId, e.toScreenId);
    }
  }
  dagre.layout(g);
  const out: Record<string, Pos> = {};
  for (const s of screens) {
    const n = g.node(s.id);
    if (n) out[s.id] = { x: n.x - NODE_W / 2, y: n.y - NODE_H / 2 };
  }
  return out;
}

/** Auto-layout: flow graph when edges exist, otherwise a sequential grid. */
export function autoLayout(
  screens: Screen[],
  edges: NavEdge[],
): Record<string, Pos> {
  return edges.length ? dagreLayout(screens, edges) : gridLayout(screens);
}
