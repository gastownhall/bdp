import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPortableReferenceFixturePort,
  createReferenceFixturePort,
  type ScopePort,
  type ScopeReadOperation,
} from "@bdp/adapter-in-memory";
import { BLOCKING_LINK_TYPE_ID, readyBeadsFromClient } from "@bdp/bd-domain";
import { BdpClient, createFetchTransport } from "@bdp/client";
import { createBdpClientScenarioActionExecutor } from "@bdp/client/testing";
import { DEFAULT_SERVER_READ_LIMITS, type ServerReadLimitsConfig } from "@bdp/config";
import {
  type ConformanceFixture,
  createConformanceArtifactBundle,
  createJsonSchemaValidator,
  createRawHttpScenarioTarget,
  runConformanceMatrix,
} from "@bdp/conformance";
import {
  type ControlledReadActionSession,
  controlledReadAdvertisedLimitsCapability,
  controlledReadCapability,
  controlledReadEpochHeader,
  controlledReadExternalTypePublisherCapability,
  controlledReadProblemCapability,
  controlledReadScopeRestoreCapability,
  controlledReadUnauthenticatedChallenge,
  controlledReadViewHeader,
  createControlledReadActionExecutor,
  emitMatrixRunForCohort,
  startControlledTypeDescriptorPublisher,
} from "@bdp/conformance/testing";
import {
  admitReadServerProfile,
  closeNodeHttpServer,
  createNodeHttpServer,
  createPublicReadControls,
  createReadServer,
  listenNodeHttpServer,
  type ServerAdvertisedReadLimits,
  type ServerReadControls,
} from "@bdp/server";
import {
  createControlledReadSessionForTesting,
  createReadProblemTablePortForTesting,
  createReadResourceFaultPortForTesting,
  establishReadConformanceEvidenceForTesting,
} from "@bdp/server/testing";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (relativePath: string): string =>
  readFileSync(path.join(root, relativePath), "utf8");
const readBytes = (relativePath: string): Uint8Array => readFileSync(path.join(root, relativePath));
const scope = "https://scope.example/acme/";

interface ReadinessFixture extends ConformanceFixture {
  readonly expectations: { readonly readyTitles: readonly string[] };
}

async function expectReferenceFixtureParity(portablePort: ScopePort): Promise<void> {
  const builtInPort = createReferenceFixturePort(scope);
  const options = { signal: new AbortController().signal };
  const compare = async (operation: ScopeReadOperation): Promise<void> => {
    const expected = await builtInPort.perform(operation, options);
    const observed = await portablePort.perform(operation, options);
    // Exact parity: the built-in domain carries the external-endpoint Links, so
    // the two realizations of the reference domain are byte-identical.
    expect(observed, JSON.stringify(operation)).toEqual(expected);
  };

  for (const collection of ["beads", "links", "types"] as const)
    await compare({ kind: "collection", collection });
  await compare({
    kind: "collection",
    collection: "beads",
    type: "https://work.example/types/work-item",
  });
  await compare({
    kind: "collection",
    collection: "beads",
    conformsTo: "https://work.example/types/tracked-item",
  });
  await compare({
    kind: "collection",
    collection: "beads",
    type: "https://work.example/types/decision",
    conformsTo: "https://work.example/types/tracked-item",
  });
  await compare({
    kind: "collection",
    collection: "links",
    type: "https://work.example/types/relationship",
  });
  await compare({
    kind: "collection",
    collection: "links",
    type: "https://work.example/types/blocks",
  });
  await compare({
    kind: "collection",
    collection: "links",
    conformsTo: "https://work.example/types/relationship",
  });
  await compare({
    kind: "collection",
    collection: "links",
    source: new URL("beads/demo-a", scope).href,
    endpoint: new URL("beads/demo-c", scope).href,
  });
  for (const localId of [
    "demo-a",
    "demo-b",
    "demo-c",
    "demo-d",
    "demo-e",
    "demo-f",
    "demo-i",
    "demo-j",
    "demo-k",
  ]) {
    const id = new URL(`beads/${localId}`, scope).href;
    await compare({ kind: "resource", resource: "bead", id });
    await compare({ kind: "properties", resource: "bead", id });
    for (const direction of ["inbound", "outbound", "both"] as const)
      await compare({ kind: "bead-links", bead: id, direction });
  }
  for (const localId of [
    "demo-b-a",
    "demo-a-c",
    "demo-d-c",
    "demo-f-e",
    "demo-e-f",
    "demo-i-a",
    "demo-i-c",
    "demo-j-c",
    "demo-j-k",
    "external-source",
    "external-target",
  ]) {
    const id = new URL(`links/${localId}`, scope).href;
    await compare({ kind: "resource", resource: "link", id });
    await compare({ kind: "properties", resource: "link", id });
  }
  for (const name of [
    "tracked-item",
    "work-item",
    "task",
    "bug",
    "feature",
    "chore",
    "epic",
    "decision",
    "relationship",
    "dependency",
    "blocks",
    "relates",
  ])
    await compare({ kind: "resource", resource: "type", id: `https://work.example/types/${name}` });
}

