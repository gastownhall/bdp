import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import type { ProtocolProfile } from "@bdp/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  assertSameServedProfileConfiguration,
  bindServedProfileConfiguration,
  inspectProfileContractSourcesForTest,
  loadProfileContractSelection,
  planProfileExecution,
  type ServedProfileConfigurationInput,
} from "../test-support/profile-contract-plan.js";
import { readProtocolSpecification } from "../test-support/spec-source.js";
import { loadScenarioCatalogJson } from "./catalog.js";
import type { ExecutableScenarioManifest } from "./executable-manifest.js";

const read = (name: string) => readFileSync(new URL(`../catalog/${name}`, import.meta.url), "utf8");
const readManifest = JSON.parse(
  readFileSync(new URL("../matrices/read-v1.json", import.meta.url), "utf8"),
) as ExecutableScenarioManifest;
const fixtureBytes = readFileSync(new URL("../fixtures/read-reference-v1.json", import.meta.url));
const source = (value: unknown) => ({ bytes: Buffer.from(JSON.stringify(value)) });
const fixture = (overrides: Record<string, unknown> = {}) =>
  source({ ...JSON.parse(fixtureBytes.toString()), ...overrides });
const input = (profile: ProtocolProfile = "read-update"): ServedProfileConfigurationInput => ({
  scope: "http://127.0.0.1:43210/",
  profile,
  history: false,
  sourceCommit: "a".repeat(40),
  installedPayloadDigest: "b".repeat(64),
  installedContractsDigest: "c".repeat(64),
  policyDigest: "d".repeat(64),
  authenticationDigest: "e".repeat(64),
  fixture: { bytes: fixtureBytes },
});
const configuration = (profile: ProtocolProfile = "read-update") =>
  bindServedProfileConfiguration(input(profile));
const manifestFor = (...ids: string[]): ExecutableScenarioManifest => ({
  ...readManifest,
  scenarios: readManifest.scenarios.filter((row) => ids.includes(row.id)),
});
const mutation =
  (file: string, change: (catalog: ReturnType<typeof JSON.parse>) => void) => (name: string) => {
    const parsed = JSON.parse(read(name));
    if (name === file) change(parsed);
    return JSON.stringify(parsed);
  };
const inspect = (profile: ProtocolProfile, load = read, files?: readonly string[]) =>
  inspectProfileContractSourcesForTest(profile, false, load, files);

