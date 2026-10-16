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

function coldDirectorySpan(
  text: string,
  key: "scenarios" | "rows",
  id = "read-update.discovery.operation-directory",
) {
  const start = text.indexOf("[", text.indexOf(JSON.stringify(key))) + 1;
  let depth = 0,
    begin = -1,
    quoted = false,
    escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === "{" || char === "[") {
      if (depth === 0) begin = i;
      depth++;
    } else if (char === "}" || char === "]") {
      if (depth === 0) break;
      if (--depth === 0 && JSON.parse(text.slice(begin, i + 1)).id === id)
        return { start: begin, end: i + 1 };
    }
  }
  throw Error("missing cold directory object");
}

describe("private two-artifact Read+Update set", () => {
  it.each(["setup", "applicability"] as const)(
    "rejects absent owned %s capabilities, including hidden missing oracles",
    (gate) => {
      for (const name of names) {
        const input = change(
          sources([[row(first, "client")], [row(second, "client")]]),
          name,
          (manifest) => {
            const plan = manifest.scenarios[0];
            plan[gate].requires = ["absent-capability"];
            const assertion = plan.actions[0].assertions[0];
            delete assertion.equals;
            assertion.fixturePointer = "/oracles/missing";
          },
        );
        // An applicable missing oracle is already refused by the bundle. The
        // applicability-gated variant used to bypass that check and acquire ownership.
        expect(() => createReadUpdateArtifactSet(selection, input)).toThrow();
        const withoutPointer = change(input, name, (manifest) => {
          const assertion = manifest.scenarios[0].actions[0].assertions[0];
          delete assertion.fixturePointer;
          assertion.equals = 200;
        });
        expect(() => createReadUpdateArtifactSet(selection, withoutPointer)).toThrow(/capabilit/);
      }
    },
  );
  it("accepts the actual current corpus split with unchanged prerequisite groups and coverage", () => {
    const read = (name: string) => ({
      bytes: readFileSync(new URL(`../${name}`, import.meta.url)),
    });
    const manifest = decode(read("matrices/read-update-v1.json"));
    const currentText = Buffer.from(read("matrices/read-update-v1.json").bytes).toString();
    const minimum = coldDirectorySpan(
      currentText,
      "scenarios",
      "read-update.http.command-minimum-fields",
    );
    expect(currentText.slice(minimum.start - 6, minimum.start)).toBe(",\n    ");
    const manifestText = currentText.slice(0, minimum.start - 6) + currentText.slice(minimum.end);
    expect(createHash("sha256").update(manifestText).digest("hex")).toBe(
      "80f74625b6074892b707365859572f8bc0b8c10478d36ac307370ef6027f5fc3",
    );
    expect(JSON.parse(manifestText).scenarios).toHaveLength(50);
    const span = coldDirectorySpan(manifestText, "scenarios");
    expect(manifestText.slice(span.end, span.end + 6)).toBe(",\n    ");
    const parent = manifestText.slice(0, span.start) + manifestText.slice(span.end + 6);
    expect(createHash("sha256").update(parent).digest("hex")).toBe(
      "c86b33535f25a1d117ce021a3bb70164f5635bdaee50758e3428c130ccc3227f",
    );
    expect(JSON.parse(parent).scenarios).toHaveLength(49);
    expect(
      createHash("sha256")
        .update(read("matrices/read-update-reference-continuation-v1.json").bytes)
        .digest("hex"),
    ).toBe("24d754618b51f255b5885d83c53ccf9a06593031e1812739a4f2b504c4a1df8d");
    const currentCoverage = Buffer.from(
      read("test-support/read-update-coverage-v1.json").bytes,
    ).toString();
    const minimumCoverage = coldDirectorySpan(
      currentCoverage,
      "rows",
      "read-update.http.command-minimum-fields",
    );
    const priorMinimum =
      '{\n      "id": "read-update.http.command-minimum-fields",\n      "status": "omitted",\n      "wholeContract": false,\n      "reason": "Private Read+Update and Transactional implementation tests cover ignored command minimum fields, but no cumulative executable row is bound to this required ID. Read minimum controls remain separate; no whole-contract credit is claimed.",\n      "bindings": []\n    }';
    const coverageText =
      currentCoverage.slice(0, minimumCoverage.start) +
      priorMinimum +
      currentCoverage.slice(minimumCoverage.end);
    expect(createHash("sha256").update(coverageText).digest("hex")).toBe(
      "85b717f1817d8ea295d0a7c51f8914bdfb942d1786d414924d3d5f80be7cd10a",
    );
    const coverageSpan = coldDirectorySpan(coverageText, "rows");
    const previous =
      '{\n      "id": "read-update.discovery.operation-directory",\n      "status": "omitted",\n      "wholeContract": false,\n      "reason": "No row-local scenario in this slice; cross-row observations do not award this required ID whole-contract credit.",\n      "bindings": []\n    }';
    expect(
      createHash("sha256")
        .update(
          coverageText.slice(0, coverageSpan.start) +
            previous +
            coverageText.slice(coverageSpan.end),
        )
        .digest("hex"),
    ).toBe("f8f0b001928f8488292403b57c973bd918cba224ef9e00fe0691482bf5cfac0c");
    const cold = manifest.scenarios.find(
      (row: { id: string }) => row.id === "read-update.discovery.operation-directory",
    );
    expect(manifest.scenarios.indexOf(cold)).toBe(18);
    expect(cold.actions).toHaveLength(21);
    expect(cold.actions.flatMap((a: { assertions: unknown[] }) => a.assertions)).toHaveLength(134);
    expect(createHash("sha256").update(JSON.stringify(cold)).digest("hex")).toBe(
      "7930b51eea68914b24ece231d9b30479e14936572bcd67d18351ffc6562efeff",
    );
    const last = manifest.scenarios.at(-1);
    expect(
      (last.actions ?? last.requests).every(
        (a: { prerequisiteScenario?: string }) => a.prerequisiteScenario === undefined,
      ),
    ).toBe(true);
    const input = sources();
    const set = createReadUpdateArtifactSet(selection, {
      ...input,
      fixture: read("fixtures/read-update-reference-v1.json"),
      coverage: bytes({
        ...decode(read("test-support/read-update-coverage-v1.json")),
        rows: decode(read("test-support/read-update-coverage-v1.json")).rows.map(
          (r: { id: string }) =>
            manifest.scenarios.some((s: { id: string }) => s.id === r.id)
              ? r
              : { ...r, status: "omitted", wholeContract: false, bindings: [] },
        ),
      }),
      manifests: {
        [names[0]]: bytes({ ...manifest, scenarios: manifest.scenarios.slice(0, -1) }),
        [names[1]]: bytes({ ...manifest, scenarios: [last] }),
      },
    });
    expect(set.shards.flatMap((s) => s.scenarioIds)).toEqual(
      manifest.scenarios.map((s: { id: string }) => s.id),
    );
    expect(
      set.coverage.rows.filter((r) => r.status === "bounded-observation").map((r) => r.id),
    ).toEqual(manifest.scenarios.map((s: { id: string }) => s.id));
    expect(set.claimEligible).toBe(false);
  });
  it.each(["index", "fixture", "coverage", ...names] as const)(
    "attributes safely captured %s failures",
    (field) => {
      const original = sources();
      const role = field.startsWith("matrices/")
        ? `shard-${names.indexOf(field as (typeof names)[number])} (${field})`
        : `artifact-set ${field}`;
      for (const body of [
        Buffer.from("!"),
        Buffer.alloc(field === "index" ? 16385 : field.startsWith("matrices/") ? 4194305 : 1048577),
      ]) {
        const bad = { bytes: body, label: "caller label is not the attribution authority" };
        const input = field.startsWith("matrices/")
          ? { ...original, manifests: { ...original.manifests, [field]: bad } }
          : { ...original, [field]: bad };
        expect(() => createReadUpdateArtifactSet(selection, input)).toThrow(role);
      }
    },
  );
  it("detaches continuation bytes without reading hostile byte properties", () => {
    const input = sources();
    let calls = 0;
    for (const key of ["byteLength", "length", "buffer", Symbol.iterator])
      Object.defineProperty(input.manifests[names[1]]!.bytes, key, {
        get() {
          calls++;
          throw Error("getter ran");
        },
      });
    const set = createReadUpdateArtifactSet(selection, input);
    const captured = copyReadUpdateArtifactSetSources(set);
    input.manifests[names[1]]!.bytes[0] = 0;
    expect(calls).toBe(0);
    expect(() => createReadUpdateArtifactSet(selection, captured)).not.toThrow();
    expect(createReadUpdateArtifactSet(selection, captured).digests).toEqual(set.digests);
  });
  it("rejects an ambiguous joined binding within one row while allowing dotted grammar", () => {
    let input = change(sources(), names[0], (manifest) => {
      const a = manifest.scenarios[0].requests[0];
      a.id = "observe.status";
      a.assertions[0].id = "code";
      manifest.scenarios[0].requests.push({
        ...a,
        id: "observe",
        assertions: [{ ...a.assertions[0], id: "status.code" }],
      });
    });
    input = change(
      input,
      "coverage",
      (coverage) =>
        (coverage.rows[0].bindings[0].assertions = ["observe.status.code", "observe.status.code"]),
    );
    expect(() => createReadUpdateArtifactSet(selection, input)).toThrow("duplicate joined");
  });
  it("binds alternative legal dotted splits through manifest and set identity despite equal coverage", () => {
    let left = change(sources(), names[0], (m) => {
      m.scenarios[0].requests[0].id = "observe.status";
      m.scenarios[0].requests[0].assertions[0].id = "code";
    });
    left = change(
      left,
      "coverage",
      (c) => (c.rows[0].bindings[0].assertions = ["observe.status.code"]),
    );
    const right = change(left, names[0], (m) => {
      m.scenarios[0].requests[0].id = "observe";
      m.scenarios[0].requests[0].assertions[0].id = "status.code";
    });
    const a = createReadUpdateArtifactSet(selection, left);
    const b = createReadUpdateArtifactSet(selection, right);
    expect(a.coverage).toEqual(b.coverage);
    expect(a.digests.coverageDigest).toBe(b.digests.coverageDigest);
    expect(a.shards[0]!.bundle.digests.manifestDigest).not.toBe(
      b.shards[0]!.bundle.digests.manifestDigest,
    );
    expect(a.digests.setDigest).not.toBe(b.digests.setDigest);
  });
  it("records whole credit as inert authored data with a distinct identity", () => {
    const input = sources();
    const before = createReadUpdateArtifactSet(selection, input);
    const after = createReadUpdateArtifactSet(
      selection,
      change(input, "coverage", (c) => (c.rows[0].wholeContract = true)),
    );
    expect(after.coverage.rows[0]!.wholeContract).toBe(true);
    expect(after.claimEligible).toBe(false);
    expect(after.requirements).toEqual(before.requirements);
    expect(after.shards.map((s) => s.bundle.digests)).toEqual(
      before.shards.map((s) => s.bundle.digests),
    );
    expect(after.digests.coverageDigest).not.toBe(before.digests.coverageDigest);
    expect(after.digests.setDigest).not.toBe(before.digests.setDigest);
  });

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
    "blank-reason",
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
      if (kind === "blank-reason") x.rows[0].reason = " \t\n";
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
  it.each(["index", "fixture", "coverage", ...names] as const)(
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
    [names[1], 4194304],
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
    for (const name of names)
      expect(() =>
        createReadUpdateArtifactSet(selection, sizedManifest(input, name, 100001)),
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
  it("preserves fixture-pointer validation and public factory/package guards", async () => {
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
    const testing = await import("../test-support/testing.js");
    expect(Object.keys(testing)).not.toContain("ownData");
    expect(testing.createReadUpdateArtifactSet).toBe(createReadUpdateArtifactSet);
    for (const module of [await import("./index.js")]) {
      for (const name of [
        "ownData",
        "createReadUpdateArtifactSet",
        "assertReadUpdateArtifactSet",
        "copyReadUpdateArtifactSetSources",
      ])
        expect(Object.keys(module)).not.toContain(name);
    }
  });
});
