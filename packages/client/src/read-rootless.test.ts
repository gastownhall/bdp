import { readFileSync } from "node:fs";
import {
  type AbsoluteHttpUrl,
  type BeadRecord,
  parseBeadRecord,
  parseLinkRecord,
} from "@bdp/protocol";
import { describe, expect, it } from "vitest";
import {
  resourceUrl,
  validateBeadSingleton,
  validateLinkSingleton,
} from "./read-record-validation.js";
import { ReadSession } from "./read-session.js";

const scope = "http://127.0.0.1:52186/demo/" as AbsoluteHttpUrl;
// Frozen HTTP200 body from Janet's counterexample, not a prefixed substitute.
const historicalRaw = JSON.parse(
  readFileSync(new URL("./fixtures/rootless-owned-link-bead.json", import.meta.url), "utf8"),
);
const raw = historicalRaw;
const bead = parseBeadRecord(raw);
const link = Object.values(bead.ownedLinks ?? {}).flat()[0];
if (link === undefined) throw new Error("counterexample must retain its owned Link");

function staged(resource: "bead" | "link", id: AbsoluteHttpUrl, body: unknown) {
  const session = new ReadSession(scope);
  const prepared = session.prepare({ kind: "resource", resource, id });
  try {
    expect(
      prepared.route({
        scope,
        beads: `${scope}inventory/items`,
        links: `${scope}inventory/relations`,
        types: `${scope}catalog`,
      }),
    ).toEqual({ kind: "success", value: id });
    return prepared.validate(body);
  } finally {
    prepared.release();
  }
}

describe("rootless Read identities", () => {
  it("accepts exact HTTP identity context and retains its rootless owned Link", () => {
    expect(link.id).toBe(`${scope}nkfpiv`);
    expect(validateBeadSingleton(historicalRaw as BeadRecord, historicalRaw.id, scope)).toBe(
      historicalRaw,
    );
    expect(validateBeadSingleton(bead, bead.id, scope)).toEqual(bead);
    const result = staged("bead", bead.id, raw);
    expect(result.kind).toBe("success");
    if (result.kind === "success") expect(result.value.body).toEqual(bead);
    expect(staged("link", link.id, link).kind).toBe("success");
  });

  it.each([
    "work",
    "projects/alpha/work",
    "a:b",
    "a:b/work",
    "beads/work",
    "links/work",
    "types/work",
  ])("preserves literal IDs %s for either record Kind", (local) => {
    const id = `${scope}${local}` as AbsoluteHttpUrl;
    const rootless = parseBeadRecord({ ...raw, id, ownedLinks: {} });
    expect(validateBeadSingleton(rootless, id, scope).id).toBe(id);
    expect(staged("bead", id, rootless).kind).toBe("success");
    const relation = parseLinkRecord({ ...link, id, source: id, target: `${scope}other` });
    expect(validateLinkSingleton(relation, id, scope).id).toBe(id);
    expect(staged("link", id, relation).kind).toBe("success");
  });

  it("rejects wrong record Kind and requested identity independently of URL spelling", () => {
    expect(staged("bead", link.id, link).kind).not.toBe("success");
    expect(staged("link", bead.id, raw).kind).not.toBe("success");
    expect(staged("bead", `${scope}other`, raw).kind).not.toBe("success");
    expect(staged("link", `${scope}other`, link).kind).not.toBe("success");
  });

  it.each([
    "",
    "/x",
    "../x",
    "%2E/x",
    "x//y",
    "x%2Fy",
    "x%5Cy",
    "%41",
    "%e2%82%ac",
    "x?view=1",
    "x#fragment",
    "x\\y",
  ])("refuses malformed local identity %s", (local) => {
    expect(typeof resourceUrl(scope, `${scope}${local}` as AbsoluteHttpUrl, "bead")).not.toBe(
      "string",
    );
  });

  it.each([
    "http://127.0.0.1:52186/demo2/x",
    "http://127.0.0.1:52186/x",
    "https://outside.example/x",
  ])("does not admit external URL %s as a local Resource", (id) => {
    expect(typeof resourceUrl(scope, id as AbsoluteHttpUrl, "link")).not.toBe("string");
  });

  it("preserves owned-Link source checks and in-Scope endpoint validation", () => {
    const type = link.type;
    expect(() =>
      parseBeadRecord({ ...raw, ownedLinks: { [type]: [{ ...link, source: `${scope}other` }] } }),
    ).toThrow();
    expect(
      staged("link", link.id, { ...link, source: `${scope}%41`, target: "urn:external:target" })
        .kind,
    ).not.toBe("success");
    expect(
      staged("link", link.id, {
        ...link,
        source: "urn:external:source",
        target: "urn:external:target",
      }).kind,
    ).not.toBe("success");
  });
});
