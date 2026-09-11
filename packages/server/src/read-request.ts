import type {
  AbsoluteHttpUrl,
  BeadCollection,
  BeadRecord,
  Reference,
  LinkCollection,
  LinkRecord,
  ReadBodyFor,
  ReadProblem,
  ReadRequest,
  ScopeReadOperation,
  TypeInventory,
} from "@bdp/protocol";
import {
  referenceUri,
  isJsonSchemaUri,
  isReadProblem,
  ProtocolArtifactValidationError,
  parseBeadCollection,
  parseBeadRecord,
  parseCanonicalTypeId,
  parseLinkCollection,
  parseLinkRecord,
  parsePropertiesRecord,
  parseTypeDescriptor,
  parseTypeInventory,
  readProblem,
  assertCanonicalPathSegments,
  compareCanonicalIds,
  resolveCanonicalLocalResourceId,
} from "@bdp/protocol";
import { ReadSelectorError } from "./read-selector.js";
import type { ReadPaginationError } from "./read-pagination.js";

/** Internal Read mechanics only. Static consumers retain their receiving behavior;
 * strict own-data snapshotting belongs to the authority plane before this kernel.
 * No profile, transport, policy capture, or store ownership is established here. */
export interface ReadRequestValidationContext {
  readonly scope: AbsoluteHttpUrl;
  readonly controlsEnabled: boolean;
}
export type ReadRequestVariant =
  | {
      readonly kind: "discovery";
      readonly fields: readonly string[];
      matches(request: Readonly<Record<string, unknown>>): boolean;
      validate(request: unknown, context: ReadRequestValidationContext): ReadProblem | undefined;
    }
  | {
      readonly kind: "scope";
      readonly fields: readonly string[];
      matches(request: Readonly<Record<string, unknown>>): boolean;
      validate(request: unknown, context: ReadRequestValidationContext): ReadProblem | undefined;
      readonly validateBody: ScopeBodyValidation<ScopeReadOperation>;
    };
type ReadRequestVariantKey<Request extends ReadRequest = ReadRequest> = Request extends ReadRequest
  ? Request extends { readonly kind: "scope-discovery" }
    ? "scope-discovery"
    : Request extends {
          readonly kind: "collection";
          readonly collection: infer Collection extends string;
        }
      ? `collection:${Collection}`
      : Request extends {
            readonly kind: "resource" | "properties";
            readonly resource: infer Resource extends string;
          }
        ? `${Request["kind"]}:${Resource}`
        : Request extends { readonly kind: "bead-links" }
          ? "bead-links"
          : Request extends { readonly kind: infer Kind extends string }
            ? `unhandled:${Kind}`
            : "unhandled:request"
  : never;

type ScopeRequestValidation<Operation extends ScopeReadOperation> = (
  operation: Operation,
  options: ReadRequestValidationContext,
) => ReadProblem | undefined;

export type ScopeBodyValidation<Operation extends ScopeReadOperation> = (
  operation: Operation,
  value: unknown,
  scope: AbsoluteHttpUrl,
) => ReadBodyFor<Operation>;

function readRequestDiscriminant(
  kind: ReadRequest["kind"],
  secondary?: readonly ["collection" | "resource", string],
): (request: Readonly<Record<string, unknown>>) => boolean {
  return (request) =>
    request.kind === kind && (secondary === undefined || request[secondary[0]] === secondary[1]);
}

function defineScopeReadVariant<Operation extends ScopeReadOperation>(options: {
  readonly matches: (request: Readonly<Record<string, unknown>>) => boolean;
  readonly fields: readonly string[];
  readonly validate: ScopeRequestValidation<Operation>;
  readonly validateBody: ScopeBodyValidation<Operation>;
}): ReadRequestVariant {
  return Object.freeze({
    kind: "scope" as const,
    fields: options.fields,
    matches: options.matches,
    validate(request: unknown, context: ReadRequestValidationContext) {
      return options.validate(request as Operation, context);
    },
    validateBody(operation: ScopeReadOperation, value: unknown, scope: AbsoluteHttpUrl) {
      return options.validateBody(operation as Operation, value, scope);
    },
  });
}

export type ScopeServerLocalErrorCode = "server-closed" | "operation-aborted";

export abstract class ScopeServerLocalError extends Error {
  abstract readonly code: ScopeServerLocalErrorCode;
}

