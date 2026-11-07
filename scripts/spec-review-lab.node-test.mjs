import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { spawnChild, terminateChild } from "./e2e-ready.mjs";
import { withPackedWorkspace } from "./packed-workspace.mjs";
import {
  admitInvocation,
  boundedCapture,
  finishOwned,
  runInstalledLab,
} from "./spec-review-lab.mjs";

const script = fileURLToPath(new URL("./spec-review-lab.mjs", import.meta.url));
const stableClient = fileURLToPath(new URL("./bdp-review-lab-client.mjs", import.meta.url));
const workspace = fileURLToPath(new URL("../", import.meta.url));
const absent = async (name) => assert.rejects(access(name), { code: "ENOENT" });
function relay(socket, args, stdin = Buffer.alloc(0)) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--invoke", socket, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [],
      err = [];
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Relay did not stop"));
    }, 10_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });
    child.stdin.end(stdin);
  });
}
function runStableClient(stateHome, args = ["--help"]) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [stableClient, ...args], {
      env: { ...process.env, HOME: stateHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [],
      stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      }),
    );
  });
}
function events(onEvent) {
  let pending = "";
  return (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) {
      if (line.startsWith("{")) onEvent(JSON.parse(line));
    }
  };
}
function malformed(socket, bytes) {
  return new Promise((resolve, reject) => {
    const client = connect(socket);
    let text = "";
    client.setTimeout(2000, () => client.destroy(new Error("No bounded refusal")));
    client.on("connect", () => client.end(bytes));
    client.on("data", (chunk) => {
      text += chunk;
    });
    client.on("end", () => resolve(text));
    client.on("close", () => resolve(text));
    client.on("error", (error) => (error.code === "ECONNRESET" ? resolve(text) : reject(error)));
  });
}

test("workstation argv policy refuses remote/config/recovery escapes and oversized input", () => {
  const scope = "http://127.0.0.1:1234/work/",
    state = "/owned/state";
  for (const args of [
    ["--scope", "https://remote.invalid/"],
    ["show", "https://remote.invalid/a"],
    ["--config=x"],
    ["update", "--retry-file", "/outside"],
    ["a\0b"],
    ["x".repeat(65536)],
  ])
    assert.throws(() => admitInvocation(args, scope, state));
  const relativeJournal = path.relative(process.cwd(), path.join(state, "journal.json"));
  assert.throws(() => admitInvocation(["update", "--retry-file", relativeJournal], scope, state));
  assert.throws(() => admitInvocation(["update", `--retry-file=${relativeJournal}`], scope, state));
  admitInvocation(["show", `${scope}a`], scope, state);
  admitInvocation(
    ["create", "--type", "https://types.invalid/Note", "--properties", "@-"],
    scope,
    state,
  );
});

test("stable lab client gives a bounded nonzero diagnostic when no owner is active", async () => {
  const stateHome = await mkdtemp(path.join(os.tmpdir(), "bdp-review-client-"));
  try {
    const result = await runStableClient(stateHome);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "No active BDP review lab. Start it with `pnpm review:lab` in the owner terminal.\n",
    );
    assert.doesNotMatch(result.stderr, /Error:|node:internal/);
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("producer capture enforces a combined bound before retention and keeps overflow failed", () => {
  let failures = 0;
  const capture = boundedCapture(() => {
    failures++;
  });
  capture.append("stdout", Buffer.alloc(1024 * 1024 - 1));
  capture.append("stderr", Buffer.from("x"));
  assert.equal(capture.retainedBytes, 1024 * 1024);
  capture.append("stderr", Buffer.from("overflow"));
  for (let n = 0; n < 100; n++) capture.append("stdout", Buffer.alloc(65536));
  assert.equal(capture.retainedBytes, 1024 * 1024);
  assert.equal(failures, 1);
  assert.throws(() => capture.finish(), /bound exceeded/);
});

test("primary and cleanup failures both survive and produce nonzero process status", async () => {
  const primary = new Error("primary"),
    cleanup = new Error("cleanup");
  await assert.rejects(
    finishOwned(
      () => {
        throw primary;
      },
      () => {
        throw cleanup;
      },
    ),
    (e) => e instanceof AggregateError && e.errors[0] === primary && e.errors[1] === cleanup,
  );
  const child = await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    `import {finishOwned} from ${JSON.stringify(new URL("./spec-review-lab.mjs", import.meta.url).href)}; await finishOwned(()=>{throw Error('primary')},()=>{throw Error('cleanup')});`,
  ]).catch((error) => error);
  assert.equal(child.code, 1);
  assert.match(child.stderr, /primary/);
  assert.match(child.stderr, /cleanup/);
});

