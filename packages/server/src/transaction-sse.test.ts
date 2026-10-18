import { DatabaseSync } from "node:sqlite";
import { replica } from "../test-support/transaction-replica.js";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { parseTypeDescriptor, stringifyJsonValue } from "@bdp/protocol";
import { selectChangefeedMedia } from "./read-http.js";
import {
  pumpTransactionChanges,
  transactionChangeFrame,
  TRANSACTION_SSE_FRAME_BYTES,
  validateTransactionStreamTimers,
  TRANSACTION_SSE_DEFAULTS,
} from "./transaction-sse.js";
import {
  TRANSACTION_CHANGEFEED_BYTES,
  type TransactionChangefeedPage,
} from "./transaction-changefeed.js";
import { recordRawSse } from "../test-support/raw-sse-recorder.js";
const { startTransactionRuntime } = (await import(
  new URL("../dist/transaction-runtime.js", import.meta.url).href
)) as typeof import("./transaction-runtime.js");
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const scope = "https://sse.invalid/acme/",
  type = `${scope}types/task`,
  linkType = `${scope}types/link`;
async function fixture(
  seams: import("./transaction-runtime.js").TransactionRuntimeTestSeams = {},
  shutdownFailure?: (error: unknown) => void,
) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-sse-"));
  const token = randomBytes(32).toString("base64url");
  const options = {
    scope,
    directory,
    port: 0,
    create: true,
    types: [
      parseTypeDescriptor({
        id: type,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ownsOutgoing: { [linkType]: { max: 4 } },
      }),
      parseTypeDescriptor({
        id: linkType,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "none" },
        target: { conformsTo: [], external: "none" },
      }),
    ],
    credentials: [{ token, principal: "p", canMutate: true }],
  };
  let runtime = await startTransactionRuntime(options, seams);
  cleanup.push(async () => {
    try {
      await runtime.close();
      if (shutdownFailure) throw new Error("expected shutdown failure");
    } catch (error) {
      if (!shutdownFailure) throw error;
      shutdownFailure(error);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  let key = 0;
  const f = {
    get runtime() {
      return runtime;
    },
    token,
    async request(target: string, init: RequestInit = {}) {
      return fetch(new URL(`/acme/${target}`, runtime.listenUrl), {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init.headers },
      });
    },
    async create(id: string, properties: unknown = { title: "café\n🦉" }) {
      const response = await f.request("operations/batch", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `k${key++}` },
        body: JSON.stringify({
          operations: [{ operation: "createBead", id: `beads/${id}`, type, properties }],
        }),
      });
      expect(response.status).toBe(200);
      return response.json();
    },
    stream(
      target = "changes/?after=genesis",
      headers: [string, string][] = [],
      method: "GET" | "HEAD" = "GET",
    ) {
      const controller = new AbortController();
      const recorder = recordRawSse({
        dial: runtime.listenUrl,
        host: new URL(runtime.listenUrl).host,
        target: `/acme/${target}`,
        headers: [
          ["Authorization", `Bearer ${token}`],
          ["Accept", "text/event-stream"],
          ...headers,
        ],
        method,
        signal: controller.signal,
        timeoutMs: 5000,
      });
      cleanup.push(() => recorder.close());
      return recorder;
    },
    async reopen() {
      await runtime.close();
      runtime = await startTransactionRuntime({ ...options, create: false }, seams);
    },
  };
  return f;
}
const groups = (r: ReturnType<typeof recordRawSse>) => r.frames.filter((f) => f.startsWith("id: "));
const group = (frame: string) =>
  JSON.parse(frame.split("\ndata: ")[1]!) as TransactionChangefeedPage["groups"][number];
