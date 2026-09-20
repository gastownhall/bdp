import {
  type BdpContinuationScope,
  type ContinuationContext,
  type ContinuationRegistry,
  ContinuationRegistryCapacityError,
  ContinuationRegistryProtocolError,
  type ContinuationReservation,
  localRefusal,
  ReadSessionLocalError,
  type ReadSessionRefusal,
  ReadSessionRequestError,
  type ReadSessionResult,
  SessionCore,
} from "./continuations.js";

export {
  type BdpContinuationScope,
  ReadSessionLocalError,
  type ReadSessionRefusal,
  type ReadSessionResult,
} from "./continuations.js";

import {
  confinedUrl,
  ReadResponseValidationError,
  resourceUrl,
  validateBeadRecord,
  validateBeadSingleton,
  validateLinkRecord,
  validateLinkSingleton,
} from "./read-record-validation.js";

export { isWithinScope } from "./read-record-validation.js";

import type {
  AbsoluteHttpUrl,
  BeadCollection,
  BeadCollectionRequest,
  LinkCollection,
  LinkCollectionRequest,
  ReadBodyFor,
  ReadDiscovery,
  ReadRequest,
  ScopeReadOperation,
  TypeInventory,
  TypeInventoryRequest,
} from "@bdp/protocol";
import {
  ProtocolArtifactValidationError,
  parseBeadCollection,
  parseBeadRecord,
  parseCanonicalScope,
  parseLinkCollection,
  parseLinkRecord,
  parsePropertiesRecord,
  parseTypeDescriptor,
  parseTypeInventory,
  referenceUri,
} from "@bdp/protocol";

export type ReadRoots = Pick<ReadDiscovery, "scope" | "beads" | "links" | "types">;
const capturedRequests = new WeakSet<object>();

type ReadRequestVariantMap = {
  readonly "scope-discovery": Extract<ReadRequest, { readonly kind: "scope-discovery" }>;
  readonly "collection:beads": Extract<
    ReadRequest,
    { readonly kind: "collection"; readonly collection: "beads" }
  >;
  readonly "collection:links": Extract<
    ReadRequest,
    { readonly kind: "collection"; readonly collection: "links" }
  >;
  readonly "collection:types": Extract<
    ReadRequest,
    { readonly kind: "collection"; readonly collection: "types" }
  >;
  readonly "resource:bead": Extract<
    ReadRequest,
    { readonly kind: "resource"; readonly resource: "bead" }
  >;
  readonly "resource:link": Extract<
    ReadRequest,
    { readonly kind: "resource"; readonly resource: "link" }
  >;
  readonly "resource:type": Extract<
    ReadRequest,
    { readonly kind: "resource"; readonly resource: "type" }
  >;
  readonly "properties:bead": Extract<
    ReadRequest,
    { readonly kind: "properties"; readonly resource: "bead" }
  >;
  readonly "properties:link": Extract<
    ReadRequest,
    { readonly kind: "properties"; readonly resource: "link" }
  >;
  readonly "bead-links": Extract<ReadRequest, { readonly kind: "bead-links" }>;
};

type ReadRequestVariant = keyof ReadRequestVariantMap;
type RegisteredReadRequest = ReadRequestVariantMap[ReadRequestVariant];
type ExhaustiveReadRequestRegistration =
  Exclude<ReadRequest, RegisteredReadRequest> extends never
    ? unknown
    : { readonly missingReadRequestRegistration: never };

type ReadRequestVisitor<Result> = {
  readonly [Variant in ReadRequestVariant]: (request: ReadRequestVariantMap[Variant]) => Result;
};

