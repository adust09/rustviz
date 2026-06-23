import { useEffect, useState } from "react";
import { fetchSource } from "./api";
import type { CrateDeps, Tile, TileFn } from "./aggregate";
import type { Lens } from "./schema";

interface InspectorProps {
  tile: Tile | null;
  /** Active metric lens, or `null` for the structural base view. */
  lens: Lens | null;
  crateDeps: Map<string, CrateDeps>;
  onClose: () => void;
}

const METRIC_LENSES: Lens[] = ["security", "performance", "complexity"];

function rawDetail(tile: Tile, lens: Lens): string {
  if (lens === "security") {
    const s = tile.security;
    return `unsafe ${s.unsafe_blocks} · unwrap ${s.unwraps} · expect ${s.expects} · panic ${s.panics} · cast ${s.lossy_casts}`;
  }
  if (lens === "performance") {
    const p = tile.performance;
    return `alloc ${p.allocs} · clone ${p.clones} · nested-loop ${p.nested_loops} · recursion ${p.recursion} · await ${p.async_points}`;
  }
  return `cyclomatic ${tile.cyclomatic} · ${tile.loc} LOC across ${tile.fnCount} fns`;
}

export function Inspector({ tile, lens, crateDeps, onClose }: InspectorProps): JSX.Element | null {
  const [openFn, setOpenFn] = useState<TileFn | null>(null);
  const [source, setSource] = useState<string>("");

  useEffect(() => {
    setOpenFn(null);
    setSource("");
  }, [tile]);

  useEffect(() => {
    if (!openFn) return;
    let cancelled = false;
    fetchSource(openFn.file, openFn.start, openFn.end)
      .then((t) => !cancelled && setSource(t))
      .catch(() => !cancelled && setSource("// source unavailable"));
    return () => {
      cancelled = true;
    };
  }, [openFn]);

  if (!tile) return null;

  const deps = crateDeps.get(tile.crate);
  // Structure view ranks functions by size; a metric lens ranks by its score.
  const sorted = lens
    ? [...tile.fns].sort((a, b) => b.scores[lens] - a.scores[lens])
    : [...tile.fns].sort((a, b) => b.loc - a.loc);
  const topFns = sorted.slice(0, 8);
  const maxFnLoc = Math.max(1, ...tile.fns.map((f) => f.loc));

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div>
          <div className="inspector-name">{tile.name}</div>
          <div className="inspector-id">{tile.crate}</div>
        </div>
        <button className="close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="inspector-sub">
        <span className="badge">{tile.loc} LOC</span>
        <span className="badge">{tile.fnCount} fns</span>
        {tile.inCycle && <span className="badge cycle">in cycle</span>}
      </div>

      <div className="metrics">
        {METRIC_LENSES.map((l) => (
          <div key={l} className={`metric ${l === lens ? "active" : ""}`}>
            <div className="metric-top">
              <span>{l}</span>
              <span>{(tile.score[l] * 100).toFixed(0)}%</span>
            </div>
            <div className="metric-track">
              <div className={`metric-fill ${l}`} style={{ width: `${tile.score[l] * 100}%` }} />
            </div>
            <div className="metric-detail">{rawDetail(tile, l)}</div>
          </div>
        ))}
      </div>

      {deps && (deps.dependsOn.length > 0 || deps.dependedBy.length > 0) && (
        <div className="deps">
          {deps.dependsOn.length > 0 && (
            <div className="dep-row">
              <span className="dep-key">depends on</span> {deps.dependsOn.join(", ")}
            </div>
          )}
          {deps.dependedBy.length > 0 && (
            <div className="dep-row">
              <span className="dep-key">used by</span> {deps.dependedBy.join(", ")}
            </div>
          )}
        </div>
      )}

      <div className="topfns">
        <div className="topfns-head">{lens ? `hottest functions · ${lens}` : "largest functions"}</div>
        {topFns.map((f) => {
          const ratio = lens ? f.scores[lens] : f.loc / maxFnLoc;
          return (
            <div
              key={f.id}
              className={`topfn ${openFn?.id === f.id ? "open" : ""}`}
              onClick={() => setOpenFn(openFn?.id === f.id ? null : f)}
            >
              <span className="topfn-bar" style={{ width: `${Math.max(4, ratio * 100)}%` }} />
              <span className="topfn-name">{f.name}</span>
              <span className="topfn-score">{lens ? `${(f.scores[lens] * 100).toFixed(0)}%` : `${f.loc} LOC`}</span>
            </div>
          );
        })}
      </div>

      {openFn && (
        <div className="source">
          <div className="source-head">
            {openFn.file}:{openFn.start}
          </div>
          <pre>{source || "loading…"}</pre>
        </div>
      )}
    </div>
  );
}