it.each([
  [null, "json"],
  ["*/*", "json"],
  ["text/event-stream", "sse"],
  ["application/json;q=0,text/*;q=0.5", "sse"],
  ["application/json;q=0.8,text/event-stream;q=0.2", "json"],
  ["application/*;q=0.1,text/event-stream;q=0.9", "sse"],
  ["application/json;q=0,text/event-stream;q=0", undefined],
  ["*/*;q=1,text/event-stream;q=0", "json"],
  ["text/event-stream; charset=utf-8", undefined],
])("selects %s as %s without changing finite JSON", (accept, expected) =>
  expect(selectChangefeedMedia(accept)).toBe(expected),
);
it("raw replay equals finite groups, live commits follow once, no-op emits no frame, and reconnect is exclusive", async () => {
  const f = await fixture();
  const literal = JSON.stringify({
    operations: [
      {
        operation: "createBead",
        id: "beads/a",
        type,
        properties: { "10": "ten", "2": "two", n: 100, title: "café\n🦉" },
      },
    ],
  }).replace('"n":100', '"n":1.0e2');
  expect(literal).toContain('"n":1.0e2');
  expect(
    (
      await f.request("operations/batch", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "literal" },
        body: literal,
      })
    ).status,
  ).toBe(200);
  await f.create("b");
  const firstBytes = await (await f.request("changes/?after=genesis")).text();
  const first = JSON.parse(firstBytes) as TransactionChangefeedPage;
  const secondBytes = await (
    await f.request(`changes/?after=${first.groups[0]!.checkpoint}`)
  ).text();
  const second = JSON.parse(secondBytes) as TransactionChangefeedPage;
  const stream = f.stream();
  await stream.until(() => groups(stream).length === 2);
  expect(groups(stream)).toEqual(
    [...first.groups, ...second.groups].map((g) => transactionChangeFrame(g).slice(0, -2)),
  );
  expect([first.groups, second.groups].map((g) => g.length)).toEqual([1, 1]);
  for (const [index, rawFinite] of [firstBytes, secondBytes].entries())
    expect(rawFinite).toContain(groups(stream)[index]!.split("\ndata: ")[1]!);
  expect(groups(stream)[0]).toContain('"n":100');
  expect(stream.headers).toMatchObject({
    "content-type": "text/event-stream",
    "cache-control": "no-store, no-transform",
    vary: "Accept",
    "x-bdp-development": "non-attesting",
    "bdp-scope-position": "pos-2",
  });
  for (const h of ["content-length", "etag", "last-modified"])
    expect(stream.headers[h]).toBeUndefined();
  await f.create("c");
  await stream.until(() => groups(stream).length === 3);
  const last = group(groups(stream)[2]!);
  const noop = await f.request("operations/batch", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "noop" },
    body: JSON.stringify({
      operations: [
        {
          operation: "updateBead",
          bead: "beads/c",
          propertiesChange: [{ op: "replace", path: "/title", value: "café\n🦉" }],
        },
      ],
    }),
  });
  expect(noop.status).toBe(200);
  await delay(150);
  expect(groups(stream)).toHaveLength(3);
  await stream.close();
  const resumed = f.stream("changes/?after=genesis", [["Last-Event-ID", last.checkpoint]]);
  await resumed.ready;
  await f.create("d");
  await resumed.until(() => groups(resumed).length === 1);
  expect(group(groups(resumed)[0]!).previousPosition).toBe(last.position);
  await resumed.close();
  await f.reopen();
  const restarted = f.stream(`changes/?after=${last.checkpoint}`);
  await restarted.until(() => groups(restarted).length === 1);
  expect(group(groups(restarted)[0]!).position).toBe("pos-4");
});
it("HEAD and preconditions do not consume a slot; capacity/disconnect/shutdown preserve finite work", async () => {
  const f = await fixture();
  const live = f.stream("changes/?start=now");
  await live.ready;
  for (const [method, headers, status] of [
    ["HEAD", [], 200],
    ["GET", [["If-None-Match", "*"]], 304],
    ["GET", [["If-Match", '"absent"']], 412],
  ] as const) {
    for (const target of ["changes/?after=genesis", "changes/?start=now"]) {
      const r = f.stream(
        target,
        [
          ...headers.map(([a, b]): [string, string] => [a, b]),
          ...(target.includes("start=") ? [["Last-Event-ID", "genesis"] as [string, string]] : []),
        ],
        method,
      );
      await r.ready;
      expect(r.status).toBe(status);
      await r.closed;
      expect(r.body).toBe("");
      expect(r.headers["bdp-scope-position"]).toBe("pos-0");
    }
  }
  const refused = f.stream();
  await refused.ready;
  expect(refused.status).toBe(503);
  await refused.closed;
  await f.create("a");
  await live.until(() => groups(live).length === 1);
  await live.close();
  const again = f.stream("changes/?start=now");
  await again.ready;
  expect(again.status).toBe(200);
  const accepted = f.create("b");
  await accepted;
  await f.runtime.close();
  await again.closed;
  await f.reopen();
  expect((await f.request("beads/b")).status).toBe(200);
});
it("raw reconnect grammar, finite header ignorance, Event Source sharing and auth precedence stay bounded", async () => {
  const f = await fixture();
  await f.create("a");
  for (const [target, headers, status] of [
    ["changes/", [["Last-Event-ID", "genesis"]], 400],
    ["changes/?after=genesis", [["Last-Event-ID", ""]], 400],
    [
      "changes/?after=genesis",
      [
        ["Last-Event-ID", "genesis"],
        ["Last-Event-ID", "genesis"],
      ],
      400,
    ],
    ["changes/?start=now", [["Last-Event-ID", "genesis"]], 200],
    ["changes/?start=now", [["Last-Event-ID", ""]], 400],
    ["changes/?start=now", [["Last-Event-ID", "bad"]], 400],
    [
      "changes/?start=now",
      [
        ["Last-Event-ID", "genesis"],
        ["Last-Event-ID", "genesis"],
      ],
      400,
    ],
    ["events/", [], 200],
    ["beads/a?view=events", [], 200],
  ] as [string, [string, string][], number][]) {
    const r = f.stream(target, headers);
    await r.ready;
    expect(r.status, target).toBe(status);
    if (target === "changes/?start=now" && status === 200) {
      await r.until(() => groups(r).length === 1);
      expect(group(groups(r)[0]!).position).toBe("pos-1");
    }
    if (target === "changes/?start=now" && status === 400) {
      await r.closed;
      expect(JSON.parse(r.body).code).toBe("invalid-parameter");
      expect(groups(r)).toEqual([]);
    }
    await r.close();
  }
  const finite = f.stream("changes/?after=genesis", [
    ["Accept", "application/json;q=1"],
    ["Last-Event-ID", "bad"],
    ["Last-Event-ID", "bad"],
  ]);
  await finite.closed;
  expect(finite.status).toBe(200);
  expect(finite.headers["content-type"]).toBe("application/json");
  await finite.close();
  const finiteNow = f.stream("changes/?start=now", [
    ["Accept", "application/json;q=1"],
    ["Last-Event-ID", "bad"],
    ["Last-Event-ID", "bad"],
  ]);
  await finiteNow.closed;
  expect(finiteNow.status).toBe(200);
  expect(finiteNow.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(finiteNow.body)).toMatchObject({
    observedHeadPosition: "pos-1",
    groups: [],
    next: null,
  });
  expect(JSON.parse(finiteNow.body).after).toBe(JSON.parse(finite.body).groups[0].checkpoint);
  const reset = f.stream("changes/?after=genesis", [
    ["Last-Event-ID", "genesis"],
    ["Accept", "application/json;q=0.1"],
  ]);
  await reset.until(() => groups(reset).length === 1);
  await reset.close();
  const unauth = await f.request("changes/?after=bad", {
    headers: { authorization: "", accept: "nonsense" },
  });
  expect(unauth.status).toBe(401);
  expect(unauth.headers.has("bdp-scope-position")).toBe(false);
});
class Sink extends EventEmitter {
  destroyed = false;
  chunks: string[] = [];
  write(value: string) {
    this.chunks.push(value);
    return false;
  }
}
it("one blocked frame suppresses read-ahead and heartbeat accumulation; abort removes listeners", async () => {
  const f = await fixture();
  await f.create("a");
  const page = (await (
    await f.request("changes/?after=genesis")
  ).json()) as TransactionChangefeedPage;
  const sink = new Sink(),
    controller = new AbortController();
  let reads = 0;
  const task = pumpTransactionChanges(
    sink,
    page,
    async () => {
      reads++;
      return page;
    },
    controller.signal,
    { pollMilliseconds: 1, heartbeatMilliseconds: 2 },
  );
  const result = task.catch((e) => e);
  await delay(25);
  expect(reads).toBe(0);
  expect(sink.chunks).toHaveLength(1);
  expect(sink.listenerCount("drain")).toBe(1);
  await f.create("b");
  controller.abort(new Error("fixture disconnect"));
  expect((await result).message).toBe("fixture disconnect");
  for (const event of ["drain", "error", "close"]) expect(sink.listenerCount(event)).toBe(0);
});
it("frame bound includes framing; SSE JSON bytes equal finite encoding", () => {
  expect(TRANSACTION_SSE_FRAME_BYTES).toBe(TRANSACTION_CHANGEFEED_BYTES + 512);
  const value = {
    checkpoint: "cg_test",
    properties: { n: 100, text: "line\n🦉" },
  } as unknown as TransactionChangefeedPage["groups"][number];
  expect(transactionChangeFrame(value)).toBe(
    `id: cg_test\nevent: change-group\ndata: ${stringifyJsonValue(value)}\n\n`,
  );
});
it("start=now retains its first anchor while the minimum wait admits a later commit", async () => {
  let tick = 0,
    commit: (() => Promise<unknown>) | undefined;
  const f = await fixture({
    minimumReads: {
      budgetMs: 100,
      now: () => tick,
      wait: async () => {
        tick += 5;
        await commit?.();
        commit = undefined;
      },
    },
  });
  const initial = (await (
    await f.request("changes/?after=genesis")
  ).json()) as TransactionChangefeedPage;
  commit = () => f.create("during-wait");
  const r = f.stream("changes/?start=now", [
    ["BDP-Minimum-Scope-Position", "pos-1"],
    ["BDP-Scope-Epoch", initial.scopeEpoch],
    ["BDP-Authorization-View", initial.authorizationView],
  ]);
  await r.until(() => groups(r).length === 1);
  expect(group(groups(r)[0]!).position).toBe("pos-1");
});
it("replica discards incomplete frames and failed publication, then replays owned agreement atomically", async () => {
  const f = await fixture();
  await f.create("a");
  await f.create("b");
  const edge = await f.request("operations/batch", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "edge" },
    body: JSON.stringify({
      operations: [
        {
          operation: "createLink",
          id: "links/x",
          type: linkType,
          source: "beads/a",
          target: "beads/b",
          properties: { n: 1 },
        },
      ],
    }),
  });
  expect(edge.status).toBe(200);
  const stream = f.stream();
  await stream.until(() => groups(stream).length === 3);
  const decoded = groups(stream).map(group),
    client = replica(
      {
        scopeEpoch: decoded[0]!.scopeEpoch,
        authorizationView: decoded[0]!.authorizationView,
        scopePosition: "pos-0",
      },
      linkType,
    );
  client.apply(decoded[0]!);
  client.apply(decoded[1]!);
  // Disconnect after receiving only a deliberately cut frame prefix at the
  // client publication boundary. Neither a transport ID nor partial data is a commit.
  const partial = transactionChangeFrame(decoded[2]!).slice(0, -1);
  expect(partial.endsWith("\n\n")).toBe(false);
  const prior = client.state();
  await stream.close();
  expect(client.state()).toEqual(prior);
  const retry = f.stream(`changes/?after=${prior.checkpoint}`);
  await retry.until(() => groups(retry).length === 1);
  const full = group(groups(retry)[0]!);
  expect(() => client.apply(full, true)).toThrow("publication failed");
  expect(client.state()).toEqual(prior);
  const bad = structuredClone(full);
  const source = bad.changes.find(
    (c) => c.operation === "upsert" && c.resource.id === `${scope}beads/a`,
  );
  if (!source || source.operation !== "upsert" || !("ownedLinks" in source.resource))
    throw Error("owned source missing");
  Reflect.set(source.resource.ownedLinks![linkType]![0]!, "revision", "contradiction");
  expect(() => client.apply(bad)).toThrow();
  expect(client.state()).toEqual(prior);
  client.apply(full);
  client.apply(full);
  expect(client.state().checkpoint).toBe(full.checkpoint);
  expect(client.state().graph.size).toBe(3);
});
it("post-frame owner failure and blocked transport errors retain their causes and stop pulls", async () => {
  const f = await fixture();
  await f.create("a");
  const page = (await (
    await f.request("changes/?after=genesis")
  ).json()) as TransactionChangefeedPage;
  const sink = new Sink();
  sink.write = (value) => {
    sink.chunks.push(value);
    return true;
  };
  const original = new Error("owner read failed");
  await expect(
    pumpTransactionChanges(
      sink,
      page,
      async () => {
        throw original;
      },
      new AbortController().signal,
    ),
  ).rejects.toBe(original);
  expect(sink.chunks).toHaveLength(1);
  const blocked = new Sink(),
    controller = new AbortController();
  const task = pumpTransactionChanges(
    blocked,
    page,
    async () => {
      throw Error("unexpected read");
    },
    controller.signal,
  );
  const observed = task.catch((e) => e);
  const fault = new Error("transport fault");
  blocked.emit("error", fault);
  expect(await observed).toBe(fault);
  expect(blocked.listenerCount("drain")).toBe(0);
});
it("observes incomplete requests and finite keepalive closure under bounded timing seams", async () => {
  const { connect } = await import("node:net");
  const f = await fixture({
    transport: { requestTimeout: 200, headersTimeout: 100, timeout: 80, keepAliveTimeout: 50 },
  });
  expect(f.runtime.configurationMetadata).toBeUndefined();
  for (const suffix of [
    "GET /acme/changes/?start=now HTTP/1.1\r\n",
    `POST /acme/operations/batch HTTP/1.1\r\nHost: ${new URL(f.runtime.listenUrl).host}\r\nContent-Length: 100\r\n\r\n{`,
  ]) {
    const address = new URL(f.runtime.listenUrl),
      socket = connect({ host: address.hostname, port: Number(address.port) }),
      started = performance.now();
    const timer = setTimeout(() => socket.destroy(new Error("wire observation deadline")), 2000);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => socket.write(suffix));
        socket.on("data", () => {});
        socket.once("error", reject);
        socket.once("close", () => resolve());
      });
      expect(performance.now() - started).toBeGreaterThanOrEqual(50);
    } finally {
      clearTimeout(timer);
      socket.destroy();
    }
  }
  const address = new URL(f.runtime.listenUrl),
    socket = connect({ host: address.hostname, port: Number(address.port) }),
    started = performance.now();
  let bytes = "";
  const timer = setTimeout(() => socket.destroy(new Error("keepalive observation deadline")), 2500);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () =>
        socket.write(
          `HEAD /acme/changes/?after=genesis HTTP/1.1\r\nHost: ${address.host}\r\nAuthorization: Bearer ${f.token}\r\nConnection: keep-alive\r\n\r\n`,
        ),
      );
      socket.on("data", (chunk) => {
        bytes += chunk.toString();
      });
      socket.once("error", reject);
      socket.once("close", () => resolve());
    });
    expect(bytes).toContain("200 OK");
    expect(performance.now() - started).toBeGreaterThanOrEqual(50);
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
});

