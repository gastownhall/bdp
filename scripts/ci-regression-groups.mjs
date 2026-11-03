/** Temporary full-regression partition trial. No impact selection or result reuse. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoveredTests, readManifest, root, validateManifest } from "./test-routing.mjs";

export const groups = Object.freeze([
  "read-update-matrix",
  "transactional-matrix",
  "realbd",
  "other",
]);
const dedicated = Object.freeze({
  "read-update-matrix": "apps/bdptest/src/read-update-matrix.test.ts",
  "transactional-matrix": "apps/bdptest/src/transactional-matrix.test.ts",
  realbd: "apps/bdpbd/src/read-matrix.test.ts",
});
function paths(values) {
  assert(Array.isArray(values) && values.length > 0, "Empty or missing Vitest inventory");
  assert.equal(new Set(values).size, values.length, "Duplicate Vitest inventory path");
  for (const value of values)
    assert(
      typeof value === "string" &&
        /^(?:apps|packages|scripts)\//.test(value) &&
        !value.includes("\\") &&
        !value.includes("\0") &&
        value.split("/").every((part) => part && part !== "." && part !== "..") &&
        /\.test\.(?:ts|mjs)$/.test(value),
      "Invalid full-config Vitest path",
    );
  return [...values].sort();
}
export function regressionGroups(manifest, sourcePaths, fullConfigPaths) {
  validateManifest(manifest, sourcePaths);
  const inventory = paths(fullConfigPaths);
  assert.deepEqual(
    manifest.tests
      .filter((entry) => entry.runner === "vitest")
      .map((entry) => entry.path)
      .sort(),
    inventory,
    "Manifest Vitest inventory differs from actual full-config discovery",
  );
  for (const file of Object.values(dedicated))
    assert(inventory.includes(file), `Missing dedicated heavy file: ${file}`);
  const result = Object.fromEntries(groups.map((group) => [group, []]));
  for (const file of inventory) {
    const group = Object.keys(dedicated).find((key) => dedicated[key] === file) ?? "other";
    result[group].push(file);
  }
  assert.deepEqual(
    paths(Object.values(result).flat()),
    inventory,
    "Partition lost or duplicated files",
  );
  assert(result.other.length > 0, "Empty remaining regression group");
  return result;
}
function relativeFile(value, workspace = root) {
  assert(typeof value === "string" && isAbsolute(value), "Vitest must report absolute file paths");
  return relative(workspace, value).split("\\").join("/");
}
export function checkExecutedFiles(expected, report, workspace = root) {
  const requested = paths(expected);
  assert(report && report.success === true, "Vitest did not report success");
  assert(Array.isArray(report.testResults), "Missing Vitest file results");
  const actual = report.testResults.map((row) => {
    assert(row.status === "passed", "A requested Vitest file did not pass");
    return relativeFile(row.name, workspace);
  });
  assert.deepEqual(
    paths(actual),
    requested,
    "Executed Vitest files differ from the requested group",
  );
  assert.equal(report.numFailedTestSuites, 0);
  assert.equal(report.numFailedTests, 0);
  return { files: actual.length, tests: report.numTotalTests, pending: report.numPendingTests };
}
function checked(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, ...options });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `${command} was interrupted`);
  assert.equal(result.status, 0, `${command} failed: ${result.stderr ?? "see command output"}`);
  return result;
}
function discoverFullConfig() {
  const listed = checked(
    process.execPath,
    [
      resolve(root, "node_modules/vitest/vitest.mjs"),
      "list",
      "--config",
      "vitest.config.ts",
      "--filesOnly",
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const entries = JSON.parse(listed.stdout);
  assert(Array.isArray(entries), "Malformed full-config discovery");
  return entries.map((entry) => relativeFile(entry.file));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.versions.node, "24.22.1", "Use the repository-pinned Node");
  const args = process.argv.slice(2);
  assert(
    (args.length === 1 && args[0] === "--check") ||
      (args.length === 2 && args[0] === "--run" && groups.includes(args[1])),
    "Usage: ci-regression-groups.mjs --check | --run GROUP",
  );
  const selection = regressionGroups(readManifest(), discoveredTests(), discoverFullConfig());
  console.log(JSON.stringify({ trial: true, config: "vitest.config.ts", groups: selection }));
  if (args[0] === "--run") {
    const group = args[1];
    if (group === "realbd") {
      assert.equal(process.env.BDP_REQUIRE_BD_MATRIX, "1", "Real bd matrix must be required");
      assert(
        isAbsolute(process.env.BDP_BD_MATRIX_EXECUTABLE ?? ""),
        "Real bd executable must be explicit and absolute",
      );
      const version = checked(process.env.BDP_BD_MATRIX_EXECUTABLE, ["--version"], {
        cwd: tmpdir(),
        encoding: "utf8",
      });
      assert.equal(version.stdout.trim(), "bd version 1.0.5 (dev)");
    }
    const reportDirectory = resolve(process.env.RUNNER_TEMP ?? tmpdir(), "bdp-ci-parallel-reports");
    mkdirSync(reportDirectory, { recursive: true });
    const reportFile = resolve(reportDirectory, `${group}.json`);
    rmSync(reportFile, { force: true });
    checked(
      process.execPath,
      [
        resolve(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "vitest.config.ts",
        "--reporter=verbose",
        "--reporter=json",
        `--outputFile.json=${reportFile}`,
        ...selection[group],
      ],
      { stdio: "inherit" },
    );
    const observed = checkExecutedFiles(
      selection[group],
      JSON.parse(readFileSync(reportFile, "utf8")),
    );
    console.log(
      JSON.stringify({
        event: "ci-parallel.executed",
        group,
        ...observed,
        reportFile,
        resultReuse: false,
      }),
    );
  }
}
