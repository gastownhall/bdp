import {
  type JsonNumberDiagnosticBudget,
  type PreparedReadUpdateCarrier,
  type ReadUpdateOperation,
  prepareReadUpdateSequence,
  prepareReadUpdateSingleton,
} from "@bdp/protocol";
import { describe, expect, it, vi } from "vitest";
import { evaluateResourceMutation, type ResourceTransaction } from "./resource-evaluator.js";
import {
  type MemberIdentityContext,
  type MemberMetadata,
  type NormalizedMemberIdentity,
  MemberMetadataError,
  capturedMemberAlias,
  normalizeMemberIdentity,
  normalizePreparedMemberIdentity,
  prepareMemberDependencies,
  type PreparedMemberDependencies,
  parseMemberMetadata,
  prepareMemberExecution,
  serializeMemberMetadata,
} from "./member-identity.js";

const scope = "https://example.test/s/";
const type = "https://types.example/task";
const linkType = "https://types.example/relation";
const a = `${scope}beads/a`;
const b = `${scope}beads/b`;
const budget: JsonNumberDiagnosticBudget = {
  diagnostic: ({ pointer }) => ({
    message: "number does not round-trip",
    instanceLocation: pointer,
  }),
};
function singleton(operation: ReadUpdateOperation, input: unknown, key = "key") {
  return prepareReadUpdateSingleton(scope, operation, JSON.stringify(input), key);
}
function sequence(operations: unknown[]) {
  return prepareReadUpdateSequence(scope, JSON.stringify({ operations }));
}
function context(patch: Partial<MemberIdentityContext> = {}): MemberIdentityContext {
  return {
    scope,
    resolveAlias: () => {
      throw Error("unexpected alias lookup");
    },
    creatorBinding: () => {
      throw Error("unexpected creator lookup");
    },
    ...patch,
  };
}
function ready(
  carrier: PreparedReadUpdateCarrier,
  index = 0,
  patch: Partial<MemberIdentityContext> = {},
): NormalizedMemberIdentity {
  const result = normalizeMemberIdentity(carrier, index, context(patch));
  if (result.kind !== "ready") throw Error(`unexpected normalization ${result.kind}`);
  return result;
}
function metadata(member: NormalizedMemberIdentity): MemberMetadata {
  return parseMemberMetadata(serializeMemberMetadata(member), scope);
}
function execution(member: NormalizedMemberIdentity) {
  const result = prepareMemberExecution(member, budget);
  if (!result.executable) throw Error("expected executable values");
  return result.executable;
}
const create = { operation: "createBead", idempotencyKey: "creator", name: "made", type };

