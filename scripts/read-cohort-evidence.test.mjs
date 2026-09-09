import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  deriveReadCohortNotApplicableRows,
  deriveReadCohortRequiredScenarioIds,
  deriveReadCohortSelfCertifiableIds,
  deriveReadSchemaProjectionRoots,
  loadExecutableScenarioManifestJson,
  loadScenarioCatalogJson,
  projectReadSchemaBundle,
  readCohortEvidenceConstant,
  ReadCohortVerificationError,
  serializeReadCohortArtifact,
  verifyReadCohortEvidence,
} from "@bdp/conformance";

import { assertIdentityPin } from "./bd-baseline.mjs";
import {
  ALLOWED_EVIDENCE_DELTA_PATHS,
  assembleVerificationInput,
  deriveReadInputBindings,
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

/**
 * D29 = C / RP1, proved both ways over the committed bytes: the gate refuses a
 * change to a sealed definition — reachable from Read or not — and tolerates
 * everything outside the sealed definitions' text: top-level bundle metadata
 * and definitions the seal does not name. The inputs are the real catalog,
 * manifest, fixtures, bundle, and sealed artifact; only the git facts are
 * stubbed, and the constant is recomputed from the artifact so the test
 * isolates the projection rule from the constant check the gate makes
 * separately.
 */
describe("Read schema projection drift over the committed cohort", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const committed = existsSync(path.join(root, READ_COHORT_ARTIFACT_PATH));
  const readText = (relative) => readFileSync(path.join(root, relative), "utf8");
  const parseJson = (relative) => JSON.parse(readText(relative));
  const committedBundle = () => parseJson("schemas/bdp-v0.schema.json");

  function committedInput(bundle) {
    const catalogPath = "packages/conformance/catalog/read-v1.json";
    const manifestPath = "packages/conformance/matrices/read-v1.json";
    const artifactBytes = readFileSync(path.join(root, READ_COHORT_ARTIFACT_PATH));
    const catalog = loadScenarioCatalogJson(readText(catalogPath), catalogPath);
    const manifest = loadExecutableScenarioManifestJson(readText(manifestPath), manifestPath);
    const requiredScenarioIds = deriveReadCohortRequiredScenarioIds(catalog);
    const capabilitiesOf = (relative) => parseJson(relative).capabilities ?? [];
    const notApplicableFor = (fixture) =>
      deriveReadCohortNotApplicableRows(manifest, requiredScenarioIds, capabilitiesOf(fixture));
    const pinned = assertIdentityPin();
    const constant = readCohortEvidenceConstant(artifactBytes);
    return assembleVerificationInput({
      artifactBytes,
      evidenceByTarget: { bdptest: constant, bdpbd: constant },
      requiredScenarioIds,
      derivedNotApplicableByTarget: {
        bdptest: notApplicableFor("packages/conformance/fixtures/read-reference-v1.json"),
        bdpbd: notApplicableFor("packages/conformance/fixtures/read-bdpbd-v1.json"),
      },
      derivedSelfCertifiable: deriveReadCohortSelfCertifiableIds(manifest, requiredScenarioIds),
      derivedSchemaReadProjection: projectReadSchemaBundle(
        bundle,
        deriveReadSchemaProjectionRoots(manifest),
      ).digest,
      derivedInputBindings: deriveReadInputBindings({
        catalogBytes: readText(catalogPath),
        manifestBytes: readText(manifestPath),
        fixtureBytesByTarget: {
          bdptest: readText("packages/conformance/fixtures/read-reference-v1.json"),
          bdpbd: readText("packages/conformance/fixtures/read-bdpbd-v1.json"),
        },
      }),
      expectedBdIdentity: {
        version: pinned.version,
        schemaVersion: pinned.schema_version,
        observationsDigest: pinned.observations_digest,
      },
      gitFacts: {
        evidenceCommit: EVIDENCE_COMMIT,
        runHeadIsAncestor: true,
        changedPathsSinceRunHead: [...ALLOWED_EVIDENCE_DELTA_PATHS],
      },
    });
  }

  it.skipIf(!committed)(
    "verifies the sealed cohort against the committed bundle's Read projection",
    () => {
      expect(() => verifyReadCohortEvidence(committedInput(committedBundle()))).not.toThrow();
    },
  );

  it.skipIf(!committed)(
    "refuses a change to a sealed definition: a new advertisedLimits member forces a re-seal",
    () => {
      const bundle = committedBundle();
      bundle.$defs.advertisedLimits.properties.snapshot = {
        type: "object",
        properties: { maximumAgeSeconds: { $ref: "#/$defs/positiveInteger" } },
        additionalProperties: false,
      };
      expect(() => verifyReadCohortEvidence(committedInput(bundle))).toThrow(
        /Read schema projection drift: re-seal required/,
      );
    },
  );

  // The finding behind RP1: nothing in Read references the profile token enum
  // (discovery pins the constant `read`), so the reachable closure left it out
  // and a token added there shipped on evidence sealed against the old enum.
  // The seal names it, so it moves the digest like any sealed definition.
  it.skipIf(!committed)(
    "refuses a change to a sealed definition nothing in Read references: a protocolProfile token forces a re-seal",
    () => {
      const bundle = committedBundle();
      bundle.$defs.protocolProfile.enum.push("read-update-v2");
      expect(() => verifyReadCohortEvidence(committedInput(bundle))).toThrow(
        /Read schema projection drift: re-seal required/,
      );
    },
  );

  it.skipIf(!committed)(
    "tolerates top-level bundle metadata drift: description, title, $id, and $schema are outside the digest",
    () => {
      const bundle = committedBundle();
      bundle.description = `${bundle.description} Rewritten since the seal.`;
      bundle.title = "renamed bundle";
      bundle.$id = "https://schemas.example/moved.json";
      bundle.$schema = "https://json-schema.org/draft/2019-09/schema";
      expect(() => verifyReadCohortEvidence(committedInput(bundle))).not.toThrow();
    },
  );

  it.skipIf(!committed)("refuses a bundle that no longer carries a sealed definition", () => {
    const bundle = committedBundle();
    delete bundle.$defs.protocolProfile;
    expect(() => committedInput(bundle)).toThrow(
      /sealed definition 'protocolProfile' is missing from the bundle/,
    );
  });

  it.skipIf(!committed)(
    "tolerates a definition the seal does not name, added by a later profile",
    () => {
      const bundle = committedBundle();
      bundle.$defs.updateSequence = {
        type: "object",
        required: ["operations"],
        properties: {
          operations: { type: "array", items: { $ref: "#/$defs/beadRecord" } },
          attribution: { $ref: "#/$defs/attribution" },
        },
        additionalProperties: false,
      };
      expect(() => verifyReadCohortEvidence(committedInput(bundle))).not.toThrow();
    },
  );
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
    schemaReadProjection: digest("12"),
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
      notApplicable: [],
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
    derivedNotApplicableByTarget: { bdptest: [], bdpbd: [] },
    derivedSelfCertifiable: ["read.scope.restore-identity"],
    derivedSchemaReadProjection: digest("12"),
    derivedInputBindings: {
      catalog: digest("c1"),
      manifest: digest("d2"),
      fixtures: { bdptest: digest("e3"), bdpbd: digest("e3") },
    },
    expectedBdIdentity: { version: "1.0.5", schemaVersion: 1, observationsDigest: digest("ab") },
    gitFacts: {
      evidenceCommit: EVIDENCE_COMMIT,
      runHeadIsAncestor: true,
      changedPathsSinceRunHead: [...ALLOWED_EVIDENCE_DELTA_PATHS],
    },
  });
  return { input, constant, artifact };
}

