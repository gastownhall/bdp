import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTypeConformanceIndex,
  READ_PROBLEM_DEFINITIONS,
  REFERENCE_TYPE_DESCRIPTORS,
  type TypeDescriptor,
} from "@bdp/protocol";
import { describe, expect, it } from "vitest";
import {
  controlledReadExternalTypePublisherCapability,
  controlledReadUnauthenticatedChallenge,
} from "../test-support/testing.js";
import {
  createConformanceArtifactBundle,
  createJsonSchemaValidator,
  type ExecutableScenario,
  type JsonValue,
  loadExecutableScenarioManifestJson,
  loadScenarioCatalogJson,
  type ScenarioAssertion,
  type ScenarioHttpAction,
  type ScenarioProgrammaticAction,
  type ScenarioRequest,
  validateCatalogCitations,
} from "./index.js";

const refUri = (reference: string | { readonly uri: string }): string =>
  typeof reference === "string" ? reference : reference.uri;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const resolveArtifactPath = (relativePath: string): string => {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    throw new Error("artifact path escapes the repository root");
  return resolved;
};
const readText = (relativePath: string): string =>
  readFileSync(resolveArtifactPath(relativePath), "utf8");
const readBytes = (relativePath: string): Uint8Array =>
  readFileSync(resolveArtifactPath(relativePath));
const bdLinkLocalId = (source: string, target: string, type: string): string => {
  const opaque = (value: string): string =>
    `b64_${Buffer.from(value, "utf8").toString("base64url")}`;
  return `links/${opaque(source)}/${opaque(target)}/${opaque(type)}`;
};

interface ReadFixture {
  readonly fixtureVersion: number;
  readonly id: string;
  readonly seed: number;
  readonly bindings: Readonly<Record<string, string>>;
  readonly beads: readonly {
    readonly localId: string;
    readonly type: string;
    readonly revision: string;
    readonly properties: {
      readonly title: string;
      readonly status: string;
      readonly priority: number;
      readonly created_at: string;
    };
  }[];
  readonly links: readonly {
    readonly localId: string;
    readonly type: string;
    readonly revision: string;
    readonly source: string | { readonly uri: string; readonly revision: string };
    readonly target: string | { readonly uri: string; readonly revision: string };
    readonly properties: Readonly<Record<string, unknown>>;
  }[];
  readonly types: readonly { readonly id: string }[];
  readonly typeDescriptors: readonly TypeDescriptor[];
  readonly expectations: {
    readonly readyTitles: readonly string[];
    readonly readyJson: readonly Readonly<Record<string, unknown>>[];
    readonly beadCount: number;
    readonly linkCount: number;
    readonly typeCount: number;
  };
  readonly oracles: {
    readonly "external-endpoint": {
      readonly input: { readonly linkIds: readonly string[] };
    };
    readonly resources: {
      readonly "bead.demo-a": {
        readonly id: string;
        readonly properties: Readonly<Record<string, unknown>>;
      };
      readonly "link.demo-b-a": {
        readonly id: string;
        readonly source: string;
        readonly target: string;
        readonly properties: Readonly<Record<string, unknown>>;
      };
    };
  };
}

interface CrossTargetFixture {
  readonly oracles: {
    readonly "cross-target": {
      readonly input: {
        readonly relationshipRoles: readonly {
          readonly type: string;
          readonly role: string;
        }[];
        readonly realizationOnlyLinkIds?: readonly string[];
      };
      readonly projection: {
        readonly beadStatuses: readonly (readonly JsonValue[])[];
        readonly relationships: readonly (readonly JsonValue[])[];
      };
    };
    readonly collections: {
      readonly "link-records": readonly (readonly JsonValue[])[];
    };
    readonly "external-endpoint": {
      readonly input: { readonly linkIds: readonly string[] };
    };
  };
  readonly beads?: readonly {
    readonly localId: string;
    readonly properties: {
      readonly title: string;
      readonly status: string;
      readonly priority: number;
    };
  }[];
  readonly bd?: {
    readonly beads: readonly {
      readonly id: string;
      readonly title: string;
      readonly status: string;
      readonly priority: number;
    }[];
  };
}

const loadManifest = () =>
  loadExecutableScenarioManifestJson(
    readText("packages/conformance/matrices/read-v1.json"),
    "read-v1.json",
  );

function scenarioRequests(scenario: ExecutableScenario | undefined): readonly ScenarioRequest[] {
  if (scenario === undefined) throw new Error("checked-in scenario was missing");
  return (
    scenario.requests ??
    scenario.actions.filter((action): action is ScenarioHttpAction => action.family === "http")
  );
}

function exactProgrammaticAction(
  scenario: ExecutableScenario | undefined,
  operation: string,
): ScenarioProgrammaticAction {
  if (scenario === undefined) throw new Error("checked-in scenario was missing");
  const actions = (scenario.actions ?? []).filter(
    (action): action is ScenarioProgrammaticAction =>
      action.family !== "http" && action.operation === operation,
  );
  if (actions.length !== 1)
    throw new Error(`expected one '${operation}' action, received ${actions.length}`);
  return actions[0] as ScenarioProgrammaticAction;
}

function assertionAtPointer(action: ScenarioProgrammaticAction, pointer: string) {
  const matches = action.assertions.filter(
    (assertion) => assertion.kind === "json-pointer" && assertion.pointer === pointer,
  );
  if (matches.length !== 1)
    throw new Error(`expected one '${pointer}' assertion, received ${matches.length}`);
  return matches[0] as Extract<ScenarioAssertion, { readonly kind: "json-pointer" }>;
}
const loadArtifactBundle = () =>
  createConformanceArtifactBundle({
    catalog: {
      bytes: readBytes("packages/conformance/catalog/read-v1.json"),
      label: "catalog/read-v1.json",
    },
    manifest: {
      bytes: readBytes("packages/conformance/matrices/read-v1.json"),
      label: "matrices/read-v1.json",
    },
    fixture: {
      bytes: readBytes("packages/conformance/fixtures/read-reference-v1.json"),
      label: "fixtures/read-reference-v1.json",
    },
  });
const loadFixture = (): ReadFixture => loadArtifactBundle().fixture as unknown as ReadFixture;

type FixtureArrayAssertion = Extract<
  ScenarioAssertion,
  { readonly kind: "json-array-set" | "json-array-tuples" }
>;

function resolveArrayExpected(
  assertion: FixtureArrayAssertion,
  fixture: ReadFixture,
): readonly JsonValue[] {
  if (assertion.fixturePointer === undefined) return assertion.equals;
  const value = resolveFixturePointer(assertion.fixturePointer, fixture);
  if (!Array.isArray(value)) throw new Error("fixture oracle was not an array");
  return value as readonly JsonValue[];
}

