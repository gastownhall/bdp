import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  parseCanonicalScope,
  parseTypeDescriptor,
  prepareReadUpdateSingleton,
  readProblem,
  stringifyJsonValue,
  type AbsoluteHttpUrl,
  type MaximumEndpointMultiplicityPolicy,
  type ReadRequest,
  type ReadUpdateOperation,
  type TypeDescriptor,
} from "@bdp/protocol";
import {
  createAuthorityReadPlane,
  AuthorityReadError,
  type AuthorityReadOptions,
  type AuthorityReadPlane,
  type ReadIntent,
  type ReadPrincipal,
  type ScopeReadConfiguration,
  type ReadObservation,
  type ResourceReadObservation,
} from "./authority-read.js";
import { runMember, type MemberExecutorOptions, type MemberTurn } from "./member-executor.js";
import {
  openRecoveryStore,
  RecoveryStoreError,
  type RecoveryStore,
  type StoredResource,
  type StoreReader,
} from "./recovery-store.js";
import { ScopeServerClosedError, ScopeServerOperationAbortedError } from "./read-request.js";
import * as paginationModule from "./read-pagination.js";
import * as protocolModule from "@bdp/protocol";
import { ReadPaginationError } from "./read-pagination.js";
import { SequenceLifecycleError } from "./sequence-executor.js";

const scope = parseCanonicalScope("https://authority-read.test/s/");
const beadType = "https://types.test/bead",
  linkType = "https://types.test/link",
  day = 86_400_000;
const principal = Object.freeze({ id: "alice" });
const url = (relative: string) => new URL(relative, scope).href as AbsoluteHttpUrl;
const roots: string[] = [],
  stores: RecoveryStore[] = [],
  planes: AuthorityReadPlane[] = [];
afterEach(async () => {
  await Promise.allSettled(planes.splice(0).map((plane) => plane.close()));
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function descriptor(id = beadType, extra: Record<string, unknown> = {}): TypeDescriptor {
  return parseTypeDescriptor({ id, name: id, describes: "bead", conformsTo: [], ...extra });
}
function edgeDescriptor(id = linkType, extra: Record<string, unknown> = {}): TypeDescriptor {
  return parseTypeDescriptor({
    id,
    name: id,
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [beadType], external: "opaque" },
    target: { conformsTo: [beadType], external: "opaque" },
    ...extra,
  });
}
const readerNames = [
  "resource",
  "resources",
  "incidentLinks",
  "outgoingLinks",
  "alias",
  "identityWasCommitted",
  "installedType",
  "policy",
  "key",
] as const;
/** Fresh never-transferred component store; this adapter is not an S5 withRead bridge. */
function fixture(descriptors = [descriptor(), edgeDescriptor()]) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-authority-read-"));
  roots.push(directory);
  const installed = new Map(
    descriptors.map((d) => [d.id, { descriptor: d, bytes: stringifyJsonValue(d) }]),
  );
  const store = openRecoveryStore({
    directory,
    scope,
    installationId: "component-test",
    lineageId: "explicit-fresh-population",
    minimumRetentionMs: day,
    create: { types: Object.fromEntries([...installed].map(([id, value]) => [id, value.bytes])) },
  });
  stores.push(store);
  const state = {
    now: 1_700_000_000_000,
    pageNow: 1_000,
    token: 0,
    entries: 0,
    reads: 0,
    captures: 0,
    configurations: 0,
    view: "view-1",
    epoch: "epoch-1",
    hidden: new Set<string>(),
    hiddenTypes: new Set<string>(),
    calls: Object.fromEntries(readerNames.map((name) => [name, 0])) as Record<
      (typeof readerNames)[number],
      number
    >,
    facades: [] as StoreReader[],
    intents: [] as ReadIntent[],
    principals: [] as ReadPrincipal[],
    memberConfigurations: [] as unknown[],
    configuration: Object.freeze({
      policyIdentity: "policy-1",
      configurationIdentity: "configuration-1",
      maximumEndpointMultiplicity: Object.freeze(
        [],
      ) as readonly MaximumEndpointMultiplicityPolicy[],
    }) as ScopeReadConfiguration,
    gate: undefined as ReturnType<typeof readProblem> | undefined,
    captureHook: undefined as
      | ((r: StoreReader, p: ReadPrincipal, intent: ReadIntent) => void)
      | undefined,
    wrap: (reader: StoreReader): StoreReader => reader,
  };
  const actualRead = store.read.bind(store);
  vi.spyOn(store, "read").mockImplementation((callback) => {
    state.reads++;
    return actualRead(callback);
  });
  const source = {
    capture(reader: StoreReader) {
      expect(this).toBe(source);
      reader.policy("fixture-policy");
      state.configurations++;
      return state.configuration;
    },
  };
  const memberClock = vi.fn(function (this: unknown) {
    expect(this).toBeUndefined();
    return state.now++;
  });
  const member: MemberExecutorOptions = {
    scope,
    limits: {},
    retentionMs: day,
    minimumRetentionMs: day,
    clock: memberClock,
    numericBudget: {
      diagnostic: ({ pointer }) => ({ message: "number", instanceLocation: pointer }),
    },
    contracts: {
      get(id, bytes) {
        const found = installed.get(id as AbsoluteHttpUrl);
        return found?.bytes === bytes ? { descriptor: found.descriptor } : undefined;
      },
    },
    captureMemberContext(reader) {
      const configuration = source.capture(reader);
      state.memberConfigurations.push(configuration);
      const hidden = new Set(state.hidden);
      return {
        ...configuration,
        recordChangeContext: true,
        policy: {
          canRead: (r) => !hidden.has(r.id),
          canCreate: () => true,
          canWrite: () => true,
          canWriteBead: () => true,
        },
      };
    },
  };
  const options: AuthorityReadOptions = {
    entry: {
      scope,
      withRead(callback) {
        state.entries++;
        const value = store.read((reader) => {
          const counted = Object.fromEntries(
            readerNames.map((name) => [
              name,
              (...args: unknown[]) => {
                state.calls[name]++;
                return Reflect.apply(reader[name], reader, args);
              },
            ]),
          ) as unknown as StoreReader;
          const wrapped = state.wrap(counted);
          state.facades.push(wrapped);
          return callback(wrapped);
        });
        return { kind: "read", value };
      },
    },
    scopeEpoch: "epoch-1",
    scopeConfiguration: source,
    installedTypes: descriptors,
    selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
    pagination: {
      scope,
      defaultPageItems: 2,
      maxPageItems: 10,
      cursorTtlMs: 1_000,
      retainedStateCapacity: 100,
      maxRetainedCursorPositionsPerSnapshot: 20,
      retainedSnapshotByteCapacity: 4_000_000,
      retainedSnapshotNodeCapacity: 200_000,
      maxOpaqueTokenLength: 40,
      tokenGenerationAttempts: 3,
      idleCleanup: "on-demand",
      clock: () => state.pageNow,
      generateOpaqueToken: () => `token_${++state.token}`,
    },
    advertisedLimits: {
      page: { defaultItems: 2, maximumItems: 10 },
      selector: { bytes: 4096, depth: 32, nodes: 256 },
      cursorTtlMilliseconds: 1_000,
    },
    captureReadAuthorization(reader, p, intent) {
      expect(this).toBe(options);
      expect(reader).toBe(state.facades.at(-1));
      state.captures++;
      state.intents.push(intent);
      state.principals.push(p);
      state.captureHook?.(reader, p, intent);
      if (state.gate) return { kind: "problem", problem: state.gate };
      const hidden = new Set(state.hidden),
        hiddenTypes = new Set(state.hiddenTypes);
      const policy = {
        canRead(r: { id: string }) {
          expect(this).toBe(policy);
          return !hidden.has(r.id);
        },
      };
      const authorization = {
        authorizationView: state.view,
        scopeEpoch: state.epoch,
        policy,
        canReadType(d: TypeDescriptor) {
          expect(this).toBe(authorization);
          return !hiddenTypes.has(d.id);
        },
      };
      return { kind: "authorized", authorization };
    },
  };
  function open(patch: Partial<AuthorityReadOptions> = {}) {
    const selected = { ...options, ...patch };
    if (!patch.captureReadAuthorization)
      selected.captureReadAuthorization = options.captureReadAuthorization.bind(options);
    const plane = createAuthorityReadPlane(selected);
    planes.push(plane);
    return plane;
  }
  function write(operation: ReadUpdateOperation, input: unknown, key: string): MemberTurn {
    const carrier = prepareReadUpdateSingleton(
      scope,
      operation,
      typeof input === "string" ? input : stringifyJsonValue(input),
      key,
    );
    const admission = store.admit(principal.id, carrier.keys);
    try {
      return runMember(
        store,
        admission,
        principal,
        carrier,
        0,
        () => {
          throw Error("unexpected creator lookup");
        },
        member,
      );
    } finally {
      store.abandonAttempt(admission);
    }
  }
  function resource(relative: string) {
    const row = store.read((reader) => reader.resource(relative));
    if (!row) throw Error(`missing fixture ${relative}`);
    return JSON.parse(row.bodyJson) as Record<string, unknown>;
  }
  function createBead(id: string, properties: unknown = {}, type = beadType) {
    const turn = write("createBead", { id: `beads/${id}`, type, properties }, `bead_${id}`);
    expect(turn.disposition).toMatchObject({ outcome: "created" });
    return turn;
  }
  function createLink(
    id: string,
    sourceId = "beads/a",
    target: unknown = "beads/b",
    type = linkType,
  ) {
    const turn = write(
      "createLink",
      { id: `links/${id}`, type, source: sourceId, target },
      `link_${id}`,
    );
    expect(turn.disposition).toMatchObject({ outcome: "created" });
    return turn;
  }
  function reset() {
    state.entries = state.reads = state.captures = state.configurations = 0;
    for (const key of readerNames) state.calls[key] = 0;
    state.facades.length = state.intents.length = state.principals.length = 0;
    memberClock.mockClear();
  }
  function replaceMaximum(max: number) {
    const count = store.read(
      (r) =>
        r
          .outgoingLinks("beads/a")
          .filter((row) => (JSON.parse(row.bodyJson) as { type: string }).type === linkType).length,
    );
    if (count > max) throw Error("fixture replacement would violate current graph");
    state.configuration = Object.freeze({
      policyIdentity: `policy-${max}`,
      configurationIdentity: `configuration-${max}`,
      maximumEndpointMultiplicity: Object.freeze([
        Object.freeze({ endpoint: "source" as const, linkConformsTo: linkType, max }),
      ]),
    });
    state.view = `view-max-${max}`;
  }
  return {
    store,
    actualRead,
    state,
    source,
    options,
    member,
    memberClock,
    open,
    write,
    resource,
    createBead,
    createLink,
    reset,
    replaceMaximum,
  };
}
function resourceRequest(id = "a"): ReadRequest {
  return { kind: "resource", resource: "bead", id: url(`beads/${id}`) };
}
function body(result: unknown): Record<string, unknown> {
  expect(result).toMatchObject({ kind: "success" });
  return (result as { body: Record<string, unknown> }).body;
}
function items(result: unknown): Record<string, unknown>[] {
  return body(result).items as Record<string, unknown>[];
}
function observation(result: unknown): Record<string, unknown> {
  return (result as { observation: Record<string, unknown> }).observation;
}
function baseObservation(f: ReturnType<typeof fixture>) {
  return {
    authorizationView: f.state.view,
    scopeEpoch: f.state.epoch,
    policyIdentity: f.state.configuration.policyIdentity,
    configurationIdentity: f.state.configuration.configurationIdentity,
  };
}
function expectProblem(result: unknown, code: string, phase = "observed") {
  expect(result).toMatchObject({ kind: "problem", phase, problem: { code } });
  expect(Object.keys(result as object).sort()).toEqual(
    (phase === "observed"
      ? ["kind", "phase", "problem", "observation"]
      : ["kind", "phase", "problem"]
    ).sort(),
  );
  if (phase === "observed") expect(observation(result)).not.toHaveProperty("resourceRevision");
}
function noSyncThrow(call: () => Promise<unknown>): Promise<unknown> {
  let returned: Promise<unknown> | undefined;
  expect(() => {
    returned = call();
  }).not.toThrow();
  expect(returned).toBeInstanceOf(Promise);
  if (!returned) throw Error("call did not return a Promise");
  return returned;
}

