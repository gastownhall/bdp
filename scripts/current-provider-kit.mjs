/** Incomplete current-contract provider slice. Adapters provision; assertions live here. */
import assert, { AssertionError } from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { optionalRowNames, runOptionalRows } from "./current-provider-kit-callables.mjs";
import {
  parseLinkHeader,
  withBdpSourceAnnotations,
  isJsonSchemaUri,
  isJsonSchemaDateTime,
} from "../packages/protocol/dist/index.js";

const media = "application/vnd.bdp.v0.1+json";
const specification = "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json";
const core = "specs/profiles/core/core.md";
const write = "specs/profiles/write/write.md";
const definitions = [
  ["core.scope-discovery", `${core}#discovery-and-capabilities`],
  ["write.discovery-fixed-routes", `${write}#discover-and-select-write`],
  ["write.media-before-admission", `${write}#contract-and-media`],
  ["write.create", `${write}#ordinary-results`],
  ["core.point-read", `${core}#read-a-bead-or-link`],
  ["core.inventory-fixed-routes", `${core}#inventory-entry-points`],
  ["write.no-op", `${write}#covered-state-and-no-ops`],
  ["write.guard-failure", `${write}#ordinary-requests`],
  ["write.effectful-update", `${write}#independent-object-planes`],
  ["write.delete", `${write}#ordinary-results`],
  ["write.restart", `${write}#atomic-durability-crash-and-capability-changes`],
  ["write.durable-original-success", `${write}#claims-and-terminal-outcomes`],
  ["write.durable-original-failure", `${write}#claims-and-terminal-outcomes`],
  ["write.durable-original-delete", `${write}#claims-and-terminal-outcomes`],
  ["core.deleted-absence", `${core}#reads-after-deletion`],
  ["write.link-create", `${write}#ordinary-results`],
  ["write.link-update", `${write}#whole-link-endpoint-correction`],
  ["write.alias-put", `${write}#aliases`],
  ["write.alias-delete", `${write}#claims-and-terminal-outcomes`],
  ["write.link-delete", `${write}#ordinary-results`],
];
export const UNCOVERED_REQUIRED = Object.freeze([
  {
    id: "coverage.complete-obligation-audit",
    source: `${write}#conformance-boundary`,
    reason: "Clause-level Core/Write obligation census is not complete; this is a vertical slice.",
  },
  {
    id: "core.collections-and-native-pagination",
    source: `${core}#collections-and-pagination`,
    reason:
      "Beyond the fixed-route smoke witness, continuation, authorization binding and frozen-selection cases are not implemented.",
  },
  {
    id: "core.link-and-alias-reads",
    source: `${core}#incident-link-reads`,
    reason:
      "Link point reads and alias GET redirects have narrow witnesses; incident directions/pagination and complete alias/Link read metadata and failure variants are not implemented.",
  },
  {
    id: "core.http-and-selection",
    source: `${core}#resource-reads-and-views`,
    reason:
      "HEAD/conditional reads, views, negotiation, CORS and complete malformed-target cases are not implemented.",
  },
  {
    id: "write.remaining-five-operations",
    source: `${write}#eight-distinct-ordinary-targets`,
    reason:
      "Local Link CRUD and alias lifecycle/replay have narrow witnesses; remaining malformed, authorization, identity and recovery variants are not implemented.",
  },
  {
    id: "write.identity-and-admission",
    source: `${write}#admission-authorization-and-limits`,
    reason:
      "Allocation collisions, remaining request/media/key admission variants, bounds and numeric cases are not implemented. The single generic-JSON 415 witness below is partial coverage only.",
  },
  {
    id: "write.authorization-and-protected-state",
    source: `${write}#admission-authorization-and-limits`,
    reason:
      "Retained disclosure, authorization changes and protected Type/native constraints are not implemented.",
  },
  {
    id: "write.concurrent-and-crash-recovery",
    source: `${write}#atomic-durability-crash-and-capability-changes`,
    reason:
      "Concurrent claims, abrupt loss/failover, expired detail and retention/erasure diagnoses are not implemented. Restart below is controlled reopen only.",
  },
]);
// Fixed qualification boundary, independent of whichever rows survive execution.
const requiredObligationIds = Object.freeze([
  "core.scope-discovery",
  "write.discovery-fixed-routes",
  "write.media-before-admission",
  "write.create",
  "core.point-read",
  "core.inventory-fixed-routes",
  "write.no-op",
  "write.guard-failure",
  "write.effectful-update",
  "write.link-create",
  "write.link-update",
  "write.alias-put",
  "write.alias-delete",
  "write.link-delete",
  "write.delete",
  "write.restart",
  "write.durable-original-success",
  "write.durable-original-failure",
  "write.durable-original-delete",
  "core.deleted-absence",
  "coverage.complete-obligation-audit",
  "core.collections-and-native-pagination",
  "core.link-and-alias-reads",
  "core.http-and-selection",
  "write.remaining-five-operations",
  "write.identity-and-admission",
  "write.authorization-and-protected-state",
  "write.concurrent-and-crash-recovery",
]);

// Internal script control seam; no provider option can waive this boundary.
export function hasCompleteRequiredCoverage(rows, lifecycle) {
  return (
    lifecycle.provision === "pass" &&
    lifecycle.cleanup === "pass" &&
    rows.length === requiredObligationIds.length &&
    new Set(rows.map((row) => row.id)).size === rows.length &&
    requiredObligationIds.every((id) =>
      rows.some((row) => row.id === id && row.required === true && row.state === "pass"),
    )
  );
}
const isWriteRowId = (id) => id.startsWith("write.");
const isAliasRowId = (id) => id === "write.alias-put" || id === "write.alias-delete";
// The rows that exist to replay a retained outcome; Write owes them only under `idempotency`.
const isReplayRowId = (id) => id.startsWith("write.durable-original-");
const IDEMPOTENCY = "https://github.com/gastownhall/bdp/capabilities/idempotency";
// A later row reads what these leave behind, so a failure here stops its journey, excepted or not.
const PRODUCER_ROWS = new Set([
  "write.discovery-fixed-routes",
  "write.create",
  "write.effectful-update",
  "write.delete",
  "write.restart",
  "write.link-create",
  "write.alias-put",
]);
const exceptableWriteRows = definitions.map(([id]) => id).filter(isWriteRowId);
class HarnessError extends Error {}
class Stop extends Error {}
class NotRun extends Error {}

const SERVICE_ALLOCATED = "service-allocated";
const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const httpUri = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
/** What a row's reason may repeat of a name the operator wrote: a token, or nothing. */
const rowName = (name) => (/^[A-Za-z0-9._-]{1,64}$/.test(name) ? `\`${name}\`` : "a row");
/**
 * A provider's own fixture: see "A provider's recipe" in docs/current-provider-kit.md. Closed, so
 * a misspelled member is refused here rather than read as a check that silently did not run.
 */
