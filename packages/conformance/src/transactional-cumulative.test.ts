import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  createConformanceArtifactBundle,
  createDevelopmentReadUpdateArtifactBundle,
  createCumulativeReadUpdateArtifactBundle,
  createCumulativeTransactionalArtifactBundle,
} from "./artifact-bundle.js";
import { canonicalJson } from "./canonical-json.js";
import { snapshotExactHttpMode } from "./http-executor.js";
import { loadProfileContractSelection } from "./profile-contract-selection.js";
import {
  bindServedProfileConfiguration,
  planProfileExecution,
} from "../test-support/profile-contract-plan.js";
import {
  runConformanceMatrix,
  runCumulativeTransactionalMatrix,
  type ScenarioRunOptions,
} from "./runner.js";

const read = (name: string) =>
  readFileSync(new URL(`../test-support/transactional/${name}-v1.json`, import.meta.url));
const source = (value: unknown) => ({ bytes: Buffer.from(JSON.stringify(value)) });
const manifest = JSON.parse(read("manifest").toString());
const fixture = JSON.parse(read("fixture").toString());
const inputs = () => ({
  manifest: { bytes: read("manifest") },
  fixture: { bytes: read("fixture") },
});
const selected = loadProfileContractSelection("transactional");
const bundle = () => createCumulativeTransactionalArtifactBundle(selected, inputs());
const configuration = (profile: "transactional" | "read-update" = "transactional") =>
  bindServedProfileConfiguration({
    scope: fixture.scope,
    profile,
    history: false,
    sourceCommit: "a".repeat(40),
    installedPayloadDigest: "b".repeat(64),
    installedContractsDigest: "c".repeat(64),
    policyDigest: "d".repeat(64),
    authenticationDigest: "e".repeat(64),
    fixture: inputs().fixture,
  });
const padded = (value: unknown, bytes: number) => ({
  bytes: Buffer.from(JSON.stringify(value).padEnd(bytes, " ")),
});
const ruManifest = {
  ...manifest,
  catalogId: "read-update-v1",
  scenarios: [
    {
      ...manifest.scenarios[0],
      id: "read-update.discovery.document",
      requiredProfile: "read-update",
      actions: [
        {
          id: "discovery",
          family: "http",
          method: "GET",
          target: { binding: "scope" },
          raw: { headerLines: [] },
          captures: [],
          assertions: [{ id: "status", kind: "status", equals: 200 }],
        },
      ],
    },
  ],
};

it("binds the canonical cumulative TX selection and exact source digests without qualification", () => {
  const actual = bundle();
  expect(selected.required).toHaveLength(250);
  expect(selected.retiredIds).toHaveLength(13);
  expect(actual.catalog).toEqual(selected.catalog);
  expect(actual.digests.catalogDigest).toBe(
    createHash("sha256").update(canonicalJson(selected.catalogDigests)).digest("hex"),
  );
  for (const [name, bytes] of [
    ["manifestDigest", read("manifest")],
    ["fixtureDigest", read("fixture")],
  ] as const)
    expect(actual.digests[name]).toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(Object.isFrozen(actual.manifest.scenarios[0])).toBe(true);
  const ordered = selected.catalog.scenarios.map((row) => row.id);
  expect(actual.manifest.scenarios.map((row) => row.id)).toEqual(
    ordered.filter((id) => actual.manifest.scenarios.some((row) => row.id === id)),
  );
  const coverage = JSON.parse(read("coverage").toString());
  expect(coverage.claimEligible).toBe(false);
  expect(coverage.status).toBe("authored-unexecuted");
  expect(coverage.rows.map((r: { id: string }) => r.id)).toEqual(
    actual.manifest.scenarios.map((row) => row.id),
  );
  for (const row of coverage.rows) {
    expect(row.wholeContract).toBe(false);
    expect(row.reason).toContain("No target observed");
    const plan = actual.manifest.scenarios.find((r) => r.id === row.id);
    expect(Array.isArray(plan?.actions)).toBe(true);
    expect(row.bindings).toStrictEqual([
      {
        scenario: row.id,
        assertions: plan?.actions?.flatMap((a) => a.assertions.map((x) => `${a.id}:${x.id}`)),
      },
    ]);
  }
});

