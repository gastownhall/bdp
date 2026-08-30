import { describe, expect, it } from "vitest";

import {
  type ReadCohortVerificationInput,
  ReadCohortVerificationError,
  readCohortEvidenceConstant,
  serializeReadCohortArtifact,
  verifyReadCohortEvidence,
} from "./index.js";

const RUN_HEAD = "b".repeat(40);
const ARTIFACT_PATH = "packages/conformance/cohort/read-v1.json";
const CONSTANT_PATH = "packages/server/src/read-conformance-capability.ts";

const digest = (seed: string): string =>
  seed
    .repeat(64)
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, "0");

const REQUIRED = ["read.a", "read.b"];
const SELF_CERTIFIABLE = ["read.b"];

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

const packagedBindings = {
  ...baseBindings,
  installedPayload: digest("66"),
  targetProcess: digest("77"),
  workspace: digest("88"),
};

const bdIdentity = {
  version: "1.0.5",
  schemaVersion: 1,
  observationsDigest: digest("ab"),
};

function row(id: string, admission: string, state = "pass") {
  return { id, state, admission, exchanges: [] };
}

function segment(admission: "packaged" | "in-process", rows: unknown[], bd: boolean) {
  return {
    admission,
    targetLabel: "test",
    scope: "https://scope.example/acme/",
    profile: "read",
    seed: 0,
    bindings: {
      ...(admission === "packaged" ? packagedBindings : baseBindings),
      ...(bd ? { bdExecutable: digest("f4") } : {}),
    },
    ...(bd ? { bdIdentity } : {}),
    scenarios: rows,
  };
}

function target(name: "bdptest" | "bdpbd") {
  const bd = name === "bdpbd";
  return {
    target: name,
    scores: { pass: 2, other: 0 },
    packagedRows: 1,
    selfCertifiedRows: 1,
    segments: [
      segment("packaged", [row("read.a", "packaged")], bd),
      segment("in-process", [row("read.b", "in-process")], bd),
    ],
  };
}

function artifact(): Record<string, unknown> {
  return {
    cohortVersion: 1,
    catalogId: "read-v1",
    selfCertified: SELF_CERTIFIABLE,
    selfCertifiedNote: "not independently verified",
    runHead: RUN_HEAD,
    requiredScenarioIds: REQUIRED,
    uncovered: [{ scenarioId: "read.a", variant: "absent-optional", reason: "unexercised" }],
    targets: [target("bdptest"), target("bdpbd")],
  };
}

/** Serialize the (possibly mutated) artifact and pair it with matching constants. */
function inputFor(
  value: Record<string, unknown>,
  overrides: Partial<ReadCohortVerificationInput> = {},
): ReadCohortVerificationInput {
  const bytes = serializeReadCohortArtifact(value as never);
  const constant = readCohortEvidenceConstant(bytes);
  return {
    artifactBytes: bytes,
    evidenceByTarget: { bdptest: constant, bdpbd: constant },
    requiredScenarioIds: REQUIRED,
    derivedNotApplicableByTarget: {},
    derivedSelfCertifiable: SELF_CERTIFIABLE,
    expectedBdIdentity: bdIdentity,
    runHeadIsAncestor: true,
    changedPathsSinceRunHead: [ARTIFACT_PATH, CONSTANT_PATH],
    allowedDeltaPaths: [ARTIFACT_PATH, CONSTANT_PATH],
    ...overrides,
  };
}

/** Mutate one target in an otherwise genuine artifact. */
function withTarget(
  name: "bdptest" | "bdpbd",
  mutate: (entry: Record<string, unknown>) => void,
): Record<string, unknown> {
  const value = artifact();
  const entry = (value.targets as Record<string, unknown>[]).find((t) => t.target === name);
  if (entry === undefined) throw new Error("test artifact missing target");
  mutate(entry);
  return value;
}

/** Index into a test structure, failing the test loudly instead of typing away undefined. */
function at(list: unknown, index: number): Record<string, unknown> {
  const entry = (list as Record<string, unknown>[])[index];
  if (entry === undefined) throw new Error(`test artifact missing entry ${index}`);
  return entry;
}

