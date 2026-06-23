import type { Lens, Metrics } from "./schema";

// Pure color helpers + the lens weight formulas (ported from analyzer/src/metrics).
// No WebGL / three dependency — the architecture overview is plain SVG.

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function hexToRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const f = (x: number): string => Math.round(x).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const u = clamp01(t);
  return rgbToHex(ar + (br - ar) * u, ag + (bg - ag) * u, ab + (bb - ab) * u);
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

/** Cool -> hot heat ramp (blue -> yellow -> red). */
export function heat(t: number): string {
  return t < 0.5 ? lerpHex("#243b6b", "#ffd23f", t * 2) : lerpHex("#ffd23f", "#ff3b30", (t - 0.5) * 2);
}

/** Low -> high complexity ramp (teal -> violet). */
export function violet(t: number): string {
  return lerpHex("#15695d", "#b14bff", t);
}

/** Stable per-crate hue (golden-angle spacing). */
export function crateColor(crate: string, allCrates: readonly string[]): string {
  const idx = Math.max(0, allCrates.indexOf(crate));
  return hslToHex((idx * 137.508) % 360, 0.55, 0.55);
}

export const CYCLE_COLOR = "#ff2d55";

/** Tile fill for a metric lens and its normalized 0..1 score. */
export function tileColor(lens: Lens, score: number): string {
  return lens === "complexity" ? violet(score) : heat(score);
}

// --- lens weight formulas (must match analyzer/src/metrics/*.rs) ---

export function securityRaw(m: Metrics["security"]): number {
  return (
    m.unsafe_blocks * 3 +
    m.transmute * 3 +
    m.raw_ptr * 2 +
    m.panics * 1.5 +
    m.unwraps * 1 +
    m.expects * 0.8 +
    m.lossy_casts * 0.5
  );
}

export function performanceRaw(m: Metrics["performance"]): number {
  return (
    m.nested_loops * 3 +
    m.recursion * 2 +
    m.allocs * 1 +
    m.clones * 1 +
    m.collects * 0.8 +
    m.async_points * 0.3
  );
}

export function complexityRaw(m: Metrics["complexity"]): number {
  return m.cyclomatic * 1 + m.max_nesting * 1.5 + m.loc * 0.05;
}
