import { defineConfig } from "vitest/config";

import base from "./vitest.config.js";

/**
 * The packaged cohort generator runs under the same source aliases as the
 * test suite but is deliberately outside `pnpm test`: it launches packaged
 * server processes, drives real bd workspaces, and writes the evidence
 * artifact. Invoke it explicitly with `pnpm evidence:generate` after a full
 * `pnpm build` on a clean tree.
 */
export default defineConfig({
  resolve: base.resolve ?? {},
  test: {
    coverage: { enabled: false },
    include: ["scripts/generate-read-cohort.mts"],
    passWithNoTests: false,
    testTimeout: 1_800_000,
    hookTimeout: 120_000,
  },
});
