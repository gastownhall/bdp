import { describe, expect, it } from "vitest";
import { type CanonicalOutput, renderCanonicalOutput } from "./canonical-output.js";

describe("canonical delivery framing and human References", () => {
  it("renders Scope discovery for people and retains the JSON envelope on request", () => {
    const result: CanonicalOutput = {
      schema_version: 2,
      bdp_spec: "selected",
      result_kind: "scope",
      outcome: "success",
      data: {
        scope: "https://work.example/team/",
        bdpVersion: "0.1",
        profile: "write",
        beads: "https://work.example/team/bdp/beads",
        links: "https://work.example/team/bdp/links",
        order: "canonical-uri",
        limits: { page: { defaultItems: 25, maximumItems: 100 } },
      },
    };

    const human = renderCanonicalOutput(result, {});
    expect(human).toContain("Scope: https://work.example/team/");
    expect(human).toContain("Profile: write");
    expect(human).toContain("Beads inventory: https://work.example/team/bdp/beads");
    expect(human).toContain('"maximumItems": 100');
    expect(human).toContain('"order": "canonical-uri"');

    expect(JSON.parse(renderCanonicalOutput(result, { outputMode: "json" }))).toEqual(result);
  });

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

  const callable = (data: unknown): CanonicalOutput => ({
    schema_version: 2,
    bdp_spec: "selected",
    result_kind: "callable_result",
    outcome: "success",
    data,
  });
  const human = (data: unknown) => renderCanonicalOutput(callable(data), {});

  it("prints a Callable's rows as a table, with no per-package presentation", () => {
    expect(
      human({
        result: {
          items: [
            { id: "bd-1", title: "Fix login", priority: 1, assignee: null, labels: ["a", "b"] },
            { id: "bd-20", title: "Ship", priority: 0, assignee: null, labels: [] },
          ],
          has_more: false,
        },
      }),
    ).toBe(
      [
        "items:",
        "id     title      priority  labels",
        'bd-1   Fix login  1         ["a","b"]',
        "bd-20  Ship       0",
        "",
        "has_more: false",
        "",
      ].join("\n"),
    );
    expect(human({ result: [{ a: 1 }, { b: 2 }] })).toBe("a  b\n1\n   2\n");
    expect(human({ result: { items: [], has_more: false } })).toBe(
      "items: (none)\nhas_more: false\n",
    );
  });

  it("prints a Callable's record as key and value, whole, and a scalar as itself", () => {
    expect(
      human({
        result: {
          id: "bd-1",
          description: "line one\nline two",
          labels: ["a", "b"],
          dependency_count: 0,
          closed_at: null,
          nested: { deep: true },
        },
      }),
    ).toBe(
      "id: bd-1\ndescription: line one\n  line two\nlabels: a, b\ndependency_count: 0\nclosed_at: null\nnested:\n  deep: true\n",
    );
    expect(human({ result: 3 })).toBe("3\n");
    expect(human({ result: "plain" })).toBe("plain\n");
    expect(human({ result: null })).toBe("null\n");
    expect(human({ result: {} })).toBe("(empty)\n");
    expect(human({ result: [] })).toBe("(none)\n");
    expect(human({ result: ["a", 1] })).toBe("a\n1\n");
  });

  it("says changed once when the result agrees, and both, labeled, when it does not", () => {
    expect(human({ changed: true, result: { changed: true, id: "bd-1" } })).toBe(
      "changed: true\nid: bd-1\n",
    );
    expect(human({ changed: false, result: { changed: false } })).toBe("changed: false\n");
    expect(human({ changed: true, result: { changed: false, id: "bd-1" } })).toBe(
      "changed (invocation): true\nchanged (result): false\nid: bd-1\n",
    );
    expect(human({ result: { changed: true } })).toBe("changed: true\n");
    const data = { changed: true, result: { changed: false } };
    expect(
      JSON.parse(
        renderCanonicalOutput(
          {
            schema_version: 2,
            bdp_spec: null,
            result_kind: "callable_result",
            outcome: "success",
            data,
          },
          { outputMode: "json" },
        ),
      ).data,
    ).toEqual(data);
  });

  it("says whether a batch changed anything", () => {
    expect(human({ changed: true, result: { id: "bd-1" } })).toBe("changed: true\nid: bd-1\n");
    expect(human({ changed: false, result: null })).toBe("changed: false\nnull\n");
  });

  it("says when a table cell was shortened, and JSON keeps it whole", () => {
    const long = "x".repeat(200);
    const rows = { result: [{ id: "a", text: long }] };
    const text = human(rows);
    expect(text).not.toContain(long);
    expect(text).toContain(`${"x".repeat(47)}…`);
    expect(text).toContain("--output-mode json carries them whole");
    expect(renderCanonicalOutput(callable(rows), { outputMode: "json" })).toContain(long);
  });

  it("keeps a service's control characters from the terminal", () => {
    const text = human({ result: { "k\u001b[2J": "v\u001b[31m", rows: [{ a: "\u0007b\nc" }] } });
    const controls = Array.from(text).filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return character !== "\n" && (code < 32 || (code >= 127 && code <= 159));
    });
    expect(controls).toEqual([]);
    expect(text).toContain(" b c");
  });

  it("keeps detail as the whole value and JSON as the envelope", () => {
    const data = { result: { a: [1] }, changed: true };
    expect(renderCanonicalOutput(callable(data), { outputFormat: "detail" })).toBe(
      `${JSON.stringify(data, null, 2)}\n`,
    );
    expect(JSON.parse(renderCanonicalOutput(callable(data), { outputMode: "json" }))).toEqual(
      callable(data),
    );
  });
});