describe("G1 strict receiving and G2 same-entry observations", () => {
  it.each(["accessor", "inherited", "proxy", "extra", "symbol", "array"])(
    "rejects %s input without callbacks or receiving side effects and returns a Promise",
    async (kind) => {
      const f = fixture();
      const facet = f.open().readFor({ kind: "authenticated", principal });
      let effects = 0;
      let request: unknown = resourceRequest();
      if (kind === "accessor")
        request = {
          kind: "resource",
          resource: "bead",
          get id() {
            effects++;
            return url("beads/a");
          },
        };
      if (kind === "inherited") request = Object.create(resourceRequest());
      if (kind === "proxy")
        request = new Proxy(resourceRequest(), {
          ownKeys(t) {
            effects++;
            return Reflect.ownKeys(t);
          },
          get(t, key) {
            effects++;
            return Reflect.get(t, key);
          },
        });
      if (kind === "extra") request = { ...resourceRequest(), extra: true };
      if (kind === "symbol") request = { ...resourceRequest(), [Symbol("extra")]: true };
      if (kind === "array") request = [];
      await expect(noSyncThrow(() => facet.perform(request as ReadRequest))).rejects.toBeInstanceOf(
        Error,
      );
      expect(effects).toBe(0);
      expect(f.state.entries).toBe(0);
      expect(f.state.captures).toBe(0);
    },
  );
  it("snapshots a legal original before provider replacement and rejects changed original principal", async () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    const p = { id: "alice" },
      request = { kind: "resource" as const, resource: "bead" as const, id: url("beads/a") };
    const facet = f.open().readFor({ kind: "authenticated", principal: p });
    f.state.captureHook = (_r, _p, intent) => {
      expect(Object.isFrozen(intent)).toBe(true);
      request.id = url("beads/b");
    };
    expect(body(await facet.perform(request)).id).toBe(url("beads/a"));
    expect(Object.isFrozen(p)).toBe(false);
    p.id = "other";
    f.reset();
    await expect(noSyncThrow(() => facet.perform(resourceRequest()))).rejects.toBeInstanceOf(Error);
    expect(f.state.entries).toBe(0);
  });
  it.each(["resource", "properties"] as const)(
    "settles %s R1 with same-root revision before real R2 and await",
    async (kind) => {
      const f = fixture();
      f.createBead("a", { revision: "domain-authored", n: 1 });
      const expected = f.resource("beads/a"),
        r1 = expected.revision;
      expect(r1).not.toBe("domain-authored");
      const facet = f.open().readFor({ kind: "authenticated", principal });
      f.reset();
      const firstObservation = { ...baseObservation(f), resourceRevision: r1 };
      const pending = facet.perform({ kind, resource: "bead", id: url("beads/a") });
      expect([f.state.entries, f.state.reads, f.state.captures, f.state.configurations]).toEqual([
        1, 1, 1, 1,
      ]);
      expect(f.state.calls.resources).toBe(0);
      expect(f.state.calls.resource).toBeGreaterThan(0);
      const escaped = f.state.facades[0];
      expect(() => escaped?.resource("beads/a")).toThrow(/expired/);
      const update = f.write(
        "updateBeadProperties",
        { bead: "beads/a", change: [{ op: "replace", path: "/n", value: 2 }] },
        "r2",
      );
      expect(update.disposition).toMatchObject({ outcome: "updated" });
      const next = f.resource("beads/a");
      expect(next.revision).not.toBe(r1);
      f.state.configuration = Object.freeze({
        ...f.state.configuration,
        configurationIdentity: "configuration-r2",
      });
      f.state.view = "view-r2";
      const result = await pending;
      expect(body(result)).toEqual(kind === "resource" ? expected : expected.properties);
      expect(observation(result)).toEqual(firstObservation);
      expect(Object.keys(result).sort()).toEqual(["body", "kind", "observation"]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(body(result))).toBe(true);
      const current = await facet.perform({ kind, resource: "bead", id: url("beads/a") });
      expect(observation(current)).toEqual({
        ...baseObservation(f),
        resourceRevision: next.revision,
      });
    },
  );
  it("routes all variants through one capture with selective graph access and base-only nonresource metadata", async () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    f.createLink("edge");
    f.write("putAlias", { alias: "alias/current", target: "beads/a" }, "alias");
    const facet = f.open().readFor({ kind: "anonymous" });
    const cases: [ReadRequest, boolean, boolean][] = [
      [{ kind: "scope-discovery", scope }, false, false],
      [{ kind: "resource", resource: "type", id: beadType as AbsoluteHttpUrl }, false, false],
      [{ kind: "collection", collection: "types" }, false, false],
      [{ kind: "collection", collection: "beads" }, true, false],
      [{ kind: "collection", collection: "links" }, true, false],
      [{ kind: "bead-links", bead: url("beads/a") }, false, false],
      [{ kind: "resource", resource: "link", id: url("links/edge") }, false, true],
      [{ kind: "properties", resource: "link", id: url("links/edge") }, false, true],
    ];
    for (const [request, scan, revision] of cases) {
      f.reset();
      const pending = facet.perform(request);
      expect([f.state.entries, f.state.reads, f.state.captures, f.state.configurations]).toEqual([
        1, 1, 1, 1,
      ]);
      const result = await pending;
      expect(f.state.calls.resources > 0).toBe(scan);
      expect(Object.hasOwn(observation(result), "resourceRevision")).toBe(revision);
      expect(observation(result)).toMatchObject(baseObservation(f));
      expect(f.state.principals).toEqual([{ kind: "anonymous" }]);
    }
    f.reset();
    const alias = await facet.resolveAlias(url("alias/current"));
    expect(alias).toEqual({
      kind: "target",
      target: url("beads/a"),
      observation: baseObservation(f),
    });
    expect(f.state.calls.alias).toBe(1);
    expect(f.state.calls.resources).toBe(0);
  });
  it("distinguishes pre-context gate/validation from observed refusal and tests genuine nested S6 rejection", async () => {
    const f = fixture();
    const facet = f.open().readFor({ kind: "authenticated", principal });
    f.state.gate = readProblem("forbidden");
    expectProblem(await facet.perform(resourceRequest()), "forbidden", "pre-context");
    expect(f.state.configurations).toBe(0);
    expect(f.state.calls.resource).toBe(0);
    f.state.gate = undefined;
    f.reset();
    expectProblem(await facet.perform(resourceRequest()), "resource-not-found");
    expect(f.state.configurations).toBe(1);
    const invalid = await facet.perform({
      kind: "resource",
      resource: "bead",
      id: "https://foreign.test/beads/a" as AbsoluteHttpUrl,
    });
    expectProblem(invalid, "invalid-parameter", "pre-context");
    f.state.captureHook = () => {
      expect(() => f.store.read(() => 1)).toThrow(RecoveryStoreError);
      expect(() => f.write("createBead", { type: beadType }, "nested")).toThrow(RecoveryStoreError);
    };
    expectProblem(await facet.perform(resourceRequest()), "resource-not-found");
  });
});

describe("G3 current values and qualified Type construction", () => {
  it("reads actual create/update/noop/delete with exact record/properties metadata and no tombstone resurrection", async () => {
    const f = fixture();
    f.createBead("a", { n: 1 });
    const facet = f.open().readFor({ kind: "authenticated", principal });
    const original = f.resource("beads/a");
    expect(body(await facet.perform(resourceRequest()))).toEqual(original);
    f.write(
      "updateBeadProperties",
      { bead: "beads/a", change: [{ op: "replace", path: "/n", value: 2 }] },
      "update",
    );
    const changed = f.resource("beads/a");
    expect(changed.revision).not.toBe(original.revision);
    expect(body(await facet.perform(resourceRequest()))).toEqual(changed);
    f.write(
      "updateBeadProperties",
      { bead: "beads/a", change: [{ op: "replace", path: "/n", value: 2 }] },
      "noop",
    );
    expect(f.resource("beads/a")).toEqual(changed);
    f.write("deleteBead", { bead: "beads/a" }, "delete");
    expect(f.store.read((r) => r.identityWasCommitted("beads/a"))).toBe(true);
    expectProblem(await facet.perform(resourceRequest()), "resource-not-found");
    expectProblem(
      await facet.perform({ kind: "properties", resource: "bead", id: url("beads/a") }),
      "resource-not-found",
    );
  });
  it.each(["duplicate", "missing-parent", "cycle", "cross-kind"])(
    "rejects %s installed closure locally",
    (kind) => {
      const f = fixture();
      let descriptors: TypeDescriptor[];
      if (kind === "duplicate") descriptors = [descriptor(), descriptor()];
      else if (kind === "missing-parent")
        descriptors = [descriptor(beadType, { conformsTo: ["https://types.test/absent"] })];
      else if (kind === "cycle")
        descriptors = [
          descriptor(beadType, { conformsTo: ["https://types.test/other"] }),
          descriptor("https://types.test/other", { conformsTo: [beadType] }),
        ];
      else descriptors = [descriptor(beadType, { conformsTo: [linkType] }), edgeDescriptor()];
      expect(() => f.open({ installedTypes: descriptors })).toThrow();
      expect(f.state.entries).toBe(0);
    },
  );
  it.each(["scope", "idle-missing", "idle-invalid", "page", "selector", "ttl"])(
    "rejects authority %s mismatch before S6",
    (kind) => {
      const f = fixture();
      const pagination = { ...f.options.pagination };
      const advertisedLimits = { ...f.options.advertisedLimits };
      if (kind === "scope") pagination.scope = "https://other.test/s/";
      if (kind === "idle-missing") Reflect.deleteProperty(pagination, "idleCleanup");
      if (kind === "idle-invalid") Object.assign(pagination, { idleCleanup: "later" });
      if (kind === "page") advertisedLimits.page = { defaultItems: 3, maximumItems: 10 };
      if (kind === "selector") advertisedLimits.selector = { bytes: 1, depth: 32, nodes: 256 };
      if (kind === "ttl") advertisedLimits.cursorTtlMilliseconds = 2_000;
      expect(() => f.open({ pagination, advertisedLimits })).toThrow();
      expect(f.state.reads).toBe(0);
    },
  );
  it.each(["view", "epoch", "policy", "configuration"])(
    "rejects invalid captured %s as local authority error",
    async (kind) => {
      const f = fixture();
      const facet = f.open().readFor({ kind: "anonymous" });
      if (kind === "view") f.state.view = " \t";
      if (kind === "epoch") f.state.epoch = "other-principal-epoch";
      if (kind === "policy")
        f.state.configuration = { ...f.state.configuration, policyIdentity: " " };
      if (kind === "configuration")
        f.state.configuration = { ...f.state.configuration, configurationIdentity: " " };
      await expect(facet.perform({ kind: "scope-discovery", scope })).rejects.toBeInstanceOf(Error);
      expect(f.state.calls.resources).toBe(0);
      expect(f.state.calls.resource).toBe(0);
    },
  );
});

