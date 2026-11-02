/** Selected atomic-batch1 carrier only. No store access or historical TX grammar. */
import { decodeJsonDocument, JsonNumberLiteral, type LosslessJsonValue } from "@bdp/protocol";
import { encodeSemanticValue, type SemanticValue } from "../semantic-identity.js";
import type { AliasWitness } from "./alias-witness.js";
import {
  closed,
  type JsonObject,
  nonempty,
  type PreparedCreate,
  type PreparedDelete,
  type PreparedUpdate,
  prepareCreate,
  prepareDelete,
  prepareUpdate,
  problem,
  RETAINED_MEDIA,
  RETAINED_SPEC,
  type ResourceKind,
  RetainedRequestError,
  record,
} from "./contract.js";
import { type PreparedLink, prepareLink } from "./link-contract.js";
import {
  compareCapturedReferences,
  type ReferenceComparison,
  type ReferenceSlot,
} from "./reference-comparison.js";

/** Preserve raw number tokens until the ordinary member's numeric admission. */
function losslessMemberText(value: LosslessJsonValue): string {
  const tasks: Array<string | { value: LosslessJsonValue }> = [{ value }];
  const out: string[] = [];
  while (tasks.length) {
    const task = tasks.pop()!;
    if (typeof task === "string") {
      out.push(task);
      continue;
    }
    const item = task.value;
    if (item instanceof JsonNumberLiteral) {
      out.push(item.literal);
      continue;
    }
    if (item === null || typeof item !== "object") {
      out.push(JSON.stringify(item));
      continue;
    }
    const array = Array.isArray(item);
    const entries = Object.entries(item);
    out.push(array ? "[" : "{");
    tasks.push(array ? "]" : "}");
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, child] = entries[i]!;
      tasks.push({ value: child });
      if (!array) tasks.push(JSON.stringify(key) + ":");
      if (i > 0) tasks.push(",");
    }
  }
  return out.join("");
}

