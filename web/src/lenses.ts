import type { Lens, Metrics } from "./schema";

// Pure color helpers + the lens weight formulas (ported from analyzer/src/metrics).
// No WebGL / three dependency — the architecture overview is plain SVG.

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

function rgbToHex(r: number, g: number, b: number): string {
  const f = (x: number): string => Math.round(x).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
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

/** Stable per-crate hue (golden-angle spacing). */
export function crateColor(crate: string, allCrates: readonly string[]): string {
  const idx = Math.max(0, allCrates.indexOf(crate));
  return hslToHex((idx * 137.508) % 360, 0.55, 0.55);
}

export const CYCLE_COLOR = "#ff2d55";

// --- comprehensive multi-lens coloring (RGB channel mix) ---
//
// Each metric lens drives one color channel; toggling any subset layers them
// over the structural base. The channel brightness is the tile's normalized
// 0..1 score for that metric, so every on/off combination yields a distinct
// composite color (security+performance -> yellow, all three -> near-white).

/** Per-lens display color, matching its RGB channel. */
export const CHANNEL_COLOR: Record<Lens, string> = {
  security: "#ff4d4d", // red channel
  performance: "#4dff6a", // green channel
  complexity: "#4d8bff", // blue channel
};

// A small floor keeps low-score / disabled channels visible (never pure black)
// against the dark crate container.
const CHANNEL_FLOOR = 26;

function channel(on: boolean, score: number): number {
  return on ? CHANNEL_FLOOR + clamp01(score) * (255 - CHANNEL_FLOOR) : CHANNEL_FLOOR;
}

/** Tile fill for the active metric set, mixed across R (sec) / G (perf) / B (cmpx). */
export function mixColor(active: ReadonlySet<Lens>, score: Record<Lens, number>): string {
  return rgbToHex(
    channel(active.has("security"), score.security),
    channel(active.has("performance"), score.performance),
    channel(active.has("complexity"), score.complexity),
  );
}

/** Mean of the active metrics' scores (0 when none active) — used for ranking. */
export function meanScore(active: ReadonlySet<Lens>, score: Record<Lens, number>): number {
  if (active.size === 0) return 0;
  let sum = 0;
  for (const l of active) sum += score[l];
  return sum / active.size;
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
  return m.cyclomatic * 1 + m.max_nesting * 1.5;
}
