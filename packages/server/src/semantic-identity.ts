import { JsonNumberLiteral, isUnicodeScalarString } from "@bdp/protocol";

/** Internal sentinel only: no JSON value can manufacture this identity. */
export const UNBOUND_SEMANTIC_REFERENCE = Symbol("unbound semantic reference");

/** S4 supplies a normalized record built from S1 lossless values. Defaults and
 * semantic reference substitutions are explicit caller work, before encoding.
 * Strings in properties (including URI/@ spellings) are never interpreted here.
 * JS numbers are deliberately excluded: their source precision may already be lost.
 */
export type SemanticValue =
  | null
  | boolean
  | string
  | JsonNumberLiteral
  | typeof UNBOUND_SEMANTIC_REFERENCE
  | readonly SemanticValue[]
  | { readonly [key: string]: SemanticValue };

/** Internal durable format, not wire JSON/JCS or a public request-hash algorithm.
 * Persisted identities must retain this version; changing it needs an explicit
 * compatibility/migration decision. S6 hashes these exact returned UTF-8 bytes.
 */
const format = "ru-semantic-value-1";
const numberPattern = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/;

function exactNumber(literal: string): readonly [string, string] {
  const match = numberPattern.exec(literal);
  if (!match || match[0] !== literal)
    throw new TypeError("semantic number must be a JSON number literal");
  const fraction = match[3] ?? "";
  const digits = `${match[2]}${fraction}`.replace(/^0+/, "");
  if (!digits) return ["0", "0"];
  let trailing = 0;
  while (digits.charCodeAt(digits.length - trailing - 1) === 48) trailing++;
  const coefficient = `${match[1]}${digits.slice(0, digits.length - trailing)}`;
  // BigInt represents the exponent's digits, never 10**exponent or an expanded
  // mantissa. Allocation depends on input length, not the represented magnitude.
  const exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length) + BigInt(trailing);
  return [coefficient, exponent.toString()];
}

function string(value: string): string {
  if (!isUnicodeScalarString(value)) throw new TypeError("semantic strings must be scalar Unicode");
  return JSON.stringify(value);
}

type Work =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "leave"; readonly value: object };

/** Deterministic exact JSON-value equality encoding, including refused numeric
 * literals. Objects are unordered, arrays ordered, and every node is tagged so
 * user objects/arrays cannot collide with number or private-unbound nodes.
 * Input must be acyclic plain data with scalar strings. No hidden nesting limit;
 * traversal and output serialization are iterative. Caller owns input byte limits.
 */
export function encodeSemanticValue(value: SemanticValue): string {
  const output = [`[${JSON.stringify(format)},`];
  const pending: Work[] = [{ kind: "value", value }];
  const ancestors = new WeakSet<object>();
  while (pending.length) {
    const work = pending.pop();
    if (!work) break;
    if (work.kind === "text") {
      output.push(work.text);
      continue;
    }
    if (work.kind === "leave") {
      ancestors.delete(work.value);
      continue;
    }
    const current = work.value;
    if (current === null) output.push('["null"]');
    else if (current === UNBOUND_SEMANTIC_REFERENCE) output.push('["unbound"]');
    else if (typeof current === "boolean") output.push(`["boolean",${current}]`);
    else if (typeof current === "string") output.push(`["string",${string(current)}]`);
    else if (current instanceof JsonNumberLiteral) {
      // Inspect data, not a getter on a forged/subclassed literal node.
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const literal = descriptors.literal;
      if (
        Object.getPrototypeOf(current) !== JsonNumberLiteral.prototype ||
        Reflect.ownKeys(descriptors).length !== 1 ||
        !literal ||
        !("value" in literal) ||
        typeof literal.value !== "string"
      )
        throw new TypeError("semantic numeric node must contain only literal data");
      const [coefficient, exponent] = exactNumber(literal.value);
      output.push(`["number",${JSON.stringify(coefficient)},${JSON.stringify(exponent)}]`);
    } else if (typeof current === "object") {
      if (ancestors.has(current)) throw new TypeError("semantic values must be acyclic");
      const array = Array.isArray(current);
      const prototype = Object.getPrototypeOf(current);
      if (!array && prototype !== null && prototype !== Object.prototype)
        throw new TypeError("semantic objects must be plain data");
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const keys = Reflect.ownKeys(descriptors);
      for (const key of keys) {
        const descriptor = descriptors[key as string];
        if (
          typeof key !== "string" ||
          !descriptor ||
          !("value" in descriptor) ||
          (!descriptor.enumerable && !(array && key === "length"))
        )
          throw new TypeError("semantic containers must contain enumerable string-keyed data");
      }
      ancestors.add(current);
      pending.push({ kind: "leave", value: current });
      pending.push({ kind: "text", text: "]]" });
      if (array) {
        const length = descriptors.length?.value as number;
        if (keys.length !== length + 1)
          throw new TypeError("semantic arrays must be dense without extra fields");
        output.push('["array",[');
        for (let index = length - 1; index >= 0; index--) {
          const descriptor = descriptors[String(index)];
          if (!descriptor)
            throw new TypeError("semantic arrays must be dense without extra fields");
          pending.push({ kind: "value", value: descriptor.value });
          if (index) pending.push({ kind: "text", text: "," });
        }
      } else {
        const names = (keys as string[]).sort(); // Deterministic UTF-16 code-unit ordering.
        output.push('["object",[');
        for (let index = names.length - 1; index >= 0; index--) {
          const name = names[index] as string;
          pending.push({ kind: "text", text: "]" });
          pending.push({ kind: "value", value: descriptors[name]?.value });
          pending.push({ kind: "text", text: `[${string(name)},` });
          if (index) pending.push({ kind: "text", text: "," });
        }
      }
    } else
      throw new TypeError(
        "semantic values require lossless JSON data, not native numbers or other runtime values",
      );
  }
  output.push("]");
  return output.join("");
}
