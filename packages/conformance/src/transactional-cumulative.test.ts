import { createServer } from "node:http";
import { createRawHttpExchangeExecutor } from "./http-executor.js";
import { createJsonSchemaValidator } from "./schema-validator.js";
import schema from "../../../specs/profiles/core/bdp-v0.schema.json" with { type: "json" };
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
import { selectApplicableScenariosForProfile } from "./selection.js";
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
const atomicCommit = manifest.scenarios.find(
  (row: { id: string }) => row.id === "transactional.batch.atomic-commit",
)!;
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
      ...atomicCommit,
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
  expect(selected.required).toHaveLength(251);
  expect(selected.required.map((row) => row.id)).toContain(
    "read-update.http.command-minimum-fields",
  );
  expect(actual.manifest.scenarios.map((row) => row.id)).toContain(
    "read-update.http.command-minimum-fields",
  );
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
    { scenarios: [{ ...atomicCommit, requiredProfile: "read-update" }] },
    { scenarios: [{ ...atomicCommit, id: selected.retiredIds[0] }] },
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
        id: atomicCommit.id,
        requiredProfile: "transactional",
        setup: atomicCommit.setup,
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
  expect(plan.requirements.filter((r) => r.readiness === "unplanned")).toHaveLength(235);
  expect(plan.unobservedIds).toEqual(selected.required.map((r) => r.id));
  expect(plan.unobservedIds).toContain("read-update.http.command-minimum-fields");
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
    ...atomicCommit,
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
      ...atomicCommit,
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
      "transactional.batch.deletion-safety",
      "3e66e7c95aec963cc80e076249a5870b952765b2e98c1023ea148f8f628e6aeb",
      131808,
    ],
    [
      "transactional.idempotency.conflict",
      "ba93aea884ae462533d02695642f03a2ca854f5adabeb41867254216dabb2106",
      29772,
    ],
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
      "transactional.receipt.pagination",
      "c531c260349347cdc3e54ba68282f1a266a5fa207d3775660615f836a4768782",
      138750,
    ],
    [
      "transactional.idempotency.failed-retained",
      "a867694406dde07da71ac70197c60c478dd0fb3344cf2c8160795d1aa62d3378",
      18404,
    ],
    [
      "transactional.batch.no-op-entries",
      "9307b230eb053131e9127cbbb5e6285305b79d6794edd22f5432a07fc74d9faa",
      81047,
    ],
  ],
  coverage: [
    [
      "transactional.batch.deletion-safety",
      "ac27a329a1cc013e6a0e24e0f5cad6b5b4af6c128ad65302d030422a3c7e3c0a",
      17375,
    ],
    [
      "transactional.idempotency.conflict",
      "de9b758f8ac4df7db5597b1eb2b402a116720becc30a41e7198f78f244358ec0",
      5188,
    ],
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
      "transactional.receipt.pagination",
      "0735edbca2fbf384f9f8147140a353dc084d9ad85facaddf2f5073f56a7256ee",
      13057,
    ],
    [
      "transactional.idempotency.failed-retained",
      "63918cbb495a504fd2043f52b60e7cd8ef1518b8022a96edb0d02660c7df1a8e",
      2917,
    ],
    [
      "transactional.batch.no-op-entries",
      "383de4e0cb9b3bad310b9db7ff9009cb59fac55966f0309bc71c5d007bea6c1c",
      10587,
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
const sequenceMemberId = "transactional.sequence.member-transactions";
const sequenceParentPins = {
  manifest: [
    [
      "read-update.http.command-minimum-fields",
      "f04c001617ccad14ef67a82586ea5f61ec918bc2545bb041fafc21dee07b5d7e",
      54412,
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
      "transactional.batch.deletion-safety",
      "3e66e7c95aec963cc80e076249a5870b952765b2e98c1023ea148f8f628e6aeb",
      131808,
    ],
    [
      "transactional.batch.no-op-entries",
      "9307b230eb053131e9127cbbb5e6285305b79d6794edd22f5432a07fc74d9faa",
      81047,
    ],
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
      "transactional.receipt.readable",
      "ddb97e450e233b941f7d905d49f48648d9965ed1b361dcdc5dee6f810038a1e0",
      12545,
    ],
    [
      "transactional.receipt.pagination",
      "c531c260349347cdc3e54ba68282f1a266a5fa207d3775660615f836a4768782",
      138750,
    ],
    [
      "transactional.idempotency.conflict",
      "ba93aea884ae462533d02695642f03a2ca854f5adabeb41867254216dabb2106",
      29772,
    ],
    [
      "transactional.idempotency.cross-carrier",
      "4ad8c05fe5fbb4682809d4481c93e2684fe30fbbb8962b4da498590637f8f35b",
      64106,
    ],
    [
      "transactional.idempotency.failed-retained",
      "a867694406dde07da71ac70197c60c478dd0fb3344cf2c8160795d1aa62d3378",
      18404,
    ],
  ],
  coverage: [
    [
      "read-update.http.command-minimum-fields",
      "47914ed67c7b06e721e74134e0c633f3e1a7d461cb50ea200ff1874686885c2a",
      8888,
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
      "transactional.batch.deletion-safety",
      "ac27a329a1cc013e6a0e24e0f5cad6b5b4af6c128ad65302d030422a3c7e3c0a",
      17375,
    ],
    [
      "transactional.batch.no-op-entries",
      "383de4e0cb9b3bad310b9db7ff9009cb59fac55966f0309bc71c5d007bea6c1c",
      10587,
    ],
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
      "transactional.receipt.readable",
      "684eba200912ccb0932c0a8286e350a6e545262a205b3ea3df47a12fc6dd18ec",
      2142,
    ],
    [
      "transactional.receipt.pagination",
      "0735edbca2fbf384f9f8147140a353dc084d9ad85facaddf2f5073f56a7256ee",
      13057,
    ],
    [
      "transactional.idempotency.conflict",
      "de9b758f8ac4df7db5597b1eb2b402a116720becc30a41e7198f78f244358ec0",
      5188,
    ],
    [
      "transactional.idempotency.cross-carrier",
      "c5e6076a2104c06f88fac88c77214522cab457faf925fe03881dff9778c35245",
      11196,
    ],
    [
      "transactional.idempotency.failed-retained",
      "63918cbb495a504fd2043f52b60e7cd8ef1518b8022a96edb0d02660c7df1a8e",
      2917,
    ],
  ],
} as const;
function withoutSequenceMemberRow(text: string, name: "manifest" | "coverage") {
  const key = name === "manifest" ? "scenarios" : "rows";
  const objects = objectSlices(text, key);
  for (const [id, hash, bytes] of sequenceParentPins[name]) {
    const raw = objects.get(id)!;
    expect(Buffer.byteLength(raw), id).toBe(bytes);
    expect(createHash("sha256").update(raw).digest("hex"), id).toBe(hash);
  }
  const raw = objects.get(sequenceMemberId)!;
  expect(typeof raw).toBe("string");
  const suffix = `,\n    ${raw}\n  ]\n}\n`;
  expect(text.endsWith(suffix), "sequence-tail-position").toBe(true);
  const parent = text.slice(0, -suffix.length) + "\n  ]\n}\n";
  expect(createHash("sha256").update(parent).digest("hex"), "sequence-full-parent").toBe(
    name === "manifest"
      ? "29729151cf6da641545910ec3880f9609c13b319af7bbe99d3d2ad47833dab96"
      : "4619813e9446e0e714a64c11eac184531950f57720e32c7ef414c7e3342121af",
  );
  return parent;
}
function assertSequenceMemberObservation(value: typeof manifest) {
  const row = value.scenarios.find((r: { id: string }) => r.id === sequenceMemberId)!;
  expect(
    row.actions.map((a: { id: string }) => a.id),
    "sequence-action-order",
  ).toEqual([
    "s-sequence",
    "s-first-receipt",
    "s-first-facts",
    "s-failed-receipt",
    "s-failed-facts",
    "s-last-receipt",
    "s-last-facts",
    "s-replay",
    "s-current",
    "s-events",
  ]);
  const fact = (index: number, id: string) =>
    row.actions[index].assertions.find((a: { id: string }) => a.id === id);
  for (const index of [0, 7]) {
    expect(fact(index, "middle-status"), "sequence-middle-status").toEqual({
      id: "middle-status",
      kind: "json-pointer",
      pointer: "/results/1/status",
      exists: true,
      equals: 404,
    });
    expect(fact(index, "middle-retry"), "sequence-middle-retry").toEqual({
      id: "middle-retry",
      kind: "json-pointer",
      pointer: "/results/1/retry",
      exists: true,
      equals: "after-state-change",
    });
  }
  expect(fact(3, "problem"), "sequence-failed-internal-index").toEqual({
    id: "problem",
    kind: "json-pointer",
    pointer: "/problem",
    exists: true,
    equals: {
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      status: 404,
      retry: "after-state-change",
      operationIndex: 0,
    },
  });
  expect(row.actions.flatMap((a: { captures: unknown[] }) => a.captures)).toEqual([
    { binding: "s-first-root", from: { kind: "json-pointer", pointer: "/id" } },
    { binding: "s-failed-root", from: { kind: "json-pointer", pointer: "/id" } },
    { binding: "s-last-root", from: { kind: "json-pointer", pointer: "/id" } },
  ]);
  expect(row.actions.flatMap((a: { assertions: unknown[] }) => a.assertions)).toHaveLength(209);
  expect(
    createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    "sequence-complete-independent-facts",
  ).toBe("48e524596890fab7bf578cbbb653ed844178c33b568f8e0c033736d2745598ca");
}

