/** Mutable reference authority for explicit development use. No profile admission. */
import { randomBytes } from "node:crypto";
import {
  isReadProblem,
  parseCanonicalScope,
  parseTypeDescriptor,
  prepareReadUpdateSingleton,
  stringifyJsonValue,
  type ReadUpdateOperation,
} from "@bdp/protocol";
import { openRecoveryStore } from "./recovery-store.js";
import { createSequenceLifecycle, type SequenceLifecycle } from "./sequence-executor.js";
import { createReadSequenceLifecycle } from "./read-sequence-lifecycle.js";
import {
  assertReadUpdateRuntimeCompatibility,
  snapshotReadUpdateRuntimeLimits,
} from "./read-update-runtime-limits.js";
import { readStoredResource } from "./resource-evaluator.js";
import { requestFromUrl } from "./read-request.js";

export const DEVELOPMENT_BEAD_TYPE = "https://bdp.example/development/bead";
export const DEVELOPMENT_LINK_TYPE = "https://bdp.example/development/link";
export const DEVELOPMENT_LIMITS = Object.freeze({
  requestBodyBytes: 64 * 1024,
  propertiesBytes: 64 * 1024,
  diagnosticBytes: 512 * 1024,
  diagnosticCount: 32,
});
const day = 86_400_000;
const installation = "bdptest-development-1-metadata-basis";
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

export interface DevelopmentAuthorityOptions {
  readonly scope: string;
  readonly directory: string;
  /** Explicit first provisioning, never inferred from a missing database. */
  readonly create: boolean;
}

export async function openDevelopmentAuthority(options: DevelopmentAuthorityOptions) {
  const scope = parseCanonicalScope(options.scope);
  const store = openRecoveryStore({
    scope,
    directory: options.directory,
    installationId: installation,
    lineageId: installation,
    minimumRetentionMs: day,
    ...(options.create ? { create: { types } } : {}),
  });
  let owner: SequenceLifecycle | undefined;
  try {
    // This closed reference contract set has no schema compiler callbacks or
    // mutable policy. Refuse foreign installations rather than silently adopt them.
    const installed = new Set<string>();
    store.visitInstalledTypes(({ id, bodyJson }) => {
      if (types[id] !== bodyJson) throw new Error("unexpected installed development Type");
      installed.add(id);
    });
    if (installed.size !== descriptors.length) throw new Error("missing development Type");
    store.read((reader) => {
      for (const row of reader.resources()) {
        const resource = readStoredResource(row, scope);
        if (!installed.has(resource.type)) throw new Error("uninstalled development Resource Type");
      }
    });
    store.expire(Date.now());
    const bounds = snapshotReadUpdateRuntimeLimits(DEVELOPMENT_LIMITS);
    assertReadUpdateRuntimeCompatibility(store, bounds);
    owner = createSequenceLifecycle({
      store,
      maximumSequenceOperations: 1,
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
            message: "unsupported number",
            instanceLocation: pointer,
          }),
        },
        retentionMs: day,
        minimumRetentionMs: day,
        clock: Date.now,
        contracts: {
          get(id, bytes) {
            if (types[id] !== bytes) return undefined;
            const descriptor = descriptors.find((candidate) => candidate.id === id);
            return descriptor === undefined ? undefined : { descriptor };
          },
        },
        captureMemberContext() {
          return { ...configuration, recordChangeContext: false, policy };
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
        scopeConfiguration: { capture: () => configuration },
        installedTypes: descriptors,
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
        captureReadAuthorization() {
          return {
            kind: "authorized",
            authorization: {
              authorizationView: epoch,
              scopeEpoch: epoch,
              policy,
              canReadType: () => true,
            },
          };
        },
      },
    });
    const reads = lifecycle.readFor({ kind: "authenticated", principal });
    return Object.freeze({
      scope,
      async mutate(operation: ReadUpdateOperation, text: string, key: string) {
        const carrier = prepareReadUpdateSingleton(scope, operation, text, key);
        const submission = lifecycle.submit(carrier, principal);
        if (submission.kind === "refused") return submission.problem;
        const result = await submission.completion;
        if (result.kind !== "singleton") throw new Error("unexpected development completion");
        return result.disposition;
      },
      async read(url: URL) {
        const request = requestFromUrl(url, scope);
        if (isReadProblem(request)) return { kind: "problem" as const, problem: request };
        return reads.perform(request);
      },
      close: () => lifecycle.close(),
    });
  } catch (error) {
    if (owner) await owner.close();
    else store.close();
    throw error;
  }
}
