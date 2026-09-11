import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate as checkpoint } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseCanonicalScope,
  parseTypeDescriptor,
  prepareReadUpdateSequence,
  prepareReadUpdateSingleton,
  stringifyJsonValue,
  type PreparedReadUpdateCarrier,
  type ReadRequest,
  type ReadUpdateOperation,
  type MaximumEndpointMultiplicityPolicy,
} from "@bdp/protocol";
import * as protocolModule from "@bdp/protocol";
import { openRecoveryStore, RecoveryStoreError, type StoreReader } from "./recovery-store.js";
import {
  createSequenceLifecycle,
  SequenceLifecycleError,
  type LifecycleScheduler,
  type SubmissionCompletion,
} from "./sequence-executor.js";
import { type MemberExecutorOptions, type StablePrincipal } from "./member-executor.js";
import {
  AuthorityReadError,
  type AuthorityReadOptions,
  type AuthorityReadFacet,
  type AuthorityReadPlane,
  type ScopeReadConfiguration,
} from "./authority-read.js";
import * as planeModule from "./authority-read.js";
import * as paginationModule from "./read-pagination.js";
import { ScopeServerClosedError } from "./read-request.js";
import {
  createReadSequenceLifecycle,
  ReadSequenceEntryError,
  ReadSequenceCloseError,
  ReadSequenceConstructionError,
  type ReadSequenceLifecycle,
  type ReadSequenceLifecycleOptions,
} from "./read-sequence-lifecycle.js";

const scope = parseCanonicalScope("https://read-sequence.test/s/"),
  beadType = "https://types.test/bead",
  linkType = "https://types.test/link";
const day = 86_400_000,
  initial = 1_700_000_000_000;
const url = (relative: string) => new URL(relative, scope).href;
const alice = Object.freeze({ id: "alice" }),
  bob = Object.freeze({ id: "bob" });
