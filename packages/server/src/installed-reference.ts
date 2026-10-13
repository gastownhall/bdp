/** Exact installed candidate factory. Public startup may call this only behind
 * independently verified profile evidence; P1a provides no such admission. */
import { installedPayloadIdentity } from "./installed-payload.js";
import { startDevelopmentReferenceRuntime } from "./development-runtime.js";
import { createDevelopmentComposition } from "./development-composition.js";
import { captureInstalledReferenceConfiguration } from "./installed-reference-configuration.js";

export async function startInstalledReferenceCandidate(input: unknown) {
  const config = captureInstalledReferenceConfiguration(input);
  const payloadIdentity = await installedPayloadIdentity();
  const composition = createDevelopmentComposition(new URL(config.scope).pathname);
  const first = config.credentials[0];
  if (first === undefined) throw new TypeError("credential required");
  const runtime = await startDevelopmentReferenceRuntime(
    { directory: config.directory, port: config.port, create: config.create, token: first.token },
    undefined,
    undefined,
    composition,
    { configuration: config.configuration, credentials: config.credentials },
    { scope: config.scope, host: config.host, schemas: config.schemas },
  );
  return Object.freeze({
    ...runtime,
    configurationIdentity: config.identity,
    artifactIdentity: config.artifactIdentity,
    payloadIdentity,
    policyIdentity: config.policyIdentity,
    authenticationIdentity: config.authenticationIdentity,
    profile: config.profile,
    history: config.history,
    claimEligible: false as const,
  });
}
