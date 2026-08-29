import type { BeadRecord, LinkRecord } from "@bdp/protocol";
import { describe, expect, it } from "vitest";

import {
  ReadSelectorError,
  type ReadSelectorErrorCode,
  selectReadResources,
} from "./read-selector.js";

const LIMITS = { bytes: 16_384, depth: 256, nodes: 2_048 } as const;
const BEAD_TYPE = "https://beads.example/acme/types/task";

function bead(id: string, properties: Record<string, unknown>, type = BEAD_TYPE): BeadRecord {
  return {
    id: `https://beads.example/acme/beads/${id}`,
    type,
    revision: `revision-${id}`,
    properties,
  } as BeadRecord;
}

function link(
  id: string,
  source: string,
  target: string,
  properties: Record<string, unknown> = {},
): LinkRecord {
  return {
    id: `https://beads.example/acme/links/${id}`,
    type: "https://beads.example/acme/types/blocks",
    revision: `revision-${id}`,
    source,
    target,
    properties,
  } as LinkRecord;
}

function expectSelectorError(selector: string, code: ReadSelectorErrorCode): ReadSelectorError {
  try {
    selectReadResources(selector, LIMITS, []);
  } catch (error) {
    expect(error).toBeInstanceOf(ReadSelectorError);
    expect(error).toMatchObject({ code });
    return error as ReadSelectorError;
  }
  throw new Error(`expected ${code} for ${selector}`);
}

