import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { BDP_V0_SCHEMA_ID, compareCanonicalIds, type Reference, referenceUri } from "./index.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";

/**
 * The wildcard ownership entry — `ownsOutgoing["*"]`, ruled 2026-09-08 and
 * transcribed under Owned Links, with the judgments the ruling left open
 * recorded as OW1–OW8 in `docs/design/owned-wildcard-decisions.md` — held
 * in lockstep from two sides: the bundle's `ownsOutgoing` and `ownedLinks`
 * shapes, and the checked-in `fixtures/owned-wildcard` example. This checks
 * structure and example consistency — the bundle admits the wildcard where
 * the ruling puts it and nowhere else, the fixture validates, its records
 * follow the present-plus-declared entry rule and the bounds, and its
 * descriptors keep every explicit max within the wildcard's (OW1, ruled A
 * 2026-09-08: a descriptor-validation rule beyond the schema, checked here
 * by a small validator because the bundle cannot compare two members). It
 * establishes none of the behavior: no target served these records, and
 * none of this is conformance evidence.
 */
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = JSON.parse(
  readFileSync(path.join(workspaceRoot, "schemas", "bdp-v0.schema.json"), "utf8"),
) as SchemaRecord;
const fixture = JSON.parse(
  readFileSync(
    path.join(workspaceRoot, "fixtures", "owned-wildcard", "owned-wildcard.json"),
    "utf8",
  ),
) as OwnedWildcardFixture;

type SchemaRecord = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;

interface FixtureDescriptor extends JsonRecord {
  readonly id: string;
  readonly describes: "bead" | "link";
  readonly ownsOutgoing?: Readonly<
    Record<string, { readonly label?: string; readonly max: number }>
  >;
}

interface FixtureLink extends JsonRecord {
  readonly id: string;
  readonly type: string;
  readonly source: Reference;
  readonly target: Reference;
}

interface FixtureRecord extends JsonRecord {
  readonly id: string;
  readonly type: string;
  readonly ownedLinks?: Readonly<Record<string, readonly FixtureLink[]>>;
}

interface RejectedShape {
  readonly id: string;
  readonly schema: string;
  /**
   * Absent: the bundle rejects the shape. "descriptor-validation": the
   * bundle accepts it and descriptor validation refuses it (OW1, ruled A).
   */
  readonly rejectedBy?: "descriptor-validation";
  readonly reason: string;
  readonly value: unknown;
}

interface OwnedWildcardFixture {
  readonly fixtureVersion: number;
  readonly id: string;
  readonly description: string;
  readonly scope: string;
  readonly wildcardOwner: string;
  readonly wildcardOnlyOwner: string;
  readonly descriptors: readonly FixtureDescriptor[];
  readonly records: readonly FixtureRecord[];
  readonly rejected: readonly RejectedShape[];
}

const WILDCARD = "*";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
ajv.addSchema(schema);

