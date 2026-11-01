/** Private non-Types atomic-batch1 preparation and durable result checks. */
import {
  decodeJsonDocument,
  JsonNumberLiteral,
  admitJsonNumbers,
  type LosslessJsonValue,
  snapshotJsonValue,
  parseRevisionProvenanceInput,
  parseRevisionProvenance,
  type RevisionProvenanceInput,
} from "@bdp/protocol";
import {
  encodeSemanticValue,
  UNBOUND_SEMANTIC_REFERENCE,
  SEMANTIC_VALUE_FORMAT,
  type SemanticValue,
} from "../semantic-identity.js";
import {
  record,
  closed,
  nonempty,
  prepareCreate,
  prepareUpdate,
  prepareDelete,
  RETAINED_MEDIA,
  RETAINED_SPEC,
  RetainedRequestError,
  serialized,
  canonicalCreatedId,
  numericDiagnostic,
  type JsonObject,
  type ResourceState,
  type ResourceKind,
  type TypeReference,
  type EndpointReference,
  type PreparedCreate,
  type PreparedUpdate,
  type PreparedDelete,
  type CrudOperation,
} from "./contract.js";
import { prepareLink, type PreparedLink } from "./link-contract.js";
import { compareCapturedReferences } from "./reference-comparison.js";
import type { AliasWitness } from "./alias-witness.js";
import type { ObjectChange } from "./object-edits.js";

export const ATOMIC_BATCH = "https://github.com/gastownhall/bdp/capabilities/atomic-batch";
export const BATCH_OPERATIONS: readonly CrudOperation[] = Object.freeze([
  "createBead",
  "updateBead",
  "deleteBead",
  "createLink",
  "updateLink",
  "deleteLink",
]);
type Slot = "bead" | "link" | "source" | "target";
export interface BatchInput {
  readonly id?: string;
  readonly bead?: string;
  readonly link?: string;
  readonly type?: TypeReference;
  readonly properties?: JsonObject;
  readonly metadata?: JsonObject;
  readonly propertiesChange?: ObjectChange;
  readonly metadataChange?: ObjectChange;
  readonly source?: EndpointReference;
  readonly target?: EndpointReference;
  readonly expectedRevision?: string;
  readonly provenance?: RevisionProvenanceInput;
  readonly refusal?: JsonObject;
}
export interface BatchMember {
  readonly operation: CrudOperation;
  readonly name?: string;
  readonly input: BatchInput;
  readonly invocation: PreparedCreate | PreparedUpdate | PreparedDelete | PreparedLink;
  readonly bindings: readonly {
    readonly slot: Slot;
    readonly creator: number;
    readonly revision?: string;
  }[];
}
export interface PreparedBatch {
  readonly scope: string;
  readonly key: string;
  readonly version: string;
  readonly identity: string;
  readonly members: readonly BatchMember[];
}
const captured = new WeakSet<PreparedBatch>();
function placeholder(scope: string, index: number): string {
  const origin =
    new URL(scope).origin === "https://batch-handles.invalid"
      ? "https://alternate-batch-handles.invalid"
      : "https://batch-handles.invalid";
  return `${origin}/${index}`;
}
function identity(version: string, input: SemanticValue): string {
  return encodeSemanticValue({
    format: "retained-v01-batch-1",
    specification: RETAINED_SPEC,
    media: RETAINED_MEDIA,
    capabilities: { [ATOMIC_BATCH]: version },
    operation: "atomicBatch",
    input,
  });
}
function bindingIdentity(member: BatchMember) {
  return member.bindings.map((binding) => [
    binding.slot,
    String(binding.creator),
    binding.revision ?? null,
  ]);
}
/** Re-emit only decoder-produced lossless data for the existing singleton
 * factories. Native JSON stringify would turn literal nodes into objects or
 * round a rejected decimal before its identity/numeric admission is captured. */
