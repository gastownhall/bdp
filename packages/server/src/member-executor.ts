import {
  type BeadRecord,
  type LinkRecord,
  type JsonNumberDiagnosticBudget,
  type MaximumEndpointMultiplicityPolicy,
  type PreparedReadUpdateCarrier,
  type ReadUpdateAliasResult,
  type ReadUpdateMutationResult,
  type ReadUpdateOperation,
  type ReadUpdateProblem,
  admitJsonNumbers,
  assertPreparedReadUpdateCarrier,
  decodeJsonDocument,
  parseCanonicalScope,
  parseReadUpdateAliasResult,
  parseReadUpdateMutationResult,
  parseReadUpdateProblem,
  resolveCanonicalLocalResourceId,
  stringifyJsonValue,
} from "@bdp/protocol";
import { assertAliasDiagnosticLimits, evaluateAliasMutation } from "./alias-evaluator.js";
import {
  type CreationBinding,
  type MemberCreatorBinding,
  type MemberMetadata,
  type MemberReferenceSlot,
  capturedMemberAlias,
  normalizePreparedMemberIdentity,
  parseMemberMetadata,
  prepareMemberDependencies,
  prepareMemberExecution,
  serializeMemberMetadata,
} from "./member-identity.js";
import {
  type Admission,
  type KeyState,
  type MemberDecision,
  type RecoveryStore,
  type RetainedOutcomeRow,
  type StoreReader,
  recoveryIdentityFingerprint,
} from "./recovery-store.js";
import {
  type ResourceContractRegistry,
  type ResourceEvaluationOptions,
  type ResourceMutationPolicy,
  evaluateResourceMutation,
} from "./resource-evaluator.js";
import {
  SEMANTIC_VALUE_FORMAT,
  encodeSemanticValue,
  UNBOUND_SEMANTIC_REFERENCE,
  type SemanticValue,
} from "./semantic-identity.js";
import { mayDiscloseRetainedResource } from "./retained-disclosure.js";

/** Authentication/provenance is authority-owned, not established by this shape. */
export interface StablePrincipal {
  readonly id: string;
}
export type MemberDisposition =
  | ReadUpdateMutationResult
  | ReadUpdateAliasResult
  | ReadUpdateProblem;
export interface MemberTurn {
  readonly disposition: MemberDisposition;
  readonly storage: "retained" | "replayed" | "expired" | "conflict" | "released" | "in-progress";
  readonly creator?: MemberCreatorBinding;
}
export interface MemberContext {
  readonly policyIdentity: string;
  readonly configurationIdentity: string;
  readonly policy: ResourceMutationPolicy & { canWriteBead(record: BeadRecord): boolean };
  readonly maximumEndpointMultiplicity: readonly MaximumEndpointMultiplicityPolicy[];
  readonly recordChangeContext: boolean;
}
export interface MemberExecutorOptions {
  readonly scope: string;
  readonly limits: ResourceEvaluationOptions["limits"];
  readonly numericBudget: JsonNumberDiagnosticBudget;
  readonly retentionMs: number;
  /** Actual configured S6 floor, supplied by its construction owner. */
  readonly minimumRetentionMs: number;
  readonly clock: () => number;
  readonly contracts: ResourceContractRegistry;
  /** Must return callbacks bound to immutable current principal/policy/contract
   * data, not closures observing mid-turn changes. Copying/freezing a function
   * cannot prove that property. The authority must qualify this synchronous owner. */
  captureMemberContext(reader: StoreReader, principal: StablePrincipal): MemberContext;
}
export class MemberIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MemberIntegrityError";
  }
}
/** Non-wire unsupported composition boundary. Attempt owner stops and cleans
 * only its claims. No fallback Problem/creator fact may escape this exception. */
