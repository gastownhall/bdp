import { isProxy } from "node:util/types";

export interface ReadPaginationOptions {
  /** Absolute canonical Scope URL, including its trailing slash. */
  readonly scope: string;
  readonly defaultPageItems: number;
  readonly maxPageItems: number;
  readonly cursorTtlMs: number;
  /** Maximum combined retained snapshots and reserved cursor/page positions. */
  readonly retainedStateCapacity: number;
  /** Maximum future cursor/page positions one admitted snapshot may reserve. */
  readonly maxRetainedCursorPositionsPerSnapshot: number;
  /** Maximum UTF-8 JSON byte weight retained across active snapshots. */
  readonly retainedSnapshotByteCapacity: number;
  /** Maximum JSON value/property positions retained across active snapshots. */
  readonly retainedSnapshotNodeCapacity: number;
  readonly maxOpaqueTokenLength: number;
  readonly tokenGenerationAttempts: number;
  /** Whether expiry also runs while no pagination method is being called. */
  readonly idleCleanup?: "timer" | "on-demand";
  readonly clock: () => number;
  readonly generateOpaqueToken: () => string;
}

export interface ReadPage<Item> {
  readonly items: readonly Item[];
  readonly next: string | null;
}

export interface ReadFirstPageInput<Item> {
  /** Complete, already filtered, deterministically ordered candidate set. */
  readonly items: readonly Item[];
  readonly limit?: number;
  readonly authorizationView: string;
  readonly scopeEpoch: string;
  /** Stable identity for the collection or incident-Link projection. */
  readonly projection: string;
  /** Absolute in-Scope URL retaining all parameters required by this projection. */
  readonly continuationUrl: string;
}

export interface ReadContinuationInput {
  readonly token: string;
  readonly authorizationView: string;
  readonly scopeEpoch: string;
  readonly projection: string;
}

export interface ReadPaginationCleanup {
  readonly releasedSnapshots: number;
  readonly releasedCursors: number;
}

export type ReadPaginationErrorCode =
  | "configuration-error"
  | "invalid-input"
  | "invalid-limit"
  | "invalid-snapshot"
  | "capacity-exceeded"
  | "token-generation-failed"
  | "cursor-expired"
  | "foreign-view"
  | "foreign-projection";

export type ReadCursorExpiryReason = "unknown" | "expired" | "epoch-changed";

/** Local server outcome only; the HTTP composition layer owns BDP Problem mapping. */
export class ReadPaginationError extends Error {
  readonly cursorReason: ReadCursorExpiryReason | undefined;

  constructor(
    readonly code: ReadPaginationErrorCode,
    message: string,
    cursorReason?: ReadCursorExpiryReason,
  ) {
    super(message);
    this.name = "ReadPaginationError";
    this.cursorReason = cursorReason;
  }
}

interface CursorBinding<Item> {
  readonly snapshot: Snapshot<Item>;
  readonly offset: number;
}

interface Snapshot<Item> {
  readonly items: readonly Item[];
  readonly limit: number;
  readonly authorizationView: string;
  readonly scopeEpoch: string;
  readonly projection: string;
  readonly continuationUrl: string;
  readonly expiresAt: number;
  readonly retainedBytes: number;
  readonly retainedNodes: number;
  /** Cursor/page positions reserved atomically when the snapshot is admitted. */
  readonly reservedCursorPositions: number;
  /** One stable token per deterministic page position, minted at most once. */
  readonly cursors: Map<number, string>;
  /** Stable replay returns the exact same immutable page object. */
  readonly pages: Map<number, ReadPage<Item>>;
}

export interface ReadPagination<Item> {
  readonly limits: {
    readonly defaultPageItems: number;
    readonly maxPageItems: number;
    readonly cursorTtlMs: number;
  };
  validateLimit(limit: number | undefined): number;
  firstPage(input: ReadFirstPageInput<Item>): ReadPage<Item>;
  continuePage(input: ReadContinuationInput): ReadPage<Item>;
  cleanupExpired(): ReadPaginationCleanup;
  close(): ReadPaginationCleanup;
}

