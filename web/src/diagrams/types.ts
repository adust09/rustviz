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

export interface StructureScene {
  kind: "structure";
  crateSlabs: StructureBox[];
  boxes: StructureBox[];
  edges: StructureEdge[];
  crateNames: string[];
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
