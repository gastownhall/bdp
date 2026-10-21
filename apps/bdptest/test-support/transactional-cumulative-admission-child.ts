/** NONORDINARY native scheduler control: holds ORIGINAL callbacks only, never supplies outcomes. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
async function main() {
  const directory = process.env.BDP_CUMULATIVE_ADMISSION_RUNTIME;
  if (!directory || !process.send || !process.connected) throw Error("installed IPC required");
  const configuration = await new Promise<unknown>((resolve) =>
    process.once("message", (v: { configuration: unknown }) => resolve(v.configuration)),
  );
  const load = (name: string) => import(pathToFileURL(path.join(directory, name)).href);
  const { captureInstalledTransactionConfiguration } = await load(
    "transaction-installed-configuration.js",
  );
  const { startTransactionRuntime } = await load("transaction-runtime.js");
  const { createNodeLifecycleScheduler } = await load("sequence-executor.js");
  const { installedPayloadIdentity } = await load("installed-payload.js");
  const native = createNodeLifecycleScheduler();
  type Turn = {
    ordinal: number;
    original: () => void;
    cancelled: boolean;
    released: boolean;
    cancel?: () => void;
  };
  const turns: Turn[] = [];
  const notifications: (() => void)[] = [];
  let draining = false;
  const runtime = await startTransactionRuntime(
    captureInstalledTransactionConfiguration(configuration),
    {
      scheduler: {
        turn(original: () => void) {
          if (turns.length >= 8) throw Error("bounded original turn count");
          const turn: Turn = {
            ordinal: turns.length + 1,
            original,
            cancelled: false,
            released: draining,
          };
          turns.push(turn);
          if (draining) turn.cancel = native.turn(original);
          for (const notify of notifications.splice(0)) notify();
          return () => {
            turn.cancelled = true;
            turn.cancel?.();
          };
        },
      },
    },
  );
  const send = (v: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(v, (e: Error | null) => (e ? reject(e) : resolve())),
    );
  const ready = {
    scope: runtime.scope,
    listenUrl: runtime.listenUrl,
    targets: runtime.targets,
    payloadIdentity: await installedPayloadIdentity(),
    facadeKeys: Object.keys(runtime).sort(),
    ordinaryConfigurationMetadataAvailable: runtime.configurationMetadata !== undefined,
    ordinaryDeployment: false,
    runtimeConfigurationIdentity: null,
    control:
      "typed ORIGINAL scheduler callbacks after native sequence bulk admission; clock/comparison/policy unchanged",
  };
  const state = () =>
    turns.map(({ ordinal, cancelled, released }) => ({ ordinal, cancelled, released }));
  let closing: Promise<void> | undefined,
    chain = Promise.resolve(),
    count = 0;
  const close = () =>
    (closing ??= (async () => {
      draining = true;
      for (const turn of turns)
        if (!turn.cancelled && !turn.released) {
          turn.released = true;
          turn.cancel = native.turn(turn.original);
        }
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  let retainedFailure: unknown;
  const fail = async (cause: unknown) => {
    retainedFailure = cause;
    process.exitCode = 2;
    try {
      await close();
    } catch (error) {
      retainedFailure = new AggregateError([cause, error], "admission and native close failed");
    }
    process.stderr.write(inspect(retainedFailure, { depth: 8 }) + "\n");
  };
  process.on("message", (v: { command?: string; ordinal?: number }) => {
    chain = chain
      .then(async () => {
        if (v.command === "close") {
          await close();
          return;
        }
        if (++count > 20) throw Error("bounded control count");
        if (!Number.isInteger(v.ordinal) || v.ordinal! < 1 || v.ordinal! > 8)
          throw Error("unbound ordinal");
        if (v.command === "await") {
          while (turns.length < v.ordinal!)
            await new Promise<void>((resolve) => notifications.push(resolve));
        } else if (v.command === "release") {
          const turn = turns[v.ordinal! - 1];
          if (!turn || turn.cancelled || turn.released) throw Error("original turn unavailable");
          turn.released = true;
          turn.cancel = native.turn(turn.original);
        } else throw Error("unsupported scheduler command");
        await send({ event: "admission.done", command: v.command, state: state(), ready });
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
    await send({ event: "admission.ready", ...ready });
  } catch (error) {
    await fail(error);
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(inspect(error, { depth: 8 }) + "\n");
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
