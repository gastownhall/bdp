/** Private retained Bead CRUD fixture. No public profile admission. */
import {
  HISTORICAL_UPDATE_CAPABILITY,
  HISTORICAL_UPDATE_MEDIA,
  admitJsonNumbers,
  assertCanonicalPathSegments,
  decodeJsonDocument,
  JsonNumberLiteral,
  isJsonSchemaUri,
  parseCanonicalScope,
  parseCanonicalHttpUrl,
  parseRevisionProvenanceInput,
  snapshotJsonValue,
  stringifyJsonValue,
  type AdmittedJsonValue,
  type LosslessJsonValue,
  type RevisionProvenanceInput,
} from "@bdp/protocol";
import { encodeSemanticValue, type SemanticValue } from "../semantic-identity.js";
import { assertObjectChange, type ObjectChange } from "./object-edits.js";
import { captureReferenceComparison, type SemanticReferenceSlots } from "./reference-comparison.js";

export const RETAINED_SPEC = "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json";
export const RETAINED_MEDIA = "application/vnd.bdp.v0.1+json";
export const ORDINARY_OPERATIONS = [
  "createBead",
  "updateBead",
  "deleteBead",
  "createLink",
  "updateLink",
  "deleteLink",
  "putAlias",
  "deleteAlias",
] as const;
export type OrdinaryOperation = (typeof ORDINARY_OPERATIONS)[number];
export type JsonObject = Readonly<Record<string, AdmittedJsonValue>>;
export type TypeReference = string | { readonly uri: string; readonly revision: string };
export interface RetainedBead {
  readonly id: string;
  readonly type: TypeReference;
  readonly revision: string;
  readonly properties: JsonObject;
  readonly metadata: JsonObject;
  readonly revisionProvenance?: AdmittedJsonValue;
}
export type ResourceKind = "bead" | "link";
export type EndpointReference = string | { readonly uri: string; readonly revision: string };
export interface RetainedLink extends RetainedBead {
  readonly source: EndpointReference;
  readonly target: EndpointReference;
}
export type ResourceState =
  | { readonly kind: "bead"; readonly resource: RetainedBead }
  | { readonly kind: "link"; readonly resource: RetainedLink };
export function referenceUri(reference: EndpointReference): string {
  return typeof reference === "string" ? reference : reference.uri;
}
export function deletedIdentity(state: ResourceState) {
  return {
    resourceKind: state.kind,
    resource: {
      id: state.resource.id,
      type: state.resource.type,
      revision: state.resource.revision,
    },
  };
}
export function eventDeleted(state: ResourceState) {
  return {
    ...deletedIdentity(state),
    ...(state.kind === "link"
      ? {
          source: state.resource.source,
          target: state.resource.target,
        }
      : {}),
  };
}
/** Explicit implementation gap, never a BDP Problem/profile/capability. */
export class RetainedFixtureGap extends Error {}
export interface DeletedBead {
  readonly resourceKind: "bead";
  readonly resource: Pick<RetainedBead, "id" | "type" | "revision">;
}
export function deletedBead(resource: RetainedBead): DeletedBead {
  return {
    resourceKind: "bead",
    resource: {
      id: resource.id,
      type: resource.type,
      revision: resource.revision,
    },
  };
}
/** Core's fixed navigation (core.md#fixed-navigation), plus the one advertised member
 * that is still a URL: the `aliases` base. Everything else derives from the Scope. */
