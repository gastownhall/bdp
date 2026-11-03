/** Real built reference observations and runner lifecycle controls; no numeric gate. */
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { spawnChild, terminateChild } from "../e2e-ready.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
async function run(args, { lateSignal = false, env = process.env } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bdp-perf-control-"));
  const output = path.join(directory, "report.json");
  let signaled = false,
    buffer = "";
  const record = spawnChild(
    process.execPath,
    ["scripts/perf/reference-trends.mjs", "--output", output, ...args],
    {
      cwd: root,
      env: { ...env, TMPDIR: directory, TEMP: directory, TMP: directory },
      stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: 15_000,
      onStderr(chunk) {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('{"event":"reference-perf.checkpoint"')) continue;
          const event = JSON.parse(line);
          if (lateSignal && !signaled && event.phase === "closed") {
            signaled = true;
            // Hold the real process only at its observed closed-checkpoint boundary.
            record.child.kill("SIGSTOP");
            record.child.kill("SIGTERM");
            record.child.kill("SIGCONT");
          }
        }
      },
    },
  );
  let result, failure, value;
  try {
    result = await record.result;
    let report;
    try {
      report = JSON.parse(await readFile(output, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const storePresenceBeforeControlCleanup = [];
    for (const rep of report?.repetitions ?? []) {
      let exists = false;
      if (rep.cleanup.ownedTemporaryDirectory) {
        try {
          await access(rep.cleanup.ownedTemporaryDirectory);
          exists = true;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      storePresenceBeforeControlCleanup.push(exists);
    }
    value = { ...result, report, signaled, storePresenceBeforeControlCleanup };
  } catch (error) {
    failure = error;
  }
  {
    const errors = [];
    try {
      await terminateChild(record);
    } catch (error) {
      errors.push(error);
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(
        [...(failure ? [failure] : []), ...errors],
        "Performance control cleanup failed",
      );
  }
  if (failure) throw failure;
  return value;
}

for (const scale of ["small", "medium"]) {
  test(`actual ${scale} default series records fresh-store repetitions and complete raw measurements`, {
    timeout: 20_000,
  }, async () => {
    const result = await run(["--scale", scale]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.signal, null);
    const report = result.report;
    assert.equal(report.status, "passed");
    assert.equal(report.workload.repetitions, 5);
    assert.equal(report.repetitions.length, report.workload.repetitions);
    assert.equal(report.toolchain.pnpm, "11.20.0");
    assert.equal(
      report.toolchain.pnpmVersionSource,
      process.env.npm_execpath
        ? "verified pnpm entry command"
        : "invoking pnpm npm_config_user_agent",
    );
    assert.equal(report.source.builtReferenceSha256, undefined);
    assert.match(report.source.builtReferenceEntrySha256, /^[a-f0-9]{64}$/);
    assert.equal(report.host.availableMemoryBytesAtStart, undefined);
    assert.equal(typeof report.host.freeMemoryBytesAtStart, "number");
    assert.equal(
      new Set(report.repetitions.map((rep) => rep.cleanup.ownedTemporaryDirectory)).size,
      report.repetitions.length,
    );
    for (const [index, rep] of report.repetitions.entries()) {
      assert.equal(rep.repetition, index);
      assert.equal(rep.status, "passed");
      assert.equal(rep.cleanup.ownerCloseState, "closed");
      assert.equal(rep.cleanup.removedOwnedDirectory, true);
      assert.equal(rep.cleanup.closeError, null);
      assert.equal(rep.cleanup.removeError, null);
      assert.equal(result.storePresenceBeforeControlCleanup[index], false);
      const observations = report.observations.filter((entry) => entry.repetition === index);
      assert.equal(
        observations.filter((entry) => entry.operation === "createBead").length,
        report.workload.beads,
      );
      assert.equal(
        observations.filter((entry) => entry.operation === "originalKeyReplay").length,
        report.workload.beads,
      );
      assert(observations.some((entry) => entry.operation === "reopen"));
      assert(
        report.checkpoints.some((entry) => entry.repetition === index && entry.phase === "closed"),
      );
    }
  });
}

test("late SIGTERM after final close reports failure and removes the actual owned store", {
  timeout: 20_000,
}, async () => {
  const result = await run(["--repetitions", "1"], { lateSignal: true });
  assert(result.signaled);
  assert.equal(result.signal, null);
  assert.equal(result.code, 143, result.stderr);
  assert.equal(result.report.status, "failed");
  assert.match(result.report.error.message, /interrupted by SIGTERM/);
  const rep = result.report.repetitions[0];
  assert.equal(rep.status, "failed");
  assert.match(rep.error.message, /interrupted by SIGTERM/);
  assert.equal(rep.cleanup.ownerCloseState, "closed");
  assert.equal(rep.cleanup.removedOwnedDirectory, true);
  assert.equal(result.storePresenceBeforeControlCleanup[0], false);
});

for (const args of [
  ["--scale", "unbounded"],
  ["--repetitions", "0"],
  ["--repetitions", "11"],
  ["--repetitions", "1.5"],
]) {
  test(`invalid workload is refused: ${args.join(" ")}`, async () => {
    const result = await run(args);
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.report, undefined);
    assert.match(result.stderr, /scale must be|repetitions must be/);
    assert(!result.stderr.includes('"event":"reference-perf.checkpoint"'));
  });
}

test("an npm entry is refused as npm rather than mislabeled as a pnpm version", async () => {
  const result = await run(["--repetitions", "1"], {
    env: {
      ...process.env,
      npm_config_user_agent: "npm/11.12.1 node/v24.22.1",
      npm_execpath: "/nonexistent/npm-cli.js",
    },
  });
  assert.equal(result.code, 1);
  assert.equal(result.report, undefined);
  assert.match(result.stderr, /other package-manager user agents are unsupported/);
  assert(!result.stderr.includes("use the pinned pnpm version"));
});

test("a non-pnpm exec path cannot be relabeled by a pnpm user agent", async () => {
  const result = await run(["--repetitions", "1"], {
    env: {
      ...process.env,
      npm_config_user_agent: "pnpm/11.20.0 node/v24.22.1",
      npm_execpath: process.execPath,
    },
  });
  assert.equal(result.code, 1);
  assert.equal(result.report, undefined);
  assert.match(result.stderr, /npm_execpath must identify pnpm/);
});
