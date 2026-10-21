/** Private test-only installed administration bridge; no public HTTP/config/CLI control. */
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { TransactionRuntimeOptions } from "../../../packages/server/src/transaction-runtime.js";

async function main() {
  const directory = process.env.BDP_TOMBSTONE_RUNTIME;
  if (!directory || !process.send || !process.connected)
    throw Error("installed tombstone fixture binding missing");
  const configuration = await new Promise<unknown>((resolve) => {
    process.once("message", (value: { configuration: unknown }) => resolve(value.configuration));
  });
  const { captureInstalledTransactionConfiguration } = await import(
    pathToFileURL(`${directory}/transaction-installed-configuration.js`).href
  );
  const { installedPayloadIdentity } = await import(
    pathToFileURL(`${directory}/installed-payload.js`).href
  );
  const { startTransactionRuntime, transactionRuntimeAdministration } = await import(
    pathToFileURL(`${directory}/transaction-runtime.js`).href
  );
  const captured = captureInstalledTransactionConfiguration(
    configuration,
  ) as TransactionRuntimeOptions;
  const payloadIdentity = await installedPayloadIdentity();
  const runtime = await startTransactionRuntime(captured);
  // Only the original authentic runtime facade owns this companion. The normal
  // installed wrapper's spread copy intentionally does not acquire administration.
  const administration = transactionRuntimeAdministration(runtime);
  const send = (value: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(value, (error: Error | null) => (error ? reject(error) : resolve())),
    );
  let tombstoned = false,
    closing: Promise<void> | undefined,
    chain = Promise.resolve();
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
          value.command !== "tombstone-live" ||
          tombstoned ||
          value.subject !== `${captured.scope}beads/b` ||
          typeof value.revision !== "string" ||
          !value.revision ||
          value.revision.length > 256
        )
          throw Error("unsupported bounded local administration request");
        tombstoned = true;
        const result = administration.tombstoneLiveBeadVersion(value.subject, value.revision);
        await send({ event: "private-tombstone.done", result });
      })
      .catch(async (error: unknown) => {
        process.stderr.write(`private tombstone fixture failed: ${inspect(error, { depth: 6 })}\n`);
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
    event: "private-tombstone.ready",
    ...runtime.configurationMetadata,
    listenUrl: runtime.listenUrl,
    targets: runtime.targets,
    facadeKeys: Object.keys(runtime).sort(),
    payloadIdentity,
    fixture: "installed-tombstone-administration-only",
    ordinaryDeployment: false,
    administrationPublic: false,
  });
}
void main().catch((error: unknown) => {
  process.stderr.write(
    `private tombstone fixture startup failed: ${inspect(error, { depth: 6 })}\n`,
  );
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
