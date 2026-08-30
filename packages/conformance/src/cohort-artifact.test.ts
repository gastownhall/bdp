import { describe, expect, it } from "vitest";

import {
  assertCanonicalReadCohortBytes,
  createReadCohortArtifact,
  READ_COHORT_HEADER_NAME_ALLOWLIST,
  type ReadCohortArtifactInput,
  ReadCohortArtifactError,
  type ReadCohortBindings,
  type ReadCohortTargetInput,
  readCohortArtifactDigest,
  readCohortEvidenceConstant,
  serializeReadCohortArtifact,
} from "./index.js";
import type { ConformanceRunResult, ScenarioRunResult } from "./runner.js";
import type { ScenarioCatalog } from "./catalog.js";
import type { ExecutableScenarioManifest } from "./executable-manifest.js";

const RUN_HEAD = "a".repeat(40);
const digest = (seed: string): string =>
  seed
    .repeat(64)
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, "0");

const CATALOG_DIGEST = digest("c1");
const MANIFEST_DIGEST = digest("d2");
const FIXTURE_DIGEST = digest("e3");
const BD_DIGEST = digest("f4");
const BD_OBSERVATIONS = digest("ab");

/** `read.b` carries a lifecycle action, so it is the self-certifiable row. */
const catalog = {
  catalogVersion: 1,
  scenarios: [
    { id: "read.a", requiredProfile: "read" },
    { id: "read.b", requiredProfile: "read" },
  ],
} as unknown as ScenarioCatalog;

const manifest = {
  manifestVersion: 1,
  catalogId: "read-v1",
  scenarios: [
    { id: "read.a", actions: [{ id: "x", family: "http" }] },
    { id: "read.b", actions: [{ id: "y", family: "lifecycle" }] },
  ],
} as unknown as ExecutableScenarioManifest;

/** A secret-shaped value planted in every place D5 forbids retaining. */
const SECRET = "s3cr3t-must-never-appear";
const INSTANCE_PATH = "/beads/01HQZZINSTANCEPATH";

function scenario(id: string, overrides: Partial<ScenarioRunResult> = {}): ScenarioRunResult {
  return {
    id,
    requiredProfile: "read",
    state: "pass",
    requirements: [],
    exchanges: [
      {
        request: {
          id: "get",
          method: "GET",
          url: `http://127.0.0.1:8080${INSTANCE_PATH}`,
          headers: { accept: "application/json", authorization: SECRET, "x-trace": SECRET },
        },
        response: {
          url: `http://127.0.0.1:8080${INSTANCE_PATH}`,
          status: 200,
          headers: { "content-type": "application/json", etag: SECRET, "x-instance": SECRET },
          decodedBodyBytes: 42,
          bodyKind: "json",
        },
        assertions: [],
      },
    ],
    ...overrides,
  } as ScenarioRunResult;
}

function run(overrides: Partial<ConformanceRunResult> = {}): ConformanceRunResult {
  return {
    reportVersion: 3,
    scope: "http://127.0.0.1:8080/",
    profile: "read",
    seed: 7,
    selectedScenarioIds: ["read.a", "read.b"],
    artifacts: {
      catalogDigest: CATALOG_DIGEST,
      manifestDigest: MANIFEST_DIGEST,
      fixtureDigest: FIXTURE_DIGEST,
    },
    declarations: { targetLabel: "bdptest" },
    scenarios: [scenario("read.a"), scenario("read.b")],
    claimEligible: false,
    ...overrides,
  } as ConformanceRunResult;
}

const bindings: ReadCohortBindings = {
  catalog: CATALOG_DIGEST,
  manifest: MANIFEST_DIGEST,
  fixture: FIXTURE_DIGEST,
  schema: digest("11"),
  validator: digest("22"),
  runner: digest("33"),
  harness: digest("44"),
  executor: digest("55"),
  installedPayload: digest("66"),
  targetProcess: digest("77"),
  workspace: digest("88"),
};

/** Bindings an in-process run may carry: no payload, process or workspace. */
const leanBindings: ReadCohortBindings = (() => {
  const lean = { ...bindings };
  for (const key of ["installedPayload", "targetProcess", "workspace"]) {
    delete (lean as Record<string, unknown>)[key];
  }
  return lean;
})();

