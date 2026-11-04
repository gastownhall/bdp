/** Explicit Core + ordinary Write reference composition for the canonical draft. */
import { parseCanonicalScope } from "@bdp/protocol";
import {
  ORDINARY_OPERATIONS,
  type PrivateNavigation,
  RETAINED_SPEC,
} from "./retained-v01/contract.js";
import { startRetainedListener } from "./retained-v01/http.js";

export interface ReferenceServiceOptions {
  /** Absolute owned local directory; creation requires it to be empty. */
  readonly directory: string;
  readonly create: boolean;
  readonly instance: string;
  /** Fresh explicit batch-enabled format6; default preserves ordinary format5. */
  readonly atomicBatch?: boolean;
  /** Fresh explicit historical-update1 store; no implicit format migration.
   * This reference retains every version; pruning/erasure administration and
   * their qualification are outside this append-only composition. */
  readonly historicalUpdate?: boolean;
  /** Canonical externally routed Scope. The returned listener is loopback-only. */
  readonly scope: string;
  /** Full canonical-protocol source commit SHA; defaults to BDP_SPEC_REVISION. */
  readonly specRevision?: string;
  /** Every configured principal has complete Scope access; no partial disclosure model. */
  readonly credentials: readonly { readonly token: string; readonly principal: string }[];
}
export function referenceNavigation(scope: string): PrivateNavigation {
  const selected = parseCanonicalScope(scope);
  if (Buffer.byteLength(selected) > 4096)
    throw new TypeError("reference Scope URL exceeds its4096-byte configuration bound");
  const control = selected + "bdp";
  return Object.freeze({
    scope: selected,
    description: control,
    beads: control + "/beads",
    links: control + "/links",
    aliases: selected + "aliases/",
    events: control + "/events",
    operations: control + "/operations",
    targets: Object.freeze(
      Object.fromEntries(
        ORDINARY_OPERATIONS.map((operation) => [operation, control + "/operations/" + operation]),
      ) as Record<(typeof ORDINARY_OPERATIONS)[number], string>,
    ),
  });
}
/** No global installation, implicit provisioning, legacy admission or Type activation.
 * Route the explicit canonical Scope to listenUrl through the deployment's proxy.
 * Events/History/Types/projection remain unadvertised. Selected six-CRUD batch1
 * is advertised with finite bounds only for an explicitly batch-enabled store.
 */
export async function startReferenceService(options: ReferenceServiceOptions) {
  if (
    Object.keys(options).some(
      (name) =>
        ![
          "directory",
          "create",
          "instance",
          "scope",
          "specRevision",
          "credentials",
          "atomicBatch",
          "historicalUpdate",
        ].includes(name),
    ) ||
    (options.atomicBatch !== undefined && typeof options.atomicBatch !== "boolean") ||
    (options.historicalUpdate !== undefined && typeof options.historicalUpdate !== "boolean") ||
    (options.atomicBatch === true && options.historicalUpdate === true) ||
    !Array.isArray(options.credentials) ||
    options.credentials.some(
      (credential) =>
        credential === null ||
        typeof credential !== "object" ||
        typeof credential.token !== "string" ||
        typeof credential.principal !== "string" ||
        credential.principal.length === 0,
    )
  )
    throw new TypeError(
      "explicit reference configuration required; unknown options are unsupported",
    );
  const specRevision = options.specRevision ?? process.env.BDP_SPEC_REVISION;
  if (typeof specRevision !== "string" || !/^[0-9a-f]{40}$/.test(specRevision))
    throw new TypeError("a full lowercase BDP_SPEC_REVISION commit SHA is required");
  const navigation = referenceNavigation(options.scope);
  const listener = await startRetainedListener({
    directory: options.directory,
    create: options.create,
    instance: options.instance,
    credentials: options.credentials,
    navigation,
    specRevision,
    referenceCore: true,
    ...(options.atomicBatch === undefined ? {} : { atomicBatch: options.atomicBatch }),
    ...(options.historicalUpdate === undefined
      ? {}
      : { historicalUpdate: options.historicalUpdate }),
  });
  return Object.freeze({
    specification: RETAINED_SPEC,
    profile: "write" as const,
    scope: navigation.scope,
    navigation,
    listenUrl: listener.listenUrl,
    close: listener.close,
  });
}
