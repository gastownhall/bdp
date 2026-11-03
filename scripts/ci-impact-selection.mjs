// SHADOW ONLY: classify source changes; never execute suites or reuse results.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isTestPath, readManifest, root, validateManifest } from "./test-routing.mjs";

export const baseline = ["artifact", "current", "packed"];
export const extendedFamilies = [
  "storage",
  "transport",
  "lifecycle",
  "test-framework",
  "historical-full",
];
const familyPaths = {
  storage: new Set([
    "packages/server/src/retained-v01/store.ts",
    "packages/server/src/retained-v01/store.test.ts",
    "packages/server/src/retained-v01/recovery.ts",
    "packages/server/src/retained-v01/historical-update.test.ts",
    "packages/server/src/retained-v01/batch-store.ts",
    "packages/server/src/retained-v01/batch-store.test.ts",
    "packages/server/src/retained-v01/batch-recovery.ts",
    "packages/server/src/recovery-store.ts",
    "packages/server/src/recovery-store.test.ts",
    "packages/server/src/transaction-store.ts",
    "packages/server/src/transaction-store.test.ts",
  ]),
  transport: new Set([
    "packages/server/src/retained-v01/http.ts",
    "packages/server/src/read-http.ts",
    "packages/server/src/read-http.test.ts",
    "packages/server/src/read-http-routing.ts",
    "packages/server/src/transaction-http.ts",
    "packages/server/src/transaction-http.test.ts",
    "packages/client/src/retained-transport.ts",
    "packages/client/src/retained-read.ts",
    "apps/bdp/src/canonical-runtime.ts",
    "apps/bdp/src/canonical-io.ts",
  ]),
  lifecycle: new Set([
    "packages/server/src/reference.ts",
    "packages/server/src/development-authority.ts",
    "packages/server/src/transaction-runtime.ts",
    "packages/server/src/transaction-runtime.test.ts",
    "packages/server/src/read-sequence-lifecycle.ts",
    "packages/server/src/read-sequence-lifecycle.test.ts",
    "apps/bdp/src/canonical-runtime.ts",
    "apps/bdp/src/canonical-io.ts",
  ]),
};
const broadPrefixes = [
  "packages/protocol/",
  "packages/conformance/",
  "packages/config/",
  "specs/",
  "fixtures/",
  "scripts/",
  ".github/",
];
const rootDocuments = new Set(["README.md", "STATUS.md", "CONTEXT.md"]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validCommit = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function pathValue(path) {
  assert(
    typeof path === "string" && path.length > 0 && !path.includes("\0"),
    "Invalid repository path",
  );
  assert(!path.startsWith("/") && !path.includes("\\"), "Invalid repository path");
  assert(
    path.split("/").every((part) => part && part !== "." && part !== ".." && part !== ".git"),
    "Invalid repository path",
  );
  return path;
}
function changeValue(change) {
  assert(change && typeof change === "object" && !Array.isArray(change), "Invalid change record");
  assert(
    typeof change.status === "string" && /^(?:[MADTUXB]|[RC](?:100|[1-9]?\d))$/.test(change.status),
    "Unknown change status",
  );
  const moved = /^[RC]/.test(change.status);
  assert.deepEqual(
    Object.keys(change).sort(),
    moved ? ["oldPath", "path", "status"] : ["path", "status"],
    "Wrong change fields",
  );
  pathValue(change.path);
  if (moved) pathValue(change.oldPath);
  return change;
}

/** Parse Git's -z name/status format, preserving both sides of renames/copies. */
export function parseNameStatus(text) {
  assert(typeof text === "string", "Expected Git name/status text");
  if (text === "") return [];
  assert(text.endsWith("\0"), "Truncated Git name/status input");
  const tokens = text.slice(0, -1).split("\0");
  const changes = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    const moved = /^[RC]/.test(status);
    const first = tokens[index++];
    changes.push(
      changeValue(
        moved ? { status, oldPath: first, path: tokens[index++] } : { status, path: first },
      ),
    );
  }
  return changes;
}

