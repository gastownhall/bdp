/** Private shared Resource numeric diagnostic formatting; no store or clock. */
import type { JsonNumberDiagnosticBudget, ReadUpdateOperation } from "@bdp/protocol";

export function memberNumericDiagnosticBudget(
  operation: ReadUpdateOperation,
  budget: JsonNumberDiagnosticBudget,
): JsonNumberDiagnosticBudget {
  // S1's occurrences are operation-relative; create diagnostics name either
  // Resource object. Locations in each object's validation are relative to it.
  // Unapplied updates omit a location in either document: the operation input
  // pointer need not identify a resulting instance (for example array append).
  let selectedBudget = budget;
  if (operation === "createBead" || operation === "createLink") {
    const { diagnostics, diagnosticBytes, diagnostic } = budget;
    selectedBudget = Object.freeze({
      ...(diagnostics !== undefined ? { diagnostics } : {}),
      ...(diagnosticBytes !== undefined ? { diagnosticBytes } : {}),
      diagnostic: (occurrence: Parameters<JsonNumberDiagnosticBudget["diagnostic"]>[0]) => {
        const object = ["properties", "metadata"].find((name) =>
          occurrence.pointer.startsWith(`/${name}/`),
        );
        if (!object)
          throw new TypeError("unexpected numeric position in admitted create operation");
        // Numeric admission precedes Type validation. Even an embedder callback
        // cannot turn this refusal into a failed Type-schema keyword.
        const { message } = diagnostic(occurrence);
        return Object.freeze({
          message: object === "metadata" ? `metadata: ${message}` : message,
          ...(object === "metadata" ? { document: "metadata" as const } : {}),
          instanceLocation: occurrence.pointer.slice(object.length + 1),
        });
      },
    });
  }
  if (operation === "updateBead" || operation === "updateLink") {
    const { diagnostics, diagnosticBytes, diagnostic } = budget;
    selectedBudget = Object.freeze({
      ...(diagnostics !== undefined ? { diagnostics } : {}),
      ...(diagnosticBytes !== undefined ? { diagnosticBytes } : {}),
      diagnostic: (occurrence: Parameters<JsonNumberDiagnosticBudget["diagnostic"]>[0]) => {
        const formatted = diagnostic(occurrence);
        if (!occurrence.pointer.startsWith("/metadataChange/")) {
          // Neither a Type keyword nor a resulting document was evaluated.
          return Object.freeze({ message: formatted.message });
        }
        // The patch has not been applied. An input value location (especially
        // an array append) need not identify a position in the resulting document.
        return Object.freeze({
          message: `metadata: ${formatted.message}`,
          document: "metadata" as const,
        });
      },
    });
  }
  return selectedBudget;
}