export class ScopeServerClosedError extends ScopeServerLocalError {
  readonly code = "server-closed" as const;

  constructor() {
    super("the BDP server is closed");
    this.name = "ScopeServerClosedError";
  }
}

export class ScopeServerOperationAbortedError extends ScopeServerLocalError {
  readonly code = "operation-aborted" as const;

  constructor(options: ErrorOptions = {}) {
    super("the BDP server operation was aborted", options);
    this.name = "ScopeServerOperationAbortedError";
  }
}

export function requestFromUrl(url: URL, scope: AbsoluteHttpUrl): ReadRequest | ReadProblem {
  const scopeUrl = new URL(scope);
  if (url.origin !== scopeUrl.origin) return notFound();
  if (!url.pathname.startsWith(scopeUrl.pathname)) return notFound();
  const relative = url.pathname.slice(scopeUrl.pathname.length);
  const segments = relative.split("/").filter(Boolean);
  if (segments.length === 1 && ["beads", "links", "types"].includes(segments[0] ?? "")) {
    const collection = segments[0] as "beads" | "links" | "types";
    if (relative !== `${collection}/`) return notFound();
    const parameterIssue = validateCollectionParameters(url, collection);
    if (parameterIssue !== undefined) return parameterIssue;
    const parameter = (name: string): string | undefined => url.searchParams.get(name) ?? undefined;
    const limit = parseOptionalLimit(parameter("limit"));
    if (isReadProblem(limit)) return limit;
    if (collection === "types") {
      if (parameter("cursor") !== undefined)
        return { kind: "collection", collection, continuation: url.href };
      return {
        kind: "collection",
        collection,
        ...(limit === undefined ? {} : { limit }),
      };
    }
    const type = parseOptionalTypeParameter(parameter("type"), scope);
    if (isReadProblem(type)) return type;
    const conformsTo = parseOptionalTypeParameter(parameter("conformsTo"), scope);
    if (isReadProblem(conformsTo)) return conformsTo;
    const filters = {
      ...(type === undefined ? {} : { type }),
      ...(conformsTo === undefined ? {} : { conformsTo }),
    };
    const controls = {
      ...(limit === undefined ? {} : { limit }),
      ...(parameter("selector") === undefined ? {} : { selector: parameter("selector") as string }),
    };
    if (collection === "beads") {
      if (parameter("cursor") !== undefined)
        return { kind: "collection", collection, continuation: url.href };
      return { kind: "collection", collection, ...filters, ...controls };
    }
    const source = normalizeEndpointParameter(parameter("source"), scope);
    if (isReadProblem(source)) return source;
    const target = normalizeEndpointParameter(parameter("target"), scope);
    if (isReadProblem(target)) return target;
    const endpoint = normalizeEndpointParameter(parameter("endpoint"), scope);
    if (isReadProblem(endpoint)) return endpoint;
    if (parameter("cursor") !== undefined)
      return { kind: "collection", collection, continuation: url.href };
    return {
      kind: "collection",
      collection,
      ...filters,
      ...(source === undefined ? {} : { source }),
      ...(target === undefined ? {} : { target }),
      ...(endpoint === undefined ? {} : { endpoint }),
      ...controls,
    } as ReadRequest;
  }
  if (
    segments.length >= 2 &&
    (segments[0] === "beads" || segments[0] === "links" || segments[0] === "types")
  ) {
    const resourceRoot = segments[0];
    const localId = `${resourceRoot}/${segments.slice(1).join("/")}`;
    if (relative !== localId) return notFound();
    let id: AbsoluteHttpUrl;
    try {
      id = resolveCanonicalLocalResourceId(
        scope,
        resourceRoot === "beads" ? "bead" : resourceRoot === "links" ? "link" : "type",
        localId,
      );
    } catch (error) {
      if (error instanceof ProtocolArtifactValidationError) return notFound();
      throw error;
    }
    if (resourceRoot === "types")
      return validateParameters(url, []) ?? { kind: "resource", resource: "type", id };
    const view = url.searchParams.get("view") ?? undefined;
    if (view === undefined)
      return (validateParameters(url, []) ?? {
        kind: "resource",
        resource: resourceRoot === "beads" ? "bead" : "link",
        id,
      }) as ReadRequest;
    if (view === "properties") {
      const parameterIssue = validateParameters(url, ["view"]);
      if (parameterIssue !== undefined) return parameterIssue;
      return {
        kind: "properties",
        resource: resourceRoot === "beads" ? "bead" : "link",
        id,
      } as ReadRequest;
    }
    if (view === "links" && resourceRoot === "beads") {
      const parameterIssue = validateParameters(url, ["view", "direction", "limit", "cursor"]);
      if (parameterIssue !== undefined) return parameterIssue;
      const direction = url.searchParams.get("direction") ?? "both";
      if (direction !== "inbound" && direction !== "outbound" && direction !== "both")
        return invalidParameter();
      const limit = parseOptionalLimit(url.searchParams.get("limit") ?? undefined);
      if (isReadProblem(limit)) return limit;
      if (url.searchParams.has("cursor"))
        return { kind: "bead-links", bead: id, continuation: url.href };
      return {
        kind: "bead-links",
        bead: id,
        direction,
        ...(limit === undefined ? {} : { limit }),
      };
    }
    return invalidParameter();
  }
  return notFound();
}