describe("exact member identity normalization", () => {
  it("equates singleton/sequence, defaults, canonical relative references and renamed envelope data", () => {
    const one = ready(singleton("createBead", { type, id: "beads/a" }, "FIRST"));
    const two = ready(
      sequence([
        {
          operation: "createBead",
          idempotencyKey: "SECOND",
          name: "elsewhere",
          id: a,
          type,
          properties: {},
        },
      ]),
    );
    expect(one.identityJson).toBe(two.identityJson);
    expect(one.metadata.witnesses).toEqual([{ slot: "/id", kind: "direct", uri: a }]);
    expect(JSON.parse(one.identityJson)[0]).toBe("ru-semantic-value-1");
    expect(execution(one)).toMatchObject({ operation: "createBead", input: { id: a, type } });
    expect(one.metadata).not.toHaveProperty("idempotencyKey");
    expect(two.metadata).not.toHaveProperty("name");
    expect(two.metadata).not.toHaveProperty("operationIndex");
  });
  it("does not insert an allocated identity or generated attribution/context into omitted input", () => {
    const one = ready(singleton("createBead", { type }));
    const supplied = ready(singleton("createBead", { type, id: a }));
    expect(one.identityJson).not.toBe(supplied.identityJson);
    const result = execution(one);
    expect(result.input).not.toHaveProperty("id");
    expect(result.input).not.toHaveProperty("changeContext");
    expect(result.input).not.toHaveProperty("attribution");
  });
  it.each([
    { expectedRevision: "r2" },
    { changeContext: {} },
    { changeContext: { message: null } },
    { changeContext: { message: "" } },
    { attribution: { principal: "other", status: "claimed" } },
  ])("preserves meaningful request context and CAS differences %#", (extra) => {
    const base = { bead: a, change: [{ op: "add", path: "/value", value: 1 }] };
    expect(ready(singleton("updateBeadProperties", { ...base, ...extra })).identityJson).not.toBe(
      ready(singleton("updateBeadProperties", base)).identityJson,
    );
  });
  it("preserves operation kind and patch array order, ignoring object order", () => {
    const change = [
      { op: "add", path: "/a", value: 1 },
      { op: "remove", path: "/a" },
    ];
    const one = ready(singleton("updateBeadProperties", { bead: "beads/a", change }));
    const ordered = ready(singleton("updateBeadProperties", { change, bead: a }));
    const reversed = ready(
      singleton("updateBeadProperties", { bead: a, change: [...change].reverse() }),
    );
    expect(one.identityJson).toBe(ordered.identityJson);
    expect(one.identityJson).not.toBe(reversed.identityJson);
    expect(ready(singleton("deleteBead", { bead: a })).identityJson).not.toBe(
      ready(singleton("deleteLink", { link: a })).identityJson,
    );
  });
  it("keeps property, patch-value, and context strings opaque", () => {
    const resolveAlias = vi.fn(() => b);
    const input = {
      type,
      properties: { source: "alias/x", target: "@made", nested: { uri: a } },
      changeContext: { message: "alias/x" },
    };
    const member = ready(singleton("createBead", input), 0, { resolveAlias });
    expect(execution(member).input).toEqual(input);
    expect(member.metadata.witnesses).toEqual([]);
    expect(resolveAlias).not.toHaveBeenCalled();
    const patch = ready(
      singleton("updateBeadProperties", {
        bead: a,
        change: [{ op: "add", path: "/target", value: "alias/x" }],
      }),
      0,
      { resolveAlias },
    );
    expect(execution(patch).input).toMatchObject({ change: [{ value: "alias/x" }] });
    expect(resolveAlias).not.toHaveBeenCalled();
  });
  it.each([
    "urn:external:X",
    "https://EXTERNAL.test:443/other/%61?q=x",
    "https://example.test/s%2fother/beads/a",
  ])("preserves external URI bytes %s", (uri) => {
    const member = ready(
      singleton("createLink", { type: linkType, source: a, target: { uri, revision: "opaque" } }),
    );
    expect(execution(member).input).toMatchObject({ target: { uri, revision: "opaque" } });
    expect(metadata(member).witnesses.at(-1)).toEqual({ slot: "/target/uri", kind: "direct", uri });
  });
  it("normalizes only the URI component of pins and retains exact revision spelling", () => {
    const one = ready(
      singleton("createLink", {
        type: linkType,
        source: "beads/a",
        target: { uri: "beads/b", revision: 'opaque\\"' },
      }),
    );
    const two = ready(
      singleton("createLink", {
        type: linkType,
        source: a,
        target: { uri: b, revision: 'opaque\\"' },
      }),
    );
    const three = ready(
      singleton("createLink", {
        type: linkType,
        source: a,
        target: { uri: b, revision: "different" },
      }),
    );
    expect(one.identityJson).toBe(two.identityJson);
    expect(one.identityJson).not.toBe(three.identityJson);
    expect(execution(one).input).toMatchObject({ target: { uri: b, revision: 'opaque\\"' } });
  });
  it("preserves complete exact numeric identity on refusal, with no rounded executable input", () => {
    const raw = (n: string) =>
      prepareReadUpdateSingleton(
        scope,
        "createBead",
        `{"type":"${type}","properties":{"n":${n}}}`,
        "key",
      );
    const one = ready(raw("9007199254740993"));
    const same = ready(raw("90071992547409930e-1"));
    const rounded = ready(raw("9007199254740992"));
    expect(one.identityJson).toBe(same.identityJson);
    expect(one.identityJson).not.toBe(rounded.identityJson);
    expect(prepareMemberExecution(one, budget)).toMatchObject({
      admission: { ok: false, diagnostics: [{ instanceLocation: "/properties/n" }] },
      unavailableBinding: false,
    });
    expect(prepareMemberExecution(one, budget)).not.toHaveProperty("executable");
    expect(prepareMemberExecution(rounded, budget)).toMatchObject({
      admission: { ok: true },
      executable: { input: { properties: { n: 9007199254740992 } } },
    });
  });
  it("handles deep lossless values without recursive normalization/serialization limits", () => {
    const depth = 12000;
    const raw = `{"type":"${type}","properties":{"deep":${"[".repeat(depth)}1.0${"]".repeat(depth)}}}`;
    const member = ready(prepareReadUpdateSingleton(scope, "createBead", raw, "key"));
    const other = ready(
      prepareReadUpdateSingleton(scope, "createBead", raw.replace("1.0", "1e0"), "other"),
    );
    expect(member.identityJson).toBe(other.identityJson);
    const executable = execution(member);
    if (executable.operation !== "createBead") throw Error();
    let value: unknown = executable.input.properties?.deep;
    for (let i = 0; i < depth; i++) {
      expect(Object.isFrozen(value)).toBe(true);
      value = (value as unknown[])[0];
    }
    expect(value).toBe(1);
  });
});

