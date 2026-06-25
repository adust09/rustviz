//! Workspace discovery via `cargo metadata`: member crates, the crate-to-crate
//! dependency edges *within* the workspace (for the architecture overlays), and
//! the full resolved dependency graph (workspace + external/transitive crates)
//! that drives the Deps tab.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use cargo_metadata::{DependencyKind, MetadataCommand};

use crate::model::{DepCrate, DepEdge, DepGraph, DepKind};

pub struct CrateInfo {
    pub name: String,
    /// Directory containing the crate's `src/`.
    pub src_dir: PathBuf,
}

pub struct Workspace {
    pub crates: Vec<CrateInfo>,
    /// `(from_crate, to_crate)` pairs, both workspace members.
    pub dep_edges: Vec<(String, String)>,
    /// Full resolved dependency graph (workspace + external/transitive).
    pub dep_graph: DepGraph,
    pub root: PathBuf,
}

/// Resolve the manifest path for a project root (accepts a dir or a Cargo.toml).
fn manifest_path(input: &Path) -> PathBuf {
    if input.is_dir() {
        input.join("Cargo.toml")
    } else {
        input.to_path_buf()
    }
}

pub fn load(project: &Path) -> Result<Workspace> {
    let manifest = manifest_path(project);
    // Full resolve (no `--no-deps`): we need the transitive dependency graph for
    // the Deps tab. Heavier than `--no-deps` and may touch the registry/network
    // if Cargo.lock or the local cache is incomplete.
    let metadata = MetadataCommand::new()
        .manifest_path(&manifest)
        .exec()
        .with_context(|| format!("cargo metadata failed for {}", manifest.display()))?;

    let member_ids: HashSet<&cargo_metadata::PackageId> = metadata.workspace_members.iter().collect();
    let member_names: HashSet<&str> = metadata
        .packages
        .iter()
        .filter(|p| member_ids.contains(&p.id))
        .map(|p| p.name.as_str())
        .collect();

    let mut crates = Vec::new();
    let mut dep_edges = Vec::new();

    for pkg in metadata.packages.iter().filter(|p| member_ids.contains(&p.id)) {
        let src_dir = pkg
            .manifest_path
            .parent()
            .map(|p| p.as_std_path().join("src"))
            .unwrap_or_default();
        crates.push(CrateInfo {
            name: pkg.name.clone(),
            src_dir,
        });

        for dep in &pkg.dependencies {
            if member_names.contains(dep.name.as_str()) && dep.name != pkg.name {
                dep_edges.push((pkg.name.clone(), dep.name.clone()));
            }
        }
    }

    let dep_graph = build_dep_graph(&metadata, &member_ids);

    Ok(Workspace {
        crates,
        dep_edges,
        dep_graph,
        root: metadata.workspace_root.as_std_path().to_path_buf(),
    })
}

/// Build the full dependency graph from `metadata.resolve` (the resolved tree).
fn build_dep_graph(
    metadata: &cargo_metadata::Metadata,
    member_ids: &HashSet<&cargo_metadata::PackageId>,
) -> DepGraph {
    let crates: Vec<DepCrate> = metadata
        .packages
        .iter()
        .map(|p| DepCrate {
            id: p.id.repr.clone(),
            name: p.name.clone(),
            version: p.version.to_string(),
            workspace: member_ids.contains(&p.id),
        })
        .collect();

    let mut edges = Vec::new();
    let mut seen = HashSet::new();
    if let Some(resolve) = &metadata.resolve {
        for node in &resolve.nodes {
            for dep in &node.deps {
                for dk in &dep.dep_kinds {
                    let Some(kind) = map_kind(dk.kind) else { continue };
                    let edge = (node.id.repr.clone(), dep.pkg.repr.clone(), kind);
                    if seen.insert(edge.clone()) {
                        edges.push(DepEdge { from: edge.0, to: edge.1, kind });
                    }
                }
            }
        }
    }

    DepGraph { crates, edges }
}

fn map_kind(kind: DependencyKind) -> Option<DepKind> {
    match kind {
        DependencyKind::Normal => Some(DepKind::Normal),
        DependencyKind::Development => Some(DepKind::Dev),
        DependencyKind::Build => Some(DepKind::Build),
        _ => None,
    }
}
