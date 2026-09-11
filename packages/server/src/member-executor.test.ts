import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseReadUpdateProblem,
  parseReadUpdateSequenceMemberProblem,
  parseTypeDescriptor,
  prepareReadUpdateSequence,
  prepareReadUpdateSingleton,
  stringifyJsonValue,
  type PreparedReadUpdateCarrier,
  type PropertyValidator,
  type ReadUpdateOperation,
} from "@bdp/protocol";
import {
  runMember,
  assertRetainedOutcomeCompatible,
  UnimplementedAliasRetryError,
  type MemberContext,
  type MemberExecutorOptions,
  type MemberTurn,
} from "./member-executor.js";
import {
  openRecoveryStore,
  recoveryIdentityFingerprint,
  type KeyState,
  type RecoveryStore,
  type StoredResource,
  type StoreReader,
} from "./recovery-store.js";
import { parseMemberMetadata, type MemberCreatorBinding } from "./member-identity.js";
import * as evaluator from "./resource-evaluator.js";

const scope = "https://executor.test/s/";
const type = "https://types.test/bead";
const linkType = "https://types.test/link";
const day = 86_400_000;
const start = 1_700_000_000_000;
const dirs: string[] = [];
const stores: RecoveryStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(path.join(tmpdir(), "bdp-member-executor-"));
  dirs.push(dir);
  return dir;
}
const unexpectedCreator = () => {
  throw Error("unexpected creator lookup");
};
function fixture(settings: { owned?: boolean; validate?: PropertyValidator; scope?: string } = {}) {
  const selectedScope = settings.scope ?? scope;
  const directoryPath = directory();
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
  });
  const link = {
    id: `${selectedScope}links/old`,
    type: linkType,
    revision: "l0",
    source: `${selectedScope}beads/a`,
    target: `${selectedScope}beads/b`,
    properties: {},
  };
  const resources: StoredResource[] = ["a", "b", "free"].map((id) => ({
    kind: "bead",
    id: `beads/${id}`,
    bodyJson: stringifyJsonValue({
      id: `${selectedScope}beads/${id}`,
      type,
      revision: "r0",
      properties: { n: 0 },
      ...(settings.owned ? { ownedLinks: { [linkType]: id === "a" ? [link] : [] } } : {}),
    }),
  }));
  resources.push({
    kind: "link",
    id: "links/old",
    source: "beads/a",
    target: "beads/b",
    bodyJson: stringifyJsonValue(link),
  });
  const types = {
    [type]: stringifyJsonValue(descriptor),
    [linkType]: stringifyJsonValue(linkDescriptor),
  };
  const configuration = {
    directory: directoryPath,
    scope: selectedScope,
    installationId: "executor-test",
    lineageId: "fresh-test-population",
    minimumRetentionMs: day,
  };
  let store = openRecoveryStore({ ...configuration, create: { resources, types } });
  stores.push(store);
  const policyState = {
    hidden: new Set<string>(),
    deny: false,
    recording: true,
    contextCalls: 0,
    principals: [] as string[],
    now: start,
  };
  const clock = vi.fn(() => policyState.now++);
  const options: MemberExecutorOptions = {
    scope: selectedScope,
    limits: {},
    numericBudget: {
      diagnostic: ({ pointer }) => ({
        message: "inadmissible property number",
        instanceLocation: pointer,
      }),
    },
    retentionMs: day,
    minimumRetentionMs: day,
    clock,
    contracts: Object.freeze({
      get(id: string, bytes: string) {
        if (types[id as keyof typeof types] !== bytes) return undefined;
        return id === type
          ? Object.freeze({
              descriptor,
              ...(settings.validate ? { validateProperties: settings.validate } : {}),
            })
          : id === linkType
            ? Object.freeze({ descriptor: linkDescriptor })
            : undefined;
      },
    }),
    captureMemberContext(_reader, principal): MemberContext {
      policyState.contextCalls++;
      policyState.principals.push(principal.id);
      // This fixture captures real values per turn; callbacks close over the
      // copied set/booleans, never the subsequently mutable backing configuration.
      const hidden = new Set(policyState.hidden);
      const denied = policyState.deny || principal.id === "blocked";
      return Object.freeze({
        policyIdentity: `view-${principal.id}`,
        configurationIdentity: "fixture-v1",
        recordChangeContext: policyState.recording,
        maximumEndpointMultiplicity: Object.freeze([]),
        policy: Object.freeze({
          canRead: (record: evaluator.ResourceRecord) => !hidden.has(record.id),
          canCreate: () => !denied,
          canWrite: () => !denied,
          canWriteBead: () => !denied,
        }),
      });
    },
  };
  function singleton(operation: ReadUpdateOperation, input: unknown, key = "key") {
    return prepareReadUpdateSingleton(
      selectedScope,
      operation,
      typeof input === "string" ? input : stringifyJsonValue(input),
      key,
    );
  }
  function present(
    carrier: PreparedReadUpdateCarrier,
    index = 0,
    creators = unexpectedCreator as (index: number) => MemberCreatorBinding,
    opts = options,
    principal = "alice",
  ): MemberTurn {
    const admission = store.admit(principal, carrier.keys);
    try {
      return runMember(
        store,
        admission,
        Object.freeze({ id: principal }),
        carrier,
        index,
        creators,
        opts,
      );
    } finally {
      store.abandonAttempt(admission);
    }
  }
  return {
    get store() {
      return store;
    },
    directory: directoryPath,
    configuration,
    options,
    policyState,
    clock,
    singleton,
    present,
    run(
      operation: ReadUpdateOperation,
      input: unknown,
      key = "key",
      opts = options,
      principal = "alice",
    ) {
      return present(singleton(operation, input, key), 0, unexpectedCreator, opts, principal);
    },
    key(key = "key", principal = "alice") {
      return store.read((reader) => reader.key(principal, key));
    },
    body(id: string) {
      return store.read((reader) => reader.resource(id)?.bodyJson);
    },
    reopen() {
      store.close();
      store = openRecoveryStore(configuration);
      stores.push(store);
    },
  };
}
function retained(state: KeyState) {
  if (state.kind !== "retained") throw Error("expected retained key");
  return state;
}
function creationId(turn: MemberTurn): string {
  if (turn.creator?.kind !== "bound") throw Error("expected private creation binding");
  return turn.creator.id;
}
function code(turn: MemberTurn) {
  return "code" in turn.disposition ? turn.disposition.code : turn.disposition.outcome;
}
const create = { operation: "createBead", idempotencyKey: "maker", name: "made", type };

