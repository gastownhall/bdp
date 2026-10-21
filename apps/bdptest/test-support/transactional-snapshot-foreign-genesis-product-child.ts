/** Nonordinary fixture: actual installed runtime with fixed trusted clock and one existing policy rotation. */
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { TransactionRuntimeOptions } from "../../../packages/server/src/transaction-runtime.js";
async function main() {
  const directory = process.env.BDP_SNAPSHOT_FOREIGN_RUNTIME;
  if (!directory || !process.send || !process.connected)
    throw Error("installed Snapshot fixture binding missing");
  const configuration = await new Promise<unknown>((resolve) =>
    process.once("message", (v: { configuration: unknown }) => resolve(v.configuration)),
  );
  const { captureInstalledTransactionConfiguration } = await import(
    pathToFileURL(`${directory}/transaction-installed-configuration.js`).href
  );
  const { startTransactionRuntime } = await import(
    pathToFileURL(`${directory}/transaction-runtime.js`).href
  );
  const { installedPayloadIdentity } = await import(
    pathToFileURL(`${directory}/installed-payload.js`).href
  );
  const captured = captureInstalledTransactionConfiguration(
    configuration,
  ) as TransactionRuntimeOptions;
  const now = 1000000;
  const runtime = await startTransactionRuntime(captured, { clock: () => now });
  const send = (v: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(v, (err: Error | null) => (err ? reject(err) : resolve())),
    );
  let rotated = false,
    chain = Promise.resolve(),
    closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  process.on("message", (v: { command?: unknown }) => {
    chain = chain
      .then(async () => {
        if (v.command === "close") {
          await close();
          return;
        }
        if (v.command === "rotate" && !rotated) {
          rotated = true;
          const result = await runtime.replaceAuthorizationPolicy({ timeoutMs: 1000 });
          await send({ event: "rotated", result, now });
          return;
        }
        throw Error("unsupported bounded Snapshot fixture control");
      })
      .catch(async (error: unknown) => {
        process.stderr.write(inspect(error, { depth: 8 }) + "\n");
        process.exitCode = 2;
        await close();
      });
  });
  process.once("disconnect", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
  await send({
    event: "snapshot-foreign.ready",
    scope: runtime.scope,
    listenUrl: runtime.listenUrl,
    now,
    payloadIdentity: await installedPayloadIdentity(),
    facadeKeys: Object.keys(runtime).sort(),
    ordinaryConfigurationMetadataAvailable: runtime.configurationMetadata !== undefined,
    ordinaryDeployment: false,
    claimEligible: false,
    selectedSeams: ["fixed-trusted-clock", "existing-authorization-policy-replacement"],
  });
}
void main().catch((error: unknown) => {
  process.stderr.write(inspect(error, { depth: 8 }) + "\n");
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
