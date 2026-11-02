/** One in-memory working graph; persistence happens only after complete admission. */
import { randomUUID } from "node:crypto";
import { parseRevisionProvenanceInput, type RevisionProvenanceInput } from "@bdp/protocol";
import { jsonValueEqual } from "../json-value-equality.js";
import {
  BATCH_LIMITS,
  type BatchComparison,
  type BatchMember,
  type PreparedBatch,
} from "./batch-contract.js";
import {
  deletedIdentity,
  type EndpointReference,
  type JsonObject,
  materializeBead,
  problem,
  type ResourceKind,
  type ResourceState,
  type RetainedBead,
  type RetainedLink,
  referenceUri,
  serialized,
  type TypeReference,
} from "./contract.js";
import {
  applyObjectChange,
  exceedsEditLimits,
  type ObjectChange,
  ObjectEditFailure,
} from "./object-edits.js";

export interface BatchFinalRow {
  readonly id: string;
  readonly resourceKind: ResourceKind;
  readonly outcome: "created" | "updated" | "unchanged" | "deleted" | "allocated";
  readonly changed: boolean;
  readonly resource?: RetainedBead | RetainedLink;
  readonly deleted?: ReturnType<typeof deletedIdentity>;
}
export interface BatchEffect {
  readonly before?: ResourceState;
  readonly after?: ResourceState;
}
export interface BatchEvaluation {
  readonly status: number;
  readonly text: string;
  readonly allocations: readonly { readonly id: string; readonly kind: ResourceKind }[];
  readonly rows: readonly BatchFinalRow[];
  readonly effects: readonly BatchEffect[];
  readonly transaction?: string;
}
function refusal(body: JsonObject): BatchEvaluation {
  return {
    status: Number(body.status),
    text: serialized(body),
    allocations: [],
    rows: [],
    effects: [],
  };
}
export function covered(state: ResourceState): unknown {
  const { type, properties, metadata } = state.resource;
  return {
    type,
    properties,
    metadata,
    ...(state.kind === "link"
      ? {
          source: state.resource.source,
          target: state.resource.target,
        }
      : {}),
  };
}
function fields(member: BatchMember): Record<string, unknown> {
  const input = member.invocation;
  if ("value" in input) return input.value;
  return {
    ...input,
    ...("provenance" in input && input.provenance !== undefined
      ? { revisionProvenance: input.provenance }
      : {}),
  };
}
export function evaluateBatch(
  input: PreparedBatch,
  comparison: BatchComparison,
  initial: ReadonlyMap<string, ResourceState>,
  taken: Pick<ReadonlySet<string>, "has">,
  aliasTaken: (id: string) => boolean,
  reserved: (id: string) => boolean,
  time: string,
): BatchEvaluation {
  const live = new Map(initial);
  const allocated = new Map<string, ResourceKind>();
  const touched = new Map<string, ResourceKind>();
  const mappings: {
    operationIndex: number;
    operation: string;
    id: string;
    operationName?: string;
  }[] = [];
  const provenance = new Map<string, RevisionProvenanceInput[]>();
  const seen = new Set<string>();
  function endpointFailure(state: ResourceState): JsonObject | undefined {
    if (state.kind !== "link") return undefined;
    let local = false;
    for (const side of ["source", "target"] as const) {
      const uri = referenceUri(state.resource[side]);
      if (!uri.startsWith(input.scope)) continue;
      local = true;
      const endpoint = live.get(uri);
      if (!endpoint) return problem("resource-not-found", 404, "after-state-change");
      if (endpoint.kind !== "bead")
        return {
          ...problem("validation-failed", 422),
          diagnostics: [{ message: `${side} endpoint must identify a live in-Scope Bead` }],
        };
    }
    return local
      ? undefined
      : {
          ...problem("validation-failed", 422),
          diagnostics: [{ message: "a Link requires at least one in-Scope Bead endpoint" }],
        };
  }
  for (const [index, member] of input.members.entries()) {
    const value = fields(member);
    if ("refusal" in member.invocation && member.invocation.refusal)
      return refusal(member.invocation.refusal);
    const resolved = comparison.members[index]!;
    const kind = member.operation.endsWith("Bead") ? "bead" : "link";
    function reference(slot: "bead" | "link" | "source" | "target"): EndpointReference | undefined {
      const handle = member.handles[slot];
      let supplied = value[slot] as EndpointReference | undefined;
      if (handle) {
        const id = mappings[handle.operationIndex]?.id;
        if (!id) throw new Error("missing prior batch identity binding");
        supplied = typeof supplied === "string" ? id : { uri: id, revision: supplied!.revision };
      } else if (slot !== "link") {
        const result = resolved.references[slot];
        if (result?.kind === "missing-alias") return undefined;
        if (result?.kind === "value") return result.reference;
      }
      return supplied;
    }
    let id: string;
    if (member.operation.startsWith("create")) {
      id = (value.id as string | undefined) ?? input.scope + randomUUID();
      if (value.id === undefined) {
        let attempts = 0;
        while (seen.has(id) || taken.has(id) || aliasTaken(id) || reserved(id)) {
          if (++attempts > 32)
            return refusal(problem("temporarily-unavailable", 503, "after-delay"));
          id = input.scope + randomUUID();
        }
      }
      if (seen.has(id) || taken.has(id) || reserved(id))
        return refusal(problem("identity-taken", 409));
      if (aliasTaken(id)) return refusal(problem("alias-path-taken", 409, "after-state-change"));
      const base = {
        id,
        type: value.type as TypeReference,
        revision: "unpublished",
        properties: value.properties as JsonObject,
        metadata: value.metadata as JsonObject,
      };
      let state: ResourceState;
      if (kind === "link") {
        const source = reference("source"),
          target = reference("target");
        if (source === undefined || target === undefined)
          return refusal(problem("resource-not-found", 404, "after-state-change"));
        state = { kind, resource: { ...base, source, target } };
      } else state = { kind, resource: base };
      const error = endpointFailure(state);
      if (error) return refusal(error);
      live.set(id, state);
      allocated.set(id, kind);
      seen.add(id);
    } else {
      const target = reference(kind);
      if (typeof target !== "string")
        return refusal(problem("resource-not-found", 404, "after-state-change"));
      id = target;
      const before = live.get(id);
      if (!before || before.kind !== kind)
        return refusal(problem("resource-not-found", 404, "after-state-change"));
      if (
        value.expectedRevision !== undefined &&
        value.expectedRevision !== initial.get(id)?.resource.revision
      )
        return refusal(problem("revision-mismatch", 409, "after-state-change"));
      if (member.operation.startsWith("delete")) {
        if (
          kind === "bead" &&
          [...live.values()].some(
            (state) =>
              state.kind === "link" &&
              [state.resource.source, state.resource.target].some(
                (ref) => referenceUri(ref) === id,
              ),
          )
        )
          return refusal(problem("incident-links-exist", 409, "after-state-change"));
        live.delete(id);
      } else {
        const propertiesChange = value.propertiesChange as ObjectChange | undefined;
        const metadataChange = value.metadataChange as ObjectChange | undefined;
        if (exceedsEditLimits([propertiesChange ?? [], metadataChange ?? []]))
          return refusal(problem("limit-exceeded", 413));
        let properties: JsonObject, metadata: JsonObject;
        let document = "properties";
        try {
          properties =
            (value.properties as JsonObject | undefined) ??
            (propertiesChange === undefined
              ? before.resource.properties
              : applyObjectChange(before.resource.properties, propertiesChange));
          document = "metadata";
          metadata =
            (value.metadata as JsonObject | undefined) ??
            (metadataChange === undefined
              ? before.resource.metadata
              : applyObjectChange(before.resource.metadata, metadataChange));
        } catch (error) {
          if (!(error instanceof ObjectEditFailure)) throw error;
          return refusal({
            ...problem("validation-failed", 422),
            diagnostics: [
              {
                ...(document === "metadata" ? { document } : {}),
                instanceLocation: error.pointer,
                message: `${document}: ${error.message}`,
              },
            ],
          });
        }
        const base = {
          ...before.resource,
          type: (value.type as TypeReference | undefined) ?? before.resource.type,
          properties,
          metadata,
        };
        let state: ResourceState;
        if (before.kind === "link") {
          const source = Object.hasOwn(value, "source")
            ? reference("source")
            : before.resource.source;
          const target = Object.hasOwn(value, "target")
            ? reference("target")
            : before.resource.target;
          if (source === undefined || target === undefined)
            return refusal(problem("resource-not-found", 404, "after-state-change"));
          state = { kind: "link", resource: { ...base, source, target } };
        } else state = { kind: "bead", resource: base };
        const error = endpointFailure(state);
        if (error) return refusal(error);
        live.set(id, state);
      }
    }
    touched.set(id, kind);
    if (value.revisionProvenance !== undefined) {
      const list = provenance.get(id) ?? [];
      list.push(parseRevisionProvenanceInput(value.revisionProvenance));
      provenance.set(id, list);
    }
    mappings.push({
      operationIndex: index,
      operation: member.operation,
      id,
      ...(member.name === undefined ? {} : { operationName: member.name }),
    });
  }
  const rows: BatchFinalRow[] = [],
    effects: BatchEffect[] = [];
  for (const [id, kind] of [...touched].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const before = initial.get(id),
      staged = live.get(id);
    if (!staged) {
      if (!before) rows.push({ id, resourceKind: kind, outcome: "allocated", changed: true });
      else {
        rows.push({
          id,
          resourceKind: kind,
          outcome: "deleted",
          changed: true,
          deleted: deletedIdentity(before),
        });
        effects.push({ before });
      }
      continue;
    }
    const changed = before === undefined || !jsonValueEqual(covered(before), covered(staged));
    if (!changed) {
      rows.push({
        id,
        resourceKind: kind,
        outcome: "unchanged",
        changed: false,
        resource: before!.resource,
      });
      continue;
    }
    const inputs = provenance.get(id) ?? [];
    if (inputs.some((value) => !jsonValueEqual(value, inputs[0])))
      return refusal({
        ...problem("validation-failed", 422),
        diagnostics: [{ message: "conflicting batch revision provenance inputs" }],
      });
    const resource = materializeBead(
      { ...staged.resource, ...(inputs[0] === undefined ? {} : { provenance: inputs[0] }) },
      id,
      randomUUID(),
      time,
    );
    const after: ResourceState =
      staged.kind === "bead"
        ? { kind: "bead", resource }
        : {
            kind: "link",
            resource: {
              ...resource,
              source: staged.resource.source,
              target: staged.resource.target,
            },
          };
    rows.push({
      id,
      resourceKind: kind,
      outcome: before ? "updated" : "created",
      changed: true,
      resource: after.resource,
    });
    effects.push({ ...(before === undefined ? {} : { before }), after });
  }
  const changed = rows.some((row) => row.changed);
  const transaction = changed ? randomUUID() : undefined;
  const text = serialized({
    capabilityVersion: "1",
    changed,
    ...(transaction ? { transaction } : {}),
    results: mappings,
    resources: rows,
  });
  if (Buffer.byteLength(text) > BATCH_LIMITS.maximumResultBytes)
    return refusal(problem("limit-exceeded", 413));
  return {
    status: 200,
    text,
    rows,
    effects,
    allocations: [...allocated].map(([id, kind]) => ({ id, kind })),
    ...(transaction ? { transaction } : {}),
  };
}