class Queue implements LifecycleScheduler {
  turns: { callback: () => void; cancelled: boolean }[] = [];
  delays: { callback: () => void; cancelled: boolean; ms: number }[] = [];
  cancellation: (() => void) | undefined;
  turn(callback: () => void) {
    const task = { callback, cancelled: false };
    this.turns.push(task);
    return () => {
      task.cancelled = true;
      this.cancellation?.();
    };
  }
  delay(ms: number, callback: () => void) {
    const task = { callback, cancelled: false, ms };
    this.delays.push(task);
    return () => {
      task.cancelled = true;
      this.cancellation?.();
    };
  }
  step() {
    const task = this.turns.shift();
    if (!task) throw Error("no queued real turn");
    if (!task.cancelled) task.callback();
  }
  tick() {
    const task = this.delays.shift();
    if (!task) throw Error("no queued real maintenance");
    if (!task.cancelled) task.callback();
  }
  drain() {
    let count = 0;
    while (this.turns.length) {
      if (++count > 2000) throw Error("bounded queue exceeded");
      this.step();
    }
  }
}
const fixtures: ReturnType<typeof makeFixture>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.state.hook = undefined;
    f.queue.cancellation = undefined;
    let completion: Promise<unknown> | undefined;
    try {
      completion = f.lifecycle ? f.lifecycle.close() : f.owner.close();
    } catch {}
    try {
      f.queue.drain();
    } catch {}
    await Promise.allSettled([...(completion ? [completion] : []), f.owner.closed]);
    vi.restoreAllMocks();
    try {
      f.store.close();
    } catch {}
    rmSync(f.directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function makeFixture(owned: boolean) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-read-sequence-"));
  const bead = parseTypeDescriptor({
    id: beadType,
    name: "Bead",
    describes: "bead",
    conformsTo: [],
    ...(owned ? { ownsOutgoing: { [linkType]: { max: 10 } } } : {}),
  });
  const link = parseTypeDescriptor({
    id: linkType,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [beadType], external: "opaque" },
    target: { conformsTo: [beadType], external: "opaque" },
  });
  const types = { [beadType]: stringifyJsonValue(bead), [linkType]: stringifyJsonValue(link) };
  const storeOptions = {
    directory,
    scope,
    installationId: "bridge-fixture",
    lineageId: "fresh-empty",
    minimumRetentionMs: day,
  };
  const store = openRecoveryStore({ ...storeOptions, create: { types } });
  const state = {
    memberNow: initial,
    pageNow: 1000,
    tokens: 0,
    view: "view-1",
    epoch: "epoch-1",
    hidden: new Set<string>(),
    memberSources: [] as ScopeReadConfiguration[],
    readSources: [] as ScopeReadConfiguration[],
    readers: [] as StoreReader[],
    captures: 0,
    hook: undefined as ((phase: string, reader?: StoreReader) => void) | undefined,
    configuration: Object.freeze({
      policyIdentity: "policy-1",
      configurationIdentity: "configuration-1",
      maximumEndpointMultiplicity: Object.freeze(
        [],
      ) as readonly MaximumEndpointMultiplicityPolicy[],
    }) as ScopeReadConfiguration,
  };
  const source = {
    capture(reader: StoreReader) {
      expect(this).toBe(source);
      reader.policy("fixture");
      if (state.readers.at(-1) === reader) state.readSources.push(state.configuration);
      return state.configuration;
    },
  };
  const captureSource = source.capture.bind(source);
  const member: MemberExecutorOptions = {
    scope,
    limits: {},
    retentionMs: day,
    minimumRetentionMs: day,
    clock: function (this: unknown) {
      expect(this).toBeUndefined();
      state.hook?.("member-clock");
      return state.memberNow++;
    },
    numericBudget: {
      diagnostic: ({ pointer }) => ({ message: "number", instanceLocation: pointer }),
    },
    contracts: {
      get(id, bytes) {
        state.hook?.("contract");
        if (types[id as keyof typeof types] !== bytes) return undefined;
        return { descriptor: id === beadType ? bead : link };
      },
    },
    captureMemberContext(reader) {
      expect(this).toBe(member);
      state.hook?.("member-capture", reader);
      const configuration = captureSource(reader);
      state.memberSources.push(configuration);
      const hidden = new Set(state.hidden);
      return {
        ...configuration,
        recordChangeContext: true,
        policy: {
          canRead: (r) => {
            state.hook?.("member-policy", reader);
            return !hidden.has(r.id);
          },
          canCreate: () => true,
          canWrite: () => true,
          canWriteBead: () => true,
        },
      };
    },
  };
  const queue = new Queue();
  const owner = createSequenceLifecycle({
    store,
    member,
    maximumSequenceOperations: undefined,
    maintenanceIntervalMs: day,
    scheduler: queue,
  });
  const pagination: AuthorityReadOptions["pagination"] = {
    scope,
    defaultPageItems: 2,
    maxPageItems: 10,
    cursorTtlMs: 1000,
    retainedStateCapacity: 100,
    maxRetainedCursorPositionsPerSnapshot: 20,
    retainedSnapshotByteCapacity: 4_000_000,
    retainedSnapshotNodeCapacity: 200_000,
    maxOpaqueTokenLength: 40,
    tokenGenerationAttempts: 3,
    idleCleanup: "on-demand",
    clock() {
      expect(this).toBe(pagination);
      state.hook?.("page-clock");
      return state.pageNow;
    },
    generateOpaqueToken() {
      expect(this).toBe(pagination);
      state.hook?.("token");
      return `bridge_${++state.tokens}`;
    },
  };
  const read: Omit<AuthorityReadOptions, "entry"> = {
    scopeEpoch: "epoch-1",
    scopeConfiguration: {
      capture(reader) {
        return source.capture.call(source, reader);
      },
    },
    installedTypes: [bead, link],
    selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
    pagination,
    advertisedLimits: {
      page: { defaultItems: 2, maximumItems: 10 },
      selector: { bytes: 4096, depth: 32, nodes: 256 },
      cursorTtlMilliseconds: 1000,
    },
    captureReadAuthorization(reader, principal, intent) {
      expect(this).toBe(read);
      state.captures++;
      state.readers.push(reader);
      state.hook?.("read-capture", reader);
      const hidden = new Set(state.hidden);
      const policy = {
        canRead(record: { id: string }) {
          expect(this).toBe(policy);
          return !hidden.has(record.id);
        },
      };
      const authorization = {
        authorizationView: state.view,
        scopeEpoch: state.epoch,
        policy,
        canReadType() {
          expect(this).toBe(authorization);
          return true;
        },
      };
      expect(
        principal.kind === "anonymous" || ["alice", "bob"].includes(principal.principal.id),
      ).toBe(true);
      expect(Object.isFrozen(intent)).toBe(true);
      return { kind: "authorized", authorization };
    },
  };
  // Same original source object in Read and member, with a logging method that
  // preserves its receiver. No equivalent-data stand-in source.
  Object.assign(read, { scopeConfiguration: source });
  const f = {
    directory,
    storeOptions,
    store,
    state,
    source,
    member,
    queue,
    owner,
    read,
    pagination,
    lifecycle: undefined as ReadSequenceLifecycle | undefined,
    async open(
      options: ReadSequenceLifecycleOptions = { owner, read },
    ): Promise<ReadSequenceLifecycle> {
      const result = await promiseCall(() => createReadSequenceLifecycle(options));
      f.lifecycle = result as ReadSequenceLifecycle;
      return f.lifecycle;
    },
  };
  return f;
}
function fixture(owned = true) {
  const f = makeFixture(owned);
  fixtures.push(f);
  return f;
}
function promiseCall<P extends Promise<unknown>>(call: () => P): P {
  let value: P | undefined;
  expect(() => {
    value = call();
  }).not.toThrow();
  expect(value).toBeInstanceOf(Promise);
  if (!value) throw Error("missing Promise");
  return value;
}
function sequence(operations: unknown[]): PreparedReadUpdateCarrier {
  return prepareReadUpdateSequence(scope, stringifyJsonValue({ operations }));
}
function create(id: string) {
  return {
    operation: "createBead",
    id: `beads/${id}`,
    type: beadType,
    properties: { revision: "authored-value", n: 0 },
    idempotencyKey: `create_${id}`,
  };
}
function submission(
  lifecycle: Pick<ReadSequenceLifecycle, "submit">,
  carrier: PreparedReadUpdateCarrier,
  principal: StablePrincipal = alice,
) {
  const result = lifecycle.submit(carrier, principal);
  expect(result.kind).toBe("admitted");
  if (result.kind !== "admitted") throw Error("refused fixture work");
  return result.completion;
}
async function execute(
  f: ReturnType<typeof fixture>,
  carrier: PreparedReadUpdateCarrier,
  principal: StablePrincipal = alice,
) {
  const lifecycle = f.lifecycle;
  if (!lifecycle) throw Error("missing coordinator");
  const done = submission(lifecycle, carrier, principal);
  f.queue.drain();
  return await done;
}
async function singleton(
  f: ReturnType<typeof fixture>,
  operation: ReadUpdateOperation,
  input: unknown,
  key: string,
) {
  return execute(f, prepareReadUpdateSingleton(scope, operation, stringifyJsonValue(input), key));
}
function body(value: unknown): Record<string, unknown> {
  expect(value).toMatchObject({ kind: "success" });
  return (value as { body: Record<string, unknown> }).body;
}
function items(value: unknown): Record<string, unknown>[] {
  return body(value).items as Record<string, unknown>[];
}
function resource(id = "a"): ReadRequest {
  return { kind: "resource", resource: "bead", id: url(`beads/${id}`) };
}
function continuation(next: unknown): ReadRequest {
  return { kind: "collection", collection: "beads", continuation: next as string };
}
function codes(value: SubmissionCompletion) {
  if (value.kind !== "sequence") throw Error("not a sequence");
  return value.response.results.map((r) => ("code" in r ? r.code : r.outcome));
}
function expectEntry(error: unknown, reason: string, origin: string) {
  expect(error).toBeInstanceOf(ReadSequenceEntryError);
  expect(error).toMatchObject({ reason, origin });
}
function reentry(
  lifecycle: ReadSequenceLifecycle,
  facet: AuthorityReadFacet,
  origin: "owner" | "coordinator" | "read",
) {
  const captured: unknown[] = [],
    pending: Promise<unknown>[] = [];
  for (const call of [
    () => lifecycle.close(),
    () => lifecycle.submit(sequence([create("blocked")]), alice),
    () => lifecycle.readFor({ kind: "anonymous" }),
  ]) {
    let error: unknown;
    try {
      call();
    } catch (caught) {
      error = caught;
    }
    captured.push(error);
  }
  expectEntry(captured[0], "reentrant", origin);
  expectEntry(captured[1], "reentrant", origin);
  expect(captured[2]).toBeInstanceOf(AuthorityReadError);
  expectEntry((captured[2] as Error).cause, "reentrant", origin);
  pending.push(
    promiseCall(() => facet.perform(resource())),
    promiseCall(() => facet.resolveAlias(url("alias/current"))),
  );
  return Promise.all(
    pending.map(async (p) => {
      await expect(p).rejects.toBeInstanceOf(AuthorityReadError);
      await expect(p).rejects.toMatchObject({ cause: { reason: "reentrant", origin } });
    }),
  );
}

