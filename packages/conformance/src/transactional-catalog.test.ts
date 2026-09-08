import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  loadExecutableScenarioManifestJson,
  loadScenarioCatalogJson,
  parseScenarioCatalog,
  retiredScenarioIds,
  selectApplicableScenariosForProfile,
  selectNormativeScenariosForProfile,
  validateCatalogCitations,
} from "./index.js";

/**
 * The drafted Transactional rows are metadata only. They bind normative text
 * so that the profile's obligations are reviewable now, but no executable
 * manifest names this catalog, no fixture realizes it, and no runner can
 * report a row from it — so nothing can claim it. That absence is asserted
 * here so it cannot erode silently. What is checked is structure and
 * citation consistency — the rows parse, every excerpt still appears in
 * its anchored section, the rows mirror the specification's table in
 * order, and the ten retired Read+Update rows are named and excluded from
 * a Transactional claim (T48) — never the behavior a row describes.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (relativePath: string): string =>
  readFileSync(path.resolve(root, relativePath), "utf8");

const CATALOG_PATH = "packages/conformance/catalog/transactional-v1.json";
const READ_UPDATE_CATALOG_PATH = "packages/conformance/catalog/read-update-v1.json";
const READ_CATALOG_PATH = "packages/conformance/catalog/read-v1.json";
const MATRICES_DIRECTORY = "packages/conformance/matrices";

/** The Read+Update rows a Transactional Scope contradicts, and the rows that retire them. */
const RETIREMENTS: Readonly<Record<string, readonly string[]>> = {
  "transactional.discovery.document": ["read-update.discovery.document"],
  "transactional.discovery.limits": ["read-update.discovery.limits"],
  "transactional.discovery.operation-directory": ["read-update.discovery.operation-directory"],
  "transactional.singleton.receipt": ["read-update.singleton.result-headers"],
  "transactional.idempotency.concurrent-join": ["read-update.idempotency.in-progress"],
  "transactional.receipt.reauthorization": ["read-update.idempotency.authorization-view"],
  "transactional.discovery.no-idempotency-retention": ["read-update.idempotency.retention-minimum"],
  "transactional.idempotency.expired-detail": ["read-update.idempotency.expired"],
  "transactional.idempotency.failed-retained": ["read-update.idempotency.expired-failure"],
  "transactional.restore.key-namespace": ["read-update.idempotency.restore"],
};

