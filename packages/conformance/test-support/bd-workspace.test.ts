import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { seedBdWorkspace, type BdWorkspaceSeed } from "./bd-workspace.js";

interface CommandTrace {
  readonly args: readonly string[];
  readonly creationSecond: number;
  readonly pid: number;
}

describe("actual bd workspace seeder with controlled creation-second witness", () => {
  it.each(["ready-trio", "unrelated-ids"] as const)(
    "separates every consecutive creation for %s while preserving public commands",
    async (kind) => {
      const directory = await mkdtemp(path.join(tmpdir(), "bdp-seed-contract-"));
      const controller = new AbortController();
      const realSetTimeout = globalThis.setTimeout;
      try {
        const workspace = path.join(directory, "workspace");
        await mkdir(workspace);
        const tracePath = path.join(directory, "commands.jsonl");
        const executable = path.join(directory, "fake-bd.mjs");
        // This real child executable only records the seeder's commands. It
        // does not implement bd, create issues, or manufacture ready results.
        await writeFile(
          executable,
          `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nappendFileSync(process.env.SEED_TRACE, JSON.stringify({ args: process.argv.slice(2), creationSecond: Math.floor(Number(process.env.SEED_EPOCH) / 1000), pid: process.pid }) + "\\n");\n`,
          { mode: 0o755 },
        );
        const environment: Record<string, string> = {
          PATH: process.env.PATH ?? "",
          HOME: directory,
          SEED_TRACE: tracePath,
          SEED_EPOCH: "0",
        };
        let epoch = 0;
        // Advance only the spacing clock. Actual spawn/streams/close events and
        // the helper's 10-second command deadlines keep their native behavior.
        vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, milliseconds, ...args) => {
          if (milliseconds !== 1_100) return realSetTimeout(handler, milliseconds, ...args);
          return realSetTimeout(() => {
            epoch += 1_100;
            environment.SEED_EPOCH = String(epoch);
            handler(...args);
          }, 0);
        });
        const ids =
          kind === "ready-trio"
            ? (["demo-a", "demo-d", "demo-j"] as const)
            : (["other-x", "other-y", "other-z"] as const);
        const seed: BdWorkspaceSeed = {
          actor: "seed-contract",
          prefix: kind === "ready-trio" ? "demo" : "other",
          beads: ids.map((id, index) => ({
            id,
            title: kind === "ready-trio" ? id.slice(-1).toUpperCase() : `Item ${index}`,
            type: "task",
            priority: 2,
            status:
              kind === "unrelated-ids" && index === 1
                ? "closed"
                : kind === "unrelated-ids" && index === 2
                  ? "deferred"
                  : "open",
          })),
          links: kind === "ready-trio" ? [] : [{ source: ids[0], target: ids[1], type: "blocks" }],
        };
        await seedBdWorkspace(executable, workspace, environment, seed, controller.signal);
        const commands = (await readFile(tracePath, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as CommandTrace);
        const expectedCommands = [
          ["init", "--prefix", seed.prefix, "--skip-agents", "--skip-hooks"],
          ...seed.beads.map((bead) => [
            "create",
            bead.title,
            "--id",
            bead.id,
            "--type",
            bead.type,
            "--priority",
            String(bead.priority),
            "--silent",
          ]),
          ...seed.links.map((link) => [
            "dep",
            "add",
            link.source,
            link.target,
            "--type",
            link.type,
          ]),
          ...(kind === "unrelated-ids"
            ? [
                ["close", ids[1], "--reason", "conformance fixture"],
                ["defer", ids[2]],
              ]
            : []),
        ];
        expect(commands.map((command) => command.args)).toEqual(
          expectedCommands.map((args) => ["--actor", seed.actor, ...args]),
        );
        for (const command of commands) {
          // seedBdWorkspace returns only after the real child close event.
          expect(() => process.kill(command.pid, 0)).toThrow(
            expect.objectContaining({ code: "ESRCH" }),
          );
        }
        const creations = commands.filter((command) => command.args[2] === "create");
        expect(creations.map((command) => command.args[5])).toEqual(ids);
        // Observe epochs recorded by the actual children at command execution,
        // not the number of timer calls. Removing any creation gap makes a tie.
        expect(creations.map((command) => command.creationSecond)).toEqual([0, 1, 2]);
      } finally {
        controller.abort();
        vi.restoreAllMocks();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

// These executables exercise real spawn/signal/close boundaries, not bd semantics.
// Their trace is outside the removable root and survives a deliberately broken pair.
const lifecycleWitness = String.raw`
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
const directory = process.env.SEED_LIFECYCLE;
const mode = process.env.SEED_MODE;
const workspace = path.basename(process.cwd());
const args = process.argv.slice(2);
const mark = (name) => writeFileSync(path.join(directory, name), String(Date.now()));
writeFileSync(path.join(directory, "pid-" + process.pid), String(process.pid));
appendFileSync(path.join(directory, "commands.jsonl"), JSON.stringify({ workspace, args, pid: process.pid }) + "\n");
const wait = async (name) => {
  const until = Date.now() + 4000;
  while (!existsSync(path.join(directory, name))) {
    if (Date.now() >= until) throw new Error("witness coordination expired: " + name);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const failing = workspace === (mode === "fail-left" ? "left" : "right");
if (mode === "success") {
  if (args[2] === "init") {
    mark("ready-" + workspace);
    await wait("ready-" + (workspace === "left" ? "right" : "left"));
  }
} else if (mode === "spacing" && !failing) {
  // Every cooperative command, including create #2 under a mutant, exits 0.
} else if (mode !== "parent" && failing) {
  await wait(mode === "spacing" ? "gap" : "ready-" + (workspace === "left" ? "right" : "left"));
  mark("failure-exit");
  process.exitCode = 23;
} else {
  process.on("SIGTERM", () => mark("term-" + workspace));
  mark("ready-" + workspace);
  setInterval(() => {}, 1000);
}
`;

const lifecycleDriver = String.raw`
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
const [source, directory, mode] = process.argv.slice(2);
// No helper import or seed command runs before the outer owner proves our PGID.
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("containment release timeout")), 2000);
  process.stdin.once("data", (data) => {
    clearTimeout(timeout);
    if (String(data) !== "release\n") reject(new Error("invalid containment release"));
    else resolve();
  });
});
process.stdin.pause();
if (mode === "report-and-output") {
  const accepted = new Promise((resolve) => process.once("message", (message) => {
    if (message !== "report-accepted") throw new Error("unexpected owner acknowledgement");
    resolve();
  }));
  await new Promise((resolve) => process.send({ ok: true }, resolve));
  await accepted;
  await new Promise((resolve) => process.stdout.write(Buffer.alloc(1048577, "x"), resolve));
  process.disconnect();
  process.exit(0);
}
if (mode === "report-and-hang") {
  process.send({ ok: true });
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
// Observe real close delivery before the helper registers its own close handler.
// The native spawn, child, signals and outcome are returned unchanged.
const nativeSpawn = childProcess.spawn;
let failureDelivered;
let failureDeliveredAt;
childProcess.spawn = (...args) => {
  const child = nativeSpawn(...args);
  if (child.pid !== undefined) writeFileSync(path.join(directory, "pid-" + child.pid), String(child.pid));
  child.once("close", (code) => { if (code === 23) { failureDelivered = Date.now(); failureDeliveredAt = performance.now(); } });
  return child;
};
syncBuiltinESMExports();
const { seedBdWorkspacePair } = await import(source);
const root = path.join(directory, "shared");
const left = path.join(root, "left"), right = path.join(root, "right");
mkdirSync(left, { recursive: true }); mkdirSync(right);
const parent = new AbortController();
const sentinel = new Error("caller cancellation sentinel");
const environment = { PATH: process.env.PATH ?? "", HOME: directory, SEED_LIFECYCLE: directory, SEED_MODE: ["client-loss", "driver-loss"].includes(mode) ? "parent" : mode };
const seed = {
  actor: "lifecycle", prefix: "pair",
  beads: [
    { id: "pair-a", title: "A", type: "task", priority: 2, status: "closed" },
    { id: "pair-b", title: "B", type: "task", priority: 2, status: "deferred" },
  ],
  links: [{ source: "pair-a", target: "pair-b", type: "blocks" }],
};
const pidRegistry = () => readdirSync(directory).filter((name) => name.startsWith("pid-")).map((name) => Number(name.slice(4)));
const absent = (pid) => {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === "ESRCH") return true; throw error; }
};
const marker = (name) => existsSync(path.join(directory, name));
const nativeTimeout = globalThis.setTimeout;
if (mode === "spacing") globalThis.setTimeout = (handler, delay, ...args) => {
  const timer = nativeTimeout(handler, delay, ...args);
  if (delay === 1100) writeFileSync(path.join(directory, "gap"), String(Date.now()));
  return timer;
};
let stopped = false;
let watcher;
let timer;
let rejectedAt;
let abortedAt;
let result;
const start = performance.now();
try {
  if (mode === "preabort") parent.abort(sentinel);
  const pair = seedBdWorkspacePair(
    path.join(directory, "witness.mjs"),
    [left, mode === "same-path" ? path.join(left, ".") : right],
    environment, seed, parent.signal,
  ).then(() => ({ ok: true }), (error) => {
    rejectedAt = performance.now();
    return { ok: false, error };
  });
  // Watches only acknowledge phases; the watchdog never aborts a subject signal.
  watcher = (async () => {
    if (mode !== "parent" && mode !== "later-parent") return;
    while (!stopped) {
      if (mode === "parent" ? marker("ready-left") && marker("ready-right") : marker("term-left")) {
        abortedAt = performance.now(); parent.abort(sentinel); return;
      }
      await new Promise((resolve) => nativeTimeout(resolve, 10));
    }
  })();
  const outcome = await Promise.race([
    pair,
    new Promise((resolve) => { timer = nativeTimeout(() => resolve({ guard: true }), 5000); }),
  ]);
  assert.ok(!outcome.guard, "subject watchdog: pair did not settle within 5s");
  const elapsed = performance.now() - start;
  // No awaited cleanup, polling or fallback occurs before this liveness assertion.
  const pids = pidRegistry();
  const live = pids.filter((pid) => !absent(pid));
  const probeDelay = rejectedAt === undefined ? 0 : performance.now() - rejectedAt;
  assert.ok(probeDelay < 100, "inconclusive setup: rejection-to-PID probe delayed");
  writeFileSync(path.join(directory, "boundary.json"), JSON.stringify({ elapsed, probeDelay, pids, live }));
  assert.deepEqual(live, [], "pair settled while seed PID still exists");
  let commands;
  try {
    commands = marker("commands.jsonl") ? readFileSync(path.join(directory, "commands.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  } catch (cause) { throw new Error("inconclusive setup: invalid command trace", { cause }); }
  if (mode === "later-parent") {
    assert.ok(failureDeliveredAt <= abortedAt && abortedAt < rejectedAt, "inconclusive setup: parent abort missed the captured-failure drain");
    writeFileSync(path.join(directory, "abort-order.json"), JSON.stringify({ failureDeliveredAt, abortedAt, rejectedAt }));
  }
  if (mode === "success") {
    assert.equal(outcome.ok, true);
    const expected = [
      ["init", "--prefix", "pair", "--skip-agents", "--skip-hooks"],
      ["create", "A", "--id", "pair-a", "--type", "task", "--priority", "2", "--silent"],
      ["create", "B", "--id", "pair-b", "--type", "task", "--priority", "2", "--silent"],
      ["dep", "add", "pair-a", "pair-b", "--type", "blocks"],
      ["close", "pair-a", "--reason", "conformance fixture"], ["defer", "pair-b"],
    ].map((args) => ["--actor", "lifecycle", ...args]);
    for (const workspace of ["left", "right"]) assert.deepEqual(commands.filter((c) => c.workspace === workspace).map((c) => c.args), expected);
  } else {
    assert.equal(outcome.ok, false);
    if (mode === "preabort" || mode === "parent") assert.equal(outcome.error, sentinel, "caller reason identity");
    else if (mode === "same-path") assert.match(outcome.error.message, /distinct/);
    else {
      assert.ok(outcome.error instanceof Error);
      assert.equal(outcome.error.message, "bd command failed with exit 23");
      assert.notEqual(outcome.error, sentinel);
    }
    if (mode === "preabort" || mode === "same-path") assert.deepEqual(commands, [], "refused pair spawned a child");
    else if (mode === "spacing") {
      const gapStart = Number(readFileSync(path.join(directory, "gap"), "utf8"));
      const deliveryDelta = failureDelivered - gapStart;
      writeFileSync(path.join(directory, "spacing.json"), JSON.stringify({ deliveryDelta, boundaryAfterGap: Date.now() - gapStart }));
      assert.ok(deliveryDelta < 1100, "inconclusive setup: failure missed the spacing gap");
      assert.ok(Date.now() - gapStart >= 1100, "pair abandoned the active spacing gap");
      assert.equal(commands.filter((c) => c.args[2] === "create").length, 1, "cancellation allowed create #2");
    } else {
      for (const workspace of mode === "parent" ? ["left", "right"] : [mode === "fail-left" ? "right" : "left"]) assert.ok(marker("term-" + workspace), "missing SIGTERM acknowledgement");
      assert.equal(commands.length, 2, "command spawned after cancellation");
    }
  }
  assert.equal(parent.signal.aborted, ["parent", "preabort", "later-parent"].includes(mode), "pair seized the parent controller");
  rmSync(root, { recursive: true, force: true });
  assert.equal(existsSync(root), false);
  result = { ok: true, elapsed, probeDelay, pids };
} catch (error) {
  result = { ok: false, error: error.stack ?? String(error) };
} finally {
  stopped = true;
  clearTimeout(timer);
  globalThis.setTimeout = nativeTimeout;
  childProcess.spawn = nativeSpawn;
  syncBuiltinESMExports();
  await watcher;
}
process.send(result, () => process.disconnect());
`;

function processAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
    throw error;
  }
}

const lifecycleOwner = String.raw`
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, renameSync, appendFileSync } from "node:fs";
import path from "node:path";
const [source, directory, mode] = process.argv.slice(2);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// An EPERM probe is inconclusive, never absence. Bounded cleanup waits must still observe ESRCH.
const absent = (pid) => {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === "ESRCH") return true; if (error.code === "EPERM") return false; throw error; }
};
const signal = (pid, value) => {
  try { process.kill(pid, value); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
};
const waitFor = async (predicate, ms) => {
  const until = performance.now() + ms;
  while (!predicate() && performance.now() < until) await delay(10);
  return predicate();
};
const pgid = (pid) => {
  const value = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8", timeout: 1000 }).trim();
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("containment setup: invalid PGID");
  return Number(value);
};
let selected, select, lateFailure;
const completion = new Promise((resolve) => { select = (value) => { if (!selected) { selected = value; resolve(value); } }; });
const stop = (reason) => { if (selected) lateFailure ??= reason; select({ ok: false, error: reason }); };
// Installed before driver creation. This process survives client group teardown.
process.on("disconnect", () => stop("lifecycle client disconnected"));
process.on("SIGTERM", () => stop("lifecycle owner terminated"));
process.on("SIGINT", () => stop("lifecycle owner interrupted"));
const deadline = setTimeout(() => stop("lifecycle owner deadline"), 10000);
let child, contained = false, released = false, closed = false, closeCode, closeSignal, output = "", outputBytes = 0;
let result, cleanupError;
const signals = [];
let seedPids = [];
try {
  if (!process.connected) throw new Error("lifecycle client already disconnected");
  const argv = ["--experimental-strip-types", path.join(directory, "driver.mjs"), source, directory, mode];
  child = spawn(process.execPath, argv, { detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"] });
  child.once("error", (error) => stop("driver error: " + error.message));
  child.once("message", (value) => {
    select(value);
    if (mode === "report-and-output") child.send("report-accepted");
  });
  child.once("close", (code, value) => {
    closed = true; closeCode = code; closeSignal = value;
    if (!selected) stop("driver closed before reporting: " + output);
  });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    outputBytes += chunk.length;
    if (outputBytes > 1048576) stop("driver output bound");
    else output += chunk.toString();
  });
  if (!child.pid) throw new Error("containment setup: missing driver PID");
  const driverPgid = pgid(child.pid), ownerPgid = pgid(process.pid);
  if (driverPgid !== child.pid || driverPgid === ownerPgid) throw new Error("containment setup: driver group not independent");
  contained = true;
  const identity = { pid: child.pid, directory, driver: argv[1], argv, pgid: driverPgid, ownerPid: process.pid, ownerPgid, verified: true, releaseAuthorized: true };
  const recordPath = path.join(directory, "owner-driver.json");
  writeFileSync(recordPath + ".tmp", JSON.stringify(identity));
  renameSync(recordPath + ".tmp", recordPath);
  if (process.env.BDP_SEED_DRIVER_REGISTRY) {
    appendFileSync(process.env.BDP_SEED_DRIVER_REGISTRY, JSON.stringify({ ...identity, source }) + "\n");
  }
  // Let queued disconnect/signal events refuse release; the mandatory record is already durable.
  await new Promise((resolve) => setImmediate(resolve));
  if (!process.connected || selected) throw new Error("containment release refused after shutdown");
  child.stdin.end("release\n"); released = true;
  result = await completion;
  if (result.ok) {
    const graceful = await waitFor(() => closed, 750);
    seedPids = readdirSync(directory).filter((name) => /^pid-[0-9]+$/.test(name)).map((name) => Number(name.slice(4)));
    if (lateFailure) result = { ok: false, error: lateFailure, subject: result };
    if (!graceful || closeCode !== 0 || closeSignal !== null || !absent(-child.pid) || seedPids.some((pid) => !absent(pid)))
      result = { ok: false, error: "driver liveness failure after successful report", subject: result };
  }
} catch (error) { result = selected ?? { ok: false, error: error.stack ?? String(error) }; }
finally {
  clearTimeout(deadline);
  try {
    if (child?.pid) {
      const target = contained ? -child.pid : child.pid;
      if (!absent(target)) {
        signals.push("SIGTERM"); signal(target, "SIGTERM");
        if (!(await waitFor(() => absent(target), 750))) {
          signals.push("SIGKILL"); signal(target, "SIGKILL");
          if (!(await waitFor(() => absent(target), 1500))) throw new Error("driver group survived fallback");
        }
      }
      if (!(await waitFor(() => closed, 1500))) throw new Error("driver native close missing");
      seedPids = readdirSync(directory).filter((name) => /^pid-[0-9]+$/.test(name)).map((name) => Number(name.slice(4)));
      if (seedPids.some((pid) => !absent(pid))) throw new Error("seed survived fallback");
    }
  } catch (error) { cleanupError = error.stack ?? String(error); }
  if (lateFailure && result.ok) result = { ok: false, error: lateFailure, subject: result };
  const receipt = { result, supervisionError: lateFailure, contained, released, closed, closeCode, closeSignal, signals, seedPids, seedPidsObserved: seedPids.length, cleanupError, outputBytes, outputTail: output.slice(-4096), ownerPid: process.pid, driverPid: child?.pid };
  // Preserve failed cleanup evidence as well as successful absence observations.
  const receiptPath = path.join(directory, "owner-receipt.json");
  writeFileSync(receiptPath + ".tmp", JSON.stringify(receipt));
  renameSync(receiptPath + ".tmp", receiptPath);
  if (cleanupError) {
    child?.stdin?.destroy(); child?.stdout?.destroy(); child?.stderr?.destroy();
    if (child?.connected) child.disconnect(); child?.unref();
  }
  if (process.connected) await new Promise((resolve) => process.send(receipt, () => { if (process.connected) process.disconnect(); resolve(); }));
}
`;

const lifecycleClient = `
import { spawn } from "node:child_process";
import { writeFileSync, renameSync } from "node:fs";
import path from "node:path";
const [source, directory, mode] = process.argv.slice(2);
const child = spawn(process.execPath, [path.join(directory, "owner.mjs"), source, directory, mode], { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
const clientPath = path.join(directory, "owner-client.json");
writeFileSync(clientPath + ".tmp", JSON.stringify({ ownerPid: child.pid, clientPid: process.pid }));
renameSync(clientPath + ".tmp", clientPath);
child.on("message", () => {});
`;

describe("lifecycle record publication", () => {
  it.each([
    ["owner-receipt.json", "receiptPath", lifecycleOwner],
    ["owner-client.json", "clientPath", lifecycleClient],
  ])("keeps %s invisible until its JSON is complete", async (name, localPath, source) => {
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-record-publication-"));
    const finalPath = path.join(directory, name);
    const receipt = { ownerPid: 42, clientPid: 43 };
    // Execute the generated fixture's actual publication statements. Interpose
    // after opening the destination but before writing bytes: this is the exact
    // boundary at which an existsSync-based reader could otherwise see empty JSON.
    const publication = source
      .split("\n")
      .filter((line) => line.includes(name) || line.includes(localPath))
      .join("\n");
    let writes = 0;
    try {
      runInNewContext(publication, {
        directory,
        path,
        receipt,
        child: { pid: receipt.ownerPid },
        process: { pid: receipt.clientPid },
        renameSync,
        writeFileSync: (destination: string, data: string) => {
          const fd = openSync(destination, "w");
          try {
            writes++;
            expect(existsSync(finalPath)).toBe(false);
            writeFileSync(fd, data);
          } finally {
            closeSync(fd);
          }
        },
      });
      expect(writes).toBe(1);
      expect(JSON.parse(readFileSync(finalPath, "utf8"))).toEqual(receipt);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

interface LifecycleReceipt {
  result: { ok: boolean; error?: string };
  contained: boolean;
  released: boolean;
  closed: boolean;
  cleanupError?: string;
  ownerPid: number;
  driverPid: number;
  seedPids: number[];
  seedPidsObserved: number;
  outputBytes: number;
}

async function superviseSeedLifecycle(mode: string): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-pair-lifecycle-"));
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate: () => boolean, milliseconds: number) => {
    const until = performance.now() + milliseconds;
    while (!predicate() && performance.now() < until) await delay(10);
    return predicate();
  };
  const signal = (pid: number, value: NodeJS.Signals) => {
    try {
      process.kill(pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  let child: ReturnType<typeof spawn> | undefined;
  let closed = false;
  let ownerPid: number | undefined;
  let ownerContained = false;
  let guard: NodeJS.Timeout | undefined;
  let receipt: LifecycleReceipt | undefined;
  const failures: unknown[] = [];
  const source = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "bd-workspace.ts"),
  ).href;
  const recordPath = path.join(directory, "owner-driver.json");
  const record = () => {
    const value = JSON.parse(readFileSync(recordPath, "utf8")) as {
      pid: number;
      pgid: number;
      ownerPid: number;
      ownerPgid: number;
      directory: string;
      driver: string;
      verified: boolean;
    };
    if (
      !Number.isSafeInteger(value.pid) ||
      value.pid <= 0 ||
      value.pgid !== value.pid ||
      value.ownerPid !== ownerPid ||
      value.ownerPgid !== ownerPid ||
      value.pgid === ownerPid ||
      value.directory !== directory ||
      value.driver !== path.join(directory, "driver.mjs") ||
      !value.verified
    )
      throw new Error("containment fallback: invalid driver identity");
    return value;
  };
  const cleanup = async () => {
    // Disconnect asks the independent owner to clean up before final fallback.
    if (child?.connected) child.disconnect();
    const ownerTarget = ownerPid === undefined ? undefined : ownerContained ? -ownerPid : ownerPid;
    if (ownerTarget !== undefined && !(await waitFor(() => processAbsent(ownerTarget), 4500))) {
      failures.push(new Error("independent owner required forced fallback"));
      signal(ownerTarget, "SIGTERM");
      if (!(await waitFor(() => processAbsent(ownerTarget), 1000))) {
        signal(ownerTarget, "SIGKILL");
        if (!(await waitFor(() => processAbsent(ownerTarget), 1500)))
          throw new Error("owner group survived fallback");
      }
    }
    if (existsSync(recordPath)) {
      const identity = record();
      if (!processAbsent(-identity.pid)) {
        failures.push(new Error("driver required outer fallback"));
        signal(-identity.pid, "SIGTERM");
        if (!(await waitFor(() => processAbsent(-identity.pid), 750))) {
          signal(-identity.pid, "SIGKILL");
          if (!(await waitFor(() => processAbsent(-identity.pid), 1500)))
            throw new Error("driver group survived outer fallback");
        }
      }
    } else if (receipt?.released) throw new Error("released driver has no ownership record");
    const pids = readdirSync(directory)
      .filter((name) => /^pid-[0-9]+$/.test(name))
      .map((name) => Number(name.slice(4)));
    for (const pid of pids)
      if (!processAbsent(pid)) throw new Error("seed survived outer fallback");
    if (child && !(await waitFor(() => closed, 1500)))
      throw new Error("client native close missing");
    const trace: Record<string, string> = {};
    for (const name of readdirSync(directory))
      if (!name.endsWith(".mjs") && name !== "shared")
        trace[name] = await readFile(path.join(directory, name), "utf8");
    console.log(`seed trace ${mode}: ${JSON.stringify(trace)}`);
    if (failures.length === 0) await rm(directory, { recursive: true, force: true });
    else console.log(`retained failed lifecycle evidence: ${directory}`);
  };
  try {
    await writeFile(
      path.join(directory, "witness.mjs"),
      `#!${process.execPath}\n${lifecycleWitness}`,
      { mode: 0o755 },
    );
    await writeFile(path.join(directory, "driver.mjs"), lifecycleDriver);
    await writeFile(path.join(directory, "owner.mjs"), lifecycleOwner);
    await writeFile(path.join(directory, "client.mjs"), lifecycleClient);
    child = spawn(
      process.execPath,
      [
        path.join(directory, mode === "client-loss" ? "client.mjs" : "owner.mjs"),
        source,
        directory,
        mode,
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    const owned = child;
    let output = "";
    const completion = new Promise<LifecycleReceipt>((resolve, reject) => {
      guard = setTimeout(() => reject(new Error("outer owner watchdog")), 16000);
      owned.once("error", reject);
      owned.once("message", (value) => resolve(value as LifecycleReceipt));
      owned.once("close", () => {
        closed = true;
        reject(new Error(`owner closed before reporting: ${output}`));
      });
      for (const stream of [owned.stdout, owned.stderr])
        stream?.on("data", (chunk: Buffer) => {
          if (Buffer.byteLength(output) + chunk.length > 1048576)
            reject(new Error("owner output bound"));
          else output += chunk.toString();
        });
    });
    void completion.catch(() => undefined);
    if (mode === "client-loss") {
      const clientRecord = path.join(directory, "owner-client.json");
      if (!(await waitFor(() => existsSync(clientRecord), 2000)))
        throw new Error("client setup expired");
      ownerPid = (JSON.parse(readFileSync(clientRecord, "utf8")) as { ownerPid: number }).ownerPid;
      if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error("invalid owner PID");
    } else ownerPid = owned.pid;
    if (!ownerPid) throw new Error("missing owner PID");
    const ownerGroup = execFileSync("ps", ["-o", "pgid=", "-p", String(ownerPid)], {
      encoding: "utf8",
      timeout: 1000,
    }).trim();
    if (ownerGroup !== String(ownerPid))
      throw new Error("containment setup: owner is not independent");
    ownerContained = true;
    const verifiedOwner = ownerPid;
    if (mode === "client-loss" || mode === "driver-loss") {
      if (
        !(await waitFor(
          () =>
            existsSync(path.join(directory, "ready-left")) &&
            existsSync(path.join(directory, "ready-right")),
          4000,
        ))
      )
        throw new Error("inconclusive setup: hostile witnesses not ready");
      const identity = record();
      expect(processAbsent(ownerPid)).toBe(false);
      if (owned.pid === undefined) throw new Error("missing client PID");
      signal(mode === "client-loss" ? owned.pid : identity.pid, "SIGKILL");
      if (mode === "client-loss") {
        if (!(await waitFor(() => existsSync(path.join(directory, "owner-receipt.json")), 6000)))
          throw new Error("owner-loss cleanup receipt missing");
        receipt = JSON.parse(
          readFileSync(path.join(directory, "owner-receipt.json"), "utf8"),
        ) as LifecycleReceipt;
      } else receipt = await completion;
    } else receipt = await completion;
    console.log(`seed lifecycle ${mode}: ${JSON.stringify(receipt)}`);
    expect(receipt.cleanupError).toBeUndefined();
    expect(receipt.contained).toBe(true);
    expect(receipt.closed).toBe(true);
    if (mode === "client-loss" || mode === "driver-loss") {
      expect(receipt.result.ok).toBe(false);
      expect(receipt.result.error).toContain(
        mode === "client-loss" ? "client disconnected" : "closed before reporting",
      );
      expect(receipt.seedPidsObserved).toBe(2);
    } else if (mode === "report-and-hang" || mode === "report-and-output") {
      expect(receipt.result.ok).toBe(false);
      expect(receipt.result.error).toContain(
        mode === "report-and-output" ? "driver output bound" : "driver liveness failure",
      );
    } else expect(receipt.result, receipt.result.error).toMatchObject({ ok: true });
    if (mode === "report-and-output") expect(receipt.outputBytes).toBeGreaterThan(1048576);
    if (!(await waitFor(() => closed && processAbsent(-verifiedOwner), 1000)))
      throw new Error("owner failed natural close");
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(guard);
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
      console.log(`retained containment failure: ${directory}`);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "subject and containment failed");
}

describe("actual bd seed pair lifecycle", () => {
  it
    .runIf(process.platform !== "win32")
    .each([
      "fail-left",
      "fail-right",
      "parent",
      "later-parent",
      "spacing",
      "preabort",
      "same-path",
      "success",
      "client-loss",
      "driver-loss",
      "report-and-hang",
      "report-and-output",
    ])(
    "drains both workspaces before releasing their shared root: %s",
    superviseSeedLifecycle,
    30_000,
  );
});
