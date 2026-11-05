import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const canonicalSources = [
  "specs/profiles/core/core.md",
  "specs/profiles/write/write.md",
  "specs/profiles/types/types.md",
  "specs/profiles/events/events.md",
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