describe("bdptest reference target Read matrix", () => {
  it("passes every checked-in plan with Read admission evidence explicitly stubbed", async () => {
    const withdrawEvidence = establishReadConformanceEvidenceForTesting("bdptest");
    let scenarioTarget: ReturnType<typeof createRawHttpScenarioTarget> | undefined;
    let descriptorPublisher:
      | Awaited<ReturnType<typeof startControlledTypeDescriptorPublisher>>
      | undefined;
    let controlledSession: ControlledReadActionSession | undefined;
    try {
      const artifactBundle = createConformanceArtifactBundle({
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
      const schema = JSON.parse(readText("schemas/bdp-v0.schema.json")) as Record<string, unknown>;
      const schemaValidator = createJsonSchemaValidator(schema);
      const portablePort = createPortableReferenceFixturePort(scope, artifactBundle.fixture);
      await expectReferenceFixtureParity(portablePort);
      scenarioTarget = createRawHttpScenarioTarget(async (scenario, _scope, _seed, fixture) => {
        const advertisedLimits = scenario.setup.requires.includes(
          controlledReadAdvertisedLimitsCapability,
        );
        const controlled =
          scenario.setup.requires.includes(controlledReadCapability) ||
          scenario.setup.requires.includes(controlledReadScopeRestoreCapability) ||
          scenario.setup.requires.includes(controlledReadProblemCapability) ||
          advertisedLimits;
        return startReferenceSession(
          portablePort,
          fixture,
          scenario.setup.requires.includes("unexpected-internal-fault"),
          scenario.setup.requires.includes(controlledReadProblemCapability),
          advertisedLimits ? DEFAULT_SERVER_READ_LIMITS : undefined,
          controlled
            ? (session) => {
                controlledSession = session;
              }
            : undefined,
          () => {
            controlledSession = undefined;
          },
        );
      });
      if (
        !artifactBundle.fixture.capabilities.includes(controlledReadExternalTypePublisherCapability)
      )
        throw new Error("reference fixture does not admit the controlled external publisher");
      descriptorPublisher = await startControlledTypeDescriptorPublisher(
        requireTypeDescriptors(artifactBundle.fixture),
      );
      const clientActions = createBdpClientScenarioActionExecutor({
        fetchImplementation: scenarioTarget.fetch,
        externalTypeDescriptorFetchImplementation: descriptorPublisher.fetch,
      });

      const result = await runConformanceMatrix({
        scope,
        profile: "read",
        seed: 0,
        artifactBundle,
        execute: scenarioTarget.execute,
        actionExecutor: createControlledReadActionExecutor(
          scenarioTarget.fetch,
          clientActions,
          () => controlledSession,
          schemaValidator,
        ),
        harness: scenarioTarget.harness,
        schemaValidator,
        declaredTargetLabel: "in-process-reference-target",
      });

      const resultsById = new Map(result.scenarios.map((scenario) => [scenario.id, scenario]));
      for (const plan of artifactBundle.manifest.scenarios) {
        const observed = resultsById.get(plan.id);
        expect(observed, `${plan.id}: ${JSON.stringify(observed)}`).toMatchObject({
          state: "pass",
        });
      }
      expect(
        result.scenarios
          .filter(({ id }) => !artifactBundle.manifest.scenarios.some((plan) => plan.id === id))
          .every(
            ({ state, category }) => state === "harness-error" && category === "not-implemented",
          ),
      ).toBe(true);
      expect(result.claimEligible).toBe(false);
      await emitMatrixRunForCohort("bdptest", result);

      const readinessSession = await startReferenceSession(portablePort, artifactBundle.fixture);
      try {
        await expectPublicReadiness(
          readinessSession.dialRoute.port,
          artifactBundle.fixture as ReadinessFixture,
        );
      } finally {
        await readinessSession.close(new AbortController().signal);
      }
    } finally {
      try {
        await descriptorPublisher?.close();
      } finally {
        try {
          await scenarioTarget?.close();
        } finally {
          withdrawEvidence();
        }
      }
    }
  });
});

async function startReferenceSession(
  port: ScopePort,
  fixture: ConformanceFixture,
  injectInternalFault = false,
  injectProblemTable = false,
  controlledLimits?: ServerReadLimitsConfig,
  installControlledSession?: (session: ControlledReadActionSession) => void,
  releaseControlledSession: () => void = () => undefined,
) {
  const faultingResource = new URL(requireBinding(fixture, "bead.demo-a"), scope).href;
  const faultPort = injectInternalFault
    ? createReadResourceFaultPortForTesting(port, {
        resource: "bead",
        id: faultingResource,
        error: new Error(
          `private injected adapter fault [${requireInternalFaultSentinel(fixture)}]`,
        ),
      })
    : port;
  const sessionPort = injectProblemTable
    ? createReadProblemTablePortForTesting(faultPort, { scope })
    : faultPort;
  const controlled =
    installControlledSession === undefined
      ? undefined
      : createControlledReadSessionForTesting({
          scope,
          source: sessionPort,
          viewHeader: controlledReadViewHeader,
          epochHeader: controlledReadEpochHeader,
          unauthenticatedChallenge: controlledReadUnauthenticatedChallenge,
          ...(injectProblemTable
            ? {
                unauthenticatedProblemUrl: new URL("beads/?limit=1", scope).href,
              }
            : {}),
          ...(controlledLimits === undefined ? {} : { limits: controlledLimits }),
        });
  const readControls =
    controlled?.readControls ??
    createPublicReadControls({ scope, limits: DEFAULT_SERVER_READ_LIMITS });
  let server: ReturnType<typeof createReadServer>;
  try {
    server = createReadServer({
      scope,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: controlled?.port ?? sessionPort,
      advertisedLimits: advertisedLimitsFor(readControls),
      readControls,
    });
  } catch (error) {
    releaseControlledSession();
    throw error;
  }
  try {
    const listener = createNodeHttpServer(server);
    let listenerFailure: unknown;
    try {
      await listenNodeHttpServer(listener, {
        host: "127.0.0.1",
        port: 0,
        onError: (error) => {
          listenerFailure ??= error;
        },
      });
      const address = listener.address();
      if (address === null || typeof address === "string")
        throw new Error("bdptest matrix listener did not expose a TCP address");
      if (controlled !== undefined) {
        const exposed: ControlledReadActionSession = {
          ...controlled,
          restoreScope: async ({ requestedScope, currentScopeEpoch, signal }) => {
            if (signal.aborted) throw signal.reason;
            if (requestedScope !== undefined && requestedScope !== scope)
              throw new Error("bdptest restore must retain its canonical Scope URL");
            const restoredScopeEpoch =
              currentScopeEpoch === "controlled-restored-epoch"
                ? "controlled-restored-epoch-2"
                : "controlled-restored-epoch";
            const restoredSource = createPortableReferenceFixturePort(scope, fixture);
            const restoredControlled = createControlledReadSessionForTesting({
              scope,
              source: restoredSource,
              viewHeader: controlledReadViewHeader,
              epochHeader: controlledReadEpochHeader,
              unauthenticatedChallenge: controlledReadUnauthenticatedChallenge,
            });
            for (const deletedId of controlled.deletedResourceIds())
              restoredControlled.deleteResource(deletedId);
            const restored = await startReferenceSession(restoredControlled.port, fixture);
            const restoredFetch = createSemanticDialFetch(restored.dialRoute.port);
            return {
              scope,
              scopeEpoch: restoredScopeEpoch,
              fetch: restoredFetch,
              close: () => restored.close(new AbortController().signal),
            };
          },
        };
        installControlledSession?.(exposed);
      }
      return {
        capabilities:
          controlled === undefined
            ? fixture.capabilities.filter((capability) => capability !== controlledReadCapability)
            : fixture.capabilities,
        bindings: fixture.bindings,
        dialRoute: {
          transport: "plain" as const,
          host: "127.0.0.1",
          port: address.port,
        },
        close: async (_signal: AbortSignal) => {
          const failures: unknown[] = [];
          try {
            try {
              await closeNodeHttpServer(listener);
            } catch (error) {
              failures.push(error);
            }
            try {
              await server.close();
            } catch (error) {
              failures.push(error);
            }
          } finally {
            releaseControlledSession();
          }
          if (listenerFailure !== undefined) failures.unshift(listenerFailure);
          if (failures.length > 0)
            throw new AggregateError(failures, "bdptest matrix target cleanup failed");
        },
      };
    } catch (error) {
      if (listener.listening) await closeNodeHttpServer(listener).catch(() => undefined);
      releaseControlledSession();
      throw error;
    }
  } catch (error) {
    await server.close();
    releaseControlledSession();
    throw error;
  }
}

function advertisedLimitsFor(controls: ServerReadControls): ServerAdvertisedReadLimits {
  return {
    page: {
      defaultItems: controls.pagination.limits.defaultPageItems,
      maximumItems: controls.pagination.limits.maxPageItems,
    },
    selector: controls.selectorLimits,
    cursorTtlMilliseconds: controls.pagination.limits.cursorTtlMs,
  };
}

function createSemanticDialFetch(dialPort: number): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const semanticUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const dialUrl = new URL(semanticUrl);
    dialUrl.protocol = "http:";
    dialUrl.hostname = "127.0.0.1";
    dialUrl.port = String(dialPort);
    const response = await fetch(dialUrl, init);
    const semanticResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(semanticResponse, "url", { value: semanticUrl });
    return semanticResponse;
  }) as typeof fetch;
}

