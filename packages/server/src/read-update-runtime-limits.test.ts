import { describe, expect, it } from "vitest";
import { snapshotReadUpdateRuntimeLimits } from "./read-update-runtime-limits.js";

const bounds = { requestBodyBytes: 1048576, propertiesBytes: 1048576, diagnosticBytes: 8388608 };
describe("conditional runtime limit snapshot", () => {
  it("derives the exact complete first-diagnostic bound and checks its boundary", () => {
    const snapshot = snapshotReadUpdateRuntimeLimits(bounds);
    expect(snapshot.maximumFirstDiagnosticBytes).toBe(4216066);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).not.toHaveProperty("diagnosticCount");
    expect(
      snapshotReadUpdateRuntimeLimits({ ...bounds, diagnosticBytes: 4216066, diagnosticCount: 1 })
        .diagnosticCount,
    ).toBe(1);
    expect(() => snapshotReadUpdateRuntimeLimits({ ...bounds, diagnosticBytes: 4216065 })).toThrow(
      RangeError,
    );
    expect(() =>
      snapshotReadUpdateRuntimeLimits({ ...bounds, propertiesBytes: 8 * 1048576 }),
    ).toThrow(RangeError);
    expect(
      snapshotReadUpdateRuntimeLimits({ ...bounds, propertiesBytes: 1 })
        .maximumFirstDiagnosticBytes,
    ).toBe(2118916);
    expect(
      snapshotReadUpdateRuntimeLimits({ ...bounds, requestBodyBytes: 1 })
        .maximumFirstDiagnosticBytes,
    ).toBe(2118916);
  });
  it("captures each supplied primitive once before later mutation", () => {
    const reads: string[] = [];
    const input: Record<string, number> = { ...bounds, diagnosticCount: 2 };
    const received = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.keys(input).map((k) => [
          k,
          {
            get() {
              reads.push(k);
              return input[k];
            },
          },
        ]),
      ),
    );
    const snapshot = snapshotReadUpdateRuntimeLimits(received as typeof bounds);
    input.diagnosticBytes = 1;
    expect(reads).toEqual([
      "requestBodyBytes",
      "propertiesBytes",
      "diagnosticBytes",
      "diagnosticCount",
    ]);
    expect(snapshot.diagnosticBytes).toBe(8388608);
  });
  it.each([0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", undefined])(
    "refuses invalid required values %s",
    (v) => {
      for (const key of Object.keys(bounds))
        expect(() => snapshotReadUpdateRuntimeLimits({ ...bounds, [key]: v })).toThrow(TypeError);
    },
  );
  it.each([0, -1, 1.1, Infinity, "1"])("refuses invalid optional counts %s", (v) => {
    expect(() =>
      snapshotReadUpdateRuntimeLimits({ ...bounds, diagnosticCount: v as number }),
    ).toThrow(TypeError);
  });
  it.each([Number.MAX_SAFE_INTEGER, Math.floor(Number.MAX_SAFE_INTEGER / 2)])(
    "refuses unsafe intermediate arithmetic %s",
    (requestBodyBytes) => {
      expect(() =>
        snapshotReadUpdateRuntimeLimits({
          ...bounds,
          requestBodyBytes,
          diagnosticBytes: Number.MAX_SAFE_INTEGER,
        }),
      ).toThrow(RangeError);
    },
  );
});
