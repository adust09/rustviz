import { crateColor, CYCLE_COLOR } from "../lenses";
import { fieldLine, kindTag, opLine, textOn, truncate, variantLine } from "./format";
import { FIELD_CAP, HEADER_H, OP_CAP, ROW_H } from "./structureScene";
import { ZoomPanSvg } from "./ZoomPanSvg";
import type {
  CrateNode,
  DiagramScene,
  RendererProps,
  SequenceScene,
  StructureBox,
  StructureScene,
} from "./types";

// Flat (2D) renderer. Handles both diagram types. The structure diagram is a
// dependency-layered, semantic-zoom map: at LoD 0 only crate regions + dep
// arrows; zoom in (LoD 1) reveals module frames + type boxes; further (LoD 2)
// expands members. Pan + wheel-zoom + minimap come from ZoomPanSvg.

const CHAR_W = 6.1; // px per monospace glyph at 11px, for truncation budgeting
const CRATE_HEAD_H = 26;
const LOD_THRESHOLDS = [0.4, 1.1];

const FLAT_DEFS = (
  <>
    <filter id="flatShadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#000" floodOpacity="0.45" />
    </filter>
    <marker id="flatArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#9aa6b6" />
    </marker>
    <marker id="flatImpl" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
      <path d="M0,0 L12,6 L0,12 z" fill="#0b0f17" stroke="#7d8aa0" strokeWidth="1" />
    </marker>
  </>
);

export function LayeredRenderer(props: RendererProps<DiagramScene>): JSX.Element {
  const { scene, ...rest } = props;
  return scene.kind === "structure" ? (
    <FlatStructure scene={scene} {...rest} />
  ) : (
    <FlatSequence scene={scene} {...rest} />
  );
}

// ---------- Structure (UML class diagram) ----------

function FlatStructure({ scene, selectedId, onSelect, onDrillToSequence }: RendererProps<StructureScene>): JSX.Element {
  const crateById = new Map(scene.crates.map((c) => [c.name, c]));
  const boxCenter = new Map(scene.boxes.map((b) => [b.id, { x: b.x + b.w / 2, y: b.y + b.h / 2 }]));

  const minimap = scene.crates.map((c) => (
    <rect key={c.name} x={c.x} y={c.y} width={c.w} height={c.h} rx={8}
      fill={crateColor(c.name, scene.crateNames)} fillOpacity={0.5}
      stroke={crateColor(c.name, scene.crateNames)} strokeWidth={8} />
  ));

  return (
    <ZoomPanSvg contentW={scene.worldW + 60} contentH={scene.worldH + 60} defs={FLAT_DEFS} lodThresholds={LOD_THRESHOLDS} minimap={minimap} render={content} />
  );

  function content(lod: number): React.ReactNode {
    return (
      <>
        {scene.crates.map((c) => (
          <CrateRegion key={c.name} crate={c} names={scene.crateNames} selected={selectedId === c.name} faded={lod >= 1} onSelect={onSelect} />
        ))}

        {lod === 0 &&
          scene.crateEdges.map((e, i) => {
            const a = crateById.get(e.source);
            const b = crateById.get(e.target);
            if (!a || !b) return null;
            return (
              <line key={i} x1={a.x + a.w / 2} y1={a.y + a.h / 2} x2={b.x + b.w / 2} y2={b.y + b.h / 2}
                stroke={e.mutual ? CYCLE_COLOR : "#5a6b86"} strokeWidth={2.2} opacity={0.5} markerEnd="url(#flatArrow)" />
            );
          })}

        {lod >= 1 &&
          scene.crates.flatMap((c) =>
            c.modules.map((f) => (
              <g key={f.id}>
                <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={6} fill="#0e141e" stroke="#26303f" strokeWidth={1} />
                <text x={f.x + 8} y={f.y + 14} className="diag-mod">{f.title}</text>
              </g>
            )),
          )}

        {lod >= 1 &&
          scene.edges.map((e, i) => {
            const a = boxCenter.get(e.source);
            const b = boxCenter.get(e.target);
            if (!a || !b) return null;
            const impl = e.kind === "impls";
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={impl ? "#7d8aa0" : "#3d5478"}
                strokeWidth={1} strokeDasharray={impl ? "6 4" : undefined} opacity={0.22}
                markerEnd={impl ? "url(#flatImpl)" : "url(#flatArrow)"} />
            );
          })}

        {lod >= 1 &&
          scene.boxes.map((b) => (
            <UmlBox key={b.id} box={b} crateNames={scene.crateNames} selected={selectedId === b.id} detail={lod >= 2} onSelect={onSelect} onDrill={onDrillToSequence} />
          ))}
      </>
    );
  }
}

