import type { DepKind, Graph } from "../schema";
import type { DepLink, DepNode, DepsScene } from "./types";

// Build the crate dependency graph (Deps tab) from `graph.dep_graph`. Layered DAG
// layout: layer = shortest hop from a workspace crate (workspace crates at 0),
// columns left→right by layer. Kind filtering + depth capping are applied here
// (the analyzer only emits raw crates/edges), mirroring the other scene builders.

export const COL_W = 240;
const ROW_H = 30;
const MARGIN = 40;
export const NODE_W = 176;
export const NODE_H = 22;

interface Opts {
  kinds: ReadonlySet<DepKind>;
  maxDepth: number;
}

export function buildDepsScene(graph: Graph, opts: Opts): DepsScene {
  const { kinds, maxDepth } = opts;
  const crateById = new Map(graph.dep_graph.crates.map((c) => [c.id, c]));

  // Edges of an active kind only; adjacency from→to (a depends on b).
  const edges = graph.dep_graph.edges.filter((e) => kinds.has(e.kind));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from);
    if (list) list.push(e.to);
    else adj.set(e.from, [e.to]);
  }

  // BFS shortest layer from the workspace crates (all at layer 0).
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const c of graph.dep_graph.crates) {
    if (c.workspace) {
      layer.set(c.id, 0);
      queue.push(c.id);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    const lu = layer.get(u)!;
    for (const v of adj.get(u) ?? []) {
      if (!layer.has(v)) {
        layer.set(v, lu + 1);
        queue.push(v);
      }
    }
  }

  // Reachable (under the active kinds) and within the depth cap.
  const reachable = [...layer.keys()];
  const shownIds = new Set(reachable.filter((id) => layer.get(id)! <= maxDepth));
  const hidden = reachable.length - shownIds.size;

  // Degrees over the shown subgraph.
  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();
  const links: DepLink[] = [];
  for (const e of edges) {
    if (!shownIds.has(e.from) || !shownIds.has(e.to)) continue;
    links.push({ from: e.from, to: e.to, kind: e.kind });
    outCount.set(e.from, (outCount.get(e.from) ?? 0) + 1);
    inCount.set(e.to, (inCount.get(e.to) ?? 0) + 1);
  }

  // Layered layout: group by layer, order within a layer by name.
  const byLayer = new Map<number, string[]>();
  for (const id of shownIds) {
    const l = layer.get(id)!;
    const list = byLayer.get(l);
    if (list) list.push(id);
    else byLayer.set(l, [id]);
  }
  const layerCount = byLayer.size;
  let maxRows = 1;
  const nodes: DepNode[] = [];
  for (const [l, ids] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    ids.sort((a, b) => (crateById.get(a)?.name ?? "").localeCompare(crateById.get(b)?.name ?? ""));
    maxRows = Math.max(maxRows, ids.length);
    ids.forEach((id, i) => {
      const c = crateById.get(id)!;
      nodes.push({
        id,
        name: c.name,
        version: c.version,
        workspace: c.workspace,
        layer: l,
        x: MARGIN + l * COL_W,
        y: MARGIN + i * ROW_H,
        inCount: inCount.get(id) ?? 0,
        outCount: outCount.get(id) ?? 0,
      });
    });
  }

  return {
    kind: "deps",
    nodes,
    links,
    layerCount,
    counts: {
      crates: shownIds.size,
      external: nodes.filter((n) => !n.workspace).length,
      edges: links.length,
      hidden,
    },
    worldW: MARGIN * 2 + Math.max(1, layerCount) * COL_W,
    worldH: MARGIN * 2 + maxRows * ROW_H,
  };
}