export class UnimplementedAliasRetryError extends Error {
  constructor(readonly slot: MemberReferenceSlot) {
    super("unimplemented member alias retry");
    this.name = "UnimplementedAliasRetryError";
  }
}
const envelopeFormat = "ru-member-outcome-1";
const operations: readonly ReadUpdateOperation[] = [
  "createBead",
  "updateBeadProperties",
  "deleteBead",
  "createLink",
  "updateLinkProperties",
  "deleteLink",
  "putAlias",
  "deleteAlias",
];
const memberProblems = {
  "binding-unavailable": ["request", 400, "never"],
  "validation-failed": ["validation", 422, "never"],
  "idempotency-conflict": ["conflict", 409, "never"],
  "idempotency-in-progress": ["conflict", 409, "after-delay"],
  "idempotency-expired": ["gone", 410, "never"],
  forbidden: ["authorization", 403, "after-state-change"],
} as const;
function problem(
  code: keyof typeof memberProblems,
  diagnostics?: Extract<ReturnType<typeof prepareMemberExecution>["admission"], { ok: false }>,
): ReadUpdateProblem {
  const [family, status, retry] = memberProblems[code];
  return parseReadUpdateProblem({
    type: `https://github.com/gastownhall/bdp/problems/${family}`,
    code,
    status,
    retry,
    ...(diagnostics
      ? {
          diagnostics: diagnostics.diagnostics,
          ...(diagnostics.diagnosticsTruncated ? { diagnosticsTruncated: true } : {}),
        }
      : {}),
  });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MemberIntegrityError("expected stored object");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value || !value.isWellFormed())
    throw new TypeError(`${label} requires nonempty scalar text`);
}
function epoch(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError("safe nonnegative epoch milliseconds required");
}
function rootId(scope: string, value: string, kind: "bead" | "link"): void {
  if (
    !value.startsWith(scope) ||
    resolveCanonicalLocalResourceId(parseCanonicalScope(scope), kind, value.slice(scope.length)) !==
      value
  )
    throw new MemberIntegrityError("stored Resource identity escaped its canonical Scope/kind");
}
function aliasId(scope: string, value: string): void {
  if (!value.startsWith(`${scope}alias/`))
    throw new MemberIntegrityError("stored alias escaped its Scope");
  // Alias suffix obeys the same canonical safe-segment grammar as Resource IDs.
  rootId(scope, `${scope}beads/${value.slice(scope.length + 6)}`, "bead");
}
function guardedJson(value: string): unknown {
  const admitted = admitJsonNumbers(decodeJsonDocument(value), {
    diagnostic() {
      throw new MemberIntegrityError("stored wire outcome contains an inadmissible number");
    },
  });
  if (!admitted.ok) throw new MemberIntegrityError("stored wire numeric integrity failure");
  return admitted.value;
}
interface Envelope {
  readonly format: typeof envelopeFormat;
  readonly operation: ReadUpdateOperation;
  readonly disposition: MemberDisposition;
}
function linkScope(record: LinkRecord, scope: string): void {
  rootId(scope, record.id, "link");
  for (const reference of [record.source, record.target]) {
    const uri = typeof reference === "string" ? reference : reference.uri;
    if (uri.startsWith(scope)) rootId(scope, uri, "bead");
  }
}
function evaluatedDisposition(result: {
  readonly effect: "success" | "failure";
  readonly outcome: MemberDisposition;
}): MemberDisposition {
  if ("code" in result.outcome !== (result.effect === "failure"))
    throw new MemberIntegrityError("evaluator effect differs from its disposition");
  return result.outcome;
}
function parseDisposition(
  value: unknown,
  operation: ReadUpdateOperation,
  scope: string,
): MemberDisposition {
  const body = record(value);
  if (Object.hasOwn(body, "operationIndex") || Object.hasOwn(body, "operationName"))
    throw new MemberIntegrityError("stored disposition must be unpositioned");
  if (Object.hasOwn(body, "code")) {
    if (Object.hasOwn(body, "outcome"))
      throw new MemberIntegrityError("stored Problem must be positionable without outcome");
    return parseReadUpdateProblem(body);
  }
  const alias = operation === "putAlias" || operation === "deleteAlias";
  if (alias) {
    const result = parseReadUpdateAliasResult(body);
    aliasId(scope, result.alias);
    if ((operation === "deleteAlias") !== (result.outcome === "deleted"))
      throw new MemberIntegrityError("alias result differs from operation");
    if (result.outcome !== "deleted") rootId(scope, result.target, "bead");
    return result;
  }
  const result = parseReadUpdateMutationResult(body);
  const expected = operation.startsWith("create")
    ? "created"
    : operation.startsWith("delete")
      ? "deleted"
      : "updated";
  const kind = operation.includes("Bead") ? "bead" : "link";
  if (result.outcome !== expected)
    throw new MemberIntegrityError("Resource result differs from operation");
  if (result.resource) {
    if (("source" in result.resource ? "link" : "bead") !== kind)
      throw new MemberIntegrityError("Resource result kind differs");
    rootId(scope, result.resource.id, kind);
    if ("source" in result.resource) linkScope(result.resource, scope);
    else
      for (const links of Object.values(result.resource.ownedLinks ?? {}))
        for (const link of links) linkScope(link, scope);
  }
  if (result.deleted) {
    if (result.deleted.resourceKind !== kind)
      throw new MemberIntegrityError("deleted result kind differs");
    rootId(scope, result.deleted.resource.id, kind);
  }
  if (result.source !== undefined) rootId(scope, result.source, "bead");
  return result;
}
function parseEnvelope(value: string, effect: "success" | "failure", scope: string): Envelope {
  if (effect !== "success" && effect !== "failure")
    throw new MemberIntegrityError("invalid stored effect");
  const envelope = record(guardedJson(value));
  if (
    Object.keys(envelope).length !== 3 ||
    !["format", "operation", "disposition"].every((key) => Object.hasOwn(envelope, key)) ||
    envelope.format !== envelopeFormat ||
    !operations.includes(envelope.operation as ReadUpdateOperation)
  )
    throw new MemberIntegrityError("unsupported or malformed member outcome envelope");
  const operation = envelope.operation as ReadUpdateOperation;
  const disposition = parseDisposition(envelope.disposition, operation, scope);
  if ("code" in disposition !== (effect === "failure"))
    throw new MemberIntegrityError("outcome effect differs");
  if (
    "code" in disposition &&
    (disposition.retry === "after-delay" ||
      disposition.code === "idempotency-conflict" ||
      disposition.code === "idempotency-expired")
  )
    throw new MemberIntegrityError("projection/transient outcome cannot be retained");
  return Object.freeze({ format: envelopeFormat, operation, disposition });
}
/** Narrow authority-startup visitor consumer, not a population/version migration.
 * The owner expires only permitted rows first and refuses startup on any error.
 * This cannot inspect expired normalization provenance or qualify the formatter. */