function parseOptionalLimit(value: string | undefined): number | undefined | ReadProblem {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) return invalidParameter();
  const limit = Number(value);
  return Number.isSafeInteger(limit) ? limit : invalidParameter();
}

export function notFound(): ReadProblem {
  return readProblem("resource-not-found");
}

export function invalidParameter(): ReadProblem {
  return readProblem("invalid-parameter");
}

function parseOptionalTypeParameter(
  value: string | undefined,
  scope: AbsoluteHttpUrl,
): AbsoluteHttpUrl | undefined | ReadProblem {
  if (value === undefined) return undefined;
  return parseTypeIdentity(value, scope);
}

function parseTypeIdentity(value: unknown, scope: AbsoluteHttpUrl): AbsoluteHttpUrl | ReadProblem {
  try {
    const id = parseCanonicalTypeId(value);
    if (id.startsWith(scope)) {
      const localId = id.slice(scope.length);
      if (resolveCanonicalLocalResourceId(scope, "type", localId) !== id) return invalidParameter();
    }
    return id;
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError) return invalidParameter();
    throw error;
  }
}

const COLLECTION_PARAMETERS = {
  beads: ["type", "conformsTo", "selector", "limit", "cursor"],
  links: ["type", "conformsTo", "source", "target", "endpoint", "selector", "limit", "cursor"],
  types: ["limit", "cursor"],
} as const;

function validateCollectionParameters(
  url: URL,
  collection: "beads" | "links" | "types",
): ReadProblem | undefined {
  return validateParameters(url, COLLECTION_PARAMETERS[collection]);
}

function validateParameters(url: URL, allowed: readonly string[]): ReadProblem | undefined {
  for (const name of new Set(url.searchParams.keys()))
    if (!allowed.includes(name) || url.searchParams.getAll(name).length !== 1)
      return invalidParameter();
  return undefined;
}

function normalizeEndpointParameter(
  value: string | undefined,
  scope: AbsoluteHttpUrl,
): string | undefined | ReadProblem {
  if (value === undefined) return undefined;
  try {
    if (!isJsonSchemaUri(value)) return resolveCanonicalLocalResourceId(scope, "bead", value);
    // RFC 3986 admits absolute URI spellings (for example IPvFuture authorities)
    // that WHATWG URL cannot parse. They cannot identify this WHATWG-canonical Scope.
    if (!URL.canParse(value)) return value;
    const parsed = new URL(value);
    const scopeUrl = new URL(scope);
    const insideScope =
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin === scopeUrl.origin &&
      parsed.pathname.startsWith(scopeUrl.pathname);
    // External endpoint identity is opaque: validate the original RFC 3986
    // spelling, classify with a parsed copy, and never serialize it back.
    if (!insideScope) return value;
    if (parsed.username !== "" || parsed.password !== "" || !value.startsWith(scope))
      return invalidParameter();
    const localId = value.slice(scope.length);
    return resolveCanonicalLocalResourceId(scope, "bead", localId) === value
      ? value
      : invalidParameter();
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError || error instanceof TypeError)
      return invalidParameter();
    throw error;
  }
}

