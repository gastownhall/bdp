/** Private lexical Reference admission. No store lookup or alias resolution. */
import { isJsonSchemaUri } from "@bdp/protocol";
import {
  canonicalCreatedId,
  canonicalLocalReference,
  RetainedFixtureGap,
  RetainedRequestError,
} from "./contract.js";

export function inputReferenceUri(scope: string, value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return canonicalLocalReference(scope, value);
  if (!isJsonSchemaUri(value)) throw new RetainedRequestError("malformed-request", 400);
  if (/^https?:\/\//i.test(value)) {
    // Preserve canonical authority binding while normalizing local path segments.
    if (new URL(value).href.startsWith(scope)) return canonicalLocalReference(scope, value);
    return value;
  }
  let local = false;
  try {
    canonicalCreatedId(scope, value);
    local = true;
  } catch {
    /* Not a local path. */
  }
  if (local)
    throw new RetainedFixtureGap(
      "absolute-URI/local-path overlap awaits paired-source clarification",
    );
  return value;
}
