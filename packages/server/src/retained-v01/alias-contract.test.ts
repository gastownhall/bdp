import { describe, expect, it } from "vitest";
import { assertPreparedAlias, prepareAlias } from "./alias-contract.js";
import { RetainedFixtureGap, RetainedRequestError } from "./contract.js";

const scope = "https://scope.invalid/acme/";
describe("private alias singleton carrier, without storage or routes", () => {
  it("normalizes equivalent escaped local and absolute aliases before identity comparison", () => {
    const canonical = prepareAlias(
      scope,
      "putAlias",
      '{"alias":"names/latest","target":"one"}',
      "key",
    );
    const escaped = prepareAlias(
      scope,
      "putAlias",
      JSON.stringify({ alias: `${scope}names/%6catest`, target: "%6Fne" }),
      "key",
    );
    expect(escaped).toMatchObject({ alias: `${scope}names/latest`, target: `${scope}one` });
    expect(escaped.identity).toBe(canonical.identity);
    expect(prepareAlias(scope, "deleteAlias", '{"alias":"names/%6Catest"}', "key").identity).toBe(
      prepareAlias(scope, "deleteAlias", '{"alias":"names/latest"}', "key").identity,
    );
  });
  it("normalizes full Scope-relative paths without adding or stripping an alias root", () => {
    const put = prepareAlias(
      scope,
      "putAlias",
      '{"alias":"names/latest","target":"beads/one"}',
      "key",
    );
    expect(put.alias).toBe("https://scope.invalid/acme/names/latest");
    expect(put).toMatchObject({
      operation: "putAlias",
      target: "https://scope.invalid/acme/beads/one",
    });
    expect(
      prepareAlias(
        scope,
        "putAlias",
        JSON.stringify({ alias: `${scope}names/latest`, target: `${scope}beads/one` }),
        "different-key",
      ).identity,
    ).toBe(put.identity);
    expect(
      prepareAlias(scope, "putAlias", '{"alias":"latest","target":"beads/one"}', "key").identity,
    ).not.toBe(put.identity);
  });
  it("captures immutable branded intent and excludes only the external key from identity", () => {
    const put = prepareAlias(scope, "putAlias", '{"alias":"names/a","target":"one"}', "key");
    expect(Object.isFrozen(put)).toBe(true);
    expect(() => assertPreparedAlias(scope, "putAlias", put)).not.toThrow();
    expect(() => assertPreparedAlias(scope, "putAlias", { ...put })).toThrow(TypeError);
    expect(() => assertPreparedAlias(scope, "deleteAlias", put)).toThrow(TypeError);
    expect(() => assertPreparedAlias("https://other.invalid/", "putAlias", put)).toThrow(TypeError);
    expect(
      prepareAlias(scope, "putAlias", '{"target":"one","alias":"names/a"}', "another").identity,
    ).toBe(put.identity);
    expect(
      prepareAlias(scope, "putAlias", '{"target":"two","alias":"names/a"}', "key").identity,
    ).not.toBe(put.identity);
    const deleted = prepareAlias(scope, "deleteAlias", '{"alias":"names/a"}', "key");
    expect(deleted.identity).not.toBe(put.identity);
    expect(deleted).not.toHaveProperty("target");
  });
  it("leaves namespace and target liveness/kind admission for the retained decision", () => {
    const outside = "https://Other.Invalid/not-an-alias?literal=%2f#fragment";
    const put = prepareAlias(
      scope,
      "putAlias",
      JSON.stringify({ alias: outside, target: "links/maybe" }),
      "key",
    );
    expect(put.alias).toBe(outside);
    expect(put).toMatchObject({ target: `${scope}links/maybe` });
    expect(
      prepareAlias(scope, "putAlias", JSON.stringify({ alias: "names/a", target: outside }), "key"),
    ).toMatchObject({ target: outside });
    // Syntactic admission is not successful alias creation or target validation.
    expect(put).not.toHaveProperty("outcome");
  });
  it.each(["group/a:b", "9:a"])("preserves unambiguous local colon path %s", (alias) => {
    expect(prepareAlias(scope, "deleteAlias", JSON.stringify({ alias }), "key").alias).toBe(
      scope + alias,
    );
  });
  it.each(["a:b", "urn:example:one"])(
    "keeps Reference ambiguity %s explicit, without adopting the proposal",
    (alias) => {
      expect(() => prepareAlias(scope, "deleteAlias", JSON.stringify({ alias }), "key")).toThrow(
        RetainedFixtureGap,
      );
      expect(() =>
        prepareAlias(scope, "putAlias", JSON.stringify({ alias: "names/a", target: alias }), "key"),
      ).toThrow(RetainedFixtureGap);
      expect(
        prepareAlias(scope, "deleteAlias", JSON.stringify({ alias: scope + alias }), "key").alias,
      ).toBe(scope + alias);
    },
  );
  it.each([
    null,
    [],
    {},
    { alias: null, target: "one" },
    { alias: "names/a" },
    { alias: "@binding", target: "one" },
    { alias: "names/a", target: "@binding" },
    { alias: "../names/a", target: "one" },
    { alias: "names/a", target: null },
    { alias: "names/a", target: { uri: "one", revision: "r" } },
    { alias: "names/a", target: "one", expectedRevision: "r" },
    { alias: "names/a", target: "one", revisionProvenance: {} },
    { alias: "names/a", target: "one", operation: "putAlias" },
    { alias: "names/a", target: "one", name: "captured" },
    { alias: "names/a", target: "one", idempotencyKey: "body-key" },
  ])("refuses malformed put carrier %j", (body) => {
    expect(() => prepareAlias(scope, "putAlias", JSON.stringify(body), "key")).toThrow(
      RetainedRequestError,
    );
  });
  it.each([
    {},
    { alias: "" },
    { alias: "names/a", target: "one" },
    { alias: "names/a", expectedRevision: "r" },
    { alias: "names/a", revisionProvenance: {} },
    { alias: "names/a", changed: false },
  ])("refuses malformed delete carrier %j", (body) => {
    expect(() => prepareAlias(scope, "deleteAlias", JSON.stringify(body), "key")).toThrow(
      RetainedRequestError,
    );
  });
  it.each(["", "contains space", "a".repeat(257), "é", "with/slash"])(
    "refuses invalid external key %s",
    (key) => {
      expect(() => prepareAlias(scope, "deleteAlias", '{"alias":"names/a"}', key)).toThrow(
        RetainedRequestError,
      );
    },
  );
  it("does not round malformed values or accept malformed JSON", () => {
    for (const text of [
      '{"alias":9007199254740993}',
      '{"alias":"names/a",}',
      '{"alias":"names/a","alias":"names/b"}',
    ]) {
      expect(() => prepareAlias(scope, "deleteAlias", text, "key")).toThrow(RetainedRequestError);
    }
  });
});
