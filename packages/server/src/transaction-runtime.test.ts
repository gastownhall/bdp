import { createHash } from "node:crypto";
import { request as authorizationHttpRequest } from "node:http";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaUri, isJsonSchemaDateTime, parseTypeDescriptor } from "@bdp/protocol";
import { recordRawSse } from "../test-support/raw-sse-recorder.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import { afterEach, expect, it } from "vitest";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const token = "x".repeat(32),
  type = "https://example.test/process-bead";
it.each([
  { pages: false, compiled: false },
  { pages: true, compiled: false },
  { pages: true, compiled: true },
])(
  "reopens actual emitted HTTP service after abrupt process loss (pages=$pages compiled=$compiled)",
  async ({ pages, compiled }) => {
    const stableScope = "https://example.test/stable/pages/";
    const fixtureType = compiled ? `${stableScope}types/process` : type;
    const schema = "https://offline.invalid/process-properties";
    const types = [
      {
        id: fixtureType,
        name: "Process Bead",
        describes: "bead",
        conformsTo: [],
        ...(compiled ? { propertiesSchema: schema } : {}),
      },
    ];
    const artifacts = {
      descriptors: types.map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
      schemas: [
        {
          retrievalUri: schema,
          utf8: JSON.stringify({
            $id: schema,
            type: "object",
            required: ["n"],
            properties: { n: { type: "integer", minimum: 0 } },
          }),
        },
      ],
      limits: CONTRACT_ARTIFACT_CEILINGS,
    };
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-tx-http-process-"));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    async function start(create: boolean, port: number) {
      const runtime = new URL("../dist/transaction-runtime.js", import.meta.url).href;
      const options = {
        directory,
        ...(pages ? { scope: stableScope } : {}),
        create,
        port,
        ...(compiled ? { artifacts } : { types }),
        credentials: [{ token, principal: "operator", canMutate: true }],
      };
      const script = `import {startTransactionRuntime} from ${JSON.stringify(runtime)};const runtime=await startTransactionRuntime(${JSON.stringify(options)},${JSON.stringify({ receiptMaximumItems: 2 })});process.stdout.write(JSON.stringify({scope:runtime.scope,targets:runtime.targets,listenUrl:runtime.listenUrl})+'\\n');process.stdin.once('data',async()=>{await runtime.close();process.exit(0)});`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      const exited = once(child, "exit");
      void exited.catch(() => {});
      cleanup.push(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
      });
      const lines = createInterface({ input: child.stdout });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const line = await Promise.race([
        once(lines, "line").then(([line]) => String(line)),
        exited.then(() => {
          throw new Error(`child exited before ready: ${stderr}`);
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`child readiness timeout: ${stderr}`)), 5000);
        }),
      ]).finally(() => {
        clearTimeout(timeout);
        lines.close();
      });
      const ready = JSON.parse(line) as {
        scope: string;
        targets: { batch: string };
        listenUrl: string;
      };
      return { child, exited, ready };
    }
    const first = await start(true, 0);
    const text = JSON.stringify({
      operations: Array.from({ length: pages ? 5 : 1 }, (_, n) => ({
        operation: "createBead",
        id: `beads/b${n}`,
        type: fixtureType,
        ...(compiled ? { properties: { n } } : {}),
      })),
    });
    const wire = (url: string, ready: { listenUrl: string }) =>
      new URL(new URL(url).pathname, ready.listenUrl).href;
    const submit = (target: string) =>
      fetch(target, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "once",
        },
        body: text,
      });
    const original = await submit(wire(first.ready.targets.batch, first.ready));
    expect(original.status).toBe(200);
    const receipt = (await original.json()) as { id: string; next: string | null };
    if (pages) expect(receipt.next).toBeTruthy();
    let page: unknown;
    if (receipt.next) {
      const response = await fetch(wire(receipt.next, first.ready), {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      page = await response.json();
      expect(page).toMatchObject({
        receipt: receipt.id,
        results: [
          { operationIndex: 2, outcome: "created" },
          { operationIndex: 3, outcome: "created" },
        ],
      });
    }
    first.child.kill("SIGKILL");
    const exit = await first.exited;
    expect(exit[1]).toBe("SIGKILL");
    const second = await start(false, pages ? 0 : Number(new URL(first.ready.scope).port));
    expect(new URL(second.ready.listenUrl).hostname).toBe("127.0.0.1");
    expect(Number(new URL(second.ready.listenUrl).port)).toBeGreaterThan(0);
    const retry = await submit(wire(second.ready.targets.batch, second.ready));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(receipt);
    expect(retry.headers.get("bdp-scope-position")).toBe("pos-1");
    const read = await fetch(wire(receipt.id, second.ready), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await read.json()).toEqual(receipt);
    if (receipt.next) {
      const response = await fetch(wire(receipt.next, second.ready), {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(page);
    }
    if (compiled) {
      const typeRead = await fetch(wire(fixtureType, second.ready), {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(typeRead.status).toBe(200);
      expect(await typeRead.json()).toEqual(types[0]);
      const invalid = await fetch(wire(second.ready.targets.batch, second.ready), {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "invalid-after-reopen",
        },
        body: JSON.stringify({
          operations: [
            {
              operation: "createBead",
              id: "beads/invalid",
              type: fixtureType,
              properties: { n: -1 },
            },
          ],
        }),
      });
      expect(await invalid.json()).toMatchObject({
        status: "failed",
        problem: { code: "validation-failed" },
      });
    }
    second.child.stdin.write("close\n");
    expect((await second.exited)[0]).toBe(0);
  },
  15000,
);

// Private trusted administration exercised through a real listener; no wire admin route.
const authorizationScope = "https://event-sse.invalid/acme/";
const authorizationType = `${authorizationScope}types/task`;
const authorizationSeed = (ids: readonly string[]) =>
  JSON.stringify({
    operations: ids.map((id) => ({
      operation: "createBead",
      id: `beads/${id}`,
      type: authorizationType,
      properties: { n: 0 },
    })),
  });
const authorizationValidators = (() => {
  const schema = JSON.parse(
    readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
  ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
  ajv.addSchema(schema);
  return Object.fromEntries(
    [
      "mutationReceipt",
      "currentBeadRecord",
      "currentBeadCollection",
      "snapshotManifest",
      "eventPage",
      "transactionalProblem",
    ].map((name) => [name, ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` })]),
  );
})();
function authorizationObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("expected observed object");
  return value as Record<string, unknown>;
}
function authorizationText(value: unknown): string {
  if (typeof value !== "string" || !value) throw Error("expected issued nonempty identity");
  return value;
}
function authorizationRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw Error("expected observed array");
  return value.map(authorizationObject);
}
async function authorizationBound<T>(
  promise: Promise<T>,
  label: string,
  milliseconds = 5000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Error(label)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
type AuthorizationResponse = {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
  bodyBytes: number;
};
function authorizationContext(headers: Record<string, string>) {
  return {
    scopeEpoch: authorizationText(headers["bdp-scope-epoch"]),
    authorizationView: authorizationText(headers["bdp-authorization-view"]),
    scopePosition: authorizationText(headers["bdp-scope-position"]),
  };
}
function authorizationChecked(response: AuthorizationResponse, status: number, schema: string) {
  expect(response.status, `authorization-transition:status ${schema}`).toBe(status);
  const validate = authorizationValidators[schema]!;
  expect(
    validate(response.body),
    `authorization-transition:schema ${schema} ${JSON.stringify(validate.errors)}`,
  ).toBe(true);
  return authorizationObject(response.body);
}
function authorizationReceipt(
  response: AuthorizationResponse,
  key: string,
  ids: readonly string[],
  position: string,
) {
  const receipt = authorizationChecked(response, 200, "mutationReceipt");
  expect(receipt).toMatchObject({
    status: "completed",
    detail: "available",
    idempotencyKey: key,
    requiredPosition: position,
    effectPosition: position,
    next: null,
  });
  const context = authorizationContext(response.headers);
  expect(receipt.scopeEpoch).toBe(context.scopeEpoch);
  expect(receipt.authorizationView).toBe(context.authorizationView);
  expect(context.scopePosition).toBe(position);
  const results = authorizationRows(receipt.results);
  expect(results).toHaveLength(ids.length);
  const resources = results.map((entry, index) => {
    expect(entry).toMatchObject({ operationIndex: index, outcome: "created" });
    const resource = authorizationObject(entry.resource);
    expect(resource).toEqual({
      id: `${authorizationScope}beads/${ids[index]}`,
      type: authorizationType,
      revision: authorizationText(resource.revision),
      properties: { n: 0 },
      metadata: {},
    });
    return resource;
  });
  return { receipt, resources, context };
}
function authorizationEvents(
  page: Record<string, unknown>,
  receipt: Record<string, unknown>,
  resources: readonly Record<string, unknown>[],
) {
  expect(page.source).toBe(`${authorizationScope}events/`);
  const events = authorizationRows(page.events);
  expect(events).toHaveLength(resources.length);
  for (const [index, event] of events.entries()) {
    expect(event).toEqual({
      id: authorizationText(event.id),
      ordinal: index,
      type: "created",
      source: `${authorizationScope}events/`,
      subject: resources[index]!.id,
      subjectType: authorizationType,
      transaction: receipt.transaction,
      time: authorizationText(event.time),
      data: { revision: resources[index]!.revision, properties: { n: 0 }, metadata: {} },
    });
  }
  return events;
}
async function withAuthorizationRuntime(
  name: string,
  maximumRequests: number,
  use: (fixture: {
    runtime: Awaited<
      ReturnType<typeof import("./transaction-runtime.js")["startTransactionRuntime"]>
    >;
    request: (
      target: string,
      method?: "GET" | "HEAD" | "POST",
      body?: string,
      key?: string,
    ) => Promise<AuthorizationResponse>;
    stream: (target: string, headers?: [string, string][]) => ReturnType<typeof recordRawSse>;
    observations: Record<string, unknown>[];
  }) => Promise<void>,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-authorization-http-"));
  const observations: Record<string, unknown>[] = [],
    failures: unknown[] = [];
  const streams: ReturnType<typeof recordRawSse>[] = [];
  const controllers: AbortController[] = [];
  let runtime:
    | Awaited<ReturnType<typeof import("./transaction-runtime.js")["startTransactionRuntime"]>>
    | undefined;
  let attempts = 0,
    closed = false;
  const reserve = () => {
    if (++attempts > maximumRequests) throw Error("authorization HTTP request bound");
  };
  try {
    const module = (await import(
      new URL("../dist/transaction-runtime.js", import.meta.url).href
    )) as typeof import("./transaction-runtime.js");
    runtime = await module.startTransactionRuntime(
      {
        directory,
        create: true,
        port: 0,
        scope: authorizationScope,
        types: [
          parseTypeDescriptor({
            id: authorizationType,
            name: "Task",
            describes: "bead",
            conformsTo: [],
          }),
        ],
        credentials: [{ token, principal: "p", canMutate: true }],
      },
      { clock: () => 1000000, maintenanceIntervalMs: 2147483647 },
    );
    const active = runtime;
    const request = async (
      target: string,
      method: "GET" | "HEAD" | "POST" = "GET",
      body?: string,
      key?: string,
    ): Promise<AuthorizationResponse> => {
      reserve();
      const canonical = new URL(target, authorizationScope);
      expect(canonical.origin).toBe(new URL(authorizationScope).origin);
      const dial = new URL(canonical.pathname + canonical.search, active.listenUrl);
      const received = Promise.withResolvers<AuthorizationResponse>();
      void received.promise.catch(() => {});
      const req = authorizationHttpRequest(
        dial,
        {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json, application/problem+json",
            connection: "close",
            ...(body === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  "content-length": String(Buffer.byteLength(body)),
                  "idempotency-key": key!,
                }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 32768) {
              res.destroy(Error("authorization response byte bound"));
              req.destroy();
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          res.once("error", received.reject);
          res.once("aborted", () => received.reject(Error("authorization response aborted")));
          res.once("end", () => {
            try {
              const text = Buffer.concat(chunks).toString("utf8");
              const headers = Object.fromEntries(
                Object.entries(res.headers).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? v.join(", ") : (v ?? ""),
                ]),
              );
              if (method === "HEAD" && bytes !== 0)
                throw Error("authorization HEAD delivered body bytes");
              const value = method === "HEAD" ? undefined : authorizationObject(JSON.parse(text));
              observations.push({
                index: attempts,
                method,
                target: canonical.pathname + canonical.search,
                status: res.statusCode,
                bodyBytes: bytes,
                bodySha256: createHash("sha256").update(text).digest("hex"),
                requestBodyBytes: body === undefined ? 0 : Buffer.byteLength(body),
                ...(body === undefined
                  ? {}
                  : { requestBodySha256: createHash("sha256").update(body).digest("hex") }),
                context: [
                  headers["bdp-scope-epoch"],
                  headers["bdp-authorization-view"],
                  headers["bdp-scope-position"],
                ],
              });
              received.resolve({ status: res.statusCode!, headers, body: value, bodyBytes: bytes });
            } catch (error) {
              received.reject(error);
            }
          });
        },
      );
      req.once("error", received.reject);
      const socketClosed = new Promise<void>((resolve) =>
        req.once("close", () => {
          received.reject(Error("authorization request closed before complete response"));
          resolve();
        }),
      );
      const timer = setTimeout(
        () => req.destroy(Error("authorization finite request timeout")),
        5000,
      );
      req.end(body);
      try {
        return await received.promise;
      } finally {
        clearTimeout(timer);
        req.destroy();
        await authorizationBound(socketClosed, "authorization finite close timeout");
      }
    };
    const stream = (target: string, headers: [string, string][] = []) => {
      reserve();
      const controller = new AbortController();
      controllers.push(controller);
      const canonical = new URL(target, authorizationScope);
      const result = recordRawSse({
        dial: active.listenUrl,
        host: new URL(active.listenUrl).host,
        target: canonical.pathname + canonical.search,
        signal: controller.signal,
        timeoutMs: 5000,
        headers: [
          ["Authorization", `Bearer ${token}`],
          ["Accept", "text/event-stream"],
          ...headers,
        ],
      });
      streams.push(result);
      const observation: Record<string, unknown> = {
        index: attempts,
        method: "GET",
        target: canonical.pathname + canonical.search,
        stream: true,
      };
      observations.push(observation);
      void result.ready.then(
        () => {
          observation.status = result.status;
          observation.context = [
            result.headers["bdp-scope-epoch"],
            result.headers["bdp-authorization-view"],
            result.headers["bdp-scope-position"],
          ];
        },
        () => {
          observation.failedBeforeHeaders = true;
        },
      );
      void result.closed.then(() => {
        observation.closed = true;
        observation.clientAbortedBeforeClose = controller.signal.aborted;
        observation.wireBytes = result.wireBytes.length;
        observation.completeFrames = result.frames.length;
      });
      return result;
    };
    await use({ runtime: active, request, stream, observations });
    expect(attempts).toBe(maximumRequests);
  } catch (error) {
    failures.push(error);
  } finally {
    console.info(
      JSON.stringify({
        label: "authorization-transition-before-cleanup",
        name,
        attempts,
        observations,
        failures: failures.length,
      }),
    );
    for (const controller of controllers) controller.abort(Error("authorization fixture cleanup"));
    for (const stream of streams) {
      try {
        await authorizationBound(stream.close(), "authorization stream close timeout");
      } catch (error) {
        failures.push(error);
      }
    }
    if (runtime) {
      try {
        await authorizationBound(runtime.close(), "authorization runtime close timeout");
        closed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (closed) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    console.info(
      JSON.stringify({
        label: "authorization-transition-cleanup",
        name,
        attempts,
        runtimeReturned: runtime !== undefined,
        closed,
        directory,
        directoryRemoved: !existsSync(directory),
        failures: failures.length,
        claimEligible: false,
      }),
    );
  }
  if (failures.length)
    throw new AggregateError(failures, "authorization transport witness and cleanup");
}

it("narrows current Transactional visibility and fences issued handles after policy publication", async () => {
  await withAuthorizationRuntime("visibility-handles", 18, async (f) => {
    const ids = Array.from({ length: 32 }, (_, index) => `b${String(index).padStart(2, "0")}`);
    const firstBody = authorizationSeed(ids);
    const first = authorizationReceipt(
      await f.request(f.runtime.targets.batch, "POST", firstBody, "auth-transition-seed-32"),
      "auth-transition-seed-32",
      ids,
      "pos-1",
    );
    const second = authorizationReceipt(
      await f.request(
        f.runtime.targets.batch,
        "POST",
        authorizationSeed(["b32"]),
        "auth-transition-seed-1",
      ),
      "auth-transition-seed-1",
      ["b32"],
      "pos-2",
    );
    expect(second.context).toEqual({ ...first.context, scopePosition: "pos-2" });
    expect(authorizationChecked(await f.request("beads/b00"), 200, "currentBeadRecord")).toEqual(
      first.resources[0],
    );
    const collection = authorizationChecked(
      await f.request("beads/?limit=2"),
      200,
      "currentBeadCollection",
    );
    expect(collection.items).toEqual(first.resources.slice(0, 2));
    const collectionNext = authorizationText(collection.next);
    const snapshot = authorizationChecked(await f.request("snapshot"), 200, "snapshotManifest");
    expect(snapshot).toMatchObject({
      scope: authorizationScope,
      scopeEpoch: second.context.scopeEpoch,
      authorizationView: second.context.authorizationView,
      scopePosition: "pos-2",
      erasures: [],
      links: { items: [], next: null },
    });
    expect(authorizationObject(snapshot.beads).items).toEqual(first.resources);
    const snapshotNext = authorizationText(authorizationObject(snapshot.beads).next);
    const checkpoint = authorizationText(snapshot.checkpoint);
    expect(checkpoint).not.toBe("genesis");
    const page = authorizationChecked(await f.request("events/"), 200, "eventPage");
    const events = authorizationEvents(page, first.receipt, first.resources);
    authorizationText(page.next);
    const stream = f.stream("changes/?start=now");
    await stream.ready;
    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toBe("text/event-stream");
    expect(authorizationContext(stream.headers)).toEqual(second.context);
    let streamClosed = false;
    void stream.closed.then(() => {
      streamClosed = true;
    });
    const policy = await f.runtime.replaceAuthorizationPolicy({ timeoutMs: 1000 });
    f.observations.push({ publication: { ...policy }, oldStreamClosedAtPublication: streamClosed });
    expect(
      {
        generation: policy.generation,
        readPolicy: policy.readPolicy,
        canMutate: policy.canMutate,
        viewChanged: policy.authorizationView !== second.context.authorizationView,
      },
      "authorization-transition:generation-and-lease",
    ).toEqual({ generation: 1, readPolicy: "empty", canMutate: false, viewChanged: true });
    await authorizationBound(stream.closed, "authorization-transition:generation-and-lease", 1000);
    expect(streamClosed, "authorization-transition:generation-and-lease").toBe(true);
    expect(stream.frames.filter((frame) => frame.startsWith("id:"))).toEqual([]);
    const current = { ...second.context, authorizationView: policy.authorizationView };
    const problem = async (target: string, status: number, code: string) => {
      const response = await f.request(target);
      const value = authorizationChecked(response, status, "transactionalProblem");
      expect(value).toMatchObject({ status, code });
      expect(authorizationContext(response.headers)).toEqual(current);
      return value;
    };
    await problem("beads/b00", 404, "resource-not-found");
    const empty = await f.request("beads/?limit=2");
    expect(authorizationChecked(empty, 200, "currentBeadCollection")).toEqual({
      items: [],
      next: null,
    });
    expect(authorizationContext(empty.headers)).toEqual(current);
    const fresh = await f.request("snapshot");
    const emptySnapshot = authorizationChecked(fresh, 200, "snapshotManifest");
    expect(emptySnapshot).toMatchObject({
      scopeEpoch: current.scopeEpoch,
      authorizationView: current.authorizationView,
      scopePosition: "pos-2",
      beads: { items: [], next: null },
      links: { items: [], next: null },
      erasures: [],
    });
    expect(emptySnapshot.id).not.toBe(snapshot.id);
    expect(authorizationContext(fresh.headers)).toEqual(current);
    await problem(authorizationText(snapshot.id), 409, "foreign-view");
    await problem(snapshotNext, 409, "foreign-view");
    await problem(collectionNext, 409, "foreign-view");
    const reconnect = f.stream("changes/?start=now", [["Last-Event-ID", checkpoint]]);
    await reconnect.ready;
    await reconnect.closed;
    expect(reconnect.status).toBe(409);
    expect(reconnect.frames.filter((frame) => frame.startsWith("id:"))).toEqual([]);
    const reconnectProblem = authorizationObject(JSON.parse(reconnect.body));
    authorizationChecked(
      {
        status: reconnect.status,
        headers: reconnect.headers,
        body: reconnectProblem,
        bodyBytes: Buffer.byteLength(reconnect.body),
      },
      409,
      "transactionalProblem",
    );
    expect(reconnectProblem.code).toBe("foreign-view");
    expect(authorizationContext(reconnect.headers)).toEqual(current);
    await problem(
      `events/?after=${encodeURIComponent(authorizationText(events.at(-1)!.id))}`,
      409,
      "foreign-view",
    );
    const receiptResponse = await f.request(authorizationText(first.receipt.id));
    const retained = authorizationChecked(receiptResponse, 200, "mutationReceipt");
    const projected: Record<string, unknown> = { ...first.receipt, detail: "withheld" };
    delete projected.results;
    delete projected.next;
    delete projected.allocated;
    delete projected.expiresAt;
    expect(retained).toEqual(projected);
    expect(authorizationContext(receiptResponse.headers)).toEqual(current);
    const receiptHead = await f.request(authorizationText(first.receipt.id), "HEAD");
    expect(receiptHead.status).toBe(200);
    expect(receiptHead.body).toBeUndefined();
    expect(receiptHead.bodyBytes).toBe(0);
    expect(receiptResponse.headers["content-length"]).toBe(String(receiptResponse.bodyBytes));
    expect(receiptHead.headers["content-length"]).toBe(receiptResponse.headers["content-length"]);
    expect(authorizationContext(receiptHead.headers)).toEqual(current);
    for (const response of [receiptResponse, receiptHead]) {
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["last-modified"]).toBeUndefined();
    }
    const replay = await f.request(
      f.runtime.targets.batch,
      "POST",
      firstBody,
      "auth-transition-seed-32",
    );
    expect(authorizationChecked(replay, 403, "transactionalProblem")).toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(authorizationContext(replay.headers)).toEqual(current);
  });
}, 30000);

it("cancels an active Event stream after policy publication", async () => {
  await withAuthorizationRuntime("active-event", 4, async (f) => {
    const created = authorizationReceipt(
      await f.request(
        f.runtime.targets.batch,
        "POST",
        authorizationSeed(["a", "b"]),
        "auth-transition-event-seed",
      ),
      "auth-transition-event-seed",
      ["a", "b"],
      "pos-1",
    );
    const finite = authorizationChecked(await f.request("events/"), 200, "eventPage");
    const events = authorizationEvents(finite, created.receipt, created.resources);
    expect(finite.next).toBeNull();
    const stream = f.stream("events/");
    await stream.until(() => stream.frames.filter((frame) => frame.startsWith("id:")).length === 2);
    expect(stream.status).toBe(200);
    expect(authorizationContext(stream.headers)).toEqual(created.context);
    const actual = stream.frames
      .filter((frame) => frame.startsWith("id:"))
      .map((frame) => JSON.parse(frame.split("\ndata: ")[1]!));
    expect(actual).toEqual(events);
    const policy = await f.runtime.replaceAuthorizationPolicy({ timeoutMs: 1000 });
    expect(policy.generation).toBe(1);
    await authorizationBound(stream.closed, "authorization Event stream not cancelled", 1000);
    const after = await f.request("events/");
    expect(authorizationChecked(after, 200, "eventPage")).toEqual({
      source: `${authorizationScope}events/`,
      events: [],
      next: null,
    });
    expect(authorizationContext(after.headers)).toEqual({
      ...created.context,
      authorizationView: policy.authorizationView,
    });
    f.observations.push({
      deliveredFrames: actual.length,
      publishedView: policy.authorizationView,
      oldStreamClosed: stream.destroyed,
    });
  });
}, 30000);