// The on-disk catalogs, not a mirrored ID list, remain the requirement authority.
describe("canonical cumulative profile contracts", () => {
  it.each(["read", "read-update", "transactional"] as const)(
    "derives %s obligations including companions, excluding diagnostics and optional History",
    (profile) => {
      const selected = loadProfileContractSelection(profile);
      const ids = selected.required.map((row) => row.id);
      expect(selected.required.every((row) => row.kind === "normative")).toBe(true);
      expect(ids.some((id) => id.startsWith("history."))).toBe(false);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain("read.discovery.unsupported-client-input");
      for (const file of ["numeric-model-v1.json", "owned-wildcard-v1.json"])
        for (const row of loadScenarioCatalogJson(read(file)).scenarios)
          if (row.requiredProfile === "read" || profile !== "read")
            expect(ids, row.id).toContain(row.id);
    },
  );
  it("replaces Read closed discovery transitively, preserving shared limits", () => {
    expect(loadProfileContractSelection("read").required.map((r) => r.id)).toContain(
      "read.discovery.document",
    );
    const ru = loadProfileContractSelection("read-update");
    const tx = loadProfileContractSelection("transactional");
    expect(ru.retiredIds).toEqual(["read.discovery.document"]);
    const direct = loadScenarioCatalogJson(read("transactional-v1.json")).scenarios.flatMap(
      (r) => r.retires ?? [],
    );
    expect(direct).toHaveLength(12);
    expect(tx.retiredIds).toEqual([...direct, "read.discovery.document"].sort());
    for (const selection of [ru, tx]) {
      const ids = selection.required.map((r) => r.id);
      for (const id of selection.retiredIds) expect(ids).not.toContain(id);
      expect(ids).toContain("read.discovery.optional-limits");
    }
  });
  it("requires every catalog to have an explicit directory classification", () => {
    const files = readdirSync(new URL("../catalog/", import.meta.url)).filter((name) =>
      name.endsWith(".json"),
    );
    expect(() => inspect("read", read, files)).not.toThrow();
    expect(() => inspect("read", read, [...files, "new-required-v1.json"])).toThrow("classified");
    expect(() =>
      inspect(
        "read",
        read,
        files.filter((name) => name !== "history-v1.json"),
      ),
    ).toThrow("classified");
    expect(() => inspect("read", read, [...files.slice(1), files[1] ?? ""])).toThrow("classified");
  });
  it("cannot turn injected/shrunken catalogs into a runner-accepted selection", () => {
    const trimmed = inspect(
      "transactional",
      mutation("read-update-v1.json", (catalog) => {
        const retired = new Set(loadProfileContractSelection("transactional").retiredIds);
        catalog.scenarios = catalog.scenarios.filter(
          (r: { id: string }) => retired.has(r.id) || r.id === "read-update.discovery.document",
        );
      }),
    );
    expect(trimmed.required.length).toBeLessThan(
      loadProfileContractSelection("transactional").required.length,
    );
    expect(() => planProfileExecution(trimmed, configuration("transactional"))).toThrow(
      "factory-loaded",
    );
    const selected = loadProfileContractSelection("read-update");
    expect(() => planProfileExecution({ ...selected, required: [] }, configuration())).toThrow(
      "factory-loaded",
    );
    expect(selected.catalogDigests["read-v1.json"]).toBe(
      createHash("sha256").update(read("read-v1.json")).digest("hex"),
    );
    expect(Object.isFrozen(selected.required[0]?.requirements)).toBe(true);
  });
  it("rejects delta-only sources, conflicting companion copies and bad retirements", () => {
    expect(() =>
      inspect("transactional", (name) =>
        name === "read-v1.json" ? '{"catalogVersion":1,"scenarios":[]}' : read(name),
      ),
    ).toThrow("empty required catalog");
    expect(() => inspect("transactional", () => read("transactional-v1.json"))).toThrow(
      "duplicate or conflicting",
    );
    expect(() =>
      inspect(
        "read-update",
        mutation("numeric-model-v1.json", (catalog) => {
          catalog.scenarios.find(
            (r: { requiredProfile: string }) => r.requiredProfile === "read",
          ).title += " conflict";
        }),
      ),
    ).toThrow("duplicate or conflicting");
    expect(() =>
      inspect(
        "transactional",
        mutation("transactional-v1.json", (catalog) => {
          catalog.scenarios[1].retires = ["read-update.discovery.document"];
        }),
      ),
    ).toThrow("multiple retirements");
    expect(() =>
      inspect(
        "read",
        mutation("transactional-v1.json", (catalog) => {
          catalog.scenarios[0].retires = ["read.missing"];
        }),
      ),
    ).toThrow("known normative row");
    expect(() =>
      inspect(
        "transactional",
        mutation("transactional-v1.json", (catalog) => {
          catalog.scenarios[0].retires = [
            "read-update.discovery.document",
            "read-update.discovery.document",
          ];
        }),
      ),
    ).toThrow("validation failed");
  });
  it("keeps optional History outside baseline and rejects mismatched selection", () => {
    expect(() =>
      inspect(
        "transactional",
        mutation("read-v1.json", (catalog) => {
          catalog.scenarios.push(JSON.parse(read("history-v1.json")).scenarios[0]);
        }),
      ),
    ).toThrow("optional catalog");
    const enabled = loadProfileContractSelection("read-update", true);
    expect(enabled.required.some((r) => r.id === "history.discovery")).toBe(true);
    expect(
      enabled.required
        .filter((r) => r.id.startsWith("history."))
        .every((r) => r.requiredProfile !== "transactional"),
    ).toBe(true);
    expect(() => planProfileExecution(enabled, configuration())).toThrow("disagree");
  });
  it("keeps surviving discovery clauses through both retirements, with removal counterfactuals", () => {
    const clauses = [
      "An omitted `order` means `canonical-uri`.",
      "The optional `limits`, `maximumEndpointMultiplicity`, `order`, and `historicalResolution` members apply under their contracts.",
    ];
    const assertClauses = (selected: ReturnType<typeof loadProfileContractSelection>) => {
      for (const clause of clauses)
        if (
          !selected.required.some((row) =>
            row.requirements.some((q) => q.selectedText.includes(clause)),
          )
        )
          throw new Error("surviving discovery clause lost");
    };
    for (const profile of ["read-update", "transactional"] as const) {
      assertClauses(loadProfileContractSelection(profile));
      for (const clause of clauses)
        expect(() =>
          assertClauses(
            inspect(
              profile,
              mutation(`${profile}-v1.json`, (catalog) => {
                const row = catalog.scenarios.find(
                  (r: { id: string }) => r.id === `${profile}.discovery.document`,
                );
                row.requirements = row.requirements.filter(
                  (q: { selectedText: string }) => !q.selectedText.includes(clause),
                );
              }),
            ),
          ),
        ).toThrow("clause lost");
    }
  });
  it("maps ordinary Update command-minimum evidence while TX mapping remains partial", () => {
    const id = "read-update.http.command-minimum-fields";
    const clause =
      "On mutation POSTs to operation command targets, authorities MUST ignore the `BDP-Minimum-Scope-Position`, `BDP-Scope-Epoch`, and `BDP-Authorization-View` request fields. Their presence, absence, completeness, and field values do not impose a minimum-position barrier or affect command identity. Ordinary HTTP field syntax and transport, header, and body bounds still apply, as do authorization, idempotency, carrier validation, and `expectedRevision`. This rule applies to mutation POSTs under this profile and cumulative profiles. It does not change conditions on reads.";
    const ruCatalog = loadScenarioCatalogJson(read("read-update-v1.json"));
    const rows = ruCatalog.scenarios.filter((row) => row.id === id);
    expect(rows).toEqual([
      {
        id,
        title:
          "Mutation POSTs ignore the three read-consistency fields without a minimum-position barrier or command-identity effect, preserving ordinary admission and read minima",
        kind: "normative",
        requiredProfile: "read-update",
        requirements: [
          {
            source: "docs/specs/bdp.md",
            anchor: "#mutation-command-preconditions",
            selectedText: clause,
          },
        ],
      },
    ]);
    const spec = readProtocolSpecification();
    expect(spec.replace(/\s+/g, " ")).toContain(clause);
    for (const profile of ["read-update", "transactional"] as const) {
      const selection = loadProfileContractSelection(profile);
      expect(selection.required.filter((row) => row.id === id)).toEqual(rows);
      expect(selection.retiredIds).not.toContain(id);
    }
    expect(loadProfileContractSelection("read-update").required).toHaveLength(130);
    expect(loadProfileContractSelection("read").required.map((row) => row.id)).not.toContain(id);
    expect(
      loadScenarioCatalogJson(read("transactional-v1.json")).scenarios.map((row) => row.id),
    ).not.toContain(id);
    const coverage = JSON.parse(
      readFileSync(
        new URL("../test-support/read-update-coverage-v1.json", import.meta.url),
        "utf8",
      ),
    ) as {
      rows: {
        id: string;
        status: string;
        wholeContract: boolean;
        reason: string;
        bindings: unknown[];
      }[];
    };
    expect(coverage.rows).toHaveLength(130);
    expect(coverage.rows.filter((row) => !row.wholeContract)).toHaveLength(96);
    expect(coverage.rows.filter((row) => row.status === "omitted")).toHaveLength(74);
    const observed = coverage.rows.filter((row) => row.id === id);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ id, status: "bounded-observation", wholeContract: false });
    expect(observed[0]?.reason).toContain("harness-local");
    const ruManifest = JSON.parse(
      readFileSync(new URL("../matrices/read-update-v1.json", import.meta.url), "utf8"),
    );
    const ru = ruManifest.scenarios.filter((row: { id: string }) => row.id === id);
    expect(ru).toHaveLength(1);
    expect(ru[0].actions).toHaveLength(11);
    expect(observed[0]?.bindings).toEqual([
      {
        scenario: id,
        assertions: ru[0].actions.flatMap((a: { id: string; assertions: { id: string }[] }) =>
          a.assertions.map((q) => `${a.id}.${q.id}`),
        ),
      },
    ]);
    const continuation = JSON.parse(
      readFileSync(
        new URL("../matrices/read-update-reference-continuation-v1.json", import.meta.url),
        "utf8",
      ),
    );
    expect(continuation.scenarios.map((row: { id: string }) => row.id)).not.toContain(id);
    const txManifest = JSON.parse(
      readFileSync(
        new URL("../test-support/transactional/manifest-v1.json", import.meta.url),
        "utf8",
      ),
    );
    const txCoverage = JSON.parse(
      readFileSync(
        new URL("../test-support/transactional/coverage-v1.json", import.meta.url),
        "utf8",
      ),
    );
    const partial = txManifest.scenarios.filter((row: { id: string }) => row.id === id);
    expect(partial).toHaveLength(1);
    expect(partial[0].requiredProfile).toBe("read-update");
    expect(partial[0].actions).toHaveLength(11);
    expect(txCoverage.rows.filter((row: { id: string }) => row.id === id)).toEqual([
      {
        id,
        wholeContract: false,
        reason: expect.stringContaining("Whole contract remains unqualified"),
        bindings: [
          {
            scenario: id,
            assertions: partial[0].actions.flatMap(
              (a: { id: string; assertions: { id: string }[] }) =>
                a.assertions.map((x) => `${a.id}:${x.id}`),
            ),
          },
        ],
      },
    ]);
  });
  it("locks every inheritance-audit row and replacement to the catalogs", () => {
    const doc = readFileSync(
      new URL("../../../docs/design/profile-contract-planning.md", import.meta.url),
      "utf8",
    );
    const rows = [
      ...doc.matchAll(/^\| `(read-update\.[^`]+)` \| (Inherited|Retired) \| ([^\n]+) \|$/gm),
    ];
    const ru = loadScenarioCatalogJson(read("read-update-v1.json")).scenarios;
    const replacements = new Map(
      loadScenarioCatalogJson(read("transactional-v1.json")).scenarios.flatMap((r) =>
        (r.retires ?? []).map((id) => [id, r.id]),
      ),
    );
    expect(rows.map((r) => r[1])).toEqual(ru.map((r) => r.id));
    for (const row of rows) {
      const replacement = replacements.get(row[1] ?? "");
      expect(row[2]).toBe(replacement ? "Retired" : "Inherited");
      if (replacement) expect(row[3]).toContain(`Replaced by \`${replacement}\``);
    }
    const ids = loadProfileContractSelection("transactional").required.map((r) => r.id);
    for (const id of [
      "read-update.sequence.member-problem-shape",
      "read-update.sequence.order-and-partial-commit",
      "read-update.sequence.retained-failure",
      "read-update.sequence.idempotent-retry",
      "read-update.sequence.disconnect",
      "read-update.problem.table",
      "read-update.http.cache-no-store",
      "read-update.http.request-too-large",
    ])
      expect(ids).toContain(id);
    const spec = readProtocolSpecification();
    expect(spec).toContain("| `sequence` | `POST` | `200` envelope");
    expect(spec).toContain("its envelope, its member records, its declaration order, its separate");
    expect(
      ru
        .find((r) => r.id === "read-update.singleton.owned-link-no-op")
        ?.requirements.some((q) => q.selectedText.includes("has no durable Mutation Receipts")),
    ).toBe(false);
  });
});

