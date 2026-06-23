import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, treemap, type HierarchyRectangularNode } from "d3-hierarchy";
import type { Lens } from "./schema";
import type { Aggregation, Tile } from "./aggregate";
import { crateColor, CYCLE_COLOR, tileColor } from "./lenses";

interface HNode {
  name: string;
  crate: string;
  tile?: Tile;
  value?: number;
  children?: HNode[];
}

interface TreemapProps {
  agg: Aggregation;
  lens: Lens;
  selectedId: string | null;
  onSelect: (tile: Tile) => void;
  showDeps: boolean;
}

const CRATE_LABEL_H = 22;

function luminance(hex: string): number {
  const s = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function textOn(hex: string): string {
  return luminance(hex) > 0.6 ? "#10141b" : "#eef2f8";
}

export function Treemap({ agg, lens, selectedId, onSelect, showDeps }: TreemapProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDims({ w: Math.max(320, r.width), h: Math.max(320, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const root = useMemo(() => {
    const byCrate = new Map<string, Tile[]>();
    for (const t of agg.tiles) {
      const list = byCrate.get(t.crate) ?? [];
      list.push(t);
      byCrate.set(t.crate, list);
    }
    const data: HNode = {
      name: "root",
      crate: "",
      children: [...byCrate.entries()].map(([crate, tiles]) => ({
        name: crate,
        crate,
        children: tiles.map((tile) => ({ name: tile.name, crate, tile, value: tile.loc })),
      })),
    };
    const h = hierarchy(data)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<HNode>()
      .size([dims.w, dims.h])
      .paddingOuter(4)
      .paddingTop((d) => (d.depth === 1 ? CRATE_LABEL_H : 0))
      .paddingInner(2)
      .round(true)(h);
    return h as HierarchyRectangularNode<HNode>;
  }, [agg, dims]);

  const crateNodes = root.descendants().filter((d) => d.depth === 1);
  const tileNodes = root.descendants().filter((d) => d.depth === 2);
  const crateRect = new Map(crateNodes.map((c) => [c.data.crate, c]));

  return (
    <div ref={wrapRef} className="treemap-wrap">
      <svg width={dims.w} height={dims.h}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#9aa6b6" />
          </marker>
        </defs>

        {/* crate containers */}
        {crateNodes.map((c) => (
          <g key={c.data.crate}>
            <rect
              x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0}
              fill="#0e131c" stroke="#2a3342" strokeWidth={1} rx={6}
            />
            <rect x={c.x0} y={c.y0} width={c.x1 - c.x0} height={CRATE_LABEL_H} fill="#161d28" rx={6} />
            <circle cx={c.x0 + 11} cy={c.y0 + CRATE_LABEL_H / 2} r={4} fill={crateColor(c.data.crate, agg.crates)} />
            <text x={c.x0 + 20} y={c.y0 + 15} className="crate-label">
              {c.data.crate} · {Math.round((c.value ?? 0) / 1)} LOC
            </text>
          </g>
        ))}

        {/* module tiles */}
        {tileNodes.map((n) => {
          const tile = n.data.tile!;
          const w = n.x1 - n.x0;
          const h = n.y1 - n.y0;
          const fill = tileColor(lens, tile.score[lens], tile.crate, agg.crates);
          const selected = selectedId === tile.id;
          const showLabel = w > 46 && h > 18;
          return (
            <g
              key={tile.id}
              onClick={() => onSelect(tile)}
              onMouseEnter={() => setHover(tile.id)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={n.x0} y={n.y0} width={w} height={h} rx={3}
                fill={fill}
                stroke={selected ? "#ffffff" : tile.inCycle ? CYCLE_COLOR : hover === tile.id ? "#cdd6e4" : "transparent"}
                strokeWidth={selected ? 2 : tile.inCycle ? 1.5 : 1}
                style={{ transition: "fill 380ms ease" }}
              />
              {showLabel && (
                <text x={n.x0 + 5} y={n.y0 + 13} className="tile-label" fill={textOn(fill)}>
                  {tile.name}
                </text>
              )}
              {showLabel && h > 30 && (
                <text x={n.x0 + 5} y={n.y0 + 26} className="tile-sub" fill={textOn(fill)} opacity={0.75}>
                  {tile.loc} LOC · {tile.fnCount} fn
                </text>
              )}
            </g>
          );
        })}

        {/* crate dependency overlay */}
        {showDeps &&
          [...agg.crateDeps.entries()].flatMap(([from, deps]) =>
            deps.dependsOn.map((to) => {
              const a = crateRect.get(from);
              const b = crateRect.get(to);
              if (!a || !b) return null;
              const ax = (a.x0 + a.x1) / 2, ay = (a.y0 + a.y1) / 2;
              const bx = (b.x0 + b.x1) / 2, by = (b.y0 + b.y1) / 2;
              const mutual = agg.crateDeps.get(to)?.dependsOn.includes(from) ?? false;
              return (
                <path
                  key={`${from}->${to}`}
                  d={`M${ax},${ay} Q${(ax + bx) / 2},${(ay + by) / 2 - 30} ${bx},${by}`}
                  fill="none"
                  stroke={mutual ? CYCLE_COLOR : "#9aa6b6"}
                  strokeWidth={1.2}
                  opacity={0.5}
                  markerEnd="url(#arrow)"
                />
              );
            }),
          )}
      </svg>
    </div>
  );
}
