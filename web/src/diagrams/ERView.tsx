import { useEffect, useMemo, useState } from "react";
import { fetchSource } from "../api";
import { crateColor } from "../lenses";
import type { Graph } from "../schema";
import { buildERScene } from "./erScene";
import { truncate } from "./format";
import { ZoomPanSvg } from "./ZoomPanSvg";
import type { EREntity, ERScene } from "./types";

// ER (KV-storage schema) tab: storage tables as `Key -> Value` boxes whose body
// lists the resolved value struct's fields, linked by co-key (shared primary
// key) and fk (value composition) relationships. Self-contained 2D SVG view —
// reuses ZoomPanSvg + the /api/source drill-down, mirroring the sequence view.

const ER_DEFS = (
  <>
    <filter id="erShadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#000" floodOpacity="0.45" />
    </filter>
    <marker id="erArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#ffd23f" />
    </marker>
  </>
);

interface OpenSource {
  file: string;
  start: number;
  end: number;
}

export function ERView({ graph }: { graph: Graph }): JSX.Element {
  const scene = useMemo<ERScene>(() => buildERScene(graph), [graph]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenSource | null>(null);
  const [source, setSource] = useState<string>("");

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

  return (
    <div className="diagram-wrap">
      <ERSvg scene={scene} selectedId={selectedId} onSelect={setSelectedId} onOpenSource={(f, s, e) => setOpen({ file: f, start: s, end: e })} />
      <ERLegend stores={scene.stores} />
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

interface ERSvgProps {
  scene: ERScene;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenSource: (file: string, start: number, end: number) => void;
}

function ERSvg({ scene, selectedId, onSelect, onOpenSource }: ERSvgProps): JSX.Element {
  if (scene.entities.length === 0) {
    return (
      <ZoomPanSvg contentW={640} contentH={320} defs={ER_DEFS}>
        <text x={40} y={56} className="diag-empty">
          no storage tables detected — looking for an enum whose variants are documented `Key -&gt; Value`
        </text>
      </ZoomPanSvg>
    );
  }

  const byId = new Map(scene.entities.map((e) => [e.id, e]));

  return (
    <ZoomPanSvg contentW={scene.worldW} contentH={scene.worldH} defs={ER_DEFS}>
      {/* relations under the boxes */}
      {scene.relations.map((rel, i) => {
        const a = byId.get(rel.from);
        const b = byId.get(rel.to);
        if (!a || !b) return null;
        const ac = center(a);
        const bc = center(b);
        const p1 = edgePoint(a, bc.x - ac.x, bc.y - ac.y);
        const p2 = edgePoint(b, ac.x - bc.x, ac.y - bc.y);
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const fk = rel.kind === "fk";
        return (
          <g key={`${rel.from}-${rel.to}-${i}`} className="er-edge">
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={fk ? "#ffd23f" : "#3fb6b6"}
              strokeWidth={1.2}
              strokeDasharray={fk ? undefined : "5 4"}
              markerEnd={fk ? "url(#erArrow)" : undefined}
              opacity={0.85}
            />
            <text x={mx} y={my - 4} className="er-edge-label" textAnchor="middle">
              {fk ? truncate(rel.label, 16) : "1:1"}
            </text>
          </g>
        );
      })}

      {/* entity boxes */}
      {scene.entities.map((e) => (
        <ERBox
          key={e.id}
          e={e}
          crateNames={scene.crateNames}
          selected={selectedId === e.id}
          onSelect={() => {
            onSelect(e.id);
            onOpenSource(e.srcFile, e.srcLine, e.srcLine + 12);
          }}
        />
      ))}
    </ZoomPanSvg>
  );
}

function ERBox({ e, crateNames, selected, onSelect }: { e: EREntity; crateNames: readonly string[]; selected: boolean; onSelect: () => void }): JSX.Element {
  const color = crateColor(e.crate, crateNames);
  const fieldsTop = 50;
  return (
    <g transform={`translate(${e.x} ${e.y})`} onClick={onSelect} style={{ cursor: "pointer" }}>
      <rect width={e.w} height={e.h} rx={8} fill="#121a26" stroke={selected ? "#ffffff" : color} strokeWidth={selected ? 2 : 1.3} filter="url(#erShadow)" />
      {/* header band */}
      <rect width={e.w} height={28} rx={8} fill={color} opacity={0.16} />
      <circle cx={14} cy={14} r={4} fill={color} />
      <text x={24} y={18} className="er-title">{truncate(e.table, 22)}</text>
      {/* key → value */}
      <text x={12} y={42} className="er-kv">
        <tspan className="er-key">{truncate(e.key, 14)}</tspan>
        <tspan className="er-arrow"> → </tspan>
        <tspan className="er-val">{truncate(e.value, 16)}</tspan>
      </text>
      <line x1={8} y1={fieldsTop - 2} x2={e.w - 8} y2={fieldsTop - 2} stroke="#243049" strokeWidth={1} />
      {/* fields */}
      {e.fields.length === 0 && (
        <text x={12} y={fieldsTop + 14} className="er-field er-field-empty">{truncate(e.value, 26)}</text>
      )}
      {e.fields.map((f, i) => (
        <text key={f.name + i} x={12} y={fieldsTop + 14 + i * 16} className={`er-field ${f.fkKey ? "er-fk" : ""}`}>
          {f.fkKey ? "→ " : ""}
          {truncate(`${f.name}: ${f.ty}`, 28)}
        </text>
      ))}
    </g>
  );
}

function ERLegend({ stores }: { stores: ERScene["stores"] }): JSX.Element {
  return (
    <div className="er-legend">
      <div className="er-legend-h">storage</div>
      {stores.map((s) => (
        <div key={s.name} className="er-legend-row">
          <b>{s.name}</b> · {s.count} tables
        </div>
      ))}
      <div className="er-legend-key">
        <span className="er-legend-cokey">— —</span> same key &nbsp;
        <span className="er-legend-fk">→</span> references
      </div>
    </div>
  );
}

function center(e: EREntity): { x: number; y: number } {
  return { x: e.x + e.w / 2, y: e.y + e.h / 2 };
}

/** Point on the box border in direction (dx,dy) from its center. */
function edgePoint(e: EREntity, dx: number, dy: number): { x: number; y: number } {
  const c = center(e);
  const hw = e.w / 2;
  const hh = e.h / 2;
  const ax = Math.abs(dx) || 1e-6;
  const ay = Math.abs(dy) || 1e-6;
  const t = 1 / Math.max(ax / hw, ay / hh);
  return { x: c.x + dx * t, y: c.y + dy * t };
}
