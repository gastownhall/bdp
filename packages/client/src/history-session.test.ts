import type { HistoryVersionsPage, ReadDiscovery } from "@bdp/protocol";
import { describe, expect, it } from "vitest";
import { type BdpContinuationScope, ReadSessionLocalError, SessionCore } from "./continuations.js";
import { type HistoryRequest, HistorySession, type PreparedHistory } from "./history-session.js";
import { ReadSession } from "./read-session.js";

const scope = "https://example.com/scope/";
const id = `${scope}beads/a`;
const request = { kind: "versions", resource: "bead", id } as const;
const metadata: ReadDiscovery = {
  bdpVersion: "0",
  profile: "read",
  scope,
  beads: `${scope}beads/`,
  links: `${scope}links/`,
  types: `${scope}types/`,
  historicalResolution: { version: 1 },
};
const cursor = (n: number) => `${id}?view=versions&cursor=${n}`;
const page = (next: string | null): HistoryVersionsPage => ({
  subject: id,
  population: "all-retained",
  participation: "tracked",
  window: { newest: null, oldest: null, complete: true },
  items: [],
  next,
});
function commit(prepared: PreparedHistory<HistoryRequest>, body: HistoryVersionsPage) {
  expect(prepared.route(metadata).kind).toBe("success");
  const stage = prepared.validate(body);
  if (stage.kind !== "success") throw new Error("expected valid stage");
  return prepared.commit(stage.value);
}
function finish(
  session: HistorySession,
  continuation: string | undefined,
  next: string | null,
  owner?: BdpContinuationScope,
) {
  const prepared = session.prepare(
    { ...request, ...(continuation ? { continuation } : {}) },
    owner,
  );
  try {
    return commit(prepared, page(next));
  } finally {
    prepared.release();
  }
}