export function parseRecipe(recipe, optionalRows) {
  const refuse = (message) => {
    throw new HarnessError(`The recipe is refused: ${message}`);
  };
  const closed = (value, where, allowed, required = []) => {
    if (!isPlainObject(value)) refuse(`${where} must be a JSON object`);
    for (const member of Object.keys(value))
      if (!allowed.includes(member)) refuse(`${where} has a member the kit does not read`);
    for (const member of required)
      if (!Object.hasOwn(value, member)) refuse(`${where} needs \`${member}\``);
  };
  const objectMember = (value, member, where) => {
    if (Object.hasOwn(value, member) && !isPlainObject(value[member]))
      refuse(`${where}.${member} must be a JSON object`);
  };
  const type = (value, where) => {
    if (typeof value !== "string" || !httpUri(value))
      refuse(`${where}.type must be an absolute HTTP(S) Type URI`);
  };
  const identity = (value, where) => {
    if (value === SERVICE_ALLOCATED) return;
    if (
      typeof value !== "string" ||
      !value.includes("{unique}") ||
      value.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/i.test(value) ||
      /[?#\\]/.test(value) ||
      value.split("/").some((segment) => segment === "." || segment === "..")
    )
      refuse(
        `${where}.id must be "${SERVICE_ALLOCATED}", or a Scope-relative spelling containing {unique}`,
      );
  };
  closed(recipe, "the recipe", ["bead", "link", "excepted"], ["bead"]);
  const { bead, link, excepted } = recipe;
  closed(bead, "bead", ["type", "id", "create", "update"], ["type", "id", "create", "update"]);
  type(bead.type, "bead");
  identity(bead.id, "bead");
  closed(bead.create, "bead.create", ["properties", "metadata"], ["properties"]);
  objectMember(bead.create, "properties", "bead.create");
  objectMember(bead.create, "metadata", "bead.create");
  closed(bead.update, "bead.update", ["properties", "propertiesChange"]);
  const created = bead.create.properties;
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  if (Object.hasOwn(bead.update, "properties") === Object.hasOwn(bead.update, "propertiesChange"))
    refuse("bead.update needs exactly one of `properties` and `propertiesChange`");
  let changes;
  if (Object.hasOwn(bead.update, "properties")) {
    objectMember(bead.update, "properties", "bead.update");
    changes = Object.entries(bead.update.properties).some(
      ([member, value]) => !same(created[member], value),
    );
  } else {
    const patch = bead.update.propertiesChange;
    if (!Array.isArray(patch) || patch.length === 0)
      refuse("bead.update.propertiesChange must be a nonempty array");
    for (const item of patch) {
      closed(item, "a propertiesChange item", ["op", "path", "value"], ["op", "path", "value"]);
      if (!["add", "replace"].includes(item.op))
        refuse('a propertiesChange item\'s op must be "add" or "replace"');
      if (typeof item.path !== "string" || !/^\/[^/~]+$/.test(item.path))
        refuse("a propertiesChange item's path must be one member, such as /title");
      // The no-op sends the created value back at each path, so there must be one.
      if (!Object.hasOwn(created, item.path.slice(1)))
        refuse("a propertiesChange item must name a member bead.create writes");
    }
    changes = patch.some((item) => !same(created[item.path.slice(1)], item.value));
  }
  if (!changes) refuse("bead.update changes nothing bead.create wrote, so no update can be seen");
  if (link !== undefined) {
    closed(link, "link", ["type", "id", "properties", "metadata"], ["type", "id"]);
    type(link.type, "link");
    identity(link.id, "link");
    objectMember(link, "properties", "link");
    objectMember(link, "metadata", "link");
  }
  if (excepted !== undefined) {
    if (!isPlainObject(excepted)) refuse("excepted must be an object of row to reason");
    for (const [row, why] of Object.entries(excepted)) {
      if (!exceptableWriteRows.includes(row) && !optionalRows.includes(row))
        refuse(`excepted names ${rowName(row)}, which is no Write row or optional row of this kit`);
      if (typeof why !== "string" || why === "") refuse(`excepted ${rowName(row)} needs a reason`);
    }
  }
  return recipe;
}
/** What the update leaves of what the kit wrote, and the same edit at the created values. */
function recipeUpdate({ create, update }) {
  if (update.properties !== undefined)
    return { wrote: update.properties, noop: { properties: create.properties } };
  const wrote = { ...create.properties };
  for (const item of update.propertiesChange) wrote[item.path.slice(1)] = item.value;
  return {
    wrote,
    noop: {
      propertiesChange: update.propertiesChange.map((item) => ({
        ...item,
        value: create.properties[item.path.slice(1)],
      })),
    },
  };
}
/** Safe to repeat in a report: a status, and a code only when it is token-shaped. */
function answerOf(reply) {
  let code;
  try {
    code = JSON.parse(reply.bytes.toString("utf8"))?.code;
  } catch {}
  return `HTTP ${reply.status}${typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? ` ${code}` : ""}`;
}

// Internal timing control seam; the runner always supplies the actual monotonic clock.
export function hasGraphDetailWindow(window, minimum, start, now) {
  return Number.isSafeInteger(window) && window >= minimum && now - start < window;
}
function fields(value, allowed, required) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new HarnessError("Adapter must return a plain data object");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new HarnessError("Adapter record prototype is unsupported");
  if (
    Reflect.ownKeys(descriptors).some(
      (key) => !allowed.includes(key) || !("value" in descriptors[key]),
    ) ||
    required.some((key) => !Object.hasOwn(descriptors, key))
  )
    throw new HarnessError("Adapter record has missing, unknown or accessor fields");
  return value;
}
function origin(value) {
  if (typeof value !== "string") throw new HarnessError("Adapter origin must be text");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href !== url.origin + "/"
  )
    throw new HarnessError(
      "Adapter connection must be an HTTP(S) origin without path or credentials",
    );
  return url.origin;
}
function connections(value) {
  if (!Array.isArray(value) || !value.length)
    throw new HarnessError("Adapter connections are required");
  const result = value.map((entry) => {
    fields(entry, ["origin", "connectOrigin", "authorization"], ["origin", "connectOrigin"]);
    if (
      entry.authorization !== undefined &&
      (typeof entry.authorization !== "string" || /[\r\n]/.test(entry.authorization))
    )
      throw new HarnessError("Invalid adapter authorization field");
    return Object.freeze({
      origin: origin(entry.origin),
      connectOrigin: origin(entry.connectOrigin),
      authorization: entry.authorization,
    });
  });
  if (new Set(result.map((entry) => entry.origin)).size !== result.length)
    throw new HarnessError("Duplicate adapter connection origin");
  return Object.freeze(result);
}
function exchange(
  routes,
  target,
  method = "GET",
  value,
  key,
  { contentType = media, accept = media, rawBody } = {},
) {
  const logical = new URL(target);
  if (
    logical.username ||
    logical.password ||
    logical.hash ||
    !["http:", "https:"].includes(logical.protocol)
  )
    throw new HarnessError("Unsupported discovered HTTP target");
  const route = routes.find((entry) => entry.origin === logical.origin);
  if (!route)
    throw new HarnessError("Discovered origin has no explicitly authorized adapter connection");
  const physical = new URL(route.connectOrigin);
  const text = rawBody ?? (value === undefined ? undefined : JSON.stringify(value));
  return new Promise((resolve, reject) => {
    const req = (physical.protocol === "https:" ? https : http).request(
      {
        hostname: physical.hostname,
        port: physical.port,
        method,
        path: logical.pathname + logical.search,
        headers: {
          host: logical.host,
          accept,
          ...(route.authorization === undefined ? {} : { authorization: route.authorization }),
          ...(text === undefined
            ? {}
            : {
                ...(contentType === null ? {} : { "content-type": contentType }),
                "content-length": String(Buffer.byteLength(text)),
                ...(key === undefined ? {} : { "idempotency-key": key }),
              }),
        },
      },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1048576) req.destroy(new HarnessError("Kit response-byte limit exceeded"));
          else chunks.push(chunk);
        });
        response.on("error", () => {
          clearTimeout(timer);
          reject(new HarnessError("Public HTTP response did not complete"));
        });
        response.on("end", () => {
          clearTimeout(timer);
          resolve({
            status: response.statusCode,
            headers: response.headers,
            bytes: Buffer.concat(chunks),
          });
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new HarnessError("Kit HTTP deadline exceeded")),
      5000,
    );
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(
        error instanceof HarnessError
          ? error
          : new HarnessError("Public HTTP exchange did not complete"),
      );
    });
    req.end(text);
  });
}

/**
 * `--scope` mode: one existing Scope, reached directly. No lifecycle, no fixture and no
 * mutation of that Scope unless the operator says so; see `allowMutation` below.
 */
export function directScopeProvider(scopeUrl, authorization) {
  return async () => ({
    scope: scopeUrl,
    connections: [
      {
        origin: new URL(scopeUrl).origin,
        connectOrigin: new URL(scopeUrl).origin,
        ...(authorization === undefined ? {} : { authorization }),
      },
    ],
    async cleanup() {},
  });
}

/**
 * Local trusted adapter module contract; no expected answers or custom validators.
 * `allowMutation: false` leaves every mutating case not-run with its reason, whatever the
 * Scope advertises: an operator's existing Scope is not the kit's to change.
 */
