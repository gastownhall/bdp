import { describe, expect, it, vi } from "vitest";
import {
  assertPreparedReadUpdateCarrier,
  prepareReadUpdateSequence,
  prepareReadUpdateSingleton,
  parseReadUpdateRequest,
  admitReadUpdateOperationNumbers,
  JsonNumberLiteral,
  ReadUpdateCarrierError,
  type ReadUpdateOperation,
  type PreparedReadUpdateCarrier,
} from "./index.js";

const scope = "https://example.test/s/";
const type = "https://types.test/task";
const prepare = (operation: ReadUpdateOperation, input: unknown) =>
  prepareReadUpdateSingleton(scope, operation, JSON.stringify(input), "exact-Key_1");
const badLocal = [
  "HTTPS://example.test/s/a",
  "https://EXAMPLE.test/s/a",
  "https://example.test:443/s/a",
  "https://example.test/%73/a",
  "https://example.test/s/%62eads/a",
  "https://example.test/s/%61",
  "https://example.test/s/%2F",
  "https://example.test/s/a#",
  "https://example.test/s/a?",
  "https://example.test/s/%FF",
  "https://example.test/%73/%FF",
  "https://example.test/s/../elsewhere/a",
  "https://example.test/x/../s/a",
  "https://example.test/s/a?view=properties",
  "https://example.test/s/a#part",
  "https://example.test/s//a",
];

