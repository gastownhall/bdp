/** Private test-only installed administration bridge; no public HTTP/config/CLI control. */
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { TransactionRuntimeOptions } from "../../../packages/server/src/transaction-runtime.js";

async function main() {
  const directory = process.env.BDP_LIVE_LINK_RUNTIME;
  if (!directory || !process.send || !process.connected)
    throw Error("installed live Link fixture binding missing");
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
  const { prepareTransactionSingleton } = await import(
    pathToFileURL(`${directory}/transaction-batch.js`).href
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
  let corrected = false,
    tombstoned = false,
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
          value.subject !== `${captured.scope}links/l` ||
          typeof value.revision !== "string" ||
          !value.revision ||
          value.revision.length > 256
        )
          throw Error("unsupported bounded Link subject/revision");
        let result: ReturnType<typeof administration.correctLiveLinkVersion>;
        if (value.command === "correct-live" && !corrected) {
          corrected = true;
          result = administration.correctLiveLinkVersion(
            value.subject,
            value.revision,
            prepareTransactionSingleton(
              captured.scope,
              "updateLink",
              JSON.stringify({
                link: value.subject,
                expectedRevision: value.revision,
                propertiesChange: [{ op: "replace", path: "", value: { title: "corrected-Link" } }],
                metadataChange: [{ op: "replace", path: "", value: { corrected: true } }],
              }),
            ),
          );
        } else if (value.command === "tombstone-live" && corrected && !tombstoned) {
          tombstoned = true;
          result = administration.tombstoneLiveLinkVersion(value.subject, value.revision);
        } else throw Error("unsupported/duplicate bounded Link administration");
        await send({ event: "private-live-link.done", command: value.command, result });
      })
      .catch(async (error: unknown) => {
        process.stderr.write(`private live Link fixture failed: ${inspect(error, { depth: 6 })}\n`);
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
    event: "private-live-link.ready",
    ...runtime.configurationMetadata,
    listenUrl: runtime.listenUrl,
    targets: runtime.targets,
    facadeKeys: Object.keys(runtime).sort(),
    preparedModule: `${directory}/transaction-batch.js`,
    payloadIdentity,
    fixture: "installed-live-link-administration-only",
    ordinaryDeployment: false,
    administrationPublic: false,
  });
}
void main().catch((error: unknown) => {
  process.stderr.write(
    `private live Link fixture startup failed: ${inspect(error, { depth: 6 })}\n`,
  );
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
