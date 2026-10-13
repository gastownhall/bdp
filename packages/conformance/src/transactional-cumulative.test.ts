import { createServer } from "node:http";
import { createRawHttpExchangeExecutor } from "./http-executor.js";
import { createJsonSchemaValidator } from "./schema-validator.js";
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
import { createTransactionalObservations } from "./transactional-observation.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  createConformanceArtifactBundle,
  createDevelopmentReadUpdateArtifactBundle,
  createCumulativeReadUpdateArtifactBundle,
  createCumulativeTransactionalArtifactBundle,
  isCumulativeTransactionalArtifactBundle,
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
  expect(coverage.status).toBe("bounded-observation");
  expect(coverage.rows.map((r: { id: string }) => r.id)).toEqual(
    actual.manifest.scenarios.map((row) => row.id),
  );
  for (const row of coverage.rows) {
    expect(row.wholeContract).toBe(false);
    expect(row.reason).toContain("Whole contract remains unqualified");
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
  expect(
    plan.requirements.filter((r) => r.readiness === "ready-unexecuted").map((r) => r.id),
  ).toEqual(actual.manifest.scenarios.map((r) => r.id));
  expect(plan.requirements.filter((r) => r.readiness === "unplanned")).toHaveLength(241);
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
  // Structural private transport availability stays separate from partial
  // observed coverage; malformed configuration still refuses before setup.
  const bound = configuration();
  const plan = planProfileExecution(selected, bound, {
    configuration: bound,
    manifest: inputs().manifest,
  });
  const coverage = JSON.parse(read("coverage").toString());
  expect(plan.transportAdmission).toBe("private-exact-available");
  expect(coverage.transportAdmission).toBe(plan.transportAdmission);
  const input = options();
  await expect(runCumulativeTransactionalMatrix(input)).rejects.toThrow(
    "private session transport required",
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
      maximumRequestHeaderBytes: 0,
      maximumRequestBodyBytes: 65536,
      defaultCredentialRef: "operator",
      credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
    },
  };
  // Malformed trusted configuration cannot reach preparation or dialing.
  await expect(
    runCumulativeTransactionalMatrix({
      ...input,
      exactExecution: invalidExact as unknown as NonNullable<ScenarioRunOptions["exactExecution"]>,
    }),
  ).rejects.toThrow("Exact HTTP execution binding is invalid");
  const mode = {
    ...invalidExact.configuration,
    maximumRequestHeaderBytes: 16384,
    profile: "read-update" as const,
    routes: [{ method: "POST" as const, url: fixture.bindings.batch }],
    resolveCredentials: () => ({}),
  };
  expect(snapshotExactHttpMode(mode).profile).toBe("read-update");
  expect(snapshotExactHttpMode({ ...mode, profile: "transactional" }).profile).toBe(
    "transactional",
  );
  expect(input.harness.prepare).not.toHaveBeenCalled();
  expect(input.execute).not.toHaveBeenCalled();
});

