import { z } from "zod";

// Mirrors `server/src/coverage.rs` (serde). Per-file line coverage from
// `cargo llvm-cov`, validated at the network boundary.

export const FileCoverage = z.object({
  file: z.string(),
  covered: z.number(),
  total: z.number(),
  pct: z.number(),
});
export type FileCoverage = z.infer<typeof FileCoverage>;

export const CoverageReport = z.object({
  files: z.array(FileCoverage),
  covered: z.number(),
  total: z.number(),
  pct: z.number(),
  ok: z.boolean(),
  error: z.string().optional(),
  ran_at: z.string(),
});
export type CoverageReport = z.infer<typeof CoverageReport>;
