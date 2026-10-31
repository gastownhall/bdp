import { describe, expect, it } from "vitest";
import {
  assertPreparedCreate,
  assertPreparedUpdate,
  assertPreparedDelete,
  canonicalCreatedId,
  canonicalLocalReference,
  captureNavigation,
  materializeBead,
  prepareCreate,
  prepareUpdate,
  prepareDelete,
  problem,
  RetainedRequestError,
} from "./contract.js";

const scope = "https://scope.invalid/acme/";
const type = { uri: "https://types.invalid/Task", revision: "definition/+opaque" };
describe("private local Reference normalization with strict creation spelling", () => {
  it("compares once-decoded segments, emits canonical escapes and preserves Unicode distinctions", () => {
    expect(canonicalLocalReference(scope, "names/%6Catest")).toBe(`${scope}names/latest`);
    expect(canonicalLocalReference(scope, `${scope}names/%6catest`)).toBe(`${scope}names/latest`);
    expect(canonicalLocalReference(scope, "names/%c3%a9")).toBe(`${scope}names/%C3%A9`);
    expect(canonicalLocalReference(scope, "names/%252F")).toBe(`${scope}names/%252F`);
    expect(canonicalLocalReference(scope, "names/%C3%A9")).not.toBe(
      canonicalLocalReference(scope, "names/e%CC%81"),
    );
    expect(() => canonicalCreatedId(scope, "names/%6Catest")).toThrow(RetainedRequestError);
    const canonical = prepareUpdate(scope, '{"bead":"names/latest","properties":{}}', "key");
    expect(prepareUpdate(scope, '{"bead":"names/%6Catest","properties":{}}', "key").identity).toBe(
      canonical.identity,
    );
  });
  it.each([
    "",
    "/a",
    "//other.invalid/a",
    "a/",
    "a//b",
    "a/%2e%2e/b",
    "a%2fb",
    "a%5Cb",
    "a%00",
    "a?x=1",
    "a#fragment",
    "a b",
    "%",
    "%C0%AF",
    "%FF",
    "@binding",
  ])("refuses invalid local Reference segments %s", (value) => {
    expect(() => canonicalLocalReference(scope, value)).toThrow(RetainedRequestError);
  });
  it("allows Scope as the alias base while preserving other navigation ambiguities", () => {
    const navigation = {
      scope,
      aliases: scope,
      description: `${scope}about`,
      beads: `${scope}nodes`,
      links: `${scope}edges`,
      events: `${scope}facts`,
      operations: `${scope}commands`,
      targets: {
        createBead: `${scope}c1`,
        updateBead: `${scope}u1`,
        deleteBead: `${scope}d1`,
        createLink: `${scope}c2`,
        updateLink: `${scope}u2`,
        deleteLink: `${scope}d2`,
        putAlias: `${scope}p`,
        deleteAlias: `${scope}x`,
      },
    };
    expect(captureNavigation(navigation).aliases).toBe(scope);
    expect(() => captureNavigation({ ...navigation, description: scope })).toThrow("ambiguous");
    expect(() => captureNavigation({ ...navigation, aliases: navigation.events })).toThrow(
      "ambiguous",
    );
    expect(() =>
      captureNavigation({ ...navigation, aliases: scope.replace("https:", "http:") }),
    ).toThrow("ambiguous");
  });
});
describe("private retained failure envelope", () => {
  it("uses the selected conflict family for a retained live-alias collision", () => {
    expect(problem("alias-path-taken", 409, "after-state-change")).toEqual({
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      code: "alias-path-taken",
      status: 409,
      retry: "after-state-change",
    });
  });
  it("uses the selected conflict family for a retained incident-Link refusal", () => {
    expect(problem("incident-links-exist", 409, "after-state-change")).toEqual({
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      code: "incident-links-exist",
      status: 409,
      retry: "after-state-change",
    });
  });
});
describe("private retained creation admission", () => {
  it("preserves whole affiliations, rootless identity and immutable values", () => {
    const input = prepareCreate(
      scope,
      JSON.stringify({
        id: "projects/a",
        type,
        properties: { nullable: null, nested: [1, { n: 2 }] },
      }),
      "Key_A",
    );
    expect(input.id).toBe(`${scope}projects/a`);
    expect(input.type).toEqual(type);
    expect(input.metadata).toEqual({});
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.properties.nested)).toBe(true);
    expect(() => assertPreparedCreate("https://elsewhere.invalid/", input)).toThrow();
    expect(() => assertPreparedCreate(scope, { ...input })).toThrow();
  });
  it("normalizes equivalent exact numbers, object order, empty defaults and local identity", () => {
    const first = prepareCreate(
      scope,
      `{"type":"https://types.invalid/Task","id":"projects/a","properties":{"x":0.10,"n":1e0}}`,
      "k",
    );
    const second = prepareCreate(
      scope,
      `{"id":"${scope}projects/a","type":"https://types.invalid/Task","metadata":{},"properties":{"n":1,"x":0.1}}`,
      "k",
    );
    expect(second.identity).toBe(first.identity);
    const pin = prepareCreate(scope, JSON.stringify({ type }), "k");
    const changed = prepareCreate(
      scope,
      JSON.stringify({ type: { ...type, revision: "other" } }),
      "k",
    );
    expect(pin.identity).not.toBe(changed.identity);
  });
  it.each(["a:b", "a:b/child"])(
    "preserves literal first-segment colon identity %s in relative and full forms",
    (local) => {
      const relative = prepareCreate(scope, JSON.stringify({ id: local, type }), "colon");
      const absolute = prepareCreate(
        scope,
        JSON.stringify({ id: `${scope}${local}`, type }),
        "colon",
      );
      expect(canonicalCreatedId(scope, local)).toBe(`${scope}${local}`);
      expect(canonicalCreatedId(scope, `${scope}${local}`)).toBe(`${scope}${local}`);
      expect(relative.id).toBe(`${scope}${local}`);
      expect(absolute.id).toBe(relative.id);
      expect(absolute.identity).toBe(relative.identity);
    },
  );
  it("keeps inadmissible decimal identity exact without rounding into execution", () => {
    const bad = prepareCreate(
      scope,
      `{"type":"https://types.invalid/Task","properties":{"n":9007199254740993}}`,
      "n",
    );
    const rounded = prepareCreate(
      scope,
      `{"type":"https://types.invalid/Task","properties":{"n":9007199254740992}}`,
      "n",
    );
    expect(bad.refusal).toMatchObject({ code: "validation-failed", status: 422 });
    expect(bad.identity).not.toBe(rounded.identity);
  });
  it.each([
    `{"type":"https://types.invalid/T","operation":"createBead"}`,
    `{"type":"https://types.invalid/T","name":"x"}`,
    `{"type":"https://types.invalid/T","properties":{"x":1,"\\u0078":2}}`,
    `{"type":{"uri":"https://types.invalid/T","revision":""}}`,
    `{"type":"https://types.invalid/T","properties":{"x":"\\ud800"}}`,
    `{"type":"https://types.invalid/T","revisionProvenance":{"agent":3}}`,
    `{"type":"https://types.invalid/T","metadata":null}`,
  ])("rejects closed syntax before preparing a decision: %s", (body) => {
    expect(() => prepareCreate(scope, body, "k")).toThrow(RetainedRequestError);
  });
  it.each([
    "/a",
    "//foreign.invalid/a",
    "a/",
    "a//b",
    "../a",
    "a%2Fb",
    "a%3Ab",
    "https://foreign.invalid/a",
    "http://scope.invalid/acme/a",
    "@label",
    "a?b=1",
    "a#fragment",
  ])("refuses noncanonical creation identity %s", (id) => {
    expect(() => canonicalCreatedId(scope, id)).toThrow();
  });
  it("preserves supplied provenance and omits empty recorded provenance", () => {
    const empty = materializeBead(
      prepareCreate(scope, JSON.stringify({ type, revisionProvenance: {} }), "k"),
      `${scope}a`,
      "r",
      "2026-10-29T23:00:00.000Z",
    );
    expect(empty).not.toHaveProperty("revisionProvenance");
    const value = materializeBead(
      prepareCreate(
        scope,
        JSON.stringify({
          type,
          revisionProvenance: {
            actor: { id: "operator", basis: "writer-supplied" },
            agent: null,
            message: "",
          },
        }),
        "k",
      ),
      `${scope}a`,
      "r",
      "2026-10-29T23:00:00.000Z",
    );
    expect(value.revisionProvenance).toMatchObject({
      actor: { id: "operator" },
      agent: { state: "absent" },
      message: { state: "present", value: "" },
    });
  });
  it("refuses ambiguous directory targets without assigning a new wire profile", () => {
    const target = "https://commands.invalid/create?scope=acme";
    expect(() =>
      captureNavigation({
        scope,
        description: `${scope}d`,
        beads: `${scope}b`,
        links: `${scope}l`,
        aliases: `${scope}a`,
        events: `${scope}e`,
        operations: `${scope}o`,
        targets: {
          createBead: target,
          updateBead: target,
          deleteBead: `${scope}d1`,
          createLink: `${scope}c1`,
          updateLink: `${scope}u1`,
          deleteLink: `${scope}x1`,
          putAlias: `${scope}p1`,
          deleteAlias: `${scope}z1`,
        },
      }),
    ).toThrow("ambiguous");
  });
});

