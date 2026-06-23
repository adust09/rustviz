import type { Graph, Lens } from "./schema";

interface ControlsProps {
  meta: Graph["meta"] | null;
  lens: Lens | null;
  lenses: readonly Lens[];
  onLens: (l: Lens | null) => void;
  search: string;
  onSearch: (s: string) => void;
  onSearchSubmit: () => void;
  showDeps: boolean;
  onToggleDeps: () => void;
}

const LENS_HINT: Record<Lens, string> = {
  security: "unsafe · unwrap · casts",
  performance: "alloc · clone · loops",
  complexity: "cyclomatic · LOC",
};

export function Controls(props: ControlsProps): JSX.Element {
  const { meta, lens, lenses, onLens, search, onSearch, onSearchSubmit, showDeps, onToggleDeps } = props;

  return (
    <div className="controls">
      <div className="controls-row">
        <div className="lens-group">
          {/* Structural base view: per-crate coloring, not a metric. */}
          <button
            className={`lens-btn structure ${lens === null ? "active" : ""}`}
            onClick={() => onLens(null)}
            title="Color tiles by crate — the structural base view"
          >
            <span className="lens-name">structure</span>
            <span className="lens-hint">crates · deps</span>
          </button>

          {lenses.map((l) => (
            <button
              key={l}
              className={`lens-btn ${l === lens ? "active" : ""}`}
              onClick={() => onLens(l)}
              title={LENS_HINT[l]}
            >
              <span className="lens-name">{l}</span>
              <span className="lens-hint">{LENS_HINT[l]}</span>
            </button>
          ))}
        </div>

        <button
          className={`deps-toggle ${showDeps ? "active" : ""}`}
          onClick={onToggleDeps}
          title="Overlay crate dependency arrows"
        >
          ⇄ deps
        </button>

        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit();
          }}
        >
          <input placeholder="find module…" value={search} onChange={(e) => onSearch(e.target.value)} />
        </form>
      </div>

      {meta && (
        <div className="meta">
          {meta.crate_count} crates · {meta.file_count} files · {meta.total_loc} LOC · tile area = LOC · color ={" "}
          {lens ?? "crate"}
        </div>
      )}
    </div>
  );
}
