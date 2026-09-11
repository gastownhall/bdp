import { isProxy } from "node:util/types";
import {
  type AbsoluteHttpUrl,
  type BeadRecord,
  type LinkRecord,
  type MaximumEndpointMultiplicityPolicy,
  type ReadBodyFor,
  type ReadProblem,
  type ReadRequest,
  type Reference,
  type ScopeReadOperation,
  type TypeDescriptor,
  type TypeSummary,
  type TypeConformanceIndex,
  ProtocolArtifactValidationError,
  createTypeConformanceIndex,
  isReadProblem,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseReadProblem,
  parseTypeDescriptor,
  referenceUri,
} from "@bdp/protocol";
import type { ServerAdvertisedReadLimits } from "./index.js";
import type { StablePrincipal } from "./member-executor.js";
import type { StoreReader, StoredResource } from "./recovery-store.js";
import {
  type ResourceMutationPolicy,
  type ResourceRecord,
  isResourceVisible,
  readStoredResource,
} from "./resource-evaluator.js";
import {
  type ReadPaginationOptions,
  type ReadPagination,
  createReadPagination,
  ReadPaginationError,
} from "./read-pagination.js";
import {
  type ReadSelectorLimits,
  ReadSelectorError,
  selectReadResources,
} from "./read-selector.js";
import {
  type PageOperation,
  classifyAliasPath,
  continuationDetails,
  continuationUrlFor,
  inCanonicalUriOrder,
  isPageOperation,
  notFound,
  readControlProblem,
  resolveReadRequestVariant,
  ScopeServerClosedError,
  ScopeServerOperationAbortedError,
  validateServerBead,
  validateServerLink,
  validateServerEndpoint,
  validateServerLocalResourceId,
} from "./read-request.js";

export type ReadPrincipal =
  | { readonly kind: "authenticated"; readonly principal: StablePrincipal }
  | { readonly kind: "anonymous" };
export interface ScopeReadConfiguration {
  readonly policyIdentity: string;
  readonly configurationIdentity: string;
  readonly maximumEndpointMultiplicity: readonly MaximumEndpointMultiplicityPolicy[];
}
export interface ScopeConfigurationSource {
  capture(reader: StoreReader): ScopeReadConfiguration;
}
export interface CapturedReadAuthorization {
  readonly authorizationView: string;
  readonly scopeEpoch: string;
  readonly policy: Pick<ResourceMutationPolicy, "canRead">;
  readonly canReadType: (descriptor: TypeDescriptor) => boolean;
}
export type ReadIntent = ReadRequest | { readonly kind: "alias"; readonly url: string };
export type ReadAuthorizationDecision =
  | { readonly kind: "authorized"; readonly authorization: CapturedReadAuthorization }
  | { readonly kind: "problem"; readonly problem: ReadProblem };

export type OwnerReadEntryResult<T> =
  | { readonly kind: "read"; readonly value: T }
  | {
      readonly kind: "entry-refused";
      readonly reason: "not-accepting" | "reentrant";
      readonly cause: unknown;
    };
export interface AuthorityReadEntry {
  readonly scope: string;
  withRead<T>(callback: (reader: StoreReader) => T): OwnerReadEntryResult<T>;
}
export interface AuthorityReadOptions {
  readonly entry: AuthorityReadEntry;
  readonly scopeEpoch: string; // qualified Scope-wide, fixed for this plane lifetime
  readonly scopeConfiguration: ScopeConfigurationSource;
  readonly installedTypes: readonly TypeDescriptor[];
  readonly selectorLimits: ReadSelectorLimits;
  readonly pagination: ReadPaginationOptions & {
    readonly idleCleanup: "timer" | "on-demand";
  };
  readonly advertisedLimits: ServerAdvertisedReadLimits;
  captureReadAuthorization(
    reader: StoreReader,
    principal: ReadPrincipal,
    request: ReadIntent,
  ): ReadAuthorizationDecision;
}
export interface ReadObservation {
  readonly authorizationView: string;
  readonly scopeEpoch: string;
  readonly policyIdentity: string;
  readonly configurationIdentity: string;
}
export interface ResourceReadObservation extends ReadObservation {
  readonly resourceRevision: string;
}
export type ResourceValueRequest = Extract<
  ScopeReadOperation,
  { readonly kind: "resource" | "properties"; readonly resource: "bead" | "link" }
>;
export type ObservationFor<O extends ScopeReadOperation> = O extends ResourceValueRequest
  ? ResourceReadObservation
  : ReadObservation;