describe("private retained deletion admission", () => {
  it("normalizes the subject and preserves the literal optional guard in retry identity", () => {
    const local = prepareDelete(scope, '{"bead":"a:b/child","expectedRevision":"opaque/+1"}', "d");
    const full = prepareDelete(
      scope,
      `{"expectedRevision":"opaque/+1","bead":"${scope}a:b/child"}`,
      "d",
    );
    expect(local.bead).toBe(`${scope}a:b/child`);
    expect(full.identity).toBe(local.identity);
    expect(Object.isFrozen(local)).toBe(true);
    expect(prepareDelete(scope, '{"bead":"a:b/child"}', "d").identity).not.toBe(local.identity);
    expect(
      prepareDelete(scope, '{"bead":"a:b/child","expectedRevision":"opaque/+2"}', "d").identity,
    ).not.toBe(local.identity);
    expect(() => assertPreparedDelete(scope, { ...local })).toThrow();
    expect(() => assertPreparedDelete("https://other.invalid/", local)).toThrow();
  });
  it.each([
    {},
    { bead: "" },
    { bead: null },
    { bead: "@binding" },
    { bead: "a", expectedRevision: "" },
    { bead: "a", expectedRevision: 1 },
    { bead: "a", operation: "deleteBead" },
    { bead: "a", revisionProvenance: {} },
    { bead: "a", properties: {} },
  ])("rejects malformed deletion carrier %j", (body) => {
    expect(() => prepareDelete(scope, JSON.stringify(body), "d")).toThrow(RetainedRequestError);
  });
});