describe("ownsOutgoing wildcard entry in the bundle", () => {
  const ownsOutgoing = requiredRecord(
    propertiesOf("typeDescriptor").ownsOutgoing,
    "typeDescriptor.properties.ownsOutgoing",
  );

  it("keys entries by the literal wildcard or a Link Type URL, and nothing else", () => {
    expect(ownsOutgoing.minProperties).toBe(1);
    expect(ownsOutgoing.propertyNames).toEqual({
      anyOf: [{ const: WILDCARD }, { $ref: "#/$defs/absoluteHttpUrl" }],
    });
    // The wildcard key is validated by its own closed declaration; every
    // other key is an explicit entry and keeps the { label?, max } shape.
    expect(ownsOutgoing.properties).toEqual({
      [WILDCARD]: { $ref: "#/$defs/ownedWildcardDeclaration" },
    });
    expect(ownsOutgoing.additionalProperties).toEqual({ $ref: "#/$defs/ownedLinkDeclaration" });
  });

  it("closes the wildcard declaration to exactly max, and leaves the explicit one as it was", () => {
    expect(def("ownedWildcardDeclaration")).toEqual({
      type: "object",
      required: ["max"],
      properties: { max: { $ref: "#/$defs/positiveInteger" } },
      additionalProperties: false,
    });
    expect(def("ownedLinkDeclaration")).toEqual({
      type: "object",
      required: ["max"],
      properties: {
        label: { type: "string", minLength: 1 },
        max: { $ref: "#/$defs/positiveInteger" },
      },
      additionalProperties: false,
    });
  });

  it("admits the wildcard alone, beside explicit entries, and on Bead Types only", () => {
    expectValid("#/$defs/typeDescriptor", beadTypeDescriptor({ [WILDCARD]: { max: 1 } }));
    expectValid(
      "#/$defs/typeDescriptor",
      beadTypeDescriptor({
        [WILDCARD]: { max: 64 },
        "https://memory.example/types/cites": { label: "cites", max: 16 },
      }),
    );
    expectInvalid("#/$defs/typeDescriptor", {
      ...linkTypeDescriptor(),
      ownsOutgoing: { [WILDCARD]: { max: 1 } },
    });
  });

  it("rejects a wildcard without max, with a label, with a non-positive bound, or misspelled", () => {
    expectInvalid("#/$defs/typeDescriptor", beadTypeDescriptor({ [WILDCARD]: {} }));
    expectInvalid(
      "#/$defs/typeDescriptor",
      beadTypeDescriptor({ [WILDCARD]: { label: "references", max: 1 } }),
    );
    expectInvalid("#/$defs/typeDescriptor", beadTypeDescriptor({ [WILDCARD]: { max: 0 } }));
    expectInvalid("#/$defs/typeDescriptor", beadTypeDescriptor({ [WILDCARD]: { max: 1.5 } }));
    for (const key of ["**", "*/", " *", "any", "urn:any"]) {
      expectInvalid("#/$defs/typeDescriptor", beadTypeDescriptor({ [key]: { max: 1 } }));
    }
  });

  it("keeps the ownedLinks record member keyed by Link Type URL alone", () => {
    expect(propertiesOf("beadRecord").ownedLinks).toMatchObject({
      type: "object",
      propertyNames: { $ref: "#/$defs/absoluteHttpUrl" },
    });
    expectValid("#/$defs/beadRecord", { ...beadRecord(), ownedLinks: {} });
    expectValid("#/$defs/beadRecord", {
      ...beadRecord(),
      ownedLinks: { "https://memory.example/types/cites": [] },
    });
    expectInvalid("#/$defs/beadRecord", { ...beadRecord(), ownedLinks: { [WILDCARD]: [] } });
  });
});

