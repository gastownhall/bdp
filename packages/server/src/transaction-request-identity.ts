/** Versioned private TX persistence commitments; the RU semantic value encoder
 * and its reference/default/number/order equivalence remain unchanged. */
import { createHash } from "node:crypto";
import { stringifyJsonValue } from "@bdp/protocol";
import { encodeSemanticValue, SEMANTIC_VALUE_FORMAT } from "./semantic-identity.js";

export const TRANSACTION_REQUEST_FINGERPRINT = "transaction-reference-leaves-sha256-1";
export const TRANSACTION_COMMITTED_WITNESSES = "transaction-alias-witnesses-sha256-1";
export const transactionReferenceCommitment = (uri: string): string =>
  createHash("sha256")
    .update("transaction-reference-leaf-sha256-1\0")
    .update(encodeSemanticValue(uri))
    .digest("hex");

type Node = unknown[];
function node(value: unknown, tag: string): Node {
  if (!Array.isArray(value) || value.length !== 2 || value[0] !== tag || !Array.isArray(value[1]))
    throw new Error("invalid retained normalized request structure");
  return value;
}
function members(value: unknown): [string, unknown][] {
  const entries = node(value, "object")[1] as unknown[];
  if (
    entries.some(
      (entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string",
    )
  )
    throw new Error("invalid normalized request object");
  return entries as [string, unknown][];
}

/** Commit only the six reference fields already normalized by TX. Property
 * strings that look like References are never inspected or rewritten. Historical
 * witness commitments substitute at those exact private sites only. */
export function storedTransactionFingerprint(
  identity: string,
  overrides: ReadonlyMap<string, string> = new Map(),
): string {
  const parsed: unknown = JSON.parse(identity);
  if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== SEMANTIC_VALUE_FORMAT)
    throw new Error("unknown retained semantic value format");
  const operations = node(parsed[1], "array")[1] as unknown[];
  if (operations.length < 1 || operations.length > 32)
    throw new Error("invalid normalized operation count");
  const consumed = new Set<string>();
  for (const [index, operation] of operations.entries()) {
    const input = members(operation).find(([key]) => key === "input");
    if (!input) throw new Error("normalized operation lacks input");
    for (const entry of members(input[1])) {
      const [field, value] = entry;
      if (!["id", "source", "target", "bead", "link", "alias"].includes(field)) continue;
      const key = `${index}/${field}`,
        committed = overrides.get(key);
      if (committed !== undefined && !/^[a-f0-9]{64}$/.test(committed))
        throw new Error("invalid reference commitment");
      const replace = (encoded: unknown): unknown => {
        if (
          !Array.isArray(encoded) ||
          encoded.length !== 2 ||
          encoded[0] !== "string" ||
          typeof encoded[1] !== "string"
        )
          throw new Error("normalized Reference URI must be a string");
        if (committed !== undefined) consumed.add(key);
        return ["reference-sha256", committed ?? transactionReferenceCommitment(encoded[1])];
      };
      if (Array.isArray(value) && value[0] === "string") entry[1] = replace(value);
      else if (Array.isArray(value) && value.length === 1 && value[0] === "unbound") {
        if (committed !== undefined)
          throw new Error("commitment cannot replace an unbound Reference");
      } else {
        const fields = members(value);
        const uri = fields.find(([name]) => name === "uri");
        if (uri) uri[1] = replace(uri[1]);
        else if (committed !== undefined) throw new Error("commitment lacks normalized URI site");
        // Symbolic creators and unresolved aliases keep their original typed
        // shape. They cannot equal a resolved Reference merely by string spelling.
      }
    }
  }
  if (consumed.size !== overrides.size) throw new Error("unused historical reference commitment");
  return `${TRANSACTION_REQUEST_FINGERPRINT}:${createHash("sha256")
    .update(stringifyJsonValue([TRANSACTION_REQUEST_FINGERPRINT, parsed]))
    .digest("hex")}`;
}
