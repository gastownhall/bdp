#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { assertIdentityPin } from "./bd-baseline.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * The one committed cohort artifact and the one shipped evidence record. These
 * two paths are also the only paths the run-head-to-evidence-commit delta may
 * touch: anything else changing in that window means the implementation the run
 * observed is not the implementation the evidence admits.
 */
export const READ_COHORT_ARTIFACT_PATH = "docs/design/evidence/read-cohort/read-v1.json";
export const READ_CONFORMANCE_CAPABILITY_PATH =
  "packages/server/src/read-conformance-capability.ts";
export const ALLOWED_EVIDENCE_DELTA_PATHS = Object.freeze([
  READ_COHORT_ARTIFACT_PATH,
  READ_CONFORMANCE_CAPABILITY_PATH,
]);

const CATALOG_PATH = "packages/conformance/catalog/read-v1.json";
const MANIFEST_PATH = "packages/conformance/matrices/read-v1.json";

/**
 * Everything verification reads from the working tree must be committed state:
 * the evidence paths, and the catalog/manifest the derivations come from. A
 * dirty input would let a local run verify against bytes no commit describes.
 */
export const VERIFICATION_INPUT_PATHS = Object.freeze([
  ...ALLOWED_EVIDENCE_DELTA_PATHS,
  CATALOG_PATH,
  MANIFEST_PATH,
]);

export class EvidenceGateError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "EvidenceGateError";
  }
}

