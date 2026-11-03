import { defineConfig } from "vitest/config";

import { routeFiles } from "./scripts/test-routing.mjs";
import base from "./vitest.config.js";

// Shadow only: preserve the base source aliases and admission setup unchanged.
export default defineConfig({
  ...base,
  test: { ...base.test, include: routeFiles("current", "vitest"), passWithNoTests: false },
});