function visitReadRequest<Result>(
  request: ReadRequest,
  visitor: ReadRequestVisitor<Result>,
): Result {
  switch (request.kind) {
    case "scope-discovery":
      return visitor["scope-discovery"](request);
    case "collection":
      switch (request.collection) {
        case "beads":
          return visitor["collection:beads"](request);
        case "links":
          return visitor["collection:links"](request);
        case "types":
          return visitor["collection:types"](request);
      }
      return unreachableReadRequestVariant(request);
    case "resource":
      switch (request.resource) {
        case "bead":
          return visitor["resource:bead"](request);
        case "link":
          return visitor["resource:link"](request);
        case "type":
          return visitor["resource:type"](request);
      }
      return unreachableReadRequestVariant(request);
    case "properties":
      switch (request.resource) {
        case "bead":
          return visitor["properties:bead"](request);
        case "link":
          return visitor["properties:link"](request);
      }
      return unreachableReadRequestVariant(request);
    case "bead-links":
      return visitor["bead-links"](request);
  }
}

function unreachableReadRequestVariant(value: never): never {
  throw new TypeError(`unregistered Read request variant ${String(value)}`);
}

interface ReadRequestDescriptor {
  readonly kind: ReadRequest["kind"];
  readonly qualifierValue?: string;
  readonly allowedFields: readonly string[];
  readonly requiredUrlFields: readonly string[];
  readonly continuationIncompatibleFields: readonly string[];
  readonly validatesDirection?: true;
}

type ReadRequestQualifier<Request extends ReadRequest> = Request extends {
  readonly kind: "collection";
  readonly collection: infer Qualifier extends string;
}
  ? Qualifier
  : Request extends {
        readonly kind: "resource" | "properties";
        readonly resource: infer Qualifier extends string;
      }
    ? Qualifier
    : never;

type RegisteredReadRequestDescriptor<Variant extends ReadRequestVariant> = ReadRequestDescriptor & {
  readonly kind: ReadRequestVariantMap[Variant]["kind"];
} & ([ReadRequestQualifier<ReadRequestVariantMap[Variant]>] extends [never]
    ? { readonly qualifierValue?: never }
    : {
        readonly qualifierValue: ReadRequestQualifier<ReadRequestVariantMap[Variant]>;
      });