export type ReadRefusal =
  | { readonly kind: "problem"; readonly phase: "pre-context"; readonly problem: ReadProblem }
  | {
      readonly kind: "problem";
      readonly phase: "observed";
      readonly problem: ReadProblem;
      readonly observation: ReadObservation;
    };
export interface AuthorityDiscoveryData {
  readonly scope: AbsoluteHttpUrl;
  readonly beads: AbsoluteHttpUrl;
  readonly links: AbsoluteHttpUrl;
  readonly types: AbsoluteHttpUrl;
  readonly aliases: AbsoluteHttpUrl;
  readonly order: "canonical-uri";
  readonly limits: ServerAdvertisedReadLimits;
  readonly maximumEndpointMultiplicity: readonly MaximumEndpointMultiplicityPolicy[];
}
export type AuthorityReadResult<O extends ReadRequest> = O extends ScopeReadOperation
  ?
      | {
          readonly kind: "success";
          readonly body: ReadBodyFor<O>;
          readonly observation: ObservationFor<O>;
        }
      | ReadRefusal
  :
      | {
          readonly kind: "discovery";
          readonly data: AuthorityDiscoveryData;
          readonly observation: ReadObservation;
        }
      | ReadRefusal;
export type AuthorityAliasResult =
  | {
      readonly kind: "target";
      readonly target: AbsoluteHttpUrl;
      readonly observation: ReadObservation;
    }
  | ReadRefusal;
