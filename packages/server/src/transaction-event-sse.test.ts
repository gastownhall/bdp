/** Private Event stream transport/owner tests; no public profile admission. */
import { randomBytes } from "node:crypto";
import { recordRawSse } from "../test-support/raw-sse-recorder.js";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { parseTypeDescriptor, stringifyJsonValue } from "@bdp/protocol";
import { openTransactionStore } from "./transaction-store.js";
import { prepareTransaction } from "./transaction-batch.js";
import {
  pumpTransactionEvents,
  transactionEventFrame,
  TRANSACTION_EVENT_FRAME_BYTES,
} from "./transaction-sse.js";
import { TRANSACTION_EVENT_PAGE_BYTES } from "./transaction-events.js";
const scope = "https://event-sse.invalid/acme/",
  type = `${scope}types/task`,
  linkType = `${scope}types/link`;
const types = [
  parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] }),
  parseTypeDescriptor({
    id: linkType,
    name: "Link",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [], external: "none" },
    target: { conformsTo: [], external: "none" },
  }),
];
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanups.splice(0).reverse()) await close();
});
function ownerFixture(maximum = 1) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-event-stream-"));
  const owner = openTransactionStore({
    file: path.join(directory, "owner.sqlite"),
    scope,
    types,
    create: true,
    receiptMaximumItems: maximum,
  });
  cleanups.push(() => {
    owner.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let key = 0;
  return {
    owner,
    run(operations: unknown[]) {
      const admission = owner.admit(
        "p",
        `k${key++}`,
        prepareTransaction(scope, JSON.stringify({ operations })),
      );
      if (admission.kind !== "owned") throw new Error("unexpected admission");
      const receipt = owner.execute(admission.claim);
      expect(receipt.status).toBe("completed");
      return receipt;
    },
  };
}
const create = (id: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { n: 0 },
});
class Sink extends EventEmitter {
  destroyed = false;
  chunks: string[] = [];
  writable = false;
  write(text: string) {
    this.chunks.push(text);
    return this.writable;
  }
}
it("Event pump adopts only delivered successors and never reads through a blocked frame", async () => {
  const f = ownerFixture();
  f.run([create("a"), create("b")]);
  const initial = f.owner.beginEventScan(`${scope}events/`);
  if (initial.kind !== "packet") throw new Error(initial.kind);
  const sink = new Sink(),
    controller = new AbortController();
  const scans: unknown[] = [];
  const task = pumpTransactionEvents(
    sink,
    initial,
    async (scan) => {
      scans.push(scan);
      return f.owner.advanceEventScan(scan);
    },
    controller.signal,
    { pollMilliseconds: 1, heartbeatMilliseconds: 2 },
  );
  const observed = task.catch((error) => error);
  cleanups.push(async () => {
    controller.abort(new Error("test cleanup"));
    await observed;
  });
  await delay(10);
  expect(scans).toEqual([]);
  expect(sink.chunks).toEqual([transactionEventFrame(initial.events[0]!)]);
  // The SQLite owner remains free while network delivery is backpressured.
  f.run([create("c")]);
  sink.emit("drain");
  await delay(10);
  expect(scans).toEqual([initial.scan]);
  expect(sink.chunks.filter((s) => s.startsWith("id:"))).toHaveLength(2);
  const reason = new Error("end controlled stream");
  controller.abort(reason);
  expect(await observed).toBe(reason);
  expect(
    sink.listenerCount("drain") + sink.listenerCount("close") + sink.listenerCount("error"),
  ).toBe(0);
});
it("empty historical packets emit heartbeats during backlog before a later relevant Event", async () => {
  const f = ownerFixture();
  f.run([create("a"), create("b")]);
  for (let n = 1; n <= 12; n++)
    f.run([
      {
        operation: "updateBead",
        bead: "beads/b",
        propertiesChange: [{ op: "replace", path: "/n", value: n }],
      },
    ]);
  f.run([
    {
      operation: "updateBead",
      bead: "beads/a",
      propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
    },
  ]);
  const source = `${scope}beads/a?view=events`;
  const finite = f.owner.readEvents(source);
  if (finite.kind !== "page") throw new Error(finite.kind);
  const initial = f.owner.beginEventScan(source, finite.page.events[0]!.id);
  if (initial.kind !== "packet") throw new Error(initial.kind);
  const sink = new Sink();
  sink.writable = true;
  const controller = new AbortController();
  let pulls = 0;
  const task = pumpTransactionEvents(
    sink,
    initial,
    async (scan) => {
      pulls++;
      // Scaled deterministic elapsed-time progression between bounded owner
      // entries, not a claim about parsing latency or production timer changes.
      await delay(2);
      return f.owner.advanceEventScan(scan);
    },
    controller.signal,
    { pollMilliseconds: 1, heartbeatMilliseconds: 3 },
  );
  const observed = task.catch((error) => error);
  cleanups.push(async () => {
    controller.abort(new Error("test cleanup"));
    await observed;
  });
  const deadline = performance.now() + 1000;
  while (!sink.chunks.some((s) => s.startsWith("id:")) && performance.now() < deadline)
    await delay(2);
  const eventIndex = sink.chunks.findIndex((s) => s.startsWith("id:"));
  expect(eventIndex).toBeGreaterThan(0);
  expect(sink.chunks.slice(0, eventIndex).every((s) => s === ": heartbeat\n\n")).toBe(true);
  expect(pulls).toBeGreaterThanOrEqual(13);
  controller.abort(new Error("observation done"));
  await observed;
});
it("Event framing is complete UTF8 JSON with a conservative arithmetic bound", () => {
  const f = ownerFixture();
  f.run([{ ...create("a"), properties: { title: "café\n🦉", "10": "ten", "2": "two" } }]);
  const packet = f.owner.beginEventScan(`${scope}events/`);
  if (packet.kind !== "packet") throw new Error(packet.kind);
  const event = packet.events[0]!;
  expect(transactionEventFrame(event)).toBe(
    `id: ${event.id}\nevent: ${event.type}\ndata: ${stringifyJsonValue(event)}\n\n`,
  );
  expect(transactionEventFrame(event).split("\n")).toHaveLength(5);
  expect(TRANSACTION_EVENT_FRAME_BYTES).toBe(TRANSACTION_EVENT_PAGE_BYTES + 512);
  expect(TRANSACTION_EVENT_FRAME_BYTES).toBe(4194816);
});