describe("real member execution and retention", () => {
  it("commits creation with exact guarded envelope/metadata, no-op and alias effects, then replays without renewal across reopen", () => {
    const f = fixture();
    const made = f.run("createBead", { type });
    const id = creationId(made);
    expect(made.storage).toBe("retained");
    expect(code(made)).toBe("created");
    const state = retained(f.key());
    const metadata = parseMemberMetadata(state.resolutionsJson, scope);
    expect(metadata.creation).toEqual(made.creator);
    expect(state.fingerprint).toBe(recoveryIdentityFingerprint(state.semanticIdentityJson));
    expect(JSON.parse(state.outcomeJson)).toMatchObject({
      format: "ru-member-outcome-1",
      operation: "createBead",
      disposition: made.disposition,
    });
    const bytes = f.body(id.slice(scope.length));
    f.reopen();
    f.clock.mockClear();
    f.policyState.now += day * 3;
    expect(f.run("createBead", { type }).storage).toBe("replayed");
    expect(f.key()).toEqual(state);
    expect(f.body(id.slice(scope.length))).toBe(bytes);
    expect(f.clock).not.toHaveBeenCalled();
    const noOp = f.run(
      "updateBeadProperties",
      { bead: id, change: [{ op: "replace", path: "", value: {} }] },
      "noop",
    );
    expect(code(noOp)).toBe("updated");
    expect(f.body(id.slice(scope.length))).toBe(bytes);
    expect(retained(f.key("noop")).effect).toBe("success");
    f.run("putAlias", { alias: "alias/new", target: id }, "put");
    expect(code(f.run("putAlias", { alias: "alias/new", target: id }, "put-again"))).toBe(
      "updated",
    );
    expect(retained(f.key("put-again")).effect).toBe("success");
  });
  it("rolls back validation failure allocations and graph changes, preserving exact failure identity/witnesses", () => {
    let valid = false;
    const f = fixture({
      validate: (_properties, emitter) => {
        if (valid) return { valid: true };
        emitter.emit({
          message: "refused",
          schemaLocation: "https://types.test/schema#",
          instanceLocation: "",
        });
        return { valid: false, diagnosticsComplete: true };
      },
    });
    // Matched pristine database proves counter/identity rollback without raw SQL.
    const copy = directory();
    f.store.close();
    cpSync(f.directory, copy, { recursive: true });
    f.reopen();
    const control = openRecoveryStore({ ...f.configuration, directory: copy });
    stores.push(control);
    const failure = f.run("createBead", { type });
    expect(code(failure)).toBe("validation-failed");
    expect(failure.creator).toEqual({ kind: "unbound" });
    expect(retained(f.key()).effect).toBe("failure");
    valid = true;
    const recovered = f.run("createBead", { type }, "next");
    const carrier = f.singleton("createBead", { type }, "next");
    const admission = control.admit("alice", carrier.keys);
    f.policyState.now = retained(f.key("next")).completedAt - 1;
    const expected = runMember(
      control,
      admission,
      { id: "alice" },
      carrier,
      0,
      unexpectedCreator,
      f.options,
    );
    control.abandonAttempt(admission);
    expect(creationId(recovered)).toBe(creationId(expected));
    expect(f.body(creationId(recovered).slice(scope.length))).toBe(
      control.read((r) => r.resource(creationId(expected).slice(scope.length))?.bodyJson),
    );
    expect(code(f.run("createBead", { type }))).toBe("validation-failed");
  });
  it("classifies current state instead of Admission.states and preserves independent principal namespaces", () => {
    const f = fixture();
    f.policyState.deny = true;
    f.run("createBead", { type }, "failure");
    f.policyState.deny = false;
    const carrier = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [
          { ...create, idempotencyKey: "failure" },
          { ...create, idempotencyKey: "second", name: "second" },
        ],
      }),
    );
    const first = f.store.admit("alice", carrier.keys);
    const duplicate = f.store.admit("alice", carrier.keys);
    expect(first.states[0]?.kind).toBe("retained");
    expect(first.states[1]?.kind).toBe("unknown");
    expect(duplicate.states[1]?.kind).toBe("claimed");
    expect(
      code(
        runMember(f.store, duplicate, { id: "alice" }, carrier, 1, unexpectedCreator, f.options),
      ),
    ).toBe("idempotency-in-progress");
    f.store.expire(retained(f.key("failure")).retainUntil);
    expect(
      runMember(f.store, first, { id: "alice" }, carrier, 0, unexpectedCreator, f.options).storage,
    ).toBe("retained");
    expect(
      runMember(f.store, first, { id: "alice" }, carrier, 1, unexpectedCreator, f.options).storage,
    ).toBe("retained");
    f.store.abandonAttempt(first);
    f.store.abandonAttempt(duplicate);
    expect(code(f.run("createBead", { type }, "failure", f.options, "blocked"))).toBe("forbidden");
    expect(f.key("failure", "blocked")).not.toEqual(f.key("failure", "alice"));
    expect(f.policyState.principals).toContain("blocked");
  });
});

const slots = [
  { operation: "deleteBead", bead: "@made" },
  { operation: "updateBeadProperties", bead: "@made", change: [{ op: "remove", path: "/x" }] },
  { operation: "createLink", type: linkType, source: "@made", target: `${scope}beads/b` },
  {
    operation: "createLink",
    type: linkType,
    source: { uri: "@made", revision: "pin" },
    target: `${scope}beads/b`,
  },
  { operation: "createLink", type: linkType, source: "alias/earlier", target: "@made" },
  {
    operation: "createLink",
    type: linkType,
    source: "alias/earlier",
    target: { uri: "@made", revision: "pin" },
  },
  { operation: "deleteLink", link: "@made" },
  { operation: "updateLinkProperties", link: "@made", change: [{ op: "remove", path: "/x" }] },
  { operation: "putAlias", alias: "alias/new", target: "@made" },
];
describe("dependency and numeric admission order", () => {
  it.each(slots)("transient legal slot consults no key/prior/alias/policy: %j", (input) => {
    const f = fixture();
    const maker =
      "link" in input
        ? {
            ...create,
            operation: "createLink",
            type: linkType,
            source: `${scope}beads/a`,
            target: `${scope}beads/b`,
          }
        : create;
    const carrier = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [
          maker,
          { ...input, idempotencyKey: "dependent" },
          { operation: "createBead", type, idempotencyKey: "tail" },
        ],
      }),
    );
    const admission = f.store.admit("alice", carrier.keys);
    const execute = vi.spyOn(f.store, "executeMember");
    const read = vi.spyOn(f.store, "read");
    const release = vi.spyOn(f.store, "releaseOwnedClaim");
    const result = runMember(
      f.store,
      admission,
      { id: "alice" },
      carrier,
      1,
      () => ({ kind: "transient" }),
      f.options,
    );
    expect(code(result)).toBe("idempotency-in-progress");
    expect(execute).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledExactlyOnceWith(admission, "dependent");
    expect(f.policyState.contextCalls).toBe(0);
    expect(f.clock).not.toHaveBeenCalled();
    expect(f.key("dependent").kind).toBe("unknown");
    expect(
      code(
        runMember(f.store, admission, { id: "alice" }, carrier, 2, unexpectedCreator, f.options),
      ),
    ).toBe("created");
    f.store.abandonAttempt(admission);
  });
  it.each(["owned", "foreign", "retained", "expired"])(
    "transient dependency does not disclose or disturb %s key state",
    (kind) => {
      const f = fixture();
      const carrier = prepareReadUpdateSequence(
        scope,
        stringifyJsonValue({
          operations: [
            create,
            { operation: "deleteBead", bead: "@made", idempotencyKey: "dependent" },
          ],
        }),
      );
      if (kind === "retained" || kind === "expired") {
        f.run("createBead", { type }, "dependent");
        if (kind === "expired") f.store.expire(retained(f.key("dependent")).retainUntil);
      }
      const owner = f.store.admit("alice", carrier.keys);
      const presenter = kind === "foreign" ? f.store.admit("alice", carrier.keys) : owner;
      const before = f.key("dependent");
      expect(
        code(
          runMember(
            f.store,
            presenter,
            { id: "alice" },
            carrier,
            1,
            () => ({ kind: "transient" }),
            f.options,
          ),
        ),
      ).toBe("idempotency-in-progress");
      expect(f.key("dependent")).toEqual(kind === "owned" ? { kind: "unknown" } : before);
      f.store.abandonAttempt(owner);
      f.store.abandonAttempt(presenter);
    },
  );
  it("retains numeric refusal before missing subject/CAS/unbound and preserves exact decimal identity", () => {
    const f = fixture();
    const raw = `{"bead":"beads/missing","expectedRevision":"wrong","change":[{"op":"add","path":"/x","value":9007199254740993}]}`;
    expect(code(f.run("updateBeadProperties", raw))).toBe("validation-failed");
    expect(retained(f.key()).semanticIdentityJson).toContain("9007199254740993");
    expect(
      code(f.run("updateBeadProperties", raw.replace("9007199254740993", "9007199254740992"))),
    ).toBe("idempotency-conflict");
    const carrier = prepareReadUpdateSequence(
      scope,
      `{"operations":[${stringifyJsonValue(create)},{"operation":"updateBeadProperties","idempotencyKey":"dependent","bead":"@made","change":[{"op":"add","path":"/x","value":9007199254740993}]}]}`,
    );
    expect(code(f.present(carrier, 1, () => ({ kind: "unbound" })))).toBe("validation-failed");
    const ready = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [create, { operation: "deleteBead", idempotencyKey: "unbound", bead: "@made" }],
      }),
    );
    expect(code(f.present(ready, 1, () => ({ kind: "unbound" })))).toBe("binding-unavailable");
  });
  it("records all alias/binding witnesses before an early supplied-ID or authorization refusal", () => {
    const f = fixture();
    f.run("putAlias", { alias: "alias/current", target: "beads/a" }, "alias");
    const carrier = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [
          create,
          {
            operation: "createLink",
            idempotencyKey: "dependent",
            type: linkType,
            id: "links/old",
            source: "alias/current",
            target: "@made",
          },
        ],
      }),
    );
    expect(
      code(
        f.present(carrier, 1, () => ({
          kind: "bound",
          id: `${scope}beads/b`,
          resourceKind: "bead",
        })),
      ),
    ).toBe("identity-taken");
    expect(
      parseMemberMetadata(retained(f.key("dependent")).resolutionsJson, scope).witnesses,
    ).toHaveLength(3);
  });
});