describe("shared Read/History continuation core", () => {
  it("uses one context capacity, restores leases on refusal and releases terminal/forgotten entries", () => {
    const core = new SessionCore();
    const history = new HistorySession(scope, core);
    const read = new ReadSession(scope, core);
    const owner = core.createContinuationScope();
    for (let n = 0; n < 1023; n++) finish(history, undefined, cursor(n), owner);
    const prepared = read.prepare({ kind: "collection", collection: "beads" });
    const staged = prepared.validate({ items: [], next: `${scope}beads/?cursor=read` });
    if (staged.kind !== "success") throw new Error("Read stage");
    prepared.commit(staged.value);
    prepared.release();
    expect(() => finish(history, undefined, cursor(1024))).toThrowError(
      expect.objectContaining({ reason: "capacity" }),
    );
    // A live lease stays charged: forgetting removes available entries only.
    const live = history.prepare({ ...request, continuation: cursor(0) }, owner);
    core.forgetContinuations(owner);
    live.release();
    expect(finish(history, cursor(0), null, owner).kind).toBe("success");
    expect(finish(history, undefined, cursor(1024)).kind).toBe("success");
  });

  it("bounds cursor cycle history and restores the final accepted cursor after capacity refusal", () => {
    const core = new SessionCore();
    const history = new HistorySession(scope, core);
    const owner = core.createContinuationScope();
    for (let n = 0; n < 10000; n++)
      finish(history, n === 0 ? undefined : cursor(n - 1), cursor(n), owner);
    expect(() => finish(history, cursor(9999), cursor(10000), owner)).toThrowError(
      expect.objectContaining({ reason: "capacity" }),
    );
    // Capacity refusal retained the old lease: an actual terminal page can still finish.
    expect(finish(history, cursor(9999), null, owner).kind).toBe("success");
    expect(finish(history, undefined, cursor(0), owner).kind).toBe("success");
  });

  it("rejects self/cyclic successors without consuming the old capability", () => {
    const core = new SessionCore();
    const history = new HistorySession(scope, core);
    finish(history, undefined, cursor(1));
    expect(finish(history, cursor(1), cursor(1))).toMatchObject({ kind: "refusal" });
    expect(finish(history, cursor(1), cursor(2))).toMatchObject({ kind: "success" });
    expect(finish(history, cursor(2), cursor(1))).toMatchObject({ kind: "refusal" });
    expect(finish(history, cursor(2), null)).toMatchObject({ kind: "success" });
  });

  it("requires issued subject/kind/owner and does not consume another traversal", () => {
    const core = new SessionCore();
    const history = new HistorySession(scope, core);
    const owner = core.createContinuationScope();
    finish(history, undefined, cursor(1), owner);
    for (const bad of [
      { ...request, id: `${scope}beads/b` },
      { ...request, resource: "link" as const },
    ])
      expect(() => history.prepare({ ...bad, continuation: cursor(1) }, owner)).toThrow(
        "not issued",
      );
    expect(() => history.prepare({ ...request, continuation: cursor(1) })).toThrow("not issued");
    const foreign = new SessionCore().createContinuationScope();
    expect(() => history.prepare(request, foreign)).toThrow("not created");
    expect(finish(history, cursor(1), null, owner).kind).toBe("success");
  });

  it("isolates cross-kind misuse and concurrent Read/History leases on the same URL", () => {
    const core = new SessionCore();
    const history = new HistorySession(scope, core);
    const read = new ReadSession(scope, core);
    const owner = core.createContinuationScope();
    finish(history, undefined, cursor(1), owner);
    expect(() =>
      read.prepare({ kind: "bead-links", bead: id, continuation: cursor(1) }, owner),
    ).toThrow("not issued");
    const initialRead = read.prepare({ kind: "bead-links", bead: id }, owner);
    const readStage = initialRead.validate({ items: [], next: cursor(1) });
    if (readStage.kind !== "success") throw new Error("Read stage");
    initialRead.commit(readStage.value);
    initialRead.release();
    const historyLease = history.prepare({ ...request, continuation: cursor(1) }, owner);
    const readLease = read.prepare(
      { kind: "bead-links", bead: id, continuation: cursor(1) },
      owner,
    );
    expect(() => history.prepare({ ...request, continuation: cursor(1) }, owner)).toThrow(
      "not issued",
    );
    expect(commit(historyLease, page(null)).kind).toBe("success");
    historyLease.release();
    const done = readLease.validate({ items: [], next: null });
    if (done.kind !== "success") throw new Error("Read stage");
    expect(readLease.commit(done.value).kind).toBe("success");
    readLease.release();
    const readOnly = read.prepare({ kind: "bead-links", bead: id }, owner);
    const readOnlyStage = readOnly.validate({ items: [], next: cursor(2) });
    if (readOnlyStage.kind !== "success") throw new Error("Read stage");
    readOnly.commit(readOnlyStage.value);
    readOnly.release();
    expect(() => history.prepare({ ...request, continuation: cursor(2) }, owner)).toThrow(
      "not issued",
    );
    expect(
      read.prepare({ kind: "bead-links", bead: id, continuation: cursor(2) }, owner),
    ).toBeDefined();
    core.clear();
  });

  it.each([false, true])(
    "refuses conflicting simultaneous initial pages with explicit owner=%s",
    (explicit) => {
      const core = new SessionCore();
      const history = new HistorySession(scope, core);
      const owner = explicit ? core.createContinuationScope() : undefined;
      const first = history.prepare(request, owner);
      const second = history.prepare(request, owner);
      expect(commit(first, page(cursor(1))).kind).toBe("success");
      first.release();
      const existingLease = history.prepare({ ...request, continuation: cursor(1) }, owner);
      expect(() => commit(second, page(cursor(1)))).toThrow("distinct continuation scopes");
      second.release();
      expect(commit(existingLease, page(null)).kind).toBe("success");
      existingLease.release();
    },
  );

  it("clearing through Read invalidates a staged History operation and its live lease", () => {
    const core = new SessionCore();
    const history = new HistorySession(scope, core);
    const read = new ReadSession(scope, core);
    finish(history, undefined, cursor(1));
    const pending = history.prepare({ ...request, continuation: cursor(1) });
    const stage = pending.validate(page(null));
    if (stage.kind !== "success") throw new Error("History stage");
    read.clear();
    expect(() => pending.commit(stage.value)).toThrowError(ReadSessionLocalError);
    pending.release();
    expect(() => history.prepare(request)).toThrowError(
      expect.objectContaining({ reason: "closed" }),
    );
  });
});