describe("draft Transactional catalog", () => {
  const catalog = loadScenarioCatalogJson(readText(CATALOG_PATH), "transactional-v1.json");
  const readUpdateCatalog = loadScenarioCatalogJson(
    readText(READ_UPDATE_CATALOG_PATH),
    "read-update-v1.json",
  );
  const readCatalog = loadScenarioCatalogJson(readText(READ_CATALOG_PATH), "read-v1.json");
  const ids = catalog.scenarios.map(({ id }) => id);

  it("strictly parses and binds every citation to the current specification text", () => {
    expect(catalog.catalogVersion).toBe(1);
    expect(catalog.scenarios.length).toBe(113);
    validateCatalogCitations(catalog, (source) => readText(source), "transactional-v1.json");
  });

  it("scopes every row to the Transactional profile with the profile's id prefix and area", () => {
    const areas = new Set<string>();
    for (const scenario of catalog.scenarios) {
      expect(scenario.requiredProfile, scenario.id).toBe("transactional");
      expect(scenario.kind, scenario.id).toBe("normative");
      expect(scenario.id, scenario.id).toMatch(/^transactional\.[a-z-]+\.[a-z0-9-]+$/);
      areas.add(scenario.id.split(".")[1] ?? "");
      expect(scenario.requirements.every(({ source }) => source === "docs/specs/bdp.md")).toBe(
        true,
      );
    }
    expect([...areas].sort()).toEqual([
      "batch",
      "changefeed",
      "discovery",
      "erasure",
      "event",
      "http",
      "idempotency",
      "receipt",
      "restore",
      "sequence",
      "set",
      "singleton",
      "snapshot",
    ]);
    expect(selectNormativeScenariosForProfile(catalog, "read").map(({ id }) => id)).toEqual([]);
    expect(selectNormativeScenariosForProfile(catalog, "read-update").map(({ id }) => id)).toEqual(
      [],
    );
  });

  it("does not collide with the sealed Read catalog or the drafted Read+Update catalog", () => {
    const taken = new Set([
      ...readCatalog.scenarios.map(({ id }) => id),
      ...readUpdateCatalog.scenarios.map(({ id }) => id),
    ]);
    for (const id of ids) expect(taken.has(id), id).toBe(false);
  });

  it("retires exactly the ten Read+Update rows the profile contradicts, each a lower-profile row", () => {
    const readUpdateIds = new Map(readUpdateCatalog.scenarios.map((row) => [row.id, row] as const));
    const retiring = Object.fromEntries(
      catalog.scenarios
        .filter((scenario) => scenario.retires !== undefined)
        .map((scenario) => [scenario.id, scenario.retires]),
    );
    expect(retiring).toEqual(RETIREMENTS);
    for (const retired of Object.values(RETIREMENTS).flat()) {
      const row = readUpdateIds.get(retired);
      expect(row, retired).toBeDefined();
      expect(row?.requiredProfile, retired).toBe("read-update");
    }
    expect(new Set(Object.values(RETIREMENTS).flat()).size).toBe(10);
  });

  it("excludes the retired rows from a Transactional claim over the concatenated catalogs and keeps them below", () => {
    const combined = parseScenarioCatalog({
      catalogVersion: 1,
      scenarios: [...readCatalog.scenarios, ...readUpdateCatalog.scenarios, ...catalog.scenarios],
    });
    const retired = new Set(Object.values(RETIREMENTS).flat());
    expect([...retiredScenarioIds(combined, "transactional")].sort()).toEqual([...retired].sort());
    expect([...retiredScenarioIds(combined, "read-update")]).toEqual([]);
    const transactional = selectNormativeScenariosForProfile(combined, "transactional").map(
      ({ id }) => id,
    );
    for (const id of retired) expect(transactional, id).not.toContain(id);
    for (const id of ids) expect(transactional, id).toContain(id);
    const inheritedReadUpdate = readUpdateCatalog.scenarios
      .filter(({ id, kind }) => kind === "normative" && !retired.has(id))
      .map(({ id }) => id);
    for (const id of inheritedReadUpdate) expect(transactional, id).toContain(id);
    const readUpdate = selectApplicableScenariosForProfile(combined, "read-update").map(
      ({ id }) => id,
    );
    for (const id of retired) expect(readUpdate, id).toContain(id);
    for (const id of ids) expect(readUpdate, id).not.toContain(id);
  });

  it("is bound by no executable manifest, so no runner report can carry its rows", () => {
    const manifests = readdirSync(path.resolve(root, MATRICES_DIRECTORY)).filter((entry) =>
      entry.endsWith(".json"),
    );
    expect(manifests.length).toBeGreaterThan(0);
    for (const entry of manifests) {
      const manifest = loadExecutableScenarioManifestJson(
        readText(path.join(MATRICES_DIRECTORY, entry)),
        entry,
      );
      expect(manifest.catalogId, entry).not.toBe("transactional-v1");
      const bound = new Set(manifest.scenarios.map(({ id }) => id));
      for (const id of ids) expect(bound.has(id), `${entry} binds ${id}`).toBe(false);
    }
  });

  it("mirrors the specification's Transactional conformance rows exactly and in order", () => {
    const specification = readText("docs/specs/bdp.md");
    const start = specification.indexOf("\n#### Transactional conformance rows\n");
    expect(start).toBeGreaterThan(0);
    const section = specification.slice(start + 1);
    const bodyStart = section.indexOf("\n") + 1;
    const end = section.slice(bodyStart).search(/^#{1,4} /m);
    const rows = [
      ...(end < 0 ? section : section.slice(0, bodyStart + end)).matchAll(
        /^\| `([a-z0-9.-]+)` \| /gm,
      ),
    ].map((match) => match[1]);
    expect(rows).toEqual(ids);
    // The retirements are stated in the same subsection, one bullet each.
    for (const [retiring, retired] of Object.entries(RETIREMENTS)) {
      expect(section).toContain(`- \`${retiring}\` retires \`${retired[0]}\``);
    }
  });
});
