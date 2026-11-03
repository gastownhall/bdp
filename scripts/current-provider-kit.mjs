/** Incomplete current-contract provider slice. Adapters provision; assertions live here. */
import assert, { AssertionError } from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
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
  ["write.discovery-directory", `${write}#discover-and-select-write`],
  ["write.media-before-admission", `${write}#contract-and-media`],
  ["write.create", `${write}#ordinary-results`],
  ["core.point-read", `${core}#read-a-bead-or-link`],
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
      "Inventory traversal, continuation, authorization binding and frozen-selection cases are not implemented.",
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
      "Unowned local Link CRUD and alias lifecycle/replay have narrow witnesses; remaining malformed, authorization, identity, owned-state and recovery variants are not implemented.",
  },
  {
    id: "write.identity-and-admission",
    source: `${write}#admission-authorization-and-limits`,
    reason:
      "Allocation collisions, remaining request/media/key admission variants, bounds and numeric cases are not implemented. The single generic-JSON 415 witness below is partial coverage only.",
  },
  {
    id: "write.authorization-and-owned-state",
    source: `${write}#owned-state-effects`,
    reason:
      "Retained disclosure, authorization changes, protected Type/native constraints and owner effects are not implemented.",
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
  "write.discovery-directory",
  "write.media-before-admission",
  "write.create",
  "core.point-read",
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
  "write.authorization-and-owned-state",
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
class HarnessError extends Error {}
class Stop extends Error {}
class NotRun extends Error {}

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
  { contentType = media, accept = media } = {},
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
  const text = value === undefined ? undefined : JSON.stringify(value);
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
                "content-type": contentType,
                "content-length": String(Buffer.byteLength(text)),
                "idempotency-key": key,
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

/** Local trusted adapter module contract; no expected answers or custom validators. */
export async function runCurrentProvider(provision) {
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
    lifecycle,
    obligations: rows,
  };
  let provider, cleanup;
  let provisionEntered = false;
  async function step(id, action) {
    const row = rows.find((entry) => entry.id === id);
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
            ? `Public assertion failed for ${id}`
            : error instanceof HarnessError
              ? error.message
              : "Harness/provider lifecycle or transport did not complete";
      throw new Stop();
    }
  }
  try {
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
      ["scope", "connections", "conditions", "restart", "cleanup"],
      ["scope", "connections", "cleanup"],
    );
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
              "unownedLinkFixture",
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
    let discoveryUrl, directory, aliases, created, failed, updated, deleted;
    const id = new URL(fixture.id, scope).href;
    const create = {
      id: fixture.id,
      type: fixture.type,
      properties: { title: "portable original" },
      metadata: { source: "provider-kit" },
    };
    const createKey = `create-${runId}`,
      failureKey = `guard-${runId}`,
      deleteKey = `delete-${runId}`;
    const update = { bead: id, properties: { title: "portable updated" } };
    const remove = { bead: id };
    const post = (operation, body, key) =>
      exchange(routes, directory[operation], "POST", body, key);
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
    async function readNavigation(description) {
      const discovery = json(await exchange(routes, description), 200, "writeDiscovery");
      assert.equal(discovery.bdpVersion, "0.1");
      assert.equal(discovery.profile, "write");
      assert.equal(discovery.scope, scope.href);
      const nextAliases = discovery.aliases;
      const nextDirectory = json(
        await exchange(routes, discovery.operations),
        200,
        "writeOperationDirectory",
      );
      assert.deepEqual(
        Object.keys(nextDirectory).sort(),
        [
          "createBead",
          "updateBead",
          "deleteBead",
          "createLink",
          "updateLink",
          "deleteLink",
          "putAlias",
          "deleteAlias",
        ].sort(),
      );
      assert.equal(new Set(Object.values(nextDirectory)).size, 8);
      return { directory: nextDirectory, aliases: nextAliases };
    }
    async function baseJourney() {
      await step("core.scope-discovery", async () => {
        discoveryUrl = await scopeDescription();
      });
      await step("write.discovery-directory", async () => {
        ({ directory, aliases } = await readNavigation(discoveryUrl));
      });
      await step("write.media-before-admission", async () => {
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
        assert.equal(created.resource.id, id);
        assert.equal(created.resource.type, fixture.type);
        assert.deepEqual(created.resource.properties, create.properties);
        assert.deepEqual(created.resource.metadata, create.metadata);
        assert.equal(typeof created.resource.revision, "string");
        assert.notEqual(created.resource.revision, "");
        assert.deepEqual(success(await post("createBead", create, createKey)), created);
      });
      await step("core.point-read", async () => {
        const reply = await exchange(routes, id);
        assert.equal(reply.headers["bdp-resource-kind"], "bead");
        assert.deepEqual(json(reply, 200, "currentBeadRecord"), created.resource);
      });
      await step("write.no-op", async () => {
        const reply = success(
          await post(
            "updateBead",
            {
              ...update,
              properties: create.properties,
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
      const guarded = { ...update, expectedRevision: badGuard };
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
            { ...update, expectedRevision: created.resource.revision },
            `update-${runId}`,
          ),
        );
        assert.equal(updated.outcome, "updated");
        assert.equal(updated.changed, true);
        assert.notEqual(updated.resource.revision, created.resource.revision);
        assert.deepEqual(updated.resource.properties, update.properties);
        assert.deepEqual(updated.resource.metadata, create.metadata);
      });
      await step("write.delete", async () => {
        deleted = success(await post("deleteBead", remove, deleteKey));
        assert.equal(deleted.outcome, "deleted");
        assert.equal(deleted.changed, true);
        assert.deepEqual(deleted.deleted, {
          resourceKind: "bead",
          resource: { id, type: fixture.type, revision: updated.resource.revision },
        });
      });
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
      await step("write.restart", async () => {
        const restarted = await provider.restart();
        fields(restarted, ["connections"], ["connections"]);
        routes = connections(restarted.connections);
      });
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
        const reply = await post("updateBead", guarded, failureKey);
        if (performance.now() - retentionStart >= conditions.retainedDetailWindowMs)
          throw new HarnessError("Retained-detail fixture window elapsed during replay");
        assert.deepEqual(json(reply, 409, "readUpdateProblem", "application/problem+json"), failed);
      });
      await step("write.durable-original-delete", async () => {
        const reply = await post("deleteBead", remove, deleteKey);
        if (performance.now() - retentionStart >= conditions.retainedDetailWindowMs)
          throw new HarnessError("Retained-detail fixture window elapsed during replay");
        assert.deepEqual(success(reply), deleted);
      });
      await step("core.deleted-absence", async () => {
        const reply = await exchange(routes, id);
        assert([404, 410].includes(reply.status));
        const problem = json(reply, reply.status, "readProblem", "application/problem+json");
        assert(
          reply.status === 404
            ? problem.code === "resource-not-found"
            : ["resource-pruned", "resource-erased"].includes(problem.code),
        );
      });
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
      for (const name of names) rows.find((row) => row.id === name).reason = reason;
    };
    const baseFailed = rows.some(
      (row) => !graphRows.includes(row.id) && ["fail", "harness-error"].includes(row.state),
    );
    let graphConditionsValid = true;
    try {
      if (
        conditions?.graphRetainedDetailWindowMs !== undefined &&
        (!Number.isSafeInteger(conditions.graphRetainedDetailWindowMs) ||
          conditions.graphRetainedDetailWindowMs <= 0)
      )
        throw new HarnessError("Graph retained-detail condition must be a positive safe integer");
      for (const name of ["unownedLinkFixture", "hierarchicalAliasFixture"])
        if (conditions?.[name] !== undefined && typeof conditions[name] !== "boolean")
          throw new HarnessError("Adapter fixture condition must be boolean");
    } catch {
      graphConditionsValid = false;
      report.harnessFailure = "Graph fixture conditions are invalid";
    }
    const graphRequested =
      conditions?.unownedLinkFixture === true ||
      (conditions?.hierarchicalAliasFixture === true &&
        conditions.graphRetainedDetailWindowMs >= fixture.minimumGraphDetailWindowMs);
    let currentGraphNavigation = false;
    if (directory && !baseFailed && graphConditionsValid && graphRequested) {
      try {
        // Original frozen retries are complete; fresh work follows current discovery.
        ({ directory, aliases } = await readNavigation(await scopeDescription()));
        currentGraphNavigation = true;
      } catch (error) {
        report.harnessFailure =
          error instanceof HarnessError
            ? error.message
            : "Current graph discovery could not be established";
      }
    }
    if (!currentGraphNavigation) {
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
        if (!detailReady())
          throw new NotRun(
            "No current requested graph retained-detail window; remaining alias subjourney is not run",
          );
      };
      // Only this fixture setup is shared; aliases do not depend on Link ownership.
      const linkId = new URL(fixture.linkId, scope).href;
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
          for (const [index, local] of [fixture.graphSourceId, ...fixture.secondaryIds].entries()) {
            await unused(new URL(local, scope).href);
            const body = {
              id: local,
              type: fixture.type,
              properties: { title: "portable endpoint" },
              metadata: {},
            };
            const reply = await post("createBead", body, `graph-bead-${index}-${runId}`);
            if (reply.status !== 200)
              throw new NotRun("Requested graph Bead fixture could not be provisioned");
            try {
              const result = success(reply);
              assert.equal(result.outcome, "created");
              assert.equal(result.changed, true);
              assert.equal(result.resource.id, new URL(local, scope).href);
              assert.equal(result.resource.type, fixture.type);
              assert.deepEqual(result.resource.properties, body.properties);
              assert.deepEqual(result.resource.metadata, {});
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
      if (conditions?.unownedLinkFixture !== true) {
        graphNotRun(
          ["write.link-create", "write.link-update", "write.link-delete"],
          "No explicit unowned Link fixture condition; Link subjourney is not run",
        );
      } else {
        await graphStep("write.link-create", async () => {
          await prepareBeads();
          await unused(linkId);
          const body = {
            id: fixture.linkId,
            type: fixture.linkType,
            properties: { label: "portable relation" },
            metadata: { source: "provider-kit" },
            source: { uri: beads[0].id, revision: beads[0].revision },
            target: { uri: beads[1].id, revision: beads[1].revision },
          };
          linkCreated = success(await post("createLink", body, `link-create-${runId}`));
          assert.equal(linkCreated.outcome, "created");
          assert.equal(linkCreated.changed, true);
          assert.equal(linkCreated.resource.id, linkId);
          for (const field of ["type", "properties", "metadata", "source", "target"])
            assert.deepEqual(linkCreated.resource[field], body[field]);
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
        requireDetail();
        const reply = await post(operation, body, key);
        if (!detailReady())
          throw new HarnessError(
            "Graph retained-detail fixture window elapsed during alias replay",
          );
        assert.deepEqual(success(reply, "aliasResult"), expected);
      };
      if (conditions?.hierarchicalAliasFixture !== true) {
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
      if (rows.find((row) => row.id === "write.link-update").state === "pass")
        await graphStep("write.link-delete", async () => {
          const result = success(
            await post(
              "deleteLink",
              { link: linkId, expectedRevision: linkUpdated.resource.revision },
              `link-delete-${runId}`,
            ),
          );
          assert.equal(result.outcome, "deleted");
          assert.equal(result.changed, true);
          assert.deepEqual(result.deleted, {
            resourceKind: "link",
            resource: {
              id: linkId,
              type: fixture.linkType,
              revision: linkUpdated.resource.revision,
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
  const implemented = rows.slice(0, definitions.length);
  report.sliceComplete =
    implemented.every((row) => row.state === "pass") &&
    lifecycle.provision === "pass" &&
    lifecycle.cleanup === "pass";
  report.qualificationComplete = hasCompleteRequiredCoverage(rows, lifecycle);
  report.state =
    report.harnessFailure !== undefined ||
    lifecycle.provision === "harness-error" ||
    lifecycle.cleanup === "harness-error" ||
    rows.some((row) => row.state === "harness-error")
      ? "harness-error"
      : rows.some((row) => row.state === "fail")
        ? "fail"
        : "incomplete";
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (
    process.argv.length !== 4 ||
    process.argv[2] !== "--provider" ||
    !path.isAbsolute(process.argv[3])
  ) {
    process.stderr.write("Usage: current-provider-kit.mjs --provider /absolute/adapter.mjs\n");
    process.exit(64);
  }
  let provision;
  try {
    ({ provision } = await import(pathToFileURL(process.argv[3]).href));
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
  const report = await runCurrentProvider(provision);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.state === "harness-error" ? 3 : report.state === "fail" ? 1 : 2;
}
