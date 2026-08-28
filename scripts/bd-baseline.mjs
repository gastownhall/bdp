#!/usr/bin/env node
// Pin the black-box `bd` observations the BDP readiness proof is measured against.
//
// Everything here runs against a throwaway workspace under the OS temp directory
// with an isolated HOME, a pinned git identity, and an allowlisted environment, so
// no real bd database is read or written and no ambient variable can steer a capture.
//
//   node scripts/bd-baseline.mjs capture   # rewrite the committed evidence
//   node scripts/bd-baseline.mjs verify    # fail if the installed bd drifts from it
//   node scripts/bd-baseline.mjs pin       # print the identity pin the cohort cites
//
// Interruption: cleanup runs in a `finally` block, which covers thrown errors and
// non-zero exits but *not* signals. Node's default SIGINT/SIGTERM disposition
// terminates the process without unwinding, so Ctrl-C during a capture leaves the
// two `bdp-bd-*` directories behind under the OS temp directory. They are inert —
// an isolated HOME and a throwaway workspace, never a real database — and are
// reclaimed by normal temp cleanup. No signal handlers are installed, because a
// handler that raced the running `bd` child could leave a half-written workspace
// that looks like a clean one.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const observationsRoot = path.join(workspaceRoot, "docs/design/evidence/bd-baseline/observations");

const PREFIX = "demo";
const ACTOR = "bdp-baseline";

// The exact `bd` identity the Read evidence cohort is measured against. The cohort
// cites these three values together and closes `bdpbd` — and therefore both targets —
// on any drift in any of them.
//
// `version` and `schema_version` identify the release. `observations_digest` pins the
// committed evidence those observations were reduced to, so a recapture cannot move
// the oracle underneath a cohort that already cited it.
//
// The digest deliberately covers the *committed* observation bytes rather than a fresh
// observation. `verify` already proves the installed `bd` reproduces those bytes, so the
// digest pins the evidence while `verify` pins the binary against it. A digest over
// freshly observed output could never be a portable checked-in constant: the host-local
// group of `00-identity.json` differs on every machine but the capture host.
export const IDENTITY_PIN = Object.freeze({
  version: "1.0.5",
  schema_version: 1,
  observations_digest: "d39ced7abdaec37513b93bcafa34ddfbaf62f935cc3a2aa7c6eb1f0b0ccca38b",
});

const VERSION_OBSERVATION = "01-version.json";

// The only ambient variables `bd` is allowed to see. Everything else is dropped,
// and dropping is what scrubs the influences that would otherwise steer a capture:
// `BD_*` and `BEADS_*` (including `BEADS_ACTOR`, which chooses the audit identity),
// `DOLT_*` (storage and remote routing), and Git's routing set (`GIT_DIR`,
// `GIT_WORK_TREE`, `GIT_CONFIG*`, `GIT_CEILING_DIRECTORIES`, and friends), which
// decides where `bd` finds a repository and whose identity it writes. An allowlist
// cannot miss a variable the way a denylist can. `PATH` is deliberately inherited:
// it selects which `bd` runs, and the binary it resolves to is recorded as
// host-local identity.
const PLATFORM_PASSTHROUGH = ["PATH", "TMPDIR"];

// Equal-priority beads are ordered by descending creation time at one-second
// granularity, so the named beads are spaced to make `ready` reproducible.
const CREATE_SPACING_MS = 1100;

// `bd list` defaults to `--limit 50`. The filler pushes the non-closed population
// past that so the committed evidence shows the truncation instead of implying it.
const FILLER_COUNT = 45;

const NAMED = [
  { id: "a", title: "A: unblocked leaf", priority: 2 },
  { id: "b", title: "B: blocked by an open bead", priority: 2 },
  { id: "c", title: "C: unlinked, higher priority", priority: 1 },
  { id: "d", title: "D: blocked only by a closed bead", priority: 2 },
  { id: "e", title: "E: blocker that gets closed", priority: 2 },
  { id: "f", title: "F: only non-blocking links", priority: 2 },
  { id: "g", title: "G: in progress, no blockers", priority: 2 },
  { id: "h", title: "H: blocked transitively through B", priority: 2 },
  { id: "i", title: "I: one closed and one open blocker", priority: 2 },
  { id: "j", title: "J: every blocker closed", priority: 2 },
  { id: "k", title: "K: second blocker that gets closed", priority: 2 },
  { id: "l", title: "L: deferred with no blockers", priority: 2 },
  { id: "m", title: "M: blocked only by a deferred bead", priority: 2 },
];