it("post-header owner failure closes the wire and retains the original cause for shutdown", async () => {
  const original = new Error("injected stream owner failure");
  const f = await fixture({}, (error) => {
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([original]);
  });
  await f.create("a");
  const stream = f.stream();
  await stream.until(() => groups(stream).length === 1);
  const prepare = DatabaseSync.prototype.prepare;
  vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: DatabaseSync,
    sql: string,
  ) {
    if (sql.includes("FROM groups")) throw original;
    return prepare.call(this, sql);
  });
  await stream.closed;
  expect(stream.wireBytes.toString("utf8").match(/HTTP\/1\.1/g)).toHaveLength(1);
  expect(stream.body).not.toContain("event: error");
});
it("disconnect cancels the actual finite minimum wait without consuming its remaining budget", async () => {
  let waits = 0;
  const f = await fixture({
    minimumReads: {
      budgetMs: 1000,
      wait: async () => {
        waits++;
        await delay(5);
      },
    },
  });
  const initial = (await (
    await f.request("changes/?after=genesis")
  ).json()) as TransactionChangefeedPage;
  const stream = f.stream("changes/?after=genesis", [
    ["BDP-Minimum-Scope-Position", "pos-99"],
    ["BDP-Scope-Epoch", initial.scopeEpoch],
    ["BDP-Authorization-View", initial.authorizationView],
  ]);
  const deadline = performance.now() + 1000;
  while (waits === 0 && performance.now() < deadline) await delay(5);
  expect(waits).toBeGreaterThan(0);
  await stream.close();
  await delay(30);
  const stopped = waits;
  await delay(30);
  expect(waits).toBe(stopped);
  expect(stream.wireBytes.length).toBe(0);
});
it("effective reconnect cursor owns epoch/view/retention decisions; overridden query is not looked up", async () => {
  const f = await fixture();
  await f.create("a");
  const page = (await (
    await f.request("changes/?after=genesis")
  ).json()) as TransactionChangefeedPage;
  const checkpoint = page.groups[0]!.checkpoint;
  const foreignEpoch = checkpoint.replace(/^cg_[^_]+_/, `cg_${"x".repeat(43)}_`);
  // Use exact codec segments; base64url fields may themselves contain underscores.
  const stale = `cg_${"x".repeat(43)}_${checkpoint.slice(47, 90)}_1`;
  const foreign = `cg_${checkpoint.slice(3, 46)}_${"x".repeat(43)}_1`;
  expect(foreignEpoch).not.toBe(checkpoint);
  for (const [effective, status] of [
    [stale, 410],
    [foreign, 409],
    [checkpoint.replace(/_1$/, "_999"), 400],
  ] as const) {
    for (const target of ["changes/?after=genesis", "changes/?start=now"]) {
      const r = f.stream(target, [
        ["Last-Event-ID", effective],
        ["If-None-Match", "*"],
      ]);
      await r.closed;
      expect(r.status, effective).toBe(status);
      expect(JSON.parse(r.body).code).toBe(
        status === 410 ? "cursor-expired" : status === 409 ? "foreign-view" : "invalid-parameter",
      );
      expect(groups(r)).toEqual([]);
      if (status !== 400) {
        expect(r.headers["bdp-scope-epoch"]).toBe(page.scopeEpoch);
        expect(r.headers["bdp-authorization-view"]).toBe(page.authorizationView);
        expect(r.headers["bdp-scope-position"]).toBe("pos-1");
      }
      await r.close();
    }
  }
  const reset = f.stream(`changes/?after=${stale}`, [
    ["Last-Event-ID", "genesis"],
    ["Accept", "application/json;q=0.1"],
  ]);
  await reset.until(() => groups(reset).length === 1);
  expect(reset.status).toBe(200);
  await reset.close();
});

