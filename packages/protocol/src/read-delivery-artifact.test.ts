import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, root), "utf8");
const native = JSON.parse(read("specs/profiles/core/bdp-v0.1.schema.json"));
const framing = JSON.parse(read("docs/cli-design/read-framing.schema.json"));
const paper = JSON.parse(read("fixtures/read-delivery/candidate.json"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv, { mode: "full" });
ajv.addSchema(native);
ajv.addSchema(framing);
const valid = (name: string, value: unknown, bundle = framing) => {
  const validate = ajv.getSchema(`${bundle.$id}#/$defs/${name}`);
  if (!validate) throw new Error(`missing artifact definition ${name}`);
  return Boolean(validate(value));
};
const sample = (id: string) =>
  structuredClone(paper.finite.find((x: { id: string }) => x.id === id).value);
const stream = (id: string) =>
  structuredClone(paper.streams.find((x: { id: string }) => x.id === id).records);

type RecordValue = {
  [key: string]: unknown;
  record_type?: string;
  result_kind?: string;
  outcome?: string;
  completion?: { returned: number; exhausted: boolean | null; stop_reason: string };
  continuation?: string | null;
  data?: unknown;
};

// Paper sequence assertions only: this is not a renderer, network reader or page loop.
function sequence(records: RecordValue[]): void {
  expect(records.length).toBeGreaterThanOrEqual(2);
  const first = records[0];
  const last = records[records.length - 1];
  expect(valid("header", first)).toBe(true);
  expect(valid("terminal", last)).toBe(true);
  const items = records.slice(1, -1);
  for (const item of items) expect(valid("item", item)).toBe(true);
  const { record_type: _header, ...header } = first;
  const { record_type: _terminal, continuation, ...terminal } = last;
  const frame: Record<string, unknown> = { ...header, ...terminal };
  if (first.result_kind === "resource_collection") {
    if (last.completion) {
      expect(last.completion.returned).toBe(items.length);
      const data: { items: unknown[]; next?: string | null } = {
        items: items.map((item) => item.data),
      };
      if (Object.hasOwn(last, "continuation")) data.next = continuation;
      frame.data = data;
      if (last.outcome === "success") {
        expect(Object.hasOwn(last, "continuation")).toBe(true);
        expect(continuation === null).toBe(last.completion.exhausted === true);
      } else if (continuation === null) {
        expect(last.completion.exhausted).toBe(true);
      }
    } else {
      expect(items).toHaveLength(0);
      expect(Object.hasOwn(last, "continuation")).toBe(false);
    }
  } else {
    expect(last).not.toHaveProperty("completion");
    expect(last).not.toHaveProperty("continuation");
    expect(items.length).toBeLessThanOrEqual(1);
    if (items.length) frame.data = items[0].data;
  }
  expect(valid("envelope", frame)).toBe(true);
}

describe("ordinary read paper artifacts, without CLI or HTTP execution", () => {
  it("compiles the separate CLI subset without adding a native definition/export", () => {
    for (const name of Object.keys(framing.$defs))
      expect(ajv.getSchema(`${framing.$id}#/$defs/${name}`)).toBeDefined();
    expect(Object.keys(native.$defs)).toHaveLength(171);
    expect(native.$defs).not.toHaveProperty("readFraming");
    expect(framing.$id).not.toBe(native.$id);
  });

  it("accepts the finite descriptor examples and checks full native records separately", () => {
    for (const entry of paper.finite) expect(valid("envelope", entry.value), entry.id).toBe(true);
    expect(valid("beadRecord", paper.native.bead, native)).toBe(true);
    expect(valid("linkRecord", paper.native.link, native)).toBe(true);
    expect(valid("readDiscovery", sample("scope-descriptor").data, native)).toBe(true);
    expect(valid("resource", sample("projected-primary").data)).toBe(true);
    expect(valid("beadRecord", sample("projected-primary").data, native)).toBe(false);

    // Static paper pairing, not execution of a field-mask renderer.
    const unmasked = sample("properties-are-data");
    const projected = paper.finite.find(
      (entry: { id: string }) => entry.id === "projected-properties-id-only",
    );
    expect(projected.inputId).toBe("properties-are-data");
    expect(unmasked).not.toHaveProperty("projection");
    expect(Object.keys(unmasked.data)).toEqual(["id", "type", "items", "next"]);
    expect(projected.value.projection).toEqual({ include: ["/id"] });
    expect(projected.value.data).toEqual({ id: unmasked.data.id });
    expect(projected.value.context).toEqual(unmasked.context);
  });

  it("keeps the immutable selected contract distinct from schema/executable versions", () => {
    for (const change of [{ schema_version: "2" }, { schema_version: 3 }, { bdp_spec: "0.1" }])
      expect(valid("envelope", { ...sample("full-point"), ...change })).toBe(false);
    expect(valid("envelope", { ...sample("full-point"), outcome: "unknown" })).toBe(false);
    expect(valid("envelope", { ...sample("full-point"), outcome: "error" })).toBe(false);
  });

  it("requires declared Resource kind even for empty/ordinary-properties data", () => {
    for (const id of ["empty-exhausted", "full-point", "properties-are-data"]) {
      const value = sample(id);
      delete value.context.resource_kind;
      expect(valid("envelope", value), id).toBe(false);
    }
    const value = sample("full-link");
    delete value.data.source;
    expect(valid("envelope", value)).toBe(false);
    const projected = sample("projected-primary");
    delete projected.data.type.revision;
    expect(valid("envelope", projected)).toBe(false);
  });

  it("does not confuse a bodyless GET with an empty collection or HEAD metadata", () => {
    const value = sample("bodyless-not-modified");
    value.data = { items: [], next: null };
    value.completion = { returned: 0, exhausted: true, stop_reason: "exhausted" };
    expect(valid("envelope", value)).toBe(false);
    const head = sample("head-not-modified");
    expect(valid("envelope", head)).toBe(true);
    delete head.data;
    expect(valid("envelope", head)).toBe(false);
    expect(sample("bodyless-http-failure").error.origin).toBe("cli");
  });

  it("preserves local/native error origins without treating framing as Problem validation", () => {
    const refusal = sample("native-refusal");
    expect(refusal.error.problem).toEqual({
      type: "https://github.com/gastownhall/bdp/problems/not-found",
      code: "resource-not-found",
      retry: "after-state-change",
      status: 404,
    });
    expect(valid("readProblem", refusal.error.problem, native)).toBe(true);
    delete refusal.error;
    expect(valid("envelope", refusal)).toBe(false);
    expect(
      valid("envelope", { ...sample("full-point"), error: sample("native-refusal").error }),
    ).toBe(false);
  });

  it("declares original-value RFC6901 masks and rejects alternate pointer grammars", () => {
    for (const pointer of ["", "/properties/a~1b", "/properties/a~0b", "/properties/steps/2"])
      expect(valid("projection", { include: [pointer] }), pointer).toBe(true);
    for (const pointer of ["envelope", "#/properties/a", "$.properties.a", "/bad~2escape"])
      expect(valid("projection", { omit: [pointer] }), pointer).toBe(false);
    expect(valid("projection", {})).toBe(false);
    // Protected-plane/original-index evaluation remains semantic, not a simulated renderer here.
  });

  it("keeps success completion distinct from partial error and unavailable continuation", () => {
    const interrupted = sample("interrupted-mid-page");
    expect(valid("envelope", interrupted)).toBe(true);
    expect(interrupted.data).not.toHaveProperty("next");
    expect(valid("envelope", { ...interrupted, outcome: "success", error: undefined })).toBe(false);
    const empty = sample("empty-not-exhausted");
    empty.completion.exhausted = true;
    expect(valid("envelope", empty)).toBe(false);
  });

  it("accepts finite JSONL sequences with exact item counts and terminal context", () => {
    for (const value of paper.streams) sequence(value.records);
  });

  it("rejects missing/early/duplicate terminals and invented JSONL success records", () => {
    const value = stream("one-capped-stream");
    for (const bad of [
      value.slice(0, -1),
      [value[0], value[2], value[1]],
      [value[0], value[1], value[2], value[2]],
      [{ ...value[0], outcome: "success" }, value[1], value[2]],
    ])
      expect(() => sequence(bad)).toThrow();
  });

  it("rejects false delivered counts, missing native boundaries and wrong primary units", () => {
    let value = stream("one-capped-stream");
    value[2].completion.returned = 2;
    expect(() => sequence(value)).toThrow();
    value = stream("one-capped-stream");
    delete value[2].continuation;
    expect(() => sequence(value)).toThrow();
    value = stream("one-capped-stream");
    value[2].continuation = null;
    expect(() => sequence(value)).toThrow();
    value = stream("point-stream");
    delete value[1].data.target;
    expect(() => sequence(value)).toThrow();
  });

  it("retains explicit query correspondences without claiming command compilation", () => {
    const pairs = Object.fromEntries(
      paper.cliPairs.map((x: { id: string; query: Record<string, string> }) => [x.id, x]),
    );
    expect(pairs["exact-and-family"].query).toEqual({
      conformsTo: "https://types.example/Issue",
      type: "https://types.example/Task",
    });
    expect(pairs["external-endpoint"].query.endpoint).toBe("urn:example:external");
    const historical = pairs["historical-token"];
    expect(new URLSearchParams(historical.encodedQuery).get("revision")).toBe(
      historical.query.revision,
    );
    const incident = paper.transportExamples[0];
    expect(incident.headers["bdp-resource-kind"]).toEqual(["bead"]);
    expect(incident.headers["bdp-collection-kind"]).toEqual(["link"]);
    expect(valid("linkCollection", incident.body, native)).toBe(true);
  });
});
