//! Source parsing: walk a crate's `src/`, parse each file with `syn`, and emit
//! module / type / trait / impl / fn nodes plus per-fn raw metrics and call idents.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::Result;
use syn::spanned::Spanned;
use walkdir::WalkDir;

use crate::model::{
    FieldDef, FnSignature, Metrics, Node, NodeKind, ParamDef, Span, VariantDef, Visibility,
};
use crate::visit::RawFn;

/// Accumulates everything parsed across all crates (modules deduped by id).
#[derive(Default)]
pub struct Collected {
    pub nodes: BTreeMap<String, Node>,
    /// `(fn_id, [(called ident, call-site line)])` in source order, for later
    /// name-based call resolution (both weighted edges and ordered call steps).
    pub calls: Vec<(String, Vec<(String, usize)>)>,
    /// `(type_id, trait simple name)` for later `impls` edge resolution.
    pub impls: Vec<(String, String)>,
    /// Storage-table enums (variants documented `<desc>: <Key> -> <Value>`),
    /// raw — value type names resolve to node ids later in `graph::assemble`.
    pub tables: Vec<RawTable>,
    pub file_count: usize,
    pub total_loc: usize,
}

/// A storage-table enum collected during the walk; value types are still raw
/// strings here (resolved to node ids in `graph::assemble`).
pub struct RawTable {
    pub enum_id: String,
    pub enum_name: String,
    pub file: String,
    pub line: usize,
    pub entries: Vec<RawEntry>,
}

