/** Private installed Transactional candidate; never a profile admission API. */
import { captureInstalledTransactionConfiguration } from "./transaction-installed-configuration.js";
import { installedPayloadIdentity } from "./installed-payload.js";
import { startTransactionRuntime } from "./transaction-runtime.js";
export async function startInstalledTransactionCandidate(input: unknown) {
  const captured = captureInstalledTransactionConfiguration(input);
  const payloadIdentity = await installedPayloadIdentity();
  const runtime = await startTransactionRuntime(captured);
  try {
    const metadata = runtime.configurationMetadata;
    if (!metadata || metadata.authorityMode !== "canonical" || metadata.scope !== captured.scope)
      throw new TypeError("installed transaction metadata unavailable");
    return Object.freeze({ ...runtime, configurationMetadata: metadata, payloadIdentity });
  } catch (error) {
    try {
      await runtime.close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "installed transaction startup cleanup failed");
    }
    throw error;
  }
}
