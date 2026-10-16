/** Private Transactional evaluator. Bounded sets share singleton/batch syntax and admission. */
import {
  prepareSetShape,
  validateSetSelector,
  type TransactionSetOperation,
  transactionInputText as losslessText,
  TRANSACTION_SELECTOR_LIMITS,
  type PreparedTransactionSet,
} from "./transaction-set.js";
import { selectReadResources } from "./read-selector.js";
import { snapshotReadUpdateRuntimeLimits } from "./read-update-runtime-limits.js";
import { memberNumericDiagnosticBudget } from "./member-numeric-diagnostics.js";
import {
  JsonNumberLiteral,
  admitJsonNumbers,
  compareCanonicalIds,
  parseCanonicalScope,
  type UnadmittedReadUpdateOperation,
  decodeJsonDocument,
  prepareReadUpdateSequence,
  prepareReadUpdateSingleton,
  admitReadUpdateOperationNumbers,
  referenceUri,
  stringifyJsonValue,
  parseCanonicalHttpUrl,
  assertCanonicalPathSegments,
  type LosslessJsonValue,
  type ReadUpdateProblem,
  type ReadUpdateOperation,
  type PreparedReadUpdateCarrier,
} from "@bdp/protocol";
import {
  encodeSemanticValue,
  UNBOUND_SEMANTIC_REFERENCE,
  type SemanticValue,
} from "./semantic-identity.js";
import {
  evaluateAliasMutation,
  type AliasMutation,
  type AliasTransaction,
  type AliasEvaluationOptions,
} from "./alias-evaluator.js";
import {
  evaluateResourceMutation,
  isResourceVisible,
  readStoredResource,
  type ResourceMutation,
  type ResourceOperation,
  type ResourceEvaluationOptions,
  type ResourceTransaction,
  type ResourceRecord,
} from "./resource-evaluator.js";

export { TransactionDevelopmentLimitError } from "./transaction-set.js";

class EventExpansionLimit extends Error {}
class MatchExpansionLimit extends Error {}

/** Private owner bounds. Check first-diagnostic feasibility against the same
 * receiving/property caps, including pointer escaping. No profile advertisement. */
export const TRANSACTION_RUNTIME_LIMITS = Object.freeze({
  maximumOperations: 32,
  inducedEvents: 256,
  matchedResources: 32,
  representationBytes: 256 * 1024,
  scopeSourceBytes: 64 * 1024,
  requestBodyBytes: 64 * 1024,
  propertiesBytes: 64 * 1024,
  diagnosticBytes: 512 * 1024,
  diagnosticCount: 16,
});
export const TRANSACTION_MAXIMUM_OPERATIONS: number = TRANSACTION_RUNTIME_LIMITS.maximumOperations;
snapshotReadUpdateRuntimeLimits(TRANSACTION_RUNTIME_LIMITS);

export type TransactionSingletonOperation = ReadUpdateOperation | TransactionSetOperation;

export interface PreparedTransaction {
  readonly carrier: Omit<PreparedReadUpdateCarrier, "operations"> & {
    readonly operations: readonly (UnadmittedReadUpdateOperation | PreparedTransactionSet)[];
  };
}
const prepared = new WeakSet<object>();
function assertResourceOperation(operation: unknown): asserts operation is ResourceOperation {
  if (
    typeof operation !== "string" ||
    !["createBead", "createLink", "updateBead", "updateLink", "deleteBead", "deleteLink"].includes(
      operation,
    )
  )
    throw new TypeError("unsupported development transaction operation");
}
function object(value: LosslessJsonValue | undefined): Record<string, LosslessJsonValue> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof JsonNumberLiteral
  )
    throw new TypeError("expected object");
  return value as Record<string, LosslessJsonValue>;
}
/** Whole-carrier syntax/Scope checks happen before consulting any durable key.
 * Reuses RU parsing, not RU admission or identity: synthetic member keys never
 * enter storage. This layer parses only the six Resource operation kinds. */
