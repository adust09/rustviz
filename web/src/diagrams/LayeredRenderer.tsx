import { crateColor } from "../lenses";
import { fieldLine, kindTag, opLine, textOn, truncate, variantLine } from "./format";
import { BOX_W, FIELD_CAP, HEADER_H, OP_CAP, ROW_H } from "./structureScene";
import { useContainerSize } from "./useSize";
import type {
  DiagramScene,
  RendererProps,
  SequenceScene,
  StructureBox,
  StructureScene,
} from "./types";

// Flat (2D) renderer. Layer depth is implied by drop-shadows + the crate slabs
// the boxes sit on, rather than projection. Handles both diagram types.

const PAD = 30;
const CHAR_W = 6.1; // px per monospace glyph at 11px, for truncation budgeting

export function LayeredRenderer(props: RendererProps<DiagramScene>): JSX.Element {
  const { scene, ...rest } = props;
  return scene.kind === "structure" ? (
    <FlatStructure scene={scene} {...rest} />
  ) : (
    <FlatSequence scene={scene} {...rest} />
  );
}

function ScrollSvg({ w, h, children }: { w: number; h: number; children: React.ReactNode }): JSX.Element {
  const [ref, size] = useContainerSize<HTMLDivElement>();
  const vw = Math.max(w, size.w);
  const vh = Math.max(h, size.h);
  return (
    <div ref={ref} className="diag-scroll">
      <svg width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`}>
        <defs>
          <filter id="flatShadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000" floodOpacity="0.45" />
          </filter>
          <marker id="flatArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#9aa6b6" />
          </marker>
          <marker id="flatImpl" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
            <path d="M0,0 L12,6 L0,12 z" fill="#0b0f17" stroke="#7d8aa0" strokeWidth="1" />
          </marker>
        </defs>
        {children}
      </svg>
    </div>
  );
}

// ---------- Structure (UML class diagram) ----------

function FlatStructure({ scene, selectedId, onSelect, onDrillToSequence }: RendererProps<StructureScene>): JSX.Element {
  const maxX = Math.max(BOX_W, ...scene.crateSlabs.map((s) => s.x + s.w), ...scene.boxes.map((b) => b.x + b.w));
  const maxY = Math.max(0, ...scene.crateSlabs.map((s) => s.y + s.h), ...scene.boxes.map((b) => b.y + b.h));
  const center = new Map(scene.boxes.map((b) => [b.id, { x: b.x + b.w / 2, y: b.y + b.h / 2 }]));

  return (
    <ScrollSvg w={maxX + PAD} h={maxY + PAD}>
      {scene.crateSlabs.map((s) => (
        <g key={s.id}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={12} fill="#0d121c" stroke={crateColor(s.crate, scene.crateNames)} strokeOpacity={0.5} strokeWidth={1.5} />
          <circle cx={s.x + 14} cy={s.y + 15} r={5} fill={crateColor(s.crate, scene.crateNames)} />
          <text x={s.x + 26} y={s.y + 19} className="diag-crate">{s.title}</text>
        </g>
      ))}

      {scene.edges.map((e, i) => {
        const a = center.get(e.source);
        const b = center.get(e.target);
        if (!a || !b) return null;
        const impl = e.kind === "impls";
        return (
          <line
            key={`${e.source}->${e.target}-${i}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={impl ? "#7d8aa0" : "#4d5d78"}
            strokeWidth={impl ? 1.4 : 1}
            strokeDasharray={impl ? "6 4" : undefined}
            opacity={impl ? 0.8 : 0.4}
            markerEnd={impl ? "url(#flatImpl)" : "url(#flatArrow)"}
          />
        );
      })}

      {scene.boxes.map((b) => (
        <UmlBox key={b.id} box={b} crateNames={scene.crateNames} selected={selectedId === b.id} onSelect={onSelect} onDrill={onDrillToSequence} />
      ))}
    </ScrollSvg>
  );
}

