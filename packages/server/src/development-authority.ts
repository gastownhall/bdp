/** Mutable reference authority for explicit development use. No profile admission. */
import { randomBytes, createHash } from "node:crypto";
import {
  isReadProblem,
  parseCanonicalScope,
  parseTypeDescriptor,
  prepareReadUpdateSingleton,
  prepareReadUpdateSequence,
  stringifyJsonValue,
  type ReadUpdateOperation,
  type ReadRequest,
  type MaximumEndpointMultiplicityPolicy,
} from "@bdp/protocol";
import { openRecoveryStore } from "./recovery-store.js";
import {
  createSequenceLifecycle,
  type SequenceLifecycle,
  type LifecycleScheduler,
} from "./sequence-executor.js";
import { createReadSequenceLifecycle } from "./read-sequence-lifecycle.js";
import {
  assertReadUpdateRuntimeCompatibility,
  snapshotReadUpdateRuntimeLimits,
} from "./read-update-runtime-limits.js";
import type { StablePrincipal } from "./member-executor.js";
import {
  administrativeData,
  administrativeArray,
  assertDevelopmentContracts,
  assertDevelopmentAccessPolicy,
  type DevelopmentContracts,
  type DevelopmentAccessPolicy,
} from "./development-contracts.js";
import { readStoredResource } from "./resource-evaluator.js";
import { requestFromUrl, classifyAliasPath } from "./read-request.js";

export const DEVELOPMENT_BEAD_TYPE = "https://bdp.example/development/bead";
export const DEVELOPMENT_LINK_TYPE = "https://bdp.example/development/link";
export const DEVELOPMENT_LIMITS = Object.freeze({
  sequenceOperations: 32,
  requestBodyBytes: 64 * 1024,
  propertiesBytes: 64 * 1024,
  diagnosticBytes: 512 * 1024,
  diagnosticCount: 32,
});
const day = 86_400_000;
const installation = "bdptest-development-2-revision-provenance";
const principal = Object.freeze({ id: "bdptest-development-operator" });
const policy = Object.freeze({
  canRead: () => true,
  canCreate: () => true,
  canWrite: () => true,
  canWriteBead: () => true,
});
const configuration = Object.freeze({
  policyIdentity: installation,
  configurationIdentity: installation,
  maximumEndpointMultiplicity: Object.freeze([]),
});
const descriptors = Object.freeze([
  parseTypeDescriptor({
    id: DEVELOPMENT_BEAD_TYPE,
    name: "Development Bead",
    describes: "bead",
    conformsTo: [],
  }),
  parseTypeDescriptor({
    id: DEVELOPMENT_LINK_TYPE,
    name: "Development Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [DEVELOPMENT_BEAD_TYPE], external: "opaque" },
    target: { conformsTo: [DEVELOPMENT_BEAD_TYPE], external: "opaque" },
  }),
]);
const types = Object.fromEntries(descriptors.map((d) => [d.id, stringifyJsonValue(d)]));

export interface DevelopmentAuthorityConfiguration {
  readonly contracts: DevelopmentContracts;
  readonly access: DevelopmentAccessPolicy;
  readonly maximumEndpointMultiplicity: readonly MaximumEndpointMultiplicityPolicy[];
}
export interface DevelopmentAuthorityOptions {
  readonly scope: string;
  readonly directory: string;
  /** Explicit first provisioning, never inferred from a missing database. */
  readonly create: boolean;
  /** Private composition seam; no scheduler enters public configuration. */
  readonly scheduler?: LifecycleScheduler;
  /** Private retention clock; absent in public development configuration. */
  readonly clock?: () => number;
  readonly configuration?: DevelopmentAuthorityConfiguration;
}

