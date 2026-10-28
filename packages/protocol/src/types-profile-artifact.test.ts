import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const common = read("specs/profiles/core/bdp-v0.1.schema.json");
const feature = read("specs/profiles/types/types-v1.schema.json");
const publicationPath = "specs/profiles/types/intrinsic-1.json";
const publication = read(publicationPath);
const receipt = read("specs/profiles/types/intrinsic-1.publication.json");
const types = "https://github.com/gastownhall/bdp/capabilities/types";
const lookup = "https://github.com/gastownhall/bdp/capabilities/type-definition-read";
const namespace = "https://github.com/gastownhall/bdp/types/type-system/";
const ajv = new Ajv2020({ strict: true, allErrors: true });
formatsPlugin.default(ajv, { mode: "full" });
ajv.addSchema(common);
ajv.addSchema(feature);

function valid(name: string, value: unknown, schema = feature): boolean {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`missing artifact definition ${name}`);
  return Boolean(validate(value));
}

function discovery(profile: "core" | "write") {
  return {
    bdpVersion: "0.1",
    profile,
    scope: "https://example.test/scope/",
    beads: "https://example.test/scope/beads",
    links: "https://example.test/scope/links",
    events: "https://example.test/scope/events",
    ...(profile === "write"
      ? {
          operations: "https://example.test/scope/operations",
          aliases: "https://example.test/scope/aliases",
        }
      : {}),
  };
}

describe("selected Types source artifacts, without provider or CLI execution", () => {
  it("strictly compiles the supplement against the unchanged common bundle", () => {
    for (const name of Object.keys(feature.$defs))
      expect(ajv.getSchema(`${feature.$id}#/$defs/${name}`)).toBeDefined();
  });

  it.each(["core", "write"] as const)(
    "keeps %s base discovery valid and requires actual nested lookup1 for Types1",
    (profile) => {
      const base = discovery(profile);
      expect(valid("discovery", base)).toBe(true);
      expect(valid("typesDiscovery", base)).toBe(false);
      const detail = { operation: "https://example.test/scope/definition-lookup" };
      const capabilities = {
        [types]: { "1": {}, "2": { future: true } },
        [lookup]: { "1": detail, "2": { future: true } },
      };
      expect(valid("typesDiscovery", { ...base, capabilities })).toBe(true);
      // The feature adds no required root member to the common grammar.
      expect(valid("retainedDiscovery", { ...base, capabilities }, common)).toBe(true);
      for (const bad of [
        { [types]: { "1": {} } },
        { [types]: { "1": {} }, [lookup]: { "2": {} } },
        { [types]: { "1": {} }, [lookup]: { "1": {} } },
        { [types]: { "1": { extra: true } }, [lookup]: { "1": detail } },
        { [types]: { "1": {} }, [lookup]: { "1": { ...detail, extra: true } } },
      ])
        expect(valid("typesDiscovery", { ...base, capabilities: bad })).toBe(false);
      const futureOnly = { ...base, capabilities: { [types]: { "2": { future: true } } } };
      expect(valid("discovery", futureOnly)).toBe(true);
      expect(valid("typesDiscovery", futureOnly)).toBe(false);
      expect(valid("discovery", { ...base, inventedInventory: [] })).toBe(false);
    },
  );

  it("requires exact affiliations on full Beads, Links, owned and incident Link records", () => {
    const bead = publication.definitions[1];
    const link = publication.declarations[0];
    expect(valid("beadRecord", bead)).toBe(true);
    expect(valid("linkRecord", link)).toBe(true);
    // URI-only affiliation is ordinary carried Core data, not a Types output.
    const unpinned = { ...link, type: link.type.uri };
    expect(valid("linkRecord", unpinned, common)).toBe(true);
    expect(valid("linkRecord", unpinned)).toBe(false);
    expect(valid("beadRecord", { ...bead, type: bead.type.uri })).toBe(false);
    for (const [name, record] of [
      ["beadRecord", bead],
      ["linkRecord", link],
    ] as const) {
      const absent = { ...record };
      delete absent.type;
      expect(valid(name, absent, common)).toBe(false);
      expect(valid(name, absent)).toBe(false);
    }
    expect(valid("beadRecord", { ...bead, originScope: "https://receiver.example.test/" })).toBe(
      false,
    );
    expect(
      valid("beadRecord", {
        ...bead,
        ownedLinks: { [link.type.uri]: [unpinned] },
      }),
    ).toBe(false);
    expect(valid("beadRecord", { ...bead, links: { items: [link], next: null } })).toBe(true);
    expect(valid("beadRecord", { ...bead, links: { items: [unpinned], next: null } })).toBe(false);
  });

  it("keeps Bead family pages exact, complete and closed", () => {
    const bead = publication.definitions[1];
    const page = { items: [bead], next: null };
    expect(valid("beadCollection", page)).toBe(true);
    expect(valid("beadCollection", { items: [], next: null })).toBe(true);
    expect(
      valid("beadCollection", { ...page, next: "https://example.test/page?cursor=next" }),
    ).toBe(true);
    const unpinned = { ...bead, type: bead.type.uri };
    expect(valid("beadCollection", { ...page, items: [unpinned] }, common)).toBe(true);
    expect(valid("beadCollection", { ...page, items: [unpinned] })).toBe(false);
    const absent = { ...bead };
    delete absent.type;
    expect(valid("beadCollection", { ...page, items: [absent] })).toBe(false);
    expect(valid("beadCollection", { items: [bead] })).toBe(false);
    expect(valid("beadCollection", { next: null })).toBe(false);
    expect(valid("beadCollection", { ...page, inventedMember: true })).toBe(false);
  });

  it("binds publication bytes and exact metatype pins without inventing an origin", () => {
    const digest = createHash("sha256")
      .update(readFileSync(new URL(publicationPath, root)))
      .digest("hex");
    expect(receipt.sha256).toBe(digest);
    expect(receipt.originScopeRecorded).toBe(false);
    expect(receipt).not.toHaveProperty("originScope");
    expect(publication.definitions).toHaveLength(4);
    expect(publication.declarations).toHaveLength(2);
    const names = ["type", "bead-type", "link-type", "refines"];
    for (const [index, name] of names.entries()) {
      const record = publication.definitions[index];
      expect(record.id).toBe(namespace + name);
      expect(record.revision).toBe(`${name}-1`);
      expect(record.type).toEqual({
        uri: namespace + (name === "refines" ? "link-type" : "bead-type"),
        revision: name === "refines" ? "link-type-1" : "bead-type-1",
      });
      expect(valid("beadRecord", record)).toBe(true);
      expect(record).not.toHaveProperty("originScope");
    }
    expect(publication.definitions[0].properties.abstract).toBe(true);
    expect(publication.definitions[0].ownedLinks).toEqual({});
    expect(publication.definitions[3].ownedLinks).toEqual({});
  });

  it("publishes the exact captured Refines records with distinct source/owner editions", () => {
    const refines = { uri: `${namespace}refines`, revision: "refines-1" };
    for (const [index, name] of ["bead-type", "link-type"].entries()) {
      const owner = publication.definitions[index + 1];
      const link = publication.declarations[index];
      expect(link).toEqual({
        id: `${namespace}${name}-refines-type`,
        revision: "declaration-1",
        type: refines,
        source: `${namespace}${name}`,
        target: { uri: `${namespace}type`, revision: "type-1" },
        properties: {},
      });
      expect(owner.ownedLinks).toEqual({ [refines.uri]: [link] });
      expect(valid("linkRecord", link)).toBe(true);
    }
  });
});
