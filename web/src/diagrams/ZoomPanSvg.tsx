import { useEffect, useRef, useState } from "react";
import { useContainerSize } from "./useSize";

// Pan + wheel-zoom wrapper for the SVG diagram renderers (flat / iso), giving
// them the same zoom/pan affordance as the three.js view, plus:
//   - semantic level-of-detail (LoD): `render(lod)` is re-evaluated only when the
//     zoom scale crosses a threshold, so detail appears/disappears as you zoom
//     while continuous pan/zoom stays imperative (no per-frame React re-render).
//   - an optional minimap (world skeleton + a live viewport rectangle) for
//     "where am I" orientation on a large, stable map.

const MIN = 0.02;
const MAX = 14;
const MINIMAP_MAX = 190;
const clamp = (v: number): number => Math.min(MAX, Math.max(MIN, v));

interface View {
  scale: number;
  tx: number;
  ty: number;
}

/** A label that stays a constant on-screen size (like a map label) regardless
 *  of zoom, positioned at a world coordinate. */
export interface WorldLabel {
  x: number;
  y: number;
  text: string;
}

interface ZoomPanSvgProps {
  contentW: number;
  contentH: number;
  defs?: React.ReactNode;
  /** Ascending scale breakpoints; lod = how many have been passed. */
  lodThresholds?: number[];
  /** World-coordinate skeleton drawn in the minimap (optional). */
  minimap?: React.ReactNode;
  /** Non-scaling overlay labels anchored at world coords (optional). */
  labels?: WorldLabel[];
  /** Static content (when LoD is not used). */
  children?: React.ReactNode;
  /** LoD content; receives the current level. Takes precedence over children. */
  render?: (lod: number) => React.ReactNode;
}

function lodFor(scale: number, thresholds?: number[]): number {
  if (!thresholds) return 0;
  let n = 0;
  for (const t of thresholds) if (scale >= t) n++;
  return n;
}

export function ZoomPanSvg(props: ZoomPanSvgProps): JSX.Element {
  const { contentW, contentH, defs, lodThresholds, minimap, labels, children, render } = props;
  const [ref, size] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const vpRef = useRef<SVGRectElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const labelData = useRef<WorldLabel[]>(labels ?? []);
  labelData.current = labels ?? [];
  const view = useRef<View>({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const interacted = useRef(false);
  const lastKey = useRef("");
  const [lod, setLod] = useState(0);

  const mmScale = minimap ? Math.min(MINIMAP_MAX / contentW, MINIMAP_MAX / contentH) : 0;
  const mmW = contentW * mmScale;
  const mmH = contentH * mmScale;

  const apply = (): void => {
    const v = view.current;
    gRef.current?.setAttribute("transform", `translate(${v.tx} ${v.ty}) scale(${v.scale})`);
    if (vpRef.current) {
      vpRef.current.setAttribute("x", String(-v.tx / v.scale));
      vpRef.current.setAttribute("y", String(-v.ty / v.scale));
      vpRef.current.setAttribute("width", String(size.w / v.scale));
      vpRef.current.setAttribute("height", String(size.h / v.scale));
    }
    const box = labelsRef.current;
    if (box) {
      const kids = box.children;
      for (let i = 0; i < kids.length; i++) {
        const l = labelData.current[i];
        const el = kids[i] as HTMLElement;
        if (!l) continue;
        const sx = l.x * v.scale + v.tx;
        const sy = l.y * v.scale + v.ty;
        const vis = sx > -120 && sx < size.w + 120 && sy > -40 && sy < size.h + 40;
        el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
        el.style.opacity = vis ? "1" : "0";
      }
    }
  };

  const syncLod = (): void => {
    const next = lodFor(view.current.scale, lodThresholds);
    setLod((prev) => (prev === next ? prev : next));
  };

  const fit = (): void => {
    if (!size.w || !contentW || !contentH) return;
    const s = clamp(Math.min(size.w / contentW, size.h / contentH) * 0.92);
    view.current = { scale: s, tx: (size.w - contentW * s) / 2, ty: Math.max(14, (size.h - contentH * s) / 2) };
    apply();
    syncLod();
  };

  const zoomAt = (cx: number, cy: number, factor: number): void => {
    const v = view.current;
    const ns = clamp(v.scale * factor);
    v.tx = cx - ((cx - v.tx) / v.scale) * ns;
    v.ty = cy - ((cy - v.ty) / v.scale) * ns;
    v.scale = ns;
    interacted.current = true;
    apply();
    syncLod();
  };

  const centerOnWorld = (wx: number, wy: number): void => {
    const v = view.current;
    v.tx = size.w / 2 - wx * v.scale;
    v.ty = size.h / 2 - wy * v.scale;
    interacted.current = true;
    apply();
  };

  useEffect(() => {
    const key = `${contentW}x${contentH}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      interacted.current = false;
    }
    if (interacted.current) apply();
    else fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentW, contentH, size.w, size.h]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, active: false };
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.active = true;
      interacted.current = true;
      svgRef.current?.setPointerCapture(e.pointerId);
      if (svgRef.current) svgRef.current.style.cursor = "grabbing";
    }
    view.current.tx += e.clientX - d.x;
    view.current.ty += e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    apply();
  };
  const endPan = (e: React.PointerEvent): void => {
    if (drag.current?.active) {
      svgRef.current?.releasePointerCapture(e.pointerId);
      if (svgRef.current) svgRef.current.style.cursor = "grab";
    }
    drag.current = null;
  };

  const onMinimap = (e: React.PointerEvent): void => {
    if (e.buttons !== 1) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    centerOnWorld((e.clientX - rect.left) / mmScale, (e.clientY - rect.top) / mmScale);
  };

  return (
    <div ref={ref} className="diag-zoom">
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        style={{ cursor: "grab", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerLeave={endPan}
      >
        <defs>{defs}</defs>
        <g ref={gRef}>{render ? render(lod) : children}</g>
      </svg>

      {labels && (
        <div className="zoom-labels" ref={labelsRef}>
          {labels.map((l, i) => (
            <div className="zoom-label" key={i}>{l.text}</div>
          ))}
        </div>
      )}

      {minimap && (
        <svg
          className="minimap"
          width={mmW}
          height={mmH}
          viewBox={`0 0 ${contentW} ${contentH}`}
          onPointerDown={onMinimap}
          onPointerMove={onMinimap}
        >
          {minimap}
          <rect ref={vpRef} className="minimap-vp" x={0} y={0} width={contentW} height={contentH} />
        </svg>
      )}

      <div className="zoom-ctl">
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)} title="Zoom in">＋</button>
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)} title="Zoom out">－</button>
        <button onClick={fit} title="Fit to view">⤢</button>
      </div>
    </div>
  );
}
