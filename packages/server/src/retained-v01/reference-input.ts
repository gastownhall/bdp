/** Private lexical Reference admission. No store lookup or alias resolution. */
import { isJsonSchemaUri } from "@bdp/protocol";
import { canonicalLocalReference, RetainedRequestError } from "./contract.js";

export function inputReferenceUri(scope: string, value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return canonicalLocalReference(scope, value);
  if (!isJsonSchemaUri(value)) throw new RetainedRequestError("malformed-request", 400);
  if (/^https?:\/\//i.test(value)) {
    // Preserve canonical authority binding while normalizing local path segments.
    if (new URL(value).href.startsWith(scope)) return canonicalLocalReference(scope, value);
    return value;
  }
  // RFC3986: a colon in the first segment selects an absolute URI. It is
  // opaque external data; address a local colon ID with its full Scope URL.
  return value;
}
