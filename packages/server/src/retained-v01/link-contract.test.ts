import { describe, expect, it } from "vitest";
import { RetainedFixtureGap, RetainedRequestError } from "./contract.js";
import { assertPreparedLink, prepareLink } from "./link-contract.js";

const scope = "https://scope.invalid/acme/";
const type = { uri: "https://types.invalid/Relation", revision: "definition/+opaque" };
describe("private Core-only Link admission", () => {
  it("normalizes local endpoints and preserves exact pins and opaque external URI bytes", () => {
    const external = "https://Other.Invalid/path?value=%2f#fragment";
    const first = prepareLink(
      scope,
      "createLink",
      JSON.stringify({
        type,
        source: "left",
        target: { uri: external, revision: "foreign/+unvalidated" },
        properties: { ordinary: { uri: "not a Reference", revision: 3 } },
      }),
      "key",
    );
    expect(first.value.source).toBe(`${scope}left`);
    expect(first.value.target).toEqual({ uri: external, revision: "foreign/+unvalidated" });
    expect(first.value.properties).toEqual({ ordinary: { uri: "not a Reference", revision: 3 } });
    expect(first.value.metadata).toEqual({});
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.value.target)).toBe(true);
    expect(() => assertPreparedLink(scope, "createLink", { ...first })).toThrow();
    expect(() => assertPreparedLink(scope, "updateLink", first)).toThrow();
    expect(() => assertPreparedLink("https://other.invalid/", "createLink", first)).toThrow();
  });
  it("normalizes defaults, exact numeric spelling and local/full forms without erasing a pin", () => {
    const first = prepareLink(
      scope,
      "createLink",
      '{"type":"https://types.invalid/R","source":"left","target":{"uri":"right","revision":"r"},"properties":{"n":1e0}}',
      "key",
    );
    const second = prepareLink(
      scope,
      "createLink",
      JSON.stringify({
        metadata: {},
        properties: { n: 1 },
        source: `${scope}left`,
        target: { uri: `${scope}right`, revision: "r" },
        type: "https://types.invalid/R",
      }),
      "key",
    );
    expect(first.identity).toBe(second.identity);
    expect(
      prepareLink(
        scope,
        "createLink",
        JSON.stringify({
          type: "https://types.invalid/R",
          source: "left",
          target: "right",
          properties: { n: 1 },
        }),
        "key",
      ).identity,
    ).not.toBe(first.identity);
  });
  it("admits endpoint-only corrections and preserves omitted endpoint intent", () => {
    const input = prepareLink(
      scope,
      "updateLink",
      JSON.stringify({
        link: "edge",
        source: {
          uri: "left",
          revision: "pin",
        },
        expectedRevision: "Link-revision",
        revisionProvenance: { message: "move" },
      }),
      "key",
    );
    expect(input.value.link).toBe(`${scope}edge`);
    expect(input.value.source).toEqual({ uri: `${scope}left`, revision: "pin" });
    expect(input.value).not.toHaveProperty("target");
    expect(input.value).not.toHaveProperty("properties");
    expect(input.identity).not.toBe(
      prepareLink(
        scope,
        "updateLink",
        JSON.stringify({
          link: "edge",
          source: "left",
          expectedRevision: "Link-revision",
          revisionProvenance: { message: "move" },
        }),
        "key",
      ).identity,
    );
  });
  it("retains exact rejected numeric intent in metadata patch diagnostics", () => {
    const bad = prepareLink(
      scope,
      "updateLink",
      '{"link":"edge","metadataChange":[{"op":"add","path":"/n","value":9007199254740993}]}',
      "key",
    );
    const rounded = prepareLink(
      scope,
      "updateLink",
      '{"link":"edge","metadataChange":[{"op":"add","path":"/n","value":9007199254740992}]}',
      "key",
    );
    expect(bad.refusal).toMatchObject({
      code: "validation-failed",
      diagnostics: [{ document: "metadata" }],
    });
    expect(bad.value).toEqual({});
    expect(bad.identity).not.toBe(rounded.identity);
  });
  it.each([
    { type, source: null, target: "right" },
    { type, source: { revision: "r" }, target: "right" },
    { type, source: { uri: "left", revision: "" }, target: "right" },
    { type, source: "@binding", target: "right" },
    { type, source: "../left", target: "right" },
    { type, source: "https://SCOPE.invalid/acme/left", target: "right" },
    { type, source: "left" },
    { type, source: "left", target: "right", operation: "createLink" },
  ])("refuses malformed create carrier %j", (body) => {
    expect(() => prepareLink(scope, "createLink", JSON.stringify(body), "key")).toThrow(
      RetainedRequestError,
    );
  });
  it.each([
    { link: "edge" },
    { link: "edge", expectedRevision: "r" },
    { link: "edge", id: "other", source: "left" },
    { link: "edge", source: null },
    { link: "edge", properties: {}, propertiesChange: [] },
    { link: "edge", metadataChange: [{ op: "remove", path: "bad" }] },
  ])("refuses malformed update carrier %j", (body) => {
    expect(() => prepareLink(scope, "updateLink", JSON.stringify(body), "key")).toThrow(
      RetainedRequestError,
    );
  });
  it("admits deletion provenance but not unrelated deletion fields", () => {
    const input = prepareLink(
      scope,
      "deleteLink",
      JSON.stringify({
        link: "edge",
        expectedRevision: "r",
        revisionProvenance: { message: "delete" },
      }),
      "key",
    );
    expect(input.value.link).toBe(`${scope}edge`);
    expect(input.value.revisionProvenance).toEqual({ message: "delete" });
    expect(() =>
      prepareLink(scope, "deleteLink", JSON.stringify({ link: "edge", target: "right" }), "key"),
    ).toThrow(RetainedRequestError);
  });
  it.each(["group/a:b", "9:a"])("admits unambiguous colon-bearing local path %s", (source) => {
    const input = prepareLink(
      scope,
      "createLink",
      JSON.stringify({ type, source, target: "right" }),
      "key",
    );
    expect(input.value.source).toBe(scope + source);
  });
  it.each(["a:b", "urn:example:one"])(
    "keeps the unresolved Reference spelling %s as an explicit private fixture gap",
    (source) => {
      expect(() =>
        prepareLink(scope, "createLink", JSON.stringify({ type, source, target: "right" }), "key"),
      ).toThrow(RetainedFixtureGap);
      expect(
        prepareLink(
          scope,
          "createLink",
          JSON.stringify({ type, source: scope + source, target: "right" }),
          "key",
        ).value.source,
      ).toBe(scope + source);
    },
  );
});
