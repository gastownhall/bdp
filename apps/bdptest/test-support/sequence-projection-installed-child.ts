/** Test-only bridge to the byte-verified installed runtime, not a public operation. */
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { TransactionRuntimeOptions } from "../../../packages/server/src/transaction-runtime.js";
async function main() {
  const directory = process.env.BDP_SEQUENCE_PROJECTION_RUNTIME;
  if (!directory || !process.send || !process.connected)
    throw Error("installed sequence fixture binding missing");
  const configuration = await new Promise<unknown>((resolve) =>
    process.once("message", (value: { configuration: unknown }) => resolve(value.configuration)),
  );
  const { captureInstalledTransactionConfiguration } = await import(
    pathToFileURL(`${directory}/transaction-installed-configuration.js`).href
  );
  const { startTransactionRuntime, transactionRuntimeAdministration } = await import(
    pathToFileURL(`${directory}/transaction-runtime.js`).href
  );
  const captured = captureInstalledTransactionConfiguration(
    configuration,
  ) as TransactionRuntimeOptions;
  let now = 1000000,
    erased = false,
    expired = false,
    empty = false;
  const runtime = await startTransactionRuntime(captured, { clock: () => now });
  const administration = transactionRuntimeAdministration(runtime);
  const send = (value: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(value, (error: Error | null) => (error ? reject(error) : resolve())),
    );
  let chain = Promise.resolve(),
    closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  process.on("message", (value: { command?: unknown; subject?: unknown; revision?: unknown }) => {
    chain = chain
      .then(async () => {
        if (value.command === "close") {
          await close();
          return;
        }
        if (
          value.command === "erase" &&
          !erased &&
          !expired &&
          value.subject === `${captured.scope}beads/a` &&
          typeof value.revision === "string" &&
          value.revision.length > 0 &&
          value.revision.length <= 256
        ) {
          erased = true;
          const result = administration.eraseHistoricalVersions([
            { subject: value.subject, revision: value.revision },
          ]);
          await send({ event: "erased", result });
          return;
        }
        if (value.command === "expire" && erased && !expired) {
          expired = true;
          now += 86400001;
          await send({ event: "expired", now });
          return;
        }
        if (value.command === "empty-policy" && expired && !empty) {
          empty = true;
          await runtime.replaceAuthorizationPolicy({ timeoutMs: 1000 });
          await send({ event: "empty-policy", now });
          return;
        }
        throw Error("unsupported bounded sequence fixture control");
      })
      .catch(async (error: unknown) => {
        process.stderr.write(`sequence fixture control failed: ${inspect(error, { depth: 8 })}\n`);
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
    event: "sequence.ready",
    fixture: "installed-sequence-private-clock-policy-administration",
    scope: runtime.scope,
    listenUrl: runtime.listenUrl,
    now,
    facadeKeys: Object.keys(runtime).sort(),
    ordinaryDeployment: false,
    claimEligible: false,
    selectedSeams: [
      "clock",
      "same-facade-private-administration",
      "existing-authorization-policy-replacement",
    ],
  });
}
void main().catch((error: unknown) => {
  process.stderr.write(`sequence fixture startup failed: ${inspect(error, { depth: 8 })}\n`);
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