test("worker refuses a preexisting directory without changing user bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bdp-lab-refusal-"));
  try {
    const file = path.join(root, "keep");
    await writeFile(file, "user bytes");
    const result = await promisify(execFile)(process.execPath, [
      script,
      "--worker",
      "/unused",
      root,
      "check",
    ]).catch((error) => error);
    assert.equal(result.code, 1);
    assert.equal(await readFile(file, "utf8"), "user bytes");
    const failedRoot = path.join(root, "failed-start");
    const failed = await promisify(execFile)(process.execPath, [
      script,
      "--worker",
      "/absent-install",
      failedRoot,
      "check",
    ]).catch((error) => error);
    assert.equal(failed.code, 1);
    await absent(failedRoot);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("actual installed finite journey and private relay preserve bytes, stdin and exits", {
  timeout: 120_000,
}, async () => {
  let installation;
  await withPackedWorkspace(async (installed, signal) => {
    installation = installed.temporaryRoot;
    let checked = false;
    await runInstalledLab(installed, {
      check: true,
      input: null,
      signal,
      onOutput: events((e) => {
        if (e.event === "review-lab.checked") checked = true;
      }),
    });
    assert.equal(checked, true);
    await absent(path.join(installation, "review"));
    const input = new PassThrough();
    let transcript = "";
    let readyResolve;
    const ready = new Promise((resolve) => {
      readyResolve = resolve;
    });
    const parseReady = events((e) => {
      if (e.event === "review-lab.ready") readyResolve(e);
    });
    const running = runInstalledLab(installed, {
      input,
      signal,
      onOutput: (chunk) => {
        transcript += chunk;
        parseReady(chunk);
      },
    });
    void running.catch(() => undefined);
    const owner = await Promise.race([
      ready,
      running.then(() => {
        throw new Error("Not ready");
      }),
    ]);
    const socket = path.join(installation, "r.sock");
    try {
      assert.equal((await stat(owner.root)).mode & 0o777, 0o700);
      assert.equal((await stat(socket)).mode & 0o777, 0o600);
      assert.equal((await stat(path.join(owner.root, "config.json"))).mode & 0o777, 0o600);
      const marker = path.join(owner.root, "shell-must-not-run");
      const properties = Buffer.from(
        JSON.stringify({ text: `α🙂$(touch ${marker})`, slash: { "x/y": true } }),
      );
      const created = await relay(
        socket,
        [
          "create",
          "--id",
          "stdin",
          "--type",
          "https://types.invalid/Note",
          "--properties",
          "@-",
          "--output-format",
          "json",
        ],
        properties,
      );
      assert.equal(created.code, 0, created.stderr.toString());
      // JSON is the data alone (the mutation result), without the envelope.
      assert.deepEqual(JSON.parse(created.stdout).resource.properties, JSON.parse(properties));
      await absent(marker);
      const shown = await relay(socket, [
        "show",
        "stdin",
        "--properties-only",
        "--output-format",
        "json",
      ]);
      assert.equal(shown.code, 0);
      assert.deepEqual(JSON.parse(shown.stdout), JSON.parse(properties));
      assert.deepEqual(shown.stdout, Buffer.concat([properties, Buffer.from("\n")]));
      const missing = await relay(socket, ["show", "missing", "--output-format", "json"]);
      assert.equal(missing.code, 3);
      const remote = await relay(socket, ["show", "https://remote.invalid/a"]);
      assert.equal(remote.code, 2);
      assert.equal(remote.stderr.toString(), "Only this loopback Scope may be contacted\n");
      const remoteDefault = await relay(socket, [
        "scope",
        "set",
        "https://chris-bot.sellsbrothers.com",
      ]);
      assert.equal(remoteDefault.code, 2);
      assert.equal(remoteDefault.stderr.toString(), "Only this loopback Scope may be contacted\n");
      const localDefault = await relay(socket, ["scope", "set", owner.scope]);
      assert.equal(localDefault.code, 2);
      assert.match(
        localDefault.stderr.toString(),
        /scope set cannot modify an explicitly selected --config file/,
      );
      const invalid = JSON.parse(await malformed(socket, "not JSON"));
      assert.equal(invalid.code, 2);
      assert.equal(Buffer.from(invalid.stderr, "base64").toString(), "Invalid relay input\n");
      assert.equal(await malformed(socket, "x".repeat(131073)), "");
      const config = JSON.parse(await readFile(path.join(owner.root, "config.json"), "utf8"));
      assert.equal(created.stdout.includes(config.auth.token), false);
      assert.equal(missing.stdout.includes(config.auth.token), false);
      assert.equal(transcript.includes(config.auth.token), false);
      for (const filename of await readdir(path.join(owner.root, "state", "bdp", "retry"))) {
        assert.equal(
          (
            await readFile(path.join(owner.root, "state", "bdp", "retry", filename), "utf8")
          ).includes(config.auth.token),
          false,
        );
      }
    } finally {
      input.end("stop\n");
      await running;
    }
    await absent(owner.root);
    await absent(socket);
    const stopped = await relay(socket, ["--help"]);
    assert.equal(stopped.code, 1);
    const eofInput = new PassThrough();
    let eofReady,
      connections = 0;
    const eofStarted = new Promise((resolve) => {
      eofReady = resolve;
    });
    const eofRun = runInstalledLab(installed, {
      input: eofInput,
      signal,
      onOutput: events((e) => {
        if (e.event === "review-lab.ready") eofReady(e);
        if (e.event === "review-lab.relay-connected") connections++;
      }),
    });
    void eofRun.catch(() => undefined);
    const eofOwner = await Promise.race([
      eofStarted,
      eofRun.then(() => {
        throw new Error("No EOF owner");
      }),
    ]);
    const waiting = spawn(
      process.execPath,
      [
        script,
        "--invoke",
        socket,
        "create",
        "--type",
        "https://types.invalid/Note",
        "--properties",
        "@-",
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    const ended = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.kill("SIGKILL");
        reject(new Error("Waiting stdin outlived owner"));
      }, 5000);
      waiting.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      waiting.once("error", reject);
    });
    void ended.catch(() => undefined);
    try {
      const connectedBy = Date.now() + 2000;
      while (connections === 0 && Date.now() < connectedBy) await delay(10);
      assert.equal(connections, 1, "Stdin-waiting relay must actually connect before owner EOF");
      assert.equal(waiting.exitCode, null);
      eofInput.end();
      await eofRun;
      assert.equal(await ended, 1);
      await absent(eofOwner.root);
    } finally {
      eofInput.end();
      await eofRun;
      if (waiting.exitCode === null) waiting.kill("SIGKILL");
      await ended.catch(() => undefined);
    }
  });
  await absent(installation);
});

