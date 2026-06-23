//! Performance lens: weight nested loops and recursion highest (super-linear
//! cost), then allocations and clones.

use crate::model::PerformanceMetrics;

/// Weighted raw cost score (un-normalized). Higher = hotter.
pub fn raw_score(m: &PerformanceMetrics) -> f64 {
    f64::from(m.nested_loops) * 3.0
        + f64::from(m.recursion) * 2.0
        + f64::from(m.allocs) * 1.0
        + f64::from(m.clones) * 1.0
        + f64::from(m.collects) * 0.8
        + f64::from(m.async_points) * 0.3
}
