// Explicit shadow routing only; no test execution or production admission changes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const lanes = ["artifact", "current", "legacy", "shared"];
export const runners = ["node", "vitest", "python"];
export function isTestPath(path) {
  return (
    /\.(?:test|node-test)\.[cm]?[jt]sx?$/.test(path) ||
    path === "scripts/check-spec-editorial-test.py"
  );
}
export function discoveredTests() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(isTestPath)
    .map((path) => {
      assert(
        existsSync(resolve(root, path)),
        `Missing test file; update its tracked assignment: ${path}`,
      );
      return path;
    })
    .sort();
}
export function readManifest() {
  return JSON.parse(readFileSync(resolve(root, "scripts/test-routing-manifest.json"), "utf8"));
}
export function validateManifest(manifest, paths) {
  assert.equal(manifest.status, "SHADOW_ONLY");
  assert.match(manifest.candidateBase, /^[a-f0-9]{40}$/);
  assert.equal(typeof manifest.scope, "string");
  assert(Array.isArray(manifest.tests) && manifest.tests.length > 0, "Missing test accounting");
  const seen = new Set();
  for (const entry of manifest.tests) {
    assert.deepEqual(Object.keys(entry).sort(), ["lane", "path", "reason", "runner"]);
    assert(
      isTestPath(entry.path) &&
        !entry.path.startsWith("/") &&
        !entry.path.split("/").includes(".."),
      "Invalid test path",
    );
    assert(!seen.has(entry.path), `Duplicate assignment: ${entry.path}`);
    seen.add(entry.path);
    assert(lanes.includes(entry.lane), "Unknown lane");
    assert(runners.includes(entry.runner), "Unknown runner");
    assert(
      typeof entry.reason === "string" && entry.reason.trim().length > 0,
      "Missing classification reason",
    );
    const expected = entry.path.endsWith(".node-test.mjs")
      ? "node"
      : entry.path.endsWith(".py")
        ? "python"
        : "vitest";
    assert.equal(entry.runner, expected, `Wrong runner for ${entry.path}`);
    assert(entry.runner === "vitest" || entry.lane !== "shared", "Shared routes require Vitest");
  }
  assert.equal(new Set(paths).size, paths.length, "Duplicate discovered path");
  assert.deepEqual(
    [...seen].sort(),
    [...paths].sort(),
    "Unassigned new test or stale manifest entry; full CI remains authoritative",
  );
  for (const lane of ["artifact", "current", "legacy"])
    assert(
      manifest.tests.some((entry) => entry.lane === lane),
      `Empty ${lane} lane`,
    );
  return manifest;
}
export function routeEntries(lane, manifest = readManifest(), paths = discoveredTests()) {
  assert(["artifact", "current", "legacy"].includes(lane), "Unknown executable lane");
  validateManifest(manifest, paths);
  return manifest.tests.filter(
    (entry) => entry.lane === lane || (lane !== "artifact" && entry.lane === "shared"),
  );
}
export function routeFiles(lane, runner) {
  assert(runners.includes(runner), "Unknown runner");
  return routeEntries(lane)
    .filter((entry) => entry.runner === runner)
    .map((entry) => entry.path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.deepEqual(
    process.argv.slice(2),
    ["--check"],
    "Usage: node scripts/test-routing.mjs --check",
  );
  const manifest = validateManifest(readManifest(), discoveredTests());
  console.log(
    JSON.stringify(
      {
        status: manifest.status,
        candidateBase: manifest.candidateBase,
        sourceFiles: manifest.tests.length,
        lanes: Object.fromEntries(
          lanes.map((lane) => [lane, manifest.tests.filter((entry) => entry.lane === lane).length]),
        ),
        claim: "Source-file accounting only; full CI unchanged",
      },
      null,
      2,
    ),
  );
}
