import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVER_READ_UPDATE_LIMITS,
  resolveServerReadUpdateLimits,
} from "../packages/config/src/index.ts";
import { snapshotReadUpdateRuntimeLimits } from "../packages/server/src/read-update-runtime-limits.ts";

describe("actual reference defaults and private numerical receiver", () => {
  it("passes the actual exported defaults through the actual receiver", () => {
    const configured = resolveServerReadUpdateLimits();
    expect(configured).toBe(DEFAULT_SERVER_READ_UPDATE_LIMITS);
    const received = snapshotReadUpdateRuntimeLimits(configured);
    expect(received.maximumFirstDiagnosticBytes).toBe(4216066);
    expect(received.diagnosticBytes).toBe(8388608);
    expect(Object.isFrozen(received)).toBe(true);
  });
});