describe("retained witnesses, equality and private creator facts", () => {
  it("reuses captures across repoint/direct retry, reuses a recorded miss, and stops a new locator without a wire fallback", () => {
    const f = fixture();
    f.run("putAlias", { alias: "alias/current", target: "beads/a" }, "alias");
    const input = { type: linkType, source: "alias/current", target: "alias/current" };
    const made = f.run("createLink", input);
    const state = f.key();
    f.run("putAlias", { alias: "alias/current", target: "beads/b" }, "repoint");
    expect(f.run("createLink", input).disposition).toEqual(made.disposition);
    expect(
      f.run("createLink", { ...input, source: `${scope}beads/a`, target: `${scope}beads/a` })
        .storage,
    ).toBe("replayed");
    expect(() => f.run("createLink", { ...input, source: "alias/other" })).toThrow(
      UnimplementedAliasRetryError,
    );
    expect(f.key()).toEqual(state);
    f.run("deleteBead", { bead: "alias/missing" }, "miss");
    const miss = f.key("miss");
    f.run("putAlias", { alias: "alias/missing", target: "beads/free" }, "install-miss");
    expect(code(f.run("deleteBead", { bead: "alias/missing" }, "miss"))).toBe("resource-not-found");
    expect(f.key("miss")).toEqual(miss);
    expect(f.body("beads/free")).toBeDefined();
    // A different operation is definitely unequal; new alias cannot force a lookup.
    expect(code(f.run("deleteBead", { bead: "alias/never" }))).toBe("idempotency-conflict");
  });
  it("keeps binding for retained-forbidden creator and independently projects both retained and unknown dependents", () => {
    const f = fixture();
    const carrier = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [
          create,
          {
            operation: "updateBeadProperties",
            bead: "@made",
            change: [{ op: "add", path: "/n", value: 1 }],
            idempotencyKey: "dependent",
          },
        ],
      }),
    );
    const creator = f.present(carrier);
    const binding = creator.creator as MemberCreatorBinding;
    expect(code(f.present(carrier, 1, () => binding))).toBe("updated");
    const state = f.key("maker");
    const dependent = f.key("dependent");
    f.policyState.hidden.add(creationId(creator));
    f.clock.mockClear();
    const denied = f.present(carrier);
    expect(code(denied)).toBe("forbidden");
    expect(denied.storage).toBe("replayed");
    expect(denied.creator).toEqual(binding);
    expect(code(f.present(carrier, 1, () => denied.creator as MemberCreatorBinding))).toBe(
      "forbidden",
    );
    expect(f.key("dependent")).toEqual(dependent);
    const unknown = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [create, { operation: "deleteBead", bead: "@made", idempotencyKey: "new" }],
      }),
    );
    expect(code(f.present(unknown, 1, () => denied.creator as MemberCreatorBinding))).toBe(
      "resource-not-found",
    );
    expect(f.key("maker")).toEqual(state);
    f.policyState.hidden.clear();
    expect(f.present(carrier).disposition).toEqual(creator.disposition);
    expect(f.present(carrier, 1, () => binding).storage).toBe("replayed");
    f.store.expire(retained(f.key("maker")).retainUntil);
    f.reopen();
    const expired = f.present(carrier);
    expect(code(expired)).toBe("idempotency-expired");
    expect(expired.creator).toEqual(binding);
    const conflict = f.run("createBead", { type, properties: { other: true } }, "maker");
    expect(code(conflict)).toBe("idempotency-conflict");
    expect(conflict.creator).toEqual({ kind: "unbound" });
  });
  it("equates renamed labels, re-keyed creators, omitted defaults and exact numeric spelling while preserving pins/context/ordered changes", () => {
    const f = fixture();
    const carrier = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [
          create,
          {
            operation: "createLink",
            type: linkType,
            source: { uri: "@made", revision: "pin" },
            target: "beads/b",
            idempotencyKey: "dependent",
          },
        ],
      }),
    );
    const binding = {
      kind: "bound" as const,
      id: `${scope}beads/a`,
      resourceKind: "bead" as const,
    };
    f.present(carrier, 1, () => binding);
    const renamed = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [
          { ...create, name: "renamed", idempotencyKey: "different" },
          {
            operation: "createLink",
            type: linkType,
            source: { uri: "@renamed", revision: "pin" },
            target: `${scope}beads/b`,
            properties: {},
            changeContext: {},
            idempotencyKey: "dependent",
          },
        ],
      }),
    );
    expect(f.present(renamed, 1, () => binding).storage).toBe("replayed");
    const changed = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [
          create,
          {
            operation: "createLink",
            type: linkType,
            source: { uri: "@made", revision: "other" },
            target: "beads/b",
            idempotencyKey: "dependent",
          },
        ],
      }),
    );
    expect(code(f.present(changed, 1, () => binding))).toBe("idempotency-conflict");
    f.run("createBead", `{"type":"${type}","properties":{"x":1.0}}`, "numeric");
    expect(
      f.run("createBead", `{"properties":{"x":1e0},"type":"${type}"}`, "numeric").storage,
    ).toBe("replayed");
    expect(
      code(
        f.run(
          "createBead",
          { type, properties: { x: 1 }, changeContext: { agent: null } },
          "numeric",
        ),
      ),
    ).toBe("idempotency-conflict");
  });
});

