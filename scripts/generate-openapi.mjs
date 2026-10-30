#!/usr/bin/env node
import { execFileSync } from "node:child_process";
// Informative catalog generation only. No HTTP, provider, CLI or schema evaluator.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const media = "application/vnd.bdp.v0.1+json";
export const schemaFile = "specs/profiles/core/bdp-v0.1.schema.json";
const external = "../profiles/core/bdp-v0.1.schema.json#/$defs/";
const baseCommit = "e23aec722763e967d3bde08caf96657069b39ead";
// Source drift stops generation. Updating a digest requires paired mapping review;
// this script intentionally has no refresh-fingerprints or moving-HEAD mode.
const approvedSources = {
  "specs/profiles/write/id-root-v1.schema.json":
    "0f4c2a7cc57fefb29dc5ff6dc4139bd1e465feb6e0551021db16a5775ed73d8f",
  "specs/profiles/write/id-root.md":
    "c7c34478f2d03cd39da4b9cffc7bfefdb6902f9d41caea67552d48faa7143563",
  "specs/profiles/core/retained-core.md":
    "a758b6db79493d71f54384ef7f514bd01760dec50127e563ad71c03cc1885a82",
  "specs/profiles/core/core.md": "da6c574ed41cfde803a80b35ae2ac4bdc07368faf4e907a837cdf1f21d69141a",
  "specs/profiles/core/contract-binding.md":
    "4cea2ef5ce44ff66ed0da93a738f01713ab4fbbd9434e9e2ea098cc626001527",
  "specs/profiles/core/read-delivery.md":
    "9ea7095d58280eb700f1cdd44e028d9407847b20025d3ebda9a90bdbaab3993d",
  "specs/profiles/core/events.md":
    "f55f292dd4fb15e463f59e2c8892b77a3f211c6cdc97e40555e184f3e88ecec4",
  "specs/profiles/core/resource-projection.md":
    "934d607e30f48813de6a1ff0b863add9e515c948d70ec9013bb62e683bcb4e9e",
  "specs/profiles/core/affiliations.md":
    "eb54fc55fdd87189dfa5c99f614ed9e97e1c8aae2413595c856c8981a8e9ed25",
  "specs/profiles/core/publication.md":
    "6e7ab19e9a7df213b71f23a6998902ef2f251d402c98429fa9ae1770933df0f7",
  "specs/profiles/core/type-definition-read.md":
    "e122e6eaab3618e4f88c8a94325df73b956b94fbded0ca785a66e9f78e56104c",
  "specs/profiles/core/bdp-v0.1.schema.json":
    "e0de70f5d1da926bedb4fac0343e0f561e91136511c4949cffd56ba5b6c60b8f",
  "specs/profiles/core/bdp-v0.schema.json":
    "15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327",
  "specs/profiles/write/retained-write.md":
    "fd4588686bf74ffac17a42018793ff9f3696a0b448d4eae32293f97359a979c8",
  "specs/profiles/write/write.md":
    "335e4b0aa6ce6d3b2ea7db1f4dd1db56bf4372453dd6c98cf709e2e1580b9349",
  "specs/profiles/write/atomic-batch.md":
    "4037788ecb5942c7ac291214efff3f8e451f73edfa4784fdec09e072e9f5c4d6",
  "specs/profiles/write/link-updates.md":
    "4d3b3154f76527fcc42e8534872f61851f53fad4280fba6775c056bdc466462e",
  "specs/profiles/write/object-edits.md":
    "9470123de75e3c1970a067cb1be4f5bd78ccd78bf271b0611cf1663ee45750fd",
  "docs/cli-design/bdp-cli.md": "408eb3677baf69b2047ad4e9de9292d835c93ae2810b6d6a4402248ef967666b",
  "docs/cli-design/retained-profiles.md":
    "f64e71432a61b6b9416332884da6e52196883880bdd268117f3f57242980fb11",
  "docs/cli-design/reads-and-paging.md":
    "2e8c800192b7abf3a254c3ecc7ab4d9b9997f6994749284625d405c99a586de2",
  "docs/cli-design/events.md": "9fd4dae988c24ccd54260a6c4d6f8703bec2f29a0b3efd73493502f97c08fc22",
  "docs/cli-design/atomic-batch.md":
    "ea1478d39a0c2fdb605d73dfcf9c5f7cc65a7096d889cb8ca19206f20ec44bb2",
  "docs/cli-design/exact-definition-read.md":
    "28a6a5a6fd76372fe14fcc3a38332b7936576d28e2d9a6bde7e3f1ce39bee27e",
  "packages/protocol/schemas/bdp-v0.1.schema.json":
    "e0de70f5d1da926bedb4fac0343e0f561e91136511c4949cffd56ba5b6c60b8f",
  "packages/protocol/schemas/bdp-v0.schema.json":
    "15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327",
};
const load = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const ref = (name) => ({ $ref: external + name });
export const idRootSchemaFile = "specs/profiles/write/id-root-v1.schema.json";
const rootedRef = (name) => ({ $ref: `../profiles/write/id-root-v1.schema.json#/$defs/${name}` });
const rootedRequests = {
  createBead: "idRootCreateBeadRequest",
  createLink: "idRootCreateLinkRequest",
  atomicBatch: "idRootBatchRequest",
};
const core = "specs/profiles/core/core.md";
const retained = "specs/profiles/core/retained-core.md";
const write = "specs/profiles/write/retained-write.md";
const events = "specs/profiles/core/events.md";
const projection = "specs/profiles/core/resource-projection.md";
const batch = "specs/profiles/write/atomic-batch.md";
const definition = "specs/profiles/core/type-definition-read.md";
const cli = "docs/cli-design/bdp-cli.md";
const source = (file, line) => ({ file, line });
const capability = (name) => `https://github.com/gastownhall/bdp/capabilities/${name}`;
const conditionHeaders = [
  "If-Match",
  "If-None-Match",
  "If-Modified-Since",
  "If-Unmodified-Since",
].map((name) => ({
  name,
  in: "header",
  schema: { type: "string" },
  description: "Native HTTP condition; never synthesize from a Resource revision.",
}));
const query = (
  name,
  schema = { type: "string", minLength: 1 },
  description = "",
  required = false,
) => ({ name, in: "query", required, schema, description });
const limit = query(
  "limit",
  ref("positiveInteger"),
  "Positive per-page bound; actual advertised/default limits apply.",
);
const cursor = query("cursor", { type: "string", minLength: 1 }, "Opaque; follow issued next.");
const filters = [
  query("type", ref("absoluteHttpUrl"), "Unpinned nominal Type identity."),
  query(
    "conformsTo",
    ref("absoluteHttpUrl"),
    "Recorded family authority required; no nominal fallback.",
  ),
  query("selector"),
];
const endpointFilters = ["source", "target", "endpoint"].map((name) =>
  query(
    name,
    { type: "string", minLength: 1 },
    "Canonical local Bead ID or absolute URI; endpoint means source OR target.",
  ),
);
const direction = query("direction", { enum: ["inbound", "outbound", "both"], default: "both" });
const eventParams = [
  query("from", { enum: ["retained", "now"], default: "retained" }),
  query("after"),
  query("representation", { enum: ["postimage", "delta"], default: "postimage" }),
  limit,
];
const maskParams = [
  query("projectionVersion", { const: "1" }, "Explicit capability selector.", true),
  {
    ...query(
      "fields",
      { type: "string", minLength: 1 },
      "Once form-decoded JSON mask; reject duplicate keys/invalid pointers. No fields means full output.",
    ),
    "x-bdp-parsed-schema": ref("resourceProjectionMask"),
  },
];
const revision = query(
  "revision",
  ref("revision"),
  "Opaque exact edition; form decode once; literal plus is %2B.",
  true,
);
const header = (description, schema = { type: "string" }, required = true) => ({
  description,
  schema,
  "x-bdp-required": required,
});
const contextHeaders = (kind, collection) => ({
  ...(kind
    ? {
        "BDP-Resource-Kind": header("Actual point-subject kind, including HEAD/304.", {
          const: kind,
        }),
      }
    : {}),
  ...(collection
    ? {
        "BDP-Collection-Kind": header(
          "Actual item kind, even on an empty page, including HEAD/304.",
          { const: collection },
        ),
      }
    : {}),
  ...(kind || collection
    ? { Link: header("Registered service-desc relation to owning Scope discovery.") }
    : {}),
});
const readCodes = [
  "malformed-request",
  "invalid-parameter",
  "unauthenticated",
  "forbidden",
  "resource-not-found",
  "resource-pruned",
  "resource-erased",
  "foreign-view",
  "cursor-expired",
  "request-too-large",
  "limit-exceeded",
  "rate-limited",
  "temporarily-unavailable",
];
const historyCodes = [
  "revision-unknown",
  "revision-unretained",
  "revision-reorganized",
  "revision-not-tracked",
  "revision-unrepresentable",
];
const writeCodes = [
  ...readCodes,
  "unsupported-media-type",
  "validation-failed",
  "type-not-installed",
  "identity-taken",
  "alias-path-taken",
  "revision-mismatch",
  "incident-links-exist",
  "aggregate-constraint-violation",
  "idempotency-conflict",
  "idempotency-in-progress",
  "idempotency-expired",
  "revision-allocation-unsafe",
];

