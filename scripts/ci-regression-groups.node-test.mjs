/** Pure full-regression partition and independent observed-file controls. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { regressionGroups, checkExecutedFiles, groups } from "./ci-regression-groups.mjs";

const heavy = [
  "apps/bdptest/src/read-update-matrix.test.ts",
  "apps/bdptest/src/transactional-matrix.test.ts",
  "apps/bdpbd/src/read-matrix.test.ts",
];
const remaining = ["packages/config/src/config.test.ts", "scripts/smoke-safety.test.mjs"];
const inventory = [...heavy, ...remaining];
const artifact = "scripts/control.node-test.mjs";
function fixture() {
  return {
    status: "SHADOW_ONLY",
    candidateBase: "a".repeat(40),
    scope: "pure fixture",
    tests: [
      ...inventory.map((path, index) => ({
        path,
        runner: "vitest",
        lane: index === 0 || index === 3 ? "current" : "legacy",
        reason: "fixture",
      })),
      { path: artifact, runner: "node", lane: "artifact", reason: "fixture" },
    ],
  };
}
const sources = [...inventory, artifact];
const workspace = "/isolated/workspace";
function report(files = remaining) {
  return {
    success: true,
    numFailedTestSuites: 0,
    numFailedTests: 0,
    numTotalTests: 7,
    numPendingTests: 1,
    testResults: files.map((file) => ({ name: resolve(workspace, file), status: "passed" })),
  };
}
test("three named heavyweight files are isolated and every other full-config file remains once", () => {
  assert.deepEqual(groups, ["read-update-matrix", "transactional-matrix", "realbd", "other"]);
  const manifest = fixture(),
    copy = structuredClone(manifest);
  assert.deepEqual(regressionGroups(manifest, sources, inventory), {
    "read-update-matrix": [heavy[0]],
    "transactional-matrix": [heavy[1]],
    realbd: [heavy[2]],
    other: [...remaining].sort(),
  });
  assert.deepEqual(manifest, copy);
});
test("missing, duplicate, unassigned and stale accounting all refuse", () => {
  const missing = fixture();
  missing.tests.pop();
  assert.throws(() => regressionGroups(missing, sources, inventory), /Unassigned/);
  const duplicate = fixture();
  duplicate.tests.push(duplicate.tests[0]);
  assert.throws(() => regressionGroups(duplicate, sources, inventory), /Duplicate assignment/);
  assert.throws(
    () => regressionGroups(fixture(), [...sources, "packages/new/new.test.ts"], inventory),
    /Unassigned/,
  );
  assert.throws(() => regressionGroups(fixture(), sources.slice(1), inventory), /stale manifest/);
});
test("actual Vitest discovery may neither lose nor gain a manifest Vitest file", () => {
  assert.throws(
    () => regressionGroups(fixture(), sources, inventory.slice(1)),
    /actual full-config/,
  );
  assert.throws(
    () => regressionGroups(fixture(), sources, [...inventory, "scripts/new.test.mjs"]),
    /actual full-config/,
  );
  assert.throws(
    () => regressionGroups(fixture(), sources, [...inventory, inventory[0]]),
    /Duplicate/,
  );
});
test("a newly explicitly accounted file enters remaining group without retiring any old file", () => {
  const file = "packages/new/new.test.ts",
    manifest = fixture();
  manifest.tests.push({ path: file, runner: "vitest", lane: "current", reason: "new fixture" });
  const selected = regressionGroups(manifest, [...sources, file], [...inventory, file]);
  assert.deepEqual(selected.other, [...remaining, file].sort());
  assert.equal(Object.values(selected).flat().length, 6);
});
test("dedicated heavy-file removal cannot silently collapse the trial", () => {
  const manifest = fixture();
  manifest.tests = manifest.tests.filter((entry) => entry.path !== heavy[0]);
  assert.throws(
    () =>
      regressionGroups(
        manifest,
        sources.filter((file) => file !== heavy[0]),
        inventory.slice(1),
      ),
    /Missing dedicated/,
  );
});
test("path traversal, options, malformed paths and empty inventories refuse", () => {
  for (const path of [
    "../escape.test.ts",
    "/tmp/absolute.test.ts",
    "--help",
    "packages/../a.test.ts",
    "packages/a\\b.test.ts",
    "packages//a.test.ts",
    "packages/a.test.ts\0",
  ])
    assert.throws(() => regressionGroups(fixture(), sources, [...inventory, path]), /Invalid/);
  assert.throws(() => regressionGroups(fixture(), sources, []), /Empty/);
});
test("countercheck accepts exactly observed requested files, preserving existing pending-case count", () => {
  assert.deepEqual(checkExecutedFiles(remaining, report(), workspace), {
    files: 2,
    tests: 7,
    pending: 1,
  });
});
test("countercheck refuses missing, duplicated, overmatched or escaped executed files", () => {
  for (const files of [
    remaining.slice(1),
    [...remaining, remaining[0]],
    [...remaining, heavy[0]],
    ["../escape.test.ts"],
  ])
    assert.throws(() => checkExecutedFiles(remaining, report(files), workspace));
  assert.throws(() => checkExecutedFiles(remaining, { ...report(), testResults: [] }, workspace));
  assert.throws(() =>
    checkExecutedFiles(
      remaining,
      { ...report(), testResults: [{ name: remaining[0], status: "passed" }] },
      workspace,
    ),
  );
});
test("countercheck refuses failed or unexecuted files and aggregate failures", () => {
  for (const replacement of [
    { success: false },
    { numFailedTests: 1 },
    { numFailedTestSuites: 1 },
    { testResults: [{ name: resolve(workspace, remaining[0]), status: "pending" }] },
  ])
    assert.throws(() => checkExecutedFiles(remaining, { ...report(), ...replacement }, workspace));
});
test("trial preserves full config and old CI while narrowly limiting activation and bd setup", () => {
  const script = readFileSync(new URL("./ci-regression-groups.mjs", import.meta.url), "utf8");
  assert(/"run",\s*"--config",\s*"vitest.config.ts"/.test(script));
  assert(!/--testNamePattern|--testTimeout|--hookTimeout|--passWithNoTests|--exclude/.test(script));
  const workflow = readFileSync(
    new URL("../.github/workflows/ci-parallel-trial.yml", import.meta.url),
    "utf8",
  );
  assert.equal((workflow.match(/timeout-minutes: 20/g) ?? []).length, 2);
  assert.equal(
    (workflow.match(/go install github.com\/steveyegge\/beads\/cmd\/bd@v1.0.5/g) ?? []).length,
    1,
  );
  assert(workflow.includes("if: matrix.group == 'realbd'"));
  assert(workflow.includes('BDP_REQUIRE_BD_MATRIX: "1"'));
  assert(workflow.includes("fail-fast: false"));
  for (const command of [
    "pnpm format:check",
    "pnpm lint",
    "pnpm check:boundaries",
    "pnpm openapi:check",
    "pnpm test:openapi",
    "pnpm markdown:check",
    "pnpm test:markdown",
    "pnpm typecheck",
    "pnpm build",
    "pnpm test:cli:built",
    "pnpm e2e:ready:preflight",
    "pnpm smoke",
    "pnpm smoke:current",
    "pnpm evidence:verify || test $? -eq 2",
  ])
    assert(workflow.includes(`run: ${command}\n`), `Missing baseline command: ${command}`);
  const manifest = JSON.parse(
    readFileSync(new URL("./test-routing-manifest.json", import.meta.url), "utf8"),
  );
  const nodeCurrent = manifest.tests
    .filter((row) => row.runner === "node" && row.lane === "current")
    .map((row) => row.path)
    .sort();
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["test:cli:built"], "node --test scripts/canonical-cli.node-test.mjs");
  const command = workflow.split("\n").find((line) => line.includes("run: pnpm test:cli:built "));
  assert.deepEqual(
    [
      "scripts/canonical-cli.node-test.mjs",
      ...command.split("test:cli:built ")[1].split(" "),
    ].sort(),
    nodeCurrent,
    "All Node/current controls must remain in baseline",
  );
  assert(!workflow.includes("cache: pnpm"));
  assert(workflow.includes("paths:"));
  assert(workflow.includes("scripts/ci-regression-groups.node-test.mjs"));
});