/// One `<desc>: <Key> -> <Value>` table parsed from a variant's first doc line.
pub struct RawEntry {
    pub name: String,
    pub key: String,
    pub value: String,
    pub doc: String,
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
                    self.add_fn(krate, module_id, module_id, file, &id, &f.sig.ident.to_string(), item.span(), Some(&f.block), Some(&f.sig), convert_vis(&f.vis), doc_of(&f.attrs));
                }
                syn::Item::Struct(s) => self.add_struct(krate, module_id, file, s, item.span()),
                syn::Item::Enum(e) => self.add_enum(krate, module_id, file, e, item.span()),
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
        self.add_node(krate, module_id, module_id, file, &trait_id, &t.ident.to_string(), NodeKind::Trait, t.span(), convert_vis(&t.vis));
        for ti in &t.items {
            if let syn::TraitItem::Fn(m) = ti {
                let id = format!("{trait_id}::{}", m.sig.ident);
                // Trait items have no own visibility; they follow the trait's.
                self.add_fn(krate, module_id, &trait_id, file, &id, &m.sig.ident.to_string(), m.span(), m.default.as_ref(), Some(&m.sig), convert_vis(&t.vis), doc_of(&m.attrs));
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
            self.add_node(krate, module_id, module_id, file, &type_id, &type_name, NodeKind::Struct, i.self_ty.span(), Visibility::Private);
        }
        if let Some((_, path, _)) = &i.trait_ {
            if let Some(seg) = path.segments.last() {
                self.impls.push((type_id.clone(), seg.ident.to_string()));
            }
        }
        for ii in &i.items {
            if let syn::ImplItem::Fn(m) = ii {
                let id = format!("{type_id}::{}", m.sig.ident);
                self.add_fn(krate, module_id, &type_id, file, &id, &m.sig.ident.to_string(), m.span(), Some(&m.block), Some(&m.sig), convert_vis(&m.vis), doc_of(&m.attrs));
            }
        }
    }

    fn add_struct(&mut self, krate: &str, module_id: &str, file: &str, s: &syn::ItemStruct, span: proc_macro2::Span) {
        let id = format!("{module_id}::{}", s.ident);
        let mut node = make_node(&id, &s.ident.to_string(), NodeKind::Struct, krate, module_id, module_id, file, span, Metrics::default());
        node.visibility = convert_vis(&s.vis);
        node.fields = Some(struct_fields(&s.fields));
        self.insert(node);
    }

    fn add_enum(&mut self, krate: &str, module_id: &str, file: &str, e: &syn::ItemEnum, span: proc_macro2::Span) {
        let id = format!("{module_id}::{}", e.ident);
        let mut node = make_node(&id, &e.ident.to_string(), NodeKind::Enum, krate, module_id, module_id, file, span, Metrics::default());
        node.visibility = convert_vis(&e.vis);
        node.variants = Some(enum_variants(e));
        self.insert(node);
        self.detect_storage_table(&id, &e.ident.to_string(), file, span, e);
    }

    /// Recognize a storage-table enum: variants documented `<desc>: <Key> -> <Value>`
    /// (a typed KV store, e.g. ethlambda's `Table`). Qualifies only if ≥2 variants
    /// parse, keeping ordinary doc'd enums out.
    fn detect_storage_table(&mut self, enum_id: &str, enum_name: &str, file: &str, span: proc_macro2::Span, e: &syn::ItemEnum) {
        let entries: Vec<RawEntry> = e
            .variants
            .iter()
            .filter_map(|v| {
                let doc = first_doc_line(&v.attrs)?;
                let (key, value) = parse_kv_spec(&doc)?;
                Some(RawEntry { name: v.ident.to_string(), key, value, doc })
            })
            .collect();
        if entries.len() < 2 {
            return;
        }
        self.tables.push(RawTable {
            enum_id: enum_id.to_string(),
            enum_name: enum_name.to_string(),
            file: file.to_string(),
            line: line_of(span),
            entries,
        });
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::too_many_arguments)]
    fn add_fn(&mut self, krate: &str, module_id: &str, parent: &str, file: &str, id: &str, name: &str, span: proc_macro2::Span, block: Option<&syn::Block>, sig: Option<&syn::Signature>, vis: Visibility, doc: Option<String>) {
        let mut metrics = Metrics::default();
        if let Some(block) = block {
            let raw = RawFn::collect(name, block);
            metrics.security = raw.security;
            metrics.performance = raw.performance;
            metrics.complexity = raw.complexity;
            self.calls.push((id.to_string(), raw.calls));
        }
        metrics.complexity.loc = loc_of(span) as u32;
        let mut node = make_node(id, name, NodeKind::Fn, krate, module_id, parent, file, span, metrics);
        node.visibility = vis;
        node.signature = sig.map(build_signature);
        node.doc = doc;
        self.insert(node);
    }

    #[allow(clippy::too_many_arguments)]
    fn add_node(&mut self, krate: &str, module_id: &str, parent: &str, file: &str, id: &str, name: &str, kind: NodeKind, span: proc_macro2::Span, vis: Visibility) {
        let mut node = make_node(id, name, kind, krate, module_id, parent, file, span, Metrics::default());
        node.visibility = vis;
        self.insert(node);
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
                visibility: Visibility::default(),
                signature: None,
                fields: None,
                variants: None,
                doc: None,
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
        visibility: Visibility::default(),
        signature: None,
        fields: None,
        variants: None,
        doc: None,
    }
}

/// Concatenate the `///` doc-comment lines of an item into one trimmed string.
fn doc_of(attrs: &[syn::Attribute]) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();
    for attr in attrs {
        if !attr.path().is_ident("doc") {
            continue;
        }
        if let syn::Meta::NameValue(nv) = &attr.meta {
            if let syn::Expr::Lit(syn::ExprLit { lit: syn::Lit::Str(s), .. }) = &nv.value {
                lines.push(s.value().trim().to_string());
            }
        }
    }
    if lines.is_empty() {
        None
    } else {
        Some(lines.join(" ").trim().to_string())
    }
}

/// First `///` doc line of an item (NOT joined like [`doc_of`]) — storage specs
/// live on the first line, with explanation paragraphs following after a blank
/// `///` line that must not bleed into the parsed value.
fn first_doc_line(attrs: &[syn::Attribute]) -> Option<String> {
    for attr in attrs {
        if !attr.path().is_ident("doc") {
            continue;
        }
        if let syn::Meta::NameValue(nv) = &attr.meta {
            if let syn::Expr::Lit(syn::ExprLit { lit: syn::Lit::Str(s), .. }) = &nv.value {
                let line = s.value().trim().to_string();
                if !line.is_empty() {
                    return Some(line);
                }
            }
        }
    }
    None
}