export function assertRetainedOutcomeCompatible(
  row: RetainedOutcomeRow,
  scope: string,
  limits: ResourceEvaluationOptions["limits"],
): void {
  parseCanonicalScope(scope);
  assertAliasDiagnosticLimits(limits);
  epoch(row.completedAt);
  epoch(row.retainUntil);
  if (row.retainUntil < row.completedAt)
    throw new MemberIntegrityError("retained times are reversed");
  const { disposition } = parseEnvelope(row.outcomeJson, row.effect, scope);
  if ("code" in disposition && disposition.diagnostics) {
    if (
      (limits.diagnosticCount !== undefined &&
        disposition.diagnostics.length > limits.diagnosticCount) ||
      (limits.diagnosticBytes !== undefined &&
        Buffer.byteLength(stringifyJsonValue(disposition.diagnostics)) > limits.diagnosticBytes)
    )
      throw new MemberIntegrityError("surviving retained diagnostics exceed configured bounds");
  }
}
function witnessTarget(metadata: MemberMetadata, field: string): string | undefined {
  const witness = metadata.witnesses.find(
    (item) => item.slot === `/${field}` || item.slot === `/${field}/uri`,
  );
  if (!witness) return undefined;
  if (witness.kind === "direct") return witness.uri;
  if (witness.kind === "alias") return witness.target ?? undefined;
  return witness.binding.kind === "bound" ? witness.binding.id : undefined;
}
function creation(operation: ReadUpdateOperation): boolean {
  return operation === "createBead" || operation === "createLink";
}
function assertSuccessfulWitnesses(metadata: MemberMetadata): void {
  if (
    metadata.witnesses.some(
      (w) =>
        (w.kind === "binding" && w.binding.kind === "unbound") ||
        (w.kind === "alias" && w.target === null),
    )
  )
    throw new MemberIntegrityError("successful member has unavailable witnesses");
}
function coherent(metadata: MemberMetadata, envelope: Envelope): void {
  if (metadata.operation !== envelope.operation)
    throw new MemberIntegrityError("stored operation and metadata differ");
  const success = !("code" in envelope.disposition);
  if ((metadata.creation !== undefined) !== (success && creation(metadata.operation)))
    throw new MemberIntegrityError("stored creation metadata differs from outcome");
  if (!success) return;
  const result = envelope.disposition;
  if ("code" in result) return;
  assertSuccessfulWitnesses(metadata);
  if ("alias" in result) {
    if (
      witnessTarget(metadata, "alias") !== result.alias ||
      (result.outcome !== "deleted" && witnessTarget(metadata, "target") !== result.target)
    )
      throw new MemberIntegrityError("alias outcome differs from witnesses");
  } else {
    const id = result.resource?.id ?? result.deleted?.resource.id;
    const field = creation(metadata.operation)
      ? "id"
      : metadata.operation.includes("Bead")
        ? "bead"
        : "link";
    const target = witnessTarget(metadata, field);
    if (
      (target !== undefined && target !== id) ||
      (metadata.creation && metadata.creation.id !== id)
    )
      throw new MemberIntegrityError("Resource outcome differs from identity witnesses");
    if (result.resource && "source" in result.resource && metadata.operation === "createLink") {
      for (const side of ["source", "target"] as const) {
        const ref = result.resource[side];
        if (witnessTarget(metadata, side) !== (typeof ref === "string" ? ref : ref.uri))
          throw new MemberIntegrityError("created Link endpoint differs from witnesses");
      }
    }
  }
}
/** Inspect only the codec's member/object framing. Expected reference nodes
 * come from the codec owner itself, never a second equality encoder or a
 * reconstruction of arbitrary/refused property values. */