const READ_REQUEST_DESCRIPTORS = {
  "scope-discovery": {
    kind: "scope-discovery",
    allowedFields: ["kind", "scope"],
    requiredUrlFields: ["scope"],
    continuationIncompatibleFields: [],
  },
  "collection:beads": {
    kind: "collection",
    qualifierValue: "beads",
    allowedFields: [
      "kind",
      "collection",
      "continuation",
      "type",
      "conformsTo",
      "limit",
      "selector",
    ],
    requiredUrlFields: [],
    continuationIncompatibleFields: [
      "type",
      "conformsTo",
      "source",
      "target",
      "endpoint",
      "selector",
      "limit",
    ],
  },
  "collection:links": {
    kind: "collection",
    qualifierValue: "links",
    allowedFields: [
      "kind",
      "collection",
      "continuation",
      "type",
      "conformsTo",
      "source",
      "target",
      "endpoint",
      "limit",
      "selector",
    ],
    requiredUrlFields: [],
    continuationIncompatibleFields: [
      "type",
      "conformsTo",
      "source",
      "target",
      "endpoint",
      "selector",
      "limit",
    ],
  },
  "collection:types": {
    kind: "collection",
    qualifierValue: "types",
    allowedFields: ["kind", "collection", "continuation", "limit"],
    requiredUrlFields: [],
    continuationIncompatibleFields: [
      "type",
      "conformsTo",
      "source",
      "target",
      "endpoint",
      "selector",
      "limit",
    ],
  },
  "resource:bead": {
    kind: "resource",
    qualifierValue: "bead",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "resource:link": {
    kind: "resource",
    qualifierValue: "link",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "resource:type": {
    kind: "resource",
    qualifierValue: "type",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "properties:bead": {
    kind: "properties",
    qualifierValue: "bead",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "properties:link": {
    kind: "properties",
    qualifierValue: "link",
    allowedFields: ["kind", "resource", "id"],
    requiredUrlFields: ["id"],
    continuationIncompatibleFields: [],
  },
  "bead-links": {
    kind: "bead-links",
    allowedFields: ["kind", "bead", "continuation", "direction", "limit"],
    requiredUrlFields: ["bead"],
    continuationIncompatibleFields: ["limit", "direction"],
    validatesDirection: true,
  },
} satisfies {
  readonly [Variant in ReadRequestVariant]: RegisteredReadRequestDescriptor<Variant>;
} & ExhaustiveReadRequestRegistration;

type ReadRequestFamilyDescriptor =
  | {
      readonly kind: "scope-discovery" | "bead-links";
    }
  | {
      readonly kind: "collection" | "resource" | "properties";
      readonly qualifierField: "collection" | "resource";
      readonly missingQualifierMessage: string;
      readonly invalidQualifierMessage: string;
    };

const READ_REQUEST_FAMILIES = {
  "scope-discovery": { kind: "scope-discovery" },
  collection: {
    kind: "collection",
    qualifierField: "collection",
    missingQualifierMessage: "collection requests require a collection kind",
    invalidQualifierMessage: "request has an invalid collection kind",
  },
  resource: {
    kind: "resource",
    qualifierField: "resource",
    missingQualifierMessage: "Resource requests require a Resource kind",
    invalidQualifierMessage: "request has an invalid Resource kind",
  },
  properties: {
    kind: "properties",
    qualifierField: "resource",
    missingQualifierMessage: "properties requests require a Resource kind",
    invalidQualifierMessage: "request has an invalid properties Resource kind",
  },
  "bead-links": { kind: "bead-links" },
} satisfies Readonly<Record<ReadRequest["kind"], ReadRequestFamilyDescriptor>>;

function requestDescriptorForCandidate(
  candidate: Readonly<Record<string, unknown>>,
): ReadRequestDescriptor {
  const family = Object.values(READ_REQUEST_FAMILIES).find(
    (registered) => registered.kind === candidate.kind,
  );
  if (family === undefined)
    throw new ReadSessionRequestError("request has an invalid operation kind");
  const candidates: readonly ReadRequestDescriptor[] = Object.values(
    READ_REQUEST_DESCRIPTORS,
  ).filter((descriptor) => descriptor.kind === family.kind);
  if (!("qualifierField" in family)) {
    const descriptor = candidates[0];
    if (descriptor === undefined)
      throw new ReadSessionRequestError("request has an invalid operation kind");
    return descriptor;
  }
  if (!Object.hasOwn(candidate, family.qualifierField))
    throw new ReadSessionRequestError(family.missingQualifierMessage);
  const qualifierValue = candidate[family.qualifierField];
  const descriptor = candidates.find((registered) => registered.qualifierValue === qualifierValue);
  if (descriptor === undefined) throw new ReadSessionRequestError(family.invalidQualifierMessage);
  return descriptor;
}

function continuationContextFor(
  request: ReadRequest,
  continuations: ContinuationRegistry,
  owner: BdpContinuationScope | undefined,
): ContinuationReservation | undefined {
  if (request.kind === "collection") {
    if (request.continuation === undefined)
      return { context: { kind: "collection", collection: request.collection } };
    const lease = continuations.reserve(
      request.continuation,
      owner,
      (candidate) => candidate.kind === "collection" && candidate.collection === request.collection,
    );
    if (lease === undefined)
      throw new ReadSessionRequestError("continuation was not issued for this collection");
    return { context: lease.context, lease };
  }
  if (request.kind === "bead-links") {
    if (request.continuation === undefined)
      return {
        context: {
          kind: "bead-links",
          bead: request.bead,
          direction: Object.hasOwn(request, "direction") ? (request.direction ?? "both") : "both",
        },
      };
    const lease = continuations.reserve(
      request.continuation,
      owner,
      (candidate) => candidate.kind === "bead-links" && candidate.bead === request.bead,
    );
    if (lease === undefined)
      throw new ReadSessionRequestError("continuation was not issued for this Bead");
    return { context: lease.context, lease };
  }
  return undefined;
}

export function captureReadRequest<Request extends ReadRequest>(value: Request): Request {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ReadSessionRequestError("request must be an object");
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch {
    throw new ReadSessionRequestError("request must be a plain object");
  }
  if (prototype !== Object.prototype && prototype !== null)
    throw new ReadSessionRequestError("request must be a plain object");
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new ReadSessionRequestError("request fields must be readable data properties");
  }
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string")
      throw new ReadSessionRequestError(
        "request contains fields not allowed for its operation kind",
      );
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value"))
      throw new ReadSessionRequestError("request fields must be readable data properties");
    entries.push([key, descriptor.value]);
  }
  const candidate = Object.freeze(Object.fromEntries(entries)) as Record<string, unknown>;
  if (!Object.hasOwn(candidate, "kind") || typeof candidate.kind !== "string")
    throw new ReadSessionRequestError("request must have an operation kind");
  const descriptor = requestDescriptorForCandidate(candidate);

  if (
    Reflect.ownKeys(candidate).some(
      (key) => typeof key !== "string" || !descriptor.allowedFields.includes(key),
    )
  )
    throw new ReadSessionRequestError("request contains fields not allowed for its operation kind");

  for (const field of descriptor.requiredUrlFields) {
    if (!Object.hasOwn(candidate, field) || typeof candidate[field] !== "string")
      throw new ReadSessionRequestError("request is missing a required URL field");
  }
  for (const field of [
    "continuation",
    "type",
    "conformsTo",
    "source",
    "target",
    "endpoint",
    "selector",
  ]) {
    if (
      Object.hasOwn(candidate, field) &&
      candidate[field] !== undefined &&
      typeof candidate[field] !== "string"
    )
      throw new ReadSessionRequestError("request URL and selector fields must be strings");
  }

  const limit = Object.hasOwn(candidate, "limit") ? candidate.limit : undefined;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || (limit as number) <= 0))
    throw new ReadSessionRequestError("limit must be a positive safe integer");
  const direction = Object.hasOwn(candidate, "direction") ? candidate.direction : undefined;
  if (descriptor.validatesDirection === true && direction !== undefined) {
    if (direction !== "inbound" && direction !== "outbound" && direction !== "both")
      throw new ReadSessionRequestError("direction must be inbound, outbound, or both");
  }
  const continuation = Object.hasOwn(candidate, "continuation")
    ? candidate.continuation
    : undefined;
  if (continuation !== undefined) {
    if (descriptor.continuationIncompatibleFields.some((field) => Object.hasOwn(candidate, field)))
      throw new ReadSessionRequestError(
        "continuation requests must not repeat predicates or limit",
      );
  }
  capturedRequests.add(candidate);
  return candidate as unknown as Request;
}