describe("exact current input byte derivation", () => {
  it("detects an assertion-only manifest change with unchanged scenario IDs and schema roots", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const relative = "packages/conformance/matrices/read-v1.json";
    const manifestBytes = readFileSync(path.join(root, relative), "utf8");
    const original = JSON.parse(manifestBytes);
    const changed = structuredClone(original);
    function alterAssertion(value) {
      if (value === null || typeof value !== "object") return false;
      if (
        value.kind === "json-pointer" &&
        value.exists === false &&
        typeof value.pointer === "string"
      ) {
        value.pointer = "/different-assertion";
        return true;
      }
      return Object.values(value).some(alterAssertion);
    }
    expect(alterAssertion(changed)).toBe(true);
    const changedBytes = JSON.stringify(changed);
    const before = loadExecutableScenarioManifestJson(manifestBytes, relative);
    const after = loadExecutableScenarioManifestJson(changedBytes, relative);
    expect(deriveReadSchemaProjectionRoots(after)).toEqual(deriveReadSchemaProjectionRoots(before));
    expect(after.scenarios.map((row) => row.id)).toEqual(before.scenarios.map((row) => row.id));
    const inputs = {
      catalogBytes: readFileSync(path.join(root, "packages/conformance/catalog/read-v1.json")),
      manifestBytes,
      fixtureBytesByTarget: {
        bdptest: readFileSync(
          path.join(root, "packages/conformance/fixtures/read-reference-v1.json"),
        ),
        bdpbd: readFileSync(path.join(root, "packages/conformance/fixtures/read-bdpbd-v1.json")),
      },
    };
    const expected = deriveReadInputBindings(inputs);
    const actual = deriveReadInputBindings({ ...inputs, manifestBytes: changedBytes });
    expect(actual.manifest).not.toBe(expected.manifest);
    expect(actual.catalog).toBe(expected.catalog);
    expect(actual.fixtures).toEqual(expected.fixtures);
  });
});
