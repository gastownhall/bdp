/** Built-artifact, real-process acceptance. Run after pnpm build. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReadUpdateFetchTransport } from "../packages/client/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(path.join(tmpdir(), "bdptest-process-"));
const token = randomBytes(32).toString("base64url");
const started = performance.now();
const checks = [];
let current;
function report(check) {
  checks.push(check);
  console.log(JSON.stringify({ check, elapsedMs: Math.round(performance.now() - started) }));
}
async function launch(port, create) {
  const config = path.join(directory, "config.json");
  await writeFile(
    config,
    JSON.stringify({ directory: path.join(directory, "store"), port, create, token }),
    { mode: 0o600 },
  );
  const child = spawn(
    process.execPath,
    [path.join(root, "apps/bdptest/dist/development-main.js"), config],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  let errorOutput = "";
  const exited = new Promise((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal })),
  );
  current = { child, exited };
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("development process startup exceeded 10s")),
      10_000,
    );
    const fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    child.once("error", fail);
    exited.then(({ code, signal }) =>
      fail(new Error(`development exited before ready: ${code}/${signal}: ${errorOutput}`)),
    );
    child.stderr.on("data", (bytes) => {
      errorOutput += bytes.toString();
      if (errorOutput.length > 64 * 1024) {
        child.kill("SIGKILL");
        fail(new Error("excess development stderr"));
      }
    });
    child.stdout.on("data", (bytes) => {
      output += bytes.toString();
      if (output.length > 64 * 1024) {
        child.kill("SIGKILL");
        fail(new Error("excess development stdout"));
        return;
      }
      const line = output.split("\n")[0];
      if (!output.includes("\n")) return;
      try {
        const event = JSON.parse(line);
        assert.equal(event.event, "development.ready");
        assert.equal(event.claimEligible, false);
        clearTimeout(timer);
        resolve(event);
      } catch (error) {
        fail(error);
      }
    });
  });
  const transport = createReadUpdateFetchTransport({
    scope: ready.scope,
    credential: () => token,
    limits: {
      requestBodyBytes: 65536,
      responseBodyBytes: 2 * 1024 * 1024,
      responseTimeoutMs: 5000,
      cleanupTimeoutMs: 1000,
    },
  });
  return {
    scope: ready.scope,
    post: (operation, body, key) =>
      transport.post(`${ready.scope}development/${operation}`, {
        bodyText: JSON.stringify(body),
        idempotencyKey: key,
      }),
    get: (relative) => transport.get(new URL(relative, ready.scope).href),
  };
}
async function stop() {
  if (!current) return;
  const { child, exited } = current;
  let timer;
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const result = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("development process drain exceeded 5s")), 5000);
      }),
    ]);
    assert.deepEqual(result, { code: 0, signal: null });
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
    current = undefined;
  }
}
let failure;
try {
  const first = await launch(0, true);
  report("launched non-attesting development executable");
  const input = {
    id: "beads/a",
    type: "https://bdp.example/development/bead",
    properties: { title: "before" },
    metadata: { demo: true },
  };
  const created = await first.post("create-bead", input, "create");
  assert.equal(created.status, 200);
  assert.equal(created.body.outcome, "created");
  assert.deepEqual((await first.get("beads/a")).body, created.body.resource);
  assert.deepEqual((await first.post("create-bead", input, "create")).body, created.body);
  assert.equal(
    (await first.post("create-bead", { ...input, properties: {} }, "create")).body.code,
    "idempotency-conflict",
  );
  report("create/read/retry/conflict through actual SDK Fetch transport");
  const update = {
    bead: "beads/a",
    expectedRevision: created.body.resource.revision,
    propertiesChange: [{ op: "replace", path: "/title", value: "after" }],
  };
  const updated = await first.post("update-bead", update, "update");
  assert.equal(updated.status, 200);
  assert.equal(updated.body.resource.properties.title, "after");
  assert.equal(updated.body.resource.metadata.demo, true);
  assert.notEqual(updated.body.resource.revision, created.body.resource.revision);
  assert.equal((await first.post("update-bead", update, "stale")).body.code, "revision-mismatch");
  report("guarded update and stale revision refusal");
  const port = Number(new URL(first.scope).port);
  await stop();
  const second = await launch(port, false);
  assert.equal(second.scope, first.scope);
  assert.deepEqual((await second.get("beads/a")).body, updated.body.resource);
  assert.deepEqual((await second.post("update-bead", update, "update")).body, updated.body);
  report("new process recovered persisted state and exact retained replay");
  const deletion = { bead: "beads/a", expectedRevision: updated.body.resource.revision };
  const deleted = await second.post("delete-bead", deletion, "delete");
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.outcome, "deleted");
  assert.equal((await second.get("beads/a")).status, 404);
  assert.deepEqual((await second.post("delete-bead", deletion, "delete")).body, deleted.body);
  await stop();
  report("delete/retry and clean process shutdown");
  console.log(
    JSON.stringify({ result: "PASS", claimEligible: false, checks, node: process.version }),
  );
} catch (error) {
  failure = error;
} finally {
  try {
    await stop();
  } catch (error) {
    failure =
      failure === undefined
        ? error
        : new AggregateError([failure, error], "Acceptance and cleanup failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
if (failure !== undefined) throw failure;