export async function runCurrentProvider(
  provision,
  { allowMutation = true, exceptions: ledger, recipe: suppliedRecipe, recipeFailure } = {},
) {
  const rows = definitions.map(([id, source]) => ({
    id,
    source,
    required: true,
    state: "not-run",
    reason: "Prerequisite did not complete",
  }));
  rows.push(...UNCOVERED_REQUIRED.map((row) => ({ ...row, required: true, state: "not-run" })));
  const lifecycle = { provision: "not-run", cleanup: "not-run" };
  const report = {
    kit: "current-core-ordinary-write-slice-1",
    specification,
    qualificationComplete: false,
    sliceComplete: false,
    state: "incomplete",
    claimEligible: false,
    lifecycle,
    obligations: rows,
  };
  let provider, cleanup;
  let provisionEntered = false;
  let exceptions = ledger;
  let lastPost;
  async function step(id, action) {
    const row = rows.find((entry) => entry.id === id);
    lastPost = undefined;
    try {
      await action();
      row.state = "pass";
      delete row.reason;
    } catch (error) {
      row.state =
        error instanceof NotRun
          ? "not-run"
          : error instanceof AssertionError
            ? "fail"
            : "harness-error";
      row.reason =
        error instanceof NotRun
          ? error.message
          : error instanceof AssertionError
            ? // An authored message is fixed text; a generated one could quote a response value.
              error.generatedMessage === false
              ? `Public assertion failed for ${id}: ${error.message}`
              : `Public assertion failed for ${id}`
            : error instanceof HarnessError
              ? error.message
              : "Harness/provider lifecycle or transport did not complete";
      const excepted = exceptions?.[id] !== undefined;
      if (excepted && lastPost !== undefined) row.observedAnswer = answerOf(lastPost);
      if (!excepted || PRODUCER_ROWS.has(id)) throw new Stop();
    }
  }
  try {
    if (recipeFailure !== undefined) throw new HarnessError(recipeFailure);
    const optionalRows = await optionalRowNames();
    const recipe =
      suppliedRecipe === undefined ? undefined : parseRecipe(suppliedRecipe, optionalRows);
    for (const row of Object.keys(ledger ?? {}))
      if (isWriteRowId(row) && !exceptableWriteRows.includes(row))
        throw new HarnessError(`The exceptions ledger names ${rowName(row)}, which no case runs`);
    if (recipe?.excepted !== undefined && Object.keys(recipe.excepted).length > 0)
      exceptions = { ...recipe.excepted, ...ledger };
    if (recipe !== undefined)
      report.recipe = {
        used: true,
        comparison: "authored-members",
        statement:
          "Not the strict portable fixture: the provider supplied its Types and bodies, the kit checked the members it wrote rather than whole properties, and a record may carry members the provider added.",
        sha256: createHash("sha256").update(JSON.stringify(recipe)).digest("hex"),
        exceptedRows: Object.keys(recipe.excepted ?? {}),
      };
    if (typeof provision !== "function")
      throw new HarnessError("Provider module must export provision");
    const schemaText = await readFile(
      new URL("../specs/profiles/core/bdp-v0.1.schema.json", import.meta.url),
      "utf8",
    );
    report.schemaSha256 = createHash("sha256").update(schemaText).digest("hex");
    const [caseSource, coreProse, writeProse] = await Promise.all([
      readFile(new URL(import.meta.url)),
      readFile(new URL(`../${core}`, import.meta.url)),
      readFile(new URL(`../${write}`, import.meta.url)),
    ]);
    const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
    report.inputs = {
      caseSourceSha256: sha256(caseSource),
      optionalCaseSourceSha256: sha256(
        await readFile(new URL("./current-provider-kit-callables.mjs", import.meta.url)),
      ),
      coreProseSha256: sha256(coreProse),
      writeProseSha256: sha256(writeProse),
      schemaSha256: report.schemaSha256,
      actualNode: process.versions.node,
      providerIdentity: "UNVERIFIED",
      inputClosure: "INCOMPLETE",
      resultReuseAttestation: false,
    };
    const schema = JSON.parse(schemaText);
    const ajv = withBdpSourceAnnotations(new Ajv2020({ strict: true, allErrors: true }));
    ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
    ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
    ajv.addSchema(schema);
    const validators = new Map();
    function json(reply, status, definition, contentType = media) {
      assert.equal(reply.status, status);
      assert.equal(
        reply.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase(),
        contentType,
      );
      let parsed;
      try {
        parsed = JSON.parse(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(reply.bytes),
        );
      } catch {
        assert.fail("Response body is not valid UTF-8 JSON");
      }
      let validate = validators.get(definition);
      if (!validate) {
        validate = ajv.compile({ $ref: `${specification}#/$defs/${definition}` });
        validators.set(definition, validate);
      }
      assert.equal(validate(parsed), true, `Response does not satisfy ${definition}`);
      return parsed;
    }
    function success(reply, definition = "mutationResult") {
      const value = json(reply, 200, definition);
      const cache = new Set(
        (reply.headers["cache-control"] ?? "")
          .split(",")
          .map((directive) => directive.trim().toLowerCase()),
      );
      assert(cache.has("private") && cache.has("no-store"));
      assert.equal(reply.headers.etag, undefined);
      assert.equal(reply.headers.location, undefined);
      return value;
    }
    const runId = randomUUID();
    const fixture = Object.freeze({
      runId,
      type: "https://conformance.invalid/types/PortableRecord",
      id: `provider-kit/${runId}/record`,
      linkType: "https://conformance.invalid/types/PortableRelation",
      linkId: `provider-kit/${runId}/relation`,
      graphSourceId: `provider-kit/${runId}/graph-source`,
      secondaryIds: Object.freeze([
        `provider-kit/${runId}/endpoint-b`,
        `provider-kit/${runId}/endpoint-c`,
      ]),
      aliasLeaf: `provider-kit-${runId}`,
      minimumDetailWindowMs: 60000,
      minimumGraphDetailWindowMs: 360000,
    });
    provisionEntered = true;
    provider = await provision(Object.freeze({ fixture }));
    cleanup = Object.getOwnPropertyDescriptor(provider ?? {}, "cleanup")?.value;
    fields(
      provider,
      ["scope", "connections", "conditions", "witnesses", "restart", "cleanup"],
      ["scope", "connections", "cleanup"],
    );
    const witnesses =
      provider.witnesses === undefined
        ? {}
        : fields(
            provider.witnesses,
            ["deletedResourceId", "callables", "issuePackage", "takesNoExceptions"],
            [],
          );
    if (witnesses.callables !== undefined)
      fields(
        witnesses.callables,
        ["unimplemented", "batch", "idempotentBatch", "callableError", "atomicProblem"],
        [],
      );
    if (witnesses.takesNoExceptions === true && exceptions !== undefined)
      throw new HarnessError("This provider takes no exceptions; a ledger cannot apply to it");
    if (
      witnesses.deletedResourceId !== undefined &&
      typeof witnesses.deletedResourceId !== "string"
    )
      throw new HarnessError("Adapter witness must name a Resource by its local identity");
    if (
      typeof cleanup !== "function" ||
      (provider.restart !== undefined && typeof provider.restart !== "function")
    )
      throw new HarnessError("Adapter lifecycle functions are malformed");
    const scope = new URL(provider.scope);
    if (
      !["http:", "https:"].includes(scope.protocol) ||
      !scope.href.endsWith("/") ||
      scope.search ||
      scope.hash ||
      scope.username ||
      scope.password ||
      scope.href !== provider.scope
    )
      throw new HarnessError("Adapter must supply the canonical Scope URL");
    let routes = connections(provider.connections);
    const conditions =
      provider.conditions === undefined
        ? undefined
        : fields(
            provider.conditions,
            [
              "retainedDetailWindowMs",
              "graphRetainedDetailWindowMs",
              "linkFixture",
              "hierarchicalAliasFixture",
            ],
            ["retainedDetailWindowMs"],
          );
    if (
      conditions &&
      (!Number.isSafeInteger(conditions.retainedDetailWindowMs) ||
        conditions.retainedDetailWindowMs <= 0)
    )
      throw new HarnessError("Adapter retained-detail condition must be a positive safe integer");
    let retentionStart;
    lifecycle.provision = "pass";
    let discoveryUrl, discovered, directory, aliases, idempotent, created, failed, updated, deleted;
    // Without a recipe every one of these is the portable fixture's, and the comparison is exact.
    let spelled = 0;
    const spell = (template) =>
      template === SERVICE_ALLOCATED
        ? undefined
        : template.replaceAll("{unique}", `${runId.slice(0, 8)}${++spelled}`);
    const identified = (local) => (local === undefined ? {} : { id: local });
    const inScope = (value) => {
      assert(
        typeof value === "string" && value.startsWith(scope.href) && value !== scope.href,
        "The allocated identity is not a URL under this Scope",
      );
      return value;
    };
    const wroteBack = recipe
      ? (actual, expected, where) => {
          for (const [member, value] of Object.entries(expected))
            assert.deepEqual(
              actual?.[member],
              value,
              `${where}.${member} did not come back as the kit wrote it`,
            );
        }
      : (actual, expected) => assert.deepEqual(actual, expected);
    const beadType = recipe?.bead.type ?? fixture.type;
    const beadMembers = recipe
      ? { properties: recipe.bead.create.properties, metadata: recipe.bead.create.metadata ?? {} }
      : { properties: { title: "portable original" }, metadata: { source: "provider-kit" } };
    const beadLocal = recipe ? spell(recipe.bead.id) : fixture.id;
    // Undefined until the service allocates it, when the recipe says it does.
    let id = beadLocal === undefined ? undefined : new URL(beadLocal, scope).href;
    const create = { ...identified(beadLocal), type: beadType, ...beadMembers };
    const createKey = `create-${runId}`,
      failureKey = `guard-${runId}`,
      deleteKey = `delete-${runId}`;
    const updateFixture = recipe
      ? { edit: recipe.bead.update, ...recipeUpdate(recipe.bead) }
      : {
          edit: { properties: { title: "portable updated" } },
          wrote: { title: "portable updated" },
          noop: { properties: create.properties },
        };
    const update = () => ({ bead: id, ...updateFixture.edit });
    const remove = () => ({ bead: id });
    const post = async (operation, body, key) => {
      lastPost = await exchange(routes, directory[operation], "POST", body, key);
      return lastPost;
    };
    async function scopeDescription() {
      const reply = await exchange(routes, scope.href, "GET", undefined, undefined, {
        accept: "*/*",
      });
      assert([200, 204].includes(reply.status));
      const links = parseLinkHeader(reply.headers.link ?? "").filter((entry) =>
        entry.parameters.some(
          (parameter) =>
            parameter.name.toLowerCase() === "rel" &&
            parameter.value
              .split(/\s+/)
              .some((relation) => relation.toLowerCase() === "service-desc"),
        ),
      );
      assert(links.length > 0, "Scope omitted its required service-desc Link");
      const typed = links.filter((entry) =>
        entry.parameters.some(
          (parameter) =>
            parameter.name.toLowerCase() === "type" && parameter.value.toLowerCase() === media,
        ),
      );
      const selected = typed.length === 1 ? typed[0] : links.length === 1 ? links[0] : undefined;
      if (!selected)
        throw new HarnessError("Kit cannot select one discovery Link among available candidates");
      return new URL(selected.target, scope).href;
    }
    function notApplicable(ids, reason) {
      for (const row of rows)
        if (ids(row.id)) {
          row.state = "not-applicable";
          row.required = false;
          row.reason = reason;
        }
    }
    const isWriteRow = isWriteRowId;
    /** Read the discovery document only to learn the profile; Write's case checks its own shape. */
    async function discoverProfile(description) {
      const reply = await exchange(routes, description);
      assert.equal(reply.status, 200);
      let parsed;
      try {
        parsed = JSON.parse(new TextDecoder().decode(reply.bytes));
      } catch {
        assert.fail("The discovery document is not JSON");
      }
      if (parsed?.profile === "write") return parsed;
      // The two base literals are closed (Core "Discovery and capabilities"): anything but
      // `write` must be a valid closed Core document, or this is the provider's failure.
      const discovery = json(reply, 200, "coreDiscovery");
      assert.equal(discovery.profile, "core");
      assert.equal(discovery.bdpVersion, "0.1");
      assert.equal(discovery.scope, scope.href);
      return discovery;
    }
    async function completePages(first, definition) {
      let page = json(first, 200, definition);
      const items = [...page.items];
      for (let guard = 0; page.next !== null && page.next !== undefined; guard++) {
        if (guard >= 100) throw new HarnessError("Inventory exceeded the kit's page budget");
        page = json(await exchange(routes, new URL(page.next, scope).href), 200, definition);
        items.push(...page.items);
      }
      return items;
    }
    /**
     * Core's cases over whatever the Scope already holds. The provider seeds its records by
     * its own means (its store, its adapter); the kit reads them through the public inventory,
     * so nothing the provider says about its data becomes an expected answer.
     */
    async function coreJourney() {
      let beads, links;
      const independent = async (name, action) => {
        try {
          await step(name, action);
        } catch (error) {
          if (!(error instanceof Stop)) throw error;
        }
      };
      await independent("core.inventory-fixed-routes", async () => {
        const beadInventory = await exchange(routes, new URL("bdp/beads", scope).href);
        assert.equal(beadInventory.status, 200);
        assert.equal(beadInventory.headers["bdp-collection-kind"], "bead");
        beads = await completePages(beadInventory, "currentBeadCollection");
        const linkInventory = await exchange(routes, new URL("bdp/links", scope).href);
        assert.equal(linkInventory.status, 200);
        assert.equal(linkInventory.headers["bdp-collection-kind"], "link");
        links = await completePages(linkInventory, "currentLinkCollection");
      });
      await independent("core.point-read", async () => {
        const absent = await exchange(
          routes,
          new URL(`provider-kit/${runId}/never-created`, scope).href,
        );
        assert.equal(
          absent.status,
          404,
          "A two-segment identity the Scope never held did not answer 404",
        );
        const absentProblem = (() => {
          try {
            return json(absent, 404, "readProblem", "application/problem+json");
          } catch {
            assert.fail("A two-segment identity's 404 is not a BDP Problem (readProblem)");
          }
        })();
        assert.equal(absentProblem.code, "resource-not-found", "Absence is not resource-not-found");
        assert.equal(absent.headers["bdp-resource-kind"], undefined);
        if (beads === undefined)
          throw new NotRun("The Bead inventory did not complete; no point-read subject is known");
        if (beads.length === 0)
          throw new NotRun(
            "The Scope holds no Bead to read; a read-only provider seeds one by its own means",
          );
        const bead = await exchange(routes, beads[0].id);
        assert.equal(bead.headers["bdp-resource-kind"], "bead");
        assert.deepEqual(json(bead, 200, "currentBeadRecord"), beads[0]);
        if (links?.length) {
          const link = await exchange(routes, links[0].id);
          assert.equal(link.headers["bdp-resource-kind"], "link");
          assert.deepEqual(json(link, 200, "currentLinkRecord"), links[0]);
        }
      });
      await independent("core.deleted-absence", async () => {
        if (witnesses.deletedResourceId === undefined)
          throw new NotRun(
            "No Write delete and no adapter witness of a natively deleted Resource; reads after deletion are not run",
          );
        const reply = await exchange(routes, new URL(witnesses.deletedResourceId, scope).href);
        assert([404, 410].includes(reply.status));
        const problem = json(reply, reply.status, "readProblem", "application/problem+json");
        assert(
          reply.status === 404
            ? problem.code === "resource-not-found"
            : ["resource-pruned", "resource-erased"].includes(problem.code),
        );
      });
    }
    // Core "Fixed navigation": every route is built from the Scope, never read from discovery.
    async function absentPath(target, method = "GET") {
      const reply = await exchange(routes, target, method);
      assert.equal(reply.status, 404, `${method} ${target} must answer as an absent path`);
      if (method === "GET")
        assert.equal(
          json(reply, 404, "readProblem", "application/problem+json").code,
          "resource-not-found",
        );
    }
    async function readNavigation(description) {
      const discovery = json(await exchange(routes, description), 200, "writeDiscovery");
      assert.equal(discovery.bdpVersion, "0.1");
      assert.equal(discovery.profile, "write");
      assert.equal(discovery.scope, scope.href);
      // Closed discovery names no route: inventories, operations and Events are fixed.
      for (const member of ["beads", "links", "operations", "events"])
        assert.equal(Object.hasOwn(discovery, member), false, `discovery carries ${member}`);
      const nextAliases = discovery.aliases;
      // Write "Ordinary targets": the six always, the alias pair exactly with advertised `aliases`.
      const resource = [
        "createBead",
        "updateBead",
        "deleteBead",
        "createLink",
        "updateLink",
        "deleteLink",
      ];
      const alias = ["putAlias", "deleteAlias"];
      const operation = (name) => new URL(`bdp/operations/${name}`, scope).href;
      const expected = [...resource, ...(nextAliases === undefined ? [] : alias)];
      const nextDirectory = Object.fromEntries(expected.map((name) => [name, operation(name)]));
      // Each served target is POST-only: a GET is Write's bodyless 405 with Allow: POST.
      for (const name of expected) {
        const reply = await exchange(routes, nextDirectory[name]);
        assert.equal(reply.status, 405, `GET ${name} must be Write's bodyless 405`);
        assert.equal(reply.headers.allow, "POST");
        assert.equal(reply.bytes.length, 0);
      }
      // The retired directory, and the alias pair without `aliases`, are absent paths.
      await absentPath(new URL("bdp/operations", scope).href);
      if (nextAliases === undefined) for (const name of alias) await absentPath(operation(name));
      return {
        directory: nextDirectory,
        aliases: nextAliases,
        idempotent: discovery.capabilities?.[IDEMPOTENCY]?.["1"] !== undefined,
      };
    }
    const deletedAbsence = async () => {
      const reply = await exchange(routes, id);
      assert([404, 410].includes(reply.status));
      const problem = json(reply, reply.status, "readProblem", "application/problem+json");
      assert(
        reply.status === 404
          ? problem.code === "resource-not-found"
          : ["resource-pruned", "resource-erased"].includes(problem.code),
      );
    };
    const restartProvider = async () => {
      const restarted = await provider.restart();
      fields(restarted, ["connections"], ["connections"]);
      routes = connections(restarted.connections);
    };
    async function baseJourney() {
      await step("core.scope-discovery", async () => {
        discoveryUrl = await scopeDescription();
        discovered = await discoverProfile(discoveryUrl);
        report.discovered = {
          profile: discovered.profile,
          capabilities: Object.keys(discovered.capabilities ?? {}).sort(),
        };
      });
      if (discovered.profile === "core") {
        notApplicable(
          isWriteRow,
          "Not applicable by discovery: the Scope advertises profile core, not write",
        );
        await coreJourney();
        return;
      }
      await step("write.discovery-fixed-routes", async () => {
        ({ directory, aliases, idempotent } = await readNavigation(discoveryUrl));
      });
      // Only after that case has held the fixed routes to discovery: a disagreement fails above.
      if (aliases === undefined)
        notApplicable(
          isAliasRowId,
          "Not applicable by discovery: the Write Scope does not advertise aliases",
        );
      // Write, "Repetition without idempotency": such a Scope retains nothing to replay.
      if (!idempotent)
        notApplicable(
          isReplayRowId,
          "Not applicable by discovery: the Write Scope does not advertise idempotency",
        );
      if (!allowMutation) {
        for (const row of rows)
          if (isWriteRow(row.id) && row.state === "not-run")
            row.reason =
              "Not run: this Scope advertises Write, but --scope mode does not change a Scope without --allow-mutation";
        await coreJourney();
        return;
      }
      await step("write.media-before-admission", async () => {
        // With no identity of its own to read back, the kit reads the whole inventory instead.
        const inventoryIds = async () =>
          (
            await completePages(
              await exchange(routes, new URL("bdp/beads", scope).href),
              "currentBeadCollection",
            )
          )
            .map((bead) => bead.id)
            .sort();
        const before = id === undefined ? await inventoryIds() : undefined;
        retentionStart = performance.now();
        const rejected = json(
          await exchange(routes, directory.createBead, "POST", create, createKey, {
            contentType: "application/json",
          }),
          415,
          "readUpdateProblem",
          "application/problem+json",
        );
        assert.equal(rejected.code, "unsupported-media-type");
        if (id === undefined) {
          assert.deepEqual(
            await inventoryIds(),
            before,
            "A create refused for its media left a record behind",
          );
          return;
        }
        const absent = json(
          await exchange(routes, id),
          404,
          "readProblem",
          "application/problem+json",
        );
        assert.equal(absent.code, "resource-not-found");
      });
      await step("write.create", async () => {
        created = success(await post("createBead", create, createKey));
        assert.equal(created.outcome, "created");
        assert.equal(created.changed, true);
        id ??= inScope(created.resource.id);
        assert.equal(created.resource.id, id);
        assert.equal(created.resource.type, beadType);
        wroteBack(created.resource.properties, create.properties, "properties");
        wroteBack(created.resource.metadata, create.metadata, "metadata");
        assert.equal(typeof created.resource.revision, "string");
        assert.notEqual(created.resource.revision, "");
        if (idempotent)
          assert.deepEqual(success(await post("createBead", create, createKey)), created);
      });
      await step("core.point-read", async () => {
        const reply = await exchange(routes, id);
        assert.equal(reply.headers["bdp-resource-kind"], "bead");
        assert.deepEqual(json(reply, 200, "currentBeadRecord"), created.resource);
      });
      await step("core.inventory-fixed-routes", async () => {
        const beadInventory = await exchange(routes, new URL("bdp/beads", scope).href);
        assert.equal(beadInventory.status, 200);
        assert.equal(beadInventory.headers["bdp-collection-kind"], "bead");
        assert(beadInventory.headers.link?.includes(`<${discoveryUrl}>; rel="service-desc"`));
        const beadPage = json(beadInventory, 200, "currentBeadCollection");
        assert(beadPage.items.some((bead) => bead.id === created.resource.id));

        const linkInventory = await exchange(routes, new URL("bdp/links", scope).href);
        assert.equal(linkInventory.status, 200);
        assert.equal(linkInventory.headers["bdp-collection-kind"], "link");
        assert(linkInventory.headers.link?.includes(`<${discoveryUrl}>; rel="service-desc"`));
        const linkPage = json(linkInventory, 200, "currentLinkCollection");
        assert(Array.isArray(linkPage.items));
      });
      await step("write.no-op", async () => {
        const reply = success(
          await post(
            "updateBead",
            {
              bead: id,
              ...updateFixture.noop,
              expectedRevision: created.resource.revision,
            },
            `noop-${runId}`,
          ),
        );
        assert.equal(reply.outcome, "updated");
        assert.equal(reply.changed, false);
        assert.deepEqual(reply.resource, created.resource);
      });
      const badGuard =
        created.resource.revision === "kit-wrong-guard"
          ? "kit-another-wrong-guard"
          : "kit-wrong-guard";
      const guarded = { ...update(), expectedRevision: badGuard };
      await step("write.guard-failure", async () => {
        failed = json(
          await post("updateBead", guarded, failureKey),
          409,
          "readUpdateProblem",
          "application/problem+json",
        );
        assert.equal(failed.code, "revision-mismatch");
        assert.deepEqual(
          json(await exchange(routes, id), 200, "currentBeadRecord"),
          created.resource,
        );
      });
      await step("write.effectful-update", async () => {
        updated = success(
          await post(
            "updateBead",
            { ...update(), expectedRevision: created.resource.revision },
            `update-${runId}`,
          ),
        );
        assert.equal(updated.outcome, "updated");
        assert.equal(updated.changed, true);
        assert.notEqual(updated.resource.revision, created.resource.revision);
        wroteBack(updated.resource.properties, updateFixture.wrote, "properties");
        wroteBack(updated.resource.metadata, create.metadata, "metadata");
      });
      await step("write.delete", async () => {
        deleted = success(await post("deleteBead", remove(), deleteKey));
        assert.equal(deleted.outcome, "deleted");
        assert.equal(deleted.changed, true);
        assert.deepEqual(deleted.deleted, {
          resourceKind: "bead",
          resource: { id, type: beadType, revision: updated.resource.revision },
        });
      });
      // Nothing is retained, so no detail window applies and nothing waits on a replay.
      if (!idempotent) {
        if (provider.restart) await step("write.restart", restartProvider);
        else
          rows.find((row) => row.id === "write.restart").reason =
            "No explicit adapter restart hook; restart is not run";
        await step("core.deleted-absence", deletedAbsence);
        return;
      }
      if (
        !provider.restart ||
        !conditions ||
        conditions.retainedDetailWindowMs < fixture.minimumDetailWindowMs ||
        performance.now() - retentionStart >= conditions.retainedDetailWindowMs
      ) {
        rows.find((row) => row.id === "write.restart").reason = !provider.restart
          ? "No explicit adapter restart hook; durable Write slice is not run"
          : !conditions
            ? "No explicit retained-detail fixture window; durable Write slice is not run"
            : conditions.retainedDetailWindowMs < fixture.minimumDetailWindowMs
              ? "Declared retained-detail window is shorter than the requested fixture window; durable Write slice is not run"
              : "Retained-detail fixture window elapsed before restart; durable Write slice is not run";
        throw new Stop();
      }
      await step("write.restart", restartProvider);
      if (performance.now() - retentionStart >= conditions.retainedDetailWindowMs) {
        rows.find((row) => row.id === "write.durable-original-success").reason =
          "Controlled restart exceeded the retained-detail fixture window";
        throw new Stop();
      }
      await step("write.durable-original-success", async () => {
        const reply = await post("createBead", create, createKey);
        if (performance.now() - retentionStart >= conditions.retainedDetailWindowMs)
          throw new HarnessError("Retained-detail fixture window elapsed during replay");
        assert.deepEqual(success(reply), created);
      });
      await step("write.durable-original-failure", async () => {
        if (failed === undefined)
          throw new NotRun("No refused guard to replay: its row is excepted");
        const reply = await post("updateBead", guarded, failureKey);
        if (performance.now() - retentionStart >= conditions.retainedDetailWindowMs)
          throw new HarnessError("Retained-detail fixture window elapsed during replay");
        assert.deepEqual(json(reply, 409, "readUpdateProblem", "application/problem+json"), failed);
      });
      await step("write.durable-original-delete", async () => {
        const reply = await post("deleteBead", remove(), deleteKey);
        if (performance.now() - retentionStart >= conditions.retainedDetailWindowMs)
          throw new HarnessError("Retained-detail fixture window elapsed during replay");
        assert.deepEqual(success(reply), deleted);
      });
      await step("core.deleted-absence", deletedAbsence);
    }
    try {
      await baseJourney();
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
    }
    const graphRows = [
      "write.link-create",
      "write.link-update",
      "write.alias-put",
      "write.alias-delete",
      "write.link-delete",
    ];
    const graphNotRun = (names, reason) => {
      for (const name of names) {
        const row = rows.find((entry) => entry.id === name);
        if (row.state !== "not-applicable") row.reason = reason;
      }
    };
    const baseFailed = rows.some(
      (row) =>
        !graphRows.includes(row.id) &&
        exceptions?.[row.id] === undefined &&
        ["fail", "harness-error"].includes(row.state),
    );
    let graphConditionsValid = true;
    try {
      if (
        conditions?.graphRetainedDetailWindowMs !== undefined &&
        (!Number.isSafeInteger(conditions.graphRetainedDetailWindowMs) ||
          conditions.graphRetainedDetailWindowMs <= 0)
      )
        throw new HarnessError("Graph retained-detail condition must be a positive safe integer");
      for (const name of ["linkFixture", "hierarchicalAliasFixture"])
        if (conditions?.[name] !== undefined && typeof conditions[name] !== "boolean")
          throw new HarnessError("Adapter fixture condition must be boolean");
    } catch {
      graphConditionsValid = false;
      report.harnessFailure = "Graph fixture conditions are invalid";
    }
    // A recipe's Link is the provider saying what its Link fixture is.
    const linkFixture = conditions?.linkFixture === true || recipe?.link !== undefined;
    const graphRequested =
      allowMutation &&
      discovered?.profile === "write" &&
      (linkFixture ||
        (aliases !== undefined &&
          conditions?.hierarchicalAliasFixture === true &&
          (!idempotent ||
            conditions.graphRetainedDetailWindowMs >= fixture.minimumGraphDetailWindowMs)));
    let currentGraphNavigation = false;
    if (directory && !baseFailed && graphConditionsValid && graphRequested) {
      try {
        // Original frozen retries are complete; fresh work follows current discovery. The alias
        // rows were already decided by the discovery the base journey read, so a provider cannot
        // withdraw aliases mid-run to make those rows not applicable, nor add them unmeasured.
        const advertisedAliases = aliases !== undefined;
        const advertisedIdempotency = idempotent;
        ({ directory, aliases, idempotent } = await readNavigation(await scopeDescription()));
        if ((aliases !== undefined) !== advertisedAliases)
          throw new HarnessError("Discovery changed its aliases advertisement during the run");
        if (idempotent !== advertisedIdempotency)
          throw new HarnessError("Discovery changed its idempotency advertisement during the run");
        currentGraphNavigation = true;
      } catch (error) {
        report.harnessFailure =
          error instanceof HarnessError
            ? error.message
            : "Current graph discovery could not be established";
      }
    }
    if (discovered?.profile === "core" || !allowMutation) {
      // Their reasons are already recorded: not applicable by discovery, or not authorized.
    } else if (!currentGraphNavigation) {
      graphNotRun(
        graphRows,
        graphRequested
          ? "Base discovery or graph fixture initialization did not complete; independent graph fixture is not run"
          : "No requested graph fixture is available; independent graph rows are not run",
      );
    } else {
      const graphRetentionStart = performance.now();
      const detailReady = () =>
        hasGraphDetailWindow(
          conditions?.graphRetainedDetailWindowMs,
          fixture.minimumGraphDetailWindowMs,
          graphRetentionStart,
          performance.now(),
        );
      const requireDetail = () => {
        if (idempotent && !detailReady())
          throw new NotRun(
            "No current requested graph retained-detail window; remaining alias subjourney is not run",
          );
      };
      // Only this fixture setup is shared; aliases do not depend on the Link fixture.
      const linkType = recipe?.link?.type ?? fixture.linkType;
      const linkLocal = recipe?.link ? spell(recipe.link.id) : fixture.linkId;
      // Undefined until the service allocates it, when the recipe says it does.
      let linkId = linkLocal === undefined ? undefined : new URL(linkLocal, scope).href;
      let graphSetup, beads, linkCreated, linkUpdated;
      const unused = async (target) => {
        const reply = await exchange(routes, target);
        if (reply.status !== 404)
          throw new NotRun("Requested unused graph fixture identity is unavailable");
        try {
          const problem = json(reply, 404, "readProblem", "application/problem+json");
          assert.equal(problem.code, "resource-not-found");
          assert.equal(reply.headers["bdp-resource-kind"], undefined);
        } catch (error) {
          if (error instanceof AssertionError)
            throw new NotRun("Requested graph fixture absence could not be established");
          throw error;
        }
      };
      const prepareBeads = () =>
        (graphSetup ??= (async () => {
          const results = [];
          const locals = recipe
            ? [spell(recipe.bead.id), spell(recipe.bead.id), spell(recipe.bead.id)]
            : [fixture.graphSourceId, ...fixture.secondaryIds];
          for (const [index, local] of locals.entries()) {
            if (local !== undefined) await unused(new URL(local, scope).href);
            const body = {
              ...identified(local),
              type: beadType,
              ...(recipe
                ? beadMembers
                : { properties: { title: "portable endpoint" }, metadata: {} }),
            };
            const reply = await post("createBead", body, `graph-bead-${index}-${runId}`);
            if (reply.status !== 200)
              throw new NotRun("Requested graph Bead fixture could not be provisioned");
            try {
              const result = success(reply);
              assert.equal(result.outcome, "created");
              assert.equal(result.changed, true);
              assert.equal(
                result.resource.id,
                local === undefined ? inScope(result.resource.id) : new URL(local, scope).href,
              );
              assert.equal(result.resource.type, beadType);
              wroteBack(result.resource.properties, body.properties, "properties");
              wroteBack(result.resource.metadata, body.metadata, "metadata");
              assert.deepEqual(
                json(await exchange(routes, result.resource.id), 200, "currentBeadRecord"),
                result.resource,
              );
              results.push(result.resource);
            } catch (error) {
              if (error instanceof AssertionError)
                throw new HarnessError("Graph Bead fixture setup could not be verified");
              throw error;
            }
          }
          beads = results;
          return results;
        })());
      const unchangedBeads = async () => {
        for (const bead of beads)
          assert.deepEqual(json(await exchange(routes, bead.id), 200, "currentBeadRecord"), bead);
      };
      const pointLink = async () => {
        const reply = await exchange(routes, linkId);
        assert.equal(reply.headers["bdp-resource-kind"], "link");
        const descriptions = parseLinkHeader(reply.headers.link ?? "").filter((entry) =>
          entry.parameters.some(
            (parameter) =>
              parameter.name.toLowerCase() === "rel" &&
              parameter.value.split(/\s+/).some((value) => value.toLowerCase() === "service-desc"),
          ),
        );
        assert(descriptions.length > 0, "Link omitted owning service-desc");
        const typed = descriptions.filter((entry) =>
          entry.parameters.some(
            (parameter) =>
              parameter.name.toLowerCase() === "type" && parameter.value.toLowerCase() === media,
          ),
        );
        const selected =
          typed.length === 1 ? typed[0] : descriptions.length === 1 ? descriptions[0] : undefined;
        if (!selected) throw new HarnessError("Kit cannot select one owning discovery Link");
        const owning = json(
          await exchange(routes, new URL(selected.target, linkId).href),
          200,
          "writeDiscovery",
        );
        assert.equal(owning.scope, scope.href);
        return json(reply, 200, "currentLinkRecord");
      };
      const graphStep = async (name, action) => {
        try {
          await step(name, action);
          return true;
        } catch (error) {
          if (!(error instanceof Stop)) throw error;
          return false;
        }
      };
      if (!linkFixture) {
        graphNotRun(
          ["write.link-create", "write.link-update", "write.link-delete"],
          "No explicit Link fixture condition; Link subjourney is not run",
        );
      } else {
        await graphStep("write.link-create", async () => {
          await prepareBeads();
          if (linkId !== undefined) await unused(linkId);
          const body = {
            ...identified(linkLocal),
            type: linkType,
            // Plain References: pinned endpoints are the portable fixture's to witness.
            ...(recipe
              ? {
                  properties: recipe.link.properties ?? {},
                  metadata: recipe.link.metadata ?? {},
                  source: beads[0].id,
                  target: beads[1].id,
                }
              : {
                  properties: { label: "portable relation" },
                  metadata: { source: "provider-kit" },
                  source: { uri: beads[0].id, revision: beads[0].revision },
                  target: { uri: beads[1].id, revision: beads[1].revision },
                }),
          };
          linkCreated = success(await post("createLink", body, `link-create-${runId}`));
          assert.equal(linkCreated.outcome, "created");
          assert.equal(linkCreated.changed, true);
          linkId ??= inScope(linkCreated.resource.id);
          assert.equal(linkCreated.resource.id, linkId);
          for (const field of ["type", "source", "target"])
            assert.deepEqual(linkCreated.resource[field], body[field]);
          for (const field of ["properties", "metadata"])
            wroteBack(linkCreated.resource[field], body[field], field);
          assert.equal(linkCreated.ownerRevisions, undefined);
          assert.deepEqual(await pointLink(), linkCreated.resource);
          await unchangedBeads();
        });
        if (rows.find((row) => row.id === "write.link-create").state === "pass") {
          await graphStep("write.link-update", async () => {
            const body = {
              link: linkId,
              target: beads[2].id,
              expectedRevision: linkCreated.resource.revision,
            };
            linkUpdated = success(await post("updateLink", body, `link-update-${runId}`));
            assert.equal(linkUpdated.outcome, "updated");
            assert.equal(linkUpdated.changed, true);
            assert.notEqual(linkUpdated.resource.revision, linkCreated.resource.revision);
            assert.equal(linkUpdated.resource.id, linkId);
            for (const field of ["type", "properties", "metadata", "source"])
              assert.deepEqual(linkUpdated.resource[field], linkCreated.resource[field]);
            assert.equal(linkUpdated.resource.target, beads[2].id);
            assert.equal(linkUpdated.ownerRevisions, undefined);
            assert.deepEqual(await pointLink(), linkUpdated.resource);
            const noop = success(
              await post(
                "updateLink",
                { ...body, expectedRevision: linkUpdated.resource.revision },
                `link-noop-${runId}`,
              ),
            );
            assert.equal(noop.outcome, "updated");
            assert.equal(noop.changed, false);
            assert.deepEqual(noop.resource, linkUpdated.resource);
            assert.equal(noop.ownerRevisions, undefined);
            assert.deepEqual(await pointLink(), linkUpdated.resource);
            await unchangedBeads();
          });
        }
      }
      let alias, putResult, deleteResult;
      const aliasAt = async (target) => {
        const reply = await exchange(routes, alias);
        assert.equal(reply.status, 307);
        assert.equal(reply.headers.location, target);
        assert.equal(reply.bytes.length, 0);
        assert.equal(reply.headers["bdp-resource-kind"], undefined);
      };
      const aliasAbsent = async () => {
        const reply = await exchange(routes, alias);
        assert.equal(
          json(reply, 404, "readProblem", "application/problem+json").code,
          "resource-not-found",
        );
        assert.equal(reply.headers["bdp-resource-kind"], undefined);
      };
      const aliasReplay = async (operation, body, key, expected) => {
        if (!idempotent) return;
        requireDetail();
        const reply = await post(operation, body, key);
        if (!detailReady())
          throw new HarnessError(
            "Graph retained-detail fixture window elapsed during alias replay",
          );
        assert.deepEqual(success(reply, "aliasResult"), expected);
      };
      if (aliases === undefined) {
        // Not applicable by discovery; those rows and their reason are already recorded.
      } else if (conditions?.hierarchicalAliasFixture !== true) {
        graphNotRun(
          ["write.alias-put", "write.alias-delete"],
          "No explicit hierarchical alias fixture condition; alias subjourney is not run",
        );
      } else {
        const putPassed = await graphStep("write.alias-put", async () => {
          requireDetail();
          let base;
          try {
            base = new URL(aliases);
          } catch {
            throw new NotRun(
              "Advertised alias base does not fit the requested hierarchical fixture",
            );
          }
          if (
            base.search ||
            base.hash ||
            base.origin !== scope.origin ||
            !base.pathname.startsWith(scope.pathname)
          )
            throw new NotRun(
              "Advertised alias base does not fit the requested hierarchical fixture",
            );
          base.pathname = base.pathname.replace(/\/?$/, "/") + fixture.aliasLeaf;
          alias = base.href;
          await prepareBeads();
          await unused(alias);
          requireDetail();
          const originalPut = { alias, target: beads[0].id };
          const reply = await post("putAlias", originalPut, `alias-first-${runId}`);
          if (
            reply.status === 404 &&
            json(reply, 404, "readProblem", "application/problem+json").code ===
              "resource-not-found"
          )
            throw new NotRun("Requested alias fixture namespace was not admitted");
          putResult = success(reply, "aliasResult");
          assert.deepEqual(putResult, { outcome: "created", alias, target: beads[0].id });
          await aliasAt(beads[0].id);
          assert.deepEqual(
            success(await post("putAlias", originalPut, `alias-same-${runId}`), "aliasResult"),
            { outcome: "updated", alias, target: beads[0].id },
          );
          assert.deepEqual(
            success(
              await post("putAlias", { alias, target: beads[1].id }, `alias-repoint-${runId}`),
              "aliasResult",
            ),
            { outcome: "updated", alias, target: beads[1].id },
          );
          await aliasAt(beads[1].id);
          await aliasReplay("putAlias", originalPut, `alias-first-${runId}`, putResult);
          await aliasAt(beads[1].id);
          await unchangedBeads();
        });
        if (putPassed)
          await graphStep("write.alias-delete", async () => {
            requireDetail();
            const originalDelete = { alias };
            deleteResult = success(
              await post("deleteAlias", originalDelete, `alias-delete-${runId}`),
              "aliasResult",
            );
            assert.deepEqual(deleteResult, { outcome: "deleted", alias });
            await aliasAbsent();
            assert.deepEqual(
              success(
                await post("putAlias", { alias, target: beads[2].id }, `alias-reuse-${runId}`),
                "aliasResult",
              ),
              { outcome: "created", alias, target: beads[2].id },
            );
            await aliasReplay("deleteAlias", originalDelete, `alias-delete-${runId}`, deleteResult);
            await aliasAt(beads[2].id);
            assert.deepEqual(
              success(
                await post("deleteAlias", originalDelete, `alias-final-${runId}`),
                "aliasResult",
              ),
              deleteResult,
            );
            await aliasAbsent();
            await unchangedBeads();
          });
        else
          graphNotRun(
            ["write.alias-delete"],
            "Alias put prerequisite did not complete; remaining alias subjourney is not run",
          );
      }
      // An excepted update need not have happened, so the Link's last live state is either one.
      const linkUpdateExcepted = exceptions?.["write.link-update"] !== undefined;
      if (
        rows.find((row) => row.id === "write.link-update").state === "pass" ||
        (linkUpdateExcepted && linkCreated !== undefined)
      )
        await graphStep("write.link-delete", async () => {
          const live = (linkUpdated ?? linkCreated).resource;
          const result = success(
            await post(
              "deleteLink",
              { link: linkId, expectedRevision: live.revision },
              `link-delete-${runId}`,
            ),
          );
          assert.equal(result.outcome, "deleted");
          assert.equal(result.changed, true);
          assert.deepEqual(result.deleted, {
            resourceKind: "link",
            resource: {
              id: linkId,
              type: linkType,
              revision: live.revision,
            },
          });
          assert.equal(result.ownerRevisions, undefined);
          const absent = await exchange(routes, linkId);
          assert([404, 410].includes(absent.status));
          const problem = json(absent, absent.status, "readProblem", "application/problem+json");
          assert(
            absent.status === 404
              ? problem.code === "resource-not-found"
              : ["resource-pruned", "resource-erased"].includes(problem.code),
          );
          await unchangedBeads();
        });
    }
    // Optional profiles the Scope may advertise. Their own rows; never a Core or Write row.
    report.optional = await runOptionalRows({
      scope: scope.href,
      discovered,
      runId,
      allowMutation,
      witnesses,
      exceptions,
      exchange: (target, method, value, key, options) =>
        exchange(routes, target, method, value, key, options),
    });
  } catch (error) {
    if (!(error instanceof Stop)) {
      if (provisionEntered && lifecycle.provision !== "pass") lifecycle.provision = "harness-error";
      report.harnessFailure =
        error instanceof HarnessError
          ? error.message
          : lifecycle.provision === "pass"
            ? "Post-provision suite or fixture failed"
            : provisionEntered
              ? "Adapter provisioning failed"
              : "Suite initialization failed";
    }
  } finally {
    if (typeof cleanup === "function") {
      try {
        await cleanup.call(provider);
        lifecycle.cleanup = "pass";
      } catch {
        lifecycle.cleanup = "harness-error";
        report.cleanupFailure = "Adapter cleanup failed; operator must inspect its owned resources";
      }
    } else if (provider !== undefined) lifecycle.cleanup = "harness-error";
  }
  // The ledger's precedent: the row ran, `observed` keeps what happened, and it is never a pass.
  for (const row of rows) {
    const why = exceptions?.[row.id];
    if (why === undefined || !exceptableWriteRows.includes(row.id)) continue;
    row.observed = row.state;
    if (row.reason !== undefined) row.observedReason = row.reason;
    row.state = "excepted";
    row.reason = why;
  }
  const implemented = rows.slice(0, definitions.length);
  report.sliceComplete =
    implemented.every(
      (row) => row.state === "pass" || (row.state === "not-applicable" && isWriteRowId(row.id)),
    ) &&
    lifecycle.provision === "pass" &&
    lifecycle.cleanup === "pass";
  report.qualificationComplete = hasCompleteRequiredCoverage(rows, lifecycle);
  report.state =
    report.harnessFailure !== undefined ||
    lifecycle.provision === "harness-error" ||
    lifecycle.cleanup === "harness-error" ||
    rows.some((row) => row.state === "harness-error") ||
    report.optional?.some((row) => row.state === "harness-error")
      ? "harness-error"
      : rows.some((row) => row.state === "fail") ||
          report.optional?.some((row) => row.state === "fail")
        ? "fail"
        : "incomplete";
  return report;
}