// Public semantic commands own variants; these entries are not extra SDK methods.
export const commandGroups = [
  ["bd create", ["createBead"]],
  [
    "bd show",
    [
      "currentBead",
      "historicalBead",
      "beadProperties",
      "projectedBead",
      "projectedHistoricalBead",
      "beadAggregate",
    ],
  ],
  ["bd update", ["updateBead"]],
  ["bd delete", ["deleteBead"]],
  ["bd list", ["beadInventory", "projectedBeadInventory"]],
  ["bd versions", ["beadVersions"]],
  ["bd link create", ["createLink"]],
  [
    "bd link show",
    ["currentLink", "historicalLink", "linkProperties", "projectedLink", "projectedHistoricalLink"],
  ],
  ["bd link update", ["updateLink"]],
  ["bd link delete", ["deleteLink"]],
  ["bd link list", ["linkInventory", "projectedLinkInventory", "incidentLinks"]],
  ["bd link versions", ["linkVersions"]],
  ["bd events", ["scopeEvents", "beadEvents"]],
  ["bd link events", ["linkEvents"]],
  ["bd scope inspect", ["discovery"]],
  ["bd alias resolve", ["aliasResolve"]],
  ["bd alias put", ["putAlias"]],
  ["bd alias delete", ["deleteAlias"]],
  ["bd batch", ["atomicBatch"]],
].map(([command, signatures]) => ({ command, signatures }));
export const transportSignatures = ["scopeLanding", "writeDirectory"];
export const deferredSignatures = ["exactDefinition"];