function validateLocalResourceIdentity(
  value: unknown,
  scope: AbsoluteHttpUrl,
  resource: "bead" | "link",
): ReadProblem | undefined {
  if (typeof value !== "string" || !value.startsWith(scope)) return invalidParameter();
  try {
    const localId = value.slice(scope.length);
    if (resolveCanonicalLocalResourceId(scope, resource, localId) !== value)
      return invalidParameter();
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError) return invalidParameter();
    throw error;
  }
  return undefined;
}

export type PageOperation =
  | BeadCollectionOperation
  | LinkCollectionOperation
  | TypeInventoryOperation
  | BeadLinksOperation;

/**
 * The advertised `canonical-uri` collection order: ascending lexicographic
 * comparison, by Unicode code unit, of each item's absolute canonical id.
 * Applied by the authority before pagination so every page of one logical
 * snapshot observes one total order.
 */
export function inCanonicalUriOrder<Item extends { readonly id: string }>(
  items: readonly Item[],
): readonly Item[] {
  return Object.freeze([...items].sort((left, right) => compareCanonicalIds(left.id, right.id)));
}

export function isPageOperation(operation: ReadRequest): operation is PageOperation {
  return operation.kind === "collection" || operation.kind === "bead-links";
}

export function withoutPageControls(operation: PageOperation): PageOperation {
  if (operation.kind === "bead-links") {
    return {
      kind: "bead-links",
      bead: operation.bead,
      ...(operation.direction === undefined ? {} : { direction: operation.direction }),
    };
  }
  if (operation.collection === "types") return { kind: "collection", collection: "types" };
  const common = {
    kind: "collection" as const,
    collection: operation.collection,
    ...(operation.type === undefined ? {} : { type: operation.type }),
    ...(operation.conformsTo === undefined ? {} : { conformsTo: operation.conformsTo }),
  };
  if (operation.collection === "beads") return common;
  return {
    ...common,
    ...(operation.source === undefined ? {} : { source: operation.source }),
    ...(operation.target === undefined ? {} : { target: operation.target }),
    ...(operation.endpoint === undefined ? {} : { endpoint: operation.endpoint }),
  };
}

export function continuationUrlFor(operation: PageOperation, scope: AbsoluteHttpUrl): string {
  const url =
    operation.kind === "bead-links"
      ? new URL(operation.bead)
      : new URL(`${operation.collection}/`, scope);
  if (operation.kind === "bead-links") {
    url.searchParams.set("view", "links");
    if (operation.direction !== undefined) url.searchParams.set("direction", operation.direction);
  } else if (operation.collection !== "types") {
    if (operation.type !== undefined) url.searchParams.set("type", operation.type);
    if (operation.conformsTo !== undefined)
      url.searchParams.set("conformsTo", operation.conformsTo);
    if (operation.collection === "links") {
      if (operation.source !== undefined) url.searchParams.set("source", operation.source);
      if (operation.target !== undefined) url.searchParams.set("target", operation.target);
      if (operation.endpoint !== undefined) url.searchParams.set("endpoint", operation.endpoint);
    }
    if (operation.selector !== undefined) url.searchParams.set("selector", operation.selector);
  }
  if (operation.limit !== undefined) url.searchParams.set("limit", String(operation.limit));
  return url.href;
}

export function continuationDetails(
  operation: PageOperation,
  scope: AbsoluteHttpUrl,
): { readonly token: string; readonly projection: string } | ReadProblem {
  let url: URL;
  try {
    url = new URL(operation.continuation ?? "");
  } catch {
    return invalidParameter();
  }
  const parsed = requestFromUrl(url, scope);
  if (isReadProblem(parsed)) return parsed;
  if (
    !isPageOperation(parsed) ||
    parsed.continuation !== url.href ||
    parsed.kind !== operation.kind ||
    (operation.kind === "collection" &&
      (parsed.kind !== "collection" || parsed.collection !== operation.collection)) ||
    (operation.kind === "bead-links" &&
      (parsed.kind !== "bead-links" || parsed.bead !== operation.bead))
  )
    return invalidParameter();
  const token = url.searchParams.get("cursor");
  if (token === null) return invalidParameter();
  url.searchParams.delete("cursor");
  return Object.freeze({ token, projection: url.href });
}

