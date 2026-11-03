// Shadow execution; package scripts do not replace the existing full test route.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { root, routeEntries, runners } from "./test-routing.mjs";

const [lane, ...tail] = process.argv.slice(2);
const filters = tail[0] === "--" ? tail.slice(1) : tail;
const entries = routeEntries(lane);
for (const file of filters)
  assert(
    entries.some((entry) => entry.path === file),
    `Unknown or out-of-route test: ${file}`,
  );
const selected = filters.length ? entries.filter((entry) => filters.includes(entry.path)) : entries;
assert(selected.length > 0, "Empty shadow selection");
assert.equal(process.versions.node, "24.22.1", "Use the repository-pinned Node 24.22.1");
console.log(
  `SHADOW ONLY: ${lane}; ${selected.length} source files; no provider-conformance or complete-coverage claim.`,
);
let dispatched = 0;
for (const runner of runners) {
  const files = selected.filter((entry) => entry.runner === runner).map((entry) => entry.path);
  if (!files.length) continue;
  const invocations =
    runner === "vitest"
      ? [
          [
            process.execPath,
            [
              resolve(root, "node_modules/vitest/vitest.mjs"),
              "run",
              "--config",
              `vitest.${lane}-shadow.config.ts`,
              "--reporter=verbose",
              ...files,
            ],
          ],
        ]
      : runner === "node"
        ? [[process.execPath, ["--test", ...files]]]
        : runner === "python"
          ? files.map((file) => ["python3", ["-B", file]])
          : assert.fail(`No dispatch for runner: ${runner}`);
  for (const [command, args] of invocations) {
    const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Shadow test interrupted by ${result.signal}`);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  dispatched += files.length;
}

assert.equal(dispatched, selected.length, "Selected test files were not all dispatched");
console.log(`SHADOW ONLY: dispatched ${dispatched} source files.`);
