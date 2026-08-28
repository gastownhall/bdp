import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { createReadPagination, ReadPaginationError } from "./read-pagination.js";

function harness<Item = unknown>(
  overrides: Partial<Parameters<typeof createReadPagination>[0]> = {},
) {
  let sequence = 0;
  let now = 1_000;
  const retainedStateCapacity = overrides.retainedStateCapacity ?? 20;
  const pagination = createReadPagination<Item>({
    scope: "https://beads.example/acme/",
    defaultPageItems: 2,
    maxPageItems: 3,
    cursorTtlMs: 1_000,
    retainedStateCapacity,
    maxRetainedCursorPositionsPerSnapshot:
      overrides.maxRetainedCursorPositionsPerSnapshot ?? retainedStateCapacity - 1,
    retainedSnapshotByteCapacity: 10_000,
    retainedSnapshotNodeCapacity: 1_000,
    maxOpaqueTokenLength: 40,
    tokenGenerationAttempts: 3,
    clock: () => now,
    generateOpaqueToken: () => `token_${++sequence}`,
    ...overrides,
  });
  return {
    pagination,
    advance(ms: number) {
      now += ms;
    },
  };
}

const identity = Object.freeze({
  authorizationView: "view-1",
  scopeEpoch: "epoch-1",
  projection: "beads-collection",
});

function firstInput(items: readonly unknown[], limit?: number) {
  return {
    items,
    ...(limit === undefined ? {} : { limit }),
    ...identity,
    continuationUrl: "https://beads.example/acme/beads/?type=task",
  };
}

function tokenFrom(next: string | null): string {
  const token = next === null ? null : new URL(next).searchParams.get("cursor");
  if (token === null) throw new Error("expected a continuation token");
  return token;
}