const ownedDescriptors = () => [
  descriptor(beadType, { ownsOutgoing: { [linkType]: { max: 10 } } }),
  edgeDescriptor(),
];
describe("G4 complete current ownership and observed integrity", () => {
  it("reads real owned create/update/noop/delete, source versions and complete inline agreement", async () => {
    const f = fixture(ownedDescriptors());
    f.createBead("a");
    f.createBead("b");
    const target = f.resource("beads/b");
    const facet = f.open().readFor({ kind: "authenticated", principal });
    expect(f.resource("beads/a").ownedLinks).toEqual({ [linkType]: [] });
    f.createLink("z");
    f.createLink("a");
    const source = body(await facet.perform(resourceRequest()));
    expect(source.ownedLinks).toEqual({
      [linkType]: [f.resource("links/a"), f.resource("links/z")],
    });
    const beforeLink = f.resource("links/a");
    const changed = f.write(
      "updateLinkProperties",
      { link: "links/a", change: [{ op: "add", path: "/n", value: 1 }] },
      "edge_update",
    );
    expect(changed.disposition).toMatchObject({ outcome: "updated", source: url("beads/a") });
    const after = body(await facet.perform(resourceRequest()));
    expect(after.revision).not.toBe(source.revision);
    expect(after.ownedLinks).toEqual({
      [linkType]: [f.resource("links/a"), f.resource("links/z")],
    });
    expect(f.resource("links/a").revision).not.toBe(beforeLink.revision);
    expect(after.changeContext).toEqual(f.resource("links/a").changeContext);
    expect(source.ownedLinks).toEqual({ [linkType]: [beforeLink, f.resource("links/z")] });
    f.write(
      "updateLinkProperties",
      { link: "links/a", change: [{ op: "replace", path: "/n", value: 1 }] },
      "edge_noop",
    );
    expect(body(await facet.perform(resourceRequest()))).toEqual(after);
    f.write("deleteLink", { link: "links/a" }, "edge_delete_a");
    f.write("deleteLink", { link: "links/z" }, "edge_delete_z");
    const empty = body(await facet.perform(resourceRequest()));
    expect(empty.ownedLinks).toEqual({ [linkType]: [] });
    expect(empty.revision).not.toBe(after.revision);
    expect(f.resource("beads/b")).toEqual(target);
    expectProblem(
      await facet.perform({ kind: "resource", resource: "link", id: url("links/a") }),
      "resource-not-found",
    );
  });
  it("preserves explicit/wildcard groups, cycles and a self-loop without duplicate incident entries", async () => {
    const other = "https://types.test/other";
    const f = fixture([
      descriptor(beadType, { ownsOutgoing: { [linkType]: { max: 5 }, "*": { max: 6 } } }),
      edgeDescriptor(),
      edgeDescriptor(other),
    ]);
    f.createBead("a");
    f.createBead("b");
    f.createLink("self", "beads/a", "beads/a");
    f.createLink("ab");
    f.createLink("ba", "beads/b", "beads/a", other);
    const facet = f.open().readFor({ kind: "authenticated", principal });
    const a = body(await facet.perform(resourceRequest()));
    expect(a).toEqual(f.resource("beads/a"));
    expect(Object.keys(a.ownedLinks as object)).not.toContain("*");
    const incident = await facet.perform({ kind: "bead-links", bead: url("beads/a"), limit: 10 });
    expect(items(incident).map((r) => r.id)).toEqual([
      url("links/ab"),
      url("links/ba"),
      url("links/self"),
    ]);
  });
  it.each(["link", "endpoint"])(
    "withholds the entire owned root/properties/alias for hidden %s",
    async (kind) => {
      const f = fixture(ownedDescriptors());
      f.createBead("a");
      f.createBead("b");
      f.createLink("edge");
      f.write("putAlias", { alias: "alias/current", target: "beads/a" }, "alias");
      f.state.hidden.add(kind === "link" ? url("links/edge") : url("beads/b"));
      const facet = f.open().readFor({ kind: "authenticated", principal });
      expectProblem(await facet.perform(resourceRequest()), "resource-not-found");
      expectProblem(
        await facet.perform({ kind: "properties", resource: "bead", id: url("beads/a") }),
        "resource-not-found",
      );
      expectProblem(await facet.resolveAlias(url("alias/current")), "resource-not-found");
    },
  );
  it("filters unowned hidden incident candidates while preserving visible anchor and opaque/pinned endpoints", async () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    f.createLink("hidden");
    f.createLink("opaque", "beads/a", "urn:opaque:outside");
    f.createLink("pinned", "beads/a", { uri: "beads/b", revision: "provenance-only" });
    f.state.hidden.add(url("links/hidden"));
    const facet = f.open().readFor({ kind: "authenticated", principal });
    expect(body(await facet.perform(resourceRequest())).id).toBe(url("beads/a"));
    const result = await facet.perform({ kind: "bead-links", bead: url("beads/a"), limit: 10 });
    expect(items(result).map((r) => r.id)).toEqual([url("links/opaque"), url("links/pinned")]);
    expect(items(result)[1]?.target).toEqual({ uri: url("beads/b"), revision: "provenance-only" });
    f.state.hidden.add(url("beads/b"));
    expect(
      items(await facet.perform({ kind: "bead-links", bead: url("beads/a") })).map((r) => r.id),
    ).toEqual([url("links/opaque")]);
  });
  it.each([
    "requested-id",
    "body-id",
    "kind",
    "local-index",
    "opaque-index",
    "pinned-index",
    "nonincident",
  ])("rejects a labeled %s reader contradiction without changing genuine rows", async (fault) => {
    const f = fixture();
    for (const id of ["a", "b", "c", "d"]) f.createBead(id);
    f.createLink(
      "edge",
      "beads/a",
      fault === "opaque-index" ? "urn:opaque:outside" : { uri: "beads/b", revision: "pin" },
    );
    f.createLink("other", "beads/c", "beads/d");
    const before = f.store.read((r) => r.resources());
    f.state.wrap = (reader) => ({
      ...reader,
      resource(id) {
        const row = reader.resource(id);
        if (!row || id !== "links/edge") return row;
        if (fault === "requested-id") return { ...row, id: "links/other" };
        if (fault === "body-id")
          return {
            ...row,
            bodyJson: stringifyJsonValue({ ...JSON.parse(row.bodyJson), id: url("links/other") }),
          };
        if (fault === "kind") return { id: row.id, kind: "bead", bodyJson: row.bodyJson };
        if (["local-index", "opaque-index", "pinned-index"].includes(fault))
          return {
            ...row,
            kind: "link",
            source: "beads/a",
            target: fault === "opaque-index" ? "urn:opaque:different" : "beads/c",
          };
        return row;
      },
      incidentLinks(id) {
        const rows = reader.incidentLinks(id);
        return fault === "nonincident"
          ? [...rows, reader.resource("links/other") as StoredResource]
          : rows;
      },
    });
    const facet = f.open().readFor({ kind: "anonymous" });
    await expect(
      facet.perform(
        fault === "nonincident"
          ? { kind: "bead-links", bead: url("beads/a") }
          : { kind: "resource", resource: "link", id: url("links/edge") },
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(f.store.read((r) => r.resources())).toEqual(before);
  });
  it.each(["missing", "revision", "properties", "attribution", "context", "pin"])(
    "rejects complete inline/first-class %s disagreement",
    async (fault) => {
      const f = fixture(ownedDescriptors());
      f.createBead("a");
      f.createBead("b");
      f.createLink("edge", "beads/a", { uri: "beads/b", revision: "pin" });
      f.state.wrap = (reader) => ({
        ...reader,
        resource(id) {
          const row = reader.resource(id);
          if (!row || id !== "links/edge") return row;
          if (fault === "missing") return undefined;
          const value = JSON.parse(row.bodyJson);
          if (fault === "revision") value.revision = "different";
          if (fault === "properties") value.properties = { extra: 1 };
          if (fault === "attribution")
            value.attribution = { principal: "urn:test:different", status: "unknown" };
          if (fault === "context")
            value.changeContext.committedAt.value = "2001-01-01T00:00:00.000Z";
          if (fault === "pin") value.target.revision = "other-pin";
          return { ...row, bodyJson: stringifyJsonValue(value) };
        },
      });
      await expect(
        f.open().readFor({ kind: "anonymous" }).perform(resourceRequest()),
      ).rejects.toBeInstanceOf(Error);
    },
  );
  it("accepts semantic object-key reorder and distinguishes missing distinct endpoint nonvisibility", async () => {
    const f = fixture(ownedDescriptors());
    f.createBead("a");
    f.createBead("b");
    f.createLink("edge");
    f.state.wrap = (reader) => ({
      ...reader,
      resource(id) {
        const row = reader.resource(id);
        if (!row || id !== "links/edge") return row;
        return {
          ...row,
          bodyJson: stringifyJsonValue(
            Object.fromEntries(Object.entries(JSON.parse(row.bodyJson)).reverse()),
          ),
        };
      },
    });
    const facet = f.open().readFor({ kind: "anonymous" });
    expect(body(await facet.perform(resourceRequest()))).toEqual(f.resource("beads/a"));
    f.state.wrap = (reader) => ({
      ...reader,
      resource(id) {
        const row = reader.resource(id);
        return id === "beads/b" ? undefined : row;
      },
    });
    expectProblem(await facet.perform(resourceRequest()), "resource-not-found");
  });
});

describe("G5 complete predicates, hidden Type ancestry and independent sorting", () => {
  it("uses hidden full conformance chain for visible Resource predicates while withholding descriptor bodies", async () => {
    const h = "https://types.test/h",
      i = "https://types.test/i",
      a = "https://types.test/a",
      c = "https://types.test/c";
    const f = fixture([
      descriptor(a, { conformsTo: [i] }),
      descriptor(c),
      descriptor(i, { conformsTo: [h] }),
      descriptor(h),
    ]);
    f.createBead("b", {}, a);
    f.createBead("c", {}, c);
    f.state.hiddenTypes = new Set([a, i, h]);
    const facet = f.open().readFor({ kind: "anonymous" });
    for (const [type, conformsTo, expected] of [
      [a, undefined, [url("beads/b")]],
      [undefined, h, [url("beads/b")]],
      [a, h, [url("beads/b")]],
      [c, h, []],
      [a, c, []],
    ] as const) {
      const result = await facet.perform({
        kind: "collection",
        collection: "beads",
        ...(type ? { type: type as AbsoluteHttpUrl } : {}),
        ...(conformsTo ? { conformsTo: conformsTo as AbsoluteHttpUrl } : {}),
      });
      expect(items(result).map((r) => r.id)).toEqual(expected);
    }
    for (const id of [a, i, h])
      expectProblem(
        await facet.perform({ kind: "resource", resource: "type", id: id as AbsoluteHttpUrl }),
        "resource-not-found",
      );
    expect(
      items(await facet.perform({ kind: "collection", collection: "types" })).map((r) => r.id),
    ).toEqual([c]);
    f.state.gate = readProblem("forbidden");
    f.reset();
    expectProblem(
      await facet.perform({
        kind: "collection",
        collection: "beads",
        conformsTo: h as AbsoluteHttpUrl,
      }),
      "forbidden",
      "pre-context",
    );
    expect(f.state.calls.resources).toBe(0);
  });
  it.each([false, true])(
    "sorts genuine rows and descriptors before page selection (permuted=%s)",
    async (permuted) => {
      const f = fixture([
        edgeDescriptor(),
        descriptor("https://types.test/z"),
        descriptor(),
        descriptor("https://types.test/a"),
      ]);
      for (const id of ["z", "a", "m"]) f.createBead(id, { keep: id === "z" });
      f.createLink("z", "beads/a", "beads/m");
      f.createLink("a", "beads/m", "beads/a");
      f.createLink("m", "beads/a", "beads/a");
      if (permuted)
        f.state.wrap = (r) => ({
          ...r,
          resources: () => {
            const rows = [...r.resources()];
            const first = rows.shift();
            if (first) rows.push(first);
            return rows;
          },
          incidentLinks: (id) => [...r.incidentLinks(id)].reverse(),
        });
      const facet = f.open().readFor({ kind: "anonymous" });
      for (const collection of ["beads", "links"] as const)
        expect(
          items(await facet.perform({ kind: "collection", collection, limit: 10 })).map(
            (r) => r.id,
          ),
        ).toEqual([url(`${collection}/a`), url(`${collection}/m`), url(`${collection}/z`)]);
      expect(
        items(await facet.perform({ kind: "collection", collection: "types", limit: 10 })).map(
          (r) => r.id,
        ),
      ).toEqual(["https://types.test/a", beadType, linkType, "https://types.test/z"]);
      expect(
        items(await facet.perform({ kind: "bead-links", bead: url("beads/a"), limit: 10 })).map(
          (r) => r.id,
        ),
      ).toEqual([url("links/a"), url("links/m"), url("links/z")]);
      expect(
        items(
          await facet.perform({
            kind: "collection",
            collection: "beads",
            limit: 1,
            selector: "$[?@.properties.keep == true]",
          }),
        ).map((r) => r.id),
      ).toEqual([url("beads/z")]);
      f.state.hidden.add(url("beads/z"));
      expect(
        items(
          await facet.perform({
            kind: "collection",
            collection: "beads",
            limit: 1,
            selector: "$[?@.properties.keep == true]",
          }),
        ),
      ).toEqual([]);
    },
  );
  it("combines Link predicates with AND, endpoint OR, exact pinned/opaque URI and incident directions", async () => {
    const f = fixture();
    for (const id of ["a", "b", "c"]) f.createBead(id);
    f.createLink("ab");
    f.createLink("ba", "beads/b", "beads/a");
    f.createLink("aa", "beads/a", "beads/a");
    f.createLink("ac", "beads/a", { uri: "beads/c", revision: "pin" });
    f.createLink("opaque", "beads/a", "urn:opaque:exact");
    const facet = f.open().readFor({ kind: "anonymous" });
    const linkQuery = { kind: "collection" as const, collection: "links" as const, limit: 10 };
    expect(
      items(
        await facet.perform({
          ...linkQuery,
          source: url("beads/a"),
          target: url("beads/b"),
          endpoint: url("beads/a"),
        }),
      ).map((r) => r.id),
    ).toEqual([url("links/ab")]);
    expect(
      items(
        await facet.perform({
          ...linkQuery,
          source: url("beads/a"),
          target: url("beads/b"),
          endpoint: url("beads/c"),
        }),
      ),
    ).toEqual([]);
    expect(
      items(await facet.perform({ ...linkQuery, target: url("beads/c") })).map((r) => r.id),
    ).toEqual([url("links/ac")]);
    expect(
      items(await facet.perform({ ...linkQuery, endpoint: "urn:opaque:exact" })).map((r) => r.id),
    ).toEqual([url("links/opaque")]);
    expect(items(await facet.perform({ ...linkQuery, endpoint: "urn:opaque:other" }))).toEqual([]);
    for (const [direction, ids] of [
      ["inbound", ["aa", "ba"]],
      ["outbound", ["aa", "ab", "ac", "opaque"]],
      ["both", ["aa", "ab", "ac", "ba", "opaque"]],
    ] as const) {
      expect(
        items(
          await facet.perform({ kind: "bead-links", bead: url("beads/a"), direction, limit: 10 }),
        ).map((r) => r.id),
      ).toEqual(ids.map((id) => url(`links/${id}`)));
    }
  });
});

describe("G6 snapshots across genuine later writes", () => {
  it.each(["beads", "links", "types", "incident"] as const)(
    "continues original %s without current graph/anchor reload",
    async (kind) => {
      const f = fixture();
      for (const id of ["a", "b", "c"]) f.createBead(id);
      f.createLink("a");
      f.createLink("b", "beads/a", "beads/c");
      const facet = f.open().readFor({ kind: "anonymous" });
      const request =
        kind === "incident"
          ? { kind: "bead-links" as const, bead: url("beads/a"), limit: 1 }
          : { kind: "collection" as const, collection: kind, limit: 1 };
      const allRequest = { ...request, limit: 10 };
      const expected = items(await facet.perform(allRequest));
      const first = body(await facet.perform(request));
      expect(first.items).toEqual(expected.slice(0, 1));
      expect(typeof first.next).toBe("string");
      f.write("deleteLink", { link: "links/a" }, "delete_edge_a");
      f.write("deleteLink", { link: "links/b" }, "delete_edge_b");
      f.write("deleteBead", { bead: "beads/a" }, "delete_anchor");
      f.createBead("d");
      const { limit: _limit, ...navigation } = request;
      const continuation = { ...navigation, continuation: first.next as AbsoluteHttpUrl };
      f.reset();
      const second = await facet.perform(continuation);
      expect(items(second)).toEqual(expected.slice(1, 2));
      expect([f.state.entries, f.state.captures, f.state.configurations]).toEqual([1, 1, 1]);
      for (const name of [
        "resource",
        "resources",
        "incidentLinks",
        "outgoingLinks",
        "alias",
        "installedType",
      ] as const)
        expect(f.state.calls[name]).toBe(0);
      expect(await facet.perform(continuation)).toEqual(second);
      if (kind === "incident") expectProblem(await facet.perform(request), "resource-not-found");
      if (kind === "links") expect(items(await facet.perform(allRequest))).toEqual([]);
      if (kind === "beads")
        expect(items(await facet.perform(allRequest)).map((r) => r.id)).toEqual([
          url("beads/b"),
          url("beads/c"),
          url("beads/d"),
        ]);
    },
  );
  it("keeps valid tokens across foreign views/projections and local epoch errors, then expires at original TTL", async () => {
    const f = fixture();
    for (const id of ["a", "b", "c"]) f.createBead(id);
    const plane = f.open(),
      p = plane.readFor({ kind: "authenticated", principal });
    const q = plane.readFor({ kind: "authenticated", principal: Object.freeze({ id: "bob" }) });
    const first = body(await p.perform({ kind: "collection", collection: "beads", limit: 1 }));
    const request = {
      kind: "collection" as const,
      collection: "beads" as const,
      continuation: first.next as AbsoluteHttpUrl,
    };
    // Projection-equivalent principals may share a view and token.
    const equivalent = await q.perform(request);
    expect(items(equivalent)[0]?.id).toBe(url("beads/b"));
    f.state.view = "distinct-view";
    expectProblem(await q.perform(request), "foreign-view");
    f.state.view = "view-1";
    expectProblem(
      await p.perform({
        kind: "collection",
        collection: "links",
        continuation: first.next as AbsoluteHttpUrl,
      }),
      "invalid-parameter",
    );
    f.state.epoch = "changed";
    await expect(p.perform(request)).rejects.toBeInstanceOf(Error);
    f.state.epoch = "epoch-1";
    f.state.pageNow = 1_999;
    expect(await p.perform(request)).toEqual(equivalent);
    f.state.pageNow = 2_000;
    expectProblem(await p.perform(request), "cursor-expired");
    const unknown = new URL(first.next as string);
    unknown.searchParams.set("cursor", "unknown_token");
    expectProblem(
      await p.perform({ ...request, continuation: unknown.href as AbsoluteHttpUrl }),
      "cursor-expired",
    );
  });
});

describe("G7 raw current alias and retained A versus current B", () => {
  const malformed = [
    "",
    "not a URL",
    "urn:alias:current",
    "https://other.test/s/alias/current",
    "https://authority-read.test/other/alias/current",
    `${scope}beads/a`,
    `${scope}alias/`,
    `${scope}alias/current?`,
    `${scope}alias/current?x=1`,
    `${scope}alias/current#`,
    `${scope}alias/current#x`,
    "https://user:pass@authority-read.test/s/alias/current",
    `${scope}alias/a/../current`,
    `${scope}alias/a/%2e%2e/current`,
    `${scope}alias/%63urrent`,
    `${scope}alias/bad%`,
    `${scope}alias/%2f`,
  ];
  it.each(malformed)("gates raw invalid %s into uniform404 without alias lookup", async (input) => {
    const f = fixture();
    const facet = f.open().readFor({ kind: "anonymous" });
    const result = await facet.resolveAlias(input);
    expectProblem(result, "resource-not-found");
    expect(f.state.calls.alias).toBe(0);
    expect(f.state.intents[0]).toEqual({ kind: "alias", url: input });
    f.state.gate = readProblem("forbidden");
    f.reset();
    expectProblem(await facet.resolveAlias(input), "forbidden", "pre-context");
    expect(f.state.calls.alias).toBe(0);
    expect(f.state.configurations).toBe(0);
  });
  it.each([undefined, null, 1, {}, new String("x")])(
    "rejects nonprimitive alias receiving %s before gate",
    async (input) => {
      const f = fixture();
      const facet = f.open().readFor({ kind: "anonymous" });
      await expect(noSyncThrow(() => facet.resolveAlias(input as string))).rejects.toBeInstanceOf(
        Error,
      );
      expect(f.state.entries).toBe(0);
    },
  );
  it("performs actual nested suffix put/repoint/delete/reuse/target deletion and detects corrupt stored target", async () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    const facet = f.open().readFor({ kind: "anonymous" });
    const alias = url("alias/alias/latest");
    f.write("putAlias", { alias: "alias/alias/latest", target: "beads/a" }, "put");
    expect(f.store.read((r) => r.alias("alias/latest"))).toBe("beads/a");
    expect(await facet.resolveAlias(alias)).toMatchObject({
      kind: "target",
      target: url("beads/a"),
    });
    f.write("putAlias", { alias, target: "beads/b" }, "repoint");
    expect(await facet.resolveAlias(alias)).toMatchObject({
      kind: "target",
      target: url("beads/b"),
    });
    f.write("deleteAlias", { alias }, "delete_alias");
    expectProblem(await facet.resolveAlias(alias), "resource-not-found");
    f.write("putAlias", { alias, target: "beads/b" }, "reuse_alias");
    f.write("deleteBead", { bead: "beads/b" }, "delete_target");
    expectProblem(await facet.resolveAlias(alias), "resource-not-found");
    expect(f.store.read((r) => r.alias("alias/latest"))).toBe("beads/b");
    f.state.wrap = (r) => ({
      ...r,
      alias(suffix) {
        r.alias(suffix);
        return "links/wrong-kind";
      },
    });
    await expect(facet.resolveAlias(alias)).rejects.toBeInstanceOf(Error);
  });
  it("separates actual retained A identity/disclosure from current alias B with no replay lookup or renewal", async () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    f.write("putAlias", { alias: "alias/current", target: "beads/a" }, "put_alias");
    const input = { type: linkType, source: "alias/current", target: "alias/current" };
    const made = f.write("createLink", input, "captured");
    expect(made.disposition).toMatchObject({
      outcome: "created",
      resource: { source: url("beads/a"), target: url("beads/a") },
    });
    const before = f.store.read((r) => r.key(principal.id, "captured"));
    expect(before.kind).toBe("retained");
    f.write("putAlias", { alias: "alias/current", target: "beads/b" }, "repoint_alias");
    const facet = f.open().readFor({ kind: "authenticated", principal });
    expect(await facet.resolveAlias(url("alias/current"))).toMatchObject({
      kind: "target",
      target: url("beads/b"),
    });
    const originalRead = f.actualRead;
    let lookups = 0;
    const spy = vi.spyOn(f.store, "read").mockImplementation((callback) =>
      originalRead((r) =>
        callback({
          ...r,
          alias() {
            lookups++;
            throw Error("live replay alias forbidden");
          },
        }),
      ),
    );
    f.memberClock.mockClear();
    expect(f.write("createLink", input, "captured")).toMatchObject({
      storage: "replayed",
      disposition: made.disposition,
    });
    expect(f.store.read((r) => r.key(principal.id, "captured"))).toEqual(before);
    expect(lookups).toBe(0);
    expect(f.memberClock).not.toHaveBeenCalled();
    f.state.hidden.add(url("beads/a"));
    const withheld = f.write("createLink", input, "captured");
    expect(withheld.disposition).toMatchObject({ code: "forbidden" });
    expect(withheld.creator).toEqual(made.creator);
    expect(f.store.read((r) => r.key(principal.id, "captured"))).toEqual(before);
    expect(lookups).toBe(0);
    spy.mockRestore();
    expect(await facet.resolveAlias(url("alias/current"))).toMatchObject({
      kind: "target",
      target: url("beads/b"),
    });
  });
});

