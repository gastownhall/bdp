import { describe, expect, it } from "vitest";

import { isJsonSchemaUri } from "./schema-formats.js";

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
