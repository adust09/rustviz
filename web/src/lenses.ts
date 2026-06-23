import { Color } from "three";
import type { GraphNode, Lens } from "./schema";

// Pure "metric -> visual" mapping. Adding a new evaluation lens means adding one
// branch here; the analyzer and the rest of the app are untouched.

export interface Visual {
  color: string;
  /** Node volume passed to 3d-force-graph `nodeVal`. */
  size: number;
}

const CYCLE_COLOR = "#ff2d55";

/** Stable per-crate hue for the architecture lens. */
export function crateColor(crate: string, allCrates: readonly string[]): string {
  const idx = Math.max(0, allCrates.indexOf(crate));
  const hue = (idx * 137.508) % 360; // golden-angle spacing avoids similar hues
  return new Color().setHSL(hue / 360, 0.6, 0.6).getStyle();
}

function lerp(a: string, b: string, t: number): string {
  return new Color(a).lerp(new Color(b), Math.min(Math.max(t, 0), 1)).getStyle();
}

/** Cool -> hot heat ramp (blue -> yellow -> red). */
function heat(t: number): string {
  return t < 0.5
    ? lerp("#2b6cff", "#ffd23f", t * 2)
    : lerp("#ffd23f", "#ff3b30", (t - 0.5) * 2);
}

/** Low -> high complexity ramp (teal -> violet). */
function violet(t: number): string {
  return lerp("#1ec8b0", "#9b30ff", t);
}

function baseSize(node: GraphNode): number {
  switch (node.kind) {
    case "crate":
      return 7;
    case "module":
      return 4;
    case "trait":
    case "struct":
    case "enum":
      return 3;
    default:
      return 1.6;
  }
}

export function nodeVisual(
  node: GraphNode,
  lens: Lens,
  allCrates: readonly string[],
): Visual {
  const m = node.metrics;
  const base = baseSize(node);
  switch (lens) {
    case "architecture":
      return {
        color: m.architecture.in_cycle
          ? CYCLE_COLOR
          : crateColor(node.crate, allCrates),
        size: base + Math.min(m.architecture.fan_in, 12) * 0.4,
      };
    case "security":
      return {
        color: heat(m.security.score),
        size: base + m.security.score * 6,
      };
    case "performance":
      return {
        color: heat(m.performance.score),
        size: base + m.performance.score * 6,
      };
    case "complexity":
      return {
        color: violet(m.complexity.score),
        size: base + m.complexity.score * 6,
      };
  }
}

/** Score for the active lens, used by the inspector and search ranking. */
export function lensScore(node: GraphNode, lens: Lens): number {
  return node.metrics[lens].score;
}
