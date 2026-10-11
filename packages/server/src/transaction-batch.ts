/** Private first Transactional slice. No transport or profile admission. */
import {
  JsonNumberLiteral,
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
  readStoredResource,
  type ResourceMutation,
  type ResourceOperation,
  type ResourceEvaluationOptions,
  type ResourceTransaction,
  type ResourceRecord,
} from "./resource-evaluator.js";

/** An unsupported private composition is not a protocol syntax ruling. */
export class TransactionDevelopmentLimitError extends Error {}
export interface PreparedTransaction {
  readonly carrier: PreparedReadUpdateCarrier;
}
const prepared = new WeakSet<object>();
function assertResourceOperation(operation: unknown): asserts operation is ResourceOperation {
  if (
    typeof operation !== "string" ||
    !["createBead", "createLink", "updateBead", "updateLink", "deleteBead", "deleteLink"].includes(
      operation,
    )
  )
    throw operation === "updateWhere" || operation === "deleteWhere"
      ? new TransactionDevelopmentLimitError(
          "set operations are not implemented by this private owner",
        )
      : new TypeError("unsupported development transaction operation");
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
function losslessText(value: LosslessJsonValue, depth = 0): string {
  if (depth > 32) throw new TransactionDevelopmentLimitError("development batch depth limit");
  if (value instanceof JsonNumberLiteral) return value.literal;
  if (Array.isArray(value)) return `[${value.map((v) => losslessText(v, depth + 1)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}:${losslessText(v, depth + 1)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Whole-carrier syntax/Scope checks happen before consulting any durable key.
 * Reuses RU parsing, not RU admission or identity: synthetic member keys never
 * enter storage. This bounded owner accepts the six singleton Resource operation kinds. */
export function prepareTransaction(scope: string, text: string): PreparedTransaction {
  if (Buffer.byteLength(text) > 65536) throw new RangeError("development batch byte limit");
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
/** A singleton is the same one-operation Transactional request, not a RU
 * execution. Its raw record excludes the discriminator, label and body key.
 * Synthetic parsing keys are never consulted or persisted by the owner. */
export function prepareTransactionSingleton(
  scope: string,
  operation: ReadUpdateOperation,
  text: string,
): PreparedTransaction {
  if (operation !== "putAlias" && operation !== "deleteAlias") assertResourceOperation(operation);
  if (Buffer.byteLength(text) > 65536) throw new RangeError("development singleton byte limit");
  // Apply the same operation-content depth bound as the batch wrapper.
  losslessText(object(decodeJsonDocument(text)), 2);
  return prepareCarrier(prepareReadUpdateSingleton(scope, operation, text, "internal-singleton"));
}
export interface PreparedTransactionSequence {
  readonly scope: string;
  readonly members: readonly {
    readonly key: string;
    readonly operation: ReadUpdateOperation;
    readonly name?: string;
    readonly request: PreparedTransaction;
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
 * effects; canonical dependencies use durable reservations, while aliases remain refused. */
export function prepareTransactionSequence(
  scope: string,
  text: string,
): PreparedTransactionSequence {
  if (Buffer.byteLength(text) > 65536) throw new RangeError("development sequence byte limit");
  const carrier = prepareReadUpdateSequence(scope, text);
  if (carrier.operations.length > 32) throw new RangeError("development sequence member limit");
  losslessText(object(decodeJsonDocument(text)));
  const labels = new Map<string, number>();
  const members = carrier.operations.map((op, index) => {
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
        aliasFields(op.operation).includes(field) &&
        canonicalReference(scope, uri).startsWith(`${scope}alias/`)
      )
        throw new TypeError("development sequence Resource aliases require turn-time resolution");
    }
    // The whole carrier already validated backward labels and Resource kinds.
    // Preserve its branded numeric operation without reparsing as a singleton,
    // whose syntax correctly rejects @name outside a sequence.
    const key = carrier.keys[index];
    if (key === undefined) throw new Error("prepared sequence lost member key");
    const request = prepareCarrier({
      kind: "singleton",
      scope: carrier.scope,
      operations: [op],
      keys: [key],
    });
    if (op.name) labels.set(op.name, index);
    return Object.freeze({
      key,
      operation: op.operation,
      ...(op.name === undefined ? {} : { name: op.name }),
      request,
      dependencies: Object.freeze(dependencies),
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
function prepareCarrier(carrier: PreparedReadUpdateCarrier): PreparedTransaction {
  const result = Object.freeze({ carrier });
  prepared.add(result);
  return result;
}
export function assertPreparedTransaction(batch: PreparedTransaction, scope: string): void {
  if (!prepared.has(batch) || batch.carrier.scope !== scope)
    throw new TypeError("expected prepared transaction for this Scope");
}
function aliasFields(operation: ReadUpdateOperation): readonly string[] {
  if (operation === "createLink") return ["source", "target"];
  if (operation === "updateBead" || operation === "deleteBead") return ["bead"];
  return [];
}
interface OperationWitnesses {
  readonly operation: ReadUpdateOperation;
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
    data.operations.length > 32
  )
    throw new TypeError("invalid transaction alias witness envelope");
  return data.operations.map((value) => {
    const entry = object(value);
    if (Object.keys(entry).length !== 2 || !Array.isArray(entry.aliases))
      throw new TypeError("invalid transaction operation witnesses");
    if (entry.operation !== "putAlias" && entry.operation !== "deleteAlias")
      assertResourceOperation(entry.operation);
    const operation = entry.operation as ReadUpdateOperation;
    if (entry.aliases.length > aliasFields(operation).length)
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
    const context = input.changeContext;
    if (context !== null && typeof context === "object" && Object.keys(context).length === 0)
      delete input.changeContext;
    const previous = prior?.[index];
    const aliases = new Map<string, string | null>();
    for (const field of ["id", "source", "target", "bead", "link", "alias"]) {
      const value = input[field];
      if (value === undefined) continue;
      const uri = typeof value === "string" ? value : (value as { uri: string }).uri;
      const locator = canonical(uri);
      let normalized: SemanticValue | undefined;
      if (index === 0 && references.has(field)) normalized = references.get(field);
      else if (aliasFields(op.operation).includes(field) && locator.startsWith(`${scope}alias/`)) {
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
export type BatchEvaluation =
  | {
      readonly ok: true;
      readonly results: readonly unknown[];
      readonly changes: readonly TransactionStateChange[];
      readonly events: readonly TransactionEvent[];
    }
  | {
      readonly ok: false;
      readonly problem: ReadUpdateProblem & {
        readonly operationIndex: number;
        readonly operationName?: string;
      };
    };
export type TransactionMutationContext = ResourceTransaction & AliasTransaction;
export interface TransactionEvaluationOptions extends ResourceEvaluationOptions {
  readonly aliasPolicy: AliasEvaluationOptions["policy"];
}
export function evaluateTransaction(
  normalized: NormalizedTransaction,
  tx: TransactionMutationContext,
  options: TransactionEvaluationOptions,
  transaction: string,
  position: string,
  now: number,
): BatchEvaluation {
  const state = normalizedState.get(normalized);
  if (!state || state.batch.carrier.scope !== options.scope)
    throw new TypeError("expected normalized transaction for this Scope");
  const batch = state.batch;
  const bindings = new Map<string, string>();
  const results: unknown[] = [],
    events: TransactionEvent[] = [];
  const changes = new Map<string, TransactionStateChange>();
  function scopeEvent(subject: ResourceRecord, type: TransactionEvent["type"], data: unknown) {
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
    const admitted = admitReadUpdateOperationNumbers(op, {
      diagnostics: 16,
      diagnosticBytes: 65536,
      diagnostic: ({ pointer }) => ({ message: "unsupported number", instanceLocation: pointer }),
    });
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
        return { ok: false, problem: { ...result.outcome, operationIndex } };
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
      } else if (aliasFields(op.operation).includes(field)) {
        const target = aliases.get(canonicalReference(options.scope, uri));
        if (target != null)
          input[field] = typeof ref === "string" ? target : { ...ref, uri: target };
      }
    }
    const locator = input.bead ?? input.link;
    const beforeRow =
      typeof locator === "string"
        ? tx.resource(
            locator.startsWith(options.scope) ? locator.slice(options.scope.length) : locator,
          )
        : undefined;
    const before = beforeRow ? readStoredResource(beforeRow, options.scope) : undefined;
    // Syntax and numeric admission preserve the operation/input pairing.
    const result = evaluateResourceMutation(
      {
        ...tx,
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
          ...result.outcome,
          operationIndex,
          ...(op.name ? { operationName: op.name } : {}),
        },
      };
    const outcome = result.outcome;
    if (outcome.sourceRevision !== undefined) throw new Error("unsupported owned-Link transition");
    results.push({ operationIndex, ...(op.name ? { operationName: op.name } : {}), ...outcome });
    const resource = outcome.resource;
    if (op.name && outcome.outcome === "created" && resource) bindings.set(op.name, resource.id);
    // A retained revision is an observed no-op, not a committed transition.
    if (result.changed.length === 0 && result.deleted.length === 0) continue;
    const subject = resource ?? before;
    if (!subject) throw new Error("successful transition lacks Resource state");
    changes.set(
      subject.id,
      outcome.deleted
        ? {
            operation: "tombstone",
            resourceKind: outcome.deleted.resourceKind,
            resource: outcome.deleted.resource,
          }
        : {
            operation: "upsert",
            resourceKind: "source" in subject ? "link" : "bead",
            resource: subject,
          },
    );
    if (outcome.outcome === "created") {
      scopeEvent(subject, "created", {
        revision: subject.revision,
        properties: subject.properties,
        metadata: subject.metadata ?? {},
        ...(subject.attribution ? { attribution: subject.attribution } : {}),
        ...("source" in subject ? { source: subject.source, target: subject.target } : {}),
      });
    } else if (outcome.outcome === "updated") {
      if (!before) throw new Error("update lacks previous state");
      scopeEvent(subject, "updated", {
        previousRevision: before.revision,
        revision: subject.revision,
        ...(input.propertiesChange !== undefined ? { change: input.propertiesChange } : {}),
        ...(input.metadataChange !== undefined ? { metadataChange: input.metadataChange } : {}),
        ...(subject.attribution ? { attribution: subject.attribution } : {}),
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
  }
  return { ok: true, results, changes: [...changes.values()], events };
}
export function transactionStorageText(value: unknown): string {
  return stringifyJsonValue(value);
}
