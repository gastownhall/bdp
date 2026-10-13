import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ProtocolProfile } from "@bdp/protocol";
import { describe, expect, it } from "vitest";
import {
  assertSameServedProfileConfiguration,
  bindServedProfileConfiguration,
  loadProfileContractSelection,
  planProfileExecution,
  type ServedProfileConfiguration,
} from "../test-support/profile-contract-plan.js";
import { loadScenarioCatalogJson } from "./catalog.js";
import type { ExecutableScenarioManifest } from "./executable-manifest.js";

const read = (name: string) => readFileSync(new URL(`../catalog/${name}`, import.meta.url), "utf8");
const readManifest = JSON.parse(
  readFileSync(new URL("../matrices/read-v1.json", import.meta.url), "utf8"),
) as ExecutableScenarioManifest;
const configuration = (profile: ProtocolProfile = "read-update"): ServedProfileConfiguration => ({
  scope: "http://127.0.0.1:43210/",
  profile,
  history: false,
  sourceCommit: "a".repeat(40),
  installedPayloadDigest: "b".repeat(64),
  installedContractsDigest: "c".repeat(64),
  policyDigest: "d".repeat(64),
  authenticationDigest: "e".repeat(64),
  fixtureDigest: "f".repeat(64),
  fixtureId: "reference-read-v1",
  capabilities: ["public-http"],
});
const manifestSource = (manifest: ExecutableScenarioManifest) => ({
  bytes: Buffer.from(JSON.stringify(manifest)),
  label: "planning-only",
});
const mutation =
  (file: string, change: (catalog: ReturnType<typeof JSON.parse>) => void) => (name: string) => {
    const parsed = JSON.parse(read(name));
    if (name === file) change(parsed);
    return JSON.stringify(parsed);
  };