describe("clock, policy snapshot and fault boundaries", () => {
  it("uses actual per-turn preparation-sensitive C and independent terminal observations; admission/replay never sample", () => {
    let advance = () => {};
    const f = fixture({
      owned: true,
      validate: () => {
        advance();
        return { valid: true };
      },
    });
    const carrier = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [
          { ...create, id: "beads/new" },
          {
            operation: "createLink",
            type: linkType,
            source: "beads/a",
            target: "beads/new",
            idempotencyKey: "link",
          },
        ],
      }),
    );
    const admission = f.store.admit("alice", carrier.keys);
    expect(f.clock).not.toHaveBeenCalled();
    advance = () => {
      f.policyState.now = start + 100;
    };
    runMember(f.store, admission, { id: "alice" }, carrier, 0, unexpectedCreator, f.options);
    expect(JSON.parse(f.body("beads/new") ?? "null").changeContext.committedAt.value).toBe(
      new Date(start + 100).toISOString(),
    );
    expect(retained(f.key("maker")).completedAt).toBe(start + 101);
    f.policyState.now = start + 1000;
    runMember(f.store, admission, { id: "alice" }, carrier, 1, unexpectedCreator, f.options);
    const link = JSON.parse(
      f.store.read((r) => r.resources().find((v) => v.kind === "link" && v.id !== "links/old"))
        ?.bodyJson ?? "null",
    );
    const source = JSON.parse(f.body("beads/a") ?? "null");
    expect(source.changeContext).toEqual(link.changeContext);
    expect(source.ownedLinks[linkType].find((v: { id: string }) => v.id === link.id)).toEqual(link);
    expect(retained(f.key("link")).completedAt).toBe(start + 1001);
    expect(f.clock).toHaveBeenCalledTimes(4);
    f.store.abandonAttempt(admission);
    f.clock.mockClear();
    f.present(carrier);
    f.present(carrier, 1);
    expect(f.clock).not.toHaveBeenCalled();
    // Explicit member calls test this module; they are not the future S5 owner.
  });
  it("captures immutable per-turn policy data before a validator mutates backing state, then honors replacement next turn", () => {
    let mutate = () => {};
    const f = fixture({
      validate: () => {
        mutate();
        return { valid: true };
      },
    });
    mutate = () => {
      f.policyState.deny = true;
    };
    expect(code(f.run("createBead", { type }))).toBe("created");
    expect(code(f.run("createBead", { type }, "later"))).toBe("forbidden");
    expect(f.policyState.contextCalls).toBe(2);
  });
  it("copies aggregate data before policy callbacks and enforces replacement across explicit turns", () => {
    const f = fixture();
    const aggregate = [{ endpoint: "source" as const, linkConformsTo: linkType, max: 2 }];
    let firstTurn = true;
    const options: MemberExecutorOptions = {
      ...f.options,
      captureMemberContext(reader, principal) {
        const current = f.options.captureMemberContext(reader, principal);
        return {
          ...current,
          maximumEndpointMultiplicity: aggregate,
          policy: {
            ...current.policy,
            canRead: (input) => {
              // Endpoint visibility precedes aggregate evaluation. A live array
              // would reject count2 here; the captured max2 must still permit it.
              if (firstTurn) {
                firstTurn = false;
                const first = aggregate[0];
                if (!first) throw Error("lost fixture aggregate");
                first.max = 1;
              }
              return current.policy.canRead(input);
            },
          },
        };
      },
    };
    expect(
      code(
        f.run(
          "createLink",
          { type: linkType, source: "beads/a", target: "beads/free" },
          "first",
          options,
        ),
      ),
    ).toBe("created");
    expect(firstTurn).toBe(false);
    const first = aggregate[0];
    if (!first) throw Error("lost fixture aggregate");
    expect(first.max).toBe(1);
    first.max = 3;
    const before = f.store.read((reader) => reader.resources());
    expect(
      code(
        f.run(
          "createLink",
          { type: linkType, source: "beads/a", target: "beads/free" },
          "second",
          options,
        ),
      ),
    ).toBe("created");
    expect(f.store.read((reader) => reader.resources())).toHaveLength(before.length + 1);
    expect(f.store.read((reader) => reader.outgoingLinks("beads/a"))).toHaveLength(3);
    expect(f.policyState.contextCalls).toBe(2);
  });
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER, 8.64e15])(
    "rolls back invalid native observation %s without retaining a Problem",
    (value) => {
      const f = fixture();
      const before = f.store.read((r) => r.resources());
      expect(() =>
        f.run("createBead", { type }, "bad", { ...f.options, clock: () => value }),
      ).toThrow();
      expect(f.key("bad")).toEqual({ kind: "unknown" });
      expect(f.store.read((r) => r.resources())).toEqual(before);
    },
  );
  it("rolls back a late terminal failure after Resource writes and rejects unsupported async clocks without unhandled rejection", async () => {
    const f = fixture();
    const before = f.store.read((r) => r.resources());
    let calls = 0;
    expect(() =>
      f.run("createBead", { type }, "bad", {
        ...f.options,
        clock: () => {
          if (++calls === 2) throw Error("terminal fault");
          return start;
        },
      }),
    ).toThrow("terminal fault");
    expect(calls).toBe(2);
    expect(f.store.read((r) => r.resources())).toEqual(before);
    expect(f.key("bad").kind).toBe("unknown");
    expect(() =>
      f.run("createBead", { type }, "async", {
        ...f.options,
        clock: (() => Promise.reject(Error("async"))) as unknown as () => number,
      }),
    ).toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.key("async").kind).toBe("unknown");
  });
  it("rejects nested store access from the owned clock and does not acknowledge an inconsistent completion", () => {
    const f = fixture();
    expect(() =>
      f.run("createBead", { type }, "nested", {
        ...f.options,
        clock: () => f.store.read(() => start),
      }),
    ).toThrow("nested store access");
    const real = f.store.executeMember.bind(f.store);
    vi.spyOn(f.store, "executeMember").mockImplementation((...args) => {
      const result = real(...args);
      return result.kind === "completed" ? { kind: "completed", outcomeJson: "{}" } : result;
    });
    expect(() => f.run("createBead", { type })).toThrow("completed member differs");
    expect(f.key().kind).toBe("retained");
  });
});