function emit(level, event, fields) {
  const line = { level, event, executable: "read-cohort-evidence", ...fields };
  (level === "error" ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
}

/**
 * Decide whether anything in the tree claims read-cohort evidence.
 *
 * "Absent" is the safe state — admission is fail-closed without evidence — so it
 * gates rather than fails. Any claim at all, including a malformed constant or
 * an artifact with no constants, commits the tree to full verification: the
 * whole point of this gate is that a bare well-formed hex string must never
 * admit the server unchallenged.
 */
export function classifyEvidenceClaim({ evidenceByTarget, artifactExists }) {
  const claimed =
    artifactExists || Object.values(evidenceByTarget).some((value) => value !== undefined);
  return claimed ? "claimed" : "absent";
}

/**
 * Prove the shipped record and the committed source agree on the constants.
 * The gate reads the recorded values from the built dist; a stale local build
 * could otherwise report green for a HEAD whose committed constant differs.
 * The comparison targets the source's constant declarations specifically —
 * a bare substring scan would be satisfied by an old constant surviving in a
 * comment. Exactly one declared constant is expected: one cohort, one digest.
 */
export function assertDistMatchesCommittedConstants(evidenceByTarget, capabilitySource) {
  const declared = [
    ...new Set(
      [...capabilitySource.matchAll(/^const [A-Z0-9_]+ = "([0-9a-f]{40})";$/gm)].map(
        (match) => match[1],
      ),
    ),
  ];
  if (declared.length !== 1) {
    throw new EvidenceGateError(
      `the committed capability source declares ${declared.length} evidence constants; exactly one is expected`,
    );
  }
  for (const [target, value] of Object.entries(evidenceByTarget)) {
    if (value === undefined) continue;
    if (value !== declared[0]) {
      throw new EvidenceGateError(
        `the built evidence record for '${target}' does not match the committed capability source; rebuild before verifying`,
      );
    }
  }
}

/**
 * Gather the git facts the verifier consumes, from committed state only.
 *
 * `runGit` is injected so the fact-gathering rules are testable without
 * constructing repositories, mirroring how the verifier itself stays pure. The
 * evidence commit is the most recent commit touching either evidence path; the
 * delta the verifier confines is run head → that commit, so later unrelated
 * commits do not reopen a sealed cohort, while any later touch of an evidence
 * path moves the evidence commit forward and forces the proof to be redone.
 */
export function gatherGitFacts({ runGit, runHead }) {
  const status = expectGit(runGit, ["status", "--porcelain", "--", ...VERIFICATION_INPUT_PATHS]);
  if (status.trim().length > 0) {
    throw new EvidenceGateError(
      "verification inputs carry uncommitted changes; the gate verifies committed state only",
    );
  }

  const evidenceCommit = expectGit(runGit, [
    "log",
    "--max-count=1",
    "--format=%H",
    "HEAD",
    "--",
    ...ALLOWED_EVIDENCE_DELTA_PATHS,
  ]).trim();
  if (evidenceCommit.length === 0) {
    throw new EvidenceGateError("no commit touches the evidence paths; evidence is not committed");
  }

  const ancestry = runGit(["merge-base", "--is-ancestor", runHead, evidenceCommit]);
  if (ancestry.code !== 0 && ancestry.code !== 1) {
    throw new EvidenceGateError(
      `git could not decide ancestry for run head ${runHead}: ${ancestry.stderr.trim()}`,
    );
  }

  const changedPathsSinceRunHead = expectGit(runGit, [
    "diff",
    "--name-only",
    runHead,
    evidenceCommit,
  ])
    .split("\n")
    .filter((line) => line.length > 0);

  return {
    evidenceCommit,
    runHeadIsAncestor: ancestry.code === 0,
    changedPathsSinceRunHead,
  };
}

function expectGit(runGit, args) {
  const result = runGit(args);
  if (result.code !== 0) {
    throw new EvidenceGateError(`git ${args[0]} failed (${result.code}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/**
 * Assemble the verifier's input. The verifier parses the committed artifact
 * bytes itself and re-proves every structural claim from them, so the gate
 * supplies only what the bytes cannot carry: the derived sets and git facts.
 */
export function assembleVerificationInput({
  artifactBytes,
  evidenceByTarget,
  requiredScenarioIds,
  derivedSelfCertifiable,
  expectedBdIdentity,
  gitFacts,
}) {
  return {
    artifactBytes,
    evidenceByTarget,
    requiredScenarioIds,
    derivedSelfCertifiable,
    expectedBdIdentity,
    runHeadIsAncestor: gitFacts.runHeadIsAncestor,
    changedPathsSinceRunHead: gitFacts.changedPathsSinceRunHead,
    allowedDeltaPaths: ALLOWED_EVIDENCE_DELTA_PATHS,
  };
}

function runGitInRoot(args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.error !== undefined) {
    throw new EvidenceGateError(`git did not run: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export async function main() {
  let conformance;
  let capability;
  try {
    conformance = await import("../packages/conformance/dist/index.js");
    capability = await import("../packages/server/dist/read-conformance-capability.js");
  } catch {
    // Exit 3, never 2: "cannot inspect the claim" must stay distinguishable
    // from "no claim exists". CI accepts only 2, so a broken build graph that
    // stops emitting the dist fails the job instead of passing silently.
    emit("error", "evidence.unavailable", {
      message: "build the workspace before verifying read-cohort evidence",
    });
    return 3;
  }
  if (typeof capability.recordedReadConformanceEvidence !== "function") {
    emit("error", "evidence.unavailable", {
      message: "the built @bdp/server is stale; rebuild before verifying read-cohort evidence",
    });
    return 3;
  }

  const evidenceByTarget = {
    bdptest: capability.recordedReadConformanceEvidence("bdptest"),
    bdpbd: capability.recordedReadConformanceEvidence("bdpbd"),
  };
  const artifactAbsolutePath = path.join(root, READ_COHORT_ARTIFACT_PATH);
  const artifactExists = existsSync(artifactAbsolutePath);

  if (classifyEvidenceClaim({ evidenceByTarget, artifactExists }) === "absent") {
    emit("error", "evidence.gated", {
      message: "no read-cohort evidence is claimed; shipping admission remains fail-closed",
    });
    return 2;
  }

  try {
    if (!artifactExists) {
      throw new EvidenceGateError(
        `an evidence constant is recorded but no cohort artifact is committed at ${READ_COHORT_ARTIFACT_PATH}`,
      );
    }

    assertDistMatchesCommittedConstants(
      evidenceByTarget,
      readFileSync(path.join(root, READ_CONFORMANCE_CAPABILITY_PATH), "utf8"),
    );

    const artifactBytes = readFileSync(artifactAbsolutePath);
    let artifact;
    try {
      artifact = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes));
    } catch (cause) {
      throw new EvidenceGateError("the committed cohort artifact is not valid UTF-8 JSON", {
        cause,
      });
    }

    const catalog = conformance.loadScenarioCatalogJson(
      readFileSync(path.join(root, CATALOG_PATH), "utf8"),
      CATALOG_PATH,
    );
    const manifest = conformance.loadExecutableScenarioManifestJson(
      readFileSync(path.join(root, MANIFEST_PATH), "utf8"),
      MANIFEST_PATH,
    );
    const requiredScenarioIds = conformance.deriveReadCohortRequiredScenarioIds(catalog);
    const derivedSelfCertifiable = conformance.deriveReadCohortSelfCertifiableIds(
      manifest,
      requiredScenarioIds,
    );
    // D4: recompute the bd identity pin from the committed baseline
    // observations (pure bytes, no bd on PATH needed); the verifier requires
    // every bdpbd segment to record exactly this identity.
    const pinned = assertIdentityPin();
    const expectedBdIdentity = {
      version: pinned.version,
      schemaVersion: pinned.schema_version,
      observationsDigest: pinned.observations_digest,
    };

    const recordedRunHead = typeof artifact?.runHead === "string" ? artifact.runHead : "";
    if (!/^[0-9a-f]{40}$/.test(recordedRunHead)) {
      throw new EvidenceGateError("the committed cohort artifact records a malformed run head");
    }
    const gitFacts = gatherGitFacts({ runGit: runGitInRoot, runHead: recordedRunHead });

    const input = assembleVerificationInput({
      artifactBytes,
      evidenceByTarget,
      requiredScenarioIds,
      derivedSelfCertifiable,
      expectedBdIdentity,
      gitFacts,
    });
    conformance.verifyReadCohortEvidence(input);

    emit("info", "evidence.verified", {
      artifact: READ_COHORT_ARTIFACT_PATH,
      constant: conformance.readCohortEvidenceConstant(artifactBytes),
      runHead: recordedRunHead,
      evidenceCommit: gitFacts.evidenceCommit,
      rows: (artifact.targets ?? []).reduce(
        (total, target) =>
          total +
          (target.segments ?? []).reduce(
            (segmentTotal, segment) => segmentTotal + (segment.scenarios ?? []).length,
            0,
          ),
        0,
      ),
    });
    return 0;
  } catch (error) {
    // Any failure while a claim exists is a red gate. A claim that cannot be
    // proved must never degrade into "no claim".
    emit("error", "evidence.failed", {
      error: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
    });
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
