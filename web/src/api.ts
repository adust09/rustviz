import { Graph } from "./schema";
import { TestRun } from "./testRun";
import { CoverageReport } from "./coverage";

// Thin, validated client for the rustviz server endpoints.

/** Run the project's tests on the server (cargo test). Can take a while. */
export async function runTests(): Promise<TestRun> {
  const res = await fetch("/api/tests", { method: "POST" });
  if (!res.ok) {
    throw new Error(`tests failed: ${res.status} ${await res.text()}`);
  }
  return TestRun.parse(await res.json());
}

/** Get the last cached test run without running anything (null if none yet). */
export async function getCachedTests(): Promise<TestRun | null> {
  const res = await fetch("/api/tests");
  if (!res.ok) {
    throw new Error(`tests cache failed: ${res.status}`);
  }
  const json = await res.json();
  return json === null ? null : TestRun.parse(json);
}

/** Run `cargo llvm-cov` on the server. Builds with instrumentation — slow. */
export async function runCoverage(): Promise<CoverageReport> {
  const res = await fetch("/api/coverage", { method: "POST" });
  if (!res.ok) {
    throw new Error(`coverage failed: ${res.status} ${await res.text()}`);
  }
  return CoverageReport.parse(await res.json());
}

/** Get the last cached coverage report (null if none run yet). */
export async function getCachedCoverage(): Promise<CoverageReport | null> {
  const res = await fetch("/api/coverage");
  if (!res.ok) {
    throw new Error(`coverage cache failed: ${res.status}`);
  }
  const json = await res.json();
  return json === null ? null : CoverageReport.parse(json);
}

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
