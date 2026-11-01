import { describe, expect, it } from "vitest";
import {
  prepareBatch,
  compareBatch,
  assertPreparedBatch,
  assertBatchIdentity,
} from "./atomic-batch.js";
const scope = "https://batch.invalid/s/";
const create = (name: string) => ({
  operation: "createBead",
  name,
  type: { uri: "https://types.invalid/T", revision: "exact +/@=" },
  properties: { literal: "@unchanged", number: 1 },
});
const prepare = (operations: unknown[], key = "k") =>
  prepareBatch(scope, JSON.stringify({ capabilityVersion: "1", operations }), key);
describe("private atomic-batch1 pure preparation", () => {
  it("captures prior typed names without interpreting property data or label spelling as identity", () => {
    const first = prepare([
      create("A"),
      { operation: "updateBead", bead: "@A", properties: { literal: "@A" } },
    ]);
    const renamed = prepare([
      create("Renamed"),
      { operation: "updateBead", bead: "@Renamed", properties: { literal: "@A" } },
    ]);
    expect(first.identity).toBe(renamed.identity);
    expect(first.members[0]?.input.type).toEqual({
      uri: "https://types.invalid/T",
      revision: "exact +/@=",
    });
    expect(first.members[1]?.input.properties).toEqual({ literal: "@A" });
    expect(first.members[1]?.bindings).toEqual([{ slot: "bead", creator: 0 }]);
    expect(Object.isFrozen(first.members)).toBe(true);
    expect(() => assertPreparedBatch(scope, { ...first })).toThrow("forged");
    const direct = prepare([
      create("A"),
      {
        operation: "updateBead",
        bead: "https://batch-handles.invalid/0",
        properties: { literal: "@A" },
      },
    ]);
    expect(first.identity).not.toBe(direct.identity);
  });
  it.each(
    [
      [{ operation: "updateBead", bead: "@future", properties: {} }, create("future")],
      [create("A"), create("A")],
      [create("A"), { operation: "updateLink", link: "@A", properties: {} }],
      [create("A"), { operation: "updateBead", bead: "@A", name: "bad", properties: {} }],
      [{ operation: "putAlias", alias: "a", target: "b" }],
      [{ operation: "createBead", id: "@A", type: "https://types.invalid/T" }],
      [{ operation: "createBead", type: "@A" }],
      [{ operation: "updateBead", bead: "b", properties: {}, propertiesChange: [] }],
    ].map((operations) => ({ operations })),
  )("refuses static carrier and handle misuse %#", ({ operations }) => {
    expect(() => prepare(operations)).toThrow();
  });
  it("preserves exact numeric intent through member preparation, including refused decimals", () => {
    const refused = prepareBatch(
      scope,
      '{"capabilityVersion":"1","operations":[{"operation":"createBead","type":"https://types.invalid/T","properties":{"n":9007199254740993}}]}',
      "numeric",
    );
    expect(refused.members[0]?.input.refusal?.status).toBe(422);
    const rounded = prepareBatch(
      scope,
      '{"capabilityVersion":"1","operations":[{"operation":"createBead","type":"https://types.invalid/T","properties":{"n":9007199254740992}}]}',
      "numeric",
    );
    expect(refused.identity).not.toBe(rounded.identity);
    expect(rounded.members[0]?.input.properties?.n).toBe(9007199254740992);
  });
  it("preserves original alias misses/pins across comparison while leaving unsupported versions opaque", () => {
    const input = prepare([{ operation: "updateBead", bead: "names/a", properties: {} }]);
    const first = compareBatch(input, (uri) => (uri === `${scope}names/a` ? null : undefined));
    expect(first.witnesses).toEqual([{ locator: `${scope}names/a`, target: null }]);
    const retry = compareBatch(input, () => `${scope}now-live`, first.witnesses);
    expect(retry.identity).toBe(first.identity);
    expect(retry.inputs[0]?.refusal?.code).toBe("resource-not-found");
    const changed = prepare([{ operation: "updateBead", bead: "names/b", properties: {} }]);
    expect(compareBatch(changed, () => null, first.witnesses).identity).not.toBe(first.identity);
    const future = prepareBatch(
      scope,
      '{"capabilityVersion":"future","foreign":{"not":"v1"}}',
      "future",
    );
    expect(future.version).toBe("future");
    expect(future.members).toEqual([]);
    expect(() =>
      prepareBatch(scope, '{"capabilityVersion":"1","operations":[],"extra":true}', "k"),
    ).toThrow();
  });
});

/** Mutate exactly the private ordinary-input cell; leave context canonical. */
function corruptInput(identity: string, mutation: string): string {
  const field = (node: unknown, name: string): unknown[] => {
    const fields = (node as unknown[])[1] as unknown[][];
    const pair = fields.find((entry) => entry[0] === name);
    if (!pair) throw Error("missing identity field");
    return pair;
  };
  const outer = JSON.parse(identity) as unknown[];
  const input = field(outer[1], "input")[1] as unknown[];
  const member = (input[1] as unknown[])[0];
  const cell = field(member, "identity")[1] as unknown[];
  const ordinary = JSON.parse(String(cell[1])) as unknown[];
  const normalized = field(ordinary[1], "input");
  if (mutation === "empty") normalized[1] = ["object", []];
  else if (mutation === "missing-default") {
    const fields = (normalized[1] as unknown[])[1] as unknown[][];
    (normalized[1] as unknown[])[1] = fields.filter((entry) => entry[0] !== "metadata");
  } else if (mutation === "recursive-tag")
    field(normalized[1], "properties")[1] = ["object", [["n", ["number", "bad", "0"]]]];
  else field(normalized[1], "type")[1] = ["null"];
  cell[1] = JSON.stringify(ordinary);
  return JSON.stringify(outer);
}
describe("complete private normalized batch identity recovery", () => {
  it.each(["empty", "missing-default", "recursive-tag", "type-shape"])(
    "rejects malformed normalized input %s while retaining the untouched identity",
    (mutation) => {
      const input = prepare([
        { operation: "createBead", id: "identity", type: "https://types.invalid/T" },
      ]);
      const mappings = [
        { operationIndex: 0, operation: "createBead" as const, id: `${scope}identity` },
      ];
      expect(() => assertBatchIdentity(input.identity, scope, mappings)).not.toThrow();
      expect(() =>
        assertBatchIdentity(corruptInput(input.identity, mutation), scope, mappings),
      ).toThrow();
      expect(() => assertBatchIdentity(input.identity, scope, mappings)).not.toThrow();
    },
  );
});
