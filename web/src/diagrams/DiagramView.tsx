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

  const scene: DiagramScene = useMemo(
    () => (diagramType === "structure" ? buildStructureScene(graph) : buildSequenceScene(graph, focusNodeId)),
    [graph, diagramType, focusNodeId],
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