describe("whole-carrier Read+Update Scope preflight", () => {
  it("binds the carrier to the receiving authority's configured Scope", () => {
    const other = "https://example.test/other/";
    const carrier = prepareReadUpdateSingleton(
      other,
      "deleteBead",
      JSON.stringify({
        bead: "https://example.test/s/%61",
      }),
      "key",
    );
    expect(() => assertPreparedReadUpdateCarrier(carrier, scope)).toThrow("different Scope");
    expect(() => assertPreparedReadUpdateCarrier(carrier, other)).not.toThrow();
    const local = prepare("deleteBead", { bead: "a" });
    expect(() => assertPreparedReadUpdateCarrier(local, scope)).not.toThrow();
  });

  it.each(["blob:https://example.test/a", "blob:https://example.test/s/a"])(
    "preserves an opaque origin-borrowing URI %s for root and nested Scopes",
    (target) => {
      for (const base of ["https://example.test/", scope]) {
        const input = { type, source: "a", target };
        const prepared = prepareReadUpdateSingleton(
          base,
          "createLink",
          JSON.stringify(input),
          "key",
        );
        expect(prepared.operations[0]?.input).toEqual(input);
        expect(() => assertPreparedReadUpdateCarrier(prepared, base)).not.toThrow();
      }
    },
  );

  it("preserves deeply frozen singleton and sequence reference inputs", () => {
    const input = { type, source: "a", target: { uri: "b", revision: "pin" } };
    const singleton = prepare("createLink", input);
    const sequence = prepareReadUpdateSequence(
      scope,
      JSON.stringify({
        operations: [{ operation: "createLink", idempotencyKey: "key", ...input }],
      }),
    );
    for (const prepared of [singleton, sequence]) {
      const value = prepared.operations[0]?.input;
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value?.target)).toBe(true);
      expect(() => Reflect.set(value?.target as object, "uri", "%61")).not.toThrow();
      expect(value?.target).toEqual(input.target);
    }
  });

  it.each(badLocal)("rejects noncanonical local subject %s before preparation", (bead) => {
    const text = JSON.stringify({ bead });
    // These are valid absolute URI spellings for the Scope-independent S1 pass.
    expect(() => parseReadUpdateRequest("deleteBead", text)).not.toThrow();
    expect(() => prepareReadUpdateSingleton(scope, "deleteBead", text, "key")).toThrow(
      ReadUpdateCarrierError,
    );
  });

  it.each([
    ["createBead", { type, id: "https://other.test/s/a" }],
    [
      "createLink",
      { type, id: "https://example.test/sibling/a", source: "a", target: "b" },
    ],
  ] as const)("requires Scope-local creation identity for %s", (operation, input) => {
    expect(() => parseReadUpdateRequest(operation, JSON.stringify(input))).not.toThrow();
    expect(() => prepare(operation, input)).toThrow(ReadUpdateCarrierError);
  });

  it.each([
    ["createBead", { type, id: "task-42" }],
    ["createBead", { type, id: "a" }],
    ["createLink", { type, id: "relation-81", source: "task-42", target: "person-7" }],
    ["createLink", { type, id: "a", source: "task-42", target: "person-7" }],
    ["createBead", { type, id: `${scope}a` }],
    ["createLink", { type, id: `${scope}a`, source: "task-42", target: "person-7" }],
  ] as const)("accepts kind-independent Scope-local identity for %s", (operation, input) => {
    expect(() => prepare(operation, input)).not.toThrow();
  });

  it.each([
    [
      "updateBead",
      {
        bead: "https://example.test:443/s/a",
        propertiesChange: [{ op: "add", path: "/n", value: true }],
      },
    ],
    ["deleteLink", { link: "https://example.test:443/s/a" }],
    [
      "updateLink",
      {
        link: "https://example.test:443/s/a",
        propertiesChange: [{ op: "add", path: "/n", value: true }],
      },
    ],
    ["createLink", { type, source: "https://example.test:443/s/a", target: "b" }],
    [
      "createLink",
      {
        type,
        source: "a",
        target: { uri: "https://example.test:443/s/b", revision: "opaque" },
      },
    ],
    ["putAlias", { alias: "alias/latest", target: "https://example.test:443/s/a" }],
    ["putAlias", { alias: "https://example.test:443/s/alias/latest", target: "a" }],
    ["deleteAlias", { alias: "https://example.test:443/s/alias/latest" }],
  ] as const)("checks every declared reference slot for %s", (operation, input) => {
    expect(() => prepare(operation, input)).toThrow(ReadUpdateCarrierError);
  });

  it.each([
    ["createBead", { type, id: "team/%E2%82%AC/a" }],
    ["createLink", { type, id: `${scope}team/a`, source: "a", target: "b" }],
    ["putAlias", { alias: "alias/alias/latest", target: "a" }],
    ["deleteAlias", { alias: `${scope}alias/team/latest` }],
    ["deleteBead", { bead: "wrong-kind" }],
    ["deleteLink", { link: `${scope}wrong-kind` }],
    ["putAlias", { alias: "wrong-root", target: "wrong-kind" }],
    ["createLink", { type, source: "wrong-kind", target: "b" }],
    ["createLink", { type, source: `${scope}alias/latest`, target: "b" }],
    ["putAlias", { alias: "alias/latest", target: "alias/no-chain" }],
  ] as const)("preserves valid grammar and member-time categories for %s", (operation, input) => {
    const carrier = prepare(operation, input);
    expect(() => assertPreparedReadUpdateCarrier(carrier, scope)).not.toThrow();
    expect(carrier.operations[0]?.input).toEqual(input);
  });

  it.each([
    "urn:example:opaque",
    "https://example.test/s%2Fa",
    "https://example.test/s%5Ca",
    "https://example.test:99999/s/a",
    "foo://[v1.a]/opaque",
    "https://other.test/s/%61?query=1#pin",
    "https://example.test/sibling/%61",
    "https://example.test./s/a",
    "http://example.test/s/a",
    "https://example.test:444/s/a",
    "https://example.test/s%252Fa",
  ])("preserves opaque external endpoint bytes %s without DNS equivalence", (uri) => {
    const input = { type, source: "a", target: { uri, revision: "untouched revision" } };
    expect(prepare("createLink", input).operations[0]?.input).toEqual(input);
    // The same outside spelling as an alias target remains a member category error.
    expect(() => prepare("putAlias", { alias: "alias/latest", target: uri })).not.toThrow();
  });

  it.each(["%2f", "%2F", "%5c", "%5C"])(
    "preserves a distinct escaped path segment %s while rejecting its local counterpart",
    (separator) => {
      const outside = `https://example.test/s${separator}other/a`;
      for (const target of [outside, { uri: outside, revision: "exact pin" }]) {
        const input = { type, source: "a", target };
        expect(() => parseReadUpdateRequest("createLink", JSON.stringify(input))).not.toThrow();
        expect(prepare("createLink", input).operations[0]?.input).toEqual(input);
      }
      const local = { type, source: "a", target: `${scope}a${separator}b` };
      expect(() => parseReadUpdateRequest("createLink", JSON.stringify(local))).not.toThrow();
      expect(() => prepare("createLink", local)).toThrow(ReadUpdateCarrierError);
      const control = { type, source: "a", target: `${scope}a` };
      expect(prepare("createLink", control).operations[0]?.input).toEqual(control);
    },
  );

  it("uses decoded Scope segments without accepting encoded aliases of the Scope", () => {
    const unicodeScope = "https://example.test/team/%E2%82%AC/";
    const good = JSON.stringify({ bead: `${unicodeScope}a` });
    expect(() => prepareReadUpdateSingleton(unicodeScope, "deleteBead", good, "key")).not.toThrow();
    const bad = JSON.stringify({ bead: "https://example.test/%74eam/%e2%82%ac/a" });
    expect(() => prepareReadUpdateSingleton(unicodeScope, "deleteBead", bad, "key")).toThrow(
      ReadUpdateCarrierError,
    );
    const foreign = JSON.stringify({
      type,
      source: "a",
      target: "https://example.test/team/%E2%82%AC-more/a",
    });
    expect(() =>
      prepareReadUpdateSingleton(unicodeScope, "createLink", foreign, "key"),
    ).not.toThrow();
  });

  it("handles a root Scope and never inspects properties or arbitrary URI-looking strings", () => {
    const properties = { uri: "https://EXAMPLE.test/s/%2F", alias: "alias//invalid" };
    const carrier = prepareReadUpdateSingleton(
      "https://example.test/",
      "createBead",
      JSON.stringify({ type, id: "https://example.test/a", properties }),
      "key",
    );
    expect(carrier.operations[0]?.input.properties).toEqual(properties);
    expect(() =>
      prepareReadUpdateSingleton(
        "https://example.test/",
        "deleteBead",
        JSON.stringify({ bead: "https://example.test:443/a" }),
        "key",
      ),
    ).toThrow(ReadUpdateCarrierError);
  });

  it("keeps S1 brands and inadmissible numeric literals without performing numeric admission", () => {
    const carrier = prepareReadUpdateSingleton(
      scope,
      "createBead",
      `{"type":"${type}","properties":{"n":9007199254740993,"overflow":1e9999}}`,
      "key",
    );
    const operation = carrier.operations[0];
    if (!operation) throw new Error("missing operation");
    const properties = operation.input.properties as Readonly<Record<string, unknown>>;
    expect(properties.n).toBeInstanceOf(JsonNumberLiteral);
    expect(properties.n).toMatchObject({ literal: "9007199254740993" });
    expect(properties.overflow).toMatchObject({ literal: "1e9999" });
    // The later numeric boundary recognizes the original private parser brand.
    expect(
      admitReadUpdateOperationNumbers(operation, {
        diagnostic: ({ pointer }) => ({ instanceLocation: pointer, message: "number" }),
      }).ok,
    ).toBe(false);
    expect(Object.isFrozen(carrier)).toBe(true);
    expect(Object.isFrozen(carrier.operations)).toBe(true);
    expect(Object.isFrozen(carrier.keys)).toBe(true);
  });

  it("passes an intact sequence with keys, names and original @ provenance", () => {
    const carrier = prepareReadUpdateSequence(
      scope,
      JSON.stringify({
        operations: [
          { operation: "createBead", idempotencyKey: "one", name: "a", type },
          { operation: "putAlias", idempotencyKey: "two", alias: "alias/a", target: "@a" },
        ],
      }),
    );
    expect(carrier.kind).toBe("sequence");
    expect(carrier.keys).toEqual(["one", "two"]);
    expect(carrier.operations[0]?.name).toBe("a");
    expect(carrier.operations[1]?.input.target).toBe("@a");
    expect(() => assertPreparedReadUpdateCarrier(carrier, scope)).not.toThrow();
  });

  it("does not hand an admission seam any carrier when only its last member is Scope-invalid", () => {
    const admit = vi.fn((carrier: PreparedReadUpdateCarrier) => {
      assertPreparedReadUpdateCarrier(carrier, scope);
      return carrier.keys;
    });
    const receive = (bead: string) =>
      admit(
        prepareReadUpdateSequence(
          scope,
          JSON.stringify({
            operations: [
              { operation: "createBead", idempotencyKey: "first", name: "a", type },
              { operation: "putAlias", idempotencyKey: "middle", alias: "alias/a", target: "@a" },
              { operation: "deleteBead", idempotencyKey: "last", bead },
            ],
          }),
        ),
      );
    expect(() => receive("https://example.test:443/s/a")).toThrow(ReadUpdateCarrierError);
    expect(admit).not.toHaveBeenCalled();
    expect(receive(`${scope}a`)).toEqual(["first", "middle", "last"]);
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged prepared carrier and malformed raw singleton keys", () => {
    const carrier = prepare("deleteBead", { bead: "a" });
    expect(() => assertPreparedReadUpdateCarrier({ ...carrier }, scope)).toThrow(TypeError);
    expect(() => assertPreparedReadUpdateCarrier(null, scope)).toThrow(TypeError);
    for (const key of ["", " padded", "key,key", "a".repeat(257)]) {
      expect(() =>
        prepareReadUpdateSingleton(scope, "deleteBead", '{"bead":"a"}', key),
      ).toThrow(ReadUpdateCarrierError);
    }
  });
});
