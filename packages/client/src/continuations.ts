import type { AbsoluteHttpUrl } from "@bdp/protocol";

const MAXIMUM_CONTINUATION_CONTEXTS = 1_024;
const MAXIMUM_CONTINUATION_HISTORY_ENTRIES = 10_000;

export interface ReadSessionRefusal {
  readonly code: "invalid-parameter" | "forbidden" | "temporarily-unavailable";
  readonly detail: string;
}
export function localRefusal(code: ReadSessionRefusal["code"], detail: string): ReadSessionRefusal {
  return Object.freeze({ code, detail });
}
export type ReadSessionResult<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "refusal"; readonly refusal: ReadSessionRefusal };
export class ReadSessionLocalError extends Error {
  constructor(
    readonly reason: "request" | "capability" | "capacity" | "closed",
    message: string,
  ) {
    super(message);
  }
}
export class ReadSessionRequestError extends ReadSessionLocalError {
  constructor(message: string) {
    super("request", message);
  }
}
export class ReadSessionCapabilityError extends ReadSessionLocalError {
  constructor(message: string) {
    super("capability", message);
  }
}
declare const CONTINUATION_SCOPE_BRAND: unique symbol;

/** Opaque ownership token for continuation capabilities issued to one traversal. */
export interface BdpContinuationScope {
  readonly [CONTINUATION_SCOPE_BRAND]: true;
}

export type ContinuationContext =
  | { readonly kind: "collection"; readonly collection: "beads" | "links" | "types" }
  | {
      readonly kind: "bead-links";
      readonly bead: AbsoluteHttpUrl;
      readonly direction: "inbound" | "outbound" | "both";
    };

export class ContinuationRegistryError extends Error {}

export class ContinuationRegistryProtocolError extends ContinuationRegistryError {}

export class ContinuationRegistryCapacityError extends ContinuationRegistryError {}

export interface ContinuationLease {
  readonly url: AbsoluteHttpUrl;
  readonly context: ContinuationContext;
  readonly owner: BdpContinuationScope | undefined;
  readonly history: Set<AbsoluteHttpUrl>;
}

export interface ContinuationReservation {
  readonly context: ContinuationContext;
  readonly lease?: ContinuationLease;
}

export class ContinuationRegistry {
  private readonly entries = new Map<
    AbsoluteHttpUrl,
    Array<{
      readonly context: ContinuationContext;
      readonly owner: BdpContinuationScope | undefined;
      readonly history: Set<AbsoluteHttpUrl>;
    }>
  >();
  private readonly leases = new Set<ContinuationLease>();
  private size = 0;
  private historySize = 0;

  reserve(
    url: AbsoluteHttpUrl,
    owner: BdpContinuationScope | undefined,
    matches: (context: ContinuationContext) => boolean,
  ): ContinuationLease | undefined {
    const entries = this.entries.get(url);
    const index =
      entries?.findIndex((entry) => entry.owner === owner && matches(entry.context)) ?? -1;
    if (entries === undefined || index < 0) return undefined;
    const entry = entries[index];
    if (entry === undefined) return undefined;
    entries.splice(index, 1);
    if (entries.length === 0) this.entries.delete(url);
    const lease = { url, context: entry.context, owner: entry.owner, history: entry.history };
    this.leases.add(lease);
    return lease;
  }