const USAGE =
  "Usage: current-provider-kit.mjs --provider /absolute/adapter.mjs\n" +
  "       current-provider-kit.mjs --scope SCOPE_URL [--token-env NAME] [--allow-mutation] [--recipe /absolute/recipe.json]\n" +
  "Either form also takes --exceptions /absolute/ledger.json\n";
/** Null on misuse. A token comes only from a named environment variable, never argv. */
export function parseKitArguments(argvWithLedger, env = {}) {
  const ledgerAt = argvWithLedger.indexOf("--exceptions");
  const argv =
    ledgerAt < 0
      ? argvWithLedger
      : argvWithLedger.filter((_, index) => index !== ledgerAt && index !== ledgerAt + 1);
  const ledger = ledgerAt < 0 ? undefined : argvWithLedger[ledgerAt + 1];
  if (ledgerAt >= 0 && (ledger === undefined || !path.isAbsolute(ledger))) return null;
  const parsed = parseSelection(argv, env);
  return parsed === null || ledger === undefined ? parsed : { ...parsed, ledger };
}
function parseSelection(argv, env) {
  if (argv.length === 2 && argv[0] === "--provider" && path.isAbsolute(argv[1]))
    return { provider: argv[1] };
  if (argv[0] !== "--scope" || argv.length < 2) return null;
  let scope;
  try {
    scope = new URL(argv[1]);
  } catch {
    return null;
  }
  if (
    !["http:", "https:"].includes(scope.protocol) ||
    !scope.pathname.endsWith("/") ||
    scope.search ||
    scope.hash ||
    scope.username ||
    scope.password ||
    scope.href !== argv[1]
  )
    return null;
  const parsed = { scope: scope.href, allowMutation: false };
  for (let index = 2; index < argv.length; index++) {
    if (argv[index] === "--allow-mutation" && !parsed.allowMutation) parsed.allowMutation = true;
    else if (argv[index] === "--token-env" && parsed.authorization === undefined) {
      const token = env[argv[++index] ?? ""];
      if (typeof token !== "string" || !token) return null;
      parsed.authorization = `Bearer ${token}`;
    } else if (argv[index] === "--recipe" && parsed.recipe === undefined) {
      const file = argv[++index];
      if (file === undefined || !path.isAbsolute(file)) return null;
      parsed.recipe = file;
    } else return null;
  }
  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parsed = parseKitArguments(process.argv.slice(2), process.env);
  if (parsed === null) {
    process.stderr.write(USAGE);
    process.exit(64);
  }
  let provision;
  if (parsed.scope !== undefined)
    provision = directScopeProvider(parsed.scope, parsed.authorization);
  else
    try {
      ({ provision } = await import(pathToFileURL(parsed.provider).href));
    } catch (error) {
      const category =
        error?.code === "ERR_MODULE_NOT_FOUND"
          ? "not-found"
          : error instanceof SyntaxError
            ? "syntax"
            : "module";
      provision = async () => {
        throw new HarnessError(`Selected provider module did not load (${category})`);
      };
    }
  let exceptions;
  if (parsed.ledger !== undefined)
    try {
      // { "IT-11": "why", ... }: a row excepted here is reported excepted, whatever it did.
      exceptions = JSON.parse(await readFile(parsed.ledger, "utf8"));
      if (
        exceptions === null ||
        typeof exceptions !== "object" ||
        Array.isArray(exceptions) ||
        Object.values(exceptions).some((why) => typeof why !== "string" || !why)
      )
        throw new TypeError("ledger shape");
    } catch {
      process.stderr.write("The exceptions ledger must be an object of row to reason\n");
      process.exit(64);
    }
  let recipe, recipeFailure;
  if (parsed.recipe !== undefined) {
    let text;
    try {
      text = await readFile(parsed.recipe, "utf8");
      recipe = JSON.parse(text);
    } catch {
      recipeFailure =
        text === undefined
          ? "The recipe is refused: its file could not be read"
          : "The recipe is refused: its file is not JSON";
    }
  }
  const report = await runCurrentProvider(provision, {
    ...(parsed.scope === undefined ? {} : { allowMutation: parsed.allowMutation }),
    ...(exceptions === undefined ? {} : { exceptions }),
    ...(recipe === undefined ? {} : { recipe }),
    ...(recipeFailure === undefined ? {} : { recipeFailure }),
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.state === "harness-error" ? 3 : report.state === "fail" ? 1 : 2;
}
