import { crateColor } from "../lenses";
import { truncate } from "./format";
import { ZoomPanSvg } from "./ZoomPanSvg";
import type { DiagramScene, RendererProps, SequenceScene } from "./types";

// Flat (2D) sequence renderer: participant lifelines + activation bars + ordered
// CALL (solid) and RETURN (dashed) message arrows — a UML sequence diagram. The
// structure view is 3D-only (see ThreeRenderer). Pan + wheel-zoom come from the
// shared ZoomPanSvg wrapper.

const CHAR_W = 6.1; // px per monospace glyph at 11px, for truncation budgeting

const FLAT_DEFS = (
  <>
    <filter id="flatShadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000" floodOpacity="0.45" />
    </filter>
    <marker id="flatArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#9aa6b6" />
    </marker>
    {/* open (line) head for return arrows */}
    <marker id="flatReturn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0,1 L9,5 L0,9" fill="none" stroke="#6f7d92" strokeWidth="1.2" />
    </marker>
  </>
);

export function LayeredRenderer(props: RendererProps<DiagramScene>): JSX.Element | null {
  const { scene, ...rest } = props;
  if (scene.kind !== "sequence") return null; // structure is rendered in 3D
  return <FlatSequence scene={scene} {...rest} />;
}

const SEQ = { margin: 44, colW: 168, headH: 58, rowH: 30, boxW: 150, boxH: 38, actW: 9 };

function FlatSequence({ scene, selectedId, onSelect, onOpenSource }: RendererProps<SequenceScene>): JSX.Element {
  const colX = (col: number): number => SEQ.margin + SEQ.colW / 2 + col * SEQ.colW;
  const rowY = (r: number): number => SEQ.headH + 18 + r * SEQ.rowH;
  const lifeX = new Map(scene.lifelines.map((l) => [l.id, colX(l.col)]));
  const w = SEQ.margin * 2 + Math.max(1, scene.lifelines.length) * SEQ.colW;
  const bottom = SEQ.headH + scene.messages.length * SEQ.rowH + SEQ.margin;

  if (scene.lifelines.length === 0) {
    return (
      <ZoomPanSvg contentW={600} contentH={300} defs={FLAT_DEFS}>
        <text x={40} y={60} className="diag-empty">no resolved calls from {scene.rootTitle}</text>
      </ZoomPanSvg>
    );
  }

  return (
    <ZoomPanSvg contentW={w} contentH={bottom + SEQ.margin} defs={FLAT_DEFS}>
      {/* lifelines */}
      {scene.lifelines.map((l) => {
        const x = colX(l.col);
        const color = crateColor(l.crate, scene.crateNames);
        const selected = selectedId === l.id || scene.rootId === l.id;
        const openDef = (): void => { if (l.file) onOpenSource(l.file, l.start, l.end); };
        return (
          <g key={l.id} onClick={() => { onSelect(l.id); openDef(); }} style={{ cursor: "pointer" }}>
            {/* Full id on hover — the header label is truncated/abbreviated. */}
            <title>{l.id}</title>
            <line x1={x} y1={SEQ.headH} x2={x} y2={bottom} stroke="#2c3647" strokeWidth={1} strokeDasharray="3 4" />
            <rect x={x - SEQ.boxW / 2} y={12} width={SEQ.boxW} height={SEQ.boxH} rx={7} fill="#121a26" stroke={selected ? "#ffffff" : color} strokeWidth={selected ? 2 : 1.2} filter="url(#flatShadow)" />
            <circle cx={x - SEQ.boxW / 2 + 12} cy={12 + SEQ.boxH / 2} r={4} fill={color} />
            <text x={x - SEQ.boxW / 2 + 22} y={12 + SEQ.boxH / 2 + 4} className="diag-life">{truncate(l.title, 18)}</text>
          </g>
        );
      })}

      {/* activation bars (under the arrows) */}
      {scene.activations.map((a, i) => {
        const cx = colX(a.col) + Math.min(a.depth, 3) * 4;
        const top = rowY(a.startRow) - 6;
        const h = Math.max(SEQ.rowH * 0.6, rowY(a.endRow) - rowY(a.startRow));
        const life = scene.lifelines.find((l) => l.col === a.col);
        const color = crateColor(life?.crate ?? "", scene.crateNames);
        return (
          <rect key={`a${i}`} className="diag-act" x={cx - SEQ.actW / 2} y={top} width={SEQ.actW} height={h} rx={2} fill={color} fillOpacity={0.22} stroke={color} strokeOpacity={0.7} strokeWidth={1} />
        );
      })}

      {/* messages: call (solid) + return (dashed) */}
      {scene.messages.map((m) => {
        const fromX = lifeX.get(m.fromId);
        const toX = lifeX.get(m.toId);
        if (fromX === undefined || toX === undefined) return null;
        const y = rowY(m.row);

        if (m.selfCall) {
          const open = (): void => { if (m.fromFile) onOpenSource(m.fromFile, m.callLine, m.callLine + 8); };
          return (
            <g key={m.row} onClick={open} style={{ cursor: "pointer" }}>
              <title>{m.label} (self-call)</title>
              <path d={`M${fromX},${y} h26 v12 h-26`} fill="none" stroke="#9aa6b6" strokeWidth={1.1} markerEnd="url(#flatArrow)" />
              <text x={fromX + 32} y={y - 2} className="diag-msg">{truncate(m.label, 22)} ↺</text>
            </g>
          );
        }

        const dir = toX >= fromX ? 1 : -1;
        if (m.kind === "return") {
          // Dashed reply back to the caller; label the returned type (if any).
          return (
            <g key={m.row} className="diag-retg">
              <line x1={fromX + dir * 2} y1={y} x2={toX - dir * 2} y2={y} stroke="#6f7d92" strokeWidth={1} strokeDasharray="4 3" markerEnd="url(#flatReturn)" />
              {m.label && (
                <text x={(fromX + toX) / 2} y={y - 5} className="diag-ret" textAnchor="middle">⤺ {truncate(m.label, Math.max(6, Math.abs(toX - fromX) / CHAR_W - 4))}</text>
              )}
            </g>
          );
        }

        const open = (): void => { if (m.fromFile) onOpenSource(m.fromFile, m.callLine, m.callLine + 8); };
        return (
          <g key={m.row} onClick={open} style={{ cursor: "pointer" }}>
            <title>{m.label}() — call site, click to open</title>
            <line x1={fromX + dir * 2} y1={y} x2={toX - dir * 2} y2={y} stroke="#9aa6b6" strokeWidth={1.1} markerEnd="url(#flatArrow)" opacity={0.9} />
            <text x={(fromX + toX) / 2} y={y - 5} className="diag-msg" textAnchor="middle">{truncate(m.label, Math.max(8, Math.abs(toX - fromX) / CHAR_W - 2))}</text>
          </g>
        );
      })}
    </ZoomPanSvg>
  );
}