describe("G8 lawful shared aggregate configuration", () => {
  it("enforces max2 then lawful max1 then max3 against hidden rows with exact shared captures", async () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    f.replaceMaximum(2);
    f.createLink("one");
    f.createLink("two");
    expect(f.store.read((r) => r.outgoingLinks("beads/a"))).toHaveLength(2);
    const before = f.state.configuration;
    expect(() => f.replaceMaximum(1)).toThrow("fixture replacement");
    expect(f.state.configuration).toBe(before);
    f.write("deleteLink", { link: "links/two" }, "remove_two");
    f.replaceMaximum(1);
    const plane = f.open(),
      facet = plane.readFor({ kind: "authenticated", principal });
    const discovery1 = await facet.perform({ kind: "scope-discovery", scope });
    expect(discovery1).toMatchObject({
      kind: "discovery",
      data: {
        maximumEndpointMultiplicity: [{ endpoint: "source", linkConformsTo: linkType, max: 1 }],
      },
      observation: baseObservation(f),
    });
    expect(discovery1).not.toHaveProperty("data.profile");
    expect(discovery1).not.toHaveProperty("data.operations");
    f.state.hidden.add(url("links/one"));
    const denied = f.write(
      "createLink",
      { id: "links/rejected", type: linkType, source: "beads/a", target: "beads/b" },
      "reject_second",
    );
    expect(denied.disposition).toMatchObject({ code: "aggregate-constraint-violation" });
    expect(f.state.memberConfigurations.at(-1)).toEqual(f.state.configuration);
    expect(f.store.read((r) => r.outgoingLinks("beads/a"))).toHaveLength(1);
    f.replaceMaximum(3);
    f.createLink("new_second");
    f.createLink("new_third");
    expect(f.store.read((r) => r.outgoingLinks("beads/a"))).toHaveLength(3);
    const discovery3 = await facet.perform({ kind: "scope-discovery", scope });
    expect(discovery3).toMatchObject({
      kind: "discovery",
      data: { maximumEndpointMultiplicity: f.state.configuration.maximumEndpointMultiplicity },
      observation: baseObservation(f),
    });
    expect(f.state.memberConfigurations.at(-1)).toEqual(f.state.configuration);
    // Reusing the refused key deliberately replays; raising policy does not renew/reexecute it.
    expect(
      f.write(
        "createLink",
        { id: "links/rejected", type: linkType, source: "beads/a", target: "beads/b" },
        "reject_second",
      ).disposition,
    ).toEqual(denied.disposition);
  });
});

