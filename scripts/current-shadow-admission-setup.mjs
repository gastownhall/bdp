// Assertion-only current-worker setup; never installs admission state or grants.
import assert from "node:assert/strict";

const historicalGrantState = Symbol.for("bdp.test.read-conformance-mock");
export function assertNoHistoricalAdmissionState(surface) {
  assert(
    !Reflect.has(surface, historicalGrantState),
    "Historical admission setup leaked into current shadow worker",
  );
}

assertNoHistoricalAdmissionState(globalThis);
