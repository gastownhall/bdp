/** Identifies this package. */
export const packageName = "@bdp/protocol";

export const BDP_V0_SCHEMA_ID = "https://github.com/gastownhall/bdp/schemas/bdp-v0.schema.json";

export const BDP_PROBLEM_FAMILY_PREFIX = "https://github.com/gastownhall/bdp/problems/";

export const BDP_EXTERNAL_REFERENCE_TYPE =
  "https://github.com/gastownhall/bdp/types/external-reference";

export {
  REFERENCE_BEAD_TYPES,
  REFERENCE_BLOCKING_LINK_TYPE_ID,
  REFERENCE_TYPE_DESCRIPTORS,
  REFERENCE_TYPE_SUMMARIES,
} from "./reference-domain.js";
export {
  createTypeConformanceIndex,
  type TypeConformanceIndex,
} from "./type-conformance.js";
export {
  parseLinkHeader,
  type LinkHeaderParameter,
  type LinkHeaderValue,
} from "./link-header.js";

/**
 * The three cumulative BDP conformance profile tokens, as they appear on the
 * wire and in discovery. See **Scope discovery and human documentation** in
 * `docs/specs/bdp.md` for the normative spelling: `read`, `read-update`, and
 * `transactional`. `read` is
 * lowest, `transactional` highest; each higher token cumulatively claims every
 * lower one.
 *
 * The tokens live here rather than in `@bdp/config` because the protocol module
 * owns wire vocabulary. Only a token union and a validator are exported — no
 * schema, routing, or discovery behavior. Downstream packages (config today,
 * client and server tomorrow) reuse this single source of truth so no consumer
 * invents its own spelling.
 */
export type ProtocolProfile = "read" | "read-update" | "transactional";

export const PROTOCOL_PROFILES: readonly ProtocolProfile[] = [
  "read",
  "read-update",
  "transactional",
];

export function isProtocolProfile(value: unknown): value is ProtocolProfile {
  return typeof value === "string" && (PROTOCOL_PROFILES as readonly string[]).includes(value);
}

export type RetryDisposition = "never" | "after-state-change" | "after-delay";

export type AbsoluteHttpUrl = string;
export type AbsoluteUri = string;

export interface CollectionPage<TItem> {
  readonly items: readonly TItem[];
  readonly next: AbsoluteHttpUrl | null;
}

export interface ReadAdvertisedLimits {
  readonly page?: {
    readonly defaultItems: number;
    readonly maximumItems: number;
  };
  readonly request?: {
    readonly targetBytes: number;
    readonly bodyBytes: number;
  };
  readonly resource?: {
    readonly representationBytes: number;
    readonly propertiesBytes: number;
  };
  readonly selector?: {
    readonly bytes: number;
    readonly depth: number;
    readonly nodes: number;
  };
  readonly retention?: {
    readonly idempotency?: string;
    readonly receipt?: string;
    readonly maximumSnapshotLifetime?: string;
    readonly replay?: string;
  };
}

export interface MaximumEndpointMultiplicityPolicy {
  readonly linkConformsTo: AbsoluteHttpUrl;
  readonly endpoint: "source" | "target";
  readonly max: number;
}

export interface ReadDiscovery {
  readonly bdpVersion: "0";
  readonly profile: ProtocolProfile;
  readonly scope: AbsoluteHttpUrl;
  readonly beads: AbsoluteHttpUrl;
  readonly links: AbsoluteHttpUrl;
  readonly types: AbsoluteHttpUrl;
  readonly limits?: ReadAdvertisedLimits;
  readonly maximumEndpointMultiplicity?: readonly MaximumEndpointMultiplicityPolicy[];
}

export function isReadDiscovery(value: unknown): value is ReadDiscovery {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.bdpVersion === "0" &&
    (candidate.profile === "read" ||
      candidate.profile === "read-update" ||
      candidate.profile === "transactional") &&
    ["scope", "beads", "links", "types"].every((key) => isAbsoluteHttpUrl(candidate[key]))
  );
}

function isAbsoluteHttpUrl(value: unknown): value is AbsoluteHttpUrl {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}

export interface TypeSummary {
  readonly id: AbsoluteHttpUrl;
  readonly name: string;
  readonly describes: "bead" | "link";
}

export interface EndpointConstraint {
  readonly conformsTo: readonly AbsoluteHttpUrl[];
}

interface TypeDescriptorMembers {
  readonly id: AbsoluteHttpUrl;
  readonly name: string;
  readonly description?: string;
  readonly conformsTo: readonly AbsoluteHttpUrl[];
  readonly propertiesSchema?: AbsoluteHttpUrl;
}

export interface BeadTypeDescriptor extends TypeDescriptorMembers {
  readonly describes: "bead";
  readonly source?: never;
  readonly target?: never;
}

