import { useMemo, useState } from "react";
import { crateColor } from "../lenses";
import type { DepKind, Graph } from "../schema";
import { buildDepsScene, NODE_H, NODE_W } from "./depsScene";
import { truncate } from "./format";
import { ZoomPanSvg } from "./ZoomPanSvg";
import type { DepNode, DepsScene } from "./types";

// Deps tab: the resolved crate dependency graph (workspace + external/transitive),
// laid out as a layered DAG (layer = hops from a workspace crate). Kind toggles
// (normal/dev/build), a depth cap, and search/click focus keep a large tree
// navigable. Self-contained 2D SVG view, mirroring ERView.

const ALL_KINDS: DepKind[] = ["normal", "dev", "build"];

const KIND_COLOR: Record<DepKind, string> = {
  normal: "#9aa6b6",
  dev: "#3fb6b6",
  build: "#ffd23f",
};

const DEP_DEFS = (
  <>
    {ALL_KINDS.map((k) => (
      <marker key={k} id={`depArrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill={KIND_COLOR[k]} />
      </marker>
    ))}
  </>
);

export function DepsView({ graph }: { graph: Graph }): JSX.Element {
  const [kinds, setKinds] = useState<ReadonlySet<DepKind>>(() => new Set(ALL_KINDS));
  // Default to a shallow view (large trees can be 800+ crates); the depth control
  // + the "beyond depth" count let the user expand toward the full tree.
  const [maxDepth, setMaxDepth] = useState(3);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const scene = useMemo<DepsScene>(() => buildDepsScene(graph, { kinds, maxDepth }), [graph, kinds, maxDepth]);

  const toggleKind = (k: DepKind): void =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next.size === 0 ? new Set(ALL_KINDS) : next; // never empty
    });

  return (
    <div className="diagram-wrap">
      <DepsSvg scene={scene} selected={selected} query={query} onSelect={(id) => setSelected((cur) => (cur === id ? null : id))} />
      <DepsPanel
        kinds={kinds}
        onToggleKind={toggleKind}
        maxDepth={maxDepth}
        onDepth={setMaxDepth}
        query={query}
        onQuery={setQuery}
        counts={scene.counts}
      />
    </div>
  );
}

interface SvgProps {
  scene: DepsScene;
  selected: string | null;
  query: string;
  onSelect: (id: string) => void;
}

function DepsSvg({ scene, selected, query, onSelect }: SvgProps): JSX.Element {
  const nodeById = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene]);
  const wsNames = useMemo(() => scene.nodes.filter((n) => n.workspace).map((n) => n.name), [scene]);

  if (scene.nodes.length === 0) {
    return (
      <ZoomPanSvg contentW={640} contentH={320} defs={DEP_DEFS}>
        <text x={40} y={56} className="diag-empty">no dependencies for the active kinds</text>
      </ZoomPanSvg>
    );
  }

  // Focus set: the selected node + its direct neighbors (deps + dependents).
  const focus = new Set<string>();
  if (selected) {
    focus.add(selected);
    for (const l of scene.links) {
      if (l.from === selected) focus.add(l.to);
      if (l.to === selected) focus.add(l.from);
    }
  }
  const q = query.trim().toLowerCase();
  const matches = (n: DepNode): boolean => q !== "" && n.name.toLowerCase().includes(q);
  const dimmed = (id: string): boolean => focus.size > 0 && !focus.has(id);

  return (
    <ZoomPanSvg contentW={scene.worldW} contentH={scene.worldH} defs={DEP_DEFS}>
      {/* edges */}
      {scene.links.map((l, i) => {
        const a = nodeById.get(l.from);
        const b = nodeById.get(l.to);
        if (!a || !b) return null;
        const x1 = a.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        const faded = focus.size > 0 && !focus.has(l.from) && !focus.has(l.to);
        return (
          <path
            key={i}
            d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
            fill="none"
            stroke={KIND_COLOR[l.kind]}
            strokeWidth={1}
            strokeDasharray={l.kind === "dev" ? "5 4" : l.kind === "build" ? "2 3" : undefined}
            markerEnd={`url(#depArrow-${l.kind})`}
            opacity={faded ? 0.06 : 0.5}
          />
        );
      })}

      {/* nodes */}
      {scene.nodes.map((n) => {
        const accent = n.workspace ? crateColor(n.name, wsNames) : "#3a4556";
        const border = matches(n) ? "#ffffff" : accent;
        const fill = n.workspace ? "#16202e" : "#0e131c";
        return (
          <g key={n.id} transform={`translate(${n.x} ${n.y})`} onClick={() => onSelect(n.id)} style={{ cursor: "pointer" }} opacity={dimmed(n.id) ? 0.2 : 1}>
            <title>{n.name} v{n.version}{n.workspace ? " · workspace" : ""} · in {n.inCount} / out {n.outCount}</title>
            <rect width={NODE_W} height={NODE_H} rx={5} fill={fill} stroke={border} strokeWidth={matches(n) || n.id === selected ? 2 : 1.2} />
            {n.workspace && <circle cx={9} cy={NODE_H / 2} r={3.5} fill={accent} />}
            <text x={n.workspace ? 18 : 9} y={NODE_H / 2 + 3.5} className="dep-name">{truncate(n.name, 18)}</text>
            <text x={NODE_W - 6} y={NODE_H / 2 + 3.5} className="dep-ver" textAnchor="end">{truncate(n.version, 8)}</text>
          </g>
        );
      })}
    </ZoomPanSvg>
  );
}

interface PanelProps {
  kinds: ReadonlySet<DepKind>;
  onToggleKind: (k: DepKind) => void;
  maxDepth: number;
  onDepth: (d: number) => void;
  query: string;
  onQuery: (s: string) => void;
  counts: DepsScene["counts"];
}

function DepsPanel({ kinds, onToggleKind, maxDepth, onDepth, query, onQuery, counts }: PanelProps): JSX.Element {
  return (
    <div className="dep-panel">
      <div className="dep-panel-h">dependencies</div>
      <div className="dep-counts">
        {counts.crates} crates · {counts.external} external · {counts.edges} edges
        {counts.hidden > 0 && <span className="dep-hidden"> · {counts.hidden} beyond depth</span>}
      </div>
      <div className="dep-kinds">
        {ALL_KINDS.map((k) => (
          <label key={k} className={`dep-kind ${kinds.has(k) ? "active" : ""}`}>
            <input type="checkbox" checked={kinds.has(k)} onChange={() => onToggleKind(k)} />
            <span className="dep-swatch" style={{ background: KIND_COLOR[k] }} />
            {k}
          </label>
        ))}
      </div>
      <div className="dep-depth">
        <span>depth</span>
        <button onClick={() => onDepth(Math.max(1, maxDepth - 1))}>−</button>
        <b>{maxDepth}</b>
        <button onClick={() => onDepth(Math.min(14, maxDepth + 1))}>＋</button>
      </div>
      <input className="dep-search" placeholder="find crate…" value={query} onChange={(e) => onQuery(e.target.value)} />
      <div className="dep-legend-key">
        <span className="dep-ws-dot" /> workspace &nbsp; <span className="dep-ext-dot" /> external
      </div>
    </div>
  );
}
