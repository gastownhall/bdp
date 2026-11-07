import { describe, expect, it } from "vitest";
import { compareBatch, prepareBatch } from "./batch-contract.js";
import { evaluateBatch } from "./batch-evaluate.js";
import type { ResourceState, RetainedBead } from "./contract.js";

const scope = "https://batch.invalid/s/";
const type = { uri: "https://types.invalid/Task", revision: "T1" };
const base: RetainedBead = {
  id: scope + "existing",
  type,
  revision: "baseline",
  properties: { status: "open", literal: "@new" },
  metadata: {},
  revisionProvenance: { actor: { id: "original", basis: "writer-supplied" } },
};
const initial = new Map<string, ResourceState>([[base.id, { kind: "bead", resource: base }]]);
function evaluate(operations: unknown[], baseline = initial) {
  const prepared = prepareBatch(
    scope,
    JSON.stringify({ capabilityVersion: "1", operations }),
    "batch-key",
  );
  return evaluateBatch(
    prepared,
    compareBatch(prepared, () => undefined),
    baseline,
    new Set(baseline.keys()),
    () => false,
    () => false,
    "2026-11-02T16:00:00Z",
    () => false,
    () => [],
  );
}
const update = (properties: unknown, extra = {}) => ({
  operation: "updateBead",
  bead: "existing",
  properties,
  ...extra,
});