// Real current catalog sources are the oracle. No mirrored required-ID list.
describe("source-private cumulative required contracts", () => {
  it.each(["read", "read-update", "transactional"] as const)(
    "derives %s obligations with companions, excluding diagnostics and optional History",
    (profile) => {
      const selected = loadProfileContractSelection(profile);
      expect(selected.required.every((row) => row.kind === "normative")).toBe(true);
      expect(selected.required.some((row) => row.id.startsWith("history."))).toBe(false);
      expect(new Set(selected.required.map((row) => row.id)).size).toBe(selected.required.length);
      expect(selected.required.map((row) => row.id)).not.toContain(
        "read.discovery.unsupported-client-input",
      );
      for (const file of ["numeric-model-v1.json", "owned-wildcard-v1.json"])
        for (const row of loadScenarioCatalogJson(read(file)).scenarios)
          if (row.requiredProfile === "read" || profile !== "read")
            expect(
              selected.required.map((entry) => entry.id),
              row.id,
            ).toContain(row.id);
    },
  );

  it("replaces closed Read discovery at RU and retains its retirement at TX", () => {
    const readIds = loadProfileContractSelection("read").required.map((row) => row.id);
    const ru = loadProfileContractSelection("read-update");
    const tx = loadProfileContractSelection("transactional");
    expect(readIds).toContain("read.discovery.document");
    expect(ru.retiredIds).toEqual(["read.discovery.document"]);
    expect(ru.required.map((row) => row.id)).toContain("read-update.discovery.document");
    expect(tx.retiredIds).toContain("read.discovery.document");
    for (const selected of [ru, tx]) {
      expect(selected.required.map((row) => row.id)).not.toContain("read.discovery.document");
      expect(selected.required.map((row) => row.id)).toContain("read.discovery.optional-limits");
    }
    const explicitTxRetirements = loadScenarioCatalogJson(
      read("transactional-v1.json"),
    ).scenarios.flatMap((row) => row.retires ?? []);
    expect(explicitTxRetirements).toHaveLength(12);
    expect(tx.retiredIds).toEqual([...explicitTxRetirements, "read.discovery.document"].sort());
    for (const id of tx.retiredIds) expect(tx.required.map((row) => row.id)).not.toContain(id);
  });

  it("keeps the TX sequence envelope and shared code/limit laws while replacing direct forms", () => {
    const selected = loadProfileContractSelection("transactional");
    const ids = selected.required.map((row) => row.id);
    for (const id of [
      "read-update.sequence.member-problem-shape",
      "read-update.sequence.order-and-partial-commit",
      "read-update.sequence.retained-failure",
      "read-update.sequence.idempotent-retry",
      "read-update.sequence.disconnect",
      "read-update.problem.table",
      "read-update.http.cache-no-store",
      "read-update.http.request-too-large",
      "read.discovery.optional-limits",
    ])
      expect(ids, id).toContain(id);
    const spec = readFileSync(new URL("../../../docs/specs/bdp.md", import.meta.url), "utf8");
    expect(spec).toContain("| `sequence` | `POST` | `200` envelope");
    expect(spec).toContain("its envelope, its member records, its declaration order, its separate");
    const noOp = selected.required.find(
      (row) => row.id === "read-update.singleton.owned-link-no-op",
    );
    expect(
      noOp?.requirements.some(({ selectedText }) =>
        selectedText.includes("has no durable Mutation Receipts"),
      ),
    ).toBe(false);
  });

  it("requires the inherited catalog rather than accepting a delta-only source", () => {
    expect(() =>
      loadProfileContractSelection("transactional", false, (name) =>
        name === "read-v1.json" ? '{"catalogVersion":1,"scenarios":[]}' : read(name),
      ),
    ).toThrow("empty required catalog");
    expect(() =>
      loadProfileContractSelection("transactional", false, () => read("transactional-v1.json")),
    ).toThrow("duplicate or conflicting");
  });

  it("rejects conflicting companion copies, repeated retirements and unknown retirement targets", () => {
    expect(() =>
      loadProfileContractSelection(
        "read-update",
        false,
        mutation("numeric-model-v1.json", (catalog) => {
          catalog.scenarios.find(
            (row: { requiredProfile: string }) => row.requiredProfile === "read",
          ).title += " conflict";
        }),
      ),
    ).toThrow("duplicate or conflicting");
    expect(() =>
      loadProfileContractSelection(
        "transactional",
        false,
        mutation("transactional-v1.json", (catalog) => {
          catalog.scenarios[1].retires = ["read-update.discovery.document"];
        }),
      ),
    ).toThrow("multiple retirements");
    expect(() =>
      loadProfileContractSelection(
        "read",
        false,
        mutation("transactional-v1.json", (catalog) => {
          catalog.scenarios[0].retires = ["read.missing"];
        }),
      ),
    ).toThrow("known normative row");
    expect(() =>
      loadProfileContractSelection(
        "transactional",
        false,
        mutation("transactional-v1.json", (catalog) => {
          catalog.scenarios[0].retires = [
            "read-update.discovery.document",
            "read-update.discovery.document",
          ];
        }),
      ),
    ).toThrow("validation failed");
  });

  it("does not accidentally include History via another catalog or via profile rank", () => {
    const injectHistory = mutation("read-v1.json", (catalog) => {
      catalog.scenarios.push(JSON.parse(read("history-v1.json")).scenarios[0]);
    });
    expect(() => loadProfileContractSelection("transactional", false, injectHistory)).toThrow(
      "optional catalog",
    );
    const enabled = loadProfileContractSelection("read-update", true);
    expect(enabled.required.some((row) => row.id === "history.discovery")).toBe(true);
    expect(
      enabled.required
        .filter((row) => row.id.startsWith("history."))
        .every((row) => row.requiredProfile !== "transactional"),
    ).toBe(true);
    expect(() => planProfileExecution(enabled, configuration())).toThrow("disagree");
  });

  it("refuses fabricated subsets and preserves exact catalog source digests", () => {
    const selected = loadProfileContractSelection("read-update");
    expect(() => planProfileExecution({ ...selected, required: [] }, configuration())).toThrow(
      "factory-loaded",
    );
    expect(selected.catalogDigests["read-v1.json"]).toBe(
      createHash("sha256").update(read("read-v1.json")).digest("hex"),
    );
    expect(Object.isFrozen(selected.required[0]?.requirements)).toBe(true);
  });
});

