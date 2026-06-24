import type { Visibility } from "../schema";
import { fieldLine, kindTag, opLine, variantLine } from "./format";
import type { CrateNode, StructureBox } from "./types";

// Detail panel for the 3D code-city: click a building (type) to inspect its
// fields / variants / methods, or a district (crate) for a summary. Methods
// open their source via the shared source panel (onOpenSource).

const VIS_WORD: Record<Visibility, string> = { public: "pub", pubcrate: "pub(crate)", private: "private" };

interface DetailPanelProps {
  box: StructureBox | null;
  crate: CrateNode | null;
  onClose: () => void;
  onOpenSource: (file: string, start: number, end: number) => void;
}

export function DetailPanel({ box, crate, onClose, onOpenSource }: DetailPanelProps): JSX.Element | null {
  if (box) return <BoxDetail box={box} onClose={onClose} onOpenSource={onOpenSource} />;
  if (crate) return <CrateDetail crate={crate} onClose={onClose} />;
  return null;
}

function BoxDetail({ box, onClose, onOpenSource }: { box: StructureBox; onClose: () => void; onOpenSource: (f: string, s: number, e: number) => void }): JSX.Element {
  const attrs = [...box.fields.map(fieldLine), ...box.variants.map(variantLine)];
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <div className="detail-tag">{kindTag(box.kind) || "·fn"}</div>
          <div className="detail-name">{box.title}</div>
          <div className="detail-sub">{box.crate} · {VIS_WORD[box.visibility]}</div>
        </div>
        <button className="close" onClick={onClose}>✕</button>
      </div>

      <div className="detail-badges">
        <span className="badge">{attrs.length} attrs</span>
        <span className="badge">{box.ops.length} methods</span>
      </div>

      {attrs.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-h">attributes</div>
          {attrs.map((line, i) => (
            <div key={i} className="detail-attr">{line}</div>
          ))}
        </div>
      )}

      {box.ops.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-h">methods · click to view source</div>
          {box.ops.map((op) => (
            <div key={op.id} className="detail-op" onClick={() => onOpenSource(op.file, op.start, op.end)}>
              {opLine(op)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CrateDetail({ crate, onClose }: { crate: CrateNode; onClose: () => void }): JSX.Element {
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <div className="detail-tag">«crate»</div>
          <div className="detail-name">{crate.name}</div>
          <div className="detail-sub">dependency layer L{crate.layer}</div>
        </div>
        <button className="close" onClick={onClose}>✕</button>
      </div>
      <div className="detail-badges">
        <span className="badge">{crate.modules.length} modules</span>
        <span className="badge">{crate.boxIds.length} types</span>
      </div>
      <div className="detail-section">
        <div className="detail-section-h">modules</div>
        {crate.modules.map((m) => (
          <div key={m.id} className="detail-attr">{m.title}</div>
        ))}
      </div>
    </div>
  );
}