const LINKS = [
  { from: "b", to: "a", type: "blocks" },
  { from: "d", to: "e", type: "blocks" },
  { from: "h", to: "b", type: "blocks" },
  { from: "i", to: "e", type: "blocks" },
  { from: "i", to: "a", type: "blocks" },
  { from: "j", to: "e", type: "blocks" },
  { from: "j", to: "k", type: "blocks" },
  { from: "m", to: "l", type: "blocks" },
  // The three non-blocking types this baseline actually tests, all on one bead so a
  // single observation shows every one of them failing to block.
  { from: "f", to: "a", type: "related" },
  { from: "f", to: "b", type: "discovered-from" },
  { from: "f", to: "c", type: "tracks" },
];

const CLOSED = ["e", "k"];
const DEFERRED = ["l"];
const IN_PROGRESS = ["g"];

const namedIds = NAMED.map((bead) => `${PREFIX}-${bead.id}`).join(",");

// `--flat` is passed explicitly because `bd list` renders a tree by default
// (`--tree` defaults to true), and the two renderings are not the same bytes.
const COMPLETE_LIST = ["list", "--all", "--limit", "0", "--sort", "id", "--flat"];

// Captured against the named corpus only, before the filler exists: `--explain`
// ignores `--label`, so it cannot be narrowed back to the named beads afterwards.
const SEMANTIC = [
  { file: "01-version.json", args: ["version", "--json"] },
  { file: "02-list-help.txt", args: ["list", "--help"] },
  { file: "03-ready-help.txt", args: ["ready", "--help"] },
  { file: "04-list-named.json", args: [...COMPLETE_LIST, "--id", namedIds, "--json"] },
  { file: "05-show-unblocked.json", args: ["show", "demo-a", "--json"] },
  { file: "06-show-blocked.json", args: ["show", "demo-b", "--json"] },
  { file: "07-show-closed.json", args: ["show", "demo-e", "--json"] },
  { file: "08-show-deferred.json", args: ["show", "demo-l", "--json"] },
  {
    file: "09-dep-list-blocked.json",
    args: ["dep", "list", "--json", "--", "demo-b"],
    sorted: true,
  },
  { file: "10-dep-list-empty.json", args: ["dep", "list", "--json", "--", "demo-a"], sorted: true },
  {
    file: "11-dep-list-dependents.json",
    args: ["dep", "list", "--direction", "up", "--json", "--", "demo-a"],
    sorted: true,
  },
  {
    file: "12-dep-list-non-blocking.json",
    args: ["dep", "list", "--json", "--", "demo-f"],
    sorted: true,
  },
  {
    file: "13-dep-list-closed-blocker.json",
    args: ["dep", "list", "--json", "--", "demo-d"],
    sorted: true,
  },
  {
    file: "14-dep-list-mixed-blockers.json",
    args: ["dep", "list", "--json", "--", "demo-i"],
    sorted: true,
  },
  {
    file: "15-dep-list-all-closed-blockers.json",
    args: ["dep", "list", "--json", "--", "demo-j"],
    sorted: true,
  },
  {
    file: "16-dep-list-deferred-blocker.json",
    args: ["dep", "list", "--json", "--", "demo-m"],
    sorted: true,
  },
  { file: "17-dep-tree-transitive.json", args: ["dep", "tree", "demo-h", "--json"] },
  { file: "18-ready.json", args: ["ready", "--limit", "0", "--json"] },
  { file: "19-ready-explain.txt", args: ["ready", "--explain", "--limit", "0"] },
];

// Captured after the filler exists. All of these sort by id, so they reproduce even
// though the filler is created without creation-time spacing.
//
// Every text capture here records both streams: the truncation warning goes to
// stderr, so a stdout-only capture of 20 would show the false footer total with
// nothing to contradict it, and an empty stderr on 22 is itself the evidence that
// an explicit limit silences the warning.
const SCALE = [
  // 20 and 21 are the same truncated page under the two renderers `bd list` offers.
  // The default is a tree, which prints a footer total; `--flat` prints none at all.
  { file: "20-list-default-truncated.txt", args: ["list", "--sort", "id"], streams: true },
  {
    file: "21-list-default-truncated-flat.txt",
    args: ["list", "--sort", "id", "--flat"],
    streams: true,
  },
  { file: "22-list-complete.txt", args: COMPLETE_LIST, streams: true },
  { file: "23-list-complete.json", args: [...COMPLETE_LIST, "--json"] },
];

