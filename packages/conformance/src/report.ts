import type { ConformanceRunResult } from "./runner.js";

/** Byte-stable JSON for machine comparison; no time or duration fields are introduced. */
export function serializeConformanceReport(report: ConformanceRunResult): string {
  if (report.reportVersion !== 3 && report.reportVersion !== 4)
    throw new TypeError("unsupported conformance report version");
  if (report.reportVersion === 3) {
    if (
      Object.hasOwn(report.declarations, "exactConfigurationDigest") ||
      report.scenarios.some((scenario) =>
        scenario.exchanges.some(
          (exchange) =>
            Object.hasOwn(exchange.request, "exact") ||
            Object.hasOwn(exchange, "harnessError") ||
            (exchange.transportError !== undefined &&
              Object.hasOwn(exchange.transportError, "writeState")),
        ),
      )
    )
      throw new TypeError("exact observations require conformance report version 4");
  }
  return `${JSON.stringify(sortJson(report))}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

/** Discriminant guard only: this does not validate arbitrary report JSON. */
export function assertLegacyReportVersion<T>(
  value: T,
): asserts value is T & { readonly reportVersion: 3 } {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getOwnPropertyDescriptor(value, "reportVersion")?.value !== 3
  )
    throw new TypeError("Read cohort requires conformance report version 3");
}