describe("complete captured alias and creator witnesses", () => {
  it("captures every alias slot before any evaluator/early failure and resolves a repeated locator once", () => {
    const resolveAlias = vi.fn(() => a);
    const member = ready(
      singleton("createLink", {
        id: "links/already-used",
        type: linkType,
        source: "alias/lead",
        target: { uri: `${scope}alias/lead`, revision: "pinned" },
      }),
      0,
      { resolveAlias },
    );
    expect(resolveAlias).toHaveBeenCalledExactlyOnceWith(`${scope}alias/lead`);
    expect(member.metadata.witnesses).toEqual([
      { slot: "/id", kind: "direct", uri: `${scope}links/already-used` },
      { slot: "/source", kind: "alias", locator: `${scope}alias/lead`, target: a },
      { slot: "/target/uri", kind: "alias", locator: `${scope}alias/lead`, target: a },
    ]);
    expect(metadata(member).witnesses).toEqual(member.metadata.witnesses);
    expect(execution(member).input).toMatchObject({
      source: a,
      target: { uri: a, revision: "pinned" },
    });
  });
  it("reuses a recorded canonical alias across slots on retry and equates the direct target", () => {
    const first = ready(
      singleton("createLink", { type: linkType, source: "alias/lead", target: b }),
      0,
      { resolveAlias: () => a },
    );
    const prior = metadata(first);
    const resolveAlias = vi.fn(() => b);
    const retry = ready(
      singleton("createLink", { type: linkType, source: `${scope}alias/lead`, target: b }),
      0,
      { prior, resolveAlias },
    );
    const direct = ready(singleton("createLink", { type: linkType, source: a, target: b }), 0, {
      prior,
      resolveAlias,
    });
    const moved = ready(
      singleton("createLink", { type: linkType, source: b, target: "alias/lead" }),
      0,
      { prior, resolveAlias },
    );
    expect(retry.identityJson).toBe(first.identityJson);
    expect(direct.identityJson).toBe(first.identityJson);
    expect(execution(moved).input).toMatchObject({ source: b, target: a });
    expect(resolveAlias).not.toHaveBeenCalled();
  });
  it("leaves a previously unrecorded alias retry as an internal boundary without resolving it", () => {
    const prior = metadata(ready(singleton("deleteBead", { bead: a })));
    const resolveAlias = vi.fn(() => a);
    const result = normalizeMemberIdentity(
      singleton("deleteBead", { bead: "alias/new" }),
      0,
      context({ prior, resolveAlias }),
    );
    expect(result).toEqual({ kind: "unimplemented-alias-retry", slot: "/bead" });
    expect(result).not.toHaveProperty("problem");
    expect(result).not.toHaveProperty("identityJson");
    expect(resolveAlias).not.toHaveBeenCalled();
  });
  it("records unresolved alias identity separately per locator and never falls through on captured misses", () => {
    const member = ready(singleton("deleteBead", { bead: "alias/missing" }), 0, {
      resolveAlias: () => undefined,
    });
    const other = ready(singleton("deleteBead", { bead: "alias/else" }), 0, {
      resolveAlias: () => undefined,
    });
    expect(member.identityJson).not.toBe(other.identityJson);
    const retry = ready(singleton("deleteBead", { bead: `${scope}alias/missing` }), 0, {
      prior: metadata(member),
      resolveAlias: () => {
        throw Error("must not read a newly created alias");
      },
    });
    expect(retry.identityJson).toBe(member.identityJson);
    expect(execution(retry).input).toEqual({ bead: `${scope}alias/missing` });
    expect(capturedMemberAlias(retry, "missing")).toEqual({ captured: true, target: undefined });
    expect(capturedMemberAlias(retry, "separate-allocation-path")).toEqual({ captured: false });
    expect(Object.isFrozen(capturedMemberAlias(retry, "missing"))).toBe(true);
  });
  it("does not dereference alias-operation locators, alias put targets, or Link subjects", () => {
    const resolveAlias = vi.fn(() => a);
    for (const carrier of [
      singleton("putAlias", { alias: "alias/lead", target: "alias/other" }),
      singleton("deleteAlias", { alias: "alias/lead" }),
      singleton("deleteLink", { link: "alias/lead" }),
    ]) {
      const member = ready(carrier, 0, { resolveAlias });
      expect(member.metadata.witnesses.every((w) => w.kind === "direct")).toBe(true);
      expect(metadata(member)).toEqual(member.metadata);
    }
    expect(resolveAlias).not.toHaveBeenCalled();
  });
  it("normalizes renamed labels via current creator facts, including a withheld retained creation", () => {
    const run = (name: string) =>
      sequence([
        { ...create, name },
        {
          operation: "createLink",
          idempotencyKey: "dependent",
          type: linkType,
          source: `@${name}`,
          target: { uri: `@${name}`, revision: "r1" },
        },
      ]);
    const creatorBinding = vi.fn(() => ({
      kind: "bound" as const,
      id: a,
      resourceKind: "bead" as const,
    }));
    const one = ready(run("made"), 1, { creatorBinding });
    const two = ready(run("renamed"), 1, { creatorBinding });
    expect(one.identityJson).toBe(two.identityJson);
    expect(one.metadata).toEqual(two.metadata);
    expect(creatorBinding).toHaveBeenCalledTimes(2);
    expect(creatorBinding).toHaveBeenNthCalledWith(1, 0);
    expect(execution(two).input).toMatchObject({ source: a, target: { uri: a, revision: "r1" } });
    expect(serializeMemberMetadata(two)).not.toContain("renamed");
    // The executor supplies the same durable fact when public replay is forbidden.
    // This pure module neither returns the creator record nor authorizes the dependent.
    expect(one.metadata.witnesses.every((w) => w.kind === "binding")).toBe(true);
  });
  it("reports unbound and numeric-refused facts independently and never manufactures executable URIs", () => {
    const carrier = prepareReadUpdateSequence(
      scope,
      `{"operations":[${JSON.stringify(create)},{"operation":"createLink","idempotencyKey":"dependent","type":"${linkType}","source":"@made","target":"alias/other","properties":{"n":9007199254740993}}]}`,
    );
    const resolveAlias = vi.fn(() => b);
    const member = ready(carrier, 1, { creatorBinding: () => ({ kind: "unbound" }), resolveAlias });
    expect(resolveAlias).toHaveBeenCalledExactlyOnceWith(`${scope}alias/other`);
    const values = prepareMemberExecution(member, budget);
    expect(values).toMatchObject({ unavailableBinding: true, admission: { ok: false } });
    expect(values).not.toHaveProperty("executable");
    expect(metadata(member).witnesses).toEqual(member.metadata.witnesses);
    const validNumbers = ready(
      sequence([create, { operation: "deleteBead", idempotencyKey: "dependent", bead: "@made" }]),
      1,
      { creatorBinding: () => ({ kind: "unbound" }) },
    );
    expect(prepareMemberExecution(validNumbers, budget)).toMatchObject({
      admission: { ok: true },
      unavailableBinding: true,
    });
    expect(prepareMemberExecution(validNumbers, budget)).not.toHaveProperty("executable");
  });
  it("scans transient bindings before reading prior metadata or resolving an earlier alias slot", () => {
    const carrier = sequence([
      create,
      {
        operation: "createLink",
        idempotencyKey: "dependent",
        type: linkType,
        source: "alias/lead",
        target: "@made",
      },
    ]);
    const resolveAlias = vi.fn(() => a);
    const result = normalizeMemberIdentity(carrier, 1, {
      scope,
      resolveAlias,
      creatorBinding: () => ({ kind: "transient" }),
      get prior(): MemberMetadata {
        throw Error("prior metadata/key-dependent access forbidden");
      },
    });
    expect(result).toEqual({ kind: "transient-dependency" });
    expect(resolveAlias).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("identityJson");
  });
  it("snapshots alias/creator facts without exposing mutable maps", () => {
    const fact = { kind: "bound" as const, id: a, resourceKind: "bead" as const };
    const member = ready(
      sequence([create, { operation: "deleteBead", idempotencyKey: "dependent", bead: "@made" }]),
      1,
      { creatorBinding: () => fact },
    );
    fact.id = b;
    expect(execution(member).input).toEqual({ bead: a });
    expect(Object.isFrozen(member)).toBe(true);
    expect(Object.isFrozen(member.metadata)).toBe(true);
    expect(Object.isFrozen(member.metadata.witnesses)).toBe(true);
    const witness = member.metadata.witnesses[0];
    expect(Object.isFrozen(witness)).toBe(true);
    if (witness?.kind !== "binding") throw Error();
    expect(Object.isFrozen(witness.binding)).toBe(true);
  });
});