export function operations() {
  const rows = [];
  const read = (id, navigation, response, parameters, file, line, cliLine, options = {}) =>
    rows.push({
      id,
      navigation,
      response,
      parameters,
      sources: [source(file, line), source(retained, 29)],
      cli: source(cli, cliLine),
      methods: ["get", "head"],
      problem: "readProblem",
      codes: readCodes,
      continuation: "none",
      ...options,
    });
  read("scopeLanding", { role: "canonical-scope" }, null, [], core, 950, 2183, {
    landing: true,
  });
  read("discovery", { role: "service-desc" }, "retainedDiscovery", [], retained, 52, 2183);
  read(
    "writeDirectory",
    { role: "discovery-member", member: "operations" },
    "writeOperationDirectory",
    [],
    write,
    19,
    2183,
    { optional: "Write profile" },
  );
  for (const [kind, record, collection] of [
    ["bead", "currentBeadRecord", "currentBeadCollection"],
    ["link", "currentLinkRecord", "currentLinkCollection"],
  ]) {
    const noun = kind[0].toUpperCase() + kind.slice(1);
    read(
      `current${noun}`,
      { role: "canonical-resource", kind },
      record,
      [],
      core,
      1417,
      kind === "bead" ? 805 : 1432,
      { kind },
    );
    read(
      `${kind}Properties`,
      { role: "canonical-resource", kind, query: { view: "properties" } },
      "properties",
      [query("view", { const: "properties" }, "", true)],
      core,
      1428,
      kind === "bead" ? 808 : 1435,
      { kind },
    );
    read(
      `${kind}Inventory`,
      { role: "discovery-member", member: kind === "bead" ? "beads" : "links" },
      collection,
      [...filters, ...(kind === "link" ? endpointFilters : []), limit, cursor],
      core,
      1600,
      kind === "bead" ? 1136 : 1811,
      { collection: kind, continuation: "ordinary-limit-only" },
    );
    read(
      `historical${noun}`,
      { role: "canonical-resource", kind, history: true },
      `historical${noun}Record`,
      [revision],
      core,
      1771,
      kind === "bead" ? 807 : 1434,
      { kind, optional: "Complete historicalResolution.version=1", history: true },
    );
    read(
      `${kind}Versions`,
      { role: "canonical-resource", kind, query: { view: "versions" }, history: true },
      "historyVersionsPage",
      [query("view", { const: "versions" }, "", true), limit, cursor],
      core,
      1885,
      kind === "bead" ? 1222 : 1907,
      {
        optional: "Complete historicalResolution.version=1",
        continuation: "unchanged",
        versions: true,
      },
    );
    read(
      `${kind}Events`,
      { role: "canonical-resource", kind, query: { view: "events" } },
      "retainedEventPage",
      [query("view", { const: "events" }, "", true), ...eventParams],
      events,
      64,
      kind === "bead" ? 2007 : 2105,
      {
        problem: "retainedEventProblem",
        codes: readCodes.filter((code) => code !== "resource-pruned"),
        event: true,
        continuation: "unchanged",
      },
    );
    const projectionNavigation = {
      capability: capability("resource-projection"),
      version: "1",
      role: "canonical-resource",
      kind,
    };
    read(
      `projected${noun}`,
      { ...projectionNavigation, support: "current" },
      [`projected${noun}Record`, record],
      maskParams,
      projection,
      82,
      469,
      { kind, optional: "Resource projection1 current:true", projection: true },
    );
    read(
      `projectedHistorical${noun}`,
      { ...projectionNavigation, support: "exact", history: true },
      [`projected${noun}Record`, `historical${noun}Record`],
      [revision, ...maskParams],
      projection,
      99,
      469,
      {
        kind,
        optional: "Resource projection1 exact:true plus complete History",
        projection: true,
        history: true,
      },
    );
    read(
      `projected${noun}Inventory`,
      {
        ...projectionNavigation,
        role: "discovery-member",
        member: kind === "bead" ? "beads" : "links",
        support: "list",
      },
      [`projected${noun}Collection`, collection],
      [...filters, ...(kind === "link" ? endpointFilters : []), limit, cursor, ...maskParams],
      projection,
      99,
      kind === "bead" ? 1136 : 1811,
      {
        collection: kind,
        optional: "Resource projection1 list:true",
        projection: true,
        continuation: "ordinary-limit-only",
      },
    );
  }
  read(
    "incidentLinks",
    { role: "canonical-resource", kind: "bead", query: { view: "links" } },
    "currentLinkCollection",
    [
      query("view", { const: "links" }, "", true),
      direction,
      ...filters,
      ...endpointFilters,
      limit,
      cursor,
    ],
    "specs/profiles/core/read-delivery.md",
    30,
    1811,
    { kind: "bead", collection: "link", continuation: "ordinary-limit-only" },
  );
  read(
    "beadAggregate",
    { role: "canonical-resource", kind: "bead", query: { include: "links" } },
    "currentBeadRecord",
    [query("include", { const: "links" }, "", true), direction, limit],
    core,
    1457,
    809,
    {
      kind: "bead",
      aggregate: true,
      optional: "Outside minimum Core; no invented capability advertisement",
    },
  );
  read("aliasResolve", { role: "advertised-alias-url" }, null, [], core, 1506, 2251, {
    alias: true,
    optional: "Advertised aliases navigation",
  });
  read(
    "scopeEvents",
    { role: "discovery-member", member: "events" },
    "retainedEventPage",
    eventParams,
    events,
    64,
    2007,
    {
      problem: "retainedEventProblem",
      codes: readCodes.filter((code) => code !== "resource-pruned"),
      event: true,
      continuation: "unchanged",
    },
  );
  read(
    "exactDefinition",
    { role: "capability-operation", capability: capability("type-definition-read"), version: "1" },
    "typeDefinitionReadResult",
    [
      query("capabilityVersion", { const: "1" }, "", true),
      query(
        "uri",
        ref("absoluteHttpUrl"),
        "Exact canonical Type identity; no alias/default refresh.",
        true,
      ),
      revision,
    ],
    definition,
    19,
    807,
    {
      cli: source("docs/cli-design/exact-definition-read.md", 1),
      optional: "Narrow type-definition-read1; not Types or application History",
      problem: "typeDefinitionReadProblem",
      forbiddenHeaders: ["BDP-Resource-Kind", "BDP-Collection-Kind"],
      codes: [
        ...readCodes.filter((code) => !["foreign-view", "cursor-expired"].includes(code)),
        "revision-unretained",
        "capability-not-supported",
      ],
    },
  );
  const requests = {
    createBead: 700,
    updateBead: 941,
    deleteBead: 1037,
    createLink: 1329,
    updateLink: 1578,
    deleteLink: 1685,
    putAlias: 2330,
    deleteAlias: 2408,
  };
  for (const [id, cliLine] of Object.entries(requests))
    rows.push({
      id,
      navigation: { role: "write-directory-member", member: id },
      methods: ["post"],
      request: `${id}Request`,
      response: id.endsWith("Alias") ? "aliasResult" : "mutationResult",
      parameters: [],
      sources: [source(write, 17), source(write, 54)],
      cli: source(cli, cliLine),
      problem: "readUpdateProblem",
      codes: writeCodes,
      continuation: "none",
      optional: "Write profile",
    });
  rows.push({
    id: "atomicBatch",
    navigation: {
      role: "capability-operation",
      capability: capability("atomic-batch"),
      version: "1",
    },
    methods: ["post"],
    request: "batchRequest",
    response: "atomicBatchResult",
    parameters: [],
    sources: [source(batch, 20), source(batch, 162)],
    cli: source(cli, 2586),
    problem: "atomicBatchProblem",
    codes: [...writeCodes, "capability-not-supported", "operation-not-supported"],
    continuation: "none",
    optional: "Write plus atomic-batch1",
  });
  return rows;
}

