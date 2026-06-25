//! Serde data model shared with the web frontend (the JSON contract).
//!
//! The analyzer emits only *raw* metric counts plus a normalized `score`
//! (0.0..=1.0) per lens. All "metric -> color/size" mapping lives in the
//! frontend so that adding a new lens never requires touching this crate.

use serde::{Deserialize, Serialize};

/// Top-level graph returned by [`crate::analyze`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub meta: Meta,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    /// Function ids that are plausible execution entry points (`main`, `#[test]`).
    pub entrypoints: Vec<String>,
    /// Strongly-connected components of size > 1 in the call graph.
    pub cycles: Vec<Vec<String>>,
    /// Ordered, resolved fn→fn calls for sequence-diagram reconstruction.
    /// Unlike the deduped weighted `Calls` edges, these preserve source order
    /// and repeats. See [`CallStep`].
    pub call_steps: Vec<CallStep>,
    /// KV-storage schema tables detected from storage-table enums (variants
    /// documented as `<desc>: <Key> -> <Value>`). Drives the ER diagram. See
    /// [`TableDef`]. A parallel array like `call_steps` — not a `NodeKind`.
    pub tables: Vec<TableDef>,
    /// Full resolved crate dependency graph (workspace + external/transitive),
    /// from `cargo metadata`. Drives the Deps tab. Kept separate from
    /// `nodes`/`edges` so the treemap/structure paths see workspace crates only.
    pub dep_graph: DepGraph,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meta {
    pub root_path: String,
    /// ISO-8601 timestamp stamped by the caller (the analyzer stays deterministic).
    pub analyzed_at: String,
    pub crate_count: usize,
    pub file_count: usize,
    pub total_loc: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Crate,
    Module,
    Struct,
    Enum,
    Trait,
    Impl,
    Fn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    /// Stable path id, e.g. `host::parser::decode`.
    pub id: String,
    pub kind: NodeKind,
    pub name: String,
    #[serde(rename = "crate")]
    pub krate: String,
    pub module: String,
    pub file: String,
    pub span: Span,
    pub loc: usize,
    /// Containment parent id (crate -> module -> type/fn). Empty for crate roots.
    pub parent: String,
    pub metrics: Metrics,
    /// Source visibility of the item (`pub` / `pub(crate)` / private).
    #[serde(default)]
    pub visibility: Visibility,
    /// Function signature — present only for `Fn` nodes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<FnSignature>,
    /// Struct fields — present only for `Struct` nodes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<Vec<FieldDef>>,
    /// Enum variants — present only for `Enum` nodes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variants: Option<Vec<VariantDef>>,
    /// Rust doc comment (`///`) text, if any — the "intent" of a fn / test.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct Span {
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeKind {
    /// Crate-to-crate dependency (from cargo metadata).
    Depends,
    /// Containment (crate->module->type->fn).
    Contains,
    /// Static call-flow edge (name-based syntactic approximation).
    Calls,
    /// Type implements a trait.
    Impls,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub source: String,
    pub target: String,
    pub kind: EdgeKind,
    pub weight: u32,
}

/// All four lenses for a single node. Raw counts + a normalized 0..=1 `score`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Metrics {
    pub security: SecurityMetrics,
    pub performance: PerformanceMetrics,
    pub complexity: ComplexityMetrics,
    pub architecture: ArchitectureMetrics,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct SecurityMetrics {
    pub unsafe_blocks: u32,
    pub unwraps: u32,
    pub expects: u32,
    pub panics: u32,
    pub raw_ptr: u32,
    pub transmute: u32,
    pub lossy_casts: u32,
    pub score: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub allocs: u32,
    pub clones: u32,
    pub nested_loops: u32,
    pub recursion: u32,
    pub collects: u32,
    pub async_points: u32,
    pub score: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ComplexityMetrics {
    pub cyclomatic: u32,
    pub loc: u32,
    pub max_nesting: u32,
    pub score: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ArchitectureMetrics {
    pub fan_in: u32,
    pub fan_out: u32,
    pub in_cycle: bool,
    pub score: f64,
}

/// Source visibility of an item. `pub(super)` / `pub(in path)` collapse to
/// `Private` since they are not callable from arbitrary crates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Public,
    #[serde(rename = "pubcrate")]
    PubCrate,
    #[default]
    Private,
}

/// One parameter of a function signature (UML "operation" argument).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamDef {
    /// Binding name (`self` for the receiver, `_` for ignored/destructured).
    pub name: String,
    /// Type rendered to a compact string, e.g. `&[u8]`, `HashMap<K, V>`.
    pub ty: String,
}

/// A function/method signature — the UML "operation" detail of a `Fn` node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FnSignature {
    pub params: Vec<ParamDef>,
    /// Return type string; `()` for the default unit return.
    pub return_type: String,
    pub is_async: bool,
    /// True when the first parameter is a `self` receiver (a method).
    pub is_method: bool,
}

/// A struct field — the UML "attribute" detail of a `Struct` node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDef {
    /// Field name; tuple-struct fields are `"0"`, `"1"`, …
    pub name: String,
    pub ty: String,
    pub visibility: Visibility,
}

/// An enum variant; `payload` holds the inner types (tuple) or `name: Type`
/// strings (struct-like), and is empty for unit variants.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantDef {
    pub name: String,
    pub payload: Vec<String>,
}

/// The resolved crate dependency graph (workspace + external/transitive crates).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DepGraph {
    pub crates: Vec<DepCrate>,
    pub edges: Vec<DepEdge>,
}

/// One crate in the dependency graph, keyed by its cargo `PackageId` repr.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepCrate {
    /// Stable id (cargo `PackageId` repr) — unique even across duplicate versions.
    pub id: String,
    pub name: String,
    pub version: String,
    /// True for workspace members; false for external/transitive crates.
    pub workspace: bool,
}

/// A `from -> to` dependency edge (ids are `DepCrate.id`), tagged with its kind.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepEdge {
    pub from: String,
    pub to: String,
    pub kind: DepKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DepKind {
    Normal,
    Dev,
    Build,
}

/// A storage-table enum: one persistence store whose variants are column
/// families / tables. Detected from variants documented `<desc>: <Key> -> <Value>`
/// (e.g. ethlambda's `Table` enum, an RocksDB/in-memory KV store).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDef {
    /// Parent enum node id — groups all tables of one store.
    pub enum_id: String,
    /// Enum identifier, e.g. `Table`.
    pub enum_name: String,
    pub file: String,
    pub line: usize,
    pub variants: Vec<StorageEntry>,
}

/// One table / column family within a [`TableDef`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageEntry {
    /// Variant identifier, e.g. `BlockHeaders`.
    pub name: String,
    /// Parsed key type, e.g. `H256` or `(slot || root)`.
    pub key: String,
    /// Parsed value type, e.g. `BlockHeader` or `parent_root`.
    pub value: String,
    /// The first doc line (the `<desc>: <Key> -> <Value>` spec line).
    pub doc: String,
    /// Resolved Struct/Enum node id when `value` names a workspace type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value_node_id: Option<String>,
}

/// One ordered call from a function body to a resolved workspace function.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallStep {
    /// Calling fn node id.
    pub caller: String,
    /// Resolved callee fn node id.
    pub callee: String,
    /// 0-based position of the call within the caller's body (source order).
    pub order: u32,
    /// Source line of the call site.
    pub call_line: usize,
}
