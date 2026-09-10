import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConformanceFixture } from "./artifact-bundle.js";
import type { ExecutableScenario } from "./executable-manifest.js";
import { createRawHttpScenarioTarget } from "./raw-http-scenario-target.js";

describe("raw HTTP scenario target", () => {
  const servers: Server[] = [];

  afterEach(async () => {
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

  it("establishes capabilities only after start and owns the executor lifecycle", async () => {
    const route = await listen((socket) => {
      socket.once("data", () => {
        socket.end("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      });
    });
    const close = vi.fn(async () => undefined);
    const start = vi.fn(async () => ({
      dialRoute: route,
      capabilities: ["public-http"],
      bindings: { bead: "beads/demo" },
      close,
    }));
    const target = createRawHttpScenarioTarget(start);
    await expect(target.execute(request())).rejects.toThrow(
      "raw HTTP scenario target executed outside a prepared fixture",
    );

    const prepared = await target.harness.prepare(
      scenario,
      "https://scope.example/acme/",
      0,
      fixture,
      new AbortController().signal,
    );
    expect(start).toHaveBeenCalledOnce();
    expect(prepared).toEqual({
      capabilities: ["public-http"],
      bindings: { bead: "beads/demo" },
    });
    await expect(target.execute(request())).resolves.toMatchObject({
      status: 204,
      bodyOctets: 0,
    });
    const response = await target.fetch("https://scope.example/acme/");
    expect(response).toMatchObject({ status: 204, url: "https://scope.example/acme/" });
    expect(await response.text()).toBe("");

    await target.harness.cleanup(
      scenario,
      "https://scope.example/acme/",
      new AbortController().signal,
    );
    expect(close).toHaveBeenCalledOnce();
    await expect(target.execute(request())).rejects.toThrow(
      "raw HTTP scenario target executed outside a prepared fixture",
    );
    await expect(target.fetch("https://scope.example/acme/")).rejects.toThrow(
      "raw HTTP scenario target executed outside a prepared fixture",
    );
  });

  it("rejects bodies and unsupported methods at the Fetch bridge", async () => {
    const target = createRawHttpScenarioTarget(async () => ({
      dialRoute: { transport: "plain", host: "127.0.0.1", port: 1 },
      capabilities: ["public-http"],
      close: async () => undefined,
    }));
    await expect(
      target.fetch("https://scope.example/acme/", { method: "POST", body: "not supported" }),
    ).rejects.toThrow("does not support request bodies");
    await expect(target.fetch("https://scope.example/acme/", { method: "QUERY" })).rejects.toThrow(
      "unsupported method",
    );
  });

  it("closes a started session when its dial route is invalid", async () => {
    const close = vi.fn(async () => undefined);
    const target = createRawHttpScenarioTarget(async () => ({
      dialRoute: { transport: "plain", host: "127.0.0.1", port: 0 },
      capabilities: ["public-http"],
      close,
    }));

    await expect(
      target.harness.prepare(
        scenario,
        "https://scope.example/acme/",
        0,
        fixture,
        new AbortController().signal,
      ),
    ).rejects.toThrow("dialRoute.port must be an integer from 1 to 65535");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a session that finishes starting after preparation was aborted", async () => {
    const close = vi.fn(async () => undefined);
    const target = createRawHttpScenarioTarget(async () => ({
      dialRoute: { transport: "plain", host: "127.0.0.1", port: 1 },
      capabilities: ["public-http"],
      close,
    }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      target.harness.prepare(
        scenario,
        "https://scope.example/acme/",
        0,
        fixture,
        controller.signal,
      ),
    ).rejects.toThrow("raw HTTP scenario target preparation was aborted");
    expect(close).toHaveBeenCalledOnce();
  });

  const scenario = {} as ExecutableScenario;
  const fixture = {} as ConformanceFixture;

  function request() {
    return {
      method: "GET" as const,
      url: "https://scope.example/acme/",
      headers: {},
      signal: new AbortController().signal,
    };
  }

  async function listen(onConnection: (socket: Socket) => void) {
    const server = createServer(onConnection);
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
    return { transport: "plain" as const, host: "127.0.0.1", port: address.port };
  }
});

describe("configured exact HTTP sessions", () => {
  const scope = "https://scope.example/acme/";
  const url = `${scope}operations/create-bead`;
  const servers = new Set<Server>();
  const sockets = new Set<Socket>();
  const scenario = {} as ExecutableScenario;
  const fixture = {} as ConformanceFixture;
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    sockets.clear();
    servers.clear();
  });
  async function bind(receive: (socket: Socket) => void) {
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      receive(socket);
    });
    servers.add(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing address");
    return { transport: "plain" as const, host: "127.0.0.1", port: address.port };
  }
  function mode(): import("./http-executor.js").ExactHttpModeOptions {
    return {
      scope,
      profile: "read-update",
      routes: [
        { method: "POST", url },
        { method: "GET", url: scope },
      ],
      maximumRequestHeaderBytes: 4096,
      maximumRequestBodyBytes: 1024,
      defaultCredentialRef: "writer",
      credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
      resolveCredentials: () => ({ Authorization: "Bearer sentinel-secret" }),
    };
  }
  function request(): import("./http-executor.js").ExactHttpExchangeRequest {
    return {
      method: "POST",
      url,
      signal: new AbortController().signal,
      raw: {
        headerLines: [{ name: "Idempotency-Key", value: "key" }],
        bodyBytes: Buffer.from("{}"),
      },
    };
  }
  function prepare(target: ReturnType<typeof createRawHttpScenarioTarget>, targetScope = scope) {
    return target.harness.prepare(scenario, targetScope, 0, fixture, new AbortController().signal);
  }

  it("binds the actual immutable route/handle configuration and refuses off-Scope credential dispatch", async () => {
    let received = "";
    let foreignConnections = 0;
    const route = await bind((socket) =>
      socket.once("data", (data) => {
        received = data.toString();
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}");
      }),
    );
    const foreign = await bind((socket) => {
      foreignConnections++;
      socket.destroy();
    });
    const routeEntry = { method: "POST" as const, url };
    const headerNames = ["authorization"];
    const configuration = {
      ...mode(),
      routes: [routeEntry],
      credentialHandles: [{ id: "writer", headerNames }],
    };
    const resolver = vi.fn(configuration.resolveCredentials);
    const start = vi.fn(async () => ({
      dialRoute: route,
      capabilities: [],
      close: async () => undefined,
      routes: [{ method: "POST", url: `http://127.0.0.1:${foreign.port}/` }],
    }));
    const target = createRawHttpScenarioTarget(start, {
      exactMode: { ...configuration, resolveCredentials: resolver },
    });
    routeEntry.url = "https://evil.example/";
    headerNames.length = 0;
    await expect(prepare(target, "https://foreign.example/")).rejects.toMatchObject({
      category: "configuration",
    });
    expect(start).not.toHaveBeenCalled();
    await prepare(target);
    expect(target.exactConfiguration?.routes[0]?.url).toBe(url);
    expect(target.exactConfiguration).not.toHaveProperty("resolveCredentials");
    expect(Object.isFrozen(target.exactConfiguration?.credentialHandles[0]?.headerNames)).toBe(
      true,
    );
    for (const targetUrl of [
      `http://127.0.0.1:${foreign.port}/`,
      "https://scope.example/other/",
      `${url}?undeclared=1`,
    ])
      await expect(target.execute({ ...request(), url: targetUrl })).rejects.toMatchObject({
        category: "configuration",
        requestWriteState: "not-started",
      });
    expect(resolver).not.toHaveBeenCalled();
    expect(foreignConnections).toBe(0);
    const response = await target.execute(request());
    expect(response.status).toBe(200);
    expect(resolver).toHaveBeenCalledOnce();
    expect(received).toContain("Authorization: Bearer sentinel-secret");
    await target.close();
  });

  it("aborts and settles an in-flight socket before emergency session close", async () => {
    let sawRequest = (): void => undefined;
    const received = new Promise<void>((resolve) => {
      sawRequest = resolve;
    });
    const route = await bind((socket) =>
      socket.once("data", () => {
        socket.pause();
        sawRequest();
      }),
    );
    const close = vi.fn(async () => undefined);
    const target = createRawHttpScenarioTarget(
      async () => ({ dialRoute: route, capabilities: [], close }),
      { exactMode: mode(), requestTimeoutMs: 1000 },
    );
    await prepare(target);
    const failure = target.execute(request()).catch((error: unknown) => error);
    await received;
    await target.close();
    expect(await failure).toMatchObject({ category: "abort", requestWriteState: "complete" });
    expect(close).toHaveBeenCalledOnce();
    await expect(target.execute(request())).rejects.toThrow("outside a prepared fixture");
    await prepare(target);
    await target.close();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("closes a late prepared session instead of resurrecting it after emergency close", async () => {
    let release = (): void => undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const closed = vi.fn(async () => undefined);
    const target = createRawHttpScenarioTarget(
      async (_scenario, _scope, _seed, _fixture, signal) => {
        await barrier;
        expect(signal.aborted).toBe(true);
        return {
          dialRoute: { transport: "plain", host: "127.0.0.1", port: 1 },
          capabilities: [],
          close: closed,
        };
      },
    );
    const preparing = prepare(target).catch((error: unknown) => error);
    const closing = target.close();
    release();
    await closing;
    expect(await preparing).toBeInstanceOf(Error);
    expect(closed).toHaveBeenCalledOnce();
    await expect(target.execute(request())).rejects.toThrow("outside a prepared fixture");
  });

  it("does not turn class instances into trusted exact requests through the session wrapper", async () => {
    const resolve = vi.fn(() => ({ Authorization: "Bearer sentinel-secret" }));
    const target = createRawHttpScenarioTarget(
      async () => ({
        dialRoute: { transport: "plain", host: "127.0.0.1", port: 1 },
        capabilities: [],
        close: async () => undefined,
      }),
      { exactMode: { ...mode(), resolveCredentials: resolve } },
    );
    await prepare(target);
    class CallerRequest {
      readonly payload = request();
    }
    const input = Object.assign(new CallerRequest(), request());
    await expect(target.execute(input)).rejects.toMatchObject({
      category: "configuration",
      requestWriteState: "not-started",
    });
    expect(resolve).not.toHaveBeenCalled();
    await target.close();
  });

  it.each(["missing", "invalid", "accessor"])(
    "categorizes %s exact signal before dispatch",
    async (kind) => {
      const resolve = vi.fn(() => ({ Authorization: "sentinel-secret" }));
      const target = createRawHttpScenarioTarget(
        async () => ({
          dialRoute: { transport: "plain", host: "127.0.0.1", port: 1 },
          capabilities: [],
          close: async () => undefined,
        }),
        { exactMode: { ...mode(), resolveCredentials: resolve } },
      );
      await prepare(target);
      const input = { ...request() };
      if (kind === "missing") Reflect.deleteProperty(input, "signal");
      else
        Object.defineProperty(
          input,
          "signal",
          kind === "invalid"
            ? { value: {} }
            : {
                get: () => {
                  throw new Error("private-signal-sentinel");
                },
              },
        );
      const error = await target.execute(input).catch((error: unknown) => error);
      expect(error).toMatchObject({ category: "configuration", requestWriteState: "not-started" });
      expect(String(error)).not.toContain("private-signal-sentinel");
      expect(resolve).not.toHaveBeenCalled();
      await target.close();
    },
  );

  it.each(["has", "getPrototypeOf", "getOwnPropertyDescriptor", "ownKeys"])(
    "sanitizes session %s traps before credentials",
    async (trap) => {
      const resolve = vi.fn(() => ({ Authorization: "sentinel-secret" }));
      const target = createRawHttpScenarioTarget(
        async () => ({
          dialRoute: { transport: "plain", host: "127.0.0.1", port: 1 },
          capabilities: [],
          close: async () => undefined,
        }),
        { exactMode: { ...mode(), resolveCredentials: resolve } },
      );
      await prepare(target);
      const input = new Proxy(request(), {
        [trap]: () => {
          throw new Error("private-input-sentinel");
        },
      });
      const error = await Promise.resolve()
        .then(() => target.execute(input))
        .catch((error: unknown) => error);
      expect(error).toMatchObject({ category: "configuration", requestWriteState: "not-started" });
      expect(String(error)).not.toContain("private-input-sentinel");
      expect(error).not.toHaveProperty("cause");
      expect(resolve).not.toHaveBeenCalled();
      await target.close();
    },
  );

  it("bounds a noncooperative session close without keeping request sockets alive", async () => {
    const target = createRawHttpScenarioTarget(
      async () => ({
        dialRoute: { transport: "plain", host: "127.0.0.1", port: 1 },
        capabilities: [],
        close: async () => new Promise<void>(() => undefined),
      }),
      { requestTimeoutMs: 10 },
    );
    await prepare(target);
    await expect(target.close()).rejects.toMatchObject({ category: "abort" });
    await expect(target.execute(request())).rejects.toThrow("outside a prepared fixture");
  });
});
