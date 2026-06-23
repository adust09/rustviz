import type { Graph, Lens } from "./schema";
import { CHANNEL_COLOR } from "./lenses";

interface ControlsProps {
  meta: Graph["meta"] | null;
  active: ReadonlySet<Lens>;
  lenses: readonly Lens[];
  onToggleLens: (l: Lens) => void;
  onClearLenses: () => void;
  search: string;
  onSearch: (s: string) => void;
  onSearchSubmit: () => void;
  showDeps: boolean;
  onToggleDeps: () => void;
}

const LENS_HINT: Record<Lens, string> = {
  security: "unsafe · unwrap · casts",
  performance: "alloc · clone · loops",
  complexity: "cyclomatic · nesting",
};

const CHANNEL_LABEL: Record<Lens, string> = {
  security: "R",
  performance: "G",
  complexity: "B",
};

export function Controls(props: ControlsProps): JSX.Element {
  const { meta, active, lenses, onToggleLens, onClearLenses, search, onSearch, onSearchSubmit, showDeps, onToggleDeps } =
    props;

  const colorLabel = active.size === 0 ? "crate" : [...lenses].filter((l) => active.has(l)).join(" + ");

  return (
    <div className="controls">
      <div className="controls-row">
        <div className="lens-group">
          {/* Structural base view: per-crate coloring. Clears every metric layer. */}
          <button
            className={`lens-btn structure ${active.size === 0 ? "active" : ""}`}
            onClick={onClearLenses}
            title="Color tiles by crate — the structural base view"
          >
            <span className="lens-name">structure</span>
            <span className="lens-hint">crates · deps</span>
          </button>

          {/* Metric lenses: check any subset; colors mix as RGB channels. */}
          {lenses.map((l) => (
            <label
              key={l}
              className={`lens-check ${active.has(l) ? "active" : ""}`}
              title={`${LENS_HINT[l]} — ${CHANNEL_LABEL[l]} channel`}
            >
              <input
                type="checkbox"
                checked={active.has(l)}
                onChange={() => onToggleLens(l)}
                style={{ accentColor: CHANNEL_COLOR[l] }}
              />
              <span className="lens-check-text">
                <span className="lens-name">
                  <span className="lens-dot" style={{ background: CHANNEL_COLOR[l] }} />
                  {l}
                </span>
                <span className="lens-hint">{LENS_HINT[l]}</span>
              </span>
            </label>
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
          {colorLabel}
        </div>
      )}
    </div>
  );
}
