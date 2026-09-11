import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBeadRecord, parseLinkRecord, stringifyJsonValue } from "@bdp/protocol";
import { openRecoveryStore, type RecoveryStore, type StoredResource } from "./recovery-store.js";
import { mayDiscloseRetainedResource } from "./retained-disclosure.js";
const scope = "https://disclosure.test/s/";
const type = "https://types.test/bead",
  linkType = "https://types.test/link";
const dirs: string[] = [],
  stores: RecoveryStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function bead(id: string, extra = {}) {
  return parseBeadRecord({
    id: `${scope}beads/${id}`,
    type,
    revision: "old",
    properties: { retained: true },
    ...extra,
  });
}
function link(id: string, target = `${scope}beads/b`, extra = {}) {
  return parseLinkRecord({
    id: `${scope}links/${id}`,
    type: linkType,
    revision: "old",
    properties: {},
    source: `${scope}beads/a`,
    target,
    ...extra,
  });
}
function store(resources: StoredResource[]) {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-retained-view-"));
  dirs.push(directory);
  const result = openRecoveryStore({
    directory,
    scope,
    installationId: "view",
    lineageId: "fresh-view",
    create: { resources },
  });
  stores.push(result);
  return result;
}
function stored(id: string, record = bead(id)): StoredResource {
  return { kind: "bead", id: `beads/${id}`, bodyJson: stringifyJsonValue(record) };
}

describe("actual current closure over retained postimages", () => {
  it.each(["deleted", "changed"])(
    "uses retained %s Bead including its old inline Link and self-source",
    (condition) => {
      const retained = bead("a", { ownedLinks: { [linkType]: [link("edge")] } });
      const current = store([
        stored("b"),
        ...(condition === "changed"
          ? [stored("a", bead("a", { properties: { current: true } }))]
          : []),
      ]);
      const seen: string[] = [];
      const canRead = vi.fn((record) => {
        seen.push(stringifyJsonValue(record));
        return record.properties.current !== true;
      });
      expect(
        current.read((reader) => mayDiscloseRetainedResource(reader, retained, scope, { canRead })),
      ).toBe(true);
      expect(seen).toContain(stringifyJsonValue(retained));
      expect(seen).toContain(stringifyJsonValue(link("edge")));
      expect(seen.some((text) => text.includes('"current":true'))).toBe(false);
    },
  );
  it.each(["hidden-target", "missing-target", "hidden-link", "hidden-root", "transitive"])(
    "refuses incomplete retained Bead closure: %s",
    (condition) => {
      const retained = bead("a", { ownedLinks: { [linkType]: [link("edge")] } });
      const current = store(
        condition === "missing-target"
          ? []
          : [
              stored(
                "b",
                condition === "transitive"
                  ? bead("b", {
                      ownedLinks: {
                        [linkType]: [
                          link("next", `${scope}beads/missing`, { source: `${scope}beads/b` }),
                        ],
                      },
                    })
                  : bead("b"),
              ),
            ],
      );
      const hidden =
        condition === "hidden-target"
          ? `${scope}beads/b`
          : condition === "hidden-link"
            ? `${scope}links/edge`
            : condition === "hidden-root"
              ? `${scope}beads/a`
              : "";
      expect(
        current.read((reader) =>
          mayDiscloseRetainedResource(reader, retained, scope, {
            canRead: (record) => record.id !== hidden,
          }),
        ),
      ).toBe(false);
    },
  );
  it.each(["source-missing", "target-missing", "source-hidden", "target-hidden", "visible"])(
    "uses current endpoint Beads for retained standalone Link: %s",
    (condition) => {
      const retained = link("edge");
      const current = store([
        ...(condition === "source-missing" ? [] : [stored("a")]),
        ...(condition === "target-missing" ? [] : [stored("b")]),
      ]);
      const hidden =
        condition === "source-hidden"
          ? `${scope}beads/a`
          : condition === "target-hidden"
            ? `${scope}beads/b`
            : "";
      expect(
        current.read((reader) =>
          mayDiscloseRetainedResource(reader, retained, scope, {
            canRead: (record) => record.id !== hidden,
          }),
        ),
      ).toBe(condition === "visible");
    },
  );
  it("does not query opaque endpoints and never replaces retained inline metadata with current standalone Link bytes", () => {
    const retained = bead("a", {
      ownedLinks: {
        [linkType]: [link("edge", "urn:opaque:outside", { properties: { old: true } })],
      },
    });
    const current = store([
      {
        kind: "link",
        id: "links/edge",
        source: "beads/a",
        target: "urn:opaque:outside",
        bodyJson: stringifyJsonValue(
          link("edge", "urn:opaque:outside", { properties: { new: true } }),
        ),
      },
    ]);
    const requested: string[] = [];
    expect(
      current.read((reader) =>
        mayDiscloseRetainedResource(
          {
            resource(id) {
              requested.push(id);
              return reader.resource(id);
            },
          },
          retained,
          scope,
          { canRead: (record) => record.properties.new !== true },
        ),
      ),
    ).toBe(true);
    expect(requested).toEqual([]);
  });
  it("canonical parser refuses incoherent inline source/type/order before disclosure", () => {
    const current = store([stored("a"), stored("b")]);
    const base = { id: `${scope}beads/a`, type, revision: "old", properties: {} };
    for (const links of [
      [link("edge", `${scope}beads/b`, { source: `${scope}beads/b` })],
      [link("z"), link("a")],
      [link("edge"), link("edge")],
    ]) {
      const malformed = { ...base, ownedLinks: { [linkType]: links } };
      expect(() =>
        current.read((reader) =>
          mayDiscloseRetainedResource(reader, malformed as ReturnType<typeof bead>, scope, {
            canRead: () => true,
          }),
        ),
      ).toThrow();
    }
  });
});
