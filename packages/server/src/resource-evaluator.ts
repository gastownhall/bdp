import {
  type Attribution,
  type BeadRecord,
  type BeadTypeDescriptor,
  type ChangeContext,
  type ChangeContextInput,
  type LinkRecord,
  type MaximumEndpointMultiplicityPolicy,
  type PropertyChange,
  type ReadUpdateInputs,
  type ReadUpdateMutationResult,
  type ReadUpdateProblem,
  type Reference,
  type TypeDescriptor,
  type ValidationDiagnostic,
  assertCanonicalPathSegments,
  compareCanonicalIds,
  createTypeConformanceIndex,
  parseBeadRecord,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseChangeContext,
  parseLinkRecord,
  parseReadUpdateProblem,
  parseTypeDescriptor,
  referenceUri,
  stringifyJsonValue,
} from "@bdp/protocol";

export type ResourceKind = "bead" | "link";
export type ResourceRecord = BeadRecord | LinkRecord;
export type ResourceOperation = Exclude<keyof ReadUpdateInputs, "putAlias" | "deleteAlias">;
export type ResourceMutation = {
  [K in ResourceOperation]: { readonly operation: K; readonly input: ReadUpdateInputs[K] };
}[ResourceOperation];
export type EvaluatorStoredResource = {
  readonly id: string;
  readonly bodyJson: string;
} & (
  | { readonly kind: "bead"; readonly source?: never; readonly target?: never }
  | { readonly kind: "link"; readonly source: string; readonly target: string }
);
/** Revision allocator result; the tag requires positively established persistent unsafety. */
export type ResourceAllocation = string | { readonly kind: "allocation-unsafe" };
/** Structural subset of the single S6 owned-member transaction. All IDs and
 * endpoint indexes are normalized Scope-relative IDs or opaque external URIs.
 * Allocation and writes MUST roll back together when the member fails.
 */
export interface ResourceTransaction {
  resource(id: string): EvaluatorStoredResource | undefined;
  incidentLinks(id: string): readonly EvaluatorStoredResource[];
  outgoingLinks(id: string): readonly EvaluatorStoredResource[];
  identityWasCommitted(id: string): boolean;
  alias(path: string): string | undefined;
  installedType(id: string): string | undefined;
  allocateResourceId(kind: ResourceKind): string;
  allocateRevision(): ResourceAllocation;
  putResource(resource: EvaluatorStoredResource): void;
  deleteResource(id: string): void;
}
export interface InstalledResourceContract {
  readonly descriptor: TypeDescriptor;
  /** Required exactly when the pinned descriptor declares propertiesSchema.
   * The installer compiles its complete immutable schema closure offline.
   * Returned schemaLocation/instanceLocation come from that compiled validator.
   */
  readonly validateProperties?: (
    properties: Readonly<Record<string, unknown>>,
  ) => readonly Omit<ValidationDiagnostic, "type">[];
}
export interface ResourceContractRegistry {
  /** Return only the validator compiled from these exact installed bytes.
   * No network, refresh, lazy installation or fallback on validator absence.
   */
  get(type: string, installedArtifact: string): InstalledResourceContract | undefined;
}
/** Captured by the authority for this member's current request projection.
 * No credentials, principal inference or independent policy snapshot here.
 */
export interface ResourceMutationPolicy {
  canRead(resource: ResourceRecord): boolean;
  canCreate(resource: ResourceRecord): boolean;
  canWrite(before: ResourceRecord, after: ResourceRecord | undefined): boolean;
}
export interface ResourceEvaluationOptions {
  readonly scope: string;
  readonly contracts: ResourceContractRegistry;
  readonly policy: ResourceMutationPolicy;
  /** Complete Scope policy set current in this member transaction. */
  readonly maximumEndpointMultiplicity: readonly MaximumEndpointMultiplicityPolicy[];
  /** Authority-observed instant for this one atomic member, never caller input. */
  readonly committedAt: string;
  /** Native History recording policy; neither this flag nor a parser is admission. */
  readonly recordChangeContext: boolean;
  /** Bounds must match advertised validation limits; absent means complete diagnostics. */
  readonly limits: {
    readonly diagnosticCount?: number;
    readonly diagnosticBytes?: number;
    readonly patchOperations?: number;
    readonly patchPathBytes?: number;
    readonly patchPathDepth?: number;
    readonly propertiesBytes?: number;
    readonly representationBytes?: number;
  };
}
/** Internal S4/S5 metadata, never additional public response members. Values
 * are captured by the same transaction reads used for this successful member.
 * S5 retains original @binding provenance before substituting input to S2.
 */
