import { z } from "zod";

// Mirrors `server/src/tests.rs` (serde, snake_case; enums lowercase). Validated
// at the network boundary like the analyze Graph contract.

export const TestKind = z.enum(["unit", "integration", "doc"]);
export type TestKind = z.infer<typeof TestKind>;

export const TestStatus = z.enum(["passed", "failed", "ignored"]);
export type TestStatus = z.infer<typeof TestStatus>;

export const TestCase = z.object({
  name: z.string(),
  status: TestStatus,
  message: z.string().optional(),
});
export type TestCase = z.infer<typeof TestCase>;

export const Suite = z.object({
  name: z.string(),
  crate: z.string(),
  kind: TestKind,
  tests: z.array(TestCase),
  passed: z.number(),
  failed: z.number(),
  ignored: z.number(),
  duration_ms: z.number(),
});
export type Suite = z.infer<typeof Suite>;

export const TestRun = z.object({
  suites: z.array(Suite),
  passed: z.number(),
  failed: z.number(),
  ignored: z.number(),
  duration_ms: z.number(),
  ok: z.boolean(),
  error: z.string().optional(),
  ran_at: z.string(),
});
export type TestRun = z.infer<typeof TestRun>;
