import { describe, expect, it } from "vitest";
import {
  parseRetainedWriteDiscovery,
  parseRetainedWriteInput,
  type RetainedWriteOperation,
} from "@bdp/protocol";
import { RetainedWriteBinding, type RetainedWriteBindingOptions } from "./retained-write.js";

// Independent consumer examples, deliberately unrelated to fixed REST paths or
// the SQLite provider. No production constants construct the expected binding.
const media = "application/vnd.bdp.v0.1+json";
const scope = "https://authority.example/work/";
const discovery = {
  bdpVersion: "0.1",
  profile: "write",
  scope,
  beads: "https://inventory.example/nodes?set=n",
  links: "https://inventory.example/edges?set=e",
  events: "https://events.example/feed?edition=7",
  operations: "https://navigation.example/verbs?edition=odd",
  aliases: "https://names.example/lookup/",
};
const directory = {
  createBead: "https://dispatch.example/a?token=%2B%2f",
  updateBead: "https://dispatch.example/b?token=%2B%2f",
  deleteBead: "https://dispatch.example/c?token=%2B%2f",
  createLink: "https://dispatch.example/d?token=%2B%2f",
  updateLink: "https://dispatch.example/e?token=%2B%2f",
  deleteLink: "https://dispatch.example/f?token=%2B%2f",
  putAlias: "https://dispatch.example/g?token=%2B%2f",
  deleteAlias: "https://dispatch.example/h?token=%2B%2f",
};
function options(): RetainedWriteBindingOptions {
  return {
    scope,
    discovery: { contentType: media, bodyText: JSON.stringify(discovery) },
    directory: { contentType: media, bodyText: JSON.stringify(directory) },
    maximumDocumentBytes: 16_384,
    maximumRequestBodyBytes: 16_384,
  };
}
function withDiscovery(change: Record<string, unknown>): RetainedWriteBindingOptions {
  return {
    ...options(),
    discovery: { contentType: media, bodyText: JSON.stringify({ ...discovery, ...change }) },
  };
}
function withDirectory(value: unknown): RetainedWriteBindingOptions {
  return { ...options(), directory: { contentType: media, bodyText: JSON.stringify(value) } };
}

