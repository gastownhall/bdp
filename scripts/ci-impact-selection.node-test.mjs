import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import test from "node:test";
import {
  baseline,
  ownerPaths,
  describeInputs,
  extendedFamilies,
  parseNameStatus,
  selectImpact,
} from "./ci-impact-selection.mjs";
import { isTestPath, readManifest, root } from "./test-routing.mjs";

const base = "a".repeat(40),
  head = "b".repeat(40);
const paths = [
  "scripts/a.node-test.mjs",
  "apps/bdp/src/unit.test.ts",
  "apps/bdpbd/src/old.test.ts",
  "packages/server/src/retained-v01/store.ts",
  "packages/server/src/retained-v01/http.ts",
  "packages/server/src/reference.ts",
  "apps/bdp/src/canonical-runtime.ts",
  "README.md",
  "docs/spec-review/notes.md",
  "docs/example.sh",
  "packages/server/src/future.ts",
  "packages/protocol/src/read-values.ts",
  "specs/profiles/core/bdp-v0.1.schema.json",
  "specs/profiles/core/core.md",
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  ".nvmrc",
  "tsconfig.check.json",
  "vitest.config.ts",
  "scripts/runner.mjs",
  "packages/server/package.json",
  "packages/config/src/index.ts",
  "fixtures/input.json",
];
const broadPaths = paths.slice(12);
paths.push(...ownerPaths.filter((path) => !paths.includes(path)));
const manifest = {
  status: "SHADOW_ONLY",
  candidateBase: base,
  scope: "Synthetic control inventory",
  tests: [
    { path: paths[0], runner: "node", lane: "artifact", reason: "Synthetic artifact" },
    { path: paths[1], runner: "vitest", lane: "current", reason: "Synthetic current" },
    { path: paths[2], runner: "vitest", lane: "legacy", reason: "Synthetic legacy" },
    ...ownerPaths
      .filter(isTestPath)
      .map((path) => ({ path, runner: "vitest", lane: "legacy", reason: "Synthetic owned test" })),
  ],
};
const selection = (changes, overrides = {}) =>
  selectImpact({
    event: "pull-request",
    base,
    head,
    changes,
    manifest,
    sourcePaths: paths,
    ...overrides,
  });
const modified = (...paths) => paths.map((path) => ({ status: "M", path }));
function full(result) {
  assert.deepEqual(result.baseline, baseline);
  assert.deepEqual(result.requiredExtended, extendedFamilies);
}

test("known root documents and empty comparisons retain every baseline family", () => {
  for (const changes of [[], modified("README.md")]) {
    const result = selection(changes);
    assert.equal(result.status, "SHADOW_ONLY");
    assert.deepEqual(result.baseline, ["artifact", "current", "packed"]);
    assert.deepEqual(result.requiredExtended, []);
  }
  full(
    selection([{ status: "A", path: "docs/new.md" }], { sourcePaths: [...paths, "docs/new.md"] }),
  );
});

test("explicit storage, transport and lifecycle owners add the corresponding extended families", () => {
  for (const [path, families] of [
    ["packages/server/src/retained-v01/store.ts", ["storage"]],
    ["packages/server/src/retained-v01/http.ts", ["transport"]],
    ["packages/server/src/reference.ts", ["lifecycle"]],
    ["apps/bdp/src/canonical-runtime.ts", ["transport", "lifecycle"]],
  ])
    assert.deepEqual(selection(modified(path)).requiredExtended, families);
});

test("mapped tests select framework coverage and legacy tests preserve historical-full", () => {
  assert.deepEqual(selection(modified(paths[1])).requiredExtended, ["test-framework"]);
  assert.deepEqual(selection(modified(paths[2])).requiredExtended, [
    "test-framework",
    "historical-full",
  ]);
  assert.equal(selection(modified(paths[1])).changedTests[0].lane, "current");
  const shared = structuredClone(manifest);
  shared.tests.push({
    path: "apps/shared.test.ts",
    runner: "vitest",
    lane: "shared",
    reason: "Both routes",
  });
  full(
    selection(modified("apps/shared.test.ts"), {
      manifest: shared,
      sourcePaths: [...paths, "apps/shared.test.ts"],
    }),
  );
});

