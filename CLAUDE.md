# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

RustViz analyzes any Rust project and renders an **architecture-at-a-glance treemap** (crates → modules, tile area = LOC, color = crate for the structural base view or one of three metric lenses) in the browser. See `README.md` for the user-facing feature tour and `docs/architecture.md` for the full layer breakdown.

## Commands

```bash
# Build the embedded UI bundle FIRST — the server embeds web/dist at compile time.
cd web && npm install && npm run build && cd ..

# Run the analyzer + server against a target project (binary is named `rustviz`).
cargo run --release -p rustviz-server -- /path/to/project
cargo run -p rustviz-server -- /path/to/project --no-open   # API only on :7878
cargo run -p rustviz-server -- /path/to/project --dump      # print analysis JSON, no server
cargo run -p rustviz-server -- /path/to/project --port 9000

# Frontend dev (Vite + HMR on :5173, proxies API to the running server on :7878).
cd web && npm run dev

# Tests / typecheck.
cargo test -p rustviz-analyzer            # all analyzer tests
cargo test -p rustviz-analyzer analyze    # single test by name filter
cd web && npm run build                   # `tsc -b && vite build` — typechecks the frontend
```

The frontend has no test runner — `npm run build` (which runs `tsc -b`) is the only TS check.

## Architecture

Three loosely-coupled layers joined by **one JSON contract**. The Rust side knows nothing about colors; the TS side knows nothing about `syn`.

```
analyzer (Rust lib `rustviz_analyzer`)  cargo_metadata + syn AST walk → Graph (raw metrics + normalized scores)
  ↓ serde_json
server   (Rust bin `rustviz`)           axum: POST /api/analyze, GET /api/source, embedded web/dist (rust-embed)
  ↓ HTTP 127.0.0.1:7878
web      (TS/Vite/React)                aggregate to crate/module treemap (d3-hierarchy), recolor per lens
```

- **analyzer/** — `cargo.rs` (workspace members + internal dep edges) → `parse.rs` (`syn` walk, `mod.rs` resolution) → `visit.rs` (one `syn::visit::Visit` pass collecting **all four lenses' metrics at once**) → `metrics/*.rs` (pure raw-score functions) → `graph.rs` (call resolution, Tarjan SCC cycle detection via `petgraph`, fan-in/out, score normalization 0..1). `analyze()` takes the timestamp as an argument — the analyzer is deterministic and never reads the clock.
- **server/** — thin axum binary. `/api/source` is path-traversal-guarded by canonicalizing under the workspace root (see `read_source` in `server/src/main.rs`); the server binds `127.0.0.1` only.
- **web/src/** — `schema.ts` (Zod validation at the network boundary) → `aggregate.ts` (roll functions up to crate→top-level-module tiles, normalize across tiles) → `treemap.tsx` (SVG d3-hierarchy layout + dependency overlay) → `inspector.tsx`/`controls.tsx`/`App.tsx`.

## Critical cross-file invariants

These couplings are not discoverable from a single file — break one and the build stays green while the visualization goes wrong.

1. **The JSON contract is dual-maintained.** `analyzer/src/model.rs` (serde, `snake_case`, note `#[serde(rename = "crate")]` for `krate`) must stay in sync with `web/src/schema.ts` (Zod). Any field change touches both.
2. **Lens weight formulas are duplicated and MUST match.** `analyzer/src/metrics/{security,performance,complexity}.rs` and `web/src/lenses.ts` (`securityRaw`/`performanceRaw`/`complexityRaw`) carry the same weighted formulas. The analyzer uses them for per-fn scores; the frontend re-applies them when aggregating tiles. Changing a weight in one place without the other silently desyncs tile color from inspector detail.
3. **Adding a new lens** is intended as a frontend-only change in `web/src/lenses.ts` (plus the metric raw counts in `model.rs`/`schema.ts` if new inputs are needed) — keep visual mapping out of the analyzer.
4. **Build order matters.** `server/build.rs` creates an empty `web/dist` so `cargo build` succeeds before the frontend is built, but the server then embeds zero assets and serves a "frontend not built" message. Always `npm run build` in `web/` before a release run.

## Conventions

- Edition 2021 Rust workspace (`analyzer`, `server`); release profile uses `lto = "thin"`.
- Frontend: React 18 + Zod + d3-hierarchy, plain SVG (no WebGL/three despite older "3D" naming in some comments/CLI help text).
- Cycle/crate edges are a name-based syntactic approximation (`syn` is a parser, not a name resolver); only workspace-defined functions enter the call-resolution index, so external calls never create spurious edges.