function prepareResourceBatch(scope: string, text: string): PreparedTransaction {
  if (Buffer.byteLength(text) > TRANSACTION_RUNTIME_LIMITS.requestBodyBytes)
    throw new RangeError("development batch byte limit");
  const root = object(decodeJsonDocument(text));
  if (
    Object.keys(root).length !== 1 ||
    !Array.isArray(root.operations) ||
    root.operations.length < 1
  )
    throw new TypeError("expected nonempty batch operations");
  const operations = root.operations.map((value, index) => {
    const op = object(value);
    assertResourceOperation(op.operation);
    if (Object.hasOwn(op, "idempotencyKey")) throw new TypeError("batch members cannot carry keys");
    return { ...op, idempotencyKey: `internal-${index}` };
  });
  return prepareCarrier(prepareReadUpdateSequence(scope, losslessText({ operations })));
}
/** One mixed carrier syntax path with complete bounded Selector grammar. */
export function prepareTransaction(scope: string, text: string): PreparedTransaction {
  return prepareTransactionSetCore(scope, text);
}
/** Retained source-private test seam uses the same mixed preparation. */
export function prepareTransactionSetCore(
  scope: string,
  text: string,
  singleton = false,
): PreparedTransaction {
  if (Buffer.byteLength(text) > TRANSACTION_RUNTIME_LIMITS.requestBodyBytes)
    throw new RangeError("development batch byte limit");
  return prepareMixedTransaction(scope, object(decodeJsonDocument(text)), singleton);
}
function prepareMixedTransaction(
  scope: string,
  root: Record<string, LosslessJsonValue>,
  singleton: boolean,
): PreparedTransaction {
  if (Object.keys(root).length !== 1 || !Array.isArray(root.operations) || !root.operations.length)
    throw new TypeError("expected nonempty batch operations");
  if (singleton && root.operations.length !== 1) throw new TypeError("expected one core operation");
  const canonicalScope = parseCanonicalScope(scope);
  const raw = root.operations.map(object);
  const resourceInputs = raw.filter(
    (op) => op.operation !== "updateWhere" && op.operation !== "deleteWhere",
  );
  // Existing parser owns reference syntax, label order/kind/uniqueness and brands.
  // Removing sets preserves relative Resource order; sets cannot declare labels.
  const resources = resourceInputs.length
    ? prepareResourceBatch(scope, losslessText({ operations: resourceInputs })).carrier.operations
    : [];
  let index = 0;
  const operations = raw.map((op) => {
    if (op.operation !== "updateWhere" && op.operation !== "deleteWhere") {
      const resource = resources[index++];
      if (!resource) throw new Error("missing prepared Resource operation");
      return resource;
    }
    const { operation, ...input } = op;
    return prepareSetShape(canonicalScope, operation, Object.freeze(input));
  });
  // Finish every shape/reference/label and Selector grammar check before admission.
  for (const [index, op] of operations.entries())
    if (op.operation === "updateWhere" || op.operation === "deleteWhere")
      validateSetSelector(
        op,
        singleton ? "/selector" : `/operations/${index}/selector`,
        TRANSACTION_RUNTIME_LIMITS.requestBodyBytes,
      );
  return prepareCarrier(
    Object.freeze({
      scope: canonicalScope,
      kind: singleton ? "singleton" : "sequence",
      operations: Object.freeze(operations),
      keys: Object.freeze([]),
    }),
  );
}
/** A singleton is the same one-operation Transactional request, not a RU
 * execution. Its raw record excludes the discriminator, label and body key.
 * Synthetic parsing keys are never consulted or persisted by the owner. */
export function prepareTransactionSingleton(
  scope: string,
  operation: TransactionSingletonOperation,
  text: string,
): PreparedTransaction {
  return prepareSingletonForReceiving(scope, operation, text);
}
/** Private receiving syntax only; the owner decides capacity after retained-key comparison. */
export function prepareTransactionForReceiving(
  scope: string,
  carrier:
    | { readonly kind: "batch" }
    | { readonly kind: "singleton"; readonly operation: TransactionSingletonOperation },
  text: string,
): PreparedTransaction {
  if (carrier.kind === "singleton")
    return prepareSingletonForReceiving(scope, carrier.operation, text);
  if (Buffer.byteLength(text) > TRANSACTION_RUNTIME_LIMITS.requestBodyBytes)
    throw new RangeError("development batch byte limit");
  return prepareMixedTransaction(scope, object(decodeJsonDocument(text)), false);
}
function prepareSingletonForReceiving(
  scope: string,
  operation: TransactionSingletonOperation,
  text: string,
): PreparedTransaction {
  if (
    operation !== "updateWhere" &&
    operation !== "deleteWhere" &&
    operation !== "putAlias" &&
    operation !== "deleteAlias"
  )
    assertResourceOperation(operation);
  if (Buffer.byteLength(text) > TRANSACTION_RUNTIME_LIMITS.requestBodyBytes)
    throw new RangeError("development singleton byte limit");
  // Preserve complete lossless root validation before choosing the singleton parser.
  const input = object(decodeJsonDocument(text));
  if (operation === "updateWhere" || operation === "deleteWhere") {
    // A raw discriminator must never replace the route. The single mixed pass
    // below validates all remaining closed fields and the complete set shape.
    if (Object.hasOwn(input, "operation")) throw new TypeError("singleton cannot carry operation");
    // The byte cap applies to the submitted body, not a synthetic carrier.
    return prepareMixedTransaction(scope, { operations: [{ operation, ...input }] }, true);
  }
  const carrier = prepareReadUpdateSingleton(scope, operation, text, "internal-singleton");
  return prepareCarrier(carrier);
}
export interface PreparedTransactionSequence {
  readonly scope: string;
  readonly members: readonly {
    readonly key: string;
    readonly operation: ReadUpdateOperation;
    readonly name?: string;
    readonly request: PreparedTransaction;
    readonly aliasOperands: readonly { readonly field: string; readonly locator: string }[];
    readonly deferred: boolean;
    readonly dependencies: readonly {
      field: string;
      creator: number;
      resourceKind: "bead" | "link";
      suppliedId?: string;
    }[];
  }[];
}
const sequences = new WeakSet<object>();
/** First private sequence boundary. Full syntax/Scope checks precede all key
 * effects; creator and alias operands retain deferred turn-time reservations. */