const ALL_ROWS = ["read.a", "read.b"];

const bdptestTarget: ReadCohortTargetInput = {
  target: "bdptest",
  run: run(),
  bindings,
  admission: "packaged",
  capabilities: [],
  rows: ALL_ROWS,
};

const bdpbdTarget: ReadCohortTargetInput = {
  target: "bdpbd",
  run: run({ declarations: { targetLabel: "bdpbd" } }),
  bindings: { ...bindings, bdExecutable: BD_DIGEST },
  bdIdentity: { version: "1.0.5", schemaVersion: 1, observationsDigest: BD_OBSERVATIONS },
  admission: "packaged",
  capabilities: [],
  rows: ALL_ROWS,
};

function input(overrides: Partial<ReadCohortArtifactInput> = {}): ReadCohortArtifactInput {
  return {
    catalog,
    manifest,
    runHead: RUN_HEAD,
    uncovered: [
      {
        scenarioId: "read.a",
        variant: "absent-optional",
        reason: "setup forces advertised limits into existence, so omission is unexercised",
      },
    ],
    targets: [bdptestTarget, bdpbdTarget],
    ...overrides,
  };
}

/** A target split across a packaged run and a self-certified in-process run. */
function splitTarget(target: "bdptest" | "bdpbd"): [ReadCohortTargetInput, ReadCohortTargetInput] {
  const bd = target === "bdpbd";
  const label = { declarations: { targetLabel: target } };
  return [
    {
      target,
      run: run(label),
      bindings: bd ? { ...bindings, bdExecutable: BD_DIGEST } : bindings,
      ...(bd
        ? {
            bdIdentity: { version: "1.0.5", schemaVersion: 1, observationsDigest: BD_OBSERVATIONS },
          }
        : {}),
      admission: "packaged",
      capabilities: [],
      rows: ["read.a"],
    },
    {
      target,
      run: run(label),
      bindings: bd ? { ...leanBindings, bdExecutable: BD_DIGEST } : leanBindings,
      ...(bd
        ? {
            bdIdentity: { version: "1.0.5", schemaVersion: 1, observationsDigest: BD_OBSERVATIONS },
          }
        : {}),
      admission: "in-process",
      capabilities: [],
      rows: ["read.b"],
    },
  ];
}

