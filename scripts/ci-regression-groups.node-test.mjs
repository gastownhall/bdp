/** Full-regression partition controls and an independent real-reporter countercheck. */
import assert from "node:assert/strict";
import {
  existsSync,
  realpathSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnChild, terminateChild } from "./e2e-ready.mjs";
import test from "node:test";
import { regressionGroups, checkExecutedFiles, groups } from "./ci-regression-groups.mjs";

const heavy = [
  "apps/bdptest/src/read-update-matrix.test.ts",
  "apps/bdptest/src/transactional-matrix.test.ts",
  "apps/bdptest/src/transactional-set-receipts.test.ts",
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
    numTotalTests: files.length * 3 + 1,
    numPassedTests: files.length * 3,
    numPendingTests: 1,
    testResults: files.map((file, index) => ({
      name: resolve(workspace, file),
      status: "passed",
      assertionResults: [
        ...Array.from({ length: 3 }, (_, n) => ({ title: `executed${n}`, status: "passed" })),
        ...(index === 0 ? [{ title: "existing pending", status: "skipped" }] : []),
      ],
    })),
  };
}
test("four named heavyweight files are isolated and every other full-config file remains once", () => {
  assert.deepEqual(groups, [
    "read-update-matrix",
    "transactional-matrix",
    "transactional-set-receipts",
    "realbd",
    "other",
  ]);
  const manifest = fixture(),
    copy = structuredClone(manifest);
  assert.deepEqual(regressionGroups(manifest, sources, inventory), {
    "read-update-matrix": [heavy[0]],
    "transactional-matrix": [heavy[1]],
    "transactional-set-receipts": [heavy[2]],
    realbd: [heavy[3]],
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
  assert.equal(Object.values(selected).flat().length, 7);
});
test("dedicated heavy-file removal cannot silently collapse required full regression", () => {
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
    { numPassedTests: 0 },
    { numFailedTestSuites: 1 },
    { testResults: [{ name: resolve(workspace, remaining[0]), status: "pending" }] },
  ])
    assert.throws(() => checkExecutedFiles(remaining, { ...report(), ...replacement }, workspace));
});
test("required CI preserves every old command and permits only legitimate editorial skips", () => {
  const script = readFileSync(new URL("./ci-regression-groups.mjs", import.meta.url), "utf8");
  assert(/"run",\s*"--config",\s*"vitest.config.ts"/.test(script));
  assert.deepEqual(
    [...new Set(script.match(/--[A-Za-z][A-Za-z.-]*/g))].sort(),
    [
      "--check",
      "--config",
      "--filesOnly",
      "--json",
      "--outputFile.json",
      "--reporter",
      "--run",
      "--version",
    ].sort(),
    "Runtime flags are closed: no retry/pool/isolation/concurrency/shard/bail or timeout changes",
  );
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.equal((workflow.match(/timeout-minutes: 10/g) ?? []).length, 5);
  assert(
    !existsSync(new URL("../.github/workflows/ci-parallel-trial.yml", import.meta.url)),
    "Temporary workflow must be retired at promotion",
  );
  assert(workflow.includes("needs: [changes, specification, implementation, regression]"));
  assert.equal((workflow.match(/if: needs.changes.outputs.editorial != 'true'/g) ?? []).length, 2);
  assert(
    workflow.includes(
      "group: [read-update-matrix, transactional-matrix, transactional-set-receipts, realbd, other]",
    ),
  );
  assert(
    workflow.includes(
      "if: always()\n    needs: [changes, specification, implementation, regression]",
    ),
  );
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
  assert(
    pkg.scripts["test:markdown"]
      .split(/\s+/)
      .includes("scripts/spec-schema-fragments.node-test.mjs"),
    "Baseline Markdown controls must retain schema-fragment extraction controls",
  );
  const command = workflow.split("\n").find((line) => line.includes("run: pnpm test:cli:built "));
  assert(command, "Baseline must extend the built Node entry with remaining current controls");
  assert.deepEqual(
    [
      "scripts/canonical-cli.node-test.mjs",
      ...command.split("test:cli:built ")[1].split(" "),
    ].sort(),
    nodeCurrent,
    "All Node/current controls must remain in baseline",
  );
  // The old specification job may keep its own defaults; the measured baseline
  // and regression fragments keep independent cold installs and builds.
  const implementation = workflow.slice(
    workflow.indexOf("  implementation:"),
    workflow.indexOf("  verify:"),
  );
  assert(
    !/actions\/cache(?:@|\/)/.test(implementation),
    "Measured fragments cannot add action caches",
  );
  assert.deepEqual(
    [...implementation.matchAll(/^\s*cache:\s*(.+)$/gm)].map((match) => match[1].trim()),
    ["false"],
    "Cold fragments retain only the explicit setup-go cache:false",
  );
  assert(!implementation.includes("ci-impact-selection"));
  assert(!workflow.includes("paths:"));
  assert(workflow.includes("run: node --test scripts/ci-regression-groups.node-test.mjs"));
  assert(workflow.includes("run: node scripts/ci-regression-groups.mjs --check"));
  for (const check of [
    "scripts/check-spec-editorial.py --classify",
    "scripts/check-spec-editorial-test.py",
    "bash -n docs/cli-design/overview/examples/csv-failure.sh docs/cli-design/overview/examples/csv-review.sh",
    "node --test scripts/spec-schema-fragments.node-test.mjs",
    "node scripts/spec-schema-fragments.mjs --check",
    "python3 -B scripts/check-spec-editorial.py",
    "go-version: 1.26.10",
    "libicu-dev",
    "bd version 1.0.5 (dev)",
    'const expected = { build: "dev", schema_version: 1, version: "1.0.5" };',
  ])
    assert(workflow.includes(check), `Missing original required check: ${check}`);
  const verify = workflow.slice(workflow.indexOf("  verify:"));
  assert(/REGRESSION_RESULT: \$\{\{ needs\.regression\.result \}\}/.test(verify));
  const shell = verify
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => (line.startsWith("          ") ? line.slice(10) : line))
    .join("\n");
  function accepted(editorial, values) {
    const [scope, spec, implementation, regression] = values;
    const result = spawnSync("bash", ["-eu", "-c", shell], {
      env: {
        ...process.env,
        EDITORIAL: editorial,
        SCOPE_RESULT: scope,
        SPEC_RESULT: spec,
        IMPLEMENTATION_RESULT: implementation,
        REGRESSION_RESULT: regression,
      },
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    assert.equal(result.signal, null);
    return result.status === 0;
  }
  assert(accepted("true", ["success", "success", "skipped", "skipped"]));
  assert(accepted("false", ["success", "success", "success", "success"]));
  for (const editorial of ["true", "false"]) {
    const valid =
      editorial === "true"
        ? ["success", "success", "skipped", "skipped"]
        : ["success", "success", "success", "success"];
    for (let index = 0; index < valid.length; index++)
      for (const outcome of ["failure", "cancelled", "skipped", "success", ""]) {
        if (outcome === valid[index]) continue;
        const invalid = [...valid];
        invalid[index] = outcome;
        assert(!accepted(editorial, invalid), `verify admitted ${editorial}: ${invalid}`);
      }
  }
});

test("actual Vitest JSON refuses a passed-status file whose assertions are all pending", {
  timeout: 15_000,
}, async () => {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), "bdp-ci-report-control-")));
  const project = fileURLToPath(new URL("../", import.meta.url));
  const files = ["scripts/passed.test.mjs", "scripts/pending.test.mjs"];
  let record, failure;
  try {
    mkdirSync(resolve(directory, "scripts"));
    writeFileSync(
      resolve(directory, "config.mjs"),
      'export default { test: { globals: true, include: ["scripts/*.test.mjs"] } };\n',
    );
    writeFileSync(resolve(directory, files[0]), 'test("actual passing case", () => {});\n');
    writeFileSync(resolve(directory, files[1]), 'test.skip("actual pending case", () => {});\n');
    const output = resolve(directory, "results.json");
    record = spawnChild(
      process.execPath,
      [
        resolve(project, "node_modules/vitest/vitest.mjs"),
        "run",
        "--root",
        directory,
        "--config",
        resolve(directory, "config.mjs"),
        "--reporter=json",
        `--outputFile=${output}`,
      ],
      {
        cwd: directory,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        timeoutMs: 10_000,
      },
    );
    const result = await record.result;
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.signal, null);
    const observed = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(observed.numPassedTests, 1);
    const pendingFile = observed.testResults.find(
      (row) => row.name === resolve(directory, files[1]),
    );
    assert(
      pendingFile,
      `Expected actual pending file in ${observed.testResults.map((row) => row.name)}`,
    );
    assert.equal(pendingFile.status, "passed");
    assert.deepEqual(
      pendingFile.assertionResults.map((assertion) => assertion.status),
      ["skipped"],
    );
    assert.throws(() => checkExecutedFiles(files, observed, directory), /executed no passing case/);
    const passedOnly = {
      ...observed,
      testResults: observed.testResults.filter((row) => row !== pendingFile),
    };
    assert.equal(checkExecutedFiles([files[0]], passedOnly, directory).files, 1);
  } catch (error) {
    failure = error;
  }
  const cleanupErrors = [];
  try {
    if (record) await terminateChild(record);
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      "JSON control cleanup failed",
    );
  if (failure) throw failure;
});
