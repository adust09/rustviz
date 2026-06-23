//! Complexity lens: cyclomatic complexity dominates, nesting adjusts. LOC is the
//! tile-area channel, so it is deliberately kept out of the color score to keep
//! size and color orthogonal.

use crate::model::ComplexityMetrics;

/// Weighted raw complexity score (un-normalized). Higher = harder to maintain.
pub fn raw_score(m: &ComplexityMetrics) -> f64 {
    f64::from(m.cyclomatic) * 1.0 + f64::from(m.max_nesting) * 1.5
}
