import assert from "node:assert/strict";
import type { ScenarioAssertion } from "./executable-manifest.js";

const literalFields = new Set(["id", "kind", "pointer", "exists", "equals"]);

// A whitelist fails closed if the authored assertion grows a new modifier.
// Use the same predicate for runner delegation and observation-reuse custody.
export function isLiteralJsonPointerAssertion(assertion: ScenarioAssertion): boolean {
  return (
    assertion.kind === "json-pointer" &&
    Reflect.ownKeys(assertion).every((key) => typeof key === "string" && literalFields.has(key)) &&
    ["id", "kind", "pointer", "exists"].every((key) => Object.hasOwn(assertion, key)) &&
    typeof assertion.id === "string" &&
    typeof assertion.pointer === "string" &&
    (assertion.pointer === "" || assertion.pointer.startsWith("/")) &&
    !/~(?![01])/.test(assertion.pointer) &&
    typeof assertion.exists === "boolean"
  );
}

// Internal evaluator shared with expectation-only verifier controls. No transport,
// session, fixture lookup, capture binding, or normalization happens here.
export function literalJsonPointerMatches(body: unknown, assertion: ScenarioAssertion): boolean {
  assert(
    assertion.kind === "json-pointer" && isLiteralJsonPointerAssertion(assertion),
    "Literal JSON pointer assertion required",
  );
  const value = jsonPointer(body, assertion.pointer);
  const exists = value !== undefined;
  return assertion.exists
    ? exists && (assertion.equals === undefined || deepEqual(value, assertion.equals))
    : !exists;
}

export function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/") || /~(?![01])/.test(pointer)) return undefined;
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