const { startTransactionRuntime } = (await import(
  new URL("../dist/transaction-runtime.js", import.meta.url).href
)) as typeof import("./transaction-runtime.js");
async function runtimeFixture(expectedFault?: (error: unknown) => void) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-event-http-")),
    token = randomBytes(32).toString("base64url");
  const runtime = await startTransactionRuntime(
    {
      scope,
      directory,
      port: 0,
      create: true,
      types,
      credentials: [{ token, principal: "p", canMutate: true }],
    },
    { receiptMaximumItems: 2, minimumReads: { budgetMs: 25 } },
  );
  cleanups.push(async () => {
    try {
      await runtime.close();
      if (expectedFault) throw new Error("expected retained stream fault");
    } catch (error) {
      if (!expectedFault) throw error;
      expectedFault(error);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  let key = 0;
  const f = {
    runtime,
    token,
    request(target: string, init: RequestInit = {}) {
      return fetch(new URL(`/acme/${target}`, runtime.listenUrl), {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...init.headers },
      });
    },
    async run(operations: unknown[]) {
      const r = await f.request("operations/batch", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `k${key++}` },
        body: JSON.stringify({ operations }),
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { status: string };
      expect(body.status).toBe("completed");
      return body;
    },
    stream(
      target: string,
      headers: [string, string][] = [],
      method: "GET" | "HEAD" = "GET",
      authenticated = true,
    ) {
      const controller = new AbortController();
      const stream = recordRawSse({
        dial: runtime.listenUrl,
        host: new URL(runtime.listenUrl).host,
        target: `/acme/${target}`,
        headers: [
          ...(authenticated ? [["Authorization", `Bearer ${token}`] as [string, string]] : []),
          ...(!headers.some(([name]) => name.toLowerCase() === "accept")
            ? [["Accept", "text/event-stream"] as [string, string]]
            : []),
          ...headers,
        ],
        method,
        signal: controller.signal,
        timeoutMs: 5000,
      });
      cleanups.push(() => stream.close());
      return stream;
    },
    async finite(target: string) {
      const events: import("./transaction-batch.js").TransactionEvent[] = [],
        pages: string[] = [];
      let next: string | null = target;
      while (next) {
        const r = await f.request(next);
        expect(r.status).toBe(200);
        const text = await r.text();
        pages.push(text);
        const page = JSON.parse(text);
        events.push(...page.events);
        next = page.next ? page.next.slice(scope.length) : null;
      }
      return { events, pages };
    },
  };
  return f;
}
const eventFrames = (stream: ReturnType<typeof recordRawSse>) =>
  stream.frames.filter((f) => f.startsWith("id:"));
const decoded = (frame: string) => JSON.parse(frame.split("\ndata: ")[1]!);
function contextFields(headers: Record<string, string>) {
  for (const key of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
    expect(headers[key]).toBeTruthy();
}
it("real Scope, Bead and Link SSE equals finite bytes and follows a live change exactly once", async () => {
  const f = await runtimeFixture();
  await f.run([
    create("a"),
    create("b"),
    {
      operation: "createLink",
      id: "links/l",
      type: linkType,
      source: "beads/a",
      target: "beads/a",
      properties: { n: 0 },
    },
  ]);
  let n = 0;
  for (const target of ["events/", "beads/a?view=events", "links/l?view=events"]) {
    const finite = await f.finite(target),
      stream = f.stream(target);
    await stream.until(() => eventFrames(stream).length === finite.events.length);
    expect(eventFrames(stream).map(decoded)).toEqual(finite.events);
    for (const frame of eventFrames(stream))
      expect(finite.pages.some((p) => p.includes(frame.split("\ndata: ")[1]!))).toBe(true);
    expect(stream.headers).toMatchObject({
      "cache-control": "no-store, no-transform",
      vary: "Accept",
      "content-type": "text/event-stream",
      "x-bdp-development": "non-attesting",
    });
    contextFields(stream.headers);
    for (const h of ["content-length", "etag", "last-modified"])
      expect(stream.headers[h]).toBeUndefined();
    await f.run([
      {
        operation: "updateLink",
        link: "links/l",
        propertiesChange: [{ op: "replace", path: "/n", value: ++n }],
      },
    ]);
    await stream.until(() => eventFrames(stream).length === finite.events.length + 1);
    const last = decoded(eventFrames(stream).at(-1)!);
    expect(last.type).toBe("updated");
    expect(last.subject).toBe(`${scope}links/l`);
    await f.run([
      {
        operation: "updateLink",
        link: "links/l",
        propertiesChange: [{ op: "replace", path: "/n", value: n }],
      },
    ]);
    await delay(30);
    expect(eventFrames(stream)).toHaveLength(finite.events.length + 1);
    await stream.close();
    const reconnect = f.stream(target, [["Last-Event-ID", last.id]]);
    await reconnect.ready;
    expect(reconnect.status).toBe(200);
    await delay(20);
    expect(eventFrames(reconnect)).toEqual([]);
    await reconnect.close();
  }
});
it("Event reconnect syntax, minimum ordering and exact context codes are preserved over HTTP", async () => {
  const f = await runtimeFixture();
  await f.run([create("a")]);
  const finite = await f.finite("events/"),
    id = finite.events[0]!.id;
  const first = f.stream("events/", [], "HEAD");
  await first.closed;
  contextFields(first.headers);
  const stale = `ev_${"x".repeat(43)}_${id.slice(47)}`,
    foreign = `ev_${id.slice(3, 46)}_${"x".repeat(43)}_${id.slice(91)}`;
  const cases: [string, [string, string][], number, string | undefined, boolean][] = [
    ["events/", [["Last-Event-ID", ""]], 400, "invalid-parameter", true],
    ["events/", [["Last-Event-ID", "genesis"]], 400, "invalid-parameter", true],
    [
      "events/",
      [
        ["Last-Event-ID", id],
        ["Last-Event-ID", id],
      ],
      400,
      "invalid-parameter",
      true,
    ],
    ["events/", [["Last-Event-ID", stale]], 410, "cursor-expired", true],
    ["events/", [["Last-Event-ID", foreign]], 409, "foreign-view", true],
    ["beads/a?view=events", [["Last-Event-ID", id]], 400, "invalid-parameter", true],
    [
      "events/",
      [["Last-Event-ID", id.replace("pos-1_", "pos-99_")]],
      400,
      "invalid-parameter",
      true,
    ],
    [
      "beads/missing?view=events",
      [
        ["Last-Event-ID", "bad"],
        ["Last-Event-ID", "bad"],
      ],
      404,
      "resource-not-found",
      true,
    ],
    [
      "beads/missing?view=events&after=bad",
      [["Last-Event-ID", id]],
      400,
      "invalid-parameter",
      false,
    ],
    [
      "events/",
      [
        ["Last-Event-ID", "bad"],
        ["BDP-Scope-Epoch", first.headers["bdp-scope-epoch"]!],
        ["BDP-Authorization-View", first.headers["bdp-authorization-view"]!],
        ["BDP-Minimum-Scope-Position", "pos-9"],
      ],
      503,
      "catch-up-timeout",
      true,
    ],
  ];
  for (const [target, headers, status, code, observed] of cases)
    for (const method of ["GET", "HEAD"] as const) {
      const r = f.stream(target, headers, method);
      await r.closed;
      expect(r.status, `${method} ${target}`).toBe(status);
      if (method === "GET") expect(JSON.parse(r.body).code).toBe(code);
      else expect(r.body).toBe("");
      if (observed) {
        contextFields(r.headers);
        expect(r.headers["bdp-scope-position"]).toBe("pos-1");
      } else expect(r.headers["bdp-scope-position"]).toBeUndefined();
    }
  for (const overridden of [stale, foreign, id.replace("pos-1_", "pos-99_")]) {
    const r = f.stream(`events/?after=${overridden}`, [["Last-Event-ID", id]], "HEAD");
    await r.closed;
    expect(r.status).toBe(200);
    contextFields(r.headers);
  }
  const json = f.stream("events/", [
    ["Accept", "application/json;q=1"],
    ["Last-Event-ID", "bad"],
    ["Last-Event-ID", "bad"],
  ]);
  await json.closed;
  expect(json.status).toBe(200);
  expect(json.headers["content-type"]).toBe("application/json");
  const noauth = f.stream("events/", [], "HEAD", false);
  await noauth.closed;
  expect(noauth.status).toBe(401);
  expect(noauth.headers["bdp-scope-position"]).toBeUndefined();
});
it("conditions, HEAD,406 and shared cross-kind capacity preserve initial context without a stream slot", async () => {
  const f = await runtimeFixture();
  await f.run([create("a")]);
  for (const firstTarget of ["events/", "changes/?after=genesis"]) {
    const active = f.stream(firstTarget);
    await active.ready;
    const other = firstTarget === "events/" ? "changes/?after=genesis" : "events/";
    const refused = f.stream(other);
    await refused.closed;
    expect(refused.status).toBe(503);
    expect(JSON.parse(refused.body).code).toBe("temporarily-unavailable");
    contextFields(refused.headers);
    for (const [headers, status] of [
      [[], 200],
      [[["If-None-Match", "*"]], 304],
      [[["If-Match", '"wrong"']], 412],
      [[["Accept", "application/json;q=0,text/event-stream;q=0"]], 406],
    ] as [[string, string][], number][]) {
      const r = f.stream("beads/a?view=events", headers, "HEAD");
      await r.closed;
      expect(r.status).toBe(status);
      contextFields(r.headers);
      expect(r.body).toBe("");
    }
    await active.close();
  }
});

const link = () => ({
  operation: "createLink",
  id: "links/l",
  type: linkType,
  source: "beads/a",
  target: "beads/b",
  properties: { n: 0 },
});
const metadataUpdate = () => ({
  operation: "updateLink",
  link: "links/l",
  metadataChange: [{ op: "add", path: "/note", value: "unresolved" }],
});
function causes(error: unknown): unknown[] {
  const result: unknown[] = [],
    seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (seen.has(value)) return;
    seen.add(value);
    result.push(value);
    if (value instanceof AggregateError) for (const e of value.errors) visit(e);
    if (value instanceof Error && value.cause) visit(value.cause);
  };
  visit(error);
  return result;
}
it("retained deleted Bead and Link Sources stream while their canonical Resources are absent", async () => {
  const f = await runtimeFixture();
  await f.run([create("a"), create("b"), link()]);
  await f.run([
    { operation: "deleteLink", link: "links/l" },
    { operation: "deleteBead", bead: "beads/a" },
  ]);
  for (const resource of ["beads/a", "links/l"]) {
    expect((await f.request(resource)).status).toBe(404);
    const target = `${resource}?view=events`,
      finite = await f.finite(target),
      live = f.stream(target);
    await live.until(() => eventFrames(live).length === finite.events.length);
    expect(eventFrames(live).map(decoded)).toEqual(finite.events);
    expect(decoded(eventFrames(live).at(-1)!).type).toBe("deleted");
    await live.close();
  }
});
it("an initial metadata-only incident Link gap refuses Bead SSE while Scope and Link remain available", async () => {
  const f = await runtimeFixture();
  await f.run([create("a"), create("b"), link(), metadataUpdate()]);
  const gap = f.stream("beads/a?view=events");
  await gap.closed;
  expect(gap.status).toBe(500);
  expect(gap.headers["x-bdp-development-limit"]).toBe("incident-link-metadata");
  expect(gap.body).toBe("");
  for (const target of ["events/", "links/l?view=events"]) {
    const finite = await f.finite(target),
      live = f.stream(target);
    await live.until(() => eventFrames(live).length === finite.events.length);
    expect(eventFrames(live).map(decoded)).toEqual(finite.events);
    await live.close();
  }
});
it("a later projection gap closes without a second response and repeat reconnect reaches the same gap", async () => {
  const f = await runtimeFixture((error) => {
    expect(
      causes(error).some((e) => e instanceof Error && e.message === "incident-link-metadata"),
    ).toBe(true);
  });
  await f.run([create("a"), create("b"), link()]);
  const finite = await f.finite("beads/a?view=events"),
    last = finite.events.at(-1)!.id;
  const live = f.stream("beads/a?view=events", [["Last-Event-ID", last]]);
  await live.ready;
  expect(live.status).toBe(200);
  await f.run([metadataUpdate()]);
  await live.closed;
  expect(eventFrames(live)).toEqual([]);
  expect(live.wireBytes.toString().match(/HTTP\/1\.1 /g)).toHaveLength(1);
  for (let n = 0; n < 2; n++) {
    const reconnect = f.stream("beads/a?view=events", [["Last-Event-ID", last]]);
    await reconnect.ready;
    expect(reconnect.status).toBe(200);
    await reconnect.closed;
    expect(eventFrames(reconnect)).toEqual([]);
  }
  expect((await f.finite("links/l?view=events")).events.at(-1)!.data).toHaveProperty(
    "metadataChange",
  );
});
it("a blocked backlog heartbeat prevents the next owner pull until drain or cancellation", async () => {
  const f = ownerFixture();
  f.run([create("a"), create("b")]);
  for (let n = 1; n <= 4; n++)
    f.run([
      {
        operation: "updateBead",
        bead: "beads/b",
        propertiesChange: [{ op: "replace", path: "/n", value: n }],
      },
    ]);
  const source = `${scope}beads/a?view=events`,
    initial = f.owner.beginEventScan(source);
  if (initial.kind !== "packet") throw Error(initial.kind);
  const sink = new Sink();
  sink.writable = true;
  const original = sink.write.bind(sink);
  sink.write = (text) => {
    if (text.startsWith(":")) sink.writable = false;
    return original(text);
  };
  const controller = new AbortController();
  let pulls = 0;
  const result = pumpTransactionEvents(
    sink,
    initial,
    async (scan) => {
      pulls++;
      await delay(3);
      return f.owner.advanceEventScan(scan);
    },
    controller.signal,
    { pollMilliseconds: 1, heartbeatMilliseconds: 1 },
  ).catch((e) => e);
  cleanups.push(async () => {
    controller.abort();
    await result;
  });
  for (let n = 0; n < 100 && !sink.chunks.some((s) => s.startsWith(":")); n++) await delay(1);
  expect(sink.chunks.some((s) => s.startsWith(":"))).toBe(true);
  const before = pulls,
    writes = sink.chunks.length;
  await delay(15);
  expect(pulls).toBe(before);
  expect(sink.chunks).toHaveLength(writes);
  controller.abort();
  await result;
  expect(
    sink.listenerCount("drain") + sink.listenerCount("close") + sink.listenerCount("error"),
  ).toBe(0);
});
it("known-source invalid cursor and capacity errors keep the captured context across an intervening commit", async () => {
  const serviceModule = await import(
    new URL("../dist/transaction-service.js", import.meta.url).href
  );
  const batchModule = await import(new URL("../dist/transaction-batch.js", import.meta.url).href);
  const actual = serviceModule.createTransactionService;
  let mutateOnFailure = false,
    mutateOnStream = false;
  vi.spyOn(serviceModule, "createTransactionService").mockImplementation((...args: unknown[]) => {
    const owner = args[0] as ReturnType<typeof openTransactionStore>,
      service = actual(...args);
    let key = 0;
    const mutate = () => {
      const id = `intervening-${key++}`;
      const admitted = owner.admit(
        "p",
        id,
        batchModule.prepareTransaction(scope, JSON.stringify({ operations: [create(id)] })),
      );
      if (admitted.kind !== "owned") throw Error(admitted.kind);
      owner.execute(admitted.claim);
    };
    return {
      ...service,
      async beginEvents(...input: unknown[]) {
        try {
          return await service.beginEvents(...input);
        } catch (error) {
          if (mutateOnFailure) {
            mutateOnFailure = false;
            mutate();
          }
          throw error;
        }
      },
      stream(...input: unknown[]) {
        if (mutateOnStream) {
          mutateOnStream = false;
          mutate();
        }
        return service.stream(...input);
      },
    };
  });
  const f = await runtimeFixture();
  await f.run([create("a")]);
  mutateOnFailure = true;
  const bad = f.stream("events/", [["Last-Event-ID", "bad"]]);
  await bad.closed;
  expect(bad.status).toBe(400);
  expect(bad.headers["bdp-scope-position"]).toBe("pos-1");
  const active = f.stream("events/");
  await active.ready;
  mutateOnStream = true;
  const full = f.stream("events/");
  await full.closed;
  expect(full.status).toBe(503);
  expect(full.headers["bdp-scope-position"]).toBe("pos-2");
  const current = await f.request("events/");
  expect(current.headers.get("bdp-scope-position")).toBe("pos-3");
  await active.close();
});
it("disconnects an actual raw response before frame completion and replays from the last fully accepted Event (none before the partial first frame)", async () => {
  const { createServer, connect } = await import("node:net");
  const f = await runtimeFixture();
  await f.run([create("a")]);
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
    target: "/acme/events/",
    headers: [
      ["Authorization", `Bearer ${f.token}`],
      ["Accept", "text/event-stream"],
    ],
    signal: controller.signal,
    timeoutMs: 5000,
  });
  try {
    await partial.until(() => partial.wireBytes.includes(Buffer.from("id: ev_")));
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
  const resumed = f.stream("events/");
  await resumed.until(() => eventFrames(resumed).length === 1);
  expect(decoded(eventFrames(resumed)[0]!).subject).toBe(`${scope}beads/a`);
});

