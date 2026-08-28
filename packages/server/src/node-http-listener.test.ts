import { request as httpRequest, maxHeaderSize, ServerResponse, type Server } from "node:http";
import { connect as connectSocket } from "node:net";
import { readProblem, type ScopeReadOperation } from "@bdp/protocol";
// This test-only import installs the single non-emitted evidence mock before server admission.
import { establishReadConformanceEvidenceForTesting } from "@bdp/server/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admitReadServerProfile,
  closeNodeHttpServer,
  createNodeHttpServer,
  createPublicReadControls,
  createReadPagination,
  createReadServer,
  listenNodeHttpServer,
  type NodeHttpListenerError,
  type ScopePort,
  type ServerReadControls,
  scopePortSuccess,
  serveNodeHttpServer,
} from "./index.js";

const SCOPE = "https://public.example/local-test/";

describe("Node HTTP listener", () => {
  let withdrawEvidence: () => void;
  beforeEach(() => {
    withdrawEvidence = establishReadConformanceEvidenceForTesting("bdptest");
  });
  afterEach(() => withdrawEvidence());

  it("serves canonical discovery/routes and rejects every unsupported method", async () => {
    const failures: unknown[] = [];
    const port: ScopePort = {
      perform<Operation extends ScopeReadOperation>(operation: Operation) {
        if (operation.kind === "collection" && operation.collection === "links") {
          throw new Error("private adapter details");
        }
        return Promise.resolve(scopePortSuccess<Operation>({ items: [], next: null } as never));
      },
    };
    const readServer = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port,
    });
    const listener = createNodeHttpServer(readServer, {
      onError: (error) => failures.push(error),
    });
    const base = await listen(listener);

    try {
      const probe = await fetch(`${base}/local-test/`);
      expect(probe.status).toBe(204);
      const discovery = await fetch(`${base}/local-test/bdp.json`);
      expect(discovery.status).toBe(200);
      expect(discovery.headers.has("cache-control")).toBe(false);
      expect(await discovery.json()).toMatchObject({ scope: SCOPE, profile: "read" });
      const beads = await fetch(`${base}/local-test/beads/`);
      expect(beads.status).toBe(200);
      expect(beads.headers.get("cache-control")).toBe("private, no-store");
      const head = await rawRequest(base, "HEAD", "/local-test/beads/");
      expect(head.status).toBe(200);
      expect(head.contentLength).toBe(beads.headers.get("content-length"));
      expect(head.cacheControl).toBe(beads.headers.get("cache-control"));
      expect(head.body).toBe("");
      const outside = await fetch(`${base}/outside`);
      expect(outside.status).toBe(404);
      expect(outside.headers.get("cache-control")).toBe("private, no-store");
      expect(
        (await rawRequest(base, "GET", "http://evil.example/local-test/bdp.json")).status,
      ).toBe(200);
      expect((await rawRequest(base, "GET", "//evil.example/local-test/bdp.json")).status).toBe(
        200,
      );
      expect((await rawRequest(base, "GET", "//[::1]/local-test/bdp.json")).status).toBe(200);
      expect((await rawRequest(base, "GET", "/local-test/../outside")).status).toBe(404);
      for (const target of [
        "http://[/local-test/bdp.json",
        "https://[/local-test/bdp.json",
        "http:////evil.example/local-test/bdp.json",
        "////evil.example/local-test/bdp.json",
        "//user@evil.example/local-test/bdp.json",
        "//user@@evil.example/local-test/bdp.json",
        "ftp://evil.example/local-test/bdp.json",
        "ws://evil.example/local-test/bdp.json",
        "/local-test/beads/a/../b",
        "/local-test/beads/a/%2e%2e/b",
        String.raw`/local-test/beads/a\..\b`,
        "/local-test/beads/a%5Cb",
        "http://evil.example/local-test/beads/a/../b",
        "//evil.example/local-test/beads/a/%2E%2E/b",
      ])
        expect((await rawRequest(base, "GET", target)).status, target).toBe(404);
      const failed = await fetch(`${base}/local-test/links/`);
      expect(failed.status).toBe(500);
      expect(await failed.text()).toBe("");
      expect(failures).toHaveLength(1);

      for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "TRACE", "CONNECT"]) {
        const response = await rawRequest(base, method, "/local-test/beads/");
        expect(response.status).toBe(405);
        expect(response.allow).toBe("GET, HEAD");
        expect(response.contentLength).toBe("0");
        expect(response.cacheControl).toBeUndefined();
        expect(response.body).toBe("");
      }
      await resetConnect(base);
      expect((await fetch(`${base}/local-test/`)).status).toBe(204);
    } finally {
      await close(listener);
      await readServer.close();
    }
  });

  it("preserves request headers for identity policy while retaining configured URL identity", async () => {
    const observed: Array<{ readonly authorization: string | null; readonly url: string }> = [];
    const readServer = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: {
        perform: async () => scopePortSuccess({ items: [], next: null } as never) as never,
      },
      readControls: testReadControls((_operation, { httpRequest: request }) => {
        if (request === undefined) throw new Error("missing originating request");
        observed.push({ authorization: request.headers.get("authorization"), url: request.url });
        return { authorizationView: "test-view", scopeEpoch: "test-epoch" };
      }),
    });
    const listener = createNodeHttpServer(readServer);
    const base = await listen(listener);

    try {
      const response = await fetch(`${base}/local-test/beads/?limit=1`, {
        headers: { authorization: "Bearer node-principal" },
      });
      expect(response.status).toBe(200);
      expect(observed).toEqual([
        {
          authorization: "Bearer node-principal",
          url: `${SCOPE}beads/?limit=1`,
        },
      ]);
    } finally {
      await close(listener);
      await readServer.close();
    }
  });

  it.each(["advertised", "controls-only"] as const)(
    "derives the transport ceiling from %s enforced Selector limits",
    async (configuration) => {
      const limits = {
        page: { defaultItems: 50, maximumItems: 200 },
        selector: { bytes: 16_384, depth: 32, nodes: 256 },
        cursorTtlMilliseconds: 300_000,
      } as const;
      const readServer = createReadServer({
        scope: SCOPE,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: {
          perform: async () => scopePortSuccess({ items: [], next: null } as never) as never,
        },
        ...(configuration === "advertised" ? { advertisedLimits: limits } : {}),
        readControls: createPublicReadControls({ scope: SCOPE, limits }),
      });
      const listener = createNodeHttpServer(readServer);
      const base = await listen(listener);
      const atLimitSelector = `$${" ".repeat(limits.selector.bytes - 1)}`;
      const atLimitPath = `/local-test/beads/?selector=${encodeURIComponent(atLimitSelector)}`;
      const selector = "x".repeat(limits.selector.bytes + 1);
      const path = `/local-test/beads/?selector=${encodeURIComponent(selector)}`;
      expect(Buffer.byteLength(path)).toBeGreaterThan(maxHeaderSize);

      try {
        const admitted = await rawRequest(base, "GET", atLimitPath);
        expect(admitted.status).toBe(400);
        expect(admitted.contentType).toBe("application/problem+json");
        const response = await rawRequest(base, "GET", path);
        expect(response.status).toBe(413);
        expect(response.contentType).toBe("application/problem+json");
        expect(response.cacheControl).toBe("private, no-store");
        expect(JSON.parse(response.body)).toEqual(readProblem("limit-exceeded"));
      } finally {
        await close(listener);
        await readServer.close();
      }
    },
  );

  it("turns an unchallenged identity-policy 401 into a bodyless internal fault", async () => {
    const onError = vi.fn();
    const readServer = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: { perform: vi.fn() as ScopePort["perform"] },
      readControls: testReadControls(() => readProblem("unauthenticated")),
    });
    const listener = createNodeHttpServer(readServer, { onError });
    const base = await listen(listener);

    try {
      const response = await rawRequest(base, "GET", "/local-test/beads/");
      expect(response.status).toBe(500);
      expect(response.body).toBe("");
      expect(response.contentType).toBeUndefined();
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: "TypeError" }));
    } finally {
      await close(listener);
      await readServer.close();
    }
  });

  it("clears staged success headers when response serialization faults", async () => {
    const onError = vi.fn();
    const originalStringify = JSON.stringify;
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation((value) => {
      if (typeof value === "object" && value !== null && Object.hasOwn(value, "revision"))
        throw new TypeError("controlled response serialization fault");
      return originalStringify(value);
    });
    const readServer = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: {
        perform: async (operation) =>
          operation.kind === "resource" && operation.resource === "bead"
            ? (scopePortSuccess({
                id: operation.id,
                type: "https://work.example/types/task",
                revision: "opaque-revision",
                properties: {},
              } as never) as never)
            : (scopePortSuccess({ items: [], next: null } as never) as never),
      },
    });
    const listener = createNodeHttpServer(readServer, { onError });
    const base = await listen(listener);

    try {
      const response = await rawRequest(base, "GET", "/local-test/beads/a");
      expect(response.status).toBe(500);
      expect(response.body).toBe("");
      expect(response.cacheControl).toBeUndefined();
      expect(response.contentType).toBeUndefined();
      expect(response.contentLength).toBe("0");
      expect(response.etag).toBeUndefined();
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: "TypeError" }));
    } finally {
      stringify.mockRestore();
      await close(listener);
      await readServer.close();
    }
  });

  it("frames a bodyless fault deterministically after staged content length", async () => {
    const onError = vi.fn();
    const readServer = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port: {
        perform: async (operation) =>
          operation.kind === "resource" && operation.resource === "bead"
            ? (scopePortSuccess({
                id: operation.id,
                type: "https://work.example/types/task",
                revision: "opaque-revision",
                properties: {},
              } as never) as never)
            : (scopePortSuccess({ items: [], next: null } as never) as never),
      },
    });
    const listener = createNodeHttpServer(readServer, { onError });

    try {
      const originalSetHeader = ServerResponse.prototype.setHeader;
      const setHeader = vi
        .spyOn(ServerResponse.prototype, "setHeader")
        .mockImplementation(function (
          this: ServerResponse,
          name: string,
          value: number | string | readonly string[],
        ) {
          const result = originalSetHeader.call(this, name, value);
          if (name.toLowerCase() === "etag") {
            originalSetHeader.call(this, "content-length", "999");
            throw new TypeError("controlled header staging fault");
          }
          return result;
        });
      try {
        const base = await listen(listener);
        const response = await rawRequest(base, "GET", "/local-test/beads/a");
        expect(response.status).toBe(500);
        expect(response.body).toBe("");
        expect(response.cacheControl).toBeUndefined();
        expect(response.contentType).toBeUndefined();
        expect(response.contentLength).toBe("0");
        expect(response.transferEncoding).toBeUndefined();
        expect(response.etag).toBeUndefined();
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: "TypeError" }));
      } finally {
        setHeader.mockRestore();
      }
    } finally {
      await close(listener);
      await readServer.close();
    }
  });

  it("aborts a slow Scope port and destroys a disconnected socket", async () => {
    let operationSignal: AbortSignal | undefined;
    const started = vi.fn();
    const cleanedUp = vi.fn();
    let finishCleanup: (() => void) | undefined;
    const port: ScopePort = {
      perform: ((_operation, options) => {
        operationSignal = options.signal;
        started();
        return new Promise((resolve) => {
          options.signal.addEventListener(
            "abort",
            () => {
              cleanedUp();
              finishCleanup = () =>
                resolve(scopePortSuccess({ items: [], next: null } as never) as never);
            },
            { once: true },
          );
        }) as never;
      }) as ScopePort["perform"],
    };
    const readServer = createReadServer({
      scope: SCOPE,
      target: "bdptest",
      admittedProfile: admitReadServerProfile("read", "bdptest"),
      port,
    });
    const listener = createNodeHttpServer(readServer);
    const base = await listen(listener);
    const client = httpRequest(`${base}/local-test/beads/`);
    client.on("error", () => undefined);
    client.end();

    try {
      await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
      client.destroy();
      await vi.waitFor(() => expect(operationSignal?.aborted).toBe(true));
      expect(cleanedUp).toHaveBeenCalledOnce();
      let closeFinished = false;
      const closePromise = readServer.close().then(() => {
        closeFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(closeFinished).toBe(false);
      finishCleanup?.();
      await expect(closePromise).resolves.toBeUndefined();
    } finally {
      client.destroy();
      await close(listener);
      await readServer.close();
    }
  });

  it("does not let a non-reading CONNECT peer block listener shutdown", async () => {
    const readServer = testReadServer();
    const listener = createNodeHttpServer(readServer);
    const base = await listen(listener);
    const connectSeen = new Promise<void>((resolve) => listener.once("connect", () => resolve()));
    const peer = await nonReadingConnect(base);

    try {
      await connectSeen;
      await expect(withTimeout(close(listener), 1_000)).resolves.toBeUndefined();
    } finally {
      peer.destroy();
      await close(listener);
      await readServer.close();
    }
  });

  it("bounds shutdown with a silent pre-header peer", async () => {
    const readServer = testReadServer();
    const listener = createNodeHttpServer(readServer);
    const base = await listen(listener);
    const connectionSeen = new Promise<void>((resolve) =>
      listener.once("connection", () => resolve()),
    );
    const peer = connectSocket(Number(new URL(base).port), "127.0.0.1");
    await Promise.all([
      connectionSeen,
      new Promise<void>((resolve, reject) => {
        peer.once("connect", resolve);
        peer.once("error", reject);
      }),
    ]);

    try {
      await expect(
        withTimeout(closeNodeHttpServer(listener, { forceAfterMilliseconds: 20 }), 1_000),
      ).resolves.toBeUndefined();
    } finally {
      peer.destroy();
      await close(listener);
      await readServer.close();
    }
  });

  it("owns listener binding and ReadServer cleanup through a termination signal", async () => {
    const readServer = testReadServer();
    const closeReadServer = vi.spyOn(readServer, "close");
    const termination = new AbortController();

    const outcome = await serveNodeHttpServer(readServer, {
      host: "127.0.0.1",
      port: 0,
      terminationSignal: termination.signal,
      onStarted: () => termination.abort("SIGTERM"),
    });

    expect(outcome).toEqual({ kind: "signal", signal: "SIGTERM" });
    expect(closeReadServer).toHaveBeenCalledOnce();
  });

  it("closes the owned ReadServer when shared lifecycle binding fails", async () => {
    const occupiedServer = testReadServer();
    const occupiedListener = createNodeHttpServer(occupiedServer);
    await listenNodeHttpServer(occupiedListener, {
      host: "127.0.0.1",
      port: 0,
      onError: vi.fn(),
    });
    const address = occupiedListener.address();
    if (address === null || typeof address === "string") throw new Error("listener did not bind");
    const rejectedServer = testReadServer();
    const closeRejectedServer = vi.spyOn(rejectedServer, "close");

    try {
      await expect(
        serveNodeHttpServer(rejectedServer, { host: "127.0.0.1", port: address.port }),
      ).rejects.toMatchObject({ name: "NodeHttpListenerError", reason: "EADDRINUSE" });
      expect(closeRejectedServer).toHaveBeenCalledOnce();
    } finally {
      await closeNodeHttpServer(occupiedListener);
      await occupiedServer.close();
    }
  });

  it("rejects a forged server before constructing a listener", () => {
    expect(() =>
      createNodeHttpServer({
        scope: SCOPE,
        perform: vi.fn(),
        probe: vi.fn(),
        close: vi.fn(),
      } as never),
    ).toThrowError(TypeError);
  });

  it("rejects bind collisions and reports later listener errors structurally", async () => {
    const firstServer = testReadServer();
    const secondServer = testReadServer();
    const first = createNodeHttpServer(firstServer);
    const second = createNodeHttpServer(secondServer);
    const laterFailures: NodeHttpListenerError[] = [];

    try {
      await listenNodeHttpServer(first, {
        host: "127.0.0.1",
        port: 0,
        onError: (error) => laterFailures.push(error),
      });
      const address = first.address();
      if (address === null || typeof address === "string") throw new Error("listener did not bind");

      await expect(
        listenNodeHttpServer(second, {
          host: "127.0.0.1",
          port: address.port,
          onError: (error) => laterFailures.push(error),
        }),
      ).rejects.toMatchObject({ name: "NodeHttpListenerError", reason: "EADDRINUSE" });

      first.emit("error", Object.assign(new Error("descriptor limit"), { code: "EMFILE" }));
      first.emit("error", Object.assign(new Error("descriptor limit"), { code: "ENFILE" }));
      expect(laterFailures).toEqual([
        expect.objectContaining({ name: "NodeHttpListenerError", reason: "EMFILE" }),
        expect.objectContaining({ name: "NodeHttpListenerError", reason: "ENFILE" }),
      ]);
    } finally {
      await close(second);
      await close(first);
      await secondServer.close();
      await firstServer.close();
    }
  });

  it("rejects a forged listener before binding", () => {
    const forged = { listen: vi.fn() };
    expect(() =>
      listenNodeHttpServer(forged as never, {
        host: "127.0.0.1",
        port: 0,
        onError: vi.fn(),
      }),
    ).toThrowError(TypeError);
    expect(forged.listen).not.toHaveBeenCalled();
  });
});