for (const [signal, expected, resistant] of [
  ["SIGINT", 130, false],
  ["SIGTERM", 143, false],
  ["SIGTERM", 143, true],
]) {
  test(`foreground ${signal}${resistant ? " while installed CLI resists TERM" : ""} terminates an observed real CLI child/group and owned root`, {
    timeout: 90_000,
  }, async () => {
    const signalFixture = resistant
      ? await mkdtemp(path.join(os.tmpdir(), "bdp-lab-resistant-"))
      : undefined;
    const proof = signalFixture && path.join(signalFixture, "ready-pid");
    const env = { ...process.env };
    if (resistant) {
      const preload = path.join(signalFixture, "signal.mjs");
      await writeFile(
        preload,
        `import {writeFileSync} from 'node:fs';
if (process.argv[1]?.endsWith('/node_modules/.bin/bdp') || process.argv[1]?.endsWith('/node_modules/@bdp/bdp/dist/main.js')) { process.on('SIGTERM', () => {}); writeFileSync(${JSON.stringify(proof)}, String(process.pid)); process.kill(process.pid, 'SIGSTOP'); }
`,
        { mode: 0o600 },
      );
      env.NODE_OPTIONS = [env.NODE_OPTIONS, "--import", pathToFileURL(preload).href]
        .filter(Boolean)
        .join(" ");
    }
    let root,
      cli,
      workerPid,
      finish,
      observationError,
      signaled = false;
    const observed = new Promise((resolve) => {
      finish = resolve;
    });
    let record;
    const lifecycle = [];
    const onStdout = events((event) => {
      lifecycle.push(event);
      if (event.event === "packed-workspace.installed") root = event.temporaryRoot;
      if (event.event === "packed-child.started") workerPid ??= event.pid;
      if (event.event === "review-lab.ready") {
        workerPid = event.pid;
        void relay(path.join(root, "r.sock"), [
          "scope",
          "inspect",
          "--output-format",
          "json",
        ]).catch(() => undefined);
      }
      if (event.event === "review-lab.cli-started" && !signaled) {
        signaled = true;
        cli = event.pid;
        void (async () => {
          try {
            if (resistant) {
              const readyBy = Date.now() + 2000;
              let readyPid;
              while (Date.now() < readyBy) {
                try {
                  readyPid = Number(await readFile(proof, "utf8"));
                } catch (error) {
                  if (error.code !== "ENOENT") throw error;
                }
                if (readyPid === cli) break;
                await delay(10);
              }
              assert.equal(
                readyPid,
                cli,
                "Signal handler must be installed in the actual CLI before owner interruption",
              );
            }
            process.kill(cli, "SIGSTOP");
            const { stdout } = await promisify(execFile)("ps", [
              "-p",
              String(cli),
              "-o",
              "stat=,pgid=,command=",
            ]);
            assert.match(stdout.trim(), /^T/);
            assert.ok(stdout.includes(String(cli)));
            assert.ok(stdout.includes(path.join(root, "install")));
            record.child.kill(signal);
          } catch (error) {
            observationError = error;
            record.child.kill("SIGTERM");
          }
          finish();
        })();
      }
    });
    record = spawnChild(process.execPath, [script], {
      cwd: workspace,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      timeoutMs: 70_000,
      onStdout,
    });
    try {
      const result = await record.result;
      await Promise.race([
        observed,
        delay(1000).then(() => {
          throw new Error("Active child was not observed");
        }),
      ]);
      if (observationError) throw observationError;
      assert.equal(result.code, expected, result.stderr);
      assert.equal(signaled, true);
      await absent(root);
      const closedAt = lifecycle.findIndex((event) => event.event === "review-lab.closed");
      const removedAt = lifecycle.findIndex((event) => event.event === "packed-workspace.removed");
      for (const [role, pid] of [
        ["owner", record.child.pid],
        ["worker", workerPid],
        ["CLI", cli],
      ]) {
        const snapshot = (await promisify(execFile)("ps", ["-axo", "pid=,ppid=,pgid=,stat="]))
          .stdout;
        const members = snapshot.split("\n").filter((line) => {
          const fields = line.trim().split(/\s+/);
          return Number(fields[0]) === pid || Number(fields[2]) === pid;
        });
        const diagnostic = `${role} PID/group ${pid} (PID PPID PGID STAT): ${members.join("; ")}`;
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, diagnostic);
        assert.throws(() => process.kill(-pid, 0), { code: "ESRCH" }, diagnostic);
        assert.equal(members.length, 0, diagnostic);
      }
      assert.ok(
        closedAt >= 0 && removedAt > closedAt,
        "Worker must acknowledge completed CLI/listener cleanup before installation removal",
      );
    } finally {
      await terminateChild(record);
      if (cli) {
        try {
          process.kill(-cli, "SIGKILL");
        } catch {}
      }
      if (signalFixture) await rm(signalFixture, { recursive: true });
    }
  });
}
