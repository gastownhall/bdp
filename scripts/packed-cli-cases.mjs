/** Explicit test runner for one owned packed installation; no ambient override. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registerCanonicalCliCases } from "./canonical-cli-cases.mjs";

assert.equal(process.argv.length, 3, "Usage: packed-cli-cases.mjs INSTALL_ROOT");
const installRoot = path.resolve(process.argv[2]);
const consumer = createRequire(path.join(installRoot, "packed-cli-consumer.cjs"));
const { startReferenceService } = await import(
  pathToFileURL(consumer.resolve("@bdp/server/reference")).href
);
registerCanonicalCliCases({
  binary: path.join(installRoot, "node_modules", ".bin", "bdp"),
  startReferenceService,
});
