import { createServer as createHttpServer } from "node:http";
import { createServer, type Server, Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFetchHttpExchangeExecutor,
  createRawHttpExchangeExecutor,
  type RawHttpDialRoute,
} from "./http-executor.js";

describe("raw HTTP exchange executor", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers
        .splice(0)
        .map(
          (server) =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error === undefined ? resolve() : reject(error))),
            ),
        ),
    );
  });

  it("keeps canonical Scope identity separate from the dial route", async () => {
    let requestHead = "";
    const rawResponse =
      "HTTP/1.1 200 Unusual Reason\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}";
    const route = await listen((socket) => {
      socket.once("data", (bytes) => {
        requestHead = bytes.toString("latin1");
        socket.end(rawResponse);
      });
    });

    const execute = createRawHttpExchangeExecutor(route);
    const response = await execute({
      method: "GET",
      url: "https://scope.example/acme/bdp.json",
      headers: { accept: "application/json" },
      signal: new AbortController().signal,
    });

    expect(requestHead).toMatch(/^GET \/acme\/bdp\.json HTTP\/1\.1\r\n/);
    expect(requestHead).toContain("\r\nHost: scope.example\r\n");
    expect(Buffer.from(response.wireResponseBytes ?? []).toString("latin1")).toBe(rawResponse);
    expect(response).toMatchObject({
      url: "https://scope.example/acme/bdp.json",
      status: 200,
      bodyText: "{}",
      bodyOctets: 2,
      effectiveRequest: {
        url: "https://scope.example/acme/bdp.json",
        headersTransmitted: true,
      },
    });
  });

  it("writes an exact raw request target while retaining canonical URL identity and Host", async () => {
    let requestHead = Buffer.alloc(0);
    const route = await listen((socket) => {
      socket.on("data", (bytes) => {
        requestHead = Buffer.concat([requestHead, bytes]);
        if (requestHead.indexOf("\r\n\r\n", 0, "latin1") !== -1)
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      });
    });
    const rawRequestTarget = Uint8Array.from(
      Buffer.from("http://authority.example//acme\\beads/%2f?next=%252F", "ascii"),
    );

    const response = await createRawHttpExchangeExecutor(route)({
      method: "GET",
      url: "https://scope.example/canonical/path?canonical=true",
      headers: {},
      signal: new AbortController().signal,
      rawRequestTarget,
    });

    const lineEnd = requestHead.indexOf("\r\n", 0, "latin1");
    expect(requestHead.subarray(0, lineEnd)).toEqual(
      Buffer.concat([
        Buffer.from("GET ", "ascii"),
        Buffer.from(rawRequestTarget),
        Buffer.from(" HTTP/1.1", "ascii"),
      ]),
    );
    expect(requestHead.toString("latin1")).toContain("\r\nHost: scope.example\r\n");
    expect(response).toMatchObject({
      url: "https://scope.example/canonical/path?canonical=true",
      effectiveRequest: { url: "https://scope.example/canonical/path?canonical=true" },
    });
  });

  it("bounds exact raw request targets at 8 KiB", async () => {
    let requestHead = Buffer.alloc(0);
    const route = await listen((socket) => {
      socket.on("data", (bytes) => {
        requestHead = Buffer.concat([requestHead, bytes]);
        if (requestHead.indexOf("\r\n\r\n", 0, "latin1") !== -1)
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      });
    });
    await expect(
      createRawHttpExchangeExecutor(route)({
        method: "GET",
        url: "https://scope.example/",
        headers: {},
        signal: new AbortController().signal,
        rawRequestTarget: new Uint8Array(8_192).fill(0x2f),
      }),
    ).resolves.toMatchObject({ status: 200 });
    expect(requestHead.indexOf(" HTTP/1.1", 0, "latin1") - Buffer.byteLength("GET ")).toBe(8_192);

    const execute = createRawHttpExchangeExecutor({
      transport: "plain",
      host: "127.0.0.1",
      port: 1,
    });

    await expect(
      execute({
        method: "GET",
        url: "https://scope.example/",
        headers: {},
        signal: new AbortController().signal,
        rawRequestTarget: new Uint8Array(8_193).fill(0x2f),
      }),
    ).rejects.toMatchObject({ category: "configuration" });
  });

  it.each([
    ["SP", 0x20],
    ["CR", 0x0d],
    ["LF", 0x0a],
  ])("rejects %s in an exact raw request target", async (_name, prohibitedOctet) => {
    const execute = createRawHttpExchangeExecutor({
      transport: "plain",
      host: "127.0.0.1",
      port: 1,
    });

    await expect(
      execute({
        method: "GET",
        url: "https://scope.example/",
        headers: {},
        signal: new AbortController().signal,
        rawRequestTarget: Uint8Array.from([0x2f, prohibitedOctet, 0x78]),
      }),
    ).rejects.toMatchObject({ category: "configuration" });
  });

  it("rejects exact raw request targets through the Fetch executor", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(
      createFetchHttpExchangeExecutor(fetchImplementation)({
        method: "GET",
        url: "https://scope.example/canonical",
        headers: {},
        signal: new AbortController().signal,
        rawRequestTarget: Uint8Array.from(Buffer.from("//noncanonical", "ascii")),
      }),
    ).rejects.toMatchObject({ category: "configuration" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("keeps the request socket open while a Node HTTP server prepares a delayed response", async () => {
    let requestAborted = false;
    const server = createHttpServer((request, response) => {
      request.once("aborted", () => {
        requestAborted = true;
      });
      setTimeout(() => {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end("{}");
      }, 25);
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");

    await expect(
      createRawHttpExchangeExecutor({
        transport: "plain",
        host: "127.0.0.1",
        port: address.port,
      })({
        method: "GET",
        url: "https://scope.example/acme/beads/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: 200, bodyText: "{}" });
    expect(requestAborted).toBe(false);
  });

  it("does not truncate a Content-Length response written in delayed segments", async () => {
    const body = JSON.stringify({ items: ["A", "B", "C"] });
    let responseClosedEarly = false;
    const server = createHttpServer((_request, response) => {
      response.once("close", () => {
        responseClosedEarly = !response.writableFinished;
      });
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.setHeader("content-length", Buffer.byteLength(body));
      response.write(body.slice(0, 8));
      setTimeout(() => response.end(body.slice(8)), 25);
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");

    await expect(
      createRawHttpExchangeExecutor({
        transport: "plain",
        host: "127.0.0.1",
        port: address.port,
      })({
        method: "GET",
        url: "https://scope.example/acme/beads/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: 200, bodyText: body });
    expect(responseClosedEarly).toBe(false);
  });

  it("half-closes only after a complete chunked response so peer FIN cannot stall", async () => {
    const route = await listen((socket) => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
        );
        socket.once("end", () => socket.end());
      });
    });

    await expect(
      createRawHttpExchangeExecutor(route, { requestTimeoutMs: 250 })({
        method: "GET",
        url: "https://scope.example/acme/beads/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: 200, bodyText: "{}" });
  });

  it("observes illegal octets sent after a HEAD response", async () => {
    const route = await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
        );
      });
    });

    const response = await createRawHttpExchangeExecutor(route)({
      method: "HEAD",
      url: "https://scope.example/acme/beads/",
      headers: {},
      signal: new AbortController().signal,
    });

    expect(response.bodyText).toBe("hello");
    expect(response.bodyOctets).toBe(5);
  });

  it("accepts a HEAD response that advertises the GET length but sends no body octets", async () => {
    const route = await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 123\r\nConnection: close\r\n\r\n",
        );
      });
    });

    const response = await createRawHttpExchangeExecutor(route)({
      method: "HEAD",
      url: "https://scope.example/acme/beads/",
      headers: {},
      signal: new AbortController().signal,
    });

    expect(response.bodyText).toBe("");
    expect(response.bodyOctets).toBe(0);
  });

  it("preserves a UTF-8 BOM in a GET body so decoded and wire octets stay attributable", async () => {
    const route = await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          Buffer.concat([
            Buffer.from(
              "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 5\r\nConnection: close\r\n\r\n",
              "latin1",
            ),
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from("{}"),
          ]),
        );
      });
    });

    const response = await createRawHttpExchangeExecutor(route)({
      method: "GET",
      url: "https://scope.example/acme/",
      headers: {},
      signal: new AbortController().signal,
    });

    expect(response.bodyText).toBe("\uFEFF{}");
    expect(response.bodyOctets).toBe(5);
  });

  it("preserves BOM-only octets after HEAD for the body-absence oracle", async () => {
    const route = await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          Buffer.concat([
            Buffer.from(
              "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n",
              "latin1",
            ),
            Buffer.from([0xef, 0xbb, 0xbf]),
          ]),
        );
      });
    });

    const response = await createRawHttpExchangeExecutor(route)({
      method: "HEAD",
      url: "https://scope.example/acme/",
      headers: {},
      signal: new AbortController().signal,
    });

    expect(response.bodyText).toBe("\uFEFF");
    expect(response.bodyOctets).toBe(3);
  });

  it("destroys the active socket and settles when the caller aborts", async () => {
    const destroy = vi.spyOn(Socket.prototype, "destroy");
    let acceptSocket!: (socket: Socket) => void;
    const accepted = new Promise<Socket>((resolve) => {
      acceptSocket = resolve;
    });
    const route = await listen((socket) => {
      socket.resume();
      acceptSocket(socket);
    });
    const controller = new AbortController();
    const exchange = createRawHttpExchangeExecutor(route)({
      method: "GET",
      url: "https://scope.example/acme/",
      headers: {},
      signal: controller.signal,
    });
    const socket = await accepted;

    controller.abort();

    await expect(exchange).rejects.toMatchObject({ category: "abort" });
    const clientSocket = destroy.mock.contexts.find(
      (candidate): candidate is Socket =>
        candidate instanceof Socket && candidate !== socket && candidate.destroyed,
    );
    expect(clientSocket).toBeDefined();
    expect(clientSocket?.listenerCount("error")).toBe(1);
    expect(() => clientSocket?.emit("error", new Error("late reset"))).not.toThrow();
    await closePeer(socket);
  });

  it("classifies a response that disconnects before Content-Length", async () => {
    const route = await listen((socket) => {
      socket.once("data", () => {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhi");
      });
    });

    await expect(
      createRawHttpExchangeExecutor(route)({
        method: "GET",
        url: "https://scope.example/acme/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "disconnect" });
  });

  it("classifies a peer that closes before completing response headers", async () => {
    const route = await listen((socket) => {
      socket.once("data", () => socket.end("HTTP/1.1 200"));
    });

    await expect(
      createRawHttpExchangeExecutor(route)({
        method: "GET",
        url: "https://scope.example/acme/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "disconnect" });
  });

  it("rejects ambiguous and malformed response framing", async () => {
    const ambiguous = await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n",
        );
      });
    });
    await expect(
      createRawHttpExchangeExecutor(ambiguous)({
        method: "GET",
        url: "https://scope.example/acme/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "invalid-body" });

    const malformedChunk = await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n1\r\naX\r\n0\r\n\r\n",
        );
      });
    });
    await expect(
      createRawHttpExchangeExecutor(malformedChunk)({
        method: "GET",
        url: "https://scope.example/acme/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "invalid-body" });
  });

  it("decodes bounded chunked bodies and rejects bytes after trailers", async () => {
    const valid = await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\n{}\r\n0\r\nX-Trace: ok\r\n\r\n",
        );
      });
    });
    await expect(
      createRawHttpExchangeExecutor(valid)({
        method: "GET",
        url: "https://scope.example/acme/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ bodyText: "{}", bodyOctets: 2 });

    const trailing = await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\nX-Trace: ok\r\n\r\nextra",
        );
      });
    });
    await expect(
      createRawHttpExchangeExecutor(trailing)({
        method: "GET",
        url: "https://scope.example/acme/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "invalid-body" });

    const delayedTrailing = await listen((socket) => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n",
        );
        setTimeout(() => socket.end("extra"), 25);
      });
    });
    await expect(
      createRawHttpExchangeExecutor(delayedTrailing)({
        method: "GET",
        url: "https://scope.example/acme/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "invalid-body" });
  });

  it("enforces configured header and decoded-body bounds", async () => {
    const oversizedHeaders = await listen((socket) => {
      socket.once("data", () => {
        socket.end(
          `HTTP/1.1 200 OK\r\nX-Oversized: ${"x".repeat(80)}\r\nContent-Length: 0\r\n\r\n`,
        );
      });
    });
    await expect(
      createRawHttpExchangeExecutor(oversizedHeaders, {
        maximumBodyBytes: 128,
        requestTimeoutMs: 30_000,
        maximumHeaderBytes: 64,
      })({
        method: "GET",
        url: "https://scope.example/acme/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "header-limit" });

    const oversizedBody = await listen((socket) => {
      socket.once("data", () => {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc");
      });
    });
    await expect(
      createRawHttpExchangeExecutor(oversizedBody, { maximumBodyBytes: 2 })({
        method: "GET",
        url: "https://scope.example/acme/",
        headers: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ category: "body-limit" });
  });

  it("times out an unresponsive peer and closes the socket", async () => {
    const destroy = vi.spyOn(Socket.prototype, "destroy");
    let acceptSocket!: (socket: Socket) => void;
    const accepted = new Promise<Socket>((resolve) => {
      acceptSocket = resolve;
    });
    const route = await listen((socket) => {
      socket.resume();
      acceptSocket(socket);
    });
    const exchange = createRawHttpExchangeExecutor(route, {
      maximumBodyBytes: 1024,
      requestTimeoutMs: 10,
    })({
      method: "GET",
      url: "https://scope.example/acme/",
      headers: {},
      signal: new AbortController().signal,
    });
    const socket = await accepted;

    await expect(exchange).rejects.toMatchObject({ category: "timeout" });
    expect(
      destroy.mock.contexts.some(
        (candidate) => candidate instanceof Socket && candidate !== socket && candidate.destroyed,
      ),
    ).toBe(true);
    await closePeer(socket);
  });

  it("validates TLS-only dial configuration before opening a socket", () => {
    expect(() =>
      createRawHttpExchangeExecutor({
        transport: "tls",
        host: "127.0.0.1",
        port: 443,
        servername: 7 as unknown as string,
      }),
    ).toThrow("dialRoute.servername must be a non-empty string when present");
    expect(() =>
      createRawHttpExchangeExecutor({
        transport: "tls",
        host: "127.0.0.1",
        port: 443,
        ca: 7 as unknown as string,
      }),
    ).toThrow("dialRoute.ca must be a non-empty string when present");
  });

  async function listen(onConnection: (socket: Socket) => void): Promise<RawHttpDialRoute> {
    const server = createServer({ allowHalfOpen: true }, onConnection);
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server did not bind");
    return { transport: "plain", host: "127.0.0.1", port: address.port };
  }

  async function closePeer(socket: Socket): Promise<void> {
    if (socket.destroyed) return;
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.end();
    });
  }
});
