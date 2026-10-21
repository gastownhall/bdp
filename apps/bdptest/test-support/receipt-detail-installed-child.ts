/** Nonordinary trusted receipt fixture: real installed owner/admin, no public control route. */
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { TransactionRuntimeOptions } from "../../../packages/server/src/transaction-runtime.js";

async function main() {
  const directory = process.env.BDP_RECEIPT_DETAIL_RUNTIME;
  if (!directory || !process.send || !process.connected)
    throw Error("installed receipt fixture binding missing");
  const configuration = await new Promise<unknown>((resolve) =>
    process.once("message", (value: { configuration: unknown }) => resolve(value.configuration)),
  );
  const { captureInstalledTransactionConfiguration } = await import(
    pathToFileURL(`${directory}/transaction-installed-configuration.js`).href
  );
  const { startTransactionRuntime, transactionRuntimeAdministration } = await import(
    pathToFileURL(`${directory}/transaction-runtime.js`).href
  );
  const { installedPayloadIdentity } = await import(
    pathToFileURL(`${directory}/installed-payload.js`).href
  );
  const captured = captureInstalledTransactionConfiguration(
    configuration,
  ) as TransactionRuntimeOptions;
  const initial = 1000000;
  let now = initial,
    stage = 0;
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
  process.on("message", (value: { command?: unknown; subjects?: unknown }) => {
    chain = chain
      .then(async () => {
        if (value.command === "close") {
          await close();
          return;
        }
        if (
          value.command === "erase" &&
          stage === 0 &&
          Array.isArray(value.subjects) &&
          value.subjects.length === 2
        ) {
          const subjects = value.subjects.map((item: unknown, index: number) => {
            if (!item || typeof item !== "object") throw Error("exact erased original required");
            const row = item as { subject?: unknown; revision?: unknown };
            if (
              Object.keys(row).sort().join(",") !== "revision,subject" ||
              row.subject !== `${captured.scope}beads/${index === 0 ? "r00" : "r31"}` ||
              typeof row.revision !== "string" ||
              !row.revision.length ||
              row.revision.length > 256
            )
              throw Error("unbound receipt erasure subject");
            return { subject: row.subject, revision: row.revision };
          });
          stage = 1;
          const result = administration.eraseHistoricalVersions(subjects);
          await send({ event: "erased", result, now });
          return;
        }
        if (value.command === "empty-policy" && stage === 1) {
          stage = 2;
          await runtime.replaceAuthorizationPolicy({ timeoutMs: 1000 });
          await send({ event: "empty-policy", now });
          return;
        }
        if (value.command === "at-expiry" && stage === 2) {
          stage = 3;
          now = initial + 86400000;
          await send({ event: "at-expiry", now });
          return;
        }
        if (value.command === "after-expiry" && stage === 3) {
          stage = 4;
          now += 1;
          await send({ event: "after-expiry", now });
          return;
        }
        throw Error("unsupported bounded receipt fixture control");
      })
      .catch(async (error: unknown) => {
        process.stderr.write(`receipt fixture control failed: ${inspect(error, { depth: 8 })}\n`);
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
    event: "receipt-detail.ready",
    ordinaryConfigurationMetadataAvailable: runtime.configurationMetadata !== undefined,
    scope: runtime.scope,
    listenUrl: runtime.listenUrl,
    targets: runtime.targets,
    payloadIdentity: await installedPayloadIdentity(),
    now,
    facadeKeys: Object.keys(runtime).sort(),
    ordinaryDeployment: false,
    claimEligible: false,
    fixture: "installed-receipt-private-clock-policy-administration",
    selectedSeams: [
      "trusted-clock",
      "same-facade-private-administration",
      "existing-empty-authorization-policy",
    ],
  });
}
void main().catch((error: unknown) => {
  process.stderr.write(`receipt fixture startup failed: ${inspect(error, { depth: 8 })}\n`);
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
