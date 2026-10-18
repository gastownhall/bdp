/** Private inherited-IPC lifecycle bootstrap; a non-entry import is inert. */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { administrativeData } from "./development-contracts.js";
import { loadReferenceDeployment, type ReferenceDeploymentInput } from "./reference-deployment.js";
import { startPreparedReferenceDeployment } from "./reference-deployment-runtime.js";

async function main() {
  if (!process.connected || typeof process.send !== "function")
    throw new Error("inherited IPC required");
  const controller = new AbortController();
  const stopped = Promise.withResolvers<void>();
  let stopping = false;
  let controlFailure: unknown;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    controller.abort(new Error("reference deployment stopping"));
    stopped.resolve();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  process.once("disconnect", stop);
  let control: ((message: unknown) => void) | undefined;
  try {
    const input = await new Promise<ReferenceDeploymentInput>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("configuration deadline")), 10000);
      const aborted = () => finish(new Error("configuration cancelled"));
      const received = (message: unknown) => {
        try {
          if (Buffer.byteLength(JSON.stringify(message)) > 65536)
            throw new Error("configuration bound");
          const data = administrativeData(message, ["configuration"]);
          finish(undefined, data.configuration as ReferenceDeploymentInput);
        } catch (error) {
          finish(error);
        }
      };
      function finish(error?: unknown, value?: ReferenceDeploymentInput) {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", aborted);
        process.removeListener("message", received);
        if (error !== undefined) reject(error);
        else resolve(value!);
      }
      process.once("message", received);
      controller.signal.addEventListener("abort", aborted, { once: true });
      if (controller.signal.aborted) aborted();
    });
    control = (message: unknown) => {
      try {
        if (Buffer.byteLength(JSON.stringify(message)) > 65536) throw new Error("control bound");
        const data = administrativeData(message, ["command"]);
        if (data.command !== "close") throw new Error("invalid control");
      } catch (error) {
        controlFailure ??= error;
      }
      stop();
    };
    process.on("message", control);
    // Observe file/preparation settlement before cancellation can proceed to owner acquisition.
    const prepared = await loadReferenceDeployment(input);
    controller.signal.throwIfAborted();
    const runtime = await startPreparedReferenceDeployment(prepared, controller.signal);
    let primary: unknown;
    try {
      controller.signal.throwIfAborted();
      if (!process.connected || stopping) throw new Error("stopped before ready");
      await new Promise<void>((resolve, reject) =>
        process.send!(
          {
            event: "qualification.ready",
            scope: runtime.scope,
            listenUrl: runtime.listenUrl,
            profile: runtime.profile,
            history: runtime.history,
            claimEligible: false,
          },
          (error: Error | null) => (error ? reject(error) : resolve()),
        ),
      );
      await Promise.race([stopped.promise, runtime.completion]);
      if (controlFailure !== undefined) throw controlFailure;
    } catch (error) {
      primary = error;
    }
    try {
      await runtime.close();
    } catch (cleanup) {
      if (primary !== undefined)
        throw new AggregateError([primary, cleanup], "reference lifecycle terminal failure");
      throw cleanup;
    }
    if (primary !== undefined) throw primary;
  } finally {
    if (control) process.removeListener("message", control);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    process.removeListener("disconnect", stop);
    if (process.connected) process.disconnect();
  }
}
function isEntrypoint() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isEntrypoint())
  void main().catch(() => {
    process.stderr.write("reference deployment startup failed\n");
    process.exitCode = 2;
    if (process.connected) process.disconnect();
  });
