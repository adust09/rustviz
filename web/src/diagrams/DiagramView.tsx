import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { fetchSource } from "../api";
import type { Graph } from "../schema";
import { ROLES, buildStructureScene } from "./structureScene";
import { buildSequenceScene } from "./sequenceScene";
import { LayeredRenderer } from "./LayeredRenderer";
import { DetailPanel } from "./DetailPanel";
import type { DiagramScene } from "./types";

// Structure renders in 3D (three.js, heavy) — load it on demand so the Map and
// the 2D sequence view never pay for the WebGL bundle.
const ThreeRenderer = lazy(() => import("./ThreeRenderer"));

interface DiagramViewProps {
  graph: Graph;
  diagramType: "structure" | "sequence";
  focusNodeId: string | null;
  onDrillToSequence: (id: string) => void;
}

interface OpenSource {
  file: string;
  start: number;
  end: number;
}

export function DiagramView({ graph, diagramType, focusNodeId, onDrillToSequence }: DiagramViewProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenSource | null>(null);
  const [source, setSource] = useState<string>("");
  const [seqDepth, setSeqDepth] = useState(2);

  const scene: DiagramScene = useMemo(
    () => (diagramType === "structure" ? buildStructureScene(graph) : buildSequenceScene(graph, focusNodeId, seqDepth)),
    [graph, diagramType, focusNodeId, seqDepth],
  );

  // Clear the selection when the diagram/scene changes.
  useEffect(() => {
    setSelectedId(null);
    setOpen(null);
  }, [scene]);

  // Resolve the selected building (type box) / district (crate) for the detail panel.
  const detail =
    scene.kind === "structure" && selectedId
      ? { box: scene.boxes.find((b) => b.id === selectedId) ?? null, crate: scene.crates.find((c) => c.name === selectedId) ?? null }
      : { box: null, crate: null };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchSource(open.file, open.start, open.end)
      .then((t) => !cancelled && setSource(t))
      .catch(() => !cancelled && setSource("// source unavailable"));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const onOpenSource = (file: string, start: number, end: number): void => setOpen({ file, start, end });
  const common = { scene, selectedId, onSelect: setSelectedId, onOpenSource, onDrillToSequence };

  // Structure renders in 3D; sequence renders in 2D (flat SVG).
  const body =
    diagramType === "structure" ? (
      <Suspense fallback={<div className="diagram-placeholder"><p>loading…</p></div>}>
        <ThreeRenderer {...common} />
      </Suspense>
    ) : (
      <LayeredRenderer {...common} />
    );

  return (
    <div className="diagram-wrap">
      {body}
      {scene.kind === "sequence" && (
        <SequenceRootPicker graph={graph} currentTitle={scene.rootTitle} onPick={onDrillToSequence} depth={seqDepth} onDepth={setSeqDepth} count={scene.callCount} truncated={scene.truncated} />
      )}
      {scene.kind === "structure" && <StructureLegend present={new Set(scene.regions.map((r) => r.title))} />}
      <DetailPanel box={detail.box} crate={detail.crate} onClose={() => setSelectedId(null)} onOpenSource={onOpenSource} />
      {open && (
        <div className="diagram-source">
          <div className="source-head">
            {open.file}:{open.start}
            <button className="close" onClick={() => setOpen(null)}>
              ✕
            </button>
          </div>
          <pre>{source || "loading…"}</pre>
        </div>
      )}
    </div>
  );
}

// Pick which function to trace, so the sequence is scoped to one scenario
// instead of the whole program from main. Suggests entry points + the
// highest-fan-out functions (orchestrators); searchable across all functions.
function shortId(id: string): string {
  return id.split("::").slice(-2).join("::");
}

function SequenceRootPicker(props: { graph: Graph; currentTitle: string; onPick: (id: string) => void; depth: number; onDepth: (d: number) => void; count: number; truncated: boolean }): JSX.Element {
  const { graph, currentTitle, onPick, depth, onDepth, count, truncated } = props;
  const [q, setQ] = useState("");
  const fns = useMemo(() => graph.nodes.filter((n) => n.kind === "fn"), [graph]);
  const entries = useMemo(() => new Set(graph.entrypoints), [graph]);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query) return fns.filter((n) => n.id.toLowerCase().includes(query)).slice(0, 25);
    // Empty query: entry points first, then the biggest orchestrators.
    const byFanOut = [...fns].sort((a, b) => b.metrics.architecture.fan_out - a.metrics.architecture.fan_out);
    const seen = new Set<string>();
    const out = [...fns.filter((n) => entries.has(n.id)), ...byFanOut].filter((n) => (seen.has(n.id) ? false : seen.add(n.id)));
    return out.slice(0, 15);
  }, [q, fns, entries]);

  return (
    <div className="seqroot">
      <div className="seqroot-cur">trace root · <b>{currentTitle}</b></div>
      <div className="seqroot-depth">
        <span>depth</span>
        <button onClick={() => onDepth(Math.max(1, depth - 1))}>−</button>
        <b>{depth}</b>
        <button onClick={() => onDepth(Math.min(8, depth + 1))}>＋</button>
        <span className="seqroot-count">{count} calls{truncated ? "+ (capped)" : ""}</span>
      </div>
      <input className="seqroot-search" placeholder="trace from… (function)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="seqroot-list">
        {results.map((n) => (
          <div key={n.id} className="seqroot-item" onClick={() => onPick(n.id)} title={n.id}>
            <span className="seqroot-name">{shortId(n.id)}</span>
            {entries.has(n.id) && <span className="seqroot-tag">entry</span>}
            <span className="seqroot-fan">→{n.metrics.architecture.fan_out}</span>
          </div>
        ))}
        {results.length === 0 && <div className="seqroot-empty">no match</div>}
      </div>
    </div>
  );
}

// Explains how to read the 3D city: what the role zones (X) classify, and what
// the other channels (elevation / height / colour) encode.
function StructureLegend({ present }: { present: Set<string> }): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <div className={`legend ${open ? "open" : ""}`}>
      <button className="legend-h" onClick={() => setOpen((v) => !v)}>
        how to read {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="legend-body">
          <div className="legend-axis">Zones (left → right) = type role</div>
          {ROLES.filter((r) => present.has(r.title)).map((r) => (
            <div key={r.key} className="legend-zone">
              <b>{r.title}</b> — {r.hint}
            </div>
          ))}
          <div className="legend-axis">Other channels</div>
          <div className="legend-zone">elevation = dependency layer (foundation → top)</div>
          <div className="legend-zone">building height = member count</div>
          <div className="legend-zone">colour = crate · click a building for details</div>
        </div>
      )}
    </div>
  );
}
