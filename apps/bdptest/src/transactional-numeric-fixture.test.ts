/** Pure fixture metadata checks; never launches or repeats the installed numeric case. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { bindServedProfileConfiguration } from "@bdp/conformance/testing";
import { expect, it } from "vitest";

const bytes = readFileSync(
  new URL("../test-support/transactional-numeric-fixture.json", import.meta.url),
);
const fixture = JSON.parse(bytes.toString("utf8"));
const scope = "https://reference.invalid/acme/";

it("numeric fixture metadata names its actual Type/schema and complete artifacts", () => {
  expect(fixture.fixtureVersion).toBe(1);
  expect(fixture.id).toBe("reference-transactional-numeric-v1");
  expect(fixture.seed).toBe(0);
  expect(fixture.capabilities).toEqual([
    "installed-transactional-http",
    "transactional-receipt-observation",
  ]);
  expect(fixture.scope).toBe(scope);
  expect(fixture.bindings).toEqual({
    subject: `${scope}beads/a`,
    type: `${scope}types/numeric`,
    schema: `${scope}schemas/numeric`,
    "create-bead": `${scope}operations/create-bead`,
    "update-bead": `${scope}operations/update-bead`,
    changes: `${scope}changes/`,
  });
  expect(fixture.artifacts.descriptors).toHaveLength(1);
  expect(fixture.artifacts.schemas).toHaveLength(1);
  expect(fixture.artifacts.descriptors[0].retrievalUri).toBe(fixture.bindings.type);
  expect(JSON.parse(fixture.artifacts.descriptors[0].utf8)).toEqual({
    id: fixture.bindings.type,
    name: "Numeric",
    describes: "bead",
    conformsTo: [],
    propertiesSchema: fixture.bindings.schema,
  });
  expect(fixture.artifacts.schemas[0].retrievalUri).toBe(fixture.bindings.schema);
  expect(JSON.parse(fixture.artifacts.schemas[0].utf8)).toEqual({
    $id: fixture.bindings.schema,
    type: "object",
    properties: {
      n: { type: "number" },
      z: { type: "number" },
      nested: {
        type: "object",
        properties: { values: { type: "array", items: { type: "number" } } },
        required: ["values"],
        additionalProperties: false,
      },
    },
    required: ["n", "z", "nested"],
    additionalProperties: false,
  });
});

const prior = process.env.BDP_NUMERIC_PRIOR_OBSERVATION;
it.skipIf(!prior)(
  "numeric fixture passes real binding validation with retained served metadata",
  () => {
    if (!prior) throw Error("explicit retained observation required");
    const observation = JSON.parse(readFileSync(prior, "utf8"));
    const served = observation.binding.served;
    expect(observation.failures).toEqual([]);
    expect(served.fixtureId).toBe("reference-transactional-v1");
    const bound = bindServedProfileConfiguration({
      scope: served.scope,
      profile: served.profile,
      history: served.history,
      sourceCommit: served.sourceCommit,
      installedPayloadDigest: served.installedPayloadDigest,
      installedContractsDigest: served.installedContractsDigest,
      policyDigest: served.policyDigest,
      authenticationDigest: served.authenticationDigest,
      fixture: { bytes },
    });
    expect(bound.fixtureId).toBe(fixture.id);
    expect(bound.fixtureDigest).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(bound.fixtureDigest).not.toBe(served.fixtureDigest);
    const {
      fixtureDigest: _oldDigest,
      fixtureId: _oldId,
      capabilities: _oldCapabilities,
      ...oldFacts
    } = served;
    const {
      fixtureDigest: _newDigest,
      fixtureId: _newId,
      capabilities: _newCapabilities,
      ...newFacts
    } = bound;
    expect(newFacts).toEqual(oldFacts);
    // This is metadata validation, not a new launch, ready message or observed corrected binding.
  },
);
