import {
  type JsonNumberDiagnosticBudget,
  type LosslessJsonValue,
  type PreparedReadUpdateCarrier,
  type ReadUpdateInputs,
  type ReadUpdateMutationResult,
  type ReadUpdateNumericAdmission,
  type ReadUpdateOperation,
  type UnadmittedReadUpdateOperation,
  JsonSyntaxError,
  ProtocolArtifactValidationError,
  admitReadUpdateOperationNumbers,
  assertCanonicalPathSegments,
  assertPreparedReadUpdateCarrier,
  decodeJsonDocument,
  isJsonSchemaUri,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseReadUpdateMutationResult,
} from "@bdp/protocol";
import {
  encodeSemanticValue,
  UNBOUND_SEMANTIC_REFERENCE,
  type SemanticValue,
} from "./semantic-identity.js";

type ResourceKind = "bead" | "link";
export interface CreationBinding {
  readonly kind: "bound";
  readonly id: string;
  readonly resourceKind: ResourceKind;
}
/** Internal creator fact, independent of whether its retained postimage is
 * disclosed. The member executor owns the disposition-to-fact decision. */
export type MemberCreatorBinding =
  | CreationBinding
  | { readonly kind: "unbound" }
  | { readonly kind: "transient" };
type StableBinding = Exclude<MemberCreatorBinding, { readonly kind: "transient" }>;
type Field = "id" | "bead" | "link" | "source" | "target" | "alias";
export type MemberReferenceSlot = `/${Field}` | "/source/uri" | "/target/uri";
export type MemberReferenceWitness =
  | { readonly slot: MemberReferenceSlot; readonly kind: "direct"; readonly uri: string }
  | {
      readonly slot: MemberReferenceSlot;
      readonly kind: "alias";
      readonly locator: string;
      readonly target: string | null;
    }
  | {
      readonly slot: MemberReferenceSlot;
      readonly kind: "binding";
      readonly binding: StableBinding;
    };
const metadataFormat = "ru-member-resolutions-1";
export interface MemberMetadata {
  readonly format: typeof metadataFormat;
  readonly scope: string;
  readonly operation: ReadUpdateOperation;
  readonly witnesses: readonly MemberReferenceWitness[];
  readonly creation?: CreationBinding;
}
export class MemberMetadataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MemberMetadataError";
  }
}
interface FieldRule {
  readonly field: Field;
  readonly required: boolean;
  readonly binding?: ResourceKind;
  readonly alias?: true;
  readonly pinned?: true;
}
const fields: Readonly<Record<ReadUpdateOperation, readonly FieldRule[]>> = {
  createBead: [{ field: "id", required: false }],
  createLink: [
    { field: "id", required: false },
    { field: "source", required: true, binding: "bead", alias: true, pinned: true },
    { field: "target", required: true, binding: "bead", alias: true, pinned: true },
  ],
  updateBeadProperties: [{ field: "bead", required: true, binding: "bead", alias: true }],
  deleteBead: [{ field: "bead", required: true, binding: "bead", alias: true }],
  updateLinkProperties: [{ field: "link", required: true, binding: "link" }],
  deleteLink: [{ field: "link", required: true, binding: "link" }],
  putAlias: [
    { field: "alias", required: true },
    { field: "target", required: true, binding: "bead" },
  ],
  deleteAlias: [{ field: "alias", required: true }],
};
const metadataBrands = new WeakSet<object>();
const identityState = new WeakMap<
  object,
  {
    readonly original: UnadmittedReadUpdateOperation;
    readonly substitutions: ReadonlyMap<Field, string>;
    readonly aliases: ReadonlyMap<string, string | null>;
    readonly unavailableBinding: boolean;
  }
>();
export interface NormalizedMemberIdentity {
  readonly kind: "ready";
  readonly identityJson: string;
  readonly metadata: MemberMetadata;
}
export type MemberNormalization =
  | NormalizedMemberIdentity
  | { readonly kind: "transient-dependency" }
  | { readonly kind: "unimplemented-alias-retry"; readonly slot: MemberReferenceSlot };
