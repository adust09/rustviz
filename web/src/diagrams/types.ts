import type { FieldDef, FnSignature, NodeKind, VariantDef, Visibility } from "../schema";

// Shared vocabulary for the architecture diagrams. The `scene` builders turn a
// validated Graph into render-agnostic geometry (positions + depth); the three
// renderers (flat / iso / 3d) consume the same scene. Keeps diagram semantics
// in one place and the visual style pluggable — same seam as treemap vs lenses.

export type ViewMode = "map" | "structure" | "sequence";
export type RenderStyle = "flat" | "iso" | "3d";

// Normalized virtual space: every scene lays out inside [0,SCENE_W] x [0,SCENE_H];
// renderers scale it into their own viewport. `layer` doubles as the z depth.
export const SCENE_W = 1000;
export const SCENE_H = 1000;

/** A box in the structure (UML class) diagram. Methods/fields live on the box. */
export interface StructureBox {
  id: string;
  kind: NodeKind | "modulefns";
  /** Title as shown in the header, e.g. `graph::Edge` or `parse (fns)`. */
  title: string;
  crate: string;
  /** 0 = crate slab, 1 = entity box. Also the z depth. */
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  visibility: Visibility;
  fields: FieldDef[];
  variants: VariantDef[];
  /** Operations (methods or free fns) drawn in the box's lower compartment. */
  ops: BoxOp[];
}

export interface BoxOp {
  id: string;
  name: string;
  visibility: Visibility;
  signature?: FnSignature;
  file: string;
  start: number;
  end: number;
}

export interface StructureEdge {
  source: string;
  target: string;
  kind: "impls" | "calls";
}

/** Level of detail, driven by zoom: 0 = crates only, 1 = + module frames &
 *  type titles, 2 = + members (full UML boxes). */
export type Lod = 0 | 1 | 2;

/** A module sub-frame inside a crate region (absolute world coords). */
export interface ModuleFrame {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  boxIds: string[];
}

/** A crate region, placed by dependency layer. Fixed world position. */
export interface CrateNode {
  name: string;
  /** Dependency layer: 0 = foundation (bottom), higher = depends-on-more (top). */
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  modules: ModuleFrame[];
  boxIds: string[];
}

/** A crate→crate dependency arrow (overview level). */
export interface CrateEdge {
  source: string;
  target: string;
  mutual: boolean;
}

export interface StructureScene {
  kind: "structure";
  crates: CrateNode[];
  /** All type / module-fn boxes, at absolute world positions inside their crate. */
  boxes: StructureBox[];
  /** Intra detail edges (impls + aggregated type calls) — shown at LoD ≥ 1. */
  edges: StructureEdge[];
  /** Crate dependency arrows — shown at the overview (LoD 0). */
  crateEdges: CrateEdge[];
  crateNames: string[];
  layerCount: number;
  worldW: number;
  worldH: number;
}

/** A participant column in the sequence diagram. */
export interface Lifeline {
  id: string;
  title: string;
  crate: string;
  /** Column index (0-based, left to right in first-call order). */
  col: number;
}

export interface SeqMessage {
  fromId: string;
  toId: string;
  /** Global vertical order (row index). */
  row: number;
  /** Call depth from the root, for indentation / styling. */
  depth: number;
  label: string;
  callLine: number;
  /** Caller's source file + line, so the message can open the call site. */
  fromFile: string;
  selfCall: boolean;
}

export interface SequenceScene {
  kind: "sequence";
  rootId: string | null;
  rootTitle: string;
  lifelines: Lifeline[];
  messages: SeqMessage[];
  crateNames: string[];
}

export type DiagramScene = StructureScene | SequenceScene;

/** Common props every renderer accepts. */
export interface RendererProps<S extends DiagramScene> {
  scene: S;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenSource: (file: string, start: number, end: number) => void;
  /** Click-through from a structure box to its call sequence (structure only). */
  onDrillToSequence?: (id: string) => void;
}
