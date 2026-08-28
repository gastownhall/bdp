import { describe, expect, it } from "vitest";

import schemaBundle from "../schemas/bdp-v0.schema.json" with { type: "json" };

describe("protocol schema isolation", () => {
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
