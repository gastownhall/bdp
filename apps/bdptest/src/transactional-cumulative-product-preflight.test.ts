/** New cumulative artifact selection/config source checks; no installed campaign here. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import { expect, it } from "vitest";

const source = (name: string) => ({
  bytes: readFileSync(
    new URL(`../test-support/transactional-cumulative-product-${name}.json`, import.meta.url),
  ),
});
it("joins all251 exact baseline clauses once with canonical retirements and preserves explicit unexecuted roles", () => {
  const actual = loadProfileContractSelection("transactional");
  const own = JSON.parse(source("requirements").bytes.toString("utf8"));
  expect(actual.required).toHaveLength(251);
  expect(own.rows).toHaveLength(251);
  expect(own.rows.map((r: { id: string }) => r.id)).toEqual(actual.required.map((r) => r.id));
  expect(new Set(own.rows.map((r: { id: string }) => r.id)).size).toBe(251);
  expect(own.retiredIds).toEqual(actual.retiredIds);
  for (const row of actual.required) {
    const chosen = own.rows.find((r: { id: string }) => r.id === row.id);
    expect(chosen.requirements).toEqual(row.requirements);
    expect(chosen.requiredProfile).toBe(row.requiredProfile);
    expect(chosen.wholePredicateState).toBe("unexecuted-unreconciled");
    expect(typeof chosen.carrierUnit).toBe("string");
  }
  for (const pin of own.catalogPins)
    expect(actual.catalogDigests[pin.path.split("/").at(-1)]).toBe(pin.sha256);
  expect(
    own.rows.filter((r: { conditionalRole: string | null }) => r.conditionalRole !== null),
  ).toHaveLength(5);
});
it("admits bounded inheritedRead bundle and one complete fixture without borrowing RU4MiB or historical17 plans", () => {
  const selection = loadProfileContractSelection("transactional"),
    manifest = source("read-manifest"),
    fixture = source("fixture");
  for (const x of [manifest, fixture]) expect(x.bytes.byteLength).toBeLessThanOrEqual(1048576);
  const bundle = createCumulativeTransactionalArtifactBundle(selection, { manifest, fixture });
  expect(bundle.manifest.scenarios).toHaveLength(8);
  expect(bundle.manifest.scenarios.every((r) => r.id.startsWith("read."))).toBe(true);
  expect(bundle.manifest.scenarios.reduce((n, r) => n + (r.actions?.length ?? 0), 0)).toBe(128);
  expect(bundle.fixture.id).toBe("tx-cumulative-product-v1");
  expect(bundle.digests.fixtureDigest).toBe(
    createHash("sha256").update(fixture.bytes).digest("hex"),
  );
  expect(bundle.fixture.campaign).toMatchObject({
    profile: "transactional",
    history: false,
    initialPolicy: "all-visible",
  });
});
it("joins selected carrier responsibilities without gaps/overlap or pretending source cases are portable manifest actions", () => {
  const selected = loadProfileContractSelection("transactional"),
    plan = JSON.parse(source("carrier-plan").bytes.toString("utf8"));
  expect(plan.rows.map((r: { id: string }) => r.id)).toEqual(selected.required.map((r) => r.id));
  const partition = plan.bundles.flatMap((b: { requirementIds: string[] }) => b.requirementIds);
  expect(partition.length).toBe(251);
  expect(new Set(partition).size).toBe(251);
  expect([...partition].sort()).toEqual(selected.required.map((r) => r.id).sort());
  for (const row of plan.rows) {
    expect(plan.bundles.find((b: { id: string }) => b.id === row.bundle).requirementIds).toContain(
      row.id,
    );
    if (row.implementationScope === "not-implemented-in-this-tranche")
      expect(row.caseRefs).toEqual([]);
    if (row.conditionalRole !== null)
      expect(row.implementationScope).toBe("conditional-role-not-selected");
  }
  expect(plan.nativeArtifactBundles[0].selectedIds).toEqual(
    JSON.parse(source("read-manifest").bytes.toString("utf8")).scenarios.map(
      (r: { id: string }) => r.id,
    ),
  );
  expect(plan.claimEligible).toBe(false);
  expect(source("carrier-plan").bytes.byteLength).toBeLessThanOrEqual(1048576);
});
