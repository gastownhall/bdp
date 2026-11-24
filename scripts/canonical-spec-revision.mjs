import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// The canonical-protocol source in the v0.2.3 layout: the normative Core authoring
// source (core.lumen) and the authored protocol narrative (bdp.md). The pre-consolidation
// per-profile sources have been retired to docs/history/ and no longer define the protocol
// the reference server stamps.
const canonicalSources = [
  "specs/src/core/core.lumen",
  "specs/src/bdp.md",
];
export function canonicalSpecRevision(repositoryRoot = root) {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", ...canonicalSources], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(
    dirty,
    "",
    "canonical protocol sources are dirty; commit them before stamping specRevision",
  );
  const revision = execFileSync("git", ["log", "-1", "--format=%H", "--", ...canonicalSources], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  assert.match(revision, /^[0-9a-f]{40}$/u, "expected a full SHA-1 Git commit ID");
  return revision;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.stdout.write(`${canonicalSpecRevision()}\n`);
