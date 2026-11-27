import test from "node:test";
import assert from "node:assert/strict";
import { runV02Provider } from "./v02-provider-kit.mjs";
import { serveFixture } from "./test-support/v02-kit-provider.mjs";
import { capabilities } from "./v02-provider-kit/contract.mjs";

// Preserved from scripts/v02-provider-kit.node-test.mjs when its clause-census was retired
// (adbbdb20). These two checks are census-INDEPENDENT: each asserts the checker's own
// discrimination (a specific obligation fails when its wire behaviour is mutated) or the
// capability contract — not the stale clause-coverage manifest. Kept because, with
// gastownhall/bdp main unprotected, they are the evidence that the still-live TS checker
// can fail at all.
//
// NOT ported: the "independent wire mutant" family's DISCRIMINATION assertions
// (claimEligible === false, state !== "pass") — the retired census forces both for every
// input via its harness-error, so they would pass without discriminating; their home is the
// Rust subject's own evidence (the teapot-probe red-green), built in the subsume. The
// family's THIRD assertion, a leak guard, IS census-independent and is ported below —
// without it the sentinel injected at test-support/v02-kit-provider.mjs:504 is planted with
// nothing reading it, which reads as coverage.

// The checker catches a broken OPTIONAL wire behaviour: the mutated obligation's own check
// sets its state to "fail", independent of the census.
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
  });

// External regression, reported by Chris Sells (#442 comment 7142885377): core.lumen
// declares ListCaps.compactFilter: bool (required). A scope omitting it was wrongly
// accepted and a valid `compactFilter: false` threw "undefined member"; both now correct.
test("ListCaps requires a boolean compactFilter, rejecting both omission and a non-boolean", () => {
  const caps = () => ({
    core: {
      get: { selector: true },
      list: { conditions: [], selector: true, sort: false, compactFilter: false },
    },
    scope: { storageClasses: [], revisionModel: "versioned" },
  });
  // Present and boolean is accepted.
  capabilities(caps());
  // Omitting the required field is rejected.
  const omitted = caps();
  delete omitted.core.list.compactFilter;
  assert.throws(() => capabilities(omitted));
  // A non-boolean value is rejected.
  const stringly = caps();
  stringly.core.list.compactFilter = "false";
  assert.throws(() => capabilities(stringly));
});

// Leak guard (the census-independent third assertion of the retired mutant family): the
// fixture support injects a sentinel `notDefined: "DO_NOT_REPORT_SERVER_VALUE"` into served
// records (test-support/v02-kit-provider.mjs:504); the checker must not echo any
// server-supplied value into its report.
test("checker does not echo a server-supplied value into its report", async () => {
  const report = await runV02Provider(await serveFixture("magic-path"), {
    allowRefusalProbes: true,
    maxPages: 100,
  });
  assert.equal(JSON.stringify(report).includes("DO_NOT_REPORT_SERVER_VALUE"), false);
});