function requireInternalFaultSentinel(fixture: ConformanceFixture): string {
  const privateFixture = fixture.private;
  const value =
    typeof privateFixture === "object" && privateFixture !== null && !Array.isArray(privateFixture)
      ? (privateFixture as Readonly<Record<string, unknown>>).internalFaultSentinel
      : undefined;
  if (typeof value !== "string" || value.length === 0)
    throw new Error("fixture private internal-fault sentinel is required");
  return value;
}

function requireBinding(fixture: Pick<ConformanceFixture, "bindings">, binding: string): string {
  const value = fixture.bindings[binding];
  if (value === undefined) throw new Error(`fixture binding '${binding}' is required`);
  return value;
}

function requireTypeDescriptors(
  fixture: ConformanceFixture,
): readonly Readonly<Record<string, unknown>>[] {
  const descriptors = (fixture as ConformanceFixture & { readonly typeDescriptors?: unknown })
    .typeDescriptors;
  if (
    !Array.isArray(descriptors) ||
    descriptors.some((value) => typeof value !== "object" || value === null)
  )
    throw new Error("reference fixture Type Descriptors are required");
  return descriptors as readonly Readonly<Record<string, unknown>>[];
}

async function expectPublicReadiness(dialPort: number, fixture: ReadinessFixture): Promise<void> {
  const dialFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const semanticUrl =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const dialUrl = new URL(semanticUrl);
    dialUrl.protocol = "http:";
    dialUrl.hostname = "127.0.0.1";
    dialUrl.port = String(dialPort);
    const response = await fetch(dialUrl, init);
    const semanticResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(semanticResponse, "url", { value: semanticUrl });
    return semanticResponse;
  }) as typeof fetch;
  const client = new BdpClient({ scope, transport: createFetchTransport(dialFetch) });
  try {
    const ready = await readyBeadsFromClient(client, { blockingLinkType: BLOCKING_LINK_TYPE_ID });
    if ("code" in ready) throw new Error(`public bdptest readiness failed: ${ready.code}`);
    expect(ready.map(({ bead }) => bead.properties.title)).toEqual(
      fixture.expectations.readyTitles,
    );
  } finally {
    await client.close();
  }
}
