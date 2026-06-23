//! Graph assembly: crate nodes, edges (contains/depends/calls/impls), call-name
//! resolution, cycle detection (Tarjan SCC), fan-in/out, and score normalization.

use std::collections::{HashMap, HashSet};

use petgraph::algo::tarjan_scc;
use petgraph::graph::DiGraph;

use crate::cargo::Workspace;
use crate::metrics::{architecture, complexity, performance, security};
use crate::model::{CallStep, Edge, EdgeKind, Graph, Meta, Node, NodeKind};
use crate::parse::Collected;

pub fn assemble(collected: Collected, ws: &Workspace, root_path: &str, analyzed_at: &str) -> Graph {
    let file_count = collected.file_count;
    let total_loc = collected.total_loc;
    let mut nodes: Vec<Node> = collected.nodes.into_values().collect();
    add_crate_nodes(&mut nodes, ws);

    let id_set: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();
    let mut edges = Vec::new();
    edges.extend(contains_edges(&nodes, &id_set));
    edges.extend(depends_edges(ws, &id_set));
    edges.extend(call_edges(&nodes, &collected.calls));
    edges.extend(impls_edges(&nodes, &collected.impls));

    apply_architecture(&mut nodes, &edges);
    let cycles = detect_cycles(&nodes, &edges);
    mark_cycles(&mut nodes, &cycles);
    normalize_scores(&mut nodes);

    let call_steps = ordered_call_steps(&nodes, &collected.calls);
    let entrypoints = entrypoints(&nodes);
    let crate_count = ws.crates.len();

    Graph {
        meta: Meta {
            root_path: root_path.to_string(),
            analyzed_at: analyzed_at.to_string(),
            crate_count,
            file_count,
            total_loc,
        },
        nodes,
        edges,
        entrypoints,
        cycles,
        call_steps,
    }
}

fn add_crate_nodes(nodes: &mut Vec<Node>, ws: &Workspace) {
    let existing: HashSet<String> = nodes.iter().map(|n| n.id.clone()).collect();
    for c in &ws.crates {
        if existing.contains(&c.name) {
            continue;
        }
        nodes.push(Node {
            id: c.name.clone(),
            kind: NodeKind::Crate,
            name: c.name.clone(),
            krate: c.name.clone(),
            module: c.name.clone(),
            file: String::new(),
            span: Default::default(),
            loc: 0,
            parent: String::new(),
            metrics: Default::default(),
            visibility: crate::model::Visibility::Public,
            signature: None,
            fields: None,
            variants: None,
        });
    }
}

fn contains_edges(nodes: &[Node], id_set: &HashSet<String>) -> Vec<Edge> {
    nodes
        .iter()
        .filter(|n| !n.parent.is_empty() && id_set.contains(&n.parent))
        .map(|n| Edge {
            source: n.parent.clone(),
            target: n.id.clone(),
            kind: EdgeKind::Contains,
            weight: 1,
        })
        .collect()
}

fn depends_edges(ws: &Workspace, id_set: &HashSet<String>) -> Vec<Edge> {
    ws.dep_edges
        .iter()
        .filter(|(a, b)| id_set.contains(a) && id_set.contains(b))
        .map(|(a, b)| Edge {
            source: a.clone(),
            target: b.clone(),
            kind: EdgeKind::Depends,
            weight: 1,
        })
        .collect()
}

/// Index workspace fn nodes by simple name for call resolution.
fn fn_index(nodes: &[Node]) -> HashMap<&str, Vec<&Node>> {
    let mut by_name: HashMap<&str, Vec<&Node>> = HashMap::new();
    for n in nodes.iter().filter(|n| n.kind == NodeKind::Fn) {
        by_name.entry(n.name.as_str()).or_default().push(n);
    }
    by_name
}

fn krate_index(nodes: &[Node]) -> HashMap<&str, &str> {
    nodes.iter().map(|n| (n.id.as_str(), n.krate.as_str())).collect()
}

/// Resolve called idents to workspace fn nodes (same-crate preferred).
fn call_edges(nodes: &[Node], calls: &[(String, Vec<(String, usize)>)]) -> Vec<Edge> {
    let by_name = fn_index(nodes);
    let krate_of = krate_index(nodes);

    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut edges = Vec::new();
    for (src_id, idents) in calls {
        let src_krate = krate_of.get(src_id.as_str()).copied().unwrap_or("");
        let mut counts: HashMap<&str, u32> = HashMap::new();
        for (ident, _line) in idents {
            *counts.entry(ident.as_str()).or_insert(0) += 1;
        }
        for (ident, weight) in counts {
            let Some(cands) = by_name.get(ident) else {
                continue;
            };
            let targets = pick_targets(cands, src_krate, src_id);
            for tgt in targets {
                if seen.insert((src_id.clone(), tgt.clone())) {
                    edges.push(Edge { source: src_id.clone(), target: tgt, kind: EdgeKind::Calls, weight });
                }
            }
        }
    }
    edges
}

/// Ordered, resolved call steps for sequence diagrams. Unlike [`call_edges`]
/// these preserve source order and repeats; each call resolves to its single
/// best target (same-crate preferred).
fn ordered_call_steps(nodes: &[Node], calls: &[(String, Vec<(String, usize)>)]) -> Vec<CallStep> {
    let by_name = fn_index(nodes);
    let krate_of = krate_index(nodes);

    let mut steps = Vec::new();
    for (src_id, idents) in calls {
        let src_krate = krate_of.get(src_id.as_str()).copied().unwrap_or("");
        for (order, (ident, line)) in idents.iter().enumerate() {
            let Some(cands) = by_name.get(ident.as_str()) else {
                continue;
            };
            let Some(callee) = pick_targets(cands, src_krate, src_id).into_iter().next() else {
                continue;
            };
            steps.push(CallStep {
                caller: src_id.clone(),
                callee,
                order: order as u32,
                call_line: *line,
            });
        }
    }
    steps
}

