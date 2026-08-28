/**
 * Harness-local navigation vocabulary. These tokens let future scenarios refer
 * to URLs observed from prior responses instead of hard-coding protocol paths.
 * This follows `docs/design/client-scope-port-interface.md#client-navigation-and-opaque-tokens`.
 * They are not URI templates or BDP wire values.
 */
export const SYMBOLIC_URLS = [
  "$scope",
  "$service-desc",
  "$beads",
  "$links",
  "$types",
  "$bead-links",
  "$next",
] as const;

export type SymbolicUrl = (typeof SYMBOLIC_URLS)[number];

export function isSymbolicUrl(value: unknown): value is SymbolicUrl {
  return typeof value === "string" && (SYMBOLIC_URLS as readonly string[]).includes(value);
}