describe("identity receiving boundaries", () => {
  it("keeps all captured witnesses when the actual Resource evaluator fails before endpoint processing", () => {
    const member = ready(
      singleton("createLink", {
        id: "links/used",
        type: linkType,
        source: "alias/one",
        target: { uri: "alias/two", revision: "r1" },
      }),
      0,
      { resolveAlias: (locator) => (locator.endsWith("one") ? a : b) },
    );
    const mutation = execution(member);
    if (mutation.operation !== "createLink") throw Error();
    const unexpected = () => {
      throw Error("unexpected evaluator state access");
    };
    const tx: ResourceTransaction = {
      resource: unexpected,
      incidentLinks: unexpected,
      outgoingLinks: unexpected,
      identityWasCommitted: (id) => id === "links/used",
      alias: unexpected,
      installedType: unexpected,
      allocateResourceId: unexpected,
      allocateRevision: unexpected,
      putResource: unexpected,
      deleteResource: unexpected,
    };
    const result = evaluateResourceMutation(tx, mutation, {
      scope,
      contracts: { get: unexpected },
      policy: { canRead: unexpected, canCreate: unexpected, canWrite: unexpected },
      maximumEndpointMultiplicity: [],
      committedAt: "2026-09-10T00:00:00Z",
      recordChangeContext: false,
      limits: {},
    });
    expect(result).toMatchObject({
      effect: "failure",
      outcome: { code: "identity-taken" },
      resolutions: [],
    });
    expect(metadata(member).witnesses).toEqual([
      { slot: "/id", kind: "direct", uri: `${scope}links/used` },
      { slot: "/source", kind: "alias", locator: `${scope}alias/one`, target: a },
      { slot: "/target/uri", kind: "alias", locator: `${scope}alias/two`, target: b },
    ]);
  });
  it.each(["updateLinkProperties", "deleteLink"] as const)(
    "uses Link creator facts in %s",
    (operation) => {
      const carrier = sequence([
        {
          operation: "createLink",
          idempotencyKey: "creator",
          name: "relation",
          type: linkType,
          source: a,
          target: b,
        },
        {
          operation,
          idempotencyKey: "next",
          link: "@relation",
          ...(operation === "updateLinkProperties"
            ? { change: [{ op: "add", path: "/v", value: true }] }
            : {}),
        },
      ]);
      const member = ready(carrier, 1, {
        creatorBinding: () => ({ kind: "bound", id: `${scope}links/l`, resourceKind: "link" }),
      });
      expect(execution(member).input).toMatchObject({ link: `${scope}links/l` });
      expect(metadata(member).witnesses).toEqual(member.metadata.witnesses);
      expect(() =>
        ready(carrier, 1, {
          creatorBinding: () => ({ kind: "bound", id: a, resourceKind: "bead" }),
        }),
      ).toThrow(MemberMetadataError);
    },
  );
  it("substitutes putAlias's Bead binding while keeping its locator unresolved", () => {
    const member = ready(
      sequence([
        create,
        { operation: "putAlias", idempotencyKey: "alias", alias: "alias/lead", target: "@made" },
      ]),
      1,
      { creatorBinding: () => ({ kind: "bound", id: a, resourceKind: "bead" }) },
    );
    expect(execution(member).input).toEqual({ alias: `${scope}alias/lead`, target: a });
    expect(metadata(member).witnesses).toEqual(member.metadata.witnesses);
  });
  it("captures a later alias even after the first has no target", () => {
    const resolveAlias = vi.fn((locator: string) => (locator.endsWith("found") ? b : undefined));
    const member = ready(
      singleton("createLink", { type: linkType, source: "alias/missing", target: "alias/found" }),
      0,
      { resolveAlias },
    );
    expect(resolveAlias).toHaveBeenCalledTimes(2);
    expect(metadata(member).witnesses).toEqual([
      { slot: "/source", kind: "alias", locator: `${scope}alias/missing`, target: null },
      { slot: "/target", kind: "alias", locator: `${scope}alias/found`, target: b },
    ]);
    expect(capturedMemberAlias(member, "found")).toEqual({ captured: true, target: "beads/b" });
  });
  it("rejects a creation completion whose Type differs from its request", () => {
    const member = ready(singleton("createBead", { type }));
    expect(() =>
      serializeMemberMetadata(member, {
        outcome: "created",
        resource: { id: a, type: "https://types.example/other", revision: "r", properties: {} },
      }),
    ).toThrow(MemberMetadataError);
  });
});