export interface ResourceReferenceResolution {
  readonly inputPointer: "/id" | "/bead" | "/link" | "/source" | "/target";
  readonly original: Reference;
  readonly resolved: Reference;
}
export type ResourceEvaluation =
  | {
      readonly effect: "success";
      readonly outcome: ReadUpdateMutationResult;
      readonly resolutions: readonly ResourceReferenceResolution[];
      readonly changed: readonly string[];
      readonly deleted: readonly string[];
    }
  | {
      readonly effect: "failure";
      readonly outcome: ReadUpdateProblem;
      readonly resolutions: readonly [];
      readonly changed: readonly [];
      readonly deleted: readonly [];
    };
class Failure extends Error {
  constructor(readonly problem: ReadUpdateProblem) {
    super(problem.code);
  }
}
const failures = {
  "resource-not-found": ["not-found", 404, "after-state-change"],
  forbidden: ["authorization", 403, "after-state-change"],
  "identity-taken": ["conflict", 409, "never"],
  "alias-path-taken": ["conflict", 409, "after-state-change"],
  "type-not-installed": ["validation", 422, "after-state-change"],
  "revision-mismatch": ["conflict", 409, "after-state-change"],
  "incident-links-exist": ["conflict", 409, "after-state-change"],
  "aggregate-constraint-violation": ["conflict", 409, "after-state-change"],
  "limit-exceeded": ["size", 413, "never"],
  "revision-allocation-unsafe": ["conflict", 409, "after-state-change"],
} as const;
function fail(code: keyof typeof failures): never {
  const [family, status, retry] = failures[code];
  throw new Failure(
    parseReadUpdateProblem({
      type: `https://github.com/gastownhall/bdp/problems/${family}`,
      code,
      status,
      retry,
    }),
  );
}
function diagnosticFailure(
  diagnostics: readonly ValidationDiagnostic[],
  limits: ResourceEvaluationOptions["limits"],
): never {
  const retained: ValidationDiagnostic[] = [];
  let bytes = 2; // JSON array brackets; include commas and full UTF-8 entries.
  for (const diagnostic of diagnostics) {
    const nextBytes =
      bytes + (retained.length ? 1 : 0) + Buffer.byteLength(JSON.stringify(diagnostic));
    if (
      (limits.diagnosticCount !== undefined && retained.length >= limits.diagnosticCount) ||
      (limits.diagnosticBytes !== undefined && nextBytes > limits.diagnosticBytes)
    )
      break;
    retained.push(diagnostic);
    bytes = nextBytes;
  }
  if (retained.length === 0) {
    // Do not truncate a required diagnostic's schema identity or invent a partial
    // diagnostic. Installation/configuration must admit at least one full entry.
    throw new Error("diagnostic configuration cannot retain one complete diagnostic");
  }
  throw new Failure(
    parseReadUpdateProblem({
      type: "https://github.com/gastownhall/bdp/problems/validation",
      code: "validation-failed",
      status: 422,
      retry: "never",
      diagnostics: retained,
      ...(retained.length < diagnostics.length ? { diagnosticsTruncated: true } : {}),
    }),
  );
}
function bad(
  message: string,
  options: ResourceEvaluationOptions,
  instanceLocation?: string,
): never {
  return diagnosticFailure(
    [{ message, ...(instanceLocation === undefined ? {} : { instanceLocation }) }],
    options.limits,
  );
}
function local(scope: string, uri: string): string | undefined {
  return uri.startsWith(scope) ? uri.slice(scope.length) : undefined;
}
function canonical(scope: string, spelling: string): string {
  if (spelling.startsWith("@"))
    throw new TypeError("S5 must resolve bindings before Resource evaluation");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(spelling)) return spelling;
  assertCanonicalPathSegments(spelling, "admitted local reference");
  return new URL(spelling, scope).href;
}
function resourcePath(scope: string, uri: string, kind: ResourceKind): string | undefined {
  const path = local(scope, uri);
  if (!path?.startsWith(kind === "bead" ? "beads/" : "links/")) return undefined;
  try {
    parseCanonicalHttpUrl(uri);
    assertCanonicalPathSegments(path, "Resource path");
  } catch {
    return undefined;
  }
  return path;
}
function storedRecord(stored: EvaluatorStoredResource, scope: string): ResourceRecord {
  const value = JSON.parse(stored.bodyJson) as unknown;
  const record = stored.kind === "bead" ? parseBeadRecord(value) : parseLinkRecord(value);
  if (resourcePath(scope, record.id, stored.kind) !== stored.id)
    throw new Error("stored Resource identity differs from its index");
  return record;
}