interface PreparedOptions {
  readonly scope: URL;
  readonly defaultPageItems: number;
  readonly maxPageItems: number;
  readonly cursorTtlMs: number;
  readonly retainedStateCapacity: number;
  readonly maxRetainedCursorPositionsPerSnapshot: number;
  readonly retainedSnapshotByteCapacity: number;
  readonly retainedSnapshotNodeCapacity: number;
  readonly maxOpaqueTokenLength: number;
  readonly tokenGenerationAttempts: number;
  readonly idleCleanup: "timer" | "on-demand";
  readonly clock: () => number;
  readonly generateOpaqueToken: () => string;
}

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]+$/;

/**
 * Creates one in-process snapshot/cursor authority. A snapshot is retained through its original
 * TTL even after its terminal page is reached so replaying any issued cursor remains stable. It is
 * then released atomically with all of its cursor positions; capacity pressure never evicts an
 * active snapshot. The token generator receives no snapshot data and must supply unpredictable
 * opaque entropy suitable for a public URL.
 */
export function createReadPagination<Item = unknown>(
  options: ReadPaginationOptions,
): ReadPagination<Item> {
  const prepared = prepareOptions(options);
  const snapshots = new Set<Snapshot<Item>>();
  const cursorIndex = new Map<string, CursorBinding<Item>>();
  let retainedSnapshotBytes = 0;
  let retainedSnapshotNodes = 0;
  let retainedCursorPositions = 0;
  let activeScopeEpoch: string | undefined;
  let closed = false;
  let idleCleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let lastClockValue = 0;

  const clock = (): number => {
    let value: unknown;
    try {
      value = prepared.clock();
    } catch {
      throw localError("configuration-error", "the pagination clock failed");
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw localError("configuration-error", "the pagination clock returned an invalid time");
    }
    // Snapshot expiry order must match insertion order so idle cleanup can use the
    // Set as a FIFO queue. A wall clock adjustment must not move pagination time
    // backwards or extend an already-advertised snapshot lifetime.
    lastClockValue = Math.max(lastClockValue, value);
    return lastClockValue;
  };

  const release = (snapshot: Snapshot<Item>): number => {
    if (!snapshots.delete(snapshot)) return 0;
    retainedSnapshotBytes -= snapshot.retainedBytes;
    retainedSnapshotNodes -= snapshot.retainedNodes;
    retainedCursorPositions -= snapshot.reservedCursorPositions;
    let releasedCursors = 0;
    for (const token of snapshot.cursors.values()) {
      const binding = cursorIndex.get(token);
      if (binding?.snapshot === snapshot) {
        cursorIndex.delete(token);
        releasedCursors += 1;
      }
    }
    snapshot.cursors.clear();
    snapshot.pages.clear();
    return releasedCursors;
  };

  const cleanupAt = (now: number): ReadPaginationCleanup => {
    let releasedSnapshots = 0;
    let releasedCursors = 0;
    for (const snapshot of snapshots) {
      if (now < snapshot.expiresAt) break;
      releasedCursors += release(snapshot);
      releasedSnapshots += 1;
    }
    return Object.freeze({ releasedSnapshots, releasedCursors });
  };

  const releaseAll = (): ReadPaginationCleanup => {
    let releasedSnapshots = 0;
    let releasedCursors = 0;
    for (const snapshot of [...snapshots]) {
      releasedCursors += release(snapshot);
      releasedSnapshots += 1;
    }
    return Object.freeze({ releasedSnapshots, releasedCursors });
  };

  const scheduleIdleCleanup = (): void => {
    if (prepared.idleCleanup !== "timer" || closed) return;
    if (idleCleanupTimer !== undefined) clearTimeout(idleCleanupTimer);
    const earliest = snapshots.values().next().value as Snapshot<Item> | undefined;
    if (earliest === undefined) {
      idleCleanupTimer = undefined;
      return;
    }
    const delay = Math.min(Math.max(0, earliest.expiresAt - clock()), 2_147_483_647);
    idleCleanupTimer = setTimeout(() => {
      idleCleanupTimer = undefined;
      if (closed) return;
      cleanupAt(clock());
      scheduleIdleCleanup();
    }, delay);
    idleCleanupTimer.unref();
  };

  const requireOpen = (): void => {
    if (closed) throw localError("configuration-error", "pagination is closed");
  };

  const assertRetainedStateCapacity = (cursorPositions: number): void => {
    if (
      snapshots.size + retainedCursorPositions + 1 + cursorPositions >
      prepared.retainedStateCapacity
    ) {
      throw localError("capacity-exceeded", "pagination retained-state capacity is exhausted");
    }
  };

  const generateToken = (): string => {
    for (let attempt = 0; attempt < prepared.tokenGenerationAttempts; attempt += 1) {
      let candidate: unknown;
      try {
        candidate = prepared.generateOpaqueToken();
      } catch {
        throw localError("token-generation-failed", "opaque cursor generation failed");
      }
      if (
        typeof candidate === "string" &&
        candidate.length > 0 &&
        candidate.length <= prepared.maxOpaqueTokenLength &&
        OPAQUE_TOKEN.test(candidate) &&
        !cursorIndex.has(candidate)
      ) {
        return candidate;
      }
    }
    throw localError(
      "token-generation-failed",
      "opaque cursor generation did not produce a bounded unique token",
    );
  };

  const cursorFor = (snapshot: Snapshot<Item>, offset: number): string => {
    const existing = snapshot.cursors.get(offset);
    if (existing !== undefined) return existing;
    const token = generateToken();
    snapshot.cursors.set(offset, token);
    cursorIndex.set(token, Object.freeze({ snapshot, offset }));
    return token;
  };

  const pageAt = (snapshot: Snapshot<Item>, offset: number): ReadPage<Item> => {
    const cached = snapshot.pages.get(offset);
    if (cached !== undefined) return cached;

    const items = Object.freeze(snapshot.items.slice(offset, offset + snapshot.limit));
    const followingOffset = offset + items.length;
    const next =
      followingOffset < snapshot.items.length
        ? continuationUrl(snapshot.continuationUrl, cursorFor(snapshot, followingOffset))
        : null;
    const page: ReadPage<Item> = Object.freeze({ items, next });
    snapshot.pages.set(offset, page);
    return page;
  };

  const pagination: ReadPagination<Item> = {
    limits: Object.freeze({
      defaultPageItems: prepared.defaultPageItems,
      maxPageItems: prepared.maxPageItems,
      cursorTtlMs: prepared.cursorTtlMs,
    }),

    validateLimit(limit: number | undefined): number {
      requireOpen();
      return validateLimit(limit, prepared);
    },

    firstPage(input: ReadFirstPageInput<Item>): ReadPage<Item> {
      requireOpen();
      const now = clock();
      cleanupAt(now);
      const limit = validateLimit(input.limit, prepared);
      const authorizationView = identity(input.authorizationView);
      const scopeEpoch = identity(input.scopeEpoch);
      const projection = identity(input.projection);
      const continuation = validateContinuationUrl(input.continuationUrl, prepared.scope);

      // A first-page request carries the authority's current internal epoch. Once it changes, no
      // prior-epoch snapshot can be continued and all of its retained capacity is released before
      // the restored epoch attempts to take a new snapshot.
      if (activeScopeEpoch !== undefined && activeScopeEpoch !== scopeEpoch) {
        for (const snapshot of snapshots) release(snapshot);
      }
      activeScopeEpoch = scopeEpoch;

      const willRetain =
        Array.isArray(input.items) && !isProxy(input.items) && input.items.length > limit;
      const byteCapacity = willRetain
        ? prepared.retainedSnapshotByteCapacity - retainedSnapshotBytes
        : prepared.retainedSnapshotByteCapacity;
      const nodeCapacity = willRetain
        ? prepared.retainedSnapshotNodeCapacity - retainedSnapshotNodes
        : prepared.retainedSnapshotNodeCapacity;
      const copied = snapshotItems(input.items, byteCapacity, nodeCapacity);
      const { items } = copied;

      if (items.length <= limit) {
        return Object.freeze({ items: Object.freeze(items.slice()), next: null });
      }

      // Reserve every future cursor/page position atomically, but mint tokens lazily. This makes
      // traversal denial-free after admission without allocating one opaque token per page up
      // front, and keeps client-driven cursor/page metadata within the retained-state bound.
      const reservedCursorPositions = Math.ceil(items.length / limit) - 1;
      if (reservedCursorPositions > prepared.maxRetainedCursorPositionsPerSnapshot) {
        throw localError(
          "capacity-exceeded",
          "this pagination snapshot exceeds the per-snapshot retained-state limit",
        );
      }
      assertRetainedStateCapacity(reservedCursorPositions);
      const expiresAt = now + prepared.cursorTtlMs;
      if (!Number.isFinite(expiresAt)) {
        throw localError("configuration-error", "the cursor expiry time is outside range");
      }
      const snapshot: Snapshot<Item> = {
        items,
        limit,
        authorizationView,
        scopeEpoch,
        projection,
        continuationUrl: continuation,
        expiresAt,
        retainedBytes: copied.retainedBytes,
        retainedNodes: copied.retainedNodes,
        reservedCursorPositions,
        cursors: new Map(),
        pages: new Map(),
      };

      // Register the snapshot first so the capacity count accounts for it. Roll back if first-
      // cursor construction fails; no partially continuable snapshot escapes.
      snapshots.add(snapshot);
      retainedSnapshotBytes += copied.retainedBytes;
      retainedSnapshotNodes += copied.retainedNodes;
      retainedCursorPositions += reservedCursorPositions;
      try {
        const page = pageAt(snapshot, 0);
        scheduleIdleCleanup();
        return page;
      } catch (error) {
        release(snapshot);
        scheduleIdleCleanup();
        throw error;
      }
    },

    continuePage(input: ReadContinuationInput): ReadPage<Item> {
      requireOpen();
      const now = clock();
      const direct = cursorIndex.get(input.token);
      if (direct !== undefined && now >= direct.snapshot.expiresAt) {
        release(direct.snapshot);
        scheduleIdleCleanup();
        throw localError("cursor-expired", "the pagination cursor expired", "expired");
      }
      cleanupAt(now);
      const binding = cursorIndex.get(input.token);
      if (binding === undefined) {
        throw localError("cursor-expired", "the pagination cursor is unavailable", "unknown");
      }
      const { snapshot } = binding;
      if (identity(input.scopeEpoch) !== snapshot.scopeEpoch) {
        release(snapshot);
        scheduleIdleCleanup();
        throw localError(
          "cursor-expired",
          "the pagination cursor belongs to another Scope epoch",
          "epoch-changed",
        );
      }
      if (identity(input.authorizationView) !== snapshot.authorizationView) {
        throw localError("foreign-view", "the pagination cursor belongs to another view");
      }
      if (identity(input.projection) !== snapshot.projection) {
        throw localError(
          "foreign-projection",
          "the pagination cursor belongs to another projection",
        );
      }
      const page = pageAt(snapshot, binding.offset);
      scheduleIdleCleanup();
      return page;
    },

    cleanupExpired(): ReadPaginationCleanup {
      if (closed) return Object.freeze({ releasedSnapshots: 0, releasedCursors: 0 });
      const cleanup = cleanupAt(clock());
      scheduleIdleCleanup();
      return cleanup;
    },

    close(): ReadPaginationCleanup {
      if (closed) return Object.freeze({ releasedSnapshots: 0, releasedCursors: 0 });
      closed = true;
      if (idleCleanupTimer !== undefined) clearTimeout(idleCleanupTimer);
      idleCleanupTimer = undefined;
      activeScopeEpoch = undefined;
      return releaseAll();
    },
  };
  return Object.freeze(pagination);
}

