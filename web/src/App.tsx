import { useEffect, useMemo, useState } from "react";
import { fetchGraph } from "./api";
import { Controls } from "./controls";
import { Inspector } from "./inspector";
import { Treemap } from "./treemap";
import { DiagramView } from "./diagrams/DiagramView";
import { aggregate, type Tile } from "./aggregate";
import { LENSES, type Graph, type Lens } from "./schema";
import type { RenderStyle, ViewMode } from "./diagrams/types";

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
  // Map = the treemap; structure/sequence = the 立体 UML diagrams (one of three
  // render styles). focusNodeId carries a structure-box click into the sequence.
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [renderStyle, setRenderStyle] = useState<RenderStyle>("flat");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  const drillToSequence = (id: string): void => {
    setFocusNodeId(id);
    setViewMode("sequence");
  };

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

      {graph && viewMode !== "map" && (
        <DiagramView
          graph={graph}
          diagramType={viewMode}
          renderStyle={renderStyle}
          focusNodeId={focusNodeId}
          onDrillToSequence={drillToSequence}
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
        renderStyle={renderStyle}
        onSetRenderStyle={setRenderStyle}
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