describe("truthful executable readiness", () => {
  it("preserves missing inherited/write obligations and rejects unsupported carriers as readiness", () => {
    const config = configuration();
    const selection = loadProfileContractSelection("read-update");
    const plan = planProfileExecution(selection, config, {
      configuration: config,
      manifest: source(manifestFor("read.discovery.scope-service-desc")),
    });
    expect(plan.claimEligible).toBe(false);
    expect(plan.carrierBlocker).toContain("read-v1 version 1 on read-update");
    expect(
      plan.requirements.find((r) => r.id === "read.discovery.scope-service-desc")?.readiness,
    ).toBe("carrier-unsupported");
    for (const id of ["read.discovery.canonical-navigation", "read-update.singleton.create-bead"])
      expect(plan.requirements.find((r) => r.id === id)?.readiness).toBe("unplanned");
    expect(plan.unobservedIds).toEqual(selection.required.map((r) => r.id));
    expect(
      planProfileExecution(selection, config).requirements.every(
        (r) => r.readiness === "unplanned",
      ),
    ).toBe(true);
  });
  it.each([1, 2] as const)(
    "does not admit version%s normative TX or unknown catalog carrier",
    (manifestVersion) => {
      for (const [profile, catalogId] of [
        ["transactional", "read-v1"],
        ["read", "unadmitted-v1"],
      ] as const) {
        const config = configuration(profile);
        const manifest = {
          ...manifestFor("read.discovery.scope-service-desc"),
          manifestVersion,
          catalogId,
        };
        const plan = planProfileExecution(loadProfileContractSelection(profile), config, {
          configuration: config,
          manifest: source(manifest),
        });
        expect(
          plan.requirements.find((r) => r.id === "read.discovery.scope-service-desc")?.readiness,
        ).toBe("carrier-unsupported");
      }
    },
  );
  it.each([
    ["read", "read-v1", 2, "ready-unexecuted"],
    ["read-update", "read-update-v1", 1, "carrier-unsupported"],
    ["read", "read-update-v1", 2, "carrier-unsupported"],
  ] as const)("pins carrier %s/%s/v%s", (profile, catalogId, manifestVersion, readiness) => {
    const config = configuration(profile);
    const plan = planProfileExecution(loadProfileContractSelection(profile), config, {
      configuration: config,
      manifest: source({
        ...manifestFor("read.discovery.scope-service-desc"),
        catalogId,
        manifestVersion,
      }),
    });
    expect(
      plan.requirements.find((row) => row.id === "read.discovery.scope-service-desc")?.readiness,
    ).toBe(readiness);
  });
  it("separates missing setup and unresolved applicability without waivers", () => {
    const config = bindServedProfileConfiguration({
      ...input("read"),
      fixture: fixture({ capabilities: ["public-http"] }),
    });
    const first = readManifest.scenarios[0];
    if (!first) throw new Error("missing row");
    for (const [field, readiness] of [
      ["setup", "setup-unavailable"],
      ["applicability", "applicability-unresolved"],
    ] as const) {
      const row = { ...first, [field]: { ...first[field], requires: ["missing-capability"] } };
      const plan = planProfileExecution(loadProfileContractSelection("read"), config, {
        configuration: config,
        manifest: source({ ...readManifest, scenarios: [row] }),
      });
      expect(plan.requirements.find((r) => r.id === row.id)?.readiness).toBe(readiness);
      expect(plan.unobservedIds).toContain(row.id);
    }
  });
  it("exposes real inherited Read prerequisites retired at RU alongside carrier blockers", () => {
    const selection = loadProfileContractSelection("read-update");
    const config = configuration();
    const ids = new Set(selection.required.map((r) => r.id));
    const manifest = {
      ...readManifest,
      scenarios: readManifest.scenarios.filter((r) => ids.has(r.id)),
    };
    const plan = planProfileExecution(selection, config, {
      configuration: config,
      manifest: source(manifest),
    });
    const dependents = plan.requirements.filter((r) =>
      r.blockedPrerequisites.includes("read.discovery.document"),
    );
    expect(dependents).toHaveLength(9);
    expect(dependents.every((r) => r.readiness === "carrier-unsupported")).toBe(true);
  });
  it("blocks missing, unready and cyclic prerequisites for a supported carrier", () => {
    const config = configuration("read");
    const a = readManifest.scenarios[0];
    const b = readManifest.scenarios.find((r) => r.id === "read.discovery.canonical-navigation");
    if (!a || !b) throw new Error("missing rows");
    const withDependency = (row: typeof a, dependency: string) => ({
      ...row,
      actions: [
        {
          id: "dependency",
          family: "http",
          method: "GET",
          target: { binding: "scope" },
          prerequisiteScenario: dependency,
          captures: [],
          assertions: [{ id: "status", kind: "status", equals: 200 }],
        },
        {
          id: "owned",
          family: "http",
          method: "GET",
          target: { binding: "scope" },
          captures: [],
          assertions: [{ id: "status", kind: "status", equals: 200 }],
        },
      ],
      requests: undefined,
    });
    const attempt = (rows: unknown[]) =>
      planProfileExecution(loadProfileContractSelection("read"), config, {
        configuration: config,
        manifest: source({ ...readManifest, scenarios: rows }),
      });
    expect(
      attempt([withDependency(b, a.id)]).requirements.find((r) => r.id === b.id),
    ).toMatchObject({ readiness: "prerequisite-blocked", blockedPrerequisites: [a.id] });
    expect(
      attempt([
        withDependency(b, a.id),
        { ...a, setup: { ...a.setup, requires: ["missing-setup"] } },
      ]).requirements.find((r) => r.id === b.id)?.readiness,
    ).toBe("prerequisite-blocked");
    const cyclic = attempt([withDependency(a, b.id), withDependency(b, a.id)]);
    expect(
      cyclic.requirements
        .filter((r) => [a.id, b.id].includes(r.id))
        .every((r) => r.readiness === "prerequisite-blocked"),
    ).toBe(true);
  });
  it("bounds shared prerequisite DAG work across every canonical Read obligation", () => {
    const selected = loadProfileContractSelection("read");
    const config = configuration("read");
    const template = readManifest.scenarios[0];
    if (!template) throw new Error("missing template");
    const ids = new Set(selected.required.map((row) => row.id));
    const scenarios = selected.required.map((row, index) => ({
      ...template,
      id: row.id,
      requiredProfile: row.requiredProfile,
      requests: undefined,
      actions: [
        ...[index - 1, index - 2]
          .filter((i) => i >= 0)
          .map((i, n) => ({
            id: `dependency-${n}`,
            family: "http",
            method: "GET",
            target: { binding: "scope" },
            prerequisiteScenario: selected.required[i]?.id,
            captures: [],
            assertions: [{ id: "status", kind: "status", equals: 200 }],
          })),
        {
          id: "owned",
          family: "http",
          method: "GET",
          target: { binding: "scope" },
          captures: [],
          assertions: [{ id: "status", kind: "status", equals: 200 }],
        },
      ],
    }));
    const manifest = source({ ...readManifest, scenarios });
    // Count actual requirement lookups, not elapsed time. The generous linear
    // budget fails fast for repeated shared-subgraph traversal even on slow CI.
    const originalGet = Map.prototype.get;
    let lookups = 0;
    const budget = selected.required.length * 100;
    const get = vi.spyOn(Map.prototype, "get").mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
    ) {
      if (typeof key === "string" && ids.has(key) && ++lookups > budget)
        throw new Error("shared prerequisite evaluation exceeded linear lookup budget");
      return originalGet.call(this, key);
    });
    try {
      const plan = planProfileExecution(selected, config, { configuration: config, manifest });
      expect(plan.requirements).toHaveLength(selected.required.length);
      expect(plan.requirements.every((row) => row.readiness === "ready-unexecuted")).toBe(true);
      expect(plan.requirements.every((row) => row.blockedPrerequisites.length === 0)).toBe(true);
      expect(plan.unobservedIds).toHaveLength(selected.required.length);
      expect(plan.claimEligible).toBe(false);
      expect(lookups).toBeLessThanOrEqual(budget);
    } finally {
      get.mockRestore();
    }
  });
  it("does not turn supported prerequisites into blockers when only the carrier is unsupported", () => {
    const selected = loadProfileContractSelection("read-update");
    const config = configuration();
    const ids = new Set(selected.required.map((row) => row.id));
    const scenarios = readManifest.scenarios.filter((row) => ids.has(row.id));
    // Use two independent ready rows and an actual declared dependency between
    // them; carrier support and graph readiness are separate explanations.
    const first = scenarios[0];
    const second = scenarios[1];
    if (!first || !second || !first.requests?.[0]) throw new Error("missing Read probes");
    const own = { ...first.requests[0], id: "own", captures: [], prerequisiteScenario: undefined };
    const pair = [
      { ...first, requests: [own] },
      { ...second, requests: [{ ...own, id: "dependency", prerequisiteScenario: first.id }, own] },
    ];
    for (const manifestVersion of [1, 2]) {
      const plan = planProfileExecution(selected, config, {
        configuration: config,
        manifest: source({ ...readManifest, manifestVersion, scenarios: pair }),
      });
      const rows = plan.requirements.filter((row) => [first.id, second.id].includes(row.id));
      expect(rows.every((row) => row.blockedPrerequisites.length === 0)).toBe(true);
      expect(
        rows.every(
          (row) =>
            row.readiness === (manifestVersion === 1 ? "carrier-unsupported" : "ready-unexecuted"),
        ),
      ).toBe(true);
      expect(plan.claimEligible).toBe(false);
      expect(plan.unobservedIds).toHaveLength(selected.required.length);
    }
  });
  it("rejects retired, diagnostic, History, misprofiled or wrong-fixture rows", () => {
    const config = configuration();
    const selected = loadProfileContractSelection(config.profile);
    const first = readManifest.scenarios[0];
    if (!first) throw new Error();
    const attempt = (row: typeof first) =>
      planProfileExecution(selected, config, {
        configuration: config,
        manifest: source({ ...readManifest, scenarios: [row] }),
      });
    for (const [id, message] of [
      ["read.discovery.document", "retired requirement"],
      ["read.discovery.unsupported-client-input", "not a selected requirement"],
      ["history.discovery", "not a selected requirement"],
    ])
      expect(() => attempt({ ...first, id: id as string })).toThrow(message);
    expect(() => attempt({ ...first, requiredProfile: "read-update" })).toThrow(
      "not a selected requirement",
    );
    expect(() => attempt({ ...first, setup: { ...first.setup, fixture: "different" } })).toThrow(
      "fixture mismatch",
    );
  });
});

