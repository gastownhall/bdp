import {
  type AbsoluteHttpUrl,
  endpointUri,
  type BeadCollectionRequest as BeadCollectionOperation,
  type BeadLinksRequest as BeadLinksOperation,
  type BeadPropertiesRequest as BeadPropertiesOperation,
  type BeadRecord,
  type BeadResourceRequest as BeadResourceOperation,
  createTypeConformanceIndex,
  type Endpoint,
  isJsonSchemaUri,
  type LinkCollectionRequest as LinkCollectionOperation,
  type LinkPropertiesRequest as LinkPropertiesOperation,
  type LinkRecord,
  type LinkResourceRequest as LinkResourceOperation,
  type PropertiesRecord,
  ProtocolArtifactValidationError,
  parseCanonicalHttpUrl,
  parseCanonicalTypeId,
  parsePropertiesRecord,
  parseTypeDescriptor,
  parseTypeSummary,
  REFERENCE_TYPE_DESCRIPTORS,
  REFERENCE_TYPE_SUMMARIES,
  type ReadProblem,
  type ReadRequest,
  type ReadResultFor,
  readProblem,
  resolveCanonicalLocalResourceId,
  type TypeDescriptor,
  type TypeInventoryRequest as TypeInventoryOperation,
  type TypeResourceRequest as TypeResourceOperation,
  type TypeSummary,
} from "@bdp/protocol";
import {
  type ScopePort,
  type ScopePortResultFor,
  type ScopeReadOperation,
  scopePortProblem,
  scopePortSuccess,
} from "@bdp/server";

/** Identifies the deterministic adapter package. */
export const packageName = "@bdp/adapter-in-memory";

export interface InMemoryScope {
  readonly scope: AbsoluteHttpUrl;
  readonly port: ScopePort;
}

/** Gate 0 prototype: records a deterministic handler behind the real port shape. */
export function createInMemoryScope(scope: AbsoluteHttpUrl, port: ScopePort): InMemoryScope {
  return { scope, port };
}

export type InMemoryReadHandler = <Operation extends ScopeReadOperation>(
  operation: Operation,
  options: { readonly signal: AbortSignal },
) => Promise<ScopePortResultFor<Operation>>;

export function createInMemoryScopePort(handler: InMemoryReadHandler): ScopePort {
  return { perform: handler };
}

interface PreparedReferenceFixture {
  readonly beads: readonly BeadRecord[];
  readonly links: readonly LinkRecord[];
  readonly types: readonly TypeSummary[];
  readonly typeDescriptors: readonly TypeDescriptor[];
}

let builtInTypeArtifacts:
  | {
      readonly types: readonly TypeSummary[];
      readonly typeDescriptors: readonly TypeDescriptor[];
    }
  | undefined;

/**
 * Deterministic built-in reference-domain fixture used by bdptest's local-test mode.
 */
export function createReferenceFixturePort(scope: AbsoluteHttpUrl): ScopePort {
  return createPreparedReferenceFixturePort(createBuiltInReferenceFixture(scope));
}

/** Constructs a target from the exact portable fixture bound into a conformance run. */
export function createPortableReferenceFixturePort(
  scope: AbsoluteHttpUrl,
  fixture: unknown,
): ScopePort {
  return createPreparedReferenceFixturePort(prepareReferenceFixture(scope, fixture));
}

