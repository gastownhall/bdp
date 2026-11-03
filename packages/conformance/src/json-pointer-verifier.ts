import type { JsonValue } from "./executable-manifest.js";

// Internal evaluator shared with expectation-only verifier controls. No transport,
// session, fixture lookup, capture binding, or normalization happens here.
export function literalJsonPointerMatches(
  body: unknown,
  assertion: { readonly pointer: string; readonly exists: boolean; readonly equals?: JsonValue },
): boolean {
  const value = jsonPointer(body, assertion.pointer);
  const exists = value !== undefined;
  return assertion.exists
    ? exists && (assertion.equals === undefined || deepEqual(value, assertion.equals))
    : !exists;
}

export function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  let current: unknown = value;
  for (const part of pointer.slice(1).split("/")) {
    if (typeof current !== "object" || current === null) return undefined;
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(key)) return undefined;
      current = current[Number(key)];
    } else {
      if (!Object.hasOwn(current, key)) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
    );
  if (typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left as object).sort();
    const rightKeys = Object.keys(right as object).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          deepEqual(
            (left as Record<string, unknown>)[key],
            (right as Record<string, unknown>)[key],
          ),
      )
    );
  }
  return false;
}