describe("captured source and exact configuration binding", () => {
  it("derives immutable fixture identity/capabilities/digest from exact fixture bytes", () => {
    const captured = Buffer.from(fixtureBytes);
    const config = bindServedProfileConfiguration({ ...input(), fixture: { bytes: captured } });
    const parsed = JSON.parse(captured.toString());
    expect(config.fixtureId).toBe(parsed.id);
    expect(config.capabilities).toEqual([...parsed.capabilities].sort());
    expect(config.fixtureDigest).toBe(createHash("sha256").update(captured).digest("hex"));
    captured.fill(0);
    expect(config.fixtureId).toBe(parsed.id);
    expect(Object.isFrozen(config.capabilities)).toBe(true);
    expect(() =>
      bindServedProfileConfiguration({
        ...input(),
        fixtureDigest: "0".repeat(64),
      } as ServedProfileConfigurationInput),
    ).toThrow("exactly");
    expect(() =>
      bindServedProfileConfiguration({
        ...input(),
        capabilities: ["invented"],
      } as ServedProfileConfigurationInput),
    ).toThrow("exactly");
  });
  it.each([
    "scope",
    "profile",
    "history",
    "sourceCommit",
    "installedPayloadDigest",
    "installedContractsDigest",
    "policyDigest",
    "authenticationDigest",
    "fixture",
  ] as const)("refuses different captured %s", (field) => {
    const left = input();
    const replacement = {
      scope: "http://127.0.0.1:43211/",
      profile: "transactional",
      history: true,
      sourceCommit: "0".repeat(40),
      installedPayloadDigest: "0".repeat(64),
      installedContractsDigest: "0".repeat(64),
      policyDigest: "0".repeat(64),
      authenticationDigest: "0".repeat(64),
      fixture: fixture({ seed: 123 }),
    }[field];
    const expected = bindServedProfileConfiguration(left);
    const actual = bindServedProfileConfiguration({
      ...left,
      [field]: replacement,
    } as ServedProfileConfigurationInput);
    expect(() => assertSameServedProfileConfiguration(expected, actual)).toThrow(
      "configuration mismatch",
    );
    expect(() =>
      planProfileExecution(loadProfileContractSelection("read-update"), expected, {
        configuration: actual,
        manifest: source(readManifest),
      }),
    ).toThrow("configuration mismatch");
    expect(() => assertSameServedProfileConfiguration(expected, { ...expected })).toThrow(
      "factory-bound",
    );
  });
  it.each([
    "http://127.0.0.1:43210/a%2fb/",
    "http://127.0.0.1:43210//x/",
    "http://127.0.0.1:43210/%7Ea/",
    "https://user:secret@example.test/",
  ])("rejects noncanonical Scope %s using runner predicate", (scope) => {
    expect(() => bindServedProfileConfiguration({ ...input(), scope })).toThrow(
      "canonical HTTP Scope",
    );
  });
  it.each([
    { id: " reference-read-v1 " },
    { capabilities: [" public-http "] },
    { capabilities: [] },
    { capabilities: ["x", "x"] },
  ])("uses existing fixture identifier validation: %j", (invalid) => {
    expect(() =>
      bindServedProfileConfiguration({ ...input(), fixture: fixture(invalid) }),
    ).toThrow();
  });
  it.each([
    new Uint16Array([1, 2]),
    [300, 44],
    { 0: 123, length: 1 },
    new Proxy(new Uint8Array([123]), {}),
  ])("rejects non-exact source byte containers", (bytes) => {
    expect(() =>
      bindServedProfileConfiguration({ ...input(), fixture: { bytes } as never }),
    ).toThrow("Uint8Array");
  });
  it("reuses byte, depth and UTF-8 bounds for fixture and manifest", () => {
    const config = configuration("read");
    for (const bytes of [
      new Uint8Array(1048577),
      new Uint8Array([255]),
      Buffer.from(`${"[".repeat(130)}0${"]".repeat(130)}`),
    ]) {
      expect(() => bindServedProfileConfiguration({ ...input(), fixture: { bytes } })).toThrow();
      expect(() =>
        planProfileExecution(loadProfileContractSelection("read"), config, {
          configuration: config,
          manifest: { bytes },
        }),
      ).toThrow();
    }
  });
  it("copies exact manifest bytes without invoking overridden iteration", () => {
    const config = configuration("read");
    const bytes = Buffer.from(JSON.stringify(manifestFor("read.discovery.scope-service-desc")));
    let calls = 0;
    Object.defineProperty(bytes, Symbol.iterator, {
      value() {
        calls++;
        return [300].values();
      },
    });
    const plan = planProfileExecution(loadProfileContractSelection("read"), config, {
      configuration: config,
      manifest: { bytes },
    });
    expect(calls).toBe(0);
    expect(plan.manifestDigest).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(
      plan.requirements.find((r) => r.id === "read.discovery.scope-service-desc")?.readiness,
    ).toBe("ready-unexecuted");
    bytes.fill(0);
    expect(plan.manifestDigest).not.toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("native snapshot regressions", () => {
  it("rejects changing accessors before invocation", () => {
    for (const field of ["sourceCommit", "fixture"] as const) {
      const value = input();
      let reads = 0;
      Object.defineProperty(value, field, {
        enumerable: true,
        get() {
          return ++reads === 1 ? input()[field] : "invalid";
        },
      });
      expect(() => bindServedProfileConfiguration(value)).toThrow("own enumerable data");
      expect(reads).toBe(0);
    }
  });
  it("rejects changing ownKeys and revoked proxies before reflection", () => {
    const target = { ...input(), token: "secret" };
    let calls = 0;
    const proxy = new Proxy(target, {
      ownKeys(v) {
        return ++calls === 1 ? Reflect.ownKeys(v).filter((k) => k !== "token") : Reflect.ownKeys(v);
      },
    });
    expect(() => bindServedProfileConfiguration(proxy)).toThrow("plain data");
    expect(calls).toBe(0);
    const revoked = Proxy.revocable(input(), {});
    revoked.revoke();
    expect(() => bindServedProfileConfiguration(revoked.proxy)).toThrow("plain data");
  });
  it("rejects unequal coercible digests without canonicalizing both as empty objects", () => {
    let calls = 0;
    const coercible = (text: string) =>
      Object.create({
        toString() {
          calls++;
          return text;
        },
      });
    for (const text of ["1".repeat(64), "2".repeat(64)])
      expect(() =>
        bindServedProfileConfiguration({ ...input(), policyDigest: coercible(text) }),
      ).toThrow("primitive string");
    expect(calls).toBe(0);
  });
  it.each([
    "scope",
    "profile",
    "sourceCommit",
    "installedPayloadDigest",
    "installedContractsDigest",
    "policyDigest",
    "authenticationDigest",
  ] as const)("rejects boxed %s", (field) => {
    const value = input();
    expect(() =>
      bindServedProfileConfiguration({
        ...value,
        [field]: Object(value[field]),
      } as ServedProfileConfigurationInput),
    ).toThrow();
  });
  it("rejects nested source getters/proxies without reading or freezing caller data", () => {
    let calls = 0;
    const nested = {};
    Object.defineProperty(nested, "bytes", {
      enumerable: true,
      get() {
        calls++;
        return fixtureBytes;
      },
    });
    expect(() => bindServedProfileConfiguration({ ...input(), fixture: nested as never })).toThrow(
      "own enumerable data",
    );
    const proxy = new Proxy(
      { bytes: fixtureBytes },
      {
        get(v, k) {
          calls++;
          return Reflect.get(v, k);
        },
      },
    );
    expect(() => bindServedProfileConfiguration({ ...input(), fixture: proxy })).toThrow(
      "plain data",
    );
    const config = configuration("read");
    expect(() =>
      planProfileExecution(loadProfileContractSelection("read"), config, {
        configuration: config,
        manifest: nested as never,
      }),
    ).toThrow("own enumerable data");
    const execution = { configuration: config };
    Object.defineProperty(execution, "manifest", {
      enumerable: true,
      get() {
        calls++;
        return source(readManifest);
      },
    });
    expect(() =>
      planProfileExecution(loadProfileContractSelection("read"), config, execution as never),
    ).toThrow("own enumerable data");
    expect(calls).toBe(0);
    expect(Object.isFrozen(nested)).toBe(false);
  });
  it("rejects inherited/hidden extras and detaches mutable input with null-prototype support", () => {
    expect(() => bindServedProfileConfiguration(Object.create(input()))).toThrow("plain data");
    for (const key of ["token", Symbol("secret")]) {
      const value = input();
      Object.defineProperty(value, key, { value: "secret" });
      expect(() => bindServedProfileConfiguration(value)).toThrow("exactly");
    }
    const value = Object.assign(Object.create(null), input());
    const bound = bindServedProfileConfiguration(value);
    value.policyDigest = "0".repeat(64);
    expect(bound.policyDigest).toBe("d".repeat(64));
    expect(Object.isFrozen(value)).toBe(false);
    expect(Object.isFrozen(bound)).toBe(true);
  });
});
