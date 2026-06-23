import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { fetchSource } from "../api";
import type { Graph } from "../schema";
import { buildStructureScene } from "./structureScene";
import { buildSequenceScene } from "./sequenceScene";
import { LayeredRenderer } from "./LayeredRenderer";
import { IsometricRenderer } from "./IsometricRenderer";
import type { DiagramScene, RenderStyle } from "./types";

// three.js is heavy and only the 3D style needs it — load it on demand so the
// Map / 2D / 2.5D users never pay for the WebGL bundle.
const ThreeRenderer = lazy(() => import("./ThreeRenderer"));

interface DiagramViewProps {
  graph: Graph;
  diagramType: "structure" | "sequence";
  renderStyle: RenderStyle;
  focusNodeId: string | null;
  onDrillToSequence: (id: string) => void;
}

interface OpenSource {
  file: string;
  start: number;
  end: number;
}

export function DiagramView({ graph, diagramType, renderStyle, focusNodeId, onDrillToSequence }: DiagramViewProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenSource | null>(null);
  const [source, setSource] = useState<string>("");

  const scene: DiagramScene = useMemo(
    () => (diagramType === "structure" ? buildStructureScene(graph) : buildSequenceScene(graph, focusNodeId)),
    [graph, diagramType, focusNodeId],
  );

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

  return (
    <div className="diagram-wrap">
      {renderStyle === "flat" && (
        <LayeredRenderer scene={scene} selectedId={selectedId} onSelect={setSelectedId} onOpenSource={onOpenSource} onDrillToSequence={onDrillToSequence} />
      )}
      {renderStyle === "iso" && (
        <IsometricRenderer scene={scene} selectedId={selectedId} onSelect={setSelectedId} onOpenSource={onOpenSource} onDrillToSequence={onDrillToSequence} />
      )}
      {renderStyle === "3d" && (
        <Suspense fallback={<div className="diagram-placeholder"><p>loading 3D…</p></div>}>
          <ThreeRenderer scene={scene} selectedId={selectedId} onSelect={setSelectedId} onOpenSource={onOpenSource} onDrillToSequence={onDrillToSequence} />
        </Suspense>
      )}
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
