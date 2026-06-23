import type { Graph, Lens } from "./schema";

interface ControlsProps {
  meta: Graph["meta"] | null;
  lens: Lens;
  lenses: readonly Lens[];
  onLens: (l: Lens) => void;
  entrypoints: string[];
  entrypoint: string;
  onEntrypoint: (s: string) => void;
  playing: boolean;
  stepIdx: number;
  stepCount: number;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onScrub: (i: number) => void;
  search: string;
  onSearch: (s: string) => void;
  onSearchSubmit: () => void;
}

const LENS_HINT: Record<Lens, string> = {
  architecture: "modules · deps · cycles",
  security: "unsafe · unwrap · casts",
  performance: "alloc · clone · loops",
  complexity: "cyclomatic · nesting",
};

export function Controls(props: ControlsProps): JSX.Element {
  const {
    meta,
    lens,
    lenses,
    onLens,
    entrypoints,
    entrypoint,
    onEntrypoint,
    playing,
    stepIdx,
    stepCount,
    onPlay,
    onPause,
    onReset,
    onScrub,
    search,
    onSearch,
    onSearchSubmit,
  } = props;

  const analyzed = meta ? new Date(Number(meta.analyzed_at)).toLocaleTimeString() : "";

  return (
    <div className="controls">
      <div className="controls-row">
        <div className="lens-group">
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

        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            onSearchSubmit();
          }}
        >
          <input
            placeholder="find symbol…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
        </form>
      </div>

      <div className="controls-row transport">
        <span className="sim-label">static call-flow</span>
        <select value={entrypoint} onChange={(e) => onEntrypoint(e.target.value)}>
          {entrypoints.map((ep) => (
            <option key={ep} value={ep}>
              {ep}
            </option>
          ))}
        </select>
        {playing ? (
          <button className="transport-btn" onClick={onPause}>
            ⏸
          </button>
        ) : (
          <button className="transport-btn" onClick={onPlay}>
            ▶
          </button>
        )}
        <button className="transport-btn" onClick={onReset}>
          ⟲
        </button>
        <input
          className="scrubber"
          type="range"
          min={0}
          max={Math.max(0, stepCount - 1)}
          value={stepIdx}
          onChange={(e) => onScrub(Number(e.target.value))}
        />
        <span className="step-count">
          {stepCount > 0 ? `${stepIdx + 1}/${stepCount}` : "0/0"}
        </span>
      </div>

      {meta && (
        <div className="meta">
          {meta.crate_count} crates · {meta.file_count} files · {meta.total_loc} LOC ·
          analyzed {analyzed}
        </div>
      )}
    </div>
  );
}
