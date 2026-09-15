import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SCHEMA_GRAPH_POLICY } from "./installed-schema-graph.js";

it("requires explicit private interpretation-policy review when pinned source changes", () => {
  const pin: { policy: string; files: Record<string, string> } = JSON.parse(
    readFileSync(new URL("../test-support/schema-graph-policy.json", import.meta.url), "utf8"),
  );
  expect(pin.policy).toBe(SCHEMA_GRAPH_POLICY);
  // Keep the required owning modules visible here so removing a manifest row
  // cannot silently weaken this guard. This is a review tripwire, not a proof
  // that a manually updated policy string encodes all program semantics.
  expect(Object.keys(pin.files).sort()).toEqual(
    [
      "packages/server/src/installed-schema-graph.ts",
      "packages/server/src/installed-schema-shape.ts",
      "packages/server/src/installed-schema-uri.ts",
      "packages/server/src/installed-schema-builtins.ts",
      "packages/server/src/installed-contract-artifact.ts",
      "packages/protocol/src/json-admission.ts",
      "packages/protocol/src/read-values.ts",
      "packages/protocol/src/type-conformance.ts",
      "packages/protocol/src/index.ts",
      "packages/protocol/src/json-values.ts",
      "packages/protocol/src/protocol-errors.ts",
      "packages/protocol/src/schema-formats.ts",
      "packages/protocol/schemas/bdp-v0.schema.json",
      "pnpm-lock.yaml",
    ].sort(),
  );
  for (const [file, sha256] of Object.entries(pin.files)) {
    expect(
      createHash("sha256")
        .update(readFileSync(new URL(`../../../${file}`, import.meta.url)))
        .digest("hex"),
      `${file}: review interpretation and the private version rule before refreshing this pin`,
    ).toBe(sha256);
  }
});
