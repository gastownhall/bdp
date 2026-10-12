/** Private shared Resource numeric diagnostic formatting; no store or clock. */
import type { JsonNumberDiagnosticBudget, ReadUpdateOperation } from "@bdp/protocol";

export function memberNumericDiagnosticBudget(
  operation: ReadUpdateOperation,
  budget: JsonNumberDiagnosticBudget,
): JsonNumberDiagnosticBudget {
  // S1's occurrences are operation-relative; create diagnostics name either
  // Resource object. Locations in each object's validation are relative to it.
  // Property update formatting retains its existing caller convention; metadata
  // updates identify the document without inventing an unapplied target. No I/O.
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
        const { message, type, schemaLocation } = diagnostic(occurrence);
        return Object.freeze({
          message: object === "metadata" ? `metadata: ${message}` : message,
          ...(object === "metadata" ? { document: "metadata" as const } : {}),
          ...(object === "properties" && type !== undefined ? { type } : {}),
          ...(object === "properties" && schemaLocation !== undefined ? { schemaLocation } : {}),
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
          // The caller still owns property update locations, but cannot relabel
          // a properties value as a metadata diagnostic.
          const { message, type, schemaLocation, instanceLocation } = formatted;
          return {
            message,
            ...(type !== undefined ? { type } : {}),
            ...(schemaLocation !== undefined ? { schemaLocation } : {}),
            ...(instanceLocation !== undefined ? { instanceLocation } : {}),
          };
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