describe("selected batch1 admission and logical final state", () => {
  it("preserves lossless member number tokens for ordinary numeric admission", () => {
    const raw = (token: string) =>
      `{"capabilityVersion":"1","operations":[{"operation":"createBead","id":"numeric","type":${JSON.stringify(type)},"properties":{"n":${token}}}]}`;
    const accepted = prepareBatch(scope, raw("9007199254740992"), "numeric");
    const result = evaluateBatch(
      accepted,
      compareBatch(accepted, () => undefined),
      new Map(),
      new Set(),
      () => false,
      () => false,
      "2026-11-02T16:00:00Z",
      () => false,
      () => [],
    );
    expect(result.status).toBe(200);
    const refused = prepareBatch(scope, raw("9007199254740993"), "numeric");
    const failure = evaluateBatch(
      refused,
      compareBatch(refused, () => undefined),
      new Map(),
      new Set(),
      () => false,
      () => false,
      "2026-11-02T16:00:00Z",
      () => false,
      () => [],
    );
    expect(failure.status).toBe(422);
    expect(failure.effects).toEqual([]);
    expect(failure.allocations).toEqual([]);
  });
  it.each([
    [
      { operation: "createBead", type, name: "a" },
      { operation: "deleteLink", link: "@a" },
    ],
    [
      { operation: "deleteBead", bead: "@later" },
      { operation: "createBead", type, name: "later" },
    ],
    [
      { operation: "createBead", type, name: "a" },
      { operation: "createBead", type, name: "a" },
    ],
    [{ operation: "createBead", type, id: "@name" }],
    [{ operation: "updateWhere", selector: "x" }],
    [
      {
        operation: "updateBead",
        bead: "existing",
        revisionProvenance: { message: "not mutation input" },
      },
    ],
    [{ operation: "deleteBead", bead: "existing", name: "forbidden" }],
  ])("refuses the complete malformed carrier without staging: %j", (...operations) => {
    expect(() =>
      prepareBatch(scope, JSON.stringify({ capabilityVersion: "1", operations }), "key"),
    ).toThrow("malformed-request");
  });
  it("normalizes label spelling without confusing a literal URL with a handle", () => {
    const make = (name: string, target = `@${name}`) =>
      prepareBatch(
        scope,
        JSON.stringify({
          capabilityVersion: "1",
          operations: [
            { operation: "createBead", type, name },
            { operation: "updateBead", bead: target, properties: {} },
          ],
        }),
        "key",
      );
    expect(make("alpha").identity).toBe(make("beta").identity);
    expect(make("alpha", scope + "batch-binding-0").identity).not.toBe(make("alpha").identity);
  });
  it("does not interpret future-version members as current CRUD", () => {
    const input = prepareBatch(scope, '{"capabilityVersion":"future","newGrammar":[null]}', "key");
    expect(input.capabilityVersion).toBe("future");
    expect(input.members).toEqual([]);
  });
  it("uses committed-baseline guards after staged edits and preserves the exact no-op envelope", () => {
    const outcome = evaluate([
      update({ status: "closed" }, { expectedRevision: "baseline" }),
      update(base.properties, {
        expectedRevision: "baseline",
        revisionProvenance: { message: "not a new version" },
      }),
    ]);
    const result = JSON.parse(outcome.text);
    expect(result).toEqual({
      capabilityVersion: "1",
      changed: false,
      results: [
        { operationIndex: 0, operation: "updateBead", id: base.id },
        { operationIndex: 1, operation: "updateBead", id: base.id },
      ],
      resources: [
        { id: base.id, resourceKind: "bead", outcome: "unchanged", changed: false, resource: base },
      ],
    });
    expect(outcome.effects).toEqual([]);
    expect(outcome.allocations).toEqual([]);
  });
  it("publishes only the final postimage once and keeps a guard distinct from a pin", () => {
    const outcome = evaluate([
      update({ n: 1 }, { expectedRevision: "baseline" }),
      update({ n: 2 }, { expectedRevision: "baseline" }),
    ]);
    const result = JSON.parse(outcome.text);
    expect(outcome.status).toBe(200);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]).toMatchObject({
      outcome: "updated",
      resource: { type, properties: { n: 2 } },
    });
    expect(result.resources[0].resource.revision).not.toBe("baseline");
    expect(result.resources[0].resource).not.toHaveProperty("revisionProvenance");
    expect(outcome.effects).toHaveLength(1);
    expect(result.transaction).toEqual(expect.any(String));
  });
  it("reports allocation without a fabricated revision/body and refuses reuse in the same decision", () => {
    const operations = [
      { operation: "createBead", id: "new", type, name: "n" },
      { operation: "deleteBead", bead: "@n" },
    ];
    const result = JSON.parse(evaluate(operations).text);
    expect(result.resources).toEqual([
      { id: scope + "new", resourceKind: "bead", outcome: "allocated", changed: true },
    ]);
    expect(evaluate(operations).effects).toEqual([]);
    const failure = evaluate([...operations, { operation: "createBead", id: "new", type }]);
    expect(JSON.parse(failure.text).code).toBe("identity-taken");
    expect(failure.allocations).toEqual([]);
  });
  it("refuses literal guards on newly created identities and updates after staged deletion", () => {
    const created = { operation: "createBead", type, name: "n" };
    expect(
      JSON.parse(
        evaluate([
          created,
          { operation: "updateBead", bead: "@n", properties: {}, expectedRevision: "unpublished" },
        ]).text,
      ).code,
    ).toBe("revision-mismatch");
    expect(
      JSON.parse(
        evaluate([
          { operation: "deleteBead", bead: "existing" },
          update({ value: "after deletion" }),
        ]).text,
      ).code,
    ).toBe("resource-not-found");
  });
  it("keeps whole exact endpoint References and sorts final rows separately from input mappings", () => {
    const outcome = evaluate([
      { operation: "createBead", id: "z", type, name: "node" },
      {
        operation: "createLink",
        id: "a-link",
        type,
        source: { uri: "@node", revision: "literal-pin" },
        target: "urn:opaque:target",
      },
    ]);
    const result = JSON.parse(outcome.text);
    expect(result.results.map((entry: { id: string }) => entry.id)).toEqual([
      scope + "z",
      scope + "a-link",
    ]);
    expect(result.resources.map((entry: { id: string }) => entry.id)).toEqual([
      scope + "a-link",
      scope + "z",
    ]);
    expect(result.resources[0].resource.source).toEqual({
      uri: scope + "z",
      revision: "literal-pin",
    });
    expect(result.resources[0]).not.toHaveProperty("ownerRevisions");
  });
  it("rejects conflicting explicit attribution only when a final version would be published", () => {
    const first = update({ changed: 1 }, { revisionProvenance: { message: "one" } });
    const second = update({ changed: 2 }, { revisionProvenance: { message: "two" } });
    const outcome = evaluate([first, second]);
    expect(JSON.parse(outcome.text).code).toBe("validation-failed");
    expect(outcome.effects).toEqual([]);
    expect(outcome.allocations).toEqual([]);
  });
  it("does not turn differing valid provenance inputs into no-op/deleted/allocation-only conflicts", () => {
    const one = { revisionProvenance: { message: "one" } };
    const two = { revisionProvenance: { message: "two" } };
    const noop = evaluate([update({ temporary: true }, one), update(base.properties, two)]);
    expect(noop.status).toBe(200);
    expect(JSON.parse(noop.text).resources[0]).toEqual({
      id: base.id,
      resourceKind: "bead",
      outcome: "unchanged",
      changed: false,
      resource: base,
    });
    const deleted = evaluate([
      update({ temporary: 1 }, one),
      update({ temporary: 2 }, two),
      { operation: "deleteBead", bead: "existing" },
    ]);
    expect(deleted.status).toBe(200);
    expect(JSON.parse(deleted.text).resources[0].deleted.resource.revision).toBe("baseline");
    const allocation = evaluate([
      { operation: "createBead", id: "transient", type, name: "n", ...one },
      { operation: "updateBead", bead: "@n", properties: { transient: true }, ...two },
      { operation: "deleteBead", bead: "@n" },
    ]);
    expect(allocation.status).toBe(200);
    expect(JSON.parse(allocation.text).resources).toEqual([
      { id: scope + "transient", resourceKind: "bead", outcome: "allocated", changed: true },
    ]);
    expect(allocation.effects).toEqual([]);
  });
  it("validates provenance contributors even when a contributing local edit is equal", () => {
    const conflict = evaluate([
      update(base.properties, { revisionProvenance: { message: "equal-edit contribution" } }),
      update({ final: true }, { revisionProvenance: { message: "different contribution" } }),
    ]);
    expect(conflict.status).toBe(422);
    expect(conflict.effects).toEqual([]);
    const unchanged = evaluate([
      update(base.properties, { revisionProvenance: { message: "no new version" } }),
    ]);
    expect(unchanged.status).toBe(200);
    expect(JSON.parse(unchanged.text).resources[0].resource).toEqual(base);
  });
  it("derives the complete result bound before returning any publishable effect", () => {
    const large = new Map<string, ResourceState>(
      ["one", "two"].map((id) => {
        const resource = { ...base, id: scope + id, properties: { padding: "x".repeat(140000) } };
        return [resource.id, { kind: "bead" as const, resource }];
      }),
    );
    const result = evaluate(
      [
        { operation: "updateBead", bead: "one", metadata: {} },
        { operation: "updateBead", bead: "two", metadata: {} },
      ],
      large,
    );
    expect(result.status).toBe(413);
    expect(JSON.parse(result.text).code).toBe("limit-exceeded");
    expect(result.rows).toEqual([]);
    expect(result.effects).toEqual([]);
    expect(result.allocations).toEqual([]);
  });
  it("refuses a late invalid patch with no prefix effects or allocations", () => {
    const outcome = evaluate([
      { operation: "createBead", id: "must-not-allocate", type },
      {
        operation: "updateBead",
        bead: "existing",
        propertiesChange: [{ op: "replace", path: "/missing", value: 1 }],
      },
    ]);
    expect(outcome.status).toBe(422);
    expect(outcome.effects).toEqual([]);
    expect(outcome.allocations).toEqual([]);
    expect(initial.get(base.id)?.resource).toEqual(base);
  });
});
