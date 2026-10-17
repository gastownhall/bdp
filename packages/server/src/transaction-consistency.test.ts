import { describe, expect, it, vi } from "vitest";
import {
  malformedTransactionMinimumHeaders,
  snapshotCurrentReadMinimum,
  currentReadMinimumHeaders,
  checkCurrentReadMinimum,
  TransactionMinimumUnproved,
  TransactionMinimumUnsupported,
  snapshotTransactionMinimum,
  transactionMinimumHeaders,
  checkTransactionMinimum,
  TransactionMinimumFailure,
  waitForTransactionMinimum,
} from "./transaction-consistency.js";
const context = Object.freeze({
  scopeEpoch: "epoch",
  authorizationView: "view",
  scopePosition: "pos-1",
});
const tuple = () => ({ scopeEpoch: "epoch", authorizationView: "view", minimumPosition: "pos-2" });
describe("private minimum-read subset", () => {
  it("snapshots canonical supported tuples without getters or opaque-token guesses", () => {
    const original = tuple(),
      result = snapshotTransactionMinimum(original);
    original.minimumPosition = "pos-999";
    expect(result.minimumPosition).toBe("pos-2");
    expect(Object.isFrozen(result)).toBe(true);
    const getter = vi.fn();
    expect(() =>
      snapshotTransactionMinimum({
        ...tuple(),
        get minimumPosition() {
          getter();
          return "pos-2";
        },
      }),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    for (const value of ["pos-01", "opaque", "pos-9007199254740992", "pos--1", "pos-1,pos-2"]) {
      expect(
        transactionMinimumHeaders(
          new Headers({
            "bdp-scope-epoch": "epoch",
            "bdp-authorization-view": "view",
            "bdp-minimum-scope-position": value,
          }),
        ),
      ).toBeUndefined();
    }
    expect(
      transactionMinimumHeaders(new Headers({ "bdp-minimum-scope-position": "pos-1" })),
    ).toBeUndefined();
  });
  it("only turns actual behind observations into timeout after the original finite deadline", async () => {
    let now = 0,
      attempts = 0;
    const result = waitForTransactionMinimum(
      () => {
        attempts++;
        checkTransactionMinimum(tuple(), context);
      },
      {
        budgetMs: 3,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
        },
      },
    );
    await expect(result).rejects.toMatchObject({ reason: "catch-up-timeout", context });
    expect(attempts).toBe(2);
    expect(now).toBe(3);
    const failure = new Error("owner failure"),
      wait = vi.fn();
    await expect(
      waitForTransactionMinimum(
        () => {
          throw failure;
        },
        { wait },
      ),
    ).rejects.toBe(failure);
    expect(wait).not.toHaveBeenCalled();
    expect(() =>
      checkTransactionMinimum({ ...tuple(), authorizationView: "other" }, context),
    ).toThrow(TransactionMinimumFailure);
  });
});

it("distinguishes closed minimum receiving syntax from supported position identities", () => {
  const names = ["bdp-minimum-scope-position", "bdp-scope-epoch", "bdp-authorization-view"];
  const complete = {
    "bdp-minimum-scope-position": "pos-1",
    "bdp-scope-epoch": "epoch",
    "bdp-authorization-view": "view",
  };
  expect(malformedTransactionMinimumHeaders(new Headers())).toBe(false);
  for (const name of names) {
    const missing = new Headers(complete);
    missing.delete(name);
    expect(malformedTransactionMinimumHeaders(missing)).toBe(true);
    expect(malformedTransactionMinimumHeaders(new Headers({ [name]: "valid" }))).toBe(true);
    for (const invalid of ["", " \t ", "two tokens", "a,b", "a%20b", "é", "x".repeat(257)]) {
      const headers = new Headers({ ...complete, [name]: invalid });
      expect(malformedTransactionMinimumHeaders(headers), `${name}: ${invalid.length}`).toBe(true);
      expect(transactionMinimumHeaders(headers)).toBeUndefined();
    }
    const repeated = new Headers(complete);
    repeated.append(name, complete[name as keyof typeof complete]);
    expect(malformedTransactionMinimumHeaders(repeated)).toBe(true);
    expect(
      malformedTransactionMinimumHeaders(new Headers({ ...complete, [name]: "x".repeat(256) })),
    ).toBe(false);
    expect(
      malformedTransactionMinimumHeaders(new Headers({ ...complete, [name]: " \tvalid \t" })),
    ).toBe(false);
  }
  for (const value of [
    "genesis",
    "pos-0",
    "pos-1",
    "pos-9007199254740991",
    "opaque",
    "unknown",
    "pos-01",
    "pos--1",
    "pos-9007199254740992",
  ]) {
    const headers = new Headers({ ...complete, "bdp-minimum-scope-position": value });
    expect(malformedTransactionMinimumHeaders(headers), value).toBe(false);
    expect(transactionMinimumHeaders(headers) !== undefined, value).toBe(
      ["genesis", "pos-0", "pos-1", "pos-9007199254740991"].includes(value),
    );
  }
});