export interface AuthorityReadFacet {
  perform<O extends ReadRequest>(
    request: O,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AuthorityReadResult<O>>;
  resolveAlias(
    url: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AuthorityAliasResult>;
}
export interface AuthorityReadPlane {
  readFor(principal: ReadPrincipal): AuthorityReadFacet;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

/** Sibling-only receiving faults; these never introduce wire Problem codes. */
export class AuthorityReadError extends Error {
  constructor(
    readonly reason:
      | "invalid-input"
      | "configuration"
      | "integrity"
      | "reentrant"
      | "async-callback",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthorityReadError";
  }
}

type PageItem = ResourceRecord | TypeSummary;
type ConcreteResult =
  | ReadRefusal
  | { readonly kind: "success"; readonly body: unknown; readonly observation: ReadObservation }
  | {
      readonly kind: "discovery";
      readonly data: AuthorityDiscoveryData;
      readonly observation: ReadObservation;
    }
  | {
      readonly kind: "target";
      readonly target: AbsoluteHttpUrl;
      readonly observation: ReadObservation;
    };
type Materialized =
  | ConcreteResult
  | {
      readonly kind: "page";
      readonly items: readonly PageItem[];
      readonly observation: ReadObservation;
    }
  | {
      readonly kind: "continuation";
      readonly token: string;
      readonly projection: string;
      readonly observation: ReadObservation;
    };
interface Prepared {
  readonly scope: AbsoluteHttpUrl;
  readonly scopeEpoch: string;
  readonly enter: AuthorityReadEntry["withRead"];
  readonly capture: AuthorityReadOptions["captureReadAuthorization"];
  readonly configuration: ScopeConfigurationSource["capture"];
  readonly types: readonly TypeDescriptor[];
  readonly conformance: TypeConformanceIndex;
  readonly selector: ReadSelectorLimits;
  readonly limits: ServerAdvertisedReadLimits;
  readonly pagination: ReadPagination<PageItem>;
}
interface ReadContext {
  readonly observation: ReadObservation;
  readonly aggregate: readonly MaximumEndpointMultiplicityPolicy[];
  readonly policy: Pick<ResourceMutationPolicy, "canRead">;
  readonly canReadType: (descriptor: TypeDescriptor) => boolean;
}

function identity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new AuthorityReadError("configuration", `${label} must be a nonempty identity`);
  return value;
}

function synchronous<T>(value: T): T {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    // Trusted synchronous callbacks only. This observes ordinary rejections;
    // it does not promise confinement of arbitrary hostile thenable side effects.
    void Promise.resolve(value).catch(() => undefined);
    throw new AuthorityReadError("async-callback", "Read callbacks must be synchronous");
  }
  return value;
}

function boolean(value: unknown): boolean {
  synchronous(value);
  if (typeof value !== "boolean")
    throw new AuthorityReadError("configuration", "Read policy must return a boolean");
  return value;
}

/** Data descriptors are inspected only after the proxy check, without getters. */
function ownData(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || isProxy(value) || Array.isArray(value))
    throw new AuthorityReadError("invalid-input", `${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new AuthorityReadError("invalid-input", `${label} must have a plain prototype`);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string")
      throw new AuthorityReadError("invalid-input", `${label} cannot have symbol fields`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor))
      throw new AuthorityReadError("invalid-input", `${label} cannot have accessors`);
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return Object.freeze(result);
}

function snapshotRequest(value: unknown): ReadRequest {
  const request = ownData(value, "Read request");
  const variant = resolveReadRequestVariant(request);
  if (variant === undefined)
    throw new AuthorityReadError("invalid-input", "unsupported Read request shape");
  const required =
    request.kind === "scope-discovery"
      ? ["scope"]
      : request.kind === "collection"
        ? ["collection"]
        : request.kind === "bead-links"
          ? ["bead"]
          : ["resource", "id"];
  for (const field of ["kind", ...required]) {
    if (typeof request[field] !== "string")
      throw new AuthorityReadError("invalid-input", `Read request requires own ${field}`);
  }
  for (const [key, field] of Object.entries(request)) {
    if (field !== undefined && typeof field !== (key === "limit" ? "number" : "string"))
      throw new AuthorityReadError("invalid-input", `invalid Read request field ${key}`);
  }
  return request as unknown as ReadRequest;
}

function prepare(options: AuthorityReadOptions): Prepared {
  const {
    entry,
    scopeEpoch: epoch,
    scopeConfiguration,
    installedTypes,
    selectorLimits,
    pagination: suppliedPagination,
    advertisedLimits,
    captureReadAuthorization,
  } = options;
  const scope = parseCanonicalScope(entry.scope);
  const scopeEpoch = identity(epoch, "Scope epoch");
  const enter = entry.withRead;
  const configuration = scopeConfiguration.capture;
  if ([enter, configuration, captureReadAuthorization].some((value) => typeof value !== "function"))
    throw new AuthorityReadError("configuration", "complete authority Read callbacks required");
  const selector = Object.freeze({
    bytes: selectorLimits.bytes,
    depth: selectorLimits.depth,
    nodes: selectorLimits.nodes,
  });
  for (const value of Object.values(selector)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new AuthorityReadError("configuration", "positive safe Selector limits required");
  }
  const paginationOptions = { ...suppliedPagination };
  if (
    paginationOptions.scope !== scope ||
    (paginationOptions.idleCleanup !== "timer" && paginationOptions.idleCleanup !== "on-demand")
  )
    throw new AuthorityReadError(
      "configuration",
      "exact pagination Scope and explicit idle cleanup required",
    );
  const limits = Object.freeze({
    page: Object.freeze({
      defaultItems: advertisedLimits.page.defaultItems,
      maximumItems: advertisedLimits.page.maximumItems,
    }),
    selector: Object.freeze({
      bytes: advertisedLimits.selector.bytes,
      depth: advertisedLimits.selector.depth,
      nodes: advertisedLimits.selector.nodes,
    }),
    cursorTtlMilliseconds: advertisedLimits.cursorTtlMilliseconds,
  });
  if (
    limits.page.defaultItems !== paginationOptions.defaultPageItems ||
    limits.page.maximumItems !== paginationOptions.maxPageItems ||
    limits.cursorTtlMilliseconds !== paginationOptions.cursorTtlMs ||
    limits.selector.bytes !== selector.bytes ||
    limits.selector.depth !== selector.depth ||
    limits.selector.nodes !== selector.nodes
  )
    throw new AuthorityReadError("configuration", "advertised Read limits must match enforcement");
  if (
    typeof paginationOptions.clock !== "function" ||
    typeof paginationOptions.generateOpaqueToken !== "function"
  )
    throw new AuthorityReadError("configuration", "pagination callbacks required");
  paginationOptions.clock = paginationOptions.clock.bind(suppliedPagination);
  paginationOptions.generateOpaqueToken =
    paginationOptions.generateOpaqueToken.bind(suppliedPagination);
  const pagination = createReadPagination<PageItem>(paginationOptions);
  try {
    if (!Array.isArray(installedTypes) || isProxy(installedTypes))
      throw new AuthorityReadError("configuration", "installed Type inventory required");
    const types = Object.freeze(
      installedTypes.map((descriptor) => parseTypeDescriptor(descriptor)),
    );
    const conformance = createTypeConformanceIndex(types);
    return Object.freeze({
      scope,
      scopeEpoch,
      enter: enter.bind(entry),
      capture: captureReadAuthorization.bind(options),
      configuration: configuration.bind(scopeConfiguration),
      types,
      conformance,
      selector,
      limits,
      pagination,
    });
  } catch (error) {
    pagination.close();
    throw error;
  }
}

function aggregateSnapshot(
  value: readonly MaximumEndpointMultiplicityPolicy[],
): readonly MaximumEndpointMultiplicityPolicy[] {
  if (!Array.isArray(value) || isProxy(value))
    throw new AuthorityReadError("configuration", "complete aggregate policy array required");
  return Object.freeze(
    value.map((item) => {
      const { linkConformsTo, endpoint, max } = item;
      const type = parseCanonicalHttpUrl(linkConformsTo, "aggregate Link Type");
      if (
        (endpoint !== "source" && endpoint !== "target") ||
        !Number.isSafeInteger(max) ||
        max <= 0
      )
        throw new AuthorityReadError("configuration", "invalid aggregate policy");
      return Object.freeze({ linkConformsTo: type, endpoint, max });
    }),
  );
}

function captureContext(
  prepared: Prepared,
  reader: StoreReader,
  principal: ReadPrincipal,
  intent: ReadIntent,
): ReadContext | ReadRefusal {
  const decision = synchronous(prepared.capture(reader, principal, intent));
  if (decision.kind === "problem") return preContext(parseReadProblem(decision.problem));
  if (decision.kind !== "authorized")
    throw new AuthorityReadError("configuration", "invalid Read authorization decision");
  const authorization = synchronous(decision.authorization);
  const { authorizationView, scopeEpoch, policy, canReadType } = authorization;
  const canRead = policy.canRead;
  if (typeof canRead !== "function" || typeof canReadType !== "function")
    throw new AuthorityReadError("configuration", "complete captured Read policy required");
  const view = identity(authorizationView, "Authorization View");
  if (identity(scopeEpoch, "captured Scope epoch") !== prepared.scopeEpoch)
    throw new AuthorityReadError(
      "configuration",
      "captured Scope epoch changed during plane lifetime",
    );
  const configuration = synchronous(prepared.configuration(reader));
  const { policyIdentity, configurationIdentity, maximumEndpointMultiplicity } = configuration;
  const observation = Object.freeze({
    authorizationView: view,
    scopeEpoch,
    policyIdentity: identity(policyIdentity, "policy identity"),
    configurationIdentity: identity(configurationIdentity, "configuration identity"),
  });
  return Object.freeze({
    observation,
    aggregate: aggregateSnapshot(maximumEndpointMultiplicity),
    policy: Object.freeze({
      canRead: (record: ResourceRecord) => boolean(canRead.call(policy, record)),
    }),
    canReadType: (descriptor: TypeDescriptor) =>
      boolean(canReadType.call(authorization, descriptor)),
  });
}

function preContext(problem: ReadProblem): ReadRefusal {
  return Object.freeze({ kind: "problem", phase: "pre-context", problem });
}
function observed(problem: ReadProblem, observation: ReadObservation): ReadRefusal {
  return Object.freeze({ kind: "problem", phase: "observed", problem, observation });
}

/** Catch only actual control work, never the enclosing provider or store call. */
function control<T>(work: () => T, observation: ReadObservation): T | ReadRefusal {
  try {
    return work();
  } catch (error) {
    if (error instanceof ReadPaginationError || error instanceof ReadSelectorError)
      return observed(readControlProblem(error), observation);
    throw error;
  }
}

function isRefusal(value: unknown): value is ReadRefusal {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "problem";
}

/** Iterative equality over parsed acyclic JSON: object order is immaterial. */
function sameJson(left: unknown, right: unknown): boolean {
  const pending: Array<readonly [unknown, unknown]> = [[left, right]];
  while (pending.length > 0) {
    const pair = pending.pop();
    if (pair === undefined) break;
    const [a, b] = pair;
    if (a === b) continue;
    if (
      a === null ||
      b === null ||
      typeof a !== "object" ||
      typeof b !== "object" ||
      Array.isArray(a) !== Array.isArray(b)
    )
      return false;
    const aa = a as Record<string, unknown>;
    const bb = b as Record<string, unknown>;
    const keys = Object.keys(aa);
    if (keys.length !== Object.keys(bb).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(bb, key)) return false;
      pending.push([aa[key], bb[key]]);
    }
  }
  return true;
}

interface CheckedRecord {
  readonly row: StoredResource;
  readonly record: ResourceRecord;
}

/** Lives only inside one synchronous entry. This does not certify unseen rows. */
function checkedGraph(reader: StoreReader, scope: AbsoluteHttpUrl) {
  const cache = new Map<string, CheckedRecord>();
  const points = new Set<string>();
  const missing = new Set<string>();
  const ownedChecked = new Set<string>();
  const ownedQueue: BeadRecord[] = [];
  const integrity = (message: string): never => {
    throw new AuthorityReadError("integrity", message);
  };
  const endpointIndex = (reference: Reference): string => {
    const uri = referenceUri(reference);
    return validateServerEndpoint(reference, scope) ? uri.slice(scope.length) : uri;
  };
  const accept = (row: StoredResource, expected?: string): CheckedRecord => {
    synchronous(row);
    if (expected !== undefined && row.id !== expected)
      integrity("point row differs from requested identity");
    if (row.kind !== "bead" && row.kind !== "link") integrity("unknown stored Resource kind");
    let record: ResourceRecord;
    try {
      record = readStoredResource(row, scope);
      if (row.kind === "bead") validateServerBead(record as BeadRecord, scope);
      else {
        const link = record as LinkRecord;
        validateServerLink(link, scope);
        if (row.source !== endpointIndex(link.source) || row.target !== endpointIndex(link.target))
          integrity("Link endpoint index disagrees with its body");
      }
    } catch (cause) {
      if (cause instanceof AuthorityReadError) throw cause;
      throw new AuthorityReadError("integrity", "invalid stored Resource", { cause });
    }
    const previous = cache.get(row.id);
    if (previous !== undefined) {
      if (
        previous.row.kind !== row.kind ||
        previous.row.source !== row.source ||
        previous.row.target !== row.target ||
        !sameJson(previous.record, record)
      )
        integrity("same entry returned contradictory Resource rows");
      return previous;
    }
    if (missing.has(row.id)) integrity("same entry returned a previously missing Resource");
    // Copy row primitives so later facade wrappers cannot change the cache.
    const item = Object.freeze({ row: Object.freeze({ ...row }), record });
    cache.set(row.id, item);
    if (row.kind === "bead") ownedQueue.push(record as BeadRecord);
    return item;
  };
  const point = (id: string): CheckedRecord | undefined => {
    if (points.has(id)) return cache.get(id);
    const row = synchronous(reader.resource(id));
    points.add(id);
    if (row === undefined) {
      if (cache.has(id)) integrity("point lookup omitted an already encountered Resource");
      missing.add(id);
      return undefined;
    }
    return accept(row, id);
  };
  const checkOwned = (): void => {
    while (ownedQueue.length > 0) {
      const bead = ownedQueue.pop();
      if (bead === undefined || ownedChecked.has(bead.id)) continue;
      ownedChecked.add(bead.id);
      for (const links of Object.values(bead.ownedLinks ?? {})) {
        for (const inline of links) {
          const found = point(inline.id.slice(scope.length));
          if (
            found?.row.kind !== "link" ||
            referenceUri(inline.source) !== bead.id ||
            !sameJson(inline, found.record)
          )
            integrity("listed owned Link disagrees with its first-class row");
        }
      }
    }
  };
  const resource = (id: string): StoredResource | undefined => {
    const found = point(id);
    checkOwned();
    return found?.row;
  };
  return {
    point(id: string): ResourceRecord | undefined {
      const found = point(id);
      checkOwned();
      return found?.record;
    },
    accept(row: StoredResource): ResourceRecord {
      const found = accept(row);
      checkOwned();
      return found.record;
    },
    visible(record: ResourceRecord, policy: Pick<ResourceMutationPolicy, "canRead">): boolean {
      checkOwned();
      return isResourceVisible({ resource }, record, scope, policy);
    },
  };
}

function structural(
  record: ResourceRecord,
  operation: PageOperation,
  conformance: TypeConformanceIndex,
): boolean {
  if (operation.kind === "bead-links") {
    if (!("source" in record)) return false;
    const source = referenceUri(record.source);
    const target = referenceUri(record.target);
    if (source !== operation.bead && target !== operation.bead)
      throw new AuthorityReadError("integrity", "incident index returned a nonincident Link");
    return operation.direction === "inbound"
      ? target === operation.bead
      : operation.direction === "outbound"
        ? source === operation.bead
        : true;
  }
  if (operation.collection === "types") return false;
  if ((operation.collection === "links") !== "source" in record) return false;
  if (operation.type !== undefined && operation.type !== record.type) return false;
  if (
    operation.conformsTo !== undefined &&
    !conformance.includes(record.type, operation.conformsTo)
  )
    return false;
  if (operation.collection === "links" && "source" in record) {
    const source = referenceUri(record.source);
    const target = referenceUri(record.target);
    if (operation.source !== undefined && operation.source !== source) return false;
    if (operation.target !== undefined && operation.target !== target) return false;
    if (
      operation.endpoint !== undefined &&
      operation.endpoint !== source &&
      operation.endpoint !== target
    )
      return false;
  }
  return true;
}

function aliasSuffix(url: string, scope: AbsoluteHttpUrl): string | undefined {
  if (url.includes("?") || url.includes("#")) return undefined;
  try {
    const canonical = parseCanonicalHttpUrl(url);
    const suffix = classifyAliasPath(new URL(canonical), scope);
    return typeof suffix === "string" ? suffix : undefined;
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError) return undefined;
    throw error;
  }
}

function materialize(
  prepared: Prepared,
  reader: StoreReader,
  context: ReadContext,
  intent: ReadIntent,
): Materialized {
  const { observation, policy } = context;
  const { scope } = prepared;
  if (intent.kind === "scope-discovery") {
    const data: AuthorityDiscoveryData = Object.freeze({
      scope,
      beads: new URL("beads/", scope).href as AbsoluteHttpUrl,
      links: new URL("links/", scope).href as AbsoluteHttpUrl,
      types: new URL("types/", scope).href as AbsoluteHttpUrl,
      aliases: new URL("alias/", scope).href as AbsoluteHttpUrl,
      order: "canonical-uri",
      limits: prepared.limits,
      maximumEndpointMultiplicity: context.aggregate,
    });
    return Object.freeze({ kind: "discovery", data, observation });
  }
  if (intent.kind !== "alias" && isPageOperation(intent)) {
    const issue = control(() => {
      prepared.pagination.validateLimit(intent.limit);
      if (
        intent.kind === "collection" &&
        intent.collection !== "types" &&
        intent.selector !== undefined
      )
        selectReadResources(intent.selector, prepared.selector, []);
    }, observation);
    if (isRefusal(issue)) return issue;
    if (intent.continuation !== undefined) {
      const details = continuationDetails(intent, scope);
      if (isReadProblem(details)) return observed(details, observation);
      return Object.freeze({ kind: "continuation", ...details, observation });
    }
  }
  const graph = checkedGraph(reader, scope);
  if (intent.kind === "alias") {
    const suffix = aliasSuffix(intent.url, scope);
    if (suffix === undefined) return observed(notFound(), observation);
    const target = synchronous(reader.alias(suffix));
    if (target === undefined) return observed(notFound(), observation);
    if (typeof target !== "string")
      throw new AuthorityReadError("integrity", "invalid stored alias target");
    const canonical = `${scope}${target}`;
    try {
      validateServerLocalResourceId(canonical, scope, "bead");
    } catch (cause) {
      throw new AuthorityReadError("integrity", "invalid stored alias target", { cause });
    }
    const record = graph.point(target);
    if (record !== undefined && "source" in record)
      throw new AuthorityReadError("integrity", "alias target row is not a Bead");
    return record !== undefined && graph.visible(record, policy)
      ? Object.freeze({ kind: "target", target: record.id, observation })
      : observed(notFound(), observation);
  }
  if (intent.kind === "resource" && intent.resource === "type") {
    const descriptor = prepared.types.find((candidate) => candidate.id === intent.id);
    return descriptor !== undefined && context.canReadType(descriptor)
      ? Object.freeze({ kind: "success", body: descriptor, observation })
      : observed(notFound(), observation);
  }
  if (intent.kind === "resource" || intent.kind === "properties") {
    const record = graph.point(intent.id.slice(scope.length));
    if (record === undefined) return observed(notFound(), observation);
    if ((intent.resource === "link") !== "source" in record)
      throw new AuthorityReadError("integrity", "requested Resource kind disagrees with row");
    if (!graph.visible(record, policy)) return observed(notFound(), observation);
    return Object.freeze({
      kind: "success",
      body: intent.kind === "properties" ? record.properties : record,
      observation: Object.freeze({ ...observation, resourceRevision: record.revision }),
    });
  }
  if (intent.kind === "collection" && intent.collection === "types") {
    const items = prepared.types
      .filter((descriptor) => context.canReadType(descriptor))
      .map(({ id, name, describes }) => Object.freeze({ id, name, describes }));
    return Object.freeze({ kind: "page", items: Object.freeze(items), observation });
  }
  let rows: readonly StoredResource[];
  if (intent.kind === "bead-links") {
    const anchor = graph.point(intent.bead.slice(scope.length));
    if (anchor === undefined) return observed(notFound(), observation);
    if ("source" in anchor)
      throw new AuthorityReadError("integrity", "incident anchor is not a Bead");
    if (!graph.visible(anchor, policy)) return observed(notFound(), observation);
    rows = synchronous(reader.incidentLinks(intent.bead.slice(scope.length)));
  } else rows = synchronous(reader.resources());
  const items: ResourceRecord[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const record = graph.accept(row);
    if (intent.kind === "bead-links" && !("source" in record))
      throw new AuthorityReadError("integrity", "incident index returned a Bead");
    if (
      structural(record, intent, prepared.conformance) &&
      graph.visible(record, policy) &&
      !seen.has(record.id)
    ) {
      seen.add(record.id);
      items.push(record);
    }
  }
  return Object.freeze({ kind: "page", items: Object.freeze(items), observation });
}

function finish(prepared: Prepared, intent: ReadIntent, result: Materialized): ConcreteResult {
  if (result.kind === "continuation") {
    const page = control(
      () =>
        prepared.pagination.continuePage({
          token: result.token,
          projection: result.projection,
          authorizationView: result.observation.authorizationView,
          scopeEpoch: result.observation.scopeEpoch,
        }),
      result.observation,
    );
    return isRefusal(page)
      ? page
      : Object.freeze({ kind: "success", body: page, observation: result.observation });
  }
  if (result.kind !== "page") return result;
  if (intent.kind === "alias" || !isPageOperation(intent))
    throw new AuthorityReadError("integrity", "unexpected materialized page");
  const body = control(() => {
    const items =
      intent.kind === "collection" && intent.collection !== "types" && intent.selector !== undefined
        ? selectReadResources(
            intent.selector,
            prepared.selector,
            result.items as readonly ResourceRecord[],
          )
        : result.items;
    const navigation = continuationUrlFor(intent, prepared.scope);
    return prepared.pagination.firstPage({
      items: inCanonicalUriOrder(items),
      ...(intent.limit === undefined ? {} : { limit: intent.limit }),
      authorizationView: result.observation.authorizationView,
      scopeEpoch: result.observation.scopeEpoch,
      projection: navigation,
      continuationUrl: navigation,
    });
  }, result.observation);
  return isRefusal(body)
    ? body
    : Object.freeze({ kind: "success", body, observation: result.observation });
}

function principalSnapshot(value: ReadPrincipal): {
  readonly principal: ReadPrincipal;
  check(): void;
} {
  const outer = ownData(value, "Read principal");
  if (outer.kind === "anonymous" && Object.keys(outer).length === 1)
    return Object.freeze({ principal: Object.freeze({ kind: "anonymous" }), check() {} });
  if (
    outer.kind !== "authenticated" ||
    Object.keys(outer).length !== 2 ||
    !Object.hasOwn(outer, "principal")
  )
    throw new AuthorityReadError("invalid-input", "explicit Read principal required");
  const original = outer.principal as StablePrincipal;
  const captured = ownData(original, "stable principal");
  const id = identity(captured.id, "principal ID");
  return Object.freeze({
    principal: Object.freeze({ kind: "authenticated", principal: original }),
    check(): void {
      if (ownData(original, "stable principal").id !== id)
        throw new AuthorityReadError("configuration", "principal changed before Read capture");
    },
  });
}

/** A private current-Read component; supplied entry/configuration are not readiness. */
export function createAuthorityReadPlane(options: AuthorityReadOptions): AuthorityReadPlane {
  const prepared = prepare(options);
  let busy = false;
  let stopped = false;
  let resolveClosed: () => void = () => undefined;
  let rejectClosed: (reason: unknown) => void = () => undefined;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  void closed.catch(() => undefined);
  const guard = (): void => {
    if (busy) throw new AuthorityReadError("reentrant", "authority Read plane is already active");
    if (stopped) throw new ScopeServerClosedError();
  };
  const observe = (principal: ReadPrincipal, intent: ReadIntent): ConcreteResult => {
    let calls = 0;
    let captured: Materialized | undefined;
    const entry = synchronous(
      prepared.enter((reader) => {
        calls += 1;
        if (calls !== 1)
          throw new AuthorityReadError("integrity", "owner invoked Read callback more than once");
        const context = captureContext(prepared, reader, principal, intent);
        captured = isRefusal(context) ? context : materialize(prepared, reader, context, intent);
        return captured;
      }),
    );
    if (entry.kind === "entry-refused") {
      if (calls !== 0)
        throw new AuthorityReadError("integrity", "owner refused after invoking Read callback");
      if (entry.reason === "reentrant")
        throw new AuthorityReadError("reentrant", "authority owner is already active", {
          cause: entry.cause,
        });
      if (entry.reason === "not-accepting") {
        const error = new ScopeServerClosedError();
        Object.defineProperty(error, "cause", {
          value: entry.cause,
          configurable: true,
          writable: true,
        });
        throw error;
      }
      throw new AuthorityReadError("integrity", "unknown owner Read refusal");
    }
    if (entry.kind !== "read" || calls !== 1 || captured === undefined || entry.value !== captured)
      throw new AuthorityReadError("integrity", "owner returned an invalid Read entry result");
    return finish(prepared, intent, captured);
  };

  const plane: AuthorityReadPlane = {
    closed,
    readFor(value): AuthorityReadFacet {
      guard();
      const principal = principalSnapshot(value);
      const deliver = <T>(
        makeIntent: () => ReadIntent,
        supplied?: { readonly signal?: AbortSignal },
      ): Promise<T> => {
        // Even early receiving/state faults belong to this observed promise.
        // Allocation itself does not mutate shared owner/plane state.
        let fulfill: (value: T) => void = () => undefined;
        let reject: (reason: unknown) => void = () => undefined;
        const delivery = new Promise<T>((resolve, fail) => {
          fulfill = resolve;
          reject = fail;
        });
        void delivery.catch(() => undefined);
        let signal: AbortSignal | undefined;
        let aborted = false;
        let entered = false;
        let listening = false;
        let outcome: T | undefined;
        let failure: { readonly error: unknown } | undefined;
        const onAbort = (): void => {
          aborted = true;
        };
        try {
          guard();
          if (supplied !== undefined) {
            const receiving = ownData(supplied, "Read delivery options");
            if (Object.keys(receiving).some((key) => key !== "signal"))
              throw new AuthorityReadError("invalid-input", "unknown Read delivery option");
            const candidate = receiving.signal;
            if (
              candidate !== undefined &&
              (typeof candidate !== "object" ||
                candidate === null ||
                isProxy(candidate) ||
                !(candidate instanceof AbortSignal))
            )
              throw new AuthorityReadError("invalid-input", "Read signal must be an AbortSignal");
            signal = candidate as AbortSignal | undefined;
          }
          if (signal?.aborted) throw new ScopeServerOperationAbortedError();
          principal.check();
          const intent = makeIntent();
          busy = true;
          entered = true;
          if (signal !== undefined) {
            listening = true;
            signal.addEventListener("abort", onAbort, { once: true });
          }
          let result: ConcreteResult;
          if (intent.kind === "alias") result = observe(principal.principal, intent);
          else {
            const variant = resolveReadRequestVariant(intent);
            if (variant === undefined)
              throw new AuthorityReadError("invalid-input", "invalid Read request");
            const issue = variant.validate(intent, {
              scope: prepared.scope,
              controlsEnabled: true,
            });
            result = issue === undefined ? observe(principal.principal, intent) : preContext(issue);
          }
          if (aborted || signal?.aborted) throw new ScopeServerOperationAbortedError();
          outcome = result as T;
        } catch (error) {
          // Work faults retain precedence over an abort observed during the work.
          failure = { error };
        } finally {
          try {
            if (listening) signal?.removeEventListener("abort", onAbort);
          } catch (error) {
            failure ??= { error };
          }
          if (entered) busy = false;
        }
        if (failure !== undefined) reject(failure.error);
        else fulfill(outcome as T);
        return delivery;
      };
      return Object.freeze({
        perform<O extends ReadRequest>(
          request: O,
          receiving?: { readonly signal?: AbortSignal },
        ): Promise<AuthorityReadResult<O>> {
          return deliver(() => snapshotRequest(request), receiving);
        },
        resolveAlias(
          url: string,
          receiving?: { readonly signal?: AbortSignal },
        ): Promise<AuthorityAliasResult> {
          return deliver(() => {
            if (typeof url !== "string")
              throw new AuthorityReadError(
                "invalid-input",
                "alias locator must be a primitive string",
              );
            return Object.freeze({ kind: "alias", url });
          }, receiving);
        },
      });
    },
    close(): Promise<void> {
      if (busy)
        throw new AuthorityReadError("reentrant", "cannot close during an authority Read entry");
      if (stopped) return closed;
      stopped = true;
      try {
        prepared.pagination.close();
        resolveClosed();
      } catch (error) {
        rejectClosed(error);
      }
      return closed;
    },
  };
  return Object.freeze(plane);
}
