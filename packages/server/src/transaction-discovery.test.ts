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
  expect(result.discovery.limits).not.toHaveProperty("cursorTtlMilliseconds");
  expect(parseTransactionalDiscovery(result.discovery)).toEqual(result.discovery);
  expect(parseTransactionalOperationDirectory(result.directory)).toEqual(result.directory);
});
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
  "rejects a schema-valid candidate substitution using the independent owner oracle %j",
  (patch) => {
    const { discovery } = assembleTransactionDiscovery(scope, context, limits);
    const substituted = parseTransactionalDiscovery({ ...discovery, ...patch });
    expect(() => expected(substituted)).toThrow();
  },
);
