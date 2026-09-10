import { describe, expect, it } from "vitest";
import {
  observedEntityTag,
  resolveScenarioHeaders,
  type ScenarioConditionalHeader,
} from "./conditional-header.js";

describe("observed conditional headers", () => {
  it.each(['""', '"opaque\\n,tag"', 'W/"opaque\\n,tag"', '"!"', '"é"'])(
    "preserves opaque bytes and guarantees a different nonmatch: %s",
    (tag) => {
      const responses = new Map([["control", { headers: { etag: tag } }]]);
      const resolve = (form: ScenarioConditionalHeader["form"]) =>
        resolveScenarioHeaders({ "if-match": { etagFrom: "control", form } }, responses)[
          "if-match"
        ];
      const opaque = tag.startsWith("W/") ? tag.slice(2) : tag;
      expect(resolve("exact")).toBe(tag);
      expect(resolve("weak")).toBe(`W/${opaque}`);
      const nonmatch = resolve("nonmatching");
      expect(observedEntityTag(nonmatch)).not.toBe(opaque);
      expect(resolve("exact-list")).toBe(`${nonmatch}, ${tag}`);
      expect(resolve("weak-list")).toBe(`${nonmatch}, W/${opaque}`);
    },
  );
  it.each([
    undefined,
    "unquoted",
    '"two", "tags"',
    '"line\nfeed"',
    '"space tag"',
    '"embedded\\"quote"',
    'w/"lowercase"',
  ])("rejects missing or invalid observed tag %s", (tag) => {
    expect(() => observedEntityTag(tag)).toThrow("one valid ETag");
  });
  it("rejects an unknown response without exposing a field value", () => {
    expect(() =>
      resolveScenarioHeaders({ "if-none-match": { etagFrom: "future", form: "exact" } }, new Map()),
    ).toThrow("earlier response");
  });
  it("retains literal field values without interpretation", () => {
    expect(
      resolveScenarioHeaders({ accept: "application/json", "if-match": '"literal"' }, new Map()),
    ).toEqual({ accept: "application/json", "if-match": '"literal"' });
  });
});
