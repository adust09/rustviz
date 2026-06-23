import type { FieldDef, VariantDef, Visibility } from "../schema";
import type { BoxOp } from "./types";

// Pure text/format helpers shared by every renderer (flat / iso / 3d). Turns
// UML detail into the compact one-liners shown inside class boxes.

export function visSigil(v: Visibility): string {
  return v === "public" ? "+" : v === "pubcrate" ? "~" : "-";
}

export function fieldLine(f: FieldDef): string {
  return `${visSigil(f.visibility)} ${f.name}: ${f.ty}`;
}

export function variantLine(v: VariantDef): string {
  return v.payload.length ? `${v.name}(${v.payload.join(", ")})` : v.name;
}

export function opLine(op: BoxOp): string {
  const sig = op.signature;
  const params = sig ? sig.params.filter((p) => p.name !== "self").map((p) => p.name).join(", ") : "";
  const ret = sig && sig.return_type !== "()" ? `: ${sig.return_type}` : "";
  const asyncKw = sig?.is_async ? "async " : "";
  return `${visSigil(op.visibility)} ${asyncKw}${op.name}(${params})${ret}`;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const KIND_TAG: Record<string, string> = {
  struct: "«struct»",
  enum: "«enum»",
  trait: "«trait»",
  modulefns: "«module»",
};

export function kindTag(kind: string): string {
  return KIND_TAG[kind] ?? "";
}

/** Perceptual luminance → pick dark or light text for a hex background. */
export function textOn(hex: string): string {
  const s = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#10141b" : "#eef2f8";
}
