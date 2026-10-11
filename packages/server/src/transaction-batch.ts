/** Private first Transactional slice. No transport or profile admission. */
import {
  JsonNumberLiteral,
  decodeJsonDocument,
  prepareReadUpdateSequence,
  prepareReadUpdateSingleton,
  admitReadUpdateOperationNumbers,
  referenceUri,
  stringifyJsonValue,
  type LosslessJsonValue,
  type ReadUpdateProblem,
  type ReadUpdateOperation,
  type PreparedReadUpdateCarrier,
} from "@bdp/protocol";
import { encodeSemanticValue, type SemanticValue } from "./semantic-identity.js";
import { evaluateAliasMutation, type AliasMutation, type AliasTransaction, type AliasEvaluationOptions } from "./alias-evaluator.js";
import {
  evaluateResourceMutation,
  readStoredResource,
  type ResourceMutation,
  type ResourceOperation,
  type ResourceEvaluationOptions,
  type ResourceTransaction,
  type ResourceRecord,
} from "./resource-evaluator.js";

export interface PreparedTransaction {
  readonly identity: string;
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
function losslessText(value: LosslessJsonValue, depth = 0): string {
  if (depth > 32) throw new RangeError("development batch depth limit");
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
    root.operations.length < 1 ||
    root.operations.length > 32
  )
    throw new TypeError("expected 1..32 batch operations");
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
function prepareCarrier(carrier: PreparedReadUpdateCarrier): PreparedTransaction {
  const scope = carrier.scope;
  const creators = new Map<string, SemanticValue>();
  const identities: SemanticValue[] = [];
  const canonical = (uri: string): string =>
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri) ? uri : `${scope}${uri}`;
  for (const [index, op] of carrier.operations.entries()) {
    const creating = op.operation === "createBead" || op.operation === "createLink";
    const input: Record<string, SemanticValue> = {
      ...op.input,
      ...(creating
        ? { properties: op.input.properties ?? {}, metadata: op.input.metadata ?? {} }
        : {}),
    };
    for (const field of ["id", "source", "target", "bead", "link", "alias"]) {
      const value = input[field];
      if (value === undefined) continue;
      const uri = typeof value === "string" ? value : (value as { uri: string }).uri;
      // Preserve binding kind with a tagged slot outside user property data.
      const normalized = uri.startsWith("@") ? creators.get(uri.slice(1)) : canonical(uri);
      if (normalized === undefined) throw new TypeError("unknown batch binding");
      input[field] =
        typeof value === "string"
          ? normalized
          : { uri: normalized, revision: (value as { revision: string }).revision };
    }
    identities.push({ operation: op.operation, input });
    if (creating && op.name)
      creators.set(
        op.name,
        op.input.id === undefined
          ? { creatorIndex: String(index) }
          : canonical(op.input.id as string),
      );
  }
  const result = Object.freeze({ identity: encodeSemanticValue(identities), carrier });
  prepared.add(result);
  return result;
}
export function assertPreparedTransaction(batch: PreparedTransaction, scope: string): void {
  if (!prepared.has(batch) || batch.carrier.scope !== scope)
    throw new TypeError("expected prepared transaction for this Scope");
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
  batch: PreparedTransaction,
  tx: TransactionMutationContext,
  options: TransactionEvaluationOptions,
  transaction: string,
  position: string,
  now: number,
): BatchEvaluation {
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
    if (op.operation === "putAlias" || op.operation === "deleteAlias") {
      // Only singleton preparation admits these operations. Locator effects have
      // a durable receipt but deliberately no Resource Event or Scope position.
      if (batch.carrier.kind !== "singleton" || batch.carrier.operations.length !== 1)
        throw new Error("alias operation escaped singleton admission");
      const result = evaluateAliasMutation(tx, { operation: op.operation, input } as AliasMutation,
        { scope: options.scope, policy: options.aliasPolicy, limits: options.limits });
      if (result.effect === "failure") return { ok: false, problem: { ...result.outcome, operationIndex } };
      results.push({ operationIndex, ...result.outcome });
      continue;
    }
    for (const field of ["source", "target", "bead", "link"]) {
      const ref = input[field] as string | { uri: string; revision: string } | undefined;
      if (ref === undefined) continue;
      const uri = referenceUri(ref);
      if (uri.startsWith("@")) {
        const id = bindings.get(uri.slice(1));
        if (!id) throw new Error("validated binding missing");
        input[field] = typeof ref === "string" ? id : { ...ref, uri: id };
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
      tx,
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
