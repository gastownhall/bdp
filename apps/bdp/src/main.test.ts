import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";
import { BdpClient } from "@bdp/client";

import { runBdp } from "./main.js";

describe("bdp ready CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([false, true])(
    "reports a local transport failure without an unhandled rejection (json=%s)",
    async (json) => {
      const server = createServer((_request, response) => {
        response.statusCode = 502;
        response.setHeader("content-type", "text/html");
        response.end("private upstream failure");
      });
      const scope = await listen(server);
      vi.stubEnv("BDP_SCOPE_URL", scope);
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      const closeClient = vi.spyOn(BdpClient.prototype, "close");

      try {
        await expect(runBdp(["bd", "ready", ...(json ? ["--json"] : [])])).resolves.toBe(1);
      } finally {
        await close(server);
      }

      const stdoutText = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
      const stderrText = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(closeClient).toHaveBeenCalledOnce();
      expect(stderrText).not.toContain("private upstream failure");
      expect(stderrText).not.toContain("BdpClientTransportError:");
      if (json) {
        expect(JSON.parse(stdoutText)).toEqual({
          error: { kind: "local", code: "transport-failed" },
        });
      } else {
        expect(stdoutText).toBe("");
        expect(stderrText).toContain('"event":"bd.ready.failed"');
        expect(stderrText).toContain('"message":"transport-failed"');
      }
    },
  );

  it.each([false, true])(
    "emits one tagged JSON envelope when a protocol Problem is followed by close failure=%s",
    async (closeFails) => {
      const problem = {
        type: "https://github.com/gastownhall/bdp/problems/unavailable",
        code: "temporarily-unavailable",
        retry: "after-delay",
        status: 503,
      } as const;
      const server = createServer((request, response) => {
        const scope = `http://${request.headers.host}/local-test/`;
        if (request.url === "/local-test/") {
          response.statusCode = 204;
          response.setHeader("link", `<${scope}bdp.json>; rel="service-desc"`);
          response.end();
          return;
        }
        response.setHeader("content-type", "application/json");
        if (request.url === "/local-test/bdp.json") {
          response.end(
            JSON.stringify({
              bdpVersion: "0",
              profile: "read",
              scope,
              beads: `${scope}beads/`,
              links: `${scope}links/`,
              types: `${scope}types/`,
            }),
          );
          return;
        }
        response.statusCode = 503;
        response.setHeader("content-type", "application/problem+json");
        response.end(JSON.stringify(problem));
      });
      const scope = await listen(server);
      vi.stubEnv("BDP_SCOPE_URL", scope);
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      if (closeFails)
        vi.spyOn(BdpClient.prototype, "close").mockRejectedValueOnce(new Error("close failed"));

      try {
        await expect(runBdp(["bd", "ready", "--json"])).resolves.toBe(1);
      } finally {
        await close(server);
      }

      const stdoutText = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(stdoutText.match(/\n/g)).toHaveLength(1);
      expect(JSON.parse(stdoutText)).toEqual(
        closeFails
          ? { error: { kind: "local", code: "internal-failure" } }
          : { error: { kind: "protocol", problem } },
      );
    },
  );
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}/local-test/`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}
