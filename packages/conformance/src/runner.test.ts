import { describe, expect, it, vi } from "vitest";
import schemaBundle from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
import {
  type ConformanceArtifactBundle,
  type ConformanceFixture,
  createConformanceArtifactBundle,
  createFetchHttpExchangeExecutor,
  createJsonSchemaValidator,
  type ExecutableScenario,
  type ExecutableScenarioManifest,
  type HttpExchangeResponse,
  parseExecutableScenarioManifest,
  parseScenarioCatalog,
  runConformanceMatrix,
  serializeConformanceReport,
  type ScenarioCatalog,
  type ScenarioHarness,
} from "./index.js";

type RequestScenario = Extract<ExecutableScenario, { readonly requests: readonly unknown[] }>;

function requestScenario(scenario: ExecutableScenario | undefined): RequestScenario {
  if (scenario?.requests === undefined) throw new Error("expected a request-based scenario");
  return scenario;
}

const citation = {
  source: "docs/specs/bdp.md",
  anchor: "#scope-discovery-and-human-documentation",
  selectedText: "service-desc",
};

const testFixture = {
  fixtureVersion: 1,
  id: "reference-read-v1",
  seed: 0,
  capabilities: ["public-http"],
  bindings: {},
} as const satisfies ConformanceFixture;

