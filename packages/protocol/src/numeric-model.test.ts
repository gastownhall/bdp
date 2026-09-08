import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The numeric model ruled 2026-09-08 (gastownhall/bdp#21) and transcribed
 * under Revisions — equality over exact decimal values, admission only of
 * literals that round-trip through binary64, token schemes naming their
 * number model — checked over the vectors in `fixtures/numeric-model`. The
 * round-trip rule is implemented below in a few lines and every vector is
 * asserted against it. The exact side never constructs a double, so the
 * distinction `JSON.parse` erases is kept; the binary64 side is exactly
 * `Number` plus the ECMAScript shortest form RFC 8785 adopts. This
 * establishes none of the behavior: no authority admitted or refused these
 * literals, and none of this is conformance evidence. The judgments the
 * ruling left open are NM1–NM11 in `docs/design/numeric-model-decisions.md`.
 */
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (...segments: readonly string[]): string =>
  readFileSync(path.join(workspaceRoot, ...segments), "utf8");
const fixture = JSON.parse(
  readText("fixtures", "numeric-model", "numeric-model.json"),
) as NumericModelFixture;

interface SameValueGroup {
  readonly id: string;
  readonly spellings: readonly string[];
  readonly serialized: string;
  readonly note?: string;
}

interface AdmittedLiteral {
  readonly literal: string;
  readonly serialized: string;
  readonly note?: string;
}

interface RefusedLiteral {
  readonly literal: string;
  readonly nearestSerialized: string | null;
  readonly reason: string;
}

interface OffendingLiteral {
  readonly pointer: string;
  readonly literal: string;
}

interface DocumentVector {
  readonly id: string;
  readonly properties: string;
  readonly disposition: "admitted" | "refused";
  readonly jcs?: string;
  readonly sha256Jcs?: string;
  readonly offending?: readonly OffendingLiteral[];
  readonly note?: string;
}

interface NumericModelFixture {
  readonly fixtureVersion: number;
  readonly id: string;
  readonly description: string;
  readonly ruling: string;
  readonly rule: string;
  readonly sameValue: readonly SameValueGroup[];
  readonly admitted: readonly AdmittedLiteral[];
  readonly refused: readonly RefusedLiteral[];
  readonly documents: readonly DocumentVector[];
}

/** RFC 8259 §6 number grammar, anchored: every vector is a well-formed JSON number. */
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * The exact decimal value a JSON number literal denotes, as a canonical
 * `[-]digits e exponent` with no leading or trailing zeros; zero is `0`
 * whatever its sign (NM1). String arithmetic only — no double is constructed
 * on this side of the comparison.
 */
function exactDecimal(literal: string): string {
  if (!JSON_NUMBER.test(literal)) throw new Error(`not a JSON number literal: ${literal}`);
  const negative = literal.startsWith("-");
  const [mantissa = "", exponentText] = (negative ? literal.slice(1) : literal).split(/[eE]/);
  const [integer = "", fraction = ""] = mantissa.split(".");
  const significant = `${integer}${fraction}`.replace(/^0+/, "");
  const trailingZeros = (/0*$/.exec(significant)?.[0] ?? "").length;
  const digits = significant.slice(0, significant.length - trailingZeros);
  const exponent =
    (exponentText === undefined ? 0 : Number.parseInt(exponentText, 10)) -
    fraction.length +
    trailingZeros;
  return digits === "" ? "0" : `${negative ? "-" : ""}${digits}e${exponent}`;
}

/**
 * RFC 8785 §3.2.2.3: the ECMAScript shortest round-trip form of the nearest
 * binary64, or undefined when no finite binary64 exists for the literal.
 */
function binary64Form(literal: string): string | undefined {
  const value = Number(literal);
  return Number.isFinite(value) ? JSON.stringify(value) : undefined;
}

/**
 * The round-trip rule under Revisions: a literal is admissible iff the
 * nearest binary64 serializes back to a literal of the same exact value.
 */
function isAdmissible(literal: string): boolean {
  const exact = exactDecimal(literal);
  const form = binary64Form(literal);
  return form !== undefined && exactDecimal(form) === exact;
}

interface NumberLiteralOccurrence {
  readonly pointer: string;
  readonly literal: string;
}

interface ReviverContext {
  readonly source?: string;
}

type SourceReviver = (
  this: unknown,
  key: string,
  value: unknown,
  context: ReviverContext,
) => unknown;

/** ES2025 `JSON.parse` source-text access, which the ES2024 lib does not type yet. */
const parseWithSource = JSON.parse as unknown as (text: string, reviver: SourceReviver) => unknown;

const escapePointerToken = (token: string): string =>
  token.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * Every number literal in a JSON text, as written, with the JSON Pointer of
 * the member holding it — the platform parser sees each literal's source
 * text before it becomes a double, so nothing is lost and nothing is
 * re-tokenized here.
 */
function numberLiterals(text: string): readonly NumberLiteralOccurrence[] {
  const sources = new WeakMap<object, Map<string, string>>();
  const root = parseWithSource(text, function (key, value, { source }) {
    const holder: unknown = this;
    if (typeof value === "number" && typeof holder === "object" && holder !== null && source) {
      const literals = sources.get(holder) ?? new Map<string, string>();
      literals.set(key, source);
      sources.set(holder, literals);
    }
    return value;
  });
  const found: NumberLiteralOccurrence[] = [];
  const visit = (node: unknown, pointer: string): void => {
    if (typeof node !== "object" || node === null) return;
    for (const [key, literal] of sources.get(node) ?? []) {
      found.push({ pointer: `${pointer}/${escapePointerToken(key)}`, literal });
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, `${pointer}/${escapePointerToken(key)}`);
    }
  };
  visit(root, "");
  return found;
}

