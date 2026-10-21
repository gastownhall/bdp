/** Test-only trusted clock bridge. No global clock patch or production operation. */

import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { TransactionRuntimeOptions } from "../../../packages/server/src/transaction-runtime.js";

export type ClockAdvance = { command: "advance-clock"; time: number };

async function main() {
  const directory = process.env.BDP_SNAPSHOT_CLOCK_RUNTIME;
  if (!directory || !process.send || !process.connected)
    throw new Error("clock bridge binding missing");
  const configuration = await new Promise<unknown>((resolve) => {
    process.once("message", (input: { configuration: unknown }) => resolve(input.configuration));
  });
  let now = 1000000,
    advanced = false;
  const { startTransactionRuntime } = await import(
    pathToFileURL(`${directory}/transaction-runtime.js`).href
  );
  const { captureInstalledTransactionConfiguration } = await import(
    pathToFileURL(`${directory}/transaction-installed-configuration.js`).href
  );
  const captured = captureInstalledTransactionConfiguration(
    configuration,
  ) as TransactionRuntimeOptions;
  const runtime = await startTransactionRuntime(captured, { clock: () => now });
  const send = (value: unknown) =>
    new Promise<void>((resolve, reject) => {
      process.send!(value, (error: Error | null) => (error ? reject(error) : resolve()));
    });
  let chain = Promise.resolve(),
    closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  process.on("message", (value: { command?: unknown; time?: unknown }) => {
    chain = chain
      .then(async () => {
        if (value.command === "close") {
          await close();
          return;
        }
        if (
          value.command !== "advance-clock" ||
          advanced ||
          typeof value.time !== "number" ||
          !Number.isSafeInteger(value.time) ||
          value.time <= now ||
          value.time > now + 600000
        )
          throw new Error("unsupported trusted clock control");
        advanced = true;
        now = value.time;
        await send({ event: "clock-advanced", now });
      })
      .catch(async () => {
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
    event: "snapshot-clock.ready",
    scope: runtime.scope,
    listenUrl: runtime.listenUrl,
    now,
    claimEligible: false,
    ordinaryDeployment: false,
    selectedSeam: "clock-only",
  });
}
void main().catch((error: unknown) => {
  process.stderr.write(`private Snapshot clock fixture failed: ${inspect(error, { depth: 6 })}\n`);
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
