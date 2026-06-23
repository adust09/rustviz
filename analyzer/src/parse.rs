//! Source parsing: walk a crate's `src/`, parse each file with `syn`, and emit
//! module / type / trait / impl / fn nodes plus per-fn raw metrics and call idents.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Result;
use syn::spanned::Spanned;
use walkdir::WalkDir;

use crate::model::{Metrics, Node, NodeKind, Span};
use crate::visit::RawFn;

/// Accumulates everything parsed across all crates (modules deduped by id).
#[derive(Default)]
pub struct Collected {
    pub nodes: BTreeMap<String, Node>,
    /// `(fn_id, called idents)` for later name-based call resolution.
    pub calls: Vec<(String, Vec<String>)>,
    /// `(type_id, trait simple name)` for later `impls` edge resolution.
    pub impls: Vec<(String, String)>,
    pub file_count: usize,
    pub total_loc: usize,
}

impl Collected {
    pub fn parse_crate(&mut self, krate: &str, src_dir: &Path, ws_root: &Path) -> Result<()> {
        if !src_dir.exists() {
            return Ok(());
        }
        for entry in WalkDir::new(src_dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let module_id = module_id_for_file(krate, src_dir, path);
            let file_rel = display_path(ws_root, path);
            self.parse_file(krate, &module_id, &file_rel, path);
        }
        Ok(())
    }

    fn parse_file(&mut self, krate: &str, module_id: &str, file_rel: &str, path: &Path) {
        let Ok(content) = std::fs::read_to_string(path) else {
            return;
        };
        self.file_count += 1;
        self.total_loc += content.lines().count();
        let ast = match syn::parse_file(&content) {
            Ok(ast) => ast,
            Err(err) => {
                eprintln!("warning: failed to parse {file_rel}: {err}");
                return;
            }
        };
        if module_id != krate {
            self.ensure_module(krate, module_id, file_rel, 1);
        }
        self.walk_items(krate, module_id, file_rel, &ast.items);
    }

    fn walk_items(&mut self, krate: &str, module_id: &str, file: &str, items: &[syn::Item]) {
        for item in items {
            match item {
                syn::Item::Mod(m) => self.handle_mod(krate, module_id, file, m),
                syn::Item::Fn(f) => {
                    let id = format!("{module_id}::{}", f.sig.ident);
                    self.add_fn(krate, module_id, module_id, file, &id, &f.sig.ident.to_string(), item.span(), Some(&f.block));
                }
                syn::Item::Struct(s) => self.add_type(krate, module_id, file, &s.ident.to_string(), NodeKind::Struct, item.span()),
                syn::Item::Enum(e) => self.add_type(krate, module_id, file, &e.ident.to_string(), NodeKind::Enum, item.span()),
                syn::Item::Trait(t) => self.handle_trait(krate, module_id, file, t),
                syn::Item::Impl(i) => self.handle_impl(krate, module_id, file, i),
                _ => {}
            }
        }
    }

    fn handle_mod(&mut self, krate: &str, module_id: &str, file: &str, m: &syn::ItemMod) {
        let inner = format!("{module_id}::{}", m.ident);
        self.ensure_module(krate, &inner, file, line_of(m.span()));
        if let Some((_, content)) = &m.content {
            self.walk_items(krate, &inner, file, content);
        }
    }

    fn handle_trait(&mut self, krate: &str, module_id: &str, file: &str, t: &syn::ItemTrait) {
        let trait_id = format!("{module_id}::{}", t.ident);
        self.add_node(krate, module_id, module_id, file, &trait_id, &t.ident.to_string(), NodeKind::Trait, t.span(), None);
        for ti in &t.items {
            if let syn::TraitItem::Fn(m) = ti {
                let id = format!("{trait_id}::{}", m.sig.ident);
                self.add_fn(krate, module_id, &trait_id, file, &id, &m.sig.ident.to_string(), m.span(), m.default.as_ref());
            }
        }
    }

    fn handle_impl(&mut self, krate: &str, module_id: &str, file: &str, i: &syn::ItemImpl) {
        let Some(type_name) = type_name(&i.self_ty) else {
            return;
        };
        let type_id = format!("{module_id}::{type_name}");
        // Best-effort: create a placeholder type node if the type was defined elsewhere.
        if !self.nodes.contains_key(&type_id) {
            self.add_node(krate, module_id, module_id, file, &type_id, &type_name, NodeKind::Struct, i.self_ty.span(), None);
        }
        if let Some((_, path, _)) = &i.trait_ {
            if let Some(seg) = path.segments.last() {
                self.impls.push((type_id.clone(), seg.ident.to_string()));
            }
        }
        for ii in &i.items {
            if let syn::ImplItem::Fn(m) = ii {
                let id = format!("{type_id}::{}", m.sig.ident);
                self.add_fn(krate, module_id, &type_id, file, &id, &m.sig.ident.to_string(), m.span(), Some(&m.block));
            }
        }
    }