describe("G9 deep immutable values and existing bounded pagination", () => {
  it("reads and pages actual 12000-deep writer properties immutably across later real updates", async () => {
    const f = fixture();
    const depth = 12_000;
    const deep = `${'{"child":'.repeat(depth)}1${"}".repeat(depth)}`;
    expect(
      f.write(
        "createBead",
        `{"id":"beads/a","type":"${beadType}","properties":${deep}}`,
        "deep_create",
      ).disposition,
    ).toMatchObject({ outcome: "created" });
    f.createBead("b");
    const before = f.resource("beads/a");
    const facet = f.open().readFor({ kind: "anonymous" });
    const full = await facet.perform(resourceRequest());
    const properties = await facet.perform({
      kind: "properties",
      resource: "bead",
      id: url("beads/a"),
    });
    const page = await facet.perform({
      kind: "collection",
      collection: "beads",
      limit: 1,
      selector: '$[?@.id == "https://authority-read.test/s/beads/a"]',
    });
    for (const value of [body(full).properties, body(properties), items(page)[0]?.properties]) {
      let leaf = value as Record<string, unknown>;
      for (let n = 0; n < depth; n++) {
        expect(Object.isFrozen(leaf)).toBe(true);
        leaf = leaf.child as Record<string, unknown>;
      }
      expect(leaf).toBe(1);
      expect(stringifyJsonValue(value)).toBe(deep);
    }
    expect(observation(properties).resourceRevision).toBe(before.revision);
    f.write(
      "updateBeadProperties",
      { bead: "beads/a", change: [{ op: "add", path: "/other", value: 2 }] },
      "deep_update",
    );
    expect(stringifyJsonValue(body(properties))).toBe(deep);
    expect(observation(await facet.perform(resourceRequest())).resourceRevision).not.toBe(
      before.revision,
    );
  });
  it.each([
    "retainedStateCapacity",
    "maxRetainedCursorPositionsPerSnapshot",
    "retainedSnapshotByteCapacity",
    "retainedSnapshotNodeCapacity",
  ] as const)(
    "reports existing %s capacity failure without S6 expiry or hidden truncation",
    async (capacity) => {
      const f = fixture();
      for (const id of ["a", "b", "c"]) f.createBead(id);
      const expire = vi.spyOn(f.store, "expire");
      const facet = f
        .open({
          pagination: {
            ...f.options.pagination,
            ...(capacity === "retainedStateCapacity"
              ? { retainedStateCapacity: 3, maxRetainedCursorPositionsPerSnapshot: 2 }
              : { [capacity]: 1 }),
          },
        })
        .readFor({ kind: "anonymous" });
      if (capacity === "retainedStateCapacity")
        expect(
          items(await facet.perform({ kind: "collection", collection: "beads", limit: 1 })),
        ).toHaveLength(1);
      expectProblem(
        await facet.perform({ kind: "collection", collection: "beads", limit: 1 }),
        "temporarily-unavailable",
      );
      expect(expire).not.toHaveBeenCalled();
      expect(f.store.read((r) => r.resources())).toHaveLength(3);
    },
  );
  it("retains an earlier token through token collisions and releases only expired pagination memory", async () => {
    const f = fixture();
    for (const id of ["a", "b", "c"]) f.createBead(id);
    const expire = vi.spyOn(f.store, "expire");
    let token = "same";
    const facet = f
      .open({ pagination: { ...f.options.pagination, generateOpaqueToken: () => token } })
      .readFor({ kind: "anonymous" });
    const first = body(await facet.perform({ kind: "collection", collection: "beads", limit: 2 }));
    expectProblem(
      await facet.perform({ kind: "collection", collection: "beads", limit: 2 }),
      "temporarily-unavailable",
    );
    const continuation = {
      kind: "collection" as const,
      collection: "beads" as const,
      continuation: first.next as AbsoluteHttpUrl,
    };
    expect(items(await facet.perform(continuation)).map((r) => r.id)).toEqual([url("beads/c")]);
    f.state.pageNow += 1_000;
    token = "new_token";
    const fresh = body(await facet.perform({ kind: "collection", collection: "beads", limit: 2 }));
    expect(typeof fresh.next).toBe("string");
    expectProblem(await facet.perform(continuation), "cursor-expired");
    expect(expire).not.toHaveBeenCalled();
  });
  it.each(["page", "selector-bytes", "selector-depth", "selector-nodes", "syntax"])(
    "maps only actual %s control refusal after capture and before acquisition",
    async (kind) => {
      const f = fixture();
      const selectorLimits = { ...f.options.selectorLimits };
      if (kind === "selector-bytes") selectorLimits.bytes = 4;
      if (kind === "selector-depth") selectorLimits.depth = 1;
      if (kind === "selector-nodes") selectorLimits.nodes = 1;
      const facet = f
        .open({
          selectorLimits,
          advertisedLimits: { ...f.options.advertisedLimits, selector: selectorLimits },
        })
        .readFor({ kind: "anonymous" });
      const request = {
        kind: "collection" as const,
        collection: "beads" as const,
        ...(kind === "page"
          ? { limit: 11 }
          : { selector: kind === "syntax" ? "not-selector" : "$[?@.properties.x == 1]" }),
      };
      expectProblem(
        await facet.perform(request),
        kind === "syntax" ? "invalid-parameter" : "limit-exceeded",
      );
      expect(f.state.captures).toBe(1);
      expect(f.state.calls.resources).toBe(0);
    },
  );
});

