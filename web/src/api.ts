import { Graph } from "./schema";

// Thin, validated client for the rustviz server endpoints.

export async function fetchGraph(path?: string): Promise<Graph> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(path ? { path } : {}),
  });
  if (!res.ok) {
    throw new Error(`analyze failed: ${res.status} ${await res.text()}`);
  }
  return Graph.parse(await res.json());
}

export async function fetchSource(
  file: string,
  start: number,
  end: number,
): Promise<string> {
  const params = new URLSearchParams({
    file,
    start: String(start),
    end: String(end),
  });
  const res = await fetch(`/api/source?${params}`);
  if (!res.ok) {
    throw new Error("source unavailable");
  }
  return res.text();
}