describe("Read Selector", () => {
  it("preserves candidate order and identities without mutating records", () => {
    const first = bead("one", { status: "open", rank: 1 });
    const second = bead("two", { status: "closed", rank: 2 });
    const third = bead("three", { status: "open", rank: 3 });
    const candidates = Object.freeze([first, second, third]);
    const before = JSON.stringify(candidates);

    const selected = selectReadResources('$[?@.properties.status == "open"]', LIMITS, candidates);

    expect(selected).toEqual([first, third]);
    expect(selected[0]).toBe(first);
    expect(selected[1]).toBe(third);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(JSON.stringify(candidates)).toBe(before);
  });

  it("applies !, &&, ||, and parentheses with JSONPath precedence", () => {
    const onlyA = bead("a", { a: true, b: false, c: false });
    const bAndC = bead("bc", { a: false, b: true, c: true });
    const onlyB = bead("b", { a: false, b: true, c: false });
    const candidates = [onlyA, bAndC, onlyB];

    expect(
      selectReadResources(
        "$[?@.properties.a == true || @.properties.b == true && @.properties.c == true]",
        LIMITS,
        candidates,
      ),
    ).toEqual([onlyA, bAndC]);
    expect(
      selectReadResources(
        "$[?(@.properties.a == true || @.properties.b == true) && !(@.properties.c == true)]",
        LIMITS,
        candidates,
      ),
    ).toEqual([onlyA, onlyB]);
  });

  it.each([
    ["==", 2, true],
    ["!=", 2, false],
    ["<", 3, true],
    ["<=", 2, true],
    [">", 1, true],
    [">=", 2, true],
  ] as const)("supports the %s operator", (operator, right, expected) => {
    const candidate = bead("number", { value: 2 });
    expect(
      selectReadResources(`$[?@.properties.value ${operator} ${right}]`, LIMITS, [candidate]),
    ).toHaveLength(expected ? 1 : 0);
  });

  it("supports string ordering and never coerces cross-type ordering or equality", () => {
    const stringValue = bead("string", { value: "10" });
    const numberValue = bead("number", { value: 10 });

    expect(selectReadResources('$[?@.properties.value < "2"]', LIMITS, [stringValue])).toEqual([
      stringValue,
    ]);
    expect(selectReadResources("$[?@.properties.value < 20]", LIMITS, [stringValue])).toEqual([]);
    expect(selectReadResources('$[?@.properties.value == "10"]', LIMITS, [numberValue])).toEqual(
      [],
    );
    expect(selectReadResources('$[?@.properties.value != "10"]', LIMITS, [numberValue])).toEqual([
      numberValue,
    ]);
  });

  it("treats own missing-path status as existence, including null and undefined values", () => {
    const absent = bead("absent", {});
    const presentNull = bead("null", { value: null });
    const presentUndefined = bead("undefined", { value: undefined });

    expect(
      selectReadResources("$[?@.properties.value]", LIMITS, [
        absent,
        presentNull,
        presentUndefined,
      ]),
    ).toEqual([presentNull, presentUndefined]);
    expect(selectReadResources("$[?!@.properties.value]", LIMITS, [absent, presentNull])).toEqual([
      absent,
    ]);
    expect(
      selectReadResources("$[?@.properties.value == null]", LIMITS, [absent, presentNull]),
    ).toEqual([presentNull]);
  });

  it("selects Bead identity/type fields and Link endpoint IDs without normalization", () => {
    const local = "https://beads.example/acme/beads/a";
    const external = "urn:partner:item:42";
    const matchingLink = link("one", local, external);
    const otherLink = link("two", "https://beads.example/acme/beads/b", local);
    const matchingBead = bead("a", {});

    expect(selectReadResources(`$[?@.id == "${local}"]`, LIMITS, [matchingBead])).toEqual([
      matchingBead,
    ]);
    expect(selectReadResources(`$[?@.type == "${BEAD_TYPE}"]`, LIMITS, [matchingBead])).toEqual([
      matchingBead,
    ]);
    expect(
      selectReadResources(`$[?@.source == "${local}" && @.target == "${external}"]`, LIMITS, [
        matchingLink,
        otherLink,
      ]),
    ).toEqual([matchingLink]);
  });

  it("projects response-only revision out of Selector candidates", () => {
    const candidate = bead("projected", { revision: "domain-value" });

    expect(selectReadResources("$[?@.revision]", LIMITS, [candidate])).toEqual([]);
    expect(
      selectReadResources('$[?@["revision"] == "revision-projected"]', LIMITS, [candidate]),
    ).toEqual([]);
    expect(
      selectReadResources('$[?@.properties.revision == "domain-value"]', LIMITS, [candidate]),
    ).toEqual([candidate]);
  });

  it("parses escaped JSON strings and numeric, boolean, and null literals", () => {
    const candidate = bead("literals", {
      text: 'line\n"quoted"\\slash',
      number: -125,
      enabled: true,
      empty: null,
    });
    const selector =
      '$[?@.properties.text == "line\\n\\"quoted\\"\\\\slash" && @.properties.number == -1.25e2 && @.properties.enabled == true && @.properties.empty == null]';

    expect(selectReadResources(selector, LIMITS, [candidate])).toEqual([candidate]);
    expect(
      selectReadResources("$[?2 <= @.properties.number]", LIMITS, [bead("reverse", { number: 3 })]),
    ).toHaveLength(1);
  });

  it("supports RFC singular bracket names and canonical array indices", () => {
    const candidate = bead("paths", {
      "display name": "ready",
      rows: [{ ignored: true }, { "k.k": "match" }],
    });

    expect(
      selectReadResources(`$[?@["properties"]['display name'] == 'ready']`, LIMITS, [candidate]),
    ).toEqual([candidate]);
    expect(
      selectReadResources('$[?@.properties.rows[1]["k.k"] == "match"]', LIMITS, [candidate]),
    ).toEqual([candidate]);
    expect(
      selectReadResources('$[?@.properties.rows[-1]["k.k"] == "match"]', LIMITS, [candidate]),
    ).toEqual([candidate]);
    expect(
      selectReadResources('$[?@.properties.rows[-2]["ignored"]]', LIMITS, [candidate]),
    ).toEqual([candidate]);
    expect(selectReadResources("$[?@.properties.rows[-3]]", LIMITS, [candidate])).toEqual([]);
    expect(selectReadResources('$[?@.properties.rows[0]["ignored"]]', LIMITS, [candidate])).toEqual(
      [candidate],
    );
  });

  it("supports RFC single-quoted literals and quote-specific escapes", () => {
    const candidate = bead("quoted", {
      apostrophe: "it's ready",
      quote: 'say "yes"',
      escaped: "line\nslash/",
      astral: "🁁",
    });

    expect(
      selectReadResources("$[?@.properties.apostrophe == 'it\\'s ready']", LIMITS, [candidate]),
    ).toEqual([candidate]);
    expect(
      selectReadResources("$[?@.properties.quote == 'say \"yes\"']", LIMITS, [candidate]),
    ).toEqual([candidate]);
    expect(
      selectReadResources("$[?@.properties.escaped == 'line\\nslash\\/']", LIMITS, [candidate]),
    ).toEqual([candidate]);
    expect(
      selectReadResources("$[?@.properties.astral == '\\uD83C\\uDC41']", LIMITS, [candidate]),
    ).toEqual([candidate]);
  });

  it("orders strings lexicographically by Unicode scalar value", () => {
    const bmp = bead("bmp", { value: "\uE000" });
    const astral = bead("astral", { value: "\u{10000}" });

    expect(selectReadResources('$[?@.properties.value < "𐀀"]', LIMITS, [bmp, astral])).toEqual([
      bmp,
    ]);
    expect(selectReadResources('$[?@.properties.value > ""]', LIMITS, [bmp, astral])).toEqual([
      astral,
    ]);
  });

  it.each([
    '$[?@..properties.status == "open"]',
    "$[?@.*]",
    "$[?length(@.properties) == 1]",
    '$[?@.properties.status =~ "open"]',
    "$[?@.properties[?@.status]]",
    "$[?@.properties.left == @.properties.right]",
    "$[?@.properties.a,@.properties.b]",
    "$[?@.properties.value == [1]]",
    '$[?@.properties.value == {"x":1}]',
    "$[?@.properties.status].name",
    "$[?$.properties.status]",
    "$[?@.properties.rows[*]]",
    "$[?@.properties.rows[0:2]]",
    "$[?@.properties.rows[0,1]]",
  ])("rejects excluded feature %s", (selector) => {
    expectSelectorError(selector, "unsupported-feature");
  });

  it.each([
    "",
    "$",
    "$[]",
    "$[?]",
    "$[?true]",
    "$[?@.properties.value ==]",
    "$[?== 1]",
    "$[?@.properties.value = 1]",
    "$[?@.properties.value &&]",
    "$[?(@.properties.value]",
    "$[?@.properties.value)]",
    '$[?@.properties.value == "unterminated] ',
    "$[?@.properties.value == 01]",
    "$[?@.properties.value == NaN]",
    "$[?@.properties.value == true false]",
    "$[?!@.properties.value == true]",
    "$[?!!@.properties.value]",
    "$[?! !@.properties.value]",
    "$[?@.properties.rows[01]]",
    "$[?@.properties.rows[-0]]",
    "$[?@.properties.rows[-01]]",
    "$[?@.properties.rows[9007199254740992]]",
    "$[?@.properties.rows[-9007199254740992]]",
    '$[?@.properties.value == "\\uD800"]',
    '$[?@.properties.value == "\\uDC00"]',
    '$[?@.properties.value == "\\uD800\\uD800"]',
  ])("rejects malformed Selector %s", (selector) => {
    expectSelectorError(selector, "syntax");
  });

  it("enforces exact UTF-8 source-byte boundaries, including Unicode", () => {
    const selector = '$[?@.properties.name == "café☕"]';
    const bytes = new TextEncoder().encode(selector).byteLength;
    const candidate = bead("unicode", { name: "café☕" });

    expect(selectReadResources(selector, { ...LIMITS, bytes }, [candidate])).toEqual([candidate]);
    expect(() =>
      selectReadResources(selector, { ...LIMITS, bytes: bytes - 1 }, [candidate]),
    ).toThrowError(
      expect.objectContaining({
        code: "source-bytes-limit-exceeded",
        actual: bytes,
        limit: bytes - 1,
      }),
    );
  });

  it("enforces exact AST depth and node boundaries without truncation", () => {
    const selector = '$[?@.properties.status == "open"]';
    const candidate = bead("open", { status: "open" });

    expect(
      selectReadResources(selector, { bytes: 1_000, depth: 4, nodes: 5 }, [candidate]),
    ).toEqual([candidate]);
    expect(() =>
      selectReadResources(selector, { bytes: 1_000, depth: 3, nodes: 5 }, [candidate]),
    ).toThrowError(
      expect.objectContaining({ code: "ast-depth-limit-exceeded", actual: 4, limit: 3 }),
    );
    expect(() =>
      selectReadResources(selector, { bytes: 1_000, depth: 4, nodes: 4 }, [candidate]),
    ).toThrowError(
      expect.objectContaining({ code: "ast-nodes-limit-exceeded", actual: 5, limit: 4 }),
    );
  });

  it("bounds pathological nesting, negation, and expression width with typed failures", () => {
    const nested = `$[?${"(".repeat(10_000)}@.id${")".repeat(10_000)}]`;
    const negated = `$[?${"!(".repeat(10_000)}@.id${")".repeat(10_000)}]`;
    const wide = `$[?${Array.from({ length: 10_000 }, () => "@.id").join(" || ")}]`;

    expect(() =>
      selectReadResources(nested, { bytes: 100_000, depth: 32, nodes: 100_000 }, []),
    ).toThrowError(expect.objectContaining({ code: "ast-depth-limit-exceeded" }));
    expect(() =>
      selectReadResources(negated, { bytes: 100_000, depth: 32, nodes: 100_000 }, []),
    ).toThrowError(expect.objectContaining({ code: "ast-depth-limit-exceeded" }));
    expect(() =>
      selectReadResources(wide, { bytes: 100_000, depth: 100_000, nodes: 32 }, []),
    ).toThrowError(expect.objectContaining({ code: "ast-nodes-limit-exceeded" }));
  });

  it("ignores inherited and accessor members without invoking hostile getters", () => {
    let getterCalls = 0;
    let arrayGetterCalls = 0;
    const inherited = Object.create({ properties: { secret: true } }) as Record<string, unknown>;
    Object.defineProperties(inherited, {
      id: { value: "https://beads.example/acme/beads/hostile", enumerable: true },
      type: { value: BEAD_TYPE, enumerable: true },
      revision: { value: "revision-hostile", enumerable: true },
      properties: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("must not run");
        },
      },
    });
    const nullPrototypeProperties = Object.assign(Object.create(null) as Record<string, unknown>, {
      safe: true,
    });
    const safe = bead("safe", nullPrototypeProperties);
    const hostileArray: unknown[] = [];
    Object.defineProperty(hostileArray, "0", {
      enumerable: true,
      get() {
        arrayGetterCalls += 1;
        throw new Error("must not run");
      },
    });
    hostileArray.length = 1;
    const arrayCandidate = bead("array-hostile", { values: hostileArray });

    expect(
      selectReadResources("$[?@.properties.secret]", LIMITS, [inherited as unknown as BeadRecord]),
    ).toEqual([]);
    expect(getterCalls).toBe(0);
    expect(selectReadResources("$[?@.properties.safe == true]", LIMITS, [safe])).toEqual([safe]);
    expect(
      selectReadResources("$[?@.properties.values[0] == true]", LIMITS, [arrayCandidate]),
    ).toEqual([]);
    expect(
      selectReadResources("$[?@.properties.values[-1] == true]", LIMITS, [arrayCandidate]),
    ).toEqual([]);
    expect(arrayGetterCalls).toBe(0);
  });

  it("requires explicit positive safe-integer limits and a primitive string", () => {
    expect(() => selectReadResources("$[?@.id]", { ...LIMITS, bytes: 0 }, [])).toThrow(TypeError);
    expect(() => selectReadResources("$[?@.id]", { ...LIMITS, depth: 1.5 }, [])).toThrow(TypeError);
    expect(() =>
      selectReadResources("$[?@.id]", { ...LIMITS, nodes: Number.MAX_VALUE }, []),
    ).toThrow(TypeError);
    expect(() =>
      selectReadResources(new String("$[?@.id]") as unknown as string, LIMITS, []),
    ).toThrow(TypeError);
  });
});