it("rejects noncanonical selections, History, wrong factories, retired and misprofiled rows", () => {
  for (const selection of [
    loadProfileContractSelection("read"),
    loadProfileContractSelection("read-update"),
    loadProfileContractSelection("transactional", true),
  ])
    expect(() => createCumulativeTransactionalArtifactBundle(selection, inputs())).toThrow(
      "baseline Transactional",
    );
  for (const selection of [{ ...selected }, { ...selected, required: selected.required.slice(1) }])
    expect(() => createCumulativeTransactionalArtifactBundle(selection, inputs())).toThrow(
      "factory-loaded",
    );
  expect(() => createCumulativeReadUpdateArtifactBundle(selected, inputs())).toThrow(
    "baseline Read+Update",
  );
  const sources = { ...inputs(), catalog: source(selected.catalog) };
  expect(() => createConformanceArtifactBundle(sources)).toThrow("catalogId");
  expect(() => createDevelopmentReadUpdateArtifactBundle(sources)).toThrow("diagnostic-only");
  for (const patch of [
    { catalogId: "read-update-v1" },
    { scenarios: [{ ...manifest.scenarios[0], requiredProfile: "read-update" }] },
    { scenarios: [{ ...manifest.scenarios[0], id: selected.retiredIds[0] }] },
  ])
    expect(() =>
      createCumulativeTransactionalArtifactBundle(selected, {
        ...inputs(),
        manifest: source({ ...manifest, ...patch }),
      }),
    ).toThrow();
  const v1 = {
    manifestVersion: 1,
    catalogId: "transactional-v1",
    scenarios: [
      {
        id: manifest.scenarios[0].id,
        requiredProfile: "transactional",
        setup: manifest.scenarios[0].setup,
        applicability: { requires: [] },
        cleanup: { resetFixture: true },
        requests: [
          {
            id: "read",
            method: "GET",
            target: { binding: "scope" },
            captures: [],
            assertions: [{ id: "status", kind: "status", equals: 200 }],
          },
        ],
      },
    ],
  };
  expect(() =>
    createCumulativeTransactionalArtifactBundle(selected, { ...inputs(), manifest: source(v1) }),
  ).toThrow("requires version 2");
});

it("copies source bytes before binding and exposes all missing obligations without executing them", () => {
  const input = inputs();
  const actual = createCumulativeTransactionalArtifactBundle(selected, input);
  input.manifest.bytes.fill(0);
  input.fixture.bytes.fill(0);
  expect(actual).toEqual(bundle());
  const bound = configuration();
  const plan = planProfileExecution(selected, bound, {
    configuration: bound,
    manifest: inputs().manifest,
  });
  expect(plan.claimEligible).toBe(false);
  expect(plan.carrierBlocker).toBeUndefined();
  expect(plan.transportAdmission).toBe("pending");
  expect(
    plan.requirements.filter((r) => r.readiness === "ready-unexecuted").map((r) => r.id),
  ).toEqual(actual.manifest.scenarios.map((r) => r.id));
  expect(plan.requirements.filter((r) => r.readiness === "unplanned")).toHaveLength(246);
  expect(plan.unobservedIds).toEqual(selected.required.map((r) => r.id));
  expect(plan.manifestDigest).toBe(actual.digests.manifestDigest);
  expect(() => planProfileExecution(selected, configuration("read-update"))).toThrow("disagree");
});

it("enforces TX1MiB and preserves RU4MiB at factory and planner boundaries", () => {
  for (const [selection, value, profile, maximum] of [
    [selected, manifest, "transactional", 1048576],
    [loadProfileContractSelection("read-update"), ruManifest, "read-update", 4194304],
  ] as const) {
    const factory =
      profile === "transactional"
        ? createCumulativeTransactionalArtifactBundle
        : createCumulativeReadUpdateArtifactBundle;
    const bound = configuration(profile);
    expect(() =>
      factory(selection, { ...inputs(), manifest: padded(value, maximum) }),
    ).not.toThrow();
    expect(() =>
      planProfileExecution(selection, bound, {
        configuration: bound,
        manifest: padded(value, maximum),
      }),
    ).not.toThrow();
    expect(() => factory(selection, { ...inputs(), manifest: padded(value, maximum + 1) })).toThrow(
      `must not exceed ${maximum}`,
    );
    expect(() =>
      planProfileExecution(selection, bound, {
        configuration: bound,
        manifest: padded(value, maximum + 1),
      }),
    ).toThrow(`must not exceed ${maximum}`);
    expect(() =>
      factory(selection, {
        ...inputs(),
        fixture: padded(fixture, 1048577),
        manifest: source(value),
      }),
    ).toThrow("1048576");
  }
});