describe("private retained update admission", () => {
  it("normalizes canonical subjects and object order while preserving edit intent", () => {
    const relative = prepareUpdate(
      scope,
      '{"bead":"a:b/child","properties":{"n":1e0,"x":null}}',
      "k",
    );
    const full = prepareUpdate(
      scope,
      `{"properties":{"x":null,"n":1},"bead":"${scope}a:b/child"}`,
      "k",
    );
    expect(relative.bead).toBe(`${scope}a:b/child`);
    expect(full.identity).toBe(relative.identity);
    expect(Object.isFrozen(relative.properties)).toBe(true);
    expect(() => assertPreparedUpdate(scope, { ...relative })).toThrow();
    expect(() => assertPreparedUpdate("https://other.invalid/", relative)).toThrow();
    const variants = [
      { propertiesChange: [{ op: "replace", path: "", value: { n: 1, x: null } }] },
      { propertiesChange: [] },
      { metadataChange: [] },
      { properties: {} },
      { properties: { n: 1, x: null }, expectedRevision: "r" },
      { properties: { n: 1, x: null }, revisionProvenance: {} },
    ].map(
      (edit) => prepareUpdate(scope, JSON.stringify({ bead: "a:b/child", ...edit }), "k").identity,
    );
    expect(new Set([relative.identity, ...variants]).size).toBe(variants.length + 1);
    const first = prepareUpdate(
      scope,
      JSON.stringify({
        bead: "a",
        propertiesChange: [
          { op: "add", path: "/x", value: 1 },
          { op: "remove", path: "/x" },
        ],
      }),
      "k",
    );
    const second = prepareUpdate(
      scope,
      JSON.stringify({
        bead: "a",
        propertiesChange: [
          { op: "remove", path: "/x" },
          { op: "add", path: "/x", value: 1 },
        ],
      }),
      "k",
    );
    expect(first.identity).not.toBe(second.identity);
  });
  it("carries complete Type pins and admits external valid subjects without inventing liveness", () => {
    const input = prepareUpdate(
      scope,
      JSON.stringify({ bead: "https://external.invalid/a", type }),
      "k",
    );
    expect(input.type).toEqual(type);
    expect(input.bead).toBe("https://external.invalid/a");
    expect(input.refusal).toBeUndefined();
    expect(
      prepareUpdate(scope, JSON.stringify({ bead: "a", type: { ...type, revision: "next" } }), "k")
        .identity,
    ).not.toBe(prepareUpdate(scope, JSON.stringify({ bead: "a", type }), "k").identity);
  });
  it("keeps rejected numeric intent exact and diagnostics in the correct document", () => {
    const bad = prepareUpdate(
      scope,
      '{"bead":"a","metadataChange":[{"op":"add","path":"/n","value":9007199254740993}]}',
      "k",
    );
    const rounded = prepareUpdate(
      scope,
      '{"bead":"a","metadataChange":[{"op":"add","path":"/n","value":9007199254740992}]}',
      "k",
    );
    expect(bad.identity).not.toBe(rounded.identity);
    expect(bad.refusal).toMatchObject({
      code: "validation-failed",
      diagnostics: [{ document: "metadata" }],
    });
    const diagnostics = bad.refusal?.diagnostics as readonly Record<string, unknown>[];
    expect(diagnostics[0]).not.toHaveProperty("instanceLocation");
  });
  it.each([
    { bead: "a" },
    { bead: "a", expectedRevision: "r" },
    { bead: "a", revisionProvenance: {} },
    { bead: "a", properties: null },
    { bead: "a", metadata: [] },
    { bead: "a", properties: {}, propertiesChange: [] },
    { bead: "a", metadata: {}, metadataChange: [] },
    { bead: "a", propertiesChange: [{ op: "test", path: "/x", value: 1 }] },
    { bead: "a", propertiesChange: [{ op: ["add"], path: "/x", value: 1 }] },
    { bead: "a", propertiesChange: [{ op: "remove", path: "/x", value: 1 }] },
    { bead: "a", propertiesChange: [{ op: "add", path: "/x" }] },
    { bead: "a", propertiesChange: [{ op: "replace", path: "x", value: 1 }] },
    { bead: "a", propertiesChange: [{ op: "remove", path: "/x~2" }] },
    { bead: "a", properties: {}, expectedRevision: "" },
    { bead: "a", properties: {}, operation: "updateBead" },
    { bead: "@binding", properties: {} },
    { bead: "../a", properties: {} },
  ])("rejects malformed update carrier before preparing a decision: %j", (body) => {
    expect(() => prepareUpdate(scope, JSON.stringify(body), "k")).toThrow(RetainedRequestError);
  });
});