describe("read cohort evidence verification", () => {
  it("accepts a cohort whose constant, ancestry, delta, coverage and provenance all hold", () => {
    expect(() => verifyReadCohortEvidence(inputFor(artifact()))).not.toThrow();
  });

  // The bootstrap commit is meant to exist transiently in branch history. These
  // are what stop it being shippable if it is cherry-picked or left behind.
  it("refuses a row exercised in-process that is not self-certifiable", () => {
    const forged = withTarget("bdptest", (entry) => {
      entry.segments = [
        segment("in-process", [row("read.a", "in-process"), row("read.b", "in-process")], false),
      ];
      entry.packagedRows = 0;
      entry.selfCertifiedRows = 2;
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /'read.a' was exercised in-process but is not self-certifiable/,
    );
  });

  // Deleting a failing row is the cheapest forgery; relabeling its admission is
  // the next cheapest. Both are refused from the committed bytes.
  it("refuses a target missing a required row", () => {
    const forged = withTarget("bdptest", (entry) => {
      entry.segments = [segment("packaged", [row("read.a", "packaged")], false)];
      entry.scores = { pass: 1, other: 0 };
      entry.packagedRows = 1;
      entry.selfCertifiedRows = 0;
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /target 'bdptest' is missing required row 'read.b'/,
    );
  });

  it("refuses an in-process segment relabeled as packaged, because the packaged bindings it cannot carry are demanded", () => {
    const forged = withTarget("bdptest", (entry) => {
      const inProcess = at(entry.segments, 1);
      inProcess.admission = "packaged";
      at(inProcess.scenarios, 0).admission = "packaged";
      entry.packagedRows = 2;
      entry.selfCertifiedRows = 0;
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /packaged target 'bdptest' binding 'installedPayload' must be a sha-256 hex digest/,
    );
  });

  it("refuses a row whose admission disagrees with its segment", () => {
    const forged = withTarget("bdptest", (entry) => {
      const inProcess = at(entry.segments, 1);
      at(inProcess.scenarios, 0).admission = "packaged";
      entry.packagedRows = 2;
      entry.selfCertifiedRows = 0;
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /row 'read.b' admission disagrees with its segment/,
    );
  });

  it("refuses a packaged segment stripped of its packaged bindings", () => {
    const forged = withTarget("bdpbd", (entry) => {
      const packaged = at(entry.segments, 0);
      packaged.bindings = { ...baseBindings, bdExecutable: digest("f4") };
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /packaged target 'bdpbd' binding 'installedPayload' must be a sha-256 hex digest/,
    );
  });

  it("refuses an in-process segment claiming packaged bindings", () => {
    const forged = withTarget("bdptest", (entry) => {
      const inProcess = at(entry.segments, 1);
      inProcess.bindings = { ...packagedBindings };
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /in-process run for 'bdptest' must not claim binding 'installedPayload'/,
    );
  });

  it("refuses bdpbd without a bd executable digest or identity pin", () => {
    const forged = withTarget("bdpbd", (entry) => {
      const segments = entry.segments as Record<string, unknown>[];
      for (const seg of segments) {
        const bindings = { ...(seg.bindings as Record<string, unknown>) };
        delete bindings.bdExecutable;
        seg.bindings = bindings;
        delete seg.bdIdentity;
      }
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /target 'bdpbd' must bind the sha-256 digest of the bd executable/,
    );
  });

  it("refuses bdptest claiming a bd binding", () => {
    const forged = withTarget("bdptest", (entry) => {
      const packaged = at(entry.segments, 0);
      packaged.bindings = {
        ...(packaged.bindings as Record<string, unknown>),
        bdExecutable: digest("f4"),
      };
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /target 'bdptest' must not claim a bd binding/,
    );
  });

  it("refuses an emptied uncovered list, which would assert total coverage", () => {
    const forged = artifact();
    forged.uncovered = [];
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /declares no uncovered variants/,
    );
  });

  it("refuses scores that disagree with the recorded rows", () => {
    const forged = withTarget("bdptest", (entry) => {
      entry.packagedRows = 2;
      entry.selfCertifiedRows = 0;
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /target 'bdptest' scores disagree with its recorded rows/,
    );
  });

  it("refuses a recorded required set that the catalog does not derive", () => {
    const forged = artifact();
    forged.requiredScenarioIds = ["read.a"];
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /required scenario ids do not match the set derived from the bound catalog/,
    );
  });

  it("refuses any recorded state other than pass", () => {
    const forged = withTarget("bdptest", (entry) => {
      at(at(entry.segments, 0).scenarios, 0).state = "fail";
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /records row 'read.a' as 'fail'; pass is the only admissible state/,
    );
  });

  it("refuses a duplicated row inside one target", () => {
    const forged = withTarget("bdptest", (entry) => {
      (at(entry.segments, 0).scenarios as unknown[]).push(row("read.a", "packaged"));
      entry.scores = { pass: 3, other: 0 };
      entry.packagedRows = 2;
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /carries row 'read.a' more than once/,
    );
  });

  it("refuses a row the bound catalog does not require", () => {
    const forged = withTarget("bdptest", (entry) => {
      (at(entry.segments, 0).scenarios as unknown[]).push(row("read.extra", "packaged"));
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /carries row 'read.extra', which the bound catalog does not require/,
    );
  });

  it("refuses a missing target", () => {
    const forged = artifact();
    forged.targets = [target("bdptest")];
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /missing required target 'bdpbd'/,
    );
  });

  it("refuses a duplicated target", () => {
    const forged = artifact();
    forged.targets = [target("bdptest"), target("bdptest"), target("bdpbd")];
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /carries target 'bdptest' more than once/,
    );
  });

  it("refuses targets disagreeing on the bound catalog or manifest", () => {
    const forged = withTarget("bdpbd", (entry) => {
      const segments = entry.segments as Record<string, unknown>[];
      for (const seg of segments) {
        seg.bindings = { ...(seg.bindings as Record<string, unknown>), manifest: digest("99") };
      }
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /runs disagree on the bound catalog or manifest/,
    );
  });

  it("accepts two targets binding their own fixture realizations", () => {
    const twoFixtures = withTarget("bdpbd", (entry) => {
      const segments = entry.segments as Record<string, unknown>[];
      for (const seg of segments) {
        seg.bindings = { ...(seg.bindings as Record<string, unknown>), fixture: digest("e9") };
      }
    });
    expect(() => verifyReadCohortEvidence(inputFor(twoFixtures))).not.toThrow();
  });

  it("refuses one target's runs disagreeing on the bound fixture", () => {
    const forged = withTarget("bdptest", (entry) => {
      const inProcess = at(entry.segments, 1);
      inProcess.bindings = {
        ...(inProcess.bindings as Record<string, unknown>),
        fixture: digest("e9"),
      };
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /target 'bdptest' runs disagree on the bound fixture/,
    );
  });

  it("refuses a declared self-certified list that the manifest does not derive", () => {
    const forged = artifact();
    forged.selfCertified = ["read.a", "read.b"];
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /do not match the set derived from the bound manifest/,
    );
  });

  it("refuses an artifact that states no callout", () => {
    const forged = artifact();
    forged.selfCertifiedNote = "  ";
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /states no self-certification callout/,
    );
  });

  it("refuses an unknown admission", () => {
    const forged = withTarget("bdptest", (entry) => {
      const packaged = at(entry.segments, 0);
      packaged.admission = "magic";
      at(packaged.scenarios, 0).admission = "magic";
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(/unknown admission 'magic'/);
  });

  it("refuses an empty derived required set", () => {
    expect(() =>
      verifyReadCohortEvidence(inputFor(artifact(), { requiredScenarioIds: [] })),
    ).toThrow(/derived required scenario set is empty/);
  });

  // D4 is an exact pin, not a shape check: a relabeled identity closes bdpbd.
  it("refuses a bd identity that drifts from the pinned baseline", () => {
    const forged = withTarget("bdpbd", (entry) => {
      const segments = entry.segments as Record<string, unknown>[];
      for (const seg of segments) {
        seg.bdIdentity = { version: "1.9.9", schemaVersion: 3, observationsDigest: digest("99") };
      }
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /bd identity that is not the pinned baseline identity/,
    );
  });

  // D5 is re-proved from bytes: unknown members are how retained content would
  // smuggle into the one file the evidence delta permits edits to.
  it("refuses an unknown member anywhere in the artifact", () => {
    const forged = artifact();
    (forged as Record<string, unknown>).extra = "retained-content";
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /artifact root carries unknown member 'extra'/,
    );
  });

  it("refuses an unknown member inside an exchange", () => {
    const forged = withTarget("bdptest", (entry) => {
      const packaged = at(entry.segments, 0);
      at(packaged.scenarios, 0).exchanges = [
        {
          requestId: "get",
          method: "GET",
          requestHeaderNames: ["accept"],
          status: 200,
          responseHeaderNames: ["content-type"],
          bodyKind: "json",
          decodedBodyBytes: 42,
          responseBody: "smuggled",
        },
      ];
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /exchange carries unknown member 'responseBody'/,
    );
  });

  it("refuses a header name outside the reviewed allowlist", () => {
    const forged = withTarget("bdptest", (entry) => {
      const packaged = at(entry.segments, 0);
      at(packaged.scenarios, 0).exchanges = [
        {
          requestId: "get",
          method: "GET",
          requestHeaderNames: ["accept"],
          status: 200,
          responseHeaderNames: ["set-cookie: session=s3cr3t"],
          bodyKind: "json",
          decodedBodyBytes: 42,
        },
      ];
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(
      /retains a header name outside the reviewed allowlist/,
    );
  });

  it("refuses an unknown exchange body kind", () => {
    const forged = withTarget("bdptest", (entry) => {
      const packaged = at(entry.segments, 0);
      at(packaged.scenarios, 0).exchanges = [
        {
          requestId: "get",
          method: "GET",
          requestHeaderNames: [],
          status: 200,
          responseHeaderNames: [],
          bodyKind: "raw-bytes",
          decodedBodyBytes: 42,
        },
      ];
    });
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(/unknown exchange body kind/);
  });

  it("fails closed when the run head is not an ancestor", () => {
    expect(() =>
      verifyReadCohortEvidence(inputFor(artifact(), { runHeadIsAncestor: false })),
    ).toThrow(/not an ancestor/);
  });

  it("fails closed when the delta escapes the artifact and the constant", () => {
    expect(() =>
      verifyReadCohortEvidence(
        inputFor(artifact(), {
          changedPathsSinceRunHead: [ARTIFACT_PATH, CONSTANT_PATH, "packages/server/src/index.ts"],
        }),
      ),
    ).toThrow(/escape the evidence delta: packages\/server\/src\/index\.ts/);
  });

  it("fails closed when a target carries no evidence", () => {
    const genuine = inputFor(artifact());
    expect(() =>
      verifyReadCohortEvidence({
        ...genuine,
        evidenceByTarget: { bdptest: genuine.evidenceByTarget.bdptest },
      }),
    ).toThrow(/target 'bdpbd' carries no well-formed evidence constant/);
  });

  it("fails closed when the two targets disagree", () => {
    const genuine = inputFor(artifact());
    expect(() =>
      verifyReadCohortEvidence({
        ...genuine,
        evidenceByTarget: { bdptest: genuine.evidenceByTarget.bdptest, bdpbd: "c".repeat(40) },
      }),
    ).toThrow(/does not match the artifact's content digest/);
  });

  it("fails closed when the constant does not digest the artifact", () => {
    const genuine = inputFor(artifact());
    const fabricated = "f".repeat(40);
    expect(fabricated).not.toBe(genuine.evidenceByTarget.bdptest);
    expect(() =>
      verifyReadCohortEvidence({
        ...genuine,
        evidenceByTarget: { bdptest: fabricated, bdpbd: fabricated },
      }),
    ).toThrow(/does not match the artifact's content digest/);
  });

  it("fails closed when the artifact bytes are not canonical", () => {
    const pretty = new TextEncoder().encode(`${JSON.stringify(artifact(), undefined, 2)}\n`);
    // The constant is recomputed over the same bytes, so this cannot pass by
    // matching -- only the canonical check stands between it and admission.
    expect(() =>
      verifyReadCohortEvidence({
        ...inputFor(artifact()),
        artifactBytes: pretty,
        evidenceByTarget: {
          bdptest: readCohortEvidenceConstant(pretty),
          bdpbd: readCohortEvidenceConstant(pretty),
        },
      }),
    ).toThrow(/not canonical/);
  });

  it("rejects a malformed recorded run head", () => {
    const forged = artifact();
    forged.runHead = "nope";
    expect(() => verifyReadCohortEvidence(inputFor(forged))).toThrow(ReadCohortVerificationError);
  });

  it("accepts a delta that touches only some allowed paths", () => {
    expect(() =>
      verifyReadCohortEvidence(inputFor(artifact(), { changedPathsSinceRunHead: [CONSTANT_PATH] })),
    ).not.toThrow();
  });
});
