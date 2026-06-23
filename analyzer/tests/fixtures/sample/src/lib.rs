//! Fixture with deliberately known metric counts (asserted in tests/analyze.rs).

/// 1 unwrap, 1 panic, 1 unsafe block, 1 nested loop, 2 lossy casts.
pub fn risky(data: &[u8]) -> u8 {
    let _first = data.first().unwrap();
    if data.is_empty() {
        panic!("empty");
    }
    let mut total: u64 = 0;
    for i in 0..data.len() {
        for j in 0..data.len() {
            total += (data[i] as u64) * (j as u64);
        }
    }
    let _ = total;
    unsafe {
        let p = data.as_ptr();
        *p
    }
}

/// 1 alloc (Vec::new), 1 clone.
pub fn helper() -> Vec<u8> {
    let v: Vec<u8> = Vec::new();
    v.clone()
}

/// 1 recursion.
pub fn recurse(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    n + recurse(n - 1)
}
