import type { AbsoluteHttpUrl, BeadRecord, LinkRecord } from "@bdp/protocol";
import {
  isHttpScopeCandidate,
  ProtocolArtifactValidationError,
  parseCanonicalHttpUrl,
  referenceUri,
  resolveCanonicalLocalResourceId,
} from "@bdp/protocol";
import {
  localRefusal,
  ReadSessionCapabilityError,
  type ReadSessionRefusal,
} from "./continuations.js";

export function resourceUrl(
  scope: AbsoluteHttpUrl,
  candidate: AbsoluteHttpUrl,
  resource: "bead" | "link" | "type",
  externalTypeDescriptorIds: ReadonlySet<string> = new Set<string>(),
): AbsoluteHttpUrl | ReadSessionRefusal {
  let parsed: AbsoluteHttpUrl;
  try {
    parsed = parseCanonicalHttpUrl(candidate, `${resource} Resource URL`);
  } catch {
    return localRefusal("invalid-parameter", `the requested ${resource} URL is invalid`);
  }
  if (resource === "type") {
    const typeUrl = new URL(parsed);
    if (!isWithinScope(scope, typeUrl) && !externalTypeDescriptorIds.has(parsed))
      throw new ReadSessionCapabilityError(
        "external Type Descriptor retrieval requires a configured safe-fetch policy",
      );
    return parsed;
  }
  const confined = confinedUrl(scope, candidate);
  if (typeof confined !== "string") return confined;
  try {
    const localId = parsed.slice(scope.length);
    if (resolveCanonicalLocalResourceId(scope, resource, localId) !== parsed)
      throw new Error("Resource identity did not resolve canonically");
  } catch {
    return localRefusal(
      "invalid-parameter",
      `the requested URL is not a canonical ${resource} Resource ID`,
    );
  }
  return confined;
}

export function isWithinScope(scope: AbsoluteHttpUrl, candidate: URL): boolean {
  const root = new URL(scope);
  return candidate.origin === root.origin && candidate.pathname.startsWith(root.pathname);
}

export class ReadResponseValidationError extends Error {}

export function validateBeadSingleton(
  record: BeadRecord,
  requestedId: AbsoluteHttpUrl,
  scope: AbsoluteHttpUrl,
): BeadRecord {
  if (record.id !== requestedId) throw new ReadResponseValidationError("wrong Bead ID");
  return validateBeadRecord(record, scope);
}

export function validateLinkSingleton(
  record: LinkRecord,
  requestedId: AbsoluteHttpUrl,
  scope: AbsoluteHttpUrl,
): LinkRecord {
  if (record.id !== requestedId) throw new ReadResponseValidationError("wrong Link ID");
  return validateLinkRecord(record, scope);
}

export function validateBeadRecord(record: BeadRecord, scope: AbsoluteHttpUrl): BeadRecord {
  if (typeof resourceUrl(scope, record.id, "bead") !== "string")
    throw new ReadResponseValidationError("invalid Bead ID");
  if (record.links !== undefined)
    throw new ReadResponseValidationError("unexpected embedded Links");
  for (const links of Object.values(record.ownedLinks ?? {}))
    for (const link of links) validateLinkRecord(link, scope);
  return record;
}

export function validateLinkRecord(record: LinkRecord, scope: AbsoluteHttpUrl): LinkRecord {
  if (typeof resourceUrl(scope, record.id, "link") !== "string")
    throw new ReadResponseValidationError("invalid Link ID");
  const sourceInScope = validateEndpoint(record.source, scope);
  const targetInScope = validateEndpoint(record.target, scope);
  if (!sourceInScope && !targetInScope)
    throw new ReadResponseValidationError("a Link must have an in-Scope endpoint");
  return record;
}

function validateEndpoint(endpoint: LinkRecord["source"], scope: AbsoluteHttpUrl): boolean {
  // In-Scope or external is derived, never declared: an endpoint URI that is
  // (an alias of) this Scope claims an in-Scope Bead and must be canonical;
  // every other URI is an opaque external reference.
  const uri = referenceUri(endpoint);
  let claimsScope = false;
  try {
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri)?.[1]?.toLowerCase();
    const normalized = scheme === "http" || scheme === "https" ? new URL(uri) : undefined;
    claimsScope = normalized !== undefined && isHttpScopeCandidate(new URL(scope), normalized, uri);
  } catch {
    // Schema validation already proved this is an absolute URI. Some opaque URI
    // spellings are deliberately outside WHATWG URL representation.
  }
  if (!claimsScope) return false;
  let canonicalEndpoint: AbsoluteHttpUrl;
  try {
    canonicalEndpoint = parseCanonicalHttpUrl(uri, "Link endpoint ID");
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError)
      throw new ReadResponseValidationError("in-Scope endpoint is not canonical");
    throw error;
  }
  const localId = canonicalEndpoint.slice(scope.length);
  let resolvedEndpoint: AbsoluteHttpUrl;
  try {
    resolvedEndpoint = resolveCanonicalLocalResourceId(scope, "bead", localId);
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError)
      throw new ReadResponseValidationError("endpoint is not a canonical in-Scope Bead ID");
    throw error;
  }
  if (resolvedEndpoint !== canonicalEndpoint)
    throw new ReadResponseValidationError("endpoint is not a canonical in-Scope Bead ID");
  return true;
}

export function confinedUrl(
  scope: AbsoluteHttpUrl,
  candidate: AbsoluteHttpUrl,
): AbsoluteHttpUrl | ReadSessionRefusal {
  try {
    const expected = new URL(scope);
    const actual = new URL(candidate);
    const prefix = expected.pathname.endsWith("/") ? expected.pathname : `${expected.pathname}/`;
    if (
      actual.origin !== expected.origin ||
      !actual.pathname.startsWith(prefix) ||
      actual.username !== "" ||
      actual.password !== "" ||
      actual.hash !== ""
    )
      return localRefusal("forbidden", "the requested URL is outside the configured Scope");
    parseCanonicalHttpUrl(candidate, "Scoped URL");
    return actual.href;
  } catch {
    return localRefusal("invalid-parameter", "the requested URL is invalid");
  }
}
