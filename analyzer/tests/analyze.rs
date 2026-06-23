use std::path::PathBuf;

use rustviz_analyzer::model::NodeKind;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample")
}

#[test]
fn analyzes_fixture_with_known_metric_counts() {
    let graph = rustviz_analyzer::analyze(&fixture_dir(), "1970-01-01T00:00:00Z")
        .expect("analysis should succeed on the sample fixture");

    assert!(
        graph
            .nodes
            .iter()
            .any(|n| n.kind == NodeKind::Crate && n.name == "sample"),
        "crate node `sample` should exist"
    );

    let fns: Vec<_> = graph
        .nodes
        .iter()
        .filter(|n| n.kind == NodeKind::Fn)
        .collect();
    assert_eq!(fns.len(), 3, "expected risky, helper, recurse");

    let total_unsafe: u32 = fns.iter().map(|n| n.metrics.security.unsafe_blocks).sum();
    let total_unwraps: u32 = fns.iter().map(|n| n.metrics.security.unwraps).sum();
    let total_panics: u32 = fns.iter().map(|n| n.metrics.security.panics).sum();
    let total_clones: u32 = fns.iter().map(|n| n.metrics.performance.clones).sum();
    let total_nested: u32 = fns.iter().map(|n| n.metrics.performance.nested_loops).sum();
    let total_recursion: u32 = fns.iter().map(|n| n.metrics.performance.recursion).sum();

    assert_eq!(total_unsafe, 1, "one unsafe block");
    assert_eq!(total_unwraps, 1, "one unwrap");
    assert_eq!(total_panics, 1, "one panic!");
    assert_eq!(total_clones, 1, "one clone");
    assert_eq!(total_nested, 1, "one nested loop");
    assert!(total_recursion >= 1, "recurse() self-calls");

    let max_security = fns
        .iter()
        .map(|n| n.metrics.security.score)
        .fold(0.0_f64, f64::max);
    assert!(
        (max_security - 1.0).abs() < 1e-9,
        "the riskiest fn should normalize to a security score of 1.0"
    );
}
