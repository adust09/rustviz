//! Architecture lens: coupling (fan-in + fan-out) with a cycle penalty.

use crate::model::ArchitectureMetrics;

/// Weighted raw coupling score (un-normalized). Higher = more central/coupled.
pub fn raw_score(m: &ArchitectureMetrics) -> f64 {
    let cycle_penalty = if m.in_cycle { 4.0 } else { 0.0 };
    f64::from(m.fan_in) * 1.0 + f64::from(m.fan_out) * 1.0 + cycle_penalty
}
