import { request as nodeRequest, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as disconnect from "./node-http-disconnect.js";
import * as schemaHttp from "./transaction-schema-http.js";
import { compileDevelopmentContracts } from "./development-contracts.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { startTransactionRuntime } from "./transaction-runtime.js";

const scope = "https://schema.invalid/acme/",
  type = `${scope}types/task`,
  root = `${scope}schemas/root`,
  ref = `${scope}schemas/value`;
const rootBytes = `{\n "$id": "${root}", "type": "object", "properties": {"title": {"$ref": "value"}}, "required": ["title"], "additionalProperties": false\n}\n`;
const refBytes = `{ "$id": "${ref}", "description": "café", "type": "string", "minLength": 1e0 }\n`;
const descriptor = (schema = root) => ({
  id: type,
  name: "Task",
  describes: "bead",
  conformsTo: [],
  propertiesSchema: schema,
});
const token = "s".repeat(32);
const authorized = { kind: "authenticated", principal: "p", canMutate: false } as const;
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  try {
    for (const fn of cleanup.splice(0).reverse()) {
      try {
        await fn();
      } catch (error) {
        failures.push(error);
      }
    }
  } finally {
    try {
      vi.restoreAllMocks();
    } catch (error) {
      failures.push(error);
    }
  }
  // Vitest retains a prior test failure separately from this hook failure.
  if (failures.length) throw new AggregateError(failures, "schema fixture cleanup failed");
});
function artifacts(
  retrieval = root,
  canonical = retrieval,
  dependency = new URL("value", canonical).href,
) {
  return {
    descriptors: [{ retrievalUri: type, utf8: JSON.stringify(descriptor(retrieval)) }],
    schemas: [
      { retrievalUri: retrieval, utf8: rootBytes.replace(root, canonical) },
      { retrievalUri: dependency, utf8: refBytes.replace(ref, dependency) },
    ],
    limits: CONTRACT_ARTIFACT_CEILINGS,
  };
}
function compile(input = artifacts()) {
  return compileDevelopmentContracts({
    descriptors: input.descriptors.map((e) => ({
      retrievalUri: e.retrievalUri,
      utf8Bytes: Buffer.from(e.utf8),
    })),
    schemas: input.schemas.map((e) => ({
      retrievalUri: e.retrievalUri,
      utf8Bytes: Buffer.from(e.utf8),
    })),
    limits: input.limits,
  });
}
async function runtime(input = artifacts()) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-schema-http-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const service = await startTransactionRuntime({
    scope,
    authorityMode: "canonical",
    directory,
    create: true,
    port: 0,
    artifacts: input,
    credentials: [{ token, principal: "p", canMutate: true }],
  });
  cleanup.push(() => service.close());
  return service;
}
function wire(
  service: Awaited<ReturnType<typeof runtime>>,
  url: string,
  method = "GET",
  headers: Record<string, string> = {},
  body?: string,
) {
  return new Promise<{
    status: number;
    headers: import("node:http").IncomingHttpHeaders;
    text: string;
  }>((resolve, reject) => {
    const target = new URL(url),
      address = new URL(service.listenUrl);
    const req = nodeRequest(
      {
        hostname: address.hostname,
        port: address.port,
        path: target.pathname + target.search,
        method,
        headers: { host: target.host, authorization: `Bearer ${token}`, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.setTimeout(5000, () => req.destroy(new Error("schema source exchange timeout")));
    req.on("error", reject);
    req.end(body);
  });
}
function commit(service: Awaited<ReturnType<typeof runtime>>, title = "café") {
  return wire(
    service,
    `${scope}operations/create-bead`,
    "POST",
    { "content-type": "application/json", "idempotency-key": "create" },
    JSON.stringify({ id: "beads/a", type, properties: { title } }),
  );
}
it("serves exact captured root and transitive bytes without retaining mutable input", async () => {
  const input = artifacts(),
    contracts = compile(input);
  input.schemas[0]!.utf8 = "mutated";
  const context = Object.freeze({
    scopeEpoch: "epoch",
    authorizationView: "view",
    scopePosition: "pos-0",
  });
  const observe = vi.fn(async () => Object.freeze({ context }));
  const select = schemaHttp.createTransactionSchemaHttp(scope, contracts, observe);
  for (const [url, bytes] of [
    [root, rootBytes],
    [ref, refBytes],
  ]) {
    const selected = await select(new Request(url!), authorized);
    expect(
      selected?.response.status,
      url === root ? "known root status" : "referenced document status",
    ).toBe(200);
    expect(selected?.raw, "exact captured schema bytes").toBe(bytes);
    expect(selected?.response.headers.get("content-length")).toBe(
      String(Buffer.byteLength(bytes!)),
    );
    expect(selected?.response.headers.has("etag")).toBe(false);
  }
  expect(observe).toHaveBeenCalledTimes(2);
});
it("applies selection once and retains exact byte length and current context", async () => {
  const original = schemaHttp.createTransactionSchemaHttp;
  let observations = 0;
  vi.spyOn(schemaHttp, "createTransactionSchemaHttp").mockImplementation(
    (scope, contracts, observe) =>
      original(scope, contracts, () => {
        observations++;
        return observe();
      }),
  );
  const service = await runtime();
  const before = await wire(service, root);
  expect(before.status, "known root status").toBe(200);
  expect(before.text, "exact captured schema bytes").toBe(rootBytes);
  expect(before.headers["bdp-scope-position"]).toBe("pos-0");
  const transitive = await wire(service, ref);
  expect(transitive.status, "referenced document status").toBe(200);
  expect(transitive.text).toBe(refBytes);
  for (const [method, headers, status] of [
    ["HEAD", {}, 200],
    ["GET", { accept: "text/plain" }, 406],
    ["GET", { "if-none-match": "*" }, 304],
    ["GET", { "if-match": '"missing"' }, 412],
  ] as const) {
    const response = await wire(service, root, method, headers);
    expect(response.status).toBe(status);
    expect(response.text).toBe("");
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    expect(response.headers["bdp-scope-position"]).toBe("pos-0");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.vary).toBe("Accept");
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers["last-modified"]).toBeUndefined();
    expect(response.headers["content-type"]).toBe(status === 200 ? "application/json" : undefined);
    expect(response.headers["content-length"]).toBe(
      status === 200 ? String(Buffer.byteLength(rootBytes)) : status === 304 ? undefined : "0",
    );
  }
  const mutation = await commit(service);
  expect(mutation.status).toBe(200);
  const after = await wire(service, root);
  expect(after.status).toBe(200);
  expect(after.text).toBe(rootBytes);
  expect(after.headers["bdp-scope-position"], "current schema position").toBe("pos-1");
  expect(after.headers["bdp-scope-epoch"]).toBe(before.headers["bdp-scope-epoch"]);
  expect(before.headers["bdp-scope-position"]).toBe("pos-0");
  expect(observations).toBe(7);
});
const minimumCases: Record<string, string>[] = [
  { "bdp-minimum-scope-position": "pos-0" },
  { "bdp-scope-epoch": "epoch" },
  { "bdp-authorization-view": "view" },
  { "bdp-minimum-scope-position": "" },
  { "bdp-scope-epoch": "" },
  { "bdp-authorization-view": "" },
  {
    "bdp-minimum-scope-position": "pos-0",
    "bdp-scope-epoch": "epoch",
    "bdp-authorization-view": "view",
  },
  { "bdp-minimum-scope-position": "bad", "bdp-scope-epoch": "epoch" },
  { "bdp-minimum-scope-position": "pos-0, pos-1" },
  { "bdp-minimum-scope-position": "", "if-none-match": "*" },
  { "bdp-scope-epoch": "bad", "if-match": '"missing"' },
];
it("preserves minimum refusals before schema conditionals and never observes excluded requests", async () => {
  const observe = vi.fn(async () => ({
    context: { scopeEpoch: "e", authorizationView: "v", scopePosition: "pos-0" },
  }));
  const select = schemaHttp.createTransactionSchemaHttp(scope, compile(), observe);
  const original = schemaHttp.createTransactionSchemaHttp;
  let actualObservations = 0;
  vi.spyOn(schemaHttp, "createTransactionSchemaHttp").mockImplementation(
    (scope, contracts, observe) =>
      original(scope, contracts, () => {
        actualObservations++;
        return observe();
      }),
  );
  const service = await runtime();
  for (const headers of minimumCases) {
    const response = await wire(service, root, "GET", headers);
    const complete =
      headers["bdp-minimum-scope-position"] === "pos-0" &&
      headers["bdp-scope-epoch"] === "epoch" &&
      headers["bdp-authorization-view"] === "view";
    expect(response.status, "preserved minimum refusal").toBe(complete ? 500 : 400);
    expect(await select(new Request(root, { headers }), authorized)).toBeUndefined();
    expect(response.headers["x-bdp-development-limit"]).toBe(
      complete ? "minimum-position-route" : undefined,
    );
    if (complete) expect(response.text).toBe("");
    else
      expect(JSON.parse(response.text)).toMatchObject({
        status: 400,
        code: "malformed-request",
        retry: "never",
      });
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(response.headers[name]).toBeUndefined();
  }
  for (const headers of [
    { accept: "text/plain" },
    { "if-none-match": "*" },
    { "if-match": '"missing"' },
  ]) {
    expect(
      await select(new Request(root, { headers }), { kind: "unauthenticated" }),
    ).toBeUndefined();
    expect(
      (await wire(service, root, "GET", { ...headers, authorization: "Bearer wrong" })).status,
    ).toBe(401);
  }
  expect((await wire(service, root, "GET", { origin: "https://other.invalid" })).status).toBe(403);
  const method = await wire(service, root, "POST", {
    authorization: "Bearer wrong",
    origin: "https://other.invalid",
  });
  expect(method.status).toBe(405);
  expect(method.text).toBe("");
  expect(method.headers.allow).toBe("GET, HEAD");
  for (const url of [
    root + "?x=1",
    root + "/",
    `${scope}schemas/unknown`,
    "https://external.invalid/schema",
    type,
  ])
    expect(await select(new Request(url), authorized)).toBeUndefined();
  expect(await select(new Request(root, { method: "POST" }), authorized)).toBeUndefined();
  expect(observe).not.toHaveBeenCalled();
  expect(actualObservations).toBe(0);
});
it.each([
  ["differing-id", root, `${scope}canonical/root`],
  ["outside-namespace", `${scope}beads/a`, `${scope}beads/a`],
  ["query-retrieval", root + "?edition=1", root + "?edition=1"],
])(
  "preserves accepted offline configuration and unserved aliases: %s",
  async (_name, retrieval, canonical) => {
    const input = artifacts(retrieval!, canonical!);
    const service = await runtime(input);
    const admitted = await commit(service);
    expect(admitted.status).toBe(200);
    expect(JSON.parse(admitted.text).status).toBe("completed");
    const rejected = await wire(
      service,
      `${scope}operations/create-bead`,
      "POST",
      { "content-type": "application/json", "idempotency-key": "invalid" },
      JSON.stringify({ id: "beads/invalid", type, properties: { title: 2 } }),
    );
    expect(rejected.status).toBe(200);
    expect(JSON.parse(rejected.text).status).toBe("failed");
    const observe = vi.fn(async () => ({
      context: { scopeEpoch: "e", authorizationView: "v", scopePosition: "pos-1" },
    }));
    const select = schemaHttp.createTransactionSchemaHttp(scope, compile(input), observe);
    if (_name === "differing-id") {
      const served = await wire(service, retrieval!);
      expect(served.status).toBe(200);
      expect(served.text).toBe(input.schemas[0]!.utf8);
      expect(await select(new Request(canonical!), authorized)).toBeUndefined();
      // Canonical identity/reference base remains valid offline but is not a retrieval alias.
      expect((await wire(service, canonical!)).status).toBe(404);
      expect(
        await select(new Request(new URL("value", canonical!).href), authorized),
      ).toBeUndefined();
      expect((await wire(service, new URL("value", retrieval!).href)).status).toBe(404);
    } else {
      expect(await select(new Request(retrieval!), authorized)).toBeUndefined();
      const response = await wire(service, retrieval!);
      expect(response.status).toBe(_name === "outside-namespace" ? 200 : 404);
      if (_name === "outside-namespace")
        expect(JSON.parse(response.text)).toMatchObject({
          id: `${scope}beads/a`,
          properties: { title: "café" },
        });
    }
    expect(observe).not.toHaveBeenCalled();
  },
);
it("discards a disconnected schema delivery and leaves the runtime usable", async () => {
  const original = schemaHttp.createTransactionSchemaHttp;
  let release!: () => void, observed!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const entered = new Promise<void>((r) => {
    observed = r;
  });
  let held = false;
  vi.spyOn(schemaHttp, "createTransactionSchemaHttp").mockImplementation((...args) => {
    const select = original(...args);
    return async (...input) => {
      const result = await select(...input);
      if (result && !held) {
        held = true;
        observed();
        await gate;
      }
      return result;
    };
  });
  const originalDisconnect = disconnect.createNodeHttpDisconnectSignal;
  let disconnected!: () => void;
  const sawDisconnect = new Promise<void>((r) => {
    disconnected = r;
  });
  vi.spyOn(disconnect, "createNodeHttpDisconnectSignal").mockImplementation((...args) => {
    const signal = originalDisconnect(...args);
    signal.addEventListener("abort", disconnected, { once: true });
    return signal;
  });
  const service = await runtime();
  const writes = vi.spyOn(ServerResponse.prototype, "writeHead");
  const address = new URL(service.listenUrl);
  const req = nodeRequest({
    hostname: address.hostname,
    port: address.port,
    path: new URL(root).pathname,
    headers: { host: "schema.invalid", authorization: `Bearer ${token}` },
  });
  req.on("error", () => {});
  req.end();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("schema disconnect barrier timeout")), 5000);
  });
  try {
    await Promise.race([entered, deadline]);
    req.destroy();
    await new Promise<void>((r) => (req.closed ? r() : req.once("close", r)));
    await Promise.race([sawDisconnect, deadline]);
    release();
    await new Promise<void>((r) => setImmediate(r));
    expect(writes).not.toHaveBeenCalled();
    expect((await wire(service, root, "HEAD")).text).toBe("");
  } finally {
    clearTimeout(timer);
    req.destroy();
    release();
  }
}, 10000);

it("sanitizes a selected schema observation fault without stale response metadata", async () => {
  const original = schemaHttp.createTransactionSchemaHttp;
  const cause = new Error("private owner failure");
  vi.spyOn(schemaHttp, "createTransactionSchemaHttp").mockImplementation((scope, contracts) =>
    original(scope, contracts, async () => {
      throw cause;
    }),
  );
  const service = await runtime();
  const response = await wire(service, root);
  expect(response.status).toBe(500);
  expect(response.text).toBe("");
  expect(response.headers["content-length"]).toBe("0");
  expect(response.headers["content-type"]).toBeUndefined();
  expect(response.headers["x-bdp-development"]).toBe("non-attesting");
  for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
    expect(response.headers[name]).toBeUndefined();
});
