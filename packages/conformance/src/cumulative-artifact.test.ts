import { createReadUpdateArtifactSet } from "../test-support/read-update-artifact-set.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createConformanceArtifactBundle,
  createCumulativeReadUpdateArtifactBundle,
  createDevelopmentReadUpdateArtifactBundle,
} from "./artifact-bundle.js";
import { loadProfileContractSelection } from "./profile-contract-selection.js";
const source = (value: unknown) => ({ bytes: Buffer.from(JSON.stringify(value)) });
const fixture = {
  fixtureVersion: 1,
  id: "reference-read-update-v1",
  seed: 0,
  capabilities: ["installed-read-update-http"],
  bindings: {},
};
const manifest = {
  manifestVersion: 2,
  catalogId: "read-update-v1",
  scenarios: [
    {
      id: "read-update.discovery.document",
      requiredProfile: "read-update",
      setup: { fixture: fixture.id, requires: fixture.capabilities },
      cleanup: { resetFixture: true },
      applicability: { requires: [] },
      requests: [
        {
          id: "discover",
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
describe("source-private cumulative RU artifact boundary", () => {
  it("binds canonical cumulative catalog bytes and preserves uncovered obligations", () => {
    const selection = loadProfileContractSelection("read-update");
    const bundle = createCumulativeReadUpdateArtifactBundle(selection, {
      manifest: source(manifest),
      fixture: source(fixture),
    });
    expect(bundle.catalog).toEqual(selection.catalog);
    expect(bundle.manifest.scenarios).toHaveLength(1);
    expect(selection.required.length).toBeGreaterThan(bundle.manifest.scenarios.length);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(bundle.manifest.manifestVersion).toBe(2);
  });
  it("rejects structural or trimmed selections, other profiles, History and retired IDs", () => {
    const selected = loadProfileContractSelection("read-update");
    const input = { manifest: source(manifest), fixture: source(fixture) };
    expect(() =>
      createCumulativeReadUpdateArtifactBundle({ ...selected, required: [] }, input),
    ).toThrow("factory-loaded");
    for (const selection of [
      loadProfileContractSelection("read"),
      loadProfileContractSelection("transactional"),
      loadProfileContractSelection("read-update", true),
    ])
      expect(() => createCumulativeReadUpdateArtifactBundle(selection, input)).toThrow(
        "baseline Read+Update",
      );
    for (const id of [
      "read.discovery.document",
      "read.discovery.unsupported-client-input",
      "made.up",
    ])
      expect(() =>
        createCumulativeReadUpdateArtifactBundle(selected, {
          ...input,
          manifest: source({ ...manifest, scenarios: [{ ...manifest.scenarios[0], id }] }),
        }),
      ).toThrow("not a cumulative requirement");
    expect(() =>
      createCumulativeReadUpdateArtifactBundle(selected, {
        ...input,
        manifest: source({ ...manifest, manifestVersion: 1 }),
      }),
    ).toThrow();
  });
  it("does not weaken existing Read or development factory guards", () => {
    const selection = loadProfileContractSelection("read-update");
    const inputs = {
      catalog: source(selection.catalog),
      manifest: source(manifest),
      fixture: source(fixture),
    };
    expect(() => createConformanceArtifactBundle(inputs)).toThrow("catalogId");
    expect(() => createDevelopmentReadUpdateArtifactBundle(inputs)).toThrow("diagnostic-only");
    const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(index).not.toContain("createCumulativeReadUpdateArtifactBundle");
    expect(index).not.toContain("loadProfileContractSelection");
  });
});

it("pins cumulative source digest map, catalog order and every coverage binding", async () => {
  const { createHash } = await import("node:crypto");
  const { canonicalJson } = await import("./canonical-json.js");
  const selected = loadProfileContractSelection("read-update");
  const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url));
  const set = createReadUpdateArtifactSet(selected, {
    index: { bytes: read("test-support/read-update-artifact-set-v1.json") },
    coverage: { bytes: read("test-support/read-update-coverage-v1.json") },
    fixture: { bytes: read("fixtures/read-update-reference-v1.json") },
    manifests: {
      "matrices/read-update-v1.json": { bytes: read("matrices/read-update-v1.json") },
      "matrices/read-update-reference-continuation-v1.json": {
        bytes: read("matrices/read-update-reference-continuation-v1.json"),
      },
    },
  });
  const bundle = set.shards[0]!.bundle;
  const plans = set.shards.flatMap((s) => s.bundle.manifest.scenarios);
  expect(bundle.digests.catalogDigest).toBe(
    createHash("sha256").update(canonicalJson(selected.catalogDigests)).digest("hex"),
  );
  const catalogOrder = bundle.catalog.scenarios.map((row) => row.id);
  expect(bundle.manifest.scenarios.map((row) => row.id)).toEqual(
    catalogOrder.filter((id) => bundle.manifest.scenarios.some((row) => row.id === id)),
  );
  for (const scenario of plans) {
    for (const action of scenario.actions ?? []) {
      if (action.family !== "http") continue;
      if (action.prerequisiteScenario)
        expect(catalogOrder.indexOf(action.prerequisiteScenario)).toBeLessThan(
          catalogOrder.indexOf(scenario.id),
        );
      expect(action.prerequisiteScenario).not.toBe("read.discovery.document");
      if (scenario.requiredProfile === "read" && action.id === "discovery")
        expect(action.assertions).toContainEqual({
          id: "local-ru-discovery",
          kind: "json-schema",
          schema: "#/$defs/readUpdateDiscovery",
        });
    }
  }
  expect(bundle.catalog.scenarios.map((row) => row.id)).toEqual(
    selected.catalog.scenarios.map((row) => row.id),
  );
  const inventory = JSON.parse(read("test-support/read-update-coverage-v1.json").toString()) as {
    claimEligible: boolean;
    rows: {
      id: string;
      status: string;
      wholeContract: boolean;
      bindings: { scenario: string; assertions: string[] }[];
    }[];
  };
  expect(inventory.claimEligible).toBe(false);
  // Reviewed whole-contract IDs; changing this list requires a clause-level coverage audit.
  expect(inventory.rows.filter((row) => row.wholeContract).map((row) => row.id)).toEqual([
    "read.discovery.scope-service-desc",
    "read.discovery.canonical-navigation",
    "read.resource.link-record",
    "read.resource.properties-view",
    "read.resource.default-bounded",
    "read.types.inventory",
    "read.types.descriptor",
    "read.collections.beads",
    "read.collections.links",
    "read.collections.invalid-query",
    "read.http.get-head",
    "read.http.method-405",
    "read.http.cache-cors",
    "read-update.discovery.operation-directory",
    "read-update.singleton.create-bead",
    "read-update.singleton.delete-bead",
    "read-update.singleton.update-link",
    "read-update.singleton.delete-link",
    "read-update.singleton.owned-link-source-revision",
    "read-update.singleton.owned-link-no-op",
    "read-update.singleton.attribution",
    "read-update.singleton.expected-revision",
    "read-update.singleton.idempotency-key-required",
    "read-update.singleton.idempotency-conflict",
    "read-update.singleton.unsupported-media-type",
    "read-update.singleton.no-local-bindings",
    "read-update.singleton.result-headers",
    "read-update.alias.put-creates",
    "read-update.alias.put-repoints",
    "read-update.alias.non-canonical-target",
    "read-update.alias.no-version-minted",
    "read-update.sequence.member-problem-shape",
    "read-update.numeric-model.same-value-no-op",
    "read-update.numeric-model.nested-refusal",
  ]);
  expect(inventory.rows.map((row) => row.id)).toEqual(selected.required.map((row) => row.id));
  for (const row of inventory.rows) {
    const planned = plans.find((scenario) => scenario.id === row.id);
    expect(row.status).toBe(planned ? "bounded-observation" : "omitted");
    if (!planned) {
      expect(row.wholeContract).toBe(false);
      expect(row.bindings).toEqual([]);
      continue;
    }
    expect(row.bindings[0]?.scenario).toBe(row.id);
    expect(row.bindings[0]?.assertions).toEqual(
      (planned.actions ?? planned.requests).flatMap((action) =>
        action.assertions.map((assertion) => `${action.id}.${assertion.id}`),
      ),
    );
  }
});

it("mirrors private cumulative carrier admission in the planner without qualification", async () => {
  const { bindServedProfileConfiguration, planProfileExecution } = await import(
    "../test-support/profile-contract-plan.js"
  );
  for (const history of [false, true]) {
    const selection = loadProfileContractSelection("read-update", history);
    const configuration = bindServedProfileConfiguration({
      scope: "https://example.invalid/",
      profile: "read-update",
      history,
      sourceCommit: "a".repeat(40),
      installedPayloadDigest: "b".repeat(64),
      installedContractsDigest: "c".repeat(64),
      policyDigest: "d".repeat(64),
      authenticationDigest: "e".repeat(64),
      fixture: source(fixture),
    });
    const plan = planProfileExecution(selection, configuration, {
      configuration,
      manifest: source(manifest),
    });
    expect(
      plan.requirements.find((row) => row.id === "read-update.discovery.document")?.readiness,
    ).toBe(history ? "carrier-unsupported" : "ready-unexecuted");
    expect(plan.claimEligible).toBe(false);
  }
});

it("bounds only private cumulative manifests at 4 MiB and retains ordinary source budgets", async () => {
  const { bindServedProfileConfiguration, planProfileExecution } = await import(
    "../test-support/profile-contract-plan.js"
  );
  const selection = loadProfileContractSelection("read-update");
  const fixtureSource = source(fixture);
  const configuration = bindServedProfileConfiguration({
    scope: "https://example.invalid/",
    profile: "read-update",
    history: false,
    sourceCommit: "a".repeat(40),
    installedPayloadDigest: "b".repeat(64),
    installedContractsDigest: "c".repeat(64),
    policyDigest: "d".repeat(64),
    authenticationDigest: "e".repeat(64),
    fixture: fixtureSource,
  });
  const padded = (size: number) => ({
    bytes: Buffer.from(JSON.stringify(manifest).padEnd(size, " ")),
  });
  for (const size of [1_048_577, 4_194_304]) {
    const manifestSource = padded(size);
    expect(
      createCumulativeReadUpdateArtifactBundle(selection, {
        manifest: manifestSource,
        fixture: fixtureSource,
      }).manifest.catalogId,
    ).toBe("read-update-v1");
    expect(
      planProfileExecution(selection, configuration, { configuration, manifest: manifestSource })
        .manifestDigest,
    ).toBeDefined();
    for (const factory of [
      createConformanceArtifactBundle,
      createDevelopmentReadUpdateArtifactBundle,
    ])
      expect(() =>
        factory({
          catalog: source(selection.catalog),
          manifest: manifestSource,
          fixture: fixtureSource,
        }),
      ).toThrow("manifest source must not exceed 1048576 bytes");
  }
  for (const [profile, history] of [
    ["read", false],
    ["read-update", true],
    ["transactional", false],
  ] as const) {
    const otherSelection = loadProfileContractSelection(profile, history);
    const otherConfiguration = bindServedProfileConfiguration({
      scope: "https://example.invalid/",
      profile,
      history,
      sourceCommit: "a".repeat(40),
      installedPayloadDigest: "b".repeat(64),
      installedContractsDigest: "c".repeat(64),
      policyDigest: "d".repeat(64),
      authenticationDigest: "e".repeat(64),
      fixture: fixtureSource,
    });
    expect(() =>
      planProfileExecution(otherSelection, otherConfiguration, {
        configuration: otherConfiguration,
        manifest: padded(1_048_577),
      }),
    ).toThrow("manifest source must not exceed 1048576 bytes");
  }
  const legacy = structuredClone(manifest);
  legacy.manifestVersion = 1;
  Reflect.deleteProperty(legacy.scenarios[0]!.requests[0]!, "raw");
  expect(() =>
    planProfileExecution(selection, configuration, {
      configuration,
      manifest: { bytes: Buffer.from(JSON.stringify(legacy).padEnd(1_048_577, " ")) },
    }),
  ).toThrow("manifest source must not exceed 1048576 bytes");
  const oversized = padded(4_194_305);
  expect(() =>
    createCumulativeReadUpdateArtifactBundle(selection, {
      manifest: oversized,
      fixture: fixtureSource,
    }),
  ).toThrow("manifest source must not exceed 4194304 bytes");
  expect(() =>
    planProfileExecution(selection, configuration, { configuration, manifest: oversized }),
  ).toThrow("manifest source must not exceed 4194304 bytes");
  expect(() =>
    createCumulativeReadUpdateArtifactBundle(selection, {
      manifest: source(manifest),
      fixture: { bytes: Buffer.from(JSON.stringify(fixture).padEnd(1_048_577, " ")) },
    }),
  ).toThrow("fixture source must not exceed 1048576 bytes");
  const ordinary = {
    bytes: Buffer.from(
      JSON.stringify({ ...manifest, catalogId: "read-v1" }).padEnd(1_048_577, " "),
    ),
  };
  expect(() =>
    planProfileExecution(selection, configuration, { configuration, manifest: ordinary }),
  ).toThrow("manifest source must not exceed 1048576 bytes");
});