export interface LinkTypeDescriptor extends TypeDescriptorMembers {
  readonly describes: "link";
  readonly source: EndpointConstraint;
  readonly target: EndpointConstraint;
}

/** Closed compile-time projection of the schema-discriminated Type Descriptor. */
export type TypeDescriptor = BeadTypeDescriptor | LinkTypeDescriptor;

export {
  parseBeadCollection,
  parseBeadRecord,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseCanonicalTypeId,
  parseLinkCollection,
  parseLinkRecord,
  parsePropertiesRecord,
  parseReadDiscovery,
  parseReadProblem,
  parseTypeDescriptor,
  parseTypeInventory,
  parseTypeSummary,
  ProtocolArtifactValidationError,
  resolveCanonicalLocalResourceId,
} from "./read-values.js";

export { isJsonSchemaUri } from "./schema-formats.js";

/** An in-Scope endpoint: exactly the Bead's identity and declared Type. */
export interface LocalEndpoint {
  readonly id: AbsoluteUri;
  readonly type: AbsoluteHttpUrl;
  readonly revision?: never;
}

/** An out-of-Scope endpoint: the sentinel Type plus an optional opaque citation. */
export interface ExternalEndpoint {
  readonly id: AbsoluteUri;
  readonly type: typeof BDP_EXTERNAL_REFERENCE_TYPE;
  /** Opaque citation of the external state referenced; equality-only. */
  readonly revision?: string;
}

export type Endpoint = LocalEndpoint | ExternalEndpoint;

export interface PropertiesRecord {
  readonly [key: string]: unknown;
}

export interface BeadRecord {
  readonly id: AbsoluteHttpUrl;
  readonly type: AbsoluteHttpUrl;
  readonly revision: string;
  readonly properties: PropertiesRecord;
  readonly links?: LinkCollection;
}

export interface LinkRecord {
  readonly id: AbsoluteHttpUrl;
  readonly type: AbsoluteHttpUrl;
  readonly revision: string;
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly properties: PropertiesRecord;
}

export interface BeadCollection extends CollectionPage<BeadRecord> {}
export interface LinkCollection extends CollectionPage<LinkRecord> {}
export interface TypeInventory extends CollectionPage<TypeSummary> {}

export interface ReadProblem {
  readonly type: AbsoluteHttpUrl;
  readonly code: ReadProblemCode;
  readonly retry: RetryDisposition;
  readonly title?: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: AbsoluteUri;
  readonly [key: string]: unknown;
}

export type ReadCollectionKind = "beads" | "links" | "types";
export type ReadResourceKind = "bead" | "link" | "type";

export type IncidentLinkDirection = "inbound" | "outbound" | "both";

export interface ScopeDiscoveryRequest {
  readonly kind: "scope-discovery";
  readonly scope: AbsoluteHttpUrl;
}

export interface ScopeProbe {
  readonly serviceDescription: AbsoluteHttpUrl;
}

export interface BeadCollectionRequest {
  readonly kind: "collection";
  readonly collection: "beads";
  readonly continuation?: AbsoluteHttpUrl;
  readonly type?: AbsoluteHttpUrl;
  readonly conformsTo?: AbsoluteHttpUrl;
  readonly limit?: number;
  readonly selector?: string;
}

export interface LinkCollectionRequest {
  readonly kind: "collection";
  readonly collection: "links";
  readonly continuation?: AbsoluteHttpUrl;
  readonly type?: AbsoluteHttpUrl;
  readonly conformsTo?: AbsoluteHttpUrl;
  readonly source?: AbsoluteUri;
  readonly target?: AbsoluteUri;
  readonly endpoint?: AbsoluteUri;
  readonly limit?: number;
  readonly selector?: string;
}

export interface TypeInventoryRequest {
  readonly kind: "collection";
  readonly collection: "types";
  readonly continuation?: AbsoluteHttpUrl;
  readonly limit?: number;
}

export interface BeadResourceRequest {
  readonly kind: "resource";
  readonly resource: "bead";
  readonly id: AbsoluteHttpUrl;
}

export interface LinkResourceRequest {
  readonly kind: "resource";
  readonly resource: "link";
  readonly id: AbsoluteHttpUrl;
}

export interface TypeResourceRequest {
  readonly kind: "resource";
  readonly resource: "type";
  readonly id: AbsoluteHttpUrl;
}

export interface BeadPropertiesRequest {
  readonly kind: "properties";
  readonly resource: "bead";
  readonly id: AbsoluteHttpUrl;
}

export interface LinkPropertiesRequest {
  readonly kind: "properties";
  readonly resource: "link";
  readonly id: AbsoluteHttpUrl;
}

export interface BeadLinksRequest {
  readonly kind: "bead-links";
  readonly bead: AbsoluteHttpUrl;
  readonly continuation?: AbsoluteHttpUrl;
  readonly direction?: IncidentLinkDirection;
  readonly limit?: number;
}

