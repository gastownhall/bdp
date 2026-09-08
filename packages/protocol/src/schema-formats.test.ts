import { describe, expect, it } from "vitest";

import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";

describe("normative URI format", () => {
  it.each([
    "https://example.com/\\path",
    "https://example.com/€",
    "https://example.com/\ud800",
    "https://example.com/a b",
    "https://example.com/%",
  ])("rejects non-RFC-3986 spelling %s", (value) => {
    expect(isJsonSchemaUri(value)).toBe(false);
  });

  it.each([
    "https://example.com/%E2%82%AC",
    "urn:example:opaque",
    "https://example.com:443/schema",
  ])("accepts RFC-3986 URI %s", (value) => {
    expect(isJsonSchemaUri(value)).toBe(true);
  });
});

describe("normative date-time format", () => {
  // The calendar and the clock are validated, not merely the punctuation:
  // the boundaries the Transactional packet's T45 names.
  it.each([
    "2026-99-99T99:99:99+99:99",
    "2026-02-30T00:00:00Z",
    "2026-09-07T18:04:12",
    "2026-09-07 18:04:12Z",
    "2026-09-07\t18:04:12Z",
    "2026-09-07\n18:04:12Z",
    "2026-09-07",
    "not an instant",
  ])("rejects non-RFC-3339 instant %s", (value) => {
    expect(isJsonSchemaDateTime(value)).toBe(false);
  });

  it.each(["2026-09-07T18:04:12Z", "2026-09-07T18:04:12.5+02:00", "2026-09-07t18:04:12z"])(
    "accepts RFC-3339 instant %s",
    (value) => {
      expect(isJsonSchemaDateTime(value)).toBe(true);
    },
  );
});