function pathItem(row) {
  return Object.fromEntries(
    row.methods.map((method) => {
      const post = method === "post",
        head = method === "head";
      const headers = {
        ETag: header(
          "Actual native authorized representation validator; never manufacture from a token.",
          { type: "string" },
          false,
        ),
        "Cache-Control": header("Authorization-dependent response: private, no-store."),
        ...contextHeaders(row.kind, row.collection),
      };
      if (row.history)
        headers["BDP-History-Lineage"] = header("Authorized retained lineage.", {
          enum: ["current", "replaced"],
        });
      if (row.versions)
        headers["BDP-Resource-Kind"] = header(
          "Only when known and disclosable.",
          { enum: ["bead", "link"] },
          false,
        );
      if (row.projection)
        headers["BDP-Projection"] = header(
          "Required iff fields mask supplied: compact ASCII JSON of actual applied mask; absent for full output.",
          { type: "string" },
          false,
        );
      const success = {
        description: row.alias
          ? "One-step alias redirect; no Resource body."
          : row.landing
            ? "Optional human landing representation, deliberately not typed as BDP JSON."
            : "Complete selected native representation; required semantics remain in cited source.",
        headers,
      };
      if (row.alias)
        success.headers = {
          "Cache-Control": headers["Cache-Control"],
          Location: header("Absolute canonical Bead target.", ref("absoluteHttpUrl")),
        };
      if (!head && row.response) {
        let schema = Array.isArray(row.response)
          ? { anyOf: row.response.map(ref) }
          : ref(row.response);
        if (row.aggregate) schema = { allOf: [schema, { type: "object", required: ["links"] }] };
        success.content = { [media]: { schema } };
      }
      const bodyless = (description, successful = false) => ({
        description,
        headers: successful ? headers : { "Cache-Control": headers["Cache-Control"] },
      });
      const responses = {
        [row.alias ? "307" : "200"]: success,
        405: {
          description:
            "HTTP-native method rejection; no Problem body. OPTIONS only under actual CORS policy.",
          headers: {
            Allow: header(
              post
                ? "POST, plus OPTIONS when CORS enabled."
                : "GET, HEAD, plus OPTIONS when CORS enabled.",
            ),
          },
        },
        406: bodyless(
          "Unacceptable successful response media; bodyless, before new mutation effects.",
        ),
        500: { description: "Unexpected internal fault: bodyless; never a BDP Problem." },
        default: {
          description: head
            ? "Applicable native Problem status with no HEAD body; use GET for typed diagnosis."
            : "Applicable cited BDP Problem only; native bodyless statuses are modeled separately.",
          headers: {
            "Cache-Control": headers["Cache-Control"],
            "Retry-After": header(
              "When useful for after-delay; not a promise of automatic safe replay.",
              { type: "string" },
              false,
            ),
          },
          ...(!head
            ? {
                content: {
                  "application/problem+json": {
                    schema: ref(row.projection ? "resourceProjectionProblem" : row.problem),
                  },
                },
              }
            : {}),
        },
      };
      if (row.landing)
        responses["204"] = {
          description: "Bodyless landing success with required service-desc Link.",
          headers: {
            "Cache-Control": headers["Cache-Control"],
            Link: header(
              "Registered service-desc relation; selected version-specific discovery media.",
            ),
          },
        };
      if (!post && !row.alias) {
        responses["304"] = bodyless(
          "Not modified after ordinary authorization/query/cursor/History checks; no body.",
          true,
        );
        responses["412"] = bodyless(
          "HTTP precondition failure; no Problem body or Resource revision-mismatch.",
        );
      }
      if (post) {
        delete success.headers.Link;
        delete success.headers.ETag;
      }
      const op = {
        operationId: row.id + method[0].toUpperCase() + method.slice(1),
        summary: `${method.toUpperCase()} ${row.id}`,
        "x-bdp-navigation": { draft: true, ...row.navigation },
        "x-bdp-sources": row.sources,
        "x-bdp-cli": row.cli,
        "x-bdp-support": row.optional || "Required retained Core",
        "x-bdp-request-media": row.landing
          ? {
              note: "Ordinary HTTP; optional human HTML/Markdown or 204. Follow service-desc before selecting BDP vendor media.",
            }
          : { accept: media, ...(post ? { contentType: media } : {}) },
        "x-bdp-continuation": row.continuation,
        "x-bdp-applicable-problem-codes": [
          ...row.codes,
          ...(row.history || row.versions ? historyCodes : []),
          ...(row.projection ? ["capability-not-supported"] : []),
        ],
        "x-bdp-query-rules":
          "Once-only admitted query members; reject unknown/repeated/conflicting inputs. Follow cited view and capability constraints.",
        parameters: post
          ? [
              {
                name: "Idempotency-Key",
                in: "header",
                required: true,
                schema: ref("idempotencyKey"),
              },
            ]
          : [...row.parameters, ...(!row.alias ? conditionHeaders : [])],
        responses,
      };
      if (post) {
        const rooted = rootedRequests[row.id];
        op.requestBody = {
          required: true,
          content: {
            [media]: {
              schema: rooted ? { oneOf: [ref(row.request), rootedRef(rooted)] } : ref(row.request),
            },
          },
        };
        if (rooted) {
          op["x-bdp-request-selection"] = {
            capability: capability("id-root"),
            version: "1",
            selector:
              row.id === "atomicBatch"
                ? "idRoot present at a createBead/createLink member"
                : "idRoot present on this create body",
            absence: "Unchanged base request; no implicit feature selection",
            requiredComposition:
              row.id === "atomicBatch" ? "atomic-batch1 plus id-root1" : "Write plus id-root1",
            operation: "Same existing operation URL, media and result; no client-side allocation",
            grammar: "specs/profiles/write/id-root.md",
          };
          op.responses.default.content["application/problem+json"].schema = rootedRef(
            row.id === "atomicBatch" ? "idRootBatchProblem" : "idRootCreateProblem",
          );
          if (!op["x-bdp-applicable-problem-codes"].includes("capability-not-supported"))
            op["x-bdp-applicable-problem-codes"].push("capability-not-supported");
        }
        op["x-bdp-forbidden-response-headers"] = ["ETag", "Location"];
      }
      if (row.forbiddenHeaders) op["x-bdp-forbidden-response-headers"] = row.forbiddenHeaders;
      if (row.event)
        op["x-bdp-query-rules"] +=
          " from and after conflict; finite JSON only; view is dispatch, not retainedEventQuery data. No progress from HEAD/304.";
      if (row.projection)
        op["x-bdp-response-selection"] =
          "fields supplied => projected arm and BDP-Projection; otherwise complete current/historical arm and no projection header. Exact requires History.";
      if (row.landing)
        success.headers.Link = header(
          "Required service-desc Link; human body is never parsed as discovery.",
        );
      return [method, op];
    }),
  );
}

