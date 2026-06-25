import type { Graph, GraphNode } from "../schema";
import type { Activation, Lifeline, SeqMessage, SequenceScene } from "./types";

// Build a UML sequence diagram by walking `call_steps` (ordered, resolved fn→fn
// calls) as a real call TREE from a chosen root: each call emits a solid request
// arrow, an activation bar on the callee while it runs, and a dashed RETURN arrow
// back to the caller (labelled with the callee's return type). A recursion-stack
// guard stops cycles/recursion from expanding forever; `maxDepth` and a message
// cap keep a focused scenario short (the call graph is dense).

interface OrderedCall {
  callee: string;
  order: number;
  line: number;
}

const MAX_MESSAGES = 320; // hard cap so a dense root can't explode the diagram

function callMapOf(graph: Graph): Map<string, OrderedCall[]> {
  const map = new Map<string, OrderedCall[]>();
  for (const s of graph.call_steps) {
    const list = map.get(s.caller) ?? [];
    list.push({ callee: s.callee, order: s.order, line: s.call_line });
    map.set(s.caller, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
}

/** Last two path segments, e.g. `graph::assemble` — disambiguates same-named fns. */
function shortTitle(id: string): string {
  return id.split("::").slice(-2).join("::");
}

/** Pick the root fn: an explicit focus, else the first entrypoint, else the
 *  fn that originates the most calls. */
function pickRoot(graph: Graph, focusId: string | null, callMap: Map<string, OrderedCall[]>): string | null {
  const fnIds = new Set(graph.nodes.filter((n) => n.kind === "fn").map((n) => n.id));
  if (focusId && fnIds.has(focusId)) return focusId;
  const entry = graph.entrypoints.find((id) => fnIds.has(id));
  if (entry) return entry;
  let best: string | null = null;
  let bestN = 0;
  for (const [id, calls] of callMap) {
    if (calls.length > bestN) {
      best = id;
      bestN = calls.length;
    }
  }
  return best;
}

export function buildSequenceScene(graph: Graph, focusId: string | null, maxDepth = 4): SequenceScene {
  const crateNames = [...new Set(graph.nodes.filter((n) => n.kind === "crate").map((n) => n.name))];
  const nodeById = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const callMap = callMapOf(graph);
  const root = pickRoot(graph, focusId, callMap);

  const lifelines: Lifeline[] = [];
  const lifelineIndex = new Map<string, number>();
  const messages: SeqMessage[] = [];
  const activations: Activation[] = [];
  let row = 0;
  let callCount = 0;
  let truncated = false;

  const ensureLifeline = (id: string): number => {
    const existing = lifelineIndex.get(id);
    if (existing !== undefined) return existing;
    const col = lifelines.length;
    lifelineIndex.set(id, col);
    const node = nodeById.get(id);
    lifelines.push({
      id,
      title: shortTitle(id),
      crate: node?.crate ?? "",
      col,
      file: node?.file ?? "",
      start: node?.span.start_line ?? 0,
      end: node?.span.end_line ?? 0,
    });
    return col;
  };

  /** Callee's return type, blank for the unit return `()` (the dashed arrow alone
   *  already reads as "control returns"). */
  const returnLabel = (id: string): string => {
    const rt = nodeById.get(id)?.signature?.return_type;
    return rt && rt !== "()" ? rt : "";
  };

  // Expand `callerId`'s calls in source order. `stack` holds the ancestors on the
  // current path so a callee already in flight is not re-expanded (recursion/cycle).
  const expand = (callerId: string, depth: number, stack: Set<string>): void => {
    if (depth >= maxDepth) return;
    const caller = nodeById.get(callerId);
    for (const call of callMap.get(callerId) ?? []) {
      if (messages.length >= MAX_MESSAGES) {
        truncated = true;
        return;
      }
      const calleeCol = ensureLifeline(call.callee);
      const isSelf = callerId === call.callee;
      const callRow = row++;
      callCount++;
      messages.push({
        kind: "call",
        fromId: callerId,
        toId: call.callee,
        row: callRow,
        depth,
        label: nodeById.get(call.callee)?.name ?? shortTitle(call.callee),
        callLine: call.line,
        fromFile: caller?.file ?? "",
        selfCall: isSelf,
      });

      // A self-call's loop already implies its return; don't draw a separate one.
      if (isSelf) continue;

      // Recursion/cycle: show the call + an immediate return, but don't re-expand.
      if (!stack.has(call.callee)) {
        const next = new Set(stack);
        next.add(call.callee);
        expand(call.callee, depth + 1, next);
      }

      const retRow = row++;
      messages.push({
        kind: "return",
        fromId: call.callee,
        toId: callerId,
        row: retRow,
        depth,
        label: returnLabel(call.callee),
        callLine: call.line,
        fromFile: "",
        selfCall: false,
      });
      activations.push({ id: call.callee, col: calleeCol, startRow: callRow, endRow: retRow, depth: depth + 1 });
    }
  };

  if (root) {
    ensureLifeline(root);
    expand(root, 0, new Set([root]));
    // The root is active for the whole interaction.
    if (messages.length) activations.push({ id: root, col: 0, startRow: 0, endRow: row, depth: 0 });
  }

  return {
    kind: "sequence",
    rootId: root,
    rootTitle: root ? shortTitle(root) : "(no entrypoint)",
    lifelines,
    messages,
    activations,
    callCount,
    truncated,
    crateNames,
  };
}
