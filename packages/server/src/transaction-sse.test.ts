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
