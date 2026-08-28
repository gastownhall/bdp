// This test-only import must install the non-emitted evidence mock before @bdp/server loads.
import { establishReadConformanceEvidenceForTesting } from "@bdp/server/testing";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPortableReferenceFixturePort } from "@bdp/adapter-in-memory";
import {
  admitReadServerProfile,
  closeNodeHttpServer,
  createNodeHttpServer,
  createReadServer,
  listenNodeHttpServer,
} from "@bdp/server";
import {
  assertStartupDiagnostic,
  parseExactJson,
  ready,
  spawnChild,
  start,
  stopServer,
  terminateChild,
  terminateChildInBackground,
} from "./e2e-ready.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("E2E child supervision", () => {
  it.runIf(process.platform !== "win32")(
    "terminates a descendant that inherits the supervised child's stdio",
    async () => {
      const source = `
        const { spawn } = require("node:child_process");
        const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
          stdio: ["ignore", "inherit", "inherit"],
        });
        process.stdout.write(String(grandchild.pid) + "\\n");
        setTimeout(() => {}, 10000);
      `;
      const record = spawnChild(process.execPath, ["-e", source], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        timeoutMs: 10_000,
      });
      try {
        const grandchildPid = Number(await waitForLine(record));
        expect(Number.isSafeInteger(grandchildPid)).toBe(true);

        await terminateChild(record);

        expect(await processExists(grandchildPid)).toBe(false);
      } finally {
        await terminateChild(record);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "kills a same-group descendant after its leader exits and it ignores SIGTERM",
    async () => {
      const source = `
        const { spawn } = require("node:child_process");
        const grandchild = spawn(
          process.execPath,
          ["-e", "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000)"],
          { stdio: ["ignore", "ignore", "ignore", "ipc"] },
        );
        grandchild.once("message", () => {
          process.stdout.write(String(grandchild.pid) + "\\n", () => process.exit(0));
        });
      `;
      const record = spawnChild(process.execPath, ["-e", source], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        timeoutMs: 10_000,
        stopTimeoutMs: 50,
      });
      const grandchildPid = Number(await waitForLine(record));
      try {
        await record.result;
        expect(await processExists(grandchildPid)).toBe(true);

        await terminateChild(record);

        expect(await processExists(grandchildPid)).toBe(false);
      } finally {
        await terminateChild(record);
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "reports a process group that survives SIGKILL and abandons its local handles",
    async () => {
      const child = fakeChild(999_999);
      vi.spyOn(process, "kill").mockImplementation(() => true);

      await expect(
        terminateChild({
          child,
          command: "hostile-child",
          exitCode: undefined,
          signal: undefined,
          closed: new Promise(() => {}),
          stopTimeoutMs: 0,
        }),
      ).rejects.toThrow("hostile-child process group survived SIGKILL");
      expect(child.unref).toHaveBeenCalledOnce();
      expect(child.stdout.destroy).toHaveBeenCalledOnce();
      expect(child.stderr.destroy).toHaveBeenCalledOnce();
    },
  );

  it.runIf(process.platform !== "win32")(
    "observes a failed fire-and-forget termination without rejecting",
    async () => {
      const child = fakeChild(999_997);
      vi.spyOn(process, "kill").mockImplementation(() => true);

      await expect(
        terminateChildInBackground({
          child,
          command: "background-hostile-child",
          exitCode: undefined,
          signal: undefined,
          closed: new Promise(() => {}),
          stopTimeoutMs: 0,
        }),
      ).resolves.toBe(false);
      expect(child.unref).toHaveBeenCalledOnce();
    },
  );

  it.runIf(process.platform !== "win32")(
    "waits for the child close event after its process group disappears",
    async () => {
      const child = fakeChild(999_998);
      const groupMissing = Object.assign(new Error("missing"), { code: "ESRCH" });
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw groupMissing;
      });
      let resolveClosed;
      const record = {
        child,
        command: "closing-child",
        exitCode: undefined,
        signal: undefined,
        closed: new Promise((resolve) => {
          resolveClosed = resolve;
        }),
        stopTimeoutMs: 1_000,
      };
      let settled = false;
      const termination = terminateChild(record).finally(() => {
        settled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      record.exitCode = 0;
      resolveClosed();

      await expect(termination).resolves.toBeUndefined();
      expect(child.unref).not.toHaveBeenCalled();
    },
  );

  it("flushes a final unterminated server diagnostic before stop validation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-e2e-ready-test-"));
    temporaryDirectories.push(directory);
    const fixture = path.join(directory, "server.mjs");
    await writeFile(
      fixture,
      `
        import { createServer } from "node:http";
        const server = createServer((request, response) => {
          response.statusCode = request.url === "/local-test/bdp.json" ? 200 : 404;
          response.end("{}");
        });
        server.listen(Number(process.env.BDP_SERVER_PORT), "127.0.0.1", () => {
          process.stderr.write(JSON.stringify({ level: "info", event: "server.started" }) + "\\n");
        });
        process.once("SIGTERM", () => {
          server.close(() => {
            process.stderr.write(JSON.stringify({ level: "info", event: "server.stopped" }));
          });
        });
      `,
    );
    const port = await freePort();
    let server;
    try {
      server = await start(fixture, {
        BDP_SCOPE_URL: `http://127.0.0.1:${port}/local-test/`,
        BDP_SERVER_PORT: String(port),
      });

      await stopServer(server);

      expect(server.diagnostics.map(({ event }) => event)).toEqual([
        "server.started",
        "server.stopped",
      ]);
    } finally {
      if (server !== undefined) await terminateChild(server.record);
    }
  });

  it.runIf(existsSync(path.join(process.cwd(), "apps/bdp/dist/main.js")))(
    "runs the packaged ready CLI against a test-admitted bdptest service",
    async () => {
      const fixture = JSON.parse(
        readFileSync(
          path.join(process.cwd(), "packages/conformance/fixtures/read-reference-v1.json"),
          "utf8",
        ),
      );
      const port = await freePort();
      const scope = `http://127.0.0.1:${port}/local-test/`;
      const withdrawEvidence = establishReadConformanceEvidenceForTesting("bdptest");
      const readServer = createReadServer({
        scope,
        target: "bdptest",
        admittedProfile: admitReadServerProfile("read", "bdptest"),
        port: createPortableReferenceFixturePort(scope, fixture),
      });
      const listener = createNodeHttpServer(readServer);
      let listenerFailure;
      try {
        await listenNodeHttpServer(listener, {
          host: "127.0.0.1",
          port,
          onError: (error) => {
            listenerFailure ??= error;
          },
        });

        const result = await ready(scope, true);

        expect(result.code).toBe(0);
        assertStartupDiagnostic(result.stderr, scope);
        expect(parseExactJson(result.stdout, "bdptest preflight")).toEqual(
          fixture.expectations.readyJson,
        );
        expect(listenerFailure).toBeUndefined();
      } finally {
        try {
          await closeNodeHttpServer(listener);
        } finally {
          try {
            await readServer.close();
          } finally {
            withdrawEvidence();
          }
        }
      }
    },
  );
});

async function waitForLine(record) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const line = record.stdout.split("\n")[0];
    if (line !== "") return line;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("child did not report its descendant PID");
}

async function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server did not bind");
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function fakeChild(pid) {
  return {
    pid,
    kill: vi.fn(),
    unref: vi.fn(),
    stdin: { destroy: vi.fn() },
    stdout: { destroy: vi.fn() },
    stderr: { destroy: vi.fn() },
  };
}