it("Event pre-abort writes no headers and idle close cancels the shared stream cleanly", async () => {
  const disconnect = await import(new URL("../dist/node-http-disconnect.js", import.meta.url).href);
  const serviceModule = await import(
    new URL("../dist/transaction-service.js", import.meta.url).href
  );
  const controller = new AbortController(),
    actual = serviceModule.createTransactionService;
  vi.spyOn(disconnect, "createNodeHttpDisconnectSignal").mockReturnValue(controller.signal);
  vi.spyOn(serviceModule, "createTransactionService").mockImplementation((...args: unknown[]) => {
    const service = actual(...args);
    return {
      ...service,
      stream(...input: unknown[]) {
        controller.abort(new Error("Event pre-abort"));
        return service.stream(...input);
      },
    };
  });
  const aborted = await runtimeFixture(),
    r = aborted.stream("events/");
  await r.closed;
  expect(r.wireBytes.length).toBe(0);
  await aborted.runtime.close();
  vi.restoreAllMocks();
  const f = await runtimeFixture();
  await f.run([create("a")]);
  const finite = await f.finite("beads/a?view=events"),
    live = f.stream("beads/a?view=events", [["Last-Event-ID", finite.events.at(-1)!.id]]);
  await live.ready;
  await f.runtime.close();
  await live.closed;
  expect(live.status).toBe(200);
  expect(eventFrames(live)).toEqual([]);
});
it("disconnect during an Event minimum wait releases the request without capturing a stream slot", async () => {
  const f = await runtimeFixture();
  await f.run([create("a")]);
  const head = f.stream("events/", [], "HEAD");
  await head.closed;
  const waiting = f.stream("events/", [
    ["BDP-Scope-Epoch", head.headers["bdp-scope-epoch"]!],
    ["BDP-Authorization-View", head.headers["bdp-authorization-view"]!],
    ["BDP-Minimum-Scope-Position", "pos-99"],
  ]);
  await delay(3);
  await waiting.close();
  const live = f.stream("events/");
  await live.until(() => eventFrames(live).length === 1);
  expect(live.status).toBe(200);
  await live.close();
});

