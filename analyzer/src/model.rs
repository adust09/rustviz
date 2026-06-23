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