    fn add_type(&mut self, krate: &str, module_id: &str, file: &str, name: &str, kind: NodeKind, span: proc_macro2::Span) {
        let id = format!("{module_id}::{name}");
        self.add_node(krate, module_id, module_id, file, &id, name, kind, span, None);
    }

    #[allow(clippy::too_many_arguments)]
    fn add_fn(&mut self, krate: &str, module_id: &str, parent: &str, file: &str, id: &str, name: &str, span: proc_macro2::Span, block: Option<&syn::Block>) {
        let mut metrics = Metrics::default();
        if let Some(block) = block {
            let raw = RawFn::collect(name, block);
            metrics.security = raw.security;
            metrics.performance = raw.performance;
            metrics.complexity = raw.complexity;
            self.calls.push((id.to_string(), raw.calls));
        }
        metrics.complexity.loc = loc_of(span) as u32;
        self.insert(make_node(id, name, NodeKind::Fn, krate, module_id, parent, file, span, metrics));
    }

    #[allow(clippy::too_many_arguments)]
    fn add_node(&mut self, krate: &str, module_id: &str, parent: &str, file: &str, id: &str, name: &str, kind: NodeKind, span: proc_macro2::Span, _block: Option<&syn::Block>) {
        let metrics = Metrics::default();
        self.insert(make_node(id, name, kind, krate, module_id, parent, file, span, metrics));
    }

    fn ensure_module(&mut self, krate: &str, module_id: &str, file: &str, line: usize) {
        if module_id == krate || !module_id.starts_with(&format!("{krate}::")) {
            return;
        }
        let suffix = &module_id[krate.len() + 2..];
        let mut cur = krate.to_string();
        for seg in suffix.split("::") {
            let parent = cur.clone();
            cur = format!("{cur}::{seg}");
            let span = Span { start_line: line, end_line: line };
            self.nodes.entry(cur.clone()).or_insert_with(|| Node {
                id: cur.clone(),
                kind: NodeKind::Module,
                name: seg.to_string(),
                krate: krate.to_string(),
                module: cur.clone(),
                file: file.to_string(),
                span,
                loc: 0,
                parent,
                metrics: Metrics::default(),
            });
        }
    }

    /// Insert a node, but never let a placeholder overwrite a real definition.
    fn insert(&mut self, node: Node) {
        self.nodes.entry(node.id.clone()).or_insert(node);
    }
}

#[allow(clippy::too_many_arguments)]
fn make_node(id: &str, name: &str, kind: NodeKind, krate: &str, module: &str, parent: &str, file: &str, span: proc_macro2::Span, metrics: Metrics) -> Node {
    Node {
        id: id.to_string(),
        kind,
        name: name.to_string(),
        krate: krate.to_string(),
        module: module.to_string(),
        file: file.to_string(),
        span: Span { start_line: line_of(span), end_line: end_line_of(span) },
        loc: loc_of(span),
        parent: parent.to_string(),
        metrics,
    }
}

fn line_of(span: proc_macro2::Span) -> usize {
    span.start().line
}

fn end_line_of(span: proc_macro2::Span) -> usize {
    span.end().line
}

fn loc_of(span: proc_macro2::Span) -> usize {
    end_line_of(span).saturating_sub(line_of(span)) + 1
}

/// Last path segment of a type, e.g. `module::Foo<T>` -> `Foo`.
fn type_name(ty: &syn::Type) -> Option<String> {
    match ty {
        syn::Type::Path(p) => p.path.segments.last().map(|s| s.ident.to_string()),
        syn::Type::Reference(r) => type_name(&r.elem),
        _ => None,
    }
}

/// Module path id for a file, following Rust's `mod.rs` / file-as-module rules.
fn module_id_for_file(krate: &str, src_dir: &Path, file: &Path) -> String {
    let rel = file.strip_prefix(src_dir).unwrap_or(file);
    let comps: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    let mut parts: Vec<String> = comps[..comps.len().saturating_sub(1)].to_vec();
    let stem = file
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    match stem.as_str() {
        "lib" | "main" if parts.is_empty() => {}
        "mod" => {}
        other => parts.push(other.to_string()),
    }
    if parts.is_empty() {
        krate.to_string()
    } else {
        format!("{}::{}", krate, parts.join("::"))
    }
}

/// Workspace-root-relative path (`host/src/parser.rs`); unique and resolvable
/// by the source-serving endpoint.
fn display_path(ws_root: &Path, file: &Path) -> String {
    file.strip_prefix(ws_root)
        .unwrap_or(file)
        .to_string_lossy()
        .to_string()
}