function identityObject(value: unknown): ReadonlyMap<string, unknown> {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value[0] !== "object" ||
    !Array.isArray(value[1])
  )
    throw new MemberIntegrityError("malformed semantic member object");
  const fields = new Map<string, unknown>();
  let previous: string | undefined;
  for (const pair of value[1]) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      (previous !== undefined && previous >= pair[0])
    )
      throw new MemberIntegrityError("malformed semantic member fields");
    previous = pair[0];
    fields.set(pair[0], pair[1]);
  }
  return fields;
}
function identityOperation(value: string, metadata: MemberMetadata, envelope: Envelope): void {
  const decoded = decodeJsonDocument(value);
  if (!Array.isArray(decoded) || decoded.length !== 2 || decoded[0] !== SEMANTIC_VALUE_FORMAT)
    throw new MemberIntegrityError("unsupported retained semantic codec");
  const root = identityObject(decoded[1]);
  const same = (node: unknown, expected: SemanticValue): boolean => {
    const encoded = decodeJsonDocument(encodeSemanticValue(expected));
    if (!Array.isArray(encoded)) throw new MemberIntegrityError("codec lost its root");
    return stringifyJsonValue(node) === stringifyJsonValue(encoded[1]);
  };
  if (
    root.size !== 2 ||
    !root.has("normalizedInput") ||
    !same(root.get("operation"), metadata.operation)
  )
    throw new MemberIntegrityError("semantic identity operation differs from metadata");
  const input = identityObject(root.get("normalizedInput"));
  for (const witness of metadata.witnesses) {
    const [field, nested] = witness.slot.slice(1).split("/");
    if (!field) throw new MemberIntegrityError("metadata lost its reference slot");
    const node = nested ? identityObject(input.get(field)).get(nested) : input.get(field);
    const expected =
      witness.kind === "direct"
        ? witness.uri
        : witness.kind === "alias"
          ? (witness.target ?? { unresolvedAlias: witness.locator })
          : witness.binding.kind === "bound"
            ? witness.binding.id
            : UNBOUND_SEMANTIC_REFERENCE;
    if (!same(node, expected))
      throw new MemberIntegrityError("semantic identity differs from reference metadata");
  }
  const result = envelope.disposition;
  if (
    creation(metadata.operation) &&
    !("code" in result) &&
    "resource" in result &&
    result.resource &&
    !same(input.get("type"), result.resource.type)
  )
    throw new MemberIntegrityError("created Type differs from semantic identity");
}
function terminal(clock: () => number): number {
  const value: unknown = clock();
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    Promise.resolve(value).catch(() => {});
    throw new TypeError("terminal clock must be synchronous");
  }
  epoch(value);
  return value;
}
function snapshotOptions(options: MemberExecutorOptions): MemberExecutorOptions {
  const {
    scope,
    limits,
    numericBudget,
    retentionMs,
    minimumRetentionMs,
    clock,
    contracts,
    captureMemberContext,
  } = options;
  parseCanonicalScope(scope);
  epoch(retentionMs);
  epoch(minimumRetentionMs);
  if (minimumRetentionMs < 86_400_000 || retentionMs < minimumRetentionMs)
    throw new TypeError("explicit retention must preserve the configured S6 floor");
  const bounds = Object.freeze({ ...limits });
  for (const bound of Object.values(bounds))
    if (bound !== undefined && (!Number.isSafeInteger(bound) || bound < 1))
      throw new TypeError("positive safe limits required");
  const budget = Object.freeze({ ...numericBudget });
  if (
    budget.diagnostics !== bounds.diagnosticCount ||
    budget.diagnosticBytes !== bounds.diagnosticBytes
  )
    throw new TypeError("numeric and semantic diagnostic budgets differ");
  assertAliasDiagnosticLimits(bounds);
  const get = contracts.get;
  if (
    typeof clock !== "function" ||
    typeof captureMemberContext !== "function" ||
    typeof budget.diagnostic !== "function" ||
    typeof get !== "function"
  )
    throw new TypeError("qualified synchronous executor configuration required");
  return Object.freeze({
    scope,
    limits: bounds,
    numericBudget: budget,
    retentionMs,
    minimumRetentionMs,
    clock,
    contracts: Object.freeze({
      get: (type: string, bytes: string) => get.call(contracts, type, bytes),
    }),
    captureMemberContext: (reader: StoreReader, principal: StablePrincipal) =>
      captureMemberContext.call(options, reader, principal),
  });
}
// S5 captures this unchanged configuration before taking admission ownership.
export { snapshotOptions as snapshotMemberExecutorOptions };

