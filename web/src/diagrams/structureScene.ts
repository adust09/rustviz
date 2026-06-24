import type { Graph, GraphNode } from "../schema";
import type {
  BoxOp,
  CrateEdge,
  CrateNode,
  ModuleFrame,
  StructureBox,
  StructureEdge,
  StructureScene,
} from "./types";

// Build a dependency-layered, hierarchical structure scene for semantic zoom:
//   crate regions  (placed by dependency layer: foundation bottom, bin top)
//     module frames  (sub-regions inside a crate)
//       type boxes   (struct/enum/trait, with fields/variants + methods)
// Every position is computed once and is stable (the user's "fixed address");
// the renderers reveal more detail as you zoom (LoD), but nothing moves.

// Box metrics (exported so renderers draw at the reserved size).
export const BOX_W = 210;
export const HEADER_H = 30;
export const ROW_H = 18;
export const GAP = 18;
export const FIELD_CAP = 6;
export const OP_CAP = 8;

// Frame / crate region metrics.
const MOD_INNER_W = 2 * BOX_W + GAP;
const MOD_HEAD = 20;
const MOD_PAD = 10;
const CRATE_HEAD = 26;
const CRATE_PAD = 16;
const CRATE_INNER_W = 2 * (MOD_INNER_W + 2 * MOD_PAD) + GAP;
const CRATE_GAP = 72;
const LAYER_GAP = 130;

const TYPE_KINDS = new Set<GraphNode["kind"]>(["struct", "enum", "trait"]);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface RawBox {
  box: StructureBox;
  crate: string;
  moduleId: string;
}

function rel(id: string, crate: string): string {
  return id.startsWith(`${crate}::`) ? id.slice(crate.length + 2) : id;
}

function boxHeight(fieldRows: number, opRows: number): number {
  const f = Math.min(fieldRows, FIELD_CAP);
  const o = Math.min(opRows, OP_CAP);
  return HEADER_H + (f + o) * ROW_H + GAP;
}

function toOp(n: GraphNode): BoxOp {
  return { id: n.id, name: n.name, visibility: n.visibility, signature: n.signature, file: n.file, start: n.span.start_line, end: n.span.end_line };
}

/** Generic shelf-packer: lays items left→right within maxW, wrapping rows. */
function shelfPack(items: Rect[], maxW: number, gap: number): { w: number; h: number } {
  let cx = 0;
  let cy = 0;
  let shelfH = 0;
  let maxRight = 0;
  for (const it of items) {
    if (cx + it.w > maxW && cx > 0) {
      cx = 0;
      cy += shelfH + gap;
      shelfH = 0;
    }
    it.x = cx;
    it.y = cy;
    cx += it.w + gap;
    shelfH = Math.max(shelfH, it.h);
    maxRight = Math.max(maxRight, it.x + it.w);
  }
  return { w: maxRight, h: cy + shelfH };
}

function fnsByParent(graph: Graph): Map<string, GraphNode[]> {
  const map = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.kind !== "fn") continue;
    const list = map.get(n.parent) ?? [];
    list.push(n);
    map.set(n.parent, list);
  }
  return map;
}

/** All type boxes + synthetic module-fn boxes, tagged with crate + module id. */
function collectBoxes(graph: Graph): RawBox[] {
  const fnMap = fnsByParent(graph);
  const moduleName = new Map(graph.nodes.filter((n) => n.kind === "module").map((n) => [n.id, n.name]));
  const raws: RawBox[] = [];

  for (const n of graph.nodes) {
    if (!TYPE_KINDS.has(n.kind)) continue;
    const ops = (fnMap.get(n.id) ?? []).map(toOp);
    const fields = n.fields ?? [];
    const variants = n.variants ?? [];
    raws.push({
      crate: n.crate,
      moduleId: n.module,
      box: { id: n.id, kind: n.kind, title: rel(n.id, n.crate), crate: n.crate, layer: 0, x: 0, y: 0, w: BOX_W, h: boxHeight(fields.length + variants.length, ops.length), visibility: n.visibility, fields, variants, ops },
    });
  }

  for (const [parent, fns] of fnMap) {
    if (!moduleName.has(parent)) continue; // parent was a type → already a box
    const crate = fns[0].crate;
    raws.push({
      crate,
      moduleId: parent,
      box: { id: parent, kind: "modulefns", title: `${rel(parent, crate)} ·fn`, crate, layer: 0, x: 0, y: 0, w: BOX_W, h: boxHeight(0, fns.length), visibility: "public", fields: [], variants: [], ops: fns.map(toOp) },
    });
  }
  return raws;
}

