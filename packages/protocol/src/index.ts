/** Identifies this package. */
export const packageName = "@bdp/protocol";

export const BDP_V0_SCHEMA_ID = "https://github.com/gastownhall/bdp/schemas/bdp-v0.schema.json";

export const BDP_PROBLEM_FAMILY_PREFIX = "https://github.com/gastownhall/bdp/problems/";

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
  /**
   * The alias root, when this authority serves aliases: repointable names
   * beneath `alias/` that resolve to canonical Bead URLs with one 307.
   * Omitted by authorities without aliases (capability honesty).
   */
  readonly aliases?: AbsoluteHttpUrl;
  /** The advertised collection order; omission means the canonical-uri baseline. */
  readonly order?: "canonical-uri";
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

export type ExternalEndpointPolicy = "none" | "opaque" | "bead";

export interface EndpointConstraint {
  readonly conformsTo: readonly AbsoluteHttpUrl[];
  /**
   * Whether this endpoint may reference an out-of-Scope target: "none"
   * rejects external URIs at creation, "opaque" admits any external URI,
   * and "bead" admits external URIs that are bead-shaped (a canonical
   * .../beads/{id} URL) at creation time — declared intent, not an ongoing
   * guarantee. Absent means "opaque", preserving the pre-policy behavior.
   */
  readonly external?: ExternalEndpointPolicy;
}

interface TypeDescriptorMembers {
  readonly id: AbsoluteHttpUrl;
  readonly name: string;
  readonly description?: string;
  readonly conformsTo: readonly AbsoluteHttpUrl[];
  readonly propertiesSchema?: AbsoluteHttpUrl;
}

/**
 * One owned outgoing Link Type: links of this type created from a Bead of
 * the declaring Type are part of the source's versioned state — target,
 * pin, and properties, so every owned-Link mutation versions the source.
 * `max` bounds the owned set so the ownedLinks plane can always be served
 * inline;
 * `label` is descriptor documentation for display and SDK projection and
 * never appears in Resource records. Declarations are keyed by Link Type
 * URL, so each pair is declared at most once by construction.
 */
export interface OwnedLinkDeclaration {
  readonly label?: string;
  readonly max: number;
}

export interface BeadTypeDescriptor extends TypeDescriptorMembers {
  readonly describes: "bead";
  readonly source?: never;
  readonly target?: never;
  readonly ownsOutgoing?: Readonly<Record<string, OwnedLinkDeclaration>>;
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
  assertCanonicalPathSegments,
  resolveCanonicalLocalResourceId,
} from "./read-values.js";

export { isJsonSchemaUri } from "./schema-formats.js";

/**
 * A Reference is how anything in BDP points at anything: a URI — or a
 * Pinned Reference, the URI plus the revision it was made against. The URI
 * is always the complete identity (in-Scope or external is derived by
 * resolution against the canonical Scope URL, never declared); the pin is
 * recorded provenance, stored and echoed byte-identically and compared
 * only for equality. Equality, incidence, multiplicity, and liveness use
 * the URI alone.
 */
export interface PinnedReference {
  readonly uri: AbsoluteUri;
  readonly revision: string;
}

export type Reference = AbsoluteUri | PinnedReference;

/**
 * The canonical-uri collection order comparator: ascending lexicographic
 * comparison, by Unicode code unit, of absolute canonical ids. The single
 * definition every layer sorts with.
 */
export function compareCanonicalIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The identity of a Reference: its URI without any pin. */
export function referenceUri(reference: Reference): AbsoluteUri {
  return typeof reference === "string" ? reference : reference.uri;
}

/** The pin on a Reference, when one is present. */
export function referenceRevision(reference: Reference): string | undefined {
  return typeof reference === "string" ? undefined : reference.revision;
}

export interface PropertiesRecord {
  readonly [key: string]: unknown;
}

/** The realization's basis for a carried attribution value — never a BDP guarantee. */
export const ATTRIBUTION_STATUSES = Object.freeze(["claimed", "unknown"] as const);
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];

/**
 * Carried attribution: data, not evidence. Transported per version beside
 * `revision`, outside `properties`; attested by nothing. A generic client
 * never treats it as an authority claim. v0 has exactly two statuses —
 * `claimed` (supplied by that version's writer) and `unknown` (carried from
 * data whose relationship to this version the realization cannot
 * establish); no status asserts authentication.
 */
export interface Attribution {
  readonly principal: string;
  readonly status: AttributionStatus;
}

export interface BeadRecord {
  readonly id: AbsoluteHttpUrl;
  readonly type: AbsoluteHttpUrl;
  readonly revision: string;
  readonly attribution?: Attribution;
  readonly properties: PropertiesRecord;
  /**
   * The owned-Links plane: for each Link Type the Bead's declared Type
   * owns, the owned Links' complete records in ascending code-unit order
   * of their canonical ids. Keyed by Link Type URL — never by label.
   * Covered by `revision`, properties included; always served on the
   * record read; absent when the Type owns nothing.
   */
  readonly ownedLinks?: Readonly<Record<string, readonly LinkRecord[]>>;
  readonly links?: LinkCollection;
}

export interface LinkRecord {
  readonly id: AbsoluteHttpUrl;
  readonly type: AbsoluteHttpUrl;
  readonly revision: string;
  readonly attribution?: Attribution;
  readonly source: Reference;
  readonly target: Reference;
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
  | "resource-pruned"
  | "resource-erased"
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
  // Authorization-gated disclosure (issue #9): served only to callers
  // authorized for the subject's retained history; everyone else keeps the
  // uniform resource-not-found. resource-pruned MAY carry an archivedAt
  // Reference; resource-erased never carries anything beyond its code.
  "resource-pruned": { family: "gone", status: 410, retry: "never" },
  "resource-erased": { family: "gone", status: 410, retry: "never" },
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
