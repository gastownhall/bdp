import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate as later } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseReadUpdateProblem,
  parseLinkRecord,
  parseReadUpdateSequenceMemberProblem,
  parseTypeDescriptor,
  prepareReadUpdateSequence,
  prepareReadUpdateSingleton,
  stringifyJsonValue,
  readProblem,
  readProblemDefinitionFor,
  isReadProblemCode,
  type PreparedReadUpdateCarrier,
  type PropertyValidator,
  type ReadUpdateProblemCode,
} from "@bdp/protocol";
import {
  openRecoveryStore,
  RecoveryStoreError,
  type RecoveryStore,
  type KeyState,
  type StoredResource,
} from "./recovery-store.js";
import {
  assertRetainedOutcomeCompatible,
  UnimplementedAliasRetryError,
  snapshotMemberExecutorOptions,
  type MemberExecutorOptions,
} from "./member-executor.js";
import { normalizeMemberIdentity, serializeMemberMetadata } from "./member-identity.js";
import {
  createSequenceLifecycle,
  createNodeLifecycleScheduler,
  SequenceLifecycleError,
  type LifecycleScheduler,
  type SequenceLifecycle,
  type SubmissionCompletion,
  type SequenceLifecycleOptions,
} from "./sequence-executor.js";
const scope = "https://sequence.test/s/",
  type = "https://types.test/bead",
  linkType = "https://types.test/link";
const day = 86_400_000,
  start = 1_700_000_000_000;
const dirs: string[] = [],
  stores: RecoveryStore[] = [],
  owners: SequenceLifecycle[] = [],
  children: ChildProcess[] = [];
const queues: Queue[] = [];
const releaseHeld: (() => void)[] = [];
afterEach(async () => {
  for (const child of children.splice(0))
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((r) => child.once("exit", () => r()));
    }
  for (const release of releaseHeld.splice(0)) release();
  for (const queue of queues.splice(0)) {
    try {
      queue.drain();
    } catch {}
  }
  for (const owner of owners.splice(0)) {
    try {
      await owner.close();
    } catch {}
  }
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {}
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(path.join(tmpdir(), "bdp-sequence-"));
  dirs.push(dir);
  return dir;
}
class Queue implements LifecycleScheduler {
  constructor() {
    queues.push(this);
  }
  turns: { callback: () => void; cancelled: boolean }[] = [];
  delays: { callback: () => void; cancelled: boolean; milliseconds: number }[] = [];
  turn(callback: () => void) {
    const task = { callback, cancelled: false };
    this.turns.push(task);
    return () => {
      task.cancelled = true;
    };
  }
  delay(milliseconds: number, callback: () => void) {
    const task = { callback, cancelled: false, milliseconds };
    this.delays.push(task);
    return () => {
      task.cancelled = true;
    };
  }
  step() {
    const task = this.turns.shift();
    if (!task) throw Error("no turn");
    if (!task.cancelled) task.callback();
    return task;
  }
  tick() {
    const task = this.delays.shift();
    if (!task) throw Error("no delay");
    if (!task.cancelled) task.callback();
    return task;
  }
  drain() {
    let n = 0;
    while (this.turns.length) {
      if (++n > 2000) throw Error("unexpected turn loop");
      this.step();
    }
  }
}
function fixture(
  settings: {
    owned?: boolean;
    validate?: PropertyValidator;
    scheduler?: LifecycleScheduler;
    empty?: boolean;
  } = {},
) {
  const dir = directory();
  const descriptor = parseTypeDescriptor({
    id: type,
    name: "Bead",
    describes: "bead",
    conformsTo: [],
    ...(settings.owned ? { ownsOutgoing: { [linkType]: { max: 10 } } } : {}),
    ...(settings.validate ? { propertiesSchema: "https://types.test/schema" } : {}),
  });
  const linkDescriptor = parseTypeDescriptor({
    id: linkType,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [type], external: "opaque" },
    target: { conformsTo: [type], external: "opaque" },
    ...(settings.validate ? { propertiesSchema: "https://types.test/link-schema" } : {}),
  });
  const old = {
    id: `${scope}links/old`,
    type: linkType,
    revision: "l0",
    source: `${scope}beads/a`,
    target: `${scope}beads/b`,
    properties: {},
  };
  const resources: StoredResource[] = ["a", "b", "free"].map((id) => ({
    kind: "bead",
    id: `beads/${id}`,
    bodyJson: stringifyJsonValue({
      id: `${scope}beads/${id}`,
      type,
      revision: "r0",
      properties: { n: 0 },
      ...(settings.owned ? { ownedLinks: { [linkType]: id === "a" ? [old] : [] } } : {}),
    }),
  }));
  resources.push({
    kind: "link",
    id: "links/old",
    source: "beads/a",
    target: "beads/b",
    bodyJson: stringifyJsonValue(old),
  });
  const types = {
    [type]: stringifyJsonValue(descriptor),
    [linkType]: stringifyJsonValue(linkDescriptor),
  };
  const config = {
    directory: dir,
    scope,
    installationId: "test",
    lineageId: "fresh",
    minimumRetentionMs: day,
  };
  let store = openRecoveryStore({
    ...config,
    create: { resources: settings.empty ? [] : resources, types },
  });
  stores.push(store);
  const state = {
    now: start,
    denied: false,
    hidden: new Set<string>(),
    principals: [] as object[],
    contexts: 0,
  };
  const clock = vi.fn(function (this: unknown) {
    expect(this).toBeUndefined();
    return state.now++;
  });
  const registry = {
    get(id: string, bytes: string) {
      expect(this).toBe(registry);
      if (types[id as keyof typeof types] !== bytes) return undefined;
      return id === type
        ? { descriptor, ...(settings.validate ? { validateProperties: settings.validate } : {}) }
        : {
            descriptor: linkDescriptor,
            ...(settings.validate ? { validateProperties: settings.validate } : {}),
          };
    },
  };
  const member: MemberExecutorOptions = {
    scope,
    limits: {},
    numericBudget: {
      diagnostic: ({ pointer }) => ({ message: "inadmissible", instanceLocation: pointer }),
    },
    retentionMs: day,
    minimumRetentionMs: day,
    clock,
    contracts: registry,
    captureMemberContext(_reader, principal) {
      expect(this).toBe(member);
      state.contexts++;
      state.principals.push(principal);
      const denied = state.denied,
        hidden = new Set(state.hidden);
      return {
        policyIdentity: "test",
        configurationIdentity: "test",
        maximumEndpointMultiplicity: [],
        recordChangeContext: true,
        policy: {
          canRead: (r) => !hidden.has(r.id),
          canWrite: () => !denied,
          canCreate: () => !denied,
          canWriteBead: () => !denied,
        },
      };
    },
  };
  const queue = new Queue();
  function owner(patch: Partial<SequenceLifecycleOptions> = {}) {
    const result = createSequenceLifecycle({
      store,
      member,
      maximumSequenceOperations: undefined,
      maintenanceIntervalMs: day,
      scheduler: settings.scheduler ?? queue,
      ...patch,
    });
    owners.push(result);
    return result;
  }
  return {
    dir,
    config,
    member,
    queue,
    state,
    clock,
    owner,
    get store() {
      return store;
    },
    key(key: string, principal = "alice") {
      return store.read((r) => r.key(principal, key));
    },
    reopen() {
      store.close();
      store = openRecoveryStore(config);
      stores.push(store);
      return store;
    },
  };
}
const principal = { id: "alice" };
const create = (key: string, extra = {}) => ({
  operation: "createBead",
  type,
  idempotencyKey: key,
  ...extra,
});
const sequence = (operations: unknown[]) =>
  prepareReadUpdateSequence(scope, stringifyJsonValue({ operations }));
const five = () =>
  sequence(
    Array.from({ length: 5 }, (_, i) => create(`k${i}`, { id: `beads/new${i}`, name: `n${i}` })),
  );
function submit(
  owner: SequenceLifecycle,
  carrier: PreparedReadUpdateCarrier,
  who = principal,
): Promise<SubmissionCompletion> {
  const result = owner.submit(carrier, who);
  if (result.kind !== "admitted") throw Error("unexpected refusal");
  return result.completion;
}
function retained(state: KeyState) {
  if (state.kind !== "retained") throw Error("expected retained");
  return state;
}
function controlled(
  f: ReturnType<typeof fixture>,
  carrier: PreparedReadUpdateCarrier,
  index: number,
  problem: unknown,
  completedAt = start,
) {
  // Controlled writer only: production constructors always supply status and no
  // arbitrary extensions. Real S4 identities, real S6 retention; never fake turns.
  const normalized = normalizeMemberIdentity(carrier, index, {
    scope,
    creatorBinding: () => {
      throw Error("unexpected creator");
    },
    resolveAlias: () => undefined,
  });
  if (normalized.kind !== "ready") throw Error("controlled identity not ready");
  const admission = f.store.admit("alice", carrier.keys);
  const key = carrier.keys[index];
  if (!key) throw Error("missing key");
  try {
    f.store.executeMember(admission, key, () => ({
      kind: "retain",
      semanticIdentityJson: normalized.identityJson,
      resolutionsJson: serializeMemberMetadata(normalized),
      outcomeJson: stringifyJsonValue({
        format: "ru-member-outcome-1",
        operation: carrier.operations[index]?.operation,
        disposition: parseReadUpdateProblem(problem),
      }),
      effect: "failure",
      completedAt,
      retainUntil: completedAt + day,
    }));
  } finally {
    f.store.abandonAttempt(admission);
  }
}
const update = (key: string, extra = {}) => ({
  operation: "updateBeadProperties",
  bead: "beads/free",
  change: [{ op: "replace", path: "", value: { n: 0 } }],
  idempotencyKey: key,
  ...extra,
});

