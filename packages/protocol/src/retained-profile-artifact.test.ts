import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { describe, expect, it } from "vitest";

const addFormats = formatsPlugin.default;

const root = new URL("../../../", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const schema = read("specs/profiles/core/bdp-v0.1.schema.json");
const old = read("specs/profiles/core/bdp-v0.schema.json");
const framing = read("docs/cli-design/read-framing.schema.json");
const paper = read("fixtures/retained-profile/candidate.json");
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv, { mode: "full" });
for (const s of [schema, old, framing]) ajv.addSchema(s);
function valid(name: string, value: unknown, bundle = schema): boolean {
  const validate = ajv.getSchema(`${bundle.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`missing artifact definition ${name}`);
  return Boolean(validate(value));
}

describe("retained profile/CLI paper artifacts, without provider or command execution", () => {
  it("strictly compiles all candidate definitions without network resolution", () => {
    for (const name of Object.keys(schema.$defs))
      expect(ajv.getSchema(`${schema.$id}#/$defs/${name}`)).toBeDefined();
    for (const name of [
      "coreDiscovery",
      "writeDiscovery",
      "retainedDiscovery",
      "writeOperationDirectory",
      "coreAdvertisedLimits",
      "writeAdvertisedLimits",
    ])
      expect(ajv.getSchema(`${schema.$id}#/$defs/${name}`)).toBeDefined();
  });

  it("admits minimal Core without a Type inventory and requires actual Event navigation", () => {
    expect(valid("coreDiscovery", paper.core)).toBe(true);
    expect(paper.core).not.toHaveProperty("types");
    expect(paper.core).not.toHaveProperty("operations");
    const absent = { ...paper.core };
    delete absent.events;
    expect(valid("coreDiscovery", absent)).toBe(false);
    expect(valid("coreDiscovery", { ...paper.core, events: "relative" })).toBe(false);
    // A navigation member is not evidence that D1/D2 or provider obligations are satisfied.
  });

  it("lets a Core reader recognize both retained discovery arms and future optional capabilities", () => {
    for (const value of [paper.core, paper.write, paper.richerWrite])
      expect(valid("retainedDiscovery", value)).toBe(true);
    expect(valid("coreDiscovery", paper.write)).toBe(false);
    expect(valid("writeDiscovery", paper.core)).toBe(false);
    const capability = "https://github.com/gastownhall/bdp/capabilities/atomic-batch";
    expect(
      valid("coreDiscovery", {
        ...paper.core,
        capabilities: { [capability]: paper.richerWrite.capabilities[capability] },
      }),
    ).toBe(false);
    expect(
      valid("coreDiscovery", {
        ...paper.core,
        capabilities: { [capability]: { "2": { future: true } } },
      }),
    ).toBe(true);
    // Every Core client parses the union, not just the Core-service arm.
  });

  it("keeps old cumulative profile helpers as staging input rather than the new front door", () => {
    const staged = read("fixtures/read-delivery/candidate.json").finite.find(
      (x: { id: string }) => x.id === "scope-descriptor",
    ).value.data;
    expect(valid("readDiscovery", staged)).toBe(true);
    expect(valid("retainedDiscovery", staged)).toBe(false);
    expect(valid("readDiscovery", paper.core)).toBe(false);
    expect(valid("readDiscovery", paper.core, old)).toBe(false);
    for (const profile of ["read", "read-update", "transactional", "experimental"])
      expect(valid("retainedDiscovery", { ...paper.core, profile })).toBe(false);
  });

  it("rejects advanced required root fields instead of treating them as future base metadata", () => {
    for (const name of [
      "types",
      "scopeEpoch",
      "authorizationView",
      "headPosition",
      "minimumReplayPosition",
      "receipts",
      "snapshot",
      "changes",
      "futureRequiredRoot",
    ]) {
      expect(
        valid("coreDiscovery", { ...paper.core, [name]: "https://example.test/value" }),
        name,
      ).toBe(false);
      expect(
        valid("writeDiscovery", { ...paper.write, [name]: "https://example.test/value" }),
        name,
      ).toBe(false);
    }
  });

  it("requires the eight absolute singleton targets without sequence, batch or sets", () => {
    expect(valid("writeOperationDirectory", paper.directory)).toBe(true);
    expect(Object.keys(paper.directory)).toEqual(
      paper.cliPairs.map((p: { operation: string }) => p.operation),
    );
    for (const name of Object.keys(paper.directory)) {
      const value = { ...paper.directory };
      delete value[name];
      expect(valid("writeOperationDirectory", value), name).toBe(false);
    }
    for (const name of ["sequence", "batch", "updateWhere", "deleteWhere"])
      expect(
        valid("writeOperationDirectory", {
          ...paper.directory,
          [name]: "https://example.test/command",
        }),
      ).toBe(false);
    expect(valid("writeOperationDirectory", { ...paper.directory, createBead: "new-item" })).toBe(
      false,
    );
  });

  it("keeps Write's aliases/operations mandatory while Core aliases remain optional", () => {
    expect(valid("coreDiscovery", { ...paper.core, aliases: paper.core.scope })).toBe(true);
    for (const name of ["aliases", "operations"]) {
      const value = { ...paper.write };
      delete value[name];
      expect(valid("writeDiscovery", value)).toBe(false);
    }
  });

  it("separates small read/write limit groups from sequence and replica machinery", () => {
    expect(valid("coreAdvertisedLimits", { retention: { maximumSnapshotLifetime: "PT1H" } })).toBe(
      true,
    );
    expect(valid("writeAdvertisedLimits", { retention: { idempotency: "PT1H" } })).toBe(true);
    expect(valid("writeAdvertisedLimits", { validation: { diagnostics: 10 } })).toBe(true);
    for (const name of ["sequence", "transaction"])
      expect(valid("writeAdvertisedLimits", { [name]: { operations: 3 } })).toBe(false);
    expect(valid("coreAdvertisedLimits", { retention: { replay: "PT1H" } })).toBe(false);
    expect(valid("coreAdvertisedLimits", { retention: { idempotency: "PT1H" } })).toBe(false);
    expect(valid("writeAdvertisedLimits", { retention: { receipt: "PT1H" } })).toBe(false);
    expect(valid("writeAdvertisedLimits", { patch: { operations: 0 } })).toBe(false);
  });

  it("checks all ordinary CLI request pairs against native singleton grammar, without compiling argv", () => {
    for (const pair of paper.cliPairs) {
      expect(valid(`${pair.operation}Request`, pair.request), pair.operation).toBe(true);
      expect(pair.request).not.toHaveProperty("force");
      expect(pair.request).not.toHaveProperty("operation");
    }
    expect(
      paper.cliPairs.find((x: { operation: string }) => x.operation === "deleteBead").argv,
    ).toContain("--force");
  });

  it("preserves exact affiliation/effect and distinct native alias/deleted results", () => {
    expect(valid("mutationResult", paper.mutationResult)).toBe(true);
    expect(valid("mutationResult", paper.deletedResult)).toBe(true);
    expect(valid("aliasResult", paper.aliasResult)).toBe(true);
    expect(paper.beforeUpdate.type.revision).not.toBe(paper.mutationResult.resource.type.revision);
    expect(paper.mutationResult.changed).toBe(true);
    expect(paper.aliasResult).not.toHaveProperty("changed");
    expect(paper.aliasResult).not.toHaveProperty("revision");
    expect(paper.deletedResult.deleted.resource.revision).toBe(
      paper.mutationResult.resource.revision,
    );
  });

  it("declares observational preview only in CLI context, without a native field", () => {
    expect(valid("envelope", paper.deletePreview, framing)).toBe(true);
    expect(paper.deletePreview.data).toEqual(paper.mutationResult.resource);
    expect(paper.deletePreview.data).not.toHaveProperty("preview");
    expect(
      valid(
        "envelope",
        {
          ...paper.deletePreview,
          context: { ...paper.deletePreview.context, preview: "update" },
        },
        framing,
      ),
    ).toBe(false);
  });

  it("keeps one native History page and every JSONL row's subject/kind/context losslessly", () => {
    expect(valid("coreDiscovery", paper.historyCore)).toBe(true);
    expect(valid("historyVersionsPage", paper.historyPage)).toBe(true);
    const [header, item, terminal] = paper.historyJsonl;
    const { items, next, ...context } = paper.historyPage;
    expect(header.context.history).toEqual(context);
    expect(item.data).toEqual({ resource: context.subject, kind: "bead", ...items[0] });
    expect(item.data).not.toHaveProperty("version");
    expect(terminal.continuation).toBe(next);
    expect(terminal.completion.returned).toBe(items.length);
    expect(valid("historyVersionsPage", paper.unknownKindHistoryPage)).toBe(true);
    expect(paper.unknownKindHistoryContext.resource_kind).toBeNull();
    expect(paper.unknownKindHistoryContext.history.participation).toBe("undetermined");
    expect(paper.unknownKindHistoryPage.items).toHaveLength(0);
    // This is static row/context pairing, not cursor fetching, row authorization or rendering.
  });

  it("does not relabel known successful data as unknown or a local pre-binding error as native", () => {
    const failure = paper.knownOutputFailure;
    expect(valid("mutationResult", failure.data)).toBe(true);
    expect(failure.outcome).toBe("failure");
    expect(failure.context.operation_outcome).toBe("success");
    expect(failure.error.problem.code).toBe("output_failed");
    expect(paper.unknownWrite.outcome).toBe("unknown");
    expect(paper.unknownWrite).not.toHaveProperty("data");
    expect(paper.unknownWrite.context.recovery.argv).toContain("--retry-file");
    expect(paper.unboundDiagnostic.bdp_spec).toBeNull();
    expect(paper.unboundDiagnostic.error.origin).toBe("cli");
    expect(valid("envelope", paper.unboundDiagnostic, framing)).toBe(false);
    // Unbound/mutation/History descriptors are outside the six ordinary-read schema subset.
  });

  it("provides a finite source cutline with genuine design/owner/deferred/qualification gates", () => {
    expect(
      paper.cutline.filter((x: { status: string }) => x.status === "source-complete"),
    ).toHaveLength(10);
    expect(
      paper.cutline.filter((x: { status: string }) => x.status === "design-gated"),
    ).toHaveLength(2);
    expect(
      paper.cutline.filter((x: { status: string }) => x.status === "owner-gated"),
    ).toHaveLength(2);
    expect(paper.cutline.filter((x: { status: string }) => x.status === "deferred")).toHaveLength(
      2,
    );
    expect(
      paper.cutline.filter((x: { status: string }) => x.status === "qualification-gated"),
    ).toHaveLength(1);
    expect(paper.semanticCases).toHaveLength(12);
  });
});