const EXTERNAL_DEPENDENCY = "external:beads:mol-run-assignee";
const EXTERNAL = [
  {
    file: "24-dep-add-external.json",
    args: ["dep", "add", "demo-a", EXTERNAL_DEPENDENCY, "--type", "related", "--json"],
  },
  {
    file: "25-list-external.json",
    args: [...COMPLETE_LIST, "--id", "demo-a", "--json"],
  },
  {
    file: "26-dep-list-external.json",
    args: ["dep", "list", "--json", "--", "demo-a"],
    sorted: true,
  },
];

const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

class BaselineError extends Error {}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) {
    throw new BaselineError(`${command} could not be executed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new BaselineError(
      `${command} ${args.join(" ")} exited ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

/**
 * Portable facts identify the release and are comparable on any host. Host-local
 * facts pin this machine's copy of it and cannot match anywhere else, so `verify`
 * treats a difference in the two groups differently.
 */
function identity(bd) {
  const resolved = run("sh", ["-c", "command -v bd"]).stdout.trim();
  const realPath = realpathSync(resolved);
  return {
    portable: {
      version_json: JSON.parse(bd(["version", "--json"]).stdout),
      version_text: bd(["--version"]).stdout.trim(),
    },
    host_local: {
      invoked_as: "bd",
      resolved_from_path: resolved,
      real_path: realPath,
      sha256: createHash("sha256").update(readFileSync(realPath)).digest("hex"),
    },
    // Drift-checked like the portable group: if a future bd starts proving its
    // origin, this baseline must be re-read rather than silently re-captured.
    source_provenance:
      "unverified: bd self-reports only a branch label and a build channel in " +
      "`version --json`, which are claims by the binary rather than proof, and no " +
      "command on this host maps that binary back to the sources that built it",
  };
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function seedNamed(bd) {
  bd(["init", "--prefix", PREFIX, "--skip-agents", "--skip-hooks"]);
  for (const [index, bead] of NAMED.entries()) {
    if (index > 0) sleep(CREATE_SPACING_MS);
    bd([
      "create",
      bead.title,
      "--id",
      `${PREFIX}-${bead.id}`,
      "--type",
      "task",
      "--priority",
      String(bead.priority),
      "--silent",
    ]);
  }
  for (const link of LINKS) {
    bd(["dep", "add", `${PREFIX}-${link.from}`, `${PREFIX}-${link.to}`, "--type", link.type]);
  }
  for (const id of CLOSED) {
    bd(["close", `${PREFIX}-${id}`, "--reason", "baseline closed blocker"]);
  }
  for (const id of IN_PROGRESS) {
    bd(["update", `${PREFIX}-${id}`, "--status", "in_progress"]);
  }
  for (const id of DEFERRED) {
    bd(["defer", `${PREFIX}-${id}`]);
  }
}

function seedFiller(bd) {
  for (let index = 1; index <= FILLER_COUNT; index += 1) {
    const suffix = String(index).padStart(2, "0");
    bd([
      "create",
      `Filler ${suffix}: population past the default list limit`,
      "--id",
      `${PREFIX}-f${suffix}`,
      "--type",
      "task",
      "--priority",
      "3",
      "--silent",
    ]);
  }
}

const byKeys = (keys) => (left, right) => {
  for (const key of keys) {
    const compared = String(left[key] ?? "").localeCompare(String(right[key] ?? ""));
    if (compared !== 0) return compared;
  }
  return 0;
};

/**
 * `bd` emits a bead's dependency edges in no stable order, so the same corpus
 * captured twice differs only in edge sequence. Sorting the edge arrays keeps every
 * byte of content while making the fixtures reproducible; the instability itself is
 * recorded as a finding rather than hidden. Walk order in `dep tree` is meaningful
 * and is never reordered.
 */
function canonicalizeEdges(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonicalizeEdges);
    const isEdge = (item) => typeof item === "object" && item !== null && "depends_on_id" in item;
    return items.length > 0 && items.every(isEdge)
      ? items.sort(byKeys(["depends_on_id", "type"]))
      : items;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, canonicalizeEdges(nested)]),
    );
  }
  return value;
}