export type ReadRequest =
  | ScopeDiscoveryRequest
  | BeadCollectionRequest
  | LinkCollectionRequest
  | TypeInventoryRequest
  | BeadResourceRequest
  | LinkResourceRequest
  | TypeResourceRequest
  | BeadPropertiesRequest
  | LinkPropertiesRequest
  | BeadLinksRequest;

/** A wire-neutral semantic operation consumed by Scope adapters. */
export type ScopeReadOperation = Exclude<ReadRequest, ScopeDiscoveryRequest>;

export type ReadBodyFor<Request extends ReadRequest> = Request extends ScopeDiscoveryRequest
  ? ReadDiscovery
  : Request extends BeadCollectionRequest
    ? BeadCollection
    : Request extends LinkCollectionRequest
      ? LinkCollection
      : Request extends TypeInventoryRequest
        ? TypeInventory
        : Request extends BeadResourceRequest
          ? BeadRecord
          : Request extends LinkResourceRequest
            ? LinkRecord
            : Request extends TypeResourceRequest
              ? TypeDescriptor
              : Request extends BeadPropertiesRequest | LinkPropertiesRequest
                ? PropertiesRecord
                : Request extends BeadLinksRequest
                  ? LinkCollection
                  : never;

export type ReadBody = ReadBodyFor<ReadRequest>;

export type ReadResultFor<Request extends ReadRequest> = ReadBodyFor<Request> | ReadProblem;

export type ReadProblemCode =
  | "malformed-request"
  | "invalid-parameter"
  | "unauthenticated"
  | "forbidden"
  | "resource-not-found"
  | "foreign-view"
  | "cursor-expired"
  | "request-too-large"
  | "limit-exceeded"
  | "rate-limited"
  | "temporarily-unavailable";

export type ReadProblemFamily =
  | "request"
  | "authentication"
  | "authorization"
  | "not-found"
  | "conflict"
  | "gone"
  | "size"
  | "rate-limit"
  | "unavailable";

export interface ReadProblemDefinition {
  readonly code: ReadProblemCode;
  readonly family: ReadProblemFamily;
  readonly type: `${typeof BDP_PROBLEM_FAMILY_PREFIX}${ReadProblemFamily}`;
  readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429 | 503;
  readonly retry: RetryDisposition;
}

const READ_PROBLEM_ROWS: {
  readonly [Code in ReadProblemCode]: Omit<ReadProblemDefinition, "code" | "type">;
} = {
  "malformed-request": { family: "request", status: 400, retry: "never" },
  "invalid-parameter": { family: "request", status: 400, retry: "never" },
  unauthenticated: { family: "authentication", status: 401, retry: "after-state-change" },
  forbidden: { family: "authorization", status: 403, retry: "after-state-change" },
  "resource-not-found": { family: "not-found", status: 404, retry: "after-state-change" },
  "foreign-view": { family: "conflict", status: 409, retry: "after-state-change" },
  "cursor-expired": { family: "gone", status: 410, retry: "after-state-change" },
  "request-too-large": { family: "size", status: 413, retry: "never" },
  "limit-exceeded": { family: "size", status: 413, retry: "never" },
  "rate-limited": { family: "rate-limit", status: 429, retry: "after-delay" },
  "temporarily-unavailable": { family: "unavailable", status: 503, retry: "after-delay" },
};

const READ_PROBLEM_CODES = Object.keys(READ_PROBLEM_ROWS) as readonly ReadProblemCode[];

export const READ_PROBLEM_DEFINITIONS: readonly ReadProblemDefinition[] = READ_PROBLEM_CODES.map(
  (code) => readProblemDefinitionFor(code),
);

export function readProblemDefinitionFor(code: ReadProblemCode): ReadProblemDefinition {
  const row = READ_PROBLEM_ROWS[code];
  return {
    code,
    ...row,
    type: `${BDP_PROBLEM_FAMILY_PREFIX}${row.family}`,
  };
}

export function readProblem(code: ReadProblemCode, detail?: string): ReadProblem {
  const definition = readProblemDefinitionFor(code);
  return {
    type: definition.type,
    code,
    retry: definition.retry,
    status: definition.status,
    ...(detail === undefined ? {} : { detail }),
  };
}

export function isReadProblemCode(value: unknown): value is ReadProblemCode {
  return (
    typeof value === "string" &&
    READ_PROBLEM_DEFINITIONS.some((definition) => definition.code === value)
  );
}

export function isReadProblem(value: unknown): value is ReadProblem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    isReadProblemCode(candidate.code) &&
    (candidate.retry === "never" ||
      candidate.retry === "after-state-change" ||
      candidate.retry === "after-delay")
  );
}
