/** Independent wire oracle for the explicit canonical Core/Write composition. */
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  RetainedClient,
  createRetainedFetchTransport,
  createHistoricalUpdateFetchTransport,
} from "@bdp/client";
import { startReferenceService } from "../../../packages/server/src/reference.js";
const scope = "https://canonical.invalid/work/";
const token = "C".repeat(32);
const media = "application/vnd.bdp.v0.1+json";
const disposals: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of disposals.splice(0).reverse()) await close();
});
async function fixture(historicalUpdate = true) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-canonical-ref-"));
  disposals.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    directory,
    create: true,
    instance: "canonical-wire",
    historicalUpdate,
    scope,
    credentials: [
      { token, principal: "p" },
      { token: "D".repeat(32), principal: "other" },
    ],
  };
  let server = await startReferenceService(config);
  disposals.push(() => server.close());
  async function wire(
    target: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const address = new URL(server.listenUrl),
      url = new URL(target);
    const text = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<{
      status: number;
      headers: import("node:http").IncomingHttpHeaders;
      text: string;
    }>((resolve, reject) => {
      const req = request(
        {
          hostname: address.hostname,
          port: address.port,
          method,
          path: url.pathname + url.search,
          headers: {
            host: url.host,
            authorization: `Bearer ${token}`,
            accept: media,
            ...(text === undefined
              ? {}
              : { "content-type": media, "content-length": String(Buffer.byteLength(text)) }),
            ...extra,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (b) => chunks.push(b));
          res.on("end", () =>
            resolve({
              status: Number(res.statusCode),
              headers: res.headers,
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(text);
    });
  }
  const post = (operation: keyof typeof server.navigation.targets, body: unknown, key: string) =>
    wire(server.navigation.targets[operation], "POST", body, { "idempotency-key": key });
  async function node(id: string) {
    const result = await post(
      "createBead",
      { id, type: "https://types.invalid/ordinary", properties: { id } },
      `create-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`,
    );
    expect(result.status).toBe(200);
    return JSON.parse(result.text).resource;
  }
  return {
    wire,
    post,
    node,
    get server() {
      return server;
    },
    async reopen() {
      await server.close();
      server = await startReferenceService({ ...config, create: false });
    },
  };
}

const feature = "application/vnd.bdp.v0.1.historical-update.v1+json";
it("negotiates real terminal state and same-ID historical recovery without widening base Resources", async () => {
  const f = await fixture();
  const first = await f.node("a");
  const edited = await f.post(
    "updateBead",
    { bead: "a", type: "https://types.invalid/current", properties: { title: "latest" } },
    "edit",
  );
  const last = JSON.parse(edited.text).resource;
  const deleted = await f.post(
    "deleteBead",
    { bead: "a", expectedRevision: last.revision },
    "delete",
  );
  expect(JSON.parse(deleted.text).deleted.resource.revision).toBe(last.revision);
  expect((await f.wire(first.id)).status).toBe(404);
  const read = await f.wire(`${first.id}?view=terminal`, "GET", undefined, { accept: feature });
  expect(read.status).toBe(200);
  expect(read.headers["content-type"]).toBe(feature);
  const terminal = JSON.parse(read.text).terminal;
  expect(terminal).toMatchObject({
    id: first.id,
    state: "deleted",
    previousRevision: last.revision,
  });
  expect(Object.keys(terminal).sort()).toEqual(["id", "previousRevision", "revision", "state"]);
  expect(terminal.revision).not.toBe(last.revision);
  const head = await f.wire(`${first.id}?view=terminal`, "HEAD", undefined, { accept: feature });
  expect(head.status).toBe(200);
  expect(head.text).toBe("");
  expect(
    (await f.wire(`${first.id}?view=terminal&view=terminal`, "GET", undefined, { accept: feature }))
      .status,
  ).toBe(400);
  const body = {
    bead: first.id,
    fromRevision: first.revision,
    expectedRevision: terminal.revision,
  };
  expect((await f.post("updateBead", body, "wrongmedia")).status).toBe(400);
  expect(
    (
      await f.wire(f.server.navigation.targets.updateBead, "POST", body, {
        "content-type": feature,
        "idempotency-key": "wrongaccept",
      })
    ).status,
  ).toBe(406);
  const invoke = () =>
    f.wire(f.server.navigation.targets.updateBead, "POST", body, {
      accept: feature,
      "content-type": feature,
      "idempotency-key": "recovery",
    });
  const recovery = await invoke();
  expect(recovery.status).toBe(200);
  const restored = JSON.parse(recovery.text);
  expect(restored).toMatchObject({
    result: {
      outcome: "updated",
      changed: true,
      resource: { id: first.id, type: last.type, properties: first.properties },
    },
    historicalUpdate: { fromRevision: first.revision, previousRevision: terminal.revision },
  });
  expect(restored.result.resource.revision).not.toBe(first.revision);
  const baseRead = await f.wire(first.id);
  expect(baseRead.status).toBe(200);
  expect(JSON.parse(baseRead.text)).toEqual(restored.result.resource);
  expect(
    (await f.wire(`${first.id}?view=terminal`, "GET", undefined, { accept: feature })).status,
  ).toBe(404);
  const selected = await f.wire(first.id, "GET", undefined, { accept: feature });
  expect(JSON.parse(selected.text)).toEqual({
    resource: restored.result.resource,
    historicalUpdate: restored.historicalUpdate,
  });
  expect(selected.headers.etag).not.toBe(baseRead.headers.etag);
  await f.reopen();
  expect((await invoke()).text).toBe(recovery.text);
});
it("advertises only selected capability and refuses unsupported composition/carriers truthfully", async () => {
  const f = await fixture(false);
  const first = await f.node("a");
  const read = await f.wire(`${first.id}?view=terminal`, "GET", undefined, { accept: feature });
  expect(read.status).toBe(422);
  expect(JSON.parse(read.text)).toMatchObject({
    code: "capability-not-supported",
    capabilityVersion: "1",
  });
  const write = await f.wire(
    f.server.navigation.targets.updateBead,
    "POST",
    { bead: "a", fromRevision: first.revision },
    { accept: feature, "content-type": feature, "idempotency-key": "unsupported" },
  );
  expect(write.status).toBe(422);
  expect(JSON.parse(write.text).pointer).toBe("/fromRevision");
  expect((await f.wire(first.id)).status).toBe(200);
});

it("delivers a terminal-version source refusal through actual HTTP and SDK as a known validation Problem", async () => {
  const f = await fixture();
  const first = await f.node("terminal-source");
  expect((await f.post("deleteBead", { bead: first.id }, "delete-source")).status).toBe(200);
  const terminalRead = await f.wire(`${first.id}?view=terminal`, "GET", undefined, {
    accept: feature,
  });
  const terminal = JSON.parse(terminalRead.text).terminal;
  const fetchImplementation: typeof fetch = async (input, init) => {
    const body =
      init?.body === undefined
        ? undefined
        : JSON.parse(new TextDecoder().decode(init.body as Uint8Array));
    const reply = await f.wire(
      String(input),
      init?.method ?? "GET",
      body,
      Object.fromEntries(new Headers(init?.headers)),
    );
    const headers = Object.fromEntries(
      Object.entries(reply.headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const response = new Response(
      reply.status === 204 || init?.method === "HEAD" ? null : reply.text,
      { status: reply.status, headers },
    );
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  };
  const options = {
    limits: {
      requestBodyBytes: 65536,
      responseBodyBytes: 65536,
      responseTimeoutMs: 1000,
      cleanupTimeoutMs: 10,
    },
    allowTarget: () => true,
    fetchImplementation,
  };
  const client = new RetainedClient({
    transport: createRetainedFetchTransport(options),
    historicalUpdateTransport: createHistoricalUpdateFetchTransport(options),
    maximumDocumentBytes: 65536,
    maximumRequestBodyBytes: 65536,
    operationTimeoutMs: 1000,
  });
  const bound = await client.bindWrite(scope);
  if (bound.kind !== "success") throw Error("Write binding unavailable");
  const prepared = bound.value.prepareHistoricalUpdate(
    JSON.stringify({
      bead: first.id,
      fromRevision: terminal.revision,
      expectedRevision: terminal.revision,
    }),
    "terminal-is-not-content",
  );
  const reply = await client.submit(prepared);
  expect(reply).toMatchObject({
    kind: "problem",
    http: { status: 422 },
    problem: {
      code: "validation-failed",
      diagnostics: [{ message: "Historical Update source must identify a retained live version" }],
    },
  });
  if (reply.kind !== "problem") throw Error("missing known source refusal");
  expect(reply.nativeBody).toEqual(new TextEncoder().encode(JSON.stringify(reply.problem)));
  expect((await f.wire(first.id)).status).toBe(404);
  expect(await client.submit(prepared)).toEqual(reply);
});
