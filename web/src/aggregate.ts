import type { Graph, GraphNode, Lens, Metrics } from "./schema";
import { performanceRaw, securityRaw } from "./lenses";

// Roll the function-level graph up to a crate -> top-level-module treemap.
// Each tile = one top-level module (or a crate-root bucket); metrics are summed
// from the contained functions, then normalized across all tiles.

export interface TileFn {
  id: string;
  name: string;
  file: string;
  start: number;
  end: number;
  loc: number;
  scores: Record<Lens, number>;
}

export interface Tile {
  id: string;
  name: string;
  crate: string;
  loc: number;
  fnCount: number;
  security: Metrics["security"];
  performance: Metrics["performance"];
  cyclomatic: number;
  inCycle: boolean;
  score: Record<Lens, number>;
  fns: TileFn[];
}

export interface CrateDeps {
  dependsOn: string[];
  dependedBy: string[];
}

export interface Aggregation {
  crates: string[];
  tiles: Tile[];
  crateDeps: Map<string, CrateDeps>;
  totalLoc: number;
}

const CONTENT = new Set<GraphNode["kind"]>(["fn", "struct", "enum", "trait"]);

function zeroSecurity(): Metrics["security"] {
  return { unsafe_blocks: 0, unwraps: 0, expects: 0, panics: 0, raw_ptr: 0, transmute: 0, lossy_casts: 0, score: 0 };
}
function zeroPerformance(): Metrics["performance"] {
  return { allocs: 0, clones: 0, nested_loops: 0, recursion: 0, collects: 0, async_points: 0, score: 0 };
}

function addSecurity(acc: Metrics["security"], m: Metrics["security"]): void {
  acc.unsafe_blocks += m.unsafe_blocks;
  acc.unwraps += m.unwraps;
  acc.expects += m.expects;
  acc.panics += m.panics;
  acc.raw_ptr += m.raw_ptr;
  acc.transmute += m.transmute;
  acc.lossy_casts += m.lossy_casts;
}
function addPerformance(acc: Metrics["performance"], m: Metrics["performance"]): void {
  acc.allocs += m.allocs;
  acc.clones += m.clones;
  acc.nested_loops += m.nested_loops;
  acc.recursion += m.recursion;
  acc.collects += m.collects;
  acc.async_points += m.async_points;
}

/** Climb to the top-level node directly under the crate. */
function topLevel(node: GraphNode, map: Map<string, GraphNode>): GraphNode {
  let cur = node;
  let parent = map.get(cur.parent);
  while (parent && parent.kind !== "crate") {
    cur = parent;
    parent = map.get(cur.parent);
  }
  return cur;
}

export function aggregate(graph: Graph): Aggregation {
  const map = new Map(graph.nodes.map((n) => [n.id, n]));
  const tiles = new Map<string, Tile>();

  const ensure = (id: string, name: string, crate: string): Tile => {
    let t = tiles.get(id);
    if (!t) {
      t = {
        id, name, crate, loc: 0, fnCount: 0,
        security: zeroSecurity(), performance: zeroPerformance(),
        cyclomatic: 0, inCycle: false,
        score: { security: 0, performance: 0, complexity: 0 },
        fns: [],
      };
      tiles.set(id, t);
    }
    return t;
  };

  for (const n of graph.nodes) {
    if (!CONTENT.has(n.kind)) continue;
    const top = topLevel(n, map);
    const isModule = top.kind === "module";
    const groupId = isModule ? top.id : `${n.crate}::(root)`;
    const groupName = isModule ? top.name : "(root)";
    const t = ensure(groupId, groupName, n.crate);
    t.loc += n.loc;
    if (n.metrics.architecture.in_cycle) t.inCycle = true;
    if (n.kind === "fn") {
      t.fnCount += 1;
      addSecurity(t.security, n.metrics.security);
      addPerformance(t.performance, n.metrics.performance);
      t.cyclomatic += n.metrics.complexity.cyclomatic;
      t.fns.push({
        id: n.id, name: n.name, file: n.file,
        start: n.span.start_line, end: n.span.end_line, loc: n.loc,
        scores: {
          security: n.metrics.security.score,
          performance: n.metrics.performance.score,
          complexity: n.metrics.complexity.score,
        },
      });
    }
  }

  const list = [...tiles.values()].filter((t) => t.loc > 0);
  const secRaw = list.map((t) => securityRaw(t.security));
  const perfRaw = list.map((t) => performanceRaw(t.performance));
  const cmpRaw = list.map((t) => t.cyclomatic + t.loc * 0.05);
  const maxS = Math.max(1, ...secRaw);
  const maxP = Math.max(1, ...perfRaw);
  const maxC = Math.max(1, ...cmpRaw);
  list.forEach((t, i) => {
    t.score = {
      security: secRaw[i] / maxS,
      performance: perfRaw[i] / maxP,
      complexity: cmpRaw[i] / maxC,
    };
  });

  const crates = [...new Set(graph.nodes.filter((n) => n.kind === "crate").map((n) => n.name))];
  const crateDeps = new Map<string, CrateDeps>();
  for (const c of crates) crateDeps.set(c, { dependsOn: [], dependedBy: [] });
  for (const e of graph.edges) {
    if (e.kind !== "depends") continue;
    crateDeps.get(e.source)?.dependsOn.push(e.target);
    crateDeps.get(e.target)?.dependedBy.push(e.source);
  }

  return { crates, tiles: list, crateDeps, totalLoc: list.reduce((s, t) => s + t.loc, 0) };
}
