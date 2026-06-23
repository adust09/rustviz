import { useEffect, useMemo, useState } from "react";
import { fetchSource } from "../api";
import type { Graph } from "../schema";
import { buildStructureScene } from "./structureScene";
import { buildSequenceScene } from "./sequenceScene";
import type { DiagramScene, RenderStyle } from "./types";

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
      <Placeholder scene={scene} renderStyle={renderStyle} onSelect={setSelectedId} selectedId={selectedId} onDrillToSequence={onDrillToSequence} onOpenSource={onOpenSource} />
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

// Temporary text summary until the flat / iso / 3d renderers land. Confirms the
// scene builders produce sensible geometry and that view switching is wired.
function Placeholder(props: {
  scene: DiagramScene;
  renderStyle: RenderStyle;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDrillToSequence: (id: string) => void;
  onOpenSource: (file: string, start: number, end: number) => void;
}): JSX.Element {
  const { scene, renderStyle } = props;
  if (scene.kind === "structure") {
    return (
      <div className="diagram-placeholder">
        <p>
          structure · {renderStyle} — {scene.boxes.length} boxes, {scene.crateSlabs.length} crates, {scene.edges.length} edges
        </p>
        <ul>
          {scene.boxes.slice(0, 30).map((b) => (
            <li key={b.id} onClick={() => props.onDrillToSequence(b.id)} style={{ cursor: "pointer" }}>
              {b.title} · {b.fields.length + b.variants.length} attrs · {b.ops.length} ops
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="diagram-placeholder">
      <p>
        sequence · {renderStyle} — root {scene.rootTitle}, {scene.lifelines.length} participants, {scene.messages.length} messages
      </p>
      <ol>
        {scene.messages.slice(0, 40).map((m) => (
          <li key={m.row}>
            {"› ".repeat(m.depth)}
            {m.fromId.split("::").slice(-1)} → {m.label}
            {m.selfCall ? " (self)" : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}
