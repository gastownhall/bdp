#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const MAXIMUM_CHILD_OUTPUT_BYTES = 1_048_576;
const CHILD_TIMEOUT_MS = 30_000;
const SERVER_START_TIMEOUT_MS = 10_000;
const SERVER_STOP_TIMEOUT_MS = 3_000;
const inheritedEnvironmentKeys = [
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_OPTIONS",
  "PATH",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
];
const children = new Set();
const servers = [];
const parentAbort = new AbortController();
const backgroundTerminations = new Set();
let backgroundCleanupFailed = false;
const referenceFixture = JSON.parse(
  readFileSync(new URL("../packages/conformance/fixtures/read-reference-v1.json", import.meta.url)),
);
const expectedReferenceJson = referenceFixture.expectations.readyJson;
const expectedTitles = referenceFixture.expectations.readyTitles;

function gated(message) {
  process.stderr.write(
    `${JSON.stringify({ level: "error", event: "e2e.gated", executable: "e2e-ready", message })}\n`,
  );
  process.exit(2);
}

function childEnvironment(overrides = {}) {
  const environment = {};
  for (const key of inheritedEnvironmentKeys) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return { ...environment, ...overrides };
}

export function spawnChild(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: process.platform !== "win32",
    env: options.env,
    stdio: options.stdio,
  });
  const record = {
    child,
    command,
    args,
    stdout: "",
    stderr: "",
    exitCode: undefined,
    signal: undefined,
    closed: undefined,
    result: undefined,
    stopTimeoutMs: options.stopTimeoutMs ?? SERVER_STOP_TIMEOUT_MS,
    terminationPromise: undefined,
  };
  children.add(record);
  child.once("exit", (code, signal) => {
    record.exitCode = code;
    record.signal = signal;
  });
  record.closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      record.exitCode = code;
      record.signal = signal;
      if (process.platform === "win32") children.delete(record);
      resolve();
    });
  });
  record.result = new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      callback(value);
    };
    const append = (stream, chunk) => {
      const text = String(chunk);
      record[stream] += text;
      if (Buffer.byteLength(record[stream]) > MAXIMUM_CHILD_OUTPUT_BYTES) {
        const error = new Error(`${command} exceeded its output bound`);
        finish(reject, error);
        void terminateChildInBackground(record);
      }
      options[stream === "stdout" ? "onStdout" : "onStderr"]?.(text);
    };
    child.stdout?.on("data", (chunk) => append("stdout", chunk));
    child.stderr?.on("data", (chunk) => append("stderr", chunk));
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code, signal) =>
      finish(resolve, { code, signal, stdout: record.stdout, stderr: record.stderr }),
    );
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        const error = new Error(`${command} timed out after ${options.timeoutMs}ms`);
        finish(reject, error);
        void terminateChildInBackground(record);
      }, options.timeoutMs);
      timeout.unref();
    }
  });
  // A server's result is observed through its close record; keep a rejected
  // supervision promise from becoming an unhandled rejection during cleanup.
  void record.result.catch(() => undefined);
  return record;
}

export function terminateChild(record) {
  record.terminationPromise ??= terminateChildOnce(record);
  return record.terminationPromise;
}

async function terminateChildOnce(record) {
  if (process.platform === "win32") {
    if (record.exitCode !== undefined || record.signal !== undefined) {
      await observeChildClose(record);
      return;
    }
    record.child.kill("SIGTERM");
    if (await closesWithin(record, record.stopTimeoutMs)) return;
    record.child.kill("SIGKILL");
    if (!(await closesWithin(record, record.stopTimeoutMs))) {
      abandonChild(record);
      throw new Error(`${record.command} did not terminate after SIGKILL`);
    }
    return;
  }
  if (!processGroupExists(record)) {
    await observeChildClose(record);
    return;
  }
  signalChild(record, "SIGTERM");
  if (!(await processGroupStopsWithin(record, record.stopTimeoutMs))) {
    signalChild(record, "SIGKILL");
    if (!(await processGroupStopsWithin(record, record.stopTimeoutMs))) {
      abandonChild(record);
      throw new Error(`${record.command} process group survived SIGKILL`);
    }
  }
  await observeChildClose(record);
}

export function terminateChildInBackground(record) {
  const termination = terminateChild(record).then(
    () => true,
    () => {
      backgroundCleanupFailed = true;
      return false;
    },
  );
  backgroundTerminations.add(termination);
  void termination.then(() => backgroundTerminations.delete(termination));
  return termination;
}

async function observeChildClose(record) {
  if (!(await closesWithin(record, record.stopTimeoutMs))) {
    abandonChild(record);
    throw new Error(`${record.command} did not report closure after its process group stopped`);
  }
  children.delete(record);
}

function abandonChild(record) {
  record.child.stdin?.destroy();
  record.child.stdout?.destroy();
  record.child.stderr?.destroy();
  record.child.unref();
  children.delete(record);
}

