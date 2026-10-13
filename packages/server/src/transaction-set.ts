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
export function transactionInputText(value: LosslessJsonValue, depth = 0): string {
  if (depth > 32) throw new TransactionDevelopmentLimitError("development batch depth limit");
  if (value instanceof JsonNumberLiteral) return value.literal;
  if (Array.isArray(value))
    return `[${value.map((v) => transactionInputText(v, depth + 1)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}:${transactionInputText(v, depth + 1)}`)
      .join(",")}}`;
  return JSON.stringify(value);
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