const encodeJson = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value)}\n`);

function bindArtifacts(
  catalog: ScenarioCatalog,
  manifest: ExecutableScenarioManifest,
  fixture: ConformanceFixture = testFixture,
): ConformanceArtifactBundle {
  return createConformanceArtifactBundle({
    catalog: { bytes: encodeJson(catalog), label: "test-catalog.json" },
    manifest: { bytes: encodeJson(manifest), label: "test-manifest.json" },
    fixture: { bytes: encodeJson(fixture), label: "test-fixture.json" },
  });
}

function replaceArtifacts(
  base: { readonly artifactBundle: ConformanceArtifactBundle },
  replacements: {
    readonly catalog?: ScenarioCatalog;
    readonly manifest?: ExecutableScenarioManifest;
    readonly fixture?: ConformanceFixture;
  },
): ConformanceArtifactBundle {
  return bindArtifacts(
    replacements.catalog ?? base.artifactBundle.catalog,
    replacements.manifest ?? base.artifactBundle.manifest,
    replacements.fixture ?? base.artifactBundle.fixture,
  );
}

function fixtureWithBindings(
  base: { readonly artifactBundle: ConformanceArtifactBundle },
  bindings: Readonly<Record<string, string>>,
): ConformanceArtifactBundle {
  return replaceArtifacts(base, {
    fixture: { ...base.artifactBundle.fixture, bindings },
  });
}

function inputs(
  assertions: readonly Record<string, unknown>[] = [
    { id: "status", kind: "status", equals: 204 },
    { id: "body", kind: "body-absent" },
  ],
  headers: Readonly<Record<string, string>> = {},
  fixture: ConformanceFixture = testFixture,
) {
  const catalog = parseScenarioCatalog({
    catalogVersion: 1,
    scenarios: [
      {
        id: "read.discovery",
        title: "Scope discovery",
        kind: "normative",
        requiredProfile: "read",
        requirements: [citation],
      },
    ],
  });
  const manifest = parseExecutableScenarioManifest({
    manifestVersion: 1,
    catalogId: "read-v1",
    scenarios: [
      {
        id: "read.discovery",
        requiredProfile: "read",
        setup: { fixture: "reference-read-v1", requires: ["public-http"] },
        applicability: { requires: [] },
        requests: [
          {
            id: "scope",
            method: "GET",
            target: { binding: "scope" },
            headers,
            captures: [],
            assertions,
          },
        ],
        cleanup: { resetFixture: true },
      },
    ],
  });
  return {
    artifactBundle: bindArtifacts(catalog, manifest, fixture),
    declaredTargetLabel: "unit-test-target",
  };
}

function actionInputs(
  actions: readonly Record<string, unknown>[],
  fixture: ConformanceFixture = testFixture,
) {
  const catalog = parseScenarioCatalog({
    catalogVersion: 1,
    scenarios: [
      {
        id: "read.discovery",
        title: "Scope discovery",
        kind: "normative",
        requiredProfile: "read",
        requirements: [citation],
      },
    ],
  });
  const manifest = parseExecutableScenarioManifest({
    manifestVersion: 1,
    catalogId: "read-v1",
    scenarios: [
      {
        id: "read.discovery",
        requiredProfile: "read",
        setup: { fixture: "reference-read-v1", requires: ["public-http"] },
        applicability: { requires: [] },
        actions,
        cleanup: { resetFixture: true },
      },
    ],
  });
  return {
    artifactBundle: bindArtifacts(catalog, manifest, fixture),
    declaredTargetLabel: "unit-test-target",
  };
}

function harness(capabilities: readonly string[] = ["public-http"]): ScenarioHarness {
  return { prepare: vi.fn(async () => ({ capabilities })), cleanup: vi.fn(async () => undefined) };
}

describe("black-box conformance runner", () => {
  it("preserves mixed action ordering while the runner owns assertions and captures", async () => {
    const calls: string[] = [];
    const runInputs = actionInputs([
      {
        id: "scope",
        family: "http",
        method: "GET",
        target: { binding: "scope" },
        headers: {},
        captures: [],
        assertions: [{ id: "status", kind: "status", equals: 200 }],
      },
      {
        id: "list",
        family: "client",
        operation: "list",
        input: { selector: "open" },
        captures: [{ binding: "next", from: { kind: "json-pointer", pointer: "/next" } }],
        assertions: [
          {
            id: "count",
            kind: "json-pointer",
            pointer: "/count",
            exists: true,
            equals: 1,
          },
        ],
      },
      {
        id: "next",
        family: "http",
        method: "GET",
        target: { binding: "next" },
        headers: {},
        captures: [],
        assertions: [{ id: "status", kind: "status", equals: 204 }],
      },
    ]);
    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async ({ url }) => {
        calls.push(`http:${url}`);
        return {
          url,
          status: url.endsWith("next") ? 204 : 200,
          headers: {},
          bodyText: "",
        };
      },
      actionExecutor: async ({ family, operation, scope, bindings, input }) => {
        calls.push(`${family}:${operation}`);
        expect(scope).toBe("https://scope.example/");
        expect(bindings).toEqual({ scope: "https://scope.example/" });
        expect(input).toEqual({ selector: "open" });
        return { count: 1, next: "https://scope.example/next" };
      },
      harness: harness(),
    });
    expect(calls).toEqual([
      "http:https://scope.example/",
      "client:list",
      "http:https://scope.example/next",
    ]);
    expect(result.scenarios[0]).toMatchObject({
      state: "pass",
      exchanges: [
        { request: { id: "scope" } },
        { request: { id: "next", url: "https://scope.example/next" } },
      ],
      actions: [
        {
          action: { id: "list", family: "client", operation: "list" },
          output: { kind: "json" },
          assertions: [{ id: "count", passed: true }],
        },
      ],
    });
  });

  it("materializes target-specific programmable input from the bound fixture oracle", async () => {
    const fixture = {
      ...testFixture,
      oracles: { actionInput: { relationshipRoles: [{ type: "types/blocks", role: "blocks" }] } },
    } as const satisfies ConformanceFixture;
    const runInputs = actionInputs(
      [
        {
          id: "projection",
          family: "client",
          operation: "projection",
          inputFixturePointer: "/oracles/actionInput",
          captures: [],
          assertions: [
            {
              id: "success",
              kind: "json-pointer",
              pointer: "/success",
              exists: true,
              equals: true,
            },
          ],
        },
      ],
      fixture,
    );
    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => {
        throw new Error("HTTP was not expected");
      },
      actionExecutor: async ({ input }) => {
        expect(input).toEqual(fixture.oracles.actionInput);
        expect(input).not.toBe(fixture.oracles.actionInput);
        return { success: true };
      },
      harness: harness(),
    });
    expect(result.scenarios[0]).toMatchObject({ state: "pass" });
    expect(JSON.stringify(result)).not.toContain("types/blocks");
  });

  it("fails closed when a programmable action has no executor", async () => {
    const result = await runConformanceMatrix({
      ...actionInputs([
        {
          id: "list",
          family: "client",
          operation: "list",
          input: {},
          captures: [],
          assertions: [{ id: "shape", kind: "json-pointer", pointer: "", exists: true }],
        },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => {
        throw new Error("HTTP must not run");
      },
      harness: harness(),
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "not-implemented",
      actions: [{ executionError: { category: "not-implemented" } }],
    });
  });

  it("records runner-owned programmable assertion failures", async () => {
    const result = await runConformanceMatrix({
      ...actionInputs([
        {
          id: "list",
          family: "lifecycle",
          operation: "restart",
          input: {},
          captures: [],
          assertions: [
            { id: "ready", kind: "json-pointer", pointer: "/ready", exists: true, equals: true },
          ],
        },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => {
        throw new Error("HTTP must not run");
      },
      actionExecutor: async () => ({ ready: false }),
      harness: harness(),
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "fail",
      actions: [{ assertions: [{ id: "ready", passed: false }] }],
    });
  });

  it("snapshots programmable output without invoking getters, toJSON, or leaking proxy errors", async () => {
    const runOutput = async (output: unknown) =>
      await runConformanceMatrix({
        ...actionInputs([
          {
            id: "inspect",
            family: "client",
            operation: "list",
            input: {},
            captures: [],
            assertions: [{ id: "shape", kind: "json-pointer", pointer: "", exists: true }],
          },
        ]),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: async () => {
          throw new Error("HTTP must not run");
        },
        actionExecutor: async () => output,
        harness: harness(),
      });

    let getterCalls = 0;
    const getterSecret = "getter-secret-must-not-leak";
    const getterOutput = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return getterSecret;
      },
    });
    const getterResult = await runOutput(getterOutput);
    expect(getterCalls).toBe(0);
    expect(getterResult.scenarios[0]).toMatchObject({ state: "fail" });
    expect(JSON.stringify(getterResult)).not.toContain(getterSecret);

    let toJsonCalls = 0;
    const toJsonResult = await runOutput({
      toJSON: () => {
        toJsonCalls += 1;
        return { leaked: true };
      },
    });
    expect(toJsonCalls).toBe(0);
    expect(toJsonResult.scenarios[0]).toMatchObject({ state: "fail" });

    const proxySecret = "proxy-secret-must-not-leak";
    const proxyResult = await runOutput(
      new Proxy(
        {},
        {
          getPrototypeOf: () => {
            throw new Error(proxySecret);
          },
        },
      ),
    );
    expect(proxyResult.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "action output could not be safely inspected",
    });
    expect(JSON.stringify(proxyResult)).not.toContain(proxySecret);
  });

  it("skips cleanup when a timed-out programmable action never settles", async () => {
    const scenarioHarness = harness();
    const result = await runConformanceMatrix({
      ...actionInputs([
        {
          id: "hang",
          family: "client",
          operation: "list",
          input: {},
          captures: [],
          assertions: [{ id: "shape", kind: "json-pointer", pointer: "", exists: true }],
        },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => {
        throw new Error("HTTP must not run");
      },
      actionExecutor: async () => await new Promise(() => undefined),
      harness: scenarioHarness,
      requestTimeoutMs: 5,
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "deadline",
      cleanupError: "cleanup skipped because an action execution did not settle",
      actions: [{ executionError: { category: "timeout" } }],
    });
    expect(scenarioHarness.cleanup).not.toHaveBeenCalled();
  });

  it("decodes an authored raw request target only at the HTTP executor boundary", async () => {
    let observedTarget: Uint8Array | undefined;
    const result = await runConformanceMatrix({
      ...actionInputs([
        {
          id: "raw",
          family: "http",
          method: "GET",
          target: { binding: "scope" },
          rawRequestTarget: { encoding: "base64", value: "Ly9hY21lLyUyZg==" },
          headers: {},
          captures: [],
          assertions: [{ id: "status", kind: "status", equals: 200 }],
        },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async ({ url, rawRequestTarget }) => {
        observedTarget = rawRequestTarget;
        return { url, status: 200, headers: {}, bodyText: "" };
      },
      harness: harness(),
    });
    expect(new TextDecoder().decode(observedTarget)).toBe("//acme/%2f");
    expect(result.scenarios[0]).toMatchObject({ state: "pass" });
    expect(result.scenarios[0]).not.toHaveProperty("actions");
  });

  it("materializes portable raw request-target templates from the resolved semantic URL", async () => {
    const templates = [
      {
        id: "canonical",
        rawRequestTarget: { template: "resolved-url", form: "origin" },
      },
      {
        id: "scheme-relative",
        rawRequestTarget: {
          template: "resolved-url",
          form: "scheme-relative",
          authority: "evil.invalid",
        },
      },
      {
        id: "absolute",
        rawRequestTarget: {
          template: "resolved-url",
          form: "absolute",
          authority: "evil.invalid",
        },
      },
      {
        id: "insert",
        rawRequestTarget: {
          template: "resolved-url",
          form: "origin",
          insertBeforeFinalPathSegment: { encoding: "ascii", value: "/" },
        },
      },
      {
        id: "ascii-suffix",
        rawRequestTarget: {
          template: "resolved-url",
          form: "origin",
          suffix: { encoding: "ascii", value: "#fragment" },
        },
      },
      {
        id: "binary-suffix",
        rawRequestTarget: {
          template: "resolved-url",
          form: "origin",
          suffix: { encoding: "base64", value: "wyg=" },
        },
      },
    ].map(({ id, rawRequestTarget }) => ({
      id,
      family: "http",
      method: "GET",
      target: { binding: "resource" },
      rawRequestTarget,
      headers: {},
      captures: [],
      assertions: [{ id: "status", kind: "status", equals: 200 }],
    }));
    const fixture = {
      ...testFixture,
      bindings: { resource: "objects/fixture-a?canonical=yes" },
    };
    const observedTargets: Uint8Array[] = [];

    const result = await runConformanceMatrix({
      ...actionInputs(templates, fixture),
      scope: "https://scope.example/runtime-tenant/",
      profile: "read",
      seed: 0,
      execute: async ({ url, rawRequestTarget }) => {
        if (rawRequestTarget === undefined) throw new Error("raw target was not materialized");
        observedTargets.push(rawRequestTarget);
        return { url, status: 200, headers: {}, bodyText: "" };
      },
      harness: {
        prepare: vi.fn(async () => ({
          capabilities: ["public-http"],
          bindings: { resource: "objects/fixture-a?canonical=yes" },
        })),
        cleanup: vi.fn(async () => undefined),
      },
    });

    expect(observedTargets).toEqual(
      [
        Buffer.from("/runtime-tenant/objects/fixture-a?canonical=yes", "ascii"),
        Buffer.from("//evil.invalid/runtime-tenant/objects/fixture-a?canonical=yes", "ascii"),
        Buffer.from("https://evil.invalid/runtime-tenant/objects/fixture-a?canonical=yes", "ascii"),
        Buffer.from("/runtime-tenant/objects//fixture-a?canonical=yes", "ascii"),
        Buffer.from("/runtime-tenant/objects/fixture-a?canonical=yes#fragment", "ascii"),
        Buffer.concat([
          Buffer.from("/runtime-tenant/objects/fixture-a?canonical=yes", "ascii"),
          Buffer.from([0xc3, 0x28]),
        ]),
      ].map((bytes) => Uint8Array.from(bytes)),
    );
    expect(result.scenarios[0]).toMatchObject({ state: "pass" });
    expect(JSON.stringify(result)).not.toContain("evil.invalid");
    expect(JSON.stringify(result)).not.toContain("fragment");
  });

  it("resolves an exact JSON oracle from the bound target realization", async () => {
    const catalog = parseScenarioCatalog({
      catalogVersion: 1,
      scenarios: [
        {
          id: "read.resource",
          title: "Target-specific Resource realization",
          kind: "normative",
          requiredProfile: "read",
          requirements: [citation],
        },
      ],
    });
    const manifest = parseExecutableScenarioManifest({
      manifestVersion: 1,
      catalogId: "read-v1",
      scenarios: [
        {
          id: "read.resource",
          requiredProfile: "read",
          setup: { fixture: "reference-read-v1", requires: ["public-http"] },
          applicability: { requires: [] },
          requests: [
            {
              id: "resource",
              method: "GET",
              target: { binding: "scope" },
              headers: {},
              captures: [],
              assertions: [
                {
                  id: "target-realization",
                  kind: "json-equals",
                  fixturePointer: "/oracles/resource",
                },
              ],
            },
          ],
          cleanup: { resetFixture: true },
        },
      ],
    });
    const run = async (target: "bdptest" | "bdpbd") => {
      const fixture = {
        ...testFixture,
        oracles: { resource: { target } },
      } as const satisfies ConformanceFixture;
      return await runConformanceMatrix({
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        artifactBundle: bindArtifacts(catalog, manifest, fixture),
        execute: async () => ({
          url: "https://scope.example/",
          status: 200,
          headers: { "content-type": "application/json" },
          bodyText: JSON.stringify({ target }),
        }),
        harness: harness(),
        declaredTargetLabel: `${target}-realization`,
      });
    };

    await expect(run("bdptest")).resolves.toMatchObject({
      scenarios: [{ state: "pass" }],
    });
    await expect(run("bdpbd")).resolves.toMatchObject({
      scenarios: [{ state: "pass" }],
    });
  });

  it("normalizes a JSON pointer before comparing it with a fixture oracle", async () => {
    const fixture = {
      ...testFixture,
      oracles: { "resource-id": "beads/target-specific-id" },
    } as const satisfies ConformanceFixture;
    const runInputs = inputs(
      [
        {
          id: "resource-id",
          kind: "json-pointer",
          pointer: "/id",
          exists: true,
          fixturePointer: "/oracles/resource-id",
          normalize: "scope-relative-url",
        },
      ],
      {},
      fixture,
    );

    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({ id: "https://scope.example/beads/target-specific-id" }),
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]?.state).toBe("pass");
  });

  it("normalizes ISO timestamps only at explicitly declared target-specific pointers", async () => {
    const fixture = {
      ...testFixture,
      oracles: {
        properties: {
          id: "demo-a",
          created_at: "2026-08-08T23:33:31Z",
          dependencies: [{ created_at: "2026-08-08T23:33:32Z" }],
        },
      },
    } as const satisfies ConformanceFixture;
    const runInputs = inputs(
      [
        {
          id: "properties",
          kind: "json-equals",
          fixturePointer: "/oracles/properties",
          normalize: "iso-timestamps",
          timestampPointers: ["/created_at", "/dependencies/0/created_at"],
        },
      ],
      {},
      fixture,
    );

    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({
          id: "demo-a",
          created_at: "2026-08-16T03:30:13Z",
          dependencies: [{ created_at: "2026-08-15T20:30:14Z" }],
        }),
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]?.state).toBe("pass");
  });

  it("compares canonical timestamp strings exactly outside declared dynamic pointers", async () => {
    const fixture = {
      ...testFixture,
      oracles: {
        properties: {
          created_at: "2026-08-08T23:33:31Z",
          reviewed_at: "2026-08-08T23:33:32Z",
        },
      },
    } as const satisfies ConformanceFixture;
    const runInputs = inputs(
      [
        {
          id: "properties",
          kind: "json-equals",
          fixturePointer: "/oracles/properties",
          normalize: "iso-timestamps",
          timestampPointers: ["/created_at"],
        },
      ],
      {},
      fixture,
    );

    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({
          created_at: "2026-08-16T03:30:13Z",
          reviewed_at: "2026-08-15T20:30:14Z",
        }),
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]?.state).toBe("fail");
  });

  it("does not normalize calendar-invalid timestamp-like strings", async () => {
    const fixture = {
      ...testFixture,
      oracles: { created_at: "2026-02-28T23:33:31Z" },
    } as const satisfies ConformanceFixture;
    const runInputs = inputs(
      [
        {
          id: "created-at",
          kind: "json-equals",
          fixturePointer: "/oracles/created_at",
          normalize: "iso-timestamps",
          timestampPointers: [""],
        },
      ],
      {},
      fixture,
    );

    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify("2026-02-30T23:33:31Z"),
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]?.state).toBe("fail");
  });

  it("compares an array projection with the bound realization's exact multiset", async () => {
    const fixture = {
      ...testFixture,
      oracles: { "resource-ids": ["beads/target-a", "beads/target-b"] },
    } as const satisfies ConformanceFixture;
    const runInputs = inputs(
      [
        {
          id: "resource-ids",
          kind: "json-array-set",
          pointer: "/items",
          itemPointer: "/id",
          fixturePointer: "/oracles/resource-ids",
          normalize: "scope-relative-url",
        },
      ],
      {},
      fixture,
    );

    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({
          items: [
            { id: "https://scope.example/beads/target-b" },
            { id: "https://scope.example/beads/target-a" },
          ],
        }),
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]?.state).toBe("pass");
  });

  it("keeps external and Scope-local URI members portable in an array oracle", async () => {
    const fixture = {
      ...testFixture,
      oracles: {
        "type-ids": ["https://work.example/types/task", "types/related"],
      },
    } as const satisfies ConformanceFixture;
    const runInputs = inputs(
      [
        {
          id: "type-ids",
          kind: "json-array-set",
          pointer: "/items",
          itemPointer: "/id",
          fixturePointer: "/oracles/type-ids",
          normalize: "scope-relative-or-absolute-uri",
        },
      ],
      {},
      fixture,
    );

    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({
          items: [
            { id: "https://scope.example/types/related" },
            { id: "https://work.example/types/task" },
          ],
        }),
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]?.state).toBe("pass");
  });

  it("compares relational tuples with the bound realization's exact multiset", async () => {
    const fixture = {
      ...testFixture,
      oracles: {
        "link-tuples": [
          ["links/one", "beads/a", "https://external.example/issues/1"],
          ["links/two", "beads/b", "beads/a"],
        ],
      },
    } as const satisfies ConformanceFixture;
    const runInputs = inputs(
      [
        {
          id: "links",
          kind: "json-array-tuples",
          pointer: "/items",
          projections: [
            { pointer: "/id", normalize: "scope-relative-url" },
            { pointer: "/source/id", normalize: "scope-relative-or-absolute-uri" },
            { pointer: "/target/id", normalize: "scope-relative-or-absolute-uri" },
          ],
          fixturePointer: "/oracles/link-tuples",
        },
      ],
      {},
      fixture,
    );

    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({
          items: [
            {
              id: "https://scope.example/links/two",
              source: { id: "https://scope.example/beads/b" },
              target: { id: "https://scope.example/beads/a" },
            },
            {
              id: "https://scope.example/links/one",
              source: { id: "https://scope.example/beads/a" },
              target: { id: "https://external.example/issues/1" },
            },
          ],
        }),
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]?.state).toBe("pass");
  });

  it("does not copy fixture oracle values into failure reports", async () => {
    const oracleValue = "fixture-oracle-value-must-not-leak";
    const fixture = {
      ...testFixture,
      oracles: { resource: { privateMarker: oracleValue } },
    } as const satisfies ConformanceFixture;
    const runInputs = inputs(
      [
        {
          id: "resource",
          kind: "json-equals",
          fixturePointer: "/oracles/resource",
        },
      ],
      {},
      fixture,
    );

    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({ privateMarker: "different" }),
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]?.state).toBe("fail");
    expect(serializeConformanceReport(result)).not.toContain(oracleValue);
  });

  it("records a deterministic pass from public HTTP observations without attesting evidence", async () => {
    const execute = vi.fn(async () => ({
      url: "https://scope.example/",
      status: 204,
      headers: { link: '<bdp.json>; rel="service-desc"' },
      bodyText: "",
      bodyOctets: 0,
    }));
    const fixture = harness();
    const runInputs = inputs();
    const result = await runConformanceMatrix({
      ...runInputs,
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: fixture,
    });
    expect(result.scenarios[0]?.state).toBe("pass");
    expect(result.claimEligible).toBe(false);
    expect(result.reportVersion).toBe(3);
    expect(result.artifacts).toEqual(runInputs.artifactBundle.digests);
    expect(result.artifacts).not.toHaveProperty("targetLabel");
    expect(result.declarations).toEqual({ targetLabel: "unit-test-target" });
    expect(result).not.toHaveProperty("timestamp");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", url: "https://scope.example/" }),
    );
    expect(fixture.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ id: "read.discovery" }),
      "https://scope.example/",
      0,
      expect.objectContaining({ id: "reference-read-v1" }),
      expect.any(AbortSignal),
    );
  });

  it("compares relational array tuples with field-specific URI normalization", async () => {
    const tupleAssertion = {
      id: "links",
      kind: "json-array-tuples",
      pointer: "/items",
      projections: [
        { pointer: "/id", normalize: "scope-relative-url" },
        { pointer: "/source/id", normalize: "scope-relative-or-absolute-uri" },
        { pointer: "/target/id", normalize: "scope-relative-or-absolute-uri" },
      ],
      equals: [
        ["links/one", "beads/a", "https://external.example/issues/1"],
        ["links/two", "beads/b", "beads/a"],
      ],
    } as const;
    const execute = async () => ({
      url: "https://scope.example/",
      status: 200,
      headers: { "content-type": "application/json" },
      bodyText: JSON.stringify({
        items: [
          {
            id: "https://scope.example/links/two",
            source: { id: "https://scope.example/beads/b" },
            target: { id: "https://scope.example/beads/a" },
          },
          {
            id: "https://scope.example/links/one",
            source: { id: "https://scope.example/beads/a" },
            target: { id: "https://external.example/issues/1" },
          },
        ],
      }),
    });
    const result = await runConformanceMatrix({
      ...inputs([tupleAssertion]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });
    expect(result.scenarios[0]?.state).toBe("pass");

    const crossProduct = await runConformanceMatrix({
      ...inputs([
        {
          ...tupleAssertion,
          equals: [
            ["links/one", "beads/b", "https://external.example/issues/1"],
            ["links/two", "beads/a", "beads/a"],
          ],
        },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });
    expect(crossProduct.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "array tuples did not match the expected multiset",
    });
  });

  it("compares ordered tuple sequences positionally while default mode stays a multiset", async () => {
    const orderedAssertion = {
      id: "sequence",
      kind: "json-array-tuples",
      pointer: "/items",
      ordered: true,
      projections: [{ pointer: "/id", normalize: "scope-relative-url" }],
      equals: [["beads/a"], ["beads/b"]],
    } as const;
    const reversedItems = async () => ({
      url: "https://scope.example/",
      status: 200,
      headers: { "content-type": "application/json" },
      bodyText: JSON.stringify({
        items: [{ id: "https://scope.example/beads/b" }, { id: "https://scope.example/beads/a" }],
      }),
    });
    const orderedResult = await runConformanceMatrix({
      ...inputs([orderedAssertion]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: reversedItems,
      harness: harness(),
    });
    expect(orderedResult.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "array tuples did not match the expected sequence",
    });

    const { ordered: _dropped, ...multisetAssertion } = orderedAssertion;
    const multisetResult = await runConformanceMatrix({
      ...inputs([multisetAssertion]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: reversedItems,
      harness: harness(),
    });
    expect(multisetResult.scenarios[0]?.state).toBe("pass");
  });

  it("distinguishes observable mismatches, setup failures, applicability, and cleanup failures", async () => {
    const failed = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: {},
        bodyText: "{}",
        bodyOctets: 2,
      }),
      harness: harness(),
    });
    expect(failed.scenarios[0]?.state).toBe("fail");

    const missingSetup = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: vi.fn(),
      harness: harness([]),
    });
    expect(missingSetup.scenarios[0]?.state).toBe("harness-error");

    const applicableInputs = inputs();
    const applicableScenario = applicableInputs.artifactBundle.manifest.scenarios[0];
    if (applicableScenario === undefined) throw new Error("test manifest unexpectedly empty");
    const notApplicable = await runConformanceMatrix({
      ...applicableInputs,
      artifactBundle: replaceArtifacts(applicableInputs, {
        manifest: {
          ...applicableInputs.artifactBundle.manifest,
          scenarios: [{ ...applicableScenario, applicability: { requires: ["optional"] } }],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: vi.fn(),
      harness: harness(),
    });
    expect(notApplicable.scenarios[0]?.state).toBe("not-applicable");

    const cleanupFailure = harness();
    vi.mocked(cleanupFailure.cleanup).mockRejectedValueOnce(new Error("reset failed"));
    const cleanupResult = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {},
        bodyText: "",
        bodyOctets: 0,
      }),
      harness: cleanupFailure,
    });
    expect(cleanupResult.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "cleanup",
      cleanupError: "cleanup failed",
    });
  });

  it("binds the harness preparation to fixture capabilities, names, and values", async () => {
    const execute = vi.fn();
    const undeclaredCapability = harness(["public-http", "unbound-capability"]);
    const capabilityResult = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: undeclaredCapability,
    });
    expect(capabilityResult.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "fixture preparation capabilities must be a unique subset of the bound fixture",
    });

    const mismatchedBindings = harness();
    vi.mocked(mismatchedBindings.prepare).mockResolvedValue({
      capabilities: ["public-http"],
      bindings: { "bearer-binding-secret": "beads/demo-a" },
    });
    const bindingResult = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: mismatchedBindings,
    });
    expect(bindingResult.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "fixture preparation binding names must match the bound fixture",
    });
    expect(JSON.stringify(bindingResult)).not.toContain("bearer-binding-secret");
    expect(execute).not.toHaveBeenCalled();

    const swappedBinding = harness();
    vi.mocked(swappedBinding.prepare).mockResolvedValue({
      capabilities: ["public-http"],
      bindings: { resource: "beads/demo-b" },
    });
    const swappedInputs = inputs();
    const swappedResult = await runConformanceMatrix({
      ...swappedInputs,
      artifactBundle: fixtureWithBindings(swappedInputs, { resource: "beads/demo-a" }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: swappedBinding,
    });
    expect(swappedResult.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "fixture preparation binding values must match the bound fixture",
    });
    expect(JSON.stringify(swappedResult)).not.toContain("demo-a");
    expect(JSON.stringify(swappedResult)).not.toContain("demo-b");
    expect(execute).not.toHaveBeenCalled();

    const resolvedBinding = harness();
    vi.mocked(resolvedBinding.prepare).mockResolvedValue({
      capabilities: ["public-http"],
      bindings: { resource: "https://scope.example/beads/demo-a" },
    });
    const resolvedInputs = inputs();
    const resolvedResult = await runConformanceMatrix({
      ...resolvedInputs,
      artifactBundle: fixtureWithBindings(resolvedInputs, { resource: "beads/demo-a" }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {},
        bodyText: "",
        bodyOctets: 0,
      }),
      harness: resolvedBinding,
    });
    expect(resolvedResult.scenarios[0]?.state).toBe("pass");
  });

  it("fails closed when catalog metadata has no executable plan", async () => {
    const base = inputs();
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        manifest: { ...base.artifactBundle.manifest, scenarios: [] },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: vi.fn(),
      harness: harness(),
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "not-implemented",
      reason: "catalog scenario has no executable plan",
    });
  });

  it("captures discovered navigation and validates the offline schema independently", async () => {
    const base = inputs();
    const manifest = parseExecutableScenarioManifest({
      manifestVersion: 1,
      catalogId: "read-v1",
      scenarios: [
        {
          id: "read.discovery",
          requiredProfile: "read",
          setup: { fixture: "reference-read-v1", requires: ["public-http"] },
          applicability: { requires: [] },
          requests: [
            {
              id: "scope",
              method: "GET",
              target: { binding: "scope" },
              headers: {},
              captures: [
                { binding: "service-desc", from: { kind: "header-link", rel: "service-desc" } },
              ],
              assertions: [{ id: "status", kind: "status", equals: 204 }],
            },
            {
              id: "document",
              method: "GET",
              target: { binding: "service-desc" },
              headers: { accept: "application/json" },
              captures: [],
              assertions: [{ id: "schema", kind: "json-schema", schema: "#/$defs/readDiscovery" }],
            },
          ],
          cleanup: { resetFixture: true },
        },
      ],
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://scope.example/",
        status: 204,
        headers: { Link: '<bdp.json>; type="application/json"; rel="SERVICE-DESC"' },
        bodyText: "",
      })
      .mockResolvedValueOnce({
        url: "https://scope.example/bdp.json",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({
          bdpVersion: "0",
          profile: "read",
          scope: "https://scope.example/",
          beads: "https://scope.example/beads/",
          links: "https://scope.example/links/",
          types: "https://scope.example/types/",
        }),
      });
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, { manifest }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
      schemaValidator: createJsonSchemaValidator(schemaBundle),
    });
    expect(result.scenarios[0]?.state).toBe("pass");
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ url: "https://scope.example/bdp.json" }),
    );
  });

  it("keeps request authorization decoration separate from response headers", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
      return new Response(null, { status: 204 });
    });
    const execute = createFetchHttpExchangeExecutor(fetchMock as typeof fetch, () => ({
      authorization: "Bearer secret",
    }));
    const response = await execute({
      method: "GET",
      url: "https://scope.example/",
      headers: {},
      signal: new AbortController().signal,
    });
    expect(response.status).toBe(204);
    expect(response.headers).not.toHaveProperty("authorization");
    expect(response.effectiveRequest?.headers).toHaveProperty("authorization", "Bearer secret");
  });

  it("fails fast when schema configuration is missing", async () => {
    await expect(
      runConformanceMatrix({
        ...inputs([{ id: "schema", kind: "json-schema", schema: "#/$defs/readDiscovery" }]),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: vi.fn(),
        harness: harness(),
      }),
    ).rejects.toThrow("schema assertion requires an offline schema validator");
  });

  it("redacts secret response headers in report observations", async () => {
    const result = await runConformanceMatrix({
      ...inputs([{ id: "status", kind: "status", equals: 204 }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "authorization",
          "access-control-allow-methods": "GET",
          "access-control-allow-origin": "https://scope.example",
          "access-control-expose-headers": "etag",
          "access-control-max-age": "600",
          "set-cookie": "session=secret",
          zeta: "visible",
        },
        bodyText: "",
      }),
      harness: harness(),
    });
    expect(result.scenarios[0]?.exchanges[0]?.response?.headers).toEqual({
      "access-control-allow-credentials": "<redacted>",
      "access-control-allow-headers": "<redacted>",
      "access-control-allow-methods": "<redacted>",
      "access-control-allow-origin": "<redacted>",
      "access-control-expose-headers": "<redacted>",
      "access-control-max-age": "<redacted>",
      "set-cookie": "<redacted>",
    });
  });

  it("does not reflect credential-shaped response header values or names", async () => {
    const result = await runConformanceMatrix({
      ...inputs([{ id: "status", kind: "status", equals: 204 }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {
          allow: "GET, Bearer-secret-value",
          "content-type": "application/Bearer-secret-value",
          vary: "Bearer-secret-value",
          "user-agent": "Bearer-secret-value",
          "x-Bearer-secret-value": "visible",
        },
        bodyText: "",
      }),
      harness: harness(),
    });
    expect(JSON.stringify(result)).not.toContain("Bearer-secret-value");
    expect(result.scenarios[0]?.exchanges[0]?.response?.headers).toEqual({
      allow: "<redacted>",
      "content-type": "<redacted>",
      "user-agent": "<redacted>",
      vary: "<redacted>",
    });
  });

  it("blocks a dependent scenario when its actual prerequisite did not pass", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (metadata === undefined || scenario === undefined || request === undefined)
      throw new Error("test inputs unexpectedly empty");
    const dependentMetadata = {
      ...metadata,
      id: "read.collections.beads",
      requirements: [{ ...citation, anchor: "#dependent" }],
    };
    const dependentScenario = {
      ...scenario,
      id: "read.collections.beads",
      requests: [
        { ...request, prerequisiteScenario: "read.discovery" },
        { ...request, id: "owned", target: { binding: "scope" } },
      ],
    };
    const execute = vi.fn(async () => ({
      url: "https://scope.example/",
      status: 500,
      headers: {},
      bodyText: "",
    }));
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: { ...base.artifactBundle.catalog, scenarios: [metadata, dependentMetadata] },
        manifest: { ...base.artifactBundle.manifest, scenarios: [scenario, dependentScenario] },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.scenarios[1]).toMatchObject({
      id: "read.collections.beads",
      state: "harness-error",
      category: "not-run",
      reason: "prerequisite 'read.discovery' did not pass; dependent scenario was not run",
      requirements: ["docs/specs/bdp.md#dependent"],
      prerequisiteFailure: {
        id: "read.discovery",
        requirements: ["docs/specs/bdp.md#scope-discovery-and-human-documentation"],
        reason: "expected status 204, got 500",
        phase: "initial",
      },
    });
  });

  it("reports a failed repeated prerequisite observation as a recheck", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (metadata === undefined || scenario === undefined || request === undefined)
      throw new Error("test inputs unexpectedly empty");
    const dependentMetadata = {
      ...metadata,
      id: "read.collections.beads",
      requirements: [{ ...citation, anchor: "#dependent" }],
    };
    const dependentScenario = {
      ...scenario,
      id: "read.collections.beads",
      requests: [
        { ...request, prerequisiteScenario: "read.discovery" },
        { ...request, id: "owned", target: { binding: "scope" } },
      ],
    };
    let calls = 0;
    const execute = vi.fn(async () => {
      calls += 1;
      return {
        url: "https://scope.example/",
        status: calls === 1 ? 204 : 500,
        headers: {},
        bodyText: "",
      };
    });
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: { ...base.artifactBundle.catalog, scenarios: [metadata, dependentMetadata] },
        manifest: { ...base.artifactBundle.manifest, scenarios: [scenario, dependentScenario] },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.scenarios[1]).toMatchObject({
      id: "read.collections.beads",
      state: "harness-error",
      category: "not-run",
      reason: "prerequisite recheck 'read.discovery' failed; dependent scenario was not run",
      prerequisiteFailure: {
        id: "read.discovery",
        phase: "recheck",
        reason: "expected status 204, got 500",
      },
    });
    expect(result.scenarios[1]?.exchanges).toHaveLength(1);
  });

  it("stops after an uncontained prerequisite recheck deadline", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (metadata === undefined || scenario === undefined || request === undefined)
      throw new Error("test inputs unexpectedly empty");
    const dependentMetadata = {
      ...metadata,
      id: "read.collections.beads",
      requirements: [{ ...citation, anchor: "#dependent" }],
    };
    const laterMetadata = {
      ...metadata,
      id: "read.later",
      requirements: [{ ...citation, anchor: "#later" }],
    };
    const dependentScenario = {
      ...scenario,
      id: "read.collections.beads",
      requests: [
        { ...request, prerequisiteScenario: "read.discovery" },
        { ...request, id: "owned", target: { binding: "scope" } },
      ],
    };
    const laterScenario = { ...scenario, id: "read.later" };
    const execute = vi.fn(async () => {
      if (execute.mock.calls.length === 1)
        return { url: "https://scope.example/", status: 204, headers: {}, bodyText: "" };
      return await new Promise<never>(() => undefined);
    });
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: {
          ...base.artifactBundle.catalog,
          scenarios: [metadata, dependentMetadata, laterMetadata],
        },
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [scenario, dependentScenario, laterScenario],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
      requestTimeoutMs: 5,
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.scenarios).toMatchObject([
      { id: "read.discovery", state: "pass" },
      {
        id: "read.collections.beads",
        state: "harness-error",
        category: "not-run",
        reason:
          "prerequisite recheck 'read.discovery' exceeded its deadline; dependent scenario was not run",
        prerequisiteFailure: { phase: "recheck", category: "deadline" },
      },
      { id: "read.later", state: "harness-error", category: "not-run" },
    ]);
  });

  it("stops after a prerequisite recheck exceeds a runner observation bound", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (metadata === undefined || scenario === undefined || request === undefined)
      throw new Error("test inputs unexpectedly empty");
    const dependentMetadata = { ...metadata, id: "read.collections.beads" };
    const laterMetadata = { ...metadata, id: "read.later" };
    const dependentScenario = {
      ...scenario,
      id: "read.collections.beads",
      requests: [
        { ...request, prerequisiteScenario: "read.discovery" },
        { ...request, id: "owned" },
      ],
    };
    const depth = 129;
    const complexityExecute = vi.fn(async () =>
      complexityExecute.mock.calls.length === 1
        ? { url: "https://scope.example/", status: 204, headers: {}, bodyText: "" }
        : {
            url: "https://scope.example/",
            status: 200,
            headers: { "content-type": "application/json" },
            bodyText: `${"[".repeat(depth)}0${"]".repeat(depth)}`,
          },
    );
    const boundedFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("12345", { status: 200 }));

    for (const limitCase of [
      {
        name: "JSON complexity",
        execute: complexityExecute,
        calls: () => complexityExecute.mock.calls.length,
        reason: "response JSON exceeded the runner depth limit of 128",
      },
      {
        name: "body bytes",
        execute: createFetchHttpExchangeExecutor(boundedFetch as typeof fetch, undefined, 4),
        calls: () => boundedFetch.mock.calls.length,
        reason: "HTTP response exceeded the configured executor body limit",
      },
    ]) {
      const result = await runConformanceMatrix({
        ...base,
        artifactBundle: replaceArtifacts(base, {
          catalog: {
            ...base.artifactBundle.catalog,
            scenarios: [metadata, dependentMetadata, laterMetadata],
          },
          manifest: {
            ...base.artifactBundle.manifest,
            scenarios: [scenario, dependentScenario, { ...scenario, id: "read.later" }],
          },
        }),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: limitCase.execute,
        harness: harness(),
      });

      expect(limitCase.calls(), limitCase.name).toBe(2);
      expect(result.scenarios, limitCase.name).toMatchObject([
        { id: "read.discovery", state: "pass" },
        {
          id: "read.collections.beads",
          state: "harness-error",
          category: "not-run",
          reason:
            "prerequisite recheck 'read.discovery' exceeded a harness observation bound; dependent scenario was not run",
          prerequisiteFailure: {
            phase: "recheck",
            category: "observation-limit",
            reason: limitCase.reason,
          },
        },
        { id: "read.later", state: "harness-error", category: "not-run" },
      ]);
    }
  });

  it("stops after a prerequisite recheck escapes the safe fetch boundary", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (metadata === undefined || scenario === undefined || request === undefined)
      throw new Error("test inputs unexpectedly empty");
    const dependentMetadata = { ...metadata, id: "read.collections.beads" };
    const laterMetadata = { ...metadata, id: "read.later" };
    const dependentScenario = {
      ...scenario,
      id: "read.collections.beads",
      requests: [
        {
          ...request,
          prerequisiteScenario: "read.discovery",
          captures: [
            {
              binding: "service-desc",
              from: { kind: "header-link" as const, rel: "service-desc" },
            },
          ],
        },
        { ...request, id: "owned" },
      ],
    };
    const execute = vi.fn(async () => ({
      url: "https://scope.example/",
      status: 204,
      headers:
        execute.mock.calls.length === 1
          ? {}
          : { link: '<https://foreign.example/bdp.json>; rel="service-desc"' },
      bodyText: "",
    }));
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: {
          ...base.artifactBundle.catalog,
          scenarios: [metadata, dependentMetadata, laterMetadata],
        },
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [scenario, dependentScenario, { ...scenario, id: "read.later" }],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.scenarios).toMatchObject([
      { id: "read.discovery", state: "pass" },
      {
        id: "read.collections.beads",
        state: "harness-error",
        category: "not-run",
        reason:
          "prerequisite recheck 'read.discovery' was not safely contained; dependent scenario was not run",
        prerequisiteFailure: { phase: "recheck", category: "containment" },
      },
      { id: "read.later", state: "harness-error", category: "not-run" },
    ]);
  });

  it("refuses unsafe discovery fetches without misclassifying target conformance", async () => {
    const captureInputs = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const captureMetadata = captureInputs.artifactBundle.catalog.scenarios[0];
    const captureScenario = requestScenario(captureInputs.artifactBundle.manifest.scenarios[0]);
    const captureRequest = captureScenario?.requests[0];
    if (
      captureMetadata === undefined ||
      captureScenario === undefined ||
      captureRequest === undefined
    )
      throw new Error("test manifest unexpectedly empty");
    const captureExecute = vi.fn(async () => ({
      url: "https://scope.example/",
      status: 204,
      headers: { link: '<https://foreign.example/bdp.json>; rel="service-desc"' },
      bodyText: "",
    }));
    const capture = await runConformanceMatrix({
      ...captureInputs,
      artifactBundle: replaceArtifacts(captureInputs, {
        catalog: {
          ...captureInputs.artifactBundle.catalog,
          scenarios: [captureMetadata, { ...captureMetadata, id: "read.later" }],
        },
        manifest: {
          ...captureInputs.artifactBundle.manifest,
          scenarios: [
            {
              ...captureScenario,
              requests: [
                {
                  ...captureRequest,
                  captures: [
                    {
                      binding: "service-desc",
                      from: { kind: "header-link", rel: "service-desc" },
                    },
                  ],
                },
              ],
            },
            { ...captureScenario, id: "read.later" },
          ],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: captureExecute,
      harness: harness(),
    });
    expect(captureExecute).toHaveBeenCalledTimes(1);
    expect(capture.scenarios).toMatchObject([
      { state: "harness-error", category: "out-of-scope-target" },
      { id: "read.later", state: "harness-error", category: "not-run" },
    ]);

    const encodedEscape = await runConformanceMatrix({
      ...captureInputs,
      artifactBundle: replaceArtifacts(captureInputs, {
        manifest: {
          ...captureInputs.artifactBundle.manifest,
          scenarios: [
            {
              ...captureScenario,
              requests: [
                {
                  ...captureRequest,
                  captures: [
                    {
                      binding: "service-desc",
                      from: { kind: "header-link", rel: "service-desc" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {
          link: '<https://scope.example/root/%2f..%2fadmin>; rel="service-desc"',
        },
        bodyText: "",
      }),
      harness: harness(),
    });
    expect(encodedEscape.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "out-of-scope-target",
    });

    const transport = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => {
        throw new Error("connection reset");
      },
      harness: harness(),
    });
    expect(transport.scenarios[0]?.state).toBe("fail");
  });

  it("stops after cleanup cannot safely restore an already failed scenario", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (metadata === undefined || scenario === undefined || request === undefined)
      throw new Error("test inputs unexpectedly empty");
    const unsafeScenario = {
      ...scenario,
      requests: [
        {
          ...request,
          captures: [
            {
              binding: "service-desc",
              from: { kind: "header-link" as const, rel: "service-desc" },
            },
          ],
        },
      ],
    };

    for (const cleanupCase of [
      {
        expected: "cleanup failed",
        cleanup: async (): Promise<void> => {
          throw new Error("reset failed");
        },
      },
      {
        expected: "cleanup timed out",
        cleanup: async (): Promise<void> => await new Promise<never>(() => undefined),
      },
    ]) {
      const execute = vi.fn(async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: { link: '<https://foreign.example/bdp.json>; rel="service-desc"' },
        bodyText: "",
      }));
      const fixture = harness();
      vi.mocked(fixture.cleanup).mockImplementation(cleanupCase.cleanup);
      const result = await runConformanceMatrix({
        ...base,
        artifactBundle: replaceArtifacts(base, {
          catalog: {
            ...base.artifactBundle.catalog,
            scenarios: [metadata, { ...metadata, id: "read.later" }],
          },
          manifest: {
            ...base.artifactBundle.manifest,
            scenarios: [unsafeScenario, { ...scenario, id: "read.later" }],
          },
        }),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute,
        harness: fixture,
        cleanupTimeoutMs: 5,
      });

      expect(execute).toHaveBeenCalledTimes(1);
      expect(result.scenarios).toMatchObject([
        {
          id: "read.discovery",
          state: "harness-error",
          category: "out-of-scope-target",
          cleanupError: cleanupCase.expected,
        },
        { id: "read.later", state: "harness-error", category: "not-run" },
      ]);
    }
  });

  it("retains invalid response evidence without embedding the raw body", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 200 }]);
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [
            {
              ...scenario,
              requests: [{ ...request, target: { ...request.target, query: { token: "secret" } } }],
            },
          ],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/?token=secret",
        status: 200,
        headers: { "X-Result": "visible" },
        bodyText: "not-json-secret",
        effectiveRequest: {
          url: "https://scope.example/?token=secret",
          headers: { authorization: "Bearer secret", accept: "application/json" },
        },
      }),
      harness: harness(),
    });
    expect(result.scenarios[0]?.state).toBe("pass");
    expect(result.scenarios[0]?.exchanges[0]?.request.url).toBe(
      "https://scope.example/?<redacted>",
    );
    expect(result.scenarios[0]?.exchanges[0]?.request.url).not.toContain("secret");
    expect(result.scenarios[0]?.exchanges[0]?.request.url).not.toContain("token");
    expect(result.scenarios[0]?.exchanges[0]?.response).toMatchObject({
      bodyKind: "invalid-json",
      decodedBodyBytes: 15,
    });
    expect(result.scenarios[0]?.exchanges[0]?.request.headers.authorization).toBe("<redacted>");
    expect(result.scenarios[0]?.exchanges[0]?.response).not.toHaveProperty("bodyText");
  });

  it("materializes a repeated query key as repeated wire occurrences", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 200 }]);
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const execute = vi.fn(async (incoming: { url: string }) => ({
      url: incoming.url,
      status: 200,
      headers: {},
      bodyText: "",
    }));
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [
            {
              ...scenario,
              requests: [
                { ...request, target: { ...request.target, query: { limit: ["1", "2"] } } },
              ],
            },
          ],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });
    expect(result.scenarios[0]?.state).toBe("pass");
    expect(execute.mock.calls[0]?.[0]?.url).toBe("https://scope.example/?limit=1&limit=2");
  });

  it("runs exactly the scenarios an exact-id selection names and records the request", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    if (metadata === undefined || scenario === undefined)
      throw new Error("test inputs unexpectedly empty");
    const otherMetadata = { ...metadata, id: "read.other" };
    const otherScenario = { ...scenario, id: "read.other" };
    const execute = vi.fn(async () => ({
      url: "https://scope.example/",
      status: 204,
      headers: {},
      bodyText: "",
    }));

    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: { ...base.artifactBundle.catalog, scenarios: [metadata, otherMetadata] },
        manifest: { ...base.artifactBundle.manifest, scenarios: [scenario, otherScenario] },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
      scenarioSelection: ["read.other"],
    });

    expect(result.selectedScenarioIds).toEqual(["read.other"]);
    expect(result.scenarioSelection).toEqual(["read.other"]);
    expect(result.scenarios).toMatchObject([{ id: "read.other", state: "pass" }]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a selection names an unknown or inapplicable scenario", async () => {
    const base = inputs();

    await expect(
      runConformanceMatrix({
        ...base,
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: async () => {
          throw new Error("must not execute");
        },
        harness: harness(),
        scenarioSelection: ["read.discovery", "read.absent"],
      }),
    ).rejects.toThrow(
      "scenarioSelection names scenarios that are unknown or inapplicable: read.absent",
    );
  });

  it("refuses a selection combined with a substring filter", async () => {
    const base = inputs();

    await expect(
      runConformanceMatrix({
        ...base,
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: async () => {
          throw new Error("must not execute");
        },
        harness: harness(),
        scenarioFilter: "read",
        scenarioSelection: ["read.discovery"],
      }),
    ).rejects.toThrow("scenarioSelection and scenarioFilter are mutually exclusive");
  });

  it("does not copy expected header contents into assertion diagnostics", async () => {
    const secret = "Bearer assertion-secret";
    const result = await runConformanceMatrix({
      ...inputs([
        {
          id: "challenge",
          kind: "header",
          name: "www-authenticate",
          contains: secret,
        },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: { "www-authenticate": "Basic" },
        bodyText: "",
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "header 'www-authenticate' did not contain the expected value",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("does not copy target-controlled schema paths into assertion diagnostics", async () => {
    const secretPath = "/bearer-secret-field";
    const result = await runConformanceMatrix({
      ...inputs([{ id: "schema", kind: "json-schema", schema: "#/$defs/readDiscovery" }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({ "bearer-secret-field": false }),
      }),
      harness: harness(),
      schemaValidator: {
        resolve: () => undefined,
        validate: () => [{ instancePath: secretPath, message: "must be a string" }],
      },
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "response body must be a string",
    });
    expect(JSON.stringify(result)).not.toContain(secretPath);
    expect(JSON.stringify(result)).not.toContain("bearer-secret-field");
  });

  it("records only the size and shape of potentially sensitive JSON bodies", async () => {
    const result = await runConformanceMatrix({
      ...inputs([{ id: "status", kind: "status", equals: 200 }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({
          token: "opaque",
          next: "https://scope.example/beads/?cursor=opaque",
        }),
      }),
      harness: harness(),
    });
    expect(result.scenarios[0]?.exchanges[0]?.response).toMatchObject({
      bodyKind: "json",
      decodedBodyBytes: 70,
    });
    expect(result.scenarios[0]?.exchanges[0]?.response).not.toHaveProperty("body");
  });

  it("does not let an unrepresentable JSON value invalidate body-independent assertions", async () => {
    const result = await runConformanceMatrix({
      ...inputs([
        { id: "status", kind: "status", equals: 200 },
        { id: "mode", kind: "header", name: "x-mode", equals: "safe" },
        {
          id: "features",
          kind: "header-tokens",
          name: "x-features",
          includes: ["alpha", "beta"],
          allowsAdditional: false,
        },
        { id: "media", kind: "media-type", equals: "application/json" },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-mode": "safe",
          "x-features": "alpha, beta",
        },
        bodyText: '{"value":1e999}',
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "pass",
      exchanges: [
        {
          response: { bodyKind: "unrepresentable-json" },
          assertions: [
            { id: "status", passed: true },
            { id: "mode", passed: true },
            { id: "features", passed: true },
            { id: "media", passed: true },
          ],
        },
      ],
    });
  });

  it("keeps response and Link captures independent of unrepresentable JSON", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 200 }]);
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://scope.example/",
        status: 200,
        headers: {
          link: '<bdp.json>; rel="service-desc"',
          "content-type": "application/json",
        },
        bodyText: '{"value":1e999}',
      })
      .mockResolvedValueOnce({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: "{}",
      })
      .mockResolvedValueOnce({
        url: "https://scope.example/bdp.json",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: "{}",
      });
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [
            {
              ...scenario,
              requests: [
                {
                  ...request,
                  captures: [
                    { binding: "response-target", from: { kind: "response-url" } },
                    {
                      binding: "linked-target",
                      from: { kind: "header-link", rel: "service-desc" },
                    },
                  ],
                },
                {
                  ...request,
                  id: "response-target",
                  target: { binding: "response-target" },
                },
                {
                  ...request,
                  id: "linked-target",
                  target: { binding: "linked-target" },
                },
              ],
            },
          ],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });

    expect(result.scenarios[0]?.state).toBe("pass");
    expect(execute.mock.calls.map(([request]) => request.url)).toEqual([
      "https://scope.example/",
      "https://scope.example/",
      "https://scope.example/bdp.json",
    ]);
  });

  it("keeps body-absence checks on the raw observed body", async () => {
    const bodyText = '{"value":1e999}';
    const result = await runConformanceMatrix({
      ...inputs([{ id: "body", kind: "body-absent" }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText,
        bodyOctets: new TextEncoder().encode(bodyText).byteLength,
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "expected no response body octets",
      exchanges: [
        {
          response: { bodyKind: "unrepresentable-json" },
          assertions: [{ id: "body", passed: false, message: "expected no response body octets" }],
        },
      ],
    });
  });

  it("attributes BOM-only HEAD octets to body absence instead of the harness", async () => {
    const result = await runConformanceMatrix({
      ...inputs([{ id: "body", kind: "body-absent" }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: "\uFEFF",
        bodyOctets: 3,
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "expected no response body octets",
      exchanges: [
        {
          response: { wireBodyOctets: 3 },
          assertions: [{ id: "body", passed: false, message: "expected no response body octets" }],
        },
      ],
    });
  });

  it("fails closed when a body-absence assertion lacks wire-octet observation", async () => {
    const result = await runConformanceMatrix({
      ...inputs([{ id: "body", kind: "body-absent" }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {},
        bodyText: "",
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "wire-observation-unavailable",
      reason: "body-absence assertion requires raw wire-body observation",
    });
  });

  it.each([
    [
      "reason phrase",
      (sentinel: string) => `HTTP/1.1 500 ${sentinel}\r\nContent-Length: 0\r\n\r\n`,
      (_sentinel: string) => ({ headers: {}, bodyText: "", bodyOctets: 0 }),
    ],
    [
      "header",
      (sentinel: string) =>
        `HTTP/1.1 500 Internal Server Error\r\nX-Private-Debug: ${sentinel}\r\nContent-Length: 0\r\n\r\n`,
      (sentinel: string) => ({
        headers: { "x-private-debug": sentinel },
        bodyText: "",
        bodyOctets: 0,
      }),
    ],
    [
      "body",
      (sentinel: string) =>
        `HTTP/1.1 500 Internal Server Error\r\nContent-Length: ${sentinel.length}\r\n\r\n${sentinel}`,
      (sentinel: string) => ({
        headers: { "content-length": String(sentinel.length) },
        bodyText: sentinel,
        bodyOctets: sentinel.length,
      }),
    ],
  ])(
    "rejects a private fixture sentinel in the raw response %s",
    async (_location, rawResponse, parsed) => {
      const sentinel = "private-internal-fault-sentinel-6d131c92";
      const fixture = {
        ...testFixture,
        private: { internalFaultSentinel: sentinel },
      } as const satisfies ConformanceFixture;
      const result = await runConformanceMatrix({
        ...inputs(
          [
            { id: "status", kind: "status", equals: 500 },
            {
              id: "redacted",
              kind: "wire-not-contains",
              fixturePointer: "/private/internalFaultSentinel",
            },
            { id: "body", kind: "body-absent" },
          ],
          {},
          fixture,
        ),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: async () => ({
          url: "https://scope.example/",
          status: 500,
          ...parsed(sentinel),
          wireResponseBytes: new TextEncoder().encode(rawResponse(sentinel)),
        }),
        harness: harness(),
      });

      expect(result.scenarios[0]).toMatchObject({
        state: "fail",
        reason: "raw HTTP response contained a private fixture sentinel",
        exchanges: [
          {
            assertions: [
              {
                id: "redacted",
                passed: false,
                message: "raw HTTP response contained a private fixture sentinel",
              },
            ],
          },
        ],
      });
      expect(serializeConformanceReport(result)).not.toContain(sentinel);
    },
  );

  it("allows arbitrary safe response metadata when the private sentinel stays off-wire", async () => {
    const fixture = {
      ...testFixture,
      private: { internalFaultSentinel: "private-internal-fault-sentinel-930efa1d" },
    } as const satisfies ConformanceFixture;
    const result = await runConformanceMatrix({
      ...inputs(
        [
          {
            id: "redacted",
            kind: "wire-not-contains",
            fixturePointer: "/private/internalFaultSentinel",
          },
        ],
        {},
        fixture,
      ),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 500,
        headers: { "x-safe-metadata": "implementation-defined" },
        bodyText: "",
        bodyOctets: 0,
        wireResponseBytes: new TextEncoder().encode(
          "HTTP/1.1 500 Internal Server Error\r\nX-Safe-Metadata: implementation-defined\r\nContent-Length: 0\r\n\r\n",
        ),
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "pass",
      exchanges: [{ assertions: [{ id: "redacted", passed: true }] }],
    });
  });

  it("fails closed on absent, invalid, or oversized raw-wire evidence", async () => {
    const fixture = {
      ...testFixture,
      private: { internalFaultSentinel: "private-internal-fault-sentinel-f203d9ac" },
    } as const satisfies ConformanceFixture;
    const runInputs = inputs(
      [
        {
          id: "redacted",
          kind: "wire-not-contains",
          fixturePointer: "/private/internalFaultSentinel",
        },
      ],
      {},
      fixture,
    );
    const run = async (wireResponseBytes: Uint8Array | undefined) =>
      await runConformanceMatrix({
        ...runInputs,
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: async () => ({
          url: "https://scope.example/",
          status: 500,
          headers: {},
          bodyText: "",
          ...(wireResponseBytes === undefined ? {} : { wireResponseBytes }),
        }),
        harness: harness(),
      });

    await expect(run(undefined)).resolves.toMatchObject({
      scenarios: [
        {
          state: "harness-error",
          category: "wire-observation-unavailable",
          reason: "raw-wire noncontainment assertion requires exact response bytes",
        },
      ],
    });
    await expect(run({} as Uint8Array)).resolves.toMatchObject({
      scenarios: [
        { state: "harness-error", reason: "HTTP executor returned invalid raw-wire evidence" },
      ],
    });
    await expect(run(new Uint8Array(2_097_153))).resolves.toMatchObject({
      scenarios: [
        {
          state: "harness-error",
          reason: "HTTP executor raw-wire evidence exceeded its safety bound",
        },
      ],
    });
  });

  it("fails closed when CORS-header absence lacks an Origin-bearing effective request", async () => {
    const result = await runConformanceMatrix({
      ...inputs([
        {
          id: "cors-disabled",
          kind: "header",
          name: "access-control-allow-origin",
          absent: true,
        },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: {},
        bodyText: "",
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "wire-observation-unavailable",
      reason: "CORS-header absence assertion requires matching nonempty Origin evidence",
    });
  });

  it("accepts and records redacted Origin evidence for a CORS-header absence", async () => {
    const result = await runConformanceMatrix({
      ...inputs(
        [
          {
            id: "cors-disabled",
            kind: "header",
            name: "access-control-allow-origin",
            absent: true,
          },
        ],
        { origin: "https://cors-probe.invalid" },
      ),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: {},
        bodyText: "",
        effectiveRequest: {
          url: "https://scope.example/",
          headers: { Origin: "https://cors-probe.invalid" },
          headersTransmitted: true,
        },
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "pass",
      exchanges: [
        {
          request: {
            headers: { origin: "<redacted>" },
            wireHeadersObserved: true,
          },
        },
      ],
    });
  });

  it("fails closed when CORS evidence reports planned rather than serialized headers", async () => {
    const execute = createFetchHttpExchangeExecutor(
      vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch,
    );
    const result = await runConformanceMatrix({
      ...inputs(
        [
          {
            id: "cors-disabled",
            kind: "header",
            name: "access-control-allow-origin",
            absent: true,
          },
        ],
        { origin: "https://cors-probe.invalid" },
      ),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "wire-observation-unavailable",
      reason: "CORS-header absence assertion requires serialized wire-request evidence",
    });
  });

  it("fails closed when effective CORS evidence substitutes the requested Origin", async () => {
    const result = await runConformanceMatrix({
      ...inputs(
        [
          {
            id: "cors-disabled",
            kind: "header",
            name: "access-control-allow-origin",
            absent: true,
          },
        ],
        { origin: "https://cors-probe.invalid" },
      ),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: {},
        bodyText: "",
        effectiveRequest: {
          url: "https://scope.example/",
          headers: { origin: "https://substituted.invalid" },
          headersTransmitted: true,
        },
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "wire-observation-unavailable",
      reason: "CORS-header absence assertion requires matching nonempty Origin evidence",
    });
  });

  it("fails closed when preflight method evidence differs from the serialized request", async () => {
    const result = await runConformanceMatrix({
      ...inputs(
        [
          {
            id: "cors-disabled",
            kind: "header",
            name: "access-control-allow-methods",
            absent: true,
          },
        ],
        {
          origin: "https://cors-probe.invalid",
          "access-control-request-method": "GET",
        },
      ),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 405,
        headers: {},
        bodyText: "",
        effectiveRequest: {
          url: "https://scope.example/",
          headers: {
            origin: "https://cors-probe.invalid",
            "access-control-request-method": "POST",
          },
          headersTransmitted: true,
        },
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "wire-observation-unavailable",
      reason:
        "CORS-header absence assertion requires matching nonempty Access-Control-Request-Method evidence",
    });
  });

  it("compares HEAD status and stable metadata with an earlier GET exchange", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 200 }]);
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (scenario === undefined || request === undefined)
      throw new Error("test inputs unexpectedly empty");
    const manifest = parseExecutableScenarioManifest({
      ...base.artifactBundle.manifest,
      scenarios: [
        {
          ...scenario,
          requests: [
            request,
            {
              ...request,
              id: "head",
              method: "HEAD",
              assertions: [
                {
                  id: "metadata",
                  kind: "response-metadata-equals",
                  request: request.id,
                  headers: ["content-length", "content-type"],
                },
                { id: "body", kind: "body-absent" },
              ],
            },
          ],
        },
      ],
    });
    const execute = vi.fn(
      async ({ method }: { readonly method: string }): Promise<HttpExchangeResponse> => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-length": "2", "content-type": "application/json" },
        bodyText: method === "HEAD" ? "" : "{}",
        bodyOctets: method === "HEAD" ? 0 : 2,
      }),
    );

    const passing = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, { manifest }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });
    expect(passing.scenarios[0]).toMatchObject({ state: "pass" });

    execute.mockResolvedValueOnce({
      url: "https://scope.example/",
      status: 200,
      headers: {},
      bodyText: "{}",
      bodyOctets: 2,
    });
    execute.mockResolvedValueOnce({
      url: "https://scope.example/",
      status: 200,
      headers: {},
      bodyText: "",
      bodyOctets: 0,
    });
    const mutuallyAbsent = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, { manifest }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });
    expect(mutuallyAbsent.scenarios[0]).toMatchObject({ state: "pass" });

    execute.mockResolvedValueOnce({
      url: "https://scope.example/",
      status: 200,
      headers: { "content-length": "2", "content-type": "application/json" },
      bodyText: "{}",
      bodyOctets: 2,
    });
    execute.mockResolvedValueOnce({
      url: "https://scope.example/",
      status: 200,
      headers: { "content-length": "3", "content-type": "application/json" },
      bodyText: "",
      bodyOctets: 0,
    });
    const failing = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, { manifest }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });
    expect(failing.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "response metadata did not match request 'scope'",
    });
  });

  it.each([
    {
      bodyText: '{"next":1e999}',
      bodyKind: "unrepresentable-json",
      reason:
        "response JSON contained a number that is not representable as a finite runtime value",
    },
    { bodyText: "", bodyKind: "empty", reason: "response body was not valid JSON" },
    { bodyText: "{", bodyKind: "invalid-json", reason: "response body was not valid JSON" },
  ])("attributes a $bodyKind JSON-pointer capture to the target and continues", async (sample) => {
    const base = inputs([{ id: "status", kind: "status", equals: 200 }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (metadata === undefined || scenario === undefined || request === undefined)
      throw new Error("test inputs unexpectedly empty");
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: sample.bodyText,
      })
      .mockResolvedValueOnce({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: "{}",
      });
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: {
          ...base.artifactBundle.catalog,
          scenarios: [metadata, { ...metadata, id: "read.later" }],
        },
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [
            {
              ...scenario,
              requests: [
                {
                  ...request,
                  captures: [{ binding: "next", from: { kind: "json-pointer", pointer: "/next" } }],
                },
              ],
            },
            { ...scenario, id: "read.later" },
          ],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.scenarios).toMatchObject([
      {
        id: "read.discovery",
        state: "fail",
        reason: sample.reason,
        exchanges: [{ assertions: [{ id: "status", passed: true }] }],
      },
      { id: "read.later", state: "pass" },
    ]);
  });

  it.each([
    { bodyText: "", bodyKind: "empty" },
    { bodyText: "{", bodyKind: "invalid-json" },
  ])("reports an unparseable $bodyKind body before JSON value comparison", async (sample) => {
    const result = await runConformanceMatrix({
      ...inputs([{ id: "body", kind: "json-equals", value: {} }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: sample.bodyText,
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "response body was not valid JSON",
      exchanges: [
        {
          response: { bodyKind: sample.bodyKind },
          assertions: [{ id: "body", passed: false, message: "response body was not valid JSON" }],
        },
      ],
    });
  });

  it.each([
    { bodyText: "", bodyKind: "empty" },
    { bodyText: "{", bodyKind: "invalid-json" },
  ])("rejects an unparseable $bodyKind body before schema validation", async (sample) => {
    const validate = vi.fn(() => []);
    const result = await runConformanceMatrix({
      ...inputs([{ id: "body", kind: "json-schema", schema: "#/$defs/readDiscovery" }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: sample.bodyText,
      }),
      harness: harness(),
      schemaValidator: { resolve: () => undefined, validate },
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "fail",
      reason: "response body was not valid JSON",
      exchanges: [
        {
          response: { bodyKind: sample.bodyKind },
          assertions: [{ id: "body", passed: false, message: "response body was not valid JSON" }],
        },
      ],
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it("attributes an unrepresentable JSON value to a body-consuming assertion and continues", async () => {
    const base = inputs([{ id: "root", kind: "json-pointer", pointer: "", exists: true }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    if (metadata === undefined || scenario === undefined)
      throw new Error("test inputs unexpectedly empty");
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: '{"value":1e999}',
      })
      .mockResolvedValueOnce({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: "{}",
      });
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: {
          ...base.artifactBundle.catalog,
          scenarios: [metadata, { ...metadata, id: "read.later" }],
        },
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [scenario, { ...scenario, id: "read.later" }],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.scenarios).toMatchObject([
      {
        id: "read.discovery",
        state: "fail",
        reason:
          "response JSON contained a number that is not representable as a finite runtime value",
        exchanges: [
          {
            response: { bodyKind: "unrepresentable-json" },
            assertions: [
              {
                id: "root",
                passed: false,
                message:
                  "response JSON contained a number that is not representable as a finite runtime value",
              },
            ],
          },
        ],
      },
      { id: "read.later", state: "pass" },
    ]);
  });

  it("reports valid over-limit target JSON locally and continues independent scenarios", async () => {
    const depth = 129;
    const base = inputs([{ id: "root", kind: "json-pointer", pointer: "", exists: true }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    if (metadata === undefined || scenario === undefined)
      throw new Error("test inputs unexpectedly empty");
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: `${"[".repeat(depth)}0${"]".repeat(depth)}`,
      })
      .mockResolvedValueOnce({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: "{}",
      });
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: {
          ...base.artifactBundle.catalog,
          scenarios: [metadata, { ...metadata, id: "read.later" }],
        },
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [scenario, { ...scenario, id: "read.later" }],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.scenarios).toMatchObject([
      {
        id: "read.discovery",
        state: "harness-error",
        category: "observation-limit",
        reason: "response JSON exceeded the runner depth limit of 128",
        exchanges: [{ response: { bodyKind: "unrepresentable-json" } }],
      },
      { id: "read.later", state: "pass" },
    ]);
  });

  it.each([
    {
      name: "node",
      bodyText: JSON.stringify(Array.from({ length: 101 }, () => Array(1_000).fill(0))),
      reason: "response JSON exceeded the runner node limit of 100000",
    },
    {
      name: "per-container entry",
      bodyText: JSON.stringify(Array(10_001).fill(0)),
      reason: "response JSON exceeded the runner per-container entry limit of 10000",
    },
  ])(
    "reports a $name bound locally and continues independent scenarios",
    async ({ bodyText, reason }) => {
      const base = inputs([{ id: "root", kind: "json-pointer", pointer: "", exists: true }]);
      const metadata = base.artifactBundle.catalog.scenarios[0];
      const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
      if (metadata === undefined || scenario === undefined)
        throw new Error("test inputs unexpectedly empty");
      const execute = vi
        .fn()
        .mockResolvedValueOnce({
          url: "https://scope.example/",
          status: 200,
          headers: { "content-type": "application/json" },
          bodyText,
        })
        .mockResolvedValueOnce({
          url: "https://scope.example/",
          status: 200,
          headers: { "content-type": "application/json" },
          bodyText: "{}",
        });
      const result = await runConformanceMatrix({
        ...base,
        artifactBundle: replaceArtifacts(base, {
          catalog: {
            ...base.artifactBundle.catalog,
            scenarios: [metadata, { ...metadata, id: "read.later" }],
          },
          manifest: {
            ...base.artifactBundle.manifest,
            scenarios: [scenario, { ...scenario, id: "read.later" }],
          },
        }),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute,
        harness: harness(),
      });

      expect(execute).toHaveBeenCalledTimes(2);
      expect(result.scenarios).toMatchObject([
        {
          id: "read.discovery",
          state: "harness-error",
          category: "observation-limit",
          reason,
          exchanges: [{ response: { bodyKind: "unrepresentable-json" } }],
        },
        { id: "read.later", state: "pass" },
      ]);
    },
  );

  it("gives runner safety bounds precedence over target-value attribution", async () => {
    const thousandNodes = `[${Array(1_000).fill("0").join(",")}]`;
    const bodyText = `[${Array(100).fill(thousandNodes).join(",")},1e999]`;
    const result = await runConformanceMatrix({
      ...inputs([{ id: "root", kind: "json-pointer", pointer: "", exists: true }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText,
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "observation-limit",
      reason: "response JSON exceeded the runner node limit of 100000",
    });
  });

  it("uses own properties and canonical array indices for JSON Pointer", async () => {
    const result = await runConformanceMatrix({
      ...inputs([
        { id: "prototype", kind: "json-pointer", pointer: "/constructor", exists: false },
        { id: "index", kind: "json-pointer", pointer: "/items/01", exists: false },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "content-type": "application/json" },
        bodyText: JSON.stringify({ items: [1, 2] }),
      }),
      harness: harness(),
    });
    expect(result.scenarios[0]?.state).toBe("pass");
  });

  it("parses media types exactly while allowing case and parameters", async () => {
    const run = async (contentType: string) =>
      await runConformanceMatrix({
        ...inputs([{ id: "media", kind: "media-type", equals: "application/json" }]),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: async () => ({
          url: "https://scope.example/",
          status: 200,
          headers: { "Content-Type": contentType },
          bodyText: "{}",
        }),
        harness: harness(),
      });
    await expect(run("Application/JSON; Charset=UTF-8")).resolves.toMatchObject({
      scenarios: [{ state: "pass" }],
    });
    await expect(run("text/application/json-fake")).resolves.toMatchObject({
      scenarios: [{ state: "fail" }],
    });
  });

  it("compares Allow methods case-sensitively and rejects undeclared extras", async () => {
    const run = async (allow: string) =>
      await runConformanceMatrix({
        ...inputs([
          {
            id: "allow",
            kind: "header-tokens",
            name: "allow",
            includes: ["GET", "HEAD"],
            optional: ["OPTIONS"],
            allowsAdditional: false,
          },
        ]),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: async () => ({
          url: "https://scope.example/",
          status: 405,
          headers: { Allow: allow },
          bodyText: "",
        }),
        harness: harness(),
      });
    await expect(run("HEAD, GET")).resolves.toMatchObject({ scenarios: [{ state: "pass" }] });
    await expect(run("HEAD, GET, OPTIONS")).resolves.toMatchObject({
      scenarios: [{ state: "pass" }],
    });
    await expect(run("get, head")).resolves.toMatchObject({ scenarios: [{ state: "fail" }] });
    await expect(run("GET, HEAD, POST")).resolves.toMatchObject({
      scenarios: [{ state: "fail" }],
    });
  });

  it("compares Cache-Control directive names case-insensitively when declared", async () => {
    const result = await runConformanceMatrix({
      ...inputs([
        {
          id: "cache-control",
          kind: "header-tokens",
          name: "cache-control",
          includes: ["private", "no-store"],
          allowsAdditional: false,
          caseInsensitive: true,
        },
      ]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 200,
        headers: { "cache-control": "Private, No-Store" },
        bodyText: "{}",
      }),
      harness: harness(),
    });

    expect(result.scenarios[0]).toMatchObject({ state: "pass" });
  });

  it("rejects noncanonical Scope URLs before contacting a target", async () => {
    await expect(
      runConformanceMatrix({
        ...inputs(),
        scope: "https://scope.example/root?cursor=unsafe",
        profile: "read",
        seed: 0,
        execute: vi.fn(),
        harness: harness(),
      }),
    ).rejects.toThrow("scope must be an absolute credential-free HTTP(S) URL ending in '/'");
    await expect(
      runConformanceMatrix({
        ...inputs(),
        scope: "https://scope.example/%41/",
        profile: "read",
        seed: 0,
        execute: vi.fn(),
        harness: harness(),
      }),
    ).rejects.toThrow("scope must be an absolute credential-free HTTP(S) URL ending in '/'");
  });

  it("rejects noncanonical target URL percent encoding", async () => {
    const run = async (url: string) =>
      await runConformanceMatrix({
        ...inputs([{ id: "status", kind: "status", equals: 204 }]),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: async () => ({ url, status: 204, headers: {}, bodyText: "" }),
        harness: harness(),
      });
    await expect(run("https://scope.example/%41")).resolves.toMatchObject({
      scenarios: [{ state: "fail" }],
    });
    await expect(run("https://scope.example/%2a")).resolves.toMatchObject({
      scenarios: [{ state: "fail" }],
    });
  });

  it("uses standard relative URL resolution for resource bindings", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const execute = vi.fn(async () => ({
      url: "https://scope.example/beads/child",
      status: 204,
      headers: {},
      bodyText: "",
    }));
    await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        fixture: { ...base.artifactBundle.fixture, bindings: { resource: "beads/demo-a" } },
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [
            {
              ...scenario,
              requests: [{ ...request, target: { binding: "resource", path: "child" } }],
            },
          ],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: {
        prepare: async () => ({
          capabilities: ["public-http"],
          bindings: { resource: "https://scope.example/beads/demo-a" },
        }),
        cleanup: async () => undefined,
      },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://scope.example/beads/child" }),
    );
  });

  it("materializes fixture query bindings in absolute and Scope-relative forms", async () => {
    const base = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const execute = vi.fn(async ({ url }: { readonly url: string }) => ({
      url,
      status: 204,
      headers: {},
      bodyText: "",
    }));
    await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        fixture: {
          ...base.artifactBundle.fixture,
          bindings: { resource: "beads/demo-a" },
        },
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [
            {
              ...scenario,
              requests: [
                {
                  ...request,
                  target: {
                    binding: "scope",
                    query: {
                      source: { binding: "resource", representation: "scope-relative-url" },
                      target: { binding: "resource", representation: "absolute-url" },
                    },
                  },
                },
              ],
            },
          ],
        },
      }),
      scope: "https://scope.example/local-test/",
      profile: "read",
      seed: 0,
      execute,
      harness: {
        prepare: async () => ({
          capabilities: ["public-http"],
          bindings: { resource: "https://scope.example/local-test/beads/demo-a" },
        }),
        cleanup: async () => undefined,
      },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://scope.example/local-test/?source=beads%2Fdemo-a&target=https%3A%2F%2Fscope.example%2Flocal-test%2Fbeads%2Fdemo-a",
      }),
    );
  });

  it("bounds fixture preparation even when the harness ignores its signal", async () => {
    const fixture = harness();
    vi.mocked(fixture.prepare).mockImplementation(
      async () => await new Promise<never>(() => undefined),
    );
    const result = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: vi.fn(),
      harness: fixture,
      prepareTimeoutMs: 5,
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "deadline",
      reason: "fixture preparation timed out",
      cleanupError: "cleanup skipped because fixture preparation did not settle",
    });
    expect(fixture.cleanup).not.toHaveBeenCalled();
  });

  it("rejects fixture bindings that shadow Scope or a scenario capture", async () => {
    const scopeShadow = harness();
    vi.mocked(scopeShadow.prepare).mockResolvedValue({
      capabilities: ["public-http"],
      bindings: { scope: "https://foreign.example/" },
    });
    const execute = vi.fn();
    const scopeInputs = inputs();
    const scopeResult = await runConformanceMatrix({
      ...scopeInputs,
      artifactBundle: fixtureWithBindings(scopeInputs, { scope: "scope" }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: scopeShadow,
    });
    expect(scopeResult.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "fixture bindings must not shadow Scope",
    });
    expect(execute).not.toHaveBeenCalled();

    const escapedBinding = harness();
    vi.mocked(escapedBinding.prepare).mockResolvedValue({
      capabilities: ["public-http"],
      bindings: { resource: "https://foreign.example/beads/demo-a" },
    });
    const escapedInputs = inputs();
    const escapedResult = await runConformanceMatrix({
      ...escapedInputs,
      artifactBundle: fixtureWithBindings(escapedInputs, { resource: "beads/demo-a" }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: escapedBinding,
    });
    expect(escapedResult.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "fixture binding must resolve within the canonical Scope",
    });
    expect(execute).not.toHaveBeenCalled();

    const secretNamedBinding = harness();
    vi.mocked(secretNamedBinding.prepare).mockResolvedValue({
      capabilities: ["public-http"],
      bindings: { "bearer-binding-secret": "https://foreign.example/beads/demo-a" },
    });
    const secretInputs = inputs();
    const secretNamedResult = await runConformanceMatrix({
      ...secretInputs,
      artifactBundle: fixtureWithBindings(secretInputs, {
        "bearer-binding-secret": "beads/demo-a",
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: secretNamedBinding,
    });
    expect(secretNamedResult.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "fixture binding must resolve within the canonical Scope",
    });
    expect(JSON.stringify(secretNamedResult)).not.toContain("bearer-binding-secret");
    expect(execute).not.toHaveBeenCalled();

    const captureInputs = inputs([{ id: "status", kind: "status", equals: 204 }]);
    const scenario = requestScenario(captureInputs.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (scenario === undefined || request === undefined)
      throw new Error("test manifest unexpectedly empty");
    const captureShadow = harness();
    vi.mocked(captureShadow.prepare).mockResolvedValue({
      capabilities: ["public-http"],
      bindings: { "service-desc": "bdp.json" },
    });
    const captureResult = await runConformanceMatrix({
      ...captureInputs,
      artifactBundle: replaceArtifacts(captureInputs, {
        fixture: {
          ...captureInputs.artifactBundle.fixture,
          bindings: { "service-desc": "bdp.json" },
        },
        manifest: {
          ...captureInputs.artifactBundle.manifest,
          scenarios: [
            {
              ...scenario,
              requests: [
                {
                  ...request,
                  captures: [{ binding: "service-desc", from: { kind: "response-url" } }],
                },
              ],
            },
          ],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: captureShadow,
    });
    expect(captureResult.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "capture 'service-desc' shadows an established binding",
    });
    expect(execute).not.toHaveBeenCalled();

    const unsafeName = harness();
    vi.mocked(unsafeName.prepare).mockResolvedValue({
      capabilities: ["public-http"],
      bindings: { "Bearer BINDING-SECRET": "beads/a" },
    });
    const unsafe = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: unsafeName,
    });
    expect(unsafe.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "fixture preparation binding names must match the bound fixture",
    });
    expect(JSON.stringify(unsafe)).not.toContain("BINDING-SECRET");
  });

  it("treats invalid executor authorization setup as a harness error", async () => {
    const fetchMock = vi.fn();
    const execute = createFetchHttpExchangeExecutor(fetchMock as typeof fetch, () => ({
      "bad header": "invalid",
    }));
    const result = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "HTTP executor configuration failed",
      exchanges: [{ transportError: { category: "configuration" } }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects and redacts an unsafe executor-supplied effective request", async () => {
    const result = await runConformanceMatrix({
      ...inputs([{ id: "status", kind: "status", equals: 204 }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {},
        bodyText: "",
        bodyOctets: 0,
        effectiveRequest: {
          url: "https://scope.example/#secret-fragment",
          headers: { authorization: "Bearer secret" },
        },
      }),
      harness: harness(),
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "HTTP executor returned an unsafe effective request",
    });
    expect(JSON.stringify(result)).not.toContain("secret-fragment");
    expect(JSON.stringify(result)).not.toContain("Bearer secret");
  });

  it("rejects an executor-supplied effective request with a changed query", async () => {
    const result = await runConformanceMatrix({
      ...inputs([{ id: "status", kind: "status", equals: 204 }]),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {},
        bodyText: "",
        effectiveRequest: {
          url: "https://scope.example/?unexpected=true",
          headers: {},
        },
      }),
      harness: harness(),
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "HTTP executor returned an unsafe effective request",
    });
  });

  it("bounds a custom executor even when it ignores the request signal", async () => {
    const fixture = harness();
    const result = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => await new Promise<never>(() => undefined),
      harness: fixture,
      requestTimeoutMs: 5,
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "deadline",
      reason: "HTTP transport failed (timeout)",
      cleanupError: "cleanup skipped because an HTTP exchange did not settle",
      exchanges: [
        { transportError: { category: "timeout", message: "HTTP transport failed (timeout)" } },
      ],
    });
    expect(fixture.cleanup).not.toHaveBeenCalled();
  });

  it("does not start later scenarios after an uncontained deadline", async () => {
    const base = inputs();
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    if (metadata === undefined || scenario === undefined)
      throw new Error("test inputs unexpectedly empty");
    const fixture = harness();
    vi.mocked(fixture.prepare).mockImplementation(
      async () => await new Promise<never>(() => undefined),
    );
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: {
          ...base.artifactBundle.catalog,
          scenarios: [metadata, { ...metadata, id: "read.second" }],
        },
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [scenario, { ...scenario, id: "read.second" }],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: vi.fn(),
      harness: fixture,
      prepareTimeoutMs: 5,
    });
    expect(fixture.prepare).toHaveBeenCalledTimes(1);
    expect(result.scenarios).toMatchObject([
      { id: "read.discovery", category: "deadline", state: "harness-error" },
      { id: "read.second", category: "not-run", state: "harness-error" },
    ]);
  });

  it("rejects timeout values that exceed the Node timer range", async () => {
    await expect(
      runConformanceMatrix({
        ...inputs(),
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute: vi.fn(),
        harness: harness(),
        requestTimeoutMs: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toThrow("requestTimeoutMs must be an integer from 1 to 2147483647");
    expect(() =>
      createFetchHttpExchangeExecutor(fetch, undefined, 1024, Number.MAX_SAFE_INTEGER),
    ).toThrow("requestTimeoutMs must be an integer from 1 to 2147483647");
  });

  it("validates safety-critical run identity, profile, and filter options before execution", async () => {
    const base = inputs();
    const execute = vi.fn();
    const run = async (overrides: Partial<Parameters<typeof runConformanceMatrix>[0]>) =>
      await runConformanceMatrix({
        ...base,
        scope: "https://scope.example/",
        profile: "read",
        seed: 0,
        execute,
        harness: harness(),
        ...overrides,
      });
    await expect(run({ seed: -1 })).rejects.toThrow("seed must be a non-negative safe integer");
    await expect(run({ seed: 1 })).rejects.toThrow("seed must equal the bound fixture seed");
    for (const declaredTargetLabel of ["", "Bearer TARGET-SECRET", "a".repeat(129)])
      await expect(run({ declaredTargetLabel })).rejects.toThrow(
        "declaredTargetLabel must be 1..128 lowercase identifier characters",
      );
    await expect(run({ profile: "read-update" })).rejects.toThrow(
      "read-v1 executable scaffold currently supports targets advertising the Read profile only",
    );
    await expect(run({ scenarioFilter: "" })).rejects.toThrow("scenarioFilter must not be empty");
    await expect(run({ scenarioFilter: "missing" })).rejects.toThrow(
      "scenarioFilter matched no applicable scenarios",
    );
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    if (scenario === undefined) throw new Error("test manifest unexpectedly empty");
    await expect(
      run({
        artifactBundle: replaceArtifacts(base, {
          manifest: {
            ...base.artifactBundle.manifest,
            scenarios: [{ ...scenario, id: "read.unknown" }],
          },
        }),
      }),
    ).rejects.toThrow("executable plan 'read.unknown' has no catalog metadata");
    const request = scenario.requests[0];
    if (request === undefined) throw new Error("test manifest unexpectedly empty");
    await expect(
      run({
        artifactBundle: replaceArtifacts(base, {
          manifest: {
            ...base.artifactBundle.manifest,
            scenarios: [
              {
                ...scenario,
                id: "read.unknown",
                requests: [
                  { ...request, prerequisiteScenario: "read.discovery" },
                  { ...request, id: "owned" },
                ],
              },
            ],
          },
        }),
      }),
    ).rejects.toThrow("executable plan 'read.unknown' has no catalog metadata");
    await expect(
      run({
        artifactBundle: replaceArtifacts(base, {
          manifest: {
            ...base.artifactBundle.manifest,
            scenarios: [
              {
                ...scenario,
                requests: [
                  { ...request, prerequisiteScenario: "read.discovery.missing" },
                  { ...request, id: "owned" },
                ],
              },
            ],
          },
        }),
      }),
    ).rejects.toThrow("references unknown prerequisite scenario 'read.discovery.missing'");
    await expect(
      run({
        artifactBundle: replaceArtifacts(base, {
          manifest: {
            ...base.artifactBundle.manifest,
            scenarios: [
              {
                ...scenario,
                requests: [
                  { ...request, prerequisiteScenario: scenario.id },
                  { ...request, id: "owned" },
                ],
              },
            ],
          },
        }),
      }),
    ).rejects.toThrow("cannot use its own scenario as a prerequisite");
    expect(() =>
      replaceArtifacts(base, {
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [
            {
              ...scenario,
              requests: [
                {
                  ...request,
                  method: "DELETE",
                  headers: { authorization: "Bearer HARNESS-SECRET" },
                },
              ],
            },
          ],
        },
      }),
    ).toThrow("validation failed");
    await expect(run({ artifactBundle: { ...base.artifactBundle } })).rejects.toThrow(
      "artifact bundle failed runtime provenance validation",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("snapshots the factory-created artifact bundle once before any await", async () => {
    const base = inputs();
    const forged = {
      ...base.artifactBundle,
      digests: {
        catalogDigest: "a".repeat(64),
        manifestDigest: "b".repeat(64),
        fixtureDigest: "c".repeat(64),
      },
    } as ConformanceArtifactBundle;
    const execute = vi.fn(async () => ({
      url: "https://scope.example/",
      status: 204,
      headers: {},
      bodyText: "",
    }));
    let reads = 0;
    const alternatingOptions = {
      scope: "https://scope.example/",
      profile: "read" as const,
      seed: 0,
      execute,
      harness: harness(),
      declaredTargetLabel: base.declaredTargetLabel,
    } as unknown as Omit<Parameters<typeof runConformanceMatrix>[0], "artifactBundle"> & {
      readonly artifactBundle: ConformanceArtifactBundle;
    };
    Object.defineProperty(alternatingOptions, "artifactBundle", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? base.artifactBundle : forged;
      },
    });

    const alternatingResult = await runConformanceMatrix(alternatingOptions);
    expect(reads).toBe(1);
    expect(alternatingResult.artifacts).toEqual(base.artifactBundle.digests);

    const mutableOptions: Parameters<typeof runConformanceMatrix>[0] = {
      ...alternatingOptions,
      artifactBundle: base.artifactBundle,
      harness: {
        prepare: async () => {
          (mutableOptions as { artifactBundle: ConformanceArtifactBundle }).artifactBundle = forged;
          return { capabilities: ["public-http"] };
        },
        cleanup: async () => undefined,
      },
    };
    const mutationResult = await runConformanceMatrix(mutableOptions);
    expect(mutationResult.artifacts).toEqual(base.artifactBundle.digests);
  });

  it("rejects prerequisite filters and ordering errors before execution", async () => {
    const base = inputs();
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    const request = scenario?.requests[0];
    if (metadata === undefined || scenario === undefined || request === undefined)
      throw new Error("test inputs unexpectedly empty");
    const dependentMetadata = { ...metadata, id: "read.collections.beads" };
    const dependentScenario = {
      ...scenario,
      id: "read.collections.beads",
      requests: [
        { ...request, prerequisiteScenario: "read.discovery" },
        { ...request, id: "owned" },
      ],
    };
    const execute = vi.fn();
    const common = {
      ...base,
      scope: "https://scope.example/",
      profile: "read" as const,
      seed: 0,
      execute,
      harness: harness(),
    };

    await expect(
      runConformanceMatrix({
        ...common,
        artifactBundle: replaceArtifacts(base, {
          catalog: { ...base.artifactBundle.catalog, scenarios: [metadata, dependentMetadata] },
          manifest: {
            ...base.artifactBundle.manifest,
            scenarios: [scenario, dependentScenario],
          },
        }),
        scenarioFilter: "collections",
      }),
    ).rejects.toThrow(
      "scenarioFilter selects dependent scenario 'read.collections.beads' but excludes prerequisite 'read.discovery'",
    );
    await expect(
      runConformanceMatrix({
        ...common,
        artifactBundle: replaceArtifacts(base, {
          catalog: { ...base.artifactBundle.catalog, scenarios: [dependentMetadata, metadata] },
          manifest: {
            ...base.artifactBundle.manifest,
            scenarios: [dependentScenario, scenario],
          },
        }),
      }),
    ).rejects.toThrow(
      "scenario 'read.collections.beads' prerequisite 'read.discovery' must appear earlier in catalog order",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("classifies caller cancellation as a harness-side abort", async () => {
    const controller = new AbortController();
    const fixture = harness();
    const result = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => {
        controller.abort();
        return await new Promise<never>(() => undefined);
      },
      harness: fixture,
      signal: controller.signal,
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      reason: "scenario run was aborted",
      cleanupError: "cleanup skipped because an HTTP exchange did not settle",
      exchanges: [{ transportError: { category: "abort" } }],
    });
    expect(fixture.cleanup).not.toHaveBeenCalled();
  });

  it("bounds cooperative fixture cleanup and prevents a passing scenario", async () => {
    const bounded = harness();
    vi.mocked(bounded.cleanup).mockImplementation(
      async (_scenario, _scope, signal) =>
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cleanup timed out")), {
            once: true,
          });
        }),
    );
    const result = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {},
        bodyText: "",
        bodyOctets: 0,
      }),
      harness: bounded,
      cleanupTimeoutMs: 1,
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "deadline",
      cleanupError: "cleanup timed out",
    });
  });

  it("enforces the cleanup deadline when a harness ignores its signal", async () => {
    const uncooperative = harness();
    vi.mocked(uncooperative.cleanup).mockImplementation(
      async () => await new Promise<void>(() => undefined),
    );
    const result = await runConformanceMatrix({
      ...inputs(),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute: async () => ({
        url: "https://scope.example/",
        status: 204,
        headers: {},
        bodyText: "",
        bodyOctets: 0,
      }),
      harness: uncooperative,
      cleanupTimeoutMs: 5,
    });
    expect(result.scenarios[0]).toMatchObject({
      state: "harness-error",
      category: "deadline",
      cleanupError: "cleanup timed out",
    });
  });

  it("bounds response bodies before returning an observation", async () => {
    const execute = createFetchHttpExchangeExecutor(
      vi.fn(async () => new Response("12345", { status: 200 })) as typeof fetch,
      undefined,
      4,
    );
    await expect(
      execute({
        method: "GET",
        url: "https://scope.example/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "body-limit" });
  });

  it("reports a response byte bound locally and continues independent scenarios", async () => {
    const boundedFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("12345", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const execute = createFetchHttpExchangeExecutor(boundedFetch as typeof fetch, undefined, 4);
    const base = inputs([{ id: "status", kind: "status", equals: 200 }]);
    const metadata = base.artifactBundle.catalog.scenarios[0];
    const scenario = requestScenario(base.artifactBundle.manifest.scenarios[0]);
    if (metadata === undefined || scenario === undefined)
      throw new Error("test inputs unexpectedly empty");
    const result = await runConformanceMatrix({
      ...base,
      artifactBundle: replaceArtifacts(base, {
        catalog: {
          ...base.artifactBundle.catalog,
          scenarios: [metadata, { ...metadata, id: "read.later" }],
        },
        manifest: {
          ...base.artifactBundle.manifest,
          scenarios: [scenario, { ...scenario, id: "read.later" }],
        },
      }),
      scope: "https://scope.example/",
      profile: "read",
      seed: 0,
      execute,
      harness: harness(),
    });

    expect(boundedFetch).toHaveBeenCalledTimes(2);
    expect(result.scenarios).toMatchObject([
      {
        state: "harness-error",
        category: "observation-limit",
        reason: "HTTP response exceeded the configured executor body limit",
        exchanges: [
          {
            transportError: {
              category: "body-limit",
              message: "HTTP response exceeded the configured executor body limit",
            },
          },
        ],
      },
      { id: "read.later", state: "pass" },
    ]);
  });

  it("does not wait for an uncooperative body cancellation after the limit", async () => {
    const execute = createFetchHttpExchangeExecutor(
      vi.fn(
        async () =>
          ({
            body: {
              getReader: () => ({
                read: async () => ({ done: false, value: Uint8Array.from([1, 2]) }),
                cancel: async () => await new Promise<never>(() => undefined),
                releaseLock: () => undefined,
              }),
            },
            headers: new Headers(),
            status: 200,
            url: "https://scope.example/",
          }) as unknown as Response,
      ) as typeof fetch,
      undefined,
      1,
    );
    await expect(
      execute({
        method: "GET",
        url: "https://scope.example/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "body-limit" });
  });

  it("times out a response body that never produces another byte", async () => {
    const execute = createFetchHttpExchangeExecutor(
      vi.fn(
        async () =>
          ({
            body: {
              getReader: () => ({
                read: () => new Promise<never>(() => undefined),
                cancel: async () => undefined,
                releaseLock: () => undefined,
              }),
            },
            headers: new Headers(),
            status: 200,
            url: "https://scope.example/",
          }) as unknown as Response,
      ) as typeof fetch,
      undefined,
      1024,
      5,
    );
    await expect(
      execute({
        method: "GET",
        url: "https://scope.example/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "timeout" });
  });

  it("rejects an HTTP response body that is not valid UTF-8", async () => {
    const execute = createFetchHttpExchangeExecutor(
      vi.fn(
        async () => new Response(Uint8Array.from([0xc3, 0x28]), { status: 200 }),
      ) as typeof fetch,
    );
    await expect(
      execute({
        method: "GET",
        url: "https://scope.example/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "invalid-body" });
  });

  it("cancels a response reader when UTF-8 decoding fails midstream", async () => {
    const cancel = vi.fn(async () => undefined);
    const execute = createFetchHttpExchangeExecutor(
      vi.fn(
        async () =>
          ({
            body: {
              getReader: () => ({
                read: async () => ({ done: false, value: Uint8Array.from([0xc3, 0x28]) }),
                cancel,
                releaseLock: () => undefined,
              }),
            },
            headers: new Headers(),
            status: 200,
            url: "https://scope.example/",
          }) as unknown as Response,
      ) as typeof fetch,
    );
    await expect(
      execute({
        method: "GET",
        url: "https://scope.example/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "invalid-body" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
