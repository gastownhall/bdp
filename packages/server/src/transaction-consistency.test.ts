import { describe, expect, it, vi } from "vitest";
import {
  malformedTransactionMinimumHeaders,
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
