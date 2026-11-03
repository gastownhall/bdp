/** Actual package custody and cleanup, including the failed-observation path. */
import assert from "node:assert/strict";
import { access, readdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnChild, terminateChild } from "./e2e-ready.mjs";
import test from "node:test";
import { withPackedWorkspace } from "./packed-workspace.mjs";

// Observe the real installed CLI while a case-owned fixture exists. The driver
// started event alone precedes case allocation and cannot prove cleanup coverage.
async function activeCase(started) {
  const binary = path.join(started.temporaryRoot, "install", "node_modules", ".bin", "bdp");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const fixtures = await readdir(started.fixturesRoot);
    const { stdout } = await promisify(execFile)("ps", ["-axo", "pid=,ppid=,pgid=,command="]);
    for (const line of stdout.split("\n")) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (
        match &&
        Number(match[2]) === started.pid &&
        Number(match[3]) === started.pid &&
        match[4].includes(binary) &&
        fixtures.some((name) => name.startsWith("bdp-cli-"))
      ) {
        // Hold this real child at the OS boundary so a fast help invocation
        // cannot finish between observation and parent interruption.
        try {
          process.kill(Number(match[1]), "SIGSTOP");
          const { stdout: state } = await promisify(execFile)("ps", [
            "-p",
            match[1],
            "-o",
            "stat=",
          ]);
          if (state.trim().startsWith("T")) return { pid: Number(match[1]), fixtures };
        } catch (error) {
          if (error.code !== "ESRCH" && error.code !== 1) throw error;
        }
      }
    }
    await delay(10);
  }
  throw new Error("No active installed CLI with an owned case fixture observed");
}

async function removed(directory) {
  await assert.rejects(access(directory), { code: "ENOENT" });
}

test("owned packed installation is removed after a successful observation", async () => {
  let directory;
  const value = await withPackedWorkspace(async (installed) => {
    directory = installed.temporaryRoot;
    await access(installed.entry("bdp"));
    return "observed actual package";
  });
  assert.equal(value, "observed actual package");
  assert.equal(typeof directory, "string");
  await removed(directory);
});

test("failed observation stays failed and removes the actual packed installation", async () => {
  let directory;
  const failure = new Error("deliberate observation failure");
  await assert.rejects(
    withPackedWorkspace(async (installed) => {
      directory = installed.temporaryRoot;
      await access(installed.entry("bdp"));
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(typeof directory, "string");
  await removed(directory);
});

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`parent ${signal} stops the actual packed driver and removes its installation`, {
    timeout: 75_000,
  }, async () => {
    let started,
      buffer = "",
      resolveStarted;
    const active = new Promise((resolve) => {
      resolveStarted = resolve;
    });
    const record = spawnChild(
      process.execPath,
      [fileURLToPath(new URL("./smoke-current.mjs", import.meta.url))],
      {
        cwd: path.resolve(fileURLToPath(new URL("../", import.meta.url))),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        timeoutMs: 60_000,
        onStdout(chunk) {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("{")) continue;
            const value = JSON.parse(line);
            if (value.event === "installed.canonical-cli.started") {
              started = value;
              resolveStarted(value);
            }
          }
        },
      },
    );
    let stopped = false,
      failure;
    try {
      await Promise.race([
        active,
        record.result.then((result) => {
          throw new Error(
            `Smoke exited before driver activation: ${result.stderr || result.stdout}`,
          );
        }),
      ]);
      assert(Number.isInteger(started.pid) && started.pid > 0);
      assert.equal(typeof started.temporaryRoot, "string");
      assert.match(path.basename(started.temporaryRoot), /^bdp-smoke-/);
      await access(path.join(started.temporaryRoot, "install", "node_modules", ".bin", "bdp"));
      assert.equal(started.fixturesRoot, path.join(started.temporaryRoot, "cli-fixtures"));
      const runningCase = await activeCase(started);
      assert(runningCase.fixtures.length > 0);
      process.kill(runningCase.pid, 0);
      // Signal only the smoke parent: its detached packed driver must be cleaned
      // by the lifetime handler, rather than accidentally sharing this signal.
      process.kill(-started.pid, 0);
      record.child.kill(signal);
      const result = await record.result;
      assert.equal(result.signal, null);
      assert.equal(result.code, exitCode, result.stderr || result.stdout);
      assert.match(result.stderr, new RegExp(`Packed workspace interrupted by ${signal}`));
      assert(!result.stdout.includes('"event":"installed.canonical-cli.observed"'));
      assert.throws(() => process.kill(-started.pid, 0), { code: "ESRCH" });
      assert.throws(() => process.kill(runningCase.pid, 0), { code: "ESRCH" });
      stopped = true;
      await removed(started.fixturesRoot);
      await removed(started.temporaryRoot);
    } catch (error) {
      failure = error;
    }
    try {
      await terminateChild(record);
      if (started && !stopped) {
        try {
          process.kill(-started.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH" && error.code !== 1) throw error;
        }
      }
      if (started) await rm(started.temporaryRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      if (failure)
        throw new AggregateError(
          [failure, cleanupError],
          "Interruption control and cleanup failed",
          { cause: failure },
        );
      throw cleanupError;
    }
    if (failure) throw failure;
  });
}
