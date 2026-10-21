/** NEW fixed management companion. Genuine installed owner/admin, trusted clock, offline restore; never public/configurable BDP controls. */
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { TransactionRuntimeOptions } from "../../../packages/server/src/transaction-runtime.js";
async function main() {
  const directory = process.env.BDP_CUMULATIVE_MANAGEMENT_RUNTIME;
  if (!directory || !process.send || !process.connected)
    throw Error("exact installed management binding required");
  const configuration = await new Promise<unknown>((resolve) =>
    process.once("message", (v: { configuration: unknown }) => resolve(v.configuration)),
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
  const { prepareTransactionSingleton } = await load("transaction-batch.js");
  const { installedPayloadIdentity } = await load("installed-payload.js");
  const captured = captureInstalledTransactionConfiguration(
    configuration,
  ) as TransactionRuntimeOptions;
  let now = 1000000;
  let runtime = await startTransactionRuntime(captured, { clock: () => now });
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
    selectedSeams: [
      "trusted-clock",
      "same-facade-private-administration",
      "existing-empty-policy-replacement",
      "offline-native-backup-restore",
    ],
  });
  const send = (v: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(v, (error: Error | null) => (error ? reject(error) : resolve())),
    );
  let chain = Promise.resolve(),
    closing: Promise<void> | undefined,
    count = 0,
    saved = false,
    restored = false,
    rotated = false;
  const close = () =>
    (closing ??= (async () => {
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  process.on(
    "message",
    (v: { command?: unknown; now?: unknown; subject?: unknown; revision?: unknown }) => {
      chain = chain
        .then(async () => {
          if (v.command === "close") {
            await close();
            return;
          }
          if (++count > 12) throw Error("bounded management control count exceeded");
          let result: unknown;
          if (
            v.command === "advance" &&
            typeof v.now === "number" &&
            [1300000, 1300001, 87400000, 87400001].includes(v.now) &&
            v.now > now
          ) {
            now = v.now;
          } else if (v.command === "empty-policy" && !rotated) {
            rotated = true;
            result = await runtime.replaceAuthorizationPolicy({ timeoutMs: 1000 });
          } else if (v.command === "save" && !saved) {
            saved = true;
            await runtime.close();
            await copyFile(
              path.join(captured.directory, "transaction.sqlite"),
              path.join(captured.directory, "management-backup.sqlite"),
            );
            runtime = await startTransactionRuntime(
              { ...captured, create: false },
              { clock: () => now },
            );
          } else if (v.command === "reopen") {
            await runtime.close();
            runtime = await startTransactionRuntime(
              { ...captured, create: false },
              { clock: () => now },
            );
          } else if (v.command === "restore" && saved && !restored) {
            restored = true;
            await runtime.close();
            const native = captureTransactionRuntimeConfiguration({ ...captured, create: false });
            const owner = openTransactionStore({
              file: path.join(captured.directory, "transaction.sqlite"),
              scope: captured.scope,
              create: false,
              types: native.types,
              contracts: native.contracts,
              receiptMaximumItems: native.settings.receiptMaximumItems,
              clock: () => now,
              nativeRestore: path.join(captured.directory, "management-backup.sqlite"),
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
            runtime = await startTransactionRuntime(
              { ...captured, create: false },
              { clock: () => now },
            );
          } else if (
            typeof v.subject === "string" &&
            typeof v.revision === "string" &&
            v.revision.length > 0 &&
            v.revision.length <= 256
          ) {
            const admin = transactionRuntimeAdministration(runtime);
            if (v.command === "erase" && v.subject === `${captured.scope}beads/r00`)
              result = admin.eraseHistoricalVersions([
                { subject: v.subject, revision: v.revision },
              ]);
            else if (v.command === "correct-link" && v.subject === `${captured.scope}links/l`)
              result = admin.correctLiveLinkVersion(
                v.subject,
                v.revision,
                prepareTransactionSingleton(
                  captured.scope,
                  "updateLink",
                  JSON.stringify({
                    link: v.subject,
                    expectedRevision: v.revision,
                    propertiesChange: [{ op: "replace", path: "", value: { n: 2 } }],
                    metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
                  }),
                ),
              );
            else if (v.command === "tombstone-link" && v.subject === `${captured.scope}links/l`)
              result = admin.tombstoneLiveLinkVersion(v.subject, v.revision);
            else throw Error("unbound administrative subject/command");
          } else throw Error("unsupported bounded management command");
          await send({
            event: "management.done",
            command: v.command,
            result,
            ready: await ready(),
          });
        })
        .catch(async (error: unknown) => {
          process.stderr.write(inspect(error, { depth: 8 }) + "\n");
          process.exitCode = 2;
          await close();
        });
    },
  );
  process.once("disconnect", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
  await send({ event: "management.ready", ...(await ready()) });
}
void main().catch((error: unknown) => {
  process.stderr.write(inspect(error, { depth: 8 }) + "\n");
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
