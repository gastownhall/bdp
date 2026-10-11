import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReadUpdateFetchTransport } from "@bdp/client";
import { parseReadUpdateSequenceResponse } from "@bdp/protocol";

const token = "development_disconnect_credential_0123456789";
const beadType = "https://bdp.example/development/bead";
const runtime = new URL("../../../packages/server/dist/development-runtime.js", import.meta.url)
  .href;
const scheduler = new URL("../../../packages/server/dist/sequence-executor.js", import.meta.url)
  .href;
const executable = new URL("../dist/development-main.js", import.meta.url);
const directories: string[] = [];
const children: ChildProcess[] = [];
const exits = new Map<
  ChildProcess,
  Promise<{ code: number | null; signal: NodeJS.Signals | null }>
>();
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exits.get(child);
  }
  exits.clear();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const result = mkdtempSync(path.join(tmpdir(), "bdp-http-disconnect-"));
  directories.push(result);
  return result;
}

// This child changes scheduling only. The real emitted HTTP receiver, durable
// owner, evaluator and store execute every request. No mocked admission or
// synthetic outcome stands in for committed state. Dispatch 2 is parked before
// its callback: dispatch 1 has committed, and all later members remain unrun.
const controlledProgram = `
import { readFileSync } from "node:fs";
import { startDevelopmentReferenceRuntime } from ${JSON.stringify(runtime)};
import { createNodeLifecycleScheduler } from ${JSON.stringify(scheduler)};
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (process.version !== "v24.16.0") throw Error("wrong pinned Node");
const adapter = createNodeLifecycleScheduler();
const send = (message) => process.send(message);
let dispatch = 0, parked, closed = false;
const controlled = {
  delay: (ms, callback) => adapter.delay(ms, callback),
  turn(callback) {
    let cancelled = false;
    const cancel = adapter.turn(() => {
      const index = ++dispatch;
      const run = () => {
        if (cancelled) return;
        callback();
        send({ event: "turn-completed", index });
      };
      if (index === 2) { parked = run; send({ event: "parked", index }); }
      else run();
    });
    return () => { cancelled = true; cancel(); };
  },
};
const server = await startDevelopmentReferenceRuntime(config, controlled);
process.on("message", (message) => {
  if (message === "release") {
    if (!parked) throw Error("no parked member");
    const run = parked; parked = undefined;
    adapter.turn(run);
  } else if (message === "close") {
    if (closed) throw Error("already closing");
    closed = true;
    const closing = server.close();
    send({ event: "closing" });
    closing.then(() => {
      send({ event: "closed" });
      process.disconnect();
    }, () => process.exit(2));
  } else throw Error("unknown control");
});
send({ event: "development.ready", scope: server.scope, claimEligible: false });
`;
interface Message {
  event: string;
  scope?: string;
  index?: number;
}
async function start(store: string, port = 0, create = true, controlled = true) {
  const support = directory();
  const config = path.join(support, "config.json");
  writeFileSync(config, JSON.stringify({ directory: store, port, create, token }), { mode: 0o600 });
  const program = path.join(support, "controlled.mjs");
  writeFileSync(program, controlledProgram);
  const child = spawn(process.execPath, [controlled ? program : executable.pathname, config], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  const messages: Message[] = [];
  const listeners = new Set<() => void>();
  let output = "",
    stderr = "";
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
        for (const notify of listeners) notify();
      });
    },
  );
  exits.set(child, exited);
  const receive = (value: unknown) => {
    if (
      !value ||
      typeof value !== "object" ||
      !("event" in value) ||
      typeof value.event !== "string"
    )
      throw new Error("invalid child message");
    messages.push(value as Message);
    for (const notify of listeners) notify();
  };
  child.on("message", receive);
  child.stdout?.on("data", (bytes) => {
    output += String(bytes);
    if (output.length > 65536) {
      child.kill("SIGKILL");
      return;
    }
    let newline = output.indexOf("\n");
    while (newline >= 0) {
      receive(JSON.parse(output.slice(0, newline)));
      output = output.slice(newline + 1);
      newline = output.indexOf("\n");
    }
  });
  child.stderr?.on("data", (bytes) => {
    stderr += String(bytes);
    if (stderr.length > 65536) child.kill("SIGKILL");
  });
  function wait(event: string, index?: number): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`child did not reach ${event}: ${stderr}`));
      }, 5000);
      const check = () => {
        const found = messages.find(
          (m) => m.event === event && (index === undefined || m.index === index),
        );
        if (found) {
          clearTimeout(timer);
          listeners.delete(check);
          resolve(found);
        } else if (child.exitCode !== null || child.signalCode !== null) {
          clearTimeout(timer);
          listeners.delete(check);
          reject(new Error(`child exited before ${event}: ${stderr}`));
        }
      };
      listeners.add(check);
      check();
    });
  }
  const ready = await wait("development.ready");
  if (!ready.scope) throw new Error("missing Scope");
  const scope = ready.scope;
  const transport = createReadUpdateFetchTransport({
    scope,
    credential: () => token,
    limits: {
      requestBodyBytes: 65536,
      responseBodyBytes: 1024 * 1024,
      responseTimeoutMs: 5000,
      cleanupTimeoutMs: 1000,
    },
  });
  return {
    child,
    scope,
    wait,
    exited,
    send: (message: "release" | "close") => child.send(message),
    get: (relative: string) => transport.get(new URL(relative, scope).href),
    sequence: (input: unknown, signal?: AbortSignal) =>
      transport.post(`${scope}development/sequence`, {
        bodyText: JSON.stringify(input),
        ...(signal === undefined ? {} : { signal }),
      }),
    async stop() {
      child.kill("SIGTERM");
      expect(await exited).toEqual({ code: 0, signal: null });
    },
  };
}
function input() {
  return {
    operations: [
      {
        operation: "createBead",
        idempotencyKey: "prefix",
        id: "beads/prefix",
        name: "prefix",
        type: beadType,
      },
      { operation: "deleteBead", idempotencyKey: "failed-middle", bead: "beads/missing" },
      {
        operation: "putAlias",
        idempotencyKey: "alias-tail",
        alias: "alias/prefix-name",
        target: "@prefix",
      },
      {
        operation: "createBead",
        idempotencyKey: "independent-tail",
        id: "beads/tail",
        type: beadType,
      },
    ],
  };
}
function json(
  response: Awaited<ReturnType<ReturnType<typeof createReadUpdateFetchTransport>["get"]>>,
) {
  if (response.kind !== "json") throw new Error("expected JSON response");
  return response.body;
}
function lost(promise: Promise<unknown>) {
  return promise.then(
    () => ({ delivered: true }),
    () => ({ delivered: false }),
  );
}