it("disconnects an actual raw response before frame completion and replays from the applied checkpoint", async () => {
  const { createServer, connect } = await import("node:net");
  const f = await fixture();
  await f.create("a");
  const upstream = new URL(f.runtime.listenUrl);
  const sockets = new Set<import("node:net").Socket>();
  const proxy = createServer((client) => {
    const target = connect({ host: upstream.hostname, port: Number(upstream.port) });
    sockets.add(client);
    sockets.add(target);
    client.on("data", (bytes) => target.write(bytes));
    const disconnect = () => {
      client.destroy();
      target.destroy();
    };
    client.on("error", disconnect);
    target.on("error", disconnect);
    client.on("close", () => {
      sockets.delete(client);
      target.destroy();
    });
    target.on("close", () => {
      sockets.delete(target);
      client.destroy();
    });
    let received = Buffer.alloc(0),
      forwarded = false;
    target.on("data", (bytes) => {
      if (forwarded) return;
      received = Buffer.concat([received, bytes]);
      const headersEnd = received.indexOf("\r\n\r\n");
      if (headersEnd < 0) return;
      const chunkLineEnd = received.indexOf("\r\n", headersEnd + 4);
      if (chunkLineEnd < 0) return;
      const count = Number.parseInt(
        received.subarray(headersEnd + 4, chunkLineEnd).toString("ascii"),
        16,
      );
      if (!Number.isSafeInteger(count) || count < 2) {
        disconnect();
        return;
      }
      const lastData = chunkLineEnd + 2 + count;
      if (received.length < lastData) return;
      // Forward an exact wire prefix, withholding the frame's final LF (and
      // chunk terminator). No successful complete frame is synthesized.
      client.write(received.subarray(0, lastData - 1));
      forwarded = true;
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw Error("proxy address");
  const controller = new AbortController();
  const partial = recordRawSse({
    dial: `http://127.0.0.1:${address.port}/`,
    host: upstream.host,
    target: "/acme/changes/?after=genesis",
    headers: [
      ["Authorization", `Bearer ${f.token}`],
      ["Accept", "text/event-stream"],
    ],
    signal: controller.signal,
    timeoutMs: 5000,
  });
  try {
    await partial.until(() => partial.wireBytes.includes(Buffer.from("id: cg_")));
    expect(partial.frames).toEqual([]);
    expect(partial.wireBytes.toString().endsWith("\n\n")).toBe(false);
    await partial.close();
  } finally {
    await partial.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve())),
    );
  }
  const resumed = f.stream("changes/?after=genesis");
  await resumed.until(() => groups(resumed).length === 1);
  expect(group(groups(resumed)[0]!).previousPosition).toBe("pos-0");
});

it("validates pump timers and the minimal heartbeat/idle relationship", async () => {
  for (const value of [0, -1, NaN, Infinity, 0.5, 2_147_483_648]) {
    for (const name of ["pollMilliseconds", "heartbeatMilliseconds"] as const) {
      const sink = { destroyed: false, write: vi.fn() };
      await expect(
        pumpTransactionChanges(
          sink as never,
          { after: "genesis", groups: [] } as unknown as TransactionChangefeedPage,
          vi.fn(),
          new AbortController().signal,
          { ...TRANSACTION_SSE_DEFAULTS, [name]: value },
        ),
      ).rejects.toThrow("invalid transaction stream timer");
      expect(sink.write).not.toHaveBeenCalled();
    }
  }
  expect(() => validateTransactionStreamTimers(TRANSACTION_SSE_DEFAULTS, 5000)).toThrow(
    "heartbeat must precede",
  );
  expect(() => validateTransactionStreamTimers(TRANSACTION_SSE_DEFAULTS, 4999)).toThrow(
    "heartbeat must precede",
  );
  expect(() => validateTransactionStreamTimers(TRANSACTION_SSE_DEFAULTS, 5001)).not.toThrow();
});

it("short finite-only transport seams cannot register live streams; HEAD and finite reads remain usable", async () => {
  const f = await fixture({ transport: { timeout: 100 } });
  expect(f.runtime.configurationMetadata).toBeUndefined();
  const stream = f.stream();
  await stream.closed;
  expect(stream.status).toBe(500);
  expect(stream.headers["x-bdp-development-limit"]).toBe("stream-transport-timing");
  expect(stream.body).toBe("");
  expect(stream.frames).toEqual([]);
  expect((await f.request("changes/?after=genesis")).status).toBe(200);
  expect(
    (
      await f.request("changes/?after=genesis", {
        method: "HEAD",
        headers: { accept: "text/event-stream" },
      })
    ).status,
  ).toBe(200);
});

it("pre-abort between selection and stream registration never writes a finite500", async () => {
  const disconnect = await import(new URL("../dist/node-http-disconnect.js", import.meta.url).href);
  const serviceModule = await import(
    new URL("../dist/transaction-service.js", import.meta.url).href
  );
  const controller = new AbortController();
  vi.spyOn(disconnect, "createNodeHttpDisconnectSignal").mockReturnValue(controller.signal);
  const create = serviceModule.createTransactionService;
  vi.spyOn(serviceModule, "createTransactionService").mockImplementation((...args: unknown[]) => {
    const service = create(...args);
    return {
      ...service,
      stream(start: never, signal: AbortSignal) {
        controller.abort(new Error("registration race disconnect"));
        return service.stream(start, signal);
      },
    };
  });
  const f = await fixture();
  const stream = f.stream();
  await stream.closed;
  expect(controller.signal.aborted).toBe(true);
  expect(stream.wireBytes.length).toBe(0);
  // Fixture cleanup awaits close: ordinary cancellation must not become a
  // retained unexpected fault or shutdown AggregateError.
});

it("destroyed transport before close notification is cancellation, not a retained stream fault", async () => {
  const pumpModule = (await import(
    new URL("../dist/transaction-sse.js", import.meta.url).href
  )) as typeof import("./transaction-sse.js");
  const actualPump = pumpModule.pumpTransactionChanges;
  let witnessedWindow = false;
  vi.spyOn(pumpModule, "pumpTransactionChanges").mockImplementation(
    async (...args: Parameters<typeof pumpTransactionChanges>) => {
      const [sink, initial, , signal] = args;
      const response = sink as import("node:http").ServerResponse;
      expect(initial.groups).toHaveLength(1);
      expect(response.headersSent).toBe(true);
      response.destroy();
      expect(response.destroyed).toBe(true);
      expect(signal.aborted).toBe(false);
      // Node's close event is queued after this microtask continuation. The
      // real pump now observes destroyed=true before the disconnect signal.
      await Promise.resolve();
      expect(signal.aborted).toBe(false);
      witnessedWindow = true;
      return actualPump(...args);
    },
  );
  const f = await fixture();
  await f.create("before-close");
  const stream = f.stream();
  await stream.closed;
  expect(witnessedWindow).toBe(true);
  expect(stream.body).not.toContain("event: error");
  await expect(f.runtime.close()).resolves.toBeUndefined();
});

it("same start=now URL resumes offline groups exclusively after its saved checkpoint", async () => {
  const f = await fixture();
  const initial = f.stream("changes/?start=now");
  await initial.ready;
  expect(initial.status).toBe(200);
  await f.create("first");
  await initial.until(() => groups(initial).length === 1);
  const first = group(groups(initial)[0]!);
  expect(first.position).toBe("pos-1");
  await initial.close();
  await f.create("offline");
  const resumed = f.stream("changes/?start=now", [["Last-Event-ID", first.checkpoint]]);
  await resumed.until(() => groups(resumed).length === 1);
  const second = group(groups(resumed)[0]!);
  expect(second.position).toBe("pos-2");
  expect(second.previousPosition).toBe(first.position);
  const finite = (await (
    await f.request(`changes/?after=${first.checkpoint}`)
  ).json()) as TransactionChangefeedPage;
  expect(second).toEqual(finite.groups[0]);
  await f.create("live");
  await resumed.until(() => groups(resumed).length === 2);
  await resumed.close();
  expect(groups(resumed).map((v) => group(v).position)).toEqual(["pos-2", "pos-3"]);
  const eventId = first.events[0]!.id;
  const wrongDomain = f.stream("changes/?start=now", [["Last-Event-ID", eventId]]);
  await wrongDomain.closed;
  expect(wrongDomain.status).toBe(400);
  expect(JSON.parse(wrongDomain.body).code).toBe("invalid-parameter");
});

it("start=now reconnect checkpoint survives a controlled minimum wait", async () => {
  let tick = 0,
    commit: (() => Promise<unknown>) | undefined;
  const f = await fixture({
    minimumReads: {
      budgetMs: 100,
      now: () => tick,
      wait: async () => {
        tick += 5;
        await commit?.();
        commit = undefined;
      },
    },
  });
  await f.create("before");
  const initial = (await (
    await f.request("changes/?after=genesis")
  ).json()) as TransactionChangefeedPage;
  await f.create("offline-before-wait");
  commit = () => f.create("during-wait");
  const r = f.stream("changes/?start=now", [
    ["Last-Event-ID", initial.groups[0]!.checkpoint],
    ["BDP-Minimum-Scope-Position", "pos-3"],
    ["BDP-Scope-Epoch", initial.scopeEpoch],
    ["BDP-Authorization-View", initial.authorizationView],
  ]);
  await r.until(() => groups(r).length >= 1);
  expect(group(groups(r)[0]!).position).toBe("pos-2");
  expect(group(groups(r)[0]!).previousPosition).toBe("pos-1");
  expect(r.headers["bdp-scope-position"]).toBe("pos-3");
});

it("serves current changefeed opaque minima across finite and SSE admission", async () => {
  const began = performance.now();
  const { createHash } = await import("node:crypto");
  const { existsSync, readFileSync } = await import("node:fs");
  const { Ajv2020 } = await import("ajv/dist/2020.js");
  const { isJsonSchemaUri, isJsonSchemaDateTime } = await import("@bdp/protocol");
  const validator = new Ajv2020({ strict: true, allErrors: true });
  validator.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
  validator.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
  const schema = JSON.parse(
    readFileSync(new URL("../../../schemas/bdp-v0.schema.json", import.meta.url), "utf8"),
  );
  validator.addSchema(schema);
  const validReceipt = validator.compile({ $ref: schema.$id + "#/$defs/mutationReceipt" });
  const validPage = validator.compile({ $ref: schema.$id + "#/$defs/changefeedPage" });
  const validProblem = validator.compile({ $ref: schema.$id + "#/$defs/transactionalProblem" });
  const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const controller = new AbortController(),
    failures: unknown[] = [];
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-current-feed-http-"));
  const token = randomBytes(32).toString("base64url");
  const recorders: ReturnType<typeof recordRawSse>[] = [],
    pending = new Set<Promise<unknown>>();
  const records: {
    ordinal: number;
    method: string;
    url: string;
    status: number | null;
    bodyOctets: number | null;
    bodySha256: string | null;
    wireSha256: string | null;
    requestHeaders: [string, string][];
    headers: Record<string, string | null>;
    readyObserved: boolean;
    drained: boolean;
    transportClosedObserved: boolean | null;
    drainKind: "none" | "finite-body" | "intentional-live" | "seed-body";
    availability: { status: boolean; headers: boolean; body: boolean; wire: boolean };
    bodyState: "unavailable" | "partial" | "drained";
  }[] = [];
  const rawSnapshots: (() => void)[] = [];
  const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"];
  const safeHeaders = [
    ...contextNames,
    "content-type",
    "content-length",
    "cache-control",
    "retry-after",
    "etag",
    "x-bdp-development-limit",
    "x-bdp-development",
  ];
  let runtime: Awaited<ReturnType<typeof startTransactionRuntime>> | undefined;
  let attempted = 0,
    tick = 0,
    runtimeClosed = false,
    stopUnknown = false,
    workDeadlineFired = false;
  let stream: Record<string, unknown> | null = null;
  const workTimer = setTimeout(
    () => {
      workDeadlineFired = true;
      controller.abort(new Error("current feed HTTP work deadline"));
    },
    Math.max(1, began + 3000 - performance.now()),
  );
  function track<T>(operation: Promise<T>) {
    const settled = operation.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
    return settled.then((result) => {
      if (!result.ok) throw result.error;
      return result.value;
    });
  }
  async function bounded<T>(operation: Promise<T>, stop: number, label: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(label)), Math.max(1, stop - performance.now()));
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  function dispatch() {
    controller.signal.throwIfAborted();
    if (attempted >= 32) throw new Error("current feed HTTP dispatch bound");
    return ++attempted;
  }
  function record(
    ordinal: number,
    method: string,
    suffix: string,
    status: number | null,
    body: string | Uint8Array | null,
    headers: Record<string, string>,
    requestHeaders: [string, string][],
    wire: Uint8Array | undefined,
    readyObserved: boolean,
    drained: boolean,
    transportClosedObserved: boolean | null,
    drainKind: "none" | "finite-body" | "intentional-live" | "seed-body",
  ) {
    const snapshot = {
      ordinal,
      method,
      url: new URL(suffix, scope).href,
      status,
      bodyOctets:
        body === null ? null : typeof body === "string" ? Buffer.byteLength(body) : body.byteLength,
      bodySha256: body === null ? null : hash(body),
      wireSha256: wire?.length ? hash(wire) : null,
      requestHeaders: requestHeaders.filter(([name]) => name.toLowerCase() !== "authorization"),
      headers: Object.fromEntries(safeHeaders.map((name) => [name, headers[name] ?? null])),
      readyObserved,
      drained,
      transportClosedObserved,
      drainKind,
      availability: {
        status: status !== null,
        headers: readyObserved,
        body: body !== null,
        wire: wire !== undefined && wire.length > 0,
      },
      bodyState:
        body === null
          ? ("unavailable" as const)
          : drained
            ? ("drained" as const)
            : ("partial" as const),
    };
    const previous = records.findIndex((entry) => entry.ordinal === ordinal);
    if (previous < 0) records.push(snapshot);
    else records[previous] = snapshot;
  }
  async function raw(
    suffix: string,
    method: "GET" | "HEAD",
    headers: [string, string][],
    expected: number,
    live = false,
    authenticated = true,
  ) {
    if (!runtime) throw new Error("missing current HTTP runtime");
    const ordinal = dispatch(),
      target = new URL(suffix, scope);
    expect(target.origin + target.pathname).toBe(scope + "changes/");
    const requestHeaders: [string, string][] = [
      ...(authenticated ? [["Authorization", "Bearer " + token] as [string, string]] : []),
      ...headers,
    ];
    const rec = recordRawSse({
      dial: runtime.listenUrl,
      host: new URL(runtime.listenUrl).host,
      target: target.pathname + target.search,
      method,
      headers: requestHeaders,
      signal: controller.signal,
      timeoutMs: 5000,
    });
    recorders.push(rec);
    const observed = {
      ready: false,
      closed: false,
      drained: false,
      kind: "none" as "none" | "finite-body" | "intentional-live",
    };
    const refresh = () => {
      const finiteDrained =
        observed.ready &&
        observed.closed &&
        (method === "HEAD"
          ? rec.body === ""
          : rec.headers["content-length"] !== undefined
            ? Buffer.byteLength(rec.body) === Number(rec.headers["content-length"])
            : [204, 304].includes(rec.status) && rec.body === "");
      record(
        ordinal,
        method,
        suffix,
        observed.ready ? rec.status : null,
        observed.ready ? rec.body : null,
        rec.headers,
        requestHeaders,
        rec.wireBytes,
        observed.ready,
        observed.drained || finiteDrained,
        observed.closed,
        observed.kind === "none" && finiteDrained ? "finite-body" : observed.kind,
      );
    };
    rawSnapshots.push(refresh);
    void rec.ready.then(
      () => {
        observed.ready = true;
        refresh();
      },
      () => refresh(),
    );
    void rec.closed.then(() => {
      observed.closed = true;
      refresh();
    });
    try {
      await track(rec.ready);
      observed.ready = true;
      refresh();
      expect(rec.status).toBe(expected);
      if (!live) {
        await track(rec.closed);
        observed.closed = true;
        const completeBody =
          method === "HEAD"
            ? rec.body === ""
            : rec.headers["content-length"] !== undefined
              ? Buffer.byteLength(rec.body) === Number(rec.headers["content-length"])
              : rec.status === 304 && rec.body === "";
        observed.drained = completeBody;
        observed.kind = completeBody ? "finite-body" : "none";
        refresh();
        if (method === "HEAD") expect(rec.body).toBe("");
        else if (rec.headers["content-length"] !== undefined)
          expect(Buffer.byteLength(rec.body)).toBe(Number(rec.headers["content-length"]));
        expect(rec.frames).toHaveLength(0);
      }
      return {
        rec,
        ordinal,
        suffix,
        method,
        requestHeaders,
        refresh,
        drained() {
          observed.closed = true;
          observed.drained = true;
          observed.kind = "intentional-live";
          refresh();
        },
      };
    } catch (error) {
      refresh();
      throw error;
    }
  }
  try {
    runtime = await startTransactionRuntime(
      {
        scope,
        directory,
        port: 0,
        create: true,
        types: [
          parseTypeDescriptor({
            id: type,
            name: "Task",
            describes: "bead",
            conformsTo: [],
            ownsOutgoing: { [linkType]: { max: 4 } },
          }),
          parseTypeDescriptor({
            id: linkType,
            name: "Link",
            describes: "link",
            conformsTo: [],
            source: { conformsTo: [], external: "none" },
            target: { conformsTo: [], external: "none" },
          }),
        ],
        credentials: [{ token, principal: "p", canMutate: true }],
      },
      {
        minimumReads: {
          budgetMs: 2,
          now: () => tick,
          wait: async (ms) => {
            tick += ms;
          },
        },
      },
    );
    const receipts: Record<string, unknown>[] = [];
    for (const id of ["a", "b"]) {
      const ordinal = dispatch(),
        suffix = "operations/batch";
      const headers: [string, string][] = [
        ["authorization", "Bearer " + token],
        ["accept", "application/json"],
        ["content-type", "application/json"],
        ["idempotency-key", "current-feed-" + id],
      ];
      const seed = await track(
        (async () => {
          const response = await fetch(new URL("/acme/" + suffix, runtime!.listenUrl), {
            method: "POST",
            headers: Object.fromEntries(headers),
            signal: controller.signal,
            body: JSON.stringify({
              operations: [
                {
                  operation: "createBead",
                  id: "beads/" + id,
                  type,
                  properties: { title: "current-feed-" + id },
                },
              ],
            }),
          });
          const reader = response.body?.getReader(),
            chunks: Uint8Array[] = [];
          let bytes = 0,
            bodyDrained = false;
          const refresh = () =>
            record(
              ordinal,
              "POST",
              suffix,
              response.status,
              Buffer.concat(chunks),
              Object.fromEntries(response.headers),
              headers,
              undefined,
              true,
              bodyDrained,
              null,
              bodyDrained ? "seed-body" : "none",
            );
          refresh();
          try {
            if (reader) {
              try {
                for (;;) {
                  const chunk = await reader.read();
                  if (chunk.done) {
                    bodyDrained = true;
                    break;
                  }
                  bytes += chunk.value.byteLength;
                  chunks.push(chunk.value);
                  refresh();
                  if (bytes > 131072) throw new Error("current seed body bound");
                }
              } catch (error) {
                controller.abort(error);
                await reader.cancel(error);
                throw error;
              } finally {
                reader.releaseLock();
              }
            } else bodyDrained = true;
            return {
              response,
              text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
            };
          } finally {
            refresh();
          }
        })(),
      );
      expect(seed.response.status).toBe(200);
      const receipt = JSON.parse(seed.text);
      expect(validReceipt(receipt), JSON.stringify(validReceipt.errors)).toBe(true);
      expect(receipt).toMatchObject({
        status: "completed",
        requiredPosition: id === "a" ? "pos-1" : "pos-2",
      });
      receipts.push(receipt);
    }
    const second = receipts[1]!;
    const k: [string, string][] = [
      ["bdp-scope-epoch", String(second.scopeEpoch)],
      ["bdp-authorization-view", String(second.authorizationView)],
      ["bdp-minimum-scope-position", "pos-2"],
    ];
    const u = k.map(([name, value]): [string, string] => [
      name,
      name === "bdp-minimum-scope-position" ? "unknown" : value,
    ]);
    const p = u.map(([name, value]): [string, string] => [
      name,
      name === "bdp-minimum-scope-position" ? "pos-01" : value,
    ]);
    const json: [string, string] = ["Accept", "application/json"],
      sse: [string, string] = ["Accept", "text/event-stream"];
    const firstRead = await raw("changes/?after=genesis", "GET", [json, ...k], 200);
    const first = JSON.parse(firstRead.rec.body) as TransactionChangefeedPage;
    expect(validPage(first), JSON.stringify(validPage.errors)).toBe(true);
    expect(first.groups).toHaveLength(1);
    expect(first.observedHeadPosition).toBe("pos-2");
    expect(contextNames.map((name) => firstRead.rec.headers[name])).toEqual([
      second.scopeEpoch,
      second.authorizationView,
      "pos-2",
    ]);
    const cp1 = first.groups[0]!.checkpoint;
    expect(first.next).toBe(scope + "changes/?after=" + cp1);
    const after = "changes/?after=" + cp1;
    const secondRead = await raw(after, "GET", [json, ...k], 200);
    const page2 = JSON.parse(secondRead.rec.body) as TransactionChangefeedPage;
    expect(validPage(page2), JSON.stringify(validPage.errors)).toBe(true);
    expect(page2.groups).toHaveLength(1);
    expect(page2.after).toBe(cp1);
    expect(page2.next).toBeNull();
    expect(page2.observedHeadPosition).toBe("pos-2");
    expect(page2.groups[0]!.changes[0]!.resource.id).toBe(scope + "beads/b");
    const cp2 = page2.groups[0]!.checkpoint;
    expect(cp2).not.toBe(cp1);
    await raw(after, "HEAD", [json, ...k], 200);
    const stale = cp1.slice(0, 3) + (cp1[3] === "A" ? "B" : "A") + cp1.slice(4);
    const foreign = cp1.slice(0, 47) + (cp1[47] === "A" ? "B" : "A") + cp1.slice(48);
    const future = cp1.slice(0, 91) + "3";
    const foreignMinimum = (values: [string, string][], field: string) =>
      values.map(([name, value]): [string, string] => [name, name === field ? "foreign" : value]);
    const rows: {
      method?: "GET" | "HEAD";
      suffix: string;
      headers: [string, string][];
      expected: number;
      auth?: boolean;
      live?: boolean;
    }[] = [
      {
        suffix: "changes/?after=genesis",
        headers: [json, ...u, ["If-None-Match", "*"]],
        expected: 503,
      },
      {
        method: "HEAD",
        suffix: "changes/?after=genesis",
        headers: [json, ...u, ["If-None-Match", "*"]],
        expected: 503,
      },
      { suffix: after, headers: [json, ...p, ["If-Match", '"missing"']], expected: 503 },
      {
        method: "HEAD",
        suffix: after,
        headers: [json, ...p, ["If-Match", '"missing"']],
        expected: 503,
      },
      { suffix: "changes/?start=now", headers: [sse, ...u], expected: 503 },
      { suffix: after, headers: [sse, ...u], expected: 503 },
      { suffix: "changes/?start=now", headers: [sse, ...u, ["Last-Event-ID", cp1]], expected: 503 },
      {
        suffix: "changes/?after=" + stale,
        headers: [sse, ...u, ["Last-Event-ID", cp1]],
        expected: 503,
      },
      {
        suffix: "changes/?after=genesis",
        headers: [json, ...u, ["Last-Event-ID", "bad"], ["Last-Event-ID", "also-bad"]],
        expected: 503,
      },
      { suffix: after, headers: [json, ...u, ["Last-Event-ID", foreign]], expected: 503 },
      {
        suffix: "changes/?after=genesis",
        headers: [["Accept", "text/plain"], ...u],
        expected: 503,
      },
      {
        suffix: "changes/?after=genesis",
        headers: [["Accept", "text/plain"], ...k],
        expected: 406,
      },
      { suffix: after, headers: [json, ...k, ["If-None-Match", "*"]], expected: 304 },
      { suffix: after, headers: [json, ...k, ["If-Match", '"missing"']], expected: 412 },
      { suffix: after, headers: [json, ["bdp-minimum-scope-position", "unknown"]], expected: 400 },
      { suffix: "changes/?after=bad", headers: [sse, ...u, ["Last-Event-ID", cp1]], expected: 400 },
      {
        suffix: "changes/?after=genesis",
        headers: [sse, ...u, ["Last-Event-ID", cp1], ["Last-Event-ID", cp1]],
        expected: 400,
      },
      {
        suffix: "changes/?after=genesis",
        headers: [sse, ...u, ["Last-Event-ID", "bad"]],
        expected: 400,
      },
      {
        suffix: "changes/?after=genesis",
        headers: [sse, ...foreignMinimum(u, "bdp-authorization-view"), ["Last-Event-ID", stale]],
        expected: 410,
      },
      {
        suffix: "changes/?after=genesis",
        headers: [sse, ...foreignMinimum(u, "bdp-scope-epoch"), ["Last-Event-ID", foreign]],
        expected: 409,
      },
      {
        suffix: "changes/?after=genesis",
        headers: [sse, ...u, ["Last-Event-ID", future]],
        expected: 400,
      },
      { suffix: after, headers: [json, ...foreignMinimum(u, "bdp-scope-epoch")], expected: 410 },
      {
        suffix: after,
        headers: [json, ...foreignMinimum(u, "bdp-authorization-view")],
        expected: 409,
      },
      {
        suffix: after,
        headers: [
          json,
          ...foreignMinimum(foreignMinimum(u, "bdp-scope-epoch"), "bdp-authorization-view"),
        ],
        expected: 410,
      },
      {
        suffix: "changes/?after=genesis",
        headers: [sse, ...k, ["Last-Event-ID", cp1]],
        expected: 200,
        live: true,
      },
      { method: "HEAD", suffix: "changes/?start=now", headers: [sse, ...u], expected: 503 },
      { suffix: "changes/?after=genesis", headers: [sse, ...u], expected: 401, auth: false },
    ];
    for (const row of rows) {
      const result = await raw(
        row.suffix,
        row.method ?? "GET",
        row.headers,
        row.expected,
        row.live,
        row.auth,
      );
      const rec = result.rec;
      if (row.live) {
        await track(rec.until(() => groups(rec).length >= 1));
        const expectedFrame =
          "id: " +
          cp2 +
          "\nevent: change-group\ndata: " +
          stringifyJsonValue(page2.groups[0]) +
          "\n";
        expect(groups(rec)).toEqual([expectedFrame.trimEnd()]);
        expect(rec.headers["content-type"]).toBe("text/event-stream");
        expect(controller.signal.aborted).toBe(false);
        expect(rec.destroyed).toBe(false);
        const liveBeforeClose = !controller.signal.aborted && !rec.destroyed;
        await track(rec.close());
        result.drained();
        expect(groups(rec)).toEqual([expectedFrame.trimEnd()]);
        expect(group(groups(rec)[0]!)).toEqual(page2.groups[0]);
        stream = {
          request: result.ordinal,
          status: rec.status,
          readyObserved: true,
          liveBeforeClose,
          afterDrain: true,
          destroyed: rec.destroyed,
          frames: groups(rec),
          checkpoint: cp2,
          group: group(groups(rec)[0]!),
          headers: Object.fromEntries(safeHeaders.map((name) => [name, rec.headers[name] ?? null])),
        };
      }
      const current = contextNames.map((name) => rec.headers[name] ?? null);
      if (row.expected === 401 || (result.ordinal >= 20 && result.ordinal <= 22))
        expect(current).toEqual([null, null, null]);
      else expect(current).toEqual([second.scopeEpoch, second.authorizationView, "pos-2"]);
      expect(rec.headers["x-bdp-development"]).toBe("non-attesting");
      if (row.expected === 503) {
        expect(rec.headers["content-type"]).toBe("application/problem+json");
        expect(rec.headers["cache-control"]).toBe("private, no-store");
        expect(rec.headers["retry-after"]).toBe("1");
        expect(rec.headers.etag).toBeUndefined();
        expect(rec.headers["x-bdp-development-limit"]).toBeUndefined();
        if (row.method !== "HEAD") {
          const problem = JSON.parse(rec.body);
          expect(validProblem(problem), JSON.stringify(validProblem.errors)).toBe(true);
          expect(problem).toMatchObject({
            code: "catch-up-timeout",
            status: 503,
            retry: "after-delay",
          });
        }
      } else if ([400, 409, 410].includes(row.expected)) {
        const problem = JSON.parse(rec.body);
        expect(validProblem(problem), JSON.stringify(validProblem.errors)).toBe(true);
        expect(problem.code).toBe(
          row.expected === 409
            ? "foreign-view"
            : row.expected === 410
              ? "cursor-expired"
              : result.ordinal === 20
                ? "malformed-request"
                : "invalid-parameter",
        );
      } else if ([406, 304, 412].includes(row.expected)) expect(rec.body).toBe("");
    }
    for (const [get, head] of [
      [6, 7],
      [8, 9],
      [4, 5],
    ] as const) {
      expect(records[head - 1]!.bodyOctets).toBe(0);
      expect(records[head - 1]!.headers["content-length"]).toBe(
        records[get - 1]!.headers["content-length"],
      );
      expect(records[get - 1]!.headers["content-length"]).toBe(
        String(records[get - 1]!.bodyOctets),
      );
    }
    expect(attempted).toBe(32);
    expect(records).toHaveLength(32);
    expect(records.filter((entry) => entry.drained)).toHaveLength(32);
    expect(records.map((r) => r.status)).toEqual([
      200, 200, 200, 200, 200, 503, 503, 503, 503, 503, 503, 503, 503, 503, 503, 503, 406, 304, 412,
      400, 400, 400, 400, 410, 409, 400, 410, 409, 410, 200, 503, 401,
    ]);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort();
    clearTimeout(workTimer);
    const cleaning = (async () => {
      await Promise.all(recorders.map((rec) => rec.close()));
      await Promise.all([...pending]);
      if (runtime) {
        await runtime.close();
        runtimeClosed = true;
      }
    })();
    void cleaning.catch(() => {});
    try {
      await bounded(cleaning, began + 4000, "current feed HTTP cleanup-inclusive deadline");
      if (runtimeClosed) rmSync(directory, { recursive: true, force: false });
    } catch (error) {
      stopUnknown = true;
      failures.push(error);
    }
    for (const refresh of rawSnapshots) refresh();
    const elapsedMs = performance.now() - began;
    if (elapsedMs >= 4000) failures.push(new Error("current feed HTTP total deadline exceeded"));
    console.log(
      JSON.stringify({
        observation: "current-changefeed-minimum-http",
        outcome: failures.length ? "failed" : "passed",
        attempted,
        observedResponses: records.filter((entry) => entry.readyObserved).length,
        completed: records.filter((entry) => entry.drained).length,
        records,
        stream,
        elapsedMs,
        runtimeClosed,
        stopUnknown,
        workDeadlineFired,
        pendingOperationsAtReport: pending.size,
        directory,
        directoryAbsent: !existsSync(directory),
        failureCount: failures.length,
        claimEligible: false,
      }),
    );
  }
  if (failures.length) throw new AggregateError(failures, "current feed HTTP witness failed");
});
