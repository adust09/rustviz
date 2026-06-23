//! Pure scoring functions: raw metric counts -> a weighted raw score.
//!
//! Normalization to 0.0..=1.0 happens later in `graph.rs` (it needs the global
//! max across all nodes). Keeping scoring pure makes weights easy to tune and
//! unit-test without building a graph.

pub mod architecture;
pub mod complexity;
pub mod performance;
pub mod security;