function prepareOptions(options: ReadPaginationOptions): PreparedOptions {
  let scope: URL;
  try {
    scope = new URL(options.scope);
  } catch {
    throw localError("configuration-error", "pagination Scope must be an absolute URL");
  }
  if (
    (scope.protocol !== "http:" && scope.protocol !== "https:") ||
    scope.username !== "" ||
    scope.password !== "" ||
    scope.search !== "" ||
    scope.hash !== "" ||
    !scope.pathname.endsWith("/")
  ) {
    throw localError(
      "configuration-error",
      "pagination Scope must be a credential-free canonical HTTP URL with a trailing slash",
    );
  }
  requirePositiveInteger(options.defaultPageItems, "defaultPageItems");
  requirePositiveInteger(options.maxPageItems, "maxPageItems");
  if (options.defaultPageItems > options.maxPageItems) {
    throw localError("configuration-error", "defaultPageItems must not exceed maxPageItems");
  }
  requirePositiveInteger(options.cursorTtlMs, "cursorTtlMs");
  requirePositiveInteger(options.retainedStateCapacity, "retainedStateCapacity");
  const maxRetainedCursorPositionsPerSnapshot = options.maxRetainedCursorPositionsPerSnapshot;
  requirePositiveInteger(
    maxRetainedCursorPositionsPerSnapshot,
    "maxRetainedCursorPositionsPerSnapshot",
  );
  if (maxRetainedCursorPositionsPerSnapshot >= options.retainedStateCapacity) {
    throw localError(
      "configuration-error",
      "maxRetainedCursorPositionsPerSnapshot must be less than retainedStateCapacity",
    );
  }
  requirePositiveInteger(options.retainedSnapshotByteCapacity, "retainedSnapshotByteCapacity");
  requirePositiveInteger(options.retainedSnapshotNodeCapacity, "retainedSnapshotNodeCapacity");
  requirePositiveInteger(options.maxOpaqueTokenLength, "maxOpaqueTokenLength");
  requirePositiveInteger(options.tokenGenerationAttempts, "tokenGenerationAttempts");
  if (typeof options.clock !== "function" || typeof options.generateOpaqueToken !== "function") {
    throw localError("configuration-error", "pagination dependencies must be functions");
  }
  if (
    options.idleCleanup !== undefined &&
    options.idleCleanup !== "timer" &&
    options.idleCleanup !== "on-demand"
  ) {
    throw localError("configuration-error", "idleCleanup must be 'timer' or 'on-demand'");
  }
  return Object.freeze({
    scope,
    defaultPageItems: options.defaultPageItems,
    maxPageItems: options.maxPageItems,
    cursorTtlMs: options.cursorTtlMs,
    retainedStateCapacity: options.retainedStateCapacity,
    maxRetainedCursorPositionsPerSnapshot,
    retainedSnapshotByteCapacity: options.retainedSnapshotByteCapacity,
    retainedSnapshotNodeCapacity: options.retainedSnapshotNodeCapacity,
    maxOpaqueTokenLength: options.maxOpaqueTokenLength,
    tokenGenerationAttempts: options.tokenGenerationAttempts,
    idleCleanup: options.idleCleanup ?? "on-demand",
    clock: options.clock,
    generateOpaqueToken: options.generateOpaqueToken,
  });
}

function requirePositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw localError("configuration-error", `${name} must be a positive safe integer`);
  }
}

function validateLimit(limit: number | undefined, options: PreparedOptions): number {
  const selected = limit ?? options.defaultPageItems;
  if (
    typeof selected !== "number" ||
    !Number.isSafeInteger(selected) ||
    selected <= 0 ||
    selected > options.maxPageItems
  ) {
    throw localError("invalid-limit", "pagination limit is outside the configured range");
  }
  return selected;
}

function identity(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw localError("invalid-input", "pagination identities must be non-empty strings");
  }
  return value;
}

function validateContinuationUrl(value: unknown, scope: URL): string {
  if (typeof value !== "string") {
    throw localError("invalid-input", "the pagination continuation URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw localError("invalid-input", "the pagination continuation URL must be absolute");
  }
  const cursorParameters = url.searchParams.getAll("cursor");
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== scope.origin ||
    !url.pathname.startsWith(scope.pathname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    cursorParameters.length !== 0
  ) {
    throw localError(
      "invalid-input",
      "the pagination continuation URL must be credential-free and confined to the Scope",
    );
  }
  return url.href;
}

function continuationUrl(base: string, token: string): string {
  const url = new URL(base);
  url.searchParams.set("cursor", token);
  return url.href;
}

interface SnapshotCopy<Item> {
  readonly items: readonly Item[];
  readonly retainedBytes: number;
  readonly retainedNodes: number;
}

interface SnapshotBudget {
  remainingBytes: number;
  remainingNodes: number;
  retainedBytes: number;
  retainedNodes: number;
}

class SnapshotCapacityExceeded extends Error {}

function snapshotItems<Item>(
  input: readonly Item[],
  byteCapacity: number,
  nodeCapacity: number,
): SnapshotCopy<Item> {
  const copied = snapshotJson(input, byteCapacity, nodeCapacity);
  const snapshot = copied.value;
  if (!Array.isArray(snapshot)) {
    throw localError("invalid-snapshot", "pagination items must be an array");
  }
  return Object.freeze({
    items: snapshot as readonly Item[],
    retainedBytes: copied.retainedBytes,
    retainedNodes: copied.retainedNodes,
  });
}

type SnapshotJob =
  | { readonly kind: "value"; readonly input: unknown; readonly assign: (value: unknown) => void }
  | { readonly kind: "finish"; readonly input: object; readonly output: object };

/**
 * Snapshots JSON-compatible input from own data descriptors only. The iterative walk avoids
 * invoking getters or toJSON and rejects proxies before their traps can run.
 */
function snapshotJson(
  input: unknown,
  byteCapacity: number,
  nodeCapacity: number,
): { readonly value: unknown; readonly retainedBytes: number; readonly retainedNodes: number } {
  let root: unknown;
  const budget: SnapshotBudget = {
    remainingBytes: byteCapacity,
    remainingNodes: nodeCapacity,
    retainedBytes: 0,
    retainedNodes: 0,
  };
  const states = new WeakMap<object, "visiting" | "done">();
  const copies = new WeakMap<object, object>();
  const jobs: SnapshotJob[] = [
    {
      kind: "value",
      input,
      assign(value) {
        root = value;
      },
    },
  ];

  try {
    consumeSnapshotNodes(budget, 1);
    while (jobs.length > 0) {
      const job = jobs.pop();
      if (job === undefined) break;
      if (job.kind === "finish") {
        Object.freeze(job.output);
        states.set(job.input, "done");
        continue;
      }

      const value = job.input;
      if (value === null || typeof value === "string" || typeof value === "boolean") {
        if (value === null) consumeSnapshotBytes(budget, 4);
        else if (typeof value === "string") consumeJsonStringBytes(budget, value);
        else consumeSnapshotBytes(budget, value ? 4 : 5);
        job.assign(value);
        continue;
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("non-finite number");
        consumeSnapshotBytes(budget, String(Object.is(value, -0) ? 0 : value).length);
        job.assign(value);
        continue;
      }
      if (typeof value !== "object" || isProxy(value)) throw new Error("non-JSON value");

      const state = states.get(value);
      if (state === "visiting") throw new Error("cycle");
      if (state === "done") {
        const copy = copies.get(value);
        if (copy === undefined) throw new Error("snapshot state");
        job.assign(copy);
        continue;
      }

      const prototype = Object.getPrototypeOf(value);
      const array = Array.isArray(value);
      if (
        array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
      )
        throw new Error("non-plain object");
      const symbols = Object.getOwnPropertySymbols(value);
      for (const symbol of symbols) {
        if (Object.getOwnPropertyDescriptor(value, symbol)?.enumerable === true)
          throw new Error("symbol property");
      }

      const arrayLength = array ? (value as unknown[]).length : undefined;
      if (arrayLength !== undefined && arrayLength > budget.remainingNodes) {
        throw new SnapshotCapacityExceeded();
      }
      const keys: string[] = [];
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (keys.length >= budget.remainingNodes) throw new SnapshotCapacityExceeded();
        keys.push(key);
      }
      consumeSnapshotNodes(budget, keys.length);

      const output: unknown[] | Record<string, unknown> = array ? new Array(arrayLength) : {};
      states.set(value, "visiting");
      copies.set(value, output);
      job.assign(output);
      jobs.push({ kind: "finish", input: value, output });

      if (array) {
        const length = arrayLength;
        if (keys.length !== length) throw new Error("sparse or extended array");
        consumeSnapshotBytes(budget, 2 + Math.max(0, length - 1));
        for (let index = length - 1; index >= 0; index -= 1) {
          const key = String(index);
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (descriptor === undefined || !("value" in descriptor)) throw new Error("accessor");
          jobs.push({
            kind: "value",
            input: descriptor.value,
            assign(entry) {
              Object.defineProperty(output, key, {
                value: entry,
                enumerable: true,
                writable: true,
                configurable: true,
              });
            },
          });
        }
      } else {
        consumeSnapshotBytes(budget, 2 + Math.max(0, keys.length - 1));
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          const key = keys[index];
          if (key === undefined) continue;
          consumeJsonStringBytes(budget, key);
          consumeSnapshotBytes(budget, 1);
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (descriptor === undefined || !("value" in descriptor)) throw new Error("accessor");
          jobs.push({
            kind: "value",
            input: descriptor.value,
            assign(entry) {
              Object.defineProperty(output, key, {
                value: entry,
                enumerable: true,
                writable: true,
                configurable: true,
              });
            },
          });
        }
      }
    }
  } catch (error) {
    if (error instanceof SnapshotCapacityExceeded) {
      throw localError("capacity-exceeded", "pagination snapshot capacity is exhausted");
    }
    throw localError(
      "invalid-snapshot",
      "pagination items must contain plain, acyclic JSON data properties",
    );
  }
  return Object.freeze({
    value: root,
    retainedBytes: budget.retainedBytes,
    retainedNodes: budget.retainedNodes,
  });
}

