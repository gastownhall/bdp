import test from "node:test";
import assert from "node:assert/strict";
import { runV02Provider, parseV02Arguments } from "./v02-provider-kit.mjs";
import { serveFixture } from "./test-support/v02-kit-provider.mjs";
import { harvest, loadCoverage, qualify } from "./v02-provider-kit/specification.mjs";
import { resource, reply, descriptor } from "./v02-provider-kit/contract.mjs";
import { condition, query } from "./v02-provider-kit/evaluate.mjs";
import { parseJson } from "./v02-provider-kit/transport.mjs";
test("latest pinned normative census has executable coverage plus Appendix E", async () => {
  const c = await loadCoverage();
  assert.equal(c.points.length, 116);
  assert.equal(new Set(c.points.map((p) => p.id)).size, 116);
  assert.equal(harvest("## X\n/// normative: Test\ntype X = string")[0].anchor, "X#1");
});
test("incomplete, failed and cleanup-error reports cannot qualify", () => {
  for (const state of ["not-run", "fail", "harness-error"])
    assert.equal(
      qualify({
        obligations: [{ state }],
        normative: [{ state: "pass" }],
        lifecycle: { provision: "pass", cleanup: "pass" },
      }).qualificationComplete,
      false,
    );
  assert.equal(
    qualify({
      obligations: [],
      normative: [{ state: "pass" }],
      lifecycle: { provision: "pass", cleanup: "harness-error" },
    }).claimEligible,
    false,
  );
});
test("CLI refuses malformed versions, flags, credentials and duplicate options without disclosure", () => {
  const args = ["--spec", "v0.2", "--profile", "read-only", "--scope", "http://localhost/"];
  assert.ok(parseV02Arguments(args));
  for (const tail of [["--spec", "v0.2"], ["--allow-mutation"], ["--max-pages", "0"]])
    assert.equal(parseV02Arguments([...args, ...tail]), null);
  assert.equal(
    parseV02Arguments(
      args.map((v) => (v === "http://localhost/" ? "http://user:secret@localhost/" : v)),
    ),
    null,
  );
});
test("closed envelopes, open Outcome arms and future identity bases follow the formal contract", () => {
  assert.throws(() => resource({ id: { id: "a" }, type: "x", body: {}, extra: 1 }));
  reply({ outcome: { kind: "success", value: 1, future: "allowed" }, cause: "c", callId: "i" });
  reply({ outcome: { kind: "future-fate", future: true }, cause: "c", callId: "i" }, 500);
  resource({
    id: { id: "a" },
    type: "x",
    body: {},
    provenance: {
      principals: [{ id: "urn:person", basis: { kind: "future-auth", additional: true } }],
      inception: "unknown",
      committedAt: "2026-11-21T00:00:00Z",
    },
  });
});
test("reference semantics use lexical numeric ordering, segment type prefixes and boolean identities", () => {
  const r = { id: { id: "a" }, type: "issue/task", body: { n: 10 } };
  assert.equal(condition({ kind: "compare", field: ["body", "n"], op: "lt", value: 2 }, r), true);
  assert.equal(condition({ kind: "is-type", type: "issu" }, r), false);
  assert.equal(condition({ kind: "is-type", type: "issue" }, r), true);
  assert.equal(query({ kind: "all", of: [] }, r, [], "http://x/"), true);
  assert.equal(query({ kind: "any", of: [] }, r, [], "http://x/"), false);
});
test("JSON parser refuses duplicate members rather than dropping evidence", () => {
  assert.throws(() => parseJson('{"x":1,"x":2}'));
  assert.deepEqual(parseJson('{"x":[true,null]}'), { x: [true, null] });
});
test("a conforming domain-neutral read-only wire fixture reaches real exit-zero qualification", async () => {
  const target = await serveFixture();
  const report = await runV02Provider(target, { allowRefusalProbes: true, maxPages: 100 });
  assert.equal(
    report.state,
    "pass",
    JSON.stringify(report.obligations.filter((r) => !["pass", "not-applicable"].includes(r.state))),
  );
  assert.equal(report.qualificationComplete, true);
  assert.equal(report.claimEligible, true);
  assert.equal(report.exitCode, 0);
});
for (const mutation of [
  "magic-path",
  "context-floor",
  "channel-point",
  "discovery",
  "extra-envelope",
  "storage",
  "missing-cause",
  "filter",
  "selector",
  "cursor-unbound",
  "no-jsonl",
  "default-limit",
  "malformed-query",
  "count",
  "safe-transaction",
  "via-direction",
  "export-truncated",
  "export-count",
  "export-state",
  "export-cut",
])
  test(`checker rejects independent wire mutant: ${mutation}`, async () => {
    const report = await runV02Provider(await serveFixture(mutation), {
      allowRefusalProbes: true,
      maxPages: 100,
    });
    assert.equal(report.claimEligible, false);
    assert.notEqual(report.state, "pass");
    assert.equal(JSON.stringify(report).includes("DO_NOT_REPORT_SERVER_VALUE"), false);
  });
