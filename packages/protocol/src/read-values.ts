import { readFileSync } from "node:fs";

// These ESM deep entries are guarded by exact dependency pins and installed-package smoke tests.
import { Ajv2020, type JSONSchemaType, type ValidateFunction } from "ajv/dist/2020.js";

import { isJsonSchemaUri } from "./schema-formats.js";
import type {
  AbsoluteHttpUrl,
  BeadCollection,
  BeadRecord,
  LinkCollection,
  LinkRecord,
  PropertiesRecord,
  ReadDiscovery,
  ReadProblem,
  TypeDescriptor,
  TypeInventory,
  TypeSummary,
} from "./index.js";

const LITERAL_PATH_CHARACTER = /^[A-Za-z0-9._~!$&'()*+,;=:@-]$/;
const TYPE_VALUE_MAX_DEPTH = 128;
const TYPE_VALUE_MAX_NODES = 100_000;
const TYPE_VALUE_MAX_CONTAINER_ENTRIES = 10_000;
const CANONICAL_SCHEMA_URL = new URL("../schemas/bdp-v0.schema.json", import.meta.url);

interface ProtocolValueValidators {
  readonly summary: ValidateFunction;
  readonly descriptor: ValidateFunction;
  readonly discovery: ValidateFunction;
  readonly problem: ValidateFunction;
  readonly beadRecord: ValidateFunction;
  readonly linkRecord: ValidateFunction;
  readonly beadCollection: ValidateFunction;
  readonly linkCollection: ValidateFunction;
  readonly typesInventory: ValidateFunction;
}

let protocolValueValidators: ProtocolValueValidators | undefined;

export class ProtocolArtifactValidationError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ProtocolArtifactValidationError";
  }
}

/** Parse and close a Type inventory entry at a trusted protocol boundary. */
export function parseTypeSummary(value: unknown, path = "Type summary"): TypeSummary {
  const type = snapshotProtocolRecord(value, path);
  validateFromSchema(getProtocolValueValidators().summary, type, path);
  parseResourceTypeId(type.id, `${path}.id`);
  return type as unknown as TypeSummary;
}

/** Parse the complete closed BDP v0 Type Descriptor shape without dropping members. */
export function parseTypeDescriptor(value: unknown, path = "Type Descriptor"): TypeDescriptor {
  const type = snapshotProtocolRecord(value, path);
  validateFromSchema(getProtocolValueValidators().descriptor, type, path);
  parseResourceTypeId(type.id, `${path}.id`);
  validateResourceTypeIds(type.conformsTo, `${path}.conformsTo`);
  if (type.source !== undefined) validateEndpointConstraint(type.source, `${path}.source`);
  if (type.target !== undefined) validateEndpointConstraint(type.target, `${path}.target`);
  return type as unknown as TypeDescriptor;
}

/** Parse the complete Read discovery envelope using the canonical Read schema. */
export function parseReadDiscovery(value: unknown, path = "Read discovery"): ReadDiscovery {
  const discovery = snapshotProtocolRecord(value, path);
  validateFromSchema(getProtocolValueValidators().discovery, discovery, path);
  parseCanonicalTypeId(discovery.scope, `${path}.scope`);
  parseCanonicalTypeId(discovery.beads, `${path}.beads`);
  parseCanonicalTypeId(discovery.links, `${path}.links`);
  parseCanonicalTypeId(discovery.types, `${path}.types`);
  if (Array.isArray(discovery.maximumEndpointMultiplicity)) {
    for (const [index, policy] of discovery.maximumEndpointMultiplicity.entries())
      parseResourceTypeId(
        policy.linkConformsTo,
        `${path}.maximumEndpointMultiplicity[${index}].linkConformsTo`,
      );
  }
  return discovery as unknown as ReadDiscovery;
}

/** Parse a Problem Details response against the closed BDP problem mapping. */
export function parseReadProblem(value: unknown, path = "Read Problem"): ReadProblem {
  const problem = snapshotProtocolRecord(value, path);
  validateFromSchema(getProtocolValueValidators().problem, problem, path);
  return problem as unknown as ReadProblem;
}

/** Parse and deeply snapshot one Bead record. */
export function parseBeadRecord(value: unknown, path = "Bead record"): BeadRecord {
  const record = snapshotProtocolRecord(value, path);
  validateFromSchema(getProtocolValueValidators().beadRecord, record, path);
  parseCanonicalTypeId(record.id, `${path}.id`);
  parseResourceTypeId(record.type, `${path}.type`);
  const links =
    record.links === undefined ? undefined : parseLinkCollection(record.links, `${path}.links`);
  return Object.freeze({
    ...record,
    ...(links === undefined ? {} : { links }),
  }) as unknown as BeadRecord;
}

