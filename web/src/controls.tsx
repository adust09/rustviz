import type { Graph, Lens } from "./schema";
import { HEAT_HIGH, HEAT_LOW, HEAT_MID } from "./lenses";

interface ControlsProps {
  meta: Graph["meta"] | null;
  active: ReadonlySet<Lens>;
  lenses: readonly Lens[];
  onToggleLens: (l: Lens) => void;
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

const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_LOW}, ${HEAT_MID}, ${HEAT_HIGH})`;

export function Controls(props: ControlsProps): JSX.Element {
  const { meta, active, lenses, onToggleLens, search, onSearch, onSearchSubmit, showDeps, onToggleDeps } = props;

  const hasLens = active.size > 0;
  const colorLabel = hasLens ? [...lenses].filter((l) => active.has(l)).join(" + ") : "crate";

  return (
    <div className="controls">
      <div className="controls-row">
        <div className="lens-group">
          {/* No lens checked = structural base (per-crate coloring). Checking any
              subset overlays the heatmap; the meta line reflects the active color. */}
          {lenses.map((l) => (
            <label
              key={l}
              className={`lens-check ${active.has(l) ? "active" : ""}`}
              title={LENS_HINT[l]}
            >
              <input type="checkbox" checked={active.has(l)} onChange={() => onToggleLens(l)} />
              <span className="lens-check-text">
                <span className="lens-name">{l}</span>
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

      <div className="controls-foot">
        {meta && (
          <div className="meta">
            {meta.crate_count} crates · {meta.file_count} files · {meta.total_loc} LOC · tile area = LOC · color ={" "}
            {colorLabel}
          </div>
        )}
        {hasLens && (
          <div className="heat-legend" title="Average score of the checked lenses">
            <span>low</span>
            <span className="heat-bar" style={{ background: HEAT_GRADIENT }} />
            <span>high</span>
          </div>
        )}
      </div>
    </div>
  );
}