/**
 * RFC 8785 over a parsed value, enough for these vectors: members sorted by
 * UTF-16 code units (the default sort order), no whitespace, and strings and
 * numbers as `JSON.stringify` writes them — the ECMAScript forms §3.2.2.2
 * and §3.2.2.3 adopt. Not a general JCS implementation.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

describe("numeric-model vectors", () => {
  const spellings = fixture.sameValue.flatMap((group) => group.spellings);
  const refused = fixture.refused.map(({ literal }) => literal);

  it("carries the ruling's vectors as well-formed JSON number literals, refused ones included", () => {
    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.id).toBe("numeric-model");
    const literals = [...spellings, ...fixture.admitted.map(({ literal }) => literal), ...refused];
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) expect(JSON_NUMBER.test(literal), literal).toBe(true);
    // Refusal is semantic, never syntactic: every refused literal parses.
    for (const literal of refused) expect(() => JSON.parse(literal), literal).not.toThrow();
    // The vectors the ruling named.
    expect(spellings).toEqual(expect.arrayContaining(["1.0", "-0.0", "1e300"]));
    expect(refused).toContain("9007199254740993");
    expect(refused).toContain("1.2345678901234567891");
  });

  it("keeps the exact side exact where Number collapses distinct values", () => {
    expect(exactDecimal("1.0")).toBe(exactDecimal("1"));
    expect(exactDecimal("1e0")).toBe("1e0");
    expect(exactDecimal("-0.0")).toBe("0");
    expect(exactDecimal("1E300")).toBe(exactDecimal("1e+300"));
    expect(exactDecimal("9007199254740993")).not.toBe(exactDecimal("9007199254740992"));
    expect(Number("9007199254740993")).toBe(Number("9007199254740992"));
    expect(exactDecimal("0.10000000000000000555")).not.toBe(exactDecimal("0.1"));
    expect(Number("0.10000000000000000555")).toBe(Number("0.1"));
  });

  it("admits every spelling in a same-value group as one value with one RFC 8785 form", () => {
    for (const group of fixture.sameValue) {
      expect(group.spellings.length, group.id).toBeGreaterThan(1);
      const values = new Set(group.spellings.map(exactDecimal));
      expect(values.size, group.id).toBe(1);
      for (const spelling of group.spellings) {
        expect(isAdmissible(spelling), `${group.id}: ${spelling}`).toBe(true);
        expect(binary64Form(spelling), `${group.id}: ${spelling}`).toBe(group.serialized);
      }
      // The shared form is itself an admissible spelling of the same value.
      expect(isAdmissible(group.serialized), group.id).toBe(true);
      expect(values.has(exactDecimal(group.serialized)), group.id).toBe(true);
    }
    // Distinct groups denote distinct values.
    const groupValues = fixture.sameValue.map(({ serialized }) => exactDecimal(serialized));
    expect(new Set(groupValues).size).toBe(fixture.sameValue.length);
  });

  it("admits the boundary literals with their pinned forms", () => {
    for (const { literal, serialized } of fixture.admitted) {
      expect(isAdmissible(literal), literal).toBe(true);
      expect(binary64Form(literal), literal).toBe(serialized);
    }
  });

  it("refuses every literal whose exact value does not round-trip, pinning what it would have become", () => {
    for (const { literal, nearestSerialized } of fixture.refused) {
      expect(isAdmissible(literal), literal).toBe(false);
      expect(binary64Form(literal), literal).toBe(nearestSerialized ?? undefined);
      if (nearestSerialized !== null) {
        // What binary64 would have made of it is admissible — and a different value.
        expect(isAdmissible(nearestSerialized), literal).toBe(true);
        expect(exactDecimal(nearestSerialized), literal).not.toBe(exactDecimal(literal));
      }
    }
  });

  it("scans documents at any depth: respellings are one admitted value, the nested literal is refused", () => {
    const digests = new Map<string, string>();
    for (const document of fixture.documents) {
      const literals = numberLiterals(document.properties);
      expect(literals.length, document.id).toBeGreaterThan(0);
      const offending = literals.filter(({ literal }) => !isAdmissible(literal));
      if (document.disposition === "admitted") {
        expect(offending, document.id).toEqual([]);
        const canonical = canonicalize(JSON.parse(document.properties));
        expect(canonical, document.id).toBe(document.jcs);
        expect(sha256Hex(canonical), document.id).toBe(document.sha256Jcs);
        // The canonical bytes are themselves admissible spellings of the same values.
        for (const { literal } of numberLiterals(canonical)) {
          expect(isAdmissible(literal), `${document.id}: ${literal}`).toBe(true);
        }
        digests.set(document.id, sha256Hex(canonical));
      } else {
        expect(offending, document.id).toEqual(document.offending);
      }
    }
    // Two admissible respellings of one value: one sha256-jcs digest.
    expect(digests.get("admitted-document")).toBeDefined();
    expect(digests.get("respelled-document")).toBe(digests.get("admitted-document"));
  });

  it("finds no inadmissible literal in the sealed Read artifacts, so the rule leaves the cohort untouched", () => {
    const artifacts = [
      ["packages", "conformance", "catalog", "read-v1.json"],
      ["packages", "conformance", "matrices", "read-v1.json"],
      ["packages", "conformance", "fixtures", "read-reference-v1.json"],
      ["packages", "conformance", "fixtures", "read-bdpbd-v1.json"],
      ["fixtures", "reference-domain", "reference-domain.json"],
      ["docs", "design", "evidence", "read-cohort", "read-v1.json"],
      ["schemas", "bdp-v0.schema.json"],
    ] as const;
    let total = 0;
    for (const segments of artifacts) {
      const literals = numberLiterals(readText(...segments));
      total += literals.length;
      for (const { pointer, literal } of literals) {
        expect(isAdmissible(literal), `${segments.join("/")}${pointer}: ${literal}`).toBe(true);
      }
    }
    expect(total).toBeGreaterThan(0);
  });
});