function createPreparedReferenceFixturePort(prepared: PreparedReferenceFixture): ScopePort {
  const { beads, links, types, typeDescriptors } = snapshotPreparedReferenceFixture(prepared);
  const typeConformance = createTypeConformanceIndex(typeDescriptors);
  function perform<Operation extends ScopeReadOperation>(
    operation: Operation,
    options: { readonly signal: AbortSignal },
  ): Promise<ScopePortResultFor<Operation>>;
  async function perform(
    operation: ScopeReadOperation,
    _options: { readonly signal: AbortSignal },
  ): Promise<ScopePortResultFor<ScopeReadOperation>> {
    switch (operation.kind) {
      case "collection": {
        if (operation.collection === "beads") {
          return scopePortSuccess<BeadCollectionOperation>(
            Object.freeze({
              items: Object.freeze(
                beads.filter(
                  (bead) =>
                    (operation.type === undefined || bead.type === operation.type) &&
                    (operation.conformsTo === undefined ||
                      typeConformance.includes(bead.type, operation.conformsTo)),
                ),
              ),
              next: null,
            }),
          );
        }
        if (operation.collection === "links") {
          return scopePortSuccess<LinkCollectionOperation>(
            Object.freeze({
              items: Object.freeze(
                links.filter(
                  (link) =>
                    (operation.type === undefined || link.type === operation.type) &&
                    (operation.conformsTo === undefined ||
                      typeConformance.includes(link.type, operation.conformsTo)) &&
                    (operation.source === undefined ||
                      endpointUri(link.source) === operation.source) &&
                    (operation.target === undefined ||
                      endpointUri(link.target) === operation.target) &&
                    (operation.endpoint === undefined ||
                      endpointUri(link.source) === operation.endpoint ||
                      endpointUri(link.target) === operation.endpoint),
                ),
              ),
              next: null,
            }),
          );
        }
        return scopePortSuccess<TypeInventoryOperation>(
          Object.freeze({ items: types, next: null }),
        );
      }
      case "resource": {
        if (operation.resource === "bead") {
          const item = beads.find((bead) => bead.id === operation.id);
          return item === undefined
            ? scopePortProblem<BeadResourceOperation>(notFound())
            : scopePortSuccess<BeadResourceOperation>(item);
        }
        if (operation.resource === "link") {
          const item = links.find((link) => link.id === operation.id);
          return item === undefined
            ? scopePortProblem<LinkResourceOperation>(notFound())
            : scopePortSuccess<LinkResourceOperation>(item);
        }
        const item = typeDescriptors.find((type) => type.id === operation.id);
        return item === undefined
          ? scopePortProblem<TypeResourceOperation>(notFound())
          : scopePortSuccess<TypeResourceOperation>(item);
      }
      case "properties": {
        if (operation.resource === "bead") {
          const record = beads.find((bead) => bead.id === operation.id);
          return record === undefined
            ? scopePortProblem<BeadPropertiesOperation>(notFound())
            : scopePortSuccess<BeadPropertiesOperation>(record.properties);
        }
        const record = links.find((link) => link.id === operation.id);
        return record === undefined
          ? scopePortProblem<LinkPropertiesOperation>(notFound())
          : scopePortSuccess<LinkPropertiesOperation>(record.properties);
      }
      case "bead-links": {
        if (!beads.some((bead) => bead.id === operation.bead))
          return scopePortProblem<BeadLinksOperation>(notFound());
        const items = Object.freeze(
          links.filter((link) =>
            operation.direction === "inbound"
              ? endpointUri(link.target) === operation.bead
              : operation.direction === "outbound"
                ? endpointUri(link.source) === operation.bead
                : endpointUri(link.source) === operation.bead ||
                  endpointUri(link.target) === operation.bead,
          ),
        );
        return scopePortSuccess<BeadLinksOperation>(Object.freeze({ items, next: null }));
      }
    }
    throw new Error("unsupported operation");
  }
  return createInMemoryScopePort(perform);
}

function freezeEndpoint(endpoint: Endpoint): Endpoint {
  return typeof endpoint === "string" ? endpoint : Object.freeze({ ...endpoint });
}

function snapshotPreparedReferenceFixture(
  prepared: PreparedReferenceFixture,
): PreparedReferenceFixture {
  const beads = Object.freeze(
    prepared.beads.map((bead) =>
      Object.freeze({
        ...bead,
      }),
    ),
  );
  const links = Object.freeze(
    prepared.links.map((link) =>
      Object.freeze({
        ...link,
        source: freezeEndpoint(link.source),
        target: freezeEndpoint(link.target),
      }),
    ),
  );
  const types = Object.freeze([...prepared.types]);
  const typeDescriptors = Object.freeze([...prepared.typeDescriptors]);
  return Object.freeze({ beads, links, types, typeDescriptors });
}