describe("read cohort artifact", () => {
  it("projects both targets with catalog-derived required ids", () => {
    const artifact = createReadCohortArtifact(input());
    expect(artifact.requiredScenarioIds).toEqual(["read.a", "read.b"]);
    expect(artifact.catalogId).toBe("read-v1");
    expect(artifact.targets.map((entry) => entry.target)).toEqual(["bdptest", "bdpbd"]);
  });

  it("derives the self-certifiable set from the manifest, not from the caller", () => {
    const artifact = createReadCohortArtifact(input());
    expect(artifact.selfCertified).toEqual(["read.b"]);
    expect(artifact.selfCertifiedNote).toMatch(/not about the packaged boundary/);
  });

  it("renders packaged and self-certified counts, not a bare ratio", () => {
    const artifact = createReadCohortArtifact(
      input({ targets: [...splitTarget("bdptest"), ...splitTarget("bdpbd")] }),
    );
    for (const entry of artifact.targets) {
      expect(entry.scores).toEqual({ pass: 2, other: 0 });
      expect(entry.packagedRows).toBe(1);
      expect(entry.selfCertifiedRows).toBe(1);
    }
  });

  it("stamps admission on every row", () => {
    const artifact = createReadCohortArtifact(
      input({ targets: [...splitTarget("bdptest"), ...splitTarget("bdpbd")] }),
    );
    const rows = artifact.targets
      .flatMap((entry) => entry.segments)
      .flatMap((segment) => segment.scenarios);
    expect(rows.filter((row) => row.admission === "in-process").map((row) => row.id)).toEqual([
      "read.b",
      "read.b",
    ]);
  });

  // The rule that implements E2 and refuses the bootstrap artifact at once.
  it("refuses a row exercised in-process that is not self-certifiable", () => {
    const [packaged, inProcess] = splitTarget("bdptest");
    const swapped: ReadCohortTargetInput[] = [
      { ...packaged, rows: ["read.b"] },
      { ...inProcess, rows: ["read.a"] },
    ];
    expect(() =>
      createReadCohortArtifact(input({ targets: [...swapped, ...splitTarget("bdpbd")] })),
    ).toThrow(/'read.a' is not self-certifiable/);
  });

  it("refuses a wholly in-process cohort, which is what the bootstrap artifact is", () => {
    const bootstrap = (target: "bdptest" | "bdpbd"): ReadCohortTargetInput => ({
      target,
      run: run({ declarations: { targetLabel: target } }),
      bindings: target === "bdpbd" ? { ...leanBindings, bdExecutable: BD_DIGEST } : leanBindings,
      ...(target === "bdpbd"
        ? {
            bdIdentity: { version: "1.0.5", schemaVersion: 1, observationsDigest: BD_OBSERVATIONS },
          }
        : {}),
      admission: "in-process",
      capabilities: [],
      rows: ALL_ROWS,
    });
    expect(() =>
      createReadCohortArtifact(input({ targets: [bootstrap("bdptest"), bootstrap("bdpbd")] })),
    ).toThrow(/'read.a' is not self-certifiable/);
  });

  // D1 — every non-pass state, and absence, close the cohort.
  it.each(["fail", "harness-error", "not-applicable", "unsupported-profile"] as const)(
    "closes the cohort when a scenario is %s",
    (state) => {
      const target: ReadCohortTargetInput = {
        ...bdptestTarget,
        run: run({ scenarios: [scenario("read.a", { state } as never), scenario("read.b")] }),
      };
      expect(() => createReadCohortArtifact(input({ targets: [target, bdpbdTarget] }))).toThrow(
        /pass is the only admissible state/,
      );
    },
  );

  it("closes the cohort when a required row is attributed to no run", () => {
    const target: ReadCohortTargetInput = { ...bdptestTarget, rows: ["read.a"] };
    expect(() => createReadCohortArtifact(input({ targets: [target, bdpbdTarget] }))).toThrow(
      /missing required scenario 'read.b'/,
    );
  });

  it("closes the cohort when two runs claim the same row", () => {
    // Overlap on the self-certifiable row, so the duplicate check is what fires
    // rather than the self-certification check ahead of it.
    const [packaged, inProcess] = splitTarget("bdptest");
    const overlap: ReadCohortTargetInput = { ...packaged, rows: ["read.a", "read.b"] };
    expect(() =>
      createReadCohortArtifact(input({ targets: [overlap, inProcess, ...splitTarget("bdpbd")] })),
    ).toThrow(/attributes row 'read.b' to more than one run/);
  });

  it("closes the cohort when a run claims a row it did not select", () => {
    const target: ReadCohortTargetInput = {
      ...bdptestTarget,
      run: run({ selectedScenarioIds: ["read.a"] }),
    };
    expect(() => createReadCohortArtifact(input({ targets: [target, bdpbdTarget] }))).toThrow(
      /which its run did not select/,
    );
  });

  it("refuses an empty uncovered list, which would assert total coverage", () => {
    expect(() => createReadCohortArtifact(input({ uncovered: [] }))).toThrow(
      /must declare its uncovered variants/,
    );
  });

  it("requires both targets", () => {
    expect(() => createReadCohortArtifact(input({ targets: [bdptestTarget] }))).toThrow(
      /missing required target 'bdpbd'/,
    );
  });

  it("closes the cohort when runs bound different sources", () => {
    const target: ReadCohortTargetInput = {
      ...bdptestTarget,
      run: run({
        artifacts: {
          catalogDigest: digest("99"),
          manifestDigest: MANIFEST_DIGEST,
          fixtureDigest: FIXTURE_DIGEST,
        },
      }),
      bindings: { ...bindings, catalog: digest("99") },
    };
    expect(() => createReadCohortArtifact(input({ targets: [target, bdpbdTarget] }))).toThrow(
      /one cohort covers both targets/,
    );
  });

  it("accepts two targets binding their own fixture realizations", () => {
    // The accepted design: read-reference-v1 for bdptest, read-bdpbd-v1 for
    // bdpbd — same logical topology, different projected identifiers, so the
    // two targets legitimately bind different fixture digests.
    const bdpbdFixture = digest("e9");
    const target: ReadCohortTargetInput = {
      ...bdpbdTarget,
      run: run({
        declarations: { targetLabel: "bdpbd" },
        artifacts: {
          catalogDigest: CATALOG_DIGEST,
          manifestDigest: MANIFEST_DIGEST,
          fixtureDigest: bdpbdFixture,
        },
      }),
      bindings: { ...bindings, fixture: bdpbdFixture, bdExecutable: BD_DIGEST },
    };

    const artifact = createReadCohortArtifact(input({ targets: [bdptestTarget, target] }));

    expect(artifact.targets.map((entry) => entry.segments[0]?.bindings.fixture)).toEqual([
      FIXTURE_DIGEST,
      bdpbdFixture,
    ]);
  });

  it("closes the cohort when one target's runs disagree on the bound fixture", () => {
    const other = digest("e9");
    const packagedHalf: ReadCohortTargetInput = { ...bdptestTarget, rows: ["read.a"] };
    const inProcessHalf: ReadCohortTargetInput = {
      target: "bdptest",
      run: run({
        artifacts: {
          catalogDigest: CATALOG_DIGEST,
          manifestDigest: MANIFEST_DIGEST,
          fixtureDigest: other,
        },
      }),
      bindings: { ...leanBindings, fixture: other },
      admission: "in-process",
      capabilities: [],
      rows: ["read.b"],
    };

    expect(() =>
      createReadCohortArtifact(input({ targets: [packagedHalf, inProcessHalf, bdpbdTarget] })),
    ).toThrow(/target 'bdptest' runs disagree on the bound fixture/);
  });

  it("rejects a binding that disagrees with what the run measured", () => {
    const target: ReadCohortTargetInput = {
      ...bdptestTarget,
      bindings: { ...bindings, manifest: digest("99") },
    };
    expect(() => createReadCohortArtifact(input({ targets: [target, bdpbdTarget] }))).toThrow(
      /does not match the digest the run measured/,
    );
  });

  it("requires bdpbd to bind a bd executable and identity", () => {
    const target: ReadCohortTargetInput = { ...bdpbdTarget, bindings };
    expect(() => createReadCohortArtifact(input({ targets: [bdptestTarget, target] }))).toThrow(
      /must bind the sha-256 digest of the bd executable/,
    );
  });

  it("forbids bdptest from claiming a bd binding", () => {
    const target: ReadCohortTargetInput = {
      ...bdptestTarget,
      bindings: { ...bindings, bdExecutable: BD_DIGEST },
    };
    expect(() => createReadCohortArtifact(input({ targets: [target, bdpbdTarget] }))).toThrow(
      /must not claim a bd binding/,
    );
  });

  it("requires a packaged run to name its payload, process and workspace", () => {
    for (const key of ["installedPayload", "targetProcess", "workspace"] as const) {
      const pruned = { ...bindings };
      delete (pruned as Record<string, unknown>)[key];
      const target: ReadCohortTargetInput = { ...bdptestTarget, bindings: pruned };
      expect(() => createReadCohortArtifact(input({ targets: [target, bdpbdTarget] }))).toThrow(
        new RegExp(`packaged target .* binding '${key}'`),
      );
    }
  });

  it("forbids an in-process run from claiming packaged-only bindings", () => {
    const [packaged, inProcess] = splitTarget("bdptest");
    const greedy: ReadCohortTargetInput = { ...inProcess, bindings };
    expect(() =>
      createReadCohortArtifact(input({ targets: [packaged, greedy, ...splitTarget("bdpbd")] })),
    ).toThrow(/in-process run for .* must not claim binding/);
  });

  it("rejects a run head that is not a commit sha", () => {
    expect(() => createReadCohortArtifact(input({ runHead: "not-a-sha" }))).toThrow(
      ReadCohortArtifactError,
    );
  });
});

