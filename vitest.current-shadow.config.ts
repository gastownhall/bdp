import { defineConfig } from "vitest/config";

import { routeFiles } from "./scripts/test-routing.mjs";
import base from "./vitest.config.js";

// Shadow only: retain source aliases; current reference tests use no historical admission setup.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: routeFiles("current", "vitest"),
    setupFiles: ["./scripts/current-shadow-admission-setup.mjs"],
    passWithNoTests: false,
  },
});
