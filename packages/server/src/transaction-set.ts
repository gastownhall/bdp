/** Private valid-set core. This is not a transport parser or admission policy. */
import {
  JsonNumberLiteral,
  prepareReadUpdateSingleton,
  type LosslessJsonValue,
} from "@bdp/protocol";
import { ReadSelectorError, selectReadResources } from "./read-selector.js";

export class TransactionDevelopmentLimitError extends Error {}
export type TransactionSetOperation = "updateWhere" | "deleteWhere";
export interface PreparedTransactionSet {
  readonly operation: TransactionSetOperation;
  readonly input: Readonly<Record<string, LosslessJsonValue>>;
  readonly name?: never;
}
export const TRANSACTION_SELECTOR_LIMITS = Object.freeze({ bytes: 4096, depth: 32, nodes: 256 });
/** Serialize already decoded, byte-bounded syntax without prematurely applying
 * the executable depth limit. Preserve original numeric lexemes and key order. */
export function transactionInputText(value: LosslessJsonValue): string {
  const pending: (string | { value: LosslessJsonValue })[] = [{ value }];
  const chunks: string[] = [];
  while (pending.length) {
    const task = pending.pop()!;
    if (typeof task === "string") {
      chunks.push(task);
      continue;
    }
    const item = task.value;
    if (item instanceof JsonNumberLiteral) chunks.push(item.literal);
    else if (Array.isArray(item)) {
      chunks.push("[");
      pending.push("]");
      for (let i = item.length - 1; i >= 0; i--) {
        pending.push({ value: item[i]! });
        if (i > 0) pending.push(",");
      }
    } else if (item && typeof item === "object") {
      chunks.push("{");
      pending.push("}");
      const entries = Object.entries(item);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [key, child] = entries[i]!;
        pending.push({ value: child }, ":", JSON.stringify(key));
        if (i > 0) pending.push(",");
      }
    } else chunks.push(JSON.stringify(item));
  }
  return chunks.join("");
}
/** Private execution capacity only, after complete known carrier syntax. The
 * depth convention is unchanged: the batch root is 0, singleton input is 2. */
export function assertTransactionInputDepth(value: LosslessJsonValue, depth = 0): void {
  const pending = [{ value, depth }];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.depth > 32)
      throw new TransactionDevelopmentLimitError("development batch depth limit");
    if (item.value && typeof item.value === "object" && !(item.value instanceof JsonNumberLiteral))
      for (const child of Object.values(item.value))
        pending.push({ value: child, depth: item.depth + 1 });
  }
}
function nonnegativeInteger(value: LosslessJsonValue): boolean {
  if (!(value instanceof JsonNumberLiteral)) return false;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.literal);
  if (!match) return false;
  const digits = `${match[2]}${match[3] ?? ""}`;
  if (/^0+$/.test(digits)) return true;
  if (match[1]) return false;
  const trailing = digits.length - digits.replace(/0+$/, "").length;
  return BigInt(match[4] ?? "0") - BigInt((match[3] ?? "").length) + BigInt(trailing) >= 0n;
}
export function prepareSetShape(
  scope: string,
  operation: TransactionSetOperation,
  input: Readonly<Record<string, LosslessJsonValue>>,
): PreparedTransactionSet {
  const fields = ["collection", "selector", "cardinality", "revisionProvenance"];
  if (operation === "updateWhere") fields.push("change");
  if (
    Object.keys(input).some((key) => !fields.includes(key)) ||
    (input.collection !== "beads" && input.collection !== "links") ||
    typeof input.selector !== "string" ||
    !input.selector ||
    (operation === "updateWhere" && input.change === undefined)
  )
    throw new TypeError("invalid private set shape");
  const cardinality = input.cardinality;
  if (cardinality !== undefined) {
    if (
      !cardinality ||
      typeof cardinality !== "object" ||
      Array.isArray(cardinality) ||
      cardinality instanceof JsonNumberLiteral ||
      Object.keys(cardinality).length === 0 ||
      Object.entries(cardinality).some(
        ([key, value]) => !["min", "max"].includes(key) || !nonnegativeInteger(value),
      )
    )
      throw new TypeError("invalid private set cardinality");
  }
  // Only syntax is reused. The placeholder is never resolved, admitted, executed,
  // normalized into a key, persisted or returned in a diagnostic.
  // DeleteWhere accepts provenance for either collection. The deleteLink
  // syntax root validates that exact shared provenance input even when the
  // selected collection is Beads; deleteBead itself accepts no provenance.
  // This synthetic Resource kind affects syntax validation only.
  const syntaxOperation =
    operation === "deleteWhere"
      ? "deleteLink"
      : input.collection === "beads"
        ? "updateBead"
        : "updateLink";
  prepareReadUpdateSingleton(
    scope,
    syntaxOperation,
    transactionInputText({
      ...(syntaxOperation === "updateBead"
        ? { bead: "beads/__set_syntax_only__" }
        : { link: "links/__set_syntax_only__" }),
      ...(operation === "updateWhere"
        ? { propertiesChange: input.change as LosslessJsonValue }
        : {}),
      ...(input.revisionProvenance === undefined
        ? {}
        : { revisionProvenance: input.revisionProvenance }),
    }),
    "internal-set-syntax",
  );
  return Object.freeze({ operation, input });
}
/** Candidate-independent supported-subset check, after all carrier shape checks. */
export function validateSetSelector(prepared: PreparedTransactionSet): void {
  try {
    selectReadResources(prepared.input.selector as string, TRANSACTION_SELECTOR_LIMITS, []);
  } catch (error) {
    if (error instanceof ReadSelectorError)
      throw new TransactionDevelopmentLimitError(
        "set Selector refusal/admission policy remains outside the valid-set core",
        { cause: error },
      );
    throw error;
  }
}