// D5 — the redaction is structural. These would fail if the projection were
// replaced by a pass-through of the run result.
describe("read cohort artifact redaction", () => {
  const bytes = serializeReadCohortArtifact(createReadCohortArtifact(input()));
  const text = new TextDecoder().decode(bytes);

  // Without this, every `not.toContain` below would pass just as well against an
  // input that never carried a secret — proving nothing about the projection.
  it("is tested against a run that really does carry the forbidden values", () => {
    const raw = JSON.stringify(run());
    expect(raw).toContain(SECRET);
    expect(raw).toContain(INSTANCE_PATH);
    expect(raw).toContain("authorization");
    expect(raw).toContain("etag");
  });

  it("retains no header values", () => {
    expect(text).not.toContain(SECRET);
  });

  it("retains no target-derived instance paths", () => {
    expect(text).not.toContain(INSTANCE_PATH);
    expect(text).not.toContain("127.0.0.1:8080/beads");
  });

  it("drops header names outside the allowlist", () => {
    expect(text).not.toContain("authorization");
    expect(text).not.toContain("x-instance");
    expect(text).not.toContain("etag");
  });

  it("keeps allowlisted header names, body size and shape", () => {
    const artifact = createReadCohortArtifact(input());
    const exchange = artifact.targets[0]?.segments[0]?.scenarios[0]?.exchanges[0];
    expect(exchange?.requestHeaderNames).toEqual(["accept"]);
    expect(exchange?.responseHeaderNames).toEqual(["content-type"]);
    expect(exchange?.decodedBodyBytes).toBe(42);
    expect(exchange?.bodyKind).toBe("json");
    expect(exchange?.status).toBe(200);
  });

  it("allowlists only lowercase protocol-structural header names", () => {
    for (const name of READ_COHORT_HEADER_NAME_ALLOWLIST) {
      expect(name).toBe(name.toLowerCase());
    }
  });
});