it("wire Event JSON uses the same normalized numeric value and escaping as finite JSON", async () => {
  const f = await runtimeFixture();
  const body = JSON.stringify({
    operations: [
      { ...create("literal"), properties: { n: 100, title: "café\n🦉", "10": "ten", "2": "two" } },
    ],
  }).replace('"n":100', '"n":1e2');
  const committed = await f.request("operations/batch", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "literal" },
    body,
  });
  expect(committed.status).toBe(200);
  const finite = await f.finite("events/"),
    live = f.stream("events/");
  await live.until(() => eventFrames(live).length === 1);
  const data = eventFrames(live)[0]!.split("\ndata: ")[1]!;
  expect(finite.pages[0]).toContain(data);
  expect(data).toContain('"n":100');
  expect(data).toContain("café\\n🦉");
  expect(eventFrames(live)[0]!.split("\n")).toHaveLength(3);
  await live.close();
});

it.each([
  ["application/json;q=0.8,text/event-stream;q=0.8", "application/json"],
  ["application/json;q=0.1,text/event-stream;q=0.9", "text/event-stream"],
  ["application/json;q=0.9,text/event-stream;q=0.1", "application/json"],
] as const)("Event Accept %s selects %s on the actual route", async (accept, media) => {
  const f = await runtimeFixture();
  await f.run([create("a")]);
  const response = f.stream("events/", [["Accept", accept]]);
  await response.ready;
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toBe(media);
  if (media === "application/json") {
    await response.closed;
    expect(JSON.parse(response.body).events).toHaveLength(1);
  } else await response.until(() => eventFrames(response).length === 1);
  await response.close();
});

it.each(["header-later", "header-earlier"] as const)(
  "GET delivers the header-selected suffix when both cursors are valid: %s",
  async (direction) => {
    const f = await runtimeFixture();
    for (const id of ["a", "b", "c"]) await f.run([create(id)]);
    const finite = await f.finite("events/"),
      first = finite.events[0]!.id,
      last = finite.events.at(-1)!.id;
    const later = direction === "header-later";
    const live = f.stream(`events/?after=${later ? first : last}`, [
      ["Last-Event-ID", later ? last : first],
    ]);
    await live.ready;
    expect(live.status).toBe(200);
    // A subsequent real marker bounds the observation. This does not infer an
    // empty suffix from a sleep or from headers arriving before the pump runs.
    await f.run([create("marker")]);
    await live.until(() =>
      eventFrames(live).some((frame) => decoded(frame).subject === `${scope}beads/marker`),
    );
    const delivered = eventFrames(live).map(decoded);
    expect(delivered.map((event) => event.subject)).toEqual(
      (later ? [] : [`${scope}beads/b`, `${scope}beads/c`]).concat(`${scope}beads/marker`),
    );
    expect(delivered.slice(0, -1).map((event) => event.id)).toEqual(
      later ? [] : finite.events.slice(1).map((event) => event.id),
    );
    expect(delivered).toHaveLength(later ? 1 : 3);
    await live.close();
  },
);

it("Event delivery receives the shared captured cadence object, separate from owner scan bounds", async () => {
  const configuration = await import(
    new URL("../dist/transaction-runtime-configuration.js", import.meta.url).href
  );
  const pumping = await import(new URL("../dist/transaction-sse.js", import.meta.url).href);
  const capture = configuration.captureTransactionRuntimeConfiguration;
  const shared = Object.freeze({
    pollMilliseconds: 17,
    heartbeatMilliseconds: 31,
    maximumStreams: 1,
  });
  vi.spyOn(configuration, "captureTransactionRuntimeConfiguration").mockImplementation(
    (...args: unknown[]) => {
      const captured = capture(...args);
      return {
        ...captured,
        settings: Object.freeze({ ...captured.settings, changefeedStream: shared }),
      };
    },
  );
  const actual = pumping.pumpTransactionEvents;
  let received: unknown;
  vi.spyOn(pumping, "pumpTransactionEvents").mockImplementation((...args: unknown[]) => {
    received = args[4];
    return actual(...args);
  });
  const f = await runtimeFixture();
  await f.run([create("a")]);
  const live = f.stream("events/");
  await live.until(() => eventFrames(live).length === 1);
  expect(received).toBe(shared);
  expect(received).toEqual({ pollMilliseconds: 17, heartbeatMilliseconds: 31, maximumStreams: 1 });
  await live.close();
});

