/** Private bounded launch data; compilation remains in the one runtime factory. */
import path from "node:path";
import { parseCanonicalScope } from "@bdp/protocol";
import { administrativeArray, administrativeData } from "./development-contracts.js";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import type { TransactionRuntimeOptions } from "./transaction-runtime.js";
function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    !value.isWellFormed() ||
    Buffer.byteLength(value) > maximum
  )
    throw new TypeError("bounded installed transaction string required");
  return value;
}
export function captureInstalledTransactionConfiguration(
  input: unknown,
): TransactionRuntimeOptions {
  const own = administrativeData(input, [
    "scope",
    "directory",
    "create",
    "credentials",
    "artifacts",
  ]);
  const scope = parseCanonicalScope(text(own.scope, 8192));
  const directory = text(own.directory, 16384);
  if (!path.isAbsolute(directory) || typeof own.create !== "boolean")
    throw new TypeError("explicit provisioning required");
  const credentials = administrativeArray(own.credentials, 32).map((v) => {
    const c = administrativeData(v, ["token", "principal", "canMutate"]);
    const token = text(c.token, 256),
      principal = text(c.principal, 16384);
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token) || typeof c.canMutate !== "boolean")
      throw new TypeError("invalid installed credential");
    return Object.freeze({ token, principal, canMutate: c.canMutate });
  });
  if (!credentials.length || new Set(credentials.map((c) => c.token)).size !== credentials.length)
    throw new TypeError("unique credentials required");
  const supplied = administrativeData(own.artifacts, ["descriptors", "schemas"]);
  let total = 0;
  const artifacts = (value: unknown) =>
    Object.freeze(
      administrativeArray(value, CONTRACT_ARTIFACT_CEILINGS.submittedArtifacts).map((v) => {
        const a = administrativeData(v, ["retrievalUri", "utf8"]);
        const retrievalUri = text(a.retrievalUri, 16384),
          utf8 = text(a.utf8, CONTRACT_ARTIFACT_CEILINGS.artifactBytes);
        total += Buffer.byteLength(retrievalUri) + Buffer.byteLength(utf8);
        if (total > CONTRACT_ARTIFACT_CEILINGS.totalBytes)
          throw new TypeError("installed artifact capture bound");
        return Object.freeze({ retrievalUri, utf8 });
      }),
    );
  const descriptors = artifacts(supplied.descriptors),
    schemas = artifacts(supplied.schemas);
  if (!descriptors.length) throw new TypeError("compiled descriptor closure required");
  return Object.freeze({
    scope,
    directory,
    create: own.create,
    port: 0,
    authorityMode: "canonical",
    credentials: Object.freeze(credentials),
    artifacts: Object.freeze({ descriptors, schemas, limits: CONTRACT_ARTIFACT_CEILINGS }),
  });
}
