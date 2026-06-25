use std::path::PathBuf;

use rustviz_analyzer::model::NodeKind;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample")
}

fn storage_fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/storage")
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

    // The sample fixture has no storage-table enum.
    assert!(graph.tables.is_empty(), "sample fixture has no storage tables");
}

#[test]
fn detects_storage_tables_from_doc_specs() {
    let graph = rustviz_analyzer::analyze(&storage_fixture_dir(), "1970-01-01T00:00:00Z")
        .expect("analysis should succeed on the storage fixture");

    assert_eq!(graph.tables.len(), 1, "exactly one storage-table enum (`Table`)");
    let table = &graph.tables[0];
    assert_eq!(table.enum_name, "Table");
    assert_eq!(table.variants.len(), 5, "five documented column families");

    let by_name: std::collections::HashMap<&str, &_> =
        table.variants.iter().map(|v| (v.name.as_str(), v)).collect();

    // Struct-backed value resolves to a node id; H256 key parsed.
    let headers = by_name["BlockHeaders"];
    assert_eq!(headers.key, "H256");
    assert_eq!(headers.value, "BlockHeader");
    assert!(
        headers
            .value_node_id
            .as_deref()
            .is_some_and(|id| id.ends_with("::BlockHeader")),
        "BlockHeader value resolves to its struct node, got {:?}",
        headers.value_node_id
    );

    // Description prefix is stripped from the key.
    let meta = by_name["Metadata"];
    assert_eq!(meta.key, "string keys");
    assert_eq!(meta.value, "various scalar values");
    assert!(meta.value_node_id.is_none(), "free-text value does not resolve");

    // Composite key + scalar value: parsed but unresolved.
    let live = by_name["LiveChain"];
    assert_eq!(live.key, "(slot || root)");
    assert_eq!(live.value, "parent_root");
    assert!(live.value_node_id.is_none(), "scalar `parent_root` does not resolve");

    // The single-arrow `Direction` enum must not be picked up (≥2-variant rule).
    assert!(
        !graph.tables.iter().any(|t| t.enum_name == "Direction"),
        "ordinary enums with <2 spec variants are not storage tables"
    );
}