describe("same served configuration planning", () => {
  it("keeps every missing inherited or write obligation unplanned and unobserved", () => {
    const selected = loadProfileContractSelection("read-update");
    const config = configuration();
    const executable = {
      ...readManifest,
      scenarios: readManifest.scenarios.filter(
        (row) => row.id === "read.discovery.scope-service-desc",
      ),
    };
    const plan = planProfileExecution(selected, config, {
      configuration: config,
      manifest: manifestSource(executable),
    });
    expect(plan.claimEligible).toBe(false);
    expect(
      plan.requirements.find((row) => row.id === "read.discovery.scope-service-desc")?.readiness,
    ).toBe("ready-unexecuted");
    expect(
      plan.requirements.find((row) => row.id === "read.discovery.canonical-navigation")?.readiness,
    ).toBe("unplanned");
    expect(
      plan.requirements.find((row) => row.id === "read-update.singleton.create-bead")?.readiness,
    ).toBe("unplanned");
    expect(plan.unobservedIds).toEqual(selected.required.map((row) => row.id));
    expect(
      planProfileExecution(selected, config).requirements.every(
        (row) => row.readiness === "unplanned",
      ),
    ).toBe(true);
  });

  it("separates missing setup from unresolved applicability, without waiving either", () => {
    const selected = loadProfileContractSelection("read");
    const config = configuration("read");
    const rows = readManifest.scenarios.filter((row) =>
      ["read.discovery.scope-service-desc", "read.discovery.canonical-navigation"].includes(row.id),
    );
    const first = rows[0];
    const second = rows[1];
    if (!first || !second) throw new Error("expected current Read rows");
    const source = manifestSource({
      ...readManifest,
      scenarios: [
        { ...first, setup: { ...first.setup, requires: ["unavailable-harness"] } },
        { ...second, applicability: { requires: ["conditional-policy"] } },
      ],
    });
    const plan = planProfileExecution(selected, config, {
      configuration: config,
      manifest: source,
    });
    expect(plan.requirements.find((row) => row.id === first.id)).toMatchObject({
      readiness: "setup-unavailable",
      missingSetup: ["unavailable-harness"],
    });
    expect(plan.requirements.find((row) => row.id === second.id)).toMatchObject({
      readiness: "applicability-unresolved",
      missingApplicability: ["conditional-policy"],
    });
    expect(plan.unobservedIds).toContain(first.id);
    expect(plan.unobservedIds).toContain(second.id);
  });

  it("rejects retired, diagnostic, optional-History and misprofiled execution rows", () => {
    const config = configuration();
    const selected = loadProfileContractSelection(config.profile);
    const retired = readManifest.scenarios.find((row) => row.id === "read.discovery.document");
    const diagnostic = readManifest.scenarios.find(
      (row) => row.id === "read.discovery.unsupported-client-input",
    );
    const base = readManifest.scenarios[0];
    if (!retired || !diagnostic || !base) throw new Error("expected current Read rows");
    const attempt = (row: typeof base) =>
      planProfileExecution(selected, config, {
        configuration: config,
        manifest: manifestSource({ ...readManifest, scenarios: [row] }),
      });
    expect(() => attempt(retired)).toThrow("retired requirement");
    expect(() => attempt(diagnostic)).toThrow("not a selected requirement");
    expect(() => attempt({ ...base, id: "history.discovery" })).toThrow(
      "not a selected requirement",
    );
    expect(() => attempt({ ...base, requiredProfile: "read-update" })).toThrow(
      "not a selected requirement",
    );
    expect(() =>
      attempt({ ...base, setup: { ...base.setup, fixture: "different-fixture" } }),
    ).toThrow("fixture mismatch");
  });

  it.each([
    ["scope", "http://127.0.0.1:43211/"],
    ["profile", "transactional"],
    ["history", true],
    ["sourceCommit", "0".repeat(40)],
    ["installedPayloadDigest", "0".repeat(64)],
    ["installedContractsDigest", "0".repeat(64)],
    ["policyDigest", "0".repeat(64)],
    ["authenticationDigest", "0".repeat(64)],
    ["fixtureDigest", "0".repeat(64)],
    ["fixtureId", "another-fixture"],
    ["capabilities", ["different-capability"]],
  ])("refuses to combine a different %s", (field, value) => {
    const expected = configuration();
    const actual = { ...expected, [String(field)]: value } as ServedProfileConfiguration;
    expect(() => assertSameServedProfileConfiguration(expected, actual)).toThrow(
      "configuration mismatch",
    );
    expect(() =>
      planProfileExecution(loadProfileContractSelection("read-update"), expected, {
        configuration: actual,
        manifest: manifestSource({ ...readManifest, scenarios: [] }),
      }),
    ).toThrow("configuration mismatch");
  });

  it("copies/freeze-binds configuration and rejects secrets or malformed identities", () => {
    const input = configuration();
    const bound = bindServedProfileConfiguration(input);
    expect(bound).not.toBe(input);
    expect(Object.isFrozen(bound.capabilities)).toBe(true);
    expect(() =>
      bindServedProfileConfiguration({ ...input, scope: "https://user:secret@example.test/" }),
    ).toThrow("canonical HTTP Scope");
    expect(() =>
      bindServedProfileConfiguration({ ...input, fixtureDigest: "not-a-digest" }),
    ).toThrow("invalid fixtureDigest");
    expect(() =>
      bindServedProfileConfiguration({ ...input, capabilities: ["public-http", "public-http"] }),
    ).toThrow("unique fixture capabilities");
    expect(() =>
      bindServedProfileConfiguration({ ...input, token: "secret" } as ServedProfileConfiguration),
    ).toThrow("exactly");
    assertSameServedProfileConfiguration(
      { ...input, capabilities: ["a", "b"] },
      { ...input, capabilities: ["b", "a"] },
    );
  });
});