function obj(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
function seedRetained(
  f: ReturnType<typeof fixture>,
  key: string,
  state: ReturnType<typeof retained>,
  patch: Partial<ReturnType<typeof retained>> = {},
) {
  const value = { ...state, ...patch };
  const admission = f.store.admit("alice", [key]);
  f.store.executeMember(admission, key, () => ({
    kind: "retain",
    semanticIdentityJson: value.semanticIdentityJson,
    resolutionsJson: value.resolutionsJson,
    outcomeJson: value.outcomeJson,
    effect: value.effect,
    completedAt: value.completedAt,
    retainUntil: value.retainUntil,
  }));
  f.store.abandonAttempt(admission);
}
function failureProblem(
  code: "forbidden" | "idempotency-in-progress" | "rate-limited" | "temporarily-unavailable",
) {
  return parseReadUpdateProblem({
    type: `https://github.com/gastownhall/bdp/problems/${code === "forbidden" ? "authorization" : code === "idempotency-in-progress" ? "conflict" : code === "rate-limited" ? "rate-limit" : "unavailable"}`,
    code,
    status:
      code === "forbidden"
        ? 403
        : code === "idempotency-in-progress"
          ? 409
          : code === "rate-limited"
            ? 429
            : 503,
    retry: code === "forbidden" ? "after-state-change" : "after-delay",
  });
}
function injectFailure(problem: ReturnType<typeof parseReadUpdateProblem>) {
  // Controlled evaluator result tests only the executor's private decision/S6
  // mapping. This is not a production rate-limit source or qualified policy.
  return vi.spyOn(evaluator, "evaluateResourceMutation").mockReturnValueOnce({
    effect: "failure",
    outcome: problem,
    resolutions: [],
    changed: [],
    deleted: [],
  });
}
describe("stored envelope and metadata integrity", () => {
  it("rejects contradictory evaluator effect before retaining a terminal result", () => {
    const f = fixture();
    vi.spyOn(evaluator, "evaluateResourceMutation").mockReturnValueOnce({
      effect: "success",
      outcome: failureProblem("forbidden"),
      resolutions: [],
      changed: [],
      deleted: [],
    } as unknown as ReturnType<typeof evaluator.evaluateResourceMutation>);
    expect(() => f.run("createBead", { type })).toThrow("evaluator effect differs");
    expect(f.key()).toEqual({ kind: "unknown" });
    expect(f.clock).not.toHaveBeenCalled();
  });
  const envelopeMutations: [string, (envelope: Record<string, unknown>) => unknown][] = [
    [
      "missing format",
      (e) => {
        delete e.format;
        return e;
      },
    ],
    ["unknown format", (e) => ({ ...e, format: "future" })],
    ["array envelope", (e) => [e]],
    ["unknown operation", (e) => ({ ...e, operation: "invented" })],
    ["extra envelope member", (e) => ({ ...e, extra: true })],
    [
      "missing disposition",
      (e) => {
        delete e.disposition;
        return e;
      },
    ],
    ["bare result", (e) => e.disposition],
    ["operation/outcome mismatch", (e) => ({ ...e, operation: "updateBeadProperties" })],
    ["Resource kind mismatch", (e) => ({ ...e, operation: "createLink" })],
    [
      "foreign Resource ID",
      (e) => {
        obj(obj(e.disposition).resource).id = "https://foreign.test/beads/x";
        return e;
      },
    ],
    [
      "wrong Resource root",
      (e) => {
        obj(obj(e.disposition).resource).id = `${scope}links/x`;
        return e;
      },
    ],
    [
      "extra result member",
      (e) => {
        obj(e.disposition).extra = true;
        return e;
      },
    ],
    [
      "positioned result",
      (e) => {
        obj(e.disposition).operationIndex = 0;
        return e;
      },
    ],
    [
      "incomplete source pair",
      (e) => {
        obj(e.disposition).source = `${scope}beads/a`;
        return e;
      },
    ],
  ];
  it.each(envelopeMutations)(
    "rejects %s through the real narrow startup parser",
    (_name, mutate) => {
      const f = fixture();
      f.run("createBead", { type });
      const state = retained(f.key());
      expect(() =>
        assertRetainedOutcomeCompatible(
          { ...state, outcomeJson: stringifyJsonValue(mutate(obj(JSON.parse(state.outcomeJson)))) },
          scope,
          {},
        ),
      ).toThrow();
      expect(f.key()).toEqual(state);
    },
  );
  it.each(["duplicate", "scalar-name", "scalar-value", "syntax", "number"])(
    "rejects %s raw envelope corruption before conversion",
    (variant) => {
      const f = fixture();
      f.run("createBead", { type });
      const state = retained(f.key());
      const corrupt =
        variant === "duplicate"
          ? state.outcomeJson.replace(
              '"operation":"createBead"',
              '"operation":"createBead","oper\\u0061tion":"createBead"',
            )
          : variant === "scalar-name"
            ? state.outcomeJson.replace('"format":', '"\\ud800":1,"format":')
            : variant === "scalar-value"
              ? state.outcomeJson.replace('"ru-member-outcome-1"', '"\\ud800"')
              : variant === "syntax"
                ? "{"
                : state.outcomeJson.replace(
                    '"properties":{}',
                    '"properties":{"bad":9007199254740993}',
                  );
      expect(corrupt).not.toBe(state.outcomeJson);
      expect(() =>
        assertRetainedOutcomeCompatible({ ...state, outcomeJson: corrupt }, scope, {}),
      ).toThrow();
      // Malformed JSON would already be rejected by S6; this is a parser-seam control.
    },
  );
  const metadataMutations: [string, (metadata: Record<string, unknown>) => unknown][] = [
    ["unknown metadata version", (m) => ({ ...m, format: "future" })],
    ["wrong metadata Scope", (m) => ({ ...m, scope: "https://other.test/" })],
    [
      "missing creation",
      (m) => {
        delete m.creation;
        return m;
      },
    ],
    [
      "different creation ID",
      (m) => ({ ...m, creation: { ...obj(m.creation), id: `${scope}beads/other` } }),
    ],
    [
      "wrong creation kind",
      (m) => ({ ...m, creation: { ...obj(m.creation), resourceKind: "link" } }),
    ],
    ["unbound creation", (m) => ({ ...m, creation: { kind: "unbound" } })],
    [
      "stored transient witness",
      (m) => ({
        ...m,
        operation: "deleteBead",
        witnesses: [{ slot: "/bead", kind: "binding", binding: { kind: "transient" } }],
      }),
    ],
    [
      "coherent noncreator metadata with wrong envelope",
      (m) => {
        delete m.creation;
        return {
          ...m,
          operation: "deleteAlias",
          witnesses: [{ slot: "/alias", kind: "direct", uri: `${scope}alias/x` }],
        };
      },
    ],
  ];
  it.each(metadataMutations)("rejects %s through genuine retained key state", (_name, mutate) => {
    const f = fixture();
    f.run("createBead", { type });
    const state = retained(f.key());
    seedRetained(f, "corrupt", state, {
      resolutionsJson: stringifyJsonValue(mutate(obj(JSON.parse(state.resolutionsJson)))),
    });
    const before = f.key("corrupt");
    expect(() => f.run("createBead", { type }, "corrupt")).toThrow();
    expect(f.key("corrupt")).toEqual(before);
  });
  it("rejects unsupported semantic version and mismatched fingerprints before ordinary comparison", () => {
    const f = fixture();
    f.run("createBead", { type });
    const state = retained(f.key());
    seedRetained(f, "version", state, {
      semanticIdentityJson: state.semanticIdentityJson.replace("ru-semantic-value-1", "unknown"),
    });
    expect(() => f.run("createBead", { type }, "version")).toThrow(
      "unsupported retained semantic codec",
    );
    // S6 computes fingerprints itself. Deliberately corrupt only the receiving
    // seam observation on both sides; this is not claimed persisted corruption.
    const execute = f.store.executeMember.bind(f.store);
    const read = f.store.read.bind(f.store);
    const bad = { ...state, fingerprint: "0".repeat(64) };
    vi.spyOn(f.store, "executeMember").mockImplementation((...args) => {
      const result = execute(...args);
      return result.kind === "existing" ? { kind: "existing", state: bad } : result;
    });
    vi.spyOn(f.store, "read").mockImplementation((callback) =>
      read((reader) => callback({ ...reader, key: () => bad })),
    );
    expect(() => f.run("createBead", { type })).toThrow("retained fingerprint differs");
  });
  it.each(["idempotency-in-progress", "rate-limited", "temporarily-unavailable"] as const)(
    "releases fresh %s, rejects retained transient and preserves independent tail",
    (condition) => {
      const f = fixture();
      const transient = failureProblem(condition);
      injectFailure(transient);
      const result = f.run("createBead", { type });
      expect(result.storage).toBe("released");
      expect(result.creator).toEqual({ kind: "transient" });
      expect(f.key().kind).toBe("unknown");
      expect(f.clock).not.toHaveBeenCalled();
      expect(() =>
        assertRetainedOutcomeCompatible(
          {
            outcomeJson: stringifyJsonValue({
              format: "ru-member-outcome-1",
              operation: "createBead",
              disposition: transient,
            }),
            effect: "failure",
            completedAt: start,
            retainUntil: start + day,
          },
          scope,
          {},
        ),
      ).toThrow("cannot be retained");
      expect(code(f.run("createBead", { type }, "tail"))).toBe("created");
    },
  );
  it.each(["idempotency-conflict", "idempotency-expired"])(
    "rejects stored projection %s",
    (condition) => {
      const f = fixture();
      const disposition = parseReadUpdateProblem({
        type: `https://github.com/gastownhall/bdp/problems/${condition === "idempotency-expired" ? "gone" : "conflict"}`,
        code: condition,
        retry: "never",
        status: condition === "idempotency-expired" ? 410 : 409,
      });
      expect(() =>
        assertRetainedOutcomeCompatible(
          {
            outcomeJson: stringifyJsonValue({
              format: "ru-member-outcome-1",
              operation: "createBead",
              disposition,
            }),
            effect: "failure",
            completedAt: start,
            retainUntil: start + day,
          },
          scope,
          f.options.limits,
        ),
      ).toThrow();
    },
  );
  it("preserves optional Problem status/extensions, but rejects position, wrong tuples/effects and impossible fields", () => {
    const f = fixture();
    const disposition = parseReadUpdateProblem({
      type: "https://github.com/gastownhall/bdp/problems/authorization",
      code: "forbidden",
      retry: "after-state-change",
      extra: { operationIndex: 100, scalar: "🌙" },
      extension: { outcome: "permitted nested name" },
    });
    injectFailure(disposition);
    const first = f.run("createBead", { type });
    const state = retained(f.key());
    expect(first.disposition).not.toHaveProperty("status");
    expect(first.creator).toEqual({ kind: "unbound" });
    expect(first.storage).toBe("retained");
    f.policyState.hidden.add(`${scope}beads/a`);
    expect(f.run("createBead", { type }).disposition).toEqual(first.disposition);
    expect(f.key()).toEqual(state);
    const bad = [
      { ...disposition, operationIndex: 0 },
      { ...disposition, operationName: "position" },
      { ...disposition, status: 400 },
      { ...disposition, retry: "never" },
      { ...disposition, retryAfter: 2 },
      { ...disposition, diagnostics: [{ message: "wrong" }] },
      {
        type: "https://github.com/gastownhall/bdp/problems/validation",
        code: "validation-failed",
        retry: "never",
      },
    ];
    for (const value of bad)
      expect(() =>
        assertRetainedOutcomeCompatible(
          {
            ...state,
            outcomeJson: stringifyJsonValue({
              format: "ru-member-outcome-1",
              operation: "createBead",
              disposition: value,
            }),
          },
          scope,
          {},
        ),
      ).toThrow();
    expect(() =>
      assertRetainedOutcomeCompatible({ ...state, effect: "success" }, scope, {}),
    ).toThrow("effect differs");
    const successful = f.run("createBead", { type }, "created");
    expect(successful.creator?.kind).toBe("bound");
    expect(() =>
      assertRetainedOutcomeCompatible(
        { ...retained(f.key("created")), effect: "failure" },
        scope,
        {},
      ),
    ).toThrow("effect differs");
  });
  it("accepts external Type IDs/opaque endpoints and validates alias Scope, roots and closed variants", () => {
    const f = fixture();
    const result = f.run("createLink", {
      type: linkType,
      source: "beads/a",
      target: "urn:opaque:outside",
    });
    expect(code(result)).toBe("created");
    const state = retained(f.key());
    assertRetainedOutcomeCompatible(state, scope, {});
    expect(
      f.run("createLink", { type: linkType, source: "beads/a", target: "urn:opaque:outside" })
        .storage,
    ).toBe("replayed");
    f.run("putAlias", { alias: "alias/new", target: "beads/a" }, "alias");
    const alias = retained(f.key("alias"));
    for (const patch of [
      { alias: "https://other.test/alias/new" },
      { alias: `${scope}beads/new` },
      { target: "https://other.test/beads/a" },
      { target: `${scope}links/old` },
      { revision: "bad" },
      { outcome: "deleted" },
    ]) {
      const envelope = obj(JSON.parse(alias.outcomeJson));
      envelope.disposition = { ...obj(envelope.disposition), ...patch };
      expect(() =>
        assertRetainedOutcomeCompatible(
          { ...alias, outcomeJson: stringifyJsonValue(envelope) },
          scope,
          {},
        ),
      ).toThrow();
    }
  });
  it("checks supplied-ID/creation coherence and malformed expired creation without inventing an expired codec marker", () => {
    const f = fixture();
    f.run("createBead", { id: "beads/supplied", type });
    const state = retained(f.key());
    const metadata = obj(JSON.parse(state.resolutionsJson));
    obj(metadata.creation).id = `${scope}beads/other`;
    seedRetained(f, "bad", state, { resolutionsJson: stringifyJsonValue(metadata) });
    expect(() => f.run("createBead", { id: "beads/supplied", type }, "bad")).toThrow();
    const missing = obj(JSON.parse(state.resolutionsJson));
    delete missing.creation;
    seedRetained(f, "expired", state, { resolutionsJson: stringifyJsonValue(missing) });
    f.store.expire(state.retainUntil);
    expect(f.key("expired")).not.toHaveProperty("semanticIdentityJson");
    expect(f.key("expired")).not.toHaveProperty("outcomeJson");
    expect(() => f.run("createBead", { id: "beads/supplied", type }, "expired")).toThrow(
      "expired creator",
    );
  });
});

describe("configuration, deep durable values and startup boundary", () => {
  it.each([
    "count",
    "bytes",
    "retention",
    "floor",
    "scope",
    "principal",
    "keys",
    "carrier",
    "index",
  ])("refuses mismatched %s before key access/effects", (variant) => {
    const f = fixture();
    const carrier = f.singleton("createBead", { type });
    const admission = f.store.admit("alice", carrier.keys);
    const execute = vi.spyOn(f.store, "executeMember");
    const read = vi.spyOn(f.store, "read");
    const options =
      variant === "count"
        ? { ...f.options, numericBudget: { ...f.options.numericBudget, diagnostics: 1 } }
        : variant === "bytes"
          ? { ...f.options, numericBudget: { ...f.options.numericBudget, diagnosticBytes: 1000 } }
          : variant === "retention"
            ? { ...f.options, retentionMs: day - 1 }
            : variant === "floor"
              ? { ...f.options, minimumRetentionMs: day + 1 }
              : variant === "scope"
                ? { ...f.options, scope: "https://other.test/" }
                : f.options;
    const presented =
      variant === "keys"
        ? f.singleton("createBead", { type }, "other")
        : variant === "carrier"
          ? { ...carrier }
          : carrier;
    expect(() =>
      runMember(
        f.store,
        admission,
        { id: variant === "principal" ? "bob" : "alice" },
        presented,
        variant === "index" ? 2 : 0,
        unexpectedCreator,
        options,
      ),
    ).toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    f.store.abandonAttempt(admission);
  });
  it("rejects another real store's Admission and guards numeric diagnostic count/actual UTF-8 bytes/truncation", () => {
    const f = fixture();
    const other = fixture();
    const carrier = f.singleton("createBead", { type });
    const admission = other.store.admit("alice", carrier.keys);
    expect(() =>
      runMember(f.store, admission, { id: "alice" }, carrier, 0, unexpectedCreator, f.options),
    ).toThrow("admission is not owned");
    expect(f.key()).toEqual({ kind: "unknown" });
    other.store.abandonAttempt(admission);
    const options = {
      ...f.options,
      limits: { diagnosticCount: 1, diagnosticBytes: 512 },
      numericBudget: {
        diagnostics: 1,
        diagnosticBytes: 512,
        diagnostic: ({ pointer }: { pointer: string }) => ({
          message: "invalid 🌙",
          instanceLocation: pointer,
        }),
      },
    };
    const result = f.run(
      "createBead",
      `{"type":"${type}","properties":{"a":9007199254740993,"b":9007199254740995}}`,
      "numbers",
      options,
    );
    expect(result.disposition).toMatchObject({
      code: "validation-failed",
      diagnostics: [{ message: "invalid 🌙", instanceLocation: "/properties/a" }],
      diagnosticsTruncated: true,
    });
    const state = retained(f.key("numbers"));
    assertRetainedOutcomeCompatible(state, scope, options.limits);
    expect(() => assertRetainedOutcomeCompatible(state, scope, { diagnosticBytes: 1 })).toThrow();
  });
  it("retains/reopens/replays/scans 12,000-deep created and updated Resources without a hidden depth cap", () => {
    const f = fixture();
    const depth = 12_000;
    const deep = `${'{"child":'.repeat(depth)}1${"}".repeat(depth)}`;
    const created = f.run("createBead", `{"type":"${type}","properties":${deep}}`);
    const id = creationId(created);
    const original = retained(f.key());
    const originalBody = f.body(id.slice(scope.length));
    f.reopen();
    expect(f.run("createBead", `{"properties":${deep},"type":"${type}"}`).storage).toBe("replayed");
    expect(retained(f.key()).outcomeJson).toBe(original.outcomeJson);
    expect(f.body(id.slice(scope.length))).toBe(originalBody);
    f.run(
      "updateBeadProperties",
      `{"bead":"${id}","change":[{"op":"add","path":"/other","value":${deep}}]}`,
      "update",
    );
    const updated = retained(f.key("update"));
    f.reopen();
    expect(
      f.run(
        "updateBeadProperties",
        `{"bead":"${id}","change":[{"op":"add","path":"/other","value":${deep}}]}`,
        "update",
      ).storage,
    ).toBe("replayed");
    expect(retained(f.key("update")).outcomeJson).toBe(updated.outcomeJson);
    let visits = 0;
    f.store.visitRetainedOutcomes((row) => {
      assertRetainedOutcomeCompatible(row, scope, {});
      visits++;
    });
    expect(visits).toBe(2);
    const content = JSON.parse(f.body(id.slice(scope.length)) ?? "null");
    let leaf = content.properties.other;
    for (let i = 0; i < depth; i++) leaf = leaf.child;
    expect(leaf).toBe(1);
  });
  it("preserves permitted 12,000-deep Problem extensions through actual retention/reopen/replay/startup", () => {
    const f = fixture();
    let extension: unknown = { operationIndex: 3, operationName: "ordinary data" };
    for (let i = 0; i < 12_000; i++) extension = { child: extension };
    const disposition = parseReadUpdateProblem({ ...failureProblem("forbidden"), extension });
    injectFailure(disposition);
    const first = f.run("createBead", { type });
    expect(first.creator).toEqual({ kind: "unbound" });
    const state = retained(f.key());
    f.reopen();
    const replay = f.run("createBead", { type });
    expect(stringifyJsonValue(replay.disposition)).toBe(stringifyJsonValue(first.disposition));
    expect(retained(f.key()).outcomeJson).toBe(state.outcomeJson);
    f.store.visitRetainedOutcomes((row) => assertRetainedOutcomeCompatible(row, scope, {}));
  });
});

describe("whole-plan cross-boundary regression controls", () => {
  it("captures one fresh alias resolution for repeated slots and performs no live alias lookup on replay", () => {
    const f = fixture();
    f.run("putAlias", { alias: "alias/current", target: "beads/a" }, "alias");
    let calls = 0;
    const execute = f.store.executeMember.bind(f.store);
    vi.spyOn(f.store, "executeMember").mockImplementation((admission, key, evaluate) =>
      execute(admission, key, (tx) =>
        evaluate({
          ...tx,
          alias(path) {
            calls++;
            return tx.alias(path);
          },
        }),
      ),
    );
    f.run("createLink", { type: linkType, source: "alias/current", target: "alias/current" });
    expect(calls).toBe(1);
    const read = f.store.read.bind(f.store);
    vi.spyOn(f.store, "read").mockImplementation((callback) =>
      read((reader) =>
        callback({
          ...reader,
          alias() {
            throw Error("live replay alias forbidden");
          },
        }),
      ),
    );
    expect(
      f.run("createLink", { type: linkType, source: "alias/current", target: "alias/current" })
        .storage,
    ).toBe("replayed");
    expect(calls).toBe(1);
  });
  it("captures the clock/limits before creator callbacks can replace the supplied configuration", () => {
    const f = fixture();
    const clock = vi.fn(() => start);
    const supplied: MemberExecutorOptions & {
      clock: () => number;
      limits: { representationBytes: number };
    } = { ...f.options, clock, limits: { representationBytes: 10_000 } };
    const carrier = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [
          create,
          {
            operation: "createLink",
            type: linkType,
            source: "@made",
            target: "beads/b",
            idempotencyKey: "dependent",
          },
        ],
      }),
    );
    const result = f.present(
      carrier,
      1,
      () => {
        supplied.clock = () => {
          throw Error("replacement clock");
        };
        supplied.limits.representationBytes = 1;
        return { kind: "bound", id: `${scope}beads/a`, resourceKind: "bead" };
      },
      supplied,
    );
    expect(code(result)).toBe("created");
    expect(clock).toHaveBeenCalledTimes(2);
  });
  it("uses actual UTF-8 diagnostic list bytes at N/N-1 and reports truncation only for another omitted refusal", () => {
    const f = fixture();
    const message = "🌙".repeat(150);
    const entry = { message, instanceLocation: "/properties/a" };
    const bytes = Buffer.byteLength(stringifyJsonValue([entry]));
    const options = (cap: number): MemberExecutorOptions => ({
      ...f.options,
      limits: { diagnosticBytes: cap },
      numericBudget: {
        diagnosticBytes: cap,
        diagnostic: ({ pointer }) => ({ message, instanceLocation: pointer }),
      },
    });
    const raw = `{"type":"${type}","properties":{"a":9007199254740993}}`;
    const exact = f.run("createBead", raw, "exact", options(bytes));
    expect(exact.disposition).not.toHaveProperty("diagnosticsTruncated");
    const state = retained(f.key("exact"));
    assertRetainedOutcomeCompatible(state, scope, { diagnosticBytes: bytes });
    expect(() =>
      assertRetainedOutcomeCompatible(state, scope, { diagnosticBytes: bytes - 1 }),
    ).toThrow("surviving retained diagnostics");
    expect(() => f.run("createBead", raw, "small", options(bytes - 1))).toThrow("first entry");
    expect(f.key("small").kind).toBe("unknown");
    expect(
      f.run("createBead", raw.replace("}}", ',"b":9007199254740995}}'), "two", options(bytes))
        .disposition,
    ).toMatchObject({ diagnosticsTruncated: true });
  });
  it("rejects invalid required, duplicate, out-of-order and inconsistent captured metadata using actual stored Link outcomes", () => {
    const f = fixture();
    f.run("putAlias", { alias: "alias/current", target: "beads/a" }, "alias");
    f.run("createLink", { type: linkType, source: "alias/current", target: "alias/current" });
    const state = retained(f.key());
    const original = obj(JSON.parse(state.resolutionsJson));
    const witnesses = original.witnesses as Record<string, unknown>[];
    const variants = [
      [],
      [witnesses[0]],
      [witnesses[0], witnesses[0]],
      [...witnesses].reverse(),
      [witnesses[0], { ...witnesses[1], target: `${scope}beads/b` }],
      [
        {
          slot: "/id",
          kind: "binding",
          binding: { kind: "bound", id: `${scope}links/x`, resourceKind: "link" },
        },
        ...witnesses,
      ],
    ];
    for (const [index, invalid] of variants.entries()) {
      const key = `bad-${index}`;
      seedRetained(f, key, state, {
        resolutionsJson: stringifyJsonValue({ ...original, witnesses: invalid }),
      });
      const before = f.key(key);
      expect(() =>
        f.run(
          "createLink",
          { type: linkType, source: "alias/current", target: "alias/current" },
          key,
        ),
      ).toThrow();
      expect(f.key(key)).toEqual(before);
    }
    // Even structurally valid same-operation metadata must agree with the exact
    // owner's encoded references; it cannot lend a different hidden identity.
    const direct = {
      ...original,
      witnesses: [
        { slot: "/source", kind: "direct", uri: `${scope}beads/b` },
        { slot: "/target", kind: "direct", uri: `${scope}beads/b` },
      ],
    };
    seedRetained(f, "different", state, { resolutionsJson: stringifyJsonValue(direct) });
    expect(() =>
      f.run("createLink", { type: linkType, source: "beads/a", target: "beads/a" }, "different"),
    ).toThrow();
  });
  it("does not infer a creator for an expired successful no-op and detects a contradictory existing-state reread", () => {
    const f = fixture();
    const input = { bead: "beads/free", change: [{ op: "replace", path: "/n", value: 0 }] };
    f.run("updateBeadProperties", input);
    const state = retained(f.key());
    f.store.expire(state.retainUntil);
    const expired = f.run("updateBeadProperties", input);
    expect(expired.storage).toBe("expired");
    expect(expired).not.toHaveProperty("creator");
    const read = f.store.read.bind(f.store);
    vi.spyOn(f.store, "read").mockImplementation((callback) =>
      read((reader) => callback({ ...reader, key: () => ({ kind: "unknown" }) })),
    );
    expect(() => f.run("updateBeadProperties", input)).toThrow("existing key changed");
  });
  it("preserves ordered patches, CAS and attribution in retained identity", () => {
    const f = fixture();
    const input = {
      bead: "beads/free",
      change: [
        { op: "add", path: "/x", value: 1 },
        { op: "replace", path: "/x", value: 2 },
      ],
      expectedRevision: "r0",
    };
    f.run("updateBeadProperties", input);
    expect(
      code(f.run("updateBeadProperties", { ...input, change: [...input.change].reverse() })),
    ).toBe("idempotency-conflict");
    expect(code(f.run("updateBeadProperties", { ...input, expectedRevision: "r1" }))).toBe(
      "idempotency-conflict",
    );
    const attributable = f.singleton(
      "createBead",
      { type, attribution: { principal: "human:alice", status: "claimed" } },
      "actor",
    );
    f.present(attributable);
    expect(
      code(
        f.run(
          "createBead",
          { type, attribution: { principal: "human:bob", status: "claimed" } },
          "actor",
        ),
      ),
    ).toBe("idempotency-conflict");
  });
});

