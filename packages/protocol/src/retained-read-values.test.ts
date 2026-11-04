import { describe, expect, it } from "vitest";
import {
  parseRetainedDiscovery,
  parseRetainedProblem,
  parseRetainedProperties,
  parseRetainedResource,
  parseRetainedWriteResult,
} from "./retained-read-values.js";
import { parseRetainedWriteDiscovery } from "./retained-write-values.js";

const core = {
  bdpVersion: "0.1",
  profile: "core",
  scope: "https://records.test/work/",
  specRevision: "0123456789abcdef0123456789abcdef01234567",
  events: "https://facts.test/observations",
};
const bead = {
  id: "https://records.test/work/note",
  type: { uri: "https://types.test/note", revision: "+ /@=" },
  revision: "r+ /@=",
  properties: { operation: "literal", source: null },
  metadata: {},
};
describe("retained Core carrier values", () => {
  it.each(["core", "write"])(
    "accepts the %s discovery arm without guessing Types navigation",
    (profile) => {
      const value =
        profile === "core"
          ? core
          : {
              ...core,
              profile,
              operations: "https://verbs.test/execute",
              aliases: "https://names.test/",
            };
      const parsed = parseRetainedDiscovery(JSON.stringify(value));
      expect(parsed).toEqual(value);
      expect(Object.isFrozen(parsed)).toBe(true);
    },
  );
  it.each(["core", "write"])("accepts absent optional Events on %s", (profile) => {
    const { events: _events, ...base } = core;
    const value =
      profile === "core"
        ? base
        : {
            ...base,
            profile: "write",
            operations: "https://verbs.test/execute",
            aliases: "https://records.test/work/names/",
          };
    expect(parseRetainedDiscovery(JSON.stringify(value))).toEqual(value);
    if (profile === "write")
      expect(parseRetainedWriteDiscovery(JSON.stringify(value))).toEqual(value);
    expect(Object.hasOwn(parseRetainedDiscovery(JSON.stringify(value)), "events")).toBe(false);
  });
  it("preserves opaque unknown capability versions without selecting them", () => {
    const capabilities = { "https://future.test/feature": { "99": { url: "literal" } } };
    expect(parseRetainedDiscovery(JSON.stringify({ ...core, capabilities })).capabilities).toEqual(
      capabilities,
    );
  });
  it.each([
    ["old-version", { ...core, bdpVersion: "0" }],
    ["old-profile", { ...core, profile: "read" }],
    ["malformed-events", { ...core, events: "relative-events" }],
    [
      "advertised-inventory",
      { ...core, beads: "https://lists.test/nodes", links: "https://lists.test/edges" },
    ],
    ["query-scope", { ...core, scope: "https://records.test/work/?tenant=1" }],
    ["malformed-spec-revision", { ...core, specRevision: "main" }],
  ])("refuses discovery %s", (_label, value) => {
    expect(() => parseRetainedDiscovery(JSON.stringify(value))).toThrow();
  });
  it("requires specRevision", () => {
    const { specRevision: _revision, ...withoutRevision } = core;
    expect(() => parseRetainedDiscovery(JSON.stringify(withoutRevision))).toThrow();
  });
  it("preserves complete Type pins, native metadata and opaque revisions", () => {
    expect(parseRetainedResource(JSON.stringify(bead), "bead")).toEqual(bead);
    const link = {
      ...bead,
      source: bead.id,
      target: { uri: "urn:external:bead", revision: "exact" },
    };
    expect(parseRetainedResource(JSON.stringify(link), "link")).toEqual(link);
    expect(() => parseRetainedResource(JSON.stringify(link), "bead")).toThrow();
  });
  it.each([
    ["missing-metadata", { ...bead, metadata: undefined }],
    ["empty-revision", { ...bead, revision: "" }],
    ["relative-id", { ...bead, id: "note" }],
    ["urn-type", { ...bead, type: "urn:types:note" }],
    ["extra-native-field", { ...bead, kind: "bead" }],
  ])("refuses current record %s", (_label, value) => {
    expect(() => parseRetainedResource(JSON.stringify(value), "bead")).toThrow();
  });
  it("treats properties as literal user data rather than a record or collection", () => {
    const value = { id: "literal", type: null, source: {}, items: [], next: "not-navigation" };
    expect(parseRetainedProperties(JSON.stringify(value))).toEqual(value);
  });
  it.each([
    ["decoded-duplicate", '{"name":1,"na\\u006de":2}'],
    ["rounded-integer", '{"n":9007199254740993}'],
    ["unpaired-surrogate", '{"s":"\\ud800"}'],
    ["array-root", "[]"],
  ])("refuses lossy properties %s", (_label, text) => {
    expect(() => parseRetainedProperties(text as string)).toThrow();
  });
  it("checks native Problem status without filling an omitted member", () => {
    const problem = {
      type: "https://github.com/gastownhall/bdp/problems/conflict",
      code: "idempotency-conflict",
      retry: "never",
      custom: { preserved: true },
    };
    expect(parseRetainedProblem(JSON.stringify(problem), 409)).toEqual(problem);
    expect(() => parseRetainedProblem(JSON.stringify(problem), 404)).toThrow();
    expect(() => parseRetainedProblem(JSON.stringify({ ...problem, status: 400 }), 409)).toThrow();
  });
  it("validates mutation outcome and actual kind against the native operation", () => {
    const created = { outcome: "created", changed: true, resource: bead };
    expect(parseRetainedWriteResult("createBead", JSON.stringify(created))).toEqual(created);
    expect(() => parseRetainedWriteResult("updateBead", JSON.stringify(created))).toThrow();
    expect(() => parseRetainedWriteResult("createLink", JSON.stringify(created))).toThrow();
    expect(() =>
      parseRetainedWriteResult(
        "createBead",
        JSON.stringify({ ...created, resource: { ...bead, metadata: undefined } }),
      ),
    ).toThrow();
  });
});
