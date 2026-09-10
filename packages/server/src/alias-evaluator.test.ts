import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  admitReadUpdateOperationNumbers,
  parseReadUpdateRequest,
  ReadUpdateCarrierError,
  parseBeadRecord,
  parseLinkRecord,
  type ReadUpdateProblem,
} from "@bdp/protocol";
import {
  assertAliasDiagnosticLimits,
  evaluateAliasMutation,
  type AliasEvaluation,
  type AliasEvaluationOptions,
  type AliasMutation,
  type AliasTransaction,
} from "./alias-evaluator.js";
import {
  openRecoveryStore,
  type RecoveryStore,
  type StoredResource,
  type MemberTransaction,
} from "./recovery-store.js";

const scope = "https://example.test/s/";
const beadType = "https://types.test/bead";
const linkType = "https://types.test/owned";
const roots: string[] = [];
const stores = new Set<RecoveryStore>();
afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function bead(id: string, extra = {}): StoredResource {
  return {
    id: `beads/${id}`,
    kind: "bead",
    bodyJson: JSON.stringify(
      parseBeadRecord({
        id: `${scope}beads/${id}`,
        type: beadType,
        revision: `revision-${id}`,
        properties: {},
        ...extra,
      }),
    ),
  };
}
function link(id: string, source: string, target: string): StoredResource {
  return {
    id: `links/${id}`,
    kind: "link",
    source: `beads/${source}`,
    target: `beads/${target}`,
    bodyJson: JSON.stringify(
      parseLinkRecord({
        id: `${scope}links/${id}`,
        type: linkType,
        revision: `revision-${id}`,
        source: `${scope}beads/${source}`,
        target: `${scope}beads/${target}`,
        properties: {},
      }),
    ),
  };
}
function fixture(resources: readonly StoredResource[] = [bead("a"), bead("b")]) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-s3-alias-"));
  roots.push(directory);
  const configuration = { directory, scope, installationId: "s3-fixture", lineageId: "s3-lineage" };
  let store = openRecoveryStore({ ...configuration, create: { resources } });
  stores.add(store);
  let counter = 0;
  let aliasWrites = 0;
  const canRead = vi.fn(() => true);
  const canWriteBead = vi.fn(() => true);
  const options: AliasEvaluationOptions = {
    scope,
    policy: { canRead, canWriteBead },
    limits: { diagnosticCount: 100, diagnosticBytes: 65_536 },
  };
  function mutate(callback: (tx: MemberTransaction) => void) {
    const key = `fixture-${++counter}`;
    const admission = store.admit("fixture-admin", [key]);
    store.executeMember(admission, key, (tx) => {
      callback(tx);
      return {
        kind: "retain",
        semanticIdentityJson: JSON.stringify({ key }),
        resolutionsJson: "{}",
        outcomeJson: "{}",
        effect: "success",
        completedAt: 0,
        retainUntil: 86_400_000,
      };
    });
  }
  function execute(
    operation: "putAlias" | "deleteAlias",
    input: unknown,
    override: Partial<AliasEvaluationOptions> = {},
    afterEvaluation: () => void = () => {},
  ) {
    // Actual S1 surface, followed by an S6-owned member. This fixture identity is
    // not the S4 production normalizer or a replay/sequence implementation.
    const parsed = parseReadUpdateRequest(operation, JSON.stringify(input));
    const admitted = admitReadUpdateOperationNumbers(parsed, {
      diagnostic: ({ pointer }) => ({ message: "number", instanceLocation: pointer }),
    });
    if (!admitted.ok) throw new Error("alias input contains no numbers");
    const mutation = { operation, input: admitted.input } as AliasMutation;
    const key = `key-${++counter}`;
    const admission = store.admit("alice", [key]);
    let result: AliasEvaluation | undefined;
    store.executeMember(admission, key, (tx) => {
      const facade: AliasTransaction = {
        resource: tx.resource,
        alias: tx.alias,
        identityWasCommitted: tx.identityWasCommitted,
        putAlias(path, id) {
          aliasWrites++;
          tx.putAlias(path, id);
        },
        deleteAlias(path) {
          aliasWrites++;
          tx.deleteAlias(path);
        },
      };
      result = evaluateAliasMutation(facade, mutation, { ...options, ...override });
      afterEvaluation();
      return {
        kind: "retain",
        semanticIdentityJson: JSON.stringify(mutation),
        resolutionsJson: "{}",
        outcomeJson: JSON.stringify(result.outcome),
        effect: result.effect,
        completedAt: 0,
        retainUntil: 86_400_000,
      };
    });
    if (!result) throw new Error("member did not execute");
    expect(store.read((reader) => reader.key("alice", key))).toMatchObject({
      kind: "retained",
      effect: result.effect,
      outcomeJson: JSON.stringify(result.outcome),
    });
    return result;
  }
  return {
    execute,
    mutate,
    options,
    canRead,
    canWriteBead,
    admissions: () => counter,
    alias: (id: string) => store.read((reader) => reader.alias(id)),
    resources: () => store.read((reader) => reader.resources()),
    writes: () => aliasWrites,
    reopen() {
      store.close();
      stores.delete(store);
      store = openRecoveryStore(configuration);
      stores.add(store);
    },
  };
}
function failure(result: AliasEvaluation, code: ReadUpdateProblem["code"]) {
  expect(result.effect).toBe("failure");
  expect(result.outcome).toMatchObject({ code });
  expect(Object.isFrozen(result.outcome)).toBe(true);
}

