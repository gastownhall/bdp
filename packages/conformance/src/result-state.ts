/**
 * Observable runner outcomes selected by
 * `docs/design/component-specifications.md#conformance-kit`; none is a BDP wire value.
 */
export const CONFORMANCE_RESULT_STATES = [
  "pass",
  "fail",
  "not-applicable",
  "unsupported-profile",
  "harness-error",
] as const;

export type ConformanceResultState = (typeof CONFORMANCE_RESULT_STATES)[number];

export function isConformanceResultState(value: unknown): value is ConformanceResultState {
  return (
    typeof value === "string" && (CONFORMANCE_RESULT_STATES as readonly string[]).includes(value)
  );
}
