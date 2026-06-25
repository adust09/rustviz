import type { Graph, GraphNode } from "../schema";
import type { EREntity, ERField, ERRelation, ERScene } from "./types";

// Build the ER (KV-storage schema) diagram from `graph.tables`. Each table is a
// `Key -> Value` entity; the value type (when it resolves to a workspace struct)
// supplies the field rows. Relationships are DERIVED here (not in the analyzer),
// the same seam as structureScene/sequenceScene deriving edges:
//   - cokey: tables in one store sharing a normalized key type (same primary key)
//   - fk:    a value-struct field whose type composes another table's value type

const BOX_W = 220;
const HEADER_H = 48; // title + key→value line
const FIELD_H = 16;
const FIELD_PAD = 10;
const MAX_FIELDS = 9;
const GAP = 40;

/** Strip references / common wrappers / paths / generics to a base type name.
 *  `&'a Option<Vec<crate::H256>>` → `H256`; `[u8; 32]` → `[u8; 32]` (unchanged). */
export function normalizeBase(ty: string): string {
  let t = ty.trim().replace(/^&\s*(mut\s+)?/g, "").replace(/^'[a-z]+\s+/i, "").trim();
  for (const wrap of ["Option", "Vec", "Box", "Arc", "Rc"]) {
    const m = new RegExp(`^${wrap}\\s*<(.+)>$`).exec(t);
    if (m) {
      t = m[1].trim();
      break;
    }
  }
  const lt = t.indexOf("<");
  if (lt !== -1) t = t.slice(0, lt);
  const seg = t.split("::");
  return seg[seg.length - 1].trim();
}

interface RawEntity {
  ent: EREntity;
  store: string;
  keyBase: string;
  valueBase: string;
}

export function buildERScene(graph: Graph): ERScene {
  const crateNames = [...new Set(graph.nodes.filter((n) => n.kind === "crate").map((n) => n.name))];
  const nodeById = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));

  // 1) Flatten tables → raw entities, attaching the resolved value struct's fields.
  const raws: RawEntity[] = [];
  for (const t of graph.tables) {
    for (const v of t.variants) {
      const node = v.value_node_id ? nodeById.get(v.value_node_id) : undefined;
      raws.push({
        store: t.enum_name,
        keyBase: normalizeBase(v.key),
        valueBase: normalizeBase(v.value),
        ent: {
          id: `${t.enum_id}::${v.name}`,
          table: v.name,
          key: v.key,
          value: v.value,
          store: t.enum_name,
          crate: node?.crate ?? t.enum_id.split("::")[0] ?? "",
          fields: (node?.fields ?? []).slice(0, MAX_FIELDS).map<ERField>((f) => ({
            name: f.name,
            ty: f.ty,
            fkKey: false, // set below once every table's key type is known
          })),
          srcFile: node?.file ?? t.file,
          srcLine: node?.span.start_line ?? t.line,
          x: 0,
          y: 0,
          w: BOX_W,
          h: HEADER_H,
        },
      });
    }
  }

  // 2) Mark fields whose type references some table's key type (e.g. parent_root:
  //    H256), and size each box to its field count.
  const keyBases = new Set(raws.map((r) => r.keyBase).filter(Boolean));
  for (const r of raws) {
    for (const f of r.ent.fields) f.fkKey = keyBases.has(normalizeBase(f.ty));
    r.ent.h = HEADER_H + FIELD_PAD + Math.max(1, r.ent.fields.length) * FIELD_H;
  }

  // 3) Relationships (derived).
  const relations = deriveRelations(raws);

  // 4) Uniform-grid layout (cell = widest box × tallest box) so edges read cleanly.
  const n = raws.length;
  const cols = Math.max(1, Math.min(4, Math.round(Math.sqrt(n)) || 1));
  const maxH = raws.reduce((m, r) => Math.max(m, r.ent.h), HEADER_H);
  const cellW = BOX_W + GAP;
  const cellH = maxH + GAP;
  raws.forEach((r, i) => {
    r.ent.x = GAP + (i % cols) * cellW;
    r.ent.y = GAP + Math.floor(i / cols) * cellH;
  });
  const rows = Math.ceil(n / cols) || 1;

  return {
    kind: "er",
    entities: raws.map((r) => r.ent),
    relations,
    stores: graph.tables.map((t) => ({ name: t.enum_name, count: t.variants.length })),
    crateNames,
    worldW: GAP + cols * cellW,
    worldH: GAP + rows * cellH,
  };
}

function deriveRelations(raws: RawEntity[]): ERRelation[] {
  const out: ERRelation[] = [];
  const seen = new Set<string>();
  const push = (from: string, to: string, kind: ERRelation["kind"], label: string): void => {
    if (from === to) return;
    const k = `${from}|${to}|${kind}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ from, to, kind, label });
  };
  const bucket = <T>(map: Map<string, T[]>, key: string, item: T): void => {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  };

  // cokey: chain tables of one store that share a normalized key type.
  const byStoreKey = new Map<string, RawEntity[]>();
  for (const r of raws) {
    if (r.keyBase) bucket(byStoreKey, `${r.store}|${r.keyBase}`, r);
  }
  for (const group of byStoreKey.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.ent.table.localeCompare(b.ent.table));
    for (let i = 1; i < sorted.length; i++) {
      push(sorted[i - 1].ent.id, sorted[i].ent.id, "cokey", sorted[i].keyBase);
    }
  }

  // fk: a value-struct field whose base type equals another table's value type.
  const byValueBase = new Map<string, RawEntity[]>();
  for (const r of raws) {
    if (r.valueBase) bucket(byValueBase, r.valueBase, r);
  }
  for (const r of raws) {
    for (const f of r.ent.fields) {
      const targets = byValueBase.get(normalizeBase(f.ty));
      if (!targets) continue;
      for (const tgt of targets) push(r.ent.id, tgt.ent.id, "fk", f.name);
    }
  }

  return out;
}