function createBuiltInReferenceFixture(scope: AbsoluteHttpUrl): PreparedReferenceFixture {
  const { types, typeDescriptors } = getBuiltInTypeArtifacts();
  const typeByName = new Map(types.map((type) => [type.name, type.id]));
  const blockingTargetsById = new Map<string, readonly string[]>([
    ["demo-a", ["demo-c"]],
    ["demo-b", ["demo-a"]],
    ["demo-d", ["demo-c"]],
    ["demo-f", ["demo-e"]],
    ["demo-i", ["demo-a", "demo-c"]],
    ["demo-j", ["demo-c", "demo-k"]],
  ]);
  const dependentCountById = new Map([
    ["demo-a", 2],
    ["demo-c", 5],
    ["demo-e", 1],
    ["demo-k", 1],
  ]);
  const beads: BeadRecord[] = [
    ["demo-a", "A", "open", "Task"],
    ["demo-b", "B", "open", "Task"],
    ["demo-c", "C", "closed", "Task"],
    ["demo-d", "D", "open", "Task"],
    ["demo-e", "E", "deferred", "Bug"],
    ["demo-f", "F", "open", "Decision"],
    ["demo-i", "I", "open", "Task"],
    ["demo-j", "J", "open", "Task"],
    ["demo-k", "K", "closed", "Task"],
  ].map(([id, title, status, typeName], index) => {
    const localId = String(id);
    const type = typeByName.get(String(typeName));
    if (type === undefined) throw new Error(`reference domain does not define ${String(typeName)}`);
    const createdAt = `2026-08-08T23:33:3${index + 1}Z`;
    const blockingTargets = blockingTargetsById.get(localId) ?? [];
    return {
      id: new URL(`beads/${localId}`, scope).href,
      type,
      revision: "1",
      properties: parsePropertiesRecord({
        id: localId,
        title,
        status,
        priority: 2,
        issue_type: String(typeName).toLowerCase(),
        created_at: createdAt,
        created_by: "bdp-conformance",
        updated_at: createdAt,
        ...(blockingTargets.length === 0
          ? {}
          : {
              dependencies: blockingTargets.map((blockingTarget) => ({
                issue_id: localId,
                depends_on_id: blockingTarget,
                type: "blocks",
                created_at: createdAt,
                created_by: "bdp-conformance",
                metadata: "{}",
              })),
            }),
        dependency_count: blockingTargets.length,
        dependent_count: dependentCountById.get(localId) ?? 0,
        comment_count: 0,
        ...(localId === "demo-a" ? { extension: "retained" } : {}),
      }),
    };
  });
  const beadById = new Map(beads.map((bead) => [bead.id, bead]));
  // The accepted external-endpoint realization is part of the reference domain:
  // two blocks Links around the Decision Bead, one with an external source and
  // one with an external target. They carry the External Reference sentinel
  // type on the external end and change no bead's readiness or dependency
  // counts: demo-f is already blocked by the local demo-f-e Link. The
  // external-target Link's external end additionally carries the optional
  // endpoint revision citation; external-source's stays bare, so the domain
  // realizes both the echoed-citation and the omitted-member spellings.
  const externalEndpointId = "external:beads:mol-run-assignee";
  const externalEndpointRevision = "  Cited-9F2c — α/β (draft) Å\t";
  const links: LinkRecord[] = [
    ["demo-b-a", "demo-b", "demo-a", "Blocks"],
    ["demo-a-c", "demo-a", "demo-c", "Blocks"],
    ["demo-d-c", "demo-d", "demo-c", "Blocks"],
    ["demo-f-e", "demo-f", "demo-e", "Blocks"],
    ["demo-e-f", "demo-e", "demo-f", "Relates"],
    ["demo-i-a", "demo-i", "demo-a", "Blocks"],
    ["demo-i-c", "demo-i", "demo-c", "Blocks"],
    ["demo-j-c", "demo-j", "demo-c", "Blocks"],
    ["demo-j-k", "demo-j", "demo-k", "Blocks"],
    ["external-target", "demo-f", externalEndpointId, "Blocks"],
    ["external-source", externalEndpointId, "demo-f", "Blocks"],
  ].map(([id, source, target, typeName]) => {
    const localId = String(id);
    const resolveEndpoint = (name: string) => {
      if (name === externalEndpointId)
        return localId === "external-target"
          ? ({ uri: name, revision: externalEndpointRevision } as const)
          : name;
      const beadId = new URL(`beads/${name}`, scope).href;
      if (!beadById.has(beadId))
        throw new Error("reference Link endpoint does not name a reference Bead");
      return beadId;
    };
    const type = typeByName.get(String(typeName));
    if (type === undefined) throw new Error(`reference domain does not define ${String(typeName)}`);
    return {
      id: new URL(`links/${localId}`, scope).href,
      type,
      revision: "1",
      source: resolveEndpoint(String(source)),
      target: resolveEndpoint(String(target)),
      properties: parsePropertiesRecord(
        localId === "demo-b-a"
          ? { constraint: "hard", extension: "retained" }
          : localId === "demo-e-f"
            ? { context: "reference", extension: "retained" }
            : {},
      ),
    };
  });
  return {
    beads,
    links,
    types,
    typeDescriptors,
  };
}

