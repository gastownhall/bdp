import { describe, expect, it, vi } from "vitest";
import {
  admitJsonNumbers,
  decodeJsonDocument,
  JsonDiagnosticBudgetError,
  mapLosslessJson,
  type JsonNumberDiagnosticBudget,
  type AdmittedJsonValue,
} from "./json-admission.js";
import { admitReadUpdateOperationNumbers, parseReadUpdateRequest } from "./read-update-values.js";

const diagnostic: JsonNumberDiagnosticBudget["diagnostic"] = ({ pointer }) => ({
  instanceLocation: pointer,
  message: "inadmissible number",
});
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe("lazy numeric pointers and caller-owned diagnostic budgets", () => {
  it("does no pointer escaping when a deep many-number placeholder callback ignores paths", () => {
    const depth = 2_000;
    const root = decodeJsonDocument(`${"[1,".repeat(depth)}null${"]".repeat(depth)}`);
    const replace = vi.spyOn(String.prototype, "replace");
    let numbers = 0;
    let escaped: number;
    try {
      mapLosslessJson(root, (_number, pointer) => {
        if (typeof pointer !== "function") throw new Error("pointer was eagerly materialized");
        numbers++;
        return 0;
      });
      escaped = replace.mock.calls.length;
    } finally {
      replace.mockRestore();
    }
    expect(numbers).toBe(depth);
    expect(escaped).toBe(0);
  });

  it("parses and admits many numbers at growing depths through the actual RU carrier", () => {
    const depth = 10_000;
    const nested = `${"[1,".repeat(depth)}null${"]".repeat(depth)}`;
    const parsed = parseReadUpdateRequest(
      "createBead",
      `{"type":"https://types.example/b","properties":{"n":${nested}}}`,
    );
    const format = vi.fn(diagnostic);
    const result = admitReadUpdateOperationNumbers(parsed, {
      diagnostics: 1,
      diagnosticBytes: 128,
      diagnostic: format,
    });
    expect(result.ok).toBe(true);
    expect(format).not.toHaveBeenCalled();
    if (!result.ok) return;
    let node = result.input.properties?.n as AdmittedJsonValue;
    let seen = 0;
    while (Array.isArray(node)) {
      expect(Object.isFrozen(node)).toBe(true);
      expect(node[0]).toBe(1);
      node = node[1] as AdmittedJsonValue;
      seen++;
    }
    expect(seen).toBe(depth);
    expect(node).toBeNull();
  });

  it("caps a deep many-refusal document by actual diagnostic bytes", () => {
    const depth = 6_000;
    const root = decodeJsonDocument(
      `${"[".repeat(depth)}[${Array(2_000).fill("1e999").join(",")}]${"]".repeat(depth)}`,
    );
    const format = vi.fn(diagnostic);
    const result = admitJsonNumbers(root, {
      diagnostics: 100,
      diagnosticBytes: 26_000,
      diagnostic: format,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(2);
    expect(result.offending).toHaveLength(2);
    expect(result.diagnosticsTruncated).toBe(true);
    expect(format).toHaveBeenCalledTimes(3);
    expect(byteLength(result.diagnostics)).toBeLessThanOrEqual(26_000);
    expect(result.offending.map(({ pointer }) => pointer)).toEqual([
      `${"/0".repeat(depth)}/0`,
      `${"/0".repeat(depth)}/1`,
    ]);
    expect(result).not.toHaveProperty("value");
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
  });

  it("only marks count truncation when a further refused literal exists, without formatting it", () => {
    const format = vi.fn(diagnostic);
    const budget = { diagnostics: 2, diagnostic: format };
    const complete = admitJsonNumbers(decodeJsonDocument("[1e999,2,1e999,3]"), budget);
    expect(complete).toMatchObject({ ok: false, diagnosticsTruncated: false });
    format.mockClear();
    const truncated = admitJsonNumbers(decodeJsonDocument("[1e999,2,1e999,3,1e999,1e999]"), budget);
    expect(truncated).toMatchObject({ ok: false, diagnosticsTruncated: true });
    expect(format).toHaveBeenCalledTimes(2);
    if (truncated.ok) return;
    expect(truncated.offending.map(({ pointer }) => pointer)).toEqual(["/0", "/2"]);
  });

  it("counts UTF-8 JSON brackets, commas and escaped strings at the exact boundary", () => {
    const root = decodeJsonDocument("[1e999,1e999]");
    const format: JsonNumberDiagnosticBudget["diagnostic"] = ({ pointer }) => ({
      instanceLocation: pointer,
      message: '😀"\\\n',
    });
    const full = admitJsonNumbers(root, { diagnostic: format });
    expect(full.ok).toBe(false);
    if (full.ok) return;
    const exact = byteLength(full.diagnostics);
    const fits = admitJsonNumbers(root, { diagnosticBytes: exact, diagnostic: format });
    expect(fits).toEqual(full);
    const short = admitJsonNumbers(root, { diagnosticBytes: exact - 1, diagnostic: format });
    expect(short).toMatchObject({ ok: false, diagnosticsTruncated: true });
    if (short.ok) return;
    expect(short.diagnostics).toEqual([full.diagnostics[0]]);
    expect(byteLength(short.diagnostics)).toBeLessThan(exact);
  });

  it("makes first-entry overflow a caller obligation instead of an empty or rounded refusal", () => {
    const root = decodeJsonDocument('{"n":9007199254740993}');
    const full = admitJsonNumbers(root, { diagnostic });
    if (full.ok) throw new Error("expected number refusal");
    const required = byteLength(full.diagnostics);
    expect(() => admitJsonNumbers(root, { diagnostic, diagnosticBytes: required - 1 })).toThrow(
      JsonDiagnosticBudgetError,
    );
    expect(admitJsonNumbers(root, { diagnostic, diagnosticBytes: required })).toEqual(full);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid caller limits %s",
    (limit) => {
      for (const budget of [
        { diagnostics: limit, diagnostic },
        { diagnosticBytes: limit, diagnostic },
      ])
        expect(() => admitJsonNumbers(null, budget)).toThrow(JsonDiagnosticBudgetError);
    },
  );

  it("retains all diagnostics when the caller explicitly omits advertised bounds", () => {
    const result = admitJsonNumbers(decodeJsonDocument(`[${Array(101).fill("1e999").join(",")}]`), {
      diagnostic,
    });
    expect(result).toMatchObject({ ok: false, diagnosticsTruncated: false });
    if (!result.ok) expect(result.diagnostics).toHaveLength(101);
  });

  it("snapshots both limits before a formatter mutates the caller-owned policy", () => {
    const budget = {
      diagnostics: 1,
      diagnosticBytes: 60,
      diagnostic: ({ pointer }: Parameters<JsonNumberDiagnosticBudget["diagnostic"]>[0]) => {
        budget.diagnostics = 10;
        budget.diagnosticBytes = 1_000;
        return { instanceLocation: pointer, message: "bad" };
      },
    };
    const result = admitJsonNumbers(decodeJsonDocument("[1e999,1e999,1e999]"), budget);
    expect(result).toMatchObject({ ok: false, diagnosticsTruncated: true });
    if (result.ok) return;
    expect(result.diagnostics).toEqual([{ instanceLocation: "/0", message: "bad" }]);
    expect(result.offending).toEqual([{ pointer: "/0", literal: "1e999" }]);
    expect(byteLength(result.diagnostics)).toBeLessThanOrEqual(60);
    expect(result).not.toHaveProperty("value");
    expect(budget.diagnostics).toBe(10);
    expect(budget.diagnosticBytes).toBe(1_000);
    expect(Object.isFrozen(budget)).toBe(false);
  });

  it("keeps the original byte bound when count remains unbounded", () => {
    const budget = {
      diagnosticBytes: 60,
      diagnostic: ({ pointer }: Parameters<JsonNumberDiagnosticBudget["diagnostic"]>[0]) => {
        budget.diagnosticBytes = 1_000;
        return { instanceLocation: pointer, message: "bad" };
      },
    };
    const result = admitJsonNumbers(decodeJsonDocument("[1e999,1e999,1e999]"), budget);
    expect(result).toMatchObject({ ok: false, diagnosticsTruncated: true });
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(byteLength(result.diagnostics)).toBeLessThanOrEqual(60);
  });

  it("uses the captured formatter for all retained entries", () => {
    const replacement = vi.fn(() => ({ message: "replacement" }));
    const budget = {
      diagnostics: 2,
      diagnostic: (_occurrence: Parameters<JsonNumberDiagnosticBudget["diagnostic"]>[0]) => {
        budget.diagnostic = replacement;
        return { message: "original" };
      },
    };
    const result = admitJsonNumbers(decodeJsonDocument("[1e999,1e999]"), budget);
    expect(result).toMatchObject({
      ok: false,
      diagnosticsTruncated: false,
      diagnostics: [{ message: "original" }, { message: "original" }],
    });
    expect(replacement).not.toHaveBeenCalled();
    expect(budget.diagnostic).toBe(replacement);
  });

  it("copies the caller's measured entry so later mutation cannot exceed the bound", () => {
    const entry = { message: "number" };
    const result = admitJsonNumbers(decodeJsonDocument("1e999"), {
      diagnostic: () => entry,
      diagnosticBytes: byteLength([entry]),
    });
    entry.message = "x".repeat(1_000);
    expect(result).toMatchObject({ ok: false, diagnostics: [{ message: "number" }] });
  });
});