/** Parse and deeply snapshot one Link record. */
export function parseLinkRecord(value: unknown, path = "Link record"): LinkRecord {
  const record = snapshotProtocolRecord(value, path);
  validateFromSchema(getProtocolValueValidators().linkRecord, record, path);
  parseCanonicalTypeId(record.id, `${path}.id`);
  parseResourceTypeId(record.type, `${path}.type`);

  return record as unknown as LinkRecord;
}

/** Parse and deeply snapshot a Bead collection page. */
export function parseBeadCollection(value: unknown, path = "Bead collection"): BeadCollection {
  const page = snapshotProtocolRecord(value, path);
  validateFromSchema(getProtocolValueValidators().beadCollection, page, path);
  const items = page.items as readonly unknown[];
  return Object.freeze({
    ...page,
    items: Object.freeze(
      items.map((item, index) => parseBeadRecord(item, `${path}.items[${index}]`)),
    ),
  }) as unknown as BeadCollection;
}

/** Parse and deeply snapshot a Link collection page. */
export function parseLinkCollection(value: unknown, path = "Link collection"): LinkCollection {
  const page = snapshotProtocolRecord(value, path);
  validateFromSchema(getProtocolValueValidators().linkCollection, page, path);
  const items = page.items as readonly unknown[];
  return Object.freeze({
    ...page,
    items: Object.freeze(
      items.map((item, index) => parseLinkRecord(item, `${path}.items[${index}]`)),
    ),
  }) as unknown as LinkCollection;
}

/** Parse and deeply snapshot a Type inventory page. */
export function parseTypeInventory(value: unknown, path = "Type inventory"): TypeInventory {
  const page = snapshotProtocolRecord(value, path);
  validateFromSchema(getProtocolValueValidators().typesInventory, page, path);
  const items = page.items as readonly unknown[];
  return Object.freeze({
    ...page,
    items: Object.freeze(
      items.map((item, index) => parseTypeSummary(item, `${path}.items[${index}]`)),
    ),
  }) as unknown as TypeInventory;
}

/** Validate, bound, and deeply snapshot a Resource properties object. */
export function parsePropertiesRecord(value: unknown, path = "properties"): PropertiesRecord {
  return snapshotProtocolRecord(value, path) as PropertiesRecord;
}

/** Parse a canonical credential-free HTTP(S) navigation URL. */
export function parseCanonicalHttpUrl(value: unknown, path = "HTTP URL"): AbsoluteHttpUrl {
  if (typeof value !== "string" || !URL.canParse(value))
    throw new ProtocolArtifactValidationError(`${path} must be an absolute HTTP(S) URL`);
  const parsed = new URL(value);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    parsed.href !== value
  )
    throw new ProtocolArtifactValidationError(
      `${path} must be a canonical credential-free HTTP(S) URL`,
    );
  validateCompletePercentEscapes(value, path);
  validateCanonicalPercentEscapes(parsed.pathname, path);
  return value as AbsoluteHttpUrl;
}

/** Parse a canonical credential-free Type ID. */
export function parseCanonicalTypeId(value: unknown, path = "Type ID"): AbsoluteHttpUrl {
  return parseCanonicalHttpUrl(value, path);
}

/** Parse the canonical HTTP(S) base URL for one Scope. */
export function parseCanonicalScope(value: unknown, path = "Scope"): AbsoluteHttpUrl {
  const scope = parseCanonicalHttpUrl(value, path);
  const parsed = new URL(scope);
  if (parsed.search !== "" || !parsed.pathname.endsWith("/"))
    throw new ProtocolArtifactValidationError(
      `${path} must be a canonical HTTP(S) URL ending in /`,
    );
  validateCanonicalUrlPath(parsed.pathname, path);
  return scope;
}