export interface PrivateNavigation {
  readonly scope: string;
  readonly description: string;
  readonly beads: string;
  readonly links: string;
  readonly aliases: string;
  readonly events: string;
  readonly targets: Readonly<Record<(typeof ORDINARY_OPERATIONS)[number], string>>;
}
/** The fixed routes of a canonical Scope URL: `bdp/NAME` nouns, `bdp/operations/NAME`. */
export function fixedNavigation(scope: string, aliases = scope + "aliases/"): PrivateNavigation {
  const control = scope + "bdp";
  return Object.freeze({
    scope,
    description: control,
    beads: control + "/beads",
    links: control + "/links",
    aliases,
    events: control + "/events",
    targets: Object.freeze(
      Object.fromEntries(
        ORDINARY_OPERATIONS.map((operation) => [operation, control + "/operations/" + operation]),
      ) as Record<(typeof ORDINARY_OPERATIONS)[number], string>,
    ),
  });
}
export function navigationAddresses(navigation: PrivateNavigation): readonly string[] {
  const addresses = [
    navigation.scope,
    navigation.description,
    navigation.beads,
    navigation.links,
    navigation.aliases,
    navigation.events,
    navigation.scope + "bdp/operations",
    ...Object.values(navigation.targets),
  ];
  // A query-based navigation route must not also become an alias/Resource path.
  const routeBases = addresses.map((address) => {
    const url = new URL(address);
    url.search = "";
    url.hash = "";
    return url.href;
  });
  return Object.freeze([...new Set([...addresses, ...routeBases])]);
}
export class RetainedRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retry = "never",
  ) {
    super(code);
  }
}
export function problem(code: string, status: number, retry = "never"): JsonObject {
  const family = code.startsWith("idempotency-")
    ? code === "idempotency-expired"
      ? "gone"
      : "conflict"
    : code === "identity-taken" ||
        code === "revision-mismatch" ||
        code === "incident-links-exist" ||
        code === "alias-path-taken"
      ? "conflict"
      : code === "resource-not-found" ||
          code === "revision-unknown" ||
          code === "callable-not-found"
        ? "not-found"
        : code === "unauthenticated"
          ? "authentication"
          : code === "validation-failed"
            ? "validation"
            : code === "temporarily-unavailable" || code === "callable-unavailable"
              ? "unavailable"
              : code === "foreign-view" || code === "callable-error"
                ? "conflict"
                : code === "cursor-expired"
                  ? "gone"
                  : status === 413
                    ? "size"
                    : "request";
  return { type: `https://github.com/gastownhall/bdp/problems/${family}`, code, status, retry };
}
export function record(value: unknown): Record<string, LosslessJsonValue> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof JsonNumberLiteral
  )
    throw new RetainedRequestError("malformed-request", 400);
  return value as Record<string, LosslessJsonValue>;
}
export function closed(value: Record<string, LosslessJsonValue>, names: readonly string[]): void {
  if (Object.keys(value).some((name) => !names.includes(name)))
    throw new RetainedRequestError("malformed-request", 400);
}
export function nonempty(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length)
    throw new RetainedRequestError("malformed-request", 400);
}
function httpUri(value: unknown): asserts value is string {
  nonempty(value);
  try {
    if (!/^https?:\/\//.test(value) || !isJsonSchemaUri(value)) throw new Error("invalid HTTP URI");
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error("not an HTTP identity");
  } catch {
    throw new RetainedRequestError("malformed-request", 400);
  }
}
export function typeReference(value: LosslessJsonValue | undefined): void {
  if (typeof value === "string") httpUri(value);
  else {
    const type = record(value);
    closed(type, ["uri", "revision"]);
    httpUri(type.uri);
    nonempty(type.revision);
  }
}
export function provenanceInput(value: LosslessJsonValue): void {
  const provenance = record(value);
  closed(provenance, ["actor", "agent", "message", "metadata"]);
  if (provenance.metadata !== undefined) record(provenance.metadata);
  for (const name of ["agent", "message"]) {
    const member = provenance[name];
    if (
      member !== undefined &&
      member !== null &&
      (typeof member !== "string" || (name === "agent" && !member.length))
    )
      throw new RetainedRequestError("malformed-request", 400);
  }
  if (provenance.actor !== undefined) {
    const actor = record(provenance.actor);
    closed(actor, ["id", "basis"]);
    nonempty(actor.id);
    if (actor.basis !== "writer-supplied" && actor.basis !== "unknown")
      throw new RetainedRequestError("malformed-request", 400);
  }
}
export function numericDiagnostic(pointer: string) {
  const metadata = pointer.startsWith("/metadata");
  const document = metadata ? "metadata" : "properties";
  const prefix = `/${document}`;
  // This native numeric failure has no Types keyword location. Keep its optional
  // document pointer only when one complete entry fits the diagnostic budget.
  const location = pointer.startsWith(`${prefix}/`) ? pointer.slice(prefix.length) : undefined;
  return {
    ...(metadata ? { document: "metadata" as const } : {}),
    ...(location !== undefined && Buffer.byteLength(location) <= 1024
      ? { instanceLocation: location }
      : {}),
    message: `${document}: numeric value is not exactly supported`,
  };
}
export function canonicalSubject(scope: string, supplied: string): string {
  if (/^https?:\/\//i.test(supplied) && !supplied.startsWith(scope)) {
    try {
      return parseCanonicalHttpUrl(supplied);
    } catch {
      throw new RetainedRequestError("malformed-request", 400);
    }
  }
  return canonicalLocalReference(scope, supplied);
}
/** Reference spelling is compared on once-decoded segments; creation IDs keep
 * their separate strict canonical-spelling admission below. No URI fetching. */
export function canonicalLocalReference(scope: string, supplied: string): string {
  let local = supplied;
  if (/^https?:\/\//i.test(supplied)) {
    if (!supplied.startsWith(scope)) throw new RetainedRequestError("malformed-request", 400);
    local = supplied.slice(scope.length);
  }
  try {
    if (/[?#\\\s]/u.test(local)) throw new Error("invalid local Reference spelling");
    const normalized = local
      .split("/")
      .map((segment) => {
        const decoded = decodeURIComponent(segment);
        let encoded = "";
        for (const character of decoded) {
          if (/^[A-Za-z0-9._~!$&'()*+,;=:@-]$/.test(character)) encoded += character;
          else
            for (const byte of new TextEncoder().encode(character))
              encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
        }
        return encoded;
      })
      .join("/");
    return canonicalCreatedId(scope, normalized);
  } catch {
    throw new RetainedRequestError("malformed-request", 400);
  }
}
export function canonicalCreatedId(scope: string, supplied: string): string {
  let local = supplied;
  if (/^https?:\/\//i.test(supplied)) {
    if (!supplied.startsWith(scope)) throw new RetainedRequestError("malformed-request", 400);
    local = supplied.slice(scope.length);
  }
  try {
    assertCanonicalPathSegments(local, "creation identity");
    if (!local || local.includes("?") || local.includes("#") || local.startsWith("@"))
      throw new Error("invalid creation identity");
    const confined = scope + local;
    const resolved = new URL(confined).href;
    if (resolved !== confined) throw new Error("noncanonical identity");
    return resolved;
  } catch {
    throw new RetainedRequestError("malformed-request", 400);
  }
}
/** What a listener serves: Core fixes every protocol route (core.md#fixed-navigation), so
 * only the alias base is the Scope's to choose. Store-level units may still exercise
 * internal bounds with other addresses; the wire never does. */
export function assertFixedNavigation(input: PrivateNavigation): void {
  const fixed = fixedNavigation(parseCanonicalScope(input.scope), input.aliases);
  if (
    input.description !== fixed.description ||
    input.beads !== fixed.beads ||
    input.links !== fixed.links ||
    input.events !== fixed.events ||
    ORDINARY_OPERATIONS.some((name) => input.targets[name] !== fixed.targets[name])
  )
    throw new TypeError("protocol navigation is fixed under the Scope's bdp/ routes");
}
export function captureNavigation(input: PrivateNavigation): PrivateNavigation {
  const scope = parseCanonicalScope(input.scope);
  if (
    Object.keys(input).some(
      (name) =>
        !["scope", "description", "beads", "links", "aliases", "events", "targets"].includes(name),
    ) ||
    Object.keys(input.targets).length !== ORDINARY_OPERATIONS.length
  )
    throw new TypeError("closed fixture navigation required");
  const navigationUrls = [
    input.description,
    input.beads,
    input.links,
    input.events,
    ...ORDINARY_OPERATIONS.map((name) => input.targets[name]),
  ];
  for (const url of [...navigationUrls, input.aliases]) {
    httpUri(url);
    const parsed = new URL(url);
    if (parsed.hash || parsed.href !== url)
      throw new TypeError("fixture navigation must be canonical");
  }
  // aliases is a namespace base, and the selected contract permits Scope itself.
  // Every independently interpreted navigation/operation address stays distinct.
  const urls = [scope, ...navigationUrls, ...(input.aliases === scope ? [] : [input.aliases])];
  if (new Set(urls).size !== urls.length) throw new TypeError("ambiguous fixture navigation");
  const routes = urls.map((url) => {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname + parsed.search;
  });
  if (new Set(routes).size !== routes.length)
    throw new TypeError("ambiguous fixture transport routes");
  return Object.freeze({
    scope,
    description: input.description,
    beads: input.beads,
    links: input.links,
    aliases: input.aliases,
    events: input.events,
    targets: Object.freeze(
      Object.fromEntries(ORDINARY_OPERATIONS.map((name) => [name, input.targets[name]])),
    ) as PrivateNavigation["targets"],
  });
}
export interface PreparedCreate {
  readonly scope: string;
  readonly key: string;
  readonly identity: string;
  readonly id?: string;
  readonly type: TypeReference;
  readonly properties: JsonObject;
  readonly metadata: JsonObject;
  readonly provenance?: RevisionProvenanceInput;
  readonly refusal?: JsonObject;
}
const preparedInvocations = new WeakSet<PreparedCreate>();
function prepared(value: PreparedCreate): PreparedCreate {
  const captured = Object.freeze(value);
  preparedInvocations.add(captured);
  captureReferenceComparison(captured, {}, () => captured.identity);
  return captured;
}
export function assertPreparedCreate(scope: string, value: PreparedCreate): void {
  if (!preparedInvocations.has(value) || value.scope !== scope)
    throw new TypeError("foreign or forged prepared invocation");
}
export function prepareCreate(scope: string, text: string, key: string): PreparedCreate {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw new RetainedRequestError("malformed-request", 400);
  let input: Record<string, LosslessJsonValue>;
  try {
    input = record(decodeJsonDocument(text));
    closed(input, ["id", "type", "properties", "metadata", "revisionProvenance"]);
    if (input.id !== undefined) nonempty(input.id);
    typeReference(input.type);
    if (input.properties !== undefined) record(input.properties);
    if (input.metadata !== undefined) record(input.metadata);
    if (input.revisionProvenance !== undefined) provenanceInput(input.revisionProvenance);
  } catch (error) {
    if (error instanceof RetainedRequestError) throw error;
    throw new RetainedRequestError("malformed-request", 400);
  }
  const id = input.id === undefined ? undefined : canonicalCreatedId(scope, input.id as string);
  const normalized = {
    ...input,
    ...(id === undefined ? {} : { id }),
    properties: input.properties ?? {},
    metadata: input.metadata ?? {},
  };
  const identity = encodeSemanticValue({
    format: "retained-v01-create-1",
    specification: RETAINED_SPEC,
    media: RETAINED_MEDIA,
    capabilities: {},
    operation: "createBead",
    input: normalized as SemanticValue,
  });
  const admitted = admitJsonNumbers(normalized, {
    diagnostics: 8,
    diagnosticBytes: 4096,
    diagnostic: ({ pointer }) => numericDiagnostic(pointer),
  });
  if (!admitted.ok) {
    return prepared({
      scope,
      key,
      identity,
      ...(id === undefined ? {} : { id }),
      type: snapshotJsonValue(input.type) as TypeReference,
      properties: {},
      metadata: {},
      refusal: snapshotJsonValue({
        ...problem("validation-failed", 422),
        diagnostics: admitted.diagnostics,
        ...(admitted.diagnosticsTruncated ? { diagnosticsTruncated: true } : {}),
      }) as JsonObject,
    });
  }
  const value = snapshotJsonValue(admitted.value) as JsonObject;
  let provenance: RevisionProvenanceInput | undefined;
  if (value.revisionProvenance !== undefined) {
    try {
      provenance = parseRevisionProvenanceInput(value.revisionProvenance);
    } catch {
      throw new RetainedRequestError("malformed-request", 400);
    }
  }
  return prepared({
    scope,
    key,
    identity,
    ...(id === undefined ? {} : { id }),
    type: value.type as TypeReference,
    properties: value.properties as JsonObject,
    metadata: value.metadata as JsonObject,
    ...(provenance === undefined ? {} : { provenance }),
  });
}
/** The recorded envelope of one version; omitted input and {} record none. */
export function recordedProvenance(
  provenance: RevisionProvenanceInput | undefined,
  time: string,
): JsonObject | undefined {
  if (!provenance || !Object.keys(provenance).length) return undefined;
  const context = (value: string | null | undefined): AdmittedJsonValue =>
    value === undefined
      ? { state: "undetermined" }
      : value === null
        ? { state: "absent" }
        : { state: "present", value };
  return {
    ...(provenance.actor === undefined ? {} : { actor: { ...provenance.actor } }),
    ...(provenance.agent === undefined && provenance.message === undefined
      ? {}
      : {
          committedAt: { state: "present", value: time },
          agent: context(provenance.agent),
          message: context(provenance.message),
        }),
    ...(provenance.metadata === undefined ? {} : { metadata: provenance.metadata }),
  } as JsonObject;
}
export function materializeBead(
  input: Pick<PreparedCreate, "type" | "properties" | "metadata" | "provenance">,
  id: string,
  revision: string,
  time: string,
): RetainedBead {
  const revisionProvenance = recordedProvenance(input.provenance, time);
  return {
    id,
    type: input.type,
    revision,
    properties: input.properties,
    metadata: input.metadata,
    ...(revisionProvenance === undefined ? {} : { revisionProvenance }),
  };
}
/** Write's pinned-endpoint rule: deleting `bead` refuses on a live Link with an unpinned
 * endpoint on it, or whose pin would leave it no live in-Scope Bead endpoint. */
export function blocksBeadDeletion(
  link: { readonly source: EndpointReference; readonly target: EndpointReference },
  bead: string,
  scope: string,
  liveBead: (uri: string) => boolean,
): boolean {
  const endpoints = [link.source, link.target];
  const incident = endpoints.filter((reference) => referenceUri(reference) === bead);
  if (!incident.length) return false;
  if (incident.some((reference) => typeof reference === "string")) return true;
  return !endpoints.some((reference) => {
    const uri = referenceUri(reference);
    return uri !== bead && uri.startsWith(scope) && liveBead(uri);
  });
}
/** Core's native policy for a committed live Link: every unpinned in-Scope endpoint is a
 * live Bead, and at least one in-Scope endpoint is. */
export function linkEndpointsStand(
  link: { readonly source: EndpointReference; readonly target: EndpointReference },
  scope: string,
  liveBead: (uri: string) => boolean,
): boolean {
  let live = false;
  for (const reference of [link.source, link.target]) {
    const uri = referenceUri(reference);
    if (!uri.startsWith(scope)) continue;
    if (liveBead(uri)) live = true;
    else if (typeof reference === "string") return false;
  }
  return live;
}
export function serialized(value: unknown): string {
  return stringifyJsonValue(value);
}

export interface PreparedUpdate {
  readonly scope: string;
  readonly key: string;
  readonly identity: string;
  readonly bead: string;
  readonly type?: TypeReference;
  readonly properties?: JsonObject;
  readonly metadata?: JsonObject;
  readonly propertiesChange?: ObjectChange;
  readonly metadataChange?: ObjectChange;
  readonly expectedRevision?: string;
  readonly fromRevision?: string;
  readonly provenance?: RevisionProvenanceInput;
  readonly refusal?: JsonObject;
}
const preparedUpdates = new WeakSet<PreparedUpdate>();
export function assertPreparedUpdate(scope: string, value: PreparedUpdate): void {
  if (!preparedUpdates.has(value) || value.scope !== scope)
    throw new TypeError("foreign or forged prepared invocation");
}
export function prepareUpdate(scope: string, text: string, key: string): PreparedUpdate {
  return prepareSelectedUpdate(scope, text, key, false);
}
export function prepareHistoricalUpdate(scope: string, text: string, key: string): PreparedUpdate {
  return prepareSelectedUpdate(scope, text, key, true);
}
function prepareSelectedUpdate(
  scope: string,
  text: string,
  key: string,
  historical: boolean,
): PreparedUpdate {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw new RetainedRequestError("malformed-request", 400);
  let input: Record<string, LosslessJsonValue>;
  try {
    input = record(decodeJsonDocument(text));
    closed(input, [
      "bead",
      "type",
      "properties",
      "metadata",
      "propertiesChange",
      "metadataChange",
      "expectedRevision",
      "revisionProvenance",
      ...(historical ? ["fromRevision"] : []),
    ]);
    nonempty(input.bead);
    if (historical) nonempty(input.fromRevision);
    if (
      ![
        "type",
        "properties",
        "metadata",
        "propertiesChange",
        "metadataChange",
        ...(historical ? ["fromRevision"] : []),
      ].some((name) => Object.hasOwn(input, name))
    )
      throw new TypeError("update requires mutation input");
    if (input.type !== undefined) typeReference(input.type);
    for (const name of ["properties", "metadata"] as const) {
      const replacement = input[name];
      const change = input[`${name}Change`];
      if (replacement !== undefined && change !== undefined)
        throw new TypeError("exclusive edit modes");
      if (replacement !== undefined) record(replacement);
      if (change !== undefined) assertObjectChange(change);
    }
    if (input.expectedRevision !== undefined) nonempty(input.expectedRevision);
    if (input.revisionProvenance !== undefined) provenanceInput(input.revisionProvenance);
  } catch (error) {
    if (error instanceof RetainedRequestError) throw error;
    throw new RetainedRequestError("malformed-request", 400);
  }
  const bead = canonicalSubject(scope, input.bead as string);
  const normalized = { ...input, bead };
  const identityFor = (references: SemanticReferenceSlots) =>
    encodeSemanticValue({
      format: "retained-v01-update-1",
      specification: RETAINED_SPEC,
      media: historical ? HISTORICAL_UPDATE_MEDIA : RETAINED_MEDIA,
      capabilities: historical ? { [HISTORICAL_UPDATE_CAPABILITY]: "1" } : {},
      operation: "updateBead",
      input: { ...normalized, ...references } as SemanticValue,
    });
  const identity = identityFor({});
  const admitted = admitJsonNumbers(normalized, {
    diagnostics: 8,
    diagnosticBytes: 4096,
    diagnostic: ({ pointer }) => numericDiagnostic(pointer),
  });
  let prepared: PreparedUpdate;
  if (!admitted.ok) {
    prepared = {
      scope,
      key,
      identity,
      bead,
      ...(historical ? { fromRevision: input.fromRevision as string } : {}),
      refusal: snapshotJsonValue({
        ...problem("validation-failed", 422),
        diagnostics: admitted.diagnostics,
        ...(admitted.diagnosticsTruncated ? { diagnosticsTruncated: true } : {}),
      }) as JsonObject,
    };
  } else {
    const value = snapshotJsonValue(admitted.value) as JsonObject;
    prepared = {
      scope,
      key,
      identity,
      bead,
      ...(historical ? { fromRevision: value.fromRevision as string } : {}),
      ...(value.type === undefined ? {} : { type: value.type as TypeReference }),
      ...(value.properties === undefined ? {} : { properties: value.properties as JsonObject }),
      ...(value.metadata === undefined ? {} : { metadata: value.metadata as JsonObject }),
      ...(value.propertiesChange === undefined
        ? {}
        : {
            propertiesChange: value.propertiesChange as unknown as ObjectChange,
          }),
      ...(value.metadataChange === undefined
        ? {}
        : {
            metadataChange: value.metadataChange as unknown as ObjectChange,
          }),
      ...(value.expectedRevision === undefined
        ? {}
        : { expectedRevision: value.expectedRevision as string }),
      ...(value.revisionProvenance === undefined
        ? {}
        : {
            provenance: parseRevisionProvenanceInput(value.revisionProvenance),
          }),
    };
  }
  const captured = Object.freeze(prepared);
  preparedUpdates.add(captured);
  captureReferenceComparison(captured, { bead }, identityFor);
  return captured;
}

export interface PreparedDelete {
  readonly scope: string;
  readonly key: string;
  readonly identity: string;
  readonly bead: string;
  readonly expectedRevision?: string;
  readonly provenance?: RevisionProvenanceInput;
}
const preparedDeletions = new WeakSet<PreparedDelete>();
export function assertPreparedDelete(scope: string, value: PreparedDelete): void {
  if (!preparedDeletions.has(value) || value.scope !== scope)
    throw new TypeError("foreign or forged prepared invocation");
}
export function prepareDelete(scope: string, text: string, key: string): PreparedDelete {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw new RetainedRequestError("malformed-request", 400);
  let input: Record<string, LosslessJsonValue>;
  try {
    input = record(decodeJsonDocument(text));
    closed(input, ["bead", "expectedRevision", "revisionProvenance"]);
    nonempty(input.bead);
    if (input.expectedRevision !== undefined) nonempty(input.expectedRevision);
    if (input.revisionProvenance !== undefined) provenanceInput(input.revisionProvenance);
  } catch (error) {
    if (error instanceof RetainedRequestError) throw error;
    throw new RetainedRequestError("malformed-request", 400);
  }
  const bead = canonicalSubject(scope, input.bead as string);
  const normalized = { ...input, bead };
  const identityFor = (references: SemanticReferenceSlots) =>
    encodeSemanticValue({
      format: "retained-v01-delete-1",
      specification: RETAINED_SPEC,
      media: RETAINED_MEDIA,
      capabilities: {},
      operation: "deleteBead",
      input: { ...normalized, ...references } as SemanticValue,
    });
  const identity = identityFor({});
  let provenance: RevisionProvenanceInput | undefined;
  if (input.revisionProvenance !== undefined) {
    try {
      provenance = parseRevisionProvenanceInput(snapshotJsonValue(input.revisionProvenance));
    } catch {
      throw new RetainedRequestError("malformed-request", 400);
    }
  }
  const captured = Object.freeze({
    scope,
    key,
    identity,
    bead,
    ...(input.expectedRevision === undefined
      ? {}
      : { expectedRevision: input.expectedRevision as string }),
    ...(provenance === undefined ? {} : { provenance }),
  });
  preparedDeletions.add(captured);
  captureReferenceComparison(captured, { bead }, identityFor);
  return captured;
}
