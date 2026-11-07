#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
// Informative catalog generation only. No HTTP, provider, CLI or schema evaluator.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeSchemaJSON } from "./spec-schema-fragments.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const media = "application/vnd.bdp.v0.1+json";
export const historicalMedia = "application/vnd.bdp.v0.1.historical-update.v1+json";
export const historicalSchemaFile = "specs/profiles/write/historical-update-v1.schema.json";
const historicalRef = (name) => ({
  $ref: `../profiles/write/historical-update-v1.schema.json#/$defs/${name}`,
});
const historicalTargets = {
  historicalUpdateBead: {
    role: "write-directory-feature",
    member: "updateBead",
    request: "historicalUpdateRequest",
    response: "historicalUpdateResult",
    methods: ["post"],
  },
  historicalUpdateCurrent: {
    role: "canonical-resource",
    kind: "bead",
    response: "historicalUpdateView",
    methods: ["get", "head"],
  },
  historicalUpdateTerminal: {
    role: "canonical-resource",
    kind: "bead",
    response: "historicalUpdateTerminalView",
    methods: ["get", "head"],
  },
};
const historicalSelection = {
  capability: "https://github.com/gastownhall/bdp/capabilities/historical-update",
  version: "1",
  media: historicalMedia,
  schema: historicalSchemaFile,
};
function validateHistoricalRow(row) {
  const target = historicalTargets[row.id];
  if (!target && !row.navigation.feature) return;
  assert(target, "Unknown historical feature target");
  assert.deepEqual(
    row.navigation.feature,
    historicalSelection,
    "Wrong historical feature media/schema selection",
  );
  assert.equal(row.navigation.role, target.role, "Wrong historical operation target");
  assert.equal(row.navigation.member, target.member, "Wrong historical directory member");
  assert.equal(row.navigation.kind, target.kind, "Wrong historical subject kind");
  assert.deepEqual(
    Object.keys(row.navigation).sort(),
    ["role", ...(target.member ? ["member"] : ["kind"]), "feature"].sort(),
    "Unknown historical navigation field",
  );
  assert.equal(row.kind, target.kind, "Wrong historical response kind");
  assert.deepEqual(row.methods, target.methods, "Wrong historical methods");
  assert.equal(row.request, target.request, "Wrong historical request");
  assert.equal(row.response, target.response, "Wrong historical response");
  assert.equal(row.problem, "historicalUpdateProblem", "Wrong historical Problem");
  assert(
    !row.history &&
      !row.versions &&
      !row.event &&
      !row.projection &&
      !row.aggregate &&
      !row.alias &&
      !row.landing,
    "Historical feature does not select other optional views",
  );
  assert.deepEqual(
    row.parameters,
    row.id === "historicalUpdateTerminal"
      ? [
          {
            name: "view",
            in: "query",
            required: true,
            schema: { const: "terminal" },
            description: "Current terminal state only; no exact revision or History selection.",
          },
        ]
      : [],
    "Wrong historical query selection",
  );
}
export const schemaFile = "specs/profiles/core/bdp-v0.1.schema.json";
const external = "../profiles/core/bdp-v0.1.schema.json#/$defs/";
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
export const deleteModesSchemaFile = "specs/profiles/write/delete-modes-v1.schema.json";
const deleteModesRef = (name) => ({
  $ref: `../profiles/write/delete-modes-v1.schema.json#/$defs/${name}`,
});
const deleteModeArms = {
  deleteBead: {
    requests: ["deleteModesRequest"],
    successes: ["deleteModesResult", "deleteModesPreview"],
    problem: "deleteModesProblem",
    selector: "beads, blockedBy, cascade or dryRun present on this delete body",
    requiredComposition: "Write plus delete-modes1",
  },
};
export const operationSources = [
  "specs/profiles/core/core.md",
  "specs/profiles/write/write.md",
  "specs/profiles/events/events.md",
];
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
const historyCodes = [
  "revision-unknown",
  "revision-unretained",
  "revision-reorganized",
  "revision-not-tracked",
  "revision-unrepresentable",
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
  ["bd update", ["updateBead", "historicalUpdateBead"]],
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
export const deferredSignatures = [
  "exactDefinition",
  "historicalUpdateCurrent",
  "historicalUpdateTerminal",
];

const fields = new Set([
  "id",
  "navigation",
  "methods",
  "request",
  "response",
  "problem",
  "codes",
  "continuation",
  "optional",
  "kind",
  "collection",
  "history",
  "versions",
  "projection",
  "aggregate",
  "alias",
  "landing",
  "event",
  "forbiddenHeaders",
]);
const unwrapJSON = (cell) => {
  assert(cell.startsWith("`") && cell.endsWith("`"), "Operation value requires JSON code cell");
  return JSON.parse(cell.slice(1, -1));
};

function commentAfter(line, comment) {
  let ticks = 0;
  for (let i = 0; i < line.length; ) {
    if (comment) {
      const end = line.indexOf("-->", i);
      if (end < 0) break;
      comment = false;
      i = end + 3;
    } else if (line[i] === "`") {
      const run = /^`+/.exec(line.slice(i))[0].length;
      if (!ticks) ticks = run;
      else if (ticks === run) ticks = 0;
      i += run;
    } else if (!ticks && line.startsWith("<!--", i)) {
      comment = true;
      i += 4;
    } else i++;
  }
  return comment;
}

// Complete-line delimiters outside code fences; no hidden or executable payload.
export function parseOperationTables(markdown, sourceFile) {
  const rows = [];
  let active = null;
  let fence = null;
  let comment = false;
  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    const opening = !comment && /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) {
      assert(!active, "Fenced payload inside operation table");
      fence = opening[1];
      continue;
    }
    const marker =
      !comment && /^<!-- bdp-operation:(start|end) ([A-Za-z][A-Za-z0-9]*) -->$/.exec(line);
    if (marker) {
      const [, action, id] = marker;
      if (action === "start") {
        assert(!active, "Nested operation");
        active = { id, values: {}, parameters: [], source: { file: sourceFile, line: index + 1 } };
      } else {
        assert(active?.id === id, "Unmatched operation end");
        assert(active.heading, "Missing or mismatched operation heading");
        const row = active.values;
        assert(
          row.id === id &&
            row.methods?.length &&
            row.navigation &&
            row.codes &&
            row.problem &&
            row.continuation,
          `Incomplete operation ${id}`,
        );
        assert(
          row.methods.every((method) => ["get", "head", "post"].includes(method)) &&
            new Set(row.methods).size === row.methods.length,
          "Invalid methods",
        );
        assert(
          row.navigation.role && typeof row.navigation.role === "string",
          "Invalid navigation",
        );
        for (const key of [
          "history",
          "versions",
          "projection",
          "aggregate",
          "alias",
          "landing",
          "event",
        ])
          assert(
            !Object.hasOwn(row, key) || typeof row[key] === "boolean",
            `Invalid boolean ${key}`,
          );
        assert(
          !Object.hasOwn(row, "optional") ||
            (typeof row.optional === "string" && row.optional.length),
          "Invalid support condition",
        );
        assert(
          row.methods.includes("post") === Boolean(row.request),
          "POST requires a request schema; reads cannot acquire one",
        );
        assert(
          Array.isArray(row.codes) && row.codes.every((code) => typeof code === "string"),
          "Invalid Problem codes",
        );
        assert(
          !row.alias || !row.methods.includes("post"),
          "Alias redirect cannot be a POST operation",
        );
        assert(
          !Object.hasOwn(row, "forbiddenHeaders") ||
            (Array.isArray(row.forbiddenHeaders) &&
              row.forbiddenHeaders.every((name) => typeof name === "string" && name.length) &&
              new Set(row.forbiddenHeaders).size === row.forbiddenHeaders.length),
          "Invalid forbidden-header inventory",
        );
        assert(
          !row.event || (sourceFile.endsWith("/events/events.md") && row.optional),
          "Events requires explicit optional support and owning profile",
        );
        assert(
          new Set(active.parameters.map((p) => `${p.in}:${p.name}`)).size ===
            active.parameters.length,
          "Duplicate parameter",
        );
        validateHistoricalRow({ ...row, parameters: active.parameters });
        rows.push({
          ...row,
          parameters: active.parameters,
          sources: [active.source],
          cli: { file: "docs/cli-design/bdp-cli.md", line: 1 },
        });
        active = null;
      }
      continue;
    }
    assert(comment || !/^\s*<!--\s*bdp-operation:/.test(line), "Malformed operation delimiter");
    // Hidden review comments cannot introduce or terminate an operation.
    comment = commentAfter(line, comment);
    if (comment) continue;
    if (!active) continue;
    if (line === `### Operation: ${active.id}`) {
      assert(!active.heading, "Duplicate operation heading");
      active.heading = true;
      continue;
    }
    assert(!line.trim() || line.startsWith("|"), "Unrecognized operation source line");
    if (!line.startsWith("|")) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (["Field", "Parameter"].includes(cells[0]) || cells.every((cell) => /^-+$/.test(cell)))
      continue;
    if (cells.length === 2) {
      const [key, value] = cells;
      assert(
        fields.has(key) && !Object.hasOwn(active.values, key),
        `Unknown/duplicate operation field ${key}`,
      );
      active.values[key] = unwrapJSON(value);
    } else {
      assert(cells.length === 6, "Malformed parameter table");
      const [name, where, required, schema, description, parsed] = cells;
      assert(
        ["query", "header"].includes(where) && ["yes", "no"].includes(required),
        "Invalid parameter binding",
      );
      active.parameters.push({
        name,
        in: where,
        required: required === "yes",
        schema: unwrapJSON(schema),
        description: description === "—" ? "" : description,
        ...(parsed === "—" ? {} : { "x-bdp-parsed-schema": unwrapJSON(parsed) }),
      });
    }
  }
  assert(!active && !fence && !comment, "Unclosed operation, fence or comment");
  assert(new Set(rows.map((row) => row.id)).size === rows.length, "Duplicate operation");
  return rows;
}

export function parseComposition(markdown, name = "types1") {
  const blocks = [];
  let active = null;
  let fence = null;
  let comment = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = null;
      continue;
    }
    const opening = !comment && /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) {
      assert(!active, "Fenced composition payload");
      fence = opening[1];
      continue;
    }
    const marker =
      !comment && /^<!-- bdp-composition:(start|end) ([A-Za-z][A-Za-z0-9]*) -->$/.exec(line);
    if (marker) {
      const [, action, id] = marker;
      if (action === "start") {
        assert(!active, "Nested composition");
        active = { id, lines: [] };
      } else {
        assert(active?.id === id, "Unmatched composition end");
        blocks.push(active);
        active = null;
      }
      continue;
    }
    assert(comment || !/^\s*<!--\s*bdp-composition:/.test(line), "Malformed composition delimiter");
    const wasComment = comment;
    comment = commentAfter(line, comment);
    if (active) {
      assert(!wasComment && !comment, "Hidden composition source");
      active.lines.push(line);
    }
  }
  assert(!active && !fence && !comment, "Unclosed composition, fence or comment");
  assert(
    blocks.length === 1 && blocks[0].id === name,
    "Missing, duplicate or unexpected composition",
  );
  const values = {};
  let heading = false;
  const allowed = [
    "id",
    "media",
    "capability",
    "version",
    "operations",
    "responseSchemas",
    "selection",
  ];
  for (const line of blocks[0].lines) {
    if (!line.trim()) continue;
    if (line === `### Composition: ${name}`) {
      assert(!heading, "Duplicate composition heading");
      heading = true;
      continue;
    }
    assert(line.startsWith("|") && line.endsWith("|"), "Unrecognized composition source line");
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    assert(cells.length === 2, "Malformed composition table");
    const [key, value] = cells;
    if (key === "Field" || cells.every((cell) => /^-+$/.test(cell))) continue;
    assert(
      allowed.includes(key) && !Object.hasOwn(values, key),
      "Unknown/duplicate composition field",
    );
    values[key] = unwrapJSON(value);
  }
  assert(heading && allowed.every((key) => Object.hasOwn(values, key)), "Incomplete composition");
  assert(
    values.id === name &&
      values.version === "1" &&
      typeof values.media === "string" &&
      values.media.length &&
      typeof values.selection === "string" &&
      values.selection.length,
    "Invalid composition identity/selection",
  );
  assert(
    Array.isArray(values.operations) &&
      values.operations.every((id) => typeof id === "string") &&
      new Set(values.operations).size === values.operations.length,
    "Invalid composition targets",
  );
  assert(
    values.responseSchemas &&
      typeof values.responseSchemas === "object" &&
      !Array.isArray(values.responseSchemas) &&
      Object.values(values.responseSchemas).every((id) => typeof id === "string"),
    "Invalid feature response schemas",
  );
  return values;
}

