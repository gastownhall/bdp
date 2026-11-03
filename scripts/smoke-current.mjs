/** Current installed SDK/service AND actual CLI; no historical startup grant. */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { withPackedWorkspace } from "./packed-workspace.mjs";
import { observeCanonicalReference } from "./canonical-reference-observation.mjs";
import { spawnChild, terminateChild } from "./e2e-ready.mjs";

assert.equal(process.argv.length, 2, "Usage: smoke-current.mjs");
await withPackedWorkspace(async (installed, signal) => {
  signal.throwIfAborted();
  const observation = await observeCanonicalReference(
    installed.installRoot,
    installed.temporaryRoot,
  );
  console.log(JSON.stringify({ event: "installed.canonical-reference.observed", ...observation }));
  signal.throwIfAborted();
  // Every case mkdtemp and CLI descendant belongs to this installation lifetime.
  const fixturesRoot = path.join(installed.temporaryRoot, "cli-fixtures");
  await mkdir(fixturesRoot);
  signal.throwIfAborted();
  const child = spawnChild(
    process.execPath,
    [fileURLToPath(new URL("./packed-cli-cases.mjs", import.meta.url)), installed.installRoot],
    {
      cwd: installed.temporaryRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !name.startsWith("BDP_")),
        ),
        TMPDIR: fixturesRoot,
        TEMP: fixturesRoot,
        TMP: fixturesRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: 150_000,
    },
  );
  let interrupt;
  const aborted = new Promise((_, reject) => {
    interrupt = () => {
      reject(signal.reason);
      void terminateChild(child).catch(() => undefined);
    };
  });
  signal.addEventListener("abort", interrupt, { once: true });
  if (signal.aborted) interrupt();
  console.log(
    JSON.stringify({
      event: "installed.canonical-cli.started",
      pid: child.child.pid,
      temporaryRoot: installed.temporaryRoot,
      fixturesRoot,
    }),
  );
  let failure,
    failed = false;
  try {
    const result = await Promise.race([child.result, aborted]);
    signal.throwIfAborted();
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /(?:#|ℹ) tests 9/);
    assert.match(result.stdout, /(?:#|ℹ) pass 9/);
    process.stdout.write(result.stdout);
    console.log(
      JSON.stringify({ event: "installed.canonical-cli.observed", cases: 9, packaged: true }),
    );
  } catch (error) {
    failure = error;
    failed = true;
  }
  signal.removeEventListener("abort", interrupt);
  try {
    await terminateChild(child);
  } catch (cleanupError) {
    if (failed)
      throw new AggregateError([failure, cleanupError], "Packed driver and cleanup failed", {
        cause: failure,
      });
    throw cleanupError;
  }
  if (failed) throw failure;
});