function UmlBox(props: {
  box: StructureBox;
  crateNames: string[];
  selected: boolean;
  onSelect: (id: string) => void;
  onDrill?: (id: string) => void;
}): JSX.Element {
  const { box, crateNames, selected, onSelect, onDrill } = props;
  const color = crateColor(box.crate, crateNames);
  const charLimit = Math.floor((box.w - 16) / CHAR_W);
  const attrs = [...box.fields.map(fieldLine), ...box.variants.map(variantLine)];
  const shownAttrs = attrs.slice(0, FIELD_CAP);
  const shownOps = box.ops.slice(0, OP_CAP);
  const attrTop = HEADER_H + 4;
  const opsTop = attrTop + shownAttrs.length * ROW_H + (shownAttrs.length ? 6 : 0);

  return (
    <g transform={`translate(${box.x},${box.y})`} onClick={() => onSelect(box.id)} style={{ cursor: "pointer" }}>
      <rect width={box.w} height={box.h} rx={7} fill="#121a26" stroke={selected ? "#ffffff" : color} strokeWidth={selected ? 2.2 : 1.2} filter="url(#flatShadow)" />
      <path d={`M0,${HEADER_H} L0,7 Q0,0 7,0 L${box.w - 7},0 Q${box.w},0 ${box.w},7 L${box.w},${HEADER_H} Z`} fill={color} />
      <text x={8} y={13} className="diag-tag" fill={textOn(color)}>{kindTag(box.kind)}</text>
      <text x={8} y={25} className="diag-title" fill={textOn(color)}>{truncate(box.title, charLimit)}</text>

      {shownAttrs.map((line, i) => (
        <text key={`a${i}`} x={8} y={attrTop + 13 + i * ROW_H} className="diag-attr">{truncate(line, charLimit)}</text>
      ))}
      {attrs.length > FIELD_CAP && (
        <text x={8} y={attrTop + 13 + FIELD_CAP * ROW_H} className="diag-more">+{attrs.length - FIELD_CAP} more</text>
      )}

      {shownAttrs.length > 0 && box.ops.length > 0 && <line x1={0} y1={opsTop - 4} x2={box.w} y2={opsTop - 4} stroke="#2a3342" />}
      {shownOps.map((op, i) => (
        <text
          key={op.id}
          x={8}
          y={opsTop + 13 + i * ROW_H}
          className="diag-op"
          onClick={(e) => {
            e.stopPropagation();
            onDrill?.(op.id);
          }}
        >
          <title>{`${opLine(op)}  →  sequence`}</title>
          {truncate(opLine(op), charLimit)}
        </text>
      ))}
      {box.ops.length > OP_CAP && (
        <text x={8} y={opsTop + 13 + OP_CAP * ROW_H} className="diag-more">+{box.ops.length - OP_CAP} more</text>
      )}
    </g>
  );
}

// ---------- Sequence diagram ----------

const SEQ = { margin: 44, colW: 168, headH: 58, rowH: 30, boxW: 150, boxH: 38 };

export function FlatSequence({ scene, selectedId, onSelect, onOpenSource, onDrillToSequence }: RendererProps<SequenceScene>): JSX.Element {
  const colX = (col: number): number => SEQ.margin + SEQ.colW / 2 + col * SEQ.colW;
  const lifeX = new Map(scene.lifelines.map((l) => [l.id, colX(l.col)]));
  const w = SEQ.margin * 2 + Math.max(1, scene.lifelines.length) * SEQ.colW;
  const bottom = SEQ.headH + scene.messages.length * SEQ.rowH + SEQ.margin;

  if (scene.lifelines.length === 0) {
    return (
      <ScrollSvg w={600} h={300}>
        <text x={40} y={60} className="diag-empty">no resolved calls from {scene.rootTitle}</text>
      </ScrollSvg>
    );
  }

  return (
    <ScrollSvg w={w} h={bottom + SEQ.margin}>
      {/* lifelines */}
      {scene.lifelines.map((l) => {
        const x = colX(l.col);
        const color = crateColor(l.crate, scene.crateNames);
        const selected = selectedId === l.id || scene.rootId === l.id;
        return (
          <g key={l.id} onClick={() => { onSelect(l.id); onDrillToSequence?.(l.id); }} style={{ cursor: "pointer" }}>
            <line x1={x} y1={SEQ.headH} x2={x} y2={bottom} stroke="#2c3647" strokeWidth={1} strokeDasharray="3 4" />
            <rect x={x - SEQ.boxW / 2} y={12} width={SEQ.boxW} height={SEQ.boxH} rx={7} fill="#121a26" stroke={selected ? "#ffffff" : color} strokeWidth={selected ? 2 : 1.2} filter="url(#flatShadow)" />
            <circle cx={x - SEQ.boxW / 2 + 12} cy={12 + SEQ.boxH / 2} r={4} fill={color} />
            <text x={x - SEQ.boxW / 2 + 22} y={12 + SEQ.boxH / 2 + 4} className="diag-life">{truncate(l.title, 18)}</text>
          </g>
        );
      })}

      {/* messages */}
      {scene.messages.map((m) => {
        const fromX = lifeX.get(m.fromId);
        const toX = lifeX.get(m.toId);
        if (fromX === undefined || toX === undefined) return null;
        const y = SEQ.headH + 18 + m.row * SEQ.rowH;
        const open = (): void => {
          if (m.fromFile) onOpenSource(m.fromFile, m.callLine, m.callLine + 8);
        };
        if (m.selfCall) {
          return (
            <g key={m.row} onClick={open} style={{ cursor: "pointer" }}>
              <path d={`M${fromX},${y} h26 v12 h-26`} fill="none" stroke="#9aa6b6" strokeWidth={1.1} markerEnd="url(#flatArrow)" />
              <text x={fromX + 32} y={y - 2} className="diag-msg">{truncate(m.label, 22)} ↺</text>
            </g>
          );
        }
        const dir = toX >= fromX ? 1 : -1;
        return (
          <g key={m.row} onClick={open} style={{ cursor: "pointer" }}>
            <line x1={fromX + dir * 2} y1={y} x2={toX - dir * 2} y2={y} stroke="#9aa6b6" strokeWidth={1.1} markerEnd="url(#flatArrow)" opacity={0.9} />
            <text x={(fromX + toX) / 2} y={y - 5} className="diag-msg" textAnchor="middle">{truncate(m.label, Math.max(8, Math.abs(toX - fromX) / CHAR_W - 2))}</text>
          </g>
        );
      })}
    </ScrollSvg>
  );
}