/** An iterative RFC6902 value comparison over already-admitted numbers. */
function equal(left: unknown, right: unknown): boolean {
  const pending: Array<readonly [unknown, unknown]> = [[left, right]];
  while (pending.length) {
    const pair = pending.pop();
    if (!pair) break;
    const [a, b] = pair;
    if (a === b) continue;
    if (
      !a ||
      !b ||
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
function copy(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const result: unknown[] | Record<string, unknown> = Array.isArray(value)
    ? []
    : (Object.create(null) as Record<string, unknown>);
  const pending = [{ source: value, target: result }];
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    for (const [key, child] of Object.entries(entry.source)) {
      const next =
        child && typeof child === "object"
          ? Array.isArray(child)
            ? []
            : (Object.create(null) as Record<string, unknown>)
          : child;
      Object.defineProperty(entry.target, key, {
        value: next,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      if (child && typeof child === "object")
        pending.push({ source: child, target: next as unknown[] | Record<string, unknown> });
    }
  }
  return result;
}
function freeze<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (item && typeof item === "object" && !Object.isFrozen(item)) {
      for (const child of Object.values(item)) pending.push(child);
      Object.freeze(item);
    }
  }
  return value;
}
function patch(
  properties: Readonly<Record<string, unknown>>,
  changes: PropertyChange,
  options: ResourceEvaluationOptions,
): Readonly<Record<string, unknown>> {
  let result = copy(properties);
  for (const change of changes) {
    const tokens =
      change.path === ""
        ? []
        : change.path
            .slice(1)
            .split("/")
            .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (tokens.length === 0) {
      if (change.op !== "add" && result === undefined)
        bad("Property Change target does not exist", options, change.path);
      if (change.op === "remove") result = undefined;
      else result = copy(change.value);
      continue;
    }
    let parent = result;
    for (const token of tokens.slice(0, -1)) {
      if (
        !parent ||
        typeof parent !== "object" ||
        !Object.hasOwn(parent, token) ||
        (Array.isArray(parent) && !/^(0|[1-9][0-9]*)$/.test(token))
      )
        bad("Property Change parent does not exist", options, change.path);
      parent = (parent as Record<string, unknown>)[token];
    }
    const key = tokens[tokens.length - 1];
    if (key === undefined || !parent || typeof parent !== "object")
      bad("Property Change target does not exist", options, change.path);
    if (Array.isArray(parent)) {
      const index =
        key === "-" && change.op === "add"
          ? parent.length
          : /^(0|[1-9][0-9]*)$/.test(key)
            ? Number(key)
            : NaN;
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index > parent.length ||
        (change.op !== "add" && index === parent.length)
      )
        bad("Property Change array index does not exist", options, change.path);
      if (change.op === "add") parent.splice(index, 0, copy(change.value));
      else if (change.op === "remove") parent.splice(index, 1);
      else parent[index] = copy(change.value);
    } else {
      if (change.op !== "add" && !Object.hasOwn(parent, key))
        bad("Property Change target does not exist", options, change.path);
      if (change.op === "remove") delete (parent as Record<string, unknown>)[key];
      else
        Object.defineProperty(parent, key, {
          value: copy(change.value),
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    bad("resulting properties must be an object", options);
  return freeze(result as Record<string, unknown>);
}

/** One synchronous member; the owning transaction commits returned outcome and
 * staged Resources atomically. It must roll back counters/writes on failure.
 * No keys, auth credentials, scheduler, network or recovery state live here.
 */
export function evaluateResourceMutation(
  tx: ResourceTransaction,
  mutation: ResourceMutation,
  options: ResourceEvaluationOptions,
): ResourceEvaluation {
  parseCanonicalScope(options.scope);
  for (const bound of [options.limits.diagnosticCount, options.limits.diagnosticBytes]) {
    if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 1))
      throw new TypeError("positive usable diagnostic limits required");
  }
  try {
    return evaluate(tx, mutation, options);
  } catch (error) {
    if (error instanceof Failure)
      return freeze({
        effect: "failure",
        outcome: error.problem,
        resolutions: [],
        changed: [],
        deleted: [],
      });
    throw error;
  }
}
/** Shared current-view closure check for Resource and alias member evaluators.
 * The caller supplies its validated canonical Scope and same-turn policy/store.
 * A visible Bead includes every owned Link and its local endpoints; a visible
 * Link includes its local endpoint Beads. This grants no mutation permission.
 */
export function isResourceVisible(
  tx: Pick<ResourceTransaction, "resource">,
  record: ResourceRecord,
  scope: string,
  policy: Pick<ResourceMutationPolicy, "canRead">,
): boolean {
  const pending: ResourceRecord[] = [record];
  const seen = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    if (!policy.canRead(current)) return false;
    const links = "source" in current ? [current] : Object.values(current.ownedLinks ?? {}).flat();
    for (const link of links) {
      if (!policy.canRead(link)) return false;
      for (const ref of [link.source, link.target]) {
        const uri = referenceUri(ref);
        const id = local(scope, uri);
        if (id !== undefined) {
          const found = tx.resource(id);
          if (found?.kind !== "bead") return false;
          pending.push(storedRecord(found, scope));
        }
      }
    }
  }
  return true;
}
function evaluate(
  tx: ResourceTransaction,
  mutation: ResourceMutation,
  options: ResourceEvaluationOptions,
): ResourceEvaluation {
  const scope = options.scope;
  const { operation, input } = mutation;
  const resolutions: ResourceReferenceResolution[] = [];
  const creating = operation === "createBead" || operation === "createLink";
  const deleting = operation === "deleteBead" || operation === "deleteLink";
  const resourceKind: ResourceKind = operation.includes("Bead") ? "bead" : "link";
  const allocatedText = (value: unknown, kind: "identity" | "revision"): string => {
    if (typeof value !== "string" || value.length === 0)
      throw new TypeError(`allocator must return a nonempty ${kind} string`);
    return value;
  };
  const allocateRevision = (): string => {
    const value = tx.allocateRevision();
    // Only an established revision-allocation conflict has this wire meaning.
    // Broken facade values and Resource-ID allocator faults remain internal.
    if (typeof value === "object" && value !== null && value.kind === "allocation-unsafe")
      fail("revision-allocation-unsafe");
    return allocatedText(value, "revision");
  };
  const resolve = (spelling: string, expected: ResourceKind): string => {
    const uri = canonical(scope, spelling);
    const path = local(scope, uri);
    if (expected === "bead" && path?.startsWith("alias/")) {
      const target = tx.alias(path.slice(6));
      if (!target) fail("resource-not-found");
      return new URL(target, scope).href;
    }
    return uri;
  };
  const loadVisible = (uri: string, expected: ResourceKind): ResourceRecord => {
    const id = resourcePath(scope, uri, expected);
    const stored = id === undefined ? undefined : tx.resource(id);
    if (!stored || stored.kind !== expected) fail("resource-not-found");
    const record = storedRecord(stored, scope);
    if (!isResourceVisible(tx, record, scope, options.policy)) fail("resource-not-found");
    return record;
  };
  let id: string;
  let before: ResourceRecord | undefined;
  if (creating) {
    const supplied = "id" in input ? input.id : undefined;
    const spelling = supplied ?? allocatedText(tx.allocateResourceId(resourceKind), "identity");
    const path = resourcePath(scope, canonical(scope, spelling), resourceKind);
    if (path === undefined)
      throw new TypeError("creation ID must already have canonical Resource grammar and kind");
    if (supplied === undefined && path.indexOf("/", 6) !== -1)
      throw new Error("allocator must return one opaque Resource identity segment");
    id = path;
    if (supplied !== undefined)
      resolutions.push({
        inputPointer: "/id",
        original: supplied,
        resolved: new URL(id, scope).href,
      });
    if (tx.identityWasCommitted(id)) {
      if (supplied === undefined)
        throw new Error("allocator returned a committed Resource identity");
      fail("identity-taken");
    }
    if (resourceKind === "bead" && tx.alias(id.slice(6)) !== undefined) {
      if (supplied === undefined) throw new Error("allocator returned a live Bead alias path");
      fail("alias-path-taken");
    }
  } else {
    const subject = "bead" in input ? input.bead : "link" in input ? input.link : undefined;
    if (subject === undefined) throw new TypeError("Resource subject required");
    const resolved = resolve(subject, resourceKind);
    before = loadVisible(resolved, resourceKind);
    resolutions.push({
      inputPointer: resourceKind === "bead" ? "/bead" : "/link",
      original: subject,
      resolved,
    });
    id = local(scope, before.id) as string;
  }
  const uri = new URL(id, scope).href;
  const contractMap = new Map<string, InstalledResourceContract>();
  const contracts = (type: string): readonly InstalledResourceContract[] => {
    const pending = [type];
    const gathered = new Map<string, InstalledResourceContract>();
    while (pending.length) {
      const name = pending.pop();
      if (!name || gathered.has(name)) continue;
      let entry = contractMap.get(name);
      if (!entry) {
        const artifact = tx.installedType(name);
        const compiled = artifact === undefined ? undefined : options.contracts.get(name, artifact);
        if (!compiled) fail("type-not-installed");
        let descriptor: TypeDescriptor;
        try {
          descriptor = parseTypeDescriptor(compiled.descriptor);
        } catch {
          return fail("type-not-installed");
        }
        if (
          descriptor.id !== name ||
          (descriptor.propertiesSchema !== undefined && compiled.validateProperties === undefined)
        )
          fail("type-not-installed");
        entry = { ...compiled, descriptor };
        contractMap.set(name, entry);
      }
      gathered.set(name, entry);
      pending.push(...entry.descriptor.conformsTo);
    }
    try {
      createTypeConformanceIndex([...gathered.values()].map((entry) => entry.descriptor));
    } catch {
      return fail("type-not-installed");
    }
    return [...gathered.values()];
  };
  const type = "type" in input ? input.type : before?.type;
  if (type === undefined) throw new TypeError("Resource Type required");
  let source: BeadRecord | undefined;
  let endpoints: { source: Reference; target: Reference } | undefined;
  const endpoint = (
    reference: string | { readonly uri: string; readonly revision: string },
  ): Reference => {
    const spelling = typeof reference === "string" ? reference : reference.uri;
    const absolute = resolve(spelling, "bead");
    const path = local(scope, absolute);
    if (path !== undefined) {
      if (!resourcePath(scope, absolute, "bead"))
        bad("Link endpoint is not a Bead reference", options);
      loadVisible(absolute, "bead");
    }
    return (
      typeof reference === "string" ? absolute : { uri: absolute, revision: reference.revision }
    ) as Reference;
  };
  if (resourceKind === "link") {
    if (operation === "createLink")
      endpoints = { source: endpoint(input.source), target: endpoint(input.target) };
    else if (before && "source" in before)
      endpoints = { source: endpoint(before.source), target: endpoint(before.target) };
    if (!endpoints) throw new TypeError("Link endpoints required");
    if (
      !deleting &&
      local(scope, referenceUri(endpoints.source)) === undefined &&
      local(scope, referenceUri(endpoints.target)) === undefined
    )
      bad("a Link must have at least one in-Scope endpoint", options);

    if (operation === "createLink") {
      resolutions.push(
        { inputPointer: "/source", original: input.source, resolved: endpoints.source },
        { inputPointer: "/target", original: input.target, resolved: endpoints.target },
      );
    }
  }
  const effective = contracts(type);
  const declared = effective.find((entry) => entry.descriptor.id === type)?.descriptor;
  if (!declared) fail("type-not-installed");
  if (declared.describes !== resourceKind)
    bad("declared Type describes another Resource category", options);

  if (endpoints) {
    for (const entry of effective) {
      if (entry.descriptor.describes !== "link") fail("type-not-installed");
      for (const side of ["source", "target"] as const) {
        const constraint = entry.descriptor[side];
        const address = referenceUri(endpoints[side]);
        const required = constraint.conformsTo.flatMap((required) => [...contracts(required)]);
        if (required.some((contract) => contract.descriptor.describes !== "bead"))
          fail("type-not-installed");
        if (local(scope, address) !== undefined) {
          const bead = loadVisible(address, "bead") as BeadRecord;
          const actual = contracts(bead.type);
          if (
            constraint.conformsTo.some(
              (required) => !actual.some((contract) => contract.descriptor.id === required),
            )
          )
            diagnosticFailure(
              [
                {
                  type: entry.descriptor.id,
                  schemaLocation: `${entry.descriptor.id}#/${side}/conformsTo`,
                  message: "in-Scope endpoint fails an effective Type constraint",
                },
              ],
              options.limits,
            );
        } else {
          if (constraint.external === "none")
            diagnosticFailure(
              [
                {
                  type: entry.descriptor.id,
                  schemaLocation: `${entry.descriptor.id}#/${side}/external`,
                  message: "external endpoint is forbidden by Type contract",
                },
              ],
              options.limits,
            );
          if (constraint.external === "bead" && !isExternalBead(address))
            diagnosticFailure(
              [
                {
                  type: entry.descriptor.id,
                  schemaLocation: `${entry.descriptor.id}#/${side}/external`,
                  message: "external endpoint is not bead-shaped",
                },
              ],
              options.limits,
            );
        }
      }
    }
    const sourceId = local(scope, referenceUri(endpoints.source));
    if (sourceId !== undefined)
      source = loadVisible(new URL(sourceId, scope).href, "bead") as BeadRecord;
  }
  const properties = deleting
    ? (before?.properties ?? {})
    : "change" in input
      ? patch(before?.properties ?? {}, input.change, options)
      : "properties" in input
        ? (input.properties ?? {})
        : {};
  if (!deleting) {
    const diagnostics = effective.flatMap(
      (entry) =>
        entry
          .validateProperties?.(properties)
          .map((diagnostic) => ({ ...diagnostic, type: entry.descriptor.id })) ?? [],
    );
    if (diagnostics.length) diagnosticFailure(diagnostics, options.limits);
  }
  const sourceDescriptor = source
    ? contracts(source.type).find((entry) => entry.descriptor.id === source?.type)?.descriptor
    : undefined;
  const ownership =
    sourceDescriptor?.describes === "bead" ? sourceDescriptor.ownsOutgoing : undefined;
  const owned =
    ownership !== undefined && (Object.hasOwn(ownership, type) || Object.hasOwn(ownership, "*"));
  const noOp = !creating && !deleting && equal(properties, before?.properties);
  const metadata = (
    prior: ResourceRecord | undefined,
  ): { readonly attribution?: Attribution; readonly changeContext?: ChangeContext } => {
    if (noOp && prior)
      return {
        ...(prior.attribution ? { attribution: prior.attribution } : {}),
        ...(prior.changeContext ? { changeContext: prior.changeContext } : {}),
      };
    const attribution = "attribution" in input ? input.attribution : undefined;
    const context = "changeContext" in input ? input.changeContext : undefined;
    return {
      ...(attribution === undefined ? {} : { attribution }),
      ...(options.recordChangeContext || context !== undefined
        ? { changeContext: makeContext(context, options.committedAt) }
        : {}),
    };
  };
  const revision = noOp ? before?.revision : deleting ? undefined : allocateRevision();
  let after: ResourceRecord | undefined = deleting
    ? undefined
    : ({
        id: uri,
        type,
        revision,
        properties,
        ...metadata(before),
        ...(endpoints ?? {}),
      } as ResourceRecord);
  const ownedLinks = (
    owner: BeadRecord,
    descriptor: BeadTypeDescriptor,
    replacement?: LinkRecord,
    removed?: string,
  ): BeadRecord => {
    if (descriptor.ownsOutgoing === undefined) return owner;
    const entries: Record<string, LinkRecord[]> = Object.create(null) as Record<
      string,
      LinkRecord[]
    >;
    for (const name of Object.keys(descriptor.ownsOutgoing)) if (name !== "*") entries[name] = [];
    const live = tx
      .outgoingLinks(local(scope, owner.id) as string)
      .filter((link) => link.id !== removed && new URL(link.id, scope).href !== replacement?.id)
      .map((link) => storedRecord(link, scope) as LinkRecord);
    if (replacement) live.push(replacement);
    for (const link of live) {
      if (Object.hasOwn(descriptor.ownsOutgoing, link.type) || descriptor.ownsOutgoing["*"]) {
        const bucket = entries[link.type] ?? [];
        entries[link.type] = bucket;
        bucket.push(link);
      }
    }
    for (const [name, links] of Object.entries(entries)) {
      links.sort((a, b) => compareCanonicalIds(a.id, b.id));
      const max = descriptor.ownsOutgoing[name]?.max;
      if (max !== undefined && links.length > max)
        diagnosticFailure(
          [
            {
              type: descriptor.id,
              schemaLocation: `${descriptor.id}#/ownsOutgoing/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`,
              message: "owned Link set exceeds declared maximum",
            },
          ],
          options.limits,
        );
    }
    if (
      descriptor.ownsOutgoing["*"] &&
      Object.values(entries).reduce((count, links) => count + links.length, 0) >
        descriptor.ownsOutgoing["*"].max
    )
      diagnosticFailure(
        [
          {
            type: descriptor.id,
            schemaLocation: `${descriptor.id}#/ownsOutgoing/*`,
            message: "whole owned Link set exceeds wildcard maximum",
          },
        ],
        options.limits,
      );
    return { ...owner, ownedLinks: entries };
  };
  if (after && resourceKind === "bead" && declared.describes === "bead")
    after = ownedLinks(after as BeadRecord, declared);
  let sourceAfter: BeadRecord | undefined;
  if (owned && source && sourceDescriptor?.describes === "bead") {
    const sourceRevision = noOp ? source.revision : allocateRevision();
    sourceAfter = ownedLinks(
      {
        id: source.id,
        type: source.type,
        revision: sourceRevision,
        properties: source.properties,
        ...metadata(source),
      },
      sourceDescriptor,
      after as LinkRecord | undefined,
      deleting ? id : undefined,
    );
  }
  if (!deleting && endpoints) {
    for (const policy of options.maximumEndpointMultiplicity) {
      if (!effective.some((entry) => entry.descriptor.id === policy.linkConformsTo)) continue;
      const address = referenceUri(endpoints[policy.endpoint]);
      const endpointId = local(scope, address);
      if (endpointId === undefined) continue;
      let count = 1;
      for (const link of tx.incidentLinks(endpointId)) {
        if (link.id === id || link[policy.endpoint] !== endpointId) continue;
        const record = storedRecord(link, scope);
        if (contracts(record.type).some((entry) => entry.descriptor.id === policy.linkConformsTo))
          count++;
      }
      if (count > policy.max) fail("aggregate-constraint-violation");
    }
  }
  after = after ? freeze(after) : undefined;
  sourceAfter = sourceAfter ? freeze(sourceAfter) : undefined;
  if (
    creating
      ? !after || !options.policy.canCreate(after)
      : !before || !options.policy.canWrite(before, after)
  )
    fail("forbidden");
  if (source && sourceAfter && !options.policy.canWrite(source, sourceAfter)) fail("forbidden");
  if (
    "expectedRevision" in input &&
    input.expectedRevision !== undefined &&
    input.expectedRevision !== before?.revision
  )
    fail("revision-mismatch");
  if (deleting && resourceKind === "bead" && tx.incidentLinks(id).length)
    fail("incident-links-exist");
  if ("change" in input) {
    const limits = options.limits;
    if (limits.patchOperations !== undefined && input.change.length > limits.patchOperations)
      fail("limit-exceeded");
    for (const change of input.change)
      if (
        (limits.patchPathBytes !== undefined &&
          Buffer.byteLength(change.path) > limits.patchPathBytes) ||
        (limits.patchPathDepth !== undefined &&
          (change.path === "" ? 0 : change.path.split("/").length - 1) > limits.patchPathDepth)
      )
        fail("limit-exceeded");
  }
  const writes: EvaluatorStoredResource[] = [];
  for (const record of [after, sourceAfter]) {
    if (!record) continue;
    const bodyJson = stringifyJsonValue(record);
    if (
      (options.limits.propertiesBytes !== undefined &&
        Buffer.byteLength(stringifyJsonValue(record.properties)) >
          options.limits.propertiesBytes) ||
      (options.limits.representationBytes !== undefined &&
        Buffer.byteLength(bodyJson) > options.limits.representationBytes)
    )
      fail("limit-exceeded");
    if (!noOp) {
      const stored = { id: local(scope, record.id) as string, bodyJson };
      writes.push(
        "source" in record
          ? {
              ...stored,
              kind: "link",
              source: local(scope, referenceUri(record.source)) ?? referenceUri(record.source),
              target: local(scope, referenceUri(record.target)) ?? referenceUri(record.target),
            }
          : { ...stored, kind: "bead" },
      );
    }
  }
  const outcome: ReadUpdateMutationResult = deleting
    ? {
        outcome: "deleted",
        deleted: {
          resourceKind,
          resource: {
            id: before?.id as string,
            type: before?.type as string,
            revision: before?.revision as string,
          },
        },
        ...(sourceAfter ? { source: sourceAfter.id, sourceRevision: sourceAfter.revision } : {}),
      }
    : {
        outcome: creating ? "created" : "updated",
        resource: after as ResourceRecord,
        ...(sourceAfter ? { source: sourceAfter.id, sourceRevision: sourceAfter.revision } : {}),
      };
  // No Resource write happens until every validation/policy/CAS/limit check passes.
  for (const write of writes) tx.putResource(write);
  if (deleting) tx.deleteResource(id);
  return freeze({
    effect: "success",
    outcome,
    resolutions,
    changed: writes.map((write) => write.id),
    deleted: deleting ? [id] : [],
  });
}
function makeContext(input: ChangeContextInput | undefined, committedAt: string): ChangeContext {
  const state = (
    value: string | null | undefined,
  ): { state: "undetermined" } | { state: "absent" } | { state: "present"; value: string } =>
    value === undefined
      ? { state: "undetermined" }
      : value === null
        ? { state: "absent" }
        : { state: "present", value };
  return parseChangeContext({
    committedAt: { state: "present", value: committedAt },
    agent: state(input?.agent),
    message: state(input?.message),
  });
}
function isExternalBead(uri: string): boolean {
  try {
    const url = new URL(parseCanonicalHttpUrl(uri));
    const match = /\/beads\/(.+)$/.exec(url.pathname);
    if (url.search !== "" || match?.[1] === undefined) return false;
    assertCanonicalPathSegments(match[1], "external Bead ID");
    return true;
  } catch {
    return false;
  }
}