describe("development HTTP disconnect and process recovery", () => {
  it("continues admitted work after a mid-sequence client disconnect and replays exactly", async () => {
    const h = await start(path.join(directory(), "store"));
    const controller = new AbortController();
    const delivery = lost(h.sequence(input(), controller.signal));
    await h.wait("parked", 2);
    const prefix = await h.get("beads/prefix");
    expect(prefix.status).toBe(200);
    expect(await h.get("beads/tail")).toMatchObject({ status: 404 });
    controller.abort();
    expect(await delivery).toEqual({ delivered: false });
    h.send("release");
    await h.wait("turn-completed", 4);
    expect(await h.get("beads/tail")).toMatchObject({ status: 200 });
    const replay = await h.sequence(input());
    if (replay.kind !== "json") throw new Error("missing replay JSON");
    const result = parseReadUpdateSequenceResponse(replay.body);
    expect(result.results).toMatchObject([
      { operationIndex: 0, outcome: "created" },
      { operationIndex: 1, code: "resource-not-found" },
      { operationIndex: 2, outcome: "created" },
      { operationIndex: 3, outcome: "created" },
    ]);
    expect(json(await h.sequence(input()))).toEqual(replay.body);
    expect(json(await h.get("beads/prefix"))).toEqual(json(prefix));
    h.send("close");
    await h.wait("closed");
    expect(await h.exited).toEqual({ code: 0, signal: null });
  }, 15000);

  it("graceful close drains an admitted sequence even after disconnecting its response", async () => {
    const store = path.join(directory(), "store");
    const h = await start(store);
    const delivery = lost(h.sequence(input()));
    await h.wait("parked", 2);
    expect(await h.get("beads/prefix")).toMatchObject({ status: 200 });
    expect(await h.get("beads/tail")).toMatchObject({ status: 404 });
    h.send("close");
    await h.wait("closing");
    expect(await delivery).toEqual({ delivered: false });
    expect(h.child.exitCode).toBeNull();
    h.send("release");
    await h.wait("closed");
    expect(await h.exited).toEqual({ code: 0, signal: null });
    const reopened = await start(store, Number(new URL(h.scope).port), false, false);
    expect(await reopened.get("beads/tail")).toMatchObject({ status: 200 });
    const replay = await reopened.sequence(input());
    expect(replay).toMatchObject({
      status: 200,
      body: {
        results: [
          { outcome: "created" },
          { code: "resource-not-found" },
          { outcome: "created" },
          { outcome: "created" },
        ],
      },
    });
    expect(json(await reopened.sequence(input()))).toEqual(json(replay));
    await reopened.stop();
  }, 15000);

  it("SIGKILL preserves the prefix but never resumes abandoned members until resubmission", async () => {
    const store = path.join(directory(), "store");
    const h = await start(store);
    const delivery = lost(h.sequence(input()));
    await h.wait("parked", 2);
    const prefix = await h.get("beads/prefix");
    expect(prefix.status).toBe(200);
    expect(await h.get("beads/tail")).toMatchObject({ status: 404 });
    h.child.kill("SIGKILL");
    expect(await h.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(await delivery).toEqual({ delivered: false });
    const reopened = await start(store, Number(new URL(h.scope).port), false, false);
    expect(json(await reopened.get("beads/prefix"))).toEqual(json(prefix));
    expect(await reopened.get("beads/tail")).toMatchObject({ status: 404 });
    expect(await reopened.get("alias/prefix-name")).toMatchObject({ status: 404 });
    // The ordinary executable has completed recovery and serves reads. Only this
    // explicit resubmission is allowed to execute the formerly abandoned tail.
    const retry = await reopened.sequence(input());
    expect(retry).toMatchObject({
      status: 200,
      body: {
        results: [
          { outcome: "created" },
          { code: "resource-not-found" },
          { outcome: "created" },
          { outcome: "created" },
        ],
      },
    });
    expect(await reopened.get("beads/tail")).toMatchObject({ status: 200 });
    expect(json(await reopened.sequence(input()))).toEqual(json(retry));
    await reopened.stop();
  }, 15000);
});