it("keeps private cumulative factories, TX runner, receipt recorder and brand predicate out of public exports", async () => {
  const root = await import("./index.js");
  for (const symbol of [
    createCumulativeTransactionalArtifactBundle,
    createCumulativeReadUpdateArtifactBundle,
    runCumulativeTransactionalMatrix,
    isCumulativeTransactionalArtifactBundle,
    createTransactionalObservations,
  ])
    expect(Object.values(root)).not.toContain(symbol);
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

it("refuses reserved receipt actions in an ordinary RU run before setup or a programmable callback", async () => {
  const manifest = {
    ...ruManifest,
    scenarios: [
      {
        ...ruManifest.scenarios[0],
        actions: [
          {
            id: "receipt",
            family: "client",
            operation: "transactional.receipt-read",
            input: { binding: "subject", method: "GET" },
            captures: [],
            assertions: [
              { id: "status", kind: "json-pointer", pointer: "/status", exists: true, equals: 200 },
            ],
          },
        ],
      },
    ],
  };
  const input = options("read-update");
  const actionExecutor = vi.fn(async () => ({ status: 200 }));
  const configuration = {
    scope: fixture.scope,
    profile: "read-update" as const,
    routes: [{ method: "POST" as const, url: fixture.bindings.batch }],
    maximumRequestHeaderBytes: 16384,
    maximumRequestBodyBytes: 65536,
    defaultCredentialRef: "operator",
    credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
  };
  await expect(
    runConformanceMatrix({
      ...input,
      artifactBundle: createCumulativeReadUpdateArtifactBundle(
        loadProfileContractSelection("read-update"),
        { ...inputs(), manifest: source(manifest) },
      ),
      exactExecution: { configuration, execute: vi.fn() },
      actionExecutor,
    }),
  ).rejects.toThrow("reserved Transactional");
  expect(input.harness.prepare).not.toHaveBeenCalled();
  expect(actionExecutor).not.toHaveBeenCalled();
});

it("uses preparation rather than HTTP timeout for private reopen lifecycle", async () => {
  const row = {
    ...manifest.scenarios[0],
    actions: [
      {
        id: "reopen",
        family: "client",
        operation: "transactional.reopen",
        input: {},
        captures: [],
        assertions: [
          {
            id: "reopened",
            kind: "json-pointer",
            pointer: "/reopened",
            exists: true,
            equals: true,
          },
        ],
      },
    ],
  };
  const artifactBundle = createCumulativeTransactionalArtifactBundle(selected, {
    fixture: inputs().fixture,
    manifest: source({ ...manifest, scenarios: [row] }),
  });
  const base = options();
  let generation = 1;
  const context: import("./transactional-observation.js").TransactionalRunContext = {
    current: (scenario) => ({
      binding: {
        scenario,
        generation,
        listenUrl: "http://127.0.0.1:12345/",
        runtimeConfigurationIdentity: "a".repeat(64),
        configurationDigest: "b".repeat(64),
        responseLimits: { headerBytes: 65536, bodyBytes: 1048576, wireBytes: 2097152 },
      },
      signal: new AbortController().signal,
      dialRoute: { transport: "plain", host: "127.0.0.1", port: 12345 },
      resolveCredentials: () => ({}),
      register: (p) => p,
    }),
    reopen: async (_scenario, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      signal.throwIfAborted();
      generation++;
    },
  };
  const result = await runCumulativeTransactionalMatrix(
    {
      ...base,
      artifactBundle,
      requestTimeoutMs: 5,
      prepareTimeoutMs: 500,
      harness: {
        prepare: async () => ({ capabilities: fixture.capabilities, bindings: fixture.bindings }),
        cleanup: async () => {},
      },
      exactExecution: {
        execute: async () => {
          throw new Error("must not dial");
        },
        configuration: {
          scope: fixture.scope,
          profile: "transactional",
          routes: [{ method: "POST", url: fixture.bindings.batch }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "operator",
          credentialHandles: [{ id: "operator", headerNames: [] }],
        },
      },
    },
    context,
  );
  expect(result.scenarios.find((s) => s.id === row.id)).toMatchObject({ state: "pass" });
  expect(generation).toBe(2);
});

it.each(
  [
    ["wire", "harness-error", "receipt wire headers mismatch"],
    ["validator", "harness-error", "source receipt validator unavailable"],
    ["wire-id", "harness-error", "receipt wire body mismatch"],
    ["source-id", "fail", "source receipt identity invalid"],
    ["source-schema", "fail", "source receipt schema invalid"],
    ["retained", "fail", "retained receipt differs from original wire facts"],
  ].flatMap(([kind, state, reason]) =>
    ["batch", "update-where"].map((target) => [kind, state, reason, target] as const),
  ),
)(
  "retains safe %s receipt reason with correct attribution over raw HTTP (%s/%s/%s)",
  async (kind, state, reason, target) => {
    const scope = fixture.scope,
      id = `${scope}receipts/r1`;
    const body = {
      id,
      status: "completed",
      detail: "available",
      idempotencyKey: "key",
      scopeEpoch: "epoch",
      authorizationView: "view",
      transaction: "tx",
      requiredPosition: "pos-0",
      results: [{ operationIndex: 0, outcome: "matched", count: 0 }],
      next: null,
      expiresAt: "2030-01-01T00:00:00Z",
    };
    let reads = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (request.method === "GET") reads++;
      const text = JSON.stringify(
        kind === "source-id"
          ? { ...body, id: "https://other.invalid/receipts/r1" }
          : kind === "source-schema"
            ? { ...body, unexpected: "private-target-body" }
            : kind === "retained" && request.method === "GET"
              ? { ...body, requiredPosition: "pos-1" }
              : body,
      );
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
        connection: "close",
      });
      response.end(text);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("missing address");
    const dialRoute = { transport: "plain" as const, host: "127.0.0.1", port: address.port };
    const mode = {
      scope,
      profile: "transactional" as const,
      routes: [{ method: "POST" as const, url: fixture.bindings[target!] }],
      maximumRequestHeaderBytes: 16384,
      maximumRequestBodyBytes: 65536,
      defaultCredentialRef: "operator",
      credentialHandles: [{ id: "operator", headerNames: [] }],
      resolveCredentials: () => ({}),
    };
    const raw = createRawHttpExchangeExecutor(dialRoute, {
      exactMode: mode,
      requestTimeoutMs: 5000,
    });
    const { resolveCredentials: _resolver, ...configuration } = mode;
    const row = {
      ...manifest.scenarios[0],
      actions: [
        {
          id: "source",
          family: "http",
          method: "POST",
          target: { binding: target },
          raw: { headerLines: [], body: { encoding: "utf8", value: "{}" } },
          captures: [{ binding: "receipt", from: { kind: "json-pointer", pointer: "/id" } }],
          assertions: [{ id: "status", kind: "status", equals: 200 }],
        },
        {
          id: "read",
          family: "client",
          operation: "transactional.receipt-read",
          input: { binding: "receipt", method: "GET" },
          captures: [],
          assertions: [
            { id: "status", kind: "json-pointer", pointer: "/status", exists: true, equals: 200 },
          ],
        },
      ],
    };
    try {
      const result = await runCumulativeTransactionalMatrix(
        {
          ...options(),
          artifactBundle: createCumulativeTransactionalArtifactBundle(selected, {
            fixture: inputs().fixture,
            manifest: source({ ...manifest, scenarios: [row] }),
          }),
          harness: {
            prepare: async () => ({
              capabilities: fixture.capabilities,
              bindings: fixture.bindings,
            }),
            cleanup: async () => {},
          },
          ...(kind === "validator" ? {} : { schemaValidator: createJsonSchemaValidator(schema) }),
          exactExecution: {
            configuration,
            execute: async (request) => {
              const observed = await raw(request);
              if (kind === "wire-id")
                return {
                  ...observed,
                  bodyText: JSON.stringify({ ...body, id: `${scope}receipts/r2` }),
                };
              return kind === "wire"
                ? {
                    ...observed,
                    headers: { ...observed.headers, "x-self-mismatch": "not-on-wire" },
                  }
                : observed;
            },
          },
        },
        {
          current: (scenario) => ({
            binding: {
              scenario,
              generation: 1,
              listenUrl: `http://127.0.0.1:${address.port}/`,
              runtimeConfigurationIdentity: "a".repeat(64),
              configurationDigest: "b".repeat(64),
              responseLimits: { headerBytes: 65536, bodyBytes: 1048576, wireBytes: 2097152 },
            },
            dialRoute,
            signal: new AbortController().signal,
            resolveCredentials: () => ({}),
            register: (p) => p,
          }),
          reopen: async () => {
            throw Error("must not reopen");
          },
        },
      );
      const actual = result.scenarios.find((s) => s.id === row.id)!;
      expect(actual).toMatchObject({ state, reason });
      expect(JSON.stringify(actual)).not.toContain("private-target-body");
      expect(reads).toBe(kind === "retained" ? 1 : 0);
      if (kind === "retained") {
        expect(actual.actions?.at(-1)?.executionError?.message).toBe(reason);
        expect(actual.exchanges.at(-1)?.dynamicExactConfiguration).toBeDefined();
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

/** Source-only preservation check: braces inside quoted strings do not end an
 * object. The trusted artifacts use a root array named here; no runtime parser. */
function objectSlices(text: string, key: "scenarios" | "rows") {
  const start = text.indexOf("[", text.indexOf(JSON.stringify(key))) + 1;
  const objects = new Map<string, string>();
  let depth = 0,
    begin = -1,
    quoted = false,
    escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{" || char === "[") {
      if (depth === 0) begin = i;
      depth++;
    } else if (char === "}" || char === "]") {
      if (depth === 0) break;
      if (--depth === 0) {
        const raw = text.slice(begin, i + 1);
        objects.set((JSON.parse(raw) as { id: string }).id, raw);
      }
    }
  }
  return objects;
}
const originalObjectPins = {
  manifest: [
    [
      "transactional.set.mutation",
      "6e7280a9ebbbc3faa1da989015cc802f82cd51b17a9cea11e7cc91392bef49d6",
      71739,
    ],
    [
      "transactional.set.zero-match",
      "35aa23bd32539869ea3db41e1c9f3e81a3217e2eb983e764e860a6e00c9eb2c9",
      36055,
    ],
    [
      "transactional.set.cardinality",
      "205af1c54d62efb09c9eadf20147a1730909e788c0d4763ce9718b8648f24ede",
      28546,
    ],
    [
      "transactional.set.singleton-targets",
      "561b8ebc21106628918111332a9ab7b47be7350935925ed1e76a6cb5bed576b9",
      40018,
    ],
    [
      "transactional.batch.atomic-commit",
      "0dfd3b9ed02d01f76ecac08c00b009b4bb9f03e57f7e15a2266eed82fc144747",
      14936,
    ],
    [
      "transactional.batch.rollback",
      "be24067358af7b5acf7bc1beae2eb6534cbc0effa6f65406ab61b139310bfc37",
      16319,
    ],
    [
      "transactional.receipt.readable",
      "ddb97e450e233b941f7d905d49f48648d9965ed1b361dcdc5dee6f810038a1e0",
      12545,
    ],
    [
      "transactional.idempotency.failed-retained",
      "a867694406dde07da71ac70197c60c478dd0fb3344cf2c8160795d1aa62d3378",
      18404,
    ],
  ],
  coverage: [
    [
      "transactional.set.mutation",
      "058147f8194f091ee5a7ef3d4fd378f0324f6570049df777f993acb5f967d540",
      11676,
    ],
    [
      "transactional.set.zero-match",
      "4e79e18a5e4c2735b5c686b9ad610dedc890386bfb06584f98268a421bbb832b",
      6520,
    ],
    [
      "transactional.set.cardinality",
      "2a255ed4d364c435c9f985d7a770386bc7b20b2865887b9c8cc2d6cc5f0dd116",
      5800,
    ],
    [
      "transactional.set.singleton-targets",
      "0c9008bac3e2c047d9aa8d47d343b7ed936c9c9352bb140c6422127c71b156b1",
      7314,
    ],
    [
      "transactional.batch.atomic-commit",
      "ffd77a9d34ac41a6e1f960671bea6880eb5b2ab7b11b3af4ccf0177363d7f4d7",
      2383,
    ],
    [
      "transactional.batch.rollback",
      "9e4f5cdb45f0133f1c6d23caa402701981db2e6f4198e23c667579622ace6769",
      2857,
    ],
    [
      "transactional.receipt.readable",
      "684eba200912ccb0932c0a8286e350a6e545262a205b3ea3df47a12fc6dd18ec",
      2142,
    ],
    [
      "transactional.idempotency.failed-retained",
      "63918cbb495a504fd2043f52b60e7cd8ef1518b8022a96edb0d02660c7df1a8e",
      2917,
    ],
  ],
} as const;
function assertOriginalObjects(text: string, name: keyof typeof originalObjectPins) {
  const objects = objectSlices(text, name === "manifest" ? "scenarios" : "rows");
  for (const [id, hash, bytes] of originalObjectPins[name]) {
    const raw = objects.get(id)!;
    expect(Buffer.byteLength(raw), id).toBe(bytes);
    expect(createHash("sha256").update(raw).digest("hex"), id).toBe(hash);
  }
}
it("preserves every original TX scenario and coverage object while adding one bounded partial receipt page row", () => {
  for (const name of ["manifest", "coverage"] as const)
    assertOriginalObjects(read(name).toString(), name);
  const changed = read("manifest").toString().replace('"equals": 401', '"equals": 402');
  expect(() => assertOriginalObjects(changed, "manifest")).toThrow(
    "transactional.batch.atomic-commit",
  );
  expect(manifest.scenarios.map((r: { id: string }) => r.id)).toEqual([
    "transactional.batch.atomic-commit",
    "transactional.batch.rollback",
    "transactional.set.mutation",
    "transactional.set.zero-match",
    "transactional.set.cardinality",
    "transactional.set.singleton-targets",
    "transactional.receipt.readable",
    "transactional.receipt.pagination",
    "transactional.idempotency.failed-retained",
  ]);
  const counts = new Map<string, number>();
  for (const [id, expected] of [
    ["transactional.set.cardinality", 16],
    ["transactional.set.singleton-targets", 22],
    ["transactional.set.mutation", 30],
    ["transactional.set.zero-match", 17],
    ["transactional.receipt.pagination", 18],
  ] as const) {
    const rows = manifest.scenarios.filter((r: { id: string }) => r.id === id);
    expect(rows, id).toHaveLength(1);
    expect(rows[0].actions, id).toHaveLength(expected);
    counts.set(id, rows[0].actions.length);
  }
  expect(
    counts.get("transactional.set.cardinality")! +
      counts.get("transactional.set.singleton-targets")!,
  ).toBe(38);
  expect(
    counts.get("transactional.set.mutation")! + counts.get("transactional.set.zero-match")!,
  ).toBe(47);
  expect(manifest.scenarios.flatMap((r: { actions: unknown[] }) => r.actions)).toHaveLength(139);
  expect(read("manifest").byteLength - 238693).toBeLessThanOrEqual(136 * 1024);
  expect(read("manifest").byteLength).toBeLessThanOrEqual(370 * 1024);
  expect(read("coverage").byteLength - 41812).toBeLessThanOrEqual(16 * 1024);
  expect(read("fixture").byteLength).toBe(716);
  expect(createHash("sha256").update(read("fixture")).digest("hex")).toBe(
    "3a7899ced771d4880066d98b0000c53f801ece53458502cc4f3bc641146c9a85",
  );
  let nodes = 0;
  const pending: unknown[] = [manifest];
  while (pending.length) {
    const value = pending.pop();
    nodes++;
    if (value && typeof value === "object") pending.push(...Object.values(value));
  }
  expect(nodes).toBeLessThanOrEqual(10200);
  // Clause ownership is independent from the exhaustive mechanical assertion mirror.
  const clauseMap = {
    "transactional.set.mutation": ["#set-mutation-objects", "#mutation-receipt-responses"],
    "transactional.set.zero-match": ["#events-and-event-sources", "#mutation-receipt-responses"],
    "transactional.set.cardinality": ["#set-mutation", "#transactional-problem-details"],
    "transactional.set.singleton-targets": ["#batch-operation-target"],
  };
  for (const [id, anchors] of Object.entries(clauseMap))
    expect(
      selected.catalog.scenarios.find((r) => r.id === id)?.requirements.map((r) => r.anchor),
    ).toEqual(anchors);
});

it("pins required context presence before equality in both new set rows", () => {
  const headers = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"];
  for (const row of manifest.scenarios.filter((r: { id: string }) =>
    ["transactional.set.mutation", "transactional.set.zero-match"].includes(r.id),
  )) {
    for (const action of row.actions) {
      if (action.family === "client" && action.operation === "transactional.receipt-read") {
        for (const name of headers)
          expect(action.assertions).toContainEqual(
            expect.objectContaining({
              kind: "json-pointer",
              pointer: `/headers/${name}`,
              exists: true,
            }),
          );
      }
      for (const [index, assertion] of action.assertions.entries()) {
        if (assertion.kind !== "response-metadata-equals") continue;
        const prior = row.actions.find((a: { id: string }) => a.id === assertion.request);
        expect(prior).toBeDefined();
        expect(assertion.headers).toEqual(headers);
        for (const name of headers) {
          expect(prior.assertions).toContainEqual(
            expect.objectContaining({ kind: "header", name, absent: false }),
          );
          expect(action.assertions.slice(0, index)).toContainEqual(
            expect.objectContaining({ kind: "header", name, absent: false }),
          );
        }
      }
    }
  }
});

it("pins the one-page matched-plus-updated witness without advertised-limit or other-outcome credit", () => {
  const row = manifest.scenarios.find(
    (r: { id: string }) => r.id === "transactional.receipt.pagination",
  );
  expect(manifest.scenarios.indexOf(row)).toBe(7);
  expect(row.actions).toHaveLength(18);
  const later = row.actions.find((a: { id: string }) => a.id === "p-later-state");
  expect(later.captures).toEqual([]); // HTTP capture is URL-only; no unimplemented array capture.
  const final = row.actions.at(-1);
  expect(final.id).toBe("p-final");
  for (const [action, assertionId] of [
    [later, "ordered-state"],
    [final, "exact-later-items"],
  ] as const) {
    const tuple = action.assertions.find((a: { id: string }) => a.id === assertionId);
    expect(tuple).toMatchObject({ kind: "json-array-tuples", pointer: "/items", ordered: true });
    expect(tuple.projections).toEqual(
      ["/id", "/type", "/properties", "/metadata"].map((pointer) => ({ pointer })),
    );
    expect(tuple.equals).toEqual(
      Array.from({ length: 32 }, (_, index) => [
        `https://reference.invalid/acme/beads/p${String(index).padStart(2, "0")}`,
        "https://reference.invalid/acme/types/task",
        { title: index === 31 ? "later" : "changed" },
        { tag: "pagination" },
      ]),
    );
  }
  // Semantic final state is literal; opaque current envelopes are not captured.
  // Exact recorded root/page whole-body retention remains a separate client oracle.
  expect(
    row.actions.filter((a: { operation?: string }) => a.operation === "transactional.reopen"),
  ).toHaveLength(1);
  const coverage = JSON.parse(read("coverage").toString()).rows.find(
    (r: { id: string }) => r.id === row.id,
  );
  expect(coverage.reason).toContain("Matched consumes one entry slot");
  expect(coverage.reason).toContain("only matched+updated");
  expect(coverage.reason).toContain("advertised page.maximumItems");
  for (const action of row.actions) {
    if (action.family !== "client" || action.operation !== "transactional.receipt-read") continue;
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(action.assertions).toContainEqual(
        expect.objectContaining({
          kind: "json-pointer",
          pointer: `/headers/${name}`,
          exists: true,
        }),
      );
    expect(action.assertions).toContainEqual(
      expect.objectContaining({ pointer: "/headers/cache-control", equals: "private, no-store" }),
    );
    for (const name of ["etag", "last-modified"])
      expect(action.assertions).toContainEqual(
        expect.objectContaining({ pointer: `/headers/${name}`, exists: false }),
      );
  }
});