test("shared protocol, schema, workspace, toolchain and tooling changes are broad", () => {
  for (const path of broadPaths) full(selection(modified(path)));
  full(selection(modified("docs/example.sh")));
});

test("unknown impact, renamed, copied, deleted and type-changed paths never select a cheaper route", () => {
  full(selection(modified("packages/server/src/future.ts")));
  full(selection(modified("a/path/not/in/the/source/inventory.ts")));
  for (const status of ["D", "T", "U", "X", "B"])
    full(selection([{ status, path: "deleted/not-in-current-inventory.ts" }]));
  for (const status of ["R100", "R075", "R088", "C095", "C100"])
    full(
      selection([
        { status, oldPath: "packages/server/src/retained-v01/store.ts", path: "docs/moved.md" },
      ]),
    );
});

test("manual and main invocations retain broader coverage, without inventing an empty trustworthy PR diff", () => {
  for (const event of ["main", "manual"]) full(selection([], { event, base: null, head: null }));
  assert.throws(() => selection([], { base: null, head: null }), /needs resolved base\/head/);
  assert.throws(() => selection(undefined), /Explicit changes/);
  assert.throws(() => selection([], { event: "nightly" }), /Unknown selection event/);
  assert.throws(() => selection([], { head: null }), /resolved base\/head/);
});

test("malformed status/path/inventory/manifest input refuses rather than producing success", () => {
  for (const path of ["", "/absolute", "../parent", "a/../b", "a\\b", ".git/config", "a\0b"])
    assert.throws(() => selection(modified(path)), /Invalid repository path/);
  assert.throws(
    () => selection([{ status: "unknown", path: "README.md" }]),
    /Unknown change status/,
  );
  for (const status of ["R75", "R101", "C999", "R-01"])
    assert.throws(
      () => selection([{ status, oldPath: "old.ts", path: "new.ts" }]),
      /Unknown change status/,
    );
  assert.throws(
    () =>
      selection([], {
        sourcePaths: paths.filter(
          (path) => path !== "packages/server/src/retained-v01/batch-contract.ts",
        ),
      }),
    /Stale owner path/,
  );
  assert.throws(
    () => selection([{ status: "M", path: "README.md", ignored: true }]),
    /Wrong change fields/,
  );
  assert.throws(
    () => selection([], { sourcePaths: [...paths, paths[0]] }),
    /Invalid source inventory/,
  );
  assert.throws(
    () => selection([], { sourcePaths: [...paths, "scripts/new.node-test.mjs"] }),
    /Unassigned new test/,
  );
  assert.throws(
    () => selection([], { sourcePaths: paths.filter((path) => path !== paths[1]) }),
    /stale manifest/,
  );
});

test("NUL Git records preserve spaces and both rename identities and reject truncation", () => {
  assert.deepEqual(parseNameStatus(""), []);
  assert.deepEqual(
    parseNameStatus("M\0docs/a b.md\0R100\0old/path.ts\0new/path.ts\0D\0gone.ts\0"),
    [
      { status: "M", path: "docs/a b.md" },
      { status: "R100", oldPath: "old/path.ts", path: "new/path.ts" },
      { status: "D", path: "gone.ts" },
    ],
  );
  for (const text of ["M\0path", "R100\0old\0", "M\0\0", "UNKNOWN\0path\0"])
    assert.throws(() => parseNameStatus(text));
});

test("selection is deterministic across change/inventory order and does not mutate its inputs", () => {
  const changes = modified("README.md", "packages/server/src/retained-v01/store.ts", paths[1]);
  const original = JSON.stringify({ changes, paths, manifest });
  assert.deepEqual(
    selection(changes),
    selection([...changes].reverse(), { sourcePaths: [...paths].reverse() }),
  );
  assert.equal(JSON.stringify({ changes, paths, manifest }), original);
});