/** Top-level module under the crate (one frame per top-level module). */
function topModule(crate: string, moduleId: string): { id: string; title: string } {
  if (!moduleId || moduleId === crate) return { id: `${crate}::§root`, title: "(root)" };
  const suffix = moduleId.startsWith(`${crate}::`) ? moduleId.slice(crate.length + 2) : moduleId;
  const seg = suffix.split("::")[0];
  return { id: `${crate}::${seg}`, title: seg };
}

/** Tarjan SCC condensation + longest-path-to-sink layering of the crate graph.
 *  layer 0 = foundation (depends on nothing); higher = depends on more. */
function crateLayers(names: string[], edges: [string, string][]): Map<string, number> {
  const adj = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
  for (const [s, t] of edges) if (adj.has(s) && adj.has(t) && s !== t) adj.get(s)!.add(t);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comp = new Map<string, number>();
  let idx = 0;
  let ncomp = 0;
  const connect = (v: string): void => {
    index.set(v, idx);
    low.set(v, idx);
    idx++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v)!) {
      if (!index.has(w)) {
        connect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.set(w, ncomp);
      } while (w !== v);
      ncomp++;
    }
  };
  for (const n of names) if (!index.has(n)) connect(n);

  const cadj = new Map<number, Set<number>>();
  for (let c = 0; c < ncomp; c++) cadj.set(c, new Set());
  for (const [s, set] of adj) for (const t of set) {
    const cs = comp.get(s)!;
    const ct = comp.get(t)!;
    if (cs !== ct) cadj.get(cs)!.add(ct);
  }
  const memo = new Map<number, number>();
  const depth = (c: number): number => {
    if (memo.has(c)) return memo.get(c)!;
    let d = 0;
    for (const t of cadj.get(c)!) d = Math.max(d, 1 + depth(t));
    memo.set(c, d);
    return d;
  };
  return new Map(names.map((n) => [n, depth(comp.get(n)!)]));
}

function buildFrame(id: string, title: string, boxes: StructureBox[]): ModuleFrame {
  boxes.sort((a, b) => a.title.localeCompare(b.title));
  const inner = shelfPack(boxes, MOD_INNER_W, GAP);
  return { id, title, x: 0, y: 0, w: Math.max(inner.w, BOX_W) + 2 * MOD_PAD, h: MOD_HEAD + inner.h + MOD_PAD, boxIds: boxes.map((b) => b.id) };
}

function layoutCrate(name: string, layer: number, raws: RawBox[]): CrateNode {
  const groups = new Map<string, { title: string; boxes: StructureBox[] }>();
  for (const r of raws) {
    const { id, title } = topModule(name, r.moduleId);
    const g = groups.get(id) ?? { title, boxes: [] };
    g.boxes.push(r.box);
    groups.set(id, g);
  }
  const frames = [...groups.entries()].map(([id, g]) => buildFrame(id, g.title, g.boxes));
  frames.sort((a, b) => a.title.localeCompare(b.title));
  const inner = shelfPack(frames, CRATE_INNER_W, GAP);
  return { name, layer, x: 0, y: 0, w: Math.max(inner.w, BOX_W) + 2 * CRATE_PAD, h: CRATE_HEAD + inner.h + CRATE_PAD, modules: frames, boxIds: raws.map((r) => r.box.id) };
}

/** Place crate regions: dependency layers stack vertically (layer 0 at bottom),
 *  crates within a layer sit side by side in a stable order. */
function placeCrates(crates: CrateNode[], order: Map<string, number>): { worldW: number; worldH: number; layerCount: number } {
  const byLayer = new Map<number, CrateNode[]>();
  for (const c of crates) (byLayer.get(c.layer) ?? byLayer.set(c.layer, []).get(c.layer)!).push(c);
  const layers = [...byLayer.keys()].sort((a, b) => b - a); // highest (top) first
  let y = 0;
  let worldW = 0;
  for (const L of layers) {
    const row = byLayer.get(L)!.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
    let x = 0;
    let rowH = 0;
    for (const c of row) {
      c.x = x;
      c.y = y;
      x += c.w + CRATE_GAP;
      rowH = Math.max(rowH, c.h);
    }
    worldW = Math.max(worldW, x - CRATE_GAP);
    y += rowH + LAYER_GAP;
  }
  return { worldW, worldH: Math.max(0, y - LAYER_GAP), layerCount: layers.length };
}

