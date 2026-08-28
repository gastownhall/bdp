import type { ConformanceRunResult } from "./runner.js";

/** Byte-stable JSON for machine comparison; no time or duration fields are introduced. */
export function serializeConformanceReport(report: ConformanceRunResult): string {
  if ((report as { readonly reportVersion?: unknown }).reportVersion !== 3)
    throw new TypeError("unsupported conformance report version");
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