describe("versioned retained and expired metadata", () => {
  it("retains a successful creator fact alongside its witnesses without changing identity", () => {
    const member = ready(singleton("createBead", { type, id: "beads/a" }));
    const before = member.identityJson;
    const text = serializeMemberMetadata(member, {
      outcome: "created",
      resource: { id: a, type, revision: "r1", properties: {} },
    });
    const parsed = parseMemberMetadata(text, scope);
    expect(parsed.creation).toEqual({ kind: "bound", id: a, resourceKind: "bead" });
    expect(parsed.witnesses).toEqual(member.metadata.witnesses);
    expect(parsed.format).toBe("ru-member-resolutions-1");
    expect(member.identityJson).toBe(before);
    expect(member.metadata).not.toHaveProperty("creation");
    // S6 can retain these exact resolution bytes after discarding outcome JSON.
    const expired = parseMemberMetadata(text, scope);
    const next = ready(
      sequence([create, { operation: "deleteBead", idempotencyKey: "next", bead: "@made" }]),
      1,
      {
        creatorBinding: () => {
          if (!expired.creation) throw Error();
          return expired.creation;
        },
      },
    );
    expect(execution(next).input).toEqual({ bead: a });
  });
  it.each([
    { outcome: "updated", resource: { id: a, type, revision: "r1", properties: {} } },
    { outcome: "created", resource: { id: b, type, revision: "r1", properties: {} } },
    {
      outcome: "created",
      resource: { id: "https://foreign.test/beads/a", type, revision: "r1", properties: {} },
    },
    {
      outcome: "created",
      resource: {
        id: `${scope}links/l`,
        type: linkType,
        revision: "r1",
        properties: {},
        source: a,
        target: b,
      },
    },
  ])(
    "rejects creation completion without successful kind/Scope/supplied-id correspondence %#",
    (completion) => {
      const member = ready(singleton("createBead", { type, id: a }));
      expect(() =>
        serializeMemberMetadata(
          member,
          completion as Parameters<typeof serializeMemberMetadata>[1],
        ),
      ).toThrow();
    },
  );
  it("never attaches creation facts to alias results or noncreating Resource operations", () => {
    const result = {
      outcome: "created" as const,
      resource: { id: a, type, revision: "r1", properties: {} },
    };
    for (const carrier of [
      singleton("deleteBead", { bead: a }),
      singleton("putAlias", { alias: "alias/a", target: a }),
    ])
      expect(() => serializeMemberMetadata(ready(carrier), result)).toThrow(MemberMetadataError);
  });
  const valid = () =>
    JSON.parse(
      serializeMemberMetadata(
        ready(
          singleton("createLink", { type: linkType, source: "alias/lead", target: "alias/lead" }),
          0,
          { resolveAlias: () => a },
        ),
      ),
    );
  it.each([
    (d: ReturnType<typeof valid>) => {
      d.format = "future-version";
    },
    (d: ReturnType<typeof valid>) => {
      d.scope = "https://foreign.test/";
    },
    (d: ReturnType<typeof valid>) => {
      d.extra = true;
    },
    (d: ReturnType<typeof valid>) => {
      d.witnesses.pop();
    },
    (d: ReturnType<typeof valid>) => {
      d.witnesses.reverse();
    },
    (d: ReturnType<typeof valid>) => {
      d.witnesses[1].slot = "/source";
    },
    (d: ReturnType<typeof valid>) => {
      d.witnesses[0].locator = "alias/lead";
    },
    (d: ReturnType<typeof valid>) => {
      d.witnesses[0].locator = `${scope}alias/%6Cead`;
    },
    (d: ReturnType<typeof valid>) => {
      d.witnesses[0].target = `${scope}links/a`;
    },
    (d: ReturnType<typeof valid>) => {
      d.witnesses[1].target = b;
    },
    (d: ReturnType<typeof valid>) => {
      d.witnesses[0].target = { withheld: true };
    },
    (d: ReturnType<typeof valid>) => {
      d.witnesses[0] = { slot: "/source", kind: "binding", binding: { kind: "transient" } };
    },
    (d: ReturnType<typeof valid>) => {
      d.creation = { kind: "bound", id: a, resourceKind: "bead" };
    },
  ])("rejects malformed persistence as a local fault, never a semantic conflict %#", (corrupt) => {
    const data = valid();
    corrupt(data);
    expect(() => parseMemberMetadata(JSON.stringify(data), scope)).toThrow(MemberMetadataError);
  });
  it.each(['{"format":"x","format":"y"}', '{"format":"\\ud800"}', "{", "null"])(
    "rejects invalid serialized metadata %s",
    (text) => {
      expect(() => parseMemberMetadata(text, scope)).toThrow(MemberMetadataError);
    },
  );
  it.each(["unbound", "unresolved-alias"] as const)(
    "rejects an impossible creation fact with %s input",
    (mode) => {
      const member =
        mode === "unbound"
          ? ready(
              sequence([
                create,
                {
                  operation: "createLink",
                  idempotencyKey: "next",
                  type: linkType,
                  source: "@made",
                  target: b,
                },
              ]),
              1,
              { creatorBinding: () => ({ kind: "unbound" }) },
            )
          : ready(
              singleton("createLink", { type: linkType, source: "alias/missing", target: b }),
              0,
              { resolveAlias: () => undefined },
            );
      const completion = {
        outcome: "created" as const,
        resource: {
          id: `${scope}links/l`,
          type: linkType,
          revision: "r1",
          properties: {},
          source: a,
          target: b,
        },
      };
      expect(() => serializeMemberMetadata(member, completion)).toThrow(MemberMetadataError);
      const corrupt = {
        ...JSON.parse(serializeMemberMetadata(member)),
        creation: { kind: "bound", id: `${scope}links/l`, resourceKind: "link" },
      };
      expect(() => parseMemberMetadata(JSON.stringify(corrupt), scope)).toThrow(
        MemberMetadataError,
      );
    },
  );
  it("requires authentic prepared members and parsed metadata, preserving private S1 pairing", () => {
    const carrier = singleton("deleteBead", { bead: a });
    expect(() => normalizeMemberIdentity({ ...carrier }, 0, context())).toThrow(TypeError);
    expect(() => normalizeMemberIdentity(carrier, -1, context())).toThrow(TypeError);
    expect(() => normalizeMemberIdentity(carrier, 1, context())).toThrow(TypeError);
    expect(() =>
      normalizeMemberIdentity(carrier, 0, context({ scope: "https://foreign.test/" })),
    ).toThrow(TypeError);
    const member = ready(carrier);
    expect(() => ready(carrier, 0, { prior: { ...member.metadata } })).toThrow(MemberMetadataError);
    expect(() => prepareMemberExecution({ ...member }, budget)).toThrow(TypeError);
    expect(() => serializeMemberMetadata({ ...member })).toThrow(TypeError);
    expect(() => capturedMemberAlias({ ...member }, "x")).toThrow(TypeError);
  });
});

