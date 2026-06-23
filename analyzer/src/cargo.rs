//! Workspace discovery via `cargo metadata`: member crates and the
//! crate-to-crate dependency edges *within* the workspace (external deps are
//! intentionally excluded to keep the architecture graph readable).

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use cargo_metadata::MetadataCommand;

pub struct CrateInfo {
    pub name: String,
    /// Directory containing the crate's `src/`.
    pub src_dir: PathBuf,
}

pub struct Workspace {
    pub crates: Vec<CrateInfo>,
    /// `(from_crate, to_crate)` pairs, both workspace members.
    pub dep_edges: Vec<(String, String)>,
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
    let metadata = MetadataCommand::new()
        .manifest_path(&manifest)
        .no_deps()
        .exec()
        .with_context(|| format!("cargo metadata failed for {}", manifest.display()))?;

    let member_names: Vec<String> = metadata
        .packages
        .iter()
        .map(|p| p.name.clone())
        .collect();

    let mut crates = Vec::new();
    let mut dep_edges = Vec::new();

    for pkg in &metadata.packages {
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
            if member_names.contains(&dep.name) && dep.name != pkg.name {
                dep_edges.push((pkg.name.clone(), dep.name.clone()));
            }
        }
    }

    Ok(Workspace {
        crates,
        dep_edges,
        root: metadata.workspace_root.as_std_path().to_path_buf(),
    })
}
