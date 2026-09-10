import type { AbsoluteHttpUrl } from "./index.js";
import {
  assertCanonicalPathSegments,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
} from "./read-values.js";
import {
  parseReadUpdateRequest,
  parseReadUpdateSequenceRequest,
  ReadUpdateCarrierError,
  type ReadUpdateOperation,
  type UnadmittedReadUpdateOperation,
} from "./read-update-values.js";

/** Carrier syntax and Scope canonicality only: no numeric admission, lookup,
 * alias resolution, authorization or key claim has occurred. Original S1
 * operation objects retain their private parser brands and lossless numbers.
 */
export interface PreparedReadUpdateCarrier {
  readonly kind: "singleton" | "sequence";
  readonly scope: AbsoluteHttpUrl;
  readonly operations: readonly UnadmittedReadUpdateOperation[];
  readonly keys: readonly string[];
}
const preparedCarriers = new WeakSet<object>();

/** Receiving authorities must check the runtime brand before durable admission. */
export function assertPreparedReadUpdateCarrier(
  value: unknown,
): asserts value is PreparedReadUpdateCarrier {
  if (typeof value !== "object" || value === null || !preparedCarriers.has(value))
    throw new TypeError("expected a Scope-preflighted Read+Update carrier");
}

/** The HTTP owner checks raw header multiplicity before supplying this exact key. */
export function prepareReadUpdateSingleton(
  scope: string,
  operation: ReadUpdateOperation,
  text: string,
  idempotencyKey: string,
): PreparedReadUpdateCarrier {
  const canonicalScope = parseCanonicalScope(scope);
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(idempotencyKey))
    throw new ReadUpdateCarrierError("invalid singleton idempotency key");
  return prepare(
    canonicalScope,
    "singleton",
    [parseReadUpdateRequest(operation, text)],
    [idempotencyKey],
  );
}

/** The HTTP owner rejects a sequence Idempotency-Key field before calling this. */
export function prepareReadUpdateSequence(scope: string, text: string): PreparedReadUpdateCarrier {
  const canonicalScope = parseCanonicalScope(scope);
  const { operations } = parseReadUpdateSequenceRequest(text);
  return prepare(
    canonicalScope,
    "sequence",
    operations,
    operations.map((operation) => {
      // The S1 sequence schema requires this field; do not invent a missing key.
      if (operation.idempotencyKey === undefined)
        throw new TypeError("parsed sequence member lacks its key");
      return operation.idempotencyKey;
    }),
  );
}

function prepare(
  scope: AbsoluteHttpUrl,
  kind: PreparedReadUpdateCarrier["kind"],
  operations: readonly UnadmittedReadUpdateOperation[],
  keys: readonly string[],
): PreparedReadUpdateCarrier {
  const base = new URL(scope);
  for (const operation of operations) preflightOperation(base, operation);
  const carrier = Object.freeze({
    kind,
    scope,
    operations: Object.freeze([...operations]),
    keys: Object.freeze([...keys]),
  });
  preparedCarriers.add(carrier);
  return carrier;
}

const REFERENCE_FIELDS: Readonly<Record<ReadUpdateOperation, readonly string[]>> = {
  createBead: ["id"],
  createLink: ["id", "source", "target"],
  updateBeadProperties: ["bead"],
  deleteBead: ["bead"],
  updateLinkProperties: ["link"],
  deleteLink: ["link"],
  putAlias: ["alias", "target"],
  deleteAlias: ["alias"],
};

function preflightOperation(scope: URL, { operation, input }: UnadmittedReadUpdateOperation): void {
  const fields = REFERENCE_FIELDS[operation];
  for (const field of fields) {
    const value = input[field];
    if (value === undefined) continue;
    const reference = typeof value === "string" ? value : (value as { readonly uri: string }).uri;
    if (reference.startsWith("@")) continue; // S1 already checked binding location/kind/order.
    const creationRoot =
      field === "id" ? (operation === "createBead" ? "beads" : "links") : undefined;
    try {
      if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)) {
        assertCanonicalPathSegments(reference, field);
        if (creationRoot !== undefined) assertCreationRoot(reference, creationRoot);
        continue;
      }
      // S1 has validated an absolute RFC URI. WHATWG URL is used only for
      // locality classification, not as an additional external-URI grammar.
      const parsed = URL.canParse(reference) ? new URL(reference) : undefined;
      const inScope = parsed !== undefined && isScopeCandidate(scope, parsed, reference);
      if (!inScope && creationRoot === undefined) continue; // External references remain byte-exact.
      if (!inScope || parsed === undefined)
        throw new Error("creation ID is outside the configured Scope");
      parseCanonicalHttpUrl(reference, field);
      if (parsed.search !== "" || !reference.startsWith(scope.href))
        throw new Error("in-Scope reference must use its canonical Scope spelling");
      const local = reference.slice(scope.href.length);
      assertCanonicalPathSegments(local, field);
      if (creationRoot !== undefined) assertCreationRoot(local, creationRoot);
    } catch (cause) {
      throw new ReadUpdateCarrierError(`malformed Scope-relative ${field} reference`, { cause });
    }
  }
}

function assertCreationRoot(local: string, root: string): void {
  if (!local.startsWith(`${root}/`) || local.length === root.length + 1)
    throw new Error("creation ID requires its Resource root and a nonempty ID path");
}

/** Classification is intentionally more permissive than acceptance, so URL
 * normalization cannot disguise malformed local input as an opaque endpoint.
 * It establishes no cross-authority equivalence: no DNS or trailing-dot folding.
 */
function isScopeCandidate(scope: URL, parsed: URL, original: string): boolean {
  if (parsed.origin !== scope.origin) return false;
  const baseSegments = scope.pathname.split("/").slice(1, -1).map(decodeURIComponent);
  // Preserve a raw prefix even when URL parsing removes later dot segments.
  const rawPath = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)?/.exec(original)?.[1];
  return [parsed.pathname, rawPath].some((path) => {
    if (path === undefined) return false;
    // Separators are recognized only for classification; strict acceptance
    // below still rejects encoded separators. Decode only the Scope prefix,
    // so a malformed escape later in the local suffix cannot hide that prefix.
    const segments = path.replace(/%2f|%5c|\\/gi, "/").split("/");
    if (segments.length < baseSegments.length + 2) return false;
    return baseSegments.every((segment, index) => {
      try {
        return decodeURIComponent(segments[index + 1] ?? "") === segment;
      } catch {
        return false;
      }
    });
  });
}
