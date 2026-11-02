import { describe, expect, it, vi } from "vitest";
import { decodeJsonDocument, admitJsonNumbers, stringifyJsonValue } from "@bdp/protocol";
import {
  CanonicalInputError,
  compileCanonicalInput,
  parseCanonicalReference,
  type CanonicalInputRequest,
} from "./canonical-input.js";

const scope = "https://work.example/acme/";
const compile = (command: string, options: Record<string, unknown> = {}, positionals: readonly string[] = [], extra: Partial<CanonicalInputRequest> = {}) =>
  compileCanonicalInput({ command, options, positionals, scope, ...extra });
const body = async (promise: ReturnType<typeof compile>) => JSON.parse((await promise).bodyText) as Record<string, unknown>;
const bytes = (value: string) => new TextEncoder().encode(value);

describe("canonical References without lookup", () => {
  it("resolves complete Scope-relative paths without inserting a kind prefix", () => {
    expect(parseCanonicalReference("notes/item", scope)).toBe(`${scope}notes/item`);
    expect(parseCanonicalReference("names/current", scope)).toBe(`${scope}names/current`);
  });
  it("preserves raw absolute URL @ literally and parses bracketed exact pins", () => {
    expect(parseCanonicalReference(`${scope}notes@4`, scope)).toBe(`${scope}notes@4`);
    expect(parseCanonicalReference(`[${scope}notes@4]@==saved`, scope)).toEqual({ uri: `${scope}notes@4`, revision: "=saved" });
    expect(parseCanonicalReference("note@=123", scope)).toEqual({ uri: `${scope}note`, revision: "123" });
    expect(parseCanonicalReference("note@=current", scope)).toEqual({ uri: `${scope}note`, revision: "current" });
  });
  it.each(["note@4", "note@9223372036854775807", "note@current", "note@old", "note@=", `[${scope}note]`, "../note", "/note", "note?query", "note#frag", "", "@new"])("refuses unresolved/ambiguous input %s", (input) => {
    expect(() => parseCanonicalReference(input, scope)).toThrow();
  });
  it("refuses every authored subject pin and only admits explicit batch handles in legal positions", () => {
    expect(() => parseCanonicalReference("note@=r1", scope, { mutationSubject: true })).toThrow(CanonicalInputError);
    expect(() => parseCanonicalReference("batch-ref::x", scope)).toThrow(CanonicalInputError);
    expect(parseCanonicalReference("batch-ref::x", scope, { mutationSubject: true, allowBatchReference: true })).toBe("@x");
    expect(() => parseCanonicalReference("batch-ref::x@=r1", scope, { allowBatchReference: true })).toThrow();
  });
});