function CrateRegion(props: { crate: CrateNode; names: string[]; selected: boolean; faded: boolean; onSelect: (id: string) => void }): JSX.Element {
  const { crate, names, selected, faded, onSelect } = props;
  const color = crateColor(crate.name, names);
  return (
    <g onClick={() => onSelect(crate.name)} style={{ cursor: "pointer" }}>
      <rect x={crate.x} y={crate.y} width={crate.w} height={crate.h} rx={12} fill="#0c1019" fillOpacity={faded ? 0.3 : 0.88}
        stroke={selected ? "#ffffff" : color} strokeWidth={selected ? 2.6 : 1.8} strokeOpacity={0.85} />
      <rect x={crate.x} y={crate.y} width={crate.w} height={CRATE_HEAD_H} rx={12} fill={color} fillOpacity={0.18} />
      <circle cx={crate.x + 15} cy={crate.y + 13} r={5} fill={color} />
      <text x={crate.x + 27} y={crate.y + 17} className="diag-crate">{crate.name}</text>
      <text x={crate.x + crate.w - 9} y={crate.y + 17} className="diag-layer" textAnchor="end">L{crate.layer}</text>
    </g>
  );
}

function UmlBox(props: {
  box: StructureBox;
  crateNames: string[];
  selected: boolean;
  detail: boolean;
  onSelect: (id: string) => void;
  onDrill?: (id: string) => void;
}): JSX.Element {
  const { box, crateNames, selected, detail, onSelect, onDrill } = props;
  const color = crateColor(box.crate, crateNames);
  const charLimit = Math.floor((box.w - 16) / CHAR_W);
  const attrs = [...box.fields.map(fieldLine), ...box.variants.map(variantLine)];
  const shownAttrs = attrs.slice(0, FIELD_CAP);
  const shownOps = box.ops.slice(0, OP_CAP);
  const attrTop = HEADER_H + 4;
  const opsTop = attrTop + shownAttrs.length * ROW_H + (shownAttrs.length ? 6 : 0);
  const h = detail ? box.h : HEADER_H;

  return (
    <g transform={`translate(${box.x},${box.y})`} onClick={() => onSelect(box.id)} style={{ cursor: "pointer" }}>
      <rect width={box.w} height={h} rx={7} fill="#121a26" stroke={selected ? "#ffffff" : color} strokeWidth={selected ? 2.2 : 1.2} filter="url(#flatShadow)" />
      <path d={`M0,${HEADER_H} L0,7 Q0,0 7,0 L${box.w - 7},0 Q${box.w},0 ${box.w},7 L${box.w},${HEADER_H} Z`} fill={color} />
      <text x={8} y={13} className="diag-tag" fill={textOn(color)}>{kindTag(box.kind)}</text>
      <text x={8} y={25} className="diag-title" fill={textOn(color)}>{truncate(box.title, charLimit)}</text>

      {detail && shownAttrs.map((line, i) => (
        <text key={`a${i}`} x={8} y={attrTop + 13 + i * ROW_H} className="diag-attr">{truncate(line, charLimit)}</text>
      ))}
      {detail && attrs.length > FIELD_CAP && (
        <text x={8} y={attrTop + 13 + FIELD_CAP * ROW_H} className="diag-more">+{attrs.length - FIELD_CAP} more</text>
      )}

      {detail && shownAttrs.length > 0 && box.ops.length > 0 && <line x1={0} y1={opsTop - 4} x2={box.w} y2={opsTop - 4} stroke="#2a3342" />}
      {detail && shownOps.map((op, i) => (
        <text key={op.id} x={8} y={opsTop + 13 + i * ROW_H} className="diag-op"
          onClick={(e) => { e.stopPropagation(); onDrill?.(op.id); }}>
          <title>{`${opLine(op)}  →  sequence`}</title>
          {truncate(opLine(op), charLimit)}
        </text>
      ))}
      {detail && box.ops.length > OP_CAP && (
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
    </ZoomPanSvg>
  );
}