/// Prefer same-crate candidates; fall back to all (capped to avoid common-name noise).
fn pick_targets(cands: &[&Node], src_krate: &str, src_id: &str) -> Vec<String> {
    let same: Vec<String> = cands
        .iter()
        .filter(|c| c.krate == src_krate && c.id != src_id)
        .map(|c| c.id.clone())
        .collect();
    if !same.is_empty() {
        return same;
    }
    cands
        .iter()
        .filter(|c| c.id != src_id)
        .take(8)
        .map(|c| c.id.clone())
        .collect()
}

fn impls_edges(nodes: &[Node], impls: &[(String, String)]) -> Vec<Edge> {
    let traits: HashMap<&str, Vec<&Node>> = nodes
        .iter()
        .filter(|n| n.kind == NodeKind::Trait)
        .fold(HashMap::new(), |mut acc, n| {
            acc.entry(n.name.as_str()).or_default().push(n);
            acc
        });
    let mut edges = Vec::new();
    for (type_id, trait_name) in impls {
        let type_krate = type_id.split("::").next().unwrap_or("");
        if let Some(cands) = traits.get(trait_name.as_str()) {
            let target = cands
                .iter()
                .find(|t| t.krate == type_krate)
                .or_else(|| cands.first())
                .map(|t| t.id.clone());
            if let Some(target) = target {
                edges.push(Edge { source: type_id.clone(), target, kind: EdgeKind::Impls, weight: 1 });
            }
        }
    }
    edges
}

/// Fan-in / fan-out from calls + depends edges (structural `contains` excluded).
fn apply_architecture(nodes: &mut [Node], edges: &[Edge]) {
    let coupling: Vec<&Edge> = edges
        .iter()
        .filter(|e| matches!(e.kind, EdgeKind::Calls | EdgeKind::Depends))
        .collect();
    let mut fan_in: HashMap<&str, u32> = HashMap::new();
    let mut fan_out: HashMap<&str, u32> = HashMap::new();
    for e in &coupling {
        *fan_out.entry(e.source.as_str()).or_insert(0) += 1;
        *fan_in.entry(e.target.as_str()).or_insert(0) += 1;
    }
    for n in nodes.iter_mut() {
        n.metrics.architecture.fan_in = fan_in.get(n.id.as_str()).copied().unwrap_or(0);
        n.metrics.architecture.fan_out = fan_out.get(n.id.as_str()).copied().unwrap_or(0);
    }
}

fn detect_cycles(nodes: &[Node], edges: &[Edge]) -> Vec<Vec<String>> {
    let mut graph = DiGraph::<&str, ()>::new();
    let mut index = HashMap::new();
    for n in nodes {
        index.insert(n.id.as_str(), graph.add_node(n.id.as_str()));
    }
    for e in edges.iter().filter(|e| matches!(e.kind, EdgeKind::Calls | EdgeKind::Depends)) {
        if let (Some(&a), Some(&b)) = (index.get(e.source.as_str()), index.get(e.target.as_str())) {
            graph.add_edge(a, b, ());
        }
    }
    tarjan_scc(&graph)
        .into_iter()
        .filter(|scc| scc.len() > 1)
        .map(|scc| scc.iter().map(|&i| graph[i].to_string()).collect())
        .collect()
}

fn mark_cycles(nodes: &mut [Node], cycles: &[Vec<String>]) {
    let in_cycle: HashSet<&str> = cycles.iter().flatten().map(String::as_str).collect();
    for n in nodes.iter_mut() {
        n.metrics.architecture.in_cycle = in_cycle.contains(n.id.as_str());
    }
}

/// Normalize each lens to 0.0..=1.0 against the global max raw score.
fn normalize_scores(nodes: &mut [Node]) {
    let sec: Vec<f64> = nodes.iter().map(|n| security::raw_score(&n.metrics.security)).collect();
    let perf: Vec<f64> = nodes.iter().map(|n| performance::raw_score(&n.metrics.performance)).collect();
    let cmplx: Vec<f64> = nodes.iter().map(|n| complexity::raw_score(&n.metrics.complexity)).collect();
    let arch: Vec<f64> = nodes.iter().map(|n| architecture::raw_score(&n.metrics.architecture)).collect();

    let (ms, mp, mc, ma) = (max(&sec), max(&perf), max(&cmplx), max(&arch));
    for (i, n) in nodes.iter_mut().enumerate() {
        n.metrics.security.score = norm(sec[i], ms);
        n.metrics.performance.score = norm(perf[i], mp);
        n.metrics.complexity.score = norm(cmplx[i], mc);
        n.metrics.architecture.score = norm(arch[i], ma);
    }
}

fn max(v: &[f64]) -> f64 {
    v.iter().copied().fold(0.0, f64::max)
}

fn norm(value: f64, max: f64) -> f64 {
    if max > 0.0 {
        (value / max).clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// `main` functions are the natural entry points; fall back to the most-called fn.
fn entrypoints(nodes: &[Node]) -> Vec<String> {
    let mains: Vec<String> = nodes
        .iter()
        .filter(|n| n.kind == NodeKind::Fn && n.name == "main")
        .map(|n| n.id.clone())
        .collect();
    if !mains.is_empty() {
        return mains;
    }
    nodes
        .iter()
        .filter(|n| n.kind == NodeKind::Fn)
        .max_by_key(|n| n.metrics.architecture.fan_out)
        .map(|n| vec![n.id.clone()])
        .unwrap_or_default()
}
