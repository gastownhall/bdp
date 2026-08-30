import {
  type AbsoluteHttpUrl,
  referenceUri,
  type BeadCollectionRequest as BeadCollectionOperation,
  type BeadLinksRequest as BeadLinksOperation,
  type BeadPropertiesRequest as BeadPropertiesOperation,
  type BeadRecord,
  type BeadResourceRequest as BeadResourceOperation,
  createTypeConformanceIndex,
  type Reference,
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
  /**
   * Authorization-gated disclosure subjects: addresses whose reads answer
   * with a 410 disclosure instead of the uniform 404, realized under the
   * fixture's declared history-authorized projection.
   */
  readonly disclosures?: ReadonlyMap<string, ReadProblem>;
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

/**
 * The built-in reference domain's alias table: repointable names resolved
 * by the shipping bdptest server with one 307. Kept in lockstep with the
 * portable fixture's `aliases` section.
 */
export function referenceFixtureAliases(
  scope: AbsoluteHttpUrl,
): Readonly<Record<string, AbsoluteHttpUrl>> {
  return Object.freeze({
    decision: new URL("beads/demo-f", scope).href,
    "releases/latest": new URL("beads/demo-a", scope).href,
  });
}

/**
 * Reads and validates the portable fixture's optional `aliases` section:
 * relative alias path -> relative canonical Bead ID, returned as the
 * absolute table the server consumes. Undefined when the fixture declares
 * no aliases.
 */
export function portableReferenceFixtureAliases(
  scope: AbsoluteHttpUrl,
  fixture: unknown,
): Readonly<Record<string, AbsoluteHttpUrl>> | undefined {
  const record = readRecord(fixture, "fixture");
  const aliases = record.aliases;
  if (aliases === undefined) return undefined;
  const entries = readRecord(aliases, "fixture.aliases");
  const table: Record<string, AbsoluteHttpUrl> = {};
  for (const [path, target] of Object.entries(entries)) {
    const id = readNonemptyString(target, `fixture.aliases['${path}']`);
    table[path] = new URL(id, scope).href;
  }
  return Object.freeze(table);
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
  const disclosures = prepared.disclosures;
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
                      referenceUri(link.source) === operation.source) &&
                    (operation.target === undefined ||
                      referenceUri(link.target) === operation.target) &&
                    (operation.endpoint === undefined ||
                      referenceUri(link.source) === operation.endpoint ||
                      referenceUri(link.target) === operation.endpoint),
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
          const disclosed = disclosures?.get(operation.id);
          if (disclosed !== undefined) return scopePortProblem<BeadResourceOperation>(disclosed);
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
              ? referenceUri(link.target) === operation.bead
              : operation.direction === "outbound"
                ? referenceUri(link.source) === operation.bead
                : referenceUri(link.source) === operation.bead ||
                  referenceUri(link.target) === operation.bead,
          ),
        );
        return scopePortSuccess<BeadLinksOperation>(Object.freeze({ items, next: null }));
      }
    }
    throw new Error("unsupported operation");
  }
  return createInMemoryScopePort(perform);
}

function freezeEndpoint(endpoint: Reference): Reference {
  return typeof endpoint === "string" ? endpoint : Object.freeze({ ...endpoint });
}