describe("G11 actual committed prefixes, shared source and delivery", () => {
  it("observes five real prefixes, owned/alias state and atomic properties R1 before actual R2", async () => {
    const f = fixture(),
      lifecycle = await f.open(),
      facet = lifecycle.readFor({ kind: "authenticated", principal: alice });
    const carrier = sequence([
      create("a"),
      create("b"),
      {
        operation: "createLink",
        id: "links/l",
        type: linkType,
        source: "beads/a",
        target: "beads/b",
        idempotencyKey: "link",
      },
      { operation: "putAlias", alias: "alias/current", target: "beads/a", idempotencyKey: "alias" },
      {
        operation: "updateBeadProperties",
        bead: "beads/a",
        change: [{ op: "replace", path: "/n", value: 2 }],
        idempotencyKey: "update",
      },
    ]);
    const completed = submission(lifecycle, carrier);
    expect(items(await facet.perform({ kind: "collection", collection: "beads" }))).toEqual([]);
    f.queue.step();
    expect(
      items(await facet.perform({ kind: "collection", collection: "beads" })).map((r) => r.id),
    ).toEqual([url("beads/a")]);
    expect(await facet.resolveAlias(url("alias/current"))).toMatchObject({
      kind: "problem",
      problem: { code: "resource-not-found" },
    });
    f.queue.step();
    expect(
      items(await facet.perform({ kind: "collection", collection: "beads" })).map((r) => r.id),
    ).toEqual([url("beads/a"), url("beads/b")]);
    f.queue.step();
    const linked = body(await facet.perform(resource()));
    const edge = body(
      await facet.perform({ kind: "resource", resource: "link", id: url("links/l") }),
    );
    expect((linked.ownedLinks as Record<string, unknown[]>)[linkType]).toEqual([edge]);
    expect(linked.changeContext).toEqual(edge.changeContext);
    f.queue.step();
    expect(await facet.resolveAlias(url("alias/current"))).toMatchObject({
      kind: "target",
      target: url("beads/a"),
    });
    const read = vi.spyOn(f.store, "read");
    f.state.captures = 0;
    const r1 = promiseCall(() =>
      facet.perform({ kind: "properties", resource: "bead", id: url("beads/a") }),
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(f.state.captures).toBe(1);
    expect(() => f.state.readers.at(-1)?.resources()).toThrow(/expired/);
    f.queue.step(); // Real R2 executes before await, after the exact R1 call returned.
    const first = await r1;
    expect(body(first)).toEqual({ n: 0, revision: "authored-value" });
    expect(first).toMatchObject({
      observation: {
        resourceRevision: linked.revision,
        authorizationView: "view-1",
        scopeEpoch: "epoch-1",
        policyIdentity: "policy-1",
        configurationIdentity: "configuration-1",
      },
    });
    expect(linked.revision).not.toBe("authored-value");
    expect(body(await facet.perform(resource())).properties).toEqual({
      n: 2,
      revision: "authored-value",
    });
    expect(codes(await completed)).toEqual(["created", "created", "created", "created", "updated"]);
    expect(f.state.memberSources.at(-1)).toBe(f.state.configuration);
    expect(f.state.readSources.at(-1)).toBe(f.state.configuration);
  });
  it("shares actual configuration for P/Q/anonymous and lawful aggregate changes without stale2", async () => {
    const f = fixture(),
      lifecycle = await f.open();
    await execute(f, sequence([create("a"), create("b")]));
    const p = lifecycle.readFor({ kind: "authenticated", principal: alice }),
      q = lifecycle.readFor({ kind: "authenticated", principal: bob }),
      anon = lifecycle.readFor({ kind: "anonymous" });
    const maximum = (n: number) => {
      f.state.configuration = Object.freeze({
        policyIdentity: `p${n}`,
        configurationIdentity: `c${n}`,
        maximumEndpointMultiplicity: Object.freeze([
          { endpoint: "source" as const, linkConformsTo: linkType, max: n },
        ]),
      });
    };
    const make = (id: string) =>
      singleton(
        f,
        "createLink",
        { id: `links/${id}`, type: linkType, source: "beads/a", target: "beads/b" },
        `edge_${id}`,
      );
    maximum(2);
    await make("one");
    await make("two");
    const before = body(await p.perform(resource()));
    expect((before.ownedLinks as Record<string, unknown[]>)[linkType]).toHaveLength(2);
    // Test-only legal administrative replacement guard, measured through Read.
    expect(() => {
      if ((before.ownedLinks as Record<string, unknown[]>)[linkType]?.length !== 1)
        throw Error("already violated maximum");
      maximum(1);
    }).toThrow(/already violated/);
    await singleton(f, "deleteLink", { link: "links/two" }, "remove_two");
    maximum(1);
    const denied = await make("blocked");
    expect(denied).toMatchObject({
      kind: "singleton",
      disposition: { code: "aggregate-constraint-violation" },
    });
    maximum(3);
    await make("second");
    await make("third");
    expect(
      (body(await q.perform(resource())).ownedLinks as Record<string, unknown[]>)[linkType],
    ).toHaveLength(3);
    for (const facet of [p, q, anon]) {
      const result = await facet.perform({ kind: "scope-discovery", scope });
      expect(result).toMatchObject({
        kind: "discovery",
        data: { maximumEndpointMultiplicity: f.state.configuration.maximumEndpointMultiplicity },
        observation: { policyIdentity: "p3", configurationIdentity: "c3" },
      });
    }
    expect(f.state.memberSources.at(-1)).toBe(f.state.configuration);
    expect(f.state.readSources.at(-1)).toBe(f.state.configuration);
    const first = body(await p.perform({ kind: "collection", collection: "beads", limit: 1 }));
    expect(items(await q.perform(continuation(first.next))).map((r) => r.id)).toEqual([
      url("beads/b"),
    ]);
    f.state.epoch = "wrong";
    await expect(q.perform(continuation(first.next))).rejects.toBeInstanceOf(AuthorityReadError);
    f.state.epoch = "epoch-1";
    expect(items(await p.perform(continuation(first.next))).map((r) => r.id)).toEqual([
      url("beads/b"),
    ]);
  });
});

describe("G11 every active entry and timer phase", () => {
  it.each([
    "member-capture",
    "member-policy",
    "contract",
    "member-clock",
    "maintenance",
    "cancellation",
  ])("refuses owner-active reentry from actual %s with no new admission", async (phase) => {
    const f = fixture(),
      lifecycle = await f.open(),
      facet = lifecycle.readFor({ kind: "anonymous" });
    await execute(f, sequence([create("a"), create("b")]));
    const reads = vi.spyOn(f.store, "read"),
      admits = vi.spyOn(f.store, "admit"),
      closes = vi.spyOn(f.store, "close");
    const pending: Promise<unknown>[] = [];
    const hook = () => {
      const before = [reads.mock.calls.length, admits.mock.calls.length, closes.mock.calls.length];
      pending.push(reentry(lifecycle, facet, "owner"));
      expect([reads.mock.calls.length, admits.mock.calls.length, closes.mock.calls.length]).toEqual(
        before,
      );
    };
    if (phase === "cancellation") f.queue.cancellation = hook;
    else
      f.state.hook = (name) => {
        if (name === phase || (phase === "maintenance" && name === "member-clock")) hook();
      };
    if (phase === "maintenance") f.queue.tick();
    else {
      const done = submission(
        lifecycle,
        sequence([
          {
            operation: "updateBeadProperties",
            bead: "beads/a",
            change: [{ op: "replace", path: "/n", value: 1 }],
            idempotencyKey: "one",
          },
        ]),
      );
      if (phase === "cancellation") {
        // Explicit test instrumentation of actual owner close exercises its
        // pending scheduler cancellation while common state is still idle.
        // This retained owner handle is never part of the returned interface.
        f.owner.close();
      }
      f.queue.drain();
      await done;
    }
    expect(pending.length).toBeGreaterThan(0);
    await Promise.all(pending);
    f.state.hook = undefined;
    f.queue.cancellation = undefined;
    if (phase !== "cancellation")
      expect(body(await facet.perform(resource())).id).toBe(url("beads/a"));
  });
  it.each(["read-capture", "page-clock", "token", "signal", "remove"])(
    "contains actual %s reentry through the complete plane delegation",
    async (phase) => {
      const f = fixture(),
        lifecycle = await f.open(),
        facet = lifecycle.readFor({ kind: "anonymous" });
      await execute(f, sequence([create("a"), create("b"), create("c")]));
      const first = body(
        await facet.perform({ kind: "collection", collection: "beads", limit: 1 }),
      );
      const checks: Promise<unknown>[] = [];
      const check = () => checks.push(reentry(lifecycle, facet, "coordinator"));
      f.state.hook = (name) => {
        if (name === phase) check();
      };
      const controller = new AbortController();
      if (phase === "signal")
        Object.defineProperty(controller.signal, "aborted", {
          get() {
            check();
            return false;
          },
        });
      if (phase === "remove") {
        const remove = controller.signal.removeEventListener.bind(controller.signal);
        vi.spyOn(controller.signal, "removeEventListener").mockImplementation((...args) => {
          check();
          remove(...args);
        });
      }
      const page = await facet.perform(
        { kind: "collection", collection: "beads", limit: 1 },
        { signal: controller.signal },
      );
      expect(items(page).map((r) => r.id)).toEqual([url("beads/a")]);
      expect(checks.length).toBeGreaterThan(0);
      await Promise.all(checks);
      f.state.hook = undefined;
      expect(items(await facet.perform(continuation(first.next))).map((r) => r.id)).toEqual([
        url("beads/b"),
      ]);
      expect(codes(await execute(f, sequence([create("later")])))).toEqual(["created"]);
    },
  );
  it("guards a real idle timer before logical expiry and cancels it at ordinary joint close", async () => {
    const f = fixture();
    Object.assign(f.pagination, { idleCleanup: "timer" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const lifecycle = await f.open(),
      facet = lifecycle.readFor({ kind: "anonymous" });
    await execute(f, sequence([create("a"), create("b")]));
    const first = body(await facet.perform({ kind: "collection", collection: "beads", limit: 1 }));
    const reads = vi.spyOn(f.store, "read"),
      admits = vi.spyOn(f.store, "admit"),
      closes = vi.spyOn(f.store, "close");
    const checks: Promise<unknown>[] = [];
    f.state.hook = (name) => {
      if (name === "page-clock") checks.push(reentry(lifecycle, facet, "read"));
    };
    f.state.pageNow = 1500;
    await vi.advanceTimersByTimeAsync(1000);
    expect(checks.length).toBeGreaterThan(0);
    await Promise.all(checks);
    expect([reads.mock.calls.length, admits.mock.calls.length, closes.mock.calls.length]).toEqual([
      0, 0, 0,
    ]);
    expect(vi.getTimerCount()).toBe(1);
    f.state.hook = undefined;
    expect(items(await facet.perform(continuation(first.next))).map((r) => r.id)).toEqual([
      url("beads/b"),
    ]);
    f.state.pageNow = 2000;
    await vi.advanceTimersByTimeAsync(500);
    expect(await facet.perform(continuation(first.next))).toMatchObject({
      kind: "problem",
      problem: { code: "cursor-expired" },
    });
    expect(
      items(await facet.perform({ kind: "collection", collection: "beads", limit: 1 })),
    ).toHaveLength(1);
    await lifecycle.close();
    expect(vi.getTimerCount()).toBe(0);
    const clock = vi.fn();
    f.state.hook = clock;
    await vi.advanceTimersByTimeAsync(5000);
    expect(clock).not.toHaveBeenCalled();
  });
});

describe("G11 complete facet Promise/error boundary", () => {
  it.each(["perform", "alias"] as const)(
    "returns the exact plane Promise for %s, preserving delegate and gate fault identities",
    async (method) => {
      const f = fixture();
      const real = planeModule.createAuthorityReadPlane;
      let last: Promise<unknown> | undefined, throwDelegate: unknown;
      vi.spyOn(planeModule, "createAuthorityReadPlane").mockImplementation((options) => {
        const actual = real(options);
        return {
          ...actual,
          readFor(person) {
            const facet = actual.readFor(person);
            return {
              perform: ((...args: Parameters<AuthorityReadFacet["perform"]>) => {
                if (throwDelegate) throw throwDelegate;
                last = facet.perform(...args);
                return last;
              }) as AuthorityReadFacet["perform"],
              resolveAlias(...args) {
                if (throwDelegate) throw throwDelegate;
                last = facet.resolveAlias(...args);
                return last as ReturnType<AuthorityReadFacet["resolveAlias"]>;
              },
            };
          },
        };
      });
      let gateFault: unknown;
      // Labeled inspector fault; all non-fault calls delegate the genuine frozen owner.
      const handle = {
        ...f.owner,
        inspectLifecycle() {
          if (gateFault) throw gateFault;
          return f.owner.inspectLifecycle();
        },
      };
      const lifecycle = await f.open({ owner: handle, read: f.read }),
        facet = lifecycle.readFor({ kind: "anonymous" });
      await execute(f, sequence([create("a")]));
      const call = () =>
        method === "perform" ? facet.perform(resource()) : facet.resolveAlias(url("alias/current"));
      const pending = promiseCall(() => call());
      expect(pending).toBe(last);
      await pending;
      for (const error of [
        new ReadSequenceEntryError("not-accepting", "owner"),
        new SequenceLifecycleError("reentrant", Error("delegate")),
        new AuthorityReadError("reentrant", "delegate"),
      ]) {
        throwDelegate = error;
        await expect(promiseCall(() => call())).rejects.toBe(error);
        throwDelegate = undefined;
        gateFault = error;
        await expect(promiseCall(() => call())).rejects.toBe(error);
        gateFault = undefined;
        await promiseCall(() => call());
      }
      await lifecycle.close();
      const refused = promiseCall(() => call());
      let error: unknown;
      try {
        await refused;
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ScopeServerClosedError);
      const descriptor = Object.getOwnPropertyDescriptor(error, "cause");
      expect(descriptor).toMatchObject({ enumerable: false, configurable: true, writable: true });
      expect(descriptor?.value).toBe((error as Error).cause);
      expectEntry((error as Error).cause, "not-accepting", "coordinator");
    },
  );
});

describe("G11 actual drain, ordinary failures and read fence", () => {
  it("closes at2of5 with original completion and settled R1 while real3–5 drain", async () => {
    const f = fixture(),
      { handle, calls } = controlledClosures(f, {});
    let actualSubmission: ReturnType<typeof f.owner.submit> | undefined;
    const lifecycle = await f.open({
      owner: {
        ...handle,
        submit(...args) {
          actualSubmission = f.owner.submit(...args);
          return actualSubmission;
        },
      },
      read: f.read,
    });
    const facet = lifecycle.readFor({ kind: "anonymous" });
    const done = submission(lifecycle, sequence(["a", "b", "c", "d", "e"].map(create)));
    expect(actualSubmission).toMatchObject({ kind: "admitted", completion: done });
    if (actualSubmission?.kind !== "admitted") throw Error("missing actual submission");
    expect(actualSubmission.completion).toBe(done);
    f.queue.step();
    f.queue.step();
    const controller = new AbortController();
    const r1 = facet.perform(resource(), { signal: controller.signal });
    const storeClose = vi.spyOn(f.store, "close"),
      reads = vi.spyOn(f.store, "read"),
      admit = vi.spyOn(f.store, "admit");
    const nested: Promise<unknown>[] = [];
    f.queue.cancellation = () => nested.push(reentry(lifecycle, facet, "coordinator"));
    const closed = lifecycle.close();
    expect(closed).toBe(lifecycle.closed);
    expect(lifecycle.close()).toBe(closed);
    const before = [reads.mock.calls.length, admit.mock.calls.length];
    for (const call of [
      () => facet.perform(resource()),
      () => facet.resolveAlias(url("alias/current")),
    ])
      await expect(promiseCall(() => call())).rejects.toMatchObject({
        cause: { reason: "not-accepting", origin: "coordinator" },
      });
    expect(() => lifecycle.readFor({ kind: "anonymous" })).toThrow(ScopeServerClosedError);
    expect(() => lifecycle.submit(sequence([create("new")]), alice)).toThrow(
      ReadSequenceEntryError,
    );
    expect([reads.mock.calls.length, admit.mock.calls.length]).toEqual(before);
    expect(storeClose).not.toHaveBeenCalled();
    controller.abort();
    expect(body(await r1).id).toBe(url("beads/a"));
    f.queue.cancellation = undefined;
    f.state.hook = (phase) => {
      if (phase === "member-capture") nested.push(reentry(lifecycle, facet, "owner"));
    };
    f.queue.drain();
    expect(codes(await done)).toEqual(Array(5).fill("created"));
    await closed;
    expect(storeClose).toHaveBeenCalledTimes(1);
    expect(calls.owner).toBe(1);
    expect(calls.read).toBe(1);
    expect(calls.disposed).toBe(1);
    await Promise.all(nested);
    expect(lifecycle.close()).toBe(closed);
  });
  it("waits for another real attempt after an ordinary member fault and keeps ordinary read faults local", async () => {
    const f = fixture(),
      lifecycle = await f.open(),
      facet = lifecycle.readFor({ kind: "anonymous" });
    await execute(f, sequence([create("a")]));
    const originalRead = f.store.read.bind(f.store),
      ordinary = Object.assign(Error("labeled nonfenced read"), { code: "ERR_SQLITE_ERROR" });
    const read = vi.spyOn(f.store, "read").mockImplementationOnce(() => {
      throw ordinary;
    });
    await expect(facet.perform(resource())).rejects.toBe(ordinary);
    read.mockImplementation(originalRead);
    expect(body(await facet.perform(resource())).id).toBe(url("beads/a"));
    const failure = Error("actual member capture fault");
    let once = true;
    f.state.hook = (phase) => {
      if (phase === "member-capture" && once) {
        once = false;
        throw failure;
      }
    };
    const bad = submission(lifecycle, sequence([create("bad1"), create("bad2")]));
    const good = submission(lifecycle, sequence([create("good1"), create("good2")]));
    const close = vi.spyOn(f.store, "close"),
      closed = lifecycle.close();
    let settled = false;
    void closed.then(() => {
      settled = true;
    });
    f.queue.step();
    await expect(bad).rejects.toMatchObject({ phase: "member", cause: failure });
    expect(close).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    f.queue.step();
    expect(close).not.toHaveBeenCalled();
    f.queue.step();
    expect(codes(await good)).toEqual(["created", "created"]);
    await closed;
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("attributes a labeled sticky fence from actual withRead to read and recovers only real remaining claims", async () => {
    const f = fixture(),
      lifecycle = await f.open(),
      facet = lifecycle.readFor({ kind: "anonymous" });
    const first = submission(lifecycle, sequence(["a", "b", "c", "d", "e"].map(create)));
    f.queue.step();
    f.queue.step();
    // Explicit quiescent instrumentation, not another production owner/facet.
    const prefix = f.store.read((reader) => [
      reader.key(alice.id, "create_a"),
      reader.key(alice.id, "create_b"),
    ]);
    const extra = Array.from({ length: 4 }, (_, i) =>
      submission(lifecycle, sequence([create(`queued${i}`)])),
    );
    const fault = new RecoveryStoreError("fenced", "labeled sticky read fence");
    vi.spyOn(f.store, "read").mockImplementation(() => {
      throw fault;
    });
    const executeSpy = vi.spyOn(f.store, "executeMember").mockImplementation(() => {
      throw fault;
    });
    const release = vi.spyOn(f.store, "releaseOwnedClaim").mockImplementation(() => {
      throw fault;
    });
    const cleanups = new Map<string, Error>();
    const cleanup = vi.spyOn(f.store, "abandonAttempt").mockImplementation((admission) => {
      expect(cleanups.has(admission.attemptId)).toBe(false);
      const error = new RecoveryStoreError("fenced", admission.attemptId);
      cleanups.set(admission.attemptId, error);
      throw error;
    });
    const close = vi.spyOn(f.store, "close");
    await expect(promiseCall(() => facet.perform(resource()))).rejects.toBe(fault);
    const settled = await Promise.allSettled([first, ...extra]);
    for (const result of settled) {
      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") throw Error("fenced success");
      expect(result.reason).toMatchObject({
        phase: "read",
        cause: fault,
        cleanup: { kind: "failed" },
      });
      expect([...cleanups.values()]).toContain(result.reason.cleanup.error);
      expect(result.reason.secondary).toEqual([
        { phase: "cleanup", error: result.reason.cleanup.error },
      ]);
    }
    expect(cleanup).toHaveBeenCalledTimes(5);
    expect(executeSpy).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    await expect(lifecycle.closed).rejects.toMatchObject({
      owner: { completion: { kind: "rejected", error: { phase: "read", cause: fault } } },
    });
    expect(close).toHaveBeenCalledTimes(1);
    f.queue.drain();
    vi.restoreAllMocks();
    const reopened = openRecoveryStore(f.storeOptions);
    try {
      expect(reopened.runtime.recoveredClaims).toBe(7);
      expect(
        reopened.read((r) => [r.key(alice.id, "create_a"), r.key(alice.id, "create_b")]),
      ).toEqual(prefix);
      expect(reopened.read((r) => r.resources()).map((r) => r.id)).toEqual(["beads/a", "beads/b"]);
    } finally {
      reopened.close();
    }
  });
});

function controlledClosures(
  f: ReturnType<typeof fixture>,
  mode: {
    ownerInvocation?: unknown;
    ownerCompletion?: unknown;
    readInvocation?: unknown;
    readCompletion?: unknown;
    foreign?: boolean;
  },
) {
  const actualPlane = planeModule.createAuthorityReadPlane,
    actualPagination = paginationModule.createReadPagination;
  const calls = { owner: 0, read: 0, disposed: 0, released: [] as unknown[] };
  if (mode.ownerCompletion) {
    const close = f.store.close.bind(f.store);
    vi.spyOn(f.store, "close").mockImplementation(() => {
      close();
      throw mode.ownerCompletion;
    });
  }
  vi.spyOn(paginationModule, "createReadPagination").mockImplementation((options) => {
    const engine = actualPagination(options);
    return {
      ...engine,
      close() {
        calls.disposed++;
        const result = engine.close();
        calls.released.push(result);
        f.state.hook?.("read-disposal");
        if (mode.readCompletion) throw mode.readCompletion;
        return result;
      },
    };
  });
  vi.spyOn(planeModule, "createAuthorityReadPlane").mockImplementation((options) => {
    const plane = actualPlane(options);
    return {
      ...plane,
      close() {
        calls.read++;
        const result = plane.close();
        if (mode.readInvocation) throw mode.readInvocation;
        return result;
      },
    };
  });
  const handle = {
    ...f.owner,
    close() {
      calls.owner++;
      const result = f.owner.close();
      if (mode.ownerInvocation) throw mode.ownerInvocation;
      return mode.foreign ? Promise.reject(Error("foreign close completion")) : result;
    },
  };
  return { handle, calls };
}
describe("G11 close evidence and automatic owner observation", () => {
  it.each(["owner-invoke", "owner-complete", "read-invoke", "read-complete", "all", "foreign"])(
    "retains fixed actual completion and invocation evidence for %s",
    async (kind) => {
      const f = fixture(),
        oi = new ReadSequenceEntryError("reentrant", "owner"),
        oc = Error("owner completion"),
        ri = Error("read invocation"),
        rc = Error("read completion");
      const mode = {
        ownerInvocation: kind === "owner-invoke" || kind === "all" ? oi : undefined,
        ownerCompletion: kind === "owner-complete" || kind === "all" ? oc : undefined,
        readInvocation: kind === "read-invoke" || kind === "all" ? ri : undefined,
        readCompletion: kind === "read-complete" || kind === "all" ? rc : undefined,
        foreign: kind === "foreign",
      };
      const { handle, calls } = controlledClosures(f, mode),
        lifecycle = await f.open({ owner: handle, read: f.read });
      const pending = submission(lifecycle, sequence([create("a"), create("b")]));
      const closed = lifecycle.close();
      expect(closed).toBe(lifecycle.closed);
      expect(lifecycle.close()).toBe(closed);
      expect(calls.owner).toBe(1);
      expect(calls.read).toBe(1);
      expect(calls.disposed).toBe(1);
      let settled = false;
      void closed.catch(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      f.queue.drain();
      await pending;
      let error: unknown;
      try {
        await closed;
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ReadSequenceCloseError);
      const evidence = error as ReadSequenceCloseError;
      expect(Object.isFrozen(evidence)).toBe(true);
      for (const component of [evidence.owner, evidence.read]) {
        expect(Object.isFrozen(component)).toBe(true);
        expect(Object.isFrozen(component.completion)).toBe(true);
        if (component.invocationFault)
          expect(Object.isFrozen(component.invocationFault)).toBe(true);
      }
      if (mode.ownerInvocation) expect(evidence.owner.invocationFault?.error).toBe(oi);
      if (mode.readInvocation) expect(evidence.read.invocationFault?.error).toBe(ri);
      if (mode.ownerCompletion)
        expect(evidence.owner.completion).toMatchObject({
          kind: "rejected",
          error: { phase: "close", cause: oc },
        });
      if (mode.readCompletion)
        expect(evidence.read.completion).toEqual({ kind: "rejected", error: rc });
      if (kind === "all") expect(evidence.cause).toBe(oi);
      if (kind === "read-invoke") expect(evidence.cause).toBe(ri);
      if (kind === "read-complete") expect(evidence.cause).toBe(rc);
      if (kind === "foreign") {
        expect(evidence.owner.invocationFault?.error).toBeInstanceOf(TypeError);
        expect(evidence.owner.completion).toEqual({ kind: "fulfilled" });
      }
      expect(lifecycle.close()).toBe(closed);
      expect(calls.owner).toBe(1);
      expect(calls.read).toBe(1);
      expect(Object.isFrozen(oi)).toBe(false);
      expect(Object.isFrozen(oc)).toBe(false);
    },
  );
  it.each(["automatic", "explicit-before-observer"])(
    "owns original and derived rejections during %s close and a real timer while owner drains",
    async (path) => {
      const f = fixture();
      Object.assign(f.pagination, { idleCleanup: "timer" });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const readFailure = Error("Read cleanup"),
        { handle, calls } = controlledClosures(f, { readCompletion: readFailure });
      const lifecycle = await f.open({ owner: handle, read: f.read }),
        facet = lifecycle.readFor({ kind: "anonymous" });
      await execute(f, sequence([create("a"), create("b")]));
      await facet.perform({ kind: "collection", collection: "beads", limit: 1 });
      const tail = submission(lifecycle, sequence([create("c"), create("d")]));
      const maintenance = Error("labeled maintenance failure");
      vi.spyOn(f.store, "expire").mockImplementation(() => {
        throw maintenance;
      });
      f.queue.tick();
      for (const call of [
        () => facet.perform(resource()),
        () => facet.resolveAlias(url("alias/current")),
      ])
        await expect(promiseCall(() => call())).rejects.toMatchObject({
          cause: { origin: "owner", reason: "not-accepting" },
        });
      const checks: Promise<unknown>[] = [];
      f.state.hook = (phase) => {
        if (phase === "page-clock") checks.push(reentry(lifecycle, facet, "read"));
      };
      f.state.pageNow = 1500;
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all(checks);
      expect(checks.length).toBeGreaterThan(0);
      expect(calls.read).toBe(0);
      f.state.hook = undefined;
      const unhandled: unknown[] = [],
        listener = (value: unknown) => unhandled.push(value);
      process.on("unhandledRejection", listener);
      try {
        f.queue.drain(); // Owner completion rejects now; its observer has not run yet.
        if (path === "explicit-before-observer") expect(lifecycle.close()).toBe(lifecycle.closed);
        await checkpoint(); // Deliberately don't consume public joint.closed before this checkpoint.
        expect(unhandled).toEqual([]);
        expect(calls.read).toBe(1);
        expect(calls.disposed).toBe(1);
        expect(calls.released).toEqual([{ releasedSnapshots: 1, releasedCursors: 1 }]);
        expect(vi.getTimerCount()).toBe(0);
        expect(codes(await tail)).toEqual(["created", "created"]);
        await expect(lifecycle.closed).rejects.toMatchObject({
          owner: { completion: { error: { phase: "maintenance", cause: maintenance } } },
          read: { completion: { kind: "rejected", error: readFailure } },
        });
        expect(lifecycle.close()).toBe(lifecycle.closed);
        expect(calls.read).toBe(1);
        const clocks = vi.fn();
        f.state.hook = clocks;
        await vi.advanceTimersByTimeAsync(5000);
        expect(clocks).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", listener);
      }
    },
  );
});

describe("G11 receiving, ownership transfer and captured inputs", () => {
  it.each([
    "scope",
    "malformed-scope",
    "pagination",
    "entry",
    "method",
    "completion",
    "busy",
    "draining",
  ])("rejects %s before transfer and leaves the actual owner usable", async (kind) => {
    const f = fixture(),
      close = vi.fn(() => f.owner.close()),
      plane = vi.spyOn(planeModule, "createAuthorityReadPlane");
    const options = { owner: { ...f.owner, close }, read: f.read };
    if (kind === "scope") Object.assign(options, { scope });
    if (kind === "malformed-scope")
      Object.assign(options, { owner: { ...f.owner, scope: "relative/" } });
    if (kind === "pagination")
      Object.assign(f.pagination, { scope: parseCanonicalScope("https://elsewhere.test/") });
    if (kind === "entry") Object.assign(options, { read: { ...f.read, entry: f.owner } });
    // These wrappers are deliberately invalid receiving controls; no successful
    // turn or completion is invented and the actual owner remains caller-owned.
    if (kind === "method") Object.assign(options, { owner: { ...f.owner, withRead: undefined } });
    if (kind === "completion") Object.assign(options, { owner: { ...f.owner, closed: {} } });
    if (kind === "busy" || kind === "draining")
      Object.assign(options, {
        owner: {
          ...f.owner,
          inspectLifecycle: () => ({ busy: kind === "busy", accepting: kind !== "draining" }),
        },
      });
    const pending = promiseCall(() => createReadSequenceLifecycle(options));
    await expect(pending).rejects.toBeInstanceOf(ReadSequenceConstructionError);
    await expect(pending).rejects.toMatchObject({ phase: "receiving", ownership: "caller" });
    expect(close).not.toHaveBeenCalled();
    expect(plane).not.toHaveBeenCalled();
    expect(f.owner.inspectLifecycle()).toEqual({ busy: false, accepting: true });
    Object.assign(f.pagination, { scope });
    const lifecycle = await f.open();
    const done = submission(lifecycle, sequence([create("after")]));
    f.queue.drain();
    expect(codes(await done)).toEqual(["created"]);
  });
  it.each([false, true])(
    "waits for actual admitted tail after plane failure, retaining cleanup failure=%s",
    async (fails) => {
      const f = fixture(),
        original = Error("actual conformance construction fault"),
        invocation = Error("owner invocation"),
        completion = Error("owner completion");
      const { handle, calls } = controlledClosures(
        f,
        fails ? { ownerInvocation: invocation, ownerCompletion: completion } : {},
      );
      // Work is admitted by the actual S5 before transfer and remains owned by it.
      const tail = submission(f.owner, sequence([create("a"), create("b")]));
      vi.spyOn(protocolModule, "createTypeConformanceIndex").mockImplementationOnce(() => {
        throw original;
      });
      const unhandled: unknown[] = [],
        listener = (value: unknown) => unhandled.push(value);
      process.on("unhandledRejection", listener);
      try {
        const factory = promiseCall(() =>
          createReadSequenceLifecycle({ owner: handle, read: f.read }),
        );
        let settled = false;
        void factory.catch(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(calls.owner).toBe(1);
        expect(calls.disposed).toBe(1);
        f.queue.step();
        expect(settled).toBe(false);
        f.queue.step();
        await checkpoint();
        expect(unhandled).toEqual([]);
        expect(codes(await tail)).toEqual(["created", "created"]);
        let caught: unknown;
        try {
          await factory;
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(ReadSequenceConstructionError);
        const failure = caught as ReadSequenceConstructionError;
        expect(failure).toMatchObject({
          phase: "plane",
          ownership: "coordinator",
          cause: original,
        });
        expect(Object.isFrozen(failure)).toBe(true);
        expect(Object.isFrozen(failure.ownerCleanup)).toBe(true);
        if (fails) {
          expect(failure.ownerCleanup?.invocationFault?.error).toBe(invocation);
          expect(failure.ownerCleanup?.completion).toMatchObject({
            kind: "rejected",
            error: { phase: "close", cause: completion },
          });
        } else
          expect(failure.ownerCleanup).toEqual({
            component: "owner",
            completion: { kind: "fulfilled" },
          });
        expect(calls.owner).toBe(1);
        expect(Object.isFrozen(original)).toBe(false);
      } finally {
        process.off("unhandledRejection", listener);
      }
    },
  );
  it("owns an intentionally unconsumed receiving factory rejection through a native checkpoint", async () => {
    const f = fixture(),
      unhandled: unknown[] = [],
      listener = (value: unknown) => unhandled.push(value);
    process.on("unhandledRejection", listener);
    try {
      const pending = promiseCall(() =>
        createReadSequenceLifecycle({
          owner: f.owner,
          read: { ...f.read, pagination: { ...f.pagination, scope: "https://other.test/" } },
        }),
      );
      await checkpoint();
      expect(unhandled).toEqual([]);
      await expect(pending).rejects.toMatchObject({ phase: "receiving", ownership: "caller" });
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
  it("owns the unconsumed post-transfer factory and derived construction rejection after real tail drain", async () => {
    const f = fixture(),
      fault = Error("plane construction"),
      unhandled: unknown[] = [];
    const tail = submission(f.owner, sequence([create("a"), create("b")]));
    const index = vi
      .spyOn(protocolModule, "createTypeConformanceIndex")
      .mockImplementationOnce(() => {
        throw fault;
      });
    const listener = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", listener);
    try {
      const pending = promiseCall(() =>
        createReadSequenceLifecycle({ owner: f.owner, read: f.read }),
      );
      expect(index).toHaveBeenCalledTimes(1);
      f.queue.drain();
      await checkpoint(); // No public-factory handler attached before this checkpoint.
      expect(unhandled).toEqual([]);
      expect(codes(await tail)).toEqual(["created", "created"]);
      await expect(pending).rejects.toMatchObject({
        phase: "plane",
        ownership: "coordinator",
        cause: fault,
      });
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
  it("captures actual owner/source/Read/pagination callables and original receivers before late replacement", async () => {
    const f = fixture(),
      handle = { ...f.owner },
      lifecycle = await f.open({ owner: handle, read: f.read });
    const late = vi.fn(() => {
      throw Error("replaced callable invoked");
    });
    Object.assign(handle, { submit: late, withRead: late, inspectLifecycle: late, close: late });
    Object.assign(f.source, { capture: late });
    Object.assign(f.read, { captureReadAuthorization: late });
    Object.assign(f.pagination, { clock: late, generateOpaqueToken: late });
    await execute(f, sequence([create("a"), create("b")]));
    const facet = lifecycle.readFor({ kind: "anonymous" }),
      first = body(await facet.perform({ kind: "collection", collection: "beads", limit: 1 }));
    expect(items(await facet.perform(continuation(first.next))).map((r) => r.id)).toEqual([
      url("beads/b"),
    ]);
    await lifecycle.close();
    expect(late).not.toHaveBeenCalled();
  });
  it.each(["perform", "alias"])(
    "preserves a caller lookalike thrown from actual authorization during %s",
    async (method) => {
      const f = fixture(),
        lifecycle = await f.open(),
        facet = lifecycle.readFor({ kind: "anonymous" }),
        fault = new ReadSequenceEntryError("not-accepting", "owner");
      await execute(f, sequence([create("a")]));
      f.state.hook = (phase) => {
        if (phase === "read-capture") throw fault;
      };
      await expect(
        promiseCall(() =>
          method === "perform"
            ? facet.perform(resource())
            : facet.resolveAlias(url("alias/current")),
        ),
      ).rejects.toBe(fault);
      f.state.hook = undefined;
      expect(body(await facet.perform(resource())).id).toBe(url("beads/a"));
    },
  );
});

describe("G11 source qualification and private containment", () => {
  it("counts a hidden unowned Link against the same current aggregate seen by Read", async () => {
    const f = fixture(false),
      lifecycle = await f.open(),
      facet = lifecycle.readFor({ kind: "anonymous" });
    await execute(f, sequence([create("a"), create("b")]));
    f.state.configuration = Object.freeze({
      policyIdentity: "hidden-p",
      configurationIdentity: "hidden-c",
      maximumEndpointMultiplicity: Object.freeze([
        { endpoint: "source" as const, linkConformsTo: linkType, max: 1 },
      ]),
    });
    expect(
      await singleton(
        f,
        "createLink",
        { id: "links/hidden", type: linkType, source: "beads/a", target: "beads/b" },
        "hidden_first",
      ),
    ).toMatchObject({ kind: "singleton", disposition: { outcome: "created" } });
    f.state.hidden.add(url("links/hidden"));
    expect(items(await facet.perform({ kind: "collection", collection: "links" }))).toEqual([]);
    expect(
      await singleton(
        f,
        "createLink",
        { id: "links/blocked", type: linkType, source: "beads/a", target: "beads/b" },
        "hidden_second",
      ),
    ).toMatchObject({ kind: "singleton", disposition: { code: "aggregate-constraint-violation" } });
    expect(await facet.perform({ kind: "scope-discovery", scope })).toMatchObject({
      observation: { configurationIdentity: "hidden-c" },
      data: { maximumEndpointMultiplicity: f.state.configuration.maximumEndpointMultiplicity },
    });
    expect(f.state.memberSources.at(-1)).toBe(f.state.configuration);
    expect(f.state.readSources.at(-1)).toBe(f.state.configuration);
  });
  it("holds the common close phase through actual pagination disposal", async () => {
    const f = fixture(),
      { handle } = controlledClosures(f, {}),
      lifecycle = await f.open({ owner: handle, read: f.read }),
      facet = lifecycle.readFor({ kind: "anonymous" });
    const pending: Promise<unknown>[] = [];
    f.state.hook = (phase) => {
      if (phase === "read-disposal") pending.push(reentry(lifecycle, facet, "coordinator"));
    };
    await lifecycle.close();
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
  });
  it("exposes only frozen lifecycle/facet handles and preserves the package public export map", async () => {
    const f = fixture(),
      actual = planeModule.createAuthorityReadPlane;
    let privatePlane: AuthorityReadPlane | undefined;
    vi.spyOn(planeModule, "createAuthorityReadPlane").mockImplementation((options) => {
      privatePlane = actual(options);
      return privatePlane;
    });
    const lifecycle = await f.open(),
      facet = lifecycle.readFor({ kind: "anonymous" });
    expect(Object.keys(lifecycle).sort()).toEqual(["close", "closed", "readFor", "submit"]);
    expect(Object.isFrozen(lifecycle)).toBe(true);
    expect(Object.keys(facet).sort()).toEqual(["perform", "resolveAlias"]);
    expect(Object.isFrozen(facet)).toBe(true);
    expect(privatePlane).not.toHaveProperty("inspectLifecycle");
    expect(facet).not.toHaveProperty("entry");
    expect(lifecycle).not.toHaveProperty("owner");
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { exports: unknown };
    expect(manifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    });
  });
});
