import type { GraphEdge } from "./schema";

// Static call-flow simulation: a depth-first walk of the `calls` graph from an
// entry point. This is derived from static analysis, not a real runtime trace.

export interface SimStep {
  node: string;
  /** Caller id, or null for the entry point. */
  from: string | null;
  depth: number;
  /** Virtual call stack at this step (entry .. current). */
  stack: string[];
}

export function buildAdjacency(edges: readonly GraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "calls") continue;
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  return adj;
}

/**
 * Produce an ordered step list. Each function is entered once (a global visited
 * set keeps cyclic call graphs finite). `maxSteps` bounds very large projects.
 */
export function buildSteps(
  adj: Map<string, string[]>,
  entry: string,
  maxSteps = 600,
): SimStep[] {
  const steps: SimStep[] = [];
  const visited = new Set<string>();
  const stack: string[] = [];

  const dfs = (node: string, from: string | null): void => {
    if (steps.length >= maxSteps || visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    steps.push({ node, from, depth: stack.length - 1, stack: [...stack] });
    for (const next of adj.get(node) ?? []) {
      dfs(next, node);
    }
    stack.pop();
  };

  dfs(entry, null);
  return steps;
}
