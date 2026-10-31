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