function formattedJSON(path, value) {
  const biome = resolve(root, "node_modules/@biomejs/biome/bin/biome");
  if (load("node_modules/@biomejs/biome/package.json").version !== "2.5.7")
    throw new Error(
      "Repository-pinned Biome2.5.7 required; install with the frozen workspace lockfile.",
    );
  return execFileSync(process.execPath, [biome, "format", "--stdin-file-path", path], {
    cwd: root,
    input: `${JSON.stringify(value, null, 2)}\n`,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function validateToolingBinding(binding, row) {
  const url = new URL(binding.url);
  if (
    url.origin !== "https://bdp-tooling.invalid" ||
    !binding.path.startsWith("/") ||
    binding.path.includes("?") ||
    url.pathname !== binding.path
  )
    throw new Error("Tooling binding requires exact synthetic origin and raw pathname");
  for (const parameter of row.parameters.filter((item) => item.in === "query")) {
    const values = url.searchParams.getAll(parameter.name);
    if (parameter.required && values.length !== 1)
      throw new Error(`Tooling binding requires exactly one ${parameter.name}`);
    if (
      Object.hasOwn(parameter.schema, "const") &&
      values.some((value) => value !== String(parameter.schema.const))
    )
      throw new Error(`Tooling binding has wrong ${parameter.name} constant`);
  }
  return url;
}

export function generateArtifacts() {
  for (const [path, expected] of Object.entries(approvedSources)) {
    if (digest(readFileSync(resolve(root, path))) !== expected)
      throw new Error(`Source drift: ${path}; mapping review required, not automatic rehash.`);
  }
  const canonical = readFileSync(resolve(root, schemaFile));
  if (
    !canonical.equals(readFileSync(resolve(root, "packages/protocol/schemas/bdp-v0.1.schema.json")))
  )
    throw new Error("Canonical/mirror mismatch");
  const rows = operations();
  const catalog = {
    openapi: "3.1.1",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "BDP v0.1 operation catalog — informative draft",
      version: "0.1",
      description:
        "Empty paths by design. Reusable signatures do not prescribe routes or implement dynamic navigation. Not a provider/SDK conformance claim.",
    },
    paths: {},
    "x-bdp-cli-surface": {
      status: "Informative semantic grouping, not a generated SDK interface",
      commands: commandGroups,
      transport: transportSignatures,
      deferredPublicCLI: deferredSignatures,
    },
    "x-bdp-navigation": {
      status: "draft authoring/tooling metadata, not a wire capability",
      baseCommit,
      sourceFingerprints: approvedSources,
      exclusions: [
        "sequence",
        "public receipts",
        "replication/snapshots/changefeed",
        "SSE",
        "Query/Graph",
        "rich selection/set batch2",
        "Types inventory/lifecycle",
        "serve/production navigation adapter",
      ],
    },
    components: { pathItems: Object.fromEntries(rows.map((row) => [row.id, pathItem(row)])) },
  };
  const bindings = load("fixtures/openapi/bindings.json");
  if (bindings.status !== "SYNTHETIC_TOOLING_ONLY")
    throw new Error("Tooling fixture status required");
  const paths = {};
  for (const binding of bindings.bindings) {
    if (!catalog.components.pathItems[binding.pathItem] || paths[binding.path])
      throw new Error("Missing/duplicate fixture path item");
    validateToolingBinding(
      binding,
      rows.find((row) => row.id === binding.pathItem),
    );
    paths[binding.path] = {
      $ref: `#/components/pathItems/${binding.pathItem}`,
      "x-bdp-exact-fixture-url": binding.url,
    };
  }
  if (new Set(bindings.bindings.map((x) => x.pathItem)).size !== rows.length)
    throw new Error("Complete fixture coverage required");
  const tooling = {
    ...catalog,
    info: { ...catalog.info, title: "BDP v0.1 SYNTHETIC TOOLING FIXTURE — no deployment routes" },
    servers: [
      {
        url: "https://bdp-tooling.invalid",
        description: "Reserved .invalid fixture only; not a service or production binding.",
      },
    ],
    paths,
    "x-bdp-tooling-only": {
      exactUrlMetadata:
        "x-bdp-exact-fixture-url preserves opaque URL bytes/query; ordinary generators do not implement dynamic BDP navigation.",
    },
  };
  const grouped = [
    ...commandGroups.flatMap((group) => group.signatures),
    ...transportSignatures,
    ...deferredSignatures,
  ];
  if (
    grouped.length !== rows.length ||
    new Set(grouped).size !== rows.length ||
    grouped.some((id) => !rows.some((row) => row.id === id))
  )
    throw new Error(
      "Every wire signature requires exactly one public, transport or deferred grouping",
    );
  const commands = [
    "# Canonical commands first",
    "",
    "Nineteen specified public command signatures own the wire variants below. These are design signatures, not a claim of shipped commands or nineteen generated SDK methods. The 35 wire signature families contain 26 GETs, their 26 HEAD counterparts and nine POSTs; options and transport forms do not add public commands.",
    "",
    "| Canonical command | Wire signature variants |",
    "| --- | --- |",
    ...commandGroups.map(
      (group) =>
        `| \`${group.command}\` | ${group.signatures.map((name) => `\`${name}\``).join(", ")} |`,
    ),
    "",
    "Scope landing and the Write directory are shared transport setup. Discovery also serves scope inspect. Exact-definition lookup is a selected interpreter operation whose public Type CLI remains deferred. HEAD and paging remain mechanics of the selected read.",
    "",
    "[Command/wire exceptions and completion gaps](../../docs/cli-design/wire-correspondence.md) distinguish portable direct operations from host adapters, request composition and unfinished feature correspondence. [Wire coverage](coverage.md) retains all validation cases. Rooted allocation selects id-root1 on existing create/batch routes; it adds no public command or endpoint. Service-side Type default pinning requires no client definition prefetch.",
    "",
  ];
  const coverage = [
    "# Generated informative HTTP coverage",
    "",
    "Start with the [canonical command map](commands.md). Each row below is a wire variant or transport form, not a new command.",
    "",
    `Fixed source base: ${baseCommit}. Do not edit; run scripts/generate-openapi.mjs.`,
    "",
    "Paths are discovered runtime URLs. Source fingerprints require mapping review on change. HEAD is bodyless, including Problems. Generation and the Node unit do not perform external OpenAPI meta-validation; separate evidence is required. They do not execute a code generator or provider.",
    "",
    "| Signature | Navigation / support | Request | Success | Fields / errors | Source / CLI |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows)
    for (const method of row.methods) {
      const op = catalog.components.pathItems[row.id][method];
      const refs = row.sources
        .map((x) => `[${x.file}:${x.line}](../../${x.file}#L${x.line})`)
        .join(", ");
      coverage.push(
        `| ${op.operationId} | ${JSON.stringify(row.navigation)}; ${op["x-bdp-support"]} | ${method === "post" ? `${row.request}; Idempotency-Key; ${media}` : row.parameters.map((x) => x.name).join(", ") || "none"} | ${method === "head" ? "bodyless native status" : row.response || (row.alias ? "307 Location, no body" : "200 human/204 bodyless")} | response headers: ${Object.keys(op.responses[row.alias ? "307" : "200"].headers).join(", ")}; statuses ${Object.keys(op.responses).join(", ")}; ${method === "head" ? "no Problem body" : row.projection ? "resourceProjectionProblem" : row.problem} | ${refs}; [${row.cli.file}:${row.cli.line}](../../${row.cli.file}#L${row.cli.line}) |`,
      );
    }
  coverage.push(
    "",
    "JSON fields/media and exact response constraints are in the catalog. Problem unions may contain inherited inapplicable cases: singleton binding-unavailable is excluded; Type-specific duties remain conditional. Native authorization, admission order, id/key/owner/revision correlation, cursor context and capability checks require semantic implementation.",
    "",
    "The narrow exact-definition wrapper forbids Resource/Collection kind headers and is not a Type inventory or application History advertisement. Projection fields are JSON encoded in one query value; parsed-query helpers are not raw HTTP bodies. Required Events are finite JSON; optional delta must be selected. The separately selected id-root1 composition adds rooted creates without changing base batch1. CLI encoder2 and display/JSONL/retry-file mechanics are not selected version1 HTTP grammar.",
    "",
  );
  return {
    "specs/openapi/bdp-v0.1.openapi.json": formattedJSON(
      "specs/openapi/bdp-v0.1.openapi.json",
      catalog,
    ),
    "specs/openapi/bdp-v0.1.tooling.openapi.json": formattedJSON(
      "specs/openapi/bdp-v0.1.tooling.openapi.json",
      tooling,
    ),
    "specs/openapi/coverage.md": coverage.join("\n"),
    "specs/openapi/commands.md": commands.join("\n"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
    throw new Error("Usage: generate-openapi.mjs [--check]");
  for (const [path, bytes] of Object.entries(generateArtifacts())) {
    if (args[0] === "--check") {
      if (readFileSync(resolve(root, path), "utf8") !== bytes)
        throw new Error(`Generated drift: ${path}`);
    } else writeFileSync(resolve(root, path), bytes);
  }
  console.log(
    args[0] === "--check"
      ? "OpenAPI catalog regeneration matches."
      : "Generated informative catalog/tooling fixture/coverage.",
  );
}
