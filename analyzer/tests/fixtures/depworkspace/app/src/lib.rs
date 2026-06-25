//! Fixture crate `app` — depends on `core` (normal) and `testutil` (dev).

pub fn run() -> u64 {
    core::value()
}
