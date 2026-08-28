import { describe, expect, it } from "vitest";

import {
  readCohortEvidenceConstant,
  ReadCohortVerificationError,
  serializeReadCohortArtifact,
  verifyReadCohortEvidence,
} from "@bdp/conformance";

import {
  ALLOWED_EVIDENCE_DELTA_PATHS,
  assembleVerificationInput,
  assertDistMatchesCommittedConstants,
  classifyEvidenceClaim,
  EvidenceGateError,
  gatherGitFacts,
  READ_COHORT_ARTIFACT_PATH,
  READ_CONFORMANCE_CAPABILITY_PATH,
} from "./read-cohort-evidence.mjs";

const RUN_HEAD = "a".repeat(40);
const EVIDENCE_COMMIT = "b".repeat(40);

const digest = (seed) =>
  seed
    .repeat(64)
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, "0");

describe("evidence claim classification", () => {
  it("gates when nothing claims evidence", () => {
    expect(
      classifyEvidenceClaim({
        evidenceByTarget: { bdptest: undefined, bdpbd: undefined },
        artifactExists: false,
      }),
    ).toBe("absent");
  });

  it("treats one recorded constant as a claim even when the other is absent", () => {
    expect(
      classifyEvidenceClaim({
        evidenceByTarget: { bdptest: "c".repeat(40), bdpbd: undefined },
        artifactExists: false,
      }),
    ).toBe("claimed");
  });

  it("treats a malformed recorded value as a claim, never as absence", () => {
    expect(
      classifyEvidenceClaim({
        evidenceByTarget: { bdptest: "TRANSIENT-BOOTSTRAP", bdpbd: undefined },
        artifactExists: false,
      }),
    ).toBe("claimed");
  });

  it("treats a committed artifact without constants as a claim", () => {
    expect(
      classifyEvidenceClaim({
        evidenceByTarget: { bdptest: undefined, bdpbd: undefined },
        artifactExists: true,
      }),
    ).toBe("claimed");
  });
});

describe("dist and committed source agreement", () => {
  it("accepts a recorded constant that appears verbatim in the committed source", () => {
    const constant = "c".repeat(40);
    expect(() =>
      assertDistMatchesCommittedConstants(
        { bdptest: constant, bdpbd: constant },
        `const READ_COHORT_EVIDENCE_CONSTANT = "${constant}";`,
      ),
    ).not.toThrow();
  });

  it("refuses a stale dist whose constant the committed source no longer declares", () => {
    expect(() =>
      assertDistMatchesCommittedConstants(
        { bdptest: "c".repeat(40), bdpbd: "c".repeat(40) },
        `const READ_COHORT_EVIDENCE_CONSTANT = "${"d".repeat(40)}";`,
      ),
    ).toThrow(/does not match the committed capability source; rebuild/);
  });

  it("is not satisfied by an old constant surviving in a comment", () => {
    const source = [
      `// previously "${"c".repeat(40)}"`,
      `const READ_COHORT_EVIDENCE_CONSTANT = "${"d".repeat(40)}";`,
    ].join("\n");
    expect(() =>
      assertDistMatchesCommittedConstants(
        { bdptest: "c".repeat(40), bdpbd: "c".repeat(40) },
        source,
      ),
    ).toThrow(/does not match the committed capability source/);
  });

  it("refuses a source declaring anything but exactly one constant", () => {
    expect(() =>
      assertDistMatchesCommittedConstants({ bdptest: undefined, bdpbd: undefined }, "no constants"),
    ).toThrow(/declares 0 evidence constants/);
    const two = [
      `const A_CONSTANT = "${"c".repeat(40)}";`,
      `const B_CONSTANT = "${"d".repeat(40)}";`,
    ].join("\n");
    expect(() =>
      assertDistMatchesCommittedConstants({ bdptest: "c".repeat(40), bdpbd: "c".repeat(40) }, two),
    ).toThrow(/declares 2 evidence constants/);
  });
});