function expectPaginationError(
  operation: () => unknown,
  code: ReadPaginationError["code"],
  cursorReason?: ReadPaginationError["cursorReason"],
): ReadPaginationError {
  let captured: unknown;
  try {
    operation();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(ReadPaginationError);
  expect(captured).toMatchObject({
    code,
    ...(cursorReason === undefined ? {} : { cursorReason }),
  });
  return captured as ReadPaginationError;
}

describe("Read snapshot pagination", () => {
  it("binds first and continuation pages to one authority item type", () => {
    interface TypedItem {
      readonly id: string;
    }
    const { pagination } = harness<TypedItem>({ defaultPageItems: 1 });
    const first = pagination.firstPage({
      items: [{ id: "a" }, { id: "b" }],
      ...identity,
      continuationUrl: "https://beads.example/acme/beads/",
    });
    const second = pagination.continuePage({ token: tokenFrom(first.next), ...identity });

    expectTypeOf(first.items).toEqualTypeOf<readonly TypedItem[]>();
    expectTypeOf(second.items).toEqualTypeOf<readonly TypedItem[]>();
    expect(second.items).toEqual([{ id: "b" }]);
  });

  it("uses the configured default limit and returns stable page boundaries", () => {
    const { pagination } = harness();

    const first = pagination.firstPage(firstInput([{ id: 1 }, { id: 2 }, { id: 3 }]));
    expect(first).toEqual({
      items: [{ id: 1 }, { id: 2 }],
      next: "https://beads.example/acme/beads/?type=task&cursor=token_1",
    });

    const second = pagination.continuePage({ token: tokenFrom(first.next), ...identity });
    expect(second).toEqual({ items: [{ id: 3 }], next: null });
  });

  it("handles empty, one-item, exact, and multi-page collections", () => {
    const { pagination } = harness();

    expect(pagination.firstPage(firstInput([]))).toEqual({ items: [], next: null });
    expect(pagination.firstPage(firstInput(["only"]))).toEqual({
      items: ["only"],
      next: null,
    });
    expect(pagination.firstPage(firstInput([1, 2]))).toEqual({ items: [1, 2], next: null });

    const first = pagination.firstPage(firstInput([1, 2, 3, 4, 5], 2));
    const second = pagination.continuePage({ token: tokenFrom(first.next), ...identity });
    const third = pagination.continuePage({ token: tokenFrom(second.next), ...identity });
    expect([first.items, second.items, third.items]).toEqual([[1, 2], [3, 4], [5]]);
    expect(third.next).toBeNull();
  });

  it("accepts the maximum limit and rejects invalid limits with a typed local outcome", () => {
    const { pagination } = harness();
    expect(pagination.firstPage(firstInput([1, 2, 3, 4], 3)).items).toEqual([1, 2, 3]);

    for (const limit of [0, -1, 4, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectPaginationError(() => pagination.firstPage(firstInput([1], limit)), "invalid-limit");
    }
    expectPaginationError(
      () => pagination.firstPage(firstInput([1], "2" as never)),
      "invalid-limit",
    );
  });

  it("snapshots complete records and revisions before paging", () => {
    const { pagination } = harness({ defaultPageItems: 1 });
    const source = [
      { id: "a", revision: "rev-1", properties: { labels: ["original"] } },
      { id: "b", revision: "rev-2", properties: { labels: ["original"] } },
    ];

    const first = pagination.firstPage(firstInput(source));
    const firstSource = source[0];
    const secondSource = source[1];
    if (firstSource === undefined || secondSource === undefined) throw new Error("fixture setup");
    firstSource.revision = "changed";
    firstSource.properties.labels[0] = "changed";
    secondSource.revision = "changed";
    secondSource.properties.labels.push("changed");
    source.push({ id: "c", revision: "rev-3", properties: { labels: [] } });

    const second = pagination.continuePage({ token: tokenFrom(first.next), ...identity });
    expect(first.items).toEqual([
      { id: "a", revision: "rev-1", properties: { labels: ["original"] } },
    ]);
    expect(second).toEqual({
      items: [{ id: "b", revision: "rev-2", properties: { labels: ["original"] } }],
      next: null,
    });
  });

  it("rejects a snapshot before copying more than the configured node budget", () => {
    const { pagination } = harness({ retainedSnapshotNodeCapacity: 4 });

    expectPaginationError(
      () => pagination.firstPage(firstInput([{ value: 1 }, { value: 2 }])),
      "capacity-exceeded",
    );
  });

  it("rejects a snapshot before copying more than the configured UTF-8 byte budget", () => {
    const { pagination } = harness({ retainedSnapshotByteCapacity: 8 });

    expectPaginationError(() => pagination.firstPage(firstInput(["12345"])), "capacity-exceeded");
  });

  it("accounts retained snapshot budgets across concurrent snapshots and releases them atomically", () => {
    const { pagination, advance } = harness({
      retainedSnapshotByteCapacity: 29,
      retainedSnapshotNodeCapacity: 5,
    });
    const first = pagination.firstPage(firstInput(["aaaa", "bbbb"], 1));

    expectPaginationError(
      () =>
        pagination.firstPage({
          ...firstInput(["cccc", "dddd"], 1),
          projection: "second",
        }),
      "capacity-exceeded",
    );
    expect(pagination.continuePage({ token: tokenFrom(first.next), ...identity }).items).toEqual([
      "bbbb",
    ]);

    advance(1_000);
    expect(pagination.cleanupExpired()).toEqual({ releasedSnapshots: 1, releasedCursors: 1 });
    expect(
      pagination.firstPage({
        ...firstInput(["cccc", "dddd"], 1),
        projection: "second",
      }).items,
    ).toEqual(["cccc"]);
  });

  it("applies the configured snapshot bound without charging one-page results as retained state", () => {
    const { pagination } = harness({
      retainedSnapshotByteCapacity: 5,
      retainedSnapshotNodeCapacity: 3,
    });
    pagination.firstPage(firstInput([1, 2], 1));

    expect(pagination.firstPage(firstInput([9]))).toEqual({ items: [9], next: null });
  });

  it("replays every cursor as the same page and the same following cursor until expiry", () => {
    const { pagination, advance } = harness({ defaultPageItems: 1 });
    const first = pagination.firstPage(firstInput([1, 2, 3]));
    const cursor = tokenFrom(first.next);

    const firstReplay = pagination.continuePage({ token: cursor, ...identity });
    advance(999);
    const secondReplay = pagination.continuePage({ token: cursor, ...identity });
    expect(secondReplay).toBe(firstReplay);
    expect(secondReplay).toEqual(firstReplay);
    expect(tokenFrom(secondReplay.next)).toBe(tokenFrom(firstReplay.next));
  });

  it("retries token collisions within the configured bound and never aliases snapshots", () => {
    const generated = ["shared", "shared", "distinct"];
    const { pagination } = harness({
      generateOpaqueToken: () => generated.shift() ?? "unused",
    });
    const firstA = pagination.firstPage({
      ...firstInput(["a1", "a2"], 1),
      projection: "a",
    });
    const firstB = pagination.firstPage({
      ...firstInput(["b1", "b2"], 1),
      projection: "b",
    });

    expect(tokenFrom(firstA.next)).toBe("shared");
    expect(tokenFrom(firstB.next)).toBe("distinct");
    expect(
      pagination.continuePage({ token: "shared", ...identity, projection: "a" }).items,
    ).toEqual(["a2"]);
    expect(
      pagination.continuePage({ token: "distinct", ...identity, projection: "b" }).items,
    ).toEqual(["b2"]);
  });

  it("rolls back every retained budget when first-cursor minting fails", () => {
    const generated = ["bad?", "fresh_1", "fresh_2"];
    const { pagination } = harness({
      retainedStateCapacity: 3,
      retainedSnapshotByteCapacity: 11,
      retainedSnapshotNodeCapacity: 6,
      tokenGenerationAttempts: 1,
      generateOpaqueToken: () => generated.shift() ?? "unused",
    });

    expectPaginationError(
      () => pagination.firstPage(firstInput([1, 2, 3, 4, 5], 2)),
      "token-generation-failed",
    );
    const recovered = pagination.firstPage(firstInput([1, 2, 3, 4, 5], 2));
    expect(tokenFrom(recovered.next)).toBe("fresh_1");
    const second = pagination.continuePage({ token: "fresh_1", ...identity });
    expect(tokenFrom(second.next)).toBe("fresh_2");
  });

  it("expires snapshots at their original TTL and reports unknown cursors equivalently", () => {
    const { pagination, advance } = harness();
    const first = pagination.firstPage(firstInput([1, 2, 3]));
    const cursor = tokenFrom(first.next);
    advance(1_000);

    expectPaginationError(
      () => pagination.continuePage({ token: cursor, ...identity }),
      "cursor-expired",
      "expired",
    );
    expectPaginationError(
      () => pagination.continuePage({ token: "never-issued", ...identity }),
      "cursor-expired",
      "unknown",
    );
  });

  it("invalidates a snapshot on Scope epoch restore", () => {
    const { pagination } = harness();
    const first = pagination.firstPage(firstInput([1, 2, 3]));
    const cursor = tokenFrom(first.next);

    expectPaginationError(
      () => pagination.continuePage({ token: cursor, ...identity, scopeEpoch: "restored" }),
      "cursor-expired",
      "epoch-changed",
    );
    expectPaginationError(
      () => pagination.continuePage({ token: cursor, ...identity }),
      "cursor-expired",
      "unknown",
    );
  });

  it("bulk-releases the prior Scope epoch before admitting a fresh restored snapshot", () => {
    const { pagination } = harness({
      retainedStateCapacity: 2,
      retainedSnapshotByteCapacity: 7,
      retainedSnapshotNodeCapacity: 3,
    });
    const stale = pagination.firstPage(firstInput([1, 2], 1));
    const staleToken = tokenFrom(stale.next);

    const restored = pagination.firstPage({
      ...firstInput([3, 4], 1),
      scopeEpoch: "epoch-2",
    });
    expect(restored.items).toEqual([3]);
    expectPaginationError(
      () => pagination.continuePage({ token: staleToken, ...identity }),
      "cursor-expired",
      "unknown",
    );
  });

  it("rejects foreign authorization views without consuming the valid cursor", () => {
    const { pagination } = harness();
    const first = pagination.firstPage(firstInput([1, 2, 3]));
    const cursor = tokenFrom(first.next);

    expectPaginationError(
      () => pagination.continuePage({ token: cursor, ...identity, authorizationView: "view-2" }),
      "foreign-view",
    );
    expect(pagination.continuePage({ token: cursor, ...identity }).items).toEqual([3]);
  });

  it("binds cursors to their collection or incident-Link projection", () => {
    const { pagination } = harness();
    const first = pagination.firstPage(firstInput([1, 2, 3]));
    const cursor = tokenFrom(first.next);

    expectPaginationError(
      () => pagination.continuePage({ token: cursor, ...identity, projection: "incident-links" }),
      "foreign-projection",
    );
    expect(pagination.continuePage({ token: cursor, ...identity }).items).toEqual([3]);
  });

  it("confines authoritative next URLs to the canonical Scope and excludes credentials", () => {
    const { pagination } = harness();
    const first = pagination.firstPage({
      ...firstInput([1, 2, 3]),
      continuationUrl: "https://beads.example/acme/beads/task-42?view=links&direction=both&limit=2",
      projection: "incident-links:task-42:both",
    });
    expect(first.next).toBe(
      "https://beads.example/acme/beads/task-42?view=links&direction=both&limit=2&cursor=token_1",
    );
    expect(new URL(first.next ?? "").username).toBe("");
    expect(new URL(first.next ?? "").password).toBe("");

    for (const continuationUrl of [
      "/acme/beads/",
      "https://other.example/acme/beads/",
      "https://beads.example/outside/beads/",
      "https://user:secret@beads.example/acme/beads/",
      "https://beads.example/acme/beads/#fragment",
      "https://beads.example/acme/beads/?cursor=already-present",
    ]) {
      expectPaginationError(
        () => pagination.firstPage({ ...firstInput([1, 2, 3]), continuationUrl }),
        "invalid-input",
      );
    }
  });

  it("fails closed at retained-state capacity without silently evicting active cursors", () => {
    const { pagination } = harness({ retainedStateCapacity: 2 });
    const first = pagination.firstPage({ ...firstInput([1, 2, 3]), projection: "first" });
    const cursor = tokenFrom(first.next);
    const second = pagination.continuePage({ token: cursor, ...identity, projection: "first" });
    expect(second.items).toEqual([3]);

    expectPaginationError(
      () => pagination.firstPage({ ...firstInput([4, 5, 6]), projection: "second" }),
      "capacity-exceeded",
    );
    expect(pagination.continuePage({ token: cursor, ...identity, projection: "first" })).toBe(
      second,
    );
  });

  it("caps one snapshot's reserved cursor positions without leaking global capacity", () => {
    const { pagination } = harness({
      retainedStateCapacity: 10,
      maxRetainedCursorPositionsPerSnapshot: 2,
      defaultPageItems: 1,
    });
    const boundary = pagination.firstPage({
      ...firstInput([1, 2, 3], 1),
      projection: "boundary",
    });
    expect(boundary.items).toEqual([1]);

    expectPaginationError(
      () =>
        pagination.firstPage({
          ...firstInput([4, 5, 6, 7], 1),
          projection: "too-large",
        }),
      "capacity-exceeded",
    );

    const afterRejection = pagination.firstPage({
      ...firstInput([8, 9, 10], 1),
      projection: "after-rejection",
    });
    expect(afterRejection.items).toEqual([8]);
    expect(afterRejection.next).not.toBeNull();
  });

  it("guarantees traversal of an admitted snapshot without later capacity checks", () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const defaultPagination = harness({ retainedStateCapacity: 50 }).pagination;
    const defaultPage = defaultPagination.firstPage(firstInput(items));
    expect(defaultPage.items).toEqual([0, 1]);
    const traversed = [...defaultPage.items];
    let next = defaultPage.next;
    while (next !== null) {
      const page = defaultPagination.continuePage({ token: tokenFrom(next), ...identity });
      traversed.push(...page.items);
      next = page.next;
    }
    expect(traversed).toEqual(items);
    expectPaginationError(
      () =>
        defaultPagination.firstPage({
          ...firstInput([100, 101, 102]),
          projection: "second",
        }),
      "capacity-exceeded",
    );

    const maximumPagination = harness({ retainedStateCapacity: 34 }).pagination;
    const maximumPage = maximumPagination.firstPage(firstInput(items, 3));
    expect(maximumPage.items).toEqual([0, 1, 2]);
  });

  it("cleans all cursors for expired snapshots and frees their global capacity", () => {
    const { pagination, advance } = harness({ retainedStateCapacity: 2 });
    const first = pagination.firstPage(firstInput([1, 2, 3]));
    expect(first.next).not.toBeNull();
    advance(1_000);

    expect(pagination.cleanupExpired()).toEqual({ releasedSnapshots: 1, releasedCursors: 1 });
    expect(pagination.cleanupExpired()).toEqual({ releasedSnapshots: 0, releasedCursors: 0 });
    expect(pagination.firstPage(firstInput([4, 5, 6])).items).toEqual([4, 5]);
  });

  it("retains terminal cursors only through TTL so terminal-page replay remains stable", () => {
    const { pagination, advance } = harness();
    const first = pagination.firstPage(firstInput([1, 2, 3]));
    const cursor = tokenFrom(first.next);
    const terminal = pagination.continuePage({ token: cursor, ...identity });
    expect(pagination.continuePage({ token: cursor, ...identity })).toBe(terminal);

    advance(1_000);
    expect(pagination.cleanupExpired()).toEqual({ releasedSnapshots: 1, releasedCursors: 1 });
  });

  it("releases every retained snapshot and cursor when closed", () => {
    const { pagination } = harness();
    const first = pagination.firstPage(firstInput([1, 2, 3]));
    const cursor = tokenFrom(first.next);

    expect(pagination.close()).toEqual({ releasedSnapshots: 1, releasedCursors: 1 });
    expect(pagination.close()).toEqual({ releasedSnapshots: 0, releasedCursors: 0 });
    expect(pagination.cleanupExpired()).toEqual({ releasedSnapshots: 0, releasedCursors: 0 });
    expectPaginationError(
      () => pagination.continuePage({ token: cursor, ...identity }),
      "configuration-error",
    );
  });

  it("cleans expired public-clock snapshots while idle", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      let token = 0;
      const pagination = createReadPagination({
        scope: "https://beads.example/acme/",
        defaultPageItems: 2,
        maxPageItems: 3,
        cursorTtlMs: 100,
        retainedStateCapacity: 20,
        maxRetainedCursorPositionsPerSnapshot: 19,
        retainedSnapshotByteCapacity: 10_000,
        retainedSnapshotNodeCapacity: 1_000,
        maxOpaqueTokenLength: 40,
        tokenGenerationAttempts: 3,
        idleCleanup: "timer",
        clock: () => Date.now(),
        generateOpaqueToken: () => `idle_${++token}`,
      });
      const first = pagination.firstPage(firstInput([1, 2, 3]));
      const cursor = tokenFrom(first.next);

      vi.advanceTimersByTime(100);
      expect(pagination.cleanupExpired()).toEqual({ releasedSnapshots: 0, releasedCursors: 0 });
      expectPaginationError(
        () => pagination.continuePage({ token: cursor, ...identity }),
        "cursor-expired",
        "unknown",
      );
      pagination.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves FIFO expiry order when the injected clock moves backward", () => {
    let now = 1_000;
    let token = 0;
    const pagination = harness({
      retainedStateCapacity: 4,
      clock: () => now,
      generateOpaqueToken: () => `clock_${++token}`,
    }).pagination;
    pagination.firstPage({ ...firstInput([1, 2, 3]), projection: "first" });
    now = 1_500;
    pagination.firstPage({ ...firstInput([4, 5, 6]), projection: "second" });

    now = 1_200;
    expect(pagination.cleanupExpired()).toEqual({ releasedSnapshots: 0, releasedCursors: 0 });
    now = 2_000;
    expect(pagination.cleanupExpired()).toEqual({ releasedSnapshots: 1, releasedCursors: 1 });
    now = 2_500;
    expect(pagination.cleanupExpired()).toEqual({ releasedSnapshots: 1, releasedCursors: 1 });
  });

  it("returns deeply immutable pages", () => {
    const { pagination } = harness();
    const first = pagination.firstPage(firstInput([{ nested: { values: [1] } }]));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.items)).toBe(true);
    expect(Object.isFrozen(first.items[0])).toBe(true);
    expect(Object.isFrozen((first.items[0] as { nested: object }).nested)).toBe(true);
    expect(
      Object.isFrozen((first.items[0] as { nested: { values: readonly number[] } }).nested.values),
    ).toBe(true);
  });

  it("rejects accessors, toJSON, proxies, cycles, and non-JSON runtime values safely", () => {
    const { pagination } = harness();
    let getterCalls = 0;
    const getterRecord = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "must-not-be-read";
      },
    });
    expectPaginationError(
      () => pagination.firstPage(firstInput([getterRecord])),
      "invalid-snapshot",
    );
    expect(getterCalls).toBe(0);

    let toJsonCalls = 0;
    expectPaginationError(
      () =>
        pagination.firstPage(
          firstInput([
            {
              value: 1,
              toJSON() {
                toJsonCalls += 1;
                return { leaked: true };
              },
            },
          ]),
        ),
      "invalid-snapshot",
    );
    expect(toJsonCalls).toBe(0);

    let proxyTrapCalls = 0;
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          proxyTrapCalls += 1;
          throw new Error("secret proxy failure");
        },
      },
    );
    expectPaginationError(() => pagination.firstPage(firstInput([proxy])), "invalid-snapshot");
    expect(proxyTrapCalls).toBe(0);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const item of [cyclic, { value: undefined }, { value: Number.NaN }, new Date()]) {
      expectPaginationError(() => pagination.firstPage(firstInput([item])), "invalid-snapshot");
    }
  });

  it("bounds invalid, oversized, colliding, and throwing token-generator failures", () => {
    let invalidCalls = 0;
    const invalid = harness({
      generateOpaqueToken: () => {
        invalidCalls += 1;
        return "contains credentials?";
      },
    }).pagination;
    expectPaginationError(
      () => invalid.firstPage(firstInput([1, 2, 3])),
      "token-generation-failed",
    );
    expect(invalidCalls).toBe(3);

    let collisionCalls = 0;
    const collision = harness({
      tokenGenerationAttempts: 2,
      generateOpaqueToken: () => {
        collisionCalls += 1;
        return "same";
      },
    }).pagination;
    collision.firstPage({ ...firstInput([1, 2, 3]), projection: "one" });
    expectPaginationError(
      () => collision.firstPage({ ...firstInput([4, 5, 6]), projection: "two" }),
      "token-generation-failed",
    );
    expect(collisionCalls).toBe(3);

    const oversized = harness({ generateOpaqueToken: () => "x".repeat(41) }).pagination;
    expectPaginationError(
      () => oversized.firstPage(firstInput([1, 2, 3])),
      "token-generation-failed",
    );

    const throwing = harness({
      generateOpaqueToken: () => {
        throw new Error("secret generator failure");
      },
    }).pagination;
    const error = expectPaginationError(
      () => throwing.firstPage(firstInput([1, 2, 3])),
      "token-generation-failed",
    );
    expect(error.message).not.toContain("secret");
  });

  it("requires explicit valid configuration and non-empty snapshot identities", () => {
    const base = {
      scope: "https://beads.example/acme/",
      defaultPageItems: 2,
      maxPageItems: 3,
      cursorTtlMs: 1_000,
      retainedStateCapacity: 20,
      maxRetainedCursorPositionsPerSnapshot: 19,
      retainedSnapshotByteCapacity: 10_000,
      retainedSnapshotNodeCapacity: 1_000,
      maxOpaqueTokenLength: 40,
      tokenGenerationAttempts: 3,
      clock: () => 1_000,
      generateOpaqueToken: () => "token",
    };
    for (const overrides of [
      { scope: "http://user:secret@beads.example/acme/" },
      { scope: "https://beads.example/acme" },
      { scope: "https://beads.example/acme/?query=bad" },
      { defaultPageItems: 0 },
      { maxPageItems: 0 },
      { defaultPageItems: 4 },
      { cursorTtlMs: 0 },
      { retainedStateCapacity: 0 },
      { retainedStateCapacity: 1 },
      { maxRetainedCursorPositionsPerSnapshot: 0 },
      { maxRetainedCursorPositionsPerSnapshot: 20 },
      { retainedSnapshotByteCapacity: 0 },
      { retainedSnapshotNodeCapacity: 0 },
      { maxOpaqueTokenLength: 0 },
      { tokenGenerationAttempts: 0 },
      { idleCleanup: "sometimes" as never },
    ]) {
      expectPaginationError(
        () => createReadPagination({ ...base, ...overrides }),
        "configuration-error",
      );
    }

    const { pagination } = harness();
    for (const field of ["authorizationView", "scopeEpoch", "projection"] as const) {
      expectPaginationError(
        () => pagination.firstPage({ ...firstInput([1]), [field]: "" }),
        "invalid-input",
      );
    }
  });
});
