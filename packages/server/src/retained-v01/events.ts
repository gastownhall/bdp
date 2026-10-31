import {
  eventDeleted,
  referenceUri,
  RetainedRequestError,
  type ResourceState,
} from "./contract.js";

export interface EventSelection {
  readonly from?: "retained" | "now";
  readonly after?: string;
  readonly limit: number;
}
export function parseEventSelection(url: URL, resource: boolean): EventSelection {
  const allowed = ["from", "after", "representation", "limit", ...(resource ? ["view"] : [])];
  for (const name of url.searchParams.keys()) {
    if (!allowed.includes(name) || url.searchParams.getAll(name).length !== 1)
      throw new RetainedRequestError("invalid-parameter", 400);
  }
  if (resource && url.searchParams.get("view") !== "events")
    throw new RetainedRequestError("invalid-parameter", 400);
  const from = url.searchParams.get("from");
  const after = url.searchParams.get("after");
  const representation = url.searchParams.get("representation");
  if (
    (from !== null && from !== "retained" && from !== "now") ||
    (from !== null && after !== null) ||
    after === "" ||
    (representation !== null && representation !== "postimage")
  )
    throw new RetainedRequestError("invalid-parameter", 400);
  const rawLimit = url.searchParams.get("limit") ?? "20";
  if (!/^[1-9][0-9]*$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)))
    throw new RetainedRequestError("invalid-parameter", 400);
  if (Number(rawLimit) > 100) throw new RetainedRequestError("limit-exceeded", 413);
  return {
    ...(from === null ? {} : { from }),
    ...(after === null ? {} : { after }),
    limit: Number(rawLimit),
  };
}
export function lifecycleFact(
  verb: "create" | "update" | "delete",
  state: ResourceState,
  source: string,
  id: string,
  transaction: string,
  time: string,
  previousRevision?: string,
) {
  if (verb === "update" && !previousRevision)
    throw new TypeError("update fact requires predecessor");
  const operation = `${verb}${state.kind === "bead" ? "Bead" : "Link"}`;
  const effect =
    verb === "create"
      ? { operation, id: state.resource.id, resource: state.resource }
      : {
          operation,
          [state.kind]: state.resource.id,
          ...(verb === "delete" ? { deleted: eventDeleted(state) } : { resource: state.resource }),
        };
  return {
    id,
    source,
    time,
    origin: "write",
    transaction,
    representation: "postimage",
    revision: state.resource.revision,
    ...(verb === "update" ? { previousRevision } : {}),
    effect,
  };
}
export function incidentBeads(
  scope: string,
  ...states: readonly (ResourceState | undefined)[]
): readonly string[] {
  const ids = new Set<string>();
  for (const state of states) {
    if (state?.kind !== "link") continue;
    for (const reference of [state.resource.source, state.resource.target]) {
      const uri = referenceUri(reference);
      if (uri.startsWith(scope)) ids.add(uri);
    }
  }
  return [...ids];
}
export const EVENT_POLICY = Object.freeze({
  observation: "committed",
  description:
    "Private Core-only Resource CRUD fixture; committed transitions from explicit empty provisioning.",
  minimumRetentionSeconds: 86400,
  minimumCursorLifetimeSeconds: 300,
  representations: Object.freeze(["postimage"]),
  maximumPageSize: 100,
});
