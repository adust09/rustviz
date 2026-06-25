import { useEffect, useRef } from "react";
import { useContainerSize } from "./useSize";

// Pan + wheel-zoom wrapper for the SVG diagram renderers, giving them the same
// navigation as the three.js view. The transform is applied imperatively to the
// inner <g> so panning/zooming never re-renders the child nodes.

const MIN = 0.02;
const MAX = 14;
const clamp = (v: number): number => Math.min(MAX, Math.max(MIN, v));

interface View {
  scale: number;
  tx: number;
  ty: number;
}

interface ZoomPanSvgProps {
  contentW: number;
  contentH: number;
  defs?: React.ReactNode;
  children: React.ReactNode;
}

export function ZoomPanSvg({ contentW, contentH, defs, children }: ZoomPanSvgProps): JSX.Element {
  const [ref, size] = useContainerSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const view = useRef<View>({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const interacted = useRef(false);
  const lastKey = useRef("");

  const apply = (): void => {
    const v = view.current;
    gRef.current?.setAttribute("transform", `translate(${v.tx} ${v.ty}) scale(${v.scale})`);
  };

  const fit = (): void => {
    if (!size.w || !contentW || !contentH) return;
    const s = clamp(Math.min(size.w / contentW, size.h / contentH) * 0.92);
    view.current = { scale: s, tx: (size.w - contentW * s) / 2, ty: Math.max(14, (size.h - contentH * s) / 2) };
    apply();
  };

  const zoomAt = (cx: number, cy: number, factor: number): void => {
    const v = view.current;
    const ns = clamp(v.scale * factor);
    v.tx = cx - ((cx - v.tx) / v.scale) * ns;
    v.ty = cy - ((cy - v.ty) / v.scale) * ns;
    v.scale = ns;
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
        <g ref={gRef}>{children}</g>
      </svg>
      <div className="zoom-ctl">
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)} title="Zoom in">＋</button>
        <button onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)} title="Zoom out">－</button>
        <button onClick={fit} title="Fit to view">⤢</button>
      </div>
    </div>
  );
}