function getBuiltInTypeArtifacts(): NonNullable<typeof builtInTypeArtifacts> {
  if (builtInTypeArtifacts !== undefined) return builtInTypeArtifacts;
  builtInTypeArtifacts = Object.freeze({
    types: Object.freeze(
      REFERENCE_TYPE_SUMMARIES.map((type, index) =>
        parseTypeSummary(type, `built-in.types[${index}]`),
      ),
    ),
    typeDescriptors: Object.freeze(
      REFERENCE_TYPE_DESCRIPTORS.map((descriptor, index) =>
        parseTypeDescriptor(descriptor, `built-in.typeDescriptors[${index}]`),
      ),
    ),
  });
  return builtInTypeArtifacts;
}

function prepareReferenceFixture(scope: AbsoluteHttpUrl, value: unknown): PreparedReferenceFixture {
  const fixture = readRecord(value, "fixture");
  const types = readArray(fixture.types, "fixture.types").map((entry, index) =>
    parseTypeSummary(entry, `fixture.types[${index}]`),
  );
  requireUnique(
    types.map(({ id }) => id),
    "fixture.types",
  );
  const typeDescriptors = readArray(fixture.typeDescriptors, "fixture.typeDescriptors").map(
    (entry, index) => parseTypeDescriptor(entry, `fixture.typeDescriptors[${index}]`),
  );
  requireUnique(
    typeDescriptors.map(({ id }) => id),
    "fixture.typeDescriptors",
  );
  assertTypeDescriptorsMatchInventory(types, typeDescriptors);

  const beadsWithLocalIds = readArray(fixture.beads, "fixture.beads").map((entry, index) => {
    const path = `fixture.beads[${index}]`;
    const bead = readRecord(entry, path);
    requireAllowedKeys(bead, ["localId", "type", "revision", "properties"], path);
    const { localId, id } = readFixtureLocalId(scope, "bead", bead.localId, `${path}.localId`);
    return {
      localId,
      record: {
        id,
        type: parseCanonicalTypeId(bead.type, `${path}.type`),
        revision: readNonemptyString(bead.revision, `${path}.revision`),
        properties: readProperties(bead.properties, `${path}.properties`),
      } satisfies BeadRecord,
    };
  });
  requireUnique(
    beadsWithLocalIds.map(({ localId }) => localId),
    "fixture.beads localId",
  );
  requireUnique(
    beadsWithLocalIds.map(({ record }) => record.id),
    "fixture.beads resolved id",
  );
  const beadsByLocalId = new Map(beadsWithLocalIds.map(({ localId, record }) => [localId, record]));
  const typeById = new Map(types.map((type) => [type.id, type]));
  for (const { record } of beadsWithLocalIds) {
    if (typeById.get(record.type)?.describes !== "bead")
      throw new Error("fixture bead type must name a declared bead Type");
  }

  const links = readArray(fixture.links, "fixture.links").map((entry, index) => {
    const path = `fixture.links[${index}]`;
    const link = readRecord(entry, path);
    requireAllowedKeys(
      link,
      ["localId", "type", "revision", "source", "target", "properties"],
      path,
    );
    const source = readFixtureEndpoint(scope, link.source, `${path}.source`, beadsByLocalId);
    const target = readFixtureEndpoint(scope, link.target, `${path}.target`, beadsByLocalId);
    if (!source.local && !target.local)
      throw new Error("fixture Link must have at least one local Bead endpoint");
    const type = parseCanonicalTypeId(link.type, `${path}.type`);
    if (typeById.get(type)?.describes !== "link")
      throw new Error("fixture Link type must name a declared link Type");
    const { id } = readFixtureLocalId(scope, "link", link.localId, `${path}.localId`);
    return {
      id,
      type,
      revision: readNonemptyString(link.revision, `${path}.revision`),
      source: source.endpoint,
      target: target.endpoint,
      properties: readProperties(link.properties, `${path}.properties`),
    } satisfies LinkRecord;
  });
  requireUnique(
    links.map(({ id }) => id),
    "fixture.links resolved id",
  );

  return {
    beads: beadsWithLocalIds.map(({ record }) => record),
    links,
    types,
    typeDescriptors,
  };
}