export async function openDevelopmentAuthority(options: DevelopmentAuthorityOptions) {
  const scope = parseCanonicalScope(options.scope);
  const clock = options.clock ?? Date.now;
  const configured =
    options.configuration === undefined
      ? undefined
      : (Object.freeze(
          administrativeData(options.configuration, [
            "contracts",
            "access",
            "maximumEndpointMultiplicity",
          ]),
        ) as unknown as DevelopmentAuthorityConfiguration);
  if (configured) {
    assertDevelopmentContracts(configured.contracts);
    assertDevelopmentAccessPolicy(configured.access);
  }
  const installedDescriptors = configured?.contracts.descriptors ?? descriptors;
  const installedTypes = configured?.contracts.types ?? types;
  const contractIdentity = configured?.contracts.identity ?? installation;
  const aggregate = configured
    ? Object.freeze(
        administrativeArray(configured.maximumEndpointMultiplicity, 1000).map((value) => {
          const item = administrativeData(value, [
            "endpoint",
            "linkConformsTo",
            "max",
          ]) as unknown as MaximumEndpointMultiplicityPolicy;
          if (
            !item ||
            !["source", "target"].includes(item.endpoint) ||
            !Number.isSafeInteger(item.max) ||
            item.max < 0 ||
            !installedDescriptors.some(
              (d) => d.id === item.linkConformsTo && d.describes === "link",
            )
          )
            throw new TypeError("invalid installed aggregate policy");
          return Object.freeze({
            endpoint: item.endpoint,
            linkConformsTo: item.linkConformsTo,
            max: item.max,
          });
        }),
      )
    : configuration.maximumEndpointMultiplicity;
  const installationIdentity = configured
    ? `${contractIdentity}-${createHash("sha256").update(stringifyJsonValue(aggregate)).digest("hex")}`
    : installation;
  const capturedConfiguration = () => ({
    policyIdentity: configured?.access.identity() ?? installation,
    configurationIdentity: installationIdentity,
    maximumEndpointMultiplicity: aggregate,
  });
  const capturedPolicy = (principal: StablePrincipal) => {
    if (!configured) return policy;
    const snapshot = configured.access.capture(principal.id);
    const local = (id: string) => (id.startsWith(scope) ? id.slice(scope.length) : id);
    const canRead = (record: import("./resource-evaluator.js").ResourceRecord) =>
      !snapshot.hidden.includes(local(record.id));
    const canWrite = (record: import("./resource-evaluator.js").ResourceRecord) =>
      snapshot.write && !snapshot.readOnly.includes(local(record.id));
    return Object.freeze({
      canRead,
      canCreate: () => snapshot.create,
      canWrite,
      canWriteBead: canWrite,
    });
  };
  const store = openRecoveryStore({
    scope,
    directory: options.directory,
    installationId: installationIdentity,
    lineageId: installationIdentity,
    minimumRetentionMs: day,
    ...(options.create ? { create: { types: installedTypes } } : {}),
  });
  let owner: SequenceLifecycle | undefined;
  try {
    // Administrative artifacts are compiled before opening. Exact installed
    // descriptor bytes and the closure-derived installation identity must match.
    const installed = new Set<string>();
    store.visitInstalledTypes(({ id, bodyJson }) => {
      if (installedTypes[id] !== bodyJson) throw new Error("unexpected installed development Type");
      installed.add(id);
    });
    if (installed.size !== installedDescriptors.length) throw new Error("missing development Type");
    store.read((reader) => {
      for (const row of reader.resources()) {
        const resource = readStoredResource(row, scope);
        if (!installed.has(resource.type)) throw new Error("uninstalled development Resource Type");
      }
    });
    store.expire(clock());
    const bounds = snapshotReadUpdateRuntimeLimits(DEVELOPMENT_LIMITS);
    assertReadUpdateRuntimeCompatibility(store, bounds);
    owner = createSequenceLifecycle({
      store,
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
      maximumSequenceOperations: DEVELOPMENT_LIMITS.sequenceOperations,
      maintenanceIntervalMs: 60_000,
      member: {
        scope,
        limits: {
          ...bounds,
          patchOperations: 128,
          patchPathBytes: 4096,
          patchPathDepth: 32,
          representationBytes: 256 * 1024,
        },
        numericBudget: {
          diagnostics: DEVELOPMENT_LIMITS.diagnosticCount,
          diagnosticBytes: bounds.diagnosticBytes,
          diagnostic: ({ pointer }) => ({
            message:
              pointer.startsWith("/propertiesChange/") || pointer.startsWith("/metadataChange/")
                ? `unsupported number at request location ${pointer}`
                : "unsupported number",
          }),
        },
        retentionMs: day,
        minimumRetentionMs: day,
        clock,
        contracts: configured?.contracts.registry ?? {
          get(id, bytes) {
            if (types[id] !== bytes) return undefined;
            const descriptor = descriptors.find((candidate) => candidate.id === id);
            return descriptor === undefined ? undefined : { descriptor };
          },
        },
        captureMemberContext(_reader, principal) {
          return {
            ...capturedConfiguration(),
            recordChangeContext: false,
            policy: capturedPolicy(principal),
          };
        },
      },
    });
    const epoch = randomBytes(24).toString("base64url");
    const readLimits = {
      page: { defaultItems: 20, maximumItems: 100 },
      selector: { bytes: 4096, depth: 32, nodes: 256 },
      cursorTtlMilliseconds: 60_000,
    };
    const lifecycle = await createReadSequenceLifecycle({
      owner,
      read: {
        scopeEpoch: epoch,
        scopeConfiguration: { capture: capturedConfiguration },
        installedTypes: installedDescriptors,
        selectorLimits: readLimits.selector,
        advertisedLimits: readLimits,
        pagination: {
          scope,
          defaultPageItems: 20,
          maxPageItems: 100,
          cursorTtlMs: 60_000,
          retainedStateCapacity: 100,
          maxRetainedCursorPositionsPerSnapshot: 20,
          retainedSnapshotByteCapacity: 4 * 1024 * 1024,
          retainedSnapshotNodeCapacity: 100_000,
          maxOpaqueTokenLength: 64,
          tokenGenerationAttempts: 3,
          idleCleanup: "on-demand",
          clock: Date.now,
          generateOpaqueToken: () => randomBytes(24).toString("base64url"),
        },
        captureReadAuthorization(_reader, readPrincipal) {
          if (readPrincipal.kind !== "authenticated")
            throw new TypeError("authenticated development Read required");
          const principal = readPrincipal.principal;
          return {
            kind: "authorized",
            authorization: {
              authorizationView: `${epoch}:${principal.id}:${configured?.access.capture(principal.id).identity ?? installation}`,
              scopeEpoch: epoch,
              policy: capturedPolicy(principal),
              canReadType: () => true,
            },
          };
        },
      },
    });
    const forPrincipal = (principal: StablePrincipal) => {
      const reads = lifecycle.readFor({ kind: "authenticated", principal });
      return Object.freeze({
        scope,
        // Private HTTP composition reads the very configuration used by this owner.
        limits: DEVELOPMENT_LIMITS,
        discover: () => reads.perform({ kind: "scope-discovery", scope }),
        resolveAlias: (url: string) => reads.resolveAlias(url),
        async perform(request: ReadRequest) {
          const result = await reads.perform(request);
          return result.kind === "success" ? { ...result, request } : result;
        },
        async mutate(
          operation: ReadUpdateOperation,
          text: string,
          key: string,
          acceptsJson = true,
        ) {
          const carrier = prepareReadUpdateSingleton(scope, operation, text, key);
          const submission = lifecycle.submit(carrier, principal, { acceptsJson });
          if (submission.kind === "refused") return submission.problem;
          if (submission.kind === "not-acceptable") return submission;
          const result = await submission.completion;
          if (result.kind !== "singleton") throw new Error("unexpected development completion");
          return result.disposition;
        },
        async sequence(text: string, acceptsJson = true) {
          const carrier = prepareReadUpdateSequence(scope, text);
          const submission = lifecycle.submit(carrier, principal, { acceptsJson });
          if (submission.kind === "refused") return submission.problem;
          if (submission.kind === "not-acceptable") return submission;
          const result = await submission.completion;
          if (result.kind !== "sequence") throw new Error("unexpected development completion");
          return result.response;
        },
        async read(url: URL) {
          if (classifyAliasPath(url, scope) !== undefined) return reads.resolveAlias(url.href);
          const request = requestFromUrl(url, scope);
          if (isReadProblem(request)) return { kind: "problem" as const, problem: request };
          const result = await reads.perform(request);
          return result.kind === "success" ? { ...result, request } : result;
        },
      });
    };
    return Object.freeze({
      ...forPrincipal(principal),
      forPrincipal,
      close: () => lifecycle.close(),
    });
  } catch (error) {
    if (owner) await owner.close();
    else store.close();
    throw error;
  }
}
