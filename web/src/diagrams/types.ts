import type { FieldDef, FnSignature, NodeKind, VariantDef, Visibility } from "../schema";

// Shared vocabulary for the architecture diagrams. The `scene` builders turn a
// validated Graph into render-agnostic geometry (positions + depth); the three
// renderers (flat / iso / 3d) consume the same scene. Keeps diagram semantics
// in one place and the visual style pluggable — same seam as treemap vs lenses.

export type ViewMode = "map" | "structure" | "sequence" | "test" | "er";

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

/** A ground-plane region: a (role × dependency-layer) cell platform. */
export interface Region {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
}

export interface StructureScene {
  kind: "structure";
  /** Crates as bounding boxes of their member buildings — anchors for the
   *  dependency wires (centroid to centroid). Not drawn as platforms. */
  crates: CrateNode[];
  /** Role × dependency-layer cell platforms (the ground plane partition). */
  regions: Region[];
  /** All type / module-fn boxes, at absolute world positions (X = role zone,
   *  Z = dependency-layer band); `layer` drives the Y elevation. */
  boxes: StructureBox[];
  /** Crate→crate dependency arrows (wires). */
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
  /** Source location of the function, so clicking the header opens its snippet. */
  file: string;
  start: number;
  end: number;
}

export interface SeqMessage {
  /** `call` = solid request arrow; `return` = dashed reply arrow back to the caller. */
  kind: "call" | "return";
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

/** An activation bar: the span on a participant's lifeline while it is executing
 *  a call (from the call row down to its return row). The hallmark of a UML
 *  sequence diagram. */
export interface Activation {
  /** Lifeline (participant) id the bar sits on. */
  id: string;
  /** Lifeline column index. */
  col: number;
  startRow: number;
  endRow: number;
  /** Nesting depth — staggers overlapping bars on the same lifeline. */
  depth: number;
}

export interface SequenceScene {
  kind: "sequence";
  rootId: string | null;
  rootTitle: string;
  lifelines: Lifeline[];
  messages: SeqMessage[];
  activations: Activation[];
  /** Number of `call` messages (returns excluded) — for the picker's count. */
  callCount: number;
  /** True when expansion hit the message cap and was cut short. */
  truncated: boolean;
  crateNames: string[];
}

export type DiagramScene = StructureScene | SequenceScene;

// --- ER (KV-storage schema) diagram ---
// Each entity is one storage table (column family): a Key type -> Value type,
// laid out as a box whose body lists the resolved value struct's fields. The ER
// view is self-contained (see ERView.tsx); it does NOT join the DiagramScene
// union, so the structure/sequence renderers stay untouched.

/** One storage table / column family box. */
export interface EREntity {
  /** `${enumId}::${table}` — unique across stores. */
  id: string;
  /** Table (enum variant) name, e.g. `BlockHeaders`. */
  table: string;
  /** Parsed key type, e.g. `H256` or `(slot || root)`. */
  key: string;
  /** Parsed value type, e.g. `BlockHeader` or `parent_root`. */
  value: string;
  /** Owning store enum name, e.g. `Table`. */
  store: string;
  crate: string;
  /** Resolved value struct's fields (empty when the value is a scalar / free text). */
  fields: ERField[];
  /** Source location to open: the value struct if resolved, else the enum. */
  srcFile: string;
  srcLine: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A field row inside an entity box. `fkKey` marks a field whose type matches
 *  some table's key type (a reference-by-key, e.g. `parent_root: H256`). */
export interface ERField {
  name: string;
  ty: string;
  fkKey: boolean;
}

/** A relationship between two tables. `cokey` = same primary key; `fk` = a value
 *  field composes/references another table's value type. */
export interface ERRelation {
  from: string;
  to: string;
  kind: "cokey" | "fk";
  label: string;
}

export interface ERScene {
  kind: "er";
  entities: EREntity[];
  relations: ERRelation[];
  /** Detected store enums (one per `TableDef`). */
  stores: { name: string; count: number }[];
  crateNames: string[];
  worldW: number;
  worldH: number;
}

/** Common props every renderer accepts. */
export interface RendererProps<S extends DiagramScene> {
  scene: S;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenSource: (file: string, start: number, end: number) => void;
  /** Click-through from a structure box to its call sequence (structure only). */
  onDrillToSequence?: (id: string) => void;
}
