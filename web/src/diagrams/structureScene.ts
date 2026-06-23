import type { Graph, GraphNode } from "../schema";
import {
  SCENE_W,
  type BoxOp,
  type StructureBox,
  type StructureEdge,
  type StructureScene,
} from "./types";

// Build the UML class-diagram scene: one box per type (struct/enum/trait) with
// its fields/variants + methods, plus one synthetic box per module that owns
// free functions. Boxes are grouped into per-crate slabs (layer 0) with the
// boxes floating above (layer 1) so the 2.5D/3D renderers read as depth.

// Layout metrics (normalized units). Exported so renderers draw boxes at the
// exact size the layout reserved for them.
export const BOX_W = 210;
export const HEADER_H = 30;
export const ROW_H = 18;
export const GAP = 18;
const SLAB_PAD = 20;
const BAND_GAP = 46;

export const FIELD_CAP = 6;
export const OP_CAP = 8;

const TYPE_KINDS = new Set<GraphNode["kind"]>(["struct", "enum", "trait"]);

function rel(id: string, crate: string): string {
  return id.startsWith(`${crate}::`) ? id.slice(crate.length + 2) : id;
}

function boxHeight(fieldRows: number, opRows: number): number {
  const f = Math.min(fieldRows, FIELD_CAP);
  const o = Math.min(opRows, OP_CAP);
  return HEADER_H + (f + o) * ROW_H + GAP;
}

/** Group fn nodes by their containment parent (type id or module id). */
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

function toOp(n: GraphNode): BoxOp {
  return {
    id: n.id,
    name: n.name,
    visibility: n.visibility,
    signature: n.signature,
    file: n.file,
    start: n.span.start_line,
    end: n.span.end_line,
  };
}

/** All boxes (type boxes + synthetic module-fn boxes), unplaced. */
function collectBoxes(graph: Graph): StructureBox[] {
  const fnMap = fnsByParent(graph);
  const boxes: StructureBox[] = [];
  const moduleName = new Map(graph.nodes.filter((n) => n.kind === "module").map((n) => [n.id, n.name]));

  for (const n of graph.nodes) {
    if (!TYPE_KINDS.has(n.kind)) continue;
    const ops = (fnMap.get(n.id) ?? []).map(toOp);
    const fields = n.fields ?? [];
    const variants = n.variants ?? [];
    boxes.push({
      id: n.id,
      kind: n.kind,
      title: rel(n.id, n.crate),
      crate: n.crate,
      layer: 1,
      x: 0,
      y: 0,
      w: BOX_W,
      h: boxHeight(fields.length + variants.length, ops.length),
      visibility: n.visibility,
      fields,
      variants,
      ops,
    });
  }

  // Synthetic per-module box for free functions (parent is a module node).
  for (const [parent, fns] of fnMap) {
    if (!moduleName.has(parent)) continue; // parent was a type → already a box
    const crate = fns[0].crate;
    boxes.push({
      id: parent,
      kind: "modulefns",
      title: `${rel(parent, crate)} ·fn`,
      crate,
      layer: 1,
      x: 0,
      y: 0,
      w: BOX_W,
      h: boxHeight(0, fns.length),
      visibility: "public",
      fields: [],
      variants: [],
      ops: fns.map(toOp),
    });
  }
  return boxes;
}

/** Shelf-pack boxes left-to-right within [x0, x0+bandW]; return bottom y. */
function packShelf(boxes: StructureBox[], x0: number, y0: number, bandW: number): number {
  let cx = x0;
  let cy = y0;
  let shelfH = 0;
  for (const b of boxes) {
    if (cx + b.w > x0 + bandW && cx > x0) {
      cx = x0;
      cy += shelfH + GAP;
      shelfH = 0;
    }
    b.x = cx;
    b.y = cy;
    cx += b.w + GAP;
    shelfH = Math.max(shelfH, b.h);
  }
  return cy + shelfH;
}

export function buildStructureScene(graph: Graph): StructureScene {
  const crateNames = [...new Set(graph.nodes.filter((n) => n.kind === "crate").map((n) => n.name))];
  const all = collectBoxes(graph);
  const byCrate = new Map<string, StructureBox[]>();
  for (const b of all) {
    const list = byCrate.get(b.crate) ?? [];
    list.push(b);
    byCrate.set(b.crate, list);
  }

  const slabs: StructureBox[] = [];
  let bandTop = 0;
  for (const crate of crateNames) {
    const boxes = byCrate.get(crate) ?? [];
    if (boxes.length === 0) continue;
    boxes.sort((a, b) => b.ops.length + b.fields.length - (a.ops.length + a.fields.length));
    const top = bandTop + HEADER_H + SLAB_PAD;
    const bottom = packShelf(boxes, SLAB_PAD, top, SCENE_W - 2 * SLAB_PAD);
    slabs.push({
      id: `slab:${crate}`,
      kind: "crate",
      title: crate,
      crate,
      layer: 0,
      x: 0,
      y: bandTop,
      w: SCENE_W,
      h: bottom - bandTop + SLAB_PAD,
      visibility: "public",
      fields: [],
      variants: [],
      ops: [],
    });
    bandTop = bottom + SLAB_PAD + BAND_GAP;
  }

  return { kind: "structure", crateSlabs: slabs, boxes: all, edges: buildEdges(graph, all), crateNames };
}

function buildEdges(graph: Graph, boxes: StructureBox[]): StructureEdge[] {
  const boxIds = new Set(boxes.map((b) => b.id));
  const edges: StructureEdge[] = [];
  const seen = new Set<string>();

  for (const e of graph.edges) {
    if (e.kind !== "impls") continue;
    if (boxIds.has(e.source) && boxIds.has(e.target)) {
      edges.push({ source: e.source, target: e.target, kind: "impls" });
    }
  }

  // fn id → owning box id (type method's parent, or module-fn box = module id).
  const fnToBox = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.kind === "fn" && boxIds.has(n.parent)) fnToBox.set(n.id, n.parent);
  }
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