describe("canonical ordinary mutation compilation", () => {
  it("creates with full IDs, exact Type pin, explicit null/presence and literal nested data", async () => {
    expect(await body(compile("create", {
      type: "Task@=t1", id: "notes/item", properties: '{"nullable":null,"literal":"batch-ref::x","__proto__":{"safe":true}}', metadata: "{}",
    }))).toEqual({ type: { uri: `${scope}Task`, revision: "t1" }, id: `${scope}notes/item`, properties: { nullable: null, literal: "batch-ref::x", ["__proto__"]: { safe: true } }, metadata: {} });
    expect(await body(compile("create", { type: "Task" }))).toEqual({ type: `${scope}Task` });
    expect(await body(compile("create", { type: "Task", idRoot: "notes" }))).toEqual({ type: `${scope}Task`, idRoot: "notes" });
  });
  it("preserves exact guard token and permits empty authored patch but not attribution/guard-only update", async () => {
    for (const token of ["123", "=saved", "@current"]) {
      expect(await body(compile("update", { ifRevision: token, patchProperties: "[]" }, ["note"]))).toEqual({ bead: `${scope}note`, expectedRevision: token, propertiesChange: [] });
    }
    await expect(compile("update", { ifRevision: "r1" }, ["note"])).rejects.toThrow();
    await expect(compile("update", { revisionProvenance: "{}" }, ["note"])).rejects.toThrow();
  });
  it("lowers shallow merge in code-unit key order without recursively merging", async () => {
    expect(await body(compile("update", { properties: '{"z":{"v":1},"a":null}', replaceMetadata: "{}" }, ["note"]))).toEqual({
      bead: `${scope}note`, propertiesChange: [{ op: "add", path: "/a", value: null }, { op: "add", path: "/z", value: { v: 1 } }], metadata: {},
    });
    expect(await body(compile("update", { properties: "{}" }, ["note"]))).toEqual({ bead: `${scope}note`, propertiesChange: [] });
  });
  it("keeps keyed first occurrence order, last set, literal keys and unsets after sets", async () => {
    expect(await body(compile("update", {
      setProperty: ["a/b~c=1", "z=true", "a/b~c=2", "text=a=b", "nil=null", "obj={}"], unsetProperty: ["z", "z", "absent"],
    }, ["note"]))).toEqual({ bead: `${scope}note`, propertiesChange: [
      { op: "add", path: "/a~1b~0c", value: 2 }, { op: "add", path: "/z", value: true },
      { op: "add", path: "/text", value: "a=b" }, { op: "add", path: "/nil", value: null }, { op: "add", path: "/obj", value: "{}" },
      { op: "add", path: "/z", value: null }, { op: "remove", path: "/z" }, { op: "add", path: "/absent", value: null }, { op: "remove", path: "/absent" },
    ] });
  });
  it("allows the empty literal object key for both set and unset", async () => {
    expect(await body(compile("update", { setProperty: ["=literal"], unsetMetadata: [""] }, ["note"]))).toEqual({
      bead: `${scope}note`, propertiesChange: [{ op: "add", path: "/", value: "literal" }],
      metadataChange: [{ op: "add", path: "/", value: null }, { op: "remove", path: "/" }],
    });
  });
  it("preserves strict patch order, root edits and exact replacement intent", async () => {
    const patch = [{ op: "replace", path: "", value: { a: [1] } }, { op: "remove", path: "/a/0" }];
    expect(await body(compile("update", { patchProperties: JSON.stringify(patch) }, ["note"]))).toEqual({ bead: `${scope}note`, propertiesChange: patch });
    expect(await body(compile("update", { replaceProperties: "{}", metadata: '{"x":1}' }, ["note"]))).toEqual({ bead: `${scope}note`, properties: {}, metadataChange: [{ op: "add", path: "/x", value: 1 }] });
  });
  it.each([
    '[{"op":"move","path":"/x","from":"/y"}]', '[{"op":"remove","path":"/x","value":null}]',
    '[{"op":"add","path":"/x"}]', '[{"op":"add","path":"/x~2","value":1}]',
    '[{"op":"add","path":"x","value":1}]', '[{"op":"remove","path":"","extra":1}]', '{}', 'null',
  ])("refuses non-closed/malformed strict patch %s", async (patchProperties) => {
    await expect(compile("update", { patchProperties }, ["note"])).rejects.toThrow(CanonicalInputError);
  });
  it.each([
    { type: "Task", properties: "{}", setProperty: ["x=1"] }, { type: "Task", replaceProperties: "{}" },
    { type: "Task", id: "x", idRoot: "y" }, { type: "Task", id: "x@2" }, { type: "Task", id: "https://else.example/x" },
  ])("refuses conflicting/invalid creation inputs %j", async (options) => {
    await expect(compile("create", options)).rejects.toThrow();
  });
  it("supports the three Link binding forms, rejecting equal duplicates", async () => {
    for (const [options, args] of [
      [{ type: "Relates" }, ["a@=a1", "b"]], [{ type: "Relates", to: "b" }, ["a@=a1"]],
      [{ type: "Relates", from: "a@=a1", to: "b" }, []],
    ] as const) expect(await body(compile("link create", options, args))).toEqual({ type: `${scope}Relates`, source: { uri: `${scope}a`, revision: "a1" }, target: `${scope}b` });
    await expect(compile("link create", { type: "Relates", to: "b" }, ["a", "b"])).rejects.toThrow();
    await expect(compile("link create", { type: "Relates", from: "a" }, ["b"])).rejects.toThrow();
    expect(await body(compile("link update", { to: "b@=b1" }, ["edge"]))).toEqual({ link: `${scope}edge`, target: { uri: `${scope}b`, revision: "b1" } });
  });
  it("compiles both deletes and aliases without inventing provenance", async () => {
    expect(await body(compile("delete", { force: true, ifRevision: "r1" }, ["note"]))).toEqual({ bead: `${scope}note`, expectedRevision: "r1" });
    expect(await body(compile("link delete", { force: true }, ["edge"]))).toEqual({ link: `${scope}edge` });
    expect(await body(compile("alias put", { target: "note" }, ["names/current"]))).toEqual({ alias: `${scope}names/current`, target: `${scope}note` });
    expect(await body(compile("alias delete", { force: true }, ["names/current"]))).toEqual({ alias: `${scope}names/current` });
    await expect(compile("alias delete", {}, ["names/current"])).rejects.toThrow();
    await expect(compile("alias put", { target: "note@=r1" }, ["names/current"])).rejects.toThrow();
    for (const command of ["delete", "alias delete"]) await expect(compile(command, { force: true, actor: "human:x" }, ["note"])).rejects.toThrow();
  });
  it("refuses out-of-Scope aliases and all alias batch members", async () => {
    await expect(compile("alias put", { target: "https://other.example/note" }, ["names/current"])).rejects.toThrow();
    await expect(compile("alias delete", { force: true }, ["https://other.example/names/current"])).rejects.toThrow();
    for (const command of ["alias put", "alias delete"])
      await expect(compile(command, { target: "note", force: true, dryRunMode: "batch" }, ["names/current"])).rejects.toThrow("six CRUD");
  });
  it("lowers actor only to admitted attribution and refuses conflicting explicit actor", async () => {
    expect(await body(compile("update", { actor: "human:x", metadata: "{}", revisionProvenance: '{"message":null,"actor":{"basis":"writer-supplied","id":"human:x"}}' }, ["note"]))).toEqual({ bead: `${scope}note`, metadataChange: [], revisionProvenance: { message: null, actor: { id: "human:x", basis: "writer-supplied" } } });
    await expect(compile("create", { type: "Task", actor: "x", revisionProvenance: '{"actor":{"id":"y","basis":"writer-supplied"}}' })).rejects.toThrow();
    await expect(compile("create", { type: "Task", revisionProvenance: '{"committedAt":"invented"}' })).rejects.toThrow();
  });
});

