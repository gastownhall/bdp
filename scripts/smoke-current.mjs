/** Current installed SDK/service AND actual CLI; no historical startup grant. */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { withPackedWorkspace, withPackedChild } from "./packed-workspace.mjs";
import { observeCanonicalReference } from "./canonical-reference-observation.mjs";

assert.equal(process.argv.length, 2, "Usage: smoke-current.mjs");
await withPackedWorkspace(async (installed, signal) => {
  signal.throwIfAborted();
  const observation = await observeCanonicalReference(
    installed.installRoot,
    installed.temporaryRoot,
  );
  signal.throwIfAborted();
  console.log(JSON.stringify({ event: "installed.canonical-reference.observed", ...observation }));
  // Every case mkdtemp and CLI descendant belongs to this installation lifetime.
  const fixturesRoot = path.join(installed.temporaryRoot, "cli-fixtures");
  await mkdir(fixturesRoot);
  signal.throwIfAborted();
  await withPackedChild(
    signal,
    process.execPath,
    [fileURLToPath(new URL("./packed-cli-cases.mjs", import.meta.url)), installed.installRoot],
    {
      cwd: installed.temporaryRoot,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([name]) => !name.startsWith("BDP_")),
        ),
        ...(process.env.BDP_SPEC_REVISION === undefined
          ? {}
          : { BDP_SPEC_REVISION: process.env.BDP_SPEC_REVISION }),
        TMPDIR: fixturesRoot,
        TEMP: fixturesRoot,
        TMP: fixturesRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: 150_000,
    },
    async (child) => {
      console.log(
        JSON.stringify({
          event: "installed.canonical-cli.started",
          pid: child.child.pid,
          temporaryRoot: installed.temporaryRoot,
          fixturesRoot,
        }),
      );
      const result = await child.result;
      process.stdout.write(result.stdout);
      if (result.stdout && !result.stdout.endsWith("\n")) process.stdout.write("\n");
      signal.throwIfAborted();
      assert.equal(result.code, 0, result.stderr || result.stdout);
      assert.equal(result.signal, null);
      assert.match(result.stdout, /^(?:#|ℹ) tests 10\s*$/m);
      assert.match(result.stdout, /^(?:#|ℹ) pass 10\s*$/m);
      console.log(
        JSON.stringify({ event: "installed.canonical-cli.observed", cases: 10, packaged: true }),
      );
    },
  );
});
