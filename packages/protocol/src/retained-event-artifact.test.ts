import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";

const addFormats = formatsPlugin.default;

const root = new URL("../../../", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const schema = read("specs/profiles/core/bdp-v0.1.schema.json");
const paper = read("fixtures/retained-events/candidate.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv, { mode: "full" });
ajv.addSchema(schema);
function valid(name: string, value: unknown): boolean {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`missing artifact definition ${name}`);
  return Boolean(validate(value));
}
const clone = <T>(value: T): T => structuredClone(value);
const update = () =>
  clone(paper.pairs.find((p: { operation: string }) => p.operation === "updateBead").delta);

describe("retained Event source/grammar correspondence, without CLI/provider execution", () => {
  it("strictly compiles the complete candidate offline", () => {
    for (const name of Object.keys(schema.$defs))
      expect(ajv.getSchema(`${schema.$id}#/$defs/${name}`)).toBeDefined();
  });

  it("admits default/explicit CLI query pairs and rejects ambiguous or new selectors", () => {
    expect(valid("retainedEventQuery", {})).toBe(true);
    for (const p of paper.cliPairs) expect(valid("retainedEventQuery", p.query)).toBe(true);
    for (const value of [
      { from: "now", after: "cursor" },
      { from: "all" },
      { after: "" },
      { representation: "future" },
      { limit: 0 },
      { revision: "r1" },
      { selector: "$.x" },
      { omitRevisionProvenance: true },
    ])
      expect(valid("retainedEventQuery", value)).toBe(false);
  });

  it("requires a common postimage mode and positive declared replay/cursor duties", () => {
    const policy = paper.postimagePage.policy;
    expect(valid("retainedEventPolicy", policy)).toBe(true);
    expect(valid("retainedEventPolicy", { ...policy, representations: ["delta"] })).toBe(false);
    for (const key of ["minimumRetentionSeconds", "minimumCursorLifetimeSeconds"]) {
      expect(valid("retainedEventPolicy", { ...policy, [key]: 0 })).toBe(false);
      const missing = { ...policy };
      delete missing[key];
      expect(valid("retainedEventPolicy", missing)).toBe(false);
    }
    expect(valid("retainedEventPolicy", { ...policy, description: "" })).toBe(false);
  });

  it("checks both selected page representations and all six realized operation names", () => {
    expect(valid("retainedEventPage", paper.postimagePage)).toBe(true);
    expect(valid("retainedEventPage", paper.deltaPage)).toBe(true);
    expect(paper.pairs.map((p: { operation: string }) => p.operation)).toEqual([
      "createBead",
      "updateBead",
      "deleteBead",
      "createLink",
      "updateLink",
      "deleteLink",
    ]);
    for (const p of paper.pairs) {
      expect(valid(`${p.operation}Operation`, p.authored), p.operation).toBe(true);
      expect(valid("retainedDeltaEvent", p.delta), p.operation).toBe(true);
      expect(valid("retainedPostimageEvent", p.postimage), p.operation).toBe(true);
      expect(p.delta.id).toBe(p.postimage.id);
      expect(p.delta.revision).toBe(p.postimage.revision);
    }
  });

  it("refuses mixed payloads or an unadvertised delta selection", () => {
    const mixed = clone(paper.postimagePage);
    mixed.events[0] = paper.pairs[0].delta;
    expect(valid("retainedEventPage", mixed)).toBe(false);
    const unsupported = clone(paper.deltaPage);
    unsupported.policy.representations = ["postimage"];
    expect(valid("retainedEventPage", unsupported)).toBe(false);
  });

  it("pairs target, recorded identity, revisions and Link endpoints across the paper modes", () => {
    for (const p of paper.pairs) {
      const effect = p.delta.effect;
      const resource = p.postimage.effect.resource ?? p.postimage.effect.deleted.resource;
      const key = p.operation.startsWith("create")
        ? "id"
        : p.operation.endsWith("Bead")
          ? "bead"
          : "link";
      expect(effect[key]).toBe(resource.id);
      expect(p.delta.revision).toBe(resource.revision);
      if (effect.type) expect(effect.type).toEqual(resource.type);
      for (const endpoint of ["source", "target"])
        if (effect[endpoint]) expect(effect[endpoint]).toEqual(resource[endpoint]);
      if (p.operation.startsWith("update"))
        expect(p.delta.previousRevision).toBe(p.before.revision);
    }
  });

  it("reuses native Type/object/patch vocabulary while keeping request admission separate", () => {
    const effect = schema.$defs.retainedDeltaEffect.oneOf;
    for (const p of paper.pairs) {
      const shape = effect.find(
        (x: { properties: { operation: { const: string } } }) =>
          x.properties.operation.const === p.operation,
      );
      const members = schema.$defs[`${p.operation}Members`].properties;
      for (const key of ["type", "properties", "metadata"])
        if (shape.properties[key]) expect(shape.properties[key]).toEqual(members[key]);
      for (const key of ["propertiesChange", "metadataChange"])
        if (shape.properties[key])
          expect(shape.properties[key]).toEqual({ $ref: "#/$defs/propertyChange" });
      for (const key of ["expectedRevision", "name", "revisionProvenance"])
        expect(shape.properties).not.toHaveProperty(key);
    }
    expect(schema.$defs.ordinaryUpdateChange.items).toEqual({
      $ref: "#/$defs/propertyChange/items",
    });
  });

  it("represents a Type-only update without a fabricated patch", () => {
    const event = update();
    expect(valid("retainedDeltaEvent", event)).toBe(true);
    expect(event.effect).not.toHaveProperty("propertiesChange");
    expect(event.effect).not.toHaveProperty("change");
    expect(paper.pairs[1].before.type).not.toEqual(event.effect.type);
    expect(paper.pairs[1].postimage.effect.resource.properties).toEqual(
      paper.pairs[1].before.properties,
    );
  });

  it("refuses empty authored effects while allowing an explicit derived-only owner carrier", () => {
    const event = update();
    delete event.effect.type;
    expect(valid("retainedDeltaEvent", event)).toBe(false);
    expect(valid("retainedDeltaEvent", paper.derivedOnlyCarrier)).toBe(true);
    expect(valid("updateBeadOperation", paper.derivedOnlyCarrier.effect)).toBe(false);
    expect(
      valid("updateBeadOperation", {
        ...paper.derivedOnlyCarrier.effect,
        derived: paper.derivedOnlyCarrier.derived,
      }),
    ).toBe(false);
    for (const ownedLinks of [{}, null])
      expect(
        valid("retainedDeltaEvent", { ...paper.derivedOnlyCarrier, derived: { ownedLinks } }),
      ).toBe(true);
  });

  it("uses replacement-or-patch exclusivity independently for properties and metadata", () => {
    const event = update();
    delete event.effect.type;
    event.effect.properties = { title: "B" };
    event.effect.metadataChange = [{ op: "add", path: "/note", value: true }];
    expect(valid("retainedDeltaEvent", event)).toBe(true);
    event.effect.propertiesChange = [{ op: "replace", path: "/title", value: "C" }];
    expect(valid("retainedDeltaEvent", event)).toBe(false);
    delete event.effect.propertiesChange;
    event.effect.metadata = {};
    expect(valid("retainedDeltaEvent", event)).toBe(false);
  });

  it("does not require Types interpretation for a URI-only Core affiliation", () => {
    const event = update();
    event.effect.type = `${paper.scope}Task`;
    expect(valid("retainedDeltaEvent", event)).toBe(true);
    event.effect.type = { uri: `${paper.scope}Task`, revision: "" };
    expect(valid("retainedDeltaEvent", event)).toBe(false);
  });

  it("requires actual prior revisions only for updates and a final live revision for deletes", () => {
    const event = update();
    delete event.previousRevision;
    expect(valid("retainedDeltaEvent", event)).toBe(false);
    for (const p of paper.pairs.filter(
      (p: { operation: string }) => !p.operation.startsWith("update"),
    )) {
      expect(valid("retainedEvent", { ...p.postimage, previousRevision: "invented" })).toBe(false);
      const missing = clone(p.delta);
      delete missing.revision;
      expect(valid("retainedEvent", missing)).toBe(false);
    }
  });

  it("requires known Write correlation without inventing external transactions", () => {
    const event = update();
    delete event.transaction;
    expect(valid("retainedDeltaEvent", event)).toBe(false);
    event.origin = "observation";
    expect(valid("retainedDeltaEvent", event)).toBe(true);
    event.origin = "future";
    expect(valid("retainedDeltaEvent", event)).toBe(false);
  });

  it("keeps deletion context sufficient without retaining properties or new provenance", () => {
    const p = clone(paper.pairs[5].delta);
    expect(p.effect.deleted.source).toEqual(paper.pairs[3].postimage.effect.resource.source);
    delete p.effect.deleted.target;
    expect(valid("retainedDeltaEvent", p)).toBe(false);
    const properties = clone(paper.pairs[5].delta);
    properties.effect.deleted.resource.properties = { leaked: true };
    expect(valid("retainedDeltaEvent", properties)).toBe(false);
    expect(valid("retainedDeltaEvent", { ...paper.pairs[2].delta, revisionProvenance: {} })).toBe(
      false,
    );
  });

  it("requires complete postimage metadata and excludes incident aggregates", () => {
    const event = clone(paper.pairs[1].postimage);
    delete event.effect.resource.metadata;
    expect(valid("retainedPostimageEvent", event)).toBe(false);
    event.effect.resource.metadata = {};
    event.effect.resource.links = { items: [], next: null };
    expect(valid("retainedPostimageEvent", event)).toBe(false);
  });

  it("rejects unresolved handles, guards, request keys and the old change synonym", () => {
    for (const key of ["expectedRevision", "name", "idempotencyKey", "change"]) {
      const event = update();
      event.effect[key] = "unselected";
      expect(valid("retainedDeltaEvent", event), key).toBe(false);
    }
    const event = update();
    event.effect.bead = "@new";
    expect(valid("retainedDeltaEvent", event)).toBe(false);
    const create = clone(paper.pairs[3].delta);
    create.effect.source = "@new";
    expect(valid("retainedDeltaEvent", create)).toBe(false);
  });

  it("allows ignorable annotations but refuses unknown required semantics", () => {
    expect(
      valid("retainedDeltaEvent", { ...update(), annotations: { future: { hint: true } } }),
    ).toBe(true);
    expect(valid("retainedDeltaEvent", { ...update(), futureControl: "skip" })).toBe(false);
    const unknown = update();
    unknown.effect.operation = "futureUpdate";
    expect(valid("retainedDeltaEvent", unknown)).toBe(false);
  });

  it("preserves ordinary JSON property names rather than treating them as protocol controls", () => {
    const event = update();
    event.effect.properties = { type: "authored data", revisionProvenance: { id: "literal" } };
    expect(valid("retainedDeltaEvent", event)).toBe(true);
    expect(event.effect.properties.revisionProvenance).toEqual({ id: "literal" });
  });

  it("admits an empty covered static source and still requires explicit progress/context", () => {
    expect(valid("retainedEventPage", paper.staticPage)).toBe(true);
    for (const key of ["selection", "policy", "coverage", "cursor", "next"]) {
      const page = clone(paper.staticPage);
      delete page[key];
      expect(valid("retainedEventPage", page), key).toBe(false);
    }
    const wrong = clone(paper.staticPage);
    wrong.coverage.through = 4;
    expect(valid("retainedEventPage", wrong)).toBe(false);
  });

  it("retains each separately committed singleton postimage, without a batch policy claim", () => {
    const page = paper.separateSingletonUpdates;
    expect(valid("retainedEventPage", page)).toBe(true);
    expect(page.events[0].transaction).not.toBe(page.events[1].transaction);
    expect(page.events[0].revision).toBe(page.events[1].previousRevision);
    expect(page.events[0].effect.resource.revision).not.toBe(
      page.events[1].effect.resource.revision,
    );
    expect(
      paper.semanticCases.find((c: { id: string }) => c.id === "batch-final-publication").expect,
    ).toContain("at most one");
  });

  it("pairs nonempty observed samples and last-observed deletion context in both modes", () => {
    const observed = paper.observedSequence;
    expect(observed.backendFinalRevisionKnown).toBe(false);
    expect(observed.backendFinalAffiliationKnown).toBe(false);
    expect(observed.absenceConfirmed).toBe(true);
    for (const page of [observed.postimagePage, observed.deltaPage]) {
      expect(valid("retainedEventPage", page)).toBe(true);
      expect(page.policy.observation).toBe("observed");
      const [changed, disappeared] = page.events;
      expect(changed.origin).toBe("observation");
      expect(changed.previousRevision).toBe(observed.before.revision);
      expect(changed.revision).toBe(observed.sampled.revision);
      expect(observed.unobservedBackendIntermediate).not.toContain(changed.previousRevision);
      expect(changed).not.toHaveProperty("transaction");
      expect(disappeared.origin).toBe("observation");
      expect(disappeared.revision).toBe(observed.sampled.revision);
      expect(disappeared.effect.deleted.resource).toEqual({
        id: observed.sampled.id,
        type: observed.sampled.type,
        revision: observed.sampled.revision,
      });
      expect(disappeared).not.toHaveProperty("transaction");
      expect(disappeared).not.toHaveProperty("previousRevision");
      expect(disappeared.effect.deleted.resource).not.toHaveProperty("properties");
    }
    expect(observed.postimagePage.events[0].effect.resource).toEqual(observed.sampled);
    expect(observed.deltaPage.events[0].effect.type).toEqual(observed.sampled.type);
    expect(observed.deltaPage.events[0].effect.propertiesChange).toEqual([
      { op: "replace", path: "/title", value: observed.sampled.properties.title },
    ]);
  });

  it("records precise observed refusal controls when required context or absence is unknown", () => {
    for (const control of paper.observedSequence.refusals) {
      expect(control.priorContextKnown && control.absenceConfirmed).toBe(false);
      expect(valid("retainedEventProblem", control.response)).toBe(true);
      expect(control.response.code).toBe("foreign-view");
      expect(control.response.status).toBe(409);
      expect(control.response).not.toHaveProperty("events");
      expect(control.response).not.toHaveProperty("cursor");
      expect(control.cursorAfter).toBe(control.cursorBefore);
    }
  });

  it("uses existing precise read Problems rather than importing receipt/replica errors", () => {
    for (const problem of paper.problems)
      expect(valid("retainedEventProblem", problem), problem.code).toBe(true);
    expect(
      valid("retainedEventProblem", { ...paper.problems[0], code: "event-history-expired" }),
    ).toBe(false);
    expect(valid("retainedEventProblem", { ...paper.problems[0], status: 200 })).toBe(false);
  });
});
