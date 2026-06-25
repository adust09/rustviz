import type { Graph, GraphNode } from "../schema";
import type { Lifeline, SeqMessage, SequenceScene } from "./types";

// Build the sequence diagram by expanding `call_steps` (ordered, resolved
// fn→fn calls) from a chosen root. Each function is expanded at most once
// (DAG-ize); `maxDepth` bounds the expansion so a focused scenario stays short
// (the call graph is dense — without a depth limit most roots reach most of
// the program).

interface OrderedCall {
  callee: string;
  order: number;
  line: number;
}

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
  const expanded = new Set<string>();
  let row = 0;

  const ensureLifeline = (id: string): void => {
    if (lifelineIndex.has(id)) return;
    lifelineIndex.set(id, lifelines.length);
    lifelines.push({
      id,
      title: shortTitle(id),
      crate: nodeById.get(id)?.crate ?? "",
      col: lifelines.length,
    });
  };

  const expand = (callerId: string, depth: number): void => {
    if (depth >= maxDepth || expanded.has(callerId)) return;
    expanded.add(callerId);
    ensureLifeline(callerId);
    const caller = nodeById.get(callerId);
    for (const call of callMap.get(callerId) ?? []) {
      ensureLifeline(call.callee);
      messages.push({
        fromId: callerId,
        toId: call.callee,
        row: row++,
        depth,
        label: nodeById.get(call.callee)?.name ?? shortTitle(call.callee),
        callLine: call.line,
        fromFile: caller?.file ?? "",
        selfCall: callerId === call.callee,
      });
      expand(call.callee, depth + 1);
    }
  };

  if (root) expand(root, 0);

  return {
    kind: "sequence",
    rootId: root,
    rootTitle: root ? shortTitle(root) : "(no entrypoint)",
    lifelines,
    messages,
    crateNames,
  };
}
