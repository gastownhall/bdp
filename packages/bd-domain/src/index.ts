import {
  BDP_EXTERNAL_REFERENCE_TYPE,
  isReadProblem,
  readProblem,
  REFERENCE_BLOCKING_LINK_TYPE_ID,
  type AbsoluteHttpUrl,
  type BeadRecord,
  type LinkCollection,
  type LinkRecord,
  type ReadProblem,
} from "@bdp/protocol";
import { isBdpClientProblem, type BdpClient, type BdpContinuationScope } from "@bdp/client";

/** Identifies the bd-domain package without defining domain mappings or commands. */
export const packageName = "@bdp/bd-domain";
export const BLOCKING_LINK_TYPE_ID = REFERENCE_BLOCKING_LINK_TYPE_ID;

const MAXIMUM_READINESS_PAGES = 10_000;
const MAXIMUM_READINESS_ITEMS = 100_000;
const MAXIMUM_READINESS_REQUESTS = 10_000;

interface ReadinessTraversalBudget {
  remainingItems: number;
  remainingRequests: number;
}

export {
  ReadyOutputCompatibilityError,
  renderReadyJson,
  renderReadyText,
} from "./ready-output.js";

export interface ReadyBead {
  readonly bead: BeadRecord;
  readonly blockers: readonly BeadRecord[];
}

export interface ReadinessOptions {
  /** The nominal Link Type ID that represents a blocking dependency. */
  readonly blockingLinkType: AbsoluteHttpUrl;
  readonly signal?: AbortSignal;
}

/** Distinguishes a readiness failure from the successful ReadyBead array. */
export function isReadinessProblem(value: unknown): value is ReadProblem {
  return !Array.isArray(value) && isReadProblem(value);
}

export function isReadyBead(bead: BeadRecord, blockers: readonly BeadRecord[]): boolean {
  if (readPropertyString(bead.properties, "status") !== "open") return false;
  return blockers.every((blocker) => readPropertyString(blocker.properties, "status") === "closed");
}

export function readyBeadsFromRecords(
  beads: readonly BeadRecord[],
  options: Pick<ReadinessOptions, "blockingLinkType">,
): readonly ReadyBead[] {
  const beadById = new Map(beads.map((bead) => [bead.id, bead] as const));
  const ready: ReadyBead[] = [];

  for (const bead of beads) {
    const blockingLinks =
      bead.links?.items.filter(
        (link) => link.type === options.blockingLinkType && link.source.id === bead.id,
      ) ?? [];
    const resolvedBlockers = blockingLinks
      .map((link) => beadById.get(link.target.id))
      .filter((candidate): candidate is BeadRecord => candidate !== undefined);
    if (resolvedBlockers.length === blockingLinks.length && isReadyBead(bead, resolvedBlockers)) {
      ready.push(Object.freeze({ bead, blockers: Object.freeze(resolvedBlockers) }));
    }
  }

  return Object.freeze(ready.sort(compareReadyBeads));
}

function compareReadyBeads(left: ReadyBead, right: ReadyBead): number {
  const leftPriority = readPropertyNumber(left.bead.properties, "priority");
  const rightPriority = readPropertyNumber(right.bead.properties, "priority");
  const priorityOrder = compareOptionalNumbers(leftPriority, rightPriority);
  if (priorityOrder !== 0) return priorityOrder;

  const leftCreatedAt = readPropertyTimestamp(left.bead.properties, "created_at");
  const rightCreatedAt = readPropertyTimestamp(right.bead.properties, "created_at");
  const creationOrder = compareOptionalNumbers(rightCreatedAt, leftCreatedAt);
  if (creationOrder !== 0) return creationOrder;

  return left.bead.id < right.bead.id ? -1 : left.bead.id > right.bead.id ? 1 : 0;
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return left - right;
}

