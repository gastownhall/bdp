/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) serialization.
 *
 * One implementation serves every digest this package binds — the cohort
 * artifact's committed bytes and the Read schema projection — because two
 * serializers that could drift would be two definitions of "the same bytes".
 *
 * JCS is exactly what ECMAScript `JSON.stringify` produces for scalars: ES
 * number formatting, `\"` and `\\`, the short control escapes with lowercase
 * `\u00xx` for the remaining control characters, and non-ASCII emitted as is.
 * On top of that, object members are ordered by UTF-16 code units and no
 * insignificant whitespace is emitted. Non-finite numbers have no JSON
 * spelling and are refused rather than degraded to `null`; `undefined`
 * members are omitted exactly as `JSON.stringify` omits them.
 */
export class CanonicalJsonError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "CanonicalJsonError";
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError("canonical JSON numbers must be finite");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new CanonicalJsonError(`canonical JSON cannot serialize ${typeof value}`);
}

/** Order strings by UTF-16 code units, the member order RFC 8785 requires. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