describe("retained v0.1 base Write preparation", () => {
  it("preserves the exact advertised destination, native body and selected headers", () => {
    const request = new RetainedWriteBinding(options()).prepare(
      "createBead",
      ' { "type": "https://types.example/note" }\n',
      "saved_KEY-1",
    );
    expect(request).toEqual({
      specification: "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json",
      scope: "https://authority.example/work/",
      operation: "createBead",
      url: "https://dispatch.example/a?token=%2B%2f",
      method: "POST",
      headers: {
        accept: "application/vnd.bdp.v0.1+json",
        "content-type": "application/vnd.bdp.v0.1+json",
        "idempotency-key": "saved_KEY-1",
      },
      bodyText: ' { "type": "https://types.example/note" }\n',
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.headers)).toBe(true);
  });

  it.each<[RetainedWriteOperation, string, string]>([
    ["createBead", '{"type":"https://types.example/note"}', "a"],
    ["updateBead", '{"bead":"n","properties":{},"metadataChange":[]}', "b"],
    ["deleteBead", '{"bead":"n","expectedRevision":"3"}', "c"],
    [
      "createLink",
      '{"type":{"uri":"https://types.example/edge","revision":"type /@=1"},"source":{"uri":"https://external.example/a","revision":"a /@=1"},"target":"urn:external:b"}',
      "d",
    ],
    ["updateLink", '{"link":"edge","source":"n","metadata":{}}', "e"],
    ["deleteLink", '{"link":"edge"}', "f"],
    ["putAlias", '{"alias":"ship","target":"n"}', "g"],
    ["deleteAlias", '{"alias":"ship"}', "h"],
  ])("prepares the native %s singleton", (operation, bodyText, route) => {
    const request = new RetainedWriteBinding(options()).prepare(operation, bodyText, "same-key");
    expect(request.url).toBe(`https://dispatch.example/${route}?token=%2B%2f`);
    expect(request.bodyText).toBe(bodyText);
    expect(request.headers["idempotency-key"]).toBe("same-key");
  });

  it("keeps an existing request unchanged after caller input and discovery change", () => {
    const input = options();
    const binding = new RetainedWriteBinding(input);
    const first = binding.prepare("deleteBead", '{"bead":"n"}', "frozen");
    Object.assign(
      input,
      withDirectory({ ...directory, deleteBead: "https://elsewhere.example/x" }),
    );
    Object.assign(input.directory, { bodyText: "{}", contentType: "application/json" });
    expect(binding.prepare("deleteBead", '{"bead":"n"}', "frozen")).toEqual(first);
    expect(first.url).toBe("https://dispatch.example/c?token=%2B%2f");
  });

  it("ignores unfamiliar advertised capabilities for base-only use", () => {
    const binding = new RetainedWriteBinding(
      withDiscovery({ capabilities: { "urn:example:future": { "9": { opaque: true } } } }),
    );
    const request = binding.prepare("deleteAlias", '{"alias":"ship"}', "base-only");
    expect(request.headers["content-type"]).toBe("application/vnd.bdp.v0.1+json");
  });

  it.each([
    { bdpVersion: "0" },
    { bdpVersion: "0.2" },
    { profile: "core" },
    { profile: "read-update" },
    { scope: "https://another.example/work/" },
    { scope: "https://authority.example/work" },
    { events: null },
    { types: "https://inventory.example/types/" },
  ])("refuses incompatible or incomplete discovery %j", (change) => {
    expect(() => new RetainedWriteBinding(withDiscovery(change))).toThrow();
  });

  it.each(["discovery", "directory"] as const)("refuses generic JSON for %s", (field) => {
    const input = options();
    Object.assign(input[field], { contentType: "application/json" });
    expect(() => new RetainedWriteBinding(input)).toThrow(/media type/);
  });

  it.each(["discovery", "directory"] as const)("rejects duplicate members in %s", (field) => {
    const input = options();
    const duplicate =
      field === "discovery" ? ',"profile":"core"}' : ',"createBead":"https://elsewhere.example/x"}';
    Object.assign(input[field], { bodyText: input[field].bodyText.slice(0, -1) + duplicate });
    expect(() => new RetainedWriteBinding(input)).toThrow(/duplicate/);
  });

  it("refuses a six-CRUD directory even when preparing only CRUD", () => {
    const six: Record<string, string> = { ...directory };
    delete six.putAlias;
    delete six.deleteAlias;
    expect(() => new RetainedWriteBinding(withDirectory(six))).toThrow();
  });

  it.each([
    { ...directory, updateBead: directory.createBead },
    { ...directory, sequence: "https://dispatch.example/sequence" },
    { ...directory, batch: "https://dispatch.example/batch" },
    { ...directory, createBead: "create-bead" },
    { ...directory, createBead: "https://user:secret@dispatch.example/a" },
    { ...directory, createBead: "https://dispatch.example/a#fragment" },
  ])("refuses an ambiguous or invalid operation directory %j", (value) => {
    expect(() => new RetainedWriteBinding(withDirectory(value))).toThrow();
  });

  it.each(["", "key key", "key\n", "key\r", "é", "a".repeat(257)])(
    "refuses an invalid key %j",
    (key) => {
      const binding = new RetainedWriteBinding(options());
      expect(() => binding.prepare("deleteBead", '{"bead":"n"}', key)).toThrow(/Key/);
    },
  );

  it("accepts the maximum key length without changing case", () => {
    const key = `A${"z".repeat(255)}`;
    expect(
      new RetainedWriteBinding(options()).prepare("deleteAlias", '{"alias":"ship"}', key).headers[
        "idempotency-key"
      ],
    ).toBe(key);
  });

  it.each([
    '{"type":"https://types.example/a","properties":{"s":"\\ud800"}}',
    '{"type":"https://types.example/a","operation":"createBead"}',
    '{"type":"https://types.example/a","name":"saved"}',
    '{"type":"https://types.example/a","idRoot":"notes"}',
    '{"type":"https://types.example/a","properties":null}',
    '{"type":"https://types.example/a","metadata":null}',
    "[]",
  ])("refuses invalid or lossy native input %s", (bodyText) => {
    const binding = new RetainedWriteBinding(options());
    expect(() => binding.prepare("createBead", bodyText, "never-submit")).toThrow();
  });

  it.each([
    '{"type":"https://types.example/a","type":"https://types.example/b"}',
    '{"type":"https://types.example/a","\\u0074ype":"https://types.example/b"}',
  ])("detects duplicate decoded input members %s", (bodyText) => {
    expect(() =>
      new RetainedWriteBinding(options()).prepare("createBead", bodyText, "duplicate"),
    ).toThrow(/duplicate/);
  });

  it.each(["9007199254740993", "1e9999", "1e-9999", "0.10000000000000000555"])(
    "diagnoses an inadmissible number before schema validation: %s",
    (number) => {
      const bodyText = `{"type":"https://types.example/a","properties":{"n":${number}}}`;
      expect(() =>
        new RetainedWriteBinding(options()).prepare("createBead", bodyText, "number"),
      ).toThrow(/inadmissible number/);
    },
  );

  it("preserves admitted numeric spelling and nested literal data", () => {
    const bodyText =
      '{"type":"https://types.example/a","properties":{"n":1.00,"tiny":0.1,"literal":{"operation":"keep","name":null}}}';
    expect(
      new RetainedWriteBinding(options()).prepare("createBead", bodyText, "literal").bodyText,
    ).toBe(bodyText);
  });

  it.each([
    '{"type":"urn:example:note"}',
    '{"type":{"uri":"urn:example:note","revision":"definition-1"}}',
    '{"type":"notes/local-type"}',
  ])("refuses a non-HTTP Type identity %s", (bodyText) => {
    expect(() =>
      new RetainedWriteBinding(options()).prepare("createBead", bodyText, "invalid-type"),
    ).toThrow();
  });

  it.each<[RetainedWriteOperation, string]>([
    ["deleteBead", '{"link":"edge"}'],
    ["updateBead", '{"bead":"n","properties":{},"propertiesChange":[]}'],
    ["updateBead", '{"bead":"n","properties":{},"expectedRevision":3}'],
    [
      "createLink",
      '{"type":"https://types.example/edge","source":{"uri":"urn:a"},"target":"urn:b"}',
    ],
    ["putAlias", '{"alias":"ship","target":{"uri":"urn:a","revision":"r"}}'],
    ["createLink", '{"type":"https://types.example/edge","source":"@saved","target":"n"}'],
  ])("refuses invalid %s fields before any delivery", (operation, bodyText) => {
    expect(() =>
      new RetainedWriteBinding(options()).prepare(operation, bodyText, "invalid-fields"),
    ).toThrow();
  });

  it.each(["sequence", "batch", "toString"])("refuses unsupported operation %s", (operation) => {
    expect(() =>
      new RetainedWriteBinding(options()).prepare(
        operation as RetainedWriteOperation,
        '{"alias":"ship"}',
        "unsupported",
      ),
    ).toThrow();
  });

  it("enforces UTF-8 byte bounds instead of JavaScript character counts", () => {
    const bodyText = '{"type":"https://types.example/a","properties":{"s":"é"}}';
    const binding = new RetainedWriteBinding({
      ...options(),
      maximumRequestBodyBytes: bodyText.length,
    });
    expect(() => binding.prepare("createBead", bodyText, "bounded")).toThrow(RangeError);
  });

  it("bounds discovery and directory documents before parsing", () => {
    expect(() => new RetainedWriteBinding({ ...options(), maximumDocumentBytes: 1 })).toThrow(
      RangeError,
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid configured byte bounds %s",
    (limit) => {
      expect(
        () => new RetainedWriteBinding({ ...options(), maximumRequestBodyBytes: limit }),
      ).toThrow(TypeError);
    },
  );

  it("returns immutable parsed discovery and exact whole References", () => {
    const parsed = parseRetainedWriteDiscovery(JSON.stringify(discovery));
    const input = parseRetainedWriteInput(
      "createLink",
      '{"type":{"uri":"https://types.example/edge","revision":"type /@=1"},"source":{"uri":"urn:a","revision":"a /@=1"},"target":"urn:b"}',
    );
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(input.type).toEqual({ uri: "https://types.example/edge", revision: "type /@=1" });
    expect(input.source).toEqual({ uri: "urn:a", revision: "a /@=1" });
    expect(Object.isFrozen(input.source)).toBe(true);
  });
});