function readRequestUrl(
  request: ScopeReadOperation,
  scope: AbsoluteHttpUrl,
  discovery: ReadRoots,
  externalTypeDescriptorIds: ReadonlySet<string>,
): AbsoluteHttpUrl | ReadSessionRefusal {
  return visitReadRequest<AbsoluteHttpUrl | ReadSessionRefusal>(request, {
    "scope-discovery": () => {
      throw new TypeError("Scope discovery does not have a Read operation URL");
    },
    "collection:beads": (collectionRequest) =>
      collectionRequestUrl(collectionRequest, scope, discovery),
    "collection:links": (collectionRequest) =>
      collectionRequestUrl(collectionRequest, scope, discovery),
    "collection:types": (collectionRequest) =>
      collectionRequestUrl(collectionRequest, scope, discovery),
    "resource:bead": (resourceRequest) =>
      resourceUrl(scope, resourceRequest.id, resourceRequest.resource),
    "resource:link": (resourceRequest) =>
      resourceUrl(scope, resourceRequest.id, resourceRequest.resource),
    "resource:type": (resourceRequest) =>
      resourceUrl(scope, resourceRequest.id, resourceRequest.resource, externalTypeDescriptorIds),
    "properties:bead": (propertiesRequest) => propertiesUrl(propertiesRequest, scope),
    "properties:link": (propertiesRequest) => propertiesUrl(propertiesRequest, scope),
    "bead-links": (beadLinksRequest) => beadLinksUrl(beadLinksRequest, scope),
  });
}