test("model-gated Appendix E guarantees relax under a reusable/unversioned scope, not fail", async () => {
  const r = await runV02Provider(await serveFixture("reusable"), {
    allowRefusalProbes: true,
    maxPages: 100,
  });
  const g = (id) => r.normative.find((p) => p.id === id)?.state;
  // E1 "never reused" and E5 "revision changes on state change" are model-gated: a
  // reusable/unversioned scope must not fail them (the gated half is unasserted read-only).
  assert.equal(g("appendix-e:1"), "pass");
  assert.equal(g("appendix-e:5"), "pass");
  assert.equal(g("appendix-e:14"), "not-applicable");
  // E1's "never reused" overlaps IdModel#1 (id-remint): both leave it unasserted, no conflict.
  assert.equal(g("core:IdModel#1"), "not-applicable");
  assert.equal(
    r.normative.some((p) => p.state === "fail"),
    false,
  );
  assert.equal(r.qualificationComplete, true);
});
test("a scope advertising the alias overlay flags the unexercised read obligation, not a pass", async () => {
  const r = await runV02Provider(await serveFixture("aliases-advertised"), {
    allowRefusalProbes: true,
    maxPages: 100,
  });
  const alias = r.normative.find((p) => p.id === "core:Alias#2");
  assert.equal(alias?.state, "not-run");
  assert.equal(r.qualificationComplete, false);
  assert.equal(r.claimEligible, false);
});
test("missing refusal authorization remains incomplete, not a pass or an automatic mutation", async () => {
  const r = await runV02Provider(await serveFixture(), { maxPages: 100 });
  assert.equal(r.state, "incomplete");
  assert.equal(r.obligations.find((r) => r.id === "core.unoffered").state, "not-run");
});

test("qualification refuses missing, duplicate, unrequired or extra obligation rows", () => {
  const expected = { executionIds: ["x"], normativeIds: ["n"] };
  const make = () => ({
    obligations: [{ id: "x", state: "pass", required: true }],
    normative: [{ id: "n", state: "pass" }],
    lifecycle: { provision: "pass", cleanup: "pass" },
  });
  assert.equal(qualify(make(), expected).qualificationComplete, true);
  const missing = make();
  missing.obligations = [];
  assert.equal(qualify(missing, expected).qualificationComplete, false);
  const duplicate = make();
  duplicate.normative.push(duplicate.normative[0]);
  assert.equal(qualify(duplicate, expected).qualificationComplete, false);
  const unrequired = make();
  unrequired.obligations[0].required = false;
  assert.equal(qualify(unrequired, expected).qualificationComplete, false);
  assert.equal(qualify(make()).qualificationComplete, false);
});

test("descriptor schemas are checked as JSON Schema, not accepted as arbitrary objects", () => {
  assert.throws(() =>
    descriptor({ type: "type-def", body: { properties: [{ name: "bad", type: { type: 42 } }] } }),
  );
  descriptor({
    type: "type-def",
    body: { properties: [{ name: "data", type: { type: "object", additionalProperties: true } }] },
  });
});

test("current-provider-kit CLI selects the v0.2 runner and returns its real exit-zero report", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const target = await serveFixture();
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "scripts/current-provider-kit.mjs",
        "--spec",
        "v0.2",
        "--profile",
        "read-only",
        "--scope",
        target.scope,
        "--allow-refusal-probes",
      ],
      { timeout: 30000 },
    );
    const report = JSON.parse(stdout);
    assert.equal(report.kit, "bdp-v0.2-read-only");
    assert.equal(report.qualificationComplete, true);
  } finally {
    await target.cleanup();
  }
});

test("unrepresentable numeric evidence is inconclusive instead of silently rounded into a pass", () => {
  assert.throws(() => parseJson("9007199254740993"), /lossless bounds/);
  assert.throws(() => parseJson("1e999"), /lossless bounds/);
});

test("extended read-only fixture qualifies sorting, search, graph, detection, lint, history and live SSE", async () => {
  const r = await runV02Provider(await serveFixture("extended"), {
    allowRefusalProbes: true,
    maxPages: 100,
  });
  assert.equal(
    r.state,
    "pass",
    JSON.stringify(r.obligations.filter((x) => !["pass", "not-applicable"].includes(x.state))),
  );
});
test("qualification uses valid HTTP targets for BDP history refusal checks", async () => {
  const r = await runV02Provider(await serveFixture("extended-edge-parser"), {
    allowRefusalProbes: true,
    maxPages: 100,
  });
  assert.equal(r.obligations.find((x) => x.id === "core.history")?.state, "pass");
  assert.equal(r.state, "pass");
});
test("history refusal still fails qualification when its BDP reply lacks cause context", async () => {
  const r = await runV02Provider(await serveFixture("extended-history-missing-cause"), {
    allowRefusalProbes: true,
    maxPages: 100,
  });
  const history = r.obligations.find((x) => x.id === "core.history");
  assert.equal(history?.state, "fail");
  assert.equal(history?.reason, "Missing response BDP-Cause");
  assert.equal(r.claimEligible, false);
});
for (const [mutation, row] of [
  ["search", "stdlib.search"],
  ["sort", "core.sorting"],
  ["graph", "stdlib.graph"],
  ["duplicates", "stdlib.duplicates"],
  ["similar", "stdlib.similar"],
  ["lint", "stdlib.lint"],
  ["history", "core.history"],
  ["live", "core.live"],
])
  test(`checker catches broken optional wire behavior: ${mutation}`, async () => {
    const r = await runV02Provider(await serveFixture(`extended-${mutation}`), {
      allowRefusalProbes: true,
      maxPages: 100,
    });
    assert.equal(r.obligations.find((x) => x.id === row)?.state, "fail");
    assert.equal(r.claimEligible, false);
  });
