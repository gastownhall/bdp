/** Private installed reference candidate configuration. No profile admission. */
import { createHash } from "node:crypto";
import path from "node:path";
import {
  parseCanonicalScope,
  REFERENCE_TYPE_DESCRIPTORS,
  stringifyJsonValue,
  type TypeDescriptor,
} from "@bdp/protocol";
import { CONTRACT_ARTIFACT_CEILINGS } from "./installed-contract-artifact.js";
import {
  administrativeArray,
  administrativeData,
  compileDevelopmentContracts,
  captureDevelopmentAggregatePolicy,
  createDevelopmentAccessPolicy,
  type DevelopmentAccess,
} from "./development-contracts.js";
import { DEVELOPMENT_OWNER_LIMITS } from "./development-authority.js";

/** Reference identities are instantiated locally; the work.example identities
 * are not hosted or claimed. Remap every Type-reference position together. */
export function referenceTypeArtifacts(scope: string) {
  const canonical = parseCanonicalScope(scope);
  const ids = new Map(
    REFERENCE_TYPE_DESCRIPTORS.map((d) => [
      d.id,
      `${canonical}types/${new URL(d.id).pathname.split("/").at(-1)}`,
    ]),
  );
  const remap = (id: string) => {
    const mapped = ids.get(id);
    if (mapped === undefined) throw new TypeError("reference closure is incomplete");
    return mapped;
  };
  const artifacts = REFERENCE_TYPE_DESCRIPTORS.map(
    (d): TypeDescriptor =>
      d.describes === "link"
        ? {
            ...d,
            id: remap(d.id),
            conformsTo: d.conformsTo.map(remap),
            source: { ...d.source, conformsTo: d.source.conformsTo.map(remap) },
            target: { ...d.target, conformsTo: d.target.conformsTo.map(remap) },
          }
        : {
            ...d,
            id: remap(d.id),
            conformsTo: d.conformsTo.map(remap),
            ...(d.ownsOutgoing === undefined
              ? {}
              : {
                  ownsOutgoing: Object.fromEntries(
                    Object.entries(d.ownsOutgoing).map(([id, rule]) => [
                      id === "*" ? id : remap(id),
                      rule,
                    ]),
                  ),
                }),
          },
  );
  // Check every output key and value, not merely the positions remapped above.
  // Future reference fields must not silently retain foreign artifact identities.
  function local(value: unknown): void {
    if (typeof value === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
      if (!new URL(value).href.startsWith(canonical))
        throw new TypeError("reference artifact is not Scope-local");
    } else if (Array.isArray(value)) value.forEach(local);
    else if (value !== null && typeof value === "object")
      for (const [key, entry] of Object.entries(value)) {
        local(key);
        local(entry);
      }
  }
  local(artifacts);
  return artifacts;
}
function string(value: unknown, maximum = 16384): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > maximum)
    throw new TypeError("bounded configuration string required");
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256").update(stringifyJsonValue(value)).digest("hex");
export function captureInstalledReferenceConfiguration(input: unknown) {
  const fields = administrativeData(input, [
    "scope",
    "listener",
    "directory",
    "create",
    "credentials",
    "policies",
    "contracts",
    "maximumEndpointMultiplicity",
  ]);
  const scope = parseCanonicalScope(string(fields.scope));
  const listener = administrativeData(fields.listener, ["host", "port"]);
  const host = string(listener.host, 128);
  if (
    !["127.0.0.1", "::1"].includes(host) ||
    !Number.isSafeInteger(listener.port) ||
    (listener.port as number) < 1 ||
    (listener.port as number) > 65535
  )
    throw new TypeError("explicit loopback listener required");
  const directory = string(fields.directory);
  if (!path.isAbsolute(directory) || typeof fields.create !== "boolean")
    throw new TypeError("explicit provisioning required");
  const credentials = administrativeArray(fields.credentials, 32).map((value) => {
    const entry = administrativeData(value, ["token", "principal"]);
    const token = string(entry.token, 256),
      principal = string(entry.principal, 128);
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token) || !/^[A-Za-z0-9_-]{1,128}$/.test(principal))
      throw new TypeError("invalid trusted credential");
    return Object.freeze({ token, principal });
  });
  if (!credentials.length || new Set(credentials.map((c) => c.token)).size !== credentials.length)
    throw new TypeError("unique credentials required");
  const access = createDevelopmentAccessPolicy(
    fields.policies as Record<string, DevelopmentAccess>,
  );
  for (const c of credentials) access.policy.capture(c.principal);
  const source = administrativeData(fields.contracts, ["descriptors", "schemas"]);
  let capturedBytes = 0;
  const artifacts = (values: unknown) =>
    administrativeArray(values, 4096).map((value) => {
      const entry = administrativeData(value, ["retrievalUri", "utf8"]);
      const retrievalUri = string(entry.retrievalUri);
      const utf8 = string(entry.utf8, CONTRACT_ARTIFACT_CEILINGS.artifactBytes);
      capturedBytes += Buffer.byteLength(utf8) + Buffer.byteLength(retrievalUri);
      if (capturedBytes > CONTRACT_ARTIFACT_CEILINGS.totalBytes)
        throw new RangeError("installed artifact capture bound");
      return { retrievalUri, utf8Bytes: Buffer.from(utf8) };
    });
  // Empty descriptors select the shipped, complete local reference closure.
  const descriptors = administrativeArray(source.descriptors, 4096);
  const bundle = {
    descriptors: descriptors.length
      ? artifacts(descriptors)
      : referenceTypeArtifacts(scope).map((d) => ({
          retrievalUri: d.id,
          utf8Bytes: Buffer.from(stringifyJsonValue(d)),
        })),
    schemas: artifacts(source.schemas),
    limits: CONTRACT_ARTIFACT_CEILINGS,
  };
  const contracts = compileDevelopmentContracts(bundle);
  // Hosted artifacts are a closed manifest under this configured Scope only.
  if (contracts.descriptors.some((d) => !d.id.startsWith(`${scope}types/`)))
    throw new TypeError("installed candidate Types must be Scope-local");
  const schemas = bundle.schemas.map((artifact) => {
    if (
      !artifact.retrievalUri.startsWith(`${scope}schemas/`) ||
      new URL(artifact.retrievalUri).search ||
      new URL(artifact.retrievalUri).hash
    )
      throw new TypeError("installed schema hosting must be Scope-local");
    return Object.freeze({ uri: artifact.retrievalUri, utf8: artifact.utf8Bytes.toString("utf8") });
  });
  const aggregate = captureDevelopmentAggregatePolicy(
    fields.maximumEndpointMultiplicity,
    contracts.descriptors,
  );
  const configuration = Object.freeze({
    contracts,
    access: access.policy,
    maximumEndpointMultiplicity: Object.freeze(aggregate),
  });
  const policyIdentity = access.policy.identity();
  const authenticationIdentity = digest(
    credentials.map((c) => ({ principal: c.principal, tokenDigest: digest(c.token) })),
  );
  const profile = "read-update" as const;
  const history = false as const;
  const identity = digest({
    revision: "installed-reference-candidate-1",
    scope,
    contracts: contracts.identity,
    policyIdentity,
    authenticationIdentity,
    profile,
    aggregate,
    ownerLimits: DEVELOPMENT_OWNER_LIMITS,
    cors: "disabled",
    history,
  });
  return Object.freeze({
    scope,
    host,
    port: listener.port as number,
    directory,
    create: fields.create,
    credentials: Object.freeze(credentials),
    configuration,
    schemas: Object.freeze(schemas),
    identity,
    policyIdentity,
    authenticationIdentity,
    profile,
    history,
    artifactIdentity: contracts.identity,
  });
}
