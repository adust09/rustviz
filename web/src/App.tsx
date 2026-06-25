import { useEffect, useMemo, useState } from "react";
import { fetchGraph } from "./api";
import { Controls } from "./controls";
import { Inspector } from "./inspector";
import { Treemap } from "./treemap";
import { DiagramView } from "./diagrams/DiagramView";
import { ERView } from "./diagrams/ERView";
import { DepsView } from "./diagrams/DepsView";
import { TestView } from "./TestView";
import { aggregate, type Tile } from "./aggregate";
import { LENSES, type Graph, type Lens } from "./schema";
import { getCachedTests, runTests, getCachedCoverage, runCoverage } from "./api";
import type { TestRun } from "./testRun";
import type { CoverageReport } from "./coverage";
import type { ViewMode } from "./diagrams/types";

const EMPTY_DEPS = new Map();

export function App(): JSX.Element {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string>("");
  // Empty set = structural base (per-crate coloring). Toggling any subset of the
  // metric lenses layers them as an RGB channel mix over that base.
  const [active, setActive] = useState<ReadonlySet<Lens>>(() => new Set());
  const [selected, setSelected] = useState<Tile | null>(null);
  const [search, setSearch] = useState<string>("");
  const [showDeps, setShowDeps] = useState<boolean>(false);
  // Map = the treemap; structure = the 3D city; sequence = the 2D diagram.
  // focusNodeId carries a drill into the sequence's root.
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  // Test results are cached so switching tabs doesn't re-run the (slow) suite.
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [testLoading, setTestLoading] = useState<boolean>(false);
  const [testError, setTestError] = useState<string | null>(null);
  // Coverage is expensive (instrumented rebuild) — never auto-run, only cached.
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [covLoading, setCovLoading] = useState<boolean>(false);
  const [covError, setCovError] = useState<string | null>(null);

  const drillToSequence = (id: string): void => {
    setFocusNodeId(id);
    setViewMode("sequence");
  };

  // Explicit run (the re-run button) — always runs cargo test.
  const onRunTests = (): void => {
    setTestLoading(true);
    setTestError(null);
    runTests()
      .then(setTestRun)
      .catch((e: unknown) => setTestError(e instanceof Error ? e.message : String(e)))
      .finally(() => setTestLoading(false));
  };

  // Explicit run (the measure button) — always runs cargo llvm-cov.
  const onRunCoverage = (): void => {
    setCovLoading(true);
    setCovError(null);
    runCoverage()
      .then(setCoverage)
      .catch((e: unknown) => setCovError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCovLoading(false));
  };

  // On opening the Test tab: show the server's cached results if any (so a
  // reload doesn't re-run); only run when there's nothing cached yet.
  useEffect(() => {
    if (viewMode !== "test" || testRun || testLoading) return;
    setTestLoading(true);
    setTestError(null);
    getCachedTests()
      .then((cached) => cached ?? runTests())
      .then(setTestRun)
      .catch((e: unknown) => setTestError(e instanceof Error ? e.message : String(e)))
      .finally(() => setTestLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Coverage: only read the cache on open (it's expensive — never auto-measure).
  useEffect(() => {
    if (viewMode !== "test" || coverage || covLoading) return;
    getCachedCoverage()
      .then((cached) => cached && setCoverage(cached))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const toggleLens = (l: Lens): void =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });

  useEffect(() => {
    fetchGraph()
      .then(setGraph)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const agg = useMemo(() => (graph ? aggregate(graph) : null), [graph]);

  const onSearchSubmit = (): void => {
    if (!agg || !search) return;
    const q = search.toLowerCase();
    const hit =
      agg.tiles.find((t) => t.name.toLowerCase() === q) ??
      agg.tiles.find((t) => t.crate.toLowerCase() === q) ??
      agg.tiles.find((t) => t.id.toLowerCase().includes(q)) ??
      agg.tiles.find((t) => t.name.toLowerCase().includes(q));
    if (hit) setSelected(hit);
  };

  return (
    <div className="app">
      <header className="brand">
        <span className="logo">◈ RustViz</span>
        <span className="tagline">architecture overview</span>
      </header>

      {error && <div className="error">⚠ {error}</div>}
      {!agg && !error && <div className="loading">analyzing…</div>}

      {agg && viewMode === "map" && (
        <Treemap
          agg={agg}
          active={active}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          showDeps={showDeps}
        />
      )}

      {graph && (viewMode === "structure" || viewMode === "sequence") && (
        <DiagramView
          graph={graph}
          diagramType={viewMode}
          focusNodeId={focusNodeId}
          onDrillToSequence={drillToSequence}
        />
      )}

      {graph && viewMode === "er" && <ERView graph={graph} />}

      {graph && viewMode === "deps" && <DepsView graph={graph} />}

      {viewMode === "test" && (
        <TestView
          run={testRun}
          loading={testLoading}
          error={testError}
          onRun={onRunTests}
          graph={graph}
          coverage={coverage}
          covLoading={covLoading}
          covError={covError}
          onRunCoverage={onRunCoverage}
        />
      )}

      <Controls
        meta={graph?.meta ?? null}
        active={active}
        lenses={LENSES}
        onToggleLens={toggleLens}
        search={search}
        onSearch={setSearch}
        onSearchSubmit={onSearchSubmit}
        showDeps={showDeps}
        onToggleDeps={() => setShowDeps((v) => !v)}
        viewMode={viewMode}
        onSetViewMode={setViewMode}
      />

      {viewMode === "map" && (
        <Inspector
          tile={selected}
          active={active}
          crateDeps={agg?.crateDeps ?? EMPTY_DEPS}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
