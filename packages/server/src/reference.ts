/** Explicit Core + ordinary Write reference composition for the canonical draft. */
import { parseCanonicalScope } from "@bdp/protocol";
import {
  ORDINARY_OPERATIONS,
  type PrivateNavigation,
  RETAINED_SPEC,
} from "./retained-v01/contract.js";
import type { CallablesComposition } from "./retained-v01/callables-service.js";
import { startRetainedListener } from "./retained-v01/http.js";
import { issueConformsTo, issueScopePolicy } from "./retained-v01/issue-policy.js";
import { callablesScopePolicy, composePolicies } from "./retained-v01/callables-service.js";

export type {
  CallableAnswer,
  CallableEffects,
  CallableImplementation,
  CallableInvocationContext,
  EffectOutcome,
} from "./retained-v01/callables.js";
export type { CallablesComposition, ProvidedCallable } from "./retained-v01/callables-service.js";

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
  /** Fresh explicit format8: advertises Callables1 and serves these declarations. */
  readonly callables?: CallablesComposition;
  /** Enforce the Issue and Dependency Types package as native Scope policy (Issue §1). */
  readonly issuePackage?: boolean;
  /** Canonical externally routed Scope. The returned listener is loopback-only. */
  readonly scope: string;
  /** Full canonical-protocol source commit SHA; defaults to BDP_SPEC_REVISION. */
  readonly specRevision?: string;
  /** Every configured principal has complete Scope access; no partial disclosure model. */
  readonly credentials: readonly { readonly token: string; readonly principal: string }[];
  /** Defaults to required; disabled assigns one local anonymous test principal. */
  readonly authentication?: "required" | "disabled";
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
          "authentication",
          "atomicBatch",
          "historicalUpdate",
          "callables",
          "issuePackage",
        ].includes(name),
    ) ||
    (options.atomicBatch !== undefined && typeof options.atomicBatch !== "boolean") ||
    (options.historicalUpdate !== undefined && typeof options.historicalUpdate !== "boolean") ||
    (options.atomicBatch === true && options.historicalUpdate === true) ||
    (options.issuePackage !== undefined && typeof options.issuePackage !== "boolean") ||
    (options.issuePackage === true &&
      (options.atomicBatch === true || options.historicalUpdate === true)) ||
    (options.callables !== undefined &&
      (options.atomicBatch === true || options.historicalUpdate === true)) ||
    (options.authentication !== undefined &&
      options.authentication !== "required" &&
      options.authentication !== "disabled") ||
    !Array.isArray(options.credentials) ||
    ((options.authentication ?? "required") === "required" && options.credentials.length === 0) ||
    ((options.authentication ?? "required") === "disabled" && options.credentials.length !== 0) ||
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
  const policy = composePolicies([
    ...(options.callables === undefined ? [] : [callablesScopePolicy(navigation.scope)]),
    ...(options.issuePackage === true ? [issueScopePolicy(navigation.scope)] : []),
  ]);
  const listener = await startRetainedListener({
    directory: options.directory,
    create: options.create,
    instance: options.instance,
    credentials: options.credentials,
    authentication: options.authentication ?? "required",
    navigation,
    specRevision,
    referenceCore: true,
    ...(options.callables === undefined
      ? {}
      : { callables: true, callableComposition: options.callables }),
    ...(policy === undefined ? {} : { policy }),
    ...(options.issuePackage === true ? { conformsTo: issueConformsTo } : {}),
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