test("future-reuse metadata binds source, refs, selector, manifest and toolchain without claiming reuse", () => {
  const input = {
    event: "pull-request",
    source: base,
    base,
    mergeBase: base,
    head,
    toolchain: { actualNode: "24.22.1", expectedNode: "24.22.1", packageManager: "pnpm@11.20.0" },
    selectorBytes: "selector",
    manifestBytes: "manifest",
    sourcePaths: paths,
    lockBytes: "lock",
    packageBytes: "package",
  };
  const result = describeInputs(input);
  assert.equal(result.source, base);
  assert.equal(result.base, base);
  assert.equal(result.head, head);
  assert.equal(result.event, "pull-request");
  assert.equal(result.targetBase, base);
  assert.equal(result.mergeBase, base);
  assert.equal(result.sourceInventory.kind, "path-names-only");
  assert.match(result.reuse, /^NOT_IMPLEMENTED/);
  assert.deepEqual(result, describeInputs({ ...input, sourcePaths: [...paths].reverse() }));
  for (const field of ["selectorBytes", "manifestBytes", "lockBytes", "packageBytes"])
    assert.notDeepEqual(result, describeInputs({ ...input, [field]: "changed" }));
  assert.notDeepEqual(result, describeInputs({ ...input, head: base }));
  assert.notDeepEqual(
    result,
    describeInputs({ ...input, toolchain: { ...input.toolchain, actualNode: "future" } }),
  );
  assert.throws(() => describeInputs({ ...input, head: null }), /Incomplete base\/head/);
  assert.throws(() => describeInputs({ ...input, source: "unknown" }), /Missing source commit/);
  for (const field of ["selectorBytes", "manifestBytes", "lockBytes", "packageBytes"])
    for (const value of [undefined, null, 7, {}])
      assert.throws(() => describeInputs({ ...input, [field]: value }), /Invalid digest input/);
  for (const sourcePaths of [undefined, ["../escape"], ["README.md", "README.md"]])
    assert.throws(
      () => describeInputs({ ...input, sourcePaths }),
      /Invalid source inventory|Invalid repository path/,
    );
  assert.throws(
    () => describeInputs({ ...input, mergeBase: null }),
    /Invalid comparison merge base/,
  );
  assert.throws(() => describeInputs({ ...input, event: "nightly" }), /Unknown selection event/);
});

test("real current inventory retains the exact integrated row and rejects its absence", () => {
  const sourcePaths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  const existing = readManifest();
  const testPath = "scripts/ci-impact-selection.node-test.mjs";
  assert(sourcePaths.includes(testPath));
  const expectedRow = {
    path: testPath,
    runner: "node",
    lane: "artifact",
    reason:
      "Shadow impact selector and metadata controls; no target execution or semantic-closure claim.",
  };
  const reviewed = structuredClone(existing);
  const assigned = reviewed.tests.find((entry) => entry.path === testPath);
  assert.deepEqual(assigned, expectedRow, "Manifest must retain the exact artifact control row");
  const missing = structuredClone(reviewed);
  missing.tests = missing.tests.filter((entry) => entry.path !== testPath);
  assert.throws(
    () => selectImpact({ event: "manual", changes: [], manifest: missing, sourcePaths }),
    /Unassigned new test/,
  );
  full(selectImpact({ event: "manual", changes: [], manifest: reviewed, sourcePaths }));
  // Presence is checked against the actual manifest; no repair or override.
  assert(sourcePaths.filter(isTestPath).length === reviewed.tests.length);
  assert(
    readFileSync(resolve(root, "scripts/ci-impact-selection.mjs"), "utf8").includes("SHADOW ONLY"),
  );
});