it("captures lexical current minimums without widening strict consumers or invoking accessors", () => {
  for (const value of ["opaque", "pos-01", "pos-9007199254740992"]) {
    const supplied = { ...tuple(), minimumPosition: value };
    expect(snapshotCurrentReadMinimum(supplied)).toEqual(supplied);
    expect(Object.isFrozen(snapshotCurrentReadMinimum(supplied))).toBe(true);
    expect(() => snapshotTransactionMinimum(supplied)).toThrow("unsupported");
    expect(
      currentReadMinimumHeaders(
        new Headers({
          "bdp-scope-epoch": "epoch",
          "bdp-authorization-view": "view",
          "bdp-minimum-scope-position": value,
        }),
      ),
    ).toEqual(supplied);
    expect(() => checkCurrentReadMinimum(supplied, context, true)).toThrow(
      TransactionMinimumUnproved,
    );
    for (const [foreign, reason] of [
      [{ scopeEpoch: "other" }, "cursor-expired"],
      [{ authorizationView: "other" }, "foreign-view"],
    ] as const) {
      let failure: unknown;
      try {
        checkCurrentReadMinimum({ ...supplied, ...foreign }, context, true);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(TransactionMinimumFailure);
      if (!(failure instanceof TransactionMinimumFailure))
        throw new Error("expected minimum failure");
      expect(failure.reason).toBe(reason);
      expect(failure.context).toBe(context);
    }
    expect(() => checkCurrentReadMinimum(supplied, context, false)).toThrow(
      TransactionMinimumUnsupported,
    );
  }
  let bothMismatch: unknown;
  try {
    checkCurrentReadMinimum(
      { scopeEpoch: "other", authorizationView: "other", minimumPosition: "opaque" },
      context,
      true,
    );
  } catch (error) {
    bothMismatch = error;
  }
  expect(bothMismatch).toBeInstanceOf(TransactionMinimumFailure);
  if (!(bothMismatch instanceof TransactionMinimumFailure))
    throw new Error("expected contextual failure");
  expect(bothMismatch.reason).toBe("cursor-expired");
  expect(bothMismatch.context).toBe(context);
  const getter = vi.fn(() => "opaque");
  for (const value of [
    new Proxy(tuple(), { get: getter }),
    { ...tuple(), extra: 1 },
    Object.defineProperty({ ...tuple() }, "minimumPosition", { get: getter }),
    { ...tuple(), minimumPosition: "two tokens" },
    { ...tuple(), minimumPosition: undefined },
  ])
    expect(() => snapshotCurrentReadMinimum(value)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(() =>
    checkCurrentReadMinimum(
      { ...tuple(), minimumPosition: "opaque" },
      { ...context, scopePosition: "opaque" },
      true,
    ),
  ).toThrow("invalid owner");
});
it("waits for unproved current eligibility with one deadline and preserves terminal failures", async () => {
  let tick = 0,
    attempts = 0;
  const final = { ...context, scopePosition: "pos-2" };
  await expect(
    waitForTransactionMinimum(
      () => {
        attempts++;
        throw new TransactionMinimumUnproved(attempts === 1 ? context : final);
      },
      {
        budgetMs: 7,
        now: () => tick,
        wait: async (ms) => {
          tick += ms;
        },
      },
    ),
  ).rejects.toMatchObject({ reason: "catch-up-timeout", context: final });
  expect([tick, attempts]).toEqual([7, 3]);
  const controller = new AbortController();
  let waits = 0;
  await expect(
    waitForTransactionMinimum(
      () => {
        throw new TransactionMinimumUnproved(context);
      },
      {
        budgetMs: 7,
        now: () => 0,
        wait: async () => {
          waits++;
          controller.abort();
        },
      },
      controller.signal,
    ),
  ).rejects.toThrow("abort");
  expect(waits).toBe(1);
  const fault = new Error("unproved owner fault"),
    wait = vi.fn();
  await expect(
    waitForTransactionMinimum(
      () => {
        throw fault;
      },
      { wait },
    ),
  ).rejects.toBe(fault);
  await expect(
    waitForTransactionMinimum(
      () => {
        throw new TransactionMinimumUnsupported();
      },
      { wait },
    ),
  ).rejects.toBeInstanceOf(TransactionMinimumUnsupported);
  expect(wait).not.toHaveBeenCalled();
});