function collectionRequestUrl(
  request: BeadCollectionRequest | LinkCollectionRequest | TypeInventoryRequest,
  scope: AbsoluteHttpUrl,
  discovery: ReadRoots,
): AbsoluteHttpUrl | ReadSessionRefusal {
  if (Object.hasOwn(request, "continuation") && request.continuation !== undefined)
    return confinedUrl(scope, request.continuation);
  return collectionUrl(request, discovery);
}

function propertiesUrl(
  request: ReadRequestVariantMap["properties:bead" | "properties:link"],
  scope: AbsoluteHttpUrl,
): AbsoluteHttpUrl | ReadSessionRefusal {
  const id = resourceUrl(scope, request.id, request.resource);
  return typeof id !== "string" ? id : appendQuery(id, { view: "properties" });
}

function beadLinksUrl(
  request: ReadRequestVariantMap["bead-links"],
  scope: AbsoluteHttpUrl,
): AbsoluteHttpUrl | ReadSessionRefusal {
  const bead = resourceUrl(scope, request.bead, "bead");
  if (typeof bead !== "string") return bead;
  if (Object.hasOwn(request, "continuation") && request.continuation !== undefined)
    return confinedUrl(scope, request.continuation);
  return appendQuery(bead, {
    view: "links",
    direction: Object.hasOwn(request, "direction") ? (request.direction ?? "both") : "both",
    ...(Object.hasOwn(request, "limit") && request.limit !== undefined
      ? { limit: String(request.limit) }
      : {}),
  });
}

type ReadBodyValidationResult =
  | { readonly kind: "success"; readonly body: unknown }
  | { readonly kind: "problem"; readonly problem: ReadSessionRefusal };

function validateReadBody(
  request: ReadRequest,
  body: unknown,
  scope: AbsoluteHttpUrl,
  continuation: ContinuationContext | undefined,
): ReadBodyValidationResult {
  try {
    return visitReadRequest<ReadBodyValidationResult>(request, {
      "scope-discovery": () => {
        throw new ReadSessionRequestError("Scope discovery is not a Read session operation");
      },
      "collection:beads": () => ({
        kind: "success",
        body: validateBeadCollection(parseBeadCollection(body), scope),
      }),
      "collection:links": () => ({
        kind: "success",
        body: validateLinkCollection(parseLinkCollection(body), scope),
      }),
      "collection:types": () => ({
        kind: "success",
        body: validateTypeInventory(parseTypeInventory(body), scope),
      }),
      "resource:bead": (resourceRequest) => ({
        kind: "success",
        body: validateBeadSingleton(parseBeadRecord(body), resourceRequest.id, scope),
      }),
      "resource:link": (resourceRequest) => ({
        kind: "success",
        body: validateLinkSingleton(parseLinkRecord(body), resourceRequest.id, scope),
      }),
      "resource:type": (resourceRequest) => {
        const descriptor = parseTypeDescriptor(body);
        if (descriptor.id !== resourceRequest.id)
          throw new ReadResponseValidationError("wrong Type ID");
        return { kind: "success", body: descriptor };
      },
      "properties:bead": () => ({ kind: "success", body: parsePropertiesRecord(body) }),
      "properties:link": () => ({ kind: "success", body: parsePropertiesRecord(body) }),
      "bead-links": () => {
        if (continuation?.kind !== "bead-links")
          throw new ReadResponseValidationError("missing incident-Link continuation context");
        return {
          kind: "success",
          body: validateIncidentLinkCollection(
            parseLinkCollection(body),
            continuation.bead,
            continuation.direction,
            scope,
          ),
        };
      },
    });
  } catch (error) {
    if (error instanceof ReadSessionLocalError) throw error;
    if (
      !(error instanceof ProtocolArtifactValidationError) &&
      !(error instanceof ReadResponseValidationError)
    )
      throw error;
    return {
      kind: "problem",
      problem: localRefusal(
        "temporarily-unavailable",
        "the server returned a structurally invalid Read response",
      ),
    };
  }
}