export function prepareTransactionSequence(
  scope: string,
  text: string,
): PreparedTransactionSequence {
  return prepareSequence(scope, text);
}
/** Private receiving syntax; retained member identity precedes fresh capacity. */
export function prepareTransactionSequenceForReceiving(
  scope: string,
  text: string,
): PreparedTransactionSequence {
  return prepareSequence(scope, text);
}
function prepareSequence(scope: string, text: string): PreparedTransactionSequence {
  if (Buffer.byteLength(text) > TRANSACTION_RUNTIME_LIMITS.requestBodyBytes)
    throw new RangeError("development sequence byte limit");
  const carrier = prepareReadUpdateSequence(scope, text);
  if (carrier.operations.length > TRANSACTION_MAXIMUM_OPERATIONS)
    throw new RangeError("development sequence member limit");
  const labels = new Map<string, number>();
  const members = carrier.operations.map((op, index) => {
    const aliasOperands: { readonly field: string; readonly locator: string }[] = [];
    const dependencies: {
      field: string;
      creator: number;
      resourceKind: "bead" | "link";
      suppliedId?: string;
    }[] = [];
    for (const field of ["bead", "link", "source", "target"]) {
      const ref = op.input[field];
      if (ref === undefined) continue;
      const uri = typeof ref === "string" ? ref : (ref as { uri: string }).uri;
      if (uri.startsWith("@")) {
        const creator = labels.get(uri.slice(1));
        if (creator === undefined) throw new TypeError("unknown sequence creator");
        const creation = carrier.operations[creator];
        if (!creation) throw new Error("prepared sequence lost creator");
        const supplied = creation.input.id as string | undefined;
        dependencies.push({
          field,
          creator,
          resourceKind: creation.operation === "createBead" ? "bead" : "link",
          ...(supplied === undefined ? {} : { suppliedId: canonicalReference(scope, supplied) }),
        });
      }
      if (
        transactionAliasFields(op.operation).includes(field) &&
        canonicalReference(scope, uri).startsWith(`${scope}alias/`)
      )
        aliasOperands.push(Object.freeze({ field, locator: canonicalReference(scope, uri) }));
    }
    // The whole carrier already validated backward labels and Resource kinds.
    // Preserve its branded numeric operation without reparsing as a singleton,
    // whose syntax correctly rejects @name outside a sequence.
    const key = carrier.keys[index];
    if (key === undefined) throw new Error("prepared sequence lost member key");
    // The complete carrier parser already validated every label and reference.
    const request = prepareCarrier(
      Object.freeze({
        kind: "singleton",
        scope: carrier.scope,
        operations: Object.freeze([op]),
        keys: Object.freeze([key]),
      }),
    );
    if (op.name) labels.set(op.name, index);
    return Object.freeze({
      key,
      operation: op.operation,
      ...(op.name === undefined ? {} : { name: op.name }),
      request,
      dependencies: Object.freeze(dependencies.map((dependency) => Object.freeze(dependency))),
      aliasOperands: Object.freeze(aliasOperands),
      deferred: dependencies.length > 0 || aliasOperands.length > 0,
    });
  });
  const result = Object.freeze({ scope: carrier.scope, members: Object.freeze(members) });
  sequences.add(result);
  return result;
}
export function assertPreparedTransactionSequence(
  sequence: PreparedTransactionSequence,
  scope: string,
): void {
  if (!sequences.has(sequence) || sequence.scope !== scope)
    throw new TypeError("expected prepared transaction sequence for this Scope");
}
function prepareCarrier(carrier: PreparedTransaction["carrier"]): PreparedTransaction {
  const result = Object.freeze({ carrier });
  prepared.add(result);
  return result;
}
export function assertPreparedTransaction(batch: PreparedTransaction, scope: string): void {
  if (!prepared.has(batch) || batch.carrier.scope !== scope)
    throw new TypeError("expected prepared transaction for this Scope");
}
/** Source-private permitted alias slots shared by preparation and pending validation. */
export function transactionAliasFields(operation: string): readonly string[] {
  if (operation === "createLink") return ["source", "target"];
  if (operation === "updateBead" || operation === "deleteBead") return ["bead"];
  return [];
}
interface OperationWitnesses {
  readonly operation: ReadUpdateOperation | PreparedTransactionSet["operation"];
  readonly aliases: readonly { readonly locator: string; readonly target: string | null }[];
}
const witnessFormat = "transaction-alias-witnesses-1";
function canonicalReference(scope: string, uri: string): string {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri) ? uri : `${scope}${uri}`;
}
function witnessedReference(scope: string, value: unknown, root: "alias" | "beads"): string {
  if (typeof value !== "string" || !value.startsWith(`${scope}${root}/`))
    throw new TypeError("invalid transaction alias witness reference");
  parseCanonicalHttpUrl(value);
  assertCanonicalPathSegments(value.slice(scope.length), "transaction alias witness");
  return value;
}
/** Exact private persistence shape. Corrupt witness data is an owner fault,
 * never a missing alias or an ordinary idempotency mismatch. */