describe("owned-member alias evaluator", () => {
  it.each([1.5, NaN, Infinity, 2 ** 53])(
    "rejects non-integer or unsafe startup diagnostic limit %s",
    (limit) => {
      for (const limits of [{ diagnosticCount: limit }, { diagnosticBytes: limit }])
        expect(() => assertAliasDiagnosticLimits(limits)).toThrow(TypeError);
    },
  );
  it("preserves optional unbounded alias checks without qualifying a deployment", () => {
    expect(() => assertAliasDiagnosticLimits({})).not.toThrow();
  });
  it("creates, repoints, no-ops, deletes and reuses hierarchical paths without changing Resource bytes", () => {
    const f = fixture();
    const before = f.resources();
    const input = { alias: "alias/team/latest", target: "beads/a" };
    expect(f.execute("putAlias", input)).toEqual({
      effect: "success",
      outcome: {
        outcome: "created",
        alias: `${scope}alias/team/latest`,
        target: `${scope}beads/a`,
      },
    });
    expect(f.alias("team/latest")).toBe("beads/a");
    expect(
      f.execute("putAlias", { alias: `${scope}alias/team/latest`, target: `${scope}beads/b` })
        .outcome,
    ).toEqual({
      outcome: "updated",
      alias: `${scope}alias/team/latest`,
      target: `${scope}beads/b`,
    });
    const writes = f.writes();
    expect(
      f.execute("putAlias", { alias: "alias/team/latest", target: "beads/b" }).outcome,
    ).toMatchObject({ outcome: "updated" });
    expect(f.writes()).toBe(writes);
    expect(f.execute("deleteAlias", { alias: "alias/team/latest" }).outcome).toEqual({
      outcome: "deleted",
      alias: `${scope}alias/team/latest`,
    });
    expect(f.alias("team/latest")).toBeUndefined();
    expect(f.execute("putAlias", input).outcome).toMatchObject({ outcome: "created" });
    expect(f.resources()).toEqual(before);
    const noOp = f.execute("putAlias", input);
    expect(Object.isFrozen(noOp)).toBe(true);
    expect(Object.isFrozen(noOp.outcome)).toBe(true);
    f.reopen();
    expect(f.alias("team/latest")).toBe("beads/a");
    expect(f.resources()).toEqual(before);
  });

  it("preserves an alias-named first suffix segment without stripping it twice", () => {
    const f = fixture();
    const result = f.execute("putAlias", { alias: "alias/alias/latest", target: "beads/a" });
    expect(result.outcome).toMatchObject({ alias: `${scope}alias/alias/latest` });
    expect(f.alias("alias/latest")).toBe("beads/a");
    expect(f.alias("latest")).toBeUndefined();
    f.execute("deleteAlias", { alias: `${scope}alias/alias/latest` });
    expect(f.alias("alias/latest")).toBeUndefined();
  });

  it.each([
    "beads/latest",
    "links/latest",
    "latest",
    `${scope}other/latest`,
    "https://elsewhere.test/alias/latest",
  ])("treats well-formed wrong-root alias %s as a missing subject", (alias) => {
    const f = fixture();
    for (const operation of ["putAlias", "deleteAlias"] as const)
      failure(
        f.execute(operation, { alias, ...(operation === "putAlias" ? { target: "beads/a" } : {}) }),
        "resource-not-found",
      );
    expect(f.writes()).toBe(0);
    expect(f.canWriteBead).not.toHaveBeenCalled();
  });

  it.each([
    "alias/elsewhere",
    `${scope}alias/elsewhere`,
    "links/edge",
    "https://elsewhere.test/beads/a",
    "urn:example:bead",
  ])("refuses noncanonical target %s with one diagnostic and no alias chain", (target) => {
    const f = fixture();
    f.mutate((tx) => tx.putAlias("elsewhere", "beads/a"));
    const result = f.execute("putAlias", { alias: "alias/new", target });
    failure(result, "validation-failed");
    expect(result.outcome).toMatchObject({
      status: 422,
      retry: "never",
      diagnostics: [
        {
          message:
            "an alias put's target must be a canonical in-Scope Bead reference; an alias, a Link, or an external URI is not admitted",
        },
      ],
    });
    if (result.effect === "failure") {
      expect(result.outcome.diagnostics).toHaveLength(1);
      expect(Object.keys(result.outcome.diagnostics?.[0] ?? {})).toEqual(["message"]);
    }
    expect(f.writes()).toBe(0);
    expect(f.canWriteBead).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "checks permanent Bead identity before unknown/invalid target and authorization (deleted=%s)",
    (deleted) => {
      const f = fixture();
      if (deleted) {
        f.mutate((tx) => tx.deleteResource("beads/a"));
        f.reopen();
      }
      const policy = { canRead: vi.fn(() => false), canWriteBead: vi.fn(() => false) };
      for (const target of ["beads/missing", "alias/missing"])
        failure(f.execute("putAlias", { alias: "alias/a", target }, { policy }), "identity-taken");
      expect(policy.canRead).not.toHaveBeenCalled();
      expect(policy.canWriteBead).not.toHaveBeenCalled();
      expect(f.writes()).toBe(0);
    },
  );

  it("allows a Link and alias to share an id path", () => {
    const f = fixture([bead("a"), bead("b"), link("shared", "a", "b")]);
    const before = f.resources();
    expect(f.execute("putAlias", { alias: "alias/shared", target: "beads/a" }).effect).toBe(
      "success",
    );
    expect(f.resources()).toEqual(before);
    expect(f.alias("shared")).toBe("beads/a");
  });

  it("allows Link creation at an already live alias path", () => {
    const f = fixture();
    f.execute("putAlias", { alias: "alias/shared", target: "beads/a" });
    f.mutate((tx) => tx.putResource(link("shared", "a", "b")));
    expect(f.alias("shared")).toBe("beads/a");
    expect(f.resources().some(({ id, kind }) => id === "links/shared" && kind === "link")).toBe(
      true,
    );
  });

  it("keeps unknown/invisible subjects indistinguishable before write authorization", () => {
    const f = fixture();
    const policy = { canRead: () => false, canWriteBead: vi.fn(() => false) };
    const hidden = f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }, { policy });
    const missing = f.execute(
      "putAlias",
      { alias: "alias/latest", target: "beads/missing" },
      { policy },
    );
    expect(hidden).toEqual(missing);
    failure(hidden, "resource-not-found");
    failure(f.execute("deleteAlias", { alias: "alias/missing" }, { policy }), "resource-not-found");
    expect(policy.canWriteBead).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });

  it.each(["beads/a", "beads/b"])(
    "requires write permission on both targets of a repoint: denied %s",
    (denied) => {
      const f = fixture();
      f.mutate((tx) => tx.putAlias("latest", "beads/a"));
      const policy = {
        canRead: () => true,
        canWriteBead: (record: { id: string }) => record.id !== `${scope}${denied}`,
      };
      failure(
        f.execute("putAlias", { alias: "alias/latest", target: "beads/b" }, { policy }),
        "forbidden",
      );
      expect(f.alias("latest")).toBe("beads/a");
      expect(f.writes()).toBe(0);
    },
  );

  it("authorizes delete against its current target and same-target put against the unchanged Bead", () => {
    const f = fixture();
    f.mutate((tx) => tx.putAlias("latest", "beads/a"));
    const policy = { canRead: () => true, canWriteBead: vi.fn(() => false) };
    failure(f.execute("deleteAlias", { alias: "alias/latest" }, { policy }), "forbidden");
    failure(
      f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }, { policy }),
      "forbidden",
    );
    expect(policy.canWriteBead).toHaveBeenCalledTimes(2);
    expect(f.alias("latest")).toBe("beads/a");
    expect(f.writes()).toBe(0);
  });

  it("does not disclose a hidden current target through a forbidden proposed target", () => {
    const f = fixture();
    f.mutate((tx) => tx.putAlias("latest", "beads/a"));
    const policy = {
      canRead: (record: { id: string }) => record.id !== `${scope}beads/a`,
      canWriteBead: vi.fn(() => false),
    };
    failure(
      f.execute("putAlias", { alias: "alias/latest", target: "beads/b" }, { policy }),
      "resource-not-found",
    );
    failure(f.execute("deleteAlias", { alias: "alias/latest" }, { policy }), "resource-not-found");
    expect(policy.canWriteBead).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });

  it.each(["owned-link", "target"])(
    "uses shared whole-owned closure visibility for hidden %s",
    (hidden) => {
      const edge = link("edge", "a", "b");
      const f = fixture([
        bead("a", { ownedLinks: { [linkType]: [JSON.parse(edge.bodyJson)] } }),
        bead("b"),
        edge,
      ]);
      expect(f.execute("putAlias", { alias: "alias/control", target: "beads/a" }).effect).toBe(
        "success",
      );
      const writes = f.writes();
      const policy = {
        canRead: (record: { id: string }) =>
          record.id !== `${scope}${hidden === "owned-link" ? "links/edge" : "beads/b"}`,
        canWriteBead: vi.fn(() => true),
      };
      failure(
        f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }, { policy }),
        "resource-not-found",
      );
      f.mutate((tx) => tx.putAlias("latest", "beads/a"));
      failure(
        f.execute("deleteAlias", { alias: "alias/latest" }, { policy }),
        "resource-not-found",
      );
      expect(policy.canWriteBead).not.toHaveBeenCalled();
      expect(f.writes()).toBe(writes);
    },
  );

  it("does not cascade aliases on Bead deletion or reuse their old target as authorization", () => {
    const f = fixture();
    f.execute("putAlias", { alias: "alias/latest", target: "beads/a" });
    f.mutate((tx) => tx.deleteResource("beads/a"));
    const writes = f.writes();
    failure(f.execute("deleteAlias", { alias: "alias/latest" }), "resource-not-found");
    failure(
      f.execute("putAlias", { alias: "alias/latest", target: "beads/b" }),
      "resource-not-found",
    );
    expect(f.alias("latest")).toBe("beads/a");
    expect(f.writes()).toBe(writes);
  });

  it.each([
    { alias: "alias/latest", target: { uri: "beads/a", revision: "pin" } },
    { alias: "alias/latest", target: "beads/a", attribution: {} },
    { alias: "alias/latest", target: "beads/a", expectedRevision: "r" },
    { alias: "alias/latest", target: "beads/a", name: "bound" },
    { alias: "alias/latest", target: "@earlier" },
    { alias: "alias//bad", target: "beads/a" },
  ])("leaves prohibited carrier shape %j to S1 before any owned member", (input) => {
    const f = fixture();
    expect(() => f.execute("putAlias", input)).toThrow(ReadUpdateCarrierError);
    expect(f.admissions()).toBe(0);
    expect(f.writes()).toBe(0);
  });

  it("uses current per-member policy and rolls unexpected policy errors back without alias effects", () => {
    const f = fixture();
    const bad = {
      canRead: () => {
        throw new Error("policy unavailable");
      },
      canWriteBead: () => true,
    };
    expect(() =>
      f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }, { policy: bad }),
    ).toThrow("policy unavailable");
    expect(f.alias("latest")).toBeUndefined();
    expect(f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }).effect).toBe(
      "success",
    );
  });

  it("rolls the alias write back when its owned-member disposition cannot commit", () => {
    const f = fixture();
    const before = f.resources();
    expect(() =>
      f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }, {}, () => {
        throw new Error("injected pre-disposition failure");
      }),
    ).toThrow("injected pre-disposition failure");
    expect(f.writes()).toBe(1); // The real SQL write was reached, then rolled back.
    expect(f.alias("latest")).toBeUndefined();
    expect(f.resources()).toEqual(before);
    f.reopen();
    expect(f.alias("latest")).toBeUndefined();
    expect(f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }).effect).toBe(
      "success",
    );
  });

  it("allows Bead creation at a path only after its alias was deleted", () => {
    const f = fixture();
    f.execute("putAlias", { alias: "alias/reusable", target: "beads/a" });
    expect(() => f.mutate((tx) => tx.putResource(bead("reusable")))).toThrow();
    f.execute("deleteAlias", { alias: "alias/reusable" });
    f.mutate((tx) => tx.putResource(bead("reusable")));
    failure(
      f.execute("putAlias", { alias: "alias/reusable", target: "beads/a" }),
      "identity-taken",
    );
  });

  it("requires a usable first diagnostic budget without substituting a new wire failure", () => {
    const f = fixture();
    expect(() =>
      f.execute(
        "putAlias",
        { alias: "alias/latest", target: "links/no" },
        { limits: { diagnosticBytes: 1 } },
      ),
    ).toThrow("one complete diagnostic");
    expect(() =>
      f.execute(
        "putAlias",
        { alias: "alias/latest", target: "beads/a" },
        { limits: { diagnosticCount: 0 } },
      ),
    ).toThrow("positive usable");
    expect(f.alias("latest")).toBeUndefined();
    expect(f.writes()).toBe(0);
  });

  it("uses explicit Bead write permission rather than an unchanged transition shortcut", () => {
    const f = fixture();
    const policy = {
      canRead: () => true,
      canWrite: vi.fn((before: unknown, after: unknown) => before === after),
      canWriteBead: vi.fn(() => false),
    };
    failure(
      f.execute("putAlias", { alias: "alias/new", target: "beads/a" }, { policy }),
      "forbidden",
    );
    expect(policy.canWrite).not.toHaveBeenCalled();
    expect(policy.canWriteBead).toHaveBeenCalledTimes(1);
    expect(policy.canWriteBead.mock.calls[0]).toHaveLength(1);
    expect(f.alias("new")).toBeUndefined();
  });

  it("withholds a hidden current target even with permissive Bead write permission", () => {
    const f = fixture();
    f.mutate((tx) => tx.putAlias("latest", "beads/a"));
    const policy = {
      canRead: (record: { id: string }) => record.id !== `${scope}beads/a`,
      canWriteBead: vi.fn(() => true),
    };
    failure(
      f.execute("putAlias", { alias: "alias/latest", target: "beads/b" }, { policy }),
      "resource-not-found",
    );
    expect(policy.canWriteBead).not.toHaveBeenCalled();
    expect(f.alias("latest")).toBe("beads/a");
    expect(f.writes()).toBe(0);
  });

  it("refuses a committed but deleted proposed target as not found", () => {
    const f = fixture();
    f.mutate((tx) => tx.deleteResource("beads/a"));
    f.reopen();
    failure(
      f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }),
      "resource-not-found",
    );
    expect(f.canWriteBead).not.toHaveBeenCalled();
    expect(f.alias("latest")).toBeUndefined();
    expect(f.writes()).toBe(0);
  });

  it("returns the complete unbounded diagnostic and admits exactly its byte bound", () => {
    const f = fixture();
    const input = { alias: "alias/new", target: "links/no" };
    const result = f.execute("putAlias", input, { limits: {} });
    failure(result, "validation-failed");
    if (result.effect !== "failure") throw new Error("missing diagnostic");
    expect(result.outcome.diagnostics).toHaveLength(1);
    expect(result.outcome).not.toHaveProperty("diagnosticsTruncated");
    const bytes = Buffer.byteLength(JSON.stringify(result.outcome.diagnostics));
    // Startup can apply the same exact bound without a transaction or fake mutation.
    expect(() =>
      assertAliasDiagnosticLimits({ diagnosticCount: 1, diagnosticBytes: bytes }),
    ).not.toThrow();
    expect(() => assertAliasDiagnosticLimits({ diagnosticBytes: bytes - 1 })).toThrow(
      "one complete diagnostic",
    );
    expect(() => assertAliasDiagnosticLimits({ diagnosticCount: 0 })).toThrow(
      "positive usable diagnostic limits",
    );
    expect(
      f.execute("putAlias", input, { limits: { diagnosticCount: 1, diagnosticBytes: bytes } }),
    ).toEqual(result);
    const writes = f.writes();
    for (const [operation, record] of [
      ["putAlias", { alias: "alias/latest", target: "beads/a" }],
      ["deleteAlias", { alias: "alias/missing" }],
    ] as const) {
      expect(() =>
        f.execute(operation, record, { limits: { diagnosticBytes: bytes - 1 } }),
      ).toThrow("one complete diagnostic");
    }
    expect(f.canRead).not.toHaveBeenCalled();
    expect(f.canWriteBead).not.toHaveBeenCalled();
    expect(f.writes()).toBe(writes);
    expect(
      f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }, { limits: {} }).effect,
    ).toBe("success");
    const deleted = f.execute("deleteAlias", { alias: "alias/latest" }, { limits: {} });
    expect(deleted.effect).toBe("success");
    expect(Object.isFrozen(deleted.outcome)).toBe(true);
  });

  it.each([
    { alias: "alias/x?query=1", target: "beads/a" },
    { alias: `${scope}alias/x?query=1`, target: "beads/a" },
    { alias: `${scope}alias/x#fragment`, target: "beads/a" },
  ])("rejects query/fragment alias spelling at actual S1 before admission: %j", (input) => {
    const f = fixture();
    expect(() => f.execute("putAlias", input)).toThrow(ReadUpdateCarrierError);
    expect(f.admissions()).toBe(0);
    expect(f.writes()).toBe(0);
  });

  it.each([
    { alias: "alias//bad", target: "beads/a" },
    { alias: `${scope}alias//bad`, target: "beads/a" },
    { alias: `${scope}alias/x?query=1`, target: "beads/a" },
    { alias: `${scope}alias/x#fragment`, target: "beads/a" },
    { alias: "alias/latest", target: "beads//bad" },
    { alias: "alias/latest", target: `${scope}beads//bad` },
  ])(
    "throws an internal preflight breach if malformed grammar bypasses the caller: %j",
    (input) => {
      const f = fixture();
      const tx: AliasTransaction = {
        resource: vi.fn(() => undefined),
        alias: () => undefined,
        identityWasCommitted: () => false,
        putAlias: vi.fn(),
        deleteAlias: vi.fn(),
      };
      // Deliberately bypass S1 to verify the internal boundary. These exceptions
      // are not public malformed-request responses or a substitute for preflight.
      const run = () => evaluateAliasMutation(tx, { operation: "putAlias", input }, f.options);
      expect(run).toThrow(TypeError);
      expect(run).toThrow("S1/Scope preflight must reject malformed alias references");
      expect(tx.resource).not.toHaveBeenCalled();
      expect(tx.putAlias).not.toHaveBeenCalled();
      expect(tx.deleteAlias).not.toHaveBeenCalled();
    },
  );
});
