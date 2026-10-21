/** Validate the ordinary evaluator's complete owned transition, then replace
 * only correction deltas with the erasure-safe form. No ownership synthesis. */

import { isDeepStrictEqual } from "node:util";
import { referenceUri } from "@bdp/protocol";
import type { ResourceRecord } from "./resource-evaluator.js";
import type { TransactionEvent, TransactionStateChange } from "./transaction-batch.js";
import { liveCorrectionEvent } from "./transaction-live-correction.js";

export function liveOwnedLinkEvents(
  scope: string,
  before: ResourceRecord,
  sourceBefore: ResourceRecord,
  changes: readonly TransactionStateChange[],
  events: readonly TransactionEvent[],
  kind: "correction" | "tombstone",
): TransactionEvent[] {
  if (!("source" in before) || "source" in sourceBefore)
    throw new Error("owned Link and source Bead required");
  const sourceChange = changes.find((item) => item.resource.id === sourceBefore.id);
  const linkChange = changes.find((item) => item.resource.id === before.id);
  const sourceEvent = events.at(-1),
    linkEvent = events[0];
  if (
    changes.length !== 2 ||
    !sourceChange ||
    sourceChange.operation !== "upsert" ||
    sourceChange.resourceKind !== "bead" ||
    !("properties" in sourceChange.resource) ||
    "source" in sourceChange.resource ||
    sourceChange.resource.revision === sourceBefore.revision ||
    !linkChange ||
    !sourceEvent ||
    sourceEvent.subject !== sourceBefore.id ||
    sourceEvent.type !== "updated" ||
    !linkEvent ||
    linkEvent.subject !== before.id ||
    linkEvent.type !== (kind === "correction" ? "updated" : "deleted")
  )
    throw new Error(
      "live owned-Link erasure requires the complete ordinary Link/source transition",
    );
  const data = sourceEvent.data as Record<string, unknown>;
  const owned = data.ownedLink as
    | { operation?: string; link?: Record<string, unknown> }
    | undefined;
  if (
    data.previousRevision !== sourceBefore.revision ||
    data.revision !== sourceChange.resource.revision ||
    data.change !== undefined ||
    data.metadataChange !== undefined ||
    owned?.operation !== (kind === "correction" ? "updated" : "deleted") ||
    owned.link?.id !== before.id ||
    owned.link.type !== before.type
  )
    throw new Error("ordinary owning-source fact does not match the complete transition");
  const inline = sourceChange.resource.ownedLinks?.[before.type] ?? [];
  if (kind === "tombstone") {
    if (
      linkChange.operation !== "tombstone" ||
      linkChange.resourceKind !== "link" ||
      !isDeepStrictEqual(linkChange.resource, {
        id: before.id,
        type: before.type,
        revision: before.revision,
      }) ||
      !isDeepStrictEqual(linkEvent.data, { revision: before.revision }) ||
      !isDeepStrictEqual(owned.link, linkChange.resource) ||
      inline.some((item) => item.id === before.id) ||
      events.length !==
        2 +
          [before.source, before.target].filter((endpoint) =>
            referenceUri(endpoint).startsWith(scope),
          ).length ||
      events.slice(1, -1).some((item) => item.type !== "unlinked" || item.subject !== before.id)
    )
      throw new Error("owned Link tombstone lacks ordinary identity-only deletion/complete set");
    return [...events];
  }
  if (
    linkChange.operation !== "upsert" ||
    linkChange.resourceKind !== "link" ||
    !("source" in linkChange.resource) ||
    events.length !== 2 ||
    !isDeepStrictEqual(before.source, linkChange.resource.source) ||
    !isDeepStrictEqual(before.target, linkChange.resource.target) ||
    before.type !== linkChange.resource.type ||
    !isDeepStrictEqual(
      inline.find((item) => item.id === before.id),
      linkChange.resource,
    )
  )
    throw new Error("owned Link correction changed identity/endpoints or lost inline agreement");
  const safe = liveCorrectionEvent(before, linkChange.resource, linkEvent);
  return [
    safe,
    {
      ...sourceEvent,
      data: {
        ...data,
        ownedLink: {
          operation: "updated",
          link: {
            id: before.id,
            type: before.type,
            ...(safe.data as object),
          },
        },
      },
    },
  ];
}