describe("configuration, atomic admission and projection", () => {
  it("fixes scalar bounds and selected provider/scheduler references for the owner lifetime", async () => {
    const f = fixture();
    const limits = { representationBytes: 100_000 };
    const contracts = {
      get(id: string, bytes: string) {
        expect(this).toBe(contracts);
        return f.member.contracts.get(id, bytes);
      },
    };
    const member = { ...optionsFor(f, { limits, contracts }) };
    const options = {
      store: f.store,
      member,
      maximumSequenceOperations: 2,
      maintenanceIntervalMs: 7,
      scheduler: f.queue,
    };
    const owner = createSequenceLifecycle(options);
    owners.push(owner);
    const originalDelay = f.queue.delay;
    const scheduled = vi.spyOn(f.queue, "delay");
    options.maximumSequenceOperations = 1;
    options.maintenanceIntervalMs = 99;
    limits.representationBytes = 1;
    contracts.get = () => {
      throw Error("replaced contract selector");
    };
    member.captureMemberContext = () => {
      throw Error("replaced context selector");
    };
    const originalTurn = f.queue.turn;
    f.queue.turn = () => {
      throw Error("replaced scheduler turn");
    };
    const done = submit(owner, sequence([create("one"), create("two")]));
    f.queue.drain();
    expect(codes(await done)).toEqual(["created", "created"]);
    // The timer was captured before this spy/replacement. Its next period must
    // be armed only after the real synchronous expiry has returned.
    const realExpire = f.store.expire.bind(f.store);
    vi.spyOn(f.store, "expire").mockImplementation((now) => {
      expect(f.queue.delays).toHaveLength(0);
      realExpire(now);
      expect(f.queue.delays).toHaveLength(0);
    });
    f.queue.delay = () => {
      throw Error("replaced scheduler delay");
    };
    f.queue.tick();
    expect(f.queue.delays[0]?.milliseconds).toBe(7);
    expect(scheduled).not.toHaveBeenCalled();
    f.queue.turn = originalTurn;
    f.queue.delay = originalDelay;
    await owner.close();
  });
  it("preserves initialization and close failures, and permits safe maintenance counters beyond Date range", async () => {
    const f = fixture();
    const primary = Error("startup clock"),
      secondary = Error("startup close");
    const realClose = f.store.close.bind(f.store);
    const close = vi.spyOn(f.store, "close").mockImplementation(() => {
      realClose();
      throw secondary;
    });
    expect(() =>
      f.owner({
        member: optionsFor(f, {
          clock: () => {
            throw primary;
          },
        }),
      }),
    ).toThrow(
      expect.objectContaining({
        phase: "initialize",
        cause: primary,
        secondary: [{ phase: "close", error: secondary }],
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
    const g = fixture();
    const expire = vi.spyOn(g.store, "expire");
    const owner = g.owner({ member: optionsFor(g, { clock: () => Number.MAX_SAFE_INTEGER }) });
    expect(expire).toHaveBeenCalledExactlyOnceWith(Number.MAX_SAFE_INTEGER);
    await owner.close();
  });
  it("captures unchanged helper receivers/options, qualifies prior rows then expires once, admits no C, and drains all claims", async () => {
    const f = fixture();
    const snapshot = snapshotMemberExecutorOptions(f.member);
    expect(snapshot.limits).toEqual(f.member.limits);
    expect(Object.isFrozen(snapshot)).toBe(true);
    controlled(f, sequence([update("old")]), 0, readProblem("forbidden"));
    controlled(f, sequence([update("still-retained")]), 0, readProblem("forbidden"), start + 1);
    const stillRetained = f.key("still-retained");
    f.store.expire(start + day - 1);
    expect(f.key("old").kind).toBe("retained");
    expect(f.key("still-retained")).toEqual(stillRetained);
    f.store.visitRetainedOutcomes((row) => assertRetainedOutcomeCompatible(row, scope, {}));
    const expire = vi.spyOn(f.store, "expire"),
      admit = vi.spyOn(f.store, "admit"),
      cleanup = vi.spyOn(f.store, "abandonAttempt");
    f.state.now = start + day;
    const owner = f.owner();
    expect(expire).toHaveBeenCalledExactlyOnceWith(start + day);
    expect(f.key("old")).toEqual({ kind: "unknown" });
    expect(f.key("still-retained")).toEqual(stillRetained);
    const original = principal;
    const done = submit(owner, five(), original);
    expect(admit).toHaveBeenCalledExactlyOnceWith("alice", ["k0", "k1", "k2", "k3", "k4"]);
    expect(f.clock).toHaveBeenCalledTimes(1);
    expect(f.state.contexts).toBe(0);
    for (let i = 0; i < 5; i++) expect(f.key(`k${i}`).kind).toBe("claimed");
    (f.member as { clock: () => number }).clock = () => {
      throw Error("replaced clock");
    };
    f.queue.drain();
    const result = await done;
    expect(result.kind).toBe("sequence");
    expect(f.state.principals.every((p) => p === original)).toBe(true);
    expect(cleanup.mock.results.map((r) => r.value)).toEqual([0]);
    expect(owner.close()).toBe(owner.closed);
    await owner.closed;
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects interval %s before ownership",
    (interval) => {
      const f = fixture();
      const close = vi.spyOn(f.store, "close"),
        expire = vi.spyOn(f.store, "expire");
      expect(() => f.owner({ maintenanceIntervalMs: interval })).toThrow();
      expect(close).not.toHaveBeenCalled();
      expect(expire).not.toHaveBeenCalled();
    },
  );
  it("rejects option mismatches/scheduler/Scope before store use and closes once after startup failure", () => {
    const f = fixture();
    const close = vi.spyOn(f.store, "close"),
      expire = vi.spyOn(f.store, "expire");
    for (const patch of [
      { maximumSequenceOperations: 0 },
      { member: { ...f.member, scope: "https://other.test/" } },
      { member: { ...f.member, numericBudget: { ...f.member.numericBudget, diagnostics: 2 } } },
      { member: { ...f.member, minimumRetentionMs: day + 1 } },
      { scheduler: { turn: null, delay: null } },
    ])
      expect(() => f.owner(patch as Partial<SequenceLifecycleOptions>)).toThrow();
    expect(close).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
    expect(() => f.owner({ member: { ...f.member, clock: () => NaN } })).toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("preflights whole carriers, rejects invalid/foreign/over-cap before admission, and distinguishes nonaccepting", async () => {
    const f = fixture();
    const owner = f.owner({ maximumSequenceOperations: 2 });
    const admit = vi.spyOn(f.store, "admit");
    for (const bad of [
      [create("a"), { operation: "nope" }],
      [create("a", { id: "@bad" })],
      [create("a", { name: "same" }), create("b", { name: "same" })],
      [create("same"), create("same")],
      [{ operation: "deleteAlias", alias: "@bad", idempotencyKey: "a" }],
    ])
      expect(() => sequence(bad)).toThrow();
    expect(() => owner.submit({ ...five() }, principal)).toThrow();
    expect(() =>
      owner.submit(
        prepareReadUpdateSingleton(
          "https://other.test/",
          "createBead",
          stringifyJsonValue({ type }),
          "x",
        ),
        principal,
      ),
    ).toThrow();
    expect(() => owner.submit(five(), { id: "" })).toThrow();
    expect(owner.submit(five(), principal)).toEqual({
      kind: "refused",
      problem: parseReadUpdateProblem(readProblem("limit-exceeded")),
    });
    expect(admit).not.toHaveBeenCalled();
    const done = submit(owner, sequence([create("a"), create("b")]));
    const closed = owner.close();
    expect(owner.close()).toBe(closed);
    const hostile = {
      get id(): string {
        throw Error("must not sample");
      },
    };
    expect(() => owner.submit(five(), hostile)).toThrow(
      expect.objectContaining({ phase: "not-accepting" }),
    );
    f.queue.drain();
    await done;
    await closed;
    expect(owner.close()).toBe(closed);
    expect(() => owner.submit(five(), hostile)).toThrow(
      expect.objectContaining({ phase: "not-accepting" }),
    );
  });
  it("two pre-turn submissions cannot split claims and other principals remain independent", async () => {
    const f = fixture(),
      owner = f.owner();
    const carrier = sequence([create("a"), create("b")]);
    const admit = vi.spyOn(f.store, "admit");
    const one = submit(owner, carrier),
      duplicate = submit(owner, carrier),
      other = submit(owner, carrier, { id: "bob" });
    expect(f.clock).toHaveBeenCalledTimes(1);
    expect(admit.mock.calls).toEqual([
      ["alice", ["a", "b"]],
      ["alice", ["a", "b"]],
      ["bob", ["a", "b"]],
    ]);
    const first = admit.mock.results[0]?.value;
    const competing = admit.mock.results[1]?.value;
    const independent = admit.mock.results[2]?.value;
    if (!first || !competing || !independent) throw Error("missing actual admissions");
    expect(first.states).toEqual([{ kind: "unknown" }, { kind: "unknown" }]);
    expect(competing.attemptId).not.toBe(first.attemptId);
    expect(competing.states).toEqual([
      { kind: "claimed", attemptId: first.attemptId },
      { kind: "claimed", attemptId: first.attemptId },
    ]);
    expect(independent.attemptId).not.toBe(first.attemptId);
    expect(independent.states).toEqual([{ kind: "unknown" }, { kind: "unknown" }]);
    expect(carrier.keys.map((key) => f.key(key, "bob"))).toEqual([
      { kind: "claimed", attemptId: independent.attemptId },
      { kind: "claimed", attemptId: independent.attemptId },
    ]);
    f.queue.drain();
    expect(codes(await duplicate)).toEqual(["created", "created"]);
    const results = await Promise.all([one, duplicate, other]);
    expect(results.every((r) => r.kind === "sequence")).toBe(true);
    expect(f.key("a").kind).toBe("retained");
    expect(f.key("a", "bob").kind).toBe("retained");
    await owner.close();
  });
  it("projects every actual operation, noops/alias/deletion and cross-carrier renamed positions", async () => {
    const f = fixture(),
      owner = f.owner();
    const operations = [
      create("a", { id: "beads/new", name: "made" }),
      {
        operation: "createLink",
        type: linkType,
        source: "@made",
        target: "beads/b",
        name: "edge",
        idempotencyKey: "l",
      },
      {
        operation: "updateLinkProperties",
        link: "@edge",
        change: [{ op: "replace", path: "", value: {} }],
        idempotencyKey: "ul",
      },
      { operation: "deleteLink", link: "@edge", idempotencyKey: "dl" },
      {
        operation: "updateBeadProperties",
        bead: "@made",
        change: [{ op: "replace", path: "", value: {} }],
        idempotencyKey: "ub",
      },
      { operation: "putAlias", alias: "alias/new-alias", target: "@made", idempotencyKey: "pa" },
      { operation: "deleteAlias", alias: "alias/new-alias", idempotencyKey: "da" },
      { operation: "deleteBead", bead: "@made", idempotencyKey: "db" },
    ];
    const done = submit(owner, sequence(operations));
    f.queue.drain();
    const result = await done;
    if (result.kind !== "sequence") throw Error("wrong result");
    expect(result.response.results.map((r) => ("outcome" in r ? r.outcome : r.code))).toEqual([
      "created",
      "created",
      "updated",
      "deleted",
      "updated",
      "created",
      "deleted",
      "deleted",
    ]);
    expect(result.response.results[0]).toMatchObject({ operationIndex: 0, operationName: "made" });
    const single = submit(
      owner,
      prepareReadUpdateSingleton(
        scope,
        "createBead",
        stringifyJsonValue({ type, id: "beads/new" }),
        "a",
      ),
    );
    f.queue.drain();
    expect((await single).kind).toBe("singleton");
    const reordered = submit(
      owner,
      sequence([update("new-key"), create("a", { id: "beads/new", name: "renamed" })]),
    );
    f.queue.drain();
    const retry = await reordered;
    if (retry.kind !== "sequence") throw Error("wrong");
    expect(retry.response.results[1]).toMatchObject({
      operationIndex: 1,
      operationName: "renamed",
    });
    await owner.close();
  });
  it("reopens controlled statusless extensions without rewriting retained bytes and validates each entry before tail", async () => {
    const f = fixture();
    const carrier = sequence([update("statusless")]);
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/authorization",
      code: "forbidden",
      retry: "after-state-change",
      extension: { operationName: "data", outcome: true },
    };
    controlled(f, carrier, 0, problem);
    const old = f.key("statusless");
    f.reopen();
    const owner = f.owner();
    const done = submit(owner, carrier);
    f.queue.drain();
    const result = await done;
    if (result.kind !== "sequence") throw Error("wrong");
    expect(result.response.results[0]).toMatchObject({
      ...problem,
      status: 403,
      operationIndex: 0,
    });
    expect(f.key("statusless")).toEqual(old);
    const single = submit(
      owner,
      prepareReadUpdateSingleton(
        scope,
        "updateBeadProperties",
        stringifyJsonValue({
          bead: "beads/free",
          change: [{ op: "replace", path: "", value: { n: 0 } }],
        }),
        "statusless",
      ),
    );
    f.queue.drain();
    const singleton = await single;
    if (singleton.kind !== "singleton") throw Error("wrong");
    expect(singleton.disposition).not.toHaveProperty("status");
    await owner.close();
    const g = fixture();
    const incompatible = sequence([
      create("k0"),
      update("k1"),
      create("k2"),
      create("k3"),
      create("k4"),
    ]);
    controlled(g, incompatible, 1, readProblem("revision-unknown"));
    g.reopen();
    const next = g.owner();
    const execute = vi.spyOn(g.store, "executeMember");
    const failed = submit(next, incompatible);
    g.queue.drain();
    await expect(failed).rejects.toMatchObject({
      phase: "project",
      cleanup: { kind: "returned", releasedClaims: 3 },
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(g.key("k0").kind).toBe("retained");
    expect(g.key("k2").kind).toBe("unknown");
    await next.close();
  });
});

function optionsFor(f: ReturnType<typeof fixture>, patch: Partial<MemberExecutorOptions> = {}) {
  return {
    ...f.member,
    captureMemberContext: f.member.captureMemberContext.bind(f.member),
    ...patch,
  };
}
function results(completion: SubmissionCompletion) {
  if (completion.kind !== "sequence") throw Error("expected sequence completion");
  return completion.response.results;
}
function codes(completion: SubmissionCompletion) {
  return results(completion).map((entry) => ("code" in entry ? entry.code : entry.outcome));
}
function body(f: ReturnType<typeof fixture>, id: string) {
  return JSON.parse(f.store.read((reader) => reader.resource(id)?.bodyJson) ?? "null");
}
async function execute(
  f: ReturnType<typeof fixture>,
  owner: SequenceLifecycle,
  carrier: PreparedReadUpdateCarrier,
) {
  const done = submit(owner, carrier);
  f.queue.drain();
  return done;
}

// Expected tuples are independent owning-law data, not obtained from the new lookup.
const problemRows: readonly [ReadUpdateProblemCode, string, number, string][] = [
  ["malformed-request", "request", 400, "never"],
  ["invalid-parameter", "request", 400, "never"],
  ["unauthenticated", "authentication", 401, "after-state-change"],
  ["forbidden", "authorization", 403, "after-state-change"],
  ["resource-not-found", "not-found", 404, "after-state-change"],
  ["resource-pruned", "gone", 410, "never"],
  ["resource-erased", "gone", 410, "never"],
  ["foreign-view", "conflict", 409, "after-state-change"],
  ["cursor-expired", "gone", 410, "after-state-change"],
  ["request-too-large", "size", 413, "never"],
  ["limit-exceeded", "size", 413, "never"],
  ["rate-limited", "rate-limit", 429, "after-delay"],
  ["temporarily-unavailable", "unavailable", 503, "after-delay"],
  ["revision-unknown", "not-found", 404, "after-state-change"],
  ["revision-unretained", "conflict", 409, "after-state-change"],
  ["revision-reorganized", "gone", 410, "after-state-change"],
  ["revision-not-tracked", "conflict", 409, "after-state-change"],
  ["revision-unrepresentable", "conflict", 409, "after-state-change"],
  ["unsupported-media-type", "request", 415, "never"],
  ["binding-unavailable", "request", 400, "never"],
  ["validation-failed", "validation", 422, "never"],
  ["type-not-installed", "validation", 422, "after-state-change"],
  ["identity-taken", "conflict", 409, "never"],
  ["alias-path-taken", "conflict", 409, "after-state-change"],
  ["revision-mismatch", "conflict", 409, "after-state-change"],
  ["incident-links-exist", "conflict", 409, "after-state-change"],
  ["aggregate-constraint-violation", "conflict", 409, "after-state-change"],
  ["idempotency-conflict", "conflict", 409, "never"],
  ["idempotency-in-progress", "conflict", 409, "after-delay"],
  ["idempotency-expired", "gone", 410, "never"],
  ["revision-allocation-unsafe", "conflict", 409, "after-state-change"],
];
const historyCodes = new Set([
  "revision-unknown",
  "revision-unretained",
  "revision-reorganized",
  "revision-not-tracked",
  "revision-unrepresentable",
]);
function rowProblem([code, family, status, retry]: (typeof problemRows)[number]) {
  return {
    type: `https://github.com/gastownhall/bdp/problems/${family}`,
    code,
    status,
    retry,
    ...(code === "revision-unretained" ? { missing: { complete: false, items: [] } } : {}),
    ...(code === "validation-failed" ? { diagnostics: [{ message: "controlled fixture" }] } : {}),
  };
}

describe("canonical projection and real creator prefixes", () => {
  it("checks all31 independent tuples and projects every retainable statusless code without changing writer bytes", async () => {
    expect(problemRows).toHaveLength(31);
    expect(new Set(problemRows.map(([code]) => code)).size).toBe(31);
    const retainable = problemRows.filter(
      ([code, , , retry]) =>
        !historyCodes.has(code) &&
        retry !== "after-delay" &&
        code !== "idempotency-conflict" &&
        code !== "idempotency-expired",
    );
    for (const row of problemRows) {
      const problem = rowProblem(row);
      expect(parseReadUpdateProblem(problem)).toMatchObject(problem);
      expect(() => parseReadUpdateProblem({ ...problem, status: 599 })).toThrow();
      // Both are valid public enum members; only the per-code constant rejects this.
      const wrongStatus = row[2] === 400 ? 409 : 400;
      expect(() => parseReadUpdateProblem({ ...problem, status: wrongStatus })).toThrow();
      if (!historyCodes.has(row[0]))
        expect(() =>
          parseReadUpdateSequenceMemberProblem({
            ...problem,
            status: wrongStatus,
            operationIndex: 0,
          }),
        ).toThrow();
      if (isReadProblemCode(row[0])) {
        expect(readProblemDefinitionFor(row[0])).toMatchObject({
          code: row[0],
          type: problem.type,
          status: row[2],
          retry: row[3],
        });
      }
      const project = () => parseReadUpdateSequenceMemberProblem({ ...problem, operationIndex: 0 });
      if (historyCodes.has(row[0])) expect(project).toThrow();
      else expect(project()).toMatchObject({ code: row[0], status: row[2], operationIndex: 0 });
    }
    const f = fixture();
    const carrier = sequence(retainable.map((_, i) => update(`p${i}`)));
    for (const [i, row] of retainable.entries()) {
      const { status: _status, ...without } = rowProblem(row);
      controlled(f, carrier, i, { ...without, extension: { outcome: "data", operationIndex: 91 } });
    }
    const before = carrier.keys.map((key) => f.key(key));
    f.reopen();
    const owner = f.owner();
    const completion = await execute(f, owner, carrier);
    expect(
      results(completion).map((entry) => ("status" in entry ? entry.status : undefined)),
    ).toEqual(retainable.map((row) => row[2]));
    expect(carrier.keys.map((key) => f.key(key))).toEqual(before);
    await owner.close();
  });
  it("retains present real-writer status, continues failed-creator and transient independent tails", async () => {
    const f = fixture(),
      owner = f.owner();
    const failedCarrier = sequence([
      create("denied", { name: "failed" }),
      { operation: "deleteBead", bead: "@failed", idempotencyKey: "unbound" },
      create("tail"),
    ]);
    f.state.denied = true;
    const failed = submit(owner, failedCarrier);
    f.queue.step();
    const bytes = retained(f.key("denied")).outcomeJson;
    expect(JSON.parse(bytes).disposition.status).toBe(403);
    f.state.denied = false;
    f.queue.drain();
    expect(codes(await failed)).toEqual(["forbidden", "binding-unavailable", "created"]);
    expect(retained(f.key("denied")).outcomeJson).toBe(bytes);
    const replay = await execute(f, owner, failedCarrier);
    expect(results(replay)[0]).toMatchObject({ code: "forbidden", status: 403 });
    expect(retained(f.key("denied")).outcomeJson).toBe(bytes);
    await owner.close();

    const g = fixture();
    // Foreign Admission precedes ownership transfer; no second active controller.
    const foreign = g.store.admit("alice", ["busy"]);
    const other = g.owner();
    const carrier = sequence([
      create("busy", { name: "pending" }),
      { operation: "deleteBead", bead: "@pending", idempotencyKey: "dependent" },
      create("independent"),
    ]);
    const done = submit(other, carrier);
    g.queue.step();
    const executeSpy = vi.spyOn(g.store, "executeMember"),
      read = vi.spyOn(g.store, "read"),
      release = vi.spyOn(g.store, "releaseOwnedClaim");
    g.clock.mockClear();
    g.queue.step();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(g.clock).not.toHaveBeenCalled();
    g.queue.drain();
    expect(codes(await done)).toEqual([
      "idempotency-in-progress",
      "idempotency-in-progress",
      "created",
    ]);
    expect(g.key("busy")).toEqual({ kind: "claimed", attemptId: foreign.attemptId });
    expect(g.key("dependent")).toEqual({ kind: "unknown" });
    await other.close();
  });
  it.each(["source", "target"] as const)(
    "carries actual bound, unbound and transient creators through the pinned %s slot",
    async (slot) => {
      for (const state of ["bound", "unbound", "transient"] as const) {
        const f = fixture();
        const foreign = state === "transient" ? f.store.admit("alice", ["maker"]) : undefined;
        const owner = f.owner();
        const carrier = sequence([
          create("maker", { id: "beads/pinned", name: "made" }),
          {
            operation: "createLink",
            type: linkType,
            source: "beads/a",
            target: "beads/b",
            [slot]: { uri: "@made", revision: "opaque-pin" },
            idempotencyKey: "dependent",
          },
          create("independent"),
        ]);
        f.state.denied = state === "unbound";
        const done = submit(owner, carrier);
        f.queue.step();
        f.state.denied = false;
        const executeSpy = vi.spyOn(f.store, "executeMember");
        const read = vi.spyOn(f.store, "read");
        const release = vi.spyOn(f.store, "releaseOwnedClaim");
        f.clock.mockClear();
        f.queue.step();
        if (state === "transient") {
          expect(executeSpy).not.toHaveBeenCalled();
          expect(read).not.toHaveBeenCalled();
          expect(release).toHaveBeenCalledTimes(1);
          expect(f.clock).not.toHaveBeenCalled();
        }
        f.queue.drain();
        const completion = await done;
        expect(codes(completion)).toEqual(
          state === "bound"
            ? ["created", "created", "created"]
            : state === "unbound"
              ? ["forbidden", "binding-unavailable", "created"]
              : ["idempotency-in-progress", "idempotency-in-progress", "created"],
        );
        if (state === "bound") {
          const entry = results(completion)[1];
          if (!entry || !("resource" in entry)) throw Error("missing real pinned Link");
          expect(parseLinkRecord(entry.resource)[slot]).toEqual({
            uri: `${scope}beads/pinned`,
            revision: "opaque-pin",
          });
        }
        if (foreign) {
          expect(f.key("maker")).toEqual({ kind: "claimed", attemptId: foreign.attemptId });
          expect(f.key("dependent")).toEqual({ kind: "unknown" });
        }
        await owner.close();
      }
    },
  );
  it("carries retained-forbidden and expired creator bindings, but never steals one from a conflicting creator", async () => {
    const f = fixture(),
      owner = f.owner();
    const carrier = sequence([
      create("maker", { id: "beads/made", name: "made" }),
      {
        operation: "updateBeadProperties",
        bead: "@made",
        change: [{ op: "add", path: "/n", value: 1 }],
        idempotencyKey: "dependent",
      },
    ]);
    expect(codes(await execute(f, owner, carrier))).toEqual(["created", "updated"]);
    const maker = f.key("maker"),
      dependent = f.key("dependent");
    f.state.hidden.add(`${scope}beads/made`);
    expect(codes(await execute(f, owner, carrier))).toEqual(["forbidden", "forbidden"]);
    const unknown = sequence([
      create("maker", { id: "beads/made", name: "renamed" }),
      { operation: "deleteBead", bead: "@renamed", idempotencyKey: "unknown" },
    ]);
    expect(codes(await execute(f, owner, unknown))).toEqual(["forbidden", "resource-not-found"]);
    expect(f.key("maker")).toEqual(maker);
    expect(f.key("dependent")).toEqual(dependent);
    f.state.hidden.clear();
    const conflict = sequence([
      create("maker", { id: "beads/made", name: "different", properties: { changed: true } }),
      { operation: "deleteBead", bead: "@different", idempotencyKey: "conflict-dependent" },
    ]);
    const conflicted = submit(owner, conflict);
    f.clock.mockClear();
    f.queue.step();
    expect(f.clock).not.toHaveBeenCalled(); // Actual conflict has neither C nor terminal.
    expect(f.key("maker")).toEqual(maker);
    f.queue.drain();
    expect(codes(await conflicted)).toEqual(["idempotency-conflict", "binding-unavailable"]);
    await owner.close();
    f.reopen();
    f.state.now = Math.max(retained(maker).retainUntil, retained(dependent).retainUntil);
    const next = f.owner(); // Additional startup expiry is explicit maintenance.
    expect(f.key("maker").kind).toBe("expired");
    const expired = sequence([
      create("maker", { id: "beads/made", name: "old" }),
      {
        operation: "updateBeadProperties",
        bead: "@old",
        change: [{ op: "add", path: "/after", value: 2 }],
        idempotencyKey: "after-expiry",
      },
    ]);
    const expiredDone = submit(next, expired);
    const expiredMaker = f.key("maker");
    f.clock.mockClear(); // Exclude the independent startup maintenance observation.
    f.queue.step();
    expect(f.clock).not.toHaveBeenCalled(); // Actual expired creator has neither C nor terminal.
    expect(f.key("maker")).toEqual(expiredMaker);
    f.queue.drain();
    expect(codes(await expiredDone)).toEqual(["idempotency-expired", "updated"]);
    expect(body(f, "beads/made").properties.after).toBe(2);
    expect(f.key("maker")).not.toHaveProperty("semanticIdentityJson");
    await next.close();
  });
  it("reuses captured alias targets and stops an unsupported new locator with cleanup and no wire fallback", async () => {
    const f = fixture(),
      owner = f.owner();
    await execute(
      f,
      owner,
      sequence([
        {
          operation: "putAlias",
          alias: "alias/current",
          target: "beads/a",
          idempotencyKey: "alias",
        },
      ]),
    );
    const link = {
      operation: "createLink",
      type: linkType,
      source: "alias/current",
      target: "alias/current",
      idempotencyKey: "link",
    };
    const made = await execute(f, owner, sequence([link]));
    const retainedLink = f.key("link");
    await execute(
      f,
      owner,
      sequence([
        {
          operation: "putAlias",
          alias: "alias/current",
          target: "beads/b",
          idempotencyKey: "repoint",
        },
      ]),
    );
    expect(await execute(f, owner, sequence([link]))).toEqual(made);
    const failed = submit(owner, sequence([{ ...link, source: "alias/unseen" }, create("tail")]));
    f.queue.drain();
    await expect(failed).rejects.toMatchObject({
      phase: "member",
      cause: expect.any(UnimplementedAliasRetryError),
      cleanup: { kind: "returned", releasedClaims: 1 },
    });
    expect(f.key("link")).toEqual(retainedLink);
    expect(f.key("tail")).toEqual({ kind: "unknown" });
    await owner.close();
  });
});

describe("actual scheduled policy, clocks and independent maintenance", () => {
  it("captures max2 before early canRead mutates backing max1, then uses replacement max3 at the next turn", async () => {
    const f = fixture();
    const aggregate = [{ endpoint: "source" as const, linkConformsTo: linkType, max: 2 }];
    let mutate = true;
    const member = optionsFor(f, {
      captureMemberContext(reader, who) {
        const captured = f.member.captureMemberContext(reader, who);
        return {
          ...captured,
          maximumEndpointMultiplicity: aggregate,
          policy: {
            ...captured.policy,
            canRead(record) {
              if (mutate) {
                mutate = false;
                const rule = aggregate[0];
                if (!rule) throw Error("missing aggregate fixture");
                rule.max = 1;
              }
              return captured.policy.canRead(record);
            },
          },
        };
      },
    });
    const owner = f.owner({ member });
    const carrier = sequence(
      ["first", "second"].map((key) => ({
        operation: "createLink",
        type: linkType,
        source: "beads/a",
        target: "beads/free",
        idempotencyKey: key,
      })),
    );
    const done = submit(owner, carrier);
    f.queue.step();
    expect(aggregate[0]?.max).toBe(1);
    expect(f.store.read((reader) => reader.outgoingLinks("beads/a"))).toHaveLength(2);
    const rule = aggregate[0];
    if (!rule) throw Error("missing aggregate fixture");
    rule.max = 3;
    f.queue.step();
    expect(codes(await done)).toEqual(["created", "created"]);
    expect(f.store.read((reader) => reader.outgoingLinks("beads/a"))).toHaveLength(3);
    expect(f.state.contexts).toBe(2);
    await owner.close();
  });
  it("labels startup, per-member late C and terminal, owned Link/source/inline agreement, then zero replay samples", async () => {
    let advance = () => {};
    const f = fixture({
      owned: true,
      validate: () => {
        advance();
        return { valid: true };
      },
    });
    const expire = vi.spyOn(f.store, "expire");
    const owner = f.owner();
    expect(f.clock.mock.results.map((r) => r.value)).toEqual([start]);
    expect(expire).toHaveBeenCalledExactlyOnceWith(start);
    const carrier = sequence([
      create("maker", { id: "beads/new" }),
      {
        operation: "createLink",
        type: linkType,
        source: "beads/a",
        target: "beads/new",
        idempotencyKey: "link",
      },
    ]);
    const done = submit(owner, carrier);
    expect(f.clock).toHaveBeenCalledTimes(1); // Admission is not C.
    advance = () => {
      f.state.now = start + 100;
    };
    f.queue.step();
    expect(body(f, "beads/new").changeContext.committedAt.value).toBe(
      new Date(start + 100).toISOString(),
    );
    expect(retained(f.key("maker")).completedAt).toBe(start + 101);
    advance = () => {
      f.state.now = start + 1000;
    };
    f.queue.step();
    const completion = await done;
    const entry = results(completion)[1];
    if (!entry || !("resource" in entry) || !entry.resource) throw Error("expected Link result");
    const link = parseLinkRecord(entry.resource);
    const source = body(f, "beads/a");
    expect(source.changeContext).toEqual(link.changeContext);
    expect(
      source.ownedLinks[linkType].find((candidate: { id: string }) => candidate.id === link.id),
    ).toEqual(link);
    expect(retained(f.key("link")).completedAt).toBe(start + 1001);
    expect(f.clock.mock.results.map((r) => r.value)).toEqual([
      start,
      start + 100,
      start + 101,
      start + 1000,
      start + 1001,
    ]);
    expect(expire).toHaveBeenCalledTimes(1);
    f.clock.mockClear();
    await execute(f, owner, carrier);
    expect(f.clock).not.toHaveBeenCalled();
    await owner.close();
  });
  it("rejects a changed original principal before the next member and captures current policy once per turn", async () => {
    let mutate = () => {};
    const f = fixture({
      validate: () => {
        mutate();
        return { valid: true };
      },
    });
    const owner = f.owner(),
      who = { id: "alice" };
    mutate = () => {
      f.state.denied = true;
    };
    const done = submit(owner, sequence([create("first"), create("second")]), who);
    f.queue.step();
    expect(f.key("first").kind).toBe("retained");
    f.queue.step();
    expect(codes(await done)).toEqual(["created", "forbidden"]);
    f.state.denied = false;
    const changed = submit(owner, sequence([create("p0"), create("p1")]), who);
    f.queue.step();
    who.id = "mallory";
    const calls = f.state.contexts;
    f.queue.step();
    await expect(changed).rejects.toMatchObject({
      phase: "member",
      cleanup: { kind: "returned", releasedClaims: 1 },
    });
    expect(f.state.contexts).toBe(calls);
    expect(f.key("p1")).toEqual({ kind: "unknown" });
    expect(f.key("p1", "mallory")).toEqual({ kind: "unknown" });
    await owner.close();
  });
  it("runs before/at/after expiry independently, preserves tombstone metadata and claims a forgotten failure at its actual turn", async () => {
    const f = fixture(),
      owner = f.owner();
    f.state.denied = true;
    await execute(f, owner, sequence([create("failure")]));
    f.state.denied = false;
    await execute(
      f,
      owner,
      sequence([
        update("noop"),
        {
          operation: "putAlias",
          alias: "alias/maintenance-alias",
          target: "beads/a",
          idempotencyKey: "alias",
        },
      ]),
    );
    const failure = retained(f.key("failure")),
      noop = retained(f.key("noop")),
      alias = retained(f.key("alias"));
    expect(noop.effect).toBe("success");
    expect(alias.effect).toBe("success");
    const expire = vi.spyOn(f.store, "expire");
    f.state.now = failure.retainUntil - 1;
    f.queue.tick();
    expect(f.key("failure")).toEqual(failure);
    const done = submit(owner, sequence([create("failure"), create("tail")]));
    f.state.now = failure.retainUntil;
    f.queue.tick();
    expect(f.key("failure")).toEqual({ kind: "unknown" });
    f.queue.drain();
    expect(codes(await done)).toEqual(["created", "created"]);
    f.state.now = Math.max(noop.retainUntil, alias.retainUntil) + 1;
    f.queue.tick();
    for (const [key, original] of [
      ["noop", noop],
      ["alias", alias],
    ] as const)
      expect(f.key(key)).toEqual({
        kind: "expired",
        fingerprint: original.fingerprint,
        resolutionsJson: original.resolutionsJson,
      });
    expect(expire).toHaveBeenCalledTimes(3);
    expect(f.queue.delays).toHaveLength(1);
    await owner.close();
  });
  it.each([1, 2_147_483_647, 2_147_483_648, Number.MAX_SAFE_INTEGER])(
    "chunks logical interval %s and cancels stale chunks without rearming",
    async (interval) => {
      const f = fixture(),
        owner = f.owner({ maintenanceIntervalMs: interval });
      const expire = vi.spyOn(f.store, "expire");
      const task = f.queue.delays[0];
      expect(task?.milliseconds).toBe(Math.min(interval, 2_147_483_647));
      if (interval <= 2_147_483_648) {
        f.queue.tick();
        if (interval > 2_147_483_647) {
          expect(expire).not.toHaveBeenCalled();
          expect(f.queue.delays[0]?.milliseconds).toBe(1);
          f.queue.tick();
        }
        expect(expire).toHaveBeenCalledTimes(1);
      } else {
        f.queue.tick();
        expect(expire).not.toHaveBeenCalled();
        expect(f.queue.delays[0]?.milliseconds).toBe(2_147_483_647);
      }
      const stale = f.queue.delays[0];
      await owner.close();
      const before = expire.mock.calls.length;
      stale?.callback();
      expect(expire).toHaveBeenCalledTimes(before);
      expect(f.queue.delays.filter((delay) => !delay.cancelled)).toHaveLength(0);
    },
  );
  it("runs actual idle Node maintenance without a submission", async () => {
    const f = fixture();
    const real = f.store.expire.bind(f.store);
    const expire = vi.spyOn(f.store, "expire");
    const owner = f.owner({ scheduler: createNodeLifecycleScheduler(), maintenanceIntervalMs: 1 });
    // Await an observed event, not a latency threshold. Test timeout is only a watchdog.
    await new Promise<void>((resolve) => {
      expire.mockImplementation((now) => {
        real(now);
        resolve();
      });
    });
    expect(expire.mock.calls.length).toBeGreaterThanOrEqual(2);
    await owner.close();
  });
});

describe("scheduler contracts, drain and fault precedence", () => {
  it.each([
    "inline",
    "throw",
    "schedule-throw",
    "bad-cancel",
    "inline-cancel-throw",
    "inline-async-cancel",
  ])("cleans an admitted attempt on %s and ignores late delivery", async (mode) => {
    const queue = new Queue();
    let late: (() => void) | undefined;
    const thrown = Error(`controlled ${mode}`),
      cancellation = Error("controlled cancel");
    const scheduler: LifecycleScheduler = {
      delay: queue.delay.bind(queue),
      turn(callback) {
        late = callback;
        if (mode.startsWith("inline")) callback();
        if (mode === "schedule-throw") queue.turn(callback);
        if (mode === "throw" || mode === "schedule-throw") throw thrown;
        if (mode === "bad-cancel") return undefined as never;
        return () => {
          if (mode === "inline-cancel-throw") throw cancellation;
          if (mode === "inline-async-cancel") return Promise.reject(cancellation) as never;
        };
      },
    };
    const f = fixture({ scheduler }),
      owner = f.owner();
    const cleanup = vi.spyOn(f.store, "abandonAttempt"),
      executeSpy = vi.spyOn(f.store, "executeMember");
    const accepted = owner.submit(five(), principal);
    expect(accepted.kind).toBe("admitted");
    if (accepted.kind !== "admitted") throw Error("lost accepted handle");
    await expect(accepted.completion).rejects.toMatchObject({
      phase: "schedule",
      cleanup: { kind: "returned", releasedClaims: 5 },
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup.mock.results[0]?.value).toBe(5);
    const closed = owner.close();
    expect(owner.close()).toBe(closed);
    await expect(closed).rejects.toBeInstanceOf(SequenceLifecycleError);
    if (mode === "schedule-throw") {
      expect(queue.turns).toHaveLength(1);
      queue.step(); // The scheduler queued real delivery but never returned its cancellation.
    }
    late?.();
    late?.();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(owner.close()).toBe(closed);
    await later(); // ordinary rejected Promise neutralization is observed, not purity.
  });
  it("consumes each queued callback once and ignores duplicates after completion and close", async () => {
    const f = fixture(),
      owner = f.owner();
    const calls = vi.spyOn(f.store, "executeMember"),
      cleanup = vi.spyOn(f.store, "abandonAttempt");
    const done = submit(owner, five());
    const stale = f.queue.step();
    stale.callback();
    expect(calls).toHaveBeenCalledTimes(1);
    f.queue.drain();
    await done;
    expect(calls).toHaveBeenCalledTimes(5);
    expect(cleanup.mock.results.map((result) => result.value)).toEqual([0]);
    await owner.close();
    stale.callback();
    expect(calls).toHaveBeenCalledTimes(5);
  });
  it.each(["scheduler", "clock"] as const)(
    "rejects synchronous submit and close reentry from %s without changing accepted work",
    async (source) => {
      const f = fixture();
      let owner: SequenceLifecycle | undefined;
      let checks = 0;
      const reenter = () => {
        if (!owner) return; // Startup occurs before the factory returns its owner.
        const active = owner;
        const hostile = {
          get id(): string {
            throw Error("reentry sampled principal");
          },
        };
        expect(() => active.submit(five(), hostile)).toThrow(
          expect.objectContaining({ phase: "reentrant" }),
        );
        expect(() => active.close()).toThrow(expect.objectContaining({ phase: "reentrant" }));
        checks++;
      };
      const scheduler: LifecycleScheduler = {
        delay: f.queue.delay.bind(f.queue),
        turn(callback) {
          if (source === "scheduler") reenter();
          return f.queue.turn(callback);
        },
      };
      owner = f.owner({
        scheduler,
        member: optionsFor(f, {
          clock: function (this: unknown) {
            expect(this).toBeUndefined();
            if (source === "clock") reenter();
            const clock = f.clock;
            return clock();
          },
        }),
      });
      const admit = vi.spyOn(f.store, "admit");
      const close = vi.spyOn(f.store, "close");
      const done = submit(owner, sequence([create("first"), create("second")]));
      f.queue.drain();
      expect(codes(await done)).toEqual(["created", "created"]);
      expect(checks).toBe(source === "scheduler" ? 2 : 4);
      expect(admit).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
      expect(f.store.read((reader) => reader.resources())).toHaveLength(6);
      await owner.close();
      expect(close).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects callback reentry without state mutation and defers queued-callback cleanup outside the active S6 turn", async () => {
    const f = fixture();
    let owner: SequenceLifecycle | undefined;
    let reenterQueued = false;
    const nestedFailures: unknown[] = [];
    const member = optionsFor(f, {
      captureMemberContext(reader, who) {
        if (owner) {
          for (const action of [() => owner?.close(), () => owner?.submit(five(), principal)]) {
            try {
              action();
            } catch (error) {
              nestedFailures.push(error);
            }
          }
          if (reenterQueued) {
            reenterQueued = false;
            f.queue.turns.shift()?.callback();
          }
        }
        return f.member.captureMemberContext(reader, who);
      },
    });
    owner = f.owner({ member });
    const first = submit(owner, sequence([create("first")]));
    const second = submit(owner, sequence([create("second")]));
    reenterQueued = true;
    const cleanup = vi.spyOn(f.store, "abandonAttempt");
    f.queue.drain();
    expect(codes(await first)).toEqual(["created"]);
    await expect(second).rejects.toMatchObject({
      phase: "schedule",
      cleanup: { kind: "returned", releasedClaims: 1 },
    });
    expect(nestedFailures).toHaveLength(2);
    for (const error of nestedFailures) expect(error).toMatchObject({ phase: "reentrant" });
    expect(cleanup.mock.results.map((result) => result.type)).toEqual(["return", "return"]);
    expect(cleanup.mock.results.map((result) => result.value)).toEqual([0, 1]);
    await expect(owner.closed).rejects.toMatchObject({ phase: "schedule" });
  });
  it("does not fail-fast close when an ordinary member fault precedes another live attempt", async () => {
    const fault = Error("actual validator fault");
    let rejectNext = true;
    const f = fixture({
      validate: () => {
        if (rejectNext) {
          rejectNext = false;
          throw fault;
        }
        return { valid: true };
      },
    });
    const owner = f.owner(),
      close = vi.spyOn(f.store, "close");
    const failed = submit(owner, sequence([create("bad0"), create("bad1")]));
    const good = submit(owner, sequence([create("good0"), create("good1")]));
    const closed = owner.close();
    f.queue.step();
    await expect(failed).rejects.toMatchObject({
      phase: "member",
      cause: fault,
      cleanup: { kind: "returned", releasedClaims: 2 },
    });
    expect(close).not.toHaveBeenCalled();
    f.queue.step();
    expect(close).not.toHaveBeenCalled();
    f.queue.step();
    expect(codes(await good)).toEqual(["created", "created"]);
    await closed;
    expect(close).toHaveBeenCalledTimes(1);
    expect(owner.close()).toBe(closed);
  });
  it("drains delivery-independent3–5 after close at2of5 with the same original completion", async () => {
    const f = fixture(),
      owner = f.owner();
    const close = vi.spyOn(f.store, "close");
    const done = submit(owner, five());
    // A discarded observer races delivery only; accepted work remains owned.
    void Promise.race([done, Promise.resolve("delivery gone")]);
    f.queue.step();
    f.queue.step();
    const closed = owner.close();
    expect(owner.close()).toBe(closed);
    expect(f.queue.delays.every((task) => task.cancelled)).toBe(true);
    expect(close).not.toHaveBeenCalled();
    expect(() => owner.submit(five(), principal)).toThrow(
      expect.objectContaining({ phase: "not-accepting" }),
    );
    f.queue.drain();
    expect(codes(await done)).toEqual(Array(5).fill("created"));
    await closed;
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("preserves actual member failure before cleanup failure and closes only after every attempt settles", async () => {
    const primary = Error("actual validation failure"),
      cleanupError = Error("controlled cleanup failure");
    let fail = true;
    const f = fixture({
      validate: () => {
        if (fail) {
          fail = false;
          throw primary;
        }
        return { valid: true };
      },
    });
    const realCleanup = f.store.abandonAttempt.bind(f.store);
    let first = true;
    vi.spyOn(f.store, "abandonAttempt").mockImplementation((admission) => {
      if (first) {
        first = false;
        throw cleanupError;
      }
      return realCleanup(admission);
    });
    const owner = f.owner();
    const bad = submit(owner, sequence([create("bad")]));
    const good = submit(owner, sequence([create("good")]));
    f.queue.step();
    await expect(bad).rejects.toMatchObject({
      phase: "member",
      cause: primary,
      secondary: [{ phase: "cleanup", error: cleanupError }],
      cleanup: { kind: "failed", error: cleanupError },
    });
    f.queue.drain();
    expect(codes(await good)).toEqual(["created"]);
    await expect(owner.closed).rejects.toMatchObject({ phase: "member", cause: primary });
  });
  it("turns a controlled nonzero completed cleanup count into an integrity fault, not a complete response", async () => {
    const f = fixture();
    const real = f.store.abandonAttempt.bind(f.store);
    vi.spyOn(f.store, "abandonAttempt").mockImplementation((admission) => {
      expect(real(admission)).toBe(0);
      return 1; // Explicit impossible-count boundary; real member output is unchanged.
    });
    const owner = f.owner(),
      done = submit(owner, sequence([create("made")]));
    f.queue.drain();
    await expect(done).rejects.toMatchObject({
      phase: "cleanup",
      cleanup: { kind: "returned", releasedClaims: 1 },
    });
    await expect(owner.closed).rejects.toMatchObject({ phase: "cleanup" });
  });
  it("handles a sticky fence across many queued attempts without recursive sweep or shared cleanup failures", async () => {
    const f = fixture(),
      owner = f.owner();
    const first = submit(owner, five());
    f.queue.step();
    f.queue.step();
    const prefix = [f.key("k0"), f.key("k1")];
    const count = 128;
    const pending = Array.from({ length: count }, (_, i) =>
      submit(owner, sequence([create(`queued${i}`)])),
    );
    const fault = new RecoveryStoreError("fenced", "controlled sticky fence");
    const cleanups = new Map<string, Error>();
    const cleanupDepths: number[] = [];
    const executeSpy = vi.spyOn(f.store, "executeMember").mockImplementation(() => {
      throw fault;
    });
    const release = vi.spyOn(f.store, "releaseOwnedClaim").mockImplementation(() => {
      throw fault;
    });
    vi.spyOn(f.store, "read").mockImplementation(() => {
      throw fault;
    });
    vi.spyOn(f.store, "admit").mockImplementation(() => {
      throw fault;
    });
    vi.spyOn(f.store, "expire").mockImplementation(() => {
      throw fault;
    });
    vi.spyOn(f.store, "visitInstalledTypes").mockImplementation(() => {
      throw fault;
    });
    vi.spyOn(f.store, "visitRetainedOutcomes").mockImplementation(() => {
      throw fault;
    });
    const cleanup = vi.spyOn(f.store, "abandonAttempt").mockImplementation((admission) => {
      cleanupDepths.push(new Error().stack?.split("\n").length ?? 0);
      const error = new RecoveryStoreError("fenced", `cleanup-${admission.attemptId}`);
      expect(cleanups.has(admission.attemptId)).toBe(false);
      cleanups.set(admission.attemptId, error);
      throw error;
    });
    const close = vi.spyOn(f.store, "close");
    const stackTraceLimit = Error.stackTraceLimit;
    try {
      Error.stackTraceLimit = Infinity;
      f.queue.drain();
    } finally {
      Error.stackTraceLimit = stackTraceLimit;
    }
    const settled = await Promise.allSettled([first, ...pending]);
    expect(settled).toHaveLength(count + 1);
    for (const result of settled) {
      if (result.status !== "rejected") throw Error("fenced attempt completed");
      const error = result.reason as SequenceLifecycleError;
      expect(error.phase).toBe("member");
      expect(error.cause).toBe(fault);
      expect(error.cleanup?.kind).toBe("failed");
      if (error.cleanup?.kind !== "failed") throw Error("lost cleanup evidence");
      expect([...cleanups.values()]).toContain(error.cleanup.error);
      // Per-attempt evidence must not accumulate another attempt's cleanup error.
      expect(error.secondary).toEqual([{ phase: "cleanup", error: error.cleanup.error }]);
      expect(Object.isFrozen(error.secondary)).toBe(true);
    }
    expect(cleanup).toHaveBeenCalledTimes(count + 1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    await expect(owner.closed).rejects.toMatchObject({ cause: fault });
    expect(close).toHaveBeenCalledTimes(1);
    // Restore the operational double only after controller close, then inspect real disk.
    vi.restoreAllMocks();
    f.reopen();
    expect([f.key("k0"), f.key("k1")]).toEqual(prefix);
    expect(f.store.runtime.recoveredClaims).toBe(count + 3);
    expect(f.store.read((reader) => reader.resources())).toHaveLength(6);
    expect(cleanupDepths).toHaveLength(count + 1);
    const sweptDepths = cleanupDepths.slice(1); // Originating member cleanup has a different caller.
    expect(sweptDepths.every((depth) => depth > 0)).toBe(true);
    expect(new Set(sweptDepths).size, "swept cleanup stack depth must not grow").toBe(1);
  });
  it("stops admission on maintenance failure but drains usable-store work, preserving close failure secondarily", async () => {
    const f = fixture(),
      owner = f.owner();
    const maintenance = Error("controlled maintenance"),
      closeFailure = Error("controlled close");
    const realClose = f.store.close.bind(f.store);
    vi.spyOn(f.store, "expire").mockImplementation(() => {
      throw maintenance;
    });
    vi.spyOn(f.store, "close").mockImplementation(() => {
      realClose();
      throw closeFailure;
    });
    const done = submit(owner, five());
    f.queue.tick();
    expect(() => owner.submit(five(), principal)).toThrow(
      expect.objectContaining({ phase: "not-accepting" }),
    );
    f.queue.drain();
    expect(codes(await done)).toEqual(Array(5).fill("created"));
    await expect(owner.closed).rejects.toMatchObject({
      phase: "maintenance",
      cause: maintenance,
      secondary: expect.arrayContaining([{ phase: "close", error: closeFailure }]),
    });
    expect(owner.close()).toBe(owner.closed);
    const hostile = {
      get id(): string {
        throw Error("closed owner sampled principal");
      },
    };
    expect(() => owner.submit(five(), hostile)).toThrow(
      expect.objectContaining({ phase: "not-accepting" }),
    );
    expect(owner.close()).toBe(owner.closed);
  });
  it("rolls back a real late terminal failure while unrelated scheduled work drains", async () => {
    const f = fixture();
    const terminalFailure = Error("terminal after C");
    let calls = 0;
    const member = optionsFor(f, {
      clock: () => {
        calls++;
        if (calls === 3) throw terminalFailure; // startup, first member C, terminal.
        return start + calls;
      },
    });
    const owner = f.owner({ member });
    const before = f.store.read((reader) => reader.resources());
    const bad = submit(owner, sequence([create("bad", { id: "beads/bad" })]));
    const good = submit(owner, sequence([create("good", { id: "beads/good" })]));
    f.queue.step();
    await expect(bad).rejects.toMatchObject({
      phase: "member",
      cause: terminalFailure,
      cleanup: { kind: "returned", releasedClaims: 1 },
    });
    expect(f.store.read((reader) => reader.resources())).toEqual(before);
    f.queue.drain();
    expect(codes(await good)).toEqual(["created"]);
    await owner.close();
  });
});

describe("deep actual results and controlled retained extensions", () => {
  it("projects/serializes/reopens real12k create and update results and a separately controlled12k Problem", async () => {
    const f = fixture(),
      depth = 12_000;
    const deep = `${'{"child":'.repeat(depth)}1${"}".repeat(depth)}`;
    const carrier = prepareReadUpdateSequence(
      scope,
      `{"operations":[{"operation":"createBead","id":"beads/deep","type":"${type}","properties":${deep},"idempotencyKey":"deep-create","name":"made"},{"operation":"updateBeadProperties","bead":"@made","change":[{"op":"add","path":"/other","value":${deep}}],"idempotencyKey":"deep-update"}]}`,
    );
    const owner = f.owner();
    const first = await execute(f, owner, carrier);
    const rendered = stringifyJsonValue(first);
    const original = [f.key("deep-create"), f.key("deep-update")];
    const originalBody = f.store.read((reader) => reader.resource("beads/deep")?.bodyJson);
    await owner.close();
    f.reopen();
    const next = f.owner();
    expect(stringifyJsonValue(await execute(f, next, carrier))).toBe(rendered);
    expect([f.key("deep-create"), f.key("deep-update")]).toEqual(original);
    expect(f.store.read((reader) => reader.resource("beads/deep")?.bodyJson)).toBe(originalBody);
    let leaf = body(f, "beads/deep").properties.other;
    for (let i = 0; i < depth; i++) leaf = leaf.child;
    expect(leaf).toBe(1);
    await next.close();

    const g = fixture(),
      problemCarrier = sequence([update("deep-problem")]);
    let extension: unknown = {
      operationIndex: 4,
      operationName: "ordinary data",
      outcome: "nested",
    };
    for (let i = 0; i < depth; i++) extension = { child: extension };
    controlled(g, problemCarrier, 0, { ...readProblem("forbidden"), extension });
    const stored = retained(g.key("deep-problem"));
    g.reopen();
    const projectedOwner = g.owner();
    const projected = await execute(g, projectedOwner, problemCarrier);
    const text = stringifyJsonValue(projected);
    expect(text).toContain('"operationName":"ordinary data"');
    expect(retained(g.key("deep-problem")).outcomeJson).toBe(stored.outcomeJson);
    expect(stringifyJsonValue(await execute(g, projectedOwner, problemCarrier))).toBe(text);
    g.store.visitRetainedOutcomes((row) => assertRetainedOutcomeCompatible(row, scope, {}));
    await projectedOwner.close();
  });
});

// These children import built emitted modules. No source TypeScript loader or
// S6-only synthetic outcome can stand in for the actual sequence composition.
const emittedSequence = new URL("../dist/sequence-executor.js", import.meta.url).href;
const emittedStore = new URL("../dist/recovery-store.js", import.meta.url).href;
const emittedProtocol = new URL("../../protocol/dist/index.js", import.meta.url).href;
const childOperations = Array.from({ length: 5 }, (_, i) =>
  create(`k${i}`, { id: `beads/new${i}`, name: `n${i}` }),
);
const childRequest = stringifyJsonValue({ operations: childOperations });
const childProgram = `
import {createSequenceLifecycle,createNodeLifecycleScheduler} from ${JSON.stringify(emittedSequence)};
import {openRecoveryStore} from ${JSON.stringify(emittedStore)};
import {parseTypeDescriptor,prepareReadUpdateSequence,stringifyJsonValue} from ${JSON.stringify(emittedProtocol)};
import {writeSync} from 'node:fs';
const [directory,mode]=process.argv.slice(2);
if(process.version!=='v24.16.0')throw Error('wrong pinned interpreter: '+process.version);
const scope=${JSON.stringify(scope)},type=${JSON.stringify(type)},day=${day},start=${start};
const descriptor=parseTypeDescriptor({id:type,name:'child Bead',describes:'bead',conformsTo:[]});
const bytes=stringifyJsonValue(descriptor);
const store=openRecoveryStore({directory,scope,installationId:'sequence-child',lineageId:'fresh-child',minimumRetentionMs:day,create:{types:{[type]:bytes}}});
const send=value=>writeSync(1,JSON.stringify(value)+'\\n');
let now=start;
const member={scope,limits:{},numericBudget:{diagnostic:({pointer})=>({message:'number',instanceLocation:pointer})},retentionMs:day,minimumRetentionMs:day,clock:()=>now++,contracts:{get:(id,text)=>id===type&&text===bytes?{descriptor}:undefined},captureMemberContext:()=>({policyIdentity:'child',configurationIdentity:'child',maximumEndpointMultiplicity:[],recordChangeContext:true,policy:{canRead:()=>true,canWrite:()=>true,canCreate:()=>true,canWriteBead:()=>true}})};
const carrier=prepareReadUpdateSequence(scope,${JSON.stringify(childRequest)});
const snapshot=()=>store.read(reader=>({keys:carrier.keys.map(key=>reader.key('alice',key)),resources:reader.resources()}));
const adapter=createNodeLifecycleScheduler();
let dispatch=0,owner,parked,closeIdentity;
const wrapped={
 delay:(ms,callback)=>adapter.delay(ms,callback),
 turn(callback){
  let cancelled=false,release;
  const cancel=adapter.turn(()=>{
   dispatch++;
   if(dispatch===3&&(mode==='crash'||mode==='drain')){
    parked=callback;
    send({barrier:'after-two',snapshot:snapshot(),dispatch});
    if(mode==='drain'){
     const first=owner.close();closeIdentity=first===owner.close()&&first===owner.closed;
     let phase;try{owner.submit(carrier,{id:'alice'});}catch(error){phase=error.phase;}
     send({draining:true,closeIdentity,phase});
     release=adapter.turn(()=>{if(!cancelled){const run=parked;parked=undefined;run();}});
    }
    return;
   }
   if(!cancelled)callback();
  });
  return()=>{cancelled=true;cancel();if(release)release();parked=undefined;};
 }
};
owner=createSequenceLifecycle({store,member,maximumSequenceOperations:undefined,maintenanceIntervalMs:day,...(mode==='default'?{}:{scheduler:wrapped})});
send({ready:store.runtime});
const submitted=owner.submit(carrier,{id:'alice'});
if(submitted.kind!=='admitted')throw Error('child was refused');
const result=await submitted.completion;
// Completion includes cleanup; explicit drain may already have closed S6.
const final=mode==='drain'?undefined:snapshot();
const closing=owner.close();
await closing;
send({complete:true,result,...(final?{snapshot:final}:{}),sameClose:closing===owner.close(),closeIdentity});
`;
interface ChildFixture {
  child: ChildProcess;
  messages: Record<string, unknown>[];
  wait(field: string): Promise<Record<string, unknown>>;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
function startSequenceChild(dir: string, mode: string): ChildFixture {
  expect(process.version).toBe("v24.16.0");
  const filename = path.join(directory(), "sequence-child.mjs");
  writeFileSync(filename, childProgram);
  const child = spawn(process.execPath, [filename, dir, mode], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const messages: Record<string, unknown>[] = [];
  let buffer = "",
    stderr = "";
  child.stdout?.on("data", (chunk) => {
    buffer += String(chunk);
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      messages.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  exited.catch(() => {});
  return {
    child,
    messages,
    exited,
    async wait(field) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const found = messages.find((message) => field in message);
        if (found) return found;
        if (child.exitCode !== null || child.signalCode !== null)
          throw Error(`child exited before ${field}: ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw Error(`child ${field} watchdog: ${stderr}`);
    },
  };
}
function reopenChild(dir: string) {
  const store = openRecoveryStore({
    directory: dir,
    scope,
    installationId: "sequence-child",
    lineageId: "fresh-child",
    minimumRetentionMs: day,
  });
  stores.push(store);
  return store;
}
function childMemberOptions(): MemberExecutorOptions {
  const descriptor = parseTypeDescriptor({
    id: type,
    name: "child Bead",
    describes: "bead",
    conformsTo: [],
  });
  const bytes = stringifyJsonValue(descriptor);
  let now = start + 100;
  return {
    scope,
    limits: {},
    numericBudget: {
      diagnostic: ({ pointer }) => ({ message: "number", instanceLocation: pointer }),
    },
    retentionMs: day,
    minimumRetentionMs: day,
    clock: () => now++,
    contracts: { get: (id, text) => (id === type && text === bytes ? { descriptor } : undefined) },
    captureMemberContext: () => ({
      policyIdentity: "child",
      configurationIdentity: "child",
      maximumEndpointMultiplicity: [],
      recordChangeContext: true,
      policy: {
        canRead: () => true,
        canWrite: () => true,
        canCreate: () => true,
        canWriteBead: () => true,
      },
    }),
  };
}

describe("real event loop and emitted child ownership", () => {
  it("permits real I/O and another actual submission at a controlled boundary over the Node adapter", async () => {
    const adapter = createNodeLifecycleScheduler();
    let deliveries = 0,
      parked: (() => void) | undefined,
      holding = true;
    let reached!: () => void;
    const barrier = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const release = () => {
      holding = false; // Also prevents a later delivery from parking during teardown.
      const run = parked;
      parked = undefined;
      run?.();
    };
    releaseHeld.push(release);
    const scheduler: LifecycleScheduler = {
      delay: adapter.delay,
      turn(callback) {
        let cancelled = false,
          cancelRelease: (() => void) | undefined;
        const resume = () => {
          if (!cancelled)
            cancelRelease = adapter.turn(() => {
              if (!cancelled) callback();
            });
        };
        const cancel = adapter.turn(() => {
          deliveries++;
          if (deliveries === 2 && holding) {
            parked = resume;
            reached();
          } else if (!cancelled) callback();
        });
        return () => {
          cancelled = true;
          cancel();
          cancelRelease?.();
          if (parked === resume) parked = undefined;
        };
      },
    };
    const f = fixture({ scheduler }),
      owner = f.owner();
    try {
      const done = submit(owner, sequence([create("first"), create("last")]));
      await barrier;
      expect(f.key("first").kind).toBe("retained");
      expect(f.key("last").kind).toBe("claimed");
      const file = path.join(f.dir, "io-control.txt");
      writeFileSync(file, "actual I/O");
      // Observe actual filesystem I/O at a held dispatch boundary, without
      // claiming arbitrary I/O always wins against the next immediate.
      const data = await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8"));
      expect(data).toBe("actual I/O");
      const middle = submit(owner, sequence([create("middle")]));
      expect(codes(await middle)).toEqual(["created"]);
      expect(f.key("last").kind).toBe("claimed");
      expect(parked).toBeTypeOf("function");
      release();
      expect(codes(await done)).toEqual(["created", "created"]);
    } finally {
      release();
      await owner.close();
    }
  });
  it("recovers exactly3 claims at an actual-adapter2of5 crash and retries2 existing plus3 real completions", async () => {
    const dir = directory(),
      child = startSequenceChild(dir, "crash");
    const ready = await child.wait("ready");
    expect(ready.ready).toMatchObject({ node: "v24.16.0", lockingMode: "exclusive" });
    const barrier = await child.wait("barrier");
    expect(barrier).toMatchObject({ barrier: "after-two", dispatch: 3 });
    child.child.kill("SIGKILL");
    expect(await child.exited).toMatchObject({ signal: "SIGKILL" });
    const store = reopenChild(dir);
    expect(store.runtime.recoveredClaims).toBe(3);
    const before = store.read((reader) => ({
      keys: five().keys.map((key) => reader.key("alice", key)),
      resources: reader.resources(),
    }));
    const old = barrier.snapshot as typeof before;
    expect(before.keys.slice(0, 2)).toEqual(old.keys.slice(0, 2));
    expect(before.resources).toEqual(old.resources);
    expect(before.resources.map((resource) => resource.id).sort()).toEqual([
      "beads/new0",
      "beads/new1",
    ]);
    expect(before.keys.slice(2)).toEqual(Array.from({ length: 3 }, () => ({ kind: "unknown" })));
    const real = store.executeMember.bind(store),
      observations: string[] = [];
    let evaluated = 0;
    vi.spyOn(store, "executeMember").mockImplementation((admission, key, evaluate) => {
      const actual = real(admission, key, (tx) => {
        evaluated++;
        return evaluate(tx);
      });
      observations.push(actual.kind === "existing" ? `existing:${actual.state.kind}` : actual.kind);
      return actual;
    });
    const queue = new Queue();
    const owner = createSequenceLifecycle({
      store,
      member: childMemberOptions(),
      maximumSequenceOperations: undefined,
      maintenanceIntervalMs: day,
      scheduler: queue,
    });
    owners.push(owner);
    const done = submit(owner, prepareReadUpdateSequence(scope, childRequest));
    queue.drain();
    const completion = await done;
    expect(codes(completion)).toEqual(Array(5).fill("created"));
    expect(observations).toEqual([
      "existing:retained",
      "existing:retained",
      "completed",
      "completed",
      "completed",
    ]);
    expect(evaluated).toBe(3);
    expect(completion).not.toHaveProperty("storage");
    const after = store.read((reader) => ({
      keys: five().keys.map((key) => reader.key("alice", key)),
      resources: reader.resources(),
    }));
    expect(after.keys.slice(0, 2)).toEqual(before.keys.slice(0, 2));
    for (const resource of before.resources)
      expect(after.resources.find((candidate) => candidate.id === resource.id)).toEqual(resource);
    expect(after.resources.map((resource) => resource.id).sort()).toEqual(
      Array.from({ length: 5 }, (_, i) => `beads/new${i}`),
    );
    expect(after.keys.every((key) => key.kind === "retained")).toBe(true);
    await owner.close();
  }, 20_000);
  it.each(["default", "drain"])(
    "completes the separate %s emitted child with no automatic tail abandonment",
    async (mode) => {
      const dir = directory(),
        child = startSequenceChild(dir, mode);
      await child.wait("ready");
      if (mode === "drain") {
        await child.wait("barrier");
        expect(await child.wait("draining")).toMatchObject({
          closeIdentity: true,
          phase: "not-accepting",
        });
      }
      const completed = await child.wait("complete");
      expect(completed).toMatchObject({ complete: true, sameClose: true });
      expect(await child.exited).toEqual({ code: 0, signal: null });
      const result = completed.result as SubmissionCompletion;
      expect(codes(result)).toEqual(Array(5).fill("created"));
      const store = reopenChild(dir);
      expect(store.runtime.recoveredClaims).toBe(0);
      expect(
        store
          .read((reader) => reader.resources())
          .map((resource) => resource.id)
          .sort(),
      ).toEqual(Array.from({ length: 5 }, (_, i) => `beads/new${i}`));
      expect(
        store.read((reader) => five().keys.map((key) => reader.key("alice", key).kind)),
      ).toEqual(Array(5).fill("retained"));
    },
    20_000,
  );
});

describe("G11 actual S5 read entry and hook-free inspection", () => {
  it("owns checked Scope and one synchronous facade, expires returns, and preserves callback origins", async () => {
    const f = fixture({ empty: true }),
      owner = f.owner();
    expect(owner.scope).toBe(scope);
    expect(Reflect.set(owner, "scope", "https://wrong.test/")).toBe(false);
    const read = vi.spyOn(f.store, "read"),
      expire = vi.spyOn(f.store, "expire"),
      close = vi.spyOn(f.store, "close");
    f.clock.mockClear();
    expect(owner.inspectLifecycle()).toEqual({ busy: false, accepting: true });
    expect(Object.isFrozen(owner.inspectLifecycle())).toBe(true);
    expect([
      read.mock.calls.length,
      expire.mock.calls.length,
      close.mock.calls.length,
      f.clock.mock.calls.length,
    ]).toEqual([0, 0, 0, 0]);
    const done = submit(owner, sequence([create("read-made", { id: "beads/made" })]));
    f.queue.drain();
    await done;
    read.mockClear();
    let escaped: (() => unknown) | undefined;
    const value = { kind: "entry-refused", reason: "not-accepting" };
    const result = owner.withRead((reader) => {
      expect(owner.inspectLifecycle()).toEqual({ busy: true, accepting: true });
      expect(reader.resource("beads/made")).toBeDefined();
      escaped = reader.resources;
      expect(
        owner.withRead(() => {
          throw Error("nested callback ran");
        }),
      ).toMatchObject({
        kind: "entry-refused",
        reason: "reentrant",
        cause: { phase: "reentrant" },
      });
      return value;
    });
    expect(result).toEqual({ kind: "read", value });
    expect(Object.isFrozen(result)).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(() => escaped?.()).toThrow(expect.objectContaining({ reason: "expired-facade" }));
    const failure = new SequenceLifecycleError("not-accepting", Error("callback"));
    expect(() =>
      owner.withRead(() => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(owner.inspectLifecycle()).toEqual({ busy: false, accepting: true });
    await owner.close();
    read.mockClear();
    expect(
      owner.withRead(() => {
        throw Error("closed callback ran");
      }),
    ).toMatchObject({ kind: "entry-refused", reason: "not-accepting" });
    expect(owner.inspectLifecycle()).toEqual({ busy: false, accepting: false });
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects actual direct async read returns before an outer envelope and owns rejection hygiene", async () => {
    const f = fixture({ empty: true }),
      owner = f.owner();
    const unhandled: unknown[] = [],
      listener = (value: unknown) => unhandled.push(value);
    process.on("unhandledRejection", listener);
    try {
      for (const kind of ["resolve", "reject", "thenable"] as const) {
        let expired: (() => unknown) | undefined;
        let caught: unknown;
        try {
          owner.withRead((reader) => {
            expired = reader.resources;
            if (kind === "resolve") return Promise.resolve(1);
            if (kind === "reject") return Promise.reject(Error("forbidden async"));
            return {
              // Explicit negative direct S6 callback result.
              // biome-ignore lint/suspicious/noThenProperty: Intentional synchronous-entry rejection test.
              then(resolve: (value: number) => void) {
                resolve(1);
              },
            };
          });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(RecoveryStoreError);
        expect(caught).toMatchObject({ reason: "async-callback" });
        expect(() => expired?.()).toThrow(expect.objectContaining({ reason: "expired-facade" }));
      }
      await later();
      expect(unhandled).toEqual([]);
      expect(owner.inspectLifecycle()).toEqual({ busy: false, accepting: true });
      expect(owner.withRead((r) => r.resources())).toEqual({ kind: "read", value: [] });
    } finally {
      process.off("unhandledRejection", listener);
    }
    await owner.close();
  });
  it("keeps inspection inert and busy precedence during actual member/maintenance/cancellation drain", async () => {
    const f = fixture({ empty: true });
    let owner: SequenceLifecycle | undefined;
    const observations: { busy: boolean; accepting: boolean }[] = [];
    const inspect = () => {
      if (!owner) return;
      const state = owner.inspectLifecycle();
      observations.push(state);
      expect(Object.isFrozen(state)).toBe(true);
      expect(state.busy).toBe(true);
      expect(
        owner.withRead(() => {
          throw Error("busy read ran");
        }),
      ).toMatchObject({ kind: "entry-refused", reason: "reentrant" });
    };
    const scheduler: LifecycleScheduler = {
      turn: f.queue.turn.bind(f.queue),
      delay(ms, callback) {
        const cancel = f.queue.delay(ms, callback);
        return () => {
          inspect();
          cancel();
        };
      },
    };
    owner = f.owner({
      scheduler,
      member: optionsFor(f, {
        clock: () => {
          inspect();
          return f.state.now++;
        },
      }),
    });
    f.queue.tick(); // Actual maintenance.
    const done = submit(owner, sequence([create("one"), create("two")]));
    const closed = owner.close(); // Actual cancellation; tail still belongs to S5.
    expect(owner.inspectLifecycle()).toEqual({ busy: false, accepting: false });
    expect(
      owner.withRead(() => {
        throw Error("draining read ran");
      }),
    ).toMatchObject({ reason: "not-accepting" });
    f.queue.drain();
    await done;
    await closed;
    expect(observations.some((x) => x.accepting)).toBe(true);
    expect(observations.some((x) => !x.accepting)).toBe(true);
  });
});
