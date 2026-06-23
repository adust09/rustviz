---
title: RustViz Architecture
last_updated: 2026-06-23
tags:
  - rustviz
  - architecture
  - visualization
---

# RustViz Architecture

RustViz is three loosely-coupled layers joined by a single JSON contract. The seam
between them is deliberate: the Rust side knows nothing about colors, and the
TypeScript side knows nothing about `syn`.

## Layers

```
rustviz <path>
  [1] analyzer (Rust lib)   cargo_metadata + syn AST walk → Graph (raw metrics + scores)
        ↓ serde_json
  [2] server  (Rust bin)    axum: /api/analyze, /api/source, embedded web/dist
        ↓ HTTP (127.0.0.1:7878)
  [3] web     (TS/Vite)     aggregate to crate/module treemap (d3-hierarchy), lens recolor
```

### [1] analyzer (`analyzer/`)

| File | Responsibility |
|------|----------------|
| `cargo.rs` | `cargo metadata` → workspace member crates + crate-to-crate dependency edges (workspace-internal only) |
| `parse.rs` | Walk each crate's `src/`, parse with `syn`, emit module / type / trait / impl / fn nodes following Rust's `mod.rs` rules |
| `visit.rs` | One `syn::visit::Visit` pass per function body collecting **all** lens metrics at once + called idents |
| `metrics/*.rs` | Pure scoring functions: raw counts → weighted raw score |
| `graph.rs` | Assemble edges, resolve call names, detect cycles (Tarjan SCC via `petgraph`), compute fan-in/out, normalize scores 0..1 |
| `model.rs` | The serde data model — the JSON contract |

The analyzer is deterministic and side-effect free: the timestamp is passed in by the
caller, not read from the clock.

### [2] server (`server/`)

A thin `axum` binary:

- `POST /api/analyze {path?}` → runs the analyzer, returns the `Graph` JSON.
- `GET /api/source?file&start&end` → returns a source line range. **Path traversal is
  blocked** by canonicalizing and requiring the result to stay under the workspace root.
- Everything else → embedded `web/dist` assets via `rust-embed` (SPA fallback to
  `index.html`). The server binds to `127.0.0.1` only.

### [3] web (`web/src/`)

| File | Responsibility |
|------|----------------|
| `schema.ts` | Zod validation of the JSON at the network boundary |
| `aggregate.ts` | Roll functions up to a crate → top-level-module treemap: sum LOC + raw metric counts per tile, normalize scores across tiles, collect crate dependencies |
| `lenses.ts` | **Pure** color helpers + the lens weight formulas (ported from `metrics/*.rs`) — the only file to touch when adding a lens |
| `treemap.tsx` | `d3-hierarchy` treemap layout rendered as SVG: crate regions, module tiles colored by lens, dependency-arrow overlay, click/hover |
| `inspector.tsx`, `controls.tsx`, `App.tsx` | React UI: tile inspector (aggregated metrics, deps, hottest functions), lens switcher, search |

## The JSON contract

`analyzer/src/model.rs` (serde, snake_case) ⇔ `web/src/schema.ts` (Zod). Each node
carries raw metric counts plus a normalized `score` per lens; the frontend owns all
visual interpretation. This is why a new evaluation lens is a one-file frontend change.

## Design decisions

- **Raw metrics in Rust, visuals in TS.** Keeps the analyzer reusable and the lens set
  cheap to extend.
- **One AST pass, four lenses.** `visit.rs` collects every metric in a single walk
  instead of re-traversing per lens.
- **Natural call-resolution filter.** Only workspace-defined functions enter the name
  index, so external calls like `Vec::len()` never create spurious edges; same-name
  collisions prefer the caller's own crate.