function snapshotPreparedReferenceFixture(
  prepared: PreparedReferenceFixture,
): PreparedReferenceFixture {
  const links = Object.freeze(
    prepared.links.map((link) =>
      Object.freeze({
        ...link,
        source: freezeEndpoint(link.source),
        target: freezeEndpoint(link.target),
      }),
    ),
  );
  // The owned-references plane: for each Bead whose declared Type owns
  // outgoing Link Types, project the owned links' targets, in link order,
  // one entry per declared owned type (empty when no owned links exist).
  // The declared bound is enforced here so the plane is always servable
  // inline.
  const ownedByBeadType = new Map(
    prepared.typeDescriptors.flatMap((descriptor) =>
      descriptor.describes === "bead" && descriptor.ownsOutgoing !== undefined
        ? [[descriptor.id, descriptor.ownsOutgoing] as const]
        : [],
    ),
  );
  const beads = Object.freeze(
    prepared.beads.map((bead) => {
      const owned = ownedByBeadType.get(bead.type);
      if (owned === undefined) return Object.freeze({ ...bead });
      const references: Record<string, readonly Reference[]> = {};
      for (const [ownedType, declaration] of Object.entries(owned)) {
        const targets = links
          .filter((link) => link.type === ownedType && referenceUri(link.source) === bead.id)
          .map((link) => link.target);
        if (targets.length > declaration.max)
          throw new Error(
            `owned references for ${bead.id} exceed the declared bound of ${ownedType}`,
          );
        references[ownedType] = Object.freeze(targets);
      }
      return Object.freeze({ ...bead, references: Object.freeze(references) });
    }),
  );
  const types = Object.freeze([...prepared.types]);
  const typeDescriptors = Object.freeze([...prepared.typeDescriptors]);
  return Object.freeze({
    beads,
    links,
    types,
    typeDescriptors,
    ...(prepared.disclosures === undefined ? {} : { disclosures: prepared.disclosures }),
  });
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
  // one with an external target. The external end is an opaque URI reference
  // and changes no bead's readiness or dependency
  // counts: demo-f is already blocked by the local demo-f-e Link. The
  // external-target Link's external end additionally carries the optional
  // endpoint pin; external-source's stays bare, so the domain realizes
  // both the echoed-pin and the omitted-member spellings.
  const externalEndpointId = "external:beads:mol-run-assignee";
  const externalEndpointRevision = "  Cited-9F2c — α/β (draft) Å\t";
  const pinWitnessId = "urn:external:pin-witness";
  const citesWitnessId = "urn:external:cites-witness";
  const collationWitnessId = "urn:external:collation-witness";
  const citesWitnessRevision = "w-1";
  const pinnedLocalRevision = "pin-a-r1 (as-written)";
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
    ["pinned-local", pinWitnessId, "demo-f", "Blocks"],
    ["cites-local", "demo-f", "demo-a", "Cites"],
    ["cites-witness", "demo-f", citesWitnessId, "Cites"],
    // The collation witness: an uppercase localId that code-unit ordering
    // places before every lowercase id, distinguishing the canonical-uri
    // baseline from locale-style comparison.
    ["ZZ-collation", collationWitnessId, "demo-f", "Blocks"],
  ].map(([id, source, target, typeName]) => {
    const localId = String(id);
    const resolveEndpoint = (name: string) => {
      if (name === externalEndpointId)
        return localId === "external-target"
          ? ({ uri: name, revision: externalEndpointRevision } as const)
          : name;
      if (name === pinWitnessId) return name;
      if (name === citesWitnessId) return { uri: name, revision: citesWitnessRevision } as const;
      if (name === collationWitnessId) return name;
      const beadId = new URL(`beads/${name}`, scope).href;
      if (!beadById.has(beadId))
        throw new Error("reference Link endpoint does not name a reference Bead");
      // The pinned-local Link's in-Scope target carries a pin: the domain
      // realizes the in-Scope Pinned Reference spelling alongside the
      // external one.
      if (localId === "pinned-local")
        return { uri: beadId, revision: pinnedLocalRevision } as const;
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
  // Disclosure subjects, kept in lockstep with the portable fixture's
  // `disclosures` section: pruned answers with the pinned archive pointer,
  // erased answers with nothing beyond its code.
  const disclosures = new Map<string, ReadProblem>([
    [
      new URL("beads/pruned-relic", scope).href,
      Object.freeze({
        ...readProblem("resource-pruned"),
        archivedAt: Object.freeze({
          uri: "https://archive.example/acme/beads/pruned-relic",
          revision: "arch-r4 (as-written)",
        }) as unknown as Reference,
      }),
    ],
    [new URL("beads/erased-relic", scope).href, readProblem("resource-erased")],
  ]);
  return {
    beads,
    links,
    types,
    typeDescriptors,
    disclosures,
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

  const disclosures = readFixtureDisclosures(scope, fixture.disclosures);
  return {
    beads: beadsWithLocalIds.map(({ record }) => record),
    links,
    types,
    typeDescriptors,
    ...(disclosures === undefined ? {} : { disclosures }),
  };
}

/**
 * Reads the fixture's optional `disclosures` section: addresses whose reads
 * answer with an authorization-gated 410 disclosure. The pruned entry may
 * carry an archivedAt Reference (echoed byte-identically); erased entries
 * carry nothing beyond their code, per the disclosure law.
 */
function readFixtureDisclosures(
  scope: AbsoluteHttpUrl,
  value: unknown,
): ReadonlyMap<string, ReadProblem> | undefined {
  if (value === undefined) return undefined;
  const table = new Map<string, ReadProblem>();
  for (const [index, entry] of readArray(value, "fixture.disclosures").entries()) {
    const path = `fixture.disclosures[${index}]`;
    const record = readRecord(entry, path);
    requireAllowedKeys(record, ["localId", "code", "archivedAt"], path);
    const { id } = readFixtureLocalId(scope, "bead", record.localId, `${path}.localId`);
    const code = readNonemptyString(record.code, `${path}.code`);
    if (code !== "resource-pruned" && code !== "resource-erased")
      throw new Error(`${path}.code must be resource-pruned or resource-erased`);
    if (code === "resource-erased" && record.archivedAt !== undefined)
      throw new Error(`${path} erased disclosures carry nothing beyond their code`);
    const problem = readProblem(code);
    table.set(
      id,
      record.archivedAt === undefined
        ? problem
        : Object.freeze({
            ...problem,
            archivedAt: Object.freeze(
              readRecord(record.archivedAt, `${path}.archivedAt`),
            ) as unknown as Reference,
          }),
    );
  }
  return table;
}

function readFixtureEndpoint(
  scope: AbsoluteHttpUrl,
  value: unknown,
  path: string,
  beadsByLocalId: ReadonlyMap<string, BeadRecord>,
): { readonly endpoint: Reference; readonly local: boolean } {
  // Any endpoint may be authored as { uri, revision } — a Pinned Reference
  // recording the revision the link was made against. The URI alone is the
  // identity; the pin is stored and echoed byte-identically.
  let pinnedRevision: string | undefined;
  let endpointValue = value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = readRecord(value, path);
    requireAllowedKeys(record, ["uri", "revision"], path);
    pinnedRevision = readNonemptyString(record.revision, `${path}.revision`);
    endpointValue = record.uri;
  }
  const id = readNonemptyString(endpointValue, path);
  const localBead = beadsByLocalId.get(id);
  if (localBead !== undefined) {
    return {
      endpoint:
        pinnedRevision === undefined
          ? localBead.id
          : { uri: localBead.id, revision: pinnedRevision },
      local: true,
    };
  }
  if (isJsonSchemaUri(id)) {
    if (endpointAliasesScope(id, scope))
      throw new Error("fixture in-Scope Link endpoint must name a fixture Bead");
    requireSafeCanonicalExternalEndpoint(id, path);
    return {
      endpoint: pinnedRevision === undefined ? id : { uri: id, revision: pinnedRevision },
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
