/** Private first Transactional slice. No transport or profile admission. */
import {
  JsonNumberLiteral,
  decodeJsonDocument,
  prepareReadUpdateSequence,
  admitReadUpdateOperationNumbers,
  referenceUri,
  stringifyJsonValue,
  type LosslessJsonValue,
  type ReadUpdateInputs,
  type ReadUpdateMutationResult,
  type ReadUpdateProblem,
  type PreparedReadUpdateCarrier,
} from "@bdp/protocol";
import { encodeSemanticValue, type SemanticValue } from "./semantic-identity.js";
import {
  evaluateResourceMutation,
  readStoredResource,
  type ResourceEvaluationOptions,
  type ResourceTransaction,
  type ResourceRecord,
} from "./resource-evaluator.js";

export interface PreparedTransaction {
  readonly identity: string;
  readonly carrier: PreparedReadUpdateCarrier;
}
const prepared = new WeakSet<object>();
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
 * enter storage. This bounded owner currently accepts only Resource creations. */
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
    if (op.operation !== "createBead" && op.operation !== "createLink")
      throw new TypeError("unsupported development transaction operation");
    if (Object.hasOwn(op, "idempotencyKey")) throw new TypeError("batch members cannot carry keys");
    return { ...op, idempotencyKey: `internal-${index}` };
  });
  const carrier = prepareReadUpdateSequence(scope, losslessText({ operations }));
  const creators = new Map<string, SemanticValue>();
  const identities: SemanticValue[] = [];
  const canonical = (uri: string): string =>
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri) ? uri : `${scope}${uri}`;
  for (const [index, op] of carrier.operations.entries()) {
    const input: Record<string, SemanticValue> = {
      ...op.input,
      properties: op.input.properties ?? {},
      metadata: op.input.metadata ?? {},
    };
    for (const field of ["id", "source", "target"]) {
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
    if (op.name)
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
    throw new TypeError("expected prepared batch for this Scope");
}
export interface TransactionEvent {
  readonly id: string;
  readonly ordinal: number;
  readonly type: "created" | "linked";
  readonly source: string;
  readonly subject: string;
  readonly subjectType: string;
  readonly transaction: string;
  readonly time: string;
  readonly data: unknown;
}
export type BatchEvaluation =
  | {
      readonly ok: true;
      readonly results: readonly unknown[];
      readonly resources: readonly ResourceRecord[];
      readonly events: readonly TransactionEvent[];
    }
  | {
      readonly ok: false;
      readonly problem: ReadUpdateProblem & {
        readonly operationIndex: number;
        readonly operationName?: string;
      };
    };
export function evaluateTransaction(
  batch: PreparedTransaction,
  tx: ResourceTransaction,
  options: ResourceEvaluationOptions,
  transaction: string,
  position: string,
  now: number,
): BatchEvaluation {
  const bindings = new Map<string, string>();
  const results: unknown[] = [],
    resources: ResourceRecord[] = [],
    events: TransactionEvent[] = [];
  function event(record: ResourceRecord, type: TransactionEvent["type"], data: unknown) {
    const ordinal = events.length;
    events.push({
      id: `${position}-${ordinal}`,
      ordinal,
      type,
      source: `${record.id}/events`,
      subject: record.id,
      subjectType: record.type,
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
    const input = { ...admitted.input } as ReadUpdateInputs["createLink"];
    if (op.operation === "createLink") {
      for (const field of ["source", "target"] as const) {
        const ref = input[field],
          uri = referenceUri(ref);
        if (uri.startsWith("@")) {
          const id = bindings.get(uri.slice(1));
          if (!id) throw new Error("validated binding missing");
          Object.assign(input, { [field]: typeof ref === "string" ? id : { ...ref, uri: id } });
        }
      }
    }
    const result = evaluateResourceMutation(
      tx,
      op.operation === "createBead"
        ? { operation: "createBead", input }
        : { operation: "createLink", input },
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
    const outcome: ReadUpdateMutationResult = result.outcome;
    const resource = outcome.resource;
    if (!resource || outcome.sourceRevision !== undefined)
      throw new Error("unsupported owned-Link transition");
    results.push({ operationIndex, ...(op.name ? { operationName: op.name } : {}), ...outcome });
    resources.push(resource);
    if (op.name) bindings.set(op.name, resource.id);
    event(resource, "created", {
      revision: resource.revision,
      properties: resource.properties,
      metadata: resource.metadata ?? {},
      ...(resource.attribution ? { attribution: resource.attribution } : {}),
      ...("source" in resource ? { source: resource.source, target: resource.target } : {}),
    });
    if ("source" in resource)
      for (const endpoint of ["source", "target"] as const) {
        const uri = referenceUri(resource[endpoint]);
        if (!uri.startsWith(options.scope)) continue;
        const row = tx.resource(uri.slice(options.scope.length));
        if (!row) throw new Error("missing staged endpoint");
        event(readStoredResource(row, options.scope), "linked", {
          endpoint,
          link: { id: resource.id, type: resource.type },
          source: resource.source,
          target: resource.target,
        });
      }
  }
  return { ok: true, results, resources, events };
}
export function transactionStorageText(value: unknown): string {
  return stringifyJsonValue(value);
}
