import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertReadUpdateArtifactSet,
  copyReadUpdateArtifactSetSources,
  createReadUpdateArtifactSet,
  type ReadUpdateArtifactSetSources,
} from "../test-support/read-update-artifact-set.js";
import {
  assertFactoryCreatedArtifactBundle,
  createConformanceArtifactBundle,
  createDevelopmentReadUpdateArtifactBundle,
} from "./artifact-bundle.js";
import { canonicalJson } from "./canonical-json.js";
import { loadProfileContractSelection } from "./profile-contract-selection.js";

const selection = loadProfileContractSelection("read-update");
const [first, second, third] = selection.required.slice(0, 3).map((r) => r.id) as [
  string,
  string,
  string,
];
const names = ["matrices/baseline.json", "matrices/continuation.json"] as const;
const bytes = (value: unknown) => ({ bytes: Buffer.from(JSON.stringify(value)) });
const decode = (source: { bytes: Uint8Array }) => JSON.parse(Buffer.from(source.bytes).toString());
const fixture = {
  fixtureVersion: 1,
  id: "set-fixture",
  seed: 0,
  capabilities: ["test-http"],
  bindings: {},
};
function row(
  id: string,
  family: "requests" | "http" | "client" | "lifecycle" = "requests",
  prerequisite?: string,
) {
  const http = {
    id: "observe",
    method: "GET",
    target: { binding: "scope" },
    raw: { headerLines: [] },
    captures: [],
    assertions: [{ id: "status", kind: "status", equals: 200 }],
  };
  const action =
    family === "requests"
      ? http
      : family === "http"
        ? { ...http, family }
        : {
            id: "observe",
            family,
            operation: "test.observe",
            input: {},
            captures: [],
            assertions: [
              { id: "status", kind: "json-pointer", pointer: "/status", exists: true, equals: 200 },
            ],
          };
  const actions = [
    ...(prerequisite
      ? [{ ...action, id: "prerequisite", prerequisiteScenario: prerequisite }]
      : []),
    action,
  ];
  return {
    id,
    requiredProfile: selection.required.find((r) => r.id === id)?.requiredProfile ?? "read",
    setup: { fixture: fixture.id, requires: fixture.capabilities },
    cleanup: { resetFixture: true },
    applicability: { requires: [] },
    ...(family === "requests" ? { requests: actions } : { actions }),
  };
}
function sources(groups = [[row(first)], [row(second, "client")]]): ReadUpdateArtifactSetSources {
  const plans = new Map(groups.flat().map((r) => [r.id, r]));
  return {
    index: bytes({ version: 1, shards: names.map((source, n) => ({ id: `shard-${n}`, source })) }),
    fixture: bytes(fixture),
    coverage: bytes({
      version: 1,
      claimEligible: false,
      rows: selection.required.map(({ id }) => {
        const plan = plans.get(id);
        return {
          id,
          status: plan ? "bounded-observation" : "omitted",
          wholeContract: false,
          reason: "Tiny validation fixture; no execution credit.",
          bindings: plan
            ? [
                {
                  scenario: id,
                  assertions: ("actions" in plan ? plan.actions : plan.requests).flatMap(
                    (a: { id: string; assertions: { id: string }[] }) =>
                      a.assertions.map((x) => `${a.id}.${x.id}`),
                  ),
                },
              ]
            : [],
        };
      }),
    }),
    manifests: Object.fromEntries(
      names.map((name, n) => [
        name,
        bytes({ manifestVersion: 2, catalogId: "read-update-v1", scenarios: groups[n] }),
      ]),
    ),
  };
}
function change(
  input: ReadUpdateArtifactSetSources,
  field: "index" | "coverage" | "fixture" | (typeof names)[number],
  mutate: (value: any) => void,
) {
  const original = field.startsWith("matrices/")
    ? input.manifests[field]!
    : input[field as "index" | "coverage" | "fixture"];
  const value = decode(original);
  mutate(value);
  return field.startsWith("matrices/")
    ? { ...input, manifests: { ...input.manifests, [field]: bytes(value) } }
    : { ...input, [field]: bytes(value) };
}
function count(value: unknown): number {
  return (
    1 +
    (value && typeof value === "object"
      ? Object.values(value).reduce<number>((n, x) => n + count(x), 0)
      : 0)
  );
}
function sizedManifest(
  input: ReadUpdateArtifactSetSources,
  name: (typeof names)[number],
  nodes: number,
) {
  return change(input, name, (manifest) => {
    const action = manifest.scenarios[0].actions[0];
    action.input.padding = [];
    let remaining = nodes - count(manifest);
    while (remaining > 0) {
      const children = Math.min(9999, remaining - 1);
      action.input.padding.push(Array(children).fill(0));
      remaining -= children + 1;
    }
    expect(count(manifest)).toBe(nodes);
  });
}

