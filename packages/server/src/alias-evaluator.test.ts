import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  admitReadUpdateOperationNumbers,
  parseReadUpdateRequest,
  parseBeadRecord,
  parseLinkRecord,
  type ReadUpdateProblem,
} from "@bdp/protocol";
import {
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
  const canWrite = vi.fn(() => true);
  const options: AliasEvaluationOptions = {
    scope,
    policy: { canRead, canWrite },
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
    canWrite,
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
    expect(Object.isFrozen(f.execute("putAlias", input))).toBe(true);
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
    expect(f.canWrite).not.toHaveBeenCalled();
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
      diagnostics: [{ instanceLocation: "/target" }],
    });
    if (result.effect === "failure") expect(result.outcome.diagnostics).toHaveLength(1);
    expect(f.writes()).toBe(0);
    expect(f.canWrite).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "checks permanent Bead identity before unknown/invalid target and authorization (deleted=%s)",
    (deleted) => {
      const f = fixture();
      if (deleted) {
        f.mutate((tx) => tx.deleteResource("beads/a"));
        f.reopen();
      }
      const policy = { canRead: vi.fn(() => false), canWrite: vi.fn(() => false) };
      for (const target of ["beads/missing", "alias/missing"])
        failure(f.execute("putAlias", { alias: "alias/a", target }, { policy }), "identity-taken");
      expect(policy.canRead).not.toHaveBeenCalled();
      expect(policy.canWrite).not.toHaveBeenCalled();
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
    const policy = { canRead: () => false, canWrite: vi.fn(() => false) };
    const hidden = f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }, { policy });
    const missing = f.execute(
      "putAlias",
      { alias: "alias/latest", target: "beads/missing" },
      { policy },
    );
    expect(hidden).toEqual(missing);
    failure(hidden, "resource-not-found");
    failure(f.execute("deleteAlias", { alias: "alias/missing" }, { policy }), "resource-not-found");
    expect(policy.canWrite).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });

  it.each(["beads/a", "beads/b"])(
    "requires write permission on both targets of a repoint: denied %s",
    (denied) => {
      const f = fixture();
      f.mutate((tx) => tx.putAlias("latest", "beads/a"));
      const policy = {
        canRead: () => true,
        canWrite: (before: { id: string }, after: unknown) => {
          expect(after).toBe(before);
          return before.id !== `${scope}${denied}`;
        },
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
    const policy = { canRead: () => true, canWrite: vi.fn(() => false) };
    failure(f.execute("deleteAlias", { alias: "alias/latest" }, { policy }), "forbidden");
    failure(
      f.execute("putAlias", { alias: "alias/latest", target: "beads/a" }, { policy }),
      "forbidden",
    );
    expect(policy.canWrite).toHaveBeenCalledTimes(2);
    expect(f.alias("latest")).toBe("beads/a");
    expect(f.writes()).toBe(0);
  });

  it("does not disclose a hidden current target through a forbidden proposed target", () => {
    const f = fixture();
    f.mutate((tx) => tx.putAlias("latest", "beads/a"));
    const policy = {
      canRead: (record: { id: string }) => record.id !== `${scope}beads/a`,
      canWrite: vi.fn(() => false),
    };
    failure(
      f.execute("putAlias", { alias: "alias/latest", target: "beads/b" }, { policy }),
      "resource-not-found",
    );
    failure(f.execute("deleteAlias", { alias: "alias/latest" }, { policy }), "resource-not-found");
    expect(policy.canWrite).not.toHaveBeenCalled();
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
        canWrite: vi.fn(() => true),
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
      expect(policy.canWrite).not.toHaveBeenCalled();
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
    expect(() => f.execute("putAlias", input)).toThrow();
    expect(f.writes()).toBe(0);
  });

  it("uses current per-member policy and rolls unexpected policy errors back without alias effects", () => {
    const f = fixture();
    const bad = {
      canRead: () => {
        throw new Error("policy unavailable");
      },
      canWrite: () => true,
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
});