describe("owned-wildcard fixture", () => {
  const explicitTypes = (descriptor: FixtureDescriptor): readonly string[] =>
    Object.keys(descriptor.ownsOutgoing ?? {}).filter((key) => key !== WILDCARD);
  const descriptorOf = (typeId: string): FixtureDescriptor => {
    const descriptor = fixture.descriptors.find(({ id }) => id === typeId);
    if (descriptor === undefined) throw new Error(`fixture describes no Type ${typeId}`);
    return descriptor;
  };
  const recordOf = (beadId: string): FixtureRecord => {
    const record = fixture.records.find(({ id }) => id === beadId);
    if (record === undefined) throw new Error(`fixture carries no record ${beadId}`);
    return record;
  };

  it("is a version-1 illustrative fixture whose descriptors, records, and rejections validate as declared", () => {
    expect(fixture.fixtureVersion).toBe(1);
    expect(fixture.id).toBe("owned-wildcard");
    expect(fixture.scope).toBe("https://beads.example/acme/");
    expect(fixture.description).toContain("not evidence");
    for (const descriptor of fixture.descriptors) {
      expectValid("#/$defs/typeDescriptor", descriptor, descriptor.id);
    }
    for (const record of fixture.records) {
      expectValid("#/$defs/beadRecord", record, record.id);
    }
    expect(new Set(fixture.rejected.map(({ id }) => id)).size).toBe(fixture.rejected.length);
    for (const rejected of fixture.rejected) {
      expect(rejected.reason.length, rejected.id).toBeGreaterThan(0);
      if (rejected.rejectedBy === "descriptor-validation") {
        // OW1, ruled A: schema-valid, refused beyond the schema.
        expectValid(rejected.schema, rejected.value, rejected.id);
        expect(explicitMaxWithinWildcard(rejected.value), rejected.id).toBe(false);
      } else {
        expectInvalid(rejected.schema, rejected.value, rejected.id);
      }
    }
  });

  it("names the shapes the ruling rules out", () => {
    expect(fixture.rejected.map(({ id }) => id)).toEqual([
      "wildcard-without-max",
      "wildcard-with-label",
      "wildcard-max-zero",
      "wildcard-on-link-type",
      "wildcard-as-record-key",
      "explicit-max-exceeds-wildcard",
    ]);
  });

  it("declares a Memory-like owner with the wildcard beside one explicit type, and a wildcard-only owner", () => {
    const memory = descriptorOf(fixture.wildcardOwner);
    expect(memory.describes).toBe("bead");
    expect(memory.ownsOutgoing?.[WILDCARD]).toEqual({ max: 64 });
    expect(explicitTypes(memory)).toEqual(["https://memory.example/types/cites"]);
    expect(memory.ownsOutgoing?.["https://memory.example/types/cites"]).toEqual({
      label: "cites",
      max: 16,
    });

    // OW3: the wildcard may be the only entry.
    const note = descriptorOf(fixture.wildcardOnlyOwner);
    expect(note.describes).toBe("bead");
    expect(Object.keys(note.ownsOutgoing ?? {})).toEqual([WILDCARD]);

    // Only Bead Types own: no Link Type Descriptor in the fixture carries ownsOutgoing.
    for (const descriptor of fixture.descriptors) {
      if (descriptor.describes === "link")
        expect(descriptor.ownsOutgoing, descriptor.id).toBeUndefined();
    }
  });

  it("carries owned Links of two Link Types the owner never names, plus the explicit type's empty entry", () => {
    const memory = descriptorOf(fixture.wildcardOwner);
    const bead = recordOf(`${fixture.scope}beads/mem-1`);
    expect(bead.type).toBe(memory.id);
    const ownedLinks = bead.ownedLinks ?? {};
    const entries = Object.entries(ownedLinks);

    // Present-only entries for wildcard-owned types; an entry, empty here,
    // for the explicitly declared type; never the wildcard as a key.
    const explicit = explicitTypes(memory);
    const wildcardOwned = entries.filter(([key]) => !explicit.includes(key));
    expect(wildcardOwned.map(([key]) => key)).toEqual([
      "https://memory.example/types/contradicts",
      "https://memory.example/types/supports",
    ]);
    for (const [key, links] of wildcardOwned) {
      expect(links.length, key).toBeGreaterThan(0);
    }
    for (const key of explicit) expect(ownedLinks[key], key).toEqual([]);
    expect(Object.keys(ownedLinks)).not.toContain(WILDCARD);

    // Every entry inlines complete records of that type from this source, in
    // ascending code-unit id order, keyed by a Link Type the fixture describes.
    const linkTypes = new Set(
      fixture.descriptors.filter(({ describes }) => describes === "link").map(({ id }) => id),
    );
    for (const [key, links] of entries) {
      expect(linkTypes.has(key), key).toBe(true);
      for (const link of links) {
        expectValid("#/$defs/linkRecord", link, link.id);
        expect(link.type, link.id).toBe(key);
        expect(referenceUri(link.source), link.id).toBe(bead.id);
      }
      const ids = links.map(({ id }) => id);
      expect(ids, key).toEqual([...ids].sort(compareCanonicalIds));
    }

    // OW1: the wildcard's max bounds the whole owned set, the explicit type's
    // Links included; the explicit entry's own max bounds that type.
    const total = entries.reduce((count, [, links]) => count + links.length, 0);
    expect(total).toBeLessThanOrEqual(memory.ownsOutgoing?.[WILDCARD]?.max ?? 0);
    for (const key of explicit) {
      expect(ownedLinks[key]?.length ?? 0, key).toBeLessThanOrEqual(
        memory.ownsOutgoing?.[key]?.max ?? 0,
      );
    }
  });

  it("serves the member, possibly empty, whenever the Type owns — and nothing for absent wildcard-owned types", () => {
    // OW4: a wildcard-only owner with nothing present carries an empty member.
    expect(recordOf(`${fixture.scope}beads/note-1`).ownedLinks).toEqual({});
    // An owner whose wildcard-owned types are all absent carries only the
    // explicitly declared type's (empty) entry.
    expect(recordOf(`${fixture.scope}beads/mem-2`).ownedLinks).toEqual({
      "https://memory.example/types/cites": [],
    });
    for (const record of fixture.records) {
      const owns = descriptorOf(record.type).ownsOutgoing !== undefined;
      expect(record.ownedLinks !== undefined, record.id).toBe(owns);
    }
  });

  it("keeps every in-Scope owned target inside the fixture, so the closure it illustrates is visible", () => {
    const beadIds = new Set(fixture.records.map(({ id }) => id));
    for (const record of fixture.records) {
      for (const links of Object.values(record.ownedLinks ?? {})) {
        for (const link of links) {
          const target = referenceUri(link.target);
          if (target.startsWith(fixture.scope)) expect(beadIds.has(target), link.id).toBe(true);
        }
      }
    }
  });
});

