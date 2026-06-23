import { useEffect, useMemo, useState } from "react";
import { fetchGraph } from "./api";
import { Controls } from "./controls";
import { Inspector } from "./inspector";
import { Treemap } from "./treemap";
import { aggregate, type Tile } from "./aggregate";
import { LENSES, type Graph, type Lens } from "./schema";

const EMPTY_DEPS = new Map();

export function App(): JSX.Element {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string>("");
  // `null` = structural base view (per-crate coloring); a Lens = metric heatmap.
  const [lens, setLens] = useState<Lens | null>(null);
  const [selected, setSelected] = useState<Tile | null>(null);
  const [search, setSearch] = useState<string>("");
  const [showDeps, setShowDeps] = useState<boolean>(false);

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

      {agg && (
        <Treemap
          agg={agg}
          lens={lens}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          showDeps={showDeps}
        />
      )}

      <Controls
        meta={graph?.meta ?? null}
        lens={lens}
        lenses={LENSES}
        onLens={setLens}
        search={search}
        onSearch={setSearch}
        onSearchSubmit={onSearchSubmit}
        showDeps={showDeps}
        onToggleDeps={() => setShowDeps((v) => !v)}
      />

      <Inspector
        tile={selected}
        lens={lens}
        crateDeps={agg?.crateDeps ?? EMPTY_DEPS}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