// The same unstable edge order reaches both human-readable renderers: `--explain`
// prints it as a `Resolved blockers:` line, and `list --flat` appends it inline as
// `(blocked by: <ids>, blocks: <ids>)`.
const RESOLVED_BLOCKERS = /^(\s*Resolved blockers: )(.+)$/gm;
const INLINE_EDGES = /\(((?:blocked by|blocks): [^)]+)\)/g;
const INLINE_EDGE_GROUP = /(blocked by|blocks): ([^:]+?)(?=, (?:blocked by|blocks): |$)/g;

function sortIdList(ids) {
  return ids
    .split(", ")
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
}

function normalizeText(raw) {
  return raw
    .replace(TIMESTAMP, "<TIMESTAMP>")
    .replace(RESOLVED_BLOCKERS, (_, label, ids) => label.concat(sortIdList(ids)))
    .replace(
      INLINE_EDGES,
      (_, group) =>
        `(${group.replace(INLINE_EDGE_GROUP, (__, label, ids) => `${label}: ${sortIdList(ids)}`)})`,
    );
}

function normalize({ file, sorted, streams }, result) {
  if (streams) {
    return `--- stdout ---\n${normalizeText(result.stdout)}--- stderr ---\n${normalizeText(result.stderr)}`;
  }
  if (!file.endsWith(".json")) return normalizeText(result.stdout);
  const parsed = canonicalizeEdges(JSON.parse(result.stdout.replace(TIMESTAMP, "<TIMESTAMP>")));
  if (sorted && Array.isArray(parsed)) parsed.sort(byKeys(["id", "dependency_type"]));
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function observe() {
  let home;
  let workspace;
  try {
    home = mkdtempSync(path.join(tmpdir(), "bdp-bd-home-"));
    workspace = mkdtempSync(path.join(tmpdir(), "bdp-bd-workspace-"));
    const gitconfig = path.join(home, "gitconfig");
    writeFileSync(gitconfig, `[user]\n\tname = ${ACTOR}\n\temail = ${ACTOR}@invalid\n`);

    const env = { HOME: home, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_SYSTEM: "/dev/null" };
    for (const name of PLATFORM_PASSTHROUGH) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    env.BD_NON_INTERACTIVE = "1";
    env.CI = "true";

    // `--actor` is passed on every command rather than left to bd's fallback chain
    // ($BEADS_ACTOR, then git user.name, then $USER), so the audit identity is a
    // property of this script and not of whatever the host happens to be configured
    // with. The pinned git identity still supplies `owner`.
    const bd = (args) => run("bd", ["--actor", ACTOR, ...args], { cwd: workspace, env });

    const results = new Map([["00-identity.json", `${JSON.stringify(identity(bd), null, 2)}\n`]]);
    seedNamed(bd);
    for (const observation of SEMANTIC) {
      results.set(observation.file, normalize(observation, bd(observation.args)));
    }
    seedFiller(bd);
    for (const observation of SCALE) {
      results.set(observation.file, normalize(observation, bd(observation.args)));
    }
    // Capture after every prior observation so adding the external edge cannot
    // rewrite the established readiness/list oracle numbered 00 through 23.
    for (const observation of EXTERNAL) {
      results.set(observation.file, normalize(observation, bd(observation.args)));
    }
    return results;
  } finally {
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Reduce the committed observations to one digest.
 *
 * Names are compared by code unit rather than by locale, and each record contributes
 * its name, its exact byte length, and its exact bytes, each terminated by a NUL. The
 * length is what stops two different directories from colliding by shifting bytes
 * across a filename boundary; NUL cannot appear in a POSIX filename, so no name can
 * imitate a separator.
 */
export function observationsDigest(root = observationsRoot) {
  const names = readdirSync(root).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const hash = createHash("sha256");
  for (const name of names) {
    const bytes = readFileSync(path.join(root, name));
    hash.update(name, "utf8");
    hash.update(Buffer.of(0));
    hash.update(String(bytes.byteLength), "utf8");
    hash.update(Buffer.of(0));
    hash.update(bytes);
    hash.update(Buffer.of(0));
  }
  return hash.digest("hex");
}

/**
 * Assert the committed evidence still states the pinned identity. This is a check over
 * checked-in bytes only; proving the *installed* binary reproduces them is `verify`'s
 * separate drift comparison, and the cohort requires both.
 */
export function assertIdentityPin() {
  const drift = [];
  let version;
  try {
    version = JSON.parse(readFileSync(path.join(observationsRoot, VERSION_OBSERVATION), "utf8"));
  } catch {
    throw new BaselineError(`missing committed observation ${VERSION_OBSERVATION}`);
  }
  if (version.version !== IDENTITY_PIN.version) {
    drift.push(
      `committed bd version ${JSON.stringify(version.version)} is not the pinned ${IDENTITY_PIN.version}`,
    );
  }
  if (version.schema_version !== IDENTITY_PIN.schema_version) {
    drift.push(
      `committed bd schema_version ${JSON.stringify(version.schema_version)} is not the pinned ${IDENTITY_PIN.schema_version}`,
    );
  }
  const digest = observationsDigest();
  if (digest !== IDENTITY_PIN.observations_digest) {
    drift.push(`committed observations digest ${digest} is not the pinned identity digest`);
  }
  if (drift.length > 0) {
    for (const line of drift) process.stderr.write(`bd-baseline: ${line}\n`);
    throw new BaselineError(
      "baseline identity pin drift; a cohort citing this pin is invalid until it is re-reviewed",
    );
  }
  return { ...IDENTITY_PIN };
}

function capture(results) {
  rmSync(observationsRoot, { recursive: true, force: true });
  mkdirSync(observationsRoot, { recursive: true });
  for (const [file, contents] of results)
    writeFileSync(path.join(observationsRoot, file), contents);
  process.stdout.write(`bd-baseline: captured ${results.size} observations\n`);
}

/**
 * A host-local difference is expected on any machine but the capture host, so it is
 * reported without failing. Everything else — the portable release identity and the
 * provenance statement included — is drift that invalidates the oracle.
 */
function verify(results) {
  const drift = [];
  const notes = [];

  for (const [file, observed] of results) {
    let expected;
    try {
      expected = readFileSync(path.join(observationsRoot, file), "utf8");
    } catch {
      drift.push(`missing committed observation ${file}`);
      continue;
    }
    if (expected === observed) continue;

    if (file !== "00-identity.json") {
      drift.push(`observed output drifted from ${file}`);
      continue;
    }

    const before = JSON.parse(expected);
    const after = JSON.parse(observed);
    if (JSON.stringify(before.portable) !== JSON.stringify(after.portable)) {
      drift.push(`the installed bd is a different release from the pinned baseline (${file})`);
    }
    if (before.source_provenance !== after.source_provenance) {
      drift.push(`the recorded source provenance of bd changed (${file})`);
    }
    if (JSON.stringify(before.host_local) !== JSON.stringify(after.host_local)) {
      notes.push(`${file}: host-local facts differ, as they will on any host but the capture host`);
    }
  }

  for (const file of readdirSync(observationsRoot)) {
    if (!results.has(file)) drift.push(`committed observation ${file} is no longer produced`);
  }

  for (const line of notes) process.stdout.write(`bd-baseline: note: ${line}\n`);
  if (drift.length > 0) {
    for (const line of drift) process.stderr.write(`bd-baseline: ${line}\n`);
    throw new BaselineError(
      "baseline drift; see docs/design/evidence/bd-baseline/README.md before recapturing",
    );
  }
  // Proving the installed binary reproduces the committed bytes is only half the pin;
  // the cohort also requires that those bytes still state the reviewed identity.
  assertIdentityPin();
  process.stdout.write(
    `bd-baseline: verified ${results.size} observations against bd ${IDENTITY_PIN.version} (schema ${IDENTITY_PIN.schema_version})\n`,
  );
}

function main() {
  const mode = process.argv[2];
  if (mode !== "capture" && mode !== "verify" && mode !== "pin") {
    throw new BaselineError('expected "capture", "verify", or "pin"');
  }
  // `pin` is a pure check over committed bytes, so it must not require a `bd` on PATH:
  // the cohort verifier cites it on hosts that never run a capture.
  if (mode === "pin") {
    process.stdout.write(`${JSON.stringify(assertIdentityPin(), null, 2)}\n`);
    return;
  }
  const observations = observe();
  if (mode === "capture") capture(observations);
  else verify(observations);
}

// The cohort generator and verifier import the pin from this module. Running `main` on
// import would make every such import fail on the mode check, so the CLI body only runs
// when this file is the entrypoint.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (!(error instanceof BaselineError)) throw error;
    process.stderr.write(`bd-baseline: ${error.message}\n`);
    process.exitCode = 1;
  }
}