describe("frozen JSON inputs and finite offline member emission", () => {
  it.each(['{"x":1,"x":2}', '{"x":9007199254740993}', '{"x":1e400}', '{"x":1e-400}', '{"x":"\\ud800"}', '{"x":01}'])
    ("refuses JSON before precision/duplicates/Unicode can be lost: %s", async (properties) => {
      await expect(compile("create", { type: "Task", properties })).rejects.toThrow(CanonicalInputError);
    });
  it("uses the protocol numeric serializer and preserves exact numeric boundaries", async () => {
    const result = await compile("create", { type: "Task", properties: '{"zero":-0,"max":9007199254740991}' });
    expect(result.bodyText).toContain('"zero":0'); // The shared serializer uses JSON mathematical zero, not source spelling.
    const admitted = admitJsonNumbers(decodeJsonDocument(result.bodyText), { diagnostic: () => ({ message: "number" }) });
    expect(admitted.ok).toBe(true);
    if (admitted.ok) expect(stringifyJsonValue(admitted.value)).toBe(result.bodyText);
    await expect(compile("update", { setProperty: ["x=9007199254740993"] }, ["note"])).rejects.toThrow();
  });
  it("freezes each file once and allows one bounded stdin consumer", async () => {
    const readFile = vi.fn(async () => bytes('{"v":1}'));
    const readStdin = vi.fn(async () => bytes('{}'));
    const result = await body(compile("create", { type: "Task", properties: "@same", metadata: "@same" }, [], { reader: { readFile, readStdin } }));
    expect(result).toEqual({ type: `${scope}Task`, properties: { v: 1 }, metadata: { v: 1 } });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile.mock.calls[0]?.length).toBe(2);
    await expect(compile("create", { type: "Task", properties: "@-", metadata: "@-" }, [], { reader: { readFile, readStdin } })).rejects.toThrow("one consumer");
    expect(readStdin).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid UTF8, over-limit acquisition/body, and reader errors without private details", async () => {
    for (const value of [new Uint8Array([0xff]), bytes('{"long":"0123456789"}')])
      await expect(compile("create", { type: "Task", properties: "@x" }, [], { maxInputBytes: 10, reader: { readFile: async () => value, readStdin: async () => value } })).rejects.toThrow(CanonicalInputError);
    await expect(compile("create", { type: "Task" }, [], { maxInputBytes: 4 })).rejects.toThrow("body byte bound");
    await expect(compile("create", { type: "Task", properties: "@x" }, [], { reader: { readFile: async () => { throw new Error("SECRET"); }, readStdin: async () => bytes("{}") } })).rejects.toThrow(/^cannot compile canonical input$/);
  });
  it("emits exactly v1 member fields while keeping BDP preview the singleton body", async () => {
    const options = { type: "Relates@=t1", dryRunMode: "batch", batchBind: "edge" };
    const result = await compile("link create", options, ["batch-ref::a", "b@=r1"]);
    expect(JSON.parse(result.batchMemberText ?? "null")).toEqual({ operation: "createLink", name: "edge", type: { uri: `${scope}Relates`, revision: "t1" }, source: "@a", target: { uri: `${scope}b`, revision: "r1" } });
    expect(JSON.parse(result.bodyText)).not.toHaveProperty("operation");
    const normal = await compile("update", { replaceProperties: "{}" }, ["note"]);
    expect(await compile("update", { replaceProperties: "{}", dryRunMode: "bdp" }, ["note"])).toEqual(normal);
    expect(await body(compile("delete", { force: true, dryRunMode: "batch" }, ["batch-ref::a"]))).toEqual({ bead: "@a" });
    await expect(compile("delete", { dryRunMode: "batch" }, ["note"])).rejects.toThrow("require --force");
  });
  it.each([
    { dryRunMode: "batch", idRoot: "notes" }, { dryRunMode: "batch", type: "batch-ref::x" },
    { dryRunMode: "batch", batchBind: "9bad" }, { dryRunMode: "batch", idempotencyKey: "key" },
    { dryRunMode: "batch", outputFormat: "json" }, { batchBind: "name" }, { revision: "r1" }, { typeRevision: "r1" },
  ])("refuses unsupported emission/semantic flags %j", async (options) => {
    await expect(compile("create", { type: "Task", ...options })).rejects.toThrow();
  });
});