function parseWitnesses(text: string, scope: string): readonly OperationWitnesses[] {
  const data = object(decodeJsonDocument(text));
  if (
    Object.keys(data).length !== 3 ||
    data.format !== witnessFormat ||
    data.scope !== scope ||
    !Array.isArray(data.operations) ||
    data.operations.length < 1 ||
    data.operations.length > TRANSACTION_MAXIMUM_OPERATIONS
  )
    throw new TypeError("invalid transaction alias witness envelope");
  return data.operations.map((value) => {
    const entry = object(value);
    if (Object.keys(entry).length !== 2 || !Array.isArray(entry.aliases))
      throw new TypeError("invalid transaction operation witnesses");
    if (
      entry.operation !== "putAlias" &&
      entry.operation !== "deleteAlias" &&
      entry.operation !== "updateWhere" &&
      entry.operation !== "deleteWhere"
    )
      assertResourceOperation(entry.operation);
    const operation = entry.operation as OperationWitnesses["operation"];
    if (entry.aliases.length > transactionAliasFields(operation).length)
      throw new TypeError("invalid transaction alias witness count");
    const seen = new Set<string>();
    const aliases = entry.aliases.map((value) => {
      const alias = object(value);
      if (Object.keys(alias).length !== 2) throw new TypeError("invalid transaction alias witness");
      const locator = witnessedReference(scope, alias.locator, "alias");
      const target =
        alias.target === null ? null : witnessedReference(scope, alias.target, "beads");
      if (seen.has(locator)) throw new TypeError("duplicate transaction alias witness");
      seen.add(locator);
      return Object.freeze({ locator, target });
    });
    return Object.freeze({ operation, aliases: Object.freeze(aliases) });
  });
}
/** Source-private operand inventory; preparation and comparison share the slot grammar. */
export function transactionAliasOperands(batch: PreparedTransaction) {
  assertPreparedTransaction(batch, batch.carrier.scope);
  const operation = batch.carrier.operations[0];
  if (!operation || batch.carrier.operations.length !== 1) return [];
  return transactionAliasFields(operation.operation).flatMap((field) => {
    const value = operation.input[field];
    if (value === undefined) return [];
    const uri = typeof value === "string" ? value : (value as { uri: string }).uri;
    const locator = canonicalReference(batch.carrier.scope, uri);
    return locator.startsWith(`${batch.carrier.scope}alias/`) ? [{ field, locator }] : [];
  });
}
export interface NormalizedTransaction {
  readonly identity: string;
  readonly witnessesJson: string;
  readonly referenceIdentities: ReadonlyMap<string, string>;
}
const normalizedState = new WeakMap<
  NormalizedTransaction,
  {
    readonly batch: PreparedTransaction;
    readonly aliases: readonly ReadonlyMap<string, string | null>[];
    readonly references: ReadonlyMap<string, string | typeof UNBOUND_SEMANTIC_REFERENCE>;
  }
>();
/** Invoke under the owner's admission/comparison transaction after key lookup.
 * Original per-operation locators win regardless of the retry reference slot.
 * Fresh retry witnesses are comparison-only and never replace durable originals.
 * Batch creator indices remain symbolic; the RU normalizer binds committed IDs
 * and cannot supply that Transactional distinction. */