describe("git fact gathering", () => {
  it("refuses uncommitted changes to any verification input", () => {
    const runGit = fakeGit({ status: ` M ${READ_COHORT_ARTIFACT_PATH}\n` });

    expect(() => gatherGitFacts({ runGit, runHead: RUN_HEAD })).toThrow(
      /uncommitted changes; the gate verifies committed state only/,
    );
  });

  it("refuses an uncommitted manifest, which feeds the derivations", () => {
    const runGit = fakeGit({ status: " M packages/conformance/matrices/read-v1.json\n" });

    expect(() => gatherGitFacts({ runGit, runHead: RUN_HEAD })).toThrow(
      /uncommitted changes; the gate verifies committed state only/,
    );
  });

  it("refuses evidence paths no commit has ever touched", () => {
    const runGit = fakeGit({ log: "\n" });

    expect(() => gatherGitFacts({ runGit, runHead: RUN_HEAD })).toThrow(
      /no commit touches the evidence paths/,
    );
  });

  it("maps merge-base exit codes onto the ancestry fact", () => {
    expect(
      gatherGitFacts({ runGit: fakeGit({ ancestry: 0 }), runHead: RUN_HEAD }).runHeadIsAncestor,
    ).toBe(true);
    expect(
      gatherGitFacts({ runGit: fakeGit({ ancestry: 1 }), runHead: RUN_HEAD }).runHeadIsAncestor,
    ).toBe(false);
  });

  it("fails closed when git cannot decide ancestry", () => {
    const runGit = fakeGit({ ancestry: 128, ancestryStderr: "fatal: shallow history" });

    expect(() => gatherGitFacts({ runGit, runHead: RUN_HEAD })).toThrow(
      /could not decide ancestry.*shallow history/,
    );
  });

  it("reports the evidence commit and the exact changed paths", () => {
    const runGit = fakeGit({
      diff: `${READ_COHORT_ARTIFACT_PATH}\n${READ_CONFORMANCE_CAPABILITY_PATH}\n\n`,
    });

    const facts = gatherGitFacts({ runGit, runHead: RUN_HEAD });

    expect(facts.evidenceCommit).toBe(EVIDENCE_COMMIT);
    expect(facts.changedPathsSinceRunHead).toEqual([
      READ_COHORT_ARTIFACT_PATH,
      READ_CONFORMANCE_CAPABILITY_PATH,
    ]);
  });

  it("surfaces a git failure instead of continuing on partial facts", () => {
    const runGit = fakeGit({ diffCode: 129, diffStderr: "fatal: bad object" });

    expect(() => gatherGitFacts({ runGit, runHead: RUN_HEAD })).toThrow(EvidenceGateError);
    expect(() => gatherGitFacts({ runGit, runHead: RUN_HEAD })).toThrow(/bad object/);
  });
});

describe("verification wiring", () => {
  it("passes a genuine cohort through the real verifier", () => {
    const { input } = genuineVerificationInput();

    expect(() => verifyReadCohortEvidence(input)).not.toThrow();
  });

  it("refuses a fabricated well-formed constant", () => {
    const { input, constant } = genuineVerificationInput();
    const fabricated = "f".repeat(40);
    expect(fabricated).not.toBe(constant);

    const forged = {
      ...input,
      evidenceByTarget: { bdptest: fabricated, bdpbd: fabricated },
    };

    expect(() => verifyReadCohortEvidence(forged)).toThrow(ReadCohortVerificationError);
    expect(() => verifyReadCohortEvidence(forged)).toThrow(
      /evidence does not match the artifact's content digest/,
    );
  });

  it("refuses an artifact whose target lost a required row", () => {
    const artifact = minimalArtifact();
    const shrunk = {
      ...artifact,
      targets: artifact.targets.map((target, index) =>
        index === 0
          ? { ...target, segments: target.segments.filter((s) => s.admission === "packaged") }
          : target,
      ),
    };
    const { input } = genuineVerificationInput(shrunk);

    expect(() => verifyReadCohortEvidence(input)).toThrow(
      /target 'bdptest' is missing required row 'read.scope.restore-identity'/,
    );
  });

  it("refuses the bootstrap shape: a packaged-required row exercised in-process", () => {
    const artifact = minimalArtifact();
    const bootstrapped = {
      ...artifact,
      targets: artifact.targets.map((target) => ({
        ...target,
        packagedRows: 0,
        selfCertifiedRows: 2,
        segments: target.segments.map((segment) => ({
          ...segment,
          admission: "in-process",
          bindings: Object.fromEntries(
            Object.entries(segment.bindings).filter(
              ([key]) => !["installedPayload", "targetProcess", "workspace"].includes(key),
            ),
          ),
          scenarios: segment.scenarios.map((scenario) => ({
            ...scenario,
            admission: "in-process",
          })),
        })),
      })),
    };
    const { input } = genuineVerificationInput(bootstrapped);

    expect(() => verifyReadCohortEvidence(input)).toThrow(
      /exercised in-process but is not self-certifiable/,
    );
  });

  it("refuses a delta that escapes the artifact and the constant", () => {
    const { input } = genuineVerificationInput();
    const escaped = {
      ...input,
      changedPathsSinceRunHead: [...input.changedPathsSinceRunHead, "packages/server/src/index.ts"],
    };

    expect(() => verifyReadCohortEvidence(escaped)).toThrow(/escape the evidence delta/);
  });

  it("refuses reformatted artifact bytes even when every field still parses", () => {
    const { input, artifact } = genuineVerificationInput();
    const pretty = new TextEncoder().encode(`${JSON.stringify(artifact, null, 2)}\n`);

    expect(() => verifyReadCohortEvidence({ ...input, artifactBytes: pretty })).toThrow(
      /not canonical/,
    );
  });
});

