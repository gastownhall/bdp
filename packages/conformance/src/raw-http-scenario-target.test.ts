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
