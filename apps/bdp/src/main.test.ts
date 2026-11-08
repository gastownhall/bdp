import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { BdpClient } from "@bdp/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runBdp } from "./main.js";

describe("bdp ready CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    {
      configured: false,
      expectedScope: "not configured; set one with bdp connect <url>",
    },
    { configured: true, expectedScope: "https://default.example/work/" },
  ])(
    "shows help and the default Scope with no arguments (%j)",
    async ({ configured, expectedScope }) => {
      const root = await mkdtemp(join(tmpdir(), "bdp-no-args-"));
      const configPath = join(root, "bdp", "config.json");
      vi.stubEnv("XDG_CONFIG_HOME", root);
      vi.stubEnv("BDP_CONFIG", undefined);
      vi.stubEnv("BDP_SCOPE_URL", undefined);
      if (configured) {
        await mkdir(join(root, "bdp"), { recursive: true });
        await writeFile(configPath, JSON.stringify({ scope: { url: expectedScope } }), "utf8");
      }
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      try {
        await expect(runBdp([])).resolves.toBe(0);
        const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
        expect(output).toContain("Usage:");
        expect(output).toContain("Discover the selected Scope");
        // The default Scope names where it came from (row 3).
        expect(output).toContain(
          `Default Scope: ${expectedScope}${configured ? ` (from config file ${configPath})` : ""}`,
        );
        expect(stderr).not.toHaveBeenCalled();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([false, true])(
    "honors explicit Scope around the domain command (after=%s)",
    async (after) => {
      let ambientCalls = 0,
        selectedCalls = 0;
      const ambient = createServer((_request, response) => {
        ambientCalls++;
        response.statusCode = 502;
        response.end();
      });
      const selected = createServer((_request, response) => {
        selectedCalls++;
        response.statusCode = 502;
        response.end();
      });
      const ambientScope = await listen(ambient),
        selectedScope = await listen(selected);
      vi.stubEnv("BDP_SCOPE_URL", ambientScope);
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const args = after
          ? ["bd", "ready", "--scope", selectedScope]
          : ["--scope", selectedScope, "bd", "ready"];
        await expect(runBdp(args)).resolves.toBe(1);
        expect(selectedCalls).toBe(1);
        expect(ambientCalls).toBe(0);
      } finally {
        await close(ambient);
        await close(selected);
      }
    },
  );

  it.each([
    { json: false, args: [] },
    { json: true, args: ["--json"] },
    { json: true, args: ["--output-mode", "json"] },
  ])(
    "reports a local transport failure without an unhandled rejection (%j)",
    async ({ json, args }) => {
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
        await expect(runBdp(["bd", "ready", ...args])).resolves.toBe(1);
      } finally {
        await close(server);
      }

      const stdoutText = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
      const stderrText = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(closeClient).toHaveBeenCalledOnce();
      expect(stderrText).not.toContain("private upstream failure");
      expect(stderrText).not.toContain("BdpClientTransportError:");
      if (json) {
        // The client's own check says what failed; the upstream's text stays out of it.
        expect(JSON.parse(stdoutText)).toEqual({
          error: { kind: "local", code: "transport-failed", message: expect.any(String) },
        });
      } else {
        expect(stdoutText).toBe("");
        expect(stderrText).toContain('"event":"bd.ready.failed"');
        expect(stderrText).toContain('"message":"transport-failed: ');
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
