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
  ["write.create", `${write}#ordinary-results`],
  ["core.point-read", `${core}#read-a-bead-or-link`],
  ["write.no-op", `${write}#covered-state-and-no-ops`],
  ["write.guard-failure", `${write}#ordinary-requests`],
  ["write.effectful-update", `${write}#object-edits-and-endpoint-corrections`],
  ["write.delete", `${write}#ordinary-results`],
  ["write.restart", `${write}#atomic-durability-crash-and-capability-changes`],
  ["write.durable-original-success", `${write}#claims-and-terminal-outcomes`],
  ["write.durable-original-failure", `${write}#claims-and-terminal-outcomes`],
  ["write.durable-original-delete", `${write}#claims-and-terminal-outcomes`],
  ["core.deleted-absence", `${core}#reads-after-deletion`],
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
    reason: "Incident directions, alias redirects and their read metadata are not implemented.",
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
    reason: "Link CRUD and alias put/delete are discovered but not executed.",
  },
  {
    id: "write.identity-and-admission",
    source: `${write}#admission-authorization-and-limits`,
    reason:
      "Allocation collisions, complete request/media/key admission, bounds and numeric cases are not implemented.",
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
class HarnessError extends Error {}
class Stop extends Error {}
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
function exchange(routes, target, method = "GET", value, key) {
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
          accept: media,
          ...(route.authorization === undefined ? {} : { authorization: route.authorization }),
          ...(text === undefined
            ? {}
            : {
                "content-type": media,
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
    req.on("error", () => {
      clearTimeout(timer);
      reject(new HarnessError("Public HTTP exchange did not complete"));
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
  async function step(id, action) {
    const row = rows.find((entry) => entry.id === id);
    try {
      await action();
      row.state = "pass";
      delete row.reason;
    } catch (error) {
      row.state = error instanceof AssertionError ? "fail" : "harness-error";
      row.reason =
        error instanceof AssertionError
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
    function success(reply) {
      const value = json(reply, 200, "mutationResult");
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
      minimumDetailWindowMs: 60000,
    });
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
        : fields(provider.conditions, ["retainedDetailWindowMs"], ["retainedDetailWindowMs"]);
    if (
      conditions &&
      (!Number.isSafeInteger(conditions.retainedDetailWindowMs) ||
        conditions.retainedDetailWindowMs < fixture.minimumDetailWindowMs)
    )
      throw new HarnessError(
        "Adapter retained-detail condition is below the requested fixture window",
      );
    let retentionStart;
    lifecycle.provision = "pass";
    let discoveryUrl, directory, created, failed, updated, deleted;
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
    await step("core.scope-discovery", async () => {
      const reply = await exchange(routes, scope.href);
      assert([200, 204].includes(reply.status));
      const links = parseLinkHeader(reply.headers.link ?? "").filter((entry) =>
        entry.parameters.some(
          (parameter) =>
            parameter.name.toLowerCase() === "rel" &&
            parameter.value.split(/\s+/).includes("service-desc"),
        ),
      );
      assert(links.length > 0, "Scope omitted its required service-desc Link");
      const typed = links.filter((entry) =>
        entry.parameters.some(
          (parameter) => parameter.name.toLowerCase() === "type" && parameter.value === media,
        ),
      );
      const selected = typed.length === 1 ? typed[0] : links.length === 1 ? links[0] : undefined;
      if (!selected)
        throw new HarnessError("Kit cannot select one discovery Link among available candidates");
      discoveryUrl = new URL(selected.target, scope).href;
    });
    await step("write.discovery-directory", async () => {
      const discovery = json(await exchange(routes, discoveryUrl), 200, "writeDiscovery");
      assert.equal(discovery.bdpVersion, "0.1");
      assert.equal(discovery.profile, "write");
      assert.equal(discovery.scope, scope.href);
      directory = json(
        await exchange(routes, discovery.operations),
        200,
        "writeOperationDirectory",
      );
      assert.deepEqual(
        Object.keys(directory).sort(),
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
      assert.equal(new Set(Object.values(directory)).size, 8);
    });
    await step("write.create", async () => {
      retentionStart = performance.now();
      created = success(await post("createBead", create, createKey));
      assert.equal(created.outcome, "created");
      assert.equal(created.changed, true);
      assert.equal(created.resource.id, id);
      assert.equal(created.resource.type, fixture.type);
      assert.deepEqual(created.resource.properties, create.properties);
      assert.deepEqual(created.resource.metadata, create.metadata);
      assert.equal(typeof created.resource.revision, "string");
      assert.notEqual(created.resource.revision, "");
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
          { ...update, properties: create.properties, expectedRevision: created.resource.revision },
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
      performance.now() - retentionStart >= conditions.retainedDetailWindowMs
    ) {
      rows.find((row) => row.id === "write.restart").reason = !provider.restart
        ? "No explicit adapter restart hook; durable Write slice is not run"
        : "No current explicit retained-detail fixture window; durable Write slice is not run";
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
  } catch (error) {
    if (!(error instanceof Stop)) {
      lifecycle.provision = "harness-error";
      report.harnessFailure =
        error instanceof HarnessError
          ? error.message
          : "Adapter provisioning or suite initialization failed";
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
  report.state =
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
  assert.equal(
    process.argv.length,
    4,
    "Usage: current-provider-kit.mjs --provider /absolute/adapter.mjs",
  );
  assert.equal(process.argv[2], "--provider");
  assert(path.isAbsolute(process.argv[3]), "Provider module path must be absolute");
  let provision;
  try {
    ({ provision } = await import(pathToFileURL(process.argv[3]).href));
  } catch {
    provision = async () => {
      throw new HarnessError("Selected provider module did not load");
    };
  }
  const report = await runCurrentProvider(provision);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.state === "harness-error" ? 3 : report.state === "fail" ? 1 : 2;
}
