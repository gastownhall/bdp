import { describe, expect, it } from "vitest";
import { type CanonicalOutput, renderCanonicalOutput } from "./canonical-output.js";

describe("canonical delivery framing and human References", () => {
  it("uses bracketed absolute pin syntax and never shortens foreign identities", () => {
    const result: CanonicalOutput = {
      schema_version: 2,
      bdp_spec: "selected",
      result_kind: "resource",
      outcome: "success",
      data: {
        id: "https://local.test/work/a",
        type: { uri: "https://foreign.test/types/Note", revision: "literal+token" },
        revision: "r1",
        source: { uri: "https://local.test/work/b", revision: "r2" },
        target: "urn:external:target",
        properties: { title: "A", body: "line1\nline2", count: 7 },
      },
    };
    const short = renderCanonicalOutput(result, {}, "https://local.test/work/");
    expect(short).toContain("[https://foreign.test/types/Note]@=literal+token");
    expect(short).toContain("Source: b@=r2");
    expect(short).toContain("urn:external:target");
    expect(short).toContain("line1\nline2");
    const long = renderCanonicalOutput(result, { long: true }, "https://local.test/work/");
    expect(long).toContain("Source: [https://local.test/work/b]@=r2");
  });
  it("frames a compound mutation as exactly one item with success only in terminal", () => {
    const data = {
      changed: true,
      mappings: [{ operationIndex: 0, resource: "https://work.test/a" }],
      resources: [],
    };
    const output = renderCanonicalOutput(
      {
        schema_version: 2,
        bdp_spec: "selected",
        result_kind: "mutation",
        outcome: "success",
        data,
      },
      { outputFormat: "jsonl" },
    );
    const records = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records[0]).toEqual({
      record_type: "header",
      schema_version: 2,
      bdp_spec: "selected",
      result_kind: "mutation",
    });
    expect(records[1]).toEqual({ record_type: "item", data });
    expect(records[2]).toEqual({ record_type: "terminal", outcome: "success" });
  });
});
