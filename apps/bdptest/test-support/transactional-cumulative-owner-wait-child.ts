/** NONORDINARY controls: original native turns, one scheduler throw, observational real clock. */
import path from "node:path";
import { inspect } from "node:util";
import { pathToFileURL } from "node:url";
async function main() {
  const installed = process.env.BDP_OWNER_WAIT_RUNTIME;
  if (!installed || !process.send || !process.connected) throw Error("installed IPC required");
  const input = await new Promise<{ configuration: unknown; mode: "deadline" | "retract" }>(
    (resolve) => process.once("message", resolve),
  );
  if (!["deadline", "retract"].includes(input.mode)) throw Error("closed fixture mode");
  const load = (file: string) => import(pathToFileURL(path.join(installed, file)).href);
  const { captureInstalledTransactionConfiguration } = await load(
    "transaction-installed-configuration.js",
  );
  const { startTransactionRuntime } = await load("transaction-runtime.js");
  const { createNodeLifecycleScheduler } = await load("sequence-executor.js");
  const { installedPayloadIdentity } = await load("installed-payload.js");
  const payloadIdentity = await installedPayloadIdentity();
  const native = createNodeLifecycleScheduler();
  type Turn = {
    ordinal: number;
    original: () => void;
    released: boolean;
    cancelled: boolean;
    cancel?: () => void;
  };
  const turns: Turn[] = [],
    listeners: (() => void)[] = [];
  let drain = false,
    faultFired = false,
    armed = false;
  const ticks: number[] = [];
  const notify = () => {
    for (const f of listeners.splice(0)) f();
  };
  const runtime = await startTransactionRuntime(
    captureInstalledTransactionConfiguration(input.configuration),
    {
      scheduler: {
        turn(original: () => void) {
          const ordinal = turns.length + 1;
          if (ordinal > 8) throw Error("bounded native turn count");
          if (input.mode === "retract" && ordinal === 2 && !faultFired) {
            faultFired = true;
            notify();
            throw Error("selected native scheduling infrastructure failure");
          }
          const turn: Turn = { ordinal, original, released: drain, cancelled: false };
          turns.push(turn);
          if (drain) turn.cancel = native.turn(original);
          notify();
          return () => {
            turn.cancelled = true;
            turn.cancel?.();
          };
        },
      },
      comparison: {
        now() {
          const actual = performance.now();
          if (armed) {
            if (ticks.length >= 512) throw Error("bounded observation overflow");
            ticks.push(actual);
            notify();
          }
          return actual;
        },
      },
    },
  );
  const send = (x: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(x, (e: Error | null) => (e ? reject(e) : resolve())),
    );
  const ready = {
    event: "owner-wait.ready",
    scope: runtime.scope,
    listenUrl: runtime.listenUrl,
    targets: runtime.targets,
    payloadIdentity,
    facadeKeys: Object.keys(runtime).sort(),
    ordinaryConfigurationMetadataAvailable: runtime.configurationMetadata !== undefined,
    runtimeConfigurationIdentity: null,
    ordinaryDeployment: false,
    mode: input.mode,
    control:
      "native original callback hold/release; optional second scheduling call throws; comparison now returns exact performance.now without budget/wait override",
  };
  const state = () => ({
    turns: turns.map(({ ordinal, released, cancelled }) => ({ ordinal, released, cancelled })),
    ticks: [...ticks],
    faultFired,
    armed,
  });
  let closing: Promise<void> | undefined, retainedFailure: unknown;
  const close = () =>
    (closing ??= (async () => {
      drain = true;
      for (const turn of turns)
        if (!turn.released && !turn.cancelled) {
          turn.released = true;
          turn.cancel = native.turn(turn.original);
        }
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  const fail = async (cause: unknown) => {
    retainedFailure = cause;
    process.exitCode = 2;
    try {
      await close();
    } catch (e) {
      retainedFailure = new AggregateError([cause, e], "control and native close failed");
    } finally {
      if (process.connected) process.disconnect();
    }
    process.stderr.write(inspect(retainedFailure, { depth: 8 }) + "\n");
  };
  let chain = Promise.resolve(),
    count = 0;
  process.on("message", (v: { command?: string }) => {
    chain = chain
      .then(async () => {
        if (v.command === "close") {
          await close();
          return;
        }
        if (++count > 20) throw Error("bounded command count");
        if (v.command === "held") {
          while (!turns.length) await new Promise<void>((r) => listeners.push(r));
        } else if (v.command === "arm") {
          if (armed || !turns.length) throw Error("invalid real-clock arm");
          armed = true;
        } else if (v.command === "waiting") {
          while (ticks.length < 3) await new Promise<void>((r) => listeners.push(r));
        } else if (v.command === "release") {
          const turn = turns[0];
          if (!turn || turn.cancelled || turn.released)
            throw Error("original firstturn unavailable");
          drain = true;
          turn.released = true;
          turn.cancel = native.turn(turn.original);
        } else if (v.command !== "state") throw Error("unsupported command");
        await send({ event: "owner-wait.done", command: v.command, ready, state: state() });
      })
      .catch(fail);
  });
  process.once("disconnect", () => {
    void close().catch(fail);
  });
  process.once("SIGTERM", () => {
    void close().catch(fail);
  });
  try {
    await send(ready);
  } catch (e) {
    await fail(e);
  }
}
void main().catch(() => {
  process.stderr.write("owner-wait fixture startup failure\n");
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