  commit(
    lease: ContinuationLease | undefined,
    next: AbsoluteHttpUrl | null,
    context: ContinuationContext,
    owner: BdpContinuationScope | undefined,
  ): void {
    if (lease !== undefined && !this.leases.has(lease))
      throw new ContinuationRegistryProtocolError("the continuation lease is no longer active");
    if (lease !== undefined && !sameContinuationContext(lease.context, context))
      throw new ContinuationRegistryProtocolError("the continuation context changed");
    if (lease !== undefined && lease.owner !== owner)
      throw new ContinuationRegistryProtocolError("the continuation owner changed");
    if (next !== null && lease?.url === next)
      throw new ContinuationRegistryProtocolError("the response repeated its continuation URL");
    if (next !== null && lease?.history.has(next))
      throw new ContinuationRegistryProtocolError(
        "the response cycled to an earlier continuation URL",
      );

    const candidates = next === null ? undefined : this.entries.get(next);
    if (
      context.kind === "bead-links" &&
      (candidates?.some(
        (candidate) =>
          candidate.owner === owner &&
          candidate.context.kind === "bead-links" &&
          candidate.context.bead === context.bead &&
          candidate.context.direction !== context.direction,
      ) ||
        [...this.leases].some(
          (candidate) =>
            candidate.owner === owner &&
            candidate.url === next &&
            candidate.context.kind === "bead-links" &&
            candidate.context.bead === context.bead &&
            candidate.context.direction !== context.direction,
        ))
    )
      throw new ContinuationRegistryProtocolError(
        "the continuation URL is ambiguous across incident-Link directions",
      );
    const additions = next === null ? 0 : 1;
    const consumed = lease === undefined ? 0 : 1;
    if (this.size - consumed + additions > MAXIMUM_CONTINUATION_CONTEXTS)
      throw new ContinuationRegistryCapacityError(
        "the continuation registry reached its local bound",
      );
    const releasedHistory = next === null ? (lease?.history.size ?? 0) : 0;
    const addedHistory = next === null ? 0 : 1;
    if (this.historySize - releasedHistory + addedHistory > MAXIMUM_CONTINUATION_HISTORY_ENTRIES)
      throw new ContinuationRegistryCapacityError(
        "the continuation history reached its local bound",
      );
    if (lease !== undefined) {
      this.leases.delete(lease);
      this.size -= 1;
      if (next === null) this.historySize -= lease.history.size;
    }
    if (next !== null) {
      const history = lease?.history ?? new Set<AbsoluteHttpUrl>();
      history.add(next);
      this.historySize += 1;
      this.add(next, context, owner, true, history);
    }
  }

  restore(lease: ContinuationLease | undefined): void {
    if (lease === undefined || !this.leases.delete(lease)) return;
    this.add(lease.url, lease.context, lease.owner, false, lease.history);
  }

  clear(): void {
    this.entries.clear();
    this.leases.clear();
    this.size = 0;
    this.historySize = 0;
  }

  forgetAvailable(owner: BdpContinuationScope): void {
    for (const [url, entries] of this.entries) {
      const retained = entries.filter((entry) => entry.owner !== owner);
      for (const entry of entries) {
        if (entry.owner === owner) {
          this.size -= 1;
          this.historySize -= entry.history.size;
        }
      }
      if (retained.length === 0) this.entries.delete(url);
      else this.entries.set(url, retained);
    }
  }

  private add(
    url: AbsoluteHttpUrl,
    context: ContinuationContext,
    owner: BdpContinuationScope | undefined,
    count = true,
    history: Set<AbsoluteHttpUrl>,
  ): void {
    const entries = this.entries.get(url);
    const entry = { context, owner, history };
    if (entries === undefined) this.entries.set(url, [entry]);
    else entries.push(entry);
    if (count) this.size += 1;
  }
}

function sameContinuationContext(left: ContinuationContext, right: ContinuationContext): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "collection" && right.kind === "collection")
    return left.collection === right.collection;
  if (left.kind !== "bead-links" || right.kind !== "bead-links") return false;
  return left.bead === right.bead && left.direction === right.direction;
}

/** Internal lifecycle and continuation ownership shared by Read and History.
 * Direct ReadSession/RU users retain a private default instance. */
export class SessionCore {
  readonly continuations = new ContinuationRegistry();
  private readonly owners = new WeakSet<BdpContinuationScope>();
  generation = 0;
  closed = false;
  checkOpen(): void {
    if (this.closed) throw new ReadSessionLocalError("closed", "the Read session is closed");
  }
  owner(scope: BdpContinuationScope | undefined): BdpContinuationScope | undefined {
    if (scope !== undefined && !this.owners.has(scope))
      throw new ReadSessionRequestError("continuation scope was not created by this client");
    return scope;
  }
  createContinuationScope(): BdpContinuationScope {
    this.checkOpen();
    const owner = Object.freeze(Object.create(null)) as BdpContinuationScope;
    this.owners.add(owner);
    return owner;
  }
  forgetContinuations(scope: BdpContinuationScope): void {
    const owner = this.owner(scope);
    if (owner === undefined) throw new ReadSessionRequestError("continuation scope is required");
    this.continuations.forgetAvailable(owner);
  }
  clear(): void {
    this.closed = true;
    this.generation++;
    this.continuations.clear();
  }
}