function validateNext(next: AbsoluteHttpUrl | null, scope: AbsoluteHttpUrl): void {
  if (next !== null && typeof confinedUrl(scope, next) !== "string")
    throw new ReadResponseValidationError("collection next escaped the Scope");
}

function validateBeadCollection(page: BeadCollection, scope: AbsoluteHttpUrl): BeadCollection {
  validateNext(page.next, scope);
  return Object.freeze({
    ...page,
    items: Object.freeze(page.items.map((item) => validateBeadRecord(item, scope))),
  });
}

function validateLinkCollection(page: LinkCollection, scope: AbsoluteHttpUrl): LinkCollection {
  validateNext(page.next, scope);
  return Object.freeze({
    ...page,
    items: Object.freeze(page.items.map((item) => validateLinkRecord(item, scope))),
  });
}

function validateIncidentLinkCollection(
  page: LinkCollection,
  bead: AbsoluteHttpUrl,
  direction: "inbound" | "outbound" | "both",
  scope: AbsoluteHttpUrl,
): LinkCollection {
  const validated = validateLinkCollection(page, scope);
  for (const link of validated.items) {
    const outbound = referenceUri(link.source) === bead;
    const inbound = referenceUri(link.target) === bead;
    if (
      (direction === "inbound" && !inbound) ||
      (direction === "outbound" && !outbound) ||
      (direction === "both" && !inbound && !outbound)
    )
      throw new ReadResponseValidationError(
        "incident-Link response contains a Link unrelated to the requested Bead or direction",
      );
  }
  return validated;
}

function validateTypeInventory(page: TypeInventory, scope: AbsoluteHttpUrl): TypeInventory {
  validateNext(page.next, scope);
  return page;
}

function collectionUrl(
  request: BeadCollectionRequest | LinkCollectionRequest | TypeInventoryRequest,
  discovery: ReadRoots,
): AbsoluteHttpUrl {
  const root =
    request.collection === "beads"
      ? discovery.beads
      : request.collection === "links"
        ? discovery.links
        : discovery.types;
  const parameters: Record<string, string> = {};
  for (const key of ["type", "conformsTo", "source", "target", "endpoint", "selector"] as const) {
    const value = Object.hasOwn(request, key)
      ? (request as unknown as Record<string, unknown>)[key]
      : undefined;
    if (typeof value === "string") parameters[key] = value;
  }
  if (Object.hasOwn(request, "limit") && request.limit !== undefined)
    parameters.limit = String(request.limit);
  return appendQuery(root, parameters);
}

function appendQuery(url: AbsoluteHttpUrl, parameters: Readonly<Record<string, string>>): string {
  const parsed = new URL(url);
  for (const [name, value] of Object.entries(parameters)) parsed.searchParams.set(name, value);
  return parsed.href;
}

/** Opaque stage, valid only for the prepared operation that produced it. */
export interface StagedRead<R extends ScopeReadOperation> {
  readonly body: ReadBodyFor<R>;
}
export interface PreparedRead<R extends ScopeReadOperation> {
  route(
    roots: ReadRoots,
    externalTypeIds?: ReadonlySet<string>,
  ): ReadSessionResult<AbsoluteHttpUrl>;
  validate(body: unknown): ReadSessionResult<StagedRead<R>>;
  commit(staged: StagedRead<R>): ReadSessionResult<ReadBodyFor<R>>;
  release(): void;
}

