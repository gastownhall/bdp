import { createHash } from "node:crypto";
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

describe("exact HTTP request execution", () => {
  const servers = new Set<Server>();
  const sockets = new Set<Socket>();
  const scope = "https://scope.example/acme/";
  const url = `${scope}operations/create-bead`;
  const responseText = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}";

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await Promise.all(
      [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    servers.clear();
  });

  function mode(
    overrides: Partial<import("./http-executor.js").ExactHttpModeOptions> = {},
  ): import("./http-executor.js").ExactHttpModeOptions {
    return {
      scope,
      profile: "read-update",
      routes: [{ method: "POST", url }],
      maximumRequestHeaderBytes: 4096,
      maximumRequestBodyBytes: 1024,
      defaultCredentialRef: "anonymous",
      credentialHandles: [{ id: "anonymous", headerNames: [] }],
      resolveCredentials: () => ({}),
      ...overrides,
    };
  }
  function exact(
    bodyBytes: Uint8Array = Buffer.from("{}"),
  ): import("./http-executor.js").ExactHttpExchangeRequest {
    return {
      method: "POST",
      url,
      signal: new AbortController().signal,
      raw: {
        headerLines: [
          { name: "Content-Type", value: "application/json" },
          { name: "Idempotency-Key", value: "same" },
          { name: "iDeMpOtEnCy-KeY", value: "same" },
        ],
        bodyBytes,
      },
    };
  }
  async function bind(server: Server): Promise<RawHttpDialRoute> {
    servers.add(server);
    server.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    return { transport: "plain", host: "127.0.0.1", port: address.port };
  }
  function deadRoute(): RawHttpDialRoute {
    return { transport: "plain", host: "127.0.0.1", port: 1 };
  }

  it.each([
    Buffer.from('{"a":1,"\\u0061":2,"number":9007199254740993,"x":1e99999}'),
    Buffer.from('{"x":"\\uD800"}'),
    Buffer.from([0xc0, 0xaf, 0xff]),
    Buffer.alloc(0),
  ])(
    "preserves exact entity bytes and repeated fields at an actual Node HTTP receiver: %j",
    async (body) => {
      let received = Buffer.alloc(0);
      let rawHeaders: string[] = [];
      const route = await bind(
        createHttpServer((request, response) => {
          rawHeaders = request.rawHeaders;
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            received = Buffer.concat(chunks);
            response.end("{}");
          });
        }),
      );
      const result = await createRawHttpExchangeExecutor(route, { exactMode: mode() })(exact(body));
      expect(received).toEqual(body);
      expect(rawHeaders.slice(0, 6)).toEqual([
        "Content-Type",
        "application/json",
        "Idempotency-Key",
        "same",
        "iDeMpOtEnCy-KeY",
        "same",
      ]);
      expect(result.exactRequest).toMatchObject({
        source: "raw-http1-serializer",
        bodyPresent: true,
        bodyOctets: body.length,
        writeState: "complete",
      });
      expect(result.exactRequest?.bodyDigest).toBe(createHashForTest(body));
      expect(result.effectiveRequest).not.toHaveProperty("headersTransmitted");
    },
  );

  it("preserves padded field bytes and copies Buffer subarrays before the resolver can mutate them", async () => {
    const source = Buffer.from("!before!");
    const body = source.subarray(1, 7);
    const firstLine = { name: "Idempotency-Key", value: " \tkey,other " };
    const lines = [firstLine];
    let wire = Buffer.alloc(0);
    const route = await bind(
      createServer((socket) =>
        socket.on("data", (chunk: Buffer) => {
          wire = Buffer.concat([wire, chunk]);
          if (wire.includes(Buffer.from("before"))) socket.end(responseText);
        }),
      ),
    );
    const resolve = vi.fn(() => {
      source.fill(120);
      firstLine.value = "changed";
      return { Authorization: "Bearer sentinel-secret" };
    });
    const ordinary = vi.fn(() => ({ Authorization: "wrong-legacy" }));
    const result = await createRawHttpExchangeExecutor(route, {
      authorize: ordinary,
      exactMode: mode({
        defaultCredentialRef: "writer",
        credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
        resolveCredentials: resolve,
      }),
    })({ ...exact(body), raw: { headerLines: lines, bodyBytes: body } });
    expect(wire.toString("latin1")).toContain("Idempotency-Key:  \tkey,other \r\n");
    expect(wire.subarray(-6).toString()).toBe("before");
    expect(wire.toString()).toContain("Authorization: Bearer sentinel-secret");
    expect(resolve).toHaveBeenCalledOnce();
    expect(ordinary).not.toHaveBeenCalled();
    expect(Object.isFrozen(result.exactRequest?.headerLines)).toBe(true);
    expect(result.exactRequest?.headerLines[0]?.value).toBe(" \tkey,other ");
  });

  it.each([
    "Authorization",
    "AUTHORIZATION",
    "Cookie",
    "X-Auth-Token",
    "Host",
    "Content-Length",
    "Transfer-Encoding",
    "Expect",
    "Proxy-Connection",
  ])("rejects authored protected field %s before resolving credentials", async (name) => {
    const resolve = vi.fn(() => ({}));
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), {
        exactMode: mode({ resolveCredentials: resolve }),
      })({ ...exact(), raw: { headerLines: [{ name, value: "secret" }] } }),
    ).rejects.toMatchObject({ category: "configuration", requestWriteState: "not-started" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(["bad\r\nInjected: yes", "x\n", "x\r", "x\r\n", "x\0y", "\ud800", "\u0100"])(
    "rejects field injection/unrepresentable bytes %j",
    async (value) => {
      await expect(
        createRawHttpExchangeExecutor(deadRoute(), { exactMode: mode() })({
          ...exact(),
          raw: { headerLines: [{ name: "Idempotency-Key", value }] },
        }),
      ).rejects.toMatchObject({ category: "configuration" });
    },
  );

  it("refuses unsupported exact/Fetch forms without resolving legacy credentials or normalizing missing headers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const authorize = vi.fn(() => ({}));
    await expect(createFetchHttpExchangeExecutor(fetch, authorize)(exact())).rejects.toMatchObject({
      category: "configuration",
    });
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), { authorize })(exact()),
    ).rejects.toMatchObject({ category: "configuration", requestWriteState: "not-started" });
    await expect(
      createRawHttpExchangeExecutor(deadRoute())({
        method: "GET",
        url,
        signal: new AbortController().signal,
      } as never),
    ).rejects.toMatchObject({ category: "configuration" });
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), { exactMode: mode() })({
        ...exact(),
        headers: {},
      } as never),
    ).rejects.toMatchObject({ category: "configuration" });
    expect(fetch).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("checks body and authored-header caps before complete copies or credentials", async () => {
    const resolve = vi.fn(() => ({}));
    const body = new Uint8Array(1025);
    const bufferGetter = vi.fn(() => {
      throw new Error("must not inspect mutable buffer getter");
    });
    Object.defineProperty(body, "buffer", { get: bufferGetter });
    const execute = createRawHttpExchangeExecutor(deadRoute(), {
      exactMode: mode({ resolveCredentials: resolve, maximumRequestHeaderBytes: 64 }),
    });
    await expect(execute(exact(body))).rejects.toMatchObject({ category: "configuration" });
    await expect(
      execute({
        ...exact(),
        raw: { headerLines: [{ name: "Idempotency-Key", value: "x".repeat(1000) }] },
      }),
    ).rejects.toMatchObject({ category: "configuration" });
    expect(resolve).not.toHaveBeenCalled();
    expect(bufferGetter).not.toHaveBeenCalled();
  });

  it("rejects getters and asynchronous/foreign credential results without leaking them into errors", async () => {
    const getter = vi.fn(() => "secret");
    const line = Object.defineProperty({ name: "Idempotency-Key" }, "value", {
      get: getter,
      enumerable: true,
    });
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), { exactMode: mode() })({
        ...exact(),
        raw: { headerLines: [line] },
      } as never),
    ).rejects.toMatchObject({ category: "configuration" });
    expect(getter).not.toHaveBeenCalled();
    for (const result of [
      Promise.resolve({}),
      { Authorization: "sentinel-secret" },
      { "Content-Type": "sentinel-secret" },
    ]) {
      const execute = createRawHttpExchangeExecutor(deadRoute(), {
        exactMode: mode({ resolveCredentials: (() => result) as never }),
      });
      const error = await execute(exact()).catch((error: unknown) => error);
      expect(error).toMatchObject({ category: "configuration", requestWriteState: "not-started" });
      expect(JSON.stringify(error)).not.toContain("sentinel-secret");
    }
  });

  it.each([
    "https://evil.example/acme/operations/create-bead",
    "https://scope.example/other/",
    "https://scope.example/acme/%63reate",
    "https://scope.example/acme//x",
    `${url}#`,
    `${url}?other=1`,
  ])("refuses unconfigured/noncanonical URL %s before credentials", async (target) => {
    const resolve = vi.fn(() => ({}));
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), {
        exactMode: mode({ resolveCredentials: resolve }),
      })({ ...exact(), url: target }),
    ).rejects.toMatchObject({ category: "configuration", requestWriteState: "not-started" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("snapshots configured routes and handles and refuses a foreign raw audience with credentials", async () => {
    const routeEntry = { method: "POST" as const, url };
    const headerNames = ["authorization"];
    const configuration = mode({
      routes: [routeEntry],
      defaultCredentialRef: "writer",
      credentialHandles: [{ id: "writer", headerNames }],
      resolveCredentials: () => ({ Authorization: "sentinel-secret" }),
    });
    const execute = createRawHttpExchangeExecutor(deadRoute(), { exactMode: configuration });
    routeEntry.url = "https://evil.example/";
    headerNames.length = 0;
    await expect(
      execute({ ...exact(), rawRequestTarget: Buffer.from("https://evil.example/") }),
    ).rejects.toMatchObject({ category: "configuration", requestWriteState: "not-started" });
    await expect(execute({ ...exact(), credentialRef: "unknown" })).rejects.toMatchObject({
      category: "configuration",
    });
  });

  it("allows anonymous raw foreign-authority probes only at the configured peer and preserves absent entities", async () => {
    let wire = "";
    const route = await bind(
      createServer((socket) =>
        socket.once("data", (chunk) => {
          wire = chunk.toString();
          socket.end(responseText);
        }),
      ),
    );
    const result = await createRawHttpExchangeExecutor(route, { exactMode: mode() })({
      ...exact(),
      rawRequestTarget: Buffer.from("//foreign.example/acme/"),
      raw: { headerLines: [] },
    });
    expect(wire).toContain("POST //foreign.example/acme/ HTTP/1.1");
    expect(wire).toContain("Host: scope.example");
    expect(wire).not.toContain("Content-Length:");
    expect(result.exactRequest).toMatchObject({ bodyPresent: false, bodyOctets: 0 });
    expect(result.exactRequest).not.toHaveProperty("bodyDigest");
  });

  it("preserves a complete early refusal while the outbound body remains buffered", async () => {
    const route = await bind(
      createServer((socket) =>
        socket.once("data", () => {
          socket.pause();
          socket.end("HTTP/1.1 413 Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }),
      ),
    );
    const body = Buffer.alloc(32 * 1024 * 1024, 120);
    const result = await createRawHttpExchangeExecutor(route, {
      exactMode: mode({ maximumRequestBodyBytes: body.length }),
      requestTimeoutMs: 2000,
    })(exact(body));
    expect(result.status).toBe(413);
    expect(result.exactRequest).toMatchObject({
      writeState: "started-completion-unestablished",
      bodyOctets: body.length,
    });
    const saved = JSON.stringify(result.exactRequest);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(JSON.stringify(result.exactRequest)).toBe(saved);
  });

  it("distinguishes abort before write, during a large write, and after a received body", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), { exactMode: mode() })({
        ...exact(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ category: "abort", requestWriteState: "not-started" });
    const during = new AbortController();
    const route = await bind(
      createServer((socket) =>
        socket.once("data", () => {
          socket.pause();
          during.abort();
        }),
      ),
    );
    const body = Buffer.alloc(32 * 1024 * 1024);
    await expect(
      createRawHttpExchangeExecutor(route, {
        exactMode: mode({ maximumRequestBodyBytes: body.length }),
      })({ ...exact(body), signal: during.signal }),
    ).rejects.toMatchObject({
      category: "abort",
      requestWriteState: "started-completion-unestablished",
    });
    const after = new AbortController();
    const completedRoute = await bind(
      createHttpServer((request) => {
        request.resume();
        request.on("end", () => after.abort());
      }),
    );
    await expect(
      createRawHttpExchangeExecutor(completedRoute, { exactMode: mode() })({
        ...exact(),
        signal: after.signal,
      }),
    ).rejects.toMatchObject({ category: "abort", requestWriteState: "complete" });
  });

  it("includes credential work in the elapsed deadline", async () => {
    const execute = createRawHttpExchangeExecutor(deadRoute(), {
      requestTimeoutMs: 5,
      exactMode: mode({
        resolveCredentials: () => {
          const until = performance.now() + 10;
          while (performance.now() < until) {
            /* trusted synchronous work */
          }
          return {};
        },
      }),
    });
    await expect(execute(exact())).rejects.toMatchObject({
      category: "timeout",
      requestWriteState: "not-started",
    });
  });

  it.each([
    "HTTP/1.1 100 Continue\r\n\r\n",
    "HTTP/1.1 103 Early Hints\r\nLink: </x>\r\n\r\nHTTP/1.1 100 Continue\r\n\r\n",
  ])("consumes bounded informational heads before the final response: %s", async (prefix) => {
    const route = await bind(
      createServer((socket) =>
        socket.once("data", () => {
          socket.write(prefix.slice(0, 8));
          setTimeout(() => socket.end(prefix.slice(8) + responseText), 2);
        }),
      ),
    );
    const result = await createRawHttpExchangeExecutor(route, { exactMode: mode() })(exact());
    expect(result).toMatchObject({ status: 200, bodyText: "{}", bodyOctets: 2 });
    expect(Buffer.from(result.wireResponseBytes ?? []).toString()).toBe(prefix + responseText);
  });

  it.each([
    ["HTTP/1.1 100 Continue\r\n\r\n", "disconnect", 4096],
    ["HTTP/1.1 101 Switching Protocols\r\n\r\n", "invalid-body", 4096],
    [`HTTP/1.1 100 Continue\r\nContent-Length: 0\r\n\r\n${responseText}`, "invalid-body", 4096],
    ["HTTP/1.1 100 Continue\r\n\r\n".repeat(4) + responseText, "header-limit", 100],
  ] as const)("refuses informational framing %s", async (wire, category, cap) => {
    const route = await bind(createServer((socket) => socket.once("data", () => socket.end(wire))));
    await expect(
      createRawHttpExchangeExecutor(route, { exactMode: mode(), maximumHeaderBytes: cap })(exact()),
    ).rejects.toMatchObject({ category });
  });

  it("accepts actual body/header cap boundaries and refuses one octet below before credentials/dial", async () => {
    let lastHeadBytes = 0;
    const route = await bind(
      createServer((socket) => {
        let wire = Buffer.alloc(0);
        socket.on("data", (chunk: Buffer) => {
          wire = Buffer.concat([wire, chunk]);
          const end = wire.indexOf("\r\n\r\n");
          if (end !== -1 && wire.length >= end + 4 + 1024) {
            lastHeadBytes = end + 4;
            socket.end(responseText);
          }
        });
      }),
    );
    const body = Buffer.alloc(1024);
    await createRawHttpExchangeExecutor(route, { exactMode: mode() })(exact(body));
    const actualHeadBytes = lastHeadBytes;
    await expect(
      createRawHttpExchangeExecutor(route, {
        exactMode: mode({ maximumRequestHeaderBytes: actualHeadBytes }),
      })(exact(body)),
    ).resolves.toMatchObject({ status: 200 });
    const resolve = vi.fn(() => ({}));
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), {
        exactMode: mode({ maximumRequestBodyBytes: 1023, resolveCredentials: resolve }),
      })(exact(body)),
    ).rejects.toMatchObject({ category: "configuration", requestWriteState: "not-started" });
    expect(resolve).not.toHaveBeenCalled();
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), {
        exactMode: mode({ maximumRequestHeaderBytes: actualHeadBytes - 1 }),
      })(exact(body)),
    ).rejects.toMatchObject({ category: "configuration", requestWriteState: "not-started" });
  });

  it("refuses a credential-decorated header overflow and inherited exact forms without fallback", async () => {
    const modeWithCredentials = mode({
      maximumRequestHeaderBytes: 128,
      defaultCredentialRef: "writer",
      credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
      resolveCredentials: () => ({ Authorization: "sentinel-secret".repeat(100) }),
    });
    const failure = await createRawHttpExchangeExecutor(deadRoute(), {
      exactMode: modeWithCredentials,
    })(exact()).catch((error: unknown) => error);
    expect(failure).toMatchObject({ category: "configuration", requestWriteState: "not-started" });
    expect(JSON.stringify(failure)).not.toContain("sentinel-secret");
    const inherited = Object.create({ raw: { headerLines: [] } });
    Object.assign(inherited, {
      method: "POST",
      url,
      headers: {},
      signal: new AbortController().signal,
    });
    const authorize = vi.fn(() => ({}));
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), { authorize, exactMode: mode() })(inherited),
    ).rejects.toMatchObject({ category: "configuration", requestWriteState: "not-started" });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does not allow a Read exact-body probe to act as a mutation lane", async () => {
    await expect(
      createRawHttpExchangeExecutor(deadRoute(), { exactMode: mode({ profile: "read" }) })(exact()),
    ).rejects.toMatchObject({ category: "configuration", requestWriteState: "not-started" });
  });
});

function createHashForTest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