function collectionControlIssue(
  operation: {
    readonly continuation?: AbsoluteHttpUrl;
    readonly limit?: number;
    readonly selector?: string;
  },
  enabled: boolean,
  continuationIncompatible: readonly unknown[],
): ReadProblem | undefined {
  if (enabled) {
    if (
      operation.continuation !== undefined &&
      (operation.limit !== undefined ||
        operation.selector !== undefined ||
        continuationIncompatible.some((value) => value !== undefined))
    )
      return invalidParameter();
    if (operation.selector !== undefined && typeof operation.selector !== "string")
      return invalidParameter();
    return undefined;
  }
  return operation.continuation !== undefined ||
    operation.limit !== undefined ||
    operation.selector !== undefined
    ? invalidParameter()
    : undefined;
}

function typeFilterIssue(
  operation: { readonly type?: AbsoluteHttpUrl; readonly conformsTo?: AbsoluteHttpUrl },
  scope: AbsoluteHttpUrl,
): ReadProblem | undefined {
  for (const value of [operation.type, operation.conformsTo]) {
    const parsed = parseOptionalTypeParameter(value, scope);
    if (isReadProblem(parsed)) return parsed;
  }
  return undefined;
}

function localResourceIssue(
  operation: { readonly id: AbsoluteHttpUrl; readonly resource: "bead" | "link" },
  scope: AbsoluteHttpUrl,
): ReadProblem | undefined {
  return validateLocalResourceIdentity(operation.id, scope, operation.resource);
}

type BeadCollectionOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "collection"; readonly collection: "beads" }
>;
type LinkCollectionOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "collection"; readonly collection: "links" }
>;
type TypeInventoryOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "collection"; readonly collection: "types" }
>;
type BeadResourceOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "resource"; readonly resource: "bead" }
>;
type LinkResourceOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "resource"; readonly resource: "link" }
>;
type TypeResourceOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "resource"; readonly resource: "type" }
>;
type BeadPropertiesOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "properties"; readonly resource: "bead" }
>;
type LinkPropertiesOperation = Extract<
  ScopeReadOperation,
  { readonly kind: "properties"; readonly resource: "link" }
>;
type BeadLinksOperation = Extract<ScopeReadOperation, { readonly kind: "bead-links" }>;

