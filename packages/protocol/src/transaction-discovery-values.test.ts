import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseTransactionalDiscovery, parseTransactionalOperationDirectory } from "./index.js";
const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/transactional/discovery.json", import.meta.url), "utf8"),
);
const document = fixture.exchanges[0].response.body;
const directory = fixture.exchanges[1].response.body;
const schema = JSON.parse(
  readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
);
it("parses the normative illustrative discovery and exact directory without granting readiness", () => {
  const result = parseTransactionalDiscovery(document);
  expect(result).toEqual(document);
  expect(result).not.toBe(document);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.limits?.retention)).toBe(true);
  expect(parseTransactionalOperationDirectory(directory)).toEqual(directory);
  expect(Object.isFrozen(parseTransactionalOperationDirectory(directory))).toBe(true);
});
it.each(schema.$defs.transactionalDiscovery.required as string[])(
  "rejects missing discovery %s",
  (field) => {
    const input = structuredClone(document);
    delete input[field];
    expect(() => parseTransactionalDiscovery(input)).toThrow();
  },
);
it.each([
  { profile: "read-update" },
  { bdpVersion: "1" },
  { unknown: true },
  { scope: "https://beads.example/acme" },
  { scope: "https://beads.example/acme/?q=1" },
  { limits: { retention: { idempotency: "PT1H" } } },
  { limits: { selector: { bytes: 0 } } },
  {
    maximumEndpointMultiplicity: [
      { linkConformsTo: "https://example.test/a#fragment", endpoint: "source", max: 1 },
    ],
  },
])("rejects invalid discovery envelope %j", (patch) => {
  expect(() => parseTransactionalDiscovery({ ...document, ...patch })).toThrow();
});
it.each([
  "beads",
  "links",
  "types",
  "operations",
  "aliases",
  "receipts",
  "snapshot",
  "changes",
  "events",
])("checks canonical navigation %s", (field) => {
  expect(() =>
    parseTransactionalDiscovery({ ...document, [field]: "https://EXAMPLE.test/x" }),
  ).toThrow();
});
it("accepts schema-valid optional capabilities and foreign canonical routes structurally", () => {
  const value = {
    ...document,
    scope: "https://different.test/s/",
    snapshot: "https://different.test/snapshot",
    order: "canonical-uri",
    historicalResolution: { version: 1 },
    maximumEndpointMultiplicity: [
      { linkConformsTo: "https://example.test/link", endpoint: "source", max: 2 },
    ],
  };
  expect(parseTransactionalDiscovery(value)).toEqual(value);
});
it.each(Object.keys(directory))("rejects missing or wrong exact directory target %s", (field) => {
  const missing = { ...directory };
  delete missing[field];
  expect(() => parseTransactionalOperationDirectory(missing)).toThrow();
  expect(() =>
    parseTransactionalOperationDirectory({ ...directory, [field]: "wrong-target" }),
  ).toThrow();
});
it("rejects an unknown directory member", () => {
  expect(() => parseTransactionalOperationDirectory({ ...directory, query: "query" })).toThrow();
});
it.each([undefined, NaN, Infinity, 1n, () => {}, new Date(), "\ud800"])(
  "rejects non-JSON or nonscalar input %s",
  (value) => {
    expect(() => parseTransactionalDiscovery({ ...document, extra: value })).toThrow();
  },
);
it("rejects a cycle and a nonplain top-level prototype", () => {
  const cyclic = { ...document };
  cyclic.limits = cyclic;
  expect(() => parseTransactionalDiscovery(cyclic)).toThrow("cycle");
  expect(() => parseTransactionalDiscovery(Object.assign(Object.create({}), document))).toThrow(
    "plain object",
  );
});
it("captures supported accessors and Proxy members once into detached frozen JSON", () => {
  let scopeReads = 0,
    pageReads = 0,
    keys = 0;
  const page = { defaultItems: 2, maximumItems: 32 };
  const input = {
    ...document,
    get scope() {
      scopeReads++;
      return document.scope;
    },
    limits: {
      get page() {
        pageReads++;
        return page;
      },
    },
  };
  const captured = parseTransactionalDiscovery(
    new Proxy(input, {
      ownKeys(target) {
        keys++;
        return Reflect.ownKeys(target);
      },
    }),
  );
  expect([scopeReads, pageReads, keys]).toEqual([1, 1, 1]);
  page.defaultItems = 99;
  expect(captured.limits?.page).toEqual({ defaultItems: 2, maximumItems: 32 });
  expect(Object.getPrototypeOf(captured)).toBe(Object.prototype);
  expect(Object.isFrozen(captured.limits?.page)).toBe(true);
  let reads = 0;
  const dir = parseTransactionalOperationDirectory({
    ...directory,
    get batch() {
      reads++;
      return "batch";
    },
  });
  expect(reads).toBe(1);
  expect(dir.batch).toBe("batch");
});
