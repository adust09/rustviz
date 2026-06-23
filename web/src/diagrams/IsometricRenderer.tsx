import { crateColor } from "../lenses";
import { fieldLine, kindTag, opLine, textOn, truncate, variantLine } from "./format";
import { FlatSequence } from "./LayeredRenderer";
import { useContainerSize } from "./useSize";
import type { RendererProps, DiagramScene, StructureBox, StructureScene } from "./types";

// Isometric 2.5D renderer. The structure diagram is drawn as a true isometric
// diorama: crate slabs are floor parallelograms, type boxes are upright
// readable cards standing on the floor (with a projected shadow + stem), depth
// sorted so near cards occlude far ones. The sequence diagram — a tall temporal
// plane — instead reuses the flat layout tilted back into 3D.

const ISO_COS = Math.cos(Math.PI / 6); // 0.866
const ISO_SIN = 0.5;
const PAD = 60;
const CARD_W = 172;
const CARD_HEAD = 26;
const CARD_ROW = 15;
const CARD_LIFT = 30;
const ISO_FIELD_CAP = 4;
const ISO_OP_CAP = 4;
const CHAR_W = 6.1;

interface P {
  sx: number;
  sy: number;
}

function project(wx: number, wy: number): P {
  return { sx: (wx - wy) * ISO_COS, sy: (wx + wy) * ISO_SIN };
}

export function IsometricRenderer(props: RendererProps<DiagramScene>): JSX.Element {
  const { scene, ...rest } = props;
  if (scene.kind === "sequence") {
    return (
      <div className="iso-tilt">
        <FlatSequence scene={scene} {...rest} />
      </div>
    );
  }
  return <IsoStructure scene={scene} {...rest} />;
}

function cardHeight(box: StructureBox): number {
  const attrs = Math.min(box.fields.length + box.variants.length, ISO_FIELD_CAP);
  const ops = Math.min(box.ops.length, ISO_OP_CAP);
  return CARD_HEAD + (attrs + ops) * CARD_ROW + 8;
}

interface Placed {
  box: StructureBox;
  anchor: P; // floor point under the card
  left: number;
  top: number;
  h: number;
}