async function listen(listener: Server): Promise<string> {
  await listenNodeHttpServer(listener, {
    host: "127.0.0.1",
    port: 0,
    onError: (error) => {
      throw error;
    },
  });
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("listener did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function testReadServer() {
  return createReadServer({
    scope: SCOPE,
    target: "bdptest",
    admittedProfile: admitReadServerProfile("read", "bdptest"),
    port: {
      perform: async () => scopePortSuccess({ items: [], next: null } as never) as never,
    },
  });
}

function testReadControls(identityFor: ServerReadControls["identityFor"]): ServerReadControls {
  return {
    selectorLimits: { bytes: 1_000, depth: 20, nodes: 100 },
    pagination: createReadPagination({
      scope: SCOPE,
      defaultPageItems: 2,
      maxPageItems: 10,
      cursorTtlMs: 60_000,
      retainedStateCapacity: 100,
      maxRetainedCursorPositionsPerSnapshot: 99,
      retainedSnapshotByteCapacity: 100_000,
      retainedSnapshotNodeCapacity: 10_000,
      maxOpaqueTokenLength: 40,
      tokenGenerationAttempts: 3,
      clock: () => 1_000,
      generateOpaqueToken: () => "node_test",
    }),
    identityFor,
    problemFor: () => readProblem("invalid-parameter"),
  };
}

async function close(listener: Server): Promise<void> {
  await closeNodeHttpServer(listener);
}

async function rawRequest(
  base: string,
  method: string,
  path: string,
): Promise<{
  status: number;
  allow: string | undefined;
  cacheControl: string | undefined;
  contentType: string | undefined;
  contentLength: string | undefined;
  transferEncoding: string | undefined;
  etag: string | undefined;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const baseUrl = new URL(base);
    const request = httpRequest(
      {
        hostname: baseUrl.hostname,
        port: baseUrl.port,
        method,
        path,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            allow: response.headers.allow,
            cacheControl: response.headers["cache-control"],
            contentType: response.headers["content-type"],
            contentLength: response.headers["content-length"],
            transferEncoding: response.headers["transfer-encoding"],
            etag: response.headers.etag,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("connect", (response, socket) => {
      socket.destroy();
      resolve({
        status: response.statusCode ?? 0,
        allow: response.headers.allow,
        cacheControl: response.headers["cache-control"],
        contentType: response.headers["content-type"],
        contentLength: response.headers["content-length"],
        transferEncoding: response.headers["transfer-encoding"],
        etag: response.headers.etag,
        body: "",
      });
    });
    request.on("error", reject);
    request.end();
  });
}

async function resetConnect(base: string): Promise<void> {
  const url = new URL(base);
  await new Promise<void>((resolve, reject) => {
    const socket = connectSocket(Number(url.port), url.hostname);
    socket.once("connect", () => {
      socket.write(`CONNECT ${url.hostname}:${url.port} HTTP/1.1\r\nHost: ${url.host}\r\n\r\n`);
      socket.resetAndDestroy();
      setTimeout(resolve, 20);
    });
    socket.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolve();
      else reject(error);
    });
  });
}

async function nonReadingConnect(base: string) {
  const url = new URL(base);
  return new Promise<ReturnType<typeof connectSocket>>((resolve, reject) => {
    const socket = connectSocket(Number(url.port), url.hostname);
    socket.pause();
    socket.once("connect", () => {
      socket.write(`CONNECT ${url.hostname}:${url.port} HTTP/1.1\r\nHost: ${url.host}\r\n\r\n`);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("operation timed out")), milliseconds);
    void promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