describe("complete source-council correction batch", () => {
  it("keeps singleton Problems open but refuses non-positionable retained Problems without effects", () => {
    const f = fixture();
    const ordinary = parseReadUpdateProblem({
      ...failureProblem("forbidden"),
      extra: { outcome: "nested data", operationIndex: 4 },
    });
    expect(parseReadUpdateSequenceMemberProblem({ ...ordinary, operationIndex: 0 })).toMatchObject(
      ordinary,
    );
    const reserved = parseReadUpdateProblem({ ...ordinary, outcome: "reserved in sequence" });
    expect(() =>
      parseReadUpdateSequenceMemberProblem({ ...reserved, operationIndex: 0 }),
    ).toThrow();
    const before = f.store.read((reader) => reader.resources());
    vi.spyOn(evaluator, "evaluateResourceMutation").mockImplementationOnce((tx) => {
      tx.deleteResource("beads/free");
      return { effect: "failure", outcome: reserved, resolutions: [], changed: [], deleted: [] };
    });
    expect(() => f.run("createBead", { type })).toThrow("positionable");
    expect(f.key()).toEqual({ kind: "unknown" });
    expect(f.store.read((reader) => reader.resources())).toEqual(before);
    expect(f.clock).not.toHaveBeenCalled();
    injectFailure(ordinary);
    f.run("createBead", { type }, "good");
    const good = retained(f.key("good"));
    const bad = {
      ...good,
      outcomeJson: stringifyJsonValue({
        format: "ru-member-outcome-1",
        operation: "createBead",
        disposition: reserved,
      }),
    };
    // Valid opaque JSON is accepted by S6, but impossible under this writer.
    seedRetained(f, "bad", bad);
    const stored = f.key("bad");
    expect(() => f.run("createBead", { type }, "bad")).toThrow("positionable");
    expect(f.key("bad")).toEqual(stored);
    expect(() =>
      f.store.visitRetainedOutcomes((row) => assertRetainedOutcomeCompatible(row, scope, {})),
    ).toThrow("positionable");
    const sequence = prepareReadUpdateSequence(
      scope,
      stringifyJsonValue({
        operations: [{ operation: "createBead", type, name: "current", idempotencyKey: "good" }],
      }),
    );
    const replay = f.present(sequence);
    expect(replay.storage).toBe("replayed");
    expect(replay.disposition).toEqual(ordinary);
    expect(
      parseReadUpdateSequenceMemberProblem({
        ...replay.disposition,
        operationIndex: 0,
        operationName: "current",
      }),
    ).toMatchObject(ordinary);
    expect(f.key("good")).toEqual(good);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER - day + 1])(
    "rejects invalid terminal/overflow value %s after a valid native C and rolls back",
    (invalid) => {
      const f = fixture();
      const before = f.store.read((reader) => reader.resources());
      const clock = vi.fn().mockReturnValueOnce(start).mockReturnValueOnce(invalid);
      expect(() => f.run("createBead", { type }, "bad", { ...f.options, clock })).toThrow(
        "safe nonnegative epoch",
      );
      expect(clock).toHaveBeenCalledTimes(2);
      expect(f.key("bad")).toEqual({ kind: "unknown" });
      expect(f.store.read((reader) => reader.resources())).toEqual(before);
    },
  );
  it("accepts terminal epoch counters outside native Date range when retention remains safe", () => {
    const f = fixture();
    const completedAt = Number.MAX_SAFE_INTEGER - day;
    const clock = vi.fn().mockReturnValueOnce(start).mockReturnValueOnce(completedAt);
    expect(f.run("createBead", { type }, "large", { ...f.options, clock }).storage).toBe(
      "retained",
    );
    expect(clock).toHaveBeenCalledTimes(2);
    expect(retained(f.key("large"))).toMatchObject({
      completedAt,
      retainUntil: Number.MAX_SAFE_INTEGER,
    });
  });
  it("sinks a rejected terminal Promise after valid C and rolls back before returning", async () => {
    const f = fixture();
    const before = f.store.read((reader) => reader.resources());
    let calls = 0;
    const clock = (() =>
      ++calls === 1 ? start : Promise.reject(Error("terminal rejection"))) as () => number;
    expect(() => f.run("createBead", { type }, "bad", { ...f.options, clock })).toThrow(
      "terminal clock must be synchronous",
    );
    expect(calls).toBe(2);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.key("bad")).toEqual({ kind: "unknown" });
    expect(f.store.read((reader) => reader.resources())).toEqual(before);
  });
  it("rejects a configured S6 floor below one day independently of retention versus floor", () => {
    const f = fixture();
    const before = f.store.read((reader) => reader.resources());
    const execute = vi.spyOn(f.store, "executeMember");
    expect(() =>
      f.run("createBead", { type }, "bad", {
        ...f.options,
        minimumRetentionMs: day - 1,
        retentionMs: day,
      }),
    ).toThrow("configured S6 floor");
    expect(execute).not.toHaveBeenCalled();
    expect(f.clock).not.toHaveBeenCalled();
    expect(f.key("bad")).toEqual({ kind: "unknown" });
    expect(f.store.read((reader) => reader.resources())).toEqual(before);
  });

  it.each(["alias", "binding"] as const)(
    "refuses expired impossible-success %s witnesses before equality or operation conflict",
    (kind) => {
      const f = fixture();
      const carrier = (key: string) =>
        prepareReadUpdateSequence(
          scope,
          stringifyJsonValue({
            operations: [create, { operation: "deleteBead", bead: "@made", idempotencyKey: key }],
          }),
        );
      if (kind === "alias") f.run("deleteBead", { bead: "alias/missing" }, "origin");
      else f.present(carrier("origin"), 1, () => ({ kind: "unbound" }));
      const failure = retained(f.key("origin"));
      expect(failure.effect).toBe("failure");
      // S6 is opaque: seed the failure's metadata as an impossible success and
      // let actual expiry erase the outcome/identity, without SQL or new format.
      seedRetained(f, "bad", failure, { effect: "success" });
      f.store.expire(failure.retainUntil);
      const expired = f.key("bad");
      expect(expired.kind).toBe("expired");
      expect(() =>
        kind === "alias"
          ? f.run("deleteBead", { bead: "alias/missing" }, "bad")
          : f.present(carrier("bad"), 1, () => ({ kind: "unbound" })),
      ).toThrow("successful member has unavailable witnesses");
      expect(() => f.run("createBead", { type }, "bad")).toThrow(
        "successful member has unavailable witnesses",
      );
      expect(f.key("bad")).toEqual(expired);
    },
  );

  it.each(["owned", "retained"])(
    "rechecks the original principal after creator preparation on %s path",
    (path) => {
      const f = fixture();
      const carrier = prepareReadUpdateSequence(
        scope,
        stringifyJsonValue({
          operations: [
            create,
            {
              operation: "createLink",
              type: linkType,
              source: "@made",
              target: "beads/b",
              idempotencyKey: "dependent",
            },
          ],
        }),
      );
      const binding = {
        kind: "bound" as const,
        id: `${scope}beads/a`,
        resourceKind: "bead" as const,
      };
      if (path === "retained") f.present(carrier, 1, () => binding);
      const principal = { id: "alice" };
      const admission = f.store.admit(principal.id, carrier.keys);
      const before = f.store.read((reader) => reader.resources());
      const state = f.key("dependent");
      const capture = vi.fn(f.options.captureMemberContext);
      try {
        expect(() =>
          runMember(
            f.store,
            admission,
            principal,
            carrier,
            1,
            () => {
              principal.id = "blocked";
              return binding;
            },
            { ...f.options, captureMemberContext: capture },
          ),
        ).toThrow("principal changed");
      } finally {
        f.store.abandonAttempt(admission);
      }
      expect(capture).not.toHaveBeenCalled();
      expect(f.store.read((reader) => reader.resources())).toEqual(before);
      expect(f.key("dependent")).toEqual(path === "owned" ? { kind: "unknown" } : state);
    },
  );

  it("gives context capture exactly nine frozen reader methods with original S6 lifetimes on owned and replay paths", () => {
    const f = fixture();
    const escaped: StoreReader[] = [];
    const names = [
      "resource",
      "resources",
      "incidentLinks",
      "outgoingLinks",
      "alias",
      "identityWasCommitted",
      "installedType",
      "policy",
      "key",
    ];
    const options: MemberExecutorOptions = {
      ...f.options,
      captureMemberContext(reader, principal) {
        escaped.push(reader);
        expect(Object.keys(reader).sort()).toEqual([...names].sort());
        expect(Object.isFrozen(reader)).toBe(true);
        for (const writer of [
          "putResource",
          "deleteResource",
          "putPolicy",
          "putAlias",
          "deleteAlias",
          "allocateRevision",
          "allocateResourceId",
        ])
          expect(reader).not.toHaveProperty(writer);
        expect(reader.resource("beads/a")?.id).toBe("beads/a");
        expect(reader.resources().length).toBeGreaterThanOrEqual(4);
        expect(reader.incidentLinks("beads/a")).toHaveLength(1);
        expect(reader.outgoingLinks("beads/a")).toHaveLength(1);
        expect(reader.alias("missing")).toBeUndefined();
        expect(reader.identityWasCommitted("beads/a")).toBe(true);
        expect(reader.installedType(type)).toContain('"describes":"bead"');
        expect(reader.policy("missing")).toBeUndefined();
        expect(reader.key(principal.id, "key").kind).toBe(
          escaped.length === 1 ? "claimed" : "retained",
        );
        return f.options.captureMemberContext(reader, principal);
      },
    };
    expect(f.run("createBead", { type }, "key", options).storage).toBe("retained");
    expect(f.run("createBead", { type }, "key", options).storage).toBe("replayed");
    expect(escaped).toHaveLength(2);
    for (const reader of escaped) {
      const attempts = [
        () => reader.resource("beads/a"),
        () => reader.resources(),
        () => reader.incidentLinks("beads/a"),
        () => reader.outgoingLinks("beads/a"),
        () => reader.alias("missing"),
        () => reader.identityWasCommitted("beads/a"),
        () => reader.installedType(type),
        () => reader.policy("missing"),
        () => reader.key("alice", "key"),
      ];
      for (const attempt of attempts) expect(attempt).toThrow(/expired.*facade/);
    }
  });
});
