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
  "HTTPS://example.test/s/beads/a",
  "https://EXAMPLE.test/s/beads/a",
  "https://example.test:443/s/beads/a",
  "https://example.test/%73/beads/a",
  "https://example.test/s/%62eads/a",
  "https://example.test/s/beads/%61",
  "https://example.test/s/beads/%2F",
  "https://example.test/s/beads/%FF",
  "https://example.test/%73/beads/%FF",
  "https://example.test/s%2Fbeads/a",
  "https://example.test/s%5Cbeads/a",
  "https://example.test/s/../elsewhere/beads/a",
  "https://example.test/x/../s/beads/a",
  "https://example.test/s/beads/a?view=properties",
  "https://example.test/s/beads/a#part",
  "https://example.test/s//beads/a",
];

describe("whole-carrier Read+Update Scope preflight", () => {
  it.each(badLocal)("rejects noncanonical local subject %s before preparation", (bead) => {
    const text = JSON.stringify({ bead });
    // These are valid absolute URI spellings for the Scope-independent S1 pass.
    expect(() => parseReadUpdateRequest("deleteBead", text)).not.toThrow();
    expect(() => prepareReadUpdateSingleton(scope, "deleteBead", text, "key")).toThrow(
      ReadUpdateCarrierError,
    );
  });

  it.each([
    ["createBead", { type, id: `${scope}links/a` }],
    ["createLink", { type, id: `${scope}beads/a`, source: "beads/a", target: "beads/b" }],
    ["createBead", { type, id: "https://other.test/s/beads/a" }],
    [
      "createLink",
      { type, id: "https://example.test/sibling/links/a", source: "beads/a", target: "beads/b" },
    ],
  ] as const)(
    "requires Scope-local creation identity and correct root for %s",
    (operation, input) => {
      expect(() => parseReadUpdateRequest(operation, JSON.stringify(input))).not.toThrow();
      expect(() => prepare(operation, input)).toThrow(ReadUpdateCarrierError);
    },
  );

  it.each([
    [
      "updateBeadProperties",
      {
        bead: "https://example.test:443/s/beads/a",
        change: [{ op: "add", path: "/n", value: true }],
      },
    ],
    ["deleteLink", { link: "https://example.test:443/s/links/a" }],
    [
      "updateLinkProperties",
      {
        link: "https://example.test:443/s/links/a",
        change: [{ op: "add", path: "/n", value: true }],
      },
    ],
    ["createLink", { type, source: "https://example.test:443/s/beads/a", target: "beads/b" }],
    [
      "createLink",
      {
        type,
        source: "beads/a",
        target: { uri: "https://example.test:443/s/beads/b", revision: "opaque" },
      },
    ],
    ["putAlias", { alias: "alias/latest", target: "https://example.test:443/s/beads/a" }],
    ["putAlias", { alias: "https://example.test:443/s/alias/latest", target: "beads/a" }],
    ["deleteAlias", { alias: "https://example.test:443/s/alias/latest" }],
  ] as const)("checks every declared reference slot for %s", (operation, input) => {
    expect(() => prepare(operation, input)).toThrow(ReadUpdateCarrierError);
  });

  it.each([
    ["createBead", { type, id: "beads/team/%E2%82%AC/a" }],
    ["createLink", { type, id: `${scope}links/team/a`, source: "beads/a", target: "beads/b" }],
    ["putAlias", { alias: "alias/alias/latest", target: "beads/a" }],
    ["deleteAlias", { alias: `${scope}alias/team/latest` }],
    ["deleteBead", { bead: "links/wrong-kind" }],
    ["deleteLink", { link: `${scope}beads/wrong-kind` }],
    ["putAlias", { alias: "beads/wrong-root", target: "links/wrong-kind" }],
    ["createLink", { type, source: "links/wrong-kind", target: "beads/b" }],
    ["createLink", { type, source: `${scope}alias/latest`, target: "beads/b" }],
    ["putAlias", { alias: "alias/latest", target: "alias/no-chain" }],
  ] as const)("preserves valid grammar and member-time categories for %s", (operation, input) => {
    const carrier = prepare(operation, input);
    expect(() => assertPreparedReadUpdateCarrier(carrier)).not.toThrow();
    expect(carrier.operations[0]?.input).toEqual(input);
  });

  it.each([
    "urn:example:opaque",
    "https://example.test:99999/s/beads/a",
    "foo://[v1.a]/opaque",
    "https://other.test/s/beads/%61?query=1#pin",
    "https://example.test/sibling/beads/%61",
    "https://example.test./s/beads/a",
    "http://example.test/s/beads/a",
    "https://example.test:444/s/beads/a",
    "https://example.test/s%252Fbeads/a",
  ])("preserves opaque external endpoint bytes %s without DNS equivalence", (uri) => {
    const input = { type, source: "beads/a", target: { uri, revision: "untouched revision" } };
    expect(prepare("createLink", input).operations[0]?.input).toEqual(input);
    // The same outside spelling as an alias target remains a member category error.
    expect(() => prepare("putAlias", { alias: "alias/latest", target: uri })).not.toThrow();
  });

  it("uses decoded Scope segments without accepting encoded aliases of the Scope", () => {
    const unicodeScope = "https://example.test/team/%E2%82%AC/";
    const good = JSON.stringify({ bead: `${unicodeScope}beads/a` });
    expect(() => prepareReadUpdateSingleton(unicodeScope, "deleteBead", good, "key")).not.toThrow();
    const bad = JSON.stringify({ bead: "https://example.test/%74eam/%e2%82%ac/beads/a" });
    expect(() => prepareReadUpdateSingleton(unicodeScope, "deleteBead", bad, "key")).toThrow(
      ReadUpdateCarrierError,
    );
    const foreign = JSON.stringify({
      type,
      source: "beads/a",
      target: "https://example.test/team/%E2%82%AC-more/beads/a",
    });
    expect(() =>
      prepareReadUpdateSingleton(unicodeScope, "createLink", foreign, "key"),
    ).not.toThrow();
  });

  it("handles a root Scope and never inspects properties or arbitrary URI-looking strings", () => {
    const properties = { uri: "https://EXAMPLE.test/s/beads/%2F", alias: "alias//invalid" };
    const carrier = prepareReadUpdateSingleton(
      "https://example.test/",
      "createBead",
      JSON.stringify({ type, id: "https://example.test/beads/a", properties }),
      "key",
    );
    expect(carrier.operations[0]?.input.properties).toEqual(properties);
    expect(() =>
      prepareReadUpdateSingleton(
        "https://example.test/",
        "deleteBead",
        JSON.stringify({ bead: "https://example.test:443/beads/a" }),
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
    expect(() => assertPreparedReadUpdateCarrier(carrier)).not.toThrow();
  });

  it("does not hand an admission seam any carrier when only its last member is Scope-invalid", () => {
    const admit = vi.fn((carrier: PreparedReadUpdateCarrier) => {
      assertPreparedReadUpdateCarrier(carrier);
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
    expect(() => receive("https://example.test:443/s/beads/a")).toThrow(ReadUpdateCarrierError);
    expect(admit).not.toHaveBeenCalled();
    expect(receive(`${scope}beads/a`)).toEqual(["first", "middle", "last"]);
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it("rejects a forged prepared carrier and malformed raw singleton keys", () => {
    const carrier = prepare("deleteBead", { bead: "beads/a" });
    expect(() => assertPreparedReadUpdateCarrier({ ...carrier })).toThrow(TypeError);
    expect(() => assertPreparedReadUpdateCarrier(null)).toThrow(TypeError);
    for (const key of ["", " padded", "key,key", "a".repeat(257)]) {
      expect(() =>
        prepareReadUpdateSingleton(scope, "deleteBead", '{"bead":"beads/a"}', key),
      ).toThrow(ReadUpdateCarrierError);
    }
  });
});