test("actual CLI emits review metadata for empty PR and broader manual inputs in an isolated Git fixture", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "bdp-impact-selector-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (path, bytes) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), bytes);
  };
  for (const file of ["ci-impact-selection.mjs", "test-routing.mjs"])
    write(`scripts/${file}`, readFileSync(resolve(root, "scripts", file)));
  write("scripts/test-routing-manifest.json", JSON.stringify(manifest));
  for (const path of manifest.tests.map((entry) => entry.path))
    write(path, "// Never executed by impact selection\n");
  write(
    "package.json",
    JSON.stringify({
      type: "module",
      engines: { node: "24.22.1" },
      packageManager: "pnpm@11.20.0",
    }),
  );
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  for (const path of ownerPaths.filter((path) => !isTestPath(path)))
    write(path, "// Fixture owner placeholder\n");
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Impact selector fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "Isolated selector input",
  );
  const commit = git("rev-parse", "HEAD");
  const run = (...args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [join(directory, "scripts/ci-impact-selection.mjs"), ...args],
        { cwd: directory, encoding: "utf8", timeout: 10000 },
      ),
    );
  const manual = run();
  full(manual);
  assert.equal(manual.inputs.source, commit);
  assert.equal(manual.inputs.base, null);
  assert.equal(manual.inputs.mergeBase, null);
  assert.equal(manual.event, "manual");
  assert.equal(manual.inputs.event, "manual");
  assert.equal(manual.workingTreeDirty, false);
  assert.equal(manual.inputs.toolchain.actualNode, process.versions.node);
  const pr = run("--event", "pull-request", "--base", "HEAD", "--head", "HEAD");
  assert.deepEqual(pr.baseline, baseline);
  assert.deepEqual(pr.requiredExtended, []);
  assert.equal(pr.inputs.base, commit);
  assert.equal(pr.inputs.head, commit);
  assert.equal(pr.inputs.targetBase, commit);
  assert.equal(pr.inputs.mergeBase, commit);
  assert.equal(pr.event, "pull-request");
  assert.equal(pr.inputs.event, "pull-request");
  assert.deepEqual(pr.changes, []);
  git("branch", "topic", commit);
  git("checkout", "--quiet", "-b", "target");
  write("docs/target-only.md", "Target branch only\n");
  git("add", ".");
  const save = (message) =>
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      message,
    );
  save("target-only advance");
  const target = git("rev-parse", "HEAD");
  git("checkout", "--quiet", "topic");
  write("README.md", "Topic change\n");
  git("add", ".");
  save("topic change");
  const topic = git("rev-parse", "HEAD");
  const diverged = run("--event", "pull-request", "--base", target, "--head", topic);
  assert.deepEqual(diverged.changes, [{ status: "A", path: "README.md" }]);
  assert.deepEqual(diverged.requiredExtended, []);
  assert.equal(diverged.inputs.targetBase, target);
  assert.equal(diverged.inputs.mergeBase, commit);
  assert.equal(diverged.inputs.head, topic);
  assert.equal(diverged.workingTreeDirty, false);
});

test("real committed nonexact Git rename scores retain both identities and broad coverage", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "bdp-impact-rename-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  git("init", "--quiet");
  const original = Array.from(
    { length: 100 },
    (_, index) => `retained original line ${index}\n`,
  ).join("");
  writeFileSync(join(directory, "old.txt"), original);
  git("add", ".");
  const commit = (message) =>
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--quiet",
      "-m",
      message,
    );
  commit("original");
  const before = git("rev-parse", "HEAD").trim();
  git("mv", "old.txt", "new.txt");
  writeFileSync(
    join(directory, "new.txt"),
    original.replace("retained original line 50", "changed line fifty"),
  );
  git("add", ".");
  commit("nonexact rename");
  const actual = git("diff", "--name-status", "-z", "--find-renames", before, "HEAD", "--");
  const records = parseNameStatus(actual);
  assert.equal(records.length, 1);
  assert.match(records[0].status, /^R0\d{2}$/);
  assert.equal(records[0].oldPath, "old.txt");
  assert.equal(records[0].path, "new.txt");
  full(selection(records));
});

test("all docs paths select broad coverage including the historically consumed shim", () => {
  for (const path of [
    "docs/specs/bdp.md",
    "docs/design/requirements.md",
    "docs/cli-design/atomic-batch.md",
    "docs/spec-review/notes.md",
  ])
    full(selection(modified(path), { sourcePaths: [...new Set([...paths, path])] }));
});
