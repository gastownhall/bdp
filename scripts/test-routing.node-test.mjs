import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { assertNoHistoricalAdmissionState } from "./current-shadow-admission-setup.mjs";
import {
  discoveredTests,
  inferredRunner,
  isTestPath,
  runners,
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
  for (const name of readdirSync(resolve(root, ".github/workflows")).filter((name) =>
    /\.ya?ml$/.test(name),
  )) {
    const workflow = readFileSync(resolve(root, ".github/workflows", name), "utf8");
    assert(!/test:(?:current|legacy|artifacts):shadow/.test(workflow));
  }
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  assert(workflow.includes("run: pnpm test:routing:shadow"));
  const base = readFileSync(resolve(root, "vitest.config.ts"), "utf8");
  assert(base.includes('setupFiles: ["./packages/server/test-support/read-conformance-mock.ts"]'));
  for (const lane of ["current", "legacy"]) {
    const config = readFileSync(resolve(root, `vitest.${lane}-shadow.config.ts`), "utf8");
    assert(config.includes("...base.test"));
    assert.equal(
      config.includes('setupFiles: ["./scripts/current-shadow-admission-setup.mjs"]'),
      lane === "current",
    );
  }
});

test("shadow runner refuses an out-of-route file before launching its target suite", () => {
  const result = spawnSync(
    process.execPath,
    [resolve(root, "scripts/run-test-route.mjs"), "current", "apps/bdpbd/src/read-matrix.test.ts"],
    { cwd: root, encoding: "utf8", timeout: 15000 },
  );
  assert(!result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown or out-of-route test/);
  assert(!result.stdout.includes("RUN  v"));
});

test("current-worker admission guard rejects historical state without creating a grant", () => {
  const marker = Symbol.for("bdp.test.read-conformance-mock");
  const absent = {};
  assertNoHistoricalAdmissionState(absent);
  assert(!Reflect.has(absent, marker));
  for (const grants of [new Map(), new Map([["bdptest", 1]])]) {
    const present = { [marker]: { grants } };
    assert.throws(
      () => assertNoHistoricalAdmissionState(present),
      /Historical admission setup leaked/,
    );
    assert.equal(Reflect.get(present, marker).grants, grants);
  }
  assertNoHistoricalAdmissionState(globalThis);
});

test("discovery and runner validation share Node variants and Python conventions", () => {
  const examples = [
    ...["js", "mjs", "cjs", "ts", "mts", "cts", "jsx", "tsx"].map((extension) => [
      `scripts/new.node-test.${extension}`,
      "node",
    ]),
    ["scripts/other-test.py", "python"],
    ["scripts/other_test.py", "python"],
    ["scripts/test_other.py", "python"],
    ["packages/new/src/new.test.ts", "vitest"],
  ];
  for (const [path, runner] of examples) {
    assert(isTestPath(path));
    assert.equal(inferredRunner(path), runner);
    const changed = structuredClone(manifest);
    changed.tests.push({ path, runner, lane: "legacy", reason: "Synthetic discovery control" });
    validateManifest(changed, [...paths, path]);
    assert.throws(() => validateManifest(manifest, [...paths, path]), /Unassigned new test/);
    changed.tests.at(-1).runner = runner === "node" ? "vitest" : "node";
    assert.throws(() => validateManifest(changed, [...paths, path]), /Wrong runner/);
  }
  for (const path of ["scripts/check.py", "scripts/contest.py", "scripts/x.node-test.txt"])
    assert.equal(isTestPath(path), false);
});

test("artifact Vitest mappings refuse before dispatch, while each runner remains represented", () => {
  const changed = structuredClone(manifest);
  changed.tests.find((entry) => entry.runner === "vitest").lane = "artifact";
  assert.throws(() => validateManifest(changed, paths), /Artifact routes require Node or Python/);
  for (const runner of runners) assert(manifest.tests.some((entry) => entry.runner === runner));
});

test("an exact Python artifact selection executes and reports its dispatched file count", () => {
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, "scripts/run-test-route.mjs"),
      "artifact",
      "scripts/check-spec-editorial-test.py",
    ],
    { cwd: root, encoding: "utf8", timeout: 15000 },
  );
  assert(!result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dispatched 1 source files/);
  assert.match(result.stderr, /Ran \d+ tests/);
});
