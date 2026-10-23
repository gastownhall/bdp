import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { BDP_V0_SCHEMA_ID, isReadDiscovery } from "./index.js";

const root = new URL("../../../", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), "utf8");
const legacyText = read("specs/profiles/core/bdp-v0.schema.json");
const candidateText = read("specs/profiles/core/bdp-v0.1.schema.json");
const candidate = JSON.parse(candidateText);
const cases = JSON.parse(read("fixtures/contract-binding/candidate.json"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(candidate);
const validate = (name: string, value: unknown) => {
  const validator = ajv.getSchema(`${candidate.$id}#/$defs/${name}`);
  if (!validator) throw new Error(`missing candidate definition: ${name}`);
  return validator(value);
};

describe("staged contract artifact binding, without a runtime upgrade", () => {
  it("binds the canonical artifact, distribution export and CLI specification identity", () => {
    expect(candidate.$id).toBe(cases.binding.specification);
    expect(candidate.$defs.bdpVersion.const).toBe(cases.binding.bdpVersion);
    expect(read("packages/protocol/schemas/bdp-v0.1.schema.json")).toBe(candidateText);
    const manifest = JSON.parse(read("packages/protocol/package.json"));
    expect(manifest.exports["./schemas/bdp-v0.1.schema.json"]).toEqual({
      default: "./schemas/bdp-v0.1.schema.json",
    });
    for (const path of [
      "specs/profiles/core/contract-binding.md",
      "docs/cli-design/contract-binding.md",
    ]) {
      const text = read(path);
      expect(text).toContain(cases.binding.specification);
      expect(text).toContain(cases.binding.jsonMediaType);
    }
  });

  it("preserves the held v0 artifact and runtime identity at the source boundary", () => {
    expect(createHash("sha256").update(legacyText).digest("hex")).toBe(
      "15104f001d41290c130b22999ceafe3bb9e83e8aa36db3f7aee2de06c268a327",
    );
    expect(read("packages/protocol/schemas/bdp-v0.schema.json")).toBe(legacyText);
    expect(JSON.parse(legacyText).$id).toBe(BDP_V0_SCHEMA_ID);
    expect(isReadDiscovery(cases.legacyDiscovery)).toBe(true);
    expect(isReadDiscovery({ ...cases.legacyDiscovery, bdpVersion: "0.1" })).toBe(false);
  });

  it("admits only the exact new version rather than a number or compatibility range", () => {
    expect(validate("bdpVersion", "0.1")).toBe(true);
    for (const value of ["0", "1", "0.1.1", ">=0.1", 0.1, null, ""])
      expect(validate("bdpVersion", value), JSON.stringify(value)).toBe(false);
  });

  it("accepts staged discovery with optional unknown capability versions", () => {
    // The fixture's inherited profile token is staging input, not a profile-cut ruling.
    expect(validate("readDiscovery", cases.candidateDiscovery)).toBe(true);
    const { capabilities: _capabilities, ...base } = cases.candidateDiscovery;
    expect(validate("readDiscovery", base)).toBe(true);
    expect(validate("readDiscovery", { ...base, bdpVersion: "0" })).toBe(false);
    expect(validate("readDiscovery", { ...base, futureTopLevelFeature: {} })).toBe(false);
  });

  it("allows two exact versions without overwriting feature-owned details", () => {
    const value = {
      "urn:example:feature": {
        "1": { maximumItems: 20 },
        "2": { maximumItems: 40, futureDetail: { enabled: true } },
      },
    };
    const before = structuredClone(value);
    expect(validate("capabilityAdvertisements", value)).toBe(true);
    expect(value).toEqual(before);
  });

  it("rejects malformed advertisements without opening arbitrary base fields", () => {
    for (const value of [
      { relativeName: { "1": {} } },
      { "urn:example:feature": {} },
      { "urn:example:feature": { "": {} } },
      { "urn:example:feature": { "1": null } },
      { "urn:example:feature": { "1": [] } },
      { "urn:example:feature": "1" },
    ])
      expect(validate("capabilityAdvertisements", value), JSON.stringify(value)).toBe(false);
  });

  it("compiles every candidate definition without unresolved or cross-version references", () => {
    const inspect = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if ((key === "$ref" || key === "$dynamicRef") && typeof value === "string")
          expect(value.startsWith(BDP_V0_SCHEMA_ID), value).toBe(false);
        inspect(value);
      }
    };
    inspect(candidate);
    for (const name of Object.keys(candidate.$defs))
      expect(ajv.getSchema(`${candidate.$id}#/$defs/${name}`), name).toBeDefined();
  });
});
