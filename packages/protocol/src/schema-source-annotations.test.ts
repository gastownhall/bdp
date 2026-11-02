import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { withBdpSourceAnnotations } from "./schema-source-annotations.js";

describe("passive BDP source annotations", () => {
  it("keeps instance assertions and source bytes intact while admitting known metadata", () => {
    const schema = {
      type: "object",
      required: ["id"],
      additionalProperties: false,
      properties: { id: { type: "string" } },
      "x-bdp-schema-definitions": ["record"],
      "x-bdp-schema-sources": { "core.md": ["record"] },
    };
    const before = JSON.stringify(schema);
    const ajv = withBdpSourceAnnotations(new Ajv2020({ strict: true }));
    const valid = ajv.compile(schema);
    expect(valid({ id: "r" })).toBe(true);
    expect(valid({})).toBe(false);
    expect(valid({ id: 3 })).toBe(false);
    expect(valid({ id: "r", extra: true })).toBe(false);
    expect(JSON.stringify(schema)).toBe(before);
    expect(ajv.opts.strict).toBe(true);
  });
  it("retains strict refusal of unknown keywords", () => {
    const ajv = withBdpSourceAnnotations(new Ajv2020({ strict: true }));
    expect(() => ajv.compile({ type: "object", "x-unknown-required-meaning": true })).toThrow(
      /unknown keyword/,
    );
  });
  it.each([
    { "x-bdp-schema-definitions": "record" },
    { "x-bdp-schema-definitions": [3] },
    { "x-bdp-schema-sources": { "core.md": "record" } },
  ])("refuses malformed source annotation %j", (annotation) => {
    const ajv = withBdpSourceAnnotations(new Ajv2020({ strict: true }));
    expect(() => ajv.compile({ type: "object", ...annotation })).toThrow();
  });
});