/// Parse a `<desc>: <Key> -> <Value>` storage spec into `(key, value)`.
/// `value` is the text after the last ` -> `; `key` is the text after the last
/// `: ` on the left side (or the whole left side if there is no description).
fn parse_kv_spec(line: &str) -> Option<(String, String)> {
    let (left, value) = line.rsplit_once(" -> ")?;
    let value = value.trim();
    let key = left.rsplit_once(": ").map(|(_, k)| k).unwrap_or(left).trim();
    if key.is_empty() || value.is_empty() {
        return None;
    }
    Some((key.to_string(), value.to_string()))
}

/// Map a `syn::Visibility` to our coarse model. `pub(super)` / `pub(in ...)`
/// collapse to `Private` since they aren't reachable from arbitrary crates.
fn convert_vis(vis: &syn::Visibility) -> Visibility {
    match vis {
        syn::Visibility::Public(_) => Visibility::Public,
        syn::Visibility::Restricted(r) if r.path.is_ident("crate") => Visibility::PubCrate,
        _ => Visibility::Private,
    }
}

/// Compact, display-friendly rendering of a `syn::Type` (e.g. `HashMap<K, V>`).
fn ty_string(ty: &syn::Type) -> String {
    normalize_ty(&quote::quote!(#ty).to_string())
}

/// `quote` inserts a space around every token; tighten the common punctuation
/// so types read like source (`Vec < u8 >` -> `Vec<u8>`, `& 'a str` -> `&'a str`).
fn normalize_ty(s: &str) -> String {
    s.replace(" ::", "::")
        .replace(":: ", "::")
        .replace(" <", "<")
        .replace("< ", "<")
        .replace(" >", ">")
        .replace("> ", ">")
        .replace(" ,", ",")
        .replace("& ", "&")
}

fn build_signature(sig: &syn::Signature) -> FnSignature {
    let mut params = Vec::new();
    let mut is_method = false;
    for arg in &sig.inputs {
        match arg {
            syn::FnArg::Receiver(r) => {
                is_method = true;
                let prefix = if r.reference.is_some() { "&" } else { "" };
                let mutability = if r.mutability.is_some() { "mut " } else { "" };
                params.push(ParamDef { name: "self".into(), ty: format!("{prefix}{mutability}self") });
            }
            syn::FnArg::Typed(pt) => {
                let name = match pt.pat.as_ref() {
                    syn::Pat::Ident(i) => i.ident.to_string(),
                    _ => "_".into(),
                };
                params.push(ParamDef { name, ty: ty_string(&pt.ty) });
            }
        }
    }
    let return_type = match &sig.output {
        syn::ReturnType::Default => "()".to_string(),
        syn::ReturnType::Type(_, ty) => ty_string(ty),
    };
    FnSignature { params, return_type, is_async: sig.asyncness.is_some(), is_method }
}

fn struct_fields(fields: &syn::Fields) -> Vec<FieldDef> {
    match fields {
        syn::Fields::Named(named) => named
            .named
            .iter()
            .map(|f| FieldDef {
                name: f.ident.as_ref().map(ToString::to_string).unwrap_or_default(),
                ty: ty_string(&f.ty),
                visibility: convert_vis(&f.vis),
            })
            .collect(),
        syn::Fields::Unnamed(unnamed) => unnamed
            .unnamed
            .iter()
            .enumerate()
            .map(|(i, f)| FieldDef { name: i.to_string(), ty: ty_string(&f.ty), visibility: convert_vis(&f.vis) })
            .collect(),
        syn::Fields::Unit => Vec::new(),
    }
}

fn enum_variants(e: &syn::ItemEnum) -> Vec<VariantDef> {
    e.variants
        .iter()
        .map(|v| {
            let payload = match &v.fields {
                syn::Fields::Named(named) => named
                    .named
                    .iter()
                    .map(|f| format!("{}: {}", f.ident.as_ref().map(ToString::to_string).unwrap_or_default(), ty_string(&f.ty)))
                    .collect(),
                syn::Fields::Unnamed(unnamed) => unnamed.unnamed.iter().map(|f| ty_string(&f.ty)).collect(),
                syn::Fields::Unit => Vec::new(),
            };
            VariantDef { name: v.ident.to_string(), payload }
        })
        .collect()
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
