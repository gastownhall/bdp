/** NEW helper-only failure tests. Explicit program doubles; no installed/native subject behavior. */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { expect, it } from "vitest";
const childSource = fileURLToPath(
  new URL("../test-support/transactional-cumulative-creator-rebind-child.ts", import.meta.url),
);
const output = process.env.BDP_CREATOR_REBIND_CLOSE_OUTPUT;
const doubles = {
  "transaction-installed-configuration.js":
    "export const captureInstalledTransactionConfiguration = value => value;\n",
  "transaction-runtime.js": `export async function startTransactionRuntime() {
    return { scope: "https://helper-double.invalid/", listenUrl: "http://127.0.0.1:1/", targets: {},
      close: async () => { console.log("NEW_TEST_DOUBLE_CLOSE_CALLED"); throw new Error("NEW_TEST_DOUBLE_CLOSE_REJECTION"); }
    };
  }\n`,
  "installed-payload.js":
    'export async function installedPayloadIdentity() { return "HELPER_TEST_DOUBLE_NOT_A_PAYLOAD"; }\n',
};
it.runIf(Boolean(output)).each(["invalid-control", "signal", "disconnect"])(
  "NEW creator rebind helper rejects close safely: %s",
  async (kind) => {
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-creator-rebind-close-probe-"));
    const errors: unknown[] = [];
    let terminal: unknown;
    let removed = false;
    let processTerminal:
      | Promise<{ code: number | null; signal: NodeJS.Signals | null }>
      | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    const events: string[] = [];
    let stdout = "",
      stderr = "",
      forced = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      for (const [name, body] of Object.entries(doubles))
        await writeFile(path.join(directory, name), body);
      child = spawn(process.execPath, [childSource], {
        cwd: "/tmp",
        env: { ...process.env, BDP_CUMULATIVE_CREATOR_REBIND_RUNTIME: directory },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const owned = child;
      processTerminal = new Promise((resolve, reject) => {
        owned.once("error", reject);
        owned.once("exit", (code, signal) => {
          events.push("exit");
          resolve({ code, signal });
        });
      });
      const stdoutEnd = new Promise<void>((resolve) =>
        owned.stdout!.once("end", () => {
          events.push("stdoutEOF");
          resolve();
        }),
      );
      const stderrEnd = new Promise<void>((resolve) =>
        owned.stderr!.once("end", () => {
          events.push("stderrEOF");
          resolve();
        }),
      );
      owned.once("close", () => events.push("close"));
      owned.once("disconnect", () => events.push("disconnect"));
      timeout = setTimeout(() => {
        forced = true;
        owned.kill("SIGKILL");
      }, 10000);
      owned.stdout!.on("data", (b: Buffer) => {
        stdout += b.toString();
        if (Buffer.byteLength(stdout) > 65536) {
          forced = true;
          owned.kill("SIGKILL");
        }
      });
      owned.stderr!.on("data", (b: Buffer) => {
        stderr += b.toString();
        if (Buffer.byteLength(stderr) > 65536) {
          forced = true;
          owned.kill("SIGKILL");
        }
      });
      const readyPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
        owned.once("message", (v) => resolve(v as Record<string, unknown>));
        void processTerminal!.then(() => reject(Error("helper exited before ready")), reject);
      });
      owned.send({ configuration: { _testDouble: true } });
      const ready = await readyPromise;
      expect(ready.event).toBe("creator-rebind.ready");
      expect(ready.payloadIdentity).toBe("HELPER_TEST_DOUBLE_NOT_A_PAYLOAD");
      if (kind === "invalid-control") owned.send({ command: "NEW_UNSELECTED_CONTROL" });
      else if (kind === "signal") owned.kill("SIGTERM");
      else owned.disconnect();
      const [result] = await Promise.all([processTerminal, stdoutEnd, stderrEnd]);
      clearTimeout(timeout);
      let absent = false;
      try {
        process.kill(owned.pid!, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        absent = true;
      }
      terminal = {
        ...result,
        pid: owned.pid,
        forced,
        stdout,
        stderr,
        stdoutEOF: owned.stdout!.readableEnded,
        stderrEOF: owned.stderr!.readableEnded,
        reaped: true,
        events,
        pidAbsent: absent,
      };
      expect(terminal).toMatchObject({
        code: 2,
        signal: null,
        forced: false,
        stdoutEOF: true,
        stderrEOF: true,
        reaped: true,
        pidAbsent: true,
      });
      expect(stdout).toBe("NEW_TEST_DOUBLE_CLOSE_CALLED\n");
      expect(stderr).toContain("AggregateError: creator rebind and native close failed");
      expect(stderr).toContain("NEW_TEST_DOUBLE_CLOSE_REJECTION");
      if (kind === "invalid-control") expect(stderr).toContain("unselected clock control");
      expect(stderr).not.toContain("UnhandledPromiseRejection");
      expect(stderr.match(/AggregateError: creator rebind and native close failed/g)).toHaveLength(
        1,
      );
    } catch (error) {
      errors.push(error);
    } finally {
      clearTimeout(timeout);
      if (child && processTerminal && child.exitCode === null && child.signalCode === null) {
        forced = true;
        child.kill("SIGKILL");
        try {
          await processTerminal;
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
        await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
        removed = true;
      } catch (error) {
        errors.push(error);
      }
      try {
        await writeFile(
          path.join(output!, kind + ".json"),
          JSON.stringify(
            {
              fixtureKind: "HELPER_ONLY_EXPLICIT_CLOSE_REJECTION_DOUBLES",
              kind,
              source: childSource,
              sourceText: await readFile(childSource, "utf8"),
              doubles,
              terminal,
              removed,
              forced,
              errors: errors.map((e) => inspect(e, { depth: 8 })),
              installedSubjectCalled: false,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "helper failure probe or cleanup failed");
  },
  20000,
);