function capture(
  options: MemberExecutorOptions,
  reader: StoreReader,
  principal: StablePrincipal,
  principalId: string,
): MemberContext {
  if (principal.id !== principalId)
    throw new MemberIntegrityError("principal changed before member context capture");
  // Preserve the original facade's receiver and expiring S6 lifetime, without
  // exposing transaction writers or allocators through structural subtyping.
  const view: StoreReader = Object.freeze({
    resource: reader.resource.bind(reader),
    resources: reader.resources.bind(reader),
    incidentLinks: reader.incidentLinks.bind(reader),
    outgoingLinks: reader.outgoingLinks.bind(reader),
    alias: reader.alias.bind(reader),
    identityWasCommitted: reader.identityWasCommitted.bind(reader),
    installedType: reader.installedType.bind(reader),
    policy: reader.policy.bind(reader),
    key: reader.key.bind(reader),
  });
  const current = options.captureMemberContext(view, principal);
  const {
    policyIdentity,
    configurationIdentity,
    recordChangeContext,
    maximumEndpointMultiplicity: aggregate,
    policy: source,
  } = current;
  text(policyIdentity, "policy identity");
  text(configurationIdentity, "configuration identity");
  if (typeof recordChangeContext !== "boolean")
    throw new TypeError("explicit context recording configuration required");
  const { canRead, canCreate, canWrite, canWriteBead } = source;
  if ([canRead, canCreate, canWrite, canWriteBead].some((fn) => typeof fn !== "function"))
    throw new TypeError("complete current member policy required");
  const policy = Object.freeze({
    canRead: canRead.bind(source),
    canCreate: canCreate.bind(source),
    canWrite: canWrite.bind(source),
    canWriteBead: canWriteBead.bind(source),
  });
  const maximumEndpointMultiplicity = Object.freeze(
    aggregate.map((item) => Object.freeze({ ...item })),
  );
  return Object.freeze({
    policy,
    maximumEndpointMultiplicity,
    recordChangeContext,
    policyIdentity,
    configurationIdentity,
  });
}
function turn(
  disposition: MemberDisposition,
  storage: MemberTurn["storage"],
  operation: ReadUpdateOperation,
  creator?: MemberCreatorBinding,
): MemberTurn {
  const fact = !creation(operation)
    ? undefined
    : (creator ??
      Object.freeze({
        kind:
          "code" in disposition && disposition.retry === "after-delay"
            ? ("transient" as const)
            : ("unbound" as const),
      }));
  return Object.freeze({ disposition, storage, ...(fact === undefined ? {} : { creator: fact }) });
}
function sameState(first: KeyState, next: KeyState): boolean {
  const keys = Object.keys(first) as (keyof typeof first)[];
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) => first[key] === (next as typeof first)[key])
  );
}