describe("private two-artifact Read+Update set", () => {
  it("binds genuine independent bundles, complete inventory and exact descriptor digests", () => {
    const input = sources();
    const set = createReadUpdateArtifactSet(selection, input);
    expect(set.claimEligible).toBe(false);
    expect(set.requirements.map((r) => r.id)).toEqual(selection.required.map((r) => r.id));
    expect(set.requirements.filter((r) => r.owner !== null)).toEqual([
      { id: first, owner: "shard-0" },
      { id: second, owner: "shard-1" },
    ]);
    expect(set.requirements.find((r) => r.id === third)?.owner).toBeNull();
    expect(set.coverage.rows[2]).toMatchObject({
      status: "omitted",
      wholeContract: false,
      bindings: [],
    });
    for (const shard of set.shards) {
      expect(() => assertFactoryCreatedArtifactBundle(shard.bundle)).not.toThrow();
      expect(shard.bundle.catalog).toEqual(selection.catalog);
      expect(shard.bundle.digests.fixtureDigest).toBe(set.digests.fixtureDigest);
      expect(() => assertFactoryCreatedArtifactBundle({ ...shard.bundle })).toThrow();
    }
    const descriptor = {
      indexDigest: set.digests.indexDigest,
      coverageDigest: set.digests.coverageDigest,
      fixtureDigest: set.digests.fixtureDigest,
      catalogDigests: selection.catalogDigests,
      shards: set.shards.map((s) => ({
        id: s.id,
        manifestDigest: s.bundle.digests.manifestDigest,
        scenarioIds: s.scenarioIds,
      })),
    };
    expect(set.digests.setDigest).toBe(
      createHash("sha256").update(canonicalJson(descriptor)).digest("hex"),
    );
    expect(set.sourceBytes.manifests).toBe(
      names.reduce((n, name) => n + input.manifests[name]!.bytes.byteLength, 0),
    );
  });
  it("detaches and freezes parsed data and retained source bytes, rejecting structural set clones", () => {
    const input = sources();
    const set = createReadUpdateArtifactSet(selection, input);
    const before = copyReadUpdateArtifactSetSources(set);
    for (const item of [
      input.index,
      input.fixture,
      input.coverage,
      ...Object.values(input.manifests),
    ])
      item.bytes.fill(0);
    const output = copyReadUpdateArtifactSetSources(set);
    output.manifests[names[0]]!.bytes.fill(1);
    expect(copyReadUpdateArtifactSetSources(set)).toEqual(before);
    expect(() => (set.shards as unknown[]).pop()).toThrow();
    expect(Object.isFrozen(set.coverage.rows[0]!.bindings)).toBe(true);
    expect(() => assertReadUpdateArtifactSet({ ...set })).toThrow("factory-created");
    expect(() => copyReadUpdateArtifactSetSources({ ...set })).toThrow("factory-created");
  });
  it.each(["read", "transactional", "history", "forged"])("rejects selection %s", (kind) => {
    const selected =
      kind === "forged"
        ? { ...selection, required: [] }
        : kind === "history"
          ? loadProfileContractSelection("read-update", true)
          : loadProfileContractSelection(kind as "read" | "transactional");
    expect(() => createReadUpdateArtifactSet(selected, sources())).toThrow();
  });
  it.each(["root", "source", "map", "proxy", "byte-proxy"])(
    "rejects hostile %s without invoking accessors",
    (kind) => {
      const input = sources();
      let calls = 0;
      const getter = {
        enumerable: true,
        get() {
          calls++;
          throw Error("getter ran");
        },
      };
      if (kind === "root") Object.defineProperty(input, "fixture", getter);
      if (kind === "source") Object.defineProperty(input.fixture, "bytes", getter);
      if (kind === "map") Object.defineProperty(input.manifests, names[0], getter);
      const hostile =
        kind === "proxy"
          ? new Proxy(input, {
              ownKeys() {
                calls++;
                throw Error("proxy ran");
              },
            })
          : input;
      if (kind === "byte-proxy")
        Object.defineProperty(input.fixture, "bytes", {
          value: new Proxy(input.fixture.bytes, {
            get() {
              calls++;
              throw Error("byte proxy ran");
            },
          }),
        });
      expect(() => createReadUpdateArtifactSet(selection, hostile)).toThrow();
      expect(calls).toBe(0);
    },
  );
  it.each([
    "missing",
    "extra",
    "duplicate-id",
    "duplicate-source",
    "empty",
    "third",
    "path",
    "version",
    "unknown-field",
  ])("rejects index/source shape %s", (kind) => {
    let input = sources();
    if (kind === "missing")
      input = { ...input, manifests: { [names[0]]: input.manifests[names[0]]! } };
    else if (kind === "extra")
      input = { ...input, manifests: { ...input.manifests, "matrices/extra.json": bytes({}) } };
    else
      input = change(input, "index", (x) => {
        if (kind === "duplicate-id") x.shards[1].id = x.shards[0].id;
        if (kind === "duplicate-source") x.shards[1].source = x.shards[0].source;
        if (kind === "empty") x.shards = [];
        if (kind === "third") x.shards.push({ id: "third", source: "matrices/third.json" });
        if (kind === "path") x.shards[0].source = "../matrices/escape.json";
        if (kind === "version") x.version = 2;
        if (kind === "unknown-field") x.imports = [];
      });
    expect(() => createReadUpdateArtifactSet(selection, input)).toThrow();
  });
  it.each(["empty", "duplicate-owner", "order", "unknown", "retired", "v1", "wrong-catalog"])(
    "rejects manifest %s",
    (kind) => {
      let input = sources();
      if (kind === "duplicate-owner") input = sources([[row(first)], [row(first)]]);
      else if (kind === "order") input = sources([[row(third), row(first)], [row(second)]]);
      else
        input = change(input, names[0], (x) => {
          if (kind === "empty") x.scenarios = [];
          if (kind === "unknown") x.scenarios[0].id = "made.up";
          if (kind === "retired") x.scenarios[0].id = "read.discovery.document";
          if (kind === "v1") x.manifestVersion = 1;
          if (kind === "wrong-catalog") x.catalogId = "read-v1";
        });
      expect(() => createReadUpdateArtifactSet(selection, input)).toThrow();
    },
  );
  it.each(["requests", "http", "client", "lifecycle"] as const)(
    "requires complete same-shard earlier %s prerequisite closure",
    (family) => {
      expect(() =>
        createReadUpdateArtifactSet(
          selection,
          sources([[row(first), row(second, family, first)], [row(third)]]),
        ),
      ).not.toThrow();
      expect(() =>
        createReadUpdateArtifactSet(
          selection,
          sources([[row(first)], [row(second, family, first)]]),
        ),
      ).toThrow("same shard");
      expect(() =>
        createReadUpdateArtifactSet(
          selection,
          sources([[row(second, family, first)], [row(third)]]),
        ),
      ).toThrow("same shard");
      expect(() =>
        createReadUpdateArtifactSet(
          selection,
          sources([[row(first, family, second), row(second)], [row(third)]]),
        ),
      ).toThrow("same shard");
    },
  );
  it.each([
    "missing-row",
    "duplicate-row",
    "order",
    "orphan",
    "omitted-executed",
    "whole-omitted",
    "binding-extra",
    "binding-empty",
    "assertions-order",
    "assertions-missing",
    "extra-field",
    "claim",
  ])("rejects coverage %s", (kind) => {
    const input = change(sources(), "coverage", (x) => {
      if (kind === "missing-row") x.rows.pop();
      if (kind === "duplicate-row") x.rows[2] = x.rows[1];
      if (kind === "order") [x.rows[0], x.rows[1]] = [x.rows[1], x.rows[0]];
      if (kind === "orphan") x.rows[2].bindings = x.rows[0].bindings;
      if (kind === "omitted-executed") {
        x.rows[0].status = "omitted";
        x.rows[0].bindings = [];
      }
      if (kind === "whole-omitted") x.rows[2].wholeContract = true;
      if (kind === "binding-extra") x.rows[0].bindings.push(x.rows[0].bindings[0]);
      if (kind === "binding-empty") x.rows[0].bindings = [];
      if (kind === "assertions-order")
        x.rows[0].bindings[0].assertions = ["wrong.status", "observe.status"];
      if (kind === "assertions-missing") x.rows[0].bindings[0].assertions = [];
      if (kind === "extra-field") x.rows[0].extra = true;
      if (kind === "claim") x.claimEligible = true;
    });
    expect(() => createReadUpdateArtifactSet(selection, input)).toThrow();
  });
  it("checks full ordered bindings for both requests and actions", () => {
    for (const family of ["requests", "client"] as const) {
      const input = sources([[row(first), row(second, family, first)], [row(third)]]);
      const set = createReadUpdateArtifactSet(selection, input);
      expect(set.coverage.rows[1]!.bindings[0]!.assertions).toEqual([
        "prerequisite.status",
        "observe.status",
      ]);
      expect(() =>
        createReadUpdateArtifactSet(
          selection,
          change(input, "coverage", (x) => x.rows[1].bindings[0].assertions.reverse()),
        ),
      ).toThrow("ordered");
    }
  });
  it.each(["index", "fixture", "coverage", names[0]] as const)(
    "binds exact %s bytes, including insignificant whitespace",
    (field) => {
      const original = sources();
      const set = createReadUpdateArtifactSet(selection, original);
      const src = field.startsWith("matrices/")
        ? original.manifests[field]!
        : original[field as "index" | "fixture" | "coverage"];
      const changed = { bytes: Buffer.concat([Buffer.from(src.bytes), Buffer.from(" ")]) };
      const input = field.startsWith("matrices/")
        ? { ...original, manifests: { ...original.manifests, [field]: changed } }
        : { ...original, [field]: changed };
      expect(createReadUpdateArtifactSet(selection, input).digests.setDigest).not.toBe(
        set.digests.setDigest,
      );
    },
  );
  it("binds filename changes in set identity without changing manifest digests", () => {
    const input = sources();
    const set = createReadUpdateArtifactSet(selection, input);
    const renamed = "matrices/renamed.json";
    const changed = change(input, "index", (x) => (x.shards[0].source = renamed));
    const manifests = {
      [renamed]: input.manifests[names[0]]!,
      [names[1]]: input.manifests[names[1]]!,
    };
    const next = createReadUpdateArtifactSet(selection, { ...changed, manifests });
    expect(next.digests.setDigest).not.toBe(set.digests.setDigest);
    expect(next.shards[0]!.bundle.digests).toEqual(set.shards[0]!.bundle.digests);
  });
  it.each([
    ["index", 16384],
    ["fixture", 1048576],
    ["coverage", 1048576],
    [names[0], 4194304],
  ] as const)("retains exact %s byte ceiling", (field, maximum) => {
    const input = sources();
    const src = field.startsWith("matrices/")
      ? input.manifests[field]!
      : input[field as "index" | "fixture" | "coverage"];
    for (const extra of [0, 1]) {
      const padded = {
        bytes: Buffer.from(
          Buffer.from(src.bytes)
            .toString()
            .padEnd(maximum + extra, " "),
        ),
      };
      const changed = field.startsWith("matrices/")
        ? { ...input, manifests: { ...input.manifests, [field]: padded } }
        : { ...input, [field]: padded };
      if (extra)
        expect(() => createReadUpdateArtifactSet(selection, changed)).toThrow("must not exceed");
      else expect(() => createReadUpdateArtifactSet(selection, changed)).not.toThrow();
    }
  });
  it("allows separately bounded manifests above 100k total but refuses a single 100001-node source", () => {
    let input = sources([[row(first, "client")], [row(second, "client")]]);
    input = sizedManifest(sizedManifest(input, names[0], 60000), names[1], 60000);
    expect(() => createReadUpdateArtifactSet(selection, input)).not.toThrow();
    expect(() =>
      createReadUpdateArtifactSet(selection, sizedManifest(input, names[0], 100001)),
    ).toThrow("100000 nodes");
  });
  it("retains fixture and coverage depth/container/node guards", () => {
    for (const field of ["fixture", "coverage"] as const) {
      for (const kind of ["depth", "container", "nodes"]) {
        const input = change(sources(), field, (x) => {
          if (kind === "container") x.padding = Array(10001).fill(0);
          else if (kind === "nodes")
            x.padding = Array.from({ length: 11 }, () => Array(9999).fill(0));
          else {
            let nested: unknown = 0;
            for (let n = 0; n < 130; n++) nested = [nested];
            x.padding = nested;
          }
        });
        expect(() => createReadUpdateArtifactSet(selection, input)).toThrow(/depth|entries|nodes/);
      }
    }
  });
  it("preserves fixture-pointer validation and public factory/package guards", () => {
    const input = change(sources(), names[1], (x) => {
      const assertion = x.scenarios[0].actions[0].assertions[0];
      delete assertion.equals;
      assertion.fixturePointer = "/oracles/missing";
    });
    expect(() => createReadUpdateArtifactSet(selection, input)).toThrow();
    const plain = sources();
    const ordinary = {
      catalog: bytes(selection.catalog),
      manifest: plain.manifests[names[0]]!,
      fixture: plain.fixture,
    };
    expect(() => createConformanceArtifactBundle(ordinary)).toThrow("catalogId");
    expect(() => createDevelopmentReadUpdateArtifactBundle(ordinary)).toThrow("diagnostic-only");
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(packageJson.exports).not.toHaveProperty("./testing");
    expect(readFileSync(new URL("./index.ts", import.meta.url), "utf8")).not.toContain(
      "read-update-artifact-set",
    );
    expect(
      readFileSync(new URL("../test-support/testing.ts", import.meta.url), "utf8"),
    ).not.toContain("ownData");
  });
});
