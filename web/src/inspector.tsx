import { useEffect, useState } from "react";
import { fetchSource } from "./api";
import type { GraphNode, Lens } from "./schema";

interface InspectorProps {
  node: GraphNode | null;
  lens: Lens;
  onClose: () => void;
}

interface Bar {
  label: string;
  score: number;
  detail: string;
}

function bars(node: GraphNode): Bar[] {
  const m = node.metrics;
  return [
    {
      label: "architecture",
      score: m.architecture.score,
      detail: `fan-in ${m.architecture.fan_in} · fan-out ${m.architecture.fan_out}${m.architecture.in_cycle ? " · in cycle" : ""}`,
    },
    {
      label: "security",
      score: m.security.score,
      detail: `unsafe ${m.security.unsafe_blocks} · unwrap ${m.security.unwraps} · panic ${m.security.panics} · cast ${m.security.lossy_casts}`,
    },
    {
      label: "performance",
      score: m.performance.score,
      detail: `alloc ${m.performance.allocs} · clone ${m.performance.clones} · nested-loop ${m.performance.nested_loops} · recursion ${m.performance.recursion}`,
    },
    {
      label: "complexity",
      score: m.complexity.score,
      detail: `cyclomatic ${m.complexity.cyclomatic} · nesting ${m.complexity.max_nesting} · ${m.complexity.loc} LOC`,
    },
  ];
}

export function Inspector({ node, lens, onClose }: InspectorProps): JSX.Element | null {
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!node || !node.file) {
      setSource("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSource(node.file, node.span.start_line, node.span.end_line)
      .then((text) => {
        if (!cancelled) setSource(text);
      })
      .catch(() => {
        if (!cancelled) setSource("// source unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node]);

  if (!node) return null;

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div>
          <div className="inspector-name">{node.name}</div>
          <div className="inspector-id">{node.id}</div>
        </div>
        <button className="close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="inspector-sub">
        <span className="badge">{node.kind}</span>
        <span className="badge">{node.crate}</span>
        <span className="file">
          {node.file}:{node.span.start_line}
        </span>
      </div>

      <div className="metrics">
        {bars(node).map((b) => (
          <div key={b.label} className={`metric ${b.label === lens ? "active" : ""}`}>
            <div className="metric-top">
              <span>{b.label}</span>
              <span>{(b.score * 100).toFixed(0)}%</span>
            </div>
            <div className="metric-track">
              <div className={`metric-fill ${b.label}`} style={{ width: `${b.score * 100}%` }} />
            </div>
            <div className="metric-detail">{b.detail}</div>
          </div>
        ))}
      </div>

      <div className="source">
        <div className="source-head">source</div>
        <pre>{loading ? "loading…" : source || "// no source"}</pre>
      </div>
    </div>
  );
}
