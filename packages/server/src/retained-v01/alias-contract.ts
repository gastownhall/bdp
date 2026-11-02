/** Private alias carrier and namespace checks. No storage or profile admission. */
import { decodeJsonDocument, parseCanonicalScope } from "@bdp/protocol";
import { encodeSemanticValue } from "../semantic-identity.js";
import {
  canonicalCreatedId,
  closed,
  nonempty,
  record,
  RETAINED_MEDIA,
  RETAINED_SPEC,
  RetainedFixtureGap,
  RetainedRequestError,
} from "./contract.js";
import { inputReferenceUri } from "./reference-input.js";
import { captureReferenceComparison } from "./reference-comparison.js";

export type AliasOperation = "putAlias" | "deleteAlias";
/** Captured authority namespace; complete operands still resolve against scope. */
export function captureAliasNamespace(scope: string, base: string) {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (
    parseCanonicalScope(scope) !== scope ||
    !base.startsWith(scope) ||
    parseCanonicalScope(prefix) !== prefix
  )
    throw new TypeError("canonical in-Scope alias base required");
  return Object.freeze({
    contains(uri: string): boolean {
      if (!uri.startsWith(prefix)) return false;
      try {
        return canonicalCreatedId(scope, uri) === uri;
      } catch {
        return false;
      }
    },
  });
}
interface AliasInvocation {
  readonly scope: string;
  readonly key: string;
  readonly identity: string;
  readonly alias: string;
}
export type PreparedAlias = AliasInvocation &
  (
    | { readonly operation: "putAlias"; readonly target: string }
    | { readonly operation: "deleteAlias"; readonly target?: never }
  );
const preparedAliases = new WeakSet<PreparedAlias>();
export function assertPreparedAlias(
  scope: string,
  operation: AliasOperation,
  input: PreparedAlias,
): void {
  if (!preparedAliases.has(input) || input.scope !== scope || input.operation !== operation)
    throw new TypeError("foreign or forged prepared alias invocation");
}

export function prepareAlias(
  scope: string,
  operation: AliasOperation,
  text: string,
  key: string,
): PreparedAlias {
  if (parseCanonicalScope(scope) !== scope)
    throw new TypeError("canonical captured Scope required");
  if (operation !== "putAlias" && operation !== "deleteAlias")
    throw new TypeError("unknown alias operation");
  if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(key))
    throw new RetainedRequestError("malformed-request", 400);
  let alias: string;
  let target: string | undefined;
  try {
    const input = record(decodeJsonDocument(text));
    closed(input, operation === "putAlias" ? ["alias", "target"] : ["alias"]);
    nonempty(input.alias);
    alias = inputReferenceUri(scope, input.alias);
    if (operation === "putAlias") {
      nonempty(input.target);
      target = inputReferenceUri(scope, input.target);
    }
  } catch (error) {
    if (error instanceof RetainedRequestError || error instanceof RetainedFixtureGap) throw error;
    throw new RetainedRequestError("malformed-request", 400);
  }
  // Namespace, historical collisions, actual target kind/liveness, and permissions
  // are decision-time checks after retained-key comparison, never carrier lookups.
  const normalized: Readonly<Record<string, string>> =
    operation === "putAlias" ? { alias, target: target as string } : { alias };
  const identity = encodeSemanticValue({
    format: "retained-v01-alias-1",
    specification: RETAINED_SPEC,
    media: RETAINED_MEDIA,
    capabilities: {},
    operation,
    input: normalized,
  });
  const common = { scope, key, identity, alias };
  const prepared: PreparedAlias = Object.freeze(
    operation === "putAlias"
      ? { ...common, operation, target: target as string }
      : { ...common, operation },
  );
  preparedAliases.add(prepared);
  captureReferenceComparison(prepared, {}, () => prepared.identity);
  return prepared;
}
