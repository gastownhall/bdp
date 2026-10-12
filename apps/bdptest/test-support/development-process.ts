import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReadUpdateFetchTransport } from "@bdp/client";

const runtime = new URL("../../../packages/server/dist/development-runtime.js", import.meta.url)
  .href;
const scheduler = new URL("../../../packages/server/dist/sequence-executor.js", import.meta.url)
  .href;
const executable = new URL("../dist/development-main.js", import.meta.url);

// This child controls scheduling or a fixed retention clock only. The real emitted HTTP receiver, durable
// owner, evaluator and store execute every request. No mocked admission or
// synthetic outcome stands in for committed state. Scheduling mode parks dispatch
// 2 after dispatch 1 commits. Retention mode leaves scheduling alone and pins only
// the private retention clock; reopening lets normal startup expiry run.
const controlledProgram = `
import { readFileSync } from "node:fs";
import { startDevelopmentReferenceRuntime } from ${JSON.stringify(runtime)};
import { createNodeLifecycleScheduler } from ${JSON.stringify(scheduler)};
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const epoch = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
if (epoch !== undefined && (!Number.isSafeInteger(epoch) || epoch < 0))
  throw Error("invalid private retention epoch");
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
const server = await startDevelopmentReferenceRuntime(
  config, epoch === undefined ? controlled : undefined,
  epoch === undefined ? undefined : () => epoch,
);
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
export function createDevelopmentProcessHarness(token: string) {
  const directories: string[] = [];
  const children: ChildProcess[] = [];
  const exits = new Map<
    ChildProcess,
    Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  >();
  function directory() {
    const result = mkdtempSync(path.join(tmpdir(), "bdp-http-disconnect-"));
    directories.push(result);
    return result;
  }
  async function close() {
    try {
      await Promise.all(
        children.splice(0).map(async (child) => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          const exited = exits.get(child);
          if (exited !== undefined) await boundedExit(exited);
        }),
      );
    } finally {
      exits.clear();
      for (const owned of directories.splice(0)) rmSync(owned, { recursive: true, force: true });
    }
  }
  async function start(
    store: string,
    port = 0,
    create = true,
    controlled = true,
    retentionEpoch?: number,
  ) {
    if (
      retentionEpoch !== undefined &&
      (!controlled || !Number.isSafeInteger(retentionEpoch) || retentionEpoch < 0)
    )
      throw new Error(
        "retention epoch requires a private controlled child and safe nonnegative time",
      );
    const support = directory();
    const config = path.join(support, "config.json");
    writeFileSync(config, JSON.stringify({ directory: store, port, create, token }), {
      mode: 0o600,
    });
    const program = path.join(support, "controlled.mjs");
    writeFileSync(program, controlledProgram);
    const child = spawn(
      process.execPath,
      [
        controlled ? program : executable.pathname,
        config,
        ...(retentionEpoch === undefined ? [] : [String(retentionEpoch)]),
      ],
      {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
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
      waitForExit: () => boundedExit(exited),
      send: (message: "release" | "close") => child.send(message),
      get: (relative: string) => transport.get(new URL(relative, scope).href),
      sequence: (input: unknown, signal?: AbortSignal) =>
        transport.post(`${scope}development/sequence`, {
          bodyText: JSON.stringify(input),
          ...(signal === undefined ? {} : { signal }),
        }),
      async stop() {
        child.kill("SIGTERM");
        return boundedExit(exited);
      },
    };
  }
  return { start, directory, close };
}
async function boundedExit<T>(exited: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("development child did not exit within cleanup bound")),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