describe("explicit max bounded by the wildcard's max (OW1, ruled A 2026-09-08)", () => {
  const cites = "https://memory.example/types/cites";

  it("is a descriptor-validation rule beyond the schema: the bundle accepts what the validator refuses", () => {
    const exceeds = beadTypeDescriptor({
      [WILDCARD]: { max: 8 },
      [cites]: { label: "cites", max: 16 },
    });
    expectValid("#/$defs/typeDescriptor", exceeds);
    expect(explicitMaxWithinWildcard(exceeds)).toBe(false);
  });

  it("accepts an explicit max at or below the wildcard's, and descriptors without a wildcard", () => {
    expect(
      explicitMaxWithinWildcard(
        beadTypeDescriptor({ [WILDCARD]: { max: 16 }, [cites]: { max: 16 } }),
      ),
    ).toBe(true);
    expect(
      explicitMaxWithinWildcard(
        beadTypeDescriptor({ [WILDCARD]: { max: 16 }, [cites]: { max: 8 } }),
      ),
    ).toBe(true);
    expect(explicitMaxWithinWildcard(beadTypeDescriptor({ [cites]: { max: 16 } }))).toBe(true);
    expect(explicitMaxWithinWildcard(linkTypeDescriptor())).toBe(true);
  });

  it("holds for every descriptor the fixture serves", () => {
    for (const descriptor of fixture.descriptors) {
      expect(explicitMaxWithinWildcard(descriptor), descriptor.id).toBe(true);
    }
  });
});

function beadTypeDescriptor(ownsOutgoing: SchemaRecord): SchemaRecord {
  return {
    id: "https://memory.example/types/memory",
    name: "Memory",
    describes: "bead",
    conformsTo: [],
    ownsOutgoing,
  };
}

function linkTypeDescriptor(): SchemaRecord {
  return {
    id: "https://memory.example/types/cites",
    name: "Cites",
    describes: "link",
    conformsTo: [],
    source: { conformsTo: [] },
    target: { conformsTo: [] },
  };
}

function beadRecord(): SchemaRecord {
  return {
    id: "https://beads.example/acme/beads/mem-1",
    type: "https://memory.example/types/memory",
    revision: "mem-1-r3",
    properties: {},
  };
}

function expectValid(pointer: string, value: unknown, label?: string): void {
  const validate = compiled(pointer);
  expect(validate(value), `${label ?? pointer}: ${JSON.stringify(validate.errors, null, 2)}`).toBe(
    true,
  );
}

function expectInvalid(pointer: string, value: unknown, label?: string): void {
  expect(compiled(pointer)(value), label ?? pointer).toBe(false);
}

function compiled(pointer: string): ValidateFunction {
  const validate = ajv.getSchema(`${BDP_V0_SCHEMA_ID}${pointer}`);
  if (validate === undefined) throw new Error(`schema definition not found: ${pointer}`);
  return validate;
}

function def(name: string): SchemaRecord {
  return requiredRecord(requiredRecord(schema.$defs, "$defs")[name], `$defs.${name}`);
}

function propertiesOf(definitionName: string): SchemaRecord {
  return requiredRecord(def(definitionName).properties, `$defs.${definitionName}.properties`);
}

function requiredRecord(value: unknown, pathLabel: string): SchemaRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${pathLabel} must be a record`);
  }
  return value as SchemaRecord;
}

/**
 * OW1, ruled A (2026-09-08): an explicitly declared entry's max MUST NOT
 * exceed the wildcard's max in the same descriptor. The rule compares two
 * members, which the bundle cannot express, so it is descriptor validation
 * beyond the schema — a descriptor the bundle accepts can still fail it.
 * Assumes a schema-valid descriptor; one without a wildcard holds trivially.
 */
function explicitMaxWithinWildcard(descriptor: unknown): boolean {
  const ownsOutgoing = requiredRecord(descriptor, "descriptor").ownsOutgoing;
  if (ownsOutgoing === undefined) return true;
  const entries = requiredRecord(ownsOutgoing, "ownsOutgoing");
  const wildcard = entries[WILDCARD];
  if (wildcard === undefined) return true;
  const bound = requiredRecord(wildcard, 'ownsOutgoing["*"]').max;
  if (typeof bound !== "number") return false;
  return Object.entries(entries).every(([key, declaration]) => {
    if (key === WILDCARD) return true;
    const max = requiredRecord(declaration, `ownsOutgoing[${key}]`).max;
    return typeof max === "number" && max <= bound;
  });
}
