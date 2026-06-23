//! Security lens: weight memory-unsafety and panic surface highest.

use crate::model::SecurityMetrics;

/// Weighted raw risk score (un-normalized). Higher = riskier.
pub fn raw_score(m: &SecurityMetrics) -> f64 {
    f64::from(m.unsafe_blocks) * 3.0
        + f64::from(m.transmute) * 3.0
        + f64::from(m.raw_ptr) * 2.0
        + f64::from(m.panics) * 1.5
        + f64::from(m.unwraps) * 1.0
        + f64::from(m.expects) * 0.8
        + f64::from(m.lossy_casts) * 0.5
}