export function normalizeTransaction(
  batch: PreparedTransaction,
  resolveAlias: (locator: string) => string | undefined,
  priorWitnessesJson?: string,
  references: ReadonlyMap<string, string | typeof UNBOUND_SEMANTIC_REFERENCE> = new Map(),
): NormalizedTransaction {
  assertPreparedTransaction(batch, batch.carrier.scope);
  const scope = batch.carrier.scope;
  const prior =
    priorWitnessesJson === undefined ? undefined : parseWitnesses(priorWitnessesJson, scope);
  const creators = new Map<string, SemanticValue>();
  const referenceIdentities = new Map<string, string>();
  const identities: SemanticValue[] = [];
  const witnesses: OperationWitnesses[] = [];
  const captured: ReadonlyMap<string, string | null>[] = [];
  const canonical = (uri: string): string => canonicalReference(scope, uri);
  for (const [index, op] of batch.carrier.operations.entries()) {
    const creating = op.operation === "createBead" || op.operation === "createLink";
    const input: Record<string, SemanticValue> = {
      ...op.input,
      ...(creating
        ? { properties: op.input.properties ?? {}, metadata: op.input.metadata ?? {} }
        : {}),
    };
    // Empty context supplies no explicit states; null members remain distinct.
    const context = input.revisionProvenance;
    if (context !== null && typeof context === "object" && Object.keys(context).length === 0)
      delete input.revisionProvenance;
    const previous = prior?.[index];
    const aliases = new Map<string, string | null>();
    for (const field of ["id", "source", "target", "bead", "link", "alias"]) {
      const value = input[field];
      if (value === undefined) continue;
      const uri = typeof value === "string" ? value : (value as { uri: string }).uri;
      const locator = canonical(uri);
      let normalized: SemanticValue | undefined;
      if (index === 0 && references.has(field)) normalized = references.get(field);
      else if (
        transactionAliasFields(op.operation).includes(field) &&
        locator.startsWith(`${scope}alias/`)
      ) {
        if (!aliases.has(locator)) {
          const old =
            previous?.operation === op.operation
              ? previous.aliases.find((w) => w.locator === locator)
              : undefined;
          const target = old === undefined ? resolveAlias(locator) : old.target;
          aliases.set(locator, target == null ? null : witnessedReference(scope, target, "beads"));
        }
        normalized = aliases.get(locator) ?? { unresolvedAlias: locator };
      } else normalized = uri.startsWith("@") ? creators.get(uri.slice(1)) : locator;
      if (normalized === undefined) throw new TypeError("unknown batch binding");
      if (index === 0) referenceIdentities.set(field, encodeSemanticValue(normalized));
      input[field] =
        typeof value === "string"
          ? normalized
          : { uri: normalized, revision: (value as { revision: string }).revision };
    }
    identities.push({ operation: op.operation, input });
    captured.push(aliases);
    witnesses.push({
      operation: op.operation,
      aliases: [...aliases].map(([locator, target]) => ({ locator, target })),
    });
    if (creating && op.name)
      creators.set(
        op.name,
        op.input.id === undefined
          ? { creatorIndex: String(index) }
          : canonical(op.input.id as string),
      );
  }
  const result = Object.freeze({
    identity: encodeSemanticValue(identities),
    referenceIdentities,
    witnessesJson: JSON.stringify({ format: witnessFormat, scope, operations: witnesses }),
  });
  normalizedState.set(result, { batch, aliases: captured, references });
  return result;
}
export interface TransactionEvent {
  readonly id: string;
  readonly ordinal: number;
  readonly type: "created" | "updated" | "deleted" | "linked" | "unlinked";
  readonly source: string;
  readonly subject: string;
  readonly subjectType: string;
  readonly transaction: string;
  readonly time: string;
  readonly data: unknown;
}
export interface TransactionStateChange {
  readonly operation: "upsert" | "tombstone";
  readonly resourceKind: "bead" | "link";
  readonly resource:
    | ResourceRecord
    | { readonly id: string; readonly type: string; readonly revision: string };
}
// Source-private receipt subset; shared Read+Update Problems also describe
// receiving/Read failures that are not terminal mutation receipt outcomes.
const receiptProblemCodes = [
  "forbidden",
  "resource-not-found",
  "limit-exceeded",
  "binding-unavailable",
  "validation-failed",
  "type-not-installed",
  "identity-taken",
  "alias-path-taken",
  "revision-mismatch",
  "incident-links-exist",
  "aggregate-constraint-violation",
  "cardinality-violated",
  "revision-allocation-unsafe",
] as const;
type ReceiptProblemCode = (typeof receiptProblemCodes)[number];
const receiptProblemStatuses = [400, 403, 404, 409, 413, 422] as const;
type ReceiptProblemStatus = (typeof receiptProblemStatuses)[number];
function isReceiptCode(value: unknown): value is ReceiptProblemCode {
  return receiptProblemCodes.some((code) => code === value);
}
function isReceiptStatus(value: unknown): value is ReceiptProblemStatus {
  return receiptProblemStatuses.some((status) => status === value);
}
// Restate required receipt fields: mapped Omit over RFC9457's string index
// signature would erase their requirements. Preserve extension fields explicitly.
interface BatchProblem {
  readonly type: string;
  readonly status: ReceiptProblemStatus;
  readonly retry: ReadUpdateProblem["retry"];
  readonly diagnostics?: ReadUpdateProblem["diagnostics"];
  readonly diagnosticsTruncated?: boolean;
  readonly [key: string]: unknown;
}
function receiptProblem(
  problem: ReadUpdateProblem,
): BatchProblem & { readonly code: ReceiptProblemCode } {
  if (
    typeof problem.type !== "string" ||
    !isReceiptCode(problem.code) ||
    !isReceiptStatus(problem.status) ||
    !["never", "after-state-change", "after-delay"].includes(problem.retry)
  )
    throw new Error("evaluator failure lacks required receipt Problem fields");
  return { ...problem, type: problem.type, code: problem.code, status: problem.status };
}
export type BatchEvaluation =
  | {
      readonly ok: true;
      readonly results: readonly unknown[];
      readonly changes: readonly TransactionStateChange[];
      readonly events: readonly TransactionEvent[];
    }
  | {
      readonly ok: false;
      readonly problem: BatchProblem & {
        readonly code: ReceiptProblemCode;
        readonly operationIndex: number;
        readonly operationName?: string;
      };
    }
  | {
      readonly ok: false;
      readonly problem: BatchProblem & {
        readonly code: "limit-exceeded";
        readonly limit: "transaction.inducedEvents" | "transaction.matchedResources";
        readonly operationIndex?: never;
        readonly operationName?: never;
      };
    };
export type TransactionMutationContext = ResourceTransaction &
  AliasTransaction & {
    resources(
      kind: "bead" | "link",
    ): readonly NonNullable<ReturnType<ResourceTransaction["resource"]>>[];
  };
