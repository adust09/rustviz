//! Complexity lens: cyclomatic complexity dominates, nesting and length adjust.

use crate::model::ComplexityMetrics;

/// Weighted raw complexity score (un-normalized). Higher = harder to maintain.
pub fn raw_score(m: &ComplexityMetrics) -> f64 {
    f64::from(m.cyclomatic) * 1.0
        + f64::from(m.max_nesting) * 1.5
        + f64::from(m.loc) * 0.05
}