it("publication cancels a queued Event frame before its drain permits another write", async () => {
  const boundary = cleanups.length,
    failures: unknown[] = [];
  let lease:
    | ReturnType<ReturnType<typeof openTransactionStore>["acquireAuthorizationLease"]>
    | undefined;
  let observed: Promise<unknown> | undefined;
  try {
    const f = ownerFixture(32);
    f.run([create("a"), create("b")]);
    const initial = f.owner.beginEventScan(`${scope}events/`);
    if (initial.kind !== "packet") throw Error("actual initial Event packet required");
    expect(initial.events).toHaveLength(2);
    lease = f.owner.acquireAuthorizationLease(initial.context);
    const firstWrite = Promise.withResolvers<void>();
    class BlockedSink extends Sink {
      override write(text: string) {
        this.chunks.push(text);
        firstWrite.resolve();
        return false;
      }
    }
    const sink = new BlockedSink();
    let pulls = 0;
    const pumping = pumpTransactionEvents(
      sink,
      initial,
      async (scan) => {
        pulls++;
        return f.owner.advanceEventScan(scan);
      },
      lease.signal,
    );
    observed = pumping.then(
      () => ({ completed: true }),
      (error: unknown) => error,
    );
    await Promise.race([
      firstWrite.promise,
      observed.then(() => {
        throw Error("Event pump ended before first-write barrier");
      }),
    ]);
    expect(sink.chunks).toEqual([transactionEventFrame(initial.events[0]!)]);
    expect(pulls).toBe(0);
    const policy = f.owner.replaceAuthorizationPolicy();
    expect(policy.generation).toBe(1);
    expect(lease.signal.aborted).toBe(true);
    sink.emit("drain");
    expect(await observed).toBe(lease.signal.reason);
    expect(sink.chunks).toEqual([transactionEventFrame(initial.events[0]!)]);
    expect(pulls).toBe(0);
    expect([
      sink.listenerCount("drain"),
      sink.listenerCount("close"),
      sink.listenerCount("error"),
    ]).toEqual([0, 0, 0]);
  } catch (error) {
    failures.push(error);
  } finally {
    // Closing the real owner aborts a pump if a pre-publication assertion failed.
    for (const close of cleanups.splice(boundary).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    lease?.release();
    if (observed) {
      try {
        await observed;
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "queued Event publication witness cleanup");
}, 5000);

it("gates initial Scope Event SSE opaque minima before scan packets", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { TransactionMinimumUnproved, TransactionMinimumFailure, TransactionMinimumUnsupported } =
    await import("./transaction-consistency.js");
  const f = ownerFixture();
  let seedCommits = 0;
  f.run([
    create("a"),
    create("b"),
    {
      operation: "createLink",
      id: "links/l",
      type: linkType,
      source: "beads/a",
      target: "beads/b",
      properties: { n: 0 },
    },
  ]);
  seedCommits++;
  type Minimum = import("./transaction-consistency.js").TransactionMinimum;
  const cases: {
    label: string;
    outcome: string;
    groupObserverActive: boolean;
    groupPrepareCalls: number | null;
    context?: import("./transaction-store.js").TransactionReadContext;
  }[] = [];
  let reads = 0,
    preparations = 0,
    observing = false;
  const scan = (
    label: string,
    sourceUrl: string,
    minimum?: Minimum | "unsupported",
    after?: string,
    invalidReconnect = false,
    admission?: "initial-scope-sse",
  ) => {
    reads++;
    preparations = 0;
    try {
      const result = f.owner.beginEventScan(sourceUrl, after, minimum, invalidReconnect, admission);
      cases.push({
        label,
        outcome: result.kind,
        groupObserverActive: observing,
        groupPrepareCalls: observing ? preparations : null,
        ...("context" in result ? { context: result.context } : {}),
      });
      return result;
    } catch (error) {
      cases.push({
        label,
        outcome: error instanceof Error ? error.constructor.name : "non-Error",
        groupObserverActive: observing,
        groupPrepareCalls: observing ? preparations : null,
        ...(error instanceof TransactionMinimumUnproved ||
        error instanceof TransactionMinimumFailure
          ? { context: error.context }
          : {}),
      });
      return error;
    }
  };
  const setup = scan("setup", `${scope}events/`, undefined, undefined, false, "initial-scope-sse");
  if (!setup || typeof setup !== "object" || !("kind" in setup) || setup.kind !== "packet")
    throw new Error("expected setup packet");
  const packet = setup as import("./transaction-store.js").TransactionEventPacket;
  expect(packet.events).toHaveLength(1);
  const minimum = {
    scopeEpoch: packet.context.scopeEpoch,
    authorizationView: packet.context.authorizationView,
    minimumPosition: "unknown",
  };
  const original = DatabaseSync.prototype.prepare;
  const observer = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
    this: InstanceType<typeof DatabaseSync>,
    sql,
  ) {
    if (/FROM groups/.test(sql)) preparations++;
    return original.call(this, sql);
  });
  observing = true;
  try {
    for (const position of ["unknown", "pos-01"]) {
      const result = scan(
        position,
        `${scope}events/`,
        { ...minimum, minimumPosition: position },
        undefined,
        false,
        "initial-scope-sse",
      );
      expect(result).toBeInstanceOf(TransactionMinimumUnproved);
      expect(result).toMatchObject({ context: packet.context });
    }
    const future = scan(
      "future",
      `${scope}events/`,
      { ...minimum, minimumPosition: "pos-2" },
      undefined,
      false,
      "initial-scope-sse",
    );
    expect(future).toBeInstanceOf(TransactionMinimumFailure);
    expect(future).toMatchObject({ reason: "behind", context: packet.context });
    for (const tuple of [
      { ...minimum, scopeEpoch: "foreign-epoch" },
      { ...minimum, authorizationView: "foreign-view" },
    ]) {
      expect(
        scan("foreign", `${scope}events/`, tuple, undefined, false, "initial-scope-sse"),
      ).toBeInstanceOf(TransactionMinimumUnsupported);
    }
    const strict = [
      scan("default", `${scope}events/`, minimum),
      scan("after", `${scope}events/`, minimum, packet.events[0]!.id, false, "initial-scope-sse"),
      scan("invalid-reconnect", `${scope}events/`, minimum, undefined, true, "initial-scope-sse"),
      scan("bead", `${scope}beads/a?view=events`, minimum, undefined, false, "initial-scope-sse"),
      scan("link", `${scope}links/l?view=events`, minimum, undefined, false, "initial-scope-sse"),
    ];
    for (const result of strict) {
      expect(result).toBeInstanceOf(TypeError);
      expect(result).toMatchObject({ message: "unsupported minimum tuple" });
    }
    expect(
      scan(
        "missing",
        `${scope}beads/missing?view=events`,
        "unsupported",
        undefined,
        false,
        "initial-scope-sse",
      ),
    ).toEqual({ kind: "missing", context: packet.context });
    expect(
      scan(
        "malformed",
        `${scope}events/`,
        { ...minimum, minimumPosition: "" },
        undefined,
        false,
        "initial-scope-sse",
      ),
    ).toBeInstanceOf(TypeError);
    const positive = scan(
      "known",
      `${scope}events/`,
      { ...minimum, minimumPosition: packet.context.scopePosition },
      undefined,
      false,
      "initial-scope-sse",
    );
    expect(positive).toMatchObject({
      kind: "packet",
      context: packet.context,
      events: packet.events,
    });
    expect(reads).toBe(14);
    expect(cases[0]).toMatchObject({ groupObserverActive: false, groupPrepareCalls: null });
    for (const row of cases.slice(1, 13)) expect(row.groupPrepareCalls).toBe(0);
    expect(cases[13]!.groupPrepareCalls).toBeGreaterThan(0);
  } finally {
    observer.mockRestore();
  }
  console.log(
    JSON.stringify({ observation: "scope-event-sse-minimum-owner", reads, seedCommits, cases }),
  );
});