function fakeGit({
  status = "",
  log = `${EVIDENCE_COMMIT}\n`,
  ancestry = 0,
  ancestryStderr = "",
  diff = "",
  diffCode = 0,
  diffStderr = "",
} = {}) {
  return (args) => {
    switch (args[0]) {
      case "status":
        return { code: 0, stdout: status, stderr: "" };
      case "log":
        return { code: 0, stdout: log, stderr: "" };
      case "merge-base":
        return { code: ancestry, stdout: "", stderr: ancestryStderr };
      case "diff":
        return { code: diffCode, stdout: diff, stderr: diffStderr };
      default:
        throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    }
  };
}

const REQUIRED_IDS = ["read.discovery.document", "read.scope.restore-identity"];

/**
 * The smallest structurally complete artifact the verifier accepts: one
 * packaged row and one self-certifiable in-process row, carried identically by
 * both targets, with well-formed bindings on every segment.
 */
function minimalArtifact() {
  const baseBindings = {
    catalog: digest("c1"),
    manifest: digest("d2"),
    fixture: digest("e3"),
    schema: digest("11"),
    validator: digest("22"),
    runner: digest("33"),
    harness: digest("44"),
    executor: digest("55"),
  };
  const segmentFor = (admission, scenario, bd) => ({
    admission,
    targetLabel: "test",
    scope: "http://127.0.0.1:18280/local-test/",
    profile: "read",
    seed: 1,
    bindings: {
      ...baseBindings,
      ...(admission === "packaged"
        ? { installedPayload: digest("66"), targetProcess: digest("77"), workspace: digest("88") }
        : {}),
      ...(bd ? { bdExecutable: digest("f4") } : {}),
    },
    ...(bd
      ? { bdIdentity: { version: "1.0.5", schemaVersion: 1, observationsDigest: digest("ab") } }
      : {}),
    scenarios: [scenario],
  });
  const targetFor = (target) => {
    const bd = target === "bdpbd";
    return {
      target,
      scores: { pass: 2, other: 0 },
      packagedRows: 1,
      selfCertifiedRows: 1,
      segments: [
        segmentFor(
          "packaged",
          { id: "read.discovery.document", state: "pass", admission: "packaged", exchanges: [] },
          bd,
        ),
        segmentFor(
          "in-process",
          {
            id: "read.scope.restore-identity",
            state: "pass",
            admission: "in-process",
            exchanges: [],
          },
          bd,
        ),
      ],
    };
  };
  return {
    cohortVersion: 1,
    catalogId: "read-v1",
    selfCertified: ["read.scope.restore-identity"],
    selfCertifiedNote:
      "The self-certified rows were exercised in-process and are not independently verified.",
    runHead: RUN_HEAD,
    requiredScenarioIds: REQUIRED_IDS,
    uncovered: [
      { scenarioId: "read.discovery.document", variant: "absent-optional", reason: "unexercised" },
    ],
    targets: [targetFor("bdptest"), targetFor("bdpbd")],
  };
}

function genuineVerificationInput(artifact = minimalArtifact()) {
  const artifactBytes = serializeReadCohortArtifact(artifact);
  const constant = readCohortEvidenceConstant(artifactBytes);
  const input = assembleVerificationInput({
    artifactBytes,
    evidenceByTarget: { bdptest: constant, bdpbd: constant },
    requiredScenarioIds: REQUIRED_IDS,
    derivedSelfCertifiable: ["read.scope.restore-identity"],
    expectedBdIdentity: { version: "1.0.5", schemaVersion: 1, observationsDigest: digest("ab") },
    gitFacts: {
      evidenceCommit: EVIDENCE_COMMIT,
      runHeadIsAncestor: true,
      changedPathsSinceRunHead: [...ALLOWED_EVIDENCE_DELTA_PATHS],
    },
  });
  return { input, constant, artifact };
}
