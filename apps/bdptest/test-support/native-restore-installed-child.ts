/** Private offline native-restore fixture. No public route/config/facade extension. */
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { TransactionRuntimeOptions } from "../../../packages/server/src/transaction-runtime.js";
async function main() {
  const directory = process.env.BDP_RESTORE_RUNTIME;
  if (!directory || !process.send || !process.connected) throw Error("fixture binding required");
  const configuration = await new Promise<unknown>((resolve) =>
    process.once("message", (value: { configuration: unknown }) => resolve(value.configuration)),
  );
  const load = (name: string) => import(pathToFileURL(path.join(directory, name)).href);
  const { captureInstalledTransactionConfiguration } = await load(
    "transaction-installed-configuration.js",
  );
  const { captureTransactionRuntimeConfiguration } = await load(
    "transaction-runtime-configuration.js",
  );
  const { startTransactionRuntime, transactionRuntimeAdministration } =
    await load("transaction-runtime.js");
  const { openTransactionStore } = await load("transaction-store.js");
  const { installedPayloadIdentity } = await load("installed-payload.js");
  const captured = captureInstalledTransactionConfiguration(
    configuration,
  ) as TransactionRuntimeOptions;
  let runtime = await startTransactionRuntime(captured);
  let closing: Promise<void> | undefined,
    chain = Promise.resolve();
  const send = (value: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(value, (error: Error | null) => (error ? reject(error) : resolve())),
    );
  const ready = async () => ({
    ...runtime.configurationMetadata,
    listenUrl: runtime.listenUrl,
    targets: runtime.targets,
    facadeKeys: Object.keys(runtime).sort(),
    payloadIdentity: await installedPayloadIdentity(),
    fixture: "private-offline-native-restore",
    ordinaryDeployment: false,
  });
  const close = () =>
    (closing ??= (async () => {
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  process.on("message", (message: { command?: string; subject?: string; revision?: string }) => {
    chain = chain
      .then(async () => {
        if (message.command === "close") {
          await close();
          return;
        }
        let result: unknown;
        if (
          message.command === "erase" &&
          typeof message.subject === "string" &&
          typeof message.revision === "string"
        ) {
          result = transactionRuntimeAdministration(runtime).eraseHistoricalVersions([
            { subject: message.subject, revision: message.revision },
          ]);
        } else if (["save", "restore", "reopen"].includes(message.command ?? "")) {
          await runtime.close();
          const file = path.join(captured.directory, "transaction.sqlite"),
            backup = path.join(captured.directory, "native-backup.sqlite");
          if (message.command === "save") await copyFile(file, backup);
          if (message.command === "restore") {
            const native = captureTransactionRuntimeConfiguration({ ...captured, create: false });
            const owner = openTransactionStore({
              file,
              scope: captured.scope,
              create: false,
              types: native.types,
              contracts: native.contracts,
              receiptMaximumItems: native.settings.receiptMaximumItems,
              nativeRestore: backup,
            });
            try {
              result = {
                configuration: owner.readConfiguration(),
                history: owner.inspect(),
                ledger: owner.erasureLedger(),
              };
            } finally {
              owner.close();
            }
          }
          runtime = await startTransactionRuntime({ ...captured, create: false });
        } else throw Error("unsupported native restore fixture command");
        await send({
          event: "native-restore.done",
          command: message.command,
          result,
          ready: await ready(),
        });
      })
      .catch(async (error: unknown) => {
        process.stderr.write(inspect(error, { depth: 6 }) + "\n");
        process.exitCode = 2;
        await close();
      });
  });
  process.once("SIGTERM", () => void close());
  process.once("disconnect", () => void close());
  await send({ event: "native-restore.ready", ...(await ready()) });
}
void main().catch((error: unknown) => {
  process.stderr.write(inspect(error, { depth: 6 }) + "\n");
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