export const BATCH_CAPABILITY = "https://github.com/gastownhall/bdp/capabilities/atomic-batch";
export const BATCH_OPERATIONS = [
  "createBead",
  "updateBead",
  "deleteBead",
  "createLink",
  "updateLink",
  "deleteLink",
] as const;
export type BatchOperation = (typeof BATCH_OPERATIONS)[number];
export const BATCH_LIMITS = Object.freeze({ maximumOperations: 32, maximumResultBytes: 262144 });
export type BatchInvocation = PreparedCreate | PreparedUpdate | PreparedDelete | PreparedLink;
export interface BatchHandle {
  readonly operationIndex: number;
  readonly kind: ResourceKind;
  readonly placeholder: string;
}
export interface BatchMember {
  readonly operation: BatchOperation;
  readonly name?: string;
  readonly handles: Readonly<Partial<Record<ReferenceSlot | "link", BatchHandle>>>;
  readonly invocation: BatchInvocation;
}
export interface PreparedBatch {
  readonly scope: string;
  readonly key: string;
  readonly identity: string;
  readonly capabilityVersion: string;
  readonly members: readonly BatchMember[];
}
export interface BatchComparison {
  readonly identity: string;
  readonly members: readonly ReferenceComparison[];
  readonly originalWitnesses: readonly AliasWitness[];
}
const captures = new WeakSet<PreparedBatch>();
const validName = /^[A-Za-z][A-Za-z0-9_-]*$/;
function memberIdentity(member: BatchMember, identity: string): SemanticValue {
  // Placeholders are lexical scaffolding, never identities allocated by a store.
  // A separate tagged slot map prevents a literal URL from equating to a handle.
  return {
    operation: member.operation,
    identity,
    handles: Object.fromEntries(
      Object.entries(member.handles).map(([field, handle]) => [
        field,
        String(handle.operationIndex),
      ]),
    ),
  };
}
function identityFor(
  scope: string,
  members: readonly BatchMember[],
  identities: readonly string[],
) {
  return encodeSemanticValue({
    format: "retained-v01-batch-1",
    specification: RETAINED_SPEC,
    media: RETAINED_MEDIA,
    capabilities: { [BATCH_CAPABILITY]: "1" },
    scope,
    operation: "batch",
    input: members.map((member, index) => memberIdentity(member, identities[index]!)),
  });
}
export function batchCapabilityProblem(version: string): JsonObject {
  return {
    ...problem("capability-not-supported", 422, "after-state-change"),
    capability: BATCH_CAPABILITY,
    capabilityVersion: version,
    pointer: "/capabilityVersion",
  };
}
export function batchOperationProblem(operation: BatchOperation, index: number): JsonObject {
  return {
    ...problem("operation-not-supported", 422, "after-state-change"),
    capability: BATCH_CAPABILITY,
    capabilityVersion: "1",
    operation,
    pointer: `/operations/${index}/operation`,
  };
}
export function prepareBatch(scope: string, text: string, key: string): PreparedBatch {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw new RetainedRequestError("malformed-request", 400);
  let root: Record<string, LosslessJsonValue>;
  try {
    root = record(decodeJsonDocument(text));
  } catch {
    throw new RetainedRequestError("malformed-request", 400);
  }
  nonempty(root.capabilityVersion);
  const version = root.capabilityVersion;
  if (version !== "1") {
    // Unknown-version body is not interpreted through version1's grammar.
    const input = Object.freeze({
      scope,
      key,
      capabilityVersion: version,
      members: Object.freeze([]),
      identity: encodeSemanticValue({
        format: "retained-v01-batch-unknown-1",
        specification: RETAINED_SPEC,
        media: RETAINED_MEDIA,
        scope,
        operation: "batch",
        input: root as SemanticValue,
      }),
    });
    captures.add(input);
    return input;
  }
  closed(root, ["capabilityVersion", "operations"]);
  if (!Array.isArray(root.operations) || root.operations.length === 0)
    throw new RetainedRequestError("malformed-request", 400);
  const names = new Map<string, BatchHandle>();
  const members = root.operations.map((raw, index): BatchMember => {
    const value = record(raw);
    if (
      typeof value.operation !== "string" ||
      !BATCH_OPERATIONS.includes(value.operation as BatchOperation)
    )
      throw new RetainedRequestError("malformed-request", 400);
    const operation = value.operation as BatchOperation;
    const creating = operation.startsWith("create");
    const kind = operation.endsWith("Bead") ? "bead" : "link";
    const body = { ...value };
    const name = body.name;
    delete body.operation;
    delete body.name;
    if (
      name !== undefined &&
      (!creating || typeof name !== "string" || !validName.test(name) || names.has(name))
    )
      throw new RetainedRequestError("malformed-request", 400);
    const handles: Partial<Record<ReferenceSlot | "link", BatchHandle>> = {};
    for (const field of ["bead", "link", "source", "target"] as const) {
      if (body[field] === undefined) continue;
      const original = body[field];
      const pinned = typeof original !== "string";
      const reference = pinned ? record(original) : undefined;
      const uri = pinned ? reference!.uri : original;
      if (typeof uri !== "string" || !uri.startsWith("@")) continue;
      const handle = names.get(uri.slice(1));
      if (
        !handle ||
        !validName.test(uri.slice(1)) ||
        handle.kind !== (field === "link" ? "link" : "bead")
      )
        throw new RetainedRequestError("malformed-request", 400);
      // Subject grammar remains string-only; ordinary preparation rejects objects.
      handles[field] = handle;
      body[field] = pinned ? { ...reference!, uri: handle.placeholder } : handle.placeholder;
    }
    const memberText = losslessMemberText(body as LosslessJsonValue);
    const invocation =
      operation === "createBead"
        ? prepareCreate(scope, memberText, key)
        : operation === "updateBead"
          ? prepareUpdate(scope, memberText, key)
          : operation === "deleteBead"
            ? prepareDelete(scope, memberText, key)
            : prepareLink(scope, operation, memberText, key);
    const member = Object.freeze({
      operation,
      ...(name === undefined ? {} : { name: name as string }),
      handles: Object.freeze(handles),
      invocation,
    });
    if (typeof name === "string")
      names.set(
        name,
        Object.freeze({
          operationIndex: index,
          kind,
          placeholder: `${scope}batch-binding-${index}`,
        }),
      );
    return member;
  });
  const captured = Object.freeze({
    scope,
    key,
    capabilityVersion: version,
    members: Object.freeze(members),
    identity: identityFor(
      scope,
      members,
      members.map((member) => member.invocation.identity),
    ),
  });
  captures.add(captured);
  return captured;
}
export function assertPreparedBatch(scope: string, input: PreparedBatch): void {
  if (!captures.has(input) || input.scope !== scope) throw new TypeError("foreign or forged batch");
}
export function compareBatch(
  input: PreparedBatch,
  lookup: (locator: string) => string | null | undefined,
  prior?: readonly AliasWitness[],
): BatchComparison {
  assertPreparedBatch(input.scope, input);
  const priorCreated = new Set<string>();
  const comparisons = input.members.map((member) => {
    // A preceding explicit creation is a canonical identity in this working graph,
    // even when its path lies inside the optional alias namespace. Never acquire
    // a future creation or resolve a handle as a current alias.
    const comparison = compareCapturedReferences(
      member.invocation,
      (locator) => (priorCreated.has(locator) ? undefined : lookup(locator)),
      // The global retained witness remains frozen, but this member's direct
      // working-graph identity must not inherit an earlier pre-creation miss.
      prior?.filter((witness) => !priorCreated.has(witness.locator)),
      Object.keys(member.handles).filter((field) => field !== "link") as ReferenceSlot[],
    );
    if (member.operation.startsWith("create")) {
      const invocation = member.invocation;
      const id =
        "value" in invocation
          ? invocation.value.id
          : "id" in invocation
            ? invocation.id
            : undefined;
      if (typeof id === "string") priorCreated.add(id);
    }
    return comparison;
  });
  const witnesses = new Map<string, AliasWitness>();
  for (const comparison of comparisons)
    for (const witness of comparison.originalWitnesses) witnesses.set(witness.locator, witness);
  return {
    identity:
      input.capabilityVersion === "1"
        ? identityFor(
            input.scope,
            input.members,
            comparisons.map((member) => member.identity),
          )
        : input.identity,
    members: comparisons,
    originalWitnesses:
      prior ??
      [...witnesses.values()].sort((a, b) =>
        a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0,
      ),
  };
}