/** Path rules are conservative routing inputs, not an import/semantic closure proof. */
export function selectImpact({ event, base = null, head = null, changes, manifest, sourcePaths }) {
  assert(["pull-request", "main", "manual"].includes(event), "Unknown selection event");
  assert(
    Array.isArray(changes),
    "Explicit changes are required; missing input is not an empty diff",
  );
  if (event === "pull-request")
    assert(validCommit(base) && validCommit(head), "Pull request needs resolved base/head commits");
  assert(
    (base === null && head === null) || (validCommit(base) && validCommit(head)),
    "Incomplete base/head comparison",
  );
  assert(
    Array.isArray(sourcePaths) && new Set(sourcePaths).size === sourcePaths.length,
    "Invalid source inventory",
  );
  sourcePaths.forEach(pathValue);
  validateManifest(manifest, sourcePaths.filter(isTestPath).sort());
  const known = new Set(sourcePaths);
  const tests = new Map(manifest.tests.map((entry) => [entry.path, entry]));
  const required = new Set();
  const reasons = new Set();
  const changedTests = new Set();
  const broaden = (reason) => {
    for (const family of extendedFamilies) required.add(family);
    reasons.add(reason);
  };
  if (event !== "pull-request") broaden(`${event}: retain broader historical coverage`);
  if (changes.length === 0) reasons.add("empty diff: baseline still required");
  for (const raw of changes) {
    const change = changeValue(raw);
    if (change.status !== "M" && change.status !== "A") {
      broaden(`${change.status}: structural or uncertain change; retain both path identities`);
      for (const path of [change.oldPath, change.path].filter(Boolean))
        if (tests.has(path)) changedTests.add(path);
      continue;
    }
    const path = change.path;
    if (!known.has(path)) {
      broaden(`unknown source path: ${path}`);
      continue;
    }
    const test = tests.get(path);
    if (test) {
      changedTests.add(path);
      required.add("test-framework");
      reasons.add(`mapped ${test.lane} test: ${path}`);
      if (test.lane === "legacy") required.add("historical-full");
      if (test.lane === "shared") broaden(`shared test impacts both routes: ${path}`);
    }
    if (broadPrefixes.some((prefix) => path.startsWith(prefix))) {
      broaden(`shared protocol/schema/tooling/workspace input: ${path}`);
      continue;
    }
    let classified = Boolean(test);
    for (const [family, paths] of Object.entries(familyPaths)) {
      if (paths.has(path)) {
        required.add(family);
        reasons.add(`${family} owner path: ${path}`);
        classified = true;
      }
    }
    if (rootDocuments.has(path) || (path.startsWith("docs/") && path.endsWith(".md"))) {
      reasons.add(`documentation path; baseline retained: ${path}`);
      classified = true;
    }
    if (!classified) broaden(`unclassified impact: ${path}`);
  }
  return {
    status: "SHADOW_ONLY",
    changes: changes
      .map((change) => ({
        status: change.status,
        ...(change.oldPath === undefined ? {} : { oldPath: change.oldPath }),
        path: change.path,
      }))
      .sort((a, b) => {
        const left = JSON.stringify([a.path, a.oldPath ?? "", a.status]);
        const right = JSON.stringify([b.path, b.oldPath ?? "", b.status]);
        return left < right ? -1 : left > right ? 1 : 0;
      }),
    baseline: [...baseline],
    requiredExtended: extendedFamilies.filter((family) => required.has(family)),
    changedTests: [...changedTests].sort().map((path) => ({ ...tests.get(path) })),
    reasons: [...reasons].sort(),
    limits:
      "No suite execution, workflow cutover, coverage/budget qualification or result reuse. Full CI remains authoritative.",
  };
}

export function describeInputs({
  source,
  base,
  head,
  toolchain,
  selectorBytes,
  manifestBytes,
  sourcePaths,
  lockBytes,
  packageBytes,
}) {
  assert(validCommit(source), "Missing source commit");
  assert(
    (base === null && head === null) || (validCommit(base) && validCommit(head)),
    "Incomplete base/head comparison",
  );
  assert(
    toolchain &&
      ["actualNode", "expectedNode", "packageManager"].every(
        (key) => typeof toolchain[key] === "string" && toolchain[key],
      ),
    "Missing toolchain metadata",
  );
  return {
    source,
    base,
    head,
    toolchain: {
      actualNode: toolchain.actualNode,
      expectedNode: toolchain.expectedNode,
      packageManager: toolchain.packageManager,
    },
    selectorSHA256: sha(selectorBytes),
    manifestSHA256: sha(manifestBytes),
    sourceInventory: {
      kind: "path-names-only",
      files: sourcePaths.length,
      sha256: sha(JSON.stringify([...sourcePaths].sort())),
    },
    lockSHA256: sha(lockBytes),
    packageSHA256: sha(packageBytes),
    reuse:
      "NOT_IMPLEMENTED: these incomplete metadata inputs are not a reusable result attestation",
  };
}

if (
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    assert(
      ["--event", "--base", "--head"].includes(flag) &&
        !Object.hasOwn(options, flag) &&
        args[index + 1],
      "Usage: ci-impact-selection.mjs [--event manual|main|pull-request] [--base REF --head REF]",
    );
    options[flag] = args[index + 1];
  }
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const commit = (ref) =>
    git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();
  const source = commit("HEAD");
  assert(Boolean(options["--base"]) === Boolean(options["--head"]), "Supply both base and head");
  const base = options["--base"] ? commit(options["--base"]) : null;
  const head = options["--head"] ? commit(options["--head"]) : null;
  const sourcePaths = git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
    .split("\0")
    .filter(Boolean)
    .sort();
  const packageBytes = readFileSync(resolve(root, "package.json"));
  const pkg = JSON.parse(packageBytes);
  assert.equal(process.versions.node, pkg.engines.node, "Use the repository-pinned Node version");
  const changes =
    base === null
      ? []
      : parseNameStatus(git("diff", "--name-status", "-z", "--find-renames", base, head, "--"));
  const selection = selectImpact({
    event: options["--event"] ?? "manual",
    base,
    head,
    changes,
    manifest: readManifest(),
    sourcePaths,
  });
  const inputs = describeInputs({
    source,
    base,
    head,
    toolchain: {
      actualNode: process.versions.node,
      expectedNode: pkg.engines.node,
      packageManager: pkg.packageManager,
    },
    selectorBytes: readFileSync(fileURLToPath(import.meta.url)),
    manifestBytes: readFileSync(resolve(root, "scripts/test-routing-manifest.json")),
    sourcePaths,
    lockBytes: readFileSync(resolve(root, "pnpm-lock.yaml")),
    packageBytes,
  });
  console.log(
    JSON.stringify(
      { ...selection, inputs, workingTreeDirty: git("status", "--porcelain").length > 0 },
      null,
      2,
    ),
  );
}