function consumeSnapshotBytes(budget: SnapshotBudget, amount: number): void {
  if (amount > budget.remainingBytes) throw new SnapshotCapacityExceeded();
  budget.remainingBytes -= amount;
  budget.retainedBytes += amount;
}

function consumeSnapshotNodes(budget: SnapshotBudget, amount: number): void {
  if (amount > budget.remainingNodes) throw new SnapshotCapacityExceeded();
  budget.remainingNodes -= amount;
  budget.retainedNodes += amount;
}

function consumeJsonStringBytes(budget: SnapshotBudget, value: string): void {
  consumeSnapshotBytes(budget, 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      consumeSnapshotBytes(budget, 2);
    } else if (
      code <= 0x1f ||
      (code >= 0xd800 &&
        code <= 0xdfff &&
        !(
          code <= 0xdbff &&
          index + 1 < value.length &&
          value.charCodeAt(index + 1) >= 0xdc00 &&
          value.charCodeAt(index + 1) <= 0xdfff
        ))
    ) {
      consumeSnapshotBytes(budget, 6);
    } else if (code <= 0x7f) {
      consumeSnapshotBytes(budget, 1);
    } else if (code <= 0x7ff) {
      consumeSnapshotBytes(budget, 2);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      consumeSnapshotBytes(budget, 4);
      index += 1;
    } else {
      consumeSnapshotBytes(budget, 3);
    }
  }
}

function localError(
  code: ReadPaginationErrorCode,
  message: string,
  cursorReason?: ReadCursorExpiryReason,
): ReadPaginationError {
  return new ReadPaginationError(code, message, cursorReason);
}