// This is the only semantic Read-variant registration point. The derived key
// union makes a newly added protocol variant a compile error until its exact
// fields, request validation, and response validation are registered here.
const READ_REQUEST_VARIANTS = Object.freeze({
  "scope-discovery": Object.freeze({
    fields: ["kind", "scope"],
    matches: readRequestDiscriminant("scope-discovery"),
    kind: "discovery" as const,
    validate(value: unknown, context: ReadRequestValidationContext): ReadProblem | undefined {
      const request = value as Readonly<Record<string, unknown>>;
      return request.scope !== context.scope ? invalidParameter() : undefined;
    },
  }),
  "collection:beads": defineScopeReadVariant<BeadCollectionOperation>({
    matches: readRequestDiscriminant("collection", ["collection", "beads"]),
    fields: ["kind", "collection", "continuation", "type", "conformsTo", "limit", "selector"],
    validate: (operation, options) =>
      collectionControlIssue(operation, options.controlsEnabled, [
        operation.type,
        operation.conformsTo,
      ]) ?? typeFilterIssue(operation, options.scope),
    validateBody: validateBeadCollectionBody,
  }),
  "collection:links": defineScopeReadVariant<LinkCollectionOperation>({
    matches: readRequestDiscriminant("collection", ["collection", "links"]),
    fields: [
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
    validate: validateLinkCollectionRequest,
    validateBody: validateLinkCollectionBody,
  }),
  "collection:types": defineScopeReadVariant<TypeInventoryOperation>({
    matches: readRequestDiscriminant("collection", ["collection", "types"]),
    fields: ["kind", "collection", "continuation", "limit"],
    validate: (operation, options) =>
      collectionControlIssue(operation, options.controlsEnabled, []),
    validateBody: (_operation, value) =>
      validateTypeInventory(parseTypeInventory(value, "ScopePort Type inventory")),
  }),
  "resource:bead": defineScopeReadVariant<BeadResourceOperation>({
    matches: readRequestDiscriminant("resource", ["resource", "bead"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => localResourceIssue(operation, options.scope),
    validateBody: validateBeadResourceBody,
  }),
  "resource:link": defineScopeReadVariant<LinkResourceOperation>({
    matches: readRequestDiscriminant("resource", ["resource", "link"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => localResourceIssue(operation, options.scope),
    validateBody: validateLinkResourceBody,
  }),
  "resource:type": defineScopeReadVariant<TypeResourceOperation>({
    matches: readRequestDiscriminant("resource", ["resource", "type"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => {
      const parsed = parseTypeIdentity(operation.id, options.scope);
      return isReadProblem(parsed) ? parsed : undefined;
    },
    validateBody: validateTypeResourceBody,
  }),
  "properties:bead": defineScopeReadVariant<BeadPropertiesOperation>({
    matches: readRequestDiscriminant("properties", ["resource", "bead"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => localResourceIssue(operation, options.scope),
    validateBody: validatePropertiesBody,
  }),
  "properties:link": defineScopeReadVariant<LinkPropertiesOperation>({
    matches: readRequestDiscriminant("properties", ["resource", "link"]),
    fields: ["kind", "resource", "id"],
    validate: (operation, options) => localResourceIssue(operation, options.scope),
    validateBody: validatePropertiesBody,
  }),
  "bead-links": defineScopeReadVariant<BeadLinksOperation>({
    matches: readRequestDiscriminant("bead-links"),
    fields: ["kind", "bead", "continuation", "direction", "limit"],
    validate: validateBeadLinksRequest,
    validateBody: validateBeadLinksBody,
  }),
} satisfies Record<ReadRequestVariantKey, ReadRequestVariant>);

export function resolveReadRequestVariant(value: unknown): ReadRequestVariant | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const request = value as Readonly<Record<string, unknown>>;
  const variant = Object.values(READ_REQUEST_VARIANTS).find((candidate) =>
    candidate.matches(request),
  );
  return variant !== undefined && hasOnlyVariantFields(request, variant.fields)
    ? variant
    : undefined;
}

function validateLinkCollectionRequest(
  operation: LinkCollectionOperation,
  options: ReadRequestValidationContext,
): ReadProblem | undefined {
  const commonIssue =
    collectionControlIssue(operation, options.controlsEnabled, [
      operation.type,
      operation.conformsTo,
      operation.source,
      operation.target,
      operation.endpoint,
    ]) ?? typeFilterIssue(operation, options.scope);
  if (commonIssue !== undefined) return commonIssue;
  for (const value of [operation.source, operation.target, operation.endpoint]) {
    if (value === undefined) continue;
    const normalized = normalizeEndpointParameter(value, options.scope);
    if (isReadProblem(normalized) || normalized !== value) return invalidParameter();
  }
  return undefined;
}

function validateBeadLinksRequest(
  operation: BeadLinksOperation,
  options: ReadRequestValidationContext,
): ReadProblem | undefined {
  if (
    operation.direction !== undefined &&
    operation.direction !== "inbound" &&
    operation.direction !== "outbound" &&
    operation.direction !== "both"
  )
    return invalidParameter();
  const controlIssue = collectionControlIssue(operation, options.controlsEnabled, [
    operation.direction,
  ]);
  if (controlIssue !== undefined) return controlIssue;
  return validateLocalResourceIdentity(operation.bead, options.scope, "bead");
}

function validateBeadCollectionBody(
  operation: BeadCollectionOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<BeadCollectionOperation> {
  const page = parseBeadCollection(value, "ScopePort Bead collection");
  validateCollectionNext(page);
  for (const bead of page.items) {
    validateServerBead(bead, scope);
    if (operation.type !== undefined && bead.type !== operation.type)
      throw new ProtocolArtifactValidationError(
        "ScopePort Bead collection violated the requested Type filter",
      );
  }
  return page;
}

function validateLinkCollectionBody(
  operation: LinkCollectionOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<LinkCollectionOperation> {
  const page = parseLinkCollection(value, "ScopePort Link collection");
  validateCollectionNext(page);
  for (const link of page.items) {
    validateServerLink(link, scope);
    validateLinkCollectionFilters(link, operation);
  }
  return page;
}

function validateBeadResourceBody(
  operation: BeadResourceOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<BeadResourceOperation> {
  const bead = parseBeadRecord(value, "ScopePort Bead");
  validateServerBead(bead, scope);
  if (bead.id !== operation.id)
    throw new ProtocolArtifactValidationError("ScopePort returned the wrong Bead ID");
  return bead;
}

function validateLinkResourceBody(
  operation: LinkResourceOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<LinkResourceOperation> {
  const link = parseLinkRecord(value, "ScopePort Link");
  validateServerLink(link, scope);
  if (link.id !== operation.id)
    throw new ProtocolArtifactValidationError("ScopePort returned the wrong Link ID");
  return link;
}

function validateTypeResourceBody(
  operation: TypeResourceOperation,
  value: unknown,
): ReadBodyFor<TypeResourceOperation> {
  const body = parseTypeDescriptor(value, "ScopePort Type Descriptor");
  if (body.id !== operation.id)
    throw new ProtocolArtifactValidationError("ScopePort returned the wrong Type ID");
  return body;
}

function validatePropertiesBody(
  _operation: BeadPropertiesOperation | LinkPropertiesOperation,
  value: unknown,
): ReadBodyFor<BeadPropertiesOperation | LinkPropertiesOperation> {
  return parsePropertiesRecord(value, "ScopePort properties");
}

function validateBeadLinksBody(
  operation: BeadLinksOperation,
  value: unknown,
  scope: AbsoluteHttpUrl,
): ReadBodyFor<BeadLinksOperation> {
  const page = parseLinkCollection(value, "ScopePort incident-Link collection");
  validateCollectionNext(page);
  const direction = operation.direction ?? "both";
  for (const link of page.items) {
    validateServerLink(link, scope);
    const inbound = referenceUri(link.target) === operation.bead;
    const outbound = referenceUri(link.source) === operation.bead;
    if (
      (direction === "inbound" && !inbound) ||
      (direction === "outbound" && !outbound) ||
      (direction === "both" && !inbound && !outbound)
    )
      throw new ProtocolArtifactValidationError(
        "ScopePort returned a Link outside the requested incident direction",
      );
  }
  return page;
}

function validateTypeInventory(page: TypeInventory): TypeInventory {
  validateCollectionNext(page);
  return page;
}

function validateCollectionNext(page: BeadCollection | LinkCollection | TypeInventory): void {
  if (page.next === null) return;
  throw new ProtocolArtifactValidationError(
    "ScopePort pagination is unsupported until the server owns continuation navigation",
  );
}

export function validateServerBead(bead: BeadRecord, scope: AbsoluteHttpUrl): void {
  validateServerLocalResourceId(bead.id, scope, "bead");
  if (bead.links !== undefined)
    throw new ProtocolArtifactValidationError("ScopePort returned unexpected embedded Links");
  for (const links of Object.values(bead.ownedLinks ?? {}))
    for (const link of links) validateServerLink(link, scope);
}

export function validateServerLink(link: LinkRecord, scope: AbsoluteHttpUrl): void {
  validateServerLocalResourceId(link.id, scope, "link");
  const sourceInScope = validateServerEndpoint(link.source, scope);
  const targetInScope = validateServerEndpoint(link.target, scope);
  if (!sourceInScope && !targetInScope)
    throw new ProtocolArtifactValidationError(
      "ScopePort Link must have at least one in-Scope endpoint",
    );
}

export function validateServerEndpoint(endpoint: Reference, scope: AbsoluteHttpUrl): boolean {
  // In-Scope or external is derived from the URI: a Scope-alias URI claims an
  // in-Scope Bead and must be its canonical spelling; every other URI is an
  // opaque external reference. Either may carry a pin.
  const uri = referenceUri(endpoint);
  if (!endpointAliasesScope(uri, scope)) return false;
  validateServerLocalResourceId(uri, scope, "bead");
  return true;
}

function endpointAliasesScope(value: string, scope: AbsoluteHttpUrl): boolean {
  if (!URL.canParse(value)) return false;
  const candidate = new URL(value);
  const root = new URL(scope);
  if (candidate.origin !== root.origin) return false;
  const candidatePath = normalizeResponsePath(candidate.pathname);
  const rootPath = normalizeResponsePath(root.pathname);
  return candidatePath !== undefined && rootPath !== undefined
    ? candidatePath.startsWith(rootPath)
    : candidate.pathname.startsWith(root.pathname);
}

function normalizeResponsePath(pathname: string): string | undefined {
  let normalized = "";
  for (let index = 0; index < pathname.length; index += 1) {
    const character = pathname[index];
    if (character !== "%") {
      normalized += character;
      continue;
    }
    const digits = pathname.slice(index + 1, index + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(digits)) return undefined;
    const byte = Number.parseInt(digits, 16);
    const decoded = String.fromCharCode(byte);
    normalized += /^[A-Za-z0-9._~-]$/.test(decoded) ? decoded : `%${digits.toUpperCase()}`;
    index += 2;
  }
  return normalized;
}

export function validateServerLocalResourceId(
  id: string,
  scope: AbsoluteHttpUrl,
  resource: "bead" | "link",
): void {
  if (!id.startsWith(scope))
    throw new ProtocolArtifactValidationError(`ScopePort ${resource} ID escaped the Scope`);
  const localId = id.slice(scope.length);
  if (resolveCanonicalLocalResourceId(scope, resource, localId) !== id)
    throw new ProtocolArtifactValidationError(`ScopePort ${resource} ID is not canonical`);
}

function validateLinkCollectionFilters(
  link: LinkRecord,
  operation: Extract<
    ScopeReadOperation,
    { readonly kind: "collection"; readonly collection: "links" }
  >,
): void {
  if (operation.type !== undefined && link.type !== operation.type)
    throw new ProtocolArtifactValidationError(
      "ScopePort Link collection violated the requested Type filter",
    );
  if (operation.source !== undefined && referenceUri(link.source) !== operation.source)
    throw new ProtocolArtifactValidationError(
      "ScopePort Link collection violated the requested source filter",
    );
  if (operation.target !== undefined && referenceUri(link.target) !== operation.target)
    throw new ProtocolArtifactValidationError(
      "ScopePort Link collection violated the requested target filter",
    );
  if (
    operation.endpoint !== undefined &&
    referenceUri(link.source) !== operation.endpoint &&
    referenceUri(link.target) !== operation.endpoint
  )
    throw new ProtocolArtifactValidationError(
      "ScopePort Link collection violated the requested endpoint filter",
    );
}

const READ_REQUEST_FIELDS = [
  "kind",
  "scope",
  "collection",
  "continuation",
  "type",
  "conformsTo",
  "source",
  "target",
  "endpoint",
  "limit",
  "selector",
  "resource",
  "id",
  "bead",
  "direction",
] as const;

function hasOnlyVariantFields(
  request: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return (
    Reflect.ownKeys(request).every(
      (field) => typeof field === "string" && allowed.includes(field),
    ) && READ_REQUEST_FIELDS.every((field) => allowed.includes(field) || !(field in request))
  );
}

/**
 * Alias URL classification — deliberately table-free, so it can run before
 * the identity gate. Returns undefined when the URL is not beneath the
 * alias root, the alias path when it is well-formed, and the uniform 404
 * problem for malformed alias URLs (query, fragment, empty, or a path the
 * Resource-ID grammar refuses). Raw-target canonicality (dot segments,
 * alternate encodings the WHATWG parser normalizes away) is the transport
 * bridge's duty, exactly as for Resource URLs.
 */
export function classifyAliasPath(
  url: URL,
  scope: AbsoluteHttpUrl,
): string | ReadProblem | undefined {
  const scopeUrl = new URL(scope);
  if (url.origin !== scopeUrl.origin) return undefined;
  const aliasRoot = `${scopeUrl.pathname}alias/`;
  if (!url.pathname.startsWith(aliasRoot)) return undefined;
  if (url.search !== "" || url.hash !== "") return notFound();
  const path = url.pathname.slice(aliasRoot.length);
  if (path.length === 0) return notFound();
  try {
    assertCanonicalPathSegments(path, "alias path");
  } catch {
    return notFound();
  }
  return path;
}

export function readControlProblem(error: ReadSelectorError | ReadPaginationError): ReadProblem {
  if (error.code === "foreign-view") return readProblem("foreign-view");
  if (error.code === "cursor-expired") return readProblem("cursor-expired");
  if (error instanceof ReadSelectorError)
    return readProblem(
      error.code === "source-bytes-limit-exceeded" ||
        error.code === "ast-depth-limit-exceeded" ||
        error.code === "ast-nodes-limit-exceeded"
        ? "limit-exceeded"
        : "invalid-parameter",
    );
  if (error.code === "invalid-limit") return readProblem("limit-exceeded");
  if (error.code === "foreign-projection" || error.code === "invalid-input")
    return readProblem("invalid-parameter");
  return readProblem("temporarily-unavailable");
}