/** Resolve a canonical local Resource ID beneath the required fixed root. */
export function resolveCanonicalLocalResourceId(
  scope: AbsoluteHttpUrl,
  resource: "bead" | "link" | "type",
  localId: string,
): AbsoluteHttpUrl {
  parseCanonicalScope(scope);
  if (localId.includes("?") || localId.includes("#"))
    throw new ProtocolArtifactValidationError(
      "local Resource ID must not contain query or fragment",
    );
  const segments = localId.split("/");
  const expectedRoot = resource === "bead" ? "beads" : resource === "link" ? "links" : "types";
  if (segments[0] !== expectedRoot || segments.length < 2)
    throw new ProtocolArtifactValidationError(
      `local ${resource} ID must begin with ${expectedRoot}/ and contain an ID path`,
    );
  for (const segment of segments.slice(1)) validateCanonicalIdSegment(segment);
  return new URL(localId, scope).href as AbsoluteHttpUrl;
}

function validateEndpointConstraint(value: unknown, path: string): void {
  const constraint = readRecord(value, path);
  validateResourceTypeIds(constraint.conformsTo, `${path}.conformsTo`);
}

function validateResourceTypeIds(value: unknown, path: string): void {
  for (const [index, entry] of (value as readonly unknown[]).entries())
    parseResourceTypeId(entry, `${path}[${index}]`);
}

function parseResourceTypeId(value: unknown, path: string): AbsoluteHttpUrl {
  return parseCanonicalTypeId(value, path);
}

function getProtocolValueValidators(): ProtocolValueValidators {
  if (protocolValueValidators !== undefined) return protocolValueValidators;
  const canonicalSchemaBundle = readCanonicalSchemaBundle();
  const schemaValidator = new Ajv2020({ allErrors: false, strict: true });
  schemaValidator.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
  schemaValidator.addSchema(
    canonicalSchemaBundle as unknown as JSONSchemaType<unknown>,
    canonicalSchemaBundle.$id,
  );
  protocolValueValidators = Object.freeze({
    summary: requireSchemaValidator(
      schemaValidator,
      canonicalSchemaBundle.$id,
      "#/$defs/typeSummary",
    ),
    descriptor: requireSchemaValidator(
      schemaValidator,
      canonicalSchemaBundle.$id,
      "#/$defs/typeDescriptor",
    ),
    discovery: requireSchemaValidator(
      schemaValidator,
      canonicalSchemaBundle.$id,
      "#/$defs/readDiscovery",
    ),
    problem: requireSchemaValidator(
      schemaValidator,
      canonicalSchemaBundle.$id,
      "#/$defs/readProblem",
    ),
    beadRecord: requireSchemaValidator(
      schemaValidator,
      canonicalSchemaBundle.$id,
      "#/$defs/beadRecord",
    ),
    linkRecord: requireSchemaValidator(
      schemaValidator,
      canonicalSchemaBundle.$id,
      "#/$defs/linkRecord",
    ),
    beadCollection: requireSchemaValidator(
      schemaValidator,
      canonicalSchemaBundle.$id,
      "#/$defs/beadCollection",
    ),
    linkCollection: requireSchemaValidator(
      schemaValidator,
      canonicalSchemaBundle.$id,
      "#/$defs/linkCollection",
    ),
    typesInventory: requireSchemaValidator(
      schemaValidator,
      canonicalSchemaBundle.$id,
      "#/$defs/typesInventory",
    ),
  });
  return protocolValueValidators;
}

function readCanonicalSchemaBundle(): Readonly<Record<string, unknown>> & { readonly $id: string } {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(CANONICAL_SCHEMA_URL, "utf8"));
  } catch (cause) {
    throw new Error("failed to read the packaged canonical protocol schema", { cause });
  }
  const schema = readRecord(value, "canonical protocol schema");
  if (typeof schema.$id !== "string") throw new Error("canonical protocol schema is missing $id");
  return schema as Readonly<Record<string, unknown>> & { readonly $id: string };
}

function requireSchemaValidator(
  schemaValidator: Ajv2020,
  schemaId: string,
  schemaRef: string,
): ValidateFunction {
  const validator = schemaValidator.getSchema(`${schemaId}${schemaRef}`);
  if (validator === undefined) throw new Error(`protocol schema is missing ${schemaRef}`);
  return validator;
}

function validateFromSchema(validator: ValidateFunction, value: unknown, path: string): void {
  if (validator(value)) return;
  const failure = validator.errors?.[0];
  const location = failure?.instancePath === undefined ? path : `${path}${failure.instancePath}`;
  throw new ProtocolArtifactValidationError(
    `${location} ${failure?.message ?? "does not match the normative BDP schema"}`,
  );
}