export interface TransactionEvaluationOptions extends ResourceEvaluationOptions {
  /** TX materialization proof requires finite complete-Resource bounds.
   * The owner passes the captured tuple; this does not change RU optionality. */
  readonly limits: ResourceEvaluationOptions["limits"] & {
    readonly propertiesBytes: number;
    readonly representationBytes: number;
    readonly diagnosticBytes: number;
    readonly diagnosticCount: number;
  };
  readonly aliasPolicy: AliasEvaluationOptions["policy"];
  /** Evaluator-only test seam; cannot raise the private authority cap. */
  readonly maximumInducedEvents?: number;
  readonly maximumMatchedResources?: number;
}
export function evaluateTransaction(
  normalized: NormalizedTransaction,
  tx: TransactionMutationContext,
  options: TransactionEvaluationOptions,
  transaction: string,
  position: string,
  now: number,
): BatchEvaluation {
  for (const field of [
    "propertiesBytes",
    "representationBytes",
    "diagnosticBytes",
    "diagnosticCount",
  ] as const) {
    const value = options.limits[field];
    if (!Number.isSafeInteger(value) || value < 1 || value > TRANSACTION_RUNTIME_LIMITS[field])
      throw new TypeError(`invalid transaction evaluator ${field} bound`);
  }
  const state = normalizedState.get(normalized);
  if (!state || state.batch.carrier.scope !== options.scope)
    throw new TypeError("expected normalized transaction for this Scope");
  const eventMaximum = options.maximumInducedEvents ?? TRANSACTION_RUNTIME_LIMITS.inducedEvents;
  if (
    !Number.isSafeInteger(eventMaximum) ||
    eventMaximum < 1 ||
    eventMaximum > TRANSACTION_RUNTIME_LIMITS.inducedEvents
  )
    throw new TypeError("invalid evaluator Event bound");
  const matchMaximum =
    options.maximumMatchedResources ?? TRANSACTION_RUNTIME_LIMITS.matchedResources;
  if (
    !Number.isSafeInteger(matchMaximum) ||
    matchMaximum < 1 ||
    matchMaximum > TRANSACTION_RUNTIME_LIMITS.matchedResources
  )
    throw new TypeError("invalid evaluator matched Resource bound");
  let matchedResources = 0;
  const batch = state.batch;
  const bindings = new Map<string, string>();
  const results: unknown[] = [],
    events: TransactionEvent[] = [];
  const changes = new Map<string, TransactionStateChange>();
  function scopeEvent(subject: ResourceRecord, type: TransactionEvent["type"], data: unknown) {
    if (events.length >= eventMaximum) throw new EventExpansionLimit();
    const ordinal = events.length;
    events.push({
      id: `${position}-${ordinal}`,
      ordinal,
      type,
      // These are authority Scope-group facts, not Resource-source projections.
      // The latter rewrite source to `${resource.id}?view=events` on read.
      source: `${options.scope}events/`,
      subject: subject.id,
      subjectType: subject.type,
      transaction,
      time: new Date(now).toISOString(),
      data,
    });
  }
  function applyResource(
    op: { readonly operation: ResourceOperation; readonly name?: string },
    input: Record<string, unknown>,
    operationIndex: number,
    aliases: ReadonlyMap<string, string | null>,
  ): Extract<BatchEvaluation, { ok: false }> | undefined {
    const locator = input.bead ?? input.link;
    const beforeRow =
      typeof locator === "string"
        ? tx.resource(
            locator.startsWith(options.scope) ? locator.slice(options.scope.length) : locator,
          )
        : undefined;
    const before = beforeRow ? readStoredResource(beforeRow, options.scope) : undefined;
    // Capture each same-turn preimage before the evaluator writes either the
    // direct Resource or its owning source. No recipe or allocator is duplicated.
    const previous = new Map<string, ResourceRecord | undefined>();
    // Syntax and numeric admission preserve the operation/input pairing.
    const result = evaluateResourceMutation(
      {
        ...tx,
        putResource(row) {
          if (!previous.has(row.id)) {
            const old = tx.resource(row.id);
            previous.set(row.id, old ? readStoredResource(old, options.scope) : undefined);
          }
          tx.putResource(row);
        },
        // A captured miss must not become a live target after admission. Other
        // lookups (e.g. creation uniqueness) still consult current authority state.
        alias(path) {
          const locator = `${options.scope}alias/${path}`;
          if (!aliases.has(locator)) return tx.alias(path);
          const target = aliases.get(locator);
          return target == null ? undefined : target.slice(options.scope.length);
        },
      },
      { operation: op.operation, input } as ResourceMutation,
      options,
    );
    if (result.effect === "failure")
      return {
        ok: false,
        problem: {
          ...receiptProblem(result.outcome),
          operationIndex,
          ...(op.name ? { operationName: op.name } : {}),
        },
      };
    const outcome = result.outcome;
    results.push({ operationIndex, ...(op.name ? { operationName: op.name } : {}), ...outcome });
    const resource = outcome.resource;
    if (op.name && outcome.outcome === "created" && resource) bindings.set(op.name, resource.id);
    // A retained revision is an observed no-op, not a committed transition.
    if (result.changed.length === 0 && result.deleted.length === 0) return;
    const subject = resource ?? before;
    if (!subject) throw new Error("successful transition lacks Resource state");
    // Evaluator IDs are local lookup paths; group identity is always canonical.
    // One owned operation changes at most the Link and its source Bead.
    for (const id of result.changed) {
      const row = tx.resource(id);
      if (!row) throw new Error("changed Resource lacks staged postimage");
      const record = readStoredResource(row, options.scope);
      changes.set(record.id, {
        operation: "upsert",
        resourceKind: "source" in record ? "link" : "bead",
        resource: record,
      });
    }
    for (const id of result.deleted) {
      if (
        !before ||
        !outcome.deleted ||
        before.id !== `${options.scope}${id}` ||
        outcome.deleted.resource.id !== before.id ||
        outcome.deleted.resource.type !== before.type ||
        outcome.deleted.resource.revision !== before.revision
      )
        throw new Error("deleted Resource lacks matching previous identity");
      changes.set(before.id, { operation: "tombstone", ...outcome.deleted });
    }
    if (outcome.outcome === "created") {
      scopeEvent(subject, "created", {
        revision: subject.revision,
        properties: subject.properties,
        metadata: subject.metadata ?? {},
        ...(subject.revisionProvenance ? { revisionProvenance: subject.revisionProvenance } : {}),
        ...("source" in subject ? { source: subject.source, target: subject.target } : {}),
      });
    } else if (outcome.outcome === "updated") {
      if (!before) throw new Error("update lacks previous state");
      scopeEvent(subject, "updated", {
        previousRevision: before.revision,
        revision: subject.revision,
        ...(input.propertiesChange !== undefined ? { change: input.propertiesChange } : {}),
        ...(input.metadataChange !== undefined ? { metadataChange: input.metadataChange } : {}),
        ...(subject.revisionProvenance ? { revisionProvenance: subject.revisionProvenance } : {}),
      });
    } else {
      scopeEvent(subject, "deleted", { revision: subject.revision });
    }
    if ("source" in subject && outcome.outcome !== "updated") {
      for (const endpoint of ["source", "target"] as const) {
        const uri = referenceUri(subject[endpoint]);
        if (!uri.startsWith(options.scope)) continue;
        if (!tx.resource(uri.slice(options.scope.length)))
          throw new Error("missing staged endpoint");
        scopeEvent(subject, outcome.outcome === "deleted" ? "unlinked" : "linked", {
          endpoint,
          link: { id: subject.id, type: subject.type },
          source: subject.source,
          target: subject.target,
        });
      }
    }
    if (outcome.sourceRevision !== undefined) {
      if (!("source" in subject) || !outcome.source?.startsWith(options.scope))
        throw new Error("owned transition lacks canonical Link/source identity");
      const localSource = outcome.source.slice(options.scope.length);
      const oldSource = previous.get(localSource),
        row = tx.resource(localSource);
      const source = row ? readStoredResource(row, options.scope) : undefined;
      if (
        !oldSource ||
        !source ||
        "source" in source ||
        "source" in oldSource ||
        source.id !== outcome.source ||
        source.revision !== outcome.sourceRevision
      )
        throw new Error("owned transition lacks matching source versions");
      let link: unknown;
      if (outcome.outcome === "created") link = subject;
      else if (outcome.outcome === "deleted")
        link = { id: subject.id, type: subject.type, revision: subject.revision };
      else {
        if (!before || (input.propertiesChange === undefined && input.metadataChange === undefined))
          throw new Error("owned update lacks committed patch");
        link = {
          id: subject.id,
          type: subject.type,
          previousRevision: before.revision,
          revision: subject.revision,
          ...(input.propertiesChange !== undefined ? { change: input.propertiesChange } : {}),
          ...(input.metadataChange !== undefined ? { metadataChange: input.metadataChange } : {}),
          ...(subject.revisionProvenance ? { revisionProvenance: subject.revisionProvenance } : {}),
        };
      }
      // Up to four facts: Link lifecycle, source/target incidence, owning Bead.
      // The source Event is last and never carries a direct Resource patch.
      scopeEvent(source, "updated", {
        previousRevision: oldSource.revision,
        revision: source.revision,
        ownedLink: { operation: outcome.outcome, link },
        ...(source.revisionProvenance ? { revisionProvenance: source.revisionProvenance } : {}),
      });
    }
    return undefined;
  }
  try {
    for (const [operationIndex, op] of batch.carrier.operations.entries()) {
      if ([...state.references.values()].includes(UNBOUND_SEMANTIC_REFERENCE))
        return {
          ok: false,
          problem: {
            type: "https://github.com/gastownhall/bdp/problems/request",
            status: 400,
            code: "binding-unavailable",
            retry: "never",
            operationIndex,
          },
        };
      if (op.operation === "updateWhere" || op.operation === "deleteWhere") {
        const admitted = admitJsonNumbers(op.input, {
          diagnostics: TRANSACTION_RUNTIME_LIMITS.diagnosticCount,
          diagnosticBytes: TRANSACTION_RUNTIME_LIMITS.diagnosticBytes,
          diagnostic: ({ pointer }) => ({
            message: `unsupported number at request location ${pointer}`,
          }),
        });
        if (!admitted.ok)
          return {
            ok: false,
            problem: {
              type: "https://github.com/gastownhall/bdp/problems/validation",
              status: 422,
              code: "validation-failed",
              retry: "never",
              operationIndex,
              pointer: `${batch.carrier.kind === "singleton" ? "" : `/operations/${operationIndex}`}${admitted.offending[0]!.pointer}`,
              diagnostics: admitted.diagnostics,
              ...(admitted.diagnosticsTruncated ? { diagnosticsTruncated: true } : {}),
            },
          };
        const input = admitted.value as Record<string, unknown>;
        const selected = selectReadResources(
          input.selector as string,
          TRANSACTION_SELECTOR_LIMITS,
          tx
            .resources(input.collection === "beads" ? "bead" : "link")
            .map((row) => {
              if (!row) throw new Error("staged collection contains missing Resource");
              return readStoredResource(row, options.scope);
            })
            .filter((record) => isResourceVisible(tx, record, options.scope, options.policy)),
        )
          .slice()
          .sort((a, b) => compareCanonicalIds(a.id, b.id));
        const cardinality = input.cardinality as { min?: number; max?: number } | undefined;
        if (
          (cardinality?.min !== undefined && selected.length < cardinality.min) ||
          (cardinality?.max !== undefined && selected.length > cardinality.max)
        )
          return {
            ok: false,
            problem: {
              type: "https://github.com/gastownhall/bdp/problems/conflict",
              status: 409,
              code: "cardinality-violated",
              retry: "after-state-change",
              operationIndex,
              pointer: `${batch.carrier.kind === "singleton" ? "" : `/operations/${operationIndex}`}/cardinality/${cardinality?.min !== undefined && selected.length < cardinality.min ? "min" : "max"}`,
            },
          };
        // Count selections across operations, including repeat matches and
        // semantic no-ops, before adding their result entries. Enumeration and
        // selection above still scan the complete candidate collection.
        matchedResources += selected.length;
        if (matchedResources > matchMaximum) throw new MatchExpansionLimit();
        results.push({ operationIndex, outcome: "matched", count: selected.length });
        for (const resource of selected) {
          const bead = input.collection === "beads";
          const failure = applyResource(
            {
              operation:
                op.operation === "updateWhere"
                  ? bead
                    ? "updateBead"
                    : "updateLink"
                  : bead
                    ? "deleteBead"
                    : "deleteLink",
            },
            {
              [bead ? "bead" : "link"]: resource.id,
              ...(op.operation === "updateWhere" ? { propertiesChange: input.change } : {}),
              ...(input.revisionProvenance === undefined
                ? {}
                : { revisionProvenance: input.revisionProvenance }),
            },
            operationIndex,
            new Map(),
          );
          if (failure) {
            if (op.operation === "updateWhere" && failure.problem.code === "validation-failed") {
              // Diagnostics describe the final properties document, not the request.
              // Only an actual Property Change path failure identifies a path member;
              // repeated paths (or afterstate validation) identify the array, not an index.
              let location = "/change";
              const diagnostic = failure.problem.diagnostics?.[0];
              if (
                diagnostic?.message.startsWith("Property Change ") &&
                Array.isArray(input.change)
              ) {
                const matches = input.change.flatMap((change, index) =>
                  change.path === diagnostic.instanceLocation ? [index] : [],
                );
                if (matches.length === 1) location += `/${matches[0]}/path`;
              }
              return {
                ...failure,
                problem: {
                  ...failure.problem,
                  pointer: `${batch.carrier.kind === "singleton" ? "" : `/operations/${operationIndex}`}${location}`,
                },
              };
            }
            return failure;
          }
        }
        continue;
      }
      const admitted = admitReadUpdateOperationNumbers(
        op as UnadmittedReadUpdateOperation,
        memberNumericDiagnosticBudget(op.operation, {
          diagnostics: TRANSACTION_RUNTIME_LIMITS.diagnosticCount,
          diagnosticBytes: TRANSACTION_RUNTIME_LIMITS.diagnosticBytes,
          diagnostic: ({ pointer }) => ({
            message:
              pointer.startsWith("/propertiesChange/") || pointer.startsWith("/metadataChange/")
                ? `unsupported number at request location ${pointer}`
                : "unsupported number",
          }),
        }),
      );
      if (!admitted.ok)
        return {
          ok: false,
          problem: {
            type: "https://github.com/gastownhall/bdp/problems/validation",
            status: 422,
            code: "validation-failed",
            retry: "never",
            diagnostics: admitted.diagnostics,
            ...(admitted.diagnosticsTruncated ? { diagnosticsTruncated: true } : {}),
            operationIndex,
            ...(op.name ? { operationName: op.name } : {}),
          },
        };
      const input: Record<string, unknown> = { ...admitted.input };
      if (operationIndex === 0)
        for (const [field, value] of state.references) {
          const prior = input[field];
          input[field] = typeof prior === "string" ? value : { ...(prior as object), uri: value };
        }
      if (op.operation === "putAlias" || op.operation === "deleteAlias") {
        // Alias singletons and sequence members share this one-operation owner.
        // Locator effects have
        // a durable receipt but deliberately no Resource Event or Scope position.
        if (batch.carrier.kind !== "singleton" || batch.carrier.operations.length !== 1)
          throw new Error("alias operation escaped singleton admission");
        const result = evaluateAliasMutation(
          tx,
          { operation: op.operation, input } as AliasMutation,
          { scope: options.scope, policy: options.aliasPolicy, limits: options.limits },
        );
        if (result.effect === "failure")
          return { ok: false, problem: { ...receiptProblem(result.outcome), operationIndex } };
        results.push({ operationIndex, ...result.outcome });
        continue;
      }
      const aliases = state.aliases[operationIndex];
      if (!aliases) throw new Error("missing admitted operation witnesses");
      for (const field of ["source", "target", "bead", "link"]) {
        const ref = input[field] as string | { uri: string; revision: string } | undefined;
        if (ref === undefined) continue;
        const uri = referenceUri(ref);
        if (uri.startsWith("@")) {
          const id = bindings.get(uri.slice(1));
          if (!id) throw new Error("validated binding missing");
          input[field] = typeof ref === "string" ? id : { ...ref, uri: id };
        } else if (transactionAliasFields(op.operation).includes(field)) {
          const target = aliases.get(canonicalReference(options.scope, uri));
          if (target != null)
            input[field] = typeof ref === "string" ? target : { ...ref, uri: target };
        }
      }
      const failure = applyResource(
        { operation: op.operation as ResourceOperation, ...(op.name ? { name: op.name } : {}) },
        input,
        operationIndex,
        aliases,
      );
      if (failure) return failure;
    }
  } catch (error) {
    if (!(error instanceof EventExpansionLimit) && !(error instanceof MatchExpansionLimit))
      throw error;
    return {
      ok: false,
      problem: {
        type: "https://github.com/gastownhall/bdp/problems/size",
        status: 413,
        code: "limit-exceeded",
        retry: "never",
        limit:
          error instanceof MatchExpansionLimit
            ? "transaction.matchedResources"
            : "transaction.inducedEvents",
      },
    };
  }

  return { ok: true, results, changes: [...changes.values()], events };
}
export function transactionStorageText(value: unknown): string {
  return stringifyJsonValue(value);
}