function losslessWire(value: LosslessJsonValue): string {
  const output: string[] = [];
  const pending: (string | { value: LosslessJsonValue })[] = [{ value }];
  while (pending.length) {
    const work = pending.pop();
    if (work === undefined) break;
    if (typeof work === "string") {
      output.push(work);
      continue;
    }
    const current = work.value;
    if (current instanceof JsonNumberLiteral) output.push(current.literal);
    else if (current === null || typeof current !== "object") output.push(JSON.stringify(current));
    else if (Array.isArray(current)) {
      output.push("[");
      pending.push("]");
      for (let index = current.length - 1; index >= 0; index--) {
        pending.push({ value: current[index] as LosslessJsonValue });
        if (index) pending.push(",");
      }
    } else {
      output.push("{");
      pending.push("}");
      const keys = Object.keys(current);
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index] as string;
        pending.push({
          value: (current as Record<string, LosslessJsonValue>)[key] as LosslessJsonValue,
        });
        pending.push(":");
        pending.push(JSON.stringify(key));
        if (index) pending.push(",");
      }
    }
  }
  return output.join("");
}
export function prepareBatch(scope: string, text: string, key: string): PreparedBatch {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw new RetainedRequestError("malformed-request", 400);
  try {
    if (Buffer.byteLength(text) > 65536) throw new RetainedRequestError("request-too-large", 413);
    const root = record(decodeJsonDocument(text));
    nonempty(root.capabilityVersion);
    const version = root.capabilityVersion;
    const members: BatchMember[] = [];
    if (version === "1") {
      closed(root, ["capabilityVersion", "operations"]);
      if (!Array.isArray(root.operations) || !root.operations.length)
        throw new Error("nonempty operations required");
      const names = new Map<string, { index: number; kind: ResourceKind }>();
      for (const [index, raw] of root.operations.entries()) {
        const body = { ...record(raw) };
        const operation = body.operation as CrudOperation;
        if (!BATCH_OPERATIONS.includes(operation)) throw new Error("unknown batch operation");
        const creating = operation.startsWith("create");
        const kind = operation.endsWith("Bead") ? "bead" : "link";
        const name = body.name;
        if (
          name !== undefined &&
          (!creating ||
            typeof name !== "string" ||
            !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ||
            names.has(name))
        )
          throw new Error("invalid creator name");
        delete body.operation;
        delete body.name;
        const bindings: { slot: Slot; creator: number; revision?: string }[] = [];
        const slots: Slot[] =
          kind === "bead"
            ? creating
              ? []
              : ["bead"]
            : creating
              ? ["source", "target"]
              : ["link", "source", "target"];
        for (const slot of slots) {
          const value = body[slot];
          if (value === undefined) continue;
          const ref = typeof value === "string" ? value : record(value).uri;
          if (typeof ref !== "string" || !ref.startsWith("@")) continue;
          const creator = names.get(ref.slice(1));
          const requiredKind = slot === "link" ? "link" : "bead";
          if (!creator || creator.kind !== requiredKind)
            throw new Error("unknown, forward or wrong-kind handle");
          const substituted = placeholder(scope, creator.index);
          const revision = typeof value === "string" ? undefined : record(value).revision;
          if (revision !== undefined) nonempty(revision);
          bindings.push({
            slot,
            creator: creator.index,
            ...(revision === undefined ? {} : { revision: revision as string }),
          });
          body[slot] =
            typeof value === "string" ? substituted : { ...record(value), uri: substituted };
        }
        const wire = losslessWire(body);
        let invocation: BatchMember["invocation"];
        let input: BatchInput;
        if (operation === "createBead") {
          const value = prepareCreate(scope, wire, "batch-member");
          invocation = value;
          input = value;
        } else if (operation === "updateBead") {
          const value = prepareUpdate(scope, wire, "batch-member");
          invocation = value;
          input = value;
        } else if (operation === "deleteBead") {
          const value = prepareDelete(scope, wire, "batch-member");
          invocation = value;
          input = value;
        } else {
          const value = prepareLink(scope, operation, wire, "batch-member");
          invocation = value;
          const admitted = value.value;
          input = Object.freeze({
            ...admitted,
            ...(admitted.revisionProvenance === undefined
              ? {}
              : {
                  provenance: snapshotJsonValue(
                    parseRevisionProvenanceInput(admitted.revisionProvenance),
                  ),
                }),
            ...(value.refusal === undefined ? {} : { refusal: value.refusal }),
          }) as BatchInput;
        }
        members.push(
          Object.freeze({
            operation,
            ...(name === undefined ? {} : { name: name as string }),
            invocation,
            input,
            bindings: Object.freeze(bindings.map((binding) => Object.freeze(binding))),
          }),
        );
        if (name !== undefined) names.set(name as string, { index, kind });
      }
    }
    const value: PreparedBatch = Object.freeze({
      scope,
      key,
      version,
      members: Object.freeze(members),
      identity:
        version === "1"
          ? identity(
              version,
              members.map((member) => ({
                identity: member.invocation.identity,
                bindings: bindingIdentity(member),
              })),
            )
          : identity(version, root as SemanticValue),
    });
    captured.add(value);
    return value;
  } catch (error) {
    if (error instanceof RetainedRequestError) throw error;
    throw new RetainedRequestError("malformed-request", 400);
  }
}
export function assertPreparedBatch(scope: string, input: PreparedBatch): void {
  if (!captured.has(input) || input.scope !== scope)
    throw new TypeError("foreign or forged prepared batch");
}
export function compareBatch(
  input: PreparedBatch,
  lookup: (locator: string) => string | null | undefined,
  prior?: readonly AliasWitness[],
) {
  if (input.version !== "1")
    return {
      identity: input.identity,
      witnesses: Object.freeze([] as AliasWitness[]),
      inputs: Object.freeze([] as BatchInput[]),
    };
  const witnesses = new Map<string, AliasWitness>();
  const meanings: SemanticValue[] = [];
  const inputs: BatchInput[] = [];
  for (const member of input.members) {
    const comparison = compareCapturedReferences(member.invocation, lookup, prior);
    for (const witness of comparison.originalWitnesses) {
      const previous = witnesses.get(witness.locator);
      if (previous && previous.target !== witness.target)
        throw new Error("conflicting captured alias witness");
      witnesses.set(witness.locator, witness);
    }
    meanings.push({ identity: comparison.identity, bindings: bindingIdentity(member) });
    let value: BatchInput = member.input;
    for (const slot of ["bead", "source", "target"] as const) {
      const reference = comparison.references[slot];
      if (!reference) continue;
      if (reference.kind === "missing-alias" && value.refusal === undefined)
        value = {
          ...value,
          refusal: {
            type: "https://github.com/gastownhall/bdp/problems/not-found",
            code: "resource-not-found",
            status: 404,
            retry: "after-state-change",
          },
        };
      else if (reference.kind === "value") value = { ...value, [slot]: reference.reference };
    }
    inputs.push(value);
  }
  return {
    identity: identity("1", meanings),
    inputs: Object.freeze(inputs),
    witnesses: Object.freeze(
      [...witnesses.values()].sort((a, b) =>
        a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0,
      ),
    ),
  };
}
export interface BatchMapping {
  readonly operationIndex: number;
  readonly operation: CrudOperation;
  readonly id: string;
  readonly operationName?: string;
}
export interface BatchResource {
  readonly id: string;
  readonly resourceKind: ResourceKind;
  readonly outcome: "created" | "updated" | "unchanged" | "deleted" | "allocated";
  readonly changed: boolean;
  readonly resource?: ResourceState["resource"];
  readonly deleted?: {
    readonly resourceKind: ResourceKind;
    readonly resource: {
      readonly id: string;
      readonly type: TypeReference;
      readonly revision: string;
    };
  };
}
export interface BatchResult {
  readonly capabilityVersion: "1";
  readonly changed: boolean;
  readonly transaction?: string;
  readonly results: readonly BatchMapping[];
  readonly resources: readonly BatchResource[];
}
export interface BatchJournal {
  readonly format: "batch-final-1";
  readonly result: BatchResult;
  readonly maximumResultBytes: number;
  readonly before: readonly { readonly id: string; readonly state: ResourceState | null }[];
  readonly allocations: readonly { readonly id: string; readonly kind: ResourceKind }[];
}
function exact(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid durable batch object");
  const object = value as Record<string, unknown>;
  if (
    required.some((key) => !Object.hasOwn(object, key)) ||
    Object.keys(object).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new Error("invalid durable batch fields");
  return object;
}
function state(value: unknown, id: string, kind: ResourceKind, scope: string): void {
  const object = exact(
    value,
    ["id", "type", "revision", "properties", "metadata"],
    ["source", "target", "revisionProvenance"],
  );
  if (object.id !== id || typeof object.revision !== "string" || !object.revision)
    throw new Error("invalid durable batch record identity");
  if (kind === "bead" && (Object.hasOwn(object, "source") || Object.hasOwn(object, "target")))
    throw new Error("invalid Bead endpoints");
  const wire = {
    id: object.id,
    type: object.type,
    properties: object.properties,
    metadata: object.metadata,
    ...(kind === "link" ? { source: object.source, target: object.target } : {}),
  };
  const prepared =
    kind === "bead"
      ? prepareCreate(scope, serialized(wire), "recovery")
      : prepareLink(scope, "createLink", serialized(wire), "recovery");
  if (prepared.refusal) throw new Error("inadmissible durable batch record");
  if (object.revisionProvenance !== undefined) parseRevisionProvenance(object.revisionProvenance);
}
/** Structural durable admission, then recovery checks baseline/facts/current state.
 * This deliberately does not treat JSON.parse or a checksum as authority. */
export function readBatchJournal(text: string, scope: string): BatchJournal {
  const journal = exact(decodeJsonDocument(text), [
    "format",
    "result",
    "maximumResultBytes",
    "before",
    "allocations",
  ]);
  if (journal.format !== "batch-final-1") throw new Error("unknown durable batch format");
  // Convert only after numeric admission performed on original wire values. The
  // journal's counters are private integers written by this implementation.
  const admitted = admitJsonNumbers(decodeJsonDocument(text), {
    diagnostics: 8,
    diagnosticBytes: 4096,
    diagnostic: ({ pointer }) => numericDiagnostic(pointer),
  });
  if (!admitted.ok) throw new Error("inadmissible durable batch number");
  const parsed: unknown = admitted.value;
  const native = exact(parsed, ["format", "result", "maximumResultBytes", "before", "allocations"]);
  const result = exact(
    native.result,
    ["capabilityVersion", "changed", "results", "resources"],
    ["transaction"],
  );
  if (
    result.capabilityVersion !== "1" ||
    typeof result.changed !== "boolean" ||
    (result.changed
      ? typeof result.transaction !== "string" || !result.transaction
      : Object.hasOwn(result, "transaction")) ||
    !Number.isSafeInteger(native.maximumResultBytes) ||
    Number(native.maximumResultBytes) < 1 ||
    Number(native.maximumResultBytes) > 262144 ||
    Buffer.byteLength(serialized(result)) > Number(native.maximumResultBytes) ||
    !Array.isArray(result.results) ||
    !result.results.length ||
    !Array.isArray(result.resources) ||
    !result.resources.length ||
    !Array.isArray(native.before) ||
    !Array.isArray(native.allocations)
  )
    throw new Error("invalid durable batch result");
  const rows = new Map<string, BatchResource>();
  let previous = "";
  for (const raw of result.resources) {
    const row = exact(raw, ["id", "resourceKind", "outcome", "changed"], ["resource", "deleted"]);
    if (
      typeof row.outcome !== "string" ||
      typeof row.id !== "string" ||
      row.id <= previous ||
      canonicalCreatedId(scope, row.id) !== row.id ||
      (row.resourceKind !== "bead" && row.resourceKind !== "link") ||
      typeof row.changed !== "boolean"
    )
      throw new Error("invalid durable batch row");
    previous = row.id;
    if (["created", "updated", "unchanged"].includes(String(row.outcome))) {
      if (
        !Object.hasOwn(row, "resource") ||
        Object.hasOwn(row, "deleted") ||
        row.changed !== (row.outcome !== "unchanged")
      )
        throw new Error("invalid live batch row");
      state(row.resource, row.id, row.resourceKind as ResourceKind, scope);
    } else if (row.outcome === "deleted") {
      const deleted = exact(row.deleted, ["resourceKind", "resource"]);
      const resource = exact(deleted.resource, ["id", "type", "revision"]);
      if (
        !row.changed ||
        Object.hasOwn(row, "resource") ||
        deleted.resourceKind !== row.resourceKind ||
        resource.id !== row.id ||
        typeof resource.revision !== "string" ||
        !resource.revision
      )
        throw new Error("invalid deleted batch row");
    } else if (
      row.outcome !== "allocated" ||
      !row.changed ||
      Object.hasOwn(row, "resource") ||
      Object.hasOwn(row, "deleted")
    )
      throw new Error("invalid allocation row");
    rows.set(row.id, row as unknown as BatchResource);
  }
  const targeted = new Set<string>();
  const names = new Set<string>();
  for (const [index, raw] of result.results.entries()) {
    const entry = exact(raw, ["operationIndex", "operation", "id"], ["operationName"]);
    const row = rows.get(String(entry.id));
    if (
      typeof entry.id !== "string" ||
      entry.operationIndex !== index ||
      !BATCH_OPERATIONS.includes(entry.operation as CrudOperation) ||
      !row ||
      row.resourceKind !== (String(entry.operation).endsWith("Bead") ? "bead" : "link") ||
      (entry.operationName !== undefined &&
        (!String(entry.operation).startsWith("create") ||
          typeof entry.operationName !== "string" ||
          !/^[A-Za-z][A-Za-z0-9_-]*$/.test(entry.operationName)))
    )
      throw new Error("invalid batch mapping");
    if (entry.operationName !== undefined) {
      if (names.has(String(entry.operationName)))
        throw new Error("duplicate retained creator name");
      names.add(String(entry.operationName));
    }
    targeted.add(String(entry.id));
  }
  if (
    targeted.size !== rows.size ||
    result.changed !== [...rows.values()].some((row) => row.changed)
  )
    throw new Error("incomplete batch row census");
  const baseline = new Set<string>();
  previous = "";
  for (const raw of native.before) {
    const entry = exact(raw, ["id", "state"]);
    const row = rows.get(String(entry.id));
    if (!row || typeof entry.id !== "string" || entry.id <= previous)
      throw new Error("invalid batch baseline census");
    previous = entry.id;
    baseline.add(entry.id);
    if (entry.state !== null) {
      const before = exact(entry.state, ["kind", "resource"]);
      if (before.kind !== row.resourceKind) throw new Error("batch baseline kind");
      state(before.resource, entry.id, row.resourceKind, scope);
    }
  }
  if (baseline.size !== rows.size) throw new Error("incomplete batch baseline");
  const allocated = new Set<string>();
  previous = "";
  for (const raw of native.allocations) {
    const entry = exact(raw, ["id", "kind"]);
    const row = rows.get(String(entry.id));
    if (
      !row ||
      typeof entry.id !== "string" ||
      entry.id <= previous ||
      entry.kind !== row.resourceKind ||
      !["created", "allocated"].includes(row.outcome)
    )
      throw new Error("invalid batch allocation census");
    previous = entry.id;
    allocated.add(entry.id);
  }
  if (
    [...rows.values()].some(
      (row) => allocated.has(row.id) !== ["created", "allocated"].includes(row.outcome),
    )
  )
    throw new Error("missing batch allocation");
  return native as unknown as BatchJournal;
}
export function projectBatchResult(journal: BatchJournal, input: PreparedBatch): string {
  const results = journal.result.results.map((mapping, index) => {
    const { operationName: _old, ...value } = mapping;
    void _old;
    const name = input.members[index]?.name;
    return { ...value, ...(name === undefined ? {} : { operationName: name }) };
  });
  const text = serialized({ ...journal.result, results });
  if (Buffer.byteLength(text) > journal.maximumResultBytes)
    throw new RetainedRequestError("limit-exceeded", 413);
  return text;
}

/** Read the private, tagged identity grammar without converting exact numbers
 * to JS numbers or resolving any current Resource/alias/default. */
export function assertBatchIdentity(
  text: unknown,
  scope: string,
  mappings?: readonly BatchMapping[],
): number {
  if (typeof text !== "string" || Buffer.byteLength(text) > 1048576)
    throw new Error("invalid batch identity bound");
  const parse = (value: string): unknown => {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      parsed[0] !== SEMANTIC_VALUE_FORMAT ||
      JSON.stringify(parsed) !== value
    )
      throw new Error("invalid private identity encoding");
    return parsed[1];
  };
  const array = (value: unknown): unknown[] => {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value[0] !== "array" ||
      !Array.isArray(value[1])
    )
      throw new Error("invalid identity array");
    return value[1];
  };
  const string = (value: unknown): string => {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value[0] !== "string" ||
      typeof value[1] !== "string"
    )
      throw new Error("invalid identity string");
    return value[1];
  };
  const object = (value: unknown, fields?: readonly string[]): Map<string, unknown> => {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value[0] !== "object" ||
      !Array.isArray(value[1])
    )
      throw new Error("invalid identity object");
    const entries = new Map<string, unknown>();
    let previous: string | undefined;
    for (const entry of value[1]) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        (previous !== undefined && previous >= entry[0])
      )
        throw new Error("invalid identity members");
      previous = entry[0];
      entries.set(entry[0], entry[1]);
    }
    if (fields && JSON.stringify([...entries.keys()]) !== JSON.stringify([...fields].sort()))
      throw new Error("invalid identity context fields");
    return entries;
  };
  const tagged = (node: unknown): SemanticValue => {
    let result: SemanticValue | undefined;
    const pending: { node: unknown; put: (value: SemanticValue) => void }[] = [
      {
        node,
        put: (value) => {
          result = value;
        },
      },
    ];
    while (pending.length) {
      const work = pending.pop();
      if (!work) break;
      const value = work.node;
      if (!Array.isArray(value) || typeof value[0] !== "string")
        throw new Error("invalid recursive identity tag");
      if (value[0] === "null" || value[0] === "unbound") {
        if (value.length !== 1) throw new Error("invalid identity scalar tuple");
        work.put(value[0] === "null" ? null : UNBOUND_SEMANTIC_REFERENCE);
      } else if (value[0] === "string") work.put(string(value));
      else if (value[0] === "boolean") {
        if (value.length !== 2 || typeof value[1] !== "boolean")
          throw new Error("invalid identity boolean");
        work.put(value[1]);
      } else if (value[0] === "number") {
        if (
          value.length !== 3 ||
          typeof value[1] !== "string" ||
          typeof value[2] !== "string" ||
          !/^(?:0|-?[1-9][0-9]*)$/.test(value[1]) ||
          !/^(?:0|-?[1-9][0-9]*)$/.test(value[2]) ||
          (value[1] === "0" ? value[2] !== "0" : value[1].endsWith("0"))
        )
          throw new Error("invalid exact identity number");
        work.put(new JsonNumberLiteral(`${value[1]}e${value[2]}`));
      } else if (value[0] === "array") {
        const children = array(value);
        const target: SemanticValue[] = new Array(children.length);
        work.put(target);
        for (let index = children.length - 1; index >= 0; index--)
          pending.push({
            node: children[index],
            put: (child) => {
              target[index] = child;
            },
          });
      } else if (value[0] === "object") {
        const children = object(value);
        const target: Record<string, SemanticValue> = Object.create(null);
        work.put(target);
        for (const [key, child] of children)
          pending.push({
            node: child,
            put: (entry) => {
              Object.defineProperty(target, key, { value: entry, enumerable: true });
            },
          });
      } else throw new Error("unknown recursive identity tag");
    }
    if (
      result === undefined ||
      encodeSemanticValue(result) !== JSON.stringify([SEMANTIC_VALUE_FORMAT, node])
    )
      throw new Error("noncanonical recursive identity value");
    return result;
  };
  const root = object(parse(text), [
    "format",
    "specification",
    "media",
    "capabilities",
    "operation",
    "input",
  ]);
  if (
    string(root.get("format")) !== "retained-v01-batch-1" ||
    string(root.get("specification")) !== RETAINED_SPEC ||
    string(root.get("media")) !== RETAINED_MEDIA ||
    string(root.get("operation")) !== "atomicBatch" ||
    string(object(root.get("capabilities"), [ATOMIC_BATCH]).get(ATOMIC_BATCH)) !== "1"
  )
    throw new Error("invalid batch capability context");
  const members = array(root.get("input"));
  if (!members.length || (mappings && members.length !== mappings.length))
    throw new Error("batch identity/mapping census mismatch");
  let witnessLimit = 0;
  const kinds: ResourceKind[] = [];
  const operations: CrudOperation[] = [];
  for (const [index, value] of members.entries()) {
    const member = object(value, ["bindings", "identity"]);
    const ordinary = object(parse(string(member.get("identity"))), [
      "format",
      "specification",
      "media",
      "capabilities",
      "operation",
      "input",
    ]);
    const operation = string(ordinary.get("operation")) as CrudOperation;
    const expectedFormat =
      operation === "createBead"
        ? "retained-v01-create-1"
        : operation === "updateBead"
          ? "retained-v01-update-1"
          : operation === "deleteBead"
            ? "retained-v01-delete-1"
            : "retained-v01-link-1";
    if (
      !BATCH_OPERATIONS.includes(operation) ||
      string(ordinary.get("format")) !== expectedFormat ||
      string(ordinary.get("specification")) !== RETAINED_SPEC ||
      string(ordinary.get("media")) !== RETAINED_MEDIA ||
      object(ordinary.get("capabilities"), []).size ||
      (mappings && mappings[index]?.operation !== operation)
    )
      throw new Error("invalid batch member context");
    const kind = operation.endsWith("Bead") ? "bead" : "link";
    kinds.push(kind);
    operations.push(operation);
    const input = object(ordinary.get("input"));
    const creating = operation.startsWith("create");
    const required = creating
      ? ["type", "properties", "metadata", ...(kind === "link" ? ["source", "target"] : [])]
      : [kind];
    const optional = creating
      ? ["id", "revisionProvenance"]
      : operation === "deleteBead"
        ? ["expectedRevision"]
        : operation === "deleteLink"
          ? ["expectedRevision", "revisionProvenance"]
          : [
              "type",
              "properties",
              "metadata",
              "propertiesChange",
              "metadataChange",
              "expectedRevision",
              "revisionProvenance",
              ...(kind === "link" ? ["source", "target"] : []),
            ];
    if (
      required.some((field) => !input.has(field)) ||
      [...input.keys()].some((field) => !required.includes(field) && !optional.includes(field))
    )
      throw new Error("incomplete normalized batch member input");
    const decoded = tagged(ordinary.get("input"));
    if (
      !decoded ||
      typeof decoded !== "object" ||
      Array.isArray(decoded) ||
      decoded instanceof JsonNumberLiteral
    )
      throw new Error("invalid normalized input object");
    const wireInput = { ...decoded } as Record<string, SemanticValue>;
    const missing = new Set<string>();
    const aliasSlots = ["updateBead", "deleteBead"].includes(operation)
      ? ["bead"]
      : ["createLink", "updateLink"].includes(operation)
        ? ["source", "target"]
        : [];
    for (const slot of aliasSlots) {
      const value = wireInput[slot];
      if (!Array.isArray(value) || value[0] !== UNBOUND_SEMANTIC_REFERENCE) continue;
      if (
        (value.length !== 2 && value.length !== 3) ||
        typeof value[1] !== "string" ||
        !value[1].startsWith(scope) ||
        canonicalCreatedId(scope, value[1]) !== value[1] ||
        (value.length === 3 && (slot === "bead" || typeof value[2] !== "string" || !value[2]))
      )
        throw new Error("invalid missing alias identity slot");
      missing.add(value[1]);
      wireInput[slot] =
        value.length === 2 ? value[1] : { uri: value[1], revision: value[2] as string };
    }
    if (mappings && missing.size)
      throw new Error("successful batch identity contains a missing alias");
    const values: SemanticValue[] = [wireInput];
    while (values.length) {
      const value = values.pop();
      if (value === UNBOUND_SEMANTIC_REFERENCE)
        throw new Error("unbound identity outside admitted Reference slot");
      if (value && typeof value === "object" && !(value instanceof JsonNumberLiteral))
        values.push(...(Array.isArray(value) ? value : Object.values(value)));
    }
    const body = losslessWire(wireInput as LosslessJsonValue);
    const prepared =
      operation === "createBead"
        ? prepareCreate(scope, body, "batch-recovery")
        : operation === "updateBead"
          ? prepareUpdate(scope, body, "batch-recovery")
          : operation === "deleteBead"
            ? prepareDelete(scope, body, "batch-recovery")
            : prepareLink(scope, operation, body, "batch-recovery");
    if (mappings && "refusal" in prepared && prepared.refusal)
      throw new Error("successful batch has inadmissible normalized input");
    if (
      compareCapturedReferences(prepared, (uri) => (missing.has(uri) ? null : undefined))
        .identity !== string(member.get("identity"))
    )
      throw new Error("batch member is not complete normalized ordinary input");
    const slots = new Set<string>();
    for (const binding of array(member.get("bindings"))) {
      const fields = array(binding);
      if (fields.length !== 3) throw new Error("invalid creator binding");
      const slot = string(fields[0]);
      const creatorText = string(fields[1]);
      if (!/^(?:0|[1-9][0-9]*)$/.test(creatorText)) throw new Error("invalid creator slot");
      const creator = Number(creatorText);
      const allowed =
        operation === "createBead"
          ? []
          : kind === "bead"
            ? ["bead"]
            : operation === "createLink"
              ? ["source", "target"]
              : ["link", "source", "target"];
      if (
        !Number.isSafeInteger(creator) ||
        creator >= index ||
        !operations[creator]?.startsWith("create") ||
        slots.has(slot) ||
        !allowed.includes(slot) ||
        kinds[creator] !== (slot === "link" ? "link" : "bead") ||
        (mappings && !mappings[creator]?.operation.startsWith("create"))
      )
        throw new Error("invalid typed creator binding");
      slots.add(slot);
      const reference = input.get(slot);
      const revision =
        Array.isArray(fields[2]) && fields[2].length === 1 && fields[2][0] === "null"
          ? undefined
          : string(fields[2]);
      if (revision === undefined) {
        if (string(reference) !== placeholder(scope, creator))
          throw new Error("creator placeholder mismatch");
      } else {
        const pinned = object(reference, ["uri", "revision"]);
        if (
          string(pinned.get("uri")) !== placeholder(scope, creator) ||
          string(pinned.get("revision")) !== revision
        )
          throw new Error("pinned creator placeholder mismatch");
      }
      if (
        (slot === "bead" || slot === "link") &&
        mappings &&
        mappings[index]?.id !== mappings[creator]?.id
      )
        throw new Error("creator subject mapping mismatch");
    }
    if (mappings) {
      const subject = operation.startsWith("create") ? "id" : kind;
      if (
        !slots.has(subject) &&
        input.has(subject) &&
        string(input.get(subject)) !== mappings[index]?.id
      )
        throw new Error("batch identity/subject mapping mismatch");
    }
    witnessLimit += ["updateBead", "deleteBead"].includes(operation)
      ? 1
      : ["createLink", "updateLink"].includes(operation)
        ? 2
        : 0;
  }
  return witnessLimit;
}
