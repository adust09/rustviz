import type { Graph, GraphNode } from "../schema";
import type { BoxOp, CrateEdge, CrateNode, Region, StructureBox, StructureScene } from "./types";

// Build a role-organized structure scene for the 3D code city:
//   ground plane X  = role zone   (Interface / Service / Persistence / Data / …)
//   ground plane Z  = dependency layer band
//   building height = member count; Y elevation = dependency layer
// Each (role, layer) pair is a cell platform; crates are kept only as bounding
// boxes so the dependency wires have an anchor (centroid to centroid).

export const BOX_W = 210;
export const HEADER_H = 30;
export const ROW_H = 18;
export const GAP = 18;
export const FIELD_CAP = 6;
export const OP_CAP = 8;

const CELL_INNER_W = 3 * BOX_W + 2 * GAP;
const CELL_PAD = 22;
const ZONE_GAP = 70;
const BAND_GAP = 90;

const TYPE_KINDS = new Set<GraphNode["kind"]>(["struct", "enum", "trait"]);

// Roles inferred from kind + naming pattern, ordered left→right along X.
// `hint` documents the classification rule (shown in the legend).
export const ROLES = [
  { key: "interface", title: "Interface", hint: "traits" },
  { key: "service", title: "Service", hint: "*Server / Handler / Manager / Client …" },
  { key: "persistence", title: "Persistence", hint: "*Store / Buffer / Table / Repository …" },
  { key: "data", title: "Data", hint: "other struct / enum" },
  { key: "aux", title: "Config / Error", hint: "*Config / *Error / *Options …" },
  { key: "procedure", title: "Procedure", hint: "module-level functions" },
] as const;
const ROLE_INDEX = new Map<string, number>(ROLES.map((r, i) => [r.key, i]));

const RE_SERVICE = /(Service|Handler|Manager|Controller|Server|Client|Worker|Engine|Processor|Runner|Scheduler|Builder|Factory|Provider|Dispatcher|Listener)$/;
const RE_PERSIST = /(Store|Storage|Repository|Repo|Db|Database|Cache|Pool|Buffer|Journal|Wal|Index|Table)$/;
const RE_AUX = /(Error|Config|Options|Settings|Params|Args|Flags|Opts)$/;