describe("prepared member dependencies", () => {
  function prepared(
    carrier: PreparedReadUpdateCarrier,
    index: number,
    creatorBinding = context().creatorBinding,
  ) {
    const value = prepareMemberDependencies(carrier, index, scope, creatorBinding);
    if (value.kind !== "stable-dependencies") throw Error("unexpected transient dependency");
    return value;
  }
  const legalSlots = [
    { operation: "deleteBead", bead: "@made" },
    { operation: "updateBeadProperties", bead: "@made", change: [{ op: "remove", path: "/x" }] },
    { operation: "createLink", type: linkType, source: "@made", target: b },
    {
      operation: "createLink",
      type: linkType,
      source: { uri: "@made", revision: "r1" },
      target: b,
    },
    { operation: "createLink", type: linkType, source: "alias/earlier", target: "@made" },
    {
      operation: "createLink",
      type: linkType,
      source: "alias/earlier",
      target: { uri: "@made", revision: "r1" },
    },
    { operation: "putAlias", alias: "alias/lead", target: "@made" },
    { operation: "deleteLink", link: "@made" },
    { operation: "updateLinkProperties", link: "@made", change: [{ op: "remove", path: "/x" }] },
  ];
  it.each(legalSlots)("stops at a transient creator in the legal $operation slot: %j", (input) => {
    const link = "link" in input;
    const creator = link
      ? { ...create, operation: "createLink", type: linkType, source: a, target: b }
      : create;
    const carrier = sequence([creator, { ...input, idempotencyKey: "dependent" }]);
    const creatorBinding = vi.fn(() => ({ kind: "transient" as const }));
    expect(prepareMemberDependencies(carrier, 1, scope, creatorBinding)).toEqual({
      kind: "transient-dependency",
    });
    expect(creatorBinding).toHaveBeenCalledExactlyOnceWith(0);
    const prior = vi.fn(() => {
      throw Error("prior/key access forbidden");
    });
    const resolveAlias = vi.fn(() => {
      throw Error("alias lookup forbidden");
    });
    expect(
      normalizeMemberIdentity(carrier, 1, {
        scope,
        creatorBinding,
        get prior() {
          return prior();
        },
        resolveAlias,
      }),
    ).toEqual({ kind: "transient-dependency" });
    expect(prior).not.toHaveBeenCalled();
    expect(resolveAlias).not.toHaveBeenCalled();
  });
  it("captures repeated creator facts once and preserves them across callback backing mutation", () => {
    const carrier = sequence([
      create,
      {
        operation: "createLink",
        idempotencyKey: "dependent",
        type: linkType,
        source: "@made",
        target: { uri: "@made", revision: "r1" },
      },
    ]);
    const fact = { kind: "bound" as const, resourceKind: "bead" as const, id: a };
    const creatorBinding = vi.fn(() => fact);
    const token = prepared(carrier, 1, creatorBinding);
    expect(Object.isFrozen(token)).toBe(true);
    expect(creatorBinding).toHaveBeenCalledExactlyOnceWith(0);
    fact.id = b;
    creatorBinding.mockImplementation(() => {
      throw Error("creator provider called again");
    });
    const member = normalizePreparedMemberIdentity(carrier, 1, context(), token);
    if (member.kind !== "ready") throw Error();
    expect(execution(member).input).toMatchObject({
      source: a,
      target: { uri: a, revision: "r1" },
    });
    expect(creatorBinding).toHaveBeenCalledTimes(1);
    expect(
      member.metadata.witnesses.every(
        (witness) => witness.kind === "binding" && Object.isFrozen(witness.binding),
      ),
    ).toBe(true);
    const convenience = ready(carrier, 1, {
      creatorBinding: () => ({ kind: "bound", resourceKind: "bead", id: a }),
    });
    expect(member.identityJson).toBe(convenience.identityJson);
    expect(serializeMemberMetadata(member)).toBe(serializeMemberMetadata(convenience));
  });
  it.each(["missing", "wrong-kind", "wrong-scope"])(
    "rejects %s creator facts instead of silently treating them as unbound",
    (variant) => {
      const carrier = sequence([
        create,
        { operation: "deleteBead", idempotencyKey: "dependent", bead: "@made" },
      ]);
      const creatorBinding = () =>
        variant === "missing"
          ? undefined
          : {
              kind: "bound",
              resourceKind: variant === "wrong-kind" ? "link" : "bead",
              id: variant === "wrong-scope" ? "https://other.test/beads/a" : a,
            };
      expect(() =>
        prepareMemberDependencies(
          carrier,
          1,
          scope,
          creatorBinding as MemberIdentityContext["creatorBinding"],
        ),
      ).toThrow(MemberMetadataError);
    },
  );
  it("rejects forged and mispaired tokens before prior or alias access", () => {
    const carrier = sequence([
      create,
      { operation: "deleteBead", idempotencyKey: "dependent", bead: "alias/current" },
    ]);
    const token = prepared(carrier, 1);
    const other = sequence([
      create,
      { operation: "deleteBead", idempotencyKey: "dependent", bead: "alias/current" },
    ]);
    const prior = vi.fn(() => {
      throw Error("prior read");
    });
    const alias = vi.fn(() => {
      throw Error("alias lookup");
    });
    for (const [candidate, index, candidateScope, preparation] of [
      [carrier, 1, scope, {}],
      [carrier, 1, scope, { ...token }],
      [carrier, 1, scope, new Proxy(token, {})],
      [other, 1, scope, token],
      [carrier, 0, scope, token],
      [carrier, Number.NaN, scope, token],
      [carrier, 1, "https://other.test/", token],
    ] as const) {
      expect(() =>
        normalizePreparedMemberIdentity(
          candidate,
          index,
          {
            scope: candidateScope,
            get prior() {
              return prior();
            },
            resolveAlias: alias,
          },
          preparation as PreparedMemberDependencies,
        ),
      ).toThrow("prepared dependencies");
    }
    expect(prior).not.toHaveBeenCalled();
    expect(alias).not.toHaveBeenCalled();
  });
  it("rejects a reconstructed carrier and invalid index before creator access", () => {
    const carrier = sequence([
      create,
      { operation: "deleteBead", idempotencyKey: "dependent", bead: "@made" },
    ]);
    const creatorBinding = vi.fn(() => ({ kind: "unbound" as const }));
    expect(() => prepareMemberDependencies({ ...carrier }, 1, scope, creatorBinding)).toThrow(
      "Scope-preflighted",
    );
    for (const index of [-1, 0.5, 2, Number.NaN])
      expect(() => prepareMemberDependencies(carrier, index, scope, creatorBinding)).toThrow(
        "member index",
      );
    expect(() =>
      prepareMemberDependencies(carrier, 1, "https://other.test/", creatorBinding),
    ).toThrow("different Scope");
    expect(creatorBinding).not.toHaveBeenCalled();
  });
  it("defers alias and prior reads until prepared normalization, preserving captured misses and old API bytes", () => {
    const carrier = singleton("deleteBead", { bead: "alias/missing" });
    const token = prepared(carrier, 0);
    const resolveAlias = vi.fn(() => undefined);
    const member = normalizePreparedMemberIdentity(carrier, 0, { scope, resolveAlias }, token);
    if (member.kind !== "ready") throw Error();
    expect(resolveAlias).toHaveBeenCalledExactlyOnceWith(`${scope}alias/missing`);
    const old = ready(carrier, 0, { resolveAlias: () => undefined });
    expect(member.identityJson).toBe(old.identityJson);
    expect(serializeMemberMetadata(member)).toBe(serializeMemberMetadata(old));
    const retry = normalizePreparedMemberIdentity(
      carrier,
      0,
      {
        scope,
        prior: metadata(member),
        resolveAlias: () => {
          throw Error("no live retry lookup");
        },
      },
      prepared(carrier, 0),
    );
    if (retry.kind !== "ready") throw Error();
    expect(retry.identityJson).toBe(member.identityJson);
    expect(capturedMemberAlias(retry, "missing")).toEqual({ captured: true, target: undefined });
  });
  it("keeps opaque deep properties outside dependency scanning and preserves old normalization bytes", () => {
    const depth = 12000;
    const raw = `{"type":"${type}","properties":{"deep":${"[".repeat(depth)}"@made"${"]".repeat(depth)}}}`;
    const carrier = prepareReadUpdateSingleton(scope, "createBead", raw, "key");
    const creatorBinding = vi.fn(() => {
      throw Error("properties are not bindings");
    });
    const token = prepared(carrier, 0, creatorBinding);
    const member = normalizePreparedMemberIdentity(carrier, 0, context(), token);
    if (member.kind !== "ready") throw Error();
    expect(member.identityJson).toBe(ready(carrier).identityJson);
    expect(serializeMemberMetadata(member)).toBe(serializeMemberMetadata(ready(carrier)));
    expect(creatorBinding).not.toHaveBeenCalled();
    const executable = execution(member);
    if (executable.operation !== "createBead") throw Error();
    let current: unknown = executable.input.properties?.deep;
    for (let index = 0; index < depth; index++) current = (current as unknown[])[0];
    expect(current).toBe("@made");
  });
  it("retains unbound and numeric refusal as separate facts with prepared dependencies", () => {
    const carrier = prepareReadUpdateSequence(
      scope,
      `{"operations":[{"operation":"createBead","idempotencyKey":"creator","name":"made","type":"${type}"},{"operation":"updateBeadProperties","idempotencyKey":"dependent","bead":"@made","change":[{"op":"add","path":"/n","value":9007199254740993}]}]}`,
    );
    const member = normalizePreparedMemberIdentity(
      carrier,
      1,
      context(),
      prepared(carrier, 1, () => ({ kind: "unbound" })),
    );
    if (member.kind !== "ready") throw Error();
    expect(prepareMemberExecution(member, budget)).toMatchObject({
      admission: { ok: false },
      unavailableBinding: true,
    });
    expect(prepareMemberExecution(member, budget)).not.toHaveProperty("executable");
  });
});
