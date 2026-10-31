import { isDeepStrictEqual } from "node:util";
import { installedContractsDigest } from "./installed-contract-identity.js";
/** Source-only installed binding. Runner retains sole receipt observation authority. */
import { createHash } from "node:crypto";
import {
  createRawHttpScenarioTarget,
  type ExactHttpModeOptions,
  type ConformanceFixture,
  type ExecutableScenario,
} from "@bdp/conformance";
import {
  bindServedProfileConfiguration,
  assertSameServedProfileConfiguration,
  type TransactionalRunContext,
  type TransactionalSession,
} from "@bdp/conformance/testing";
export interface InstalledTransactionChild {
  readonly ready: Record<string, unknown>;
  close(): Promise<unknown>;
}
export function installedTransactionBinding(
  ready: Record<string, unknown>,
  sourceCommit: string,
  fixture: { bytes: Uint8Array },
) {
  if (
    ready.profile !== "transactional" ||
    ready.history !== false ||
    ready.claimEligible !== false ||
    ready.authorityMode !== "canonical" ||
    typeof ready.scope !== "string" ||
    typeof ready.runtimeConfigurationIdentity !== "string" ||
    !/^[a-f0-9]{64}$/.test(ready.runtimeConfigurationIdentity)
  )
    throw new Error("installed Transactional metadata unavailable");
  if (typeof ready.listenUrl !== "string")
    throw new Error("installed physical session unavailable");
  const url = new URL(ready.listenUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("invalid installed dial binding");
  const targetNames = {
    createBead: "create-bead",
    updateBead: "update-bead",
    deleteBead: "delete-bead",
    createLink: "create-link",
    updateLink: "update-link",
    deleteLink: "delete-link",
    putAlias: "put-alias",
    deleteAlias: "delete-alias",
    updateWhere: "update-where",
    deleteWhere: "delete-where",
    batch: "batch",
    sequence: "sequence",
  };
  const operationTargets = Object.freeze(
    Object.fromEntries(
      Object.entries(targetNames).map(([name, suffix]) => [
        name,
        `${ready.scope}operations/${suffix}`,
      ]),
    ),
  );
  if (!isDeepStrictEqual(ready.targets, operationTargets))
    throw new Error("installed operation target inventory mismatch");
  const served = bindServedProfileConfiguration({
    scope: ready.scope,
    profile: "transactional",
    history: false,
    sourceCommit,
    installedPayloadDigest: ready.payloadIdentity as string,
    installedContractsDigest: installedContractsDigest(ready.artifactIdentity),
    policyDigest: ready.policyIdentity as string,
    authenticationDigest: ready.authenticationIdentity as string,
    fixture,
  });
  return Object.freeze({
    served,
    operationTargets,
    runtimeConfigurationIdentity: ready.runtimeConfigurationIdentity,
    authorityMode: "canonical" as const,
  });
}
export function createTransactionalExecutionBinding(options: {
  readonly baseline: ReturnType<typeof installedTransactionBinding>;
  readonly sourceCommit: string;
  readonly fixtureSource: { bytes: Uint8Array };
  readonly exactMode: ExactHttpModeOptions;
  readonly launch: (
    scenario: string,
    reopen: boolean,
    signal: AbortSignal,
  ) => Promise<InstalledTransactionChild>;
}) {
  let active:
    | (TransactionalSession & { controller: AbortController; pending: Set<Promise<unknown>> })
    | undefined;
  let generation = 0;
  let presentation:
    | { scenario: ExecutableScenario; scope: string; seed: number; fixture: ConformanceFixture }
    | undefined;
  let reopening = false;
  const target = createRawHttpScenarioTarget(
    async (scenario, scope, seed, fixture, signal) => {
      const child = await options.launch(scenario.id, reopening, signal);
      try {
        if (signal.aborted) throw new Error("installed preparation aborted");
        const actual = installedTransactionBinding(
          child.ready,
          options.sourceCommit,
          options.fixtureSource,
        );
        assertSameServedProfileConfiguration(options.baseline.served, actual.served);
        if (
          actual.runtimeConfigurationIdentity !== options.baseline.runtimeConfigurationIdentity ||
          actual.authorityMode !== options.baseline.authorityMode
        )
          throw new Error("installed runtime identity mismatch");
        const listenUrl = child.ready.listenUrl as string,
          address = new URL(listenUrl);
        const controller = new AbortController(),
          pending = new Set<Promise<unknown>>();
        const binding = Object.freeze({
          scenario: scenario.id,
          generation: ++generation,
          listenUrl,
          runtimeConfigurationIdentity: actual.runtimeConfigurationIdentity,
          responseLimits: Object.freeze({
            headerBytes: 65536 as const,
            bodyBytes: 1048576 as const,
            wireBytes: 2097152 as const,
          }),
          configurationDigest: createHash("sha256")
            .update(JSON.stringify(actual.served))
            .digest("hex"),
        });
        const current = {
          binding,
          controller,
          pending,
          signal: AbortSignal.any([controller.signal, signal]),
          dialRoute: Object.freeze({
            transport: "plain" as const,
            host: address.hostname,
            port: Number(address.port),
          }),
          resolveCredentials: options.exactMode.resolveCredentials,
          register<T>(operation: Promise<T>) {
            pending.add(operation);
            void operation.then(
              () => pending.delete(operation),
              () => pending.delete(operation),
            );
            return operation;
          },
        };
        active = current;
        presentation = { scenario, scope, seed, fixture };
        return {
          capabilities: fixture.capabilities,
          bindings: fixture.bindings,
          dialRoute: current.dialRoute,
          async close() {
            if (active === current) active = undefined;
            controller.abort();
            await Promise.allSettled([...pending]);
            await child.close();
          },
        };
      } catch (error) {
        try {
          await child.close();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "installed session setup cleanup failed");
        }
        throw error;
      }
    },
    {
      exactMode: options.exactMode,
      requestTimeoutMs: 5000,
      cleanupTimeoutMs: 10000,
      maximumHeaderBytes: 65536,
      maximumBodyBytes: 1048576,
    },
  );
  const context: TransactionalRunContext = {
    current(scenario) {
      if (!active || active.binding.scenario !== scenario || active.signal.aborted)
        throw new Error("installed session unavailable");
      return active;
    },
    async reopen(scenario, signal) {
      const old = presentation;
      if (!old || old.scenario.id !== scenario || !active)
        throw new Error("reopen outside active scenario");
      await target.close(signal);
      reopening = true;
      try {
        await target.harness.prepare(old.scenario, old.scope, old.seed, old.fixture, signal);
      } finally {
        reopening = false;
      }
    },
  };
  return Object.freeze({ target, context });
}