function signalChild(record, signal) {
  if (process.platform !== "win32" && record.child.pid !== undefined) {
    try {
      process.kill(-record.child.pid, signal);
      return;
    } catch {
      // The process group may already be gone or may not have formed. Retain
      // direct-child fallback so cleanup stays bounded on every platform.
    }
  }
  record.child.kill(signal);
}

async function closesWithin(record, milliseconds) {
  let timer;
  let closed = false;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });
  await Promise.race([
    record.closed.then(() => {
      closed = true;
    }),
    timeout,
  ]);
  clearTimeout(timer);
  return closed;
}

async function processGroupStopsWithin(record, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (processGroupExists(record)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 25)));
  }
  return true;
}

function processGroupExists(record) {
  if (record.child.pid === undefined) return false;
  try {
    process.kill(-record.child.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function start(command, env) {
  const scope = env.BDP_SCOPE_URL;
  const diagnostics = [];
  let diagnosticBuffer = "";
  let started = false;
  let probing = false;
  let settleReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    settleReady = resolve;
    rejectReady = reject;
  });
  const observeDiagnostic = (line) => {
    if (line.length === 0) return;
    try {
      const diagnostic = JSON.parse(line);
      diagnostics.push(diagnostic);
      if (diagnostic.event === "server.started") started = true;
    } catch {
      /* The final assertion reports unexpected server output. */
    }
  };
  const record = spawnChild(process.execPath, [command, "--serve"], {
    cwd: root,
    env: childEnvironment(env),
    stdio: ["ignore", "pipe", "pipe"],
    onStderr(chunk) {
      diagnosticBuffer += chunk;
      const lines = diagnosticBuffer.split("\n");
      diagnosticBuffer = lines.pop() ?? "";
      for (const line of lines) observeDiagnostic(line);
    },
  });
  const probe = setInterval(async () => {
    if (!started || probing || parentAbort.signal.aborted) return;
    probing = true;
    try {
      const response = await fetch(`${scope}bdp.json`, {
        signal: AbortSignal.any([AbortSignal.timeout(500), parentAbort.signal]),
      });
      if (response.ok) settleReady(record);
    } catch {
      /* startup race; the child close and timeout paths remain authoritative */
    } finally {
      probing = false;
    }
  }, 50);
  const timeout = setTimeout(() => {
    rejectReady(new Error(`server startup timed out at ${scope}`));
  }, SERVER_START_TIMEOUT_MS);
  record.closed.then(() => {
    observeDiagnostic(diagnosticBuffer);
    diagnosticBuffer = "";
    if (record.exitCode !== 0 && record.exitCode !== undefined)
      rejectReady(
        new Error(`${command} exited before startup (${record.exitCode}): ${record.stderr}`),
      );
    else if (!started) rejectReady(new Error(`${command} exited before startup: ${record.stderr}`));
  });
  try {
    await ready;
    return { record, scope, diagnostics };
  } finally {
    clearInterval(probe);
    clearTimeout(timeout);
  }
}

export async function stopServer(server) {
  await terminateChild(server.record);
  if (server.record.exitCode !== 0)
    throw new Error(`${server.record.command} did not stop cleanly (${server.record.exitCode})`);
  if (!server.diagnostics.some(({ event }) => event === "server.stopped"))
    throw new Error(`${server.record.command} emitted no server.stopped diagnostic`);
}

export async function ready(scope, json) {
  const record = spawnChild(
    process.execPath,
    ["apps/bdp/dist/main.js", "bd", "ready", ...(json ? ["--json"] : [])],
    {
      cwd: root,
      env: childEnvironment({ BDP_SCOPE_URL: scope }),
      stdio: ["ignore", "pipe", "pipe"],
      timeoutMs: CHILD_TIMEOUT_MS,
    },
  );
  return record.result;
}

async function realBdReady(workspace) {
  const executable = process.env.BDP_E2E_BD_EXECUTABLE ?? "bd";
  const actor = process.env.BDP_E2E_BD_ACTOR ?? "bdp-conformance";
  const record = spawnChild(executable, ["--actor", actor, "ready", "--limit", "0", "--json"], {
    cwd: workspace,
    env: childEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: CHILD_TIMEOUT_MS,
  });
  const result = await record.result;
  if (result.code !== 0)
    throw new Error(`bd ready oracle failed (${result.code}): ${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `bd ready oracle returned invalid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function interrupt() {
  process.exitCode = 2;
  parentAbort.abort(new Error("E2E interrupted"));
  for (const child of children) void terminateChildInBackground(child);
}

export async function main() {
  backgroundCleanupFailed = false;
  let hasReadConformanceEvidence;
  try {
    ({ hasReadConformanceEvidence } = await import(
      "../packages/server/dist/read-conformance-capability.js"
    ));
  } catch {
    gated("build @bdp/server before checking end-to-end readiness");
  }

  if (!hasReadConformanceEvidence("bdptest") || !hasReadConformanceEvidence("bdpbd")) {
    gated("both executables must pass the cumulative black-box Read matrix first");
  }

  try {
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);

    const bdWorkspace = process.env.BDP_E2E_BD_WORKSPACE;
    if (bdWorkspace === undefined)
      throw new Error("BDP_E2E_BD_WORKSPACE is required for the bdpbd half of the proof");
    const bdExecutable = process.env.BDP_E2E_BD_EXECUTABLE ?? "bd";
    const fixtureScope = "http://127.0.0.1:18280/local-test/";
    const adaptedScope = "http://127.0.0.1:18281/local-test/";
    const fixtureServer = await start("apps/bdptest/dist/main.js", {
      BDP_SERVER_PORT: "18280",
      BDP_SCOPE_URL: fixtureScope,
      BDP_SERVER_ADVERTISED_PROFILE: "read",
    });
    servers.push(fixtureServer);
    const adaptedServer = await start("apps/bdpbd/dist/main.js", {
      BDP_SERVER_PORT: "18281",
      BDP_SCOPE_URL: adaptedScope,
      BDP_SERVER_ADVERTISED_PROFILE: "read",
      BDP_BD_WORKSPACE: bdWorkspace,
      BDP_BD_EXECUTABLE: bdExecutable,
    });
    servers.push(adaptedServer);
    const realBdJson = await realBdReady(bdWorkspace);
    const [fixtureHuman, fixtureJson, adaptedHuman, adaptedJson] = await Promise.all([
      ready(fixtureScope, false),
      ready(fixtureScope, true),
      ready(adaptedScope, false),
      ready(adaptedScope, true),
    ]);
    for (const result of [fixtureHuman, fixtureJson, adaptedHuman, adaptedJson]) {
      if (result.code !== 0) throw new Error(`bdp failed (${result.code}): ${result.stderr}`);
    }
    assertStartupDiagnostic(fixtureHuman.stderr, fixtureScope);
    assertStartupDiagnostic(fixtureJson.stderr, fixtureScope);
    assertStartupDiagnostic(adaptedHuman.stderr, adaptedScope);
    assertStartupDiagnostic(adaptedJson.stderr, adaptedScope);

    const fixture = parseExactJson(fixtureJson.stdout, "bdptest");
    const adapted = parseExactJson(adaptedJson.stdout, "bdpbd");
    if (JSON.stringify(fixture) !== JSON.stringify(expectedReferenceJson))
      throw new Error("bdptest JSON output did not equal its checked-in fixture oracle");
    if (JSON.stringify(adapted) !== JSON.stringify(realBdJson))
      throw new Error("bdpbd JSON output did not equal the direct real bd ready oracle");
    const fixtureTitles = fixture.map(({ title }) => title);
    const adaptedTitles = adapted.map(({ title }) => title);
    const expectedHuman = expectedTitles.length === 0 ? "" : `${expectedTitles.join("\n")}\n`;
    if (fixtureHuman.stdout !== expectedHuman || adaptedHuman.stdout !== expectedHuman)
      throw new Error("human output did not preserve the accepted ordered title projection");
    process.stdout.write(`${JSON.stringify({ fixtureTitles, adaptedTitles })}\n`);
    if (
      JSON.stringify(fixtureTitles) !== JSON.stringify(adaptedTitles) ||
      JSON.stringify(fixtureTitles) !== JSON.stringify(expectedTitles)
    )
      process.exitCode = 1;
  } finally {
    let cleanupFailed = false;
    for (const server of servers) {
      try {
        await stopServer(server);
      } catch {
        cleanupFailed = true;
      }
    }
    for (const child of [...children]) {
      try {
        await terminateChild(child);
      } catch {
        cleanupFailed = true;
      }
    }
    await Promise.all([...backgroundTerminations]);
    cleanupFailed ||= backgroundCleanupFailed;
    if (cleanupFailed) {
      process.exitCode = 1;
      process.stderr.write(
        `${JSON.stringify({ level: "error", event: "e2e.cleanup_failed", executable: "e2e-ready" })}\n`,
      );
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
  return process.exitCode ?? 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();

export function assertStartupDiagnostic(stderr, scope) {
  if (!stderr.endsWith("\n")) throw new Error("bdp diagnostics were not newline terminated");
  const lines = stderr.slice(0, -1).split("\n");
  if (lines.length !== 1) throw new Error("bdp emitted unexpected diagnostic lines");
  const diagnostic = JSON.parse(lines[0]);
  if (
    diagnostic.level !== "info" ||
    diagnostic.event !== "startup.config" ||
    diagnostic.executable !== "bdp" ||
    diagnostic.config?.scope?.url !== scope
  )
    throw new Error("bdp emitted an unexpected startup diagnostic");
}

export function parseExactJson(stdout, label) {
  if (!stdout.endsWith("\n")) throw new Error(`${label} JSON output was not newline terminated`);
  const body = stdout.slice(0, -1);
  if (body.includes("\n")) throw new Error(`${label} JSON output contained extra lines`);
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(
      `${label} JSON output was invalid: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
