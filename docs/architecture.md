---
title: RustViz Architecture
last_updated: 2026-06-25
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
  [3] web     (TS/Vite)     treemap (d3-hierarchy) + UML structure/sequence diagrams (SVG / three.js)
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
- `POST /api/tests` → runs `cargo test` in the project and returns a parsed `TestRun`
  (`server/src/tests.rs`). **This is the one place the server executes project code** — the
  analyzer crate stays deterministic and never runs anything.
- Everything else → embedded `web/dist` assets via `rust-embed` (SPA fallback to
  `index.html`). The server binds to `127.0.0.1` only.

### [3] web (`web/src/`)

| File | Responsibility |
|------|----------------|
| `schema.ts` | Zod validation of the JSON at the network boundary |
| `aggregate.ts` | Roll functions up to a crate → top-level-module treemap: sum LOC + raw metric counts per tile, normalize scores across tiles, collect crate dependencies |
| `lenses.ts` | **Pure** color helpers + the lens weight formulas (ported from `metrics/*.rs`) — the only file to touch when adding a lens |
| `treemap.tsx` | `d3-hierarchy` treemap layout rendered as SVG: crate regions, module tiles colored by lens, dependency-arrow overlay, click/hover |
| `diagrams/` | Structure + Sequence. **Scene builders** (`structureScene.ts`, `sequenceScene.ts`) turn the Graph into render-agnostic geometry; **Structure** renders in 3D (`ThreeRenderer.tsx`, three.js/WebGL — lazy-loaded — a role-zoned code city), **Sequence** in 2D (`LayeredRenderer.tsx`, flat SVG). `DiagramView.tsx` builds the scene and picks the renderer; `ZoomPanSvg.tsx` adds pan/zoom |
| `TestView.tsx`, `testRun.ts` | The Test tab: `POST /api/tests` → dashboard grouping results by kind (unit / integration·E2E / doc, by location) → suite → test, with pass/fail/ignored + failure messages |
| `inspector.tsx`, `controls.tsx`, `App.tsx` | React UI: tile inspector, lens switcher, search, and the four-tab switch (Map / Structure / Sequence / Test) |

The diagram layer reuses the same seam as the lenses: the **scene** (what to show — boxes, lifelines, edges, positions) is computed once, and the **render style** (how to draw it — SVG vs WebGL) is pluggable. Structure and sequence diagrams need richer data than the treemap, so the JSON contract carries per-node UML detail (`visibility`, `signature`, `fields`, `variants`) and `call_steps` (ordered, resolved fn→fn calls).

## The JSON contract

`analyzer/src/model.rs` (serde, snake_case) ⇔ `web/src/schema.ts` (Zod). Each node
carries raw metric counts plus a normalized `score` per lens; the frontend owns all
visual interpretation. This is why a new evaluation lens is a one-file frontend change.

## Design decisions

- **Raw metrics in Rust, visuals in TS.** Keeps the analyzer reusable and the lens set
  cheap to extend.
- **One AST pass, four metric families.** `visit.rs` collects every metric in a single
  walk instead of re-traversing per metric. The frontend exposes three of them as heat
  lenses (security, performance, complexity); architecture coupling (`fan_in`/`fan_out`,
  `in_cycle`) instead drives the per-crate **structural base view** and cycle highlighting,
  not a heat ramp.
- **Natural call-resolution filter.** Only workspace-defined functions enter the name
  index, so external calls like `Vec::len()` never create spurious edges; same-name
  collisions prefer the caller's own crate.