describe("read cohort artifact serialization", () => {
  it("is stable under input order", () => {
    const forward = serializeReadCohortArtifact(createReadCohortArtifact(input()));
    const reversed = serializeReadCohortArtifact(
      createReadCohortArtifact(input({ targets: [bdpbdTarget, bdptestTarget] })),
    );
    expect(new TextDecoder().decode(reversed)).toBe(new TextDecoder().decode(forward));
  });

  it("derives a 40-hex evidence constant that prefixes the full digest", () => {
    const bytes = serializeReadCohortArtifact(createReadCohortArtifact(input()));
    const constant = readCohortEvidenceConstant(bytes);
    expect(constant).toMatch(/^[0-9a-f]{40}$/);
    expect(readCohortArtifactDigest(bytes).startsWith(constant)).toBe(true);
  });

  it("never contains its own evidence constant, which is what breaks the circle", () => {
    const bytes = serializeReadCohortArtifact(createReadCohortArtifact(input()));
    expect(new TextDecoder().decode(bytes)).not.toContain(readCohortEvidenceConstant(bytes));
  });

  it("accepts canonical bytes and rejects a reformatted equivalent", () => {
    const artifact = createReadCohortArtifact(input());
    const canonical = serializeReadCohortArtifact(artifact);
    expect(() => assertCanonicalReadCohortBytes(canonical)).not.toThrow();

    const pretty = new TextEncoder().encode(`${JSON.stringify(artifact, undefined, 2)}\n`);
    expect(() => assertCanonicalReadCohortBytes(pretty)).toThrow(/not canonical/);
  });

  it("rejects bytes whose keys were reordered without reformatting", () => {
    const artifact = createReadCohortArtifact(input());
    const parsed = JSON.parse(new TextDecoder().decode(serializeReadCohortArtifact(artifact)));
    const reordered = Object.fromEntries(Object.entries(parsed).reverse());
    expect(() =>
      assertCanonicalReadCohortBytes(new TextEncoder().encode(`${JSON.stringify(reordered)}\n`)),
    ).toThrow(/not canonical/);
  });
});
