import { expect, it } from "vitest";
import {
  HISTORICAL_UPDATE_CAPABILITY,
  parseHistoricalUpdateRequest,
  parseHistoricalUpdateResult,
  parseHistoricalUpdateView,
  readHistoricalUpdateCapability,
} from "./historical-update-values.js";
import { parseRetainedWriteDiscovery, parseRetainedWriteInput } from "./retained-write-values.js";
import { parseRetainedResource } from "./retained-read-values.js";
const scope = "https://wire.example/work/";
const resource = {
  id: `${scope}a`,
  type: `${scope}Note`,
  revision: "R8",
  properties: { title: "Historical" },
  metadata: {},
};
const context = { fromRevision: "R1", previousRevision: "R7" };
it("keeps source/current roles and feature result outside the unchanged Resource", () => {
  const request = JSON.stringify({ bead: `${scope}a`, fromRevision: "R1", expectedRevision: "R7" });
  expect(parseHistoricalUpdateRequest(request).fromRevision).toBe("R1");
  expect(() => parseRetainedWriteInput("updateBead", request)).toThrow();
  const parsed = parseHistoricalUpdateResult(
    JSON.stringify({
      result: { outcome: "updated", changed: true, resource },
      historicalUpdate: context,
    }),
  );
  expect(parsed.historicalUpdate).toEqual(context);
  expect(parseRetainedResource(JSON.stringify(parsed.result.resource), "bead")).toEqual(resource);
  expect(() =>
    parseRetainedResource(JSON.stringify({ ...resource, historicalUpdate: context }), "bead"),
  ).toThrow();
  expect(
    parseHistoricalUpdateView(JSON.stringify({ resource, historicalUpdate: context }))
      .historicalUpdate,
  ).toEqual(context);
});
it("requires a new sourced transition's context but preserves original context/absence on no-op", () => {
  const result = { outcome: "updated", changed: true, resource };
  expect(() => parseHistoricalUpdateResult(JSON.stringify({ result }))).toThrow();
  expect(
    parseHistoricalUpdateResult(JSON.stringify({ result: { ...result, changed: false } }))
      .historicalUpdate,
  ).toBeUndefined();
  expect(
    parseHistoricalUpdateResult(
      JSON.stringify({
        result: { ...result, changed: false },
        historicalUpdate: {
          fromRevision: "earlier-source",
          previousRevision: "earlier-predecessor",
        },
      }),
    ).historicalUpdate?.fromRevision,
  ).toBe("earlier-source");
  expect(() =>
    parseHistoricalUpdateResult(
      JSON.stringify({ result: { ...result, outcome: "created" }, historicalUpdate: context }),
    ),
  ).toThrow();
});
it.each([
  { bead: `${scope}a`, fromRevision: "" },
  { bead: `${scope}a`, fromRevision: "R1", properties: {}, propertiesChange: [] },
  { bead: `${scope}a`, fromRevision: "R1", revisionProvenance: { historicalUpdate: context } },
])("rejects malformed/competing/caller-forged feature input", (request) => {
  expect(() => parseHistoricalUpdateRequest(JSON.stringify(request))).toThrow();
});
it("selects only advertised exact version1 and keeps batch composition explicit", () => {
  const discovery = (versions: unknown) =>
    parseRetainedWriteDiscovery(
      JSON.stringify({
        bdpVersion: "0.1",
        profile: "write",
        scope,
        beads: `${scope}beads`,
        links: `${scope}links`,
        aliases: `${scope}aliases/`,
        operations: `${scope}operations`,
        capabilities: { [HISTORICAL_UPDATE_CAPABILITY]: versions },
      }),
    );
  expect(readHistoricalUpdateCapability(discovery({ "2": {} }))).toBeUndefined();
  expect(readHistoricalUpdateCapability(discovery({ "1": { atomicBatch: false } }))).toEqual({
    atomicBatch: false,
  });
  expect(() => readHistoricalUpdateCapability(discovery({ "1": {} }))).toThrow();
});
