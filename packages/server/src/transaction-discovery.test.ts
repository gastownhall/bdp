import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  parseTransactionalDiscovery,
  parseTransactionalOperationDirectory,
  parseCanonicalScope,
} from "@bdp/protocol";
import {
  assembleTransactionDiscovery,
  TRANSACTION_HTTP_OPERATIONS,
} from "./transaction-discovery.js";
import { requestFromUrl, classifyAliasPath } from "./read-request.js";
import { transactionChangefeedRequest, transactionCheckpoint } from "./transaction-changefeed.js";
import { transactionEventRequest } from "./transaction-events.js";
const scope = "https://example.test/acme/";
const context = { scopeEpoch: "epoch-a", authorizationView: "view-a", scopePosition: "pos-2" };
const limits = {
  page: { defaultItems: 2, maximumItems: 32 },
  selector: { bytes: 4096, depth: 32, nodes: 256 },
  cursorTtlMilliseconds: 1000,
};
const required = JSON.parse(
  readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
).$defs.transactionalDiscovery.required as string[];
const literalDirectory = {
  createBead: "create-bead",
  updateBead: "update-bead",
  deleteBead: "delete-bead",
  createLink: "create-link",
  updateLink: "update-link",
  deleteLink: "delete-link",
  putAlias: "put-alias",
  deleteAlias: "delete-alias",
  sequence: "sequence",
  updateWhere: "update-where",
  deleteWhere: "delete-where",
  batch: "batch",
};
function expected(value: ReturnType<typeof assembleTransactionDiscovery>["discovery"]) {
  expect(value).toEqual({
    bdpVersion: "0",
    profile: "transactional",
    scope,
    beads: `${scope}beads/`,
    links: `${scope}links/`,
    types: `${scope}types/`,
    operations: `${scope}operations/`,
    aliases: `${scope}alias/`,
    receipts: `${scope}receipts/`,
    snapshot: `${scope}snapshot`,
    changes: `${scope}changes/`,
    events: `${scope}events/`,
    scopeEpoch: "epoch-a",
    authorizationView: "view-a",
    headPosition: "pos-2",
    minimumReplayPosition: "pos-0",
    limits: {
      page: { defaultItems: 2, maximumItems: 32 },
      selector: { bytes: 4096, depth: 32, nodes: 256 },
      validation: { diagnostics: 16, diagnosticBytes: 524288 },
    },
  });
}
it("assembles exactly sixteen required members plus consumed limits and the one directory", () => {
  const result = assembleTransactionDiscovery(scope, context, limits);
  expected(result.discovery);
  expect(Object.keys(result.discovery).sort()).toEqual([...required, "limits"].sort());
  expect(Object.keys(result.discovery)).toHaveLength(17);
  expect(result.directory).toEqual(literalDirectory);
  expect(TRANSACTION_HTTP_OPERATIONS).toEqual(literalDirectory);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.discovery.limits?.page)).toBe(true);
  expect(Object.isFrozen(result.discovery.limits?.validation)).toBe(true);
  expect(result.discovery.limits).not.toHaveProperty("cursorTtlMilliseconds");
  expect(parseTransactionalDiscovery(result.discovery)).toEqual(result.discovery);
  expect(parseTransactionalOperationDirectory(result.directory)).toEqual(result.directory);
});
it("captures each Selector scalar once for both validation and projection", () => {
  const reads = { bytes: 0, depth: 0, nodes: 0 };
  const selector = {
    get bytes() {
      return ++reads.bytes === 1 ? 4096 : 1;
    },
    get depth() {
      return ++reads.depth === 1 ? 32 : 1;
    },
    get nodes() {
      return ++reads.nodes === 1 ? 256 : 1;
    },
  };
  const { discovery } = assembleTransactionDiscovery(scope, context, { ...limits, selector });
  expect(reads).toEqual({ bytes: 1, depth: 1, nodes: 1 });
  expected(discovery);
  expect(Object.isFrozen(discovery.limits?.selector)).toBe(true);
});
it.each([
  ["bytes", 4095],
  ["bytes", 4097],
  ["depth", 31],
  ["depth", 33],
  ["nodes", 255],
  ["nodes", 257],
] as const)("rejects captured %s=%i that differs from fixed set enforcement", (field, value) => {
  expect(() =>
    assembleTransactionDiscovery(scope, context, {
      ...limits,
      selector: { ...limits.selector, [field]: value },
    }),
  ).toThrow("discovery Selector limits must match set enforcement");
});
it.each([
  undefined,
  { diagnostics: 16 },
  { diagnosticBytes: 524288 },
  { diagnostics: 15, diagnosticBytes: 524288 },
  { diagnostics: 16, diagnosticBytes: 524287 },
])(
  "rejects an absent, partial or changed validation projection with the owner oracle %j",
  (validation) => {
    const { discovery } = assembleTransactionDiscovery(scope, context, limits);
    const substituted = parseTransactionalDiscovery({
      ...discovery,
      limits: {
        page: limits.page,
        selector: limits.selector,
        ...(validation === undefined ? {} : { validation }),
      },
    });
    expect(() => expected(substituted)).toThrow();
  },
);
it("routes roots through independent existing classifiers and keeps floor/checkpoint namespaces separate", () => {
  const { discovery: d } = assembleTransactionDiscovery(scope, context, limits);
  for (const collection of ["beads", "links", "types"] as const)
    expect(requestFromUrl(new URL(d[collection]), scope)).toMatchObject({
      kind: "collection",
      collection,
    });
  expect(classifyAliasPath(new URL(`${d.aliases}work`), parseCanonicalScope(scope))).toBe("work");
  expect(transactionChangefeedRequest(new URL(`${d.changes}?after=genesis`), scope)).toEqual({
    after: "genesis",
  });
  expect(transactionEventRequest(new URL(d.events), scope)).toEqual({
    source: { kind: "scope", url: `${scope}events/` },
  });
  expect(transactionCheckpoint(scope, context, 0)).toBe("genesis");
  expect(d.minimumReplayPosition).toBe("pos-0");
});
it.each([
  { scope: "https://foreign.test/acme/" },
  { scopeEpoch: "stale" },
  { authorizationView: "stale" },
  { headPosition: "pos-1" },
  { aliases: `${scope}aliases/` },
  { snapshot: `${scope}snapshot/` },
  { operations: "http://127.0.0.1:9876/operations/" },
  { historicalResolution: { version: 1 as const } },
  { limits: { page: { defaultItems: 3, maximumItems: 32 } } },
])(
  "rejects a schema-valid candidate substitution using the literal projection oracle %j",
  (patch) => {
    const { discovery } = assembleTransactionDiscovery(scope, context, limits);
    const substituted = parseTransactionalDiscovery({ ...discovery, ...patch });
    expect(() => expected(substituted)).toThrow();
  },
);
