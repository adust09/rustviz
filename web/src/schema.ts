import { z } from "zod";

// Mirrors `analyzer/src/model.rs` (serde emits snake_case keys; enums lowercase).
// Zod validates the JSON at the network boundary so the rest of the app is typed.

export const NodeKind = z.enum([
  "crate",
  "module",
  "struct",
  "enum",
  "trait",
  "impl",
  "fn",
]);
export type NodeKind = z.infer<typeof NodeKind>;

export const EdgeKind = z.enum(["depends", "contains", "calls", "impls"]);
export type EdgeKind = z.infer<typeof EdgeKind>;

const Span = z.object({ start_line: z.number(), end_line: z.number() });

// UML detail (mirrors model.rs Visibility / ParamDef / FnSignature / FieldDef / VariantDef).
export const Visibility = z.enum(["public", "pubcrate", "private"]);
export type Visibility = z.infer<typeof Visibility>;

const ParamDef = z.object({ name: z.string(), ty: z.string() });
export const FnSignature = z.object({
  params: z.array(ParamDef),
  return_type: z.string(),
  is_async: z.boolean(),
  is_method: z.boolean(),
});
export type FnSignature = z.infer<typeof FnSignature>;

export const FieldDef = z.object({ name: z.string(), ty: z.string(), visibility: Visibility });
export type FieldDef = z.infer<typeof FieldDef>;

export const VariantDef = z.object({ name: z.string(), payload: z.array(z.string()) });
export type VariantDef = z.infer<typeof VariantDef>;

// Ordered, resolved fn→fn call (mirrors model.rs CallStep) — drives sequence diagrams.
export const CallStep = z.object({
  caller: z.string(),
  callee: z.string(),
  order: z.number(),
  call_line: z.number(),
});
export type CallStep = z.infer<typeof CallStep>;

const SecurityMetrics = z.object({
  unsafe_blocks: z.number(),
  unwraps: z.number(),
  expects: z.number(),
  panics: z.number(),
  raw_ptr: z.number(),
  transmute: z.number(),
  lossy_casts: z.number(),
  score: z.number(),
});

const PerformanceMetrics = z.object({
  allocs: z.number(),
  clones: z.number(),
  nested_loops: z.number(),
  recursion: z.number(),
  collects: z.number(),
  async_points: z.number(),
  score: z.number(),
});

const ComplexityMetrics = z.object({
  cyclomatic: z.number(),
  loc: z.number(),
  max_nesting: z.number(),
  score: z.number(),
});

const ArchitectureMetrics = z.object({
  fan_in: z.number(),
  fan_out: z.number(),
  in_cycle: z.boolean(),
  score: z.number(),
});

export const Metrics = z.object({
  security: SecurityMetrics,
  performance: PerformanceMetrics,
  complexity: ComplexityMetrics,
  architecture: ArchitectureMetrics,
});
export type Metrics = z.infer<typeof Metrics>;

export const GraphNode = z.object({
  id: z.string(),
  kind: NodeKind,
  name: z.string(),
  crate: z.string(),
  module: z.string(),
  file: z.string(),
  span: Span,
  loc: z.number(),
  parent: z.string(),
  metrics: Metrics,
  visibility: Visibility.default("private"),
  signature: FnSignature.optional(),
  fields: z.array(FieldDef).optional(),
  variants: z.array(VariantDef).optional(),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  source: z.string(),
  target: z.string(),
  kind: EdgeKind,
  weight: z.number(),
});
export type GraphEdge = z.infer<typeof GraphEdge>;

export const Graph = z.object({
  meta: z.object({
    root_path: z.string(),
    analyzed_at: z.string(),
    crate_count: z.number(),
    file_count: z.number(),
    total_loc: z.number(),
  }),
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  entrypoints: z.array(z.string()),
  cycles: z.array(z.array(z.string())),
  call_steps: z.array(CallStep),
});
export type Graph = z.infer<typeof Graph>;

// Architecture is no longer a lens — per-crate coloring is the map's structural
// base view (see `App`/`Treemap`). These three are the metric lenses; any subset
// can be checked at once and their scores average into one heat value (see `heat`).
export const LENSES = ["security", "performance", "complexity"] as const;
export type Lens = (typeof LENSES)[number];