function readFixtureEndpoint(
  scope: AbsoluteHttpUrl,
  value: unknown,
  path: string,
  beadsByLocalId: ReadonlyMap<string, BeadRecord>,
): { readonly endpoint: Endpoint; readonly local: boolean } {
  // An external endpoint may be authored as { id, revision } to carry the
  // optional opaque citation; the object form is external-only, matching the
  // wire contract's in-Scope prohibition.
  let citedRevision: string | undefined;
  let endpointValue = value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = readRecord(value, path);
    requireAllowedKeys(record, ["uri", "revision"], path);
    citedRevision = readNonemptyString(record.revision, `${path}.revision`);
    endpointValue = record.uri;
  }
  const id = readNonemptyString(endpointValue, path);
  const localBead = beadsByLocalId.get(id);
  if (localBead !== undefined) {
    if (citedRevision !== undefined)
      throw new Error(`${path} in-Scope endpoint must not carry a revision citation`);
    return { endpoint: localBead.id, local: true };
  }
  if (isJsonSchemaUri(id)) {
    if (endpointAliasesScope(id, scope))
      throw new Error("fixture in-Scope Link endpoint must name a fixture Bead");
    requireSafeCanonicalExternalEndpoint(id, path);
    return {
      endpoint: citedRevision === undefined ? id : { uri: id, revision: citedRevision },
      local: false,
    };
  }
  readFixtureLocalId(scope, "bead", id, path);
  throw new Error("fixture Link endpoint must name a fixture Bead or absolute external URI");
}

const SAFE_EXTERNAL_ENDPOINT_SCHEMES = new Set(["external", "http", "https", "urn"]);

function requireSafeCanonicalExternalEndpoint(id: string, path: string): void {
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(id)?.[1];
  const normalizedScheme = scheme?.toLowerCase();
  if (
    scheme === undefined ||
    scheme !== normalizedScheme ||
    !SAFE_EXTERNAL_ENDPOINT_SCHEMES.has(normalizedScheme)
  )
    throw new Error(`${path} must be a safe canonical absolute URI`);
  if (normalizedScheme === "http" || normalizedScheme === "https") {
    try {
      parseCanonicalHttpUrl(id, path);
    } catch (error) {
      if (error instanceof ProtocolArtifactValidationError)
        throw new Error(`${path} must be a safe canonical absolute URI`, { cause: error });
      throw error;
    }
    return;
  }
  if (URL.canParse(id) && new URL(id).href !== id)
    throw new Error(`${path} must be a safe canonical absolute URI`);
}

function endpointAliasesScope(value: string, scope: AbsoluteHttpUrl): boolean {
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value)?.[1]?.toLowerCase();
  if ((scheme !== "http" && scheme !== "https") || !URL.canParse(value)) return false;
  const candidate = new URL(value);
  const root = new URL(scope);
  if (candidate.origin !== root.origin) return false;
  const candidatePath = normalizeEndpointPath(candidate.pathname);
  const rootPath = normalizeEndpointPath(root.pathname);
  return candidatePath !== undefined && rootPath !== undefined
    ? candidatePath.startsWith(rootPath)
    : candidate.pathname.startsWith(root.pathname);
}

function normalizeEndpointPath(pathname: string): string | undefined {
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

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${path} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`${path} must be a plain object`);
  return value as Record<string, unknown>;
}

function readArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function readNonemptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${path} must be a non-empty string`);
  return value;
}

function readFixtureLocalId(
  scope: AbsoluteHttpUrl,
  resource: "bead" | "link",
  value: unknown,
  path: string,
): { readonly localId: string; readonly id: AbsoluteHttpUrl } {
  const localId = readNonemptyString(value, path);
  try {
    return { localId, id: resolveCanonicalLocalResourceId(scope, resource, localId) };
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError)
      throw new ProtocolArtifactValidationError(`${path}: ${error.message}`, { cause: error });
    throw error;
  }
}

function readProperties(value: unknown, path: string): PropertiesRecord {
  return parsePropertiesRecord(value, path);
}

function requireUnique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${path} entries must be unique`);
}

function assertTypeDescriptorsMatchInventory(
  types: readonly TypeSummary[],
  descriptors: readonly TypeDescriptor[],
): void {
  if (types.length !== descriptors.length)
    throw new Error("fixture Type Descriptors must match the fixture Type inventory");
  const descriptorsById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  for (const type of types) {
    const descriptor = descriptorsById.get(type.id);
    if (
      descriptor === undefined ||
      descriptor.name !== type.name ||
      descriptor.describes !== type.describes
    )
      throw new Error("fixture Type Descriptors must match the fixture Type inventory");
  }
}

function requireAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)))
    throw new Error(`${path} contains an unknown member`);
}

function notFound(): ReadProblem {
  return readProblem("resource-not-found");
}

export type { AbsoluteHttpUrl, ReadRequest, ReadResultFor, ScopePort, ScopeReadOperation };