function resolveFixturePointer(pointer: string, fixture: ReadFixture): unknown {
  let value: unknown = fixture;
  for (const part of pointer.slice(1).split("/")) {
    if (typeof value !== "object" || value === null)
      throw new Error("fixture oracle pointer did not resolve");
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!Object.hasOwn(value, key)) throw new Error("fixture oracle pointer did not resolve");
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function chunkValues<Value>(values: readonly Value[], size: number): readonly (readonly Value[])[] {
  const chunks: Value[][] = [];
  for (let index = 0; index < values.length; index += size)
    chunks.push(values.slice(index, index + size));
  return chunks;
}

describe("checked-in Read matrix artifacts", () => {
  it("strictly parses the catalog and manifest and validates every citation", () => {
    const catalog = loadScenarioCatalogJson(
      readText("packages/conformance/catalog/read-v1.json"),
      "read-v1.json",
    );
    const manifest = loadManifest();
    validateCatalogCitations(catalog, (source) => readText(source), "read-v1.json");
    const catalogIdList = catalog.scenarios.map(({ id }) => id);
    const manifestIdList = manifest.scenarios.map(({ id }) => id);
    const catalogIds = new Set(catalogIdList);
    const manifestIds = new Set(manifestIdList);
    expect(catalog.scenarios).toHaveLength(34);
    expect(manifest.scenarios).toHaveLength(34);
    expect(catalogIds.size).toBe(34);
    expect(manifestIds.size).toBe(34);
    expect([...manifestIds].sort()).toEqual([...catalogIds].sort());
    expect(manifest.catalogId).toBe("read-v1");
    expect(manifest.scenarios.every(({ id }) => catalogIds.has(id))).toBe(true);
    expect(manifestIdList).toEqual([
      "read.discovery.scope-service-desc",
      "read.discovery.document",
      "read.discovery.canonical-navigation",
      "read.discovery.optional-limits",
      "read.collections.beads",
      "read.collections.links",
      "read.collections.structural-predicates",
      "read.collections.selector",
      "read.collections.pagination-snapshot",
      "read.collections.cursor-errors",
      "read.types.inventory",
      "read.resource.bead-record",
      "read.resource.default-bounded",
      "read.resource.properties-view",
      "read.resource.link-record",
      "read.bead-links.directions",
      "read.bead-links.pagination",
      "read.http.get-head",
      "read.http.method-405",
      "read.http.internal-fault",
      "read.http.cache-cors",
      "read.discovery.unsupported-client-input",
      "read.types.no-eager-resolution",
      "read.client.malformed-response",
      "read.http.raw-request-targets",
      "read.transport.disconnect-recovery",
      "read.resource.not-found-nondisclosure",
      "read.types.descriptor",
      "read.collections.invalid-query",
      "read.http.problem-table",
      "read.cross.reference-equivalence",
      "read.scope.restore-identity",
      "read.resource.external-endpoint",
      "read.alias.resolution",
    ]);
  });

  it("wires every completed Read row to its exact capability and operation", () => {
    const manifest = loadManifest();
    const expected = [
      [
        "read.discovery.optional-limits",
        ["public-http", "controlled-read-advertised-limits-v1"],
        "lifecycle",
        "advertised-limit-boundaries",
      ],
      [
        "read.resource.not-found-nondisclosure",
        ["public-http", "controlled-read-pagination-v1"],
        "lifecycle",
        "nondisclosure-identities",
      ],
      [
        "read.types.descriptor",
        ["public-http", controlledReadExternalTypePublisherCapability],
        "client",
        "external-type-descriptors",
      ],
      // read.collections.invalid-query is deliberately absent: its probes need
      // no control channel, so it is authored as plain requests and checked below.
      [
        "read.http.problem-table",
        ["public-http", "controlled-read-problem-table-v1"],
        "lifecycle",
        "problem-table-serialization",
      ],
      [
        "read.scope.restore-identity",
        ["public-http", "controlled-read-scope-restore-v1"],
        "lifecycle",
        "scope-restore-identity",
      ],
      [
        "read.resource.external-endpoint",
        ["public-http", "controlled-read-external-endpoint-v1"],
        "client",
        "external-link-endpoints",
      ],
    ] as const;

    for (const [id, requires, family, operation] of expected) {
      const scenario = manifest.scenarios.find((candidate) => candidate.id === id);
      expect(scenario?.setup.requires, id).toEqual(requires);
      expect(exactProgrammaticAction(scenario, operation), id).toMatchObject({ family, operation });
    }

    // Ruled packaged-drivable: the invalid-query probes need no control channel,
    // so the row is authored as plain requests and must never re-grow an action
    // that would pull it back into the derived self-certifiable set.
    const invalidQuery = manifest.scenarios.find(
      (candidate) => candidate.id === "read.collections.invalid-query",
    );
    expect(invalidQuery?.setup.requires).toEqual(["public-http"]);
    expect(invalidQuery?.actions).toBeUndefined();
    expect(invalidQuery?.requests?.map(({ id, target }) => [id, target])).toEqual([
      ["unsupported-parameter", { binding: "scope", path: "beads/", query: { unsupported: "1" } }],
      ["repeated-limit", { binding: "scope", path: "beads/", query: { limit: ["1", "2"] } }],
      [
        "repeated-selector",
        { binding: "scope", path: "links/", query: { selector: ["$[?@.id]", "$[?@.type]"] } },
      ],
    ]);
    for (const request of invalidQuery?.requests ?? []) {
      const byId = new Map(request.assertions.map((assertion) => [assertion.id, assertion]));
      expect(byId.get("status"), request.id).toMatchObject({ equals: 400 });
      expect(byId.get("media-type"), request.id).toMatchObject({
        equals: "application/problem+json",
      });
      expect(byId.get("schema"), request.id).toMatchObject({ schema: "#/$defs/readProblem" });
      expect(byId.get("code"), request.id).toMatchObject({ equals: "invalid-parameter" });
      expect(byId.get("family"), request.id).toMatchObject({
        equals: "https://github.com/gastownhall/bdp/problems/request",
      });
      expect(byId.get("retry"), request.id).toMatchObject({ equals: "never" });
      expect(byId.get("cache-control"), request.id).toMatchObject({
        includes: ["private", "no-store"],
      });
    }

    const controlledCapabilities = expected.flatMap(([, requires]) =>
      requires.filter((capability) => capability !== "public-http"),
    );
    for (const fixturePath of [
      "packages/conformance/fixtures/read-reference-v1.json",
      "packages/conformance/fixtures/read-bdpbd-v1.json",
    ]) {
      const fixture = JSON.parse(readText(fixturePath)) as {
        readonly capabilities: readonly string[];
      };
      expect(fixture.capabilities, fixturePath).toEqual(
        expect.arrayContaining(controlledCapabilities),
      );
    }
  });

  it("derives descriptor and closed Problem-table expectations from protocol authority", () => {
    const manifest = loadManifest();
    const descriptorAction = exactProgrammaticAction(
      manifest.scenarios.find(({ id }) => id === "read.types.descriptor"),
      "external-type-descriptors",
    );
    const descriptorIds = ["https://work.example/types/task", "https://work.example/types/blocks"];
    const selectedDescriptors = REFERENCE_TYPE_DESCRIPTORS.filter(({ id }) =>
      descriptorIds.includes(id),
    );
    expect(descriptorAction.input).toEqual({ ids: descriptorIds });
    expect(selectedDescriptors.map(({ id }) => id)).toEqual(descriptorIds);
    expect(assertionAtPointer(descriptorAction, "/rows/0").equals).toEqual(selectedDescriptors[0]);
    expect(assertionAtPointer(descriptorAction, "/rows/1").equals).toEqual(selectedDescriptors[1]);
    const bdFixture = JSON.parse(readText("packages/conformance/fixtures/read-bdpbd-v1.json")) as {
      readonly typeDescriptors: readonly TypeDescriptor[];
    };
    expect(bdFixture.typeDescriptors).toEqual(selectedDescriptors);

    const problemAction = exactProgrammaticAction(
      manifest.scenarios.find(({ id }) => id === "read.http.problem-table"),
      "problem-table-serialization",
    );
    expect(READ_PROBLEM_DEFINITIONS).toHaveLength(11);
    expect(problemAction.input).toEqual({
      codes: READ_PROBLEM_DEFINITIONS.map(({ code }) => code),
    });
    expect(assertionAtPointer(problemAction, "/rows").equals).toEqual(
      READ_PROBLEM_DEFINITIONS.map(({ code, family, status, retry, type }) => [
        code,
        family,
        status,
        retry,
        type,
        code === "unauthenticated" ? controlledReadUnauthenticatedChallenge : null,
        true,
        "application/problem+json",
        true,
      ]),
    );
  });

  it("binds external endpoints and Scope restoration to both target-realization fixtures", () => {
    type Reference = readonly [uri: string] | readonly [uri: string, revision: string];
    type AuthoredEndpoint = string | { readonly uri: string; readonly revision: string };
    type ExternalEndpointFixture = {
      readonly realization: string;
      readonly links?: readonly {
        readonly localId: string;
        readonly source: AuthoredEndpoint;
        readonly target: AuthoredEndpoint;
      }[];
      readonly oracles: {
        readonly "external-endpoint": {
          readonly input: { readonly linkIds: readonly string[] };
          readonly rows: readonly (readonly [string, string, Reference, Reference])[];
          readonly externalEndpoints: number;
          readonly localSource: number;
          readonly localTarget: number;
        };
        readonly "scope-restore": {
          readonly input: {
            readonly stableId: string;
            readonly deletedId: string;
            readonly restoredScope?: string;
          };
          readonly evidence: Readonly<Record<string, JsonValue>>;
        };
      };
    };
    const fixtures = [
      "packages/conformance/fixtures/read-reference-v1.json",
      "packages/conformance/fixtures/read-bdpbd-v1.json",
    ].map((fixturePath) => ({
      fixturePath,
      fixture: JSON.parse(readText(fixturePath)) as ExternalEndpointFixture,
    }));
    const opaqueExternalId = "external:beads:mol-run-assignee";
    const originalScope = new URL("https://scope.example/acme/");

    for (const { fixturePath, fixture } of fixtures) {
      const external = fixture.oracles["external-endpoint"];
      expect(external.input.linkIds, fixturePath).toEqual(external.rows.map(([linkId]) => linkId));
      let externalCount = 0;
      let localSource = 0;
      let localTarget = 0;
      for (const [rowLinkId, , source, target] of external.rows) {
        const sourceIsExternal = !source[0].startsWith("beads/");
        const targetIsExternal = !target[0].startsWith("beads/");
        // Every Link keeps at least one in-Scope endpoint; a row with no
        // external endpoint exists to prove in-Scope pin echo.
        expect(sourceIsExternal && targetIsExternal, fixturePath).toBe(false);
        if (!sourceIsExternal && !targetIsExternal)
          expect(
            [source, target].some((tuple) => tuple.length === 2),
            fixturePath,
          ).toBe(true);
        // A reference projects as [uri] or, when pinned, [uri, revision].
        // Where the fixture authors its links directly (the reference
        // realization), BOTH oracle tuples are bound exactly to the authored
        // references, so the oracle and the authored pin cannot drift
        // together.
        const authored = fixture.links?.find(({ localId }) => localId === rowLinkId);
        for (const [tuple, side, isExternal] of [
          [source, authored?.source, sourceIsExternal],
          [target, authored?.target, targetIsExternal],
        ] as const) {
          if (side !== undefined) {
            expect(tuple, fixturePath).toEqual(
              typeof side === "string" ? [side] : [side.uri, side.revision],
            );
          } else if (isExternal) {
            expect(tuple, fixturePath).toEqual([opaqueExternalId]);
          }
          if (!isExternal) expect(tuple[0], fixturePath).toMatch(/^beads\//);
        }
        externalCount += Number(sourceIsExternal) + Number(targetIsExternal);
        localSource += Number(!sourceIsExternal);
        localTarget += Number(!targetIsExternal);
      }
      expect(external, fixturePath).toMatchObject({
        externalEndpoints: externalCount,
        localSource,
        localTarget,
      });
      expect(
        [
          external.rows.length,
          external.externalEndpoints,
          external.localSource,
          external.localTarget,
        ],
        fixturePath,
      ).toEqual(fixture.realization === "bdptest" ? [3, 3, 1, 2] : [1, 1, 1, 0]);
      // The reference realization proves both spellings of the optional
      // endpoint pin: one external endpoint echoes a stored revision and
      // one omits the member. bd stores no pin, so bdpbd proves omission.
      const externalArities = external.rows
        .map(([, , source, target]) =>
          source[0].startsWith("beads/") ? target.length : source.length,
        )
        .sort();
      expect(externalArities, fixturePath).toEqual(
        fixture.realization === "bdptest" ? [1, 1, 2] : [1],
      );

      const restore = fixture.oracles["scope-restore"];
      expect(restore.input.stableId, fixturePath).not.toBe(restore.input.deletedId);
      if (fixture.realization === "bdptest") {
        expect(restore.input.restoredScope, fixturePath).toBeUndefined();
        expect(restore.evidence, fixturePath).toEqual({
          mode: "same-scope",
          scopeChanged: false,
          stableIdentityChanged: false,
          deletedStatusAtRestoredScope: 404,
          deletedCodeAtRestoredScope: "resource-not-found",
          scopeEpochChanged: true,
          staleCursorStatus: 410,
          staleCursorCode: "cursor-expired",
          oldStableStatus: null,
          oldDeletedStatus: null,
        });
      } else {
        expect(restore.evidence, fixturePath).toEqual({
          mode: "new-scope",
          scopeChanged: true,
          stableIdentityChanged: true,
          deletedStatusAtRestoredScope: 200,
          deletedCodeAtRestoredScope: null,
          scopeEpochChanged: null,
          staleCursorStatus: null,
          staleCursorCode: null,
          oldStableStatus: 404,
          oldDeletedStatus: 404,
        });
        const restoredScope = new URL(restore.input.restoredScope as string);
        expect(restoredScope.href, fixturePath).toBe("https://scope.example/restored/");
        expect(restoredScope.pathname, fixturePath).toMatch(/\/$/);
        expect(restoredScope.href, fixturePath).not.toBe(originalScope.href);
        expect(restoredScope.pathname.startsWith(originalScope.pathname), fixturePath).toBe(false);
        expect(originalScope.pathname.startsWith(restoredScope.pathname), fixturePath).toBe(false);
      }
    }

    const manifest = loadManifest();
    const externalAction = exactProgrammaticAction(
      manifest.scenarios.find(({ id }) => id === "read.resource.external-endpoint"),
      "external-link-endpoints",
    );
    expect(externalAction.inputFixturePointer).toBe("/oracles/external-endpoint/input");
    for (const [pointer, fixturePointer] of [
      ["/rows", "/oracles/external-endpoint/rows"],
      ["/externalEndpoints", "/oracles/external-endpoint/externalEndpoints"],
      ["/localSource", "/oracles/external-endpoint/localSource"],
      ["/localTarget", "/oracles/external-endpoint/localTarget"],
    ] as const)
      expect(assertionAtPointer(externalAction, pointer).fixturePointer).toBe(fixturePointer);

    const restoreAction = exactProgrammaticAction(
      manifest.scenarios.find(({ id }) => id === "read.scope.restore-identity"),
      "scope-restore-identity",
    );
    expect(restoreAction.inputFixturePointer).toBe("/oracles/scope-restore/input");
    for (const pointer of [
      "/mode",
      "/scopeChanged",
      "/stableIdentityChanged",
      "/deletedStatusAtRestoredScope",
      "/deletedCodeAtRestoredScope",
      "/scopeEpochChanged",
      "/staleCursorStatus",
      "/staleCursorCode",
      "/oldStableStatus",
      "/oldDeletedStatus",
    ])
      expect(assertionAtPointer(restoreAction, pointer).fixturePointer).toBe(
        `/oracles/scope-restore/evidence/${pointer.slice(1)}`,
      );
  });

  it("binds every advertised optional limit to executable boundary evidence", () => {
    const scenario = loadManifest().scenarios.find(
      ({ id }) => id === "read.discovery.optional-limits",
    );
    const action = exactProgrammaticAction(scenario, "advertised-limit-boundaries");
    const input = {
      pageDefault: 50,
      pageMaximum: 200,
      selectorBytes: 16_384,
      selectorDepth: 32,
      selectorNodes: 256,
      cursorTtlMilliseconds: 300_000,
      view: "limits-view",
      epoch: "limits-epoch",
    };
    expect(action.input).toEqual(input);

    const discovery = scenarioRequests(scenario).find(({ id }) => id === "discovery");
    const discoveryValues = new Map(
      discovery?.assertions.flatMap((assertion) =>
        assertion.kind === "json-pointer" ? [[assertion.pointer, assertion.equals] as const] : [],
      ),
    );
    expect(Object.fromEntries(discoveryValues)).toEqual({
      "/limits/page/defaultItems": input.pageDefault,
      "/limits/page/maximumItems": input.pageMaximum,
      "/limits/selector/bytes": input.selectorBytes,
      "/limits/selector/depth": input.selectorDepth,
      "/limits/selector/nodes": input.selectorNodes,
      "/limits/retention/maximumSnapshotLifetime": `PT${input.cursorTtlMilliseconds / 1_000}S`,
    });

    const requests = new Map(scenarioRequests(scenario).map((request) => [request.id, request]));
    expect(requests.get("default-boundary")?.target.query?.limit).toBe(String(input.pageDefault));
    expect(requests.get("maximum-boundary")?.target.query?.limit).toBe(String(input.pageMaximum));
    expect(requests.get("above-maximum")?.target.query?.limit).toBe(String(input.pageMaximum + 1));

    const expectedEvidence = new Map<string, JsonValue>([
      ["/defaultItemsObserved", input.pageDefault],
      ["/defaultContinuationObserved", true],
      ["/maximumItemsObserved", input.pageMaximum],
      ["/maximumContinuationObserved", true],
      ["/aboveMaximum/status", 413],
      ["/aboveMaximum/code", "limit-exceeded"],
      ["/aboveMaximum/retry", "never"],
      ["/aboveMaximum/schemaValid", true],
      ["/aboveMaximum/mediaType", "application/problem+json"],
      ["/aboveMaximum/cachePrivateNoStore", true],
      ["/replayBeforeExpiry", true],
      ["/expired/status", 410],
      ["/expired/code", "cursor-expired"],
      ["/expired/retry", "after-state-change"],
      [
        "/selectorLimitsObserved",
        [
          [413, "limit-exceeded", "never", true],
          [413, "limit-exceeded", "never", true],
          [413, "limit-exceeded", "never", true],
        ],
      ],
      ["/pagesSchemaValid", true],
      ["/pagesMediaTypeValid", true],
      ["/pagesPrivateNoStore", true],
      ["/publicRequests", 9],
    ]);
    for (const [pointer, equals] of expectedEvidence)
      expect(assertionAtPointer(action, pointer).equals, pointer).toEqual(equals);
    expect(assertionAtPointer(action, "/publicRequests").equals).toBe(
      6 +
        (assertionAtPointer(action, "/selectorLimitsObserved").equals as readonly JsonValue[])
          .length,
    );
  });

  it("binds unexpected-fault coverage to bodyless public HTTP observations", () => {
    const fixtures = [
      "packages/conformance/fixtures/read-reference-v1.json",
      "packages/conformance/fixtures/read-bdpbd-v1.json",
    ].map(
      (fixture) =>
        JSON.parse(readText(fixture)) as {
          readonly capabilities: readonly string[];
          readonly bindings: Readonly<Record<string, string>>;
        },
    );
    for (const fixture of fixtures) {
      expect(fixture.capabilities).toContain("unexpected-internal-fault");
      expect(fixture.bindings["bead.demo-a"]).toBeDefined();
    }

    const plan = loadManifest().scenarios.find(({ id }) => id === "read.http.internal-fault");
    expect(plan?.setup.requires).toEqual(
      expect.arrayContaining(["public-http", "unexpected-internal-fault"]),
    );
    expect(scenarioRequests(plan)).toEqual([
      expect.objectContaining({
        id: "faulting-resource",
        method: "GET",
        target: { binding: "bead.demo-a" },
        assertions: expect.arrayContaining([
          { id: "status", kind: "status", equals: 500 },
          {
            id: "redacted",
            kind: "wire-not-contains",
            fixturePointer: "/private/internalFaultSentinel",
          },
          { id: "body", kind: "body-absent" },
        ]),
      }),
    ]);
    for (const fixturePath of [
      "packages/conformance/fixtures/read-reference-v1.json",
      "packages/conformance/fixtures/read-bdpbd-v1.json",
    ]) {
      const fixture = JSON.parse(readText(fixturePath)) as {
        readonly private?: { readonly internalFaultSentinel?: unknown };
      };
      const sentinel = fixture.private?.internalFaultSentinel;
      expect(sentinel).toEqual(expect.any(String));
      expect(typeof sentinel === "string" ? sentinel.length : 0).toBeGreaterThan(0);
    }
  });

  it("binds exact raw-target coverage to both public target realizations", () => {
    const referenceFixture = JSON.parse(
      readText("packages/conformance/fixtures/read-reference-v1.json"),
    ) as { readonly capabilities: readonly string[] };
    const bdFixture = JSON.parse(readText("packages/conformance/fixtures/read-bdpbd-v1.json")) as {
      readonly capabilities: readonly string[];
    };
    for (const fixture of [referenceFixture, bdFixture])
      expect(fixture.capabilities).toContain("exact-raw-request-target");

    const plan = loadManifest().scenarios.find(({ id }) => id === "read.http.raw-request-targets");
    expect(plan?.setup.requires).toEqual(
      expect.arrayContaining(["public-http", "exact-raw-request-target"]),
    );
    const requests = scenarioRequests(plan);
    expect(requests.map(({ id }) => id)).toEqual([
      "canonical",
      "scheme-relative-authority",
      "absolute-form-authority",
      "duplicate-separator",
      "dot-segment",
      "dotdot-segment",
      "encoded-slash",
      "encoded-backslash",
      "raw-backslash",
      "raw-fragment",
      "raw-query",
      "control-octet",
      "invalid-utf8",
    ]);
    for (const request of requests) {
      expect(request.rawRequestTarget).toMatchObject({ template: "resolved-url" });
      expect(JSON.stringify(request.rawRequestTarget)).not.toContain("/acme/");
      expect(JSON.stringify(request.rawRequestTarget)).not.toContain("demo-a");
    }
    for (const request of requests.slice(-2)) {
      expect(request.rawRequestTarget).toMatchObject({
        suffix: { encoding: "base64" },
      });
      expect(request.assertions).toContainEqual({ id: "status", kind: "status", equals: 400 });
      expect(request.assertions).toContainEqual({ id: "body", kind: "body-absent" });
    }
  });

  it("binds the checked-in parsed artifacts to their exact raw source bytes", () => {
    const bundle = loadArtifactBundle();
    expect(bundle.catalog).toEqual(
      loadScenarioCatalogJson(
        readText("packages/conformance/catalog/read-v1.json"),
        "read-v1.json",
      ),
    );
    expect(bundle.manifest).toEqual(loadManifest());
    expect(
      bundle.manifest.scenarios.every(({ setup }) => setup.fixture === bundle.fixture.id),
    ).toBe(true);
    expect(bundle.digests).toEqual({
      catalogDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      manifestDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      fixtureDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("keeps client-only and coverage-only rows diagnostic and the Gate 0 405 probe CORS-specific", () => {
    const catalog = loadScenarioCatalogJson(
      readText("packages/conformance/catalog/read-v1.json"),
      "read-v1.json",
    );
    const diagnostics = catalog.scenarios
      .filter(({ kind }) => kind === "diagnostic")
      .map(({ id }) => id);
    expect(diagnostics).toEqual([
      "read.discovery.unsupported-client-input",
      "read.types.no-eager-resolution",
      "read.transport.disconnect-recovery",
      "read.client.malformed-response",
      "read.cross.reference-equivalence",
    ]);

    for (const [id, operations] of [
      [
        "read.discovery.unsupported-client-input",
        ["unsupported-discovery", "unsupported-discovery"],
      ],
      ["read.types.no-eager-resolution", ["resource-without-type-resolution"]],
    ] as const) {
      const plan = loadManifest().scenarios.find((scenario) => scenario.id === id);
      expect(plan?.setup.requires, id).toEqual([]);
      expect(
        plan?.actions?.map((action) => [
          action.family,
          action.family === "client" ? action.operation : null,
        ]),
        id,
      ).toEqual(operations.map((operation) => ["client", operation]));
    }

    const methodPlan = loadManifest().scenarios.find(({ id }) => id === "read.http.method-405");
    const post = scenarioRequests(methodPlan).find(({ id }) => id === "post");
    expect(methodPlan?.setup.requires).toContain("cors-disabled");
    expect(post?.assertions).toContainEqual({
      id: "allow",
      kind: "header-tokens",
      name: "allow",
      includes: ["GET", "HEAD"],
      allowsAdditional: false,
    });
    expect(post?.assertions.some(({ kind }) => kind === "body-absent")).toBe(false);
  });

  it("binds recovery and cross-target diagnostics to public, runner-owned observations", () => {
    const manifest = loadManifest();
    const disconnect = manifest.scenarios.find(
      ({ id }) => id === "read.transport.disconnect-recovery",
    );
    expect(disconnect?.setup.requires).toEqual(
      expect.arrayContaining(["public-http", "reference-read-v1-single-page"]),
    );
    expect(disconnect?.actions).toHaveLength(1);
    expect(disconnect?.actions?.[0]).toMatchObject({
      family: "client",
      operation: "disconnect-recovery",
    });

    const equivalence = manifest.scenarios.find(
      ({ id }) => id === "read.cross.reference-equivalence",
    );
    expect(equivalence?.setup.requires).toEqual(
      expect.arrayContaining(["public-http", "reference-read-v1-single-page"]),
    );
    expect(equivalence?.actions?.[0]).toMatchObject({
      family: "client",
      operation: "public-logical-projection",
      assertions: expect.arrayContaining([
        expect.objectContaining({
          id: "logical-projection",
          fixturePointer: "/oracles/cross-target/projection",
        }),
      ]),
      inputFixturePointer: "/oracles/cross-target/input",
    });

    const reference = JSON.parse(
      readText("packages/conformance/fixtures/read-reference-v1.json"),
    ) as CrossTargetFixture;
    const bd = JSON.parse(
      readText("packages/conformance/fixtures/read-bdpbd-v1.json"),
    ) as CrossTargetFixture;
    expect(reference.oracles["cross-target"].projection).toEqual(
      deriveCrossTargetProjection(reference),
    );
    expect(bd.oracles["cross-target"].projection).toEqual(deriveCrossTargetProjection(bd));
    expect(bd.oracles["cross-target"].projection).toEqual(
      reference.oracles["cross-target"].projection,
    );
    expect(JSON.stringify(reference.oracles["cross-target"].projection)).not.toMatch(
      /(?:beads\/|links\/|demo-|https?:)/,
    );

    const changedType = structuredClone(reference);
    const firstLink = changedType.oracles.collections["link-records"][0];
    if (firstLink === undefined) throw new Error("fixture has no public Link oracle");
    (firstLink as JsonValue[])[1] = "https://work.example/types/relates";
    expect(deriveCrossTargetProjection(changedType)).not.toEqual(
      reference.oracles["cross-target"].projection,
    );
  });

  it("derives controlled Selector and pagination oracles from both target realizations", () => {
    const manifest = loadManifest();
    const expectedOperations = new Map([
      ["read.collections.selector", "bounded-selector-pagination"],
      ["read.collections.pagination-snapshot", "collection-snapshot-pagination"],
      ["read.collections.cursor-errors", "collection-cursor-errors"],
      ["read.bead-links.pagination", "incident-link-pagination"],
    ]);
    for (const [id, operation] of expectedOperations) {
      const plan = manifest.scenarios.find((scenario) => scenario.id === id);
      expect(plan?.setup.requires, id).toEqual(["public-http", "controlled-read-pagination-v1"]);
      expect(plan?.actions, id).toHaveLength(1);
      expect(plan?.actions?.[0], id).toMatchObject({
        family: "lifecycle",
        operation,
        inputFixturePointer: expect.stringMatching(/^\/oracles\/pagination\/.+\/input$/),
      });
      const pointers =
        plan?.actions?.[0]?.assertions.flatMap((assertion) =>
          assertion.kind === "json-pointer" ? [assertion.pointer] : [],
        ) ?? [];
      expect(pointers, id).toEqual(
        expect.arrayContaining([
          "/pagesSchemaValid",
          "/pagesMediaTypeValid",
          "/pagesPrivateNoStore",
          "/publicRequests",
        ]),
      );
    }
    const assertionPointers = (id: string): readonly string[] =>
      manifest.scenarios
        .find((scenario) => scenario.id === id)
        ?.actions?.[0]?.assertions.flatMap((assertion) =>
          assertion.kind === "json-pointer" ? [assertion.pointer] : [],
        ) ?? [];
    expect(assertionPointers("read.collections.cursor-errors")).toEqual(
      expect.arrayContaining([
        "/expired/type",
        "/foreignView/type",
        "/epochFence/type",
        "/expired/cachePrivateNoStore",
        "/foreignView/schemaValid",
        "/epochFence/mediaType",
        "/replayPreserved",
      ]),
    );
    expect(assertionPointers("read.collections.pagination-snapshot")).toEqual(
      expect.arrayContaining([
        "/baselineRevisionDistinct",
        "/oldMutationRevisionPreserved",
        "/freshRevision",
      ]),
    );
    expect(assertionPointers("read.bead-links.pagination")).toEqual(
      expect.arrayContaining([
        "/collectionIds",
        "/incidentLinkIds",
        "/collectionPageSizes",
        "/incidentPageSizes",
        "/incidentLinksComplete",
        "/freshRevision",
        "/oldCollectionMutationRevisionPreserved",
        "/oldIncidentMutationRevisionPreserved",
        "/baselineRevisionDistinct",
        "/incidentCursorReplayableBeforeExpiry",
        "/adapterReadsDuringContinuation/collection",
        "/adapterReadsDuringContinuation/incidentLinks",
        "/expired/type",
        "/expired/cachePrivateNoStore",
        "/expired/schemaValid",
      ]),
    );

    type PaginationFixture = {
      readonly realization: "bdptest" | "bdpbd";
      readonly capabilities: readonly string[];
      readonly beads?: readonly {
        readonly localId: string;
        readonly type: string;
        readonly properties: { readonly status: string };
      }[];
      readonly links?: readonly {
        readonly localId: string;
        readonly source: string;
        readonly target: string;
      }[];
      readonly bd?: {
        readonly beads: readonly {
          readonly id: string;
          readonly type: string;
          readonly status: string;
        }[];
        readonly links: readonly {
          readonly source: string;
          readonly target: string;
          readonly type: string;
        }[];
      };
      readonly oracles: {
        readonly collections: {
          readonly "link-records": readonly (readonly JsonValue[])[];
        };
        readonly "incident-links": { readonly "demo-a-both": readonly string[] };
        readonly pagination: {
          readonly selector: {
            readonly input: {
              readonly collection: string;
              readonly selector: string;
              readonly limit: number;
              readonly syntaxSelector: string;
              readonly overLimitSelector: string;
              readonly selectorLimits: {
                readonly bytes: number;
                readonly depth: number;
                readonly nodes: number;
              };
              readonly authorizationExcludedId: string;
            };
            readonly expectedIds: readonly string[];
            readonly expectedPageSizes: readonly number[];
          };
          readonly "collection-snapshot": {
            readonly input: {
              readonly collection: string;
              readonly limit: number;
              readonly mutation: {
                readonly candidateIds: readonly string[];
                readonly revision: string;
              };
            };
            readonly expectedIds: readonly string[];
            readonly expectedPageSizes: readonly number[];
          };
          readonly "cursor-errors": {
            readonly input: {
              readonly collection: string;
              readonly limit: number;
              readonly malformedQuery: Readonly<Record<string, string>>;
              readonly clockAdvanceMs: number;
            };
          };
          readonly "incident-links": {
            readonly input: {
              readonly collection: string;
              readonly bead: string;
              readonly direction: string;
              readonly limit: number;
              readonly mutation: {
                readonly candidateIds: readonly string[];
                readonly revision: string;
              };
              readonly clockAdvanceMs: number;
            };
            readonly expectedCollectionIds: readonly string[];
            readonly expectedIncidentLinkIds: readonly string[];
            readonly expectedCollectionPageSizes: readonly number[];
            readonly expectedIncidentPageSizes: readonly number[];
            readonly publicRequests?: number;
          };
        };
      };
    };

    for (const fixturePath of [
      "packages/conformance/fixtures/read-reference-v1.json",
      "packages/conformance/fixtures/read-bdpbd-v1.json",
    ]) {
      const fixture = JSON.parse(readText(fixturePath)) as PaginationFixture;
      expect(fixture.capabilities, fixturePath).toContain("controlled-read-pagination-v1");
      expect(JSON.stringify(fixture), fixturePath).not.toContain("x-bdp-conformance-");

      const beadRows =
        fixture.beads?.map(({ localId, type, properties }) => ({
          id: localId,
          type,
          status: properties.status,
        })) ??
        fixture.bd?.beads.map(({ id, type, status }) => ({
          id: `beads/${id}`,
          type,
          status,
        })) ??
        [];
      const selector = fixture.oracles.pagination.selector;
      expect(selector.input, fixturePath).toMatchObject({
        collection: "beads",
        limit: 2,
        selectorLimits: { bytes: 128, depth: 16, nodes: 64 },
      });
      expect(selector.input.selector, fixturePath).toContain("@.properties.status");
      expect(selector.input.selector, fixturePath).toContain("@.type");
      expect(selector.input.syntaxSelector, fixturePath).toBe("$[?]");
      expect(
        new TextEncoder().encode(selector.input.overLimitSelector).byteLength,
        fixturePath,
      ).toBeGreaterThan(selector.input.selectorLimits.bytes);
      const selectorCandidateIds = beadRows
        .filter(
          ({ status, type }) =>
            status === "open" && (type === "task" || type === "https://work.example/types/task"),
        )
        .map(({ id }) => id)
        .sort();
      expect(selectorCandidateIds, fixturePath).toContain(selector.input.authorizationExcludedId);
      const selectedIds = selectorCandidateIds.filter(
        (id) => id !== selector.input.authorizationExcludedId,
      );
      expect(selector.expectedIds, fixturePath).toEqual(selectedIds);
      expect(selector.expectedIds, fixturePath).not.toContain(
        selector.input.authorizationExcludedId,
      );
      expect(selector.expectedPageSizes, fixturePath).toEqual(
        chunkValues(selectedIds, selector.input.limit).map((page) => page.length),
      );

      const snapshot = fixture.oracles.pagination["collection-snapshot"];
      const allBeadIds = beadRows.map(({ id }) => id).sort();
      expect(snapshot.expectedIds, fixturePath).toEqual(allBeadIds);
      expect(snapshot.expectedPageSizes, fixturePath).toEqual(
        chunkValues(allBeadIds, snapshot.input.limit).map((page) => page.length),
      );
      expect(snapshot.input.mutation, fixturePath).toEqual({
        candidateIds: [allBeadIds.at(-1)],
        revision: "conformance-mutated-revision",
      });

      const cursor = fixture.oracles.pagination["cursor-errors"].input;
      expect(cursor, fixturePath).toMatchObject({
        collection: "beads",
        limit: 2,
        malformedQuery: { cursor: "not-issued", limit: "2" },
        clockAdvanceMs: 101,
      });

      const incident = fixture.oracles.pagination["incident-links"];
      const links =
        fixture.links?.map(({ localId: id, source, target }) => ({ id, source, target })) ??
        fixture.bd?.links.map(({ source, target, type }) => ({
          id: bdLinkLocalId(source, target, type),
          source: `beads/${source}`,
          target: `beads/${target}`,
        })) ??
        [];
      expect(incident.input, fixturePath).toMatchObject({
        collection: "links",
        bead: "beads/demo-a",
        direction: "both",
        limit: 1,
        clockAdvanceMs: 101,
      });
      const expectedCollectionIds = links.map(({ id }) => id).sort();
      const expectedIncidentLinkIds = links
        .filter(
          ({ source, target }) =>
            refUri(source) === "beads/demo-a" || refUri(target) === "beads/demo-a",
        )
        .map(({ id }) => id)
        .sort();
      expect(incident.expectedCollectionIds, fixturePath).toEqual(expectedCollectionIds);
      expect(incident.expectedIncidentLinkIds, fixturePath).toEqual(expectedIncidentLinkIds);
      expect(incident.expectedCollectionPageSizes, fixturePath).toEqual(
        chunkValues(expectedCollectionIds, incident.input.limit).map((page) => page.length),
      );
      expect(incident.expectedIncidentPageSizes, fixturePath).toEqual(
        chunkValues(expectedIncidentLinkIds, incident.input.limit).map((page) => page.length),
      );
      const derivedPublicRequests =
        incident.expectedCollectionPageSizes.length + incident.expectedIncidentPageSizes.length + 4;
      if (fixture.realization === "bdptest")
        expect(incident.publicRequests, fixturePath).toBe(derivedPublicRequests);
      expect([...incident.input.mutation.candidateIds].sort(), fixturePath).toEqual(
        expectedIncidentLinkIds,
      );
      expect(incident.input.mutation.revision, fixturePath).toBe("conformance-mutated-revision");
    }
    const incidentPlan = loadManifest().scenarios.find(
      ({ id }) => id === "read.bead-links.pagination",
    );
    const incidentAction = exactProgrammaticAction(incidentPlan, "incident-link-pagination");
    expect(assertionAtPointer(incidentAction, "/publicRequests").fixturePointer).toBe(
      "/oracles/pagination/incident-links/publicRequests",
    );
  });

  it("binds cache policy to Scope data and proves disabled CORS with Origin-bearing probes", () => {
    const plan = loadManifest().scenarios.find(({ id }) => id === "read.http.cache-cors");
    expect(plan?.setup.requires).toEqual(
      expect.arrayContaining(["public-http", "reference-read-v1", "cors-disabled"]),
    );
    const requests = new Map(scenarioRequests(plan).map((request) => [request.id, request]));
    const cacheRequestIds = [
      "beads",
      "links",
      "types",
      "bead",
      "link",
      "bead-properties",
      "link-properties",
      "bead-links",
      "missing-bead",
    ];
    for (const id of cacheRequestIds)
      expect(requests.get(id)?.assertions, id).toContainEqual({
        id: "cache-control",
        kind: "header-tokens",
        name: "cache-control",
        includes: ["private", "no-store"],
        allowsAdditional: false,
        caseInsensitive: true,
      });

    for (const id of ["scope", "discovery", "cors-preflight"])
      expect(
        requests
          .get(id)
          ?.assertions.some(
            (assertion) => assertion.kind === "header-tokens" && assertion.name === "cache-control",
          ),
        id,
      ).toBe(false);

    const preflight = requests.get("cors-preflight");
    expect(preflight?.method).toBe("OPTIONS");
    expect(preflight?.headers).toEqual({
      origin: "https://cors-probe.invalid",
      "access-control-request-method": "GET",
    });
    expect(preflight?.assertions).toContainEqual({
      id: "allow",
      kind: "header-tokens",
      name: "allow",
      includes: ["GET", "HEAD"],
      allowsAdditional: false,
    });
    for (const name of [
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-allow-methods",
      "access-control-allow-headers",
      "access-control-expose-headers",
      "access-control-max-age",
    ])
      expect(preflight?.assertions, name).toContainEqual({
        id: `${name}-absent`,
        kind: "header",
        name,
        absent: true,
      });

    expect(requests.get("beads")?.headers).toMatchObject({
      origin: "https://cors-probe.invalid",
    });
    expect(requests.get("beads")?.assertions).toContainEqual({
      id: "access-control-allow-origin-absent",
      kind: "header",
      name: "access-control-allow-origin",
      absent: true,
    });
    expect(requests.get("missing-bead")?.assertions).toEqual(
      expect.arrayContaining([
        { id: "status", kind: "status", equals: 404 },
        {
          id: "media-type",
          kind: "media-type",
          equals: "application/problem+json",
        },
      ]),
    );
  });

  it("pairs every checked-in HEAD route with an earlier equivalent GET wire oracle", () => {
    const plan = loadManifest().scenarios.find(({ id }) => id === "read.http.get-head");
    expect(plan?.setup.requires).toEqual(
      expect.arrayContaining(["public-http", "reference-read-v1", "reference-read-v1-single-page"]),
    );
    const requests = scenarioRequests(plan);
    const byId = new Map(requests.map((request) => [request.id, request]));
    const heads = requests.filter(({ method }) => method === "HEAD");
    expect(heads.map(({ id }) => id).sort()).toEqual(
      [
        "bead-head",
        "bead-links-head",
        "bead-properties-head",
        "beads-head",
        "discovery-head",
        "link-head",
        "link-properties-head",
        "links-head",
        "scope-head",
        "types-head",
      ].sort(),
    );
    for (const head of heads) {
      const metadata = head.assertions.find(
        (assertion) => assertion.kind === "response-metadata-equals",
      );
      expect(metadata?.kind, head.id).toBe("response-metadata-equals");
      if (metadata?.kind !== "response-metadata-equals") continue;
      const get = byId.get(metadata.request);
      expect(get?.method, head.id).toBe("GET");
      expect(get?.target, head.id).toEqual(head.target);
      expect(get?.headers, head.id).toEqual(head.headers);
      expect(metadata.headers, head.id).toEqual(
        head.id === "scope-head" || head.id === "discovery-head"
          ? ["content-length", "content-type"]
          : ["cache-control", "content-length", "content-type"],
      );
      expect(head.assertions, head.id).toContainEqual({
        id: "body",
        kind: "body-absent",
      });
      expect(requests.indexOf(get as (typeof requests)[number]), head.id).toBeLessThan(
        requests.indexOf(head),
      );
    }
  });

  it("attributes every repeated Scope probe to the earlier discovery scenario", () => {
    const manifest = loadManifest();
    const repeatedScopeProbes = manifest.scenarios
      .filter(({ id }) => id !== "read.discovery.scope-service-desc")
      .flatMap((scenario) =>
        scenarioRequests(scenario)
          .filter(({ id, target }) => id === "scope" && target.binding === "scope")
          .map((request) => ({
            scenario: scenario.id,
            prerequisite: request.prerequisiteScenario,
          })),
      );

    expect(repeatedScopeProbes.length).toBeGreaterThan(0);
    expect(repeatedScopeProbes).toEqual(
      repeatedScopeProbes.map(({ scenario }) => ({
        scenario,
        prerequisite: "read.discovery.scope-service-desc",
      })),
    );
  });

  it("resolves every checked-in schema assertion against the canonical bundle", () => {
    const manifest = loadManifest();
    const schema = JSON.parse(readText("schemas/bdp-v0.schema.json")) as Record<string, unknown>;
    const validator = createJsonSchemaValidator(schema);
    const references = manifest.scenarios.flatMap((scenario) =>
      scenarioRequests(scenario).flatMap((request) =>
        request.assertions.flatMap((assertion) =>
          assertion.kind === "json-schema" ? [assertion.schema] : [],
        ),
      ),
    );
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) expect(() => validator.resolve(reference)).not.toThrow();
  });

  it("keeps request binding flow and executable fixture assertions connected", () => {
    const manifest = loadManifest();
    const fixture = loadFixture();
    for (const scenario of manifest.scenarios) {
      expect(scenario.setup.fixture).toBe(fixture.id);
      const established = new Set(["scope", ...Object.keys(fixture.bindings)]);
      for (const request of scenarioRequests(scenario)) {
        expect(established.has(request.target.binding), request.id).toBe(true);
        for (const queryValue of Object.values(request.target.query ?? {})) {
          if (typeof queryValue !== "string" && "binding" in queryValue)
            expect(established.has(queryValue.binding), request.id).toBe(true);
        }
        for (const capture of request.captures) {
          expect(established.has(capture.binding), capture.binding).toBe(false);
          established.add(capture.binding);
        }
      }
    }

    const assertionValues = new Map(
      manifest.scenarios.flatMap((scenario) =>
        scenarioRequests(scenario).flatMap((request) =>
          request.assertions.flatMap((assertion) =>
            assertion.kind === "json-array-set"
              ? [[assertion.id, resolveArrayExpected(assertion, fixture)] as const]
              : [],
          ),
        ),
      ),
    );
    expect(assertionValues.get("fixture-beads")).toEqual(
      fixture.beads.map(({ properties }) => properties.title),
    );
    expect(assertionValues.get("fixture-types")).toEqual(fixture.types.map(({ id }) => id));

    const linkRecordTuples = scenarioRequests(
      manifest.scenarios.find(({ id }) => id === "read.collections.links"),
    ).flatMap((request) =>
      request.assertions.filter(
        (assertion) =>
          assertion.kind === "json-array-tuples" && assertion.id === "fixture-link-records",
      ),
    )[0];
    expect(linkRecordTuples?.kind).toBe("json-array-tuples");
    const endpointCells = (
      value: string | { readonly uri: string; readonly revision: string },
    ): readonly [uri: string, revision: string] =>
      typeof value === "string" ? [value, ""] : [value.uri, value.revision];
    expect(
      linkRecordTuples?.kind === "json-array-tuples"
        ? resolveArrayExpected(linkRecordTuples, fixture)
        : [],
    ).toEqual(
      fixture.links.map((link) => [
        link.localId,
        link.type,
        link.revision,
        ...endpointCells(link.source),
        ...endpointCells(link.target),
        link.properties,
      ]),
    );

    const propertiesPlan = manifest.scenarios.find(
      ({ id }) => id === "read.resource.properties-view",
    );
    const propertiesByLocalId = new Map(
      [...fixture.beads, ...fixture.links].map(({ localId, properties }) => [localId, properties]),
    );
    const propertiesByBinding = new Map(
      scenarioRequests(propertiesPlan).map((request) => {
        const localId = fixture.bindings[request.target.binding];
        expect(localId, request.id).toBeDefined();
        const expected = localId === undefined ? undefined : propertiesByLocalId.get(localId);
        const equality = request.assertions.find(({ kind }) => kind === "json-equals");
        expect(Object.keys(expected ?? {}), request.id).not.toHaveLength(0);
        const equalityExpected =
          equality?.kind !== "json-equals"
            ? undefined
            : equality.fixturePointer === undefined
              ? equality.value
              : resolveFixturePointer(equality.fixturePointer, fixture);
        expect(equalityExpected, request.id).toEqual(expected);
        return [request.target.binding, expected] as const;
      }),
    );
    expect([...propertiesByBinding.keys()].sort()).toEqual(["bead.demo-a", "link.demo-b-a"]);
    expect(propertiesByBinding.get("bead.demo-a")).not.toEqual(
      propertiesByBinding.get("link.demo-b-a"),
    );

    const directionPlan = manifest.scenarios.find(({ id }) => id === "read.bead-links.directions");
    expect(directionPlan?.setup.requires).toContain("reference-read-v1-single-page");
    const expectedIdsByCase = new Map<string, readonly string[]>();
    for (const request of scenarioRequests(directionPlan)) {
      const idSetAssertion = request.assertions.find(
        (assertion) => assertion.kind === "json-array-set" && assertion.id.endsWith("-ids"),
      );
      if (idSetAssertion?.kind !== "json-array-set") continue;
      const beadId = fixture.bindings[request.target.binding];
      expect(beadId, request.id).toBeDefined();
      const directionValue = request.target.query?.direction;
      const direction = typeof directionValue === "string" ? directionValue : "both";
      expect(["inbound", "outbound", "both"]).toContain(direction);
      const expectedIds = fixture.links
        .filter((link) => {
          if (direction === "inbound") return refUri(link.target) === beadId;
          if (direction === "outbound") return refUri(link.source) === beadId;
          return refUri(link.source) === beadId || refUri(link.target) === beadId;
        })
        .map(({ localId }) => localId);
      const assertionExpected = resolveArrayExpected(idSetAssertion, fixture);
      expect([...assertionExpected].sort(), request.id).toEqual([...expectedIds].sort());
      expect(assertionExpected, request.id).toHaveLength(expectedIds.length);
      expectedIdsByCase.set(
        `${request.target.binding}:${typeof directionValue === "string" ? directionValue : "default"}`,
        expectedIds,
      );
    }
    expect([...expectedIdsByCase.keys()].sort()).toEqual(
      [
        "bead.demo-a:both",
        "bead.demo-a:default",
        "bead.demo-a:inbound",
        "bead.demo-a:outbound",
        "bead.demo-b:inbound",
        "bead.demo-b:outbound",
      ].sort(),
    );
    const inbound = expectedIdsByCase.get("bead.demo-a:inbound") ?? [];
    const outbound = expectedIdsByCase.get("bead.demo-a:outbound") ?? [];
    expect(inbound.length).toBeGreaterThan(0);
    expect(outbound.length).toBeGreaterThan(0);
    expect(inbound.filter((id) => outbound.includes(id))).toEqual([]);
    expect([...(expectedIdsByCase.get("bead.demo-a:both") ?? [])].sort()).toEqual(
      [...inbound, ...outbound].sort(),
    );
    expect([...(expectedIdsByCase.get("bead.demo-a:default") ?? [])].sort()).toEqual(
      [...inbound, ...outbound].sort(),
    );

    const structuralPlan = manifest.scenarios.find(
      ({ id }) => id === "read.collections.structural-predicates",
    );
    expect(structuralPlan?.setup.requires).toContain("reference-read-v1-single-page");
    const typeConformance = createTypeConformanceIndex(fixture.typeDescriptors);
    const queryBinding = (value: unknown): string | undefined => {
      if (typeof value === "string") return value;
      if (typeof value !== "object" || value === null || !("binding" in value)) return undefined;
      const binding = (value as { readonly binding?: unknown }).binding;
      return typeof binding === "string" ? fixture.bindings[binding] : undefined;
    };
    const structuralCaseIds: string[] = [];
    for (const request of scenarioRequests(structuralPlan)) {
      const expectedSet = request.assertions.find(
        (assertion) => assertion.kind === "json-array-set",
      );
      if (expectedSet?.kind !== "json-array-set") continue;
      structuralCaseIds.push(request.id);
      const query = request.target.query ?? {};
      const type = queryBinding(query.type);
      const conformsTo = queryBinding(query.conformsTo);
      const source = queryBinding(query.source);
      const target = queryBinding(query.target);
      const endpoint = queryBinding(query.endpoint);
      if (request.target.binding === "beads") {
        const matches = fixture.beads.filter(
          (bead) =>
            (type === undefined || bead.type === type) &&
            (conformsTo === undefined || typeConformance.includes(bead.type, conformsTo)),
        );
        const expected =
          expectedSet.itemPointer === "/properties/title"
            ? matches.map(({ properties }) => properties.title)
            : matches.map(({ localId }) => localId);
        expect([...resolveArrayExpected(expectedSet, fixture)].sort(), request.id).toEqual(
          [...expected].sort(),
        );
        continue;
      }
      const matches = fixture.links.filter(
        (link) =>
          (type === undefined || link.type === type) &&
          (conformsTo === undefined || typeConformance.includes(link.type, conformsTo)) &&
          (source === undefined || refUri(link.source) === source) &&
          (target === undefined || refUri(link.target) === target) &&
          (endpoint === undefined ||
            refUri(link.source) === endpoint ||
            refUri(link.target) === endpoint),
      );
      expect([...resolveArrayExpected(expectedSet, fixture)].sort(), request.id).toEqual(
        matches.map(({ localId }) => localId).sort(),
      );
    }
    expect(structuralCaseIds.sort()).toEqual(
      [
        "beads-type",
        "beads-type-is-exact",
        "beads-conforms-to-declared-type",
        "beads-conforms-to",
        "beads-predicates-and",
        "links-source-local",
        "links-target-absolute",
        "links-endpoint-or",
        "links-endpoint-pinned-target",
        "links-type",
        "links-type-is-exact",
        "links-conforms-to-declared-type",
        "links-conforms-to",
        "links-conforms-to-cross-kind",
        "links-predicates-and",
      ].sort(),
    );
    const assertDeclaredTypeConformance = (
      exactTypeRequestId: string,
      declaredTypeRequestId: string,
      ancestorRequestId: string,
    ): void => {
      const exactTypeRequest = scenarioRequests(structuralPlan).find(
        ({ id }) => id === exactTypeRequestId,
      );
      const declaredTypeRequest = scenarioRequests(structuralPlan).find(
        ({ id }) => id === declaredTypeRequestId,
      );
      const ancestorRequest = scenarioRequests(structuralPlan).find(
        ({ id }) => id === ancestorRequestId,
      );
      expect(declaredTypeRequest?.target.query?.conformsTo, declaredTypeRequestId).toBe(
        exactTypeRequest?.target.query?.type,
      );
      expect(declaredTypeRequest?.target.query?.conformsTo, declaredTypeRequestId).not.toBe(
        ancestorRequest?.target.query?.conformsTo,
      );
      const exactSet = exactTypeRequest?.assertions.find(
        (assertion) => assertion.kind === "json-array-set",
      );
      const declaredSet = declaredTypeRequest?.assertions.find(
        (assertion) => assertion.kind === "json-array-set",
      );
      expect(exactSet?.kind, exactTypeRequestId).toBe("json-array-set");
      expect(declaredSet?.kind, declaredTypeRequestId).toBe("json-array-set");
      if (exactSet?.kind === "json-array-set" && declaredSet?.kind === "json-array-set") {
        const exactExpected = resolveArrayExpected(exactSet, fixture);
        const declaredExpected = resolveArrayExpected(declaredSet, fixture);
        expect(declaredExpected, declaredTypeRequestId).toEqual(exactExpected);
        expect(declaredExpected.length, declaredTypeRequestId).toBeGreaterThan(0);
      }
    };
    assertDeclaredTypeConformance(
      "beads-type",
      "beads-conforms-to-declared-type",
      "beads-conforms-to",
    );
    assertDeclaredTypeConformance(
      "links-type",
      "links-conforms-to-declared-type",
      "links-conforms-to",
    );
    const relationshipRequest = scenarioRequests(structuralPlan).find(
      ({ id }) => id === "links-conforms-to",
    );
    const relationshipIds = relationshipRequest?.assertions.find(
      (assertion) => assertion.kind === "json-array-set",
    );
    expect(relationshipIds?.kind).toBe("json-array-set");
    if (relationshipIds?.kind === "json-array-set") {
      const relationshipExpected = resolveArrayExpected(relationshipIds, fixture);
      expect(relationshipExpected).toContain("links/demo-b-a");
      expect(relationshipExpected).not.toContain("links/demo-e-f");
      expect(relationshipExpected.length).toBeLessThan(fixture.links.length);
    }
  });

  it("binds target-specific Resource identities and complete properties through fixture oracles", () => {
    const manifest = loadManifest();
    const fixture = loadFixture();
    const bead = fixture.beads.find(({ localId }) => localId === fixture.bindings["bead.demo-a"]);
    const link = fixture.links.find(({ localId }) => localId === fixture.bindings["link.demo-b-a"]);
    expect(fixture.oracles.resources["bead.demo-a"]).toEqual({
      id: bead?.localId,
      properties: bead?.properties,
    });
    expect(fixture.oracles.resources["link.demo-b-a"]).toEqual({
      id: link?.localId,
      source: link?.source,
      target: link?.target,
      properties: link?.properties,
    });

    const assertions = new Map<string, ScenarioAssertion>(
      manifest.scenarios.flatMap((scenario) =>
        scenarioRequests(scenario).flatMap((request) =>
          request.assertions.map(
            (assertion) => [`${scenario.id}:${request.id}:${assertion.id}`, assertion] as const,
          ),
        ),
      ),
    );
    const expectedPointers = new Map([
      ["read.resource.bead-record:bead:id", "/oracles/resources/bead.demo-a/id"],
      ["read.resource.bead-record:bead:properties", "/oracles/resources/bead.demo-a/properties"],
      [
        "read.resource.properties-view:bead-properties:fixture-bead-properties",
        "/oracles/resources/bead.demo-a/properties",
      ],
      [
        "read.resource.properties-view:link-properties:fixture-link-properties",
        "/oracles/resources/link.demo-b-a/properties",
      ],
      ["read.resource.link-record:link:id", "/oracles/resources/link.demo-b-a/id"],
      ["read.resource.link-record:link:source", "/oracles/resources/link.demo-b-a/source"],
      ["read.resource.link-record:link:target", "/oracles/resources/link.demo-b-a/target"],
    ]);
    for (const [key, fixturePointer] of expectedPointers) {
      const assertion = assertions.get(key);
      expect(
        assertion !== undefined && "fixturePointer" in assertion
          ? assertion.fixturePointer
          : undefined,
        key,
      ).toBe(fixturePointer);
    }
  });

  it("binds every target-specific collection projection through fixture oracles", () => {
    const manifest = loadManifest();
    const arrayAssertions = manifest.scenarios.flatMap((scenario) =>
      scenarioRequests(scenario).flatMap((request) =>
        request.assertions.flatMap((assertion) =>
          assertion.kind === "json-array-set" || assertion.kind === "json-array-tuples"
            ? [{ scenario: scenario.id, request: request.id, assertion }]
            : [],
        ),
      ),
    );
    expect(arrayAssertions).not.toHaveLength(0);
    for (const { scenario, request, assertion } of arrayAssertions)
      expect(assertion.fixturePointer, `${scenario}:${request}:${assertion.id}`).toMatch(
        /^\/oracles\/(?:collections|structural-predicates|incident-links|pagination)\//,
      );
  });

  it("keeps the portable fixture deterministic and free of credentials", () => {
    const fixture = loadFixture();
    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.seed).toBe(0);
    const credentialScan = JSON.stringify(fixture).replaceAll(
      '"authorizationExcludedId"',
      '"viewProjectionExcludedId"',
    );
    expect(credentialScan).not.toMatch(/authorization|cookie|token|password/i);
    const statusById = new Map(
      fixture.beads.map(({ localId, properties }) => [localId, properties.status]),
    );
    // Link direction is source depends on target. Only a closed target satisfies a blocks edge.
    const readyTitles = fixture.beads
      .filter(({ localId, properties }) => {
        const blockers = fixture.links.filter(
          ({ source, type }) => source === localId && type === "https://work.example/types/blocks",
        );
        return (
          properties.status === "open" &&
          blockers.every(
            ({ target }) =>
              statusById.get(typeof target === "string" ? target : target.uri) === "closed",
          )
        );
      })
      .sort(
        (left, right) =>
          left.properties.priority - right.properties.priority ||
          right.properties.created_at.localeCompare(left.properties.created_at) ||
          left.localId.localeCompare(right.localId),
      )
      .map(({ properties }) => properties.title);
    expect(fixture.expectations).toEqual({
      readyTitles,
      readyJson: fixture.expectations.readyJson,
      beadCount: fixture.beads.length,
      linkCount: fixture.links.length,
      typeCount: fixture.types.length,
    });
    expect(fixture.expectations.readyJson.map(({ title }) => title)).toEqual(readyTitles);
    expect(fixture.typeDescriptors).toHaveLength(fixture.types.length);
    expect(fixture.typeDescriptors.map(({ id }) => id)).toEqual(fixture.types.map(({ id }) => id));
    expect(fixture.bindings).toMatchObject({
      "bead.demo-a": "beads/demo-a",
      "bead.demo-c": "beads/demo-c",
      "link.demo-b-a": "links/demo-b-a",
    });

    const referenceDomain = JSON.parse(
      readText("fixtures/reference-domain/reference-domain.json"),
    ) as {
      readonly beadTypes: ReadFixture["types"];
      readonly linkTypes: ReadFixture["types"];
      readonly propertiesSchemas: Readonly<Record<string, unknown>>;
      readonly externalEndpointLinks: ReadFixture["links"];
    };
    const referenceTypes = [...referenceDomain.beadTypes, ...referenceDomain.linkTypes];
    expect(fixture.types).toEqual(referenceTypes);
    expect(fixture.typeDescriptors).toEqual(REFERENCE_TYPE_DESCRIPTORS);
    expect(Object.keys(referenceDomain.propertiesSchemas).sort()).toEqual(
      referenceTypes.map(({ id }) => id).sort(),
    );
    const externalEndpointIds = new Set(fixture.oracles["external-endpoint"].input.linkIds);
    expect(fixture.links.filter(({ localId }) => externalEndpointIds.has(localId))).toEqual(
      referenceDomain.externalEndpointLinks,
    );
  });
});

function deriveCrossTargetProjection(fixture: CrossTargetFixture) {
  const sortRows = <Row extends readonly JsonValue[]>(rows: readonly Row[]): readonly Row[] =>
    [...rows].sort((left, right) => {
      const leftJson = JSON.stringify(left);
      const rightJson = JSON.stringify(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    });
  const beads =
    fixture.beads?.map(({ localId, properties: { title, status, priority } }) => ({
      id: localId,
      title,
      status,
      priority,
    })) ??
    fixture.bd?.beads.map(({ id, title, status, priority }) => ({
      id: `beads/${id}`,
      title,
      status,
      priority,
    }));
  if (beads === undefined) throw new Error("fixture has no target realization");
  const titleById = new Map(beads.map(({ id, title }) => [id, title]));
  const roleByType = new Map(
    fixture.oracles["cross-target"].input.relationshipRoles.map(({ type, role }) => [type, role]),
  );
  // The exclusion list is not self-certifying: it must name exactly the
  // known witnesses, and every excluded link must be independently
  // justified by the model — it carries a pin, or its type is owned by its
  // source's Type — and every link so justified must be excluded.
  const authoredRealizationOnly = fixture.oracles["cross-target"].input.realizationOnlyLinkIds;
  if ((fixture as { readonly realization?: string }).realization === "bdptest") {
    const fixtureLinks = (
      fixture as unknown as {
        readonly links: readonly {
          readonly localId: string;
          readonly type: string;
          readonly source: unknown;
          readonly target: unknown;
        }[];
        readonly typeDescriptors: readonly {
          readonly id: string;
          readonly ownsOutgoing?: Readonly<Record<string, unknown>>;
        }[];
        readonly beads: readonly { readonly localId: string; readonly type: string }[];
      }
    ).links;
    const fixtureShape = fixture as unknown as {
      readonly typeDescriptors: readonly {
        readonly id: string;
        readonly ownsOutgoing?: Readonly<Record<string, unknown>>;
      }[];
      readonly beads: readonly { readonly localId: string; readonly type: string }[];
    };
    const ownedPairs = new Set(
      fixtureShape.typeDescriptors.flatMap((descriptor) =>
        Object.keys(descriptor.ownsOutgoing ?? {}).map((type) => `${descriptor.id}|${type}`),
      ),
    );
    const beadTypeByLocalId = new Map(
      fixtureShape.beads.map(({ localId, type }) => [localId, type]),
    );
    const isPinned = (value: unknown): boolean =>
      typeof value === "object" && value !== null && "revision" in value;
    const justified = new Set(
      fixtureLinks
        .filter(({ type, source, target }) => {
          const sourceType = typeof source === "string" ? beadTypeByLocalId.get(source) : undefined;
          return (
            isPinned(source) ||
            isPinned(target) ||
            (sourceType !== undefined && ownedPairs.has(`${sourceType}|${type}`))
          );
        })
        .map(({ localId }) => localId),
    );
    // external-endpoint witnesses are excluded through their own input
    // list; the realization-only list must cover exactly the remainder.
    const externallyExcluded = new Set(fixture.oracles["external-endpoint"].input.linkIds);
    expect([...justified].filter((id) => !externallyExcluded.has(id)).sort()).toEqual(
      [...(authoredRealizationOnly ?? [])].filter((id) => !externallyExcluded.has(id)).sort(),
    );
  }
  const excludedLinkIds = new Set([
    ...fixture.oracles["external-endpoint"].input.linkIds,
    ...(fixture.oracles["cross-target"].input.realizationOnlyLinkIds ?? []),
  ]);
  return {
    beadStatuses: sortRows(beads.map(({ title, status, priority }) => [title, status, priority])),
    relationships: sortRows(
      fixture.oracles.collections["link-records"]
        .filter((record) => !excludedLinkIds.has(requiredTupleString(record, 0, "Link ID")))
        .map((record) => {
          const type = requiredTupleString(record, 1, "Link Type");
          const source = requiredTupleString(record, 3, "Link source");
          const target = requiredTupleString(record, 5, "Link target");
          const role = roleByType.get(type);
          if (role === undefined) throw new Error("public Link Type has no logical role");
          return [requiredTitle(titleById, source), requiredTitle(titleById, target), role];
        }),
    ),
  };
}

function requiredTitle(titles: ReadonlyMap<string, string>, id: string): string {
  const title = titles.get(id);
  if (title === undefined) throw new Error("fixture relationship endpoint has no logical title");
  return title;
}

function requiredTupleString(tuple: readonly JsonValue[], index: number, label: string): string {
  const value = tuple[index];
  if (typeof value !== "string") throw new Error(`${label} oracle was not a string`);
  return value;
}
