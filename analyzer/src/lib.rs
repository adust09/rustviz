//! rustviz-analyzer: static analysis of a Rust project into a graph model with
//! per-node Security / Performance / Complexity / Architecture metrics.
//!
//! The crate emits only raw metric counts plus a normalized 0..=1 `score`;
//! all visual mapping (color/size per lens) lives in the web frontend.

mod cargo;
mod graph;
mod metrics;
pub mod model;
mod parse;
mod visit;

use std::path::Path;

use anyhow::Result;

pub use model::Graph;

/// Analyze a Rust project at `project` (a directory or a `Cargo.toml`).
///
/// `analyzed_at` is an ISO-8601 timestamp supplied by the caller, keeping the
/// analyzer itself deterministic and side-effect free.
pub fn analyze(project: &Path, analyzed_at: &str) -> Result<Graph> {
    let ws = cargo::load(project)?;
    let mut collected = parse::Collected::default();
    for c in &ws.crates {
        collected.parse_crate(&c.name, &c.src_dir, &ws.root)?;
    }
    let root = ws.root.to_string_lossy().to_string();
    Ok(graph::assemble(collected, &ws, &root, analyzed_at))
}