/** Pure Read routing/validation and locally owned continuation capabilities.
 * Discovery, credentials, clocks and caller delivery belong to each wrapper. */
export class ReadSession {
  readonly scope: AbsoluteHttpUrl;
  constructor(
    scope: AbsoluteHttpUrl,
    private readonly core = new SessionCore(),
  ) {
    this.scope = parseCanonicalScope(scope);
  }
  owner(scope: BdpContinuationScope | undefined): BdpContinuationScope | undefined {
    return this.core.owner(scope);
  }
  createContinuationScope(): BdpContinuationScope {
    return this.core.createContinuationScope();
  }
  forgetContinuations(scope: BdpContinuationScope): void {
    this.core.forgetContinuations(scope);
  }
  clear(): void {
    this.core.clear();
  }
  prepare<R extends ScopeReadOperation>(request: R, owner?: BdpContinuationScope): PreparedRead<R> {
    this.core.checkOpen();
    this.owner(owner);
    const owned = capturedRequests.has(request) ? request : captureReadRequest(request);
    if ((owned as ReadRequest).kind === "scope-discovery")
      throw new ReadSessionRequestError("Scope discovery is not a Read session operation");
    const continuation = continuationContextFor(owned, this.core.continuations, owner);
    const generation = this.core.generation;
    let state: "active" | "staged" | "committed" | "released" = "active";
    let staged: StagedRead<R> | undefined;
    let stagedNext: AbsoluteHttpUrl | null = null;
    const check = () => {
      this.core.checkOpen();
      if (this.core.generation !== generation || state === "released" || state === "committed")
        throw new ReadSessionLocalError("closed", "the prepared Read is no longer active");
    };
    return Object.freeze({
      route: (roots: ReadRoots, externalTypeIds: ReadonlySet<string> = new Set<string>()) => {
        check();
        const result = readRequestUrl(owned, this.scope, roots, externalTypeIds);
        return typeof result === "string"
          ? { kind: "success" as const, value: result }
          : { kind: "refusal" as const, refusal: result };
      },
      validate: (body: unknown) => {
        check();
        if (state !== "active") throw new ReadSessionRequestError("Read body was already staged");
        const result = validateReadBody(owned, body, this.scope, continuation?.context);
        if (result.kind === "problem") return { kind: "refusal" as const, refusal: result.problem };
        // Validation can invoke hostile object inspection; recheck before staging.
        check();
        stagedNext =
          continuation === undefined
            ? null
            : (result.body as { readonly next: AbsoluteHttpUrl | null }).next;
        staged = Object.freeze({ body: result.body as ReadBodyFor<R> });
        state = "staged";
        return { kind: "success" as const, value: staged };
      },
      commit: (value: StagedRead<R>) => {
        check();
        if (state !== "staged" || value !== staged)
          throw new ReadSessionRequestError("Read stage does not belong to this operation");
        if (continuation !== undefined) {
          try {
            this.core.continuations.commit(
              continuation.lease,
              stagedNext,
              continuation.context,
              owner,
            );
          } catch (error) {
            if (error instanceof ContinuationRegistryCapacityError)
              throw new ReadSessionLocalError(
                "capacity",
                "the BDP client continuation registry is at capacity",
              );
            if (error instanceof ContinuationRegistryProtocolError)
              return {
                kind: "refusal" as const,
                refusal: localRefusal(
                  "temporarily-unavailable",
                  "the server returned a structurally invalid Read response",
                ),
              };
            throw error;
          }
        }
        state = "committed";
        return { kind: "success" as const, value: value.body };
      },
      release: () => {
        if (state === "released" || state === "committed") return;
        state = "released";
        staged = undefined;
        if (!this.core.closed && generation === this.core.generation)
          this.core.continuations.restore(continuation?.lease);
      },
    });
  }
}