/** Shift each crate's frames + boxes from crate-relative to absolute world coords. */
function absolutize(crate: CrateNode, boxById: Map<string, StructureBox>): void {
  for (const f of crate.modules) {
    const fx = crate.x + CRATE_PAD + f.x;
    const fy = crate.y + CRATE_HEAD + f.y;
    for (const id of f.boxIds) {
      const b = boxById.get(id);
      if (!b) continue;
      b.x = fx + MOD_PAD + b.x;
      b.y = fy + MOD_HEAD + b.y;
    }
    f.x = fx;
    f.y = fy;
  }
}

/** Architectural group from a representative file path (crates/net, bin, …). */
function crateOrder(graph: Graph, names: string[]): Map<string, number> {
  const groupOf = new Map<string, string>();
  for (const name of names) {
    const f = graph.nodes.find((n) => n.crate === name && n.file)?.file ?? "";
    groupOf.set(name, f.split("/").slice(0, 2).join("/"));
  }
  const sorted = [...names].sort((a, b) => (groupOf.get(a)! + a).localeCompare(groupOf.get(b)! + b));
  return new Map(sorted.map((n, i) => [n, i]));
}

export function buildStructureScene(graph: Graph): StructureScene {
  const crateNames = [...new Set(graph.nodes.filter((n) => n.kind === "crate").map((n) => n.name))];
  const depEdges: [string, string][] = graph.edges.filter((e) => e.kind === "depends").map((e) => [e.source, e.target]);
  const layerOf = crateLayers(crateNames, depEdges);
  const order = crateOrder(graph, crateNames);

  const raws = collectBoxes(graph);
  const boxById = new Map(raws.map((r) => [r.box.id, r.box]));
  const byCrate = new Map<string, RawBox[]>();
  for (const r of raws) (byCrate.get(r.crate) ?? byCrate.set(r.crate, []).get(r.crate)!).push(r);

  const crates = crateNames
    .filter((n) => (byCrate.get(n) ?? []).length > 0)
    .map((n) => layoutCrate(n, layerOf.get(n) ?? 0, byCrate.get(n)!));

  const { worldW, worldH, layerCount } = placeCrates(crates, order);
  for (const c of crates) absolutize(c, boxById);

  const boxes = raws.map((r) => r.box);
  const layerByCrate = new Map(crates.map((c) => [c.name, c.layer]));
  for (const b of boxes) b.layer = layerByCrate.get(b.crate) ?? 0;

  return {
    kind: "structure",
    crates,
    boxes,
    edges: buildEdges(graph, boxes),
    crateEdges: buildCrateEdges(depEdges),
    crateNames,
    layerCount,
    worldW,
    worldH,
  };
}

function buildCrateEdges(depEdges: [string, string][]): CrateEdge[] {
  const set = new Set(depEdges.map(([s, t]) => `${s}->${t}`));
  const seen = new Set<string>();
  const out: CrateEdge[] = [];
  for (const [s, t] of depEdges) {
    if (s === t) continue;
    const key = `${s}->${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: s, target: t, mutual: set.has(`${t}->${s}`) });
  }
  return out;
}

function buildEdges(graph: Graph, boxes: StructureBox[]): StructureEdge[] {
  const boxIds = new Set(boxes.map((b) => b.id));
  const edges: StructureEdge[] = [];
  const seen = new Set<string>();

  for (const e of graph.edges) {
    if (e.kind !== "impls") continue;
    if (boxIds.has(e.source) && boxIds.has(e.target)) edges.push({ source: e.source, target: e.target, kind: "impls" });
  }
  const fnToBox = new Map<string, string>();
  for (const n of graph.nodes) if (n.kind === "fn" && boxIds.has(n.parent)) fnToBox.set(n.id, n.parent);
  for (const step of graph.call_steps) {
    const a = fnToBox.get(step.caller);
    const b = fnToBox.get(step.callee);
    if (!a || !b || a === b) continue;
    const key = `${a}->${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: a, target: b, kind: "calls" });
  }
  return edges;
}