export interface MemberIdentityContext {
  readonly scope: string;
  /** Same synchronous member turn; no authorization or Resource-body read.
   * locator is an absolute canonical in-Scope alias URL, unlike the bare path
   * accepted by capturedMemberAlias. Return an absolute canonical in-Scope
   * Bead ID, or undefined for no alias. */
  resolveAlias(locator: string): string | undefined;
  /** Index is the earlier creator in this current carrier, never a stored label. */
  creatorBinding(index: number): MemberCreatorBinding;
  /** Parsed metadata from this principal/key's retained or expired state.
   * The owner must check that namespace: branding and Scope alone do not prove
   * key ownership. Retry normalization never replaces retained metadata or
   * outcome, even if the current spelling produces different witnesses. */
  readonly prior?: MemberMetadata;
}

const dependencyBrand = Symbol("prepared member dependencies");
/** Opaque stable facts for one original member in one captured synchronous turn.
 * Only prepareMemberDependencies can create a usable token; copying it loses its brand. */
export interface PreparedMemberDependencies {
  readonly kind: "stable-dependencies";
  readonly [dependencyBrand]: true;
}
export type MemberDependencyPreparation =
  | PreparedMemberDependencies
  | { readonly kind: "transient-dependency" };
export type PreparedMemberIdentityContext = Omit<MemberIdentityContext, "creatorBinding">;
type PreparedNormalization = Exclude<
  MemberNormalization,
  { readonly kind: "transient-dependency" }
>;
const dependencyState = new WeakMap<
  PreparedMemberDependencies,
  {
    readonly carrier: PreparedReadUpdateCarrier;
    readonly index: number;
    readonly scope: string;
    readonly original: UnadmittedReadUpdateOperation;
    readonly references: readonly {
      readonly rule: FieldRule;
      readonly slot: MemberReferenceSlot;
      readonly uri: string;
    }[];
    readonly bindings: ReadonlyMap<string, MemberCreatorBinding>;
  }
>();

