import { describe, expect, it } from "vitest";

import schemaBundle from "../schemas/bdp-v0.schema.json" with { type: "json" };

describe("protocol schema isolation", () => {
  it("cannot poison History bootstrap through the public JSON export", async () => {
    const version = schemaBundle.$defs.historyCapability.properties.version;
    const original = version.const;
    version.const = 2;
    try {
      const { parseHistoryCapability } = await import("./history-values.js");
      expect(() => parseHistoryCapability({ version: 2 })).toThrow();
      expect(parseHistoryCapability({ version: 1 })).toEqual({ version: 1 });
    } finally {
      version.const = original;
    }
  });

  it("cannot be poisoned through the public JSON export before parser initialization", async () => {
    const describesValues = (
      schemaBundle as unknown as {
        $defs: { typeSummary: { properties: { describes: { enum: string[] } } } };
      }
    ).$defs.typeSummary.properties.describes.enum;
    describesValues.push("evil");
    try {
      const { parseTypeSummary } = await import("./read-values.js");
      expect(() =>
        parseTypeSummary({
          id: "https://work.example/types/task",
          name: "Task",
          describes: "evil",
        }),
      ).toThrow();
    } finally {
      describesValues.pop();
    }
  });
});