function cliSource(id) {
  const group = commandGroups.find((entry) => entry.signatures.includes(id));
  const command = group?.command ?? (deferredSignatures.includes(id) ? null : "bd scope inspect");
  const file = "docs/cli-design/bdp-cli.md";
  const lines = readFileSync(resolve(root, file), "utf8").split(/\r?\n/);
  const index = command
    ? lines.indexOf(`#### \`${command}\``)
    : lines.indexOf(
        id.startsWith("historicalUpdate")
          ? "#### Historical-update feature reads"
          : "#### Types: `--type` and `--exact-type`",
      );
  assert(index >= 0, `Missing CLI correspondence for ${id}`);
  return { file, line: index + 1 };
}

export function operations() {
  const rows = operationSources.flatMap((path) =>
    parseOperationTables(readFileSync(resolve(root, path), "utf8"), path),
  );
  assert(
    new Set(rows.map((row) => row.id)).size === rows.length,
    "Duplicate cross-profile operation",
  );
  return rows.map((row) => ({ ...row, cli: cliSource(row.id) }));
}

export function pathItem(row) {
  validateHistoricalRow(row);
  const historical = Boolean(historicalTargets[row.id]);
  const selectedMedia = historical ? historicalMedia : media;
  const schemaRef = historical ? historicalRef : ref;
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
      if (historical && !post)
        headers.Vary = header(
          "Negotiated feature representation; MUST include Accept, plus any actual additional variation.",
        );
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
      if (row.landing)
        headers.Link = header(
          "Scope discovery navigation; also valid on bodyless conditional success.",
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
          : schemaRef(row.response);
        if (row.aggregate) schema = { allOf: [schema, { type: "object", required: ["links"] }] };
        success.content = { [selectedMedia]: { schema } };
      }
      const bodyless = (description, successful = false) => ({
        description,
        headers: successful
          ? structuredClone(headers)
          : { "Cache-Control": headers["Cache-Control"] },
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
                    schema: schemaRef(row.projection ? "resourceProjectionProblem" : row.problem),
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
          : { accept: selectedMedia, ...(post ? { contentType: selectedMedia } : {}) },
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
                required: false,
                description:
                  "Required under the idempotency capability; ignored, without validation, on a Scope that does not advertise it.",
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
            [selectedMedia]: {
              schema: rooted
                ? { oneOf: [ref(row.request), rootedRef(rooted)] }
                : schemaRef(row.request),
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
            grammar: "specs/profiles/write/write.md#optional-rooted-allocation-version-1",
          };
          op.responses.default.content["application/problem+json"].schema = rootedRef(
            row.id === "atomicBatch" ? "idRootBatchProblem" : "idRootCreateProblem",
          );
          if (!op["x-bdp-applicable-problem-codes"].includes("capability-not-supported"))
            op["x-bdp-applicable-problem-codes"].push("capability-not-supported");
        }
      }
      const deleteModes = post ? deleteModeArms[row.id] : undefined;
      if (deleteModes) {
        op["x-bdp-feature-arms"] = [
          {
            capability: capability("delete-modes"),
            version: "1",
            selector: deleteModes.selector,
            absence: "Unchanged base request, result and Problems; no implicit feature selection",
            requiredComposition: deleteModes.requiredComposition,
            operation: "Same existing operation URL and media",
            request: { oneOf: deleteModes.requests.map(deleteModesRef) },
            success: { oneOf: deleteModes.successes.map(deleteModesRef) },
            problem: deleteModesRef(deleteModes.problem),
            grammar: "specs/profiles/write/write.md#optional-deletion-modes-version-1",
          },
        ];
        if (!op["x-bdp-applicable-problem-codes"].includes("capability-not-supported"))
          op["x-bdp-applicable-problem-codes"].push("capability-not-supported");
      }
      if (historical) {
        op["x-bdp-feature-selection"] = {
          ...row.navigation.feature,
          selection: post
            ? "Both feature Content-Type and Accept; required fromRevision; same discovered updateBead URL"
            : "Feature Accept; canonical Bead URL; terminal requires exactly one view=terminal",
        };
        if (!head) {
          const capabilityProblem = post
            ? {
                allOf: [
                  historicalRef("historicalUpdateCapabilityProblem"),
                  { type: "object", properties: { pointer: { const: "/fromRevision" } } },
                ],
              }
            : historicalRef("historicalUpdateReadCapabilityProblem");
          op.responses.default.content["application/problem+json"].schema = {
            allOf: [
              historicalRef("historicalUpdateProblem"),
              {
                if: {
                  type: "object",
                  required: ["code"],
                  properties: { code: { const: "capability-not-supported" } },
                },
                // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword is passive schema data.
                then: capabilityProblem,
              },
            ],
          };
        }
        op["x-bdp-query-rules"] =
          row.id === "historicalUpdateTerminal"
            ? "Exactly one view=terminal; reject extras/repeats; current terminal only, live/unknown/undisclosable gives uniform404. No alias forwarding or exact-D read."
            : "No query members; no History, projection or aggregate selection.";
        if (post)
          op.responses["415"] = {
            description:
              "Unsupported request media, before admission; ordinary unsupported-media-type Problem, no feature execution.",
            headers: { "Cache-Control": headers["Cache-Control"] },
            content: { "application/problem+json": { schema: ref("readUpdateProblem") } },
          };
      }
      if (post || row.forbiddenHeaders)
        op["x-bdp-forbidden-response-headers"] = [
          ...new Set([...(post ? ["ETag", "Location"] : []), ...(row.forbiddenHeaders ?? [])]),
        ];
      if (row.event)
        op["x-bdp-query-rules"] +=
          " from and after conflict; finite JSON only; view is dispatch, not retainedEventQuery data. No progress from HEAD/304.";
      if (row.projection)
        op["x-bdp-response-selection"] =
          "fields supplied => projected arm and BDP-Projection; otherwise complete current/historical arm and no projection header. Exact requires History.";
      return [method, op];
    }),
  );
}

