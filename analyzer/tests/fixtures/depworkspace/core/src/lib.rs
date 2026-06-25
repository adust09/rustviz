//! Fixture crate `core` — depends on the non-member path crate `leaf`.

pub fn value() -> u64 {
    leaf::seed()
}