export async function readyBeadsFromClient(
  client: BdpClient,
  options: ReadinessOptions,
): Promise<readonly ReadyBead[] | ReadProblem> {
  const continuationScope = client.createContinuationScope();
  const budget: ReadinessTraversalBudget = {
    remainingItems: MAXIMUM_READINESS_ITEMS,
    remainingRequests: MAXIMUM_READINESS_REQUESTS,
  };
  try {
    const discovery = await client.discover(
      options.signal === undefined ? {} : { signal: options.signal },
    );
    if (isBdpClientProblem(discovery)) return discovery;
    const allBeads = await readAllBeads(client, continuationScope, budget, options.signal);
    if (isReadProblem(allBeads)) return allBeads;
    const beads = [...allBeads];

    const withLinks: BeadRecord[] = [];
    for (const bead of beads) {
      const links = await readAllIncidentLinks(
        client,
        bead.id,
        continuationScope,
        budget,
        options.signal,
      );
      if (isReadProblem(links)) return links;
      withLinks.push({ ...bead, links });
    }

    const missingBlockerIds = new Set<string>();
    const knownIds = new Set(withLinks.map((bead) => bead.id));
    for (const bead of withLinks) {
      for (const link of bead.links?.items ?? []) {
        // External targets stay opaque. They remain unresolved blockers in
        // readyBeadsFromRecords, but the domain must never dereference them as Beads.
        if (
          link.type === options.blockingLinkType &&
          link.target.type !== BDP_EXTERNAL_REFERENCE_TYPE &&
          !knownIds.has(link.target.id)
        ) {
          missingBlockerIds.add(link.target.id);
        }
      }
    }
    for (const blockerId of missingBlockerIds) {
      if (!consumeTraversalRequest(budget)) return requestLimitProblem();
      const blocker = await client.perform(
        { kind: "resource", resource: "bead", id: blockerId },
        {
          continuationScope,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
      if (isBdpClientProblem(blocker)) {
        if (blocker.code === "resource-not-found") continue;
        return blocker;
      }
      if (!consumeTraversalItems(budget, 1)) return itemLimitProblem();
      withLinks.push(blocker);
    }

    const candidateIds = new Set(beads.map((bead) => bead.id));
    return readyBeadsFromRecords(withLinks, options).filter(({ bead }) =>
      candidateIds.has(bead.id),
    );
  } finally {
    client.forgetContinuations(continuationScope);
  }
}

async function readAllBeads(
  client: BdpClient,
  continuationScope: BdpContinuationScope,
  budget: ReadinessTraversalBudget,
  signal: AbortSignal | undefined,
): Promise<readonly BeadRecord[] | ReadProblem> {
  const beads: BeadRecord[] = [];
  let continuation: string | undefined;
  const seen = new Set<string>();
  let pages = 0;
  do {
    if (
      pages++ >= MAXIMUM_READINESS_PAGES ||
      (continuation !== undefined && seen.has(continuation))
    )
      return paginationProblem();
    if (continuation !== undefined) seen.add(continuation);
    if (!consumeTraversalRequest(budget)) return requestLimitProblem();
    const page = await client.perform(
      {
        kind: "collection",
        collection: "beads",
        ...(continuation === undefined ? {} : { continuation }),
      },
      { continuationScope, ...(signal === undefined ? {} : { signal }) },
    );
    if (isBdpClientProblem(page)) return page;
    if (!consumeTraversalItems(budget, page.items.length)) return itemLimitProblem();
    beads.push(...page.items);
    continuation = page.next ?? undefined;
  } while (continuation !== undefined);
  return beads;
}

async function readAllIncidentLinks(
  client: BdpClient,
  bead: string,
  continuationScope: BdpContinuationScope,
  budget: ReadinessTraversalBudget,
  signal: AbortSignal | undefined,
): Promise<LinkCollection | ReadProblem> {
  const items: LinkRecord[] = [];
  let continuation: string | undefined;
  const seen = new Set<string>();
  let pages = 0;
  do {
    if (
      pages++ >= MAXIMUM_READINESS_PAGES ||
      (continuation !== undefined && seen.has(continuation))
    )
      return paginationProblem();
    if (continuation !== undefined) seen.add(continuation);
    if (!consumeTraversalRequest(budget)) return requestLimitProblem();
    const page = await client.perform(
      {
        kind: "bead-links",
        bead,
        // The pinned `bd dep add ISSUE BLOCKER` oracle maps ISSUE to the
        // outbound Link source and BLOCKER to its target.
        ...(continuation === undefined ? { direction: "outbound" } : { continuation }),
      },
      { continuationScope, ...(signal === undefined ? {} : { signal }) },
    );
    if (isBdpClientProblem(page)) return page;
    if (!consumeTraversalItems(budget, page.items.length)) return itemLimitProblem();
    items.push(...page.items);
    continuation = page.next ?? undefined;
  } while (continuation !== undefined);
  return { items, next: null };
}

function paginationProblem(): ReadProblem {
  return Object.freeze(readProblem("temporarily-unavailable", "pagination did not make progress"));
}

function itemLimitProblem(): ReadProblem {
  return Object.freeze(
    readProblem("temporarily-unavailable", "readiness traversal exceeded its local item bound"),
  );
}

function requestLimitProblem(): ReadProblem {
  return Object.freeze(
    readProblem("temporarily-unavailable", "readiness traversal exceeded its local request bound"),
  );
}

function consumeTraversalItems(budget: ReadinessTraversalBudget, count: number): boolean {
  if (count > budget.remainingItems) return false;
  budget.remainingItems -= count;
  return true;
}

function consumeTraversalRequest(budget: ReadinessTraversalBudget): boolean {
  if (budget.remainingRequests === 0) return false;
  budget.remainingRequests -= 1;
  return true;
}

function readPropertyString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readPropertyNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readPropertyTimestamp(record: Record<string, unknown>, key: string): number | undefined {
  const value = readPropertyString(record, key);
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value))
    return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19)
    ? timestamp
    : undefined;
}