function roleOf(box: StructureBox): string {
  if (box.kind === "modulefns") return "procedure";
  if (box.kind === "trait") return "interface";
  const name = box.title.split("::").pop() ?? box.title;
  if (RE_AUX.test(name)) return "aux";
  if (RE_PERSIST.test(name)) return "persistence";
  if (RE_SERVICE.test(name)) return "service";
  return "data";
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface RawBox {
  box: StructureBox;
  crate: string;
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

function collectBoxes(graph: Graph): RawBox[] {
  const fnMap = fnsByParent(graph);
  const moduleName = new Map(graph.nodes.filter((n) => n.kind === "module").map((n) => [n.id, n.name]));
  const raws: RawBox[] = [];

  for (const n of graph.nodes) {
    if (!TYPE_KINDS.has(n.kind)) continue;
    const ops = (fnMap.get(n.id) ?? []).map(toOp);
    const fields = n.fields ?? [];
    const variants = n.variants ?? [];
    raws.push({ crate: n.crate, box: { id: n.id, kind: n.kind, title: rel(n.id, n.crate), crate: n.crate, layer: 0, x: 0, y: 0, w: BOX_W, h: boxHeight(fields.length + variants.length, ops.length), visibility: n.visibility, fields, variants, ops } });
  }
  for (const [parent, fns] of fnMap) {
    if (!moduleName.has(parent)) continue;
    const crate = fns[0].crate;
    raws.push({ crate, box: { id: parent, kind: "modulefns", title: `${rel(parent, crate)} ·fn`, crate, layer: 0, x: 0, y: 0, w: BOX_W, h: boxHeight(0, fns.length), visibility: "public", fields: [], variants: [], ops: fns.map(toOp) } });
  }
  return raws;
}

/** Tarjan SCC condensation + longest-path layering of the crate graph. */
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

interface Cell {
  role: number;
  layer: number;
  boxes: StructureBox[];
  w: number;
  h: number;
}

export function buildStructureScene(graph: Graph): StructureScene {
  const crateNames = [...new Set(graph.nodes.filter((n) => n.kind === "crate").map((n) => n.name))];
  const depEdges: [string, string][] = graph.edges.filter((e) => e.kind === "depends").map((e) => [e.source, e.target]);
  const layerOf = crateLayers(crateNames, depEdges);
  const raws = collectBoxes(graph);

  // Group boxes into (role, layer) cells and pack each.
  const cells = new Map<string, Cell>();
  for (const r of raws) {
    const role = ROLE_INDEX.get(roleOf(r.box)) ?? ROLE_INDEX.get("data")!;
    const layer = layerOf.get(r.crate) ?? 0;
    r.box.layer = layer;
    const key = `${role}|${layer}`;
    const cell = cells.get(key) ?? { role, layer, boxes: [], w: 0, h: 0 };
    cell.boxes.push(r.box);
    cells.set(key, cell);
  }
  for (const cell of cells.values()) {
    const sz = shelfPack(cell.boxes, CELL_INNER_W, GAP);
    cell.w = sz.w;
    cell.h = sz.h;
  }

  // Role zones present (X), and layer bands present (Z, foundation furthest).
  const rolesPresent = [...new Set([...cells.values()].map((c) => c.role))].sort((a, b) => a - b);
  const layersPresent = [...new Set([...cells.values()].map((c) => c.layer))].sort((a, b) => b - a);
  const cellsW = (role: number): number => Math.max(BOX_W, ...[...cells.values()].filter((c) => c.role === role).map((c) => c.w)) + 2 * CELL_PAD;
  const cellsH = (layer: number): number => Math.max(HEADER_H, ...[...cells.values()].filter((c) => c.layer === layer).map((c) => c.h)) + 2 * CELL_PAD;

  const roleX0 = new Map<number, number>();
  const roleW = new Map<number, number>();
  let x = 0;
  for (const r of rolesPresent) {
    const w = cellsW(r);
    roleX0.set(r, x);
    roleW.set(r, w);
    x += w + ZONE_GAP;
  }
  const worldW = Math.max(0, x - ZONE_GAP);

  const layerZ0 = new Map<number, number>();
  const layerH = new Map<number, number>();
  let z = 0;
  for (const L of layersPresent) {
    const h = cellsH(L);
    layerZ0.set(L, z);
    layerH.set(L, h);
    z += h + BAND_GAP;
  }
  const worldH = Math.max(0, z - BAND_GAP);

  // Offset each cell's boxes to absolute world coords; emit a region platform.
  const regions: Region[] = [];
  for (const cell of cells.values()) {
    const ox = roleX0.get(cell.role)! + CELL_PAD;
    const oz = layerZ0.get(cell.layer)! + CELL_PAD;
    for (const b of cell.boxes) {
      b.x += ox;
      b.y += oz;
    }
    regions.push({ id: `${cell.role}@${cell.layer}`, title: ROLES[cell.role].title, x: roleX0.get(cell.role)!, y: layerZ0.get(cell.layer)!, w: roleW.get(cell.role)!, h: layerH.get(cell.layer)!, layer: cell.layer });
  }

  const crates = buildCrateBoxes(crateNames, raws, layerOf);
  return { kind: "structure", crates, regions, boxes: raws.map((r) => r.box), crateEdges: buildCrateEdges(depEdges), crateNames, layerCount: layersPresent.length, worldW, worldH };
}

/** Each crate as the bounding box of its member buildings (wire anchor). */
function buildCrateBoxes(names: string[], raws: RawBox[], layerOf: Map<string, number>): CrateNode[] {
  const out: CrateNode[] = [];
  for (const name of names) {
    const bs = raws.filter((r) => r.crate === name).map((r) => r.box);
    if (bs.length === 0) continue;
    const minX = Math.min(...bs.map((b) => b.x));
    const minY = Math.min(...bs.map((b) => b.y));
    const maxX = Math.max(...bs.map((b) => b.x + b.w));
    const maxY = Math.max(...bs.map((b) => b.y + b.h));
    out.push({ name, layer: layerOf.get(name) ?? 0, x: minX, y: minY, w: maxX - minX, h: maxY - minY, modules: [], boxIds: bs.map((b) => b.id) });
  }
  return out;
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
