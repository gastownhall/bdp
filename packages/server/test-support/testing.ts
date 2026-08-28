import {
  isReadProblemCode,
  type ReadProblem,
  type ReadProblemCode,
  readProblemDefinitionFor,
} from "@bdp/protocol";
import { createReadPagination, type ScopePort, type ServerReadControls } from "../src/index.js";
import {
  hasReadConformanceEvidence,
  type ReadServerTarget,
} from "../src/read-conformance-capability.js";
import { readConformanceMockState } from "./read-conformance-mock-state.js";

/**
 * Server-owned test seam. This entry is mapped only by the repository's test
 * and no-emit typecheck configurations; it is outside the production source
 * tree and cannot be emitted or imported by installed consumers.
 */
const conformance = readConformanceMockState();

export function establishReadConformanceEvidenceForTesting(target: ReadServerTarget): () => void {
  assertObservedReadConformanceMockForTesting(
    conformance.installedMock,
    hasReadConformanceEvidence,
  );
  conformance.grants.set(target, (conformance.grants.get(target) ?? 0) + 1);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const remaining = (conformance.grants.get(target) ?? 1) - 1;
    if (remaining === 0) conformance.grants.delete(target);
    else conformance.grants.set(target, remaining);
  };
}

/** Injects one exact Resource failure through the non-emitted server test seam. */
export function createReadResourceFaultPortForTesting(
  port: ScopePort,
  fault: {
    readonly resource: "bead" | "link" | "type";
    readonly id: string;
    readonly error: Error;
  },
): ScopePort {
  return {
    async perform(operation, options) {
      if (
        operation.kind === "resource" &&
        operation.resource === fault.resource &&
        operation.id === fault.id
      )
        throw fault.error;
      return port.perform(operation, options);
    },
  };
}

/**
 * Injects every closed Read Problem row through an ordinary public Resource
 * route. Semantic applicability remains owned by the scenarios that exercise
 * natural triggers; this seam proves the shared server's exact serialization.
 */
export function createReadProblemTablePortForTesting(
  port: ScopePort,
  options: { readonly scope: string; readonly pathPrefix?: string },
): ScopePort {
  const pathPrefix = options.pathPrefix ?? "beads/__problem__/";
  const prefix = new URL(pathPrefix, options.scope).href;
  return {
    async perform(operation, performOptions) {
      if (
        operation.kind === "resource" &&
        operation.resource === "bead" &&
        operation.id.startsWith(prefix)
      ) {
        const encodedCode = operation.id.slice(prefix.length);
        if (!encodedCode.includes("/") && isReadProblemCode(encodedCode))
          return { kind: "problem", problem: exactReadProblem(encodedCode) };
      }
      return port.perform(operation, performOptions);
    },
  };
}

export interface ControlledReadSessionForTesting {
  readonly port: ScopePort;
  readonly readControls: ServerReadControls;
  advanceClock(milliseconds: number): void;
  materializeAdvertisedLimitFixture(): void;
  mutateSource(mutation: { readonly id: string; readonly revision: string }): void;
  excludeResourceFromAuthorizationView(id: string): void;
  deleteResource(id: string): void;
  deletedResourceIds(): readonly string[];
  adapterReads(): number;
  adapterReadsByProjection(): Readonly<{ collection: number; incidentLinks: number }>;
  forbidAdapterReads(): () => void;
}

