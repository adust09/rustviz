import { useEffect, useRef, useState } from "react";
import { fetchGraph } from "./api";
import { Controls } from "./controls";
import { GraphView } from "./graph3d";
import { Inspector } from "./inspector";
import { buildAdjacency, buildSteps, type SimStep } from "./simulation";
import { LENSES, type Graph, type GraphNode, type Lens } from "./schema";

export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<GraphView | null>(null);

  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string>("");
  const [lens, setLens] = useState<Lens>("architecture");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [entrypoint, setEntrypoint] = useState<string>("");
  const [steps, setSteps] = useState<SimStep[]>([]);
  const [stepIdx, setStepIdx] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");

  // Create the 3D view once the container is mounted.
  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;
    viewRef.current = new GraphView(containerRef.current, (n) => setSelected(n));
  }, []);

  // Initial analysis.
  useEffect(() => {
    fetchGraph()
      .then(setGraph)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Push graph data + default entry point when analysis arrives.
  useEffect(() => {
    if (!graph || !viewRef.current) return;
    viewRef.current.setData(graph);
    viewRef.current.setLens(lens);
    if (graph.entrypoints.length > 0) setEntrypoint(graph.entrypoints[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    viewRef.current?.setLens(lens);
  }, [lens]);

  // Apply the current simulation step to the view (highlight + call pulse).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (steps.length === 0) {
      view.exitSim();
      return;
    }
    const step = steps[stepIdx];
    if (!step) return;
    const active = new Set(steps.slice(0, stepIdx + 1).map((s) => s.node));
    view.setSim(active, step.node);
    view.emitCall(step.from, step.node);
  }, [steps, stepIdx]);

  // Auto-advance while playing.
  useEffect(() => {
    if (!playing || steps.length === 0) return;
    const id = window.setInterval(() => {
      setStepIdx((i) => {
        if (i + 1 >= steps.length) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 480);
    return () => window.clearInterval(id);
  }, [playing, steps]);

  const ensureSteps = (): SimStep[] => {
    if (steps.length > 0 || !graph || !entrypoint) return steps;
    const built = buildSteps(buildAdjacency(graph.edges), entrypoint);
    setSteps(built);
    setStepIdx(0);
    return built;
  };

  const onPlay = (): void => {
    ensureSteps();
    setPlaying(true);
  };

  const resetSim = (): void => {
    setPlaying(false);
    setSteps([]);
    setStepIdx(0);
  };

  const onEntrypoint = (ep: string): void => {
    setEntrypoint(ep);
    resetSim();
  };

  const onScrub = (i: number): void => {
    setPlaying(false);
    const s = ensureSteps();
    setStepIdx(Math.min(i, Math.max(0, s.length - 1)));
  };

  const onSearchSubmit = (): void => {
    if (!graph || !search) return;
    const q = search.toLowerCase();
    const hit =
      graph.nodes.find((n) => n.id.toLowerCase() === q) ??
      graph.nodes.find((n) => n.name.toLowerCase() === q) ??
      graph.nodes.find((n) => n.id.toLowerCase().includes(q));
    if (hit) {
      setSelected(hit);
      viewRef.current?.focusNode(hit.id);
    }
  };

  const stack = steps.length > 0 ? steps[stepIdx]?.stack ?? [] : [];

  return (
    <div className="app">
      <div ref={containerRef} className="graph-canvas" />

      <header className="brand">
        <span className="logo">◈ RustViz</span>
        <span className="tagline">3D Rust project simulator</span>
      </header>

      {error && <div className="error">⚠ {error}</div>}

      {stack.length > 0 && (
        <div className="callstack">
          <div className="callstack-head">call stack</div>
          {[...stack].reverse().map((id, i) => (
            <div key={id} className={`frame ${i === 0 ? "top" : ""}`}>
              {id.split("::").slice(-2).join("::")}
            </div>
          ))}
        </div>
      )}

      <Controls
        meta={graph?.meta ?? null}
        lens={lens}
        lenses={LENSES}
        onLens={setLens}
        entrypoints={graph?.entrypoints ?? []}
        entrypoint={entrypoint}
        onEntrypoint={onEntrypoint}
        playing={playing}
        stepIdx={stepIdx}
        stepCount={steps.length}
        onPlay={onPlay}
        onPause={() => setPlaying(false)}
        onReset={resetSim}
        onScrub={onScrub}
        search={search}
        onSearch={setSearch}
        onSearchSubmit={onSearchSubmit}
      />

      <Inspector node={selected} lens={lens} onClose={() => setSelected(null)} />
    </div>
  );
}
