import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  discoveredTests,
  readManifest,
  root,
  routeEntries,
  validateManifest,
} from "./test-routing.mjs";

const manifest = readManifest(),
  paths = discoveredTests();
test("every discovered test has one explicit assignment, with shared overlap declared", () => {
  validateManifest(manifest, paths);
  const current = routeEntries("current").map((entry) => entry.path),
    legacy = routeEntries("legacy").map((entry) => entry.path);
  assert.deepEqual(
    current.filter((path) => legacy.includes(path)).sort(),
    manifest.tests
      .filter((entry) => entry.lane === "shared")
      .map((entry) => entry.path)
      .sort(),
  );
  assert(
    manifest.tests.some(
      (entry) =>
        entry.path === "scripts/canonical-cli.node-test.mjs" &&
        entry.runner === "node" &&
        entry.lane === "current",
    ),
  );
  assert(
    manifest.tests.some(
      (entry) => entry.path === "scripts/e2e-ready.test.mjs" && entry.lane === "legacy",
    ),
  );
});
test("unassigned, stale, duplicate, unknown-lane and wrong-runner accounting fails closed", () => {
  assert.throws(() => validateManifest(manifest, [...paths, "packages/new/src/new.test.ts"]));
  assert.throws(() => validateManifest(manifest, paths.slice(1)));
  for (const entry of [
    { ...manifest.tests[0], lane: "future" },
    { ...manifest.tests[0], runner: "node" },
    { ...manifest.tests[0], reason: "" },
  ]) {
    const changed = structuredClone(manifest);
    changed.tests[0] = entry;
    assert.throws(() => validateManifest(changed, paths));
  }
  const duplicate = structuredClone(manifest);
  duplicate.tests.push(duplicate.tests[0]);
  assert.throws(() => validateManifest(duplicate, paths));
  assert.throws(() => routeEntries("all"));
});
test("original full command, CI and base admission setup remain outside shadow routing", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.test, "vitest run --reporter=verbose");
  assert.equal(pkg.scripts["evidence:generate"], "vitest run --config vitest.evidence.config.ts");
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  assert(!workflow.includes(":shadow"));
  const base = readFileSync(resolve(root, "vitest.config.ts"), "utf8");
  assert(base.includes('setupFiles: ["./packages/server/test-support/read-conformance-mock.ts"]'));
  for (const lane of ["current", "legacy"]) {
    const config = readFileSync(resolve(root, `vitest.${lane}-shadow.config.ts`), "utf8");
    assert(config.includes("...base.test"));
    assert(!config.includes("setupFiles:"));
  }
});

test("shadow runner refuses an out-of-route file before launching its target suite", () => {
  const result = spawnSync(
    process.execPath,
    [resolve(root, "scripts/run-test-route.mjs"), "current", "apps/bdpbd/src/read-matrix.test.ts"],
    { cwd: root, encoding: "utf8", timeout: 5000 },
  );
  assert(!result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown or out-of-route test/);
  assert(!result.stdout.includes("RUN  v"));
});