/** Creates the deterministic source, clock, identity, and cursor controls used by Read matrices. */
export function createControlledReadSessionForTesting(options: {
  readonly scope: string;
  readonly source: ScopePort;
  readonly viewHeader: string;
  readonly epochHeader: string;
  readonly unauthenticatedChallenge: string;
  readonly unauthenticatedProblemUrl?: string;
  readonly limits?: {
    readonly selector: { readonly bytes: number; readonly depth: number; readonly nodes: number };
    readonly page: { readonly defaultItems: number; readonly maximumItems: number };
    readonly cursorTtlMilliseconds: number;
  };
}): ControlledReadSessionForTesting {
  let now = 1_000;
  let token = 0;
  let advertisedLimitFixtureRequested = false;
  let mutation: { readonly id: string; readonly revision: string } | undefined;
  let authorizationExcludedId: string | undefined;
  const deletedIds = new Set<string>();
  let reads = 0;
  let collectionReads = 0;
  let incidentLinkReads = 0;
  let readsForbidden = false;
  const port: ScopePort = {
    async perform(operation, performOptions) {
      reads += 1;
      if (operation.kind === "collection") collectionReads += 1;
      if (operation.kind === "bead-links") incidentLinkReads += 1;
      if (readsForbidden) throw new Error("pagination continuation reread the source adapter");
      const directId =
        operation.kind === "resource" || operation.kind === "properties"
          ? operation.id
          : operation.kind === "bead-links"
            ? operation.bead
            : undefined;
      if (
        directId !== undefined &&
        (directId === authorizationExcludedId || deletedIds.has(directId))
      )
        return { kind: "problem", problem: exactReadProblem("resource-not-found") };
      const result = await options.source.perform(operation, performOptions);
      if (
        result.kind !== "success" ||
        (operation.kind !== "collection" && operation.kind !== "bead-links")
      )
        return result;
      const originalBody = result.body;
      const body = originalBody as { readonly items: readonly unknown[]; readonly next: null };
      const activeMutation = mutation;
      const absoluteMutationId =
        activeMutation === undefined ? undefined : new URL(activeMutation.id, options.scope).href;
      let items: readonly unknown[] = body.items;
      let modified = false;
      if (
        advertisedLimitFixtureRequested &&
        operation.kind === "collection" &&
        operation.collection === "beads" &&
        operation.type === undefined &&
        operation.conformsTo === undefined
      ) {
        const template = body.items.find(
          (item) => isPlainRecord(item) && typeof item.id === "string",
        );
        if (template === undefined || options.limits === undefined)
          throw new Error("controlled advertised-limit fixture requires a Resource template");
        const invalidItems = body.items.filter(
          (item) => !isPlainRecord(item) || typeof item.id !== "string",
        );
        const requestedLength = options.limits.page.maximumItems + 1;
        const materializedLength = Math.max(0, requestedLength - invalidItems.length);
        items = [
          ...invalidItems,
          ...Array.from({ length: materializedLength }, (_, index) =>
            Object.freeze({
              ...template,
              id: new URL(`beads/limit-${index}`, options.scope).href,
              revision: `limit-${index}`,
            }),
          ),
        ];
        modified = true;
      }
      items = items.filter((item) => {
        if (!isPlainRecord(item) || typeof item.id !== "string") return true;
        const excluded = item.id === authorizationExcludedId || deletedIds.has(item.id);
        if (excluded) modified = true;
        return !excluded;
      });
      items = items.map((item) => {
        if (
          absoluteMutationId === undefined ||
          !isPlainRecord(item) ||
          item.id !== absoluteMutationId
        )
          return item;
        modified = true;
        return Object.freeze({ ...item, revision: activeMutation?.revision });
      });
      if (!modified) return result;
      const controlledBody = Object.freeze({
        ...body,
        items: Object.freeze(items),
      }) as typeof originalBody;
      return { kind: "success", body: controlledBody };
    },
  };
  const readControls: ServerReadControls = {
    selectorLimits: options.limits?.selector ?? { bytes: 128, depth: 16, nodes: 64 },
    pagination: createReadPagination({
      scope: options.scope,
      defaultPageItems: options.limits?.page.defaultItems ?? 2,
      maxPageItems: options.limits?.page.maximumItems ?? 4,
      cursorTtlMs: options.limits?.cursorTtlMilliseconds ?? 100,
      retainedStateCapacity: 256,
      maxRetainedCursorPositionsPerSnapshot: 100,
      retainedSnapshotByteCapacity: 1_048_576,
      retainedSnapshotNodeCapacity: 65_536,
      maxOpaqueTokenLength: 64,
      tokenGenerationAttempts: 4,
      clock: () => now,
      generateOpaqueToken: () => `matrix_${++token}`,
    }),
    unauthenticatedChallenge: options.unauthenticatedChallenge,
    identityFor: (operation, { httpRequest }) => {
      if (
        options.unauthenticatedProblemUrl !== undefined &&
        httpRequest?.url === options.unauthenticatedProblemUrl
      )
        return exactReadProblem("unauthenticated");
      if (operation.kind === "scope-discovery") {
        return {
          authorizationView: "controlled-discovery-view",
          scopeEpoch: "controlled-discovery-epoch",
        };
      }
      const authorizationView = httpRequest?.headers.get(options.viewHeader);
      const scopeEpoch = httpRequest?.headers.get(options.epochHeader);
      return authorizationView === null || authorizationView === undefined || scopeEpoch == null
        ? conformanceReadProblem("invalid-parameter")
        : { authorizationView, scopeEpoch };
    },
    problemFor: (error) =>
      conformanceReadProblem(
        error.code === "foreign-view"
          ? "foreign-view"
          : error.code === "cursor-expired"
            ? "cursor-expired"
            : error.code === "invalid-limit" ||
                error.code === "source-bytes-limit-exceeded" ||
                error.code === "ast-depth-limit-exceeded" ||
                error.code === "ast-nodes-limit-exceeded"
              ? "limit-exceeded"
              : "invalid-parameter",
      ),
  };
  return Object.freeze({
    port,
    readControls,
    advanceClock(milliseconds: number) {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
        throw new Error("controlled pagination clock advance must be a non-negative integer");
      now += milliseconds;
    },
    materializeAdvertisedLimitFixture() {
      if (options.limits === undefined)
        throw new Error("controlled advertised-limit fixture requires configured limits");
      advertisedLimitFixtureRequested = true;
    },
    mutateSource(nextMutation: { readonly id: string; readonly revision: string }) {
      if (
        typeof nextMutation.id !== "string" ||
        nextMutation.id.length === 0 ||
        typeof nextMutation.revision !== "string" ||
        nextMutation.revision.length === 0
      )
        throw new Error("controlled pagination mutation is invalid");
      mutation = Object.freeze({ ...nextMutation });
    },
    excludeResourceFromAuthorizationView(id: string) {
      if (typeof id !== "string" || id.length === 0)
        throw new Error("controlled authorization exclusion is invalid");
      authorizationExcludedId = new URL(id, options.scope).href;
    },
    deleteResource(id: string) {
      if (typeof id !== "string" || id.length === 0)
        throw new Error("controlled deleted Resource identity is invalid");
      deletedIds.add(new URL(id, options.scope).href);
    },
    deletedResourceIds: () => Object.freeze([...deletedIds].sort()),
    adapterReads: () => reads,
    adapterReadsByProjection: () =>
      Object.freeze({ collection: collectionReads, incidentLinks: incidentLinkReads }),
    forbidAdapterReads: () => {
      if (readsForbidden) throw new Error("source adapter read guard is already active");
      readsForbidden = true;
      return () => {
        readsForbidden = false;
      };
    },
  });
}

function conformanceReadProblem(
  code:
    | "invalid-parameter"
    | "foreign-view"
    | "cursor-expired"
    | "resource-not-found"
    | "limit-exceeded",
): ReturnType<ServerReadControls["problemFor"]> {
  return exactReadProblem(code);
}

function exactReadProblem(code: ReadProblemCode): ReadProblem {
  const definition = readProblemDefinitionFor(code);
  return {
    type: definition.type,
    code: definition.code,
    retry: definition.retry,
    status: definition.status,
  };
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertObservedReadConformanceMockForTesting(
  installedMock: ((target: ReadServerTarget) => boolean) | undefined,
  observedBinding: (target: ReadServerTarget) => boolean,
): void {
  if (installedMock !== observedBinding)
    throw new Error("test-support module did not observe its installed Read evidence mock");
}