function validateCanonicalIdSegment(segment: string): void {
  if (segment.length === 0)
    throw new ProtocolArtifactValidationError("local Resource ID segments must be nonempty");
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new ProtocolArtifactValidationError(
      "local Resource ID segments must contain valid UTF-8 percent escapes",
    );
  }
  if (
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    containsAsciiControl(decoded)
  )
    throw new ProtocolArtifactValidationError("local Resource ID contains a forbidden segment");
  if (canonicalPathSegment(decoded) !== segment)
    throw new ProtocolArtifactValidationError("local Resource ID is not canonically encoded");
}

function validateCanonicalUrlPath(pathname: string, path: string): void {
  const segments = pathname.split("/");
  for (const [index, segment] of segments.entries()) {
    if ((index === 0 || index === segments.length - 1) && segment.length === 0) continue;
    try {
      validateCanonicalIdSegment(segment);
    } catch (cause) {
      throw new ProtocolArtifactValidationError(`${path} has a noncanonical path`, { cause });
    }
  }
}

function validateCompletePercentEscapes(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "%") continue;
    const hex = value.slice(index + 1, index + 3);
    if (!/^[0-9A-Fa-f]{2}$/.test(hex))
      throw new ProtocolArtifactValidationError(`${path} must use complete percent escapes`);
    index += 2;
  }
}

function validateCanonicalPercentEscapes(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "%") continue;
    const hex = value.slice(index + 1, index + 3);
    if (!/^[0-9A-F]{2}$/.test(hex))
      throw new ProtocolArtifactValidationError(
        `${path} must use uppercase complete percent escapes`,
      );
    const decoded = String.fromCharCode(Number.parseInt(hex, 16));
    if (/^[A-Za-z0-9._~-]$/.test(decoded))
      throw new ProtocolArtifactValidationError(
        `${path} must not percent-encode an unreserved character`,
      );
    index += 2;
  }
}

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

function canonicalPathSegment(value: string): string {
  let encoded = "";
  for (const character of value) {
    if (LITERAL_PATH_CHARACTER.test(character)) {
      encoded += character;
      continue;
    }
    for (const byte of new TextEncoder().encode(character))
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ProtocolArtifactValidationError(`${path} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new ProtocolArtifactValidationError(`${path} must be a plain object`);
  return value as Record<string, unknown>;
}

function snapshotProtocolRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  let nodes = 0;
  const active = new WeakSet<object>();

  const snapshot = (entry: unknown, entryPath: string, depth: number): unknown => {
    nodes += 1;
    if (nodes > TYPE_VALUE_MAX_NODES)
      throw new ProtocolArtifactValidationError(
        `${path} must not exceed ${TYPE_VALUE_MAX_NODES} values`,
      );
    if (depth > TYPE_VALUE_MAX_DEPTH)
      throw new ProtocolArtifactValidationError(
        `${path} must not exceed depth ${TYPE_VALUE_MAX_DEPTH}`,
      );
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return entry;
    if (typeof entry === "number") {
      if (Number.isFinite(entry)) return entry;
      throw new ProtocolArtifactValidationError(`${entryPath} must contain a finite JSON number`);
    }
    if (typeof entry !== "object")
      throw new ProtocolArtifactValidationError(`${entryPath} must contain only JSON values`);
    if (active.has(entry))
      throw new ProtocolArtifactValidationError(`${entryPath} must not contain a cycle`);
    active.add(entry);
    try {
      if (Array.isArray(entry)) {
        const length = entry.length;
        if (length > TYPE_VALUE_MAX_CONTAINER_ENTRIES)
          throw new ProtocolArtifactValidationError(
            `${entryPath} must not exceed ${TYPE_VALUE_MAX_CONTAINER_ENTRIES} entries`,
          );
        return Object.freeze(
          Array.from({ length }, (_, index) =>
            snapshot(entry[index], `${entryPath}[${index}]`, depth + 1),
          ),
        );
      }
      const record = readRecord(entry, entryPath);
      const keys = Object.keys(record);
      if (keys.length > TYPE_VALUE_MAX_CONTAINER_ENTRIES)
        throw new ProtocolArtifactValidationError(
          `${entryPath} must not exceed ${TYPE_VALUE_MAX_CONTAINER_ENTRIES} entries`,
        );
      return Object.freeze(
        Object.fromEntries(
          keys.map((key) => [key, snapshot(record[key], `${entryPath}.${key}`, depth + 1)]),
        ),
      );
    } finally {
      active.delete(entry);
    }
  };

  return readRecord(snapshot(value, path, 0), path);
}