describe("numeric diagnostic completeness", () => {
  it.each(["properties", "metadata"] as const)(
    "reports truncated %s diagnostics with document-relative locations",
    (document) => {
      const members = Array.from({ length: 9 }, (_, index) => `"p${index}":9007199254740993`).join(
        ",",
      );
      const input = prepareCreate(
        scope,
        `{"type":"https://types.invalid/T","${document}":{${members}}}`,
        "diagnostics",
      );
      expect(input.refusal).toMatchObject({
        code: "validation-failed",
        diagnosticsTruncated: true,
      });
      const diagnostics = input.refusal?.diagnostics as readonly Record<string, unknown>[];
      expect(diagnostics).toHaveLength(8);
      expect(diagnostics[0]?.instanceLocation).toBe("/p0");
      if (document === "metadata") expect(diagnostics[0]?.document).toBe("metadata");
      else expect(diagnostics[0]).not.toHaveProperty("document");
    },
  );
  it("retains a feasible diagnostic when a numeric value has a very long property path", () => {
    const name = "x".repeat(6000);
    const input = prepareCreate(
      scope,
      `{"type":"https://types.invalid/T","metadata":{"${name}":9007199254740993}}`,
      "long-path",
    );
    expect(input.refusal).toMatchObject({ code: "validation-failed" });
    const diagnostics = input.refusal?.diagnostics as readonly Record<string, unknown>[];
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ document: "metadata" });
    expect(diagnostics[0]).not.toHaveProperty("instanceLocation");
    expect(Buffer.byteLength(JSON.stringify(diagnostics))).toBeLessThanOrEqual(4096);
  });
});