describe("G10 delivery, callback origin and plane-owned cleanup", () => {
  it.each(["perform", "alias"] as const)(
    "returns observed early closed and receiving rejections for %s",
    async (method) => {
      const f = fixture();
      const plane = f.open(),
        facet = plane.readFor({ kind: "anonymous" });
      const call = () =>
        method === "perform"
          ? facet.perform(resourceRequest())
          : facet.resolveAlias(url("alias/current"));
      const invalid = () =>
        method === "perform"
          ? facet.perform(null as unknown as ReadRequest)
          : facet.resolveAlias(null as unknown as string);
      await expect(noSyncThrow(invalid)).rejects.toBeInstanceOf(Error);
      const closed = plane.closed;
      expect(plane.close()).toBe(closed);
      await closed;
      expect(plane.close()).toBe(closed);
      await expect(noSyncThrow(call)).rejects.toBeInstanceOf(ScopeServerClosedError);
      expect(() => plane.readFor({ kind: "anonymous" })).toThrow(ScopeServerClosedError);
      expect(f.state.entries).toBe(0);
    },
  );
  it("returns rejected reentrant facet Promises while synchronous readFor/close reject without cleanup", async () => {
    const f = fixture();
    f.createBead("a");
    const plane = f.open(),
      facet = plane.readFor({ kind: "anonymous" });
    const failures: Promise<unknown>[] = [];
    f.state.captureHook = () => {
      failures.push(noSyncThrow(() => facet.perform(resourceRequest())));
      failures.push(noSyncThrow(() => facet.resolveAlias(url("alias/current"))));
      expect(() => plane.readFor({ kind: "anonymous" })).toThrow();
      expect(() => plane.close()).toThrow();
    };
    expect(body(await facet.perform(resourceRequest())).id).toBe(url("beads/a"));
    for (const rejection of failures)
      await expect(rejection).rejects.toMatchObject({ reason: "reentrant" });
    expect(f.state.entries).toBe(1);
    f.state.captureHook = undefined;
    expect(body(await facet.perform(resourceRequest())).id).toBe(url("beads/a"));
  });
  it.each(["before", "during", "after", "fault"] as const)(
    "owns %s abort at synchronous final settlement and removes listeners",
    async (when) => {
      const f = fixture();
      f.createBead("a");
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener"),
        remove = vi.spyOn(controller.signal, "removeEventListener");
      const facet = f.open().readFor({ kind: "anonymous" });
      const failure = Error("original capture fault");
      if (when === "before") controller.abort();
      if (when === "during" || when === "fault")
        f.state.captureHook = () => {
          controller.abort();
          if (when === "fault") throw failure;
        };
      f.reset();
      const pending = noSyncThrow(() =>
        facet.perform(resourceRequest(), { signal: controller.signal }),
      );
      if (when === "after") controller.abort();
      if (when === "after") expect(body(await pending).id).toBe(url("beads/a"));
      else
        await expect(pending).rejects[when === "fault" ? "toBe" : "toBeInstanceOf"](
          when === "fault" ? failure : ScopeServerOperationAbortedError,
        );
      expect(f.state.entries).toBe(when === "before" ? 0 : 1);
      expect(remove.mock.calls.filter(([name]) => name === "abort")).toHaveLength(
        add.mock.calls.filter(([name]) => name === "abort").length,
      );
      if (when !== "before")
        expect(() => f.state.facades[0]?.resource("beads/a")).toThrow(/expired/);
    },
  );
  it.each(["not-accepting", "reentrant"] as const)(
    "maps only outer owner %s refusal with its exact cause",
    async (reason) => {
      const f = fixture();
      const cause = Error("owner guard");
      const facet = f
        .open({
          entry: {
            scope,
            withRead() {
              return { kind: "entry-refused", reason, cause };
            },
          },
        })
        .readFor({ kind: "anonymous" });
      for (const call of [
        () => facet.perform(resourceRequest()),
        () => facet.resolveAlias(url("alias/current")),
      ]) {
        const pending = noSyncThrow(call);
        await expect(pending).rejects.toMatchObject({ cause });
        if (reason === "not-accepting")
          await expect(pending).rejects.toBeInstanceOf(ScopeServerClosedError);
        else await expect(pending).rejects.toMatchObject({ reason: "reentrant" });
      }
      expect(f.state.reads).toBe(0);
      expect(f.state.captures).toBe(0);
    },
  );
  it.each(["sequence", "read-control", "sqlite", "lookalike"])(
    "preserves callback-origin %s fault unchanged without shutdown",
    async (kind) => {
      const f = fixture();
      const plane = f.open(),
        facet = plane.readFor({ kind: "anonymous" });
      const error =
        kind === "sequence"
          ? new SequenceLifecycleError("not-accepting", Error("callback"))
          : kind === "read-control"
            ? new ReadPaginationError("invalid-input", "callback")
            : kind === "sqlite"
              ? Object.assign(Error("sqlite"), { code: "ERR_SQLITE_ERROR" })
              : { kind: "entry-refused", reason: "not-accepting", cause: "callback" };
      const close = vi.spyOn(f.store, "close"),
        expire = vi.spyOn(f.store, "expire");
      f.state.captureHook = () => {
        throw error;
      };
      await expect(noSyncThrow(() => facet.perform(resourceRequest()))).rejects.toBe(error);
      await expect(noSyncThrow(() => facet.resolveAlias(url("alias/current")))).rejects.toBe(error);
      expect(close).not.toHaveBeenCalled();
      expect(expire).not.toHaveBeenCalled();
      f.state.captureHook = undefined;
      expectProblem(await facet.perform(resourceRequest()), "resource-not-found");
    },
  );
  it("rejects a callback-value lookalike, owner replay of callback and hidden async S6 results", async () => {
    const f = fixture();
    const forged = f
      .open({
        entry: {
          scope,
          withRead(callback) {
            const value = f.options.entry.withRead(callback);
            return {
              kind: "read",
              value: { kind: "entry-refused", reason: "not-accepting" } as typeof value extends {
                kind: "read";
                value: infer T;
              }
                ? T
                : never,
            };
          },
        },
      })
      .readFor({ kind: "anonymous" });
    await expect(forged.perform(resourceRequest())).rejects.toMatchObject({ reason: "integrity" });
    const repeated = f
      .open({
        entry: {
          scope,
          withRead(callback) {
            f.options.entry.withRead(callback);
            return f.options.entry.withRead(callback);
          },
        },
      })
      .readFor({ kind: "anonymous" });
    await expect(repeated.perform(resourceRequest())).rejects.toMatchObject({
      reason: "integrity",
    });
    const asynchronous = f
      .open({
        entry: {
          scope,
          withRead(callback) {
            const value = f.store.read((r) => {
              callback(r);
              return Promise.resolve(1);
            });
            return { kind: "read", value: value as never };
          },
        },
        captureReadAuthorization() {
          return { kind: "problem", problem: readProblem("forbidden") };
        },
      })
      .readFor({ kind: "anonymous" });
    await expect(asynchronous.perform(resourceRequest())).rejects.toMatchObject({
      reason: "async-callback",
    });
  });
  it("observes ignored early and asynchronous provider rejections without unhandled rejection", async () => {
    const f = fixture();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      const facet = f
        .open({
          captureReadAuthorization: (() =>
            Promise.reject(
              Error("provider async"),
            )) as unknown as AuthorityReadOptions["captureReadAuthorization"],
        })
        .readFor({ kind: "anonymous" });
      void facet.perform(resourceRequest());
      void facet.resolveAlias(url("alias/current"));
      void facet.perform(null as unknown as ReadRequest);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
  it("closes only its pagination once, keeps one rejected close Promise and cleans partial construction", async () => {
    const f = fixture();
    const realFactory = paginationModule.createReadPagination;
    const failure = Error("pagination cleanup");
    const closes: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(paginationModule, "createReadPagination").mockImplementation(((options) => {
      const engine = realFactory(options);
      const close = vi.fn(() => {
        engine.close();
        throw failure;
      });
      closes.push(close);
      return { ...engine, close };
    }) as typeof realFactory);
    const plane = f.open();
    const storeClose = vi.spyOn(f.store, "close"),
      expire = vi.spyOn(f.store, "expire"),
      abandon = vi.spyOn(f.store, "abandonAttempt");
    const first = plane.close();
    expect(first).toBe(plane.closed);
    expect(plane.close()).toBe(first);
    await expect(first).rejects.toBe(failure);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(storeClose).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
    expect(() => f.open({ installedTypes: [descriptor(), descriptor()] })).toThrow();
    expect(closes[1]).toHaveBeenCalledTimes(1);
  });
});

describe("additional authority receiving and observer cleanup controls", () => {
  it("rejects zero aggregate maximum as local configuration, never discovery data or a client Problem", async () => {
    const f = fixture();
    f.state.configuration = {
      ...f.state.configuration,
      maximumEndpointMultiplicity: [{ endpoint: "source", linkConformsTo: linkType, max: 0 }],
    };
    await expect(
      f.open().readFor({ kind: "anonymous" }).perform({ kind: "scope-discovery", scope }),
    ).rejects.toMatchObject({ reason: "configuration" });
  });
  it("removes an abort listener even when its controlled registering method throws after installation", async () => {
    const f = fixture();
    const controller = new AbortController();
    const failure = Error("register after install");
    const add = controller.signal.addEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, "addEventListener").mockImplementation((...args) => {
      add(...args);
      throw failure;
    });
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const facet = f.open().readFor({ kind: "anonymous" });
    await expect(facet.perform(resourceRequest(), { signal: controller.signal })).rejects.toBe(
      failure,
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(f.state.entries).toBe(0);
  });
});

describe("remaining construction, idle memory and captured-provider boundaries", () => {
  it("cleans the actual partial pagination engine after a labeled controlled Type-conformance RangeError", () => {
    const f = fixture();
    const original = paginationModule.createReadPagination;
    const closed: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(paginationModule, "createReadPagination").mockImplementation(((options) => {
      const engine = original(options);
      const close = vi.fn(engine.close.bind(engine));
      closed.push(close);
      return { ...engine, close };
    }) as typeof original);
    const fault = new RangeError("controlled conformance construction failure");
    vi.spyOn(protocolModule, "createTypeConformanceIndex").mockImplementation(() => {
      throw fault;
    });
    expect(() => f.open()).toThrow(fault);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toHaveBeenCalledTimes(1);
    expect(f.state.reads).toBe(0);
  });
  it("uses explicit idle timer cleanup without any S6 expiry/read or mutable owner operation", async () => {
    const f = fixture();
    f.createBead("a");
    f.createBead("b");
    vi.useFakeTimers();
    const expire = vi.spyOn(f.store, "expire");
    const plane = f.open({ pagination: { ...f.options.pagination, idleCleanup: "timer" } });
    const facet = plane.readFor({ kind: "anonymous" });
    const first = body(await facet.perform({ kind: "collection", collection: "beads", limit: 1 }));
    expect(vi.getTimerCount()).toBe(1);
    f.reset();
    f.state.pageNow += 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.state.reads).toBe(0);
    expect(expire).not.toHaveBeenCalled();
    expectProblem(
      await facet.perform({
        kind: "collection",
        collection: "beads",
        continuation: first.next as AbsoluteHttpUrl,
      }),
      "cursor-expired",
    );
    await plane.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("captures provider callables/options and permits no external Type or endpoint fetch", async () => {
    const f = fixture();
    f.createBead("a");
    f.createLink("opaque", "beads/a", "urn:opaque:outside");
    const noFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw Error("unexpected external fetch");
    });
    const plane = f.open(),
      facet = plane.readFor({ kind: "anonymous" });
    f.options.entry.withRead = () => {
      throw Error("late entry replacement");
    };
    f.options.captureReadAuthorization = () => {
      throw Error("late capture replacement");
    };
    f.source.capture = () => {
      throw Error("late configuration replacement");
    };
    Object.assign(f.options.pagination, {
      generateOpaqueToken: () => {
        throw Error("late token replacement");
      },
    });
    expect(body(await facet.perform(resourceRequest())).id).toBe(url("beads/a"));
    expect(
      items(await facet.perform({ kind: "bead-links", bead: url("beads/a") }))[0]?.target,
    ).toBe("urn:opaque:outside");
    expect(
      body(
        await facet.perform({
          kind: "resource",
          resource: "type",
          id: beadType as AbsoluteHttpUrl,
        }),
      ).id,
    ).toBe(beadType);
    expect(noFetch).not.toHaveBeenCalled();
  });
  it("abort and ignored delivery never evict an existing issued cursor or own its admitted store", async () => {
    const f = fixture();
    for (const id of ["a", "b", "c"]) f.createBead(id);
    const facet = f.open().readFor({ kind: "anonymous" });
    const first = body(await facet.perform({ kind: "collection", collection: "beads", limit: 1 }));
    const controller = new AbortController();
    f.state.captureHook = () => controller.abort();
    await expect(
      facet.perform(
        { kind: "collection", collection: "beads", limit: 1 },
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(ScopeServerOperationAbortedError);
    f.state.captureHook = undefined;
    expect(
      items(
        await facet.perform({
          kind: "collection",
          collection: "beads",
          continuation: first.next as AbsoluteHttpUrl,
        }),
      ).map((r) => r.id),
    ).toEqual([url("beads/b")]);
    f.createBead("d");
    expect(f.resource("beads/d").id).toBe(url("beads/d"));
  });
});

describe("independent generic, Link conformance and deep owned-pair oracles", () => {
  it("types revision witnesses only on same-root Resource/properties successes", async () => {
    const f = fixture();
    f.createBead("a");
    const facet = f.open().readFor({ kind: "anonymous" });
    const pending = facet.perform({ kind: "properties", resource: "bead", id: url("beads/a") });
    type PropertiesSuccess = Extract<Awaited<typeof pending>, { kind: "success" }>;
    expectTypeOf<PropertiesSuccess["observation"]>().toEqualTypeOf<ResourceReadObservation>();
    const types = facet.perform({ kind: "collection", collection: "types" });
    type TypesSuccess = Extract<Awaited<typeof types>, { kind: "success" }>;
    expectTypeOf<TypesSuccess["observation"]>().toEqualTypeOf<ReadObservation>();
    const a = await pending,
      b = await types;
    expect(Object.keys(observation(a)).sort()).toEqual([
      "authorizationView",
      "configurationIdentity",
      "policyIdentity",
      "resourceRevision",
      "scopeEpoch",
    ]);
    expect(Object.keys(observation(b)).sort()).toEqual([
      "authorizationView",
      "configurationIdentity",
      "policyIdentity",
      "scopeEpoch",
    ]);
  });
  it("combines exact Link type with effective Link conformance and keeps hidden candidates out", async () => {
    const child = "https://types.test/child-link",
      other = "https://types.test/other-link";
    const f = fixture([
      descriptor(),
      edgeDescriptor(),
      edgeDescriptor(child, { conformsTo: [linkType] }),
      edgeDescriptor(other),
    ]);
    f.createBead("a");
    f.createBead("b");
    f.createLink("parent");
    f.createLink("child", "beads/a", "beads/b", child);
    f.createLink("other", "beads/a", "beads/b", other);
    const facet = f.open().readFor({ kind: "anonymous" });
    const request = { kind: "collection" as const, collection: "links" as const, limit: 10 };
    expect(
      items(await facet.perform({ ...request, conformsTo: linkType as AbsoluteHttpUrl })).map(
        (r) => r.id,
      ),
    ).toEqual([url("links/child"), url("links/parent")]);
    expect(
      items(
        await facet.perform({
          ...request,
          type: child as AbsoluteHttpUrl,
          conformsTo: linkType as AbsoluteHttpUrl,
        }),
      ).map((r) => r.id),
    ).toEqual([url("links/child")]);
    expect(
      items(
        await facet.perform({
          ...request,
          type: other as AbsoluteHttpUrl,
          conformsTo: linkType as AbsoluteHttpUrl,
        }),
      ),
    ).toEqual([]);
    f.state.hidden.add(url("links/child"));
    expect(
      items(
        await facet.perform({
          ...request,
          type: child as AbsoluteHttpUrl,
          conformsTo: linkType as AbsoluteHttpUrl,
        }),
      ),
    ).toEqual([]);
  });
  it("compares complete real 12000-deep first-class/inline owned Links and detects a changed bottom leaf", async () => {
    const f = fixture(ownedDescriptors());
    f.createBead("a");
    f.createBead("b");
    const depth = 12_000,
      deep = `${'{"child":'.repeat(depth)}1${"}".repeat(depth)}`;
    expect(
      f.write(
        "createLink",
        `{"id":"links/deep","type":"${linkType}","source":"beads/a","target":"beads/b","properties":${deep}}`,
        "deep_link",
      ).disposition,
    ).toMatchObject({ outcome: "created" });
    const facet = f.open().readFor({ kind: "anonymous" });
    const result = body(await facet.perform(resourceRequest()));
    expect(stringifyJsonValue(result)).toBe(stringifyJsonValue(f.resource("beads/a")));
    const inline = (result.ownedLinks as Record<string, Record<string, unknown>[]>)[linkType]?.[0];
    expect(stringifyJsonValue(inline?.properties)).toBe(deep);
    f.state.wrap = (reader) => ({
      ...reader,
      resource(id) {
        const row = reader.resource(id);
        if (!row || id !== "links/deep") return row;
        const value = JSON.parse(row.bodyJson);
        let cursor = value.properties;
        for (let i = 1; i < depth; i++) cursor = cursor.child;
        cursor.child = 2;
        return { ...row, bodyJson: stringifyJsonValue(value) };
      },
    });
    await expect(facet.perform(resourceRequest())).rejects.toMatchObject({ reason: "integrity" });
  });
});

// Full source council correction controls. All positive rows and aliases below
// still come through the real fixture writer; only named receiving faults vary.
describe("council delivery guard and actual settlement regressions", () => {
  it.each(["perform", "alias"] as const)(
    "guards genuine signal getter close/nested %s without disposing an old cursor",
    async (method) => {
      const f = fixture();
      for (const id of ["a", "b", "c"]) f.createBead(id);
      f.write("putAlias", { alias: "alias/current", target: "beads/a" }, "signal_alias");
      const plane = f.open(),
        facet = plane.readFor({ kind: "anonymous" });
      const first = body(
        await facet.perform({ kind: "collection", collection: "beads", limit: 1 }),
      );
      const continuation = {
        kind: "collection",
        collection: "beads",
        continuation: first.next,
      } as ReadRequest;
      let closed = false,
        getterCalls = 0;
      void plane.closed.then(() => {
        closed = true;
      });
      const nested: Promise<unknown>[] = [];
      const controller = new AbortController();
      Object.defineProperty(controller.signal, "aborted", {
        get() {
          getterCalls++;
          expect(() => plane.close()).toThrow(AuthorityReadError);
          expect(() => plane.readFor({ kind: "anonymous" })).toThrow(AuthorityReadError);
          nested.push(noSyncThrow(() => facet.perform(resourceRequest())));
          nested.push(noSyncThrow(() => facet.resolveAlias(url("alias/current"))));
          expect(f.state.entries).toBe(0);
          return false;
        },
      });
      f.reset();
      const pending = noSyncThrow(() =>
        method === "perform"
          ? facet.perform(resourceRequest(), { signal: controller.signal })
          : facet.resolveAlias(url("alias/current"), { signal: controller.signal }),
      );
      expect(f.state.entries).toBe(1);
      const result = await pending;
      if (method === "perform") expect(body(result).id).toBe(url("beads/a"));
      else expect(result).toMatchObject({ kind: "target", target: url("beads/a") });
      expect(getterCalls).toBe(1); // final check uses the genuine signal state, not this override
      for (const rejection of nested) {
        await expect(rejection).rejects.toBeInstanceOf(AuthorityReadError);
        await expect(rejection).rejects.toMatchObject({ reason: "reentrant" });
      }
      expect(closed).toBe(false);
      expect(items(await facet.perform(continuation)).map((r) => r.id)).toEqual([url("beads/b")]);
      expect(body(await facet.perform(resourceRequest())).id).toBe(url("beads/a"));
    },
  );

  it.each(["perform", "alias"] as const)(
    "keeps %s guarded through cleanup abort/fault precedence and synchronous settlement",
    async (method) => {
      const f = fixture();
      f.createBead("a");
      f.write("putAlias", { alias: "alias/current", target: "beads/a" }, "cleanup_alias");
      const plane = f.open(),
        facet = plane.readFor({ kind: "anonymous" });
      for (const scenario of [
        "before-remove",
        "after-remove",
        "cleanup-fault",
        "work-and-cleanup",
        "after-return",
      ] as const) {
        const controller = new AbortController();
        const workFailure = Error("original work"),
          cleanupFailure = Error("listener cleanup");
        const remove = controller.signal.removeEventListener.bind(controller.signal);
        const addSpy = vi.spyOn(controller.signal, "addEventListener");
        const removeSpy = vi
          .spyOn(controller.signal, "removeEventListener")
          .mockImplementation((...args) => {
            expect(() => plane.close()).toThrow(AuthorityReadError);
            if (scenario === "before-remove") controller.abort();
            remove(...args);
            if (scenario !== "after-return" && scenario !== "before-remove") controller.abort();
            if (scenario === "cleanup-fault" || scenario === "work-and-cleanup")
              throw cleanupFailure;
          });
        f.state.captureHook =
          scenario === "work-and-cleanup"
            ? () => {
                throw workFailure;
              }
            : undefined;
        f.reset();
        const pending = noSyncThrow(() =>
          method === "perform"
            ? facet.perform(resourceRequest(), { signal: controller.signal })
            : facet.resolveAlias(url("alias/current"), { signal: controller.signal }),
        );
        expect(f.state.entries).toBe(1);
        expect(() => f.state.facades[0]?.resource("beads/a")).toThrow(/expired/);
        expect(addSpy).toHaveBeenCalledTimes(1);
        expect(removeSpy).toHaveBeenCalledTimes(1);
        if (scenario === "after-return") {
          controller.abort();
          const result = await pending;
          if (method === "perform") expect(body(result).id).toBe(url("beads/a"));
          else expect(result).toMatchObject({ kind: "target", target: url("beads/a") });
        } else if (scenario === "work-and-cleanup") await expect(pending).rejects.toBe(workFailure);
        else if (scenario === "cleanup-fault") await expect(pending).rejects.toBe(cleanupFailure);
        else await expect(pending).rejects.toBeInstanceOf(ScopeServerOperationAbortedError);
        f.state.captureHook = undefined;
        expect(body(await facet.perform(resourceRequest())).id).toBe(url("beads/a"));
      }
    },
  );
});

describe("council immutable generated refusals and required receiving fields", () => {
  it.each(["pre-context", "observed", "control"] as const)(
    "freezes generated %s Problem values without changing phase or shape",
    async (origin) => {
      const f = fixture(),
        facet = f.open().readFor({ kind: "anonymous" });
      const request: ReadRequest =
        origin === "pre-context"
          ? { kind: "resource", resource: "bead", id: "https://foreign.test/beads/a" }
          : origin === "control"
            ? { kind: "collection", collection: "beads", limit: 0 }
            : resourceRequest();
      const result = await facet.perform(request);
      const code =
        origin === "pre-context"
          ? "invalid-parameter"
          : origin === "control"
            ? "limit-exceeded"
            : "resource-not-found";
      expectProblem(result, code, origin === "pre-context" ? "pre-context" : "observed");
      if (result.kind !== "problem") throw Error("expected actual generated refusal");
      expect(result.problem).toEqual(readProblem(code));
      expect(Object.isFrozen(result.problem)).toBe(true);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Reflect.set(result.problem, "code", "forged")).toBe(false);
      expect(Reflect.set(result.problem, "detail", "forged")).toBe(false);
      expect(result.problem).toEqual(readProblem(code));
      expect(f.state.captures).toBe(origin === "pre-context" ? 0 : 1);
      expect(f.state.calls.resources).toBe(0);
    },
  );
  it("keeps nested supplied gate Problem values immutable and performs no configuration lookup", async () => {
    const f = fixture();
    f.state.gate = {
      ...readProblem("forbidden"),
      detail: "gate detail",
      extension: { values: ["kept"] },
    };
    const result = await f.open().readFor({ kind: "anonymous" }).perform(resourceRequest());
    expectProblem(result, "forbidden", "pre-context");
    if (result.kind !== "problem") throw Error("gate did not refuse");
    expect(Object.isFrozen(result.problem)).toBe(true);
    expect(Reflect.set(result.problem, "detail", "changed")).toBe(false);
    const extension = result.problem.extension as { values: string[] };
    expect(Object.isFrozen(extension)).toBe(true);
    expect(Object.isFrozen(extension.values)).toBe(true);
    expect(Reflect.set(extension.values, "0", "changed")).toBe(false);
    expect(extension.values).toEqual(["kept"]);
    expect(f.state.configurations).toBe(0);
  });
  it.each([
    [{ kind: "scope-discovery", scope }, ["kind", "scope"]],
    [{ kind: "collection", collection: "beads" }, ["kind", "collection"]],
    [{ kind: "collection", collection: "links" }, ["kind", "collection"]],
    [{ kind: "collection", collection: "types" }, ["kind", "collection"]],
    [{ kind: "resource", resource: "bead", id: url("beads/a") }, ["kind", "resource", "id"]],
    [{ kind: "resource", resource: "link", id: url("links/a") }, ["kind", "resource", "id"]],
    [{ kind: "resource", resource: "type", id: beadType }, ["kind", "resource", "id"]],
    [{ kind: "properties", resource: "bead", id: url("beads/a") }, ["kind", "resource", "id"]],
    [{ kind: "properties", resource: "link", id: url("links/a") }, ["kind", "resource", "id"]],
    [{ kind: "bead-links", bead: url("beads/a") }, ["kind", "bead"]],
  ] as const)(
    "rejects absent/nonstring mandatory values on %j before entry",
    async (request, required) => {
      const f = fixture(),
        facet = f.open().readFor({ kind: "anonymous" });
      for (const field of required)
        for (const value of [undefined, 5, null]) {
          const input: Record<string, unknown> = { ...request };
          if (value === undefined) delete input[field];
          else input[field] = value;
          await expect(
            noSyncThrow(() => facet.perform(input as unknown as ReadRequest)),
          ).rejects.toBeInstanceOf(AuthorityReadError);
        }
      expect(f.state.entries).toBe(0);
      expect(f.state.captures).toBe(0);
    },
  );
});

describe("council real two-principal retained capacity coupling", () => {
  it.each(["state", "bytes", "nodes", "positions"] as const)(
    "distinguishes plane-global %s capacity from per-snapshot positions without cross-view leaks",
    async (capacity) => {
      const f = fixture();
      for (const id of ["p1", "p2", "p3", "q1", "q2", "q3"])
        f.createBead(id, { payload: capacity === "nodes" ? Array(100).fill(1) : "x".repeat(2000) });
      const settings =
        capacity === "state"
          ? { retainedStateCapacity: 3 }
          : capacity === "bytes"
            ? { retainedSnapshotByteCapacity: 10_000 }
            : capacity === "nodes"
              ? { retainedSnapshotNodeCapacity: 500 }
              : { retainedStateCapacity: 6 };
      const plane = f.open({
        pagination: {
          ...f.options.pagination,
          maxRetainedCursorPositionsPerSnapshot: 2,
          ...settings,
        },
      });
      const p = plane.readFor({ kind: "authenticated", principal: { id: "P" } });
      const q = plane.readFor({ kind: "authenticated", principal: { id: "Q" } });
      f.state.captureHook = (_r, person) => {
        if (person.kind !== "authenticated") throw Error("expected P/Q");
        const prefix = person.principal.id === "P" ? "p" : "q";
        f.state.view = `view-${prefix}`;
        f.state.hidden = new Set(
          ["p1", "p2", "p3", "q1", "q2", "q3"]
            .filter((id) => !id.startsWith(prefix))
            .map((id) => url(`beads/${id}`)),
        );
      };
      const expire = vi.spyOn(f.store, "expire");
      const request = { kind: "collection", collection: "beads", limit: 1 } as const;
      const first = body(await p.perform(request));
      expect((first.items as { id: string }[]).map((r) => r.id)).toEqual([url("beads/p1")]);
      const continuation = {
        kind: "collection",
        collection: "beads",
        continuation: first.next,
      } as ReadRequest;
      const qFirst = await q.perform(request);
      if (capacity === "positions") {
        expect(items(qFirst).map((r) => r.id)).toEqual([url("beads/q1")]);
        const qNext = {
          kind: "collection",
          collection: "beads",
          continuation: body(qFirst).next,
        } as ReadRequest;
        expect(items(await q.perform(qNext)).map((r) => r.id)).toEqual([url("beads/q2")]);
        // Two snapshots reserve four cursor positions overall, exceeding the
        // value2 independently allowed for each. It is not a global position cap.
      } else expectProblem(qFirst, "temporarily-unavailable");
      expectProblem(await q.perform(continuation), "foreign-view");
      const pSecond = body(await p.perform(continuation));
      expect((pSecond.items as { id: string }[]).map((r) => r.id)).toEqual([url("beads/p2")]);
      expect(
        items(
          await p.perform({
            kind: "collection",
            collection: "beads",
            continuation: pSecond.next,
          } as ReadRequest),
        ).map((r) => r.id),
      ).toEqual([url("beads/p3")]);
      expect(body(await q.perform(resourceRequest("q1"))).id).toBe(url("beads/q1"));
      f.state.pageNow = 2000;
      expect(items(await q.perform(request)).map((r) => r.id)).toEqual([url("beads/q1")]);
      expectProblem(await p.perform(continuation), "cursor-expired");
      expect(expire).not.toHaveBeenCalled();
    },
  );
});

describe("council defensive callback origin and captured-row consistency", () => {
  it.each(["thenable", "rejected-promise"] as const)(
    "rejects an outer owner %s specifically at the plane async guard",
    async (kind) => {
      const f = fixture();
      let assimilations = 0;
      const unhandled: unknown[] = [],
        listener = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", listener);
      try {
        const facet = f
          .open({
            entry: {
              scope,
              withRead: (() =>
                kind === "thenable"
                  ? {
                      // biome-ignore lint/suspicious/noThenProperty: Labeled negative owner-result thenable.
                      then(resolve: (value: unknown) => void) {
                        assimilations++;
                        resolve({ kind: "read", value: 1 });
                      },
                    }
                  : Promise.reject(
                      Error("outer async owner"),
                    )) as unknown as AuthorityReadOptions["entry"]["withRead"],
            },
          })
          .readFor({ kind: "anonymous" });
        for (const call of [
          () => facet.perform(resourceRequest()),
          () => facet.resolveAlias(url("alias/current")),
        ]) {
          const pending = noSyncThrow(call);
          await expect(pending).rejects.toBeInstanceOf(AuthorityReadError);
          await expect(pending).rejects.not.toBeInstanceOf(RecoveryStoreError);
          await expect(pending).rejects.toMatchObject({ reason: "async-callback" });
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(unhandled).toEqual([]);
        expect(assimilations).toBe(kind === "thenable" ? 2 : 0);
        expect(f.state.reads).toBe(0);
        expect(f.state.captures).toBe(0);
      } finally {
        process.off("unhandledRejection", listener);
      }
    },
  );
  it.each(["canRead", "canReadType"] as const)(
    "requires actual booleans from %s and observes ordinary async rejection",
    async (callback) => {
      const f = fixture();
      f.createBead("a");
      for (const mode of ["nonboolean", "thenable", "rejected-promise"] as const) {
        let calls = 0;
        const unhandled: unknown[] = [],
          listener = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", listener);
        try {
          const facet = f
            .open({
              captureReadAuthorization(reader, person, intent) {
                const decision = f.options.captureReadAuthorization.call(
                  f.options,
                  reader,
                  person,
                  intent,
                );
                if (decision.kind !== "authorized") throw Error("expected fixture authorization");
                const bad = () => {
                  calls++;
                  if (mode === "nonboolean") return 1;
                  if (mode === "thenable")
                    return {
                      // biome-ignore lint/suspicious/noThenProperty: Labeled negative synchronous-policy thenable.
                      then(resolve: (value: boolean) => void) {
                        resolve(true);
                      },
                    };
                  return Promise.reject(Error("async boolean"));
                };
                return {
                  kind: "authorized",
                  authorization: {
                    ...decision.authorization,
                    ...(callback === "canRead"
                      ? { policy: { canRead: bad } }
                      : { canReadType: bad }),
                  },
                } as unknown as ReturnType<AuthorityReadOptions["captureReadAuthorization"]>;
              },
            })
            .readFor({ kind: "anonymous" });
          const request: ReadRequest =
            callback === "canRead"
              ? resourceRequest()
              : { kind: "resource", resource: "type", id: beadType };
          const pending = noSyncThrow(() => facet.perform(request));
          await expect(pending).rejects.toBeInstanceOf(AuthorityReadError);
          await expect(pending).rejects.toMatchObject({
            reason: mode === "nonboolean" ? "configuration" : "async-callback",
          });
          expect(calls).toBe(1);
          expect(() => f.state.facades.at(-1)?.policy("x")).toThrow(/expired/);
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(unhandled).toEqual([]);
        } finally {
          process.off("unhandledRejection", listener);
        }
      }
    },
  );
  it("rejects an invalid decision discriminant before configuration or graph acquisition", async () => {
    const f = fixture();
    const facet = f
      .open({
        captureReadAuthorization: (() => ({
          kind: "permission-ish",
        })) as unknown as AuthorityReadOptions["captureReadAuthorization"],
      })
      .readFor({ kind: "anonymous" });
    for (const call of [
      () => facet.perform(resourceRequest()),
      () => facet.resolveAlias(url("alias/current")),
    ]) {
      const pending = noSyncThrow(call);
      await expect(pending).rejects.toBeInstanceOf(AuthorityReadError);
      await expect(pending).rejects.toMatchObject({ reason: "configuration" });
    }
    expect(f.state.entries).toBe(2);
    expect(f.state.configurations).toBe(0);
    expect(Object.values(f.state.calls)).toEqual(readerNames.map(() => 0));
  });
  it("captures a labeled varying row once before checks and retains the captured body", async () => {
    const f = fixture();
    f.createBead("a");
    const original = f.resource("beads/a");
    const wrong = { ...original, id: url("beads/forged") };
    let bodyReads = 0;
    f.state.wrap = (reader) => ({
      ...reader,
      resource(id) {
        const real = reader.resource(id);
        if (!real || id !== "beads/a") return real;
        // Deliberately non-S6 row wrapper: first captured primitive is valid,
        // subsequent reads would contradict it. No hostile-row qualification.
        return {
          ...real,
          get bodyJson() {
            bodyReads++;
            return bodyReads === 1 ? real.bodyJson : stringifyJsonValue(wrong);
          },
        };
      },
    });
    const result = await f.open().readFor({ kind: "anonymous" }).perform(resourceRequest());
    expect(body(result)).toEqual(original);
    expect(bodyReads).toBe(1);
  });
});

describe("council native cancellation state before observation", () => {
  it.each(["perform", "alias"] as const)(
    "rejects %s before S6 when a genuine signal getter lies or aborts during the initial sample",
    async (method) => {
      for (const alreadyAborted of [true, false]) {
        const f = fixture();
        f.createBead("a");
        const facet = f.open().readFor({ kind: "anonymous" });
        const controller = new AbortController();
        if (alreadyAborted) controller.abort();
        let reads = 0;
        Object.defineProperty(controller.signal, "aborted", {
          get() {
            reads++;
            if (!alreadyAborted) controller.abort();
            return false;
          },
        });
        f.reset();
        const pending = noSyncThrow(() =>
          method === "perform"
            ? facet.perform(resourceRequest(), { signal: controller.signal })
            : facet.resolveAlias(url("alias/current"), { signal: controller.signal }),
        );
        await expect(pending).rejects.toBeInstanceOf(ScopeServerOperationAbortedError);
        expect(reads).toBe(1);
        expect([f.state.entries, f.state.reads, f.state.captures, f.state.configurations]).toEqual([
          0, 0, 0, 0,
        ]);
        expect(body(await facet.perform(resourceRequest())).id).toBe(url("beads/a"));
      }
    },
  );
});