/** One synchronous member under the authority's exclusive immutable-turn owner.
 * No admission, expiry, whole-attempt cleanup, scheduler or HTTP policy here.
 * New/unaffected population provenance or reviewed compatibility is required
 * before corrected empty-context equality is used against historical stores. */
export function runMember(
  store: RecoveryStore,
  admission: Admission,
  principal: StablePrincipal,
  carrier: PreparedReadUpdateCarrier,
  index: number,
  creators: (earlierIndex: number) => MemberCreatorBinding,
  supplied: MemberExecutorOptions,
): MemberTurn {
  const options = snapshotOptions(supplied);
  const principalId = principal.id;
  text(principalId, "authenticated principal");
  if (principalId !== admission.principal || options.scope !== store.scope)
    throw new TypeError("member principal/Scope does not match its Admission/store");
  assertPreparedReadUpdateCarrier(carrier, options.scope);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= carrier.operations.length ||
    carrier.keys.length !== admission.keys.length ||
    carrier.keys.some((key, i) => key !== admission.keys[i])
  )
    throw new TypeError("member index/complete Admission key inventory differs");
  const original = carrier.operations[index];
  const key = carrier.keys[index];
  if (!original || key === undefined) throw new TypeError("prepared carrier lost its member");
  const operation = original.operation;
  const prepared = prepareMemberDependencies(carrier, index, options.scope, creators);
  if (prepared.kind === "transient-dependency") {
    store.releaseOwnedClaim(admission, key);
    return turn(problem("idempotency-in-progress"), "in-progress", operation);
  }
  let staged:
    | { disposition: MemberDisposition; outcomeJson?: string; creator?: CreationBinding }
    | undefined;
  const completion = store.executeMember(admission, key, (tx): MemberDecision => {
    const context = capture(options, tx, principal, principalId);
    const member = normalizePreparedMemberIdentity(
      carrier,
      index,
      {
        scope: options.scope,
        resolveAlias(locator) {
          const target = tx.alias(locator.slice(options.scope.length + 6));
          return target === undefined ? undefined : `${options.scope}${target}`;
        },
      },
      prepared,
    );
    if (member.kind !== "ready") throw new UnimplementedAliasRetryError(member.slot);
    const values = prepareMemberExecution(member, options.numericBudget);
    let disposition: MemberDisposition;
    if (!values.admission.ok) disposition = problem("validation-failed", values.admission);
    else if (values.unavailableBinding) disposition = problem("binding-unavailable");
    else {
      const executable = values.executable;
      if (!executable) throw new MemberIntegrityError("admitted executable pair is absent");
      if (executable.operation === "putAlias" || executable.operation === "deleteAlias")
        disposition = evaluatedDisposition(
          evaluateAliasMutation(tx, executable, {
            scope: options.scope,
            policy: context.policy,
            limits: options.limits,
          }),
        );
      else
        disposition = evaluatedDisposition(
          evaluateResourceMutation(
            {
              ...tx,
              alias(path) {
                const captured = capturedMemberAlias(member, path);
                return captured.captured ? captured.target : tx.alias(path);
              },
            },
            executable,
            {
              scope: options.scope,
              contracts: options.contracts,
              policy: context.policy,
              maximumEndpointMultiplicity: context.maximumEndpointMultiplicity,
              observeCommitTime: options.clock,
              recordChangeContext: context.recordChangeContext,
              limits: options.limits,
            },
          ),
        );
    }
    disposition = parseDisposition(disposition, operation, options.scope);
    if ("code" in disposition && disposition.retry === "after-delay") {
      staged = { disposition };
      return { kind: "release" };
    }
    const effect = "code" in disposition ? "failure" : "success";
    const resolutionsJson = serializeMemberMetadata(
      member,
      effect === "success" && creation(operation)
        ? (disposition as ReadUpdateMutationResult)
        : undefined,
    );
    const metadata = parseMemberMetadata(resolutionsJson, options.scope);
    const outcomeJson = stringifyJsonValue({ format: envelopeFormat, operation, disposition });
    const envelope = parseEnvelope(outcomeJson, effect, options.scope);
    coherent(metadata, envelope);
    const completedAt = terminal(options.clock);
    const retainUntil = completedAt + options.retentionMs;
    epoch(retainUntil);
    staged = {
      disposition: envelope.disposition,
      outcomeJson,
      ...(metadata.creation ? { creator: metadata.creation } : {}),
    };
    return {
      kind: "retain",
      semanticIdentityJson: member.identityJson,
      resolutionsJson,
      outcomeJson,
      effect,
      completedAt,
      retainUntil,
    };
  });
  if (completion.kind === "completed") {
    if (!staged || staged.outcomeJson !== completion.outcomeJson)
      throw new MemberIntegrityError("completed member differs from its staged envelope");
    return turn(staged.disposition, "retained", operation, staged.creator);
  }
  if (completion.kind === "released") {
    if (
      !staged ||
      staged.outcomeJson !== undefined ||
      !("code" in staged.disposition) ||
      staged.disposition.retry !== "after-delay"
    )
      throw new MemberIntegrityError("released member lacks a staged transient");
    return turn(staged.disposition, "released", operation);
  }
  if (staged) throw new MemberIntegrityError("existing key unexpectedly evaluated");
  if (completion.state.kind === "claimed")
    return turn(problem("idempotency-in-progress"), "in-progress", operation);
  const expected = completion.state;
  if (expected.kind !== "retained" && expected.kind !== "expired")
    throw new MemberIntegrityError("unexpected existing key state");
  return store.read((reader) => {
    const state = reader.key(principalId, key);
    if (!sameState(expected, state) || (state.kind !== "retained" && state.kind !== "expired"))
      throw new MemberIntegrityError("existing key changed across synchronous ownership");
    const metadata = parseMemberMetadata(state.resolutionsJson, options.scope);
    let envelope: Envelope | undefined;
    if (state.kind === "retained") {
      envelope = parseEnvelope(state.outcomeJson, state.effect, options.scope);
      coherent(metadata, envelope);
      identityOperation(state.semanticIdentityJson, metadata, envelope);
      if (recoveryIdentityFingerprint(state.semanticIdentityJson) !== state.fingerprint)
        throw new MemberIntegrityError("retained fingerprint differs from exact identity");
    } else {
      assertSuccessfulWitnesses(metadata);
      if (creation(metadata.operation) && !metadata.creation)
        throw new MemberIntegrityError("expired creator has no successful creation fact");
    }
    const context = capture(options, reader, principal, principalId);
    if (metadata.operation !== operation)
      return turn(problem("idempotency-conflict"), "conflict", operation);
    const member = normalizePreparedMemberIdentity(
      carrier,
      index,
      {
        scope: options.scope,
        prior: metadata,
        resolveAlias() {
          throw new MemberIntegrityError("replay attempted live alias lookup");
        },
      },
      prepared,
    );
    if (member.kind !== "ready") throw new UnimplementedAliasRetryError(member.slot);
    const equal =
      state.kind === "retained"
        ? member.identityJson === state.semanticIdentityJson
        : recoveryIdentityFingerprint(member.identityJson) === state.fingerprint;
    if (!equal) return turn(problem("idempotency-conflict"), "conflict", operation);
    if (state.kind === "expired")
      return turn(problem("idempotency-expired"), "expired", operation, metadata.creation);
    if (!envelope) throw new MemberIntegrityError("lost retained envelope");
    const result = envelope.disposition;
    const disposition =
      !("code" in result) &&
      "resource" in result &&
      result.resource &&
      !mayDiscloseRetainedResource(reader, result.resource, options.scope, context.policy)
        ? problem("forbidden")
        : result;
    return turn(disposition, "replayed", operation, metadata.creation);
  });
}