// Appended src-graph fixture; the historical owner/runtime helpers above are unchanged.
async function scopeSseMinimumService() {
  const { createTransactionService } = await import("./transaction-service.js");
  const { TransactionMinimumUnproved, TransactionMinimumFailure } = await import(
    "./transaction-consistency.js"
  );
  const f = ownerFixture();
  let seedCommits = 0;
  const receipt = f.run([create("a")]);
  seedCommits++;
  let interveningCommits = 0,
    ownerCloseCalls = 0,
    serviceCalls = 0,
    waits = 0,
    clockCalls = 0,
    now = 0,
    cursor = 0;
  const entered = Promise.withResolvers<void>(),
    latch = Promise.withResolvers<void>(),
    controller = new AbortController();
  const attempts: {
    minimum: unknown;
    outcome: string;
    context?: import("./transaction-store.js").TransactionReadContext;
  }[] = [];
  const owner = {
    ...f.owner,
    beginEventScan(...args: Parameters<typeof f.owner.beginEventScan>) {
      const minimum = args[2] === undefined ? null : structuredClone(args[2]);
      try {
        const result = f.owner.beginEventScan(...args);
        attempts.push({
          minimum,
          outcome: result.kind,
          ...("context" in result ? { context: result.context } : {}),
        });
        return result;
      } catch (error) {
        attempts.push({
          minimum,
          outcome: error instanceof Error ? error.constructor.name : "non-Error",
          ...(error instanceof TransactionMinimumUnproved ||
          error instanceof TransactionMinimumFailure
            ? { context: error.context }
            : {}),
        });
        throw error;
      }
    },
    close() {
      ownerCloseCalls++;
      f.owner.close();
    },
  };
  const service = createTransactionService(owner, {
    ownerLifetime: "service",
    minimumReads: {
      budgetMs: 2,
      now: () => {
        clockCalls++;
        return now;
      },
      wait: async () => {
        waits++;
        entered.resolve();
        await latch.promise;
      },
    },
    read: {
      selectorLimits: { bytes: 4096, depth: 32, nodes: 256 },
      advertisedLimits: {
        page: { defaultItems: 1, maximumItems: 1 },
        selector: { bytes: 4096, depth: 32, nodes: 256 },
        cursorTtlMilliseconds: 1000,
      },
      pagination: {
        scope,
        defaultPageItems: 1,
        maxPageItems: 1,
        cursorTtlMs: 1000,
        retainedStateCapacity: 100,
        maxRetainedCursorPositionsPerSnapshot: 20,
        retainedSnapshotByteCapacity: 100000,
        retainedSnapshotNodeCapacity: 10000,
        maxOpaqueTokenLength: 64,
        tokenGenerationAttempts: 3,
        idleCleanup: "on-demand",
        clock: () => 1000,
        generateOpaqueToken: () => `scope_sse_${++cursor}`,
      },
    },
  });
  let closedSettled = false;
  const closed = service.closed.then(
    () => {
      closedSettled = true;
      return { ok: true as const };
    },
    (error: unknown) => {
      closedSettled = true;
      return { ok: false as const, error };
    },
  );
  const minimum = {
    scopeEpoch: receipt.scopeEpoch,
    authorizationView: receipt.authorizationView,
    minimumPosition: "unknown",
  };
  let closing: ReturnType<typeof service.close> | undefined;
  const close = () => {
    closing ??= service.close();
    void closing.catch(() => {});
    return closing;
  };
  const probes: { call: number; outcome: string }[] = [];
  const call = (tuple: typeof minimum) => {
    serviceCalls++;
    try {
      const operation = service.beginEvents(
        `${scope}events/`,
        undefined,
        tuple,
        controller.signal,
        false,
        "initial-scope-sse",
      );
      probes.push({ call: serviceCalls, outcome: "promise-returned" });
      return operation;
    } catch (error) {
      probes.push({
        call: serviceCalls,
        outcome: error instanceof Error ? error.constructor.name : "non-Error",
      });
      throw error;
    }
  };
  type Outcome =
    | { ok: true; value: Awaited<ReturnType<typeof call>> }
    | { ok: false; error: unknown };
  let operation: Promise<Outcome> | undefined;
  const start = () => {
    operation = call(minimum).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    return operation;
  };
  const waitEntered = async () => {
    if (!operation) throw new Error("operation not started");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        entered.promise,
        operation.then(() => {
          throw new Error("minimum settled before held wait");
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("held wait entry guard")), 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const cleanup = async (failures: unknown[]) => {
    controller.abort();
    latch.resolve();
    if (operation) await operation;
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
    const outcome = await closed;
    if (!outcome.ok) failures.push(outcome.error);
  };
  return {
    service,
    owner: f.owner,
    minimum,
    controller,
    call,
    start,
    waitEntered,
    close,
    closed,
    cleanup,
    release: () => latch.resolve(),
    setNow: (value: number) => {
      now = value;
    },
    closedSettled: () => closedSettled,
    async advance() {
      const result = await service.submit({
        carrier: { kind: "batch" },
        body: JSON.stringify({ operations: [create("b")] }),
        key: "scope-sse-advance",
        authorization: { kind: "authorized", principal: "p" },
        receiving: { acceptsJson: true, maximumOperations: 1 },
      });
      expect(result).toMatchObject({
        kind: "receipt",
        receipt: { status: "completed", requiredPosition: "pos-2" },
      });
      interveningCommits++;
    },
    counts: () => ({
      seedCommits,
      interveningCommits,
      serviceCalls,
      ownerAttempts: attempts.length,
      waits,
      clockCalls,
      ownerCloseCalls,
    }),
    attempts,
    probes,
  };
}

it("captures initial Scope Event SSE minima once and recaptures context on retry", async () => {
  const { TransactionMinimumFailure } = await import("./transaction-consistency.js");
  const f = await scopeSseMinimumService();
  const failures: unknown[] = [];
  let finalContext: unknown;
  try {
    expect(() => f.call({ ...f.minimum, minimumPosition: "" })).toThrow(TypeError);
    expect(f.counts()).toMatchObject({ ownerAttempts: 0, clockCalls: 0 });
    const captured = { ...f.minimum };
    const observed = f.start();
    await f.waitEntered();
    f.minimum.scopeEpoch = "mutated-epoch";
    f.minimum.authorizationView = "mutated-view";
    f.minimum.minimumPosition = "pos-99";
    await f.advance();
    f.setNow(2);
    f.release();
    const outcome = await observed;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unknown minimum unexpectedly admitted");
    expect(outcome.error).toBeInstanceOf(TransactionMinimumFailure);
    expect(outcome.error).toMatchObject({ reason: "catch-up-timeout" });
    if (!(outcome.error instanceof TransactionMinimumFailure)) throw outcome.error;
    finalContext = outcome.error.context;
    expect(outcome.error.context).toEqual({
      scopeEpoch: captured.scopeEpoch,
      authorizationView: captured.authorizationView,
      scopePosition: "pos-2",
    });
    const known = { ...captured, minimumPosition: "pos-2" };
    const positive = await f.call(known);
    expect(positive.kind).toBe("packet");
    expect(f.attempts.map((attempt) => attempt.minimum)).toEqual([captured, captured, known]);
    expect(f.attempts.slice(0, 2).map((attempt) => attempt.outcome)).toEqual([
      "TransactionMinimumUnproved",
      "TransactionMinimumUnproved",
    ]);
    expect(f.attempts.map((attempt) => attempt.context?.scopePosition)).toEqual([
      "pos-1",
      "pos-2",
      "pos-2",
    ]);
    await f.close();
    expect(() => f.call({ ...known, minimumPosition: "" })).toThrow(TypeError);
    expect(() => f.call(known)).toThrow("closing or closed");
    expect(f.probes.map((probe) => probe.outcome)).toEqual([
      "TypeError",
      "promise-returned",
      "promise-returned",
      "TypeError",
      "Error",
    ]);
    expect(f.counts()).toMatchObject({
      serviceCalls: 5,
      ownerAttempts: 3,
      waits: 1,
      clockCalls: 4,
      seedCommits: 1,
      interveningCommits: 1,
    });
  } catch (error) {
    failures.push(error);
  } finally {
    await f.cleanup(failures);
  }
  console.log(
    JSON.stringify({
      observation: "scope-event-sse-minimum-capture",
      ...f.counts(),
      attempts: f.attempts,
      probes: f.probes,
      finalContext,
      closed: f.closedSettled(),
      failureCount: failures.length,
    }),
  );
  if (failures.length) throw new AggregateError(failures, "Scope SSE minimum capture failed");
});

it("drains an aborted initial Scope Event SSE minimum wait before owner close", async () => {
  const { ScopeServerOperationAbortedError } = await import("./read-request.js");
  const f = await scopeSseMinimumService();
  const failures: unknown[] = [];
  let rawPostCloseProbes = 0,
    operationOutcome = "not-observed",
    synchronouslyUnsettled = false;
  try {
    const observed = f.start();
    await f.waitEntered();
    const closing = f.close();
    synchronouslyUnsettled = !f.closedSettled();
    expect(synchronouslyUnsettled).toBe(true);
    f.controller.abort();
    f.release();
    const outcome = await observed;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("aborted minimum unexpectedly admitted");
    expect(outcome.error).toBeInstanceOf(ScopeServerOperationAbortedError);
    operationOutcome = "aborted";
    await closing;
    expect(await f.closed).toEqual({ ok: true });
    expect(() => f.call({ ...f.minimum, minimumPosition: "pos-1" })).toThrow("closing or closed");
    rawPostCloseProbes++;
    expect(() => f.owner.beginEventScan(`${scope}events/`)).toThrow();
    expect(f.counts()).toMatchObject({
      serviceCalls: 2,
      ownerAttempts: 1,
      waits: 1,
      clockCalls: 2,
      seedCommits: 1,
      ownerCloseCalls: 1,
    });
  } catch (error) {
    failures.push(error);
  } finally {
    await f.cleanup(failures);
  }
  console.log(
    JSON.stringify({
      observation: "scope-event-sse-minimum-abort",
      ...f.counts(),
      rawPostCloseProbes,
      probes: f.probes,
      operationOutcome,
      synchronouslyUnsettled,
      closed: f.closedSettled(),
      failureCount: failures.length,
    }),
  );
  if (failures.length) throw new AggregateError(failures, "Scope SSE minimum abort failed");
});

it("serves initial Scope Event SSE opaque minima before conditional admission", async () => {
  const f = await runtimeFixture();
  const started = performance.now();
  const records: {
    ordinal: number;
    method: string;
    target: string;
    status: number;
    bodyBytes: number;
    context: Record<string, string | undefined>;
  }[] = [];
  const baselinePages: {
    target: string;
    eventCount: number;
    next: string | null;
    context: Record<string, string | undefined>;
  }[] = [];
  const baseline: import("./transaction-batch.js").TransactionEvent[] = [];
  const failures: unknown[] = [];
  let requests = 0,
    seedCommits = 0;
  let expectedContext: Record<string, string> = {};
  let positive: ReturnType<typeof recordRawSse> | undefined;
  const positiveController = new AbortController();
  let positiveEvidence: unknown;
  const names = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
  const safeContext = (headers: Record<string, string>) =>
    Object.fromEntries(names.map((name) => [name, headers[name]]));
  function begin() {
    expect(++requests).toBeLessThanOrEqual(31);
  }
  function record(
    method: string,
    target: string,
    status: number,
    body: string,
    headers: Record<string, string>,
  ) {
    records.push({
      ordinal: requests,
      method,
      target,
      status,
      bodyBytes: Buffer.byteLength(body),
      context: safeContext(headers),
    });
  }
  const finite = async (target: string, init: RequestInit = {}) => {
    begin();
    const response = await f.request(target, init);
    const text = await response.text();
    const headers = Object.fromEntries(response.headers);
    record(init.method ?? "GET", target, response.status, text, headers);
    expect(response.status).toBe(200);
    return { body: JSON.parse(text), headers };
  };
  const raw = async (
    target: string,
    headers: [string, string][],
    status: number,
    method: "GET" | "HEAD" = "GET",
    authenticated = true,
  ) => {
    begin();
    const stream = f.stream(target, headers, method, authenticated);
    const ready = stream.ready.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const closed = stream.closed.then(() => undefined);
    try {
      const outcome = await ready;
      if (!outcome.ok) throw outcome.error;
      if (method === "HEAD" || status !== 200) await closed;
      expect(stream.status).toBe(status);
      record(method, target, stream.status, stream.body, stream.headers);
      expect(eventFrames(stream)).toHaveLength(0);
      if (method === "HEAD") expect(stream.body).toBe("");
      for (const name of ["etag", "last-modified"]) expect(stream.headers[name]).toBeUndefined();
      if (status === 503) {
        expect(stream.headers).toMatchObject({
          ...expectedContext,
          "content-type": "application/problem+json",
          "retry-after": "1",
          "cache-control": "private, no-store",
        });
        if (method === "GET")
          expect(JSON.parse(stream.body)).toEqual({
            type: "https://github.com/gastownhall/bdp/problems/unavailable",
            status: 503,
            code: "catch-up-timeout",
            retry: "after-delay",
          });
      } else if (status === 500) {
        expect(stream.headers["x-bdp-development-limit"]).toBe("minimum-position");
        expect(stream.body).toBe("");
        for (const name of names) expect(stream.headers[name]).toBeUndefined();
      } else if (status === 400 || status === 401) {
        for (const name of names) expect(stream.headers[name]).toBeUndefined();
        if (method === "GET")
          expect(JSON.parse(stream.body)).toMatchObject({
            status,
            code:
              status === 401
                ? "unauthenticated"
                : target === "events/?after="
                  ? "invalid-parameter"
                  : "malformed-request",
          });
      } else {
        expect(safeContext(stream.headers)).toEqual(expectedContext);
        if (status === 404)
          expect(JSON.parse(stream.body)).toMatchObject({
            status: 404,
            code: "resource-not-found",
          });
      }
      return { headers: { ...stream.headers }, body: stream.body };
    } finally {
      await stream.close();
      await closed;
    }
  };
  const pair = async (headers: [string, string][], status: number) => {
    const get = await raw("events/", headers, status);
    const head = await raw("events/", headers, status, "HEAD");
    expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(get.body)));
    expect(head.headers["content-type"]).toBe(get.headers["content-type"]);
    expect(safeContext(head.headers)).toEqual(safeContext(get.headers));
  };
  try {
    const seed = await finite("operations/batch", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "scope-sse-minimum-seed" },
      body: JSON.stringify({
        operations: [
          create("a"),
          create("b"),
          {
            operation: "createLink",
            id: "links/l",
            type: linkType,
            source: "beads/a",
            target: "beads/b",
            properties: { n: 0 },
          },
        ],
      }),
    });
    expect(seed.body).toMatchObject({
      status: "completed",
      effectPosition: "pos-1",
      requiredPosition: "pos-1",
    });
    seedCommits++;
    let target = "events/";
    for (const [index, count] of [2, 2, 1].entries()) {
      const page = await finite(target, { headers: { accept: "application/json" } });
      contextFields(page.headers);
      if (index === 0)
        expectedContext = Object.fromEntries(names.map((name) => [name, page.headers[name]!]));
      expect(safeContext(page.headers)).toEqual(expectedContext);
      expect(page.body.source).toBe(`${scope}events/`);
      expect(page.body.events).toHaveLength(count);
      baseline.push(...page.body.events);
      baselinePages.push({
        target,
        eventCount: page.body.events.length,
        next: page.body.next,
        context: safeContext(page.headers),
      });
      if (index < 2) {
        expect(typeof page.body.next).toBe("string");
        const next = new URL(page.body.next);
        const last = page.body.events.at(-1);
        expect(next.origin).toBe(new URL(scope).origin);
        expect(next.pathname).toBe("/acme/events/");
        expect([...next.searchParams.keys()]).toEqual(["after"]);
        expect(next.searchParams.get("after")).toBe(last.id);
        expect(next.hash).toBe("");
        target = next.href.slice(scope.length);
      } else expect(page.body.next).toBeNull();
    }
    expect(baseline).toHaveLength(5);
    expect(baseline.map((event) => event.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(baseline.map((event) => event.type)).toEqual([
      "created",
      "created",
      "created",
      "linked",
      "linked",
    ]);
    expect(baseline.map((event) => event.subject)).toEqual([
      `${scope}beads/a`,
      `${scope}beads/b`,
      `${scope}links/l`,
      `${scope}links/l`,
      `${scope}links/l`,
    ]);
    for (const event of baseline)
      expect(event).toMatchObject({
        source: `${scope}events/`,
        transaction: seed.body.transaction,
      });
    expect(baseline[3]!.data).toMatchObject({
      endpoint: "source",
      link: { id: `${scope}links/l`, type: linkType },
    });
    expect(baseline[4]!.data).toMatchObject({
      endpoint: "target",
      link: { id: `${scope}links/l`, type: linkType },
    });
    const minimum = (position: string): [string, string][] => [
      ["BDP-Scope-Epoch", expectedContext["bdp-scope-epoch"]!],
      ["BDP-Authorization-View", expectedContext["bdp-authorization-view"]!],
      ["BDP-Minimum-Scope-Position", position],
    ];
    const known = minimum("pos-1"),
      opaque = minimum("unknown"),
      after = baseline[0]!.id;
    const knownHead = await raw("events/", known, 200, "HEAD");
    expect(knownHead.headers["content-type"]).toBe("text/event-stream");
    expect(knownHead.headers["content-length"]).toBeUndefined();
    await pair(opaque, 503);
    await pair(minimum("pos-01"), 503);
    await pair([...opaque, ["If-None-Match", "*"]], 503);
    await pair([...opaque, ["If-Match", '"wrong"']], 503);
    await pair([["BDP-Minimum-Scope-Position", "unknown"]], 400);
    await pair(minimum("pos-2"), 503);
    await raw("events/", [["BDP-Scope-Epoch", "foreign-epoch"], ...opaque.slice(1)], 500);
    await raw("events/", [opaque[0]!, ["BDP-Authorization-View", "foreign-view"], opaque[2]!], 500);
    await raw(`events/?after=${encodeURIComponent(after)}`, opaque, 500);
    await raw("events/?after=", opaque, 400);
    await raw("events/", [...opaque, ["Last-Event-ID", after]], 500);
    await raw("events/", [...opaque, ["Last-Event-ID", ""]], 500);
    await raw("events/", [...opaque, ["Last-Event-ID", after], ["Last-Event-ID", after]], 500);
    await raw("beads/a?view=events", opaque, 500);
    await raw("links/l?view=events", opaque, 500);
    await raw("beads/missing?view=events", opaque, 404);
    await raw("events/", opaque, 401, "GET", false);
    await raw("events/", [...known, ["If-None-Match", "*"]], 304, "HEAD");
    await raw("events/", [...known, ["If-Match", '"wrong"']], 412, "HEAD");
    begin();
    const stream = recordRawSse({
      dial: f.runtime.listenUrl,
      host: new URL(f.runtime.listenUrl).host,
      target: "/acme/events/",
      headers: [["Authorization", `Bearer ${f.token}`], ["Accept", "text/event-stream"], ...known],
      signal: positiveController.signal,
      timeoutMs: 5000,
    });
    positive = stream;
    const ready = stream.ready.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const closed = stream.closed.then(() => undefined);
    const readyResult = await ready;
    if (!readyResult.ok) throw readyResult.error;
    expect(stream.status).toBe(200);
    expect(stream.headers).toMatchObject({
      ...expectedContext,
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
    });
    expect(stream.headers["etag"]).toBeUndefined();
    expect(stream.headers["content-length"]).toBeUndefined();
    await stream.until(() => eventFrames(stream).length >= 5);
    const before = [...eventFrames(stream)];
    const sameFrames = (frames: string[]) => {
      expect(frames).toHaveLength(5);
      expect(frames.map(decoded)).toEqual(baseline);
      frames.forEach((frame, index) => {
        expect(frame.split("\n").filter((line) => line.startsWith("id: "))).toEqual([
          `id: ${baseline[index]!.id}`,
        ]);
        expect(frame.split("\n").filter((line) => line.startsWith("event: "))).toEqual([
          `event: ${baseline[index]!.type}`,
        ]);
      });
    };
    sameFrames(before);
    expect(() =>
      sameFrames([before[0]!.replace("id: ", "id: wrong_"), ...before.slice(1)]),
    ).toThrow();
    expect(positiveController.signal.aborted).toBe(false);
    expect(stream.destroyed).toBe(false);
    expect(stream.elapsedMs).toBeLessThan(5000);
    const liveBeforeClose = {
      aborted: positiveController.signal.aborted,
      destroyed: stream.destroyed,
      elapsedMs: stream.elapsedMs,
    };
    await stream.close();
    await closed;
    const afterDrain = [...eventFrames(stream)];
    sameFrames(afterDrain);
    record("GET", "events/", stream.status, stream.body, stream.headers);
    positiveEvidence = {
      ready: true,
      status: stream.status,
      headers: { ...stream.headers },
      framesBeforeClose: before,
      framesAfterDrain: afterDrain,
      liveBeforeClose,
      drained: true,
    };
    expect(requests).toBe(31);
    expect(records).toHaveLength(31);
    expect(
      records.reduce<Record<string, number>>((counts, row) => {
        counts[row.status] = (counts[row.status] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({ 200: 6, 503: 10, 500: 8, 400: 3, 404: 1, 401: 1, 304: 1, 412: 1 });
  } catch (error) {
    failures.push(error);
  } finally {
    positiveController.abort();
    try {
      await positive?.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await f.runtime.close();
    } catch (error) {
      failures.push(error);
    }
  }
  console.log(
    JSON.stringify({
      observation: "scope-event-sse-minimum-http",
      requests,
      records,
      seedCommits,
      elapsedMs: performance.now() - started,
      baselinePages,
      positive: positiveEvidence,
      failureCount: failures.length,
    }),
  );
  if (failures.length) throw new AggregateError(failures, "Scope SSE HTTP minimum failed");
});
