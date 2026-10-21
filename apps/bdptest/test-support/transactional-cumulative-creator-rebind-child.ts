/** Existing233 trusted-clock seam only; no policy, fault, scheduler, SQL or admin control. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { TransactionRuntimeOptions } from "../../../packages/server/src/transaction-runtime.js";
async function main() {
  const directory = process.env.BDP_CUMULATIVE_CREATOR_REBIND_RUNTIME;
  if (!directory || !process.send || !process.connected)
    throw Error("exact installed binding required");
  const configuration = await new Promise<unknown>((resolve) =>
    process.once("message", (v: { configuration: unknown }) => resolve(v.configuration)),
  );
  const load = (name: string) => import(pathToFileURL(path.join(directory, name)).href);
  const { captureInstalledTransactionConfiguration } = await load(
    "transaction-installed-configuration.js",
  );
  const { startTransactionRuntime } = await load("transaction-runtime.js");
  const { installedPayloadIdentity } = await load("installed-payload.js");
  const captured = captureInstalledTransactionConfiguration(
    configuration,
  ) as TransactionRuntimeOptions;
  let now = 1000000;
  const runtime = await startTransactionRuntime(captured, { clock: () => now });
  const ready = async () => ({
    scope: runtime.scope,
    listenUrl: runtime.listenUrl,
    targets: runtime.targets,
    payloadIdentity: await installedPayloadIdentity(),
    facadeKeys: Object.keys(runtime).sort(),
    ordinaryConfigurationMetadataAvailable: runtime.configurationMetadata !== undefined,
    ordinaryDeployment: false,
    claimEligible: false,
    now,
    selectedSeams: ["trusted-clock"],
  });
  const send = (v: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(v, (error: Error | null) => (error ? reject(error) : resolve())),
    );
  let chain = Promise.resolve(),
    closing: Promise<void> | undefined,
    count = 0;
  const close = () =>
    (closing ??= (async () => {
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  process.on("message", (v: { command?: unknown; now?: unknown }) => {
    chain = chain
      .then(async () => {
        if (v.command === "close") {
          await close();
          return;
        }
        if (++count > 2) throw Error("bounded clock control count exceeded");
        if (
          v.command !== "advance" ||
          typeof v.now !== "number" ||
          ![1300000, 87400001].includes(v.now) ||
          v.now <= now
        )
          throw Error("unselected clock control");
        now = v.now;
        await send({ event: "creator-rebind.done", command: v.command, ready: await ready() });
      })
      .catch(async (error) => {
        console.error(inspect(error, { depth: 8 }));
        await close();
        process.exitCode = 1;
      });
  });
  process.once("SIGTERM", () => void close());
  process.once("disconnect", () => void close());
  await send({ event: "creator-rebind.ready", ...(await ready()) });
}
main().catch((error) => {
  console.error(inspect(error, { depth: 8 }));
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