function options(profile: ScenarioRunOptions["profile"] = "transactional"): ScenarioRunOptions {
  return {
    profile,
    scope: fixture.scope,
    seed: 0,
    artifactBundle: bundle(),
    declaredTargetLabel: "h1a-no-target",
    execute: vi.fn(async () => {
      throw Error("must not execute");
    }),
    harness: {
      prepare: vi.fn(async () => {
        throw Error("must not prepare");
      }),
      cleanup: vi.fn(async () => {}),
    },
  };
}
it.each(["read", "read-update", "transactional"] as const)(
  "denies genuine TX bundles through public runner declared %s",
  async (profile) => {
    const input = options(profile);
    // A valid RU exact mode reaches the public brand gate even if the caller lies
    // about the run profile; this is the formerly admissible F7 path.
    const exactExecution = {
      execute: vi.fn(async () => {
        throw Error("must not dial");
      }),
      configuration: {
        scope: fixture.scope,
        profile: "read-update" as const,
        routes: [{ method: "POST" as const, url: fixture.bindings.batch }],
        maximumRequestHeaderBytes: 16384,
        maximumRequestBodyBytes: 65536,
        defaultCredentialRef: "operator",
        credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
      },
    };
    await expect(runConformanceMatrix({ ...input, exactExecution })).rejects.toThrow(
      "private Transactional bundle",
    );
    expect(input.harness.prepare).not.toHaveBeenCalled();
    expect(input.execute).not.toHaveBeenCalled();
    expect(exactExecution.execute).not.toHaveBeenCalled();
  },
);
it("private runner refuses lookalikes, RU bundles, wrong profiles and absent exact transport before setup", async () => {
  for (const artifactBundle of [
    { ...bundle() },
    createCumulativeReadUpdateArtifactBundle(loadProfileContractSelection("read-update"), {
      ...inputs(),
      manifest: source(ruManifest),
    }),
  ])
    await expect(
      runCumulativeTransactionalMatrix({ ...options(), artifactBundle }),
    ).rejects.toThrow("matching private runner");
  await expect(runCumulativeTransactionalMatrix(options("read-update"))).rejects.toThrow(
    "matching private runner",
  );
  const input = options();
  await expect(runCumulativeTransactionalMatrix(input)).rejects.toThrow(
    "transport admission pending",
  );
  await expect(
    runCumulativeTransactionalMatrix({ ...input, scope: "not-a-scope" }),
  ).rejects.toThrow("scope must");
  const invalidExact = {
    execute: vi.fn(async () => {
      throw Error("must not dial");
    }),
    configuration: {
      scope: fixture.scope,
      profile: "transactional",
      routes: [{ method: "POST", url: fixture.bindings.batch }],
      maximumRequestHeaderBytes: 16384,
      maximumRequestBodyBytes: 65536,
      defaultCredentialRef: "operator",
      credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
    },
  };
  // This hostile cast is only a refusal probe: H1a cannot manufacture an exact
  // TX mode by changing its type. Real transport admission belongs to H1b.
  await expect(
    runCumulativeTransactionalMatrix({
      ...input,
      exactExecution: invalidExact as unknown as NonNullable<ScenarioRunOptions["exactExecution"]>,
    }),
  ).rejects.toThrow("Exact HTTP execution binding is invalid");
  const mode = {
    ...invalidExact.configuration,
    profile: "read-update" as const,
    routes: [{ method: "POST" as const, url: fixture.bindings.batch }],
    resolveCredentials: () => ({}),
  };
  expect(snapshotExactHttpMode(mode).profile).toBe("read-update");
  expect(() =>
    snapshotExactHttpMode({ ...mode, profile: "transactional" } as unknown as Parameters<
      typeof snapshotExactHttpMode
    >[0]),
  ).toThrow("exact HTTP request configuration is invalid");
  expect(input.harness.prepare).not.toHaveBeenCalled();
  expect(input.execute).not.toHaveBeenCalled();
});

it("leaves all private symbols and TX artifacts out of public package admission", async () => {
  const root = await import("./index.js");
  for (const symbol of [
    "createCumulativeTransactionalArtifactBundle",
    "runCumulativeTransactionalMatrix",
    "isCumulativeTransactionalArtifactBundle",
  ])
    expect(Object.keys(root)).not.toContain(symbol);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(pkg.files).not.toContain("test-support");
  expect(Object.keys(pkg.exports)).toEqual([
    ".",
    "./catalog/read-v1.json",
    "./fixtures/read-reference-v1.json",
    "./fixtures/read-bdpbd-v1.json",
    "./matrices/read-v1.json",
  ]);
});