function formattedJSON(path, value) {
  assert.equal(load("node_modules/@biomejs/biome/package.json").version, "2.5.7");
  return execFileSync(
    process.execPath,
    [resolve(root, "node_modules/@biomejs/biome/bin/biome"), "format", "--stdin-file-path", path],
    {
      cwd: root,
      input: `${serializeSchemaJSON(value)}\n`,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
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
  const sourceFingerprints = Object.fromEntries(
    [
      ...operationSources,
      "specs/profiles/types/types.md",
      "specs/profiles/transfer/transfer.md",
      "specs/formats/markdown-openapi.md",
      "docs/cli-design/bdp-cli.md",
      "specs/profiles/types/types-v1.schema.json",
      "scripts/generate-openapi.mjs",
      "scripts/spec-schema-fragments.mjs",
      "fixtures/openapi/bindings.json",
      "packages/protocol/schemas/bdp-v0.1.schema.json",
      schemaFile,
      idRootSchemaFile,
      deleteModesSchemaFile,
      historicalSchemaFile,
      "packages/protocol/schemas/historical-update-v1.schema.json",
    ].map((path) => [path, digest(readFileSync(resolve(root, path)))]),
  );
  const canonical = readFileSync(resolve(root, schemaFile));
  if (
    !canonical.equals(readFileSync(resolve(root, "packages/protocol/schemas/bdp-v0.1.schema.json")))
  )
    throw new Error("Canonical/mirror mismatch");
  assert.deepEqual(
    load(historicalSchemaFile),
    load("packages/protocol/schemas/historical-update-v1.schema.json"),
    "Historical feature canonical/mirror schema graph mismatch",
  );
  const typesSource = "specs/profiles/types/types.md";
  const typesText = readFileSync(resolve(root, typesSource), "utf8");
  const composition = parseComposition(typesText);
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
      authoringSource: "Visible profile OpenAPI tables; shared native HTTP rules in Core",
      sourceFingerprints,
      profileCompositions: [
        "specs/profiles/types/types.md#openapi",
        "specs/profiles/transfer/transfer.md#openapi",
      ],
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
  assert(
    Array.isArray(composition.operations) &&
      new Set(composition.operations).size === composition.operations.length,
    "Duplicate composition operation",
  );
  const featureSchema = load("specs/profiles/types/types-v1.schema.json");
  for (const id of composition.operations) {
    const row = rows.find((candidate) => candidate.id === id);
    assert(
      row &&
        !row.event &&
        !row.landing &&
        !row.alias &&
        !row.versions &&
        (row.kind || row.collection || row.methods.includes("post")),
      `Invalid Types composition target ${id}`,
    );
    for (const op of Object.values(catalog.components.pathItems[id])) {
      op["x-bdp-feature-selection"] = {
        capability: composition.capability,
        version: composition.version,
        media: composition.media,
        selection: composition.selection,
        source: `${typesSource}#openapi`,
      };
      if (op.requestBody)
        op.requestBody.content[composition.media] = structuredClone(op.requestBody.content[media]);
      const success = op.responses["200"];
      if (success.content) {
        const shape = structuredClone(success.content[media]);
        const name = composition.responseSchemas[id];
        if (name) {
          assert(Object.hasOwn(featureSchema.$defs, name), `Unknown Types shape ${name}`);
          shape.schema = {
            allOf: [
              shape.schema,
              { $ref: `../profiles/types/types-v1.schema.json#/$defs/${name}` },
            ],
          };
        }
        success.content[composition.media] = shape;
      }
    }
  }
  assert(
    Object.keys(composition.responseSchemas).every((id) => composition.operations.includes(id)),
    "Unselected feature response schema",
  );
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
    ...structuredClone(catalog),
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
  // This file lives under fixtures/openapi, so schema locations must be rebased.
  function rebaseFixtureRefs(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && value.$ref.startsWith("../profiles/"))
      value.$ref = value.$ref.replace("../profiles/", "../../specs/profiles/");
    for (const child of Object.values(value)) rebaseFixtureRefs(child);
  }
  rebaseFixtureRefs(tooling);
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
    "Nineteen specified public command signatures own the wire variants below. These are design signatures, not a claim of shipped commands or nineteen generated SDK methods. The 38 wire signature families contain 28 GETs, their 28 HEAD counterparts and ten POSTs; options and transport forms do not add public commands.",
    "",
    "| Canonical command | Wire signature variants |",
    "| --- | --- |",
    ...commandGroups.map(
      (group) =>
        `| \`${group.command}\` | ${group.signatures.map((name) => `\`${name}\``).join(", ")} |`,
    ),
    "",
    "Scope landing and the Write directory are shared transport setup. Discovery also serves scope inspect. Exact-definition lookup is a selected interpreter operation whose public Type CLI remains deferred. Historical-update current/terminal reads are explicit SDK/HTTP feature methods with no selected public CLI read flag or verb; bd update --from-revision selects the existing Update route with feature media. HEAD and paging remain mechanics of the selected read.",
    "",
    "[Command/wire exceptions and completion gaps](../../docs/cli-design/wire-correspondence.md) distinguish portable direct operations from host adapters, request composition and unfinished feature correspondence. [Wire coverage](coverage.md) retains all validation cases. Rooted allocation selects id-root1 on existing create/batch routes; it adds no public command or endpoint. Deletion modes select delete-modes1 on the existing deleteBead and atomic-batch1 routes; they add no endpoint. Service-side Type default pinning requires no client definition prefetch.",
    "",
  ];
  const coverage = [
    "# Generated informative HTTP coverage",
    "",
    "Start with the [canonical command map](commands.md). Each row below is a wire variant or transport form, not a new command.",
    "",
    "Generated directly from the current profile OpenAPI appendices. Do not edit; run scripts/generate-openapi.mjs.",
    "",
    "Paths are discovered runtime URLs. Source fingerprints identify the visible authoring inputs; operation edits are reviewed in those tables. HEAD is bodyless, including Problems. Generation and the Node unit do not perform external OpenAPI meta-validation; separate evidence is required. They do not execute a code generator or provider.",
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
        `| ${op.operationId} | ${JSON.stringify(row.navigation)}; ${op["x-bdp-support"]} | ${method === "post" ? `${row.request}; Idempotency-Key; ${op["x-bdp-request-media"].contentType}` : row.parameters.map((x) => x.name).join(", ") || "none"} | ${method === "head" ? "bodyless native status" : row.response || (row.alias ? "307 Location, no body" : "200 human/204 bodyless")} | response headers: ${Object.keys(op.responses[row.alias ? "307" : "200"].headers).join(", ")}; statuses ${Object.keys(op.responses).join(", ")}; ${method === "head" ? "no Problem body" : row.projection ? "resourceProjectionProblem" : row.problem} | ${refs}; [${row.cli.file}:${row.cli.line}](../../${row.cli.file}#L${row.cli.line}) |`,
      );
    }
  coverage.push(
    "",
    "JSON fields/media and exact response constraints are in the catalog. Problem unions may contain inherited inapplicable cases: singleton binding-unavailable is excluded; Type-specific duties remain conditional. Native authorization, admission order, id/key/owner/revision correlation, cursor context and capability checks require semantic implementation.",
    "",
    "The narrow exact-definition wrapper forbids Resource/Collection kind headers and is not a Type inventory or application History advertisement. Projection fields are JSON encoded in one query value; parsed-query helpers are not raw HTTP bodies. Advertised optional Events are finite JSON; optional delta must be selected. The separately selected id-root1 composition adds rooted creates without changing base batch1. The separately selected delete-modes1 composition adds deletion modes without changing base deleteBead or batch1; its arms are recorded in x-bdp-feature-arms. CLI encoder2 and display/JSONL/retry-file mechanics are not selected version1 HTTP grammar.",
    "",
  );
  return {
    "specs/openapi/bdp-v0.1.openapi.json": formattedJSON(
      "specs/openapi/bdp-v0.1.openapi.json",
      catalog,
    ),
    "fixtures/openapi/generated.openapi.json": formattedJSON(
      "fixtures/openapi/generated.openapi.json",
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