function creationKind(operation: ReadUpdateOperation): ResourceKind | undefined {
  return operation === "createBead" ? "bead" : operation === "createLink" ? "link" : undefined;
}
function canonical(scope: string, spelling: string): string {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(spelling) ? spelling : new URL(spelling, scope).href;
}
function resourceId(scope: string, value: unknown, kind: ResourceKind): string {
  if (
    typeof value !== "string" ||
    !value.startsWith(`${scope}${kind === "bead" ? "beads" : "links"}/`)
  )
    throw new MemberMetadataError("binding requires the canonical in-Scope Resource kind");
  parseCanonicalHttpUrl(value);
  assertCanonicalPathSegments(value.slice(scope.length), "binding Resource path");
  return value;
}
function binding(
  value: unknown,
  scope: string,
  kind: ResourceKind,
  transient: boolean,
): MemberCreatorBinding {
  const record = object(value);
  if (record.kind === "bound") {
    closed(record, ["kind", "id", "resourceKind"]);
    if (record.resourceKind !== kind)
      throw new MemberMetadataError("binding Resource kind differs");
    return Object.freeze({
      kind: "bound",
      id: resourceId(scope, record.id, kind),
      resourceKind: kind,
    });
  }
  closed(record, ["kind"]);
  if (record.kind === "unbound") return Object.freeze({ kind: "unbound" });
  if (record.kind === "transient" && transient) return Object.freeze({ kind: "transient" });
  throw new MemberMetadataError("invalid creator binding fact");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MemberMetadataError("metadata requires an object");
  return value as Record<string, unknown>;
}
function closed(value: Record<string, unknown>, names: readonly string[]): void {
  if (
    Object.keys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    throw new MemberMetadataError("metadata has missing or unknown members");
}
function remember(metadata: MemberMetadata): MemberMetadata {
  metadataBrands.add(metadata);
  return Object.freeze(metadata);
}
function checkMetadata(metadata: MemberMetadata, scope: string): void {
  if (!metadata || !metadataBrands.has(metadata) || metadata.scope !== scope)
    throw new MemberMetadataError("expected parsed same-Scope member metadata");
}
function inputReference(
  value: LosslessJsonValue | undefined,
  rule: FieldRule,
): { slot: MemberReferenceSlot; uri: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return { slot: `/${rule.field}`, uri: value };
  // Original operation belongs to a branded, schema-checked complete carrier.
  if (!rule.pinned) throw new TypeError("unexpected non-string admitted reference");
  const uri = (value as Readonly<Record<string, LosslessJsonValue>>).uri;
  if (typeof uri !== "string") throw new TypeError("admitted pinned reference lost its URI");
  return { slot: `/${rule.field}/uri` as MemberReferenceSlot, uri };
}

/** Captures only legal reference slots and creator facts, before any key/prior,
 * alias, policy or numeric-admission access. Missing facts are sequencing errors.
 * The caller may continue normalization only for this exact carrier/index/Scope. */
export function prepareMemberDependencies(
  carrier: PreparedReadUpdateCarrier,
  index: number,
  scope: string,
  creatorBinding: MemberIdentityContext["creatorBinding"],
): MemberDependencyPreparation {
  assertPreparedReadUpdateCarrier(carrier, scope);
  if (!Number.isSafeInteger(index) || index < 0 || index >= carrier.operations.length)
    throw new TypeError("member index is outside its prepared carrier");
  const original = carrier.operations[index];
  if (!original) throw new TypeError("prepared carrier lost a member");
  const rules = fields[original.operation];
  const references = rules.flatMap((rule) => {
    const ref = inputReference(original.input[rule.field], rule);
    return ref ? [{ rule, ...ref }] : [];
  });
  const bindings = new Map<string, MemberCreatorBinding>();
  for (const ref of references) {
    if (!ref.uri.startsWith("@")) continue;
    if (!ref.rule.binding) throw new TypeError("binding in a forbidden admitted slot");
    let fact = bindings.get(ref.uri);
    if (!fact) {
      const creator = carrier.operations.findIndex((member) => member.name === ref.uri.slice(1));
      if (creator < 0 || creator >= index) throw new TypeError("invalid prepared creator order");
      fact = binding(creatorBinding(creator), scope, ref.rule.binding, true);
      bindings.set(ref.uri, fact);
    }
    if (fact.kind === "transient") return Object.freeze({ kind: "transient-dependency" });
  }
  const prepared: PreparedMemberDependencies = Object.freeze({
    kind: "stable-dependencies",
    [dependencyBrand]: true as const,
  });
  dependencyState.set(prepared, {
    carrier,
    index,
    scope,
    original,
    references: Object.freeze(references),
    bindings,
  });
  return prepared;
}

/** Existing convenience API. Preparation and prepared normalization share the
 * same inventory; the creator provider is called at most once per distinct
 * referenced creator label per preparation. */
export function normalizeMemberIdentity(
  carrier: PreparedReadUpdateCarrier,
  index: number,
  context: MemberIdentityContext,
): MemberNormalization {
  const scope = context.scope;
  const prepared = prepareMemberDependencies(carrier, index, scope, (creator) =>
    context.creatorBinding(creator),
  );
  if (prepared.kind === "transient-dependency") return prepared;
  const prior = context.prior;
  return normalizePreparedMemberIdentity(
    carrier,
    index,
    {
      scope,
      ...(prior === undefined ? {} : { prior }),
      resolveAlias(locator) {
        return context.resolveAlias(locator);
      },
    },
    prepared,
  );
}

/** Continue using captured dependency facts after authoritative key classification.
 * Pairing is checked before reading prior metadata or invoking an alias callback.
 * No creator provider belongs to this interface or is called a second time. */
export function normalizePreparedMemberIdentity(
  carrier: PreparedReadUpdateCarrier,
  index: number,
  context: PreparedMemberIdentityContext,
  prepared: PreparedMemberDependencies,
): PreparedNormalization {
  const state = dependencyState.get(prepared);
  if (!state || state.carrier !== carrier || state.index !== index || state.scope !== context.scope)
    throw new TypeError("prepared dependencies do not match the original member and Scope");
  const { scope, original, references, bindings } = state;
  // Do not even read context.prior/resolveAlias before the dependency/pairing checks.
  const prior = context.prior;
  if (prior !== undefined) checkMetadata(prior, scope);
  const aliases = new Map<string, string | null>();
  const substitutions = new Map<Field, string>();
  const witnesses: MemberReferenceWitness[] = [];
  const normalized: Record<string, SemanticValue> = { ...original.input };
  let unavailableBinding = false;
  for (const ref of references) {
    let replacement: SemanticValue;
    let executable: string | undefined;
    if (ref.uri.startsWith("@")) {
      const fact = bindings.get(ref.uri);
      if (!fact || fact.kind === "transient") throw new TypeError("lost stable creator binding");
      witnesses.push(Object.freeze({ slot: ref.slot, kind: "binding", binding: fact }));
      replacement = fact.kind === "bound" ? fact.id : UNBOUND_SEMANTIC_REFERENCE;
      executable = fact.kind === "bound" ? fact.id : undefined;
      unavailableBinding ||= fact.kind === "unbound";
    } else {
      const uri = canonical(scope, ref.uri);
      if (ref.rule.alias && uri.startsWith(`${scope}alias/`)) {
        if (!aliases.has(uri)) {
          if (prior !== undefined) {
            const old = prior.witnesses.find((w) => w.kind === "alias" && w.locator === uri);
            if (old?.kind !== "alias")
              return Object.freeze({ kind: "unimplemented-alias-retry", slot: ref.slot });
            aliases.set(uri, old.target);
          } else {
            const target = context.resolveAlias(uri);
            aliases.set(uri, target === undefined ? null : resourceId(scope, target, "bead"));
          }
        }
        const target = aliases.get(uri);
        if (target === undefined) throw new TypeError("lost captured alias resolution");
        witnesses.push(Object.freeze({ slot: ref.slot, kind: "alias", locator: uri, target }));
        replacement = target ?? Object.freeze({ unresolvedAlias: uri });
        executable = target ?? uri;
      } else {
        witnesses.push(Object.freeze({ slot: ref.slot, kind: "direct", uri }));
        replacement = executable = uri;
      }
    }
    const value = original.input[ref.rule.field];
    normalized[ref.rule.field] =
      typeof value === "string"
        ? replacement
        : Object.freeze({ ...(value as Record<string, SemanticValue>), uri: replacement });
    if (executable !== undefined) substitutions.set(ref.rule.field, executable);
  }
  if (creationKind(original.operation) && !Object.hasOwn(normalized, "properties"))
    normalized.properties = Object.freeze({});
  // Context's protocol default is omission: {} carries no explicit states.
  // Keep null/string members and never insert generated version metadata.
  const contextInput = normalized.changeContext;
  if (
    contextInput !== null &&
    typeof contextInput === "object" &&
    Object.keys(contextInput).length === 0
  )
    delete normalized.changeContext;
  const metadata = remember({
    format: metadataFormat,
    scope,
    operation: original.operation,
    witnesses: Object.freeze(witnesses),
  });
  const result: NormalizedMemberIdentity = Object.freeze({
    kind: "ready",
    identityJson: encodeSemanticValue({
      operation: original.operation,
      normalizedInput: normalized,
    }),
    metadata,
  });
  identityState.set(result, { original, substitutions, aliases, unavailableBinding });
  return result;
}

export type ExecutableMember = {
  [K in ReadUpdateOperation]: { readonly operation: K; readonly input: ReadUpdateInputs[K] };
}[ReadUpdateOperation];
export interface MemberExecutionValues {
  readonly admission: ReadUpdateNumericAdmission<ReadUpdateOperation>;
  readonly unavailableBinding: boolean;
  readonly executable?: ExecutableMember;
}
/** Numeric admission remains paired with the private original S1 operation.
 * This reports both independent facts, not which failure should win. The future
 * executor owns ordering/Problems; no unbound sentinel can become an input URI. */
export function prepareMemberExecution(
  member: NormalizedMemberIdentity,
  budget: JsonNumberDiagnosticBudget,
): MemberExecutionValues {
  const state = identityState.get(member);
  if (!state) throw new TypeError("expected a normalized member identity");
  const admission = admitReadUpdateOperationNumbers(state.original, budget);
  if (!admission.ok || state.unavailableBinding)
    return Object.freeze({ admission, unavailableBinding: state.unavailableBinding });
  const input: Record<string, unknown> = { ...admission.input };
  for (const [field, uri] of state.substitutions) {
    const value = input[field];
    input[field] =
      typeof value === "string"
        ? uri
        : Object.freeze({ ...(value as Record<string, unknown>), uri });
  }
  return Object.freeze({
    admission,
    unavailableBinding: false,
    executable: Object.freeze({
      operation: state.original.operation,
      input: Object.freeze(input),
    }) as ExecutableMember,
  });
}

/** Structural alias-facade overlay: path is the bare path beneath alias/,
 * unlike MemberIdentityContext.resolveAlias's absolute canonical alias URL.
 * A captured target is returned as a Scope-relative Bead ID. A captured
 * miss stays a miss. Only an explicitly uncaptured path may reach the live store
 * (e.g. the separate Bead-allocation uniqueness guard). */
export function capturedMemberAlias(
  member: NormalizedMemberIdentity,
  path: string,
): { readonly captured: false } | { readonly captured: true; readonly target: string | undefined } {
  const state = identityState.get(member);
  if (!state) throw new TypeError("expected a normalized member identity");
  const locator = `${member.metadata.scope}alias/${path}`;
  if (!state.aliases.has(locator)) return Object.freeze({ captured: false });
  const target = state.aliases.get(locator);
  return Object.freeze({
    captured: true,
    target: target == null ? undefined : target.slice(member.metadata.scope.length),
  });
}

function assertCreationWitnesses(witnesses: readonly MemberReferenceWitness[]): void {
  if (
    witnesses.some(
      (witness) =>
        (witness.kind === "binding" && witness.binding.kind === "unbound") ||
        (witness.kind === "alias" && witness.target === null),
    )
  )
    throw new MemberMetadataError("successful creation cannot have an unavailable reference");
}

/** Called with an actual successful creator completion by the later owner,
 * before its atomic S6 retain. Parsing a result here proves shape/correspondence,
 * not a committed transaction. Never call this to infer allocation from input. */
export function serializeMemberMetadata(
  member: NormalizedMemberIdentity,
  completion?: ReadUpdateMutationResult,
): string {
  const state = identityState.get(member);
  if (!state) throw new TypeError("expected a normalized member identity");
  let creation: CreationBinding | undefined;
  if (completion !== undefined) {
    assertCreationWitnesses(member.metadata.witnesses);
    const result = parseReadUpdateMutationResult(completion);
    const kind = creationKind(state.original.operation);
    if (
      !kind ||
      result.outcome !== "created" ||
      !result.resource ||
      result.resource.type !== state.original.input.type ||
      ("source" in result.resource ? "link" : "bead") !== kind
    )
      throw new MemberMetadataError(
        "creation metadata needs the successful Resource creator result",
      );
    const id = resourceId(member.metadata.scope, result.resource.id, kind);
    const supplied = member.metadata.witnesses.find((w) => w.slot === "/id");
    if (supplied && (supplied.kind !== "direct" || supplied.uri !== id))
      throw new MemberMetadataError("creation result differs from supplied identity");
    creation = Object.freeze({ kind: "bound", id, resourceKind: kind });
  }
  return JSON.stringify({ ...member.metadata, ...(creation === undefined ? {} : { creation }) });
}

/** Versioned persistence parser. Syntax/shape/canonical failures are local
 * metadata faults, never ordinary semantic mismatch or a public Problem. */
export function parseMemberMetadata(text: string, expectedScope: string): MemberMetadata {
  try {
    const scope = parseCanonicalScope(expectedScope);
    const data = object(decodeJsonDocument(text));
    closed(data, [
      "format",
      "scope",
      "operation",
      "witnesses",
      ...(Object.hasOwn(data, "creation") ? ["creation"] : []),
    ]);
    if (
      data.format !== metadataFormat ||
      data.scope !== scope ||
      typeof data.operation !== "string" ||
      !Object.hasOwn(fields, data.operation)
    )
      throw new MemberMetadataError("unsupported member metadata version, Scope or operation");
    const operation = data.operation as ReadUpdateOperation;
    const rules = fields[operation];
    if (!Array.isArray(data.witnesses) || data.witnesses.length > rules.length)
      throw new MemberMetadataError("invalid witness inventory");
    const seen = new Set<Field>();
    const aliasTargets = new Map<string, string | null>();
    let previous = -1;
    const witnesses = data.witnesses.map((value) => {
      const witness = object(value);
      const position = rules.findIndex(
        (rule) =>
          witness.slot === `/${rule.field}` ||
          (rule.pinned && witness.slot === `/${rule.field}/uri`),
      );
      const rule = rules[position];
      if (!rule || position <= previous || seen.has(rule.field))
        throw new MemberMetadataError("invalid, repeated or out-of-order witness slot");
      previous = position;
      seen.add(rule.field);
      const slot = witness.slot as MemberReferenceSlot;
      if (witness.kind === "binding") {
        closed(witness, ["slot", "kind", "binding"]);
        if (!rule.binding) throw new MemberMetadataError("binding witness in a forbidden slot");
        const fact = binding(witness.binding, scope, rule.binding, false) as StableBinding;
        return Object.freeze({ slot, kind: "binding" as const, binding: fact });
      }
      if (witness.kind === "alias") {
        closed(witness, ["slot", "kind", "locator", "target"]);
        if (
          !rule.alias ||
          typeof witness.locator !== "string" ||
          !witness.locator.startsWith(`${scope}alias/`)
        )
          throw new MemberMetadataError("alias witness in a forbidden slot or Scope");
        const locator = parseCanonicalHttpUrl(witness.locator);
        assertCanonicalPathSegments(locator.slice(scope.length), "alias witness path");
        const target = witness.target === null ? null : resourceId(scope, witness.target, "bead");
        if (aliasTargets.has(locator) && aliasTargets.get(locator) !== target)
          throw new MemberMetadataError("one alias has inconsistent captured targets");
        aliasTargets.set(locator, target);
        return Object.freeze({ slot, kind: "alias" as const, locator, target });
      }
      closed(witness, ["slot", "kind", "uri"]);
      if (
        witness.kind !== "direct" ||
        typeof witness.uri !== "string" ||
        !isJsonSchemaUri(witness.uri)
      )
        throw new MemberMetadataError("invalid direct witness URI");
      const uri = witness.uri;
      if (uri.startsWith(scope)) {
        parseCanonicalHttpUrl(uri);
        assertCanonicalPathSegments(uri.slice(scope.length), "direct witness path");
      }
      if (rule.field === "id") resourceId(scope, uri, creationKind(operation) as ResourceKind);
      if (rule.alias && uri.startsWith(`${scope}alias/`))
        throw new MemberMetadataError("alias reference lacks its resolution witness");
      return Object.freeze({ slot, kind: "direct" as const, uri });
    });
    if (rules.some((rule) => rule.required && !seen.has(rule.field)))
      throw new MemberMetadataError("missing required reference witness");
    let creation: CreationBinding | undefined;
    if (Object.hasOwn(data, "creation")) {
      assertCreationWitnesses(witnesses);
      const kind = creationKind(operation);
      if (!kind) throw new MemberMetadataError("noncreator metadata cannot allocate an identity");
      const fact = binding(data.creation, scope, kind, false);
      if (fact.kind !== "bound")
        throw new MemberMetadataError("creation metadata requires an allocation");
      creation = fact;
      const supplied = witnesses.find((w) => w.slot === "/id");
      if (supplied && (supplied.kind !== "direct" || supplied.uri !== fact.id))
        throw new MemberMetadataError("allocation differs from supplied identity witness");
    }
    return remember({
      format: metadataFormat,
      scope,
      operation,
      witnesses: Object.freeze(witnesses),
      ...(creation === undefined ? {} : { creation }),
    });
  } catch (cause) {
    if (cause instanceof MemberMetadataError) throw cause;
    if (cause instanceof JsonSyntaxError || cause instanceof ProtocolArtifactValidationError)
      throw new MemberMetadataError("invalid serialized member metadata", { cause });
    throw cause;
  }
}
