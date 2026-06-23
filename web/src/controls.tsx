import type { Graph, Lens } from "./schema";
import { HEAT_HIGH, HEAT_LOW, HEAT_MID } from "./lenses";
import type { RenderStyle, ViewMode } from "./diagrams/types";

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
  viewMode: ViewMode;
  onSetViewMode: (v: ViewMode) => void;
  renderStyle: RenderStyle;
  onSetRenderStyle: (r: RenderStyle) => void;
}

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "structure", label: "Structure" },
  { id: "sequence", label: "Sequence" },
];

const RENDER_STYLES: { id: RenderStyle; label: string }[] = [
  { id: "flat", label: "2D" },
  { id: "iso", label: "2.5D" },
  { id: "3d", label: "3D" },
];

const LENS_HINT: Record<Lens, string> = {
  security: "unsafe · unwrap · casts",
  performance: "alloc · clone · loops",
  complexity: "cyclomatic · nesting",
};

const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_LOW}, ${HEAT_MID}, ${HEAT_HIGH})`;

export function Controls(props: ControlsProps): JSX.Element {
  const { meta, active, lenses, onToggleLens, search, onSearch, onSearchSubmit, showDeps, onToggleDeps } = props;
  const { viewMode, onSetViewMode, renderStyle, onSetRenderStyle } = props;

  const hasLens = active.size > 0;
  const colorLabel = hasLens ? [...lenses].filter((l) => active.has(l)).join(" + ") : "crate";
  const isMap = viewMode === "map";

  return (
    <div className="controls">
      <div className="controls-row">
        <div className="seg" role="group" aria-label="view">
          {VIEW_MODES.map((v) => (
            <button
              key={v.id}
              className={`seg-btn ${viewMode === v.id ? "active" : ""}`}
              onClick={() => onSetViewMode(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        {!isMap && (
          <div className="seg" role="group" aria-label="render style" title="Render style">
            {RENDER_STYLES.map((r) => (
              <button
                key={r.id}
                className={`seg-btn ${renderStyle === r.id ? "active" : ""}`}
                onClick={() => onSetRenderStyle(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        {isMap && (
          <>
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
          </>
        )}
      </div>

      <div className="controls-foot">
        {meta && isMap && (
          <div className="meta">
            {meta.crate_count} crates · {meta.file_count} files · {meta.total_loc} LOC · tile area = LOC · color ={" "}
            {colorLabel}
          </div>
        )}
        {meta && !isMap && (
          <div className="meta">
            {viewMode} · {renderStyle} · {meta.crate_count} crates · {meta.total_loc} LOC
          </div>
        )}
        {hasLens && isMap && (
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