it("preserves every original TX scenario and coverage object while adding one bounded partial cross-carrier row", () => {
  assertSequenceMemberObservation(manifest);
  for (const [index, id] of [
    [0, "middle-status"],
    [3, "problem"],
  ] as const) {
    const weak = structuredClone(manifest);
    const row = weak.scenarios.find((r: { id: string }) => r.id === sequenceMemberId)!;
    row.actions[index].assertions = row.actions[index].assertions.filter(
      (a: { id: string }) => a.id !== id,
    );
    expect(() => assertSequenceMemberObservation(weak)).toThrow(
      index === 0 ? "sequence-middle-status" : "sequence-failed-internal-index",
    );
  }
  assertCrossCarrierObservation(manifest);
  for (const kind of ["retained-body", "presentation", "old-record"] as const) {
    const weak = structuredClone(manifest);
    const row = weak.scenarios.find(
      (r: { id: string }) => r.id === "transactional.idempotency.cross-carrier",
    )!;
    if (kind === "retained-body")
      row.actions[2].assertions = row.actions[2].assertions.filter(
        (a: { id: string }) => a.id !== "retained-body",
      );
    if (kind === "presentation")
      row.actions[6].assertions.find((a: { id: string }) => a.id === "present-name").equals =
        "first";
    if (kind === "old-record")
      row.actions[6].assertions.find(
        (a: { id: string }) => a.id === "created-record",
      ).equalsBinding = "x-updated-record";
    expect(() => assertCrossCarrierObservation(weak)).toThrow(kind);
  }
  for (const name of ["manifest", "coverage"] as const) {
    const text = withoutMinimumRow(
      withoutSequenceMemberRow(withoutPrincipalRow(read(name).toString(), name), name),
      name,
    );
    const raw = objectSlices(text, name === "manifest" ? "scenarios" : "rows").get(
      "transactional.idempotency.cross-carrier",
    )!;
    const reconstructed = text.replace(`    ${raw},\n`, "");
    expect(reconstructed).not.toBe(text);
    expect(createHash("sha256").update(reconstructed).digest("hex")).toBe(
      name === "manifest"
        ? "56318c56ee99bb981336e3f17560e7b079e88f2f85ef463874c1d556a066b2b2"
        : "dafedd035ca20f684559c739ebf2e6155f8446ce8062c3fa60ff86967b259bbd",
    );
  }
  for (const name of ["manifest", "coverage"] as const)
    assertOriginalObjects(read(name).toString(), name);
  const changed = read("manifest").toString().replace('"equals": 401', '"equals": 402');
  expect(() => assertOriginalObjects(changed, "manifest")).toThrow(
    "transactional.batch.atomic-commit",
  );
  expect(manifest.scenarios.map((r: { id: string }) => r.id)).toEqual([
    "read-update.idempotency.principal-isolation",
    "read-update.http.command-minimum-fields",
    "transactional.batch.atomic-commit",
    "transactional.batch.rollback",
    "transactional.batch.deletion-safety",
    "transactional.batch.no-op-entries",
    "transactional.set.mutation",
    "transactional.set.zero-match",
    "transactional.set.cardinality",
    "transactional.set.singleton-targets",
    "transactional.receipt.readable",
    "transactional.receipt.pagination",
    "transactional.idempotency.conflict",
    "transactional.idempotency.cross-carrier",
    "transactional.idempotency.failed-retained",
    "transactional.sequence.member-transactions",
  ]);
  const counts = new Map<string, number>();
  for (const [id, expected] of [
    ["transactional.set.cardinality", 16],
    ["transactional.set.singleton-targets", 22],
    ["transactional.set.mutation", 30],
    ["transactional.set.zero-match", 17],
    ["transactional.receipt.pagination", 18],
    ["transactional.idempotency.conflict", 12],
    ["transactional.idempotency.cross-carrier", 12],
    ["transactional.batch.no-op-entries", 15],
    ["transactional.batch.deletion-safety", 21],
    ["transactional.sequence.member-transactions", 10],
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
  expect(manifest.scenarios.flatMap((r: { actions: unknown[] }) => r.actions)).toHaveLength(227);
  // Historical root-accepted deletion-safety measurement: M620094/N16373/C88043/A333.
  // Schema-name repair uses4B of the accepted margin:4092B/64nodes/1024B.
  // Historical measurement-only draft retained the smaller guards pending root acceptance.
  // Root-accepted cross-carrier: disk684206/normal695598/nodes18107/coverage99245.
  // Disk and normal-form fences are separate; margins are4096B/64nodes/1024B.
  // Historical deletion guards: manifest135906delta/650386absolute,
  // coverage18405delta/91848absolute, nodes3418delta/17275absolute.
  // Root-accepted command-minimum: disk738783/normal750589/nodes19575/coverage108091.
  // Preserve bases488280/13019/70662 and margins4096B/64nodes/1024B.
  // Root-accepted sequence-member: disk790009/normal802361/nodes20956/coverage117702.
  // Root-accepted principal: disk825049/normal837765/nodes21908/coverage124537.
  // These measured source authoring fences do not change runtime/parser limits.
  expect(read("manifest").byteLength - 488280).toBeLessThanOrEqual(340865);
  expect(read("manifest").byteLength).toBeLessThanOrEqual(829145);
  expect(Buffer.byteLength(JSON.stringify(manifest, null, 2) + "\n")).toBeLessThanOrEqual(841861);
  expect(read("coverage").byteLength - 70662).toBeLessThanOrEqual(54899);
  expect(read("coverage").byteLength).toBeLessThanOrEqual(125561);
  expect(
    Buffer.byteLength(JSON.stringify(JSON.parse(read("coverage").toString()), null, 2) + "\n"),
  ).toBeLessThanOrEqual(125561);
  expect(
    manifest.scenarios.flatMap((r: { actions: { assertions: unknown[] }[] }) =>
      r.actions.flatMap((a) => a.assertions),
    ),
  ).toHaveLength(2642);
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
  expect(nodes - 13019).toBeLessThanOrEqual(8953);
  expect(nodes).toBeLessThanOrEqual(21972);
  // Clause ownership is independent from the exhaustive mechanical assertion mirror.
  const clauseMap = {
    "transactional.receipt.pagination": [
      "#mutation-receipt-responses",
      "#mutation-receipt-responses",
    ],
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

it("pins required context presence before equality in set and cross-carrier rows", () => {
  const headers = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"];
  for (const row of manifest.scenarios.filter((r: { id: string }) =>
    [
      "read-update.idempotency.principal-isolation",
      "transactional.set.mutation",
      "transactional.set.zero-match",
      "transactional.idempotency.cross-carrier",
    ].includes(r.id),
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
  expect(manifest.scenarios.indexOf(row)).toBe(11);
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
  const update = row.actions.find((a: { id: string }) => a.id === "p-update");
  const page = row.actions.find((a: { id: string }) => a.id === "p-page-read");
  const assertion = (action: typeof update, id: string) =>
    action.assertions.find((a: { id: string }) => a.id === id);
  expect(assertion(update, "matched")).toMatchObject({
    kind: "json-pointer",
    pointer: "/results/0",
    exists: true,
    equals: { operationIndex: 0, outcome: "matched", count: 32 },
  });
  expect(assertion(update, "outcomes")).toMatchObject({
    kind: "json-array-tuples",
    pointer: "/results",
    ordered: true,
    projections: [{ pointer: "/operationIndex" }, { pointer: "/outcome" }],
    equals: [[0, "matched"], ...Array.from({ length: 31 }, () => [0, "updated"])],
  });
  expect(assertion(update, "no-extra")).toMatchObject({ pointer: "/results/32", exists: false });
  expect(assertion(update, "next-page")).toMatchObject({ pointer: "/next", exists: true });
  const root = row.actions.find((a: { id: string }) => a.id === "p-root-read");
  expect(assertion(root, "next-page")).toMatchObject({
    pointer: "/body/next",
    exists: true,
    equalsBinding: "p-page",
  });
  expect(page.assertions).toContainEqual(
    expect.objectContaining({ pointer: "/body/results/1", exists: false }),
  );
  for (const [pointer, equals] of [
    ["/body/results/0/resource/id", "https://reference.invalid/acme/beads/p31"],
    ["/body/results/0/resource/type", "https://reference.invalid/acme/types/task"],
    ["/body/results/0/resource/properties", { title: "changed" }],
    ["/body/results/0/resource/metadata", { tag: "pagination" }],
  ])
    expect(page.assertions).toContainEqual(
      expect.objectContaining({ pointer, exists: true, equals }),
    );
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

function assertCompletedConflictRequests(value: typeof manifest) {
  const row = value.scenarios.find(
    (r: { id: string }) => r.id === "transactional.idempotency.conflict",
  )!;
  const scope = "https://reference.invalid/acme/";
  const expected = (id: string) =>
    JSON.stringify({
      operations: [
        {
          operation: "createBead",
          id: `beads/${id}`,
          type: `${scope}types/task`,
          properties: { title: "original" },
          metadata: { tag: "conflict" },
        },
      ],
    });
  expect(row.actions.map((a: { id: string }) => a.id)).toEqual([
    "c-commit",
    "c-original",
    "c-conflict",
    "c-state",
    "c-events",
    "c-retry",
    "c-reopen",
    "c-conflict-reopened",
    "c-retry-reopened",
    "reopened-conflict-root",
    "c-state-reopened",
    "c-events-reopened",
  ]);
  const posts = row.actions.filter((a: { method?: string }) => a.method === "POST");
  expect(posts).toHaveLength(5);
  for (const action of posts) {
    const conflict = action.id === "c-conflict" || action.id === "c-conflict-reopened";
    expect(action.raw.body, action.id).toEqual({
      encoding: "utf8",
      value: expected(conflict ? "b" : "a"),
    });
    expect(action.raw.headerLines, action.id).toEqual([
      { name: "content-type", value: "application/json" },
      { name: "idempotency-key", value: "completed-conflict" },
      { name: "accept", value: action.id === "c-conflict" ? "text/plain" : "application/json" },
    ]);
    expect(action.credentialRef).toBe("operator");
    expect(action.target).toEqual({ binding: "batch" });
    expect(action.captures).toEqual(
      action.id === "c-commit"
        ? [{ binding: "c-root", from: { kind: "json-pointer", pointer: "/id" } }]
        : [],
    );
    expect(Buffer.byteLength(action.raw.body.value)).toBeLessThanOrEqual(2048);
  }
  expect(row.actions.filter((a: { family: string }) => a.family === "http")).toHaveLength(9);
  for (const action of row.actions.filter((a: { family: string }) => a.family === "http")) {
    expect(action.assertions).toContainEqual({
      id: "request-headers",
      kind: "request-authored-headers",
    });
    expect(action.assertions).toContainEqual({ id: "request-body", kind: "request-authored-body" });
  }
}
// Independent expected response objects: all context-presence assertions are mandatory.
// Preserve the existing Event assertion order instead of rewriting the artifact to
// match the M/Z guard convention; presence after equality must still pass.
function assertCompletedConflictResponses(value: typeof manifest) {
  const row = value.scenarios.find(
    (r: { id: string }) => r.id === "transactional.idempotency.conflict",
  )!;
  const scope = "https://reference.invalid/acme/";
  const headers = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"];
  const pointer = (id: string, path: string, expected: unknown) => ({
    id,
    kind: "json-pointer",
    pointer: path,
    exists: true,
    equals: expected,
  });
  const present = (id: string, path: string) => ({
    id,
    kind: "json-pointer",
    pointer: path,
    exists: true,
  });
  const binding = (id: string, path: string, equalsBinding: string) => ({
    id,
    kind: "json-pointer",
    pointer: path,
    exists: true,
    equalsBinding,
  });
  const schema = (ref: string) => ({ id: "schema", kind: "json-schema", schema: `#/$defs/${ref}` });
  const status = (equals: number) => ({ id: "http-status", kind: "status", equals });
  const state = [
    `${scope}beads/a`,
    `${scope}types/task`,
    { title: "original" },
    { tag: "conflict" },
  ];
  const created = (path: string) => ({
    id: "created-record",
    kind: "json-array-tuples",
    pointer: path,
    ordered: true,
    projections: [
      "/operationIndex",
      "/outcome",
      "/resource/id",
      "/resource/type",
      "/resource/properties",
      "/resource/metadata",
    ].map((pointer) => ({ pointer })),
    equals: [[0, "created", ...state]],
  });
  const headerPresence = headers.map((name) => ({
    id: `present-${name}`,
    kind: "header",
    name,
    absent: false,
  }));
  const authored = [
    { id: "request-headers", kind: "request-authored-headers" },
    { id: "request-body", kind: "request-authored-body" },
  ];
  const rootRead = [
    pointer("status", "/status", 200),
    pointer("body-present", "/bodyPresent", true),
    ...headers.map((name) => present(name, `/headers/${name}`)),
    pointer("private-cache", "/headers/cache-control", "private, no-store"),
    { id: "no-etag", kind: "json-pointer", pointer: "/headers/etag", exists: false },
    {
      id: "no-last-modified",
      kind: "json-pointer",
      pointer: "/headers/last-modified",
      exists: false,
    },
  ];
  const conflict = [
    status(409),
    {
      id: "problem-media",
      kind: "header",
      name: "content-type",
      equals: "application/problem+json",
    },
    schema("transactionalProblem"),
    pointer("problem-type", "/type", "https://github.com/gastownhall/bdp/problems/conflict"),
    pointer("problem-code", "/code", "idempotency-conflict"),
    pointer("problem-status", "/status", 409),
    pointer("retry", "/retry", "never"),
    ...authored,
  ];
  const collection = [
    status(200),
    schema("currentBeadCollection"),
    pointer("no-next", "/next", null),
    {
      id: "ordered-state",
      kind: "json-array-tuples",
      pointer: "/items",
      ordered: true,
      projections: ["/id", "/type", "/properties", "/metadata"].map((pointer) => ({ pointer })),
      equals: [state],
    },
    binding("retained-record", "/items/0", "c-record"),
    ...authored,
  ];
  const events = [
    status(200),
    schema("eventPage"),
    pointer("no-next", "/next", null),
    {
      id: "ordered-facts",
      kind: "json-array-tuples",
      pointer: "/events",
      ordered: true,
      projections: ["/source", "/type", "/subject", "/ordinal"].map((pointer) => ({ pointer })),
      equals: [[`${scope}events/`, "created", `${scope}beads/a`, 0]],
    },
    { id: "serving-context", kind: "response-metadata-equals", request: "c-commit", headers },
    ...headerPresence,
    ...authored,
  ];
  const replay = [
    status(200),
    schema("mutationReceipt"),
    pointer("disposition", "/status", "completed"),
    binding("retained-body", "", "c-body"),
    binding("retained-root", "/id", "c-root"),
    ...authored,
  ];
  const assertions: Record<string, unknown[]> = {
    "c-commit": [
      status(200),
      schema("mutationReceipt"),
      pointer("disposition", "/status", "completed"),
      pointer("no-next", "/next", null),
      present("effect-position", "/effectPosition"),
      created("/results"),
      ...headerPresence,
      ...authored,
    ],
    "c-original": [
      ...rootRead,
      pointer("disposition", "/body/status", "completed"),
      pointer("no-next", "/body/next", null),
      present("effect-position", "/body/effectPosition"),
      created("/body/results"),
    ],
    "c-conflict": conflict,
    "c-conflict-reopened": conflict,
    "c-state": collection,
    "c-state-reopened": collection,
    "c-events": events,
    "c-events-reopened": events,
    "c-retry": replay,
    "c-retry-reopened": replay,
    "c-reopen": [pointer("reopened", "/reopened", true)],
    "reopened-conflict-root": [...rootRead, binding("retained-body", "/body", "c-body")],
  };
  const captures: Record<string, unknown[]> = {
    "c-commit": [{ binding: "c-root", from: { kind: "json-pointer", pointer: "/id" } }],
    "c-original": [
      { binding: "c-body", from: { kind: "json-pointer", pointer: "/body" } },
      { binding: "c-record", from: { kind: "json-pointer", pointer: "/body/results/0/resource" } },
    ],
  };
  expect(row.actions).toHaveLength(Object.keys(assertions).length);
  for (const action of row.actions) {
    expect(action.assertions, `${action.id} complete response assertions`).toEqual(
      assertions[action.id],
    );
    expect(action.captures, `${action.id} complete captures`).toEqual(captures[action.id] ?? []);
  }
}

it("pins complete conflict responses and rejects retained-record equality weakening", () => {
  assertCompletedConflictResponses(manifest);
  for (const id of ["c-state", "c-state-reopened"]) {
    const weakened = structuredClone(manifest);
    const row = weakened.scenarios.find(
      (r: { id: string }) => r.id === "transactional.idempotency.conflict",
    )!;
    const assertion = row.actions
      .find((a: { id: string }) => a.id === id)
      .assertions.find((a: { id: string }) => a.id === "retained-record");
    delete assertion.equalsBinding;
    expect(() => assertCompletedConflictResponses(weakened)).toThrow(
      `${id} complete response assertions`,
    );
  }
});

it("rejects removing mandatory context presence from either comparison side", () => {
  for (const id of ["c-commit", "c-events", "c-events-reopened"]) {
    const weakened = structuredClone(manifest);
    const row = weakened.scenarios.find(
      (r: { id: string }) => r.id === "transactional.idempotency.conflict",
    )!;
    const action = row.actions.find((a: { id: string }) => a.id === id);
    action.assertions = action.assertions.filter(
      (a: { id: string }) => a.id !== "present-bdp-scope-position",
    );
    expect(() => assertCompletedConflictResponses(weakened)).toThrow(
      `${id} complete response assertions`,
    );
  }
});

it("pins the completed-key conflict law, five presentations, and semantic request difference", () => {
  expect(
    selected.catalog.scenarios.find((r) => r.id === "transactional.idempotency.conflict")!
      .requirements,
  ).toEqual([
    {
      source: "docs/specs/bdp.md",
      anchor: "#mutation-transactions",
      selectedText: "Reusing the key for a different semantic request is an idempotency conflict.",
    },
    {
      source: "docs/specs/bdp.md",
      anchor: "#mutation-transactions",
      selectedText:
        "A request with the same key and a different normalized request is refused before admission with `409` `idempotency-conflict` for as long as the key is bound",
    },
  ]);
  assertCompletedConflictRequests(manifest);
  const changed = structuredClone(manifest);
  const row = changed.scenarios.find(
    (r: { id: string }) => r.id === "transactional.idempotency.conflict",
  )!;
  row.actions.find((a: { id: string }) => a.id === "c-conflict").raw.body.value =
    row.actions[0].raw.body.value;
  expect(() => assertCompletedConflictRequests(changed)).toThrow("c-conflict");
  for (const name of ["manifest", "coverage"] as const) {
    expect(originalObjectPins[name]).toHaveLength(12);
    const text = read(name).toString();
    const raw = objectSlices(text, name === "manifest" ? "scenarios" : "rows").get(
      "transactional.receipt.pagination",
    )!;
    const changedRaw =
      name === "manifest"
        ? raw.replace('"equals": 200', '"equals": 201')
        : raw.replace('"reason": "Bounded', '"reason": "bounded');
    expect(changedRaw).not.toBe(raw);
    expect(Buffer.byteLength(changedRaw)).toBe(Buffer.byteLength(raw));
    expect(JSON.parse(changedRaw).id).toBe("transactional.receipt.pagination");
    expect(() => assertOriginalObjects(text.replace(raw, changedRaw), name)).toThrow(
      "transactional.receipt.pagination",
    );
  }
});

// Independent literal oracle for the bounded matching no-op partition. None of
// these expected values or captures are derived from the candidate manifest.
function assertMatchingNoopObservation(candidate: typeof manifest) {
  const scope = "https://reference.invalid/acme/";
  const task = `${scope}types/task`,
    relationship = `${scope}types/relationship`;
  const headers = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"];
  type Assertion = Record<string, unknown>;
  const pointer = (id: string, path: string, equals: unknown): Assertion => ({
    id,
    kind: "json-pointer",
    pointer: path,
    exists: true,
    equals,
  });
  const present = (id: string, path: string): Assertion => ({
    id,
    kind: "json-pointer",
    pointer: path,
    exists: true,
  });
  const binding = (id: string, path: string, equalsBinding: string): Assertion => ({
    id,
    kind: "json-pointer",
    pointer: path,
    exists: true,
    equalsBinding,
  });
  const tuple = (
    id: string,
    path: string,
    projections: string[],
    equals: unknown[][],
  ): Assertion => ({
    id,
    kind: "json-array-tuples",
    pointer: path,
    ordered: true,
    projections: projections.map((pointer) => ({ pointer })),
    equals,
  });
  const capture = (binding: string, pointer: string) => ({
    binding,
    from: { kind: "json-pointer", pointer },
  });
  const raw = (schema: string, baseline: string | undefined, position = "pos-1"): Assertion[] => [
    { id: "http-status", kind: "status", equals: 200 },
    ...headers.map((name) => ({ id: `present-${name}`, kind: "header", name, absent: false })),
    { id: "schema", kind: "json-schema", schema: `#/$defs/${schema}` },
    baseline
      ? { id: "serving-context", kind: "response-metadata-equals", request: baseline, headers }
      : { id: "position", kind: "header", name: headers[2], equals: position },
    { id: "request-headers", kind: "request-authored-headers" },
    { id: "request-body", kind: "request-authored-body" },
  ];
  const client = (position: string): Assertion[] => [
    pointer("status", "/status", 200),
    pointer("body-present", "/bodyPresent", true),
    present(headers[0]!, `/headers/${headers[0]}`),
    present(headers[1]!, `/headers/${headers[1]}`),
    pointer(headers[2]!, `/headers/${headers[2]}`, position),
  ];
  const receipt = (phase: "seed" | "noop" | "changed", prefix = ""): Assertion[] => {
    const changed = phase === "changed";
    const ids = phase === "seed" ? ["a", "b", "l"] : ["a", "l"];
    return [
      pointer("disposition", `${prefix}/status`, "completed"),
      pointer("detail", `${prefix}/detail`, "available"),
      pointer("required-position", `${prefix}/requiredPosition`, changed ? "pos-2" : "pos-1"),
      pointer("inline", `${prefix}/next`, null),
      phase === "noop"
        ? {
            id: "no-effect",
            kind: "json-pointer",
            pointer: `${prefix}/effectPosition`,
            exists: false,
          }
        : pointer("effect-position", `${prefix}/effectPosition`, changed ? "pos-2" : "pos-1"),
      tuple(
        "ordered-results",
        `${prefix}/results`,
        [
          "/operationIndex",
          "/outcome",
          "/resource/id",
          "/resource/type",
          "/resource/properties",
          "/resource/metadata",
        ],
        ids.map((id, index) => [
          index,
          phase === "seed" ? "created" : "updated",
          `${scope}${id === "l" ? "links" : "beads"}/${id}`,
          id === "l" ? relationship : task,
          { title: `${id}${changed ? "-changed" : ""}` },
          changed ? { tag: "changed" } : {},
        ]),
      ),
      ...(phase === "noop"
        ? [
            binding("bead-retained-record", `${prefix}/results/0/resource`, "n-a-before"),
            binding("link-retained-record", `${prefix}/results/1/resource`, "n-l-before"),
          ]
        : [
            pointer(
              "link-source",
              `${prefix}/results/${ids.length - 1}/resource/source`,
              `${scope}beads/a`,
            ),
            pointer(
              "link-target",
              `${prefix}/results/${ids.length - 1}/resource/target`,
              `${scope}beads/b`,
            ),
          ]),
    ];
  };
  const seedFacts = [
    [`${scope}events/`, "created", `${scope}beads/a`, task, 0],
    [`${scope}events/`, "created", `${scope}beads/b`, task, 1],
    [`${scope}events/`, "created", `${scope}links/l`, relationship, 2],
    [`${scope}events/`, "linked", `${scope}links/l`, relationship, 3],
    [`${scope}events/`, "linked", `${scope}links/l`, relationship, 4],
  ];
  const events = (path: string, changed = false): Assertion[] => [
    tuple(
      "ordered-facts",
      path,
      ["/source", "/type", "/subject", "/subjectType", "/ordinal"],
      changed
        ? [
            ...seedFacts,
            [`${scope}events/`, "updated", `${scope}beads/a`, task, 0],
            [`${scope}events/`, "updated", `${scope}links/l`, relationship, 1],
          ]
        : seedFacts,
    ),
    ...(["source", "target"] as const).map((endpoint, index) =>
      pointer(`incidence-${endpoint}`, `${path}/${index + 3}/data`, {
        endpoint,
        link: { id: `${scope}links/l`, type: relationship },
        source: `${scope}beads/a`,
        target: `${scope}beads/b`,
      }),
    ),
    ...(changed
      ? ["a", "l"].flatMap((id, index) => [
          binding(`${id}-transaction`, `${path}/${index + 5}/transaction`, "n-changed-transaction"),
          binding(`${id}-revision`, `${path}/${index + 5}/data/revision`, `n-${id}-after-revision`),
          binding(
            `${id}-previous`,
            `${path}/${index + 5}/data/previousRevision`,
            `n-${id}-before-revision`,
          ),
          pointer(`${id}-change`, `${path}/${index + 5}/data/change`, [
            { op: "replace", path: "/title", value: `${id}-changed` },
          ]),
          pointer(`${id}-metadata-change`, `${path}/${index + 5}/data/metadataChange`, [
            { op: "replace", path: "", value: { tag: "changed" } },
          ]),
        ])
      : []),
  ];
  const groups = (changed = false): Assertion[] => [
    ...raw("changefeedPage", changed ? "n-changed" : "n-seed"),
    pointer("observed-head", "/observedHeadPosition", changed ? "pos-2" : "pos-1"),
    tuple("group-inventory", "/groups", ["/position"], [["pos-1"]]),
    tuple(
      "group-envelope",
      "/groups",
      ["/previousPosition", "/projectionAdvance", "/eventCount", "/erasures"],
      [["pos-0", false, 5, []]],
    ),
    binding("group-transaction", "/groups/0/transaction", "n-seed-transaction"),
    tuple(
      "upsert-inventory",
      "/groups/0/changes",
      ["/operation", "/resourceKind", "/resource/id"],
      [
        ["upsert", "bead", `${scope}beads/a`],
        ["upsert", "bead", `${scope}beads/b`],
        ["upsert", "link", `${scope}links/l`],
      ],
    ),
    ...["a", "b", "l"].map((id, index) =>
      binding(`upsert-${id}`, `/groups/0/changes/${index}/resource`, `n-${id}-before`),
    ),
    ...events("/groups/0/events"),
    changed ? present("next-present", "/next") : pointer("no-next", "/next", null),
  ];
  const state = (changed: boolean, link = false): Assertion[] => [
    ...raw(link ? "currentLinkRecord" : "currentBeadCollection", changed ? "n-changed" : "n-seed"),
    ...(link
      ? [binding("complete-link", "", changed ? "n-l-after" : "n-l-before")]
      : [
          tuple(
            "ordered-identities",
            "/items",
            ["/id"],
            [[`${scope}beads/a`], [`${scope}beads/b`]],
          ),
          binding("complete-a", "/items/0", changed ? "n-a-after" : "n-a-before"),
          binding("complete-b", "/items/1", "n-b-before"),
          pointer("no-next", "/next", null),
        ]),
  ];
  const expected: Record<string, Assertion[]> = {
    "n-seed": [...raw("mutationReceipt", undefined), ...receipt("seed")],
    "n-seed-facts": [...client("pos-1"), ...receipt("seed", "/body")],
    "n-seed-groups": groups(),
    "n-noop": [...raw("mutationReceipt", "n-seed"), ...receipt("noop")],
    "n-noop-facts": [...client("pos-1"), ...receipt("noop", "/body")],
    "n-noop-beads": state(false),
    "n-noop-link": state(false, true),
    "n-noop-events": [
      ...raw("eventPage", "n-seed"),
      pointer("no-next", "/next", null),
      ...events("/events"),
    ],
    "n-noop-groups": groups(),
    "n-changed": [...raw("mutationReceipt", undefined, "pos-2"), ...receipt("changed")],
    "n-changed-facts": [...client("pos-2"), ...receipt("changed", "/body")],
    "n-changed-beads": state(true),
    "n-changed-link": state(true, true),
    "n-changed-events": [
      ...raw("eventPage", "n-changed"),
      pointer("no-next", "/next", null),
      ...events("/events", true),
    ],
    "n-changed-groups": groups(true),
  };
  const captures: Record<string, unknown[]> = {
    "n-seed": [capture("n-seed-receipt", "/id")],
    "n-noop": [capture("n-noop-receipt", "/id")],
    "n-changed": [capture("n-changed-receipt", "/id")],
    "n-seed-facts": [
      capture("n-seed-transaction", "/body/transaction"),
      capture("n-a-before", "/body/results/0/resource"),
      capture("n-a-before-revision", "/body/results/0/resource/revision"),
      capture("n-b-before", "/body/results/1/resource"),
      capture("n-l-before", "/body/results/2/resource"),
      capture("n-l-before-revision", "/body/results/2/resource/revision"),
    ],
    "n-changed-facts": [
      capture("n-changed-transaction", "/body/transaction"),
      capture("n-a-after", "/body/results/0/resource"),
      capture("n-a-after-revision", "/body/results/0/resource/revision"),
      capture("n-l-after", "/body/results/1/resource"),
      capture("n-l-after-revision", "/body/results/1/resource/revision"),
    ],
    // Presence alone permits null. Successful execution of this unused scoped
    // URL capture is required; it grants no receipt or continuation authority.
    "n-changed-groups": [capture("n-changed-next", "/next")],
  };
  const row = candidate.scenarios.find(
    (r: { id: string }) => r.id === "transactional.batch.no-op-entries",
  )!;
  expect(row.actions.map((a: { id: string }) => a.id)).toEqual(Object.keys(expected));
  for (const action of row.actions) {
    expect(action.assertions, `${action.id} complete no-op assertions`).toEqual(
      expected[action.id],
    );
    expect(action.captures, `${action.id} complete no-op captures`).toEqual(
      captures[action.id] ?? [],
    );
  }
  expect(row.actions.flatMap((a: { assertions: unknown[] }) => a.assertions)).toHaveLength(223);
  const update = (changed: boolean) =>
    ["a", "l"].map((id) => ({
      operation: id === "a" ? "updateBead" : "updateLink",
      [id === "a" ? "bead" : "link"]: id === "a" ? "beads/a" : "links/l",
      propertiesChange: [
        { op: "replace", path: "/title", value: `${id}${changed ? "-changed" : ""}` },
      ],
      metadataChange: [{ op: "replace", path: "", value: changed ? { tag: "changed" } : {} }],
    }));
  const seed = [
    ...["a", "b"].map((id) => ({
      operation: "createBead",
      id: `beads/${id}`,
      type: task,
      properties: { title: id },
      metadata: {},
    })),
    {
      operation: "createLink",
      id: "links/l",
      type: relationship,
      source: "beads/a",
      target: "beads/b",
      properties: { title: "l" },
      metadata: {},
    },
  ];
  const requests: Record<string, { operations: unknown[] }> = {
    "n-seed": { operations: seed },
    "n-noop": { operations: update(false) },
    "n-changed": { operations: update(true) },
  };
  const keys: Record<string, string> = {
    "n-seed": "noop-seed",
    "n-noop": "noop-equal",
    "n-changed": "noop-changed",
  };
  for (const action of row.actions) {
    if (action.family === "client") {
      expect(action.operation).toBe("transactional.receipt-read");
      expect(action.input).toEqual({
        binding: action.id.replace("-facts", "-receipt"),
        method: "GET",
      });
      continue;
    }
    expect(action.credentialRef).toBe("operator");
    if (requests[action.id]) {
      expect(action.method).toBe("POST");
      expect(action.target).toEqual({ binding: "batch" });
      expect(action.raw.headerLines).toEqual([
        { name: "content-type", value: "application/json" },
        { name: "idempotency-key", value: keys[action.id] },
      ]);
      expect(action.raw.body.encoding).toBe("utf8");
      expect(JSON.parse(action.raw.body.value)).toEqual(requests[action.id]);
      expect(Buffer.byteLength(action.raw.body.value)).toBeLessThanOrEqual(2048);
    } else {
      expect(action.method).toBe("GET");
      expect(action.raw).toEqual({ headerLines: [{ name: "accept", value: "application/json" }] });
      const suffix = action.id.split("-").at(-1);
      expect(action.target).toEqual(
        suffix === "groups"
          ? { binding: "scope", path: "changes/", query: { after: "genesis" } }
          : suffix === "beads"
            ? { binding: "scope", path: "beads/", query: { limit: "32" } }
            : { binding: "scope", path: suffix === "link" ? "links/l" : "events/" },
      );
    }
  }
}

it("pins the complete matching no-op partition and its exact selected clauses", () => {
  expect(
    selected.catalog.scenarios.find((r) => r.id === "transactional.batch.no-op-entries")!
      .requirements,
  ).toEqual([
    {
      source: "docs/specs/bdp.md",
      anchor: "#change-groups-and-replication",
      selectedText:
        "A failed or admitted no-effect mutation produces no group and no new position. Its receipt reports the current `requiredPosition` and omits `effectPosition`.",
    },
    {
      source: "docs/specs/bdp.md",
      anchor: "#mutation-receipt-responses",
      selectedText:
        "a transaction all of whose operations are no-ops is an admitted no-effect mutation: it completes, produces no group, and its receipt omits `effectPosition`.",
    },
  ]);
  assertMatchingNoopObservation(manifest);
});

it.each([
  ["n-noop", "bead-retained-record"],
  ["n-noop", "no-effect"],
  ["n-noop", "present-bdp-scope-position"],
  ["n-noop-groups", "group-inventory"],
] as const)("rejects independent no-op oracle weakening in %s:%s", (actionId, assertionId) => {
  const weakened = structuredClone(manifest);
  const row = weakened.scenarios.find(
    (r: { id: string }) => r.id === "transactional.batch.no-op-entries",
  )!;
  const action = row.actions.find((a: { id: string }) => a.id === actionId);
  if (assertionId === "group-inventory")
    action.assertions.find((a: { id: string }) => a.id === assertionId).equals = [["pos-2"]];
  else action.assertions = action.assertions.filter((a: { id: string }) => a.id !== assertionId);
  expect(() => assertMatchingNoopObservation(weakened)).toThrow(
    `${actionId} complete no-op assertions`,
  );
});

// Independent expected-content oracle for the accepted visible/unowned deletion
// partition. Expected literals are authored here, never read from the candidate.
function assertDeletionSafetyObservation(candidate: typeof manifest) {
  const scope = "https://reference.invalid/acme/";
  const headers = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"];
  const resource = (id: string) => `${scope}${id === "a" || id === "b" ? "beads" : "links"}/${id}`;
  const type = (id: string) =>
    `${scope}types/${id === "a" || id === "b" ? "task" : "relationship"}`;
  type Assertion = Record<string, unknown>;
  const value = (id: string, pointer: string, equals: unknown): Assertion => ({
    id,
    kind: "json-pointer",
    pointer,
    exists: true,
    equals,
  });
  const binding = (id: string, pointer: string, equalsBinding: string): Assertion => ({
    id,
    kind: "json-pointer",
    pointer,
    exists: true,
    equalsBinding,
  });
  const absent = (id: string, pointer: string): Assertion => ({
    id,
    kind: "json-pointer",
    pointer,
    exists: false,
  });
  const present = (id: string, pointer: string): Assertion => ({
    id,
    kind: "json-pointer",
    pointer,
    exists: true,
  });
  const tuples = (
    id: string,
    pointer: string,
    projections: string[],
    equals: unknown[][],
  ): Assertion => ({
    id,
    kind: "json-array-tuples",
    pointer,
    ordered: true,
    projections: projections.map((pointer) => ({ pointer })),
    equals,
  });
  const capture = (binding: string, pointer: string) => ({
    binding,
    from: { kind: "json-pointer", pointer },
  });
  const raw = (
    schema: string,
    baseline: string | undefined = "d-seed",
    position = "pos-1",
    status = 200,
  ): Assertion[] => [
    { id: "http-status", kind: "status", equals: status },
    ...headers.map((name) => ({ id: `present-${name}`, kind: "header", name, absent: false })),
    { id: "schema", kind: "json-schema", schema: `#/$defs/${schema}` },
    baseline
      ? { id: "serving-context", kind: "response-metadata-equals", request: baseline, headers }
      : { id: "position", kind: "header", name: headers[2], equals: position },
    { id: "request-headers", kind: "request-authored-headers" },
    { id: "request-body", kind: "request-authored-body" },
  ];
  const client = (position: string): Assertion[] => [
    value("status", "/status", 200),
    value("body-present", "/bodyPresent", true),
    present(headers[0]!, `/headers/${headers[0]}`),
    present(headers[1]!, `/headers/${headers[1]}`),
    value(headers[2]!, `/headers/${headers[2]}`, position),
  ];
  const receipt = (seed: boolean, prefix = ""): Assertion[] => [
    value("disposition", `${prefix}/status`, "completed"),
    value("detail", `${prefix}/detail`, "available"),
    value("required-position", `${prefix}/requiredPosition`, seed ? "pos-1" : "pos-2"),
    value("effect-position", `${prefix}/effectPosition`, seed ? "pos-1" : "pos-2"),
    value("inline", `${prefix}/next`, null),
    ...(seed
      ? [
          tuples(
            "ordered-results",
            `${prefix}/results`,
            [
              "/operationIndex",
              "/outcome",
              "/resource/id",
              "/resource/type",
              "/resource/properties",
              "/resource/metadata",
            ],
            ["a", "b", "l", "r"].map((id, index) => [
              index,
              "created",
              resource(id),
              type(id),
              { title: id },
              {},
            ]),
          ),
          value("l-source", `${prefix}/results/2/resource/source`, resource("a")),
          value("l-target", `${prefix}/results/2/resource/target`, resource("b")),
          value("r-source", `${prefix}/results/3/resource/source`, resource("b")),
          value("r-target", `${prefix}/results/3/resource/target`, resource("a")),
        ]
      : [
          tuples(
            "ordered-results",
            `${prefix}/results`,
            [
              "/operationIndex",
              "/outcome",
              "/deleted/resourceKind",
              "/deleted/resource/id",
              "/deleted/resource/type",
            ],
            ["l", "r", "a"].map((id, index) => [
              index,
              "deleted",
              id === "a" ? "bead" : "link",
              resource(id),
              type(id),
            ]),
          ),
          ...["l", "r", "a"].map((id, index) =>
            binding(
              `${id}-revision`,
              `${prefix}/results/${index}/deleted/resource/revision`,
              `d-${id}-revision`,
            ),
          ),
        ]),
  ];
  const seedFacts: [string, string, number][] = [
    ["created", "a", 0],
    ["created", "b", 1],
    ["created", "l", 2],
    ["linked", "l", 3],
    ["linked", "l", 4],
    ["created", "r", 5],
    ["linked", "r", 6],
    ["linked", "r", 7],
  ];
  const deletedFacts: [string, string, number][] = [
    ["deleted", "l", 0],
    ["unlinked", "l", 1],
    ["unlinked", "l", 2],
    ["deleted", "r", 3],
    ["unlinked", "r", 4],
    ["unlinked", "r", 5],
    ["deleted", "a", 6],
  ];
  const incidence = (id: string, endpoint: string) => ({
    endpoint,
    link: { id: resource(id), type: type(id) },
    source: resource(id === "l" ? "a" : "b"),
    target: resource(id === "l" ? "b" : "a"),
  });
  const events = (path: string, final = false): Assertion[] => [
    tuples(
      "ordered-facts",
      path,
      ["/source", "/type", "/subject", "/subjectType", "/ordinal"],
      [...seedFacts, ...(final ? deletedFacts : [])].map(([verb, id, ordinal]) => [
        `${scope}events/`,
        verb,
        resource(id),
        type(id),
        ordinal,
      ]),
    ),
    ...["l", "r"].flatMap((id, index) =>
      ["source", "target"].map((endpoint, offset) =>
        value(
          `${id}-incidence-${endpoint}`,
          `${path}/${3 + index * 3 + offset}/data`,
          incidence(id, endpoint),
        ),
      ),
    ),
    ...(final
      ? [
          ...["l", "r", "a"].map((id, index) =>
            binding(
              `${id}-delete-revision`,
              `${path}/${8 + index * 3}/data/revision`,
              `d-${id}-revision`,
            ),
          ),
          ...Array.from({ length: 7 }, (_, i) =>
            binding(
              `delete-transaction-${i}`,
              `${path}/${8 + i}/transaction`,
              "d-delete-transaction",
            ),
          ),
          ...["l", "r"].flatMap((id, index) =>
            ["source", "target"].map((endpoint, offset) =>
              value(
                `${id}-unlink-${endpoint}`,
                `${path}/${9 + index * 3 + offset}/data`,
                incidence(id, endpoint),
              ),
            ),
          ),
        ]
      : []),
  ];
  const eventPage = (final = false) => [
    ...raw("eventPage", final ? "d-delete" : "d-seed"),
    value("no-next", "/next", null),
    ...events("/events", final),
  ];
  const groups = (final = false) => [
    ...raw("changefeedPage", final ? "d-delete" : "d-seed"),
    value("observed-head", "/observedHeadPosition", final ? "pos-2" : "pos-1"),
    tuples("group-inventory", "/groups", ["/position"], [["pos-1"]]),
    tuples(
      "group-envelope",
      "/groups",
      ["/previousPosition", "/projectionAdvance", "/eventCount", "/erasures"],
      [["pos-0", false, 8, []]],
    ),
    binding("group-transaction", "/groups/0/transaction", "d-seed-transaction"),
    tuples(
      "upsert-inventory",
      "/groups/0/changes",
      ["/operation", "/resourceKind", "/resource/id"],
      ["a", "b", "l", "r"].map((id) => [
        "upsert",
        id === "a" || id === "b" ? "bead" : "link",
        resource(id),
      ]),
    ),
    ...["a", "b", "l", "r"].map((id, i) =>
      binding(`upsert-${id}`, `/groups/0/changes/${i}/resource`, `d-${id}-before`),
    ),
    ...events("/groups/0/events"),
    final ? present("next-present", "/next") : value("no-next", "/next", null),
  ];
  const state = (links = false, final = false) => {
    const ids = final ? (links ? [] : ["b"]) : links ? ["l", "r"] : ["a", "b"];
    return [
      ...raw(
        links ? "currentLinkCollection" : "currentBeadCollection",
        final ? "d-delete" : "d-seed",
      ),
      tuples(
        "ordered-identities",
        "/items",
        ["/id", "/type", "/properties", "/metadata"],
        ids.map((id) => [resource(id), type(id), { title: id }, {}]),
      ),
      ...ids.map((id, i) => binding(`complete-${id}`, `/items/${i}`, `d-${id}-before`)),
      value("no-next", "/next", null),
    ];
  };
  const failed = () => [
    ...raw("mutationReceipt"),
    value("disposition", "/status", "failed"),
    value("detail", "/detail", "available"),
    value("required-position", "/requiredPosition", "pos-1"),
    absent("no-effect", "/effectPosition"),
    absent("no-results", "/results"),
    absent("no-next", "/next"),
    value("problem", "/problem", {
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      status: 409,
      code: "incident-links-exist",
      retry: "after-state-change",
      operationIndex: 2,
    }),
  ];
  const expected: Record<string, Assertion[]> = {
    "d-seed": [...raw("mutationReceipt", "", "pos-1"), ...receipt(true)],
    "d-seed-facts": [...client("pos-1"), ...receipt(true, "/body")],
    "d-seed-events": eventPage(),
    "d-seed-groups": groups(),
    "d-incoming-survives": failed(),
    "d-incoming-survives-beads": state(),
    "d-incoming-survives-links": state(true),
    "d-incoming-survives-events": eventPage(),
    "d-incoming-survives-groups": groups(),
    "d-outgoing-survives": failed(),
    "d-outgoing-survives-beads": state(),
    "d-outgoing-survives-links": state(true),
    "d-outgoing-survives-events": eventPage(),
    "d-outgoing-survives-groups": groups(),
    "d-delete": [...raw("mutationReceipt", "", "pos-2"), ...receipt(false)],
    "d-delete-facts": [...client("pos-2"), ...receipt(false, "/body")],
    "d-final-beads": state(false, true),
    "d-final-links": state(true, true),
    "d-deleted-a": raw("readProblem", "", "pos-2", 404),
    "d-final-events": eventPage(true),
    "d-final-groups": groups(true),
  };
  const captures: Record<string, unknown[]> = {
    "d-seed": [capture("d-seed-receipt", "/id")],
    "d-seed-facts": [
      capture("d-seed-transaction", "/body/transaction"),
      ...["a", "b", "l", "r"].flatMap((id, i) => [
        capture(`d-${id}-before`, `/body/results/${i}/resource`),
        capture(`d-${id}-revision`, `/body/results/${i}/resource/revision`),
      ]),
    ],
    "d-delete": [capture("d-delete-receipt", "/id")],
    "d-delete-facts": [capture("d-delete-transaction", "/body/transaction")],
    "d-final-groups": [capture("d-final-next", "/next")],
  };
  const deleteOp = (id: string) =>
    id === "a"
      ? { operation: "deleteBead", bead: "beads/a" }
      : { operation: "deleteLink", link: `links/${id}` };
  const prefix = (direction: string) => ({
    operation: "updateBead",
    bead: "beads/b",
    propertiesChange: [{ op: "replace", path: "/title", value: `${direction}-survives-prefix` }],
    metadataChange: [{ op: "replace", path: "", value: { phase: `${direction}-survives-prefix` } }],
  });
  const bodies: Record<string, unknown> = {
    "d-seed": {
      operations: [
        ...["a", "b"].map((id) => ({
          operation: "createBead",
          id: `beads/${id}`,
          type: type(id),
          properties: { title: id },
          metadata: {},
        })),
        ...["l", "r"].map((id) => ({
          operation: "createLink",
          id: `links/${id}`,
          type: type(id),
          source: id === "l" ? "beads/a" : "beads/b",
          target: id === "l" ? "beads/b" : "beads/a",
          properties: { title: id },
          metadata: {},
        })),
      ],
    },
    "d-incoming-survives": {
      operations: [prefix("incoming"), deleteOp("l"), deleteOp("a"), deleteOp("r")],
    },
    "d-outgoing-survives": {
      operations: [prefix("outgoing"), deleteOp("r"), deleteOp("a"), deleteOp("l")],
    },
    "d-delete": { operations: [deleteOp("l"), deleteOp("r"), deleteOp("a")] },
  };
  const row = candidate.scenarios.find(
    (r: { id: string }) => r.id === "transactional.batch.deletion-safety",
  )!;
  expect({ ...row, actions: undefined }).toEqual({
    id: "transactional.batch.deletion-safety",
    requiredProfile: "transactional",
    setup: {
      fixture: "reference-transactional-v1",
      requires: ["installed-transactional-http", "transactional-receipt-observation"],
    },
    applicability: { requires: [] },
    cleanup: { resetFixture: true },
    actions: undefined,
  });
  expect(row.actions.map((a: { id: string }) => a.id)).toEqual(Object.keys(expected));
  for (const action of row.actions) {
    expect(action.assertions, `${action.id} complete deletion assertions`).toEqual(
      expected[action.id],
    );
    expect(action.captures, `${action.id} complete deletion captures`).toEqual(
      captures[action.id] ?? [],
    );
    if (action.family === "client") {
      expect(action.operation).toBe("transactional.receipt-read");
      expect(action.input).toEqual({
        binding: action.id.replace("-facts", "-receipt"),
        method: "GET",
      });
    } else {
      expect(action.credentialRef).toBe("operator");
      if (bodies[action.id]) {
        expect(action.method).toBe("POST");
        expect(action.target).toEqual({ binding: "batch" });
        expect(action.raw.headerLines).toEqual([
          { name: "content-type", value: "application/json" },
          { name: "idempotency-key", value: action.id },
        ]);
        expect(action.raw.body.encoding).toBe("utf8");
        expect(JSON.parse(action.raw.body.value)).toEqual(bodies[action.id]);
        expect(Buffer.byteLength(action.raw.body.value)).toBeLessThanOrEqual(2048);
      } else {
        expect(action.method).toBe("GET");
        expect(action.raw).toEqual({
          headerLines: [{ name: "accept", value: "application/json" }],
        });
        const suffix = action.id.split("-").at(-1);
        expect(action.target).toEqual(
          suffix === "groups"
            ? { binding: "scope", path: "changes/", query: { after: "genesis" } }
            : suffix === "beads" || suffix === "links"
              ? { binding: "scope", path: `${suffix}/`, query: { limit: "32" } }
              : { binding: "scope", path: action.id === "d-deleted-a" ? "beads/a" : "events/" },
        );
      }
    }
  }
  expect(row.actions.flatMap((a: { assertions: unknown[] }) => a.assertions)).toHaveLength(333);
}

it("pins complete operation-time deletion safety and its exact selected clause", () => {
  expect(
    selected.catalog.scenarios.find((r) => r.id === "transactional.batch.deletion-safety")!
      .requirements,
  ).toEqual([
    {
      source: "docs/specs/bdp.md",
      anchor: "#explicit-bead-operations",
      selectedText:
        "`DeleteBead` fails if any live Link is incident upon (attached to) the Bead when the operation is reached.",
    },
  ]);
  assertDeletionSafetyObservation(manifest);
});
it.each(["unchanged-link", "problem-index", "rollback-metadata"] as const)(
  "rejects deletion-safety oracle weakening: %s",
  (control) => {
    const weakened = structuredClone(manifest);
    const row = weakened.scenarios.find(
      (r: { id: string }) => r.id === "transactional.batch.deletion-safety",
    )!;
    const actionId =
      control === "unchanged-link"
        ? "d-incoming-survives-links"
        : control === "problem-index"
          ? "d-incoming-survives"
          : "d-incoming-survives-beads";
    const action = row.actions.find((a: { id: string }) => a.id === actionId)!;
    if (control === "unchanged-link")
      action.assertions = action.assertions.filter((a: { id: string }) => a.id !== "complete-l");
    else if (control === "problem-index")
      action.assertions.find((a: { id: string }) => a.id === "problem").equals.operationIndex = 1;
    else
      action.assertions.find((a: { id: string }) => a.id === "ordered-identities").equals[1][3] = {
        phase: "incoming-survives-prefix",
      };
    expect(() => assertDeletionSafetyObservation(weakened)).toThrow(
      `${actionId} complete deletion assertions`,
    );
  },
);

// Resolve every authored reference without starting an installed service.
function resolveAuthoredTransactionalSchemas(candidate: typeof manifest) {
  const validator = createJsonSchemaValidator(schema);
  for (const row of candidate.scenarios)
    for (const action of row.actions)
      for (const assertion of action.assertions)
        if (assertion.kind === "json-schema") validator.resolve(assertion.schema);
}
it("resolves every authored TX schema and rejects the undefined deleted-point reference", () => {
  resolveAuthoredTransactionalSchemas(manifest);
  const previous = structuredClone(manifest);
  const row = previous.scenarios.find(
    (r: { id: string }) => r.id === "transactional.batch.deletion-safety",
  )!;
  row.actions
    .find((a: { id: string }) => a.id === "d-deleted-a")!
    .assertions.find((a: { id: string }) => a.id === "schema")!.schema = "#/$defs/problem";
  expect(() => resolveAuthoredTransactionalSchemas(previous)).toThrow(
    "unknown schema reference '#/$defs/problem'",
  );
});

/** Independent literal request/capture/presentation guard; the final hash also
 * pins every authored assertion, so a weaker substitute cannot satisfy it. */
function assertCrossCarrierObservation(candidate: typeof manifest) {
  const row = candidate.scenarios.find(
    (r: { id: string }) => r.id === "transactional.idempotency.cross-carrier",
  );
  expect(row).toBeDefined();
  expect(row.actions.map((a: { id: string }) => a.id)).toEqual([
    "x-create",
    "x-created-facts",
    "x-create-batch",
    "x-create-sequence",
    "x-update",
    "x-updated-facts",
    "x-two-sequence",
    "x-update-singleton",
    "x-create-singleton-retry",
    "x-create-batch-retry",
    "x-current",
    "x-events",
  ]);
  const assertion = (index: number, id: string) =>
    row.actions[index].assertions.find((a: { id: string }) => a.id === id);
  expect(assertion(2, "retained-body"), "retained-body").toEqual({
    id: "retained-body",
    kind: "json-pointer",
    pointer: "",
    exists: true,
    equalsBinding: "x-created-body",
  });
  expect(assertion(6, "present-name"), "presentation").toEqual({
    id: "present-name",
    kind: "json-pointer",
    pointer: "/results/0/operationName",
    exists: true,
    equals: "again",
  });
  expect(assertion(6, "presentation"), "presentation").toEqual({
    id: "presentation",
    kind: "json-array-tuples",
    pointer: "/results",
    ordered: true,
    projections: [{ pointer: "/operationIndex" }, { pointer: "/outcome" }],
    equals: [
      [0, "created"],
      [1, "updated"],
    ],
  });
  expect(assertion(6, "created-record"), "old-record").toEqual({
    id: "created-record",
    kind: "json-pointer",
    pointer: "/results/0/resource",
    exists: true,
    equalsBinding: "x-created-record",
  });
  const create = {
    id: "beads/a",
    type: "https://reference.invalid/acme/types/task",
    properties: { title: "carrier-original" },
  };
  const update = {
    bead: "beads/a",
    propertiesChange: [{ op: "replace", path: "/title", value: "carrier-current" }],
  };
  const bodies = [
    create,
    undefined,
    { operations: [{ operation: "createBead", ...create }] },
    {
      operations: [
        { operation: "createBead", ...create, idempotencyKey: "carrier-create", name: "first" },
      ],
    },
    { operations: [{ operation: "updateBead", ...update }] },
    undefined,
    {
      operations: [
        { operation: "createBead", ...create, idempotencyKey: "carrier-create", name: "again" },
        { operation: "updateBead", ...update, idempotencyKey: "carrier-update" },
      ],
    },
    update,
    create,
    { operations: [{ operation: "createBead", ...create }] },
    undefined,
    undefined,
  ];
  for (const [index, action] of row.actions.entries()) {
    const body = bodies[index];
    if (action.family === "http") {
      expect(action.raw.body?.value, action.id).toBe(
        body === undefined ? undefined : JSON.stringify(body),
      );
      for (const id of [
        "http-status",
        "schema",
        "media",
        "present-bdp-scope-epoch",
        "present-bdp-authorization-view",
        "present-bdp-scope-position",
        "serving-position",
        "request-headers",
        "request-body",
      ])
        expect(assertion(index, id), `${action.id}:${id}`).toBeDefined();
      expect(assertion(index, "serving-position").equals).toBe(index < 4 ? "pos-1" : "pos-2");
    }
  }
  for (const [index, stem] of [
    [0, "x-created"],
    [4, "x-updated"],
  ] as const)
    expect(row.actions[index].captures).toEqual([
      { binding: `${stem}-root`, from: { kind: "json-pointer", pointer: "/id" } },
    ]);
  for (const [index, stem] of [
    [1, "x-created"],
    [5, "x-updated"],
  ] as const) {
    expect(row.actions[index].input).toEqual({ binding: `${stem}-root`, method: "GET" });
    expect(row.actions[index].captures).toEqual(
      [
        ["body", "/body"],
        ["record", "/body/results/0/resource"],
        ["revision", "/body/results/0/resource/revision"],
        ["transaction", "/body/transaction"],
      ].map(([suffix, pointer]) => ({
        binding: `${stem}-${suffix}`,
        from: { kind: "json-pointer", pointer },
      })),
    );
  }
  expect(row.actions.flatMap((a: { assertions: unknown[] }) => a.assertions)).toHaveLength(230);
  expect(
    createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    "complete cross-carrier authored row",
  ).toBe("9edceed3f23528cff25103143dc27aeac69be409420f0ed54c5a4f992c89ba73");
}

const minimumId = "read-update.http.command-minimum-fields";
function withoutMinimumRow(text: string, name: "manifest" | "coverage") {
  const raw = objectSlices(text, name === "manifest" ? "scenarios" : "rows").get(minimumId);
  expect(raw).toBeDefined();
  const reconstructed = text.replace(`    ${raw},\n`, "");
  expect(reconstructed).not.toBe(text);
  return reconstructed;
}
/** Independent literal HTTP, schema, capture and finite-state contract. Replay
 * full JSON and Resource/revision comparisons are explicitly app supplements;
 * private receipt GET equality is enforced by the existing observed authority. */
function assertMinimumObservation(candidate: typeof manifest) {
  const row = candidate.scenarios.find((r: { id: string }) => r.id === minimumId);
  expect(row).toBeDefined();
  expect(row.requiredProfile).toBe("read-update");
  expect(row.setup).toEqual({
    fixture: "reference-transactional-v1",
    requires: ["installed-transactional-http", "transactional-receipt-observation"],
  });
  expect(row.actions.map((a: { id: string }) => a.id)).toEqual([
    "m-create-a",
    "m-replay-a",
    "m-create-b",
    "m-replay-b",
    "m-create-c",
    "m-replay-c",
    "m-body-conflict",
    "m-stale-update",
    "m-retained-a",
    "m-current",
    "m-events",
  ]);
  const scope = "https://reference.invalid/acme/";
  const create = (id: string) => ({
    id: `beads/${id}`,
    type: `${scope}types/task`,
    properties: { title: `minimum-${id}` },
  });
  const batch = { operations: [{ operation: "createBead", ...create("b") }] };
  const sequence = {
    operations: [{ operation: "createBead", ...create("c"), idempotencyKey: "minimum-c" }],
  };
  const bodies = [
    create("a"),
    create("a"),
    batch,
    batch,
    sequence,
    sequence,
    {
      operations: [
        { operation: "createBead", ...create("b"), properties: { title: "minimum-conflict" } },
      ],
    },
    {
      bead: "beads/a",
      expectedRevision: "minimum-wrong-revision",
      propertiesChange: [{ op: "replace", path: "/title", value: "minimum-stale" }],
    },
    undefined,
    undefined,
    undefined,
  ];
  const fields = ["bdp-minimum-scope-position", "bdp-scope-epoch", "bdp-authorization-view"];
  const M = fields.map((name, i) => ({
    name,
    value: ["not a position!", "", "view-one, view-two"][i],
  }));
  const F = fields.map((name, i) => ({
    name,
    value: ["pos-99", "foreign-epoch", "foreign-view"][i],
  }));
  const Z = fields.map((name) => ({ name, value: "" }));
  const copied = [
    M,
    [],
    [{ name: "bdp-scope-epoch", value: "foreign-epoch" }],
    Z,
    F,
    M,
    F,
    M,
    [],
    [],
    [],
  ];
  const keys = [
    "minimum-a",
    "minimum-a",
    "minimum-b",
    "minimum-b",
    undefined,
    undefined,
    "minimum-b",
    "minimum-stale",
    undefined,
    undefined,
    undefined,
  ];
  const paths = [
    "operations/create-bead",
    "operations/create-bead",
    "operations/batch",
    "operations/batch",
    "operations/sequence",
    "operations/sequence",
    "operations/batch",
    "operations/update-bead",
    undefined,
    "beads/",
    "events/",
  ];
  const positions = [1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3];
  const schemas = [
    "mutationReceipt",
    "mutationReceipt",
    "mutationReceipt",
    "mutationReceipt",
    "transactionalSequenceResponse",
    "transactionalSequenceResponse",
    "transactionalProblem",
    "mutationReceipt",
    undefined,
    "currentBeadCollection",
    "eventPage",
  ];
  for (const [index, action] of row.actions.entries()) {
    expect(action.captures, action.id).toEqual(
      index === 0
        ? [{ binding: "minimum-a-root", from: { kind: "json-pointer", pointer: "/id" } }]
        : [],
    );
    const assertion = (id: string) => action.assertions.find((a: { id: string }) => a.id === id);
    if (index === 8) {
      expect(action).toMatchObject({
        family: "client",
        operation: "transactional.receipt-read",
        input: { binding: "minimum-a-root", method: "GET" },
      });
      expect(assertion("root")).toEqual({
        id: "root",
        kind: "json-pointer",
        pointer: "/body/id",
        exists: true,
        equalsBinding: "minimum-a-root",
      });
      for (const [id, pointer, value] of [
        ["key", "/body/idempotencyKey", "minimum-a"],
        ["required-position", "/body/requiredPosition", "pos-1"],
        ["effect-position", "/body/effectPosition", "pos-1"],
        ["serving-position", "/headers/bdp-scope-position", "pos-3"],
      ])
        expect(assertion(id!)).toEqual({
          id,
          kind: "json-pointer",
          pointer,
          exists: true,
          equals: value,
        });
      continue;
    }
    expect(action.family).toBe("http");
    expect(action.method).toBe(index < 8 ? "POST" : "GET");
    expect(action.target).toEqual({
      binding: "scope",
      path: paths[index],
      ...(index === 9 ? { query: { limit: "32" } } : {}),
    });
    expect(action.credentialRef).toBe("operator");
    expect(action.raw.body).toEqual(
      bodies[index] === undefined
        ? undefined
        : { encoding: "utf8", value: JSON.stringify(bodies[index]) },
    );
    const headers = [
      ...(index < 8 ? [{ name: "content-type", value: "application/json" }] : []),
      ...(keys[index] ? [{ name: "idempotency-key", value: keys[index] }] : []),
      ...(index < 8 ? [{ name: "accept", value: "application/json" }] : []),
      ...copied[index]!,
    ];
    if (index >= 9)
      expect(
        action.raw.headerLines.filter((h: { name: string }) =>
          fields.includes(h.name.toLowerCase()),
        ),
        "minimum-read-header-absence",
      ).toEqual([]);
    expect(action.raw.headerLines, "minimum-empty-header-ledger").toEqual(headers);
    expect(assertion("http-status")).toEqual({
      id: "http-status",
      kind: "status",
      equals: index === 6 ? 409 : 200,
    });
    expect(assertion("schema")).toEqual({
      id: "schema",
      kind: "json-schema",
      schema: `#/$defs/${schemas[index]}`,
    });
    expect(assertion("serving-position")).toEqual({
      id: "serving-position",
      kind: "header",
      name: "bdp-scope-position",
      equals: `pos-${positions[index]}`,
    });
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(assertion(`present-${name}`)).toEqual({
        id: `present-${name}`,
        kind: "header",
        name,
        absent: false,
      });
    expect(assertion("request-headers")).toEqual({
      id: "request-headers",
      kind: "request-authored-headers",
    });
    expect(assertion("request-body")).toEqual({
      id: "request-body",
      kind: "request-authored-body",
    });
  }
  const fact = (index: number, id: string) =>
    row.actions[index].assertions.find((a: { id: string }) => a.id === id);
  const problem = {
    type: "https://github.com/gastownhall/bdp/problems/conflict",
    code: "idempotency-conflict",
    status: 409,
    retry: "never",
  };
  expect(fact(6, "whole-problem")).toEqual({
    id: "whole-problem",
    kind: "json-pointer",
    pointer: "",
    exists: true,
    equals: problem,
  });
  expect(fact(7, "whole-problem")).toEqual({
    id: "whole-problem",
    kind: "json-pointer",
    pointer: "/problem",
    exists: true,
    equals: {
      ...problem,
      code: "revision-mismatch",
      retry: "after-state-change",
      operationIndex: 0,
    },
  });
  for (const [index, key, position] of [
    [0, "a", 1],
    [1, "a", 1],
    [2, "b", 2],
    [3, "b", 2],
  ] as const) {
    for (const [id, pointer, value] of [
      ["disposition", "/status", "completed"],
      ["detail", "/detail", "available"],
      ["key", "/idempotencyKey", `minimum-${key}`],
      ["required-position", "/requiredPosition", `pos-${position}`],
      ["effect-position", "/effectPosition", `pos-${position}`],
    ] as const)
      expect(fact(index, id)).toEqual({
        id,
        kind: "json-pointer",
        pointer,
        exists: true,
        equals: value,
      });
  }
  expect(fact(7, "no-effect")).toEqual({
    id: "no-effect",
    kind: "json-pointer",
    pointer: "/effectPosition",
    exists: false,
  });
  expect(fact(9, "ordered-state")).toEqual({
    id: "ordered-state",
    kind: "json-array-tuples",
    pointer: "/items",
    ordered: true,
    projections: ["/id", "/type", "/properties", "/metadata"].map((pointer) => ({ pointer })),
    equals: ["a", "b", "c"].map((k) => [
      `${scope}beads/${k}`,
      `${scope}types/task`,
      { title: `minimum-${k}` },
      {},
    ]),
  });
  expect(fact(10, "ordered-facts")).toEqual({
    id: "ordered-facts",
    kind: "json-array-tuples",
    pointer: "/events",
    ordered: true,
    projections: ["/source", "/type", "/subject", "/subjectType", "/ordinal"].map((pointer) => ({
      pointer,
    })),
    equals: ["a", "b", "c"].map((k) => [
      `${scope}events/`,
      "created",
      `${scope}beads/${k}`,
      `${scope}types/task`,
      0,
    ]),
  });
  for (const index of [9, 10])
    expect(fact(index, "no-next")).toEqual({
      id: "no-next",
      kind: "json-pointer",
      pointer: "/next",
      exists: true,
      equals: null,
    });
  expect(row.actions.flatMap((a: { assertions: unknown[] }) => a.assertions)).toHaveLength(192);
  expect(
    createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    "complete minimum manifest facts",
  ).toBe("4344f3701bc99031485bc4f7e327f738bc138084ff10e43c1623cdfa57d068b6");
}
it("pins the inherited command-minimum manifest facts, read-header absence and all thirteen prior objects", () => {
  assertMinimumObservation(manifest);
  expect(
    selectApplicableScenariosForProfile(selected.catalog, "transactional").map((r) => r.id),
  ).toContain(minimumId);
  expect(bundle().manifest.scenarios.find((row) => row.id === minimumId)?.id).toBe(minimumId);
  for (const name of ["manifest", "coverage"] as const) {
    const original = withoutMinimumRow(
      withoutSequenceMemberRow(withoutPrincipalRow(read(name).toString(), name), name),
      name,
    );
    expect(createHash("sha256").update(original).digest("hex")).toBe(
      name === "manifest"
        ? "726fc623bbb115a0f39e0bb3aaa586ea37254522b254e55e555ea95587f14cb9"
        : "a3a15b5143c118b24965698ec10289821664c90e935820b51c8cf76c05bdb1df",
    );
    const before = objectSlices(original, name === "manifest" ? "scenarios" : "rows"),
      after = objectSlices(read(name).toString(), name === "manifest" ? "scenarios" : "rows");
    expect(before.size).toBe(13);
    for (const [id, raw] of before) expect(after.get(id), id).toBe(raw);
  }
  const empty = structuredClone(manifest);
  empty.scenarios.find((r: { id: string }) => r.id === minimumId)!.actions[0].raw.headerLines =
    empty.scenarios
      .find((r: { id: string }) => r.id === minimumId)!
      .actions[0].raw.headerLines.filter((h: { name: string }) => h.name !== "bdp-scope-epoch");
  expect(() => assertMinimumObservation(empty)).toThrow("minimum-empty-header-ledger");
  for (const index of [9, 10]) {
    const changed = structuredClone(manifest);
    changed.scenarios
      .find((r: { id: string }) => r.id === minimumId)!
      .actions[index].raw.headerLines.push({
        name: "bdp-minimum-scope-position",
        value: "pos-99",
      });
    expect(() => assertMinimumObservation(changed)).toThrow("minimum-read-header-absence");
  }
  // Full replay-pair ledger weakening is checked in an existing app static
  // callback; arbitrary JSON raw captures are intentionally not manufactured.
});

const principalId = "read-update.idempotency.principal-isolation";
const principalParentPins = {
  manifest: [
    [
      "read-update.http.command-minimum-fields",
      "f04c001617ccad14ef67a82586ea5f61ec918bc2545bb041fafc21dee07b5d7e",
      54412,
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
      "transactional.batch.deletion-safety",
      "3e66e7c95aec963cc80e076249a5870b952765b2e98c1023ea148f8f628e6aeb",
      131808,
    ],
    [
      "transactional.batch.no-op-entries",
      "9307b230eb053131e9127cbbb5e6285305b79d6794edd22f5432a07fc74d9faa",
      81047,
    ],
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
      "transactional.receipt.readable",
      "ddb97e450e233b941f7d905d49f48648d9965ed1b361dcdc5dee6f810038a1e0",
      12545,
    ],
    [
      "transactional.receipt.pagination",
      "c531c260349347cdc3e54ba68282f1a266a5fa207d3775660615f836a4768782",
      138750,
    ],
    [
      "transactional.idempotency.conflict",
      "ba93aea884ae462533d02695642f03a2ca854f5adabeb41867254216dabb2106",
      29772,
    ],
    [
      "transactional.idempotency.cross-carrier",
      "4ad8c05fe5fbb4682809d4481c93e2684fe30fbbb8962b4da498590637f8f35b",
      64106,
    ],
    [
      "transactional.idempotency.failed-retained",
      "a867694406dde07da71ac70197c60c478dd0fb3344cf2c8160795d1aa62d3378",
      18404,
    ],
    [
      "transactional.sequence.member-transactions",
      "c46b34914118dd34ea1e5f12304124550b9d3c4bfcd9671b99995d6af44a2e1b",
      51379,
    ],
  ],
  coverage: [
    [
      "read-update.http.command-minimum-fields",
      "47914ed67c7b06e721e74134e0c633f3e1a7d461cb50ea200ff1874686885c2a",
      8888,
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
      "transactional.batch.deletion-safety",
      "ac27a329a1cc013e6a0e24e0f5cad6b5b4af6c128ad65302d030422a3c7e3c0a",
      17375,
    ],
    [
      "transactional.batch.no-op-entries",
      "383de4e0cb9b3bad310b9db7ff9009cb59fac55966f0309bc71c5d007bea6c1c",
      10587,
    ],
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
      "transactional.receipt.readable",
      "684eba200912ccb0932c0a8286e350a6e545262a205b3ea3df47a12fc6dd18ec",
      2142,
    ],
    [
      "transactional.receipt.pagination",
      "0735edbca2fbf384f9f8147140a353dc084d9ad85facaddf2f5073f56a7256ee",
      13057,
    ],
    [
      "transactional.idempotency.conflict",
      "de9b758f8ac4df7db5597b1eb2b402a116720becc30a41e7198f78f244358ec0",
      5188,
    ],
    [
      "transactional.idempotency.cross-carrier",
      "c5e6076a2104c06f88fac88c77214522cab457faf925fe03881dff9778c35245",
      11196,
    ],
    [
      "transactional.idempotency.failed-retained",
      "63918cbb495a504fd2043f52b60e7cd8ef1518b8022a96edb0d02660c7df1a8e",
      2917,
    ],
    [
      "transactional.sequence.member-transactions",
      "aea606d1456549f6dd9dc1903e42568282154a61a9fbef50dab3526202eb4045",
      9557,
    ],
  ],
} as const;
function withoutPrincipalRow(text: string, name: "manifest" | "coverage") {
  const objects = objectSlices(text, name === "manifest" ? "scenarios" : "rows");
  for (const [id, hash, bytes] of principalParentPins[name]) {
    const raw = objects.get(id)!;
    expect(Buffer.byteLength(raw), id).toBe(bytes);
    expect(createHash("sha256").update(raw).digest("hex"), id).toBe(hash);
  }
  const raw = objects.get(principalId)!;
  expect(typeof raw).toBe("string");
  const key = name === "manifest" ? "scenarios" : "rows";
  const prefix = `"${key}": [\n    ${raw},\n`;
  expect(text.includes(prefix), "principal-first-object").toBe(true);
  const parent = text.replace(prefix, `"${key}": [\n`);
  expect(createHash("sha256").update(parent).digest("hex"), "principal-full-parent").toBe(
    name === "manifest"
      ? "a11a79f6d0f9ffa5933a680a3e4fed87987789c3deca50a38cda8563132d242e"
      : "346e1edaa22af789f89017fdc2fef6bb01b7564ed72a65344e9fe5635887c74f",
  );
  return parent;
}
it("pins the partial principal namespace row, full parent and exact credential roles", () => {
  const row = manifest.scenarios.find((r: { id: string }) => r.id === principalId)!;
  expect(manifest.scenarios[0]).toBe(row);
  expect(row.requiredProfile).toBe("read-update");
  expect(row.actions.flatMap((a: { captures: unknown[] }) => a.captures)).toEqual([]);
  expect(row.actions.map((a: { id: string }) => a.id)).toEqual([
    "pk-a-create",
    "pk-b-create",
    "pk-a-rotated",
    "pk-b-replay",
    "pk-a-conflict",
    "pk-current",
    "pk-events",
  ]);
  const expected = [
    {
      action: "pk-a-create",
      method: "POST",
      credentialRef: "principal-a",
      headerLines: [
        {
          name: "accept",
          value: "application/json",
        },
        {
          name: "content-type",
          value: "application/json",
        },
        {
          name: "idempotency-key",
          value: "principal-shared",
        },
      ],
      body: '{"operations":[{"operation":"createBead","id":"beads/a","type":"https://reference.invalid/acme/types/task","properties":{"title":"a"},"metadata":{}}]}',
      bodyBytes: 150,
      bodySha256: "54f0fefb0965a8210bb22cf09601c18296ef450489eff1aef5a8bea8b99d83b8",
    },
    {
      action: "pk-b-create",
      method: "POST",
      credentialRef: "principal-b",
      headerLines: [
        {
          name: "accept",
          value: "application/json",
        },
        {
          name: "content-type",
          value: "application/json",
        },
        {
          name: "idempotency-key",
          value: "principal-shared",
        },
      ],
      body: '{"operations":[{"operation":"createBead","id":"beads/b","type":"https://reference.invalid/acme/types/task","properties":{"title":"b"},"metadata":{}}]}',
      bodyBytes: 150,
      bodySha256: "b26bbe9a43f5cc9b54d7fe7778786b33e5e8d613bf30248de3af65f5eac0cdc8",
    },
    {
      action: "pk-a-rotated",
      method: "POST",
      credentialRef: "principal-a-rotated",
      headerLines: [
        {
          name: "accept",
          value: "application/json",
        },
        {
          name: "content-type",
          value: "application/json",
        },
        {
          name: "idempotency-key",
          value: "principal-shared",
        },
      ],
      body: '{"operations":[{"operation":"createBead","id":"beads/a","type":"https://reference.invalid/acme/types/task","properties":{"title":"a"},"metadata":{}}]}',
      bodyBytes: 150,
      bodySha256: "54f0fefb0965a8210bb22cf09601c18296ef450489eff1aef5a8bea8b99d83b8",
    },
    {
      action: "pk-b-replay",
      method: "POST",
      credentialRef: "principal-b",
      headerLines: [
        {
          name: "accept",
          value: "application/json",
        },
        {
          name: "content-type",
          value: "application/json",
        },
        {
          name: "idempotency-key",
          value: "principal-shared",
        },
      ],
      body: '{"operations":[{"operation":"createBead","id":"beads/b","type":"https://reference.invalid/acme/types/task","properties":{"title":"b"},"metadata":{}}]}',
      bodyBytes: 150,
      bodySha256: "b26bbe9a43f5cc9b54d7fe7778786b33e5e8d613bf30248de3af65f5eac0cdc8",
    },
    {
      action: "pk-a-conflict",
      method: "POST",
      credentialRef: "principal-a",
      headerLines: [
        {
          name: "accept",
          value: "application/json",
        },
        {
          name: "content-type",
          value: "application/json",
        },
        {
          name: "idempotency-key",
          value: "principal-shared",
        },
      ],
      body: '{"operations":[{"operation":"createBead","id":"beads/c","type":"https://reference.invalid/acme/types/task","properties":{"title":"c"},"metadata":{}}]}',
      bodyBytes: 150,
      bodySha256: "3de2f9bb5fb4b4b0537d252ba722b05a3385414129cf35fc6ab0355720f9ff62",
    },
    {
      action: "pk-current",
      method: "GET",
      credentialRef: "principal-a",
      headerLines: [
        {
          name: "accept",
          value: "application/json",
        },
      ],
      body: null,
      bodyBytes: 0,
      bodySha256: null,
    },
    {
      action: "pk-events",
      method: "GET",
      credentialRef: "principal-a",
      headerLines: [
        {
          name: "accept",
          value: "application/json",
        },
      ],
      body: null,
      bodyBytes: 0,
      bodySha256: null,
    },
  ];
  for (const [i, action] of row.actions.entries()) {
    const literal = expected[i]!;
    expect(action.family).toBe("http");
    expect(action.method).toBe(literal.method);
    expect(action.credentialRef).toBe(literal.credentialRef);
    expect(action.raw.headerLines).toEqual(literal.headerLines);
    expect(action.raw.body?.value).toBe(literal.body ?? undefined);
    expect(action.assertions).toContainEqual({
      id: "request-headers",
      kind: "request-authored-headers",
    });
    expect(action.assertions).toContainEqual({ id: "request-body", kind: "request-authored-body" });
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(action.assertions).toContainEqual({
        id: `present-${name}`,
        kind: "header",
        name,
        absent: false,
      });
  }
  expect(
    row.actions.map((a: { assertions: { id: string }[] }) => a.assertions.map((x) => x.id)),
  ).toEqual([
    [
      "http-status",
      "schema",
      "media",
      "present-bdp-scope-epoch",
      "present-bdp-authorization-view",
      "present-bdp-scope-position",
      "serving-position",
      "request-headers",
      "request-body",
      "disposition",
      "detail",
      "key",
      "receipt-id",
      "transaction",
      "required-position",
      "effect-position",
      "no-next",
      "result-indices",
      "resource-id",
      "resource-type",
      "resource-revision",
      "resource-properties",
      "resource-metadata",
      "no-owned-links",
      "no-provenance",
    ],
    [
      "http-status",
      "schema",
      "media",
      "present-bdp-scope-epoch",
      "present-bdp-authorization-view",
      "present-bdp-scope-position",
      "serving-position",
      "request-headers",
      "request-body",
      "disposition",
      "detail",
      "key",
      "receipt-id",
      "transaction",
      "required-position",
      "effect-position",
      "no-next",
      "result-indices",
      "resource-id",
      "resource-type",
      "resource-revision",
      "resource-properties",
      "resource-metadata",
      "no-owned-links",
      "no-provenance",
    ],
    [
      "http-status",
      "schema",
      "media",
      "present-bdp-scope-epoch",
      "present-bdp-authorization-view",
      "present-bdp-scope-position",
      "serving-position",
      "request-headers",
      "request-body",
      "disposition",
      "detail",
      "key",
      "receipt-id",
      "transaction",
      "required-position",
      "effect-position",
      "no-next",
      "result-indices",
      "resource-id",
      "resource-type",
      "resource-revision",
      "resource-properties",
      "resource-metadata",
      "no-owned-links",
      "no-provenance",
    ],
    [
      "http-status",
      "schema",
      "media",
      "present-bdp-scope-epoch",
      "present-bdp-authorization-view",
      "present-bdp-scope-position",
      "serving-position",
      "request-headers",
      "request-body",
      "disposition",
      "detail",
      "key",
      "receipt-id",
      "transaction",
      "required-position",
      "effect-position",
      "no-next",
      "result-indices",
      "resource-id",
      "resource-type",
      "resource-revision",
      "resource-properties",
      "resource-metadata",
      "no-owned-links",
      "no-provenance",
    ],
    [
      "http-status",
      "schema",
      "media",
      "present-bdp-scope-epoch",
      "present-bdp-authorization-view",
      "present-bdp-scope-position",
      "serving-position",
      "request-headers",
      "request-body",
      "exact-problem",
    ],
    [
      "http-status",
      "schema",
      "media",
      "present-bdp-scope-epoch",
      "present-bdp-authorization-view",
      "present-bdp-scope-position",
      "serving-position",
      "request-headers",
      "request-body",
      "no-next",
      "ordered-state",
    ],
    [
      "http-status",
      "schema",
      "media",
      "present-bdp-scope-epoch",
      "present-bdp-authorization-view",
      "present-bdp-scope-position",
      "serving-position",
      "request-headers",
      "request-body",
      "no-next",
      "ordered-facts",
      "source",
      "a-properties",
      "a-metadata",
      "a-no-provenance",
      "b-properties",
      "b-metadata",
      "b-no-provenance",
    ],
  ]);
  expect(
    createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    "principal-independent-complete-facts",
  ).toBe("097a27abcff4db5d788f3c9a37889f1590cbcbc011a77e2b8a97d17a260973ff");
  const coverage = JSON.parse(read("coverage").toString()).rows.find(
    (r: { id: string }) => r.id === principalId,
  )!;
  expect(coverage.wholeContract).toBe(false);
  expect(coverage.bindings).toEqual([
    {
      scenario: principalId,
      assertions: row.actions.flatMap((a: { id: string; assertions: { id: string }[] }) =>
        a.assertions.map((x) => `${a.id}:${x.id}`),
      ),
    },
  ]);
  for (const name of ["manifest", "coverage"] as const)
    withoutPrincipalRow(read(name).toString(), name);
});