function IsoStructure({ scene, selectedId, onSelect, onDrillToSequence }: RendererProps<StructureScene>): JSX.Element {
  const [ref, size] = useContainerSize<HTMLDivElement>();

  const placed: Placed[] = scene.boxes.map((box) => {
    const anchor = project(box.x + box.w / 2, box.y + box.h / 2);
    const h = cardHeight(box);
    return { box, anchor, left: anchor.sx - CARD_W / 2, top: anchor.sy - CARD_LIFT - h, h };
  });
  // Far (small x+y) first so near cards draw on top.
  placed.sort((a, b) => a.box.x + a.box.y - (b.box.x + b.box.y));
  const anchorOf = new Map(placed.map((p) => [p.box.id, p.anchor]));

  const slabPolys = scene.crateSlabs.map((s) => ({
    slab: s,
    pts: [
      project(s.x, s.y),
      project(s.x + s.w, s.y),
      project(s.x + s.w, s.y + s.h),
      project(s.x, s.y + s.h),
    ],
  }));

  // Translate the whole projected scene into the positive quadrant.
  const xs = [...placed.flatMap((p) => [p.left, p.left + CARD_W]), ...slabPolys.flatMap((s) => s.pts.map((p) => p.sx))];
  const ys = [...placed.flatMap((p) => [p.top, p.anchor.sy]), ...slabPolys.flatMap((s) => s.pts.map((p) => p.sy))];
  const ox = PAD - Math.min(...xs);
  const oy = PAD - Math.min(...ys);
  const w = Math.max(...xs) - Math.min(...xs) + PAD * 2;
  const h = Math.max(...ys) - Math.min(...ys) + PAD * 2;
  const vw = Math.max(w, size.w);
  const vh = Math.max(h, size.h);

  return (
    <div ref={ref} className="diag-scroll">
      <svg width={vw} height={vh} viewBox={`0 0 ${vw} ${vh}`}>
        <defs>
          <filter id="isoShadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor="#000" floodOpacity="0.5" />
          </filter>
          <marker id="isoArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#9aa6b6" />
          </marker>
        </defs>
        <g transform={`translate(${ox},${oy})`}>
          {/* floor slabs */}
          {slabPolys.map(({ slab, pts }) => (
            <g key={slab.id}>
              <polygon
                points={pts.map((p) => `${p.sx},${p.sy}`).join(" ")}
                fill="#0c111b"
                stroke={crateColor(slab.crate, scene.crateNames)}
                strokeOpacity={0.55}
                strokeWidth={1.5}
              />
              <text x={pts[0].sx + 10} y={pts[0].sy + 4} className="diag-crate">{slab.title}</text>
            </g>
          ))}

          {/* call / impls edges along the floor */}
          {scene.edges.map((e, i) => {
            const a = anchorOf.get(e.source);
            const b = anchorOf.get(e.target);
            if (!a || !b) return null;
            const impl = e.kind === "impls";
            return (
              <line
                key={`${e.source}->${e.target}-${i}`}
                x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy}
                stroke={impl ? "#7d8aa0" : "#3d5478"}
                strokeWidth={1}
                strokeDasharray={impl ? "5 4" : undefined}
                opacity={0.35}
                markerEnd="url(#isoArrow)"
              />
            );
          })}

          {/* shadows + upright cards, depth sorted */}
          {placed.map((p) => (
            <IsoCard
              key={p.box.id}
              p={p}
              crateNames={scene.crateNames}
              selected={selectedId === p.box.id}
              onSelect={onSelect}
              onDrill={onDrillToSequence}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function IsoCard(props: {
  p: Placed;
  crateNames: string[];
  selected: boolean;
  onSelect: (id: string) => void;
  onDrill?: (id: string) => void;
}): JSX.Element {
  const { p, crateNames, selected, onSelect, onDrill } = props;
  const { box, anchor, left, top, h } = p;
  const color = crateColor(box.crate, crateNames);
  const charLimit = Math.floor((CARD_W - 16) / CHAR_W);
  const attrs = [...box.fields.map(fieldLine), ...box.variants.map(variantLine)].slice(0, ISO_FIELD_CAP);
  const ops = box.ops.slice(0, ISO_OP_CAP);
  const attrTop = top + CARD_HEAD + 3;
  const opsTop = attrTop + attrs.length * CARD_ROW + (attrs.length ? 4 : 0);

  return (
    <g style={{ cursor: "pointer" }} onClick={() => onSelect(box.id)}>
      {/* floor footprint shadow */}
      <ellipse cx={anchor.sx} cy={anchor.sy} rx={CARD_W / 2.4} ry={12} fill="#000" opacity={0.28} />
      {/* stem from floor to card */}
      <line x1={anchor.sx} y1={anchor.sy} x2={anchor.sx} y2={top + h} stroke={color} strokeOpacity={0.5} strokeWidth={1} />
      {/* card */}
      <rect x={left} y={top} width={CARD_W} height={h} rx={7} fill="#121a26" stroke={selected ? "#ffffff" : color} strokeWidth={selected ? 2.2 : 1.2} filter="url(#isoShadow)" />
      <path d={`M${left},${top + CARD_HEAD} L${left},${top + 7} Q${left},${top} ${left + 7},${top} L${left + CARD_W - 7},${top} Q${left + CARD_W},${top} ${left + CARD_W},${top + 7} L${left + CARD_W},${top + CARD_HEAD} Z`} fill={color} />
      <text x={left + 8} y={top + 11} className="diag-tag" fill={textOn(color)}>{kindTag(box.kind)}</text>
      <text x={left + 8} y={top + 22} className="diag-title" fill={textOn(color)}>{truncate(box.title, charLimit)}</text>
      {attrs.map((line, i) => (
        <text key={`a${i}`} x={left + 8} y={attrTop + 11 + i * CARD_ROW} className="diag-attr">{truncate(line, charLimit)}</text>
      ))}
      {attrs.length > 0 && ops.length > 0 && <line x1={left} y1={opsTop - 3} x2={left + CARD_W} y2={opsTop - 3} stroke="#2a3342" />}
      {ops.map((op, i) => (
        <text key={op.id} x={left + 8} y={opsTop + 11 + i * CARD_ROW} className="diag-op" onClick={(e) => { e.stopPropagation(); onDrill?.(op.id); }}>
          <title>{`${opLine(op)}  →  sequence`}</title>
          {truncate(opLine(op), charLimit)}
        </text>
      ))}
      {box.ops.length > ISO_OP_CAP && (
        <text x={left + 8} y={opsTop + 11 + ISO_OP_CAP * CARD_ROW} className="diag-more">+{box.ops.length - ISO_OP_CAP}</text>
      )}
    </g>
  );
}
