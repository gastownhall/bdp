/** Bounded inherited-IPC launcher. No request or observation emulation. */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
export async function launchInstalledTransaction(entry, configuration, signal) {
  signal?.throwIfAborted();
  // Explicit launcher-owned provisioning; reopen keeps the directory/create:false.
  if (configuration.create) await mkdir(configuration.directory, { recursive: true, mode: 0o700 });
  signal?.throwIfAborted();
  const child = spawn(process.execPath, [entry], {
    cwd: "/tmp",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let bytes = 0;
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 65536) child.kill("SIGKILL");
    });
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  async function bounded(promise) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error("installed transaction process deadline"));
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function drainFailure(error) {
    child.kill("SIGKILL");
    try {
      await bounded(exited);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "installed transaction cleanup failed");
    }
    throw error;
  }
  let closing;
  const close = () =>
    (closing ??= (async () => {
      try {
        if (child.connected) child.send({ command: "close" });
        const result = await bounded(exited);
        if (result.code !== 0 || result.signal !== null)
          throw new Error("installed transaction child did not close cleanly");
      } catch (error) {
        await drainFailure(error);
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    })());
  const onAbort = () => {
    void close().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  let detachReadyAbort = () => {};
  try {
    const ready = await bounded(
      new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal?.addEventListener("abort", abort, { once: true });
        detachReadyAbort = () => signal?.removeEventListener("abort", abort);
        if (signal?.aborted) {
          abort();
          return;
        }
        child.once("error", reject);
        child.once("message", resolve);
        void exited.then(() => reject(new Error("installed transaction exited before ready")));
        child.send({ configuration });
      }),
    );
    signal?.throwIfAborted();
    if (!ready || ready.event !== "qualification.ready" || JSON.stringify(ready).length > 65536)
      throw new Error("invalid installed ready message");
    return { child, ready, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "installed transaction startup cleanup failed");
    }
    throw error;
  } finally {
    detachReadyAbort();
  }
}
