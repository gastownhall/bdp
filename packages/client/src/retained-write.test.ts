import { describe, expect, it } from "vitest";
import {
  parseRetainedWriteDiscovery,
  parseRetainedWriteInput,
  type RetainedWriteOperation,
} from "@bdp/protocol";
import { RetainedWriteBinding, type RetainedWriteBindingOptions } from "./retained-write.js";

// Independent consumer example: Core fixes every operation at <scope>/bdp/operations/NAME.
const media = "application/vnd.bdp.v0.1+json";
const scope = "https://authority.example/work/";
const discovery = {
  bdpVersion: "0.1",
  profile: "write",
  scope,
  specRevision: "0123456789abcdef0123456789abcdef01234567",
  aliases: "https://authority.example/work/names/",
};
const target = (operation: RetainedWriteOperation) => `${scope}bdp/operations/${operation}`;
function options(): RetainedWriteBindingOptions {
  return {
    scope,
    discovery: { contentType: media, bodyText: JSON.stringify(discovery) },
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

describe("retained v0.1 base Write preparation", () => {
  it("builds the fixed destination and preserves the native body and selected headers", () => {
    const request = new RetainedWriteBinding(options()).prepare(
      "createBead",
      ' { "type": "https://types.example/note" }\n',
      "saved_KEY-1",
    );
    expect(request).toEqual({
      specification: "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json",
      scope: "https://authority.example/work/",
      operation: "createBead",
      url: "https://authority.example/work/bdp/operations/createBead",
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

  it.each<[RetainedWriteOperation, string]>([
    ["createBead", '{"type":"https://types.example/note"}'],
    ["updateBead", '{"bead":"n","properties":{},"metadataChange":[]}'],
    ["deleteBead", '{"bead":"n","expectedRevision":"3"}'],
    [
      "createLink",
      '{"type":{"uri":"https://types.example/edge","revision":"type /@=1"},"source":{"uri":"https://external.example/a","revision":"a /@=1"},"target":"urn:external:b"}',
    ],
    ["updateLink", '{"link":"edge","source":"n","metadata":{}}'],
    ["deleteLink", '{"link":"edge"}'],
    ["putAlias", '{"alias":"ship","target":"n"}'],
    ["deleteAlias", '{"alias":"ship"}'],
  ])("prepares the native %s singleton at its fixed route", (operation, bodyText) => {
    const request = new RetainedWriteBinding(options()).prepare(operation, bodyText, "same-key");
    expect(request.url).toBe(target(operation));
    expect(request.bodyText).toBe(bodyText);
    expect(request.headers["idempotency-key"]).toBe("same-key");
  });

  it("keeps an existing request unchanged after caller input and discovery change", () => {
    const input = options();
    const binding = new RetainedWriteBinding(input);
    const first = binding.prepare("deleteBead", '{"bead":"n"}', "frozen");
    Object.assign(input, withDiscovery({ scope: "https://elsewhere.example/" }));
    Object.assign(input.discovery, { bodyText: "{}", contentType: "application/json" });
    expect(binding.prepare("deleteBead", '{"bead":"n"}', "frozen")).toEqual(first);
    expect(first.url).toBe(target("deleteBead"));
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
    { types: "https://inventory.example/types/" },
    // The retired navigation members: discovery is closed, and routes are fixed.
    { operations: "https://authority.example/work/bdp/operations" },
    { events: "https://authority.example/work/bdp/events" },
    { events: null },
  ])("refuses incompatible or incomplete discovery %j", (change) => {
    expect(() => new RetainedWriteBinding(withDiscovery(change))).toThrow();
  });

  it("refuses generic JSON for discovery", () => {
    const input = options();
    Object.assign(input.discovery, { contentType: "application/json" });
    expect(() => new RetainedWriteBinding(input)).toThrow(/media type/);
  });

  it("rejects duplicate members in discovery", () => {
    const input = options();
    Object.assign(input.discovery, {
      bodyText: input.discovery.bodyText.slice(0, -1) + ',"profile":"core"}',
    });
    expect(() => new RetainedWriteBinding(input)).toThrow(/duplicate/);
  });

  describe("alias operations are optional (Write: Ordinary targets)", () => {
    const { aliases: _advertised, ...withoutAliases } = discovery;
    const noAliases = (): RetainedWriteBindingOptions => ({
      ...options(),
      discovery: { contentType: media, bodyText: JSON.stringify(withoutAliases) },
    });

    it("binds the six Resource operations when discovery omits aliases", () => {
      const binding = new RetainedWriteBinding(noAliases());
      expect(binding.aliasesSupported).toBe(false);
      expect(binding.prepare("createBead", '{"type":"https://t.example/n"}', "k").url).toBe(
        target("createBead"),
      );
      expect(binding.prepare("deleteLink", '{"link":"edge"}', "k").url).toBe(target("deleteLink"));
    });

    it.each([
      ["putAlias", '{"alias":"ship","target":"n"}'],
      ["deleteAlias", '{"alias":"ship"}'],
    ] as const)("prepares no %s for a provider without aliases", (operation, body) => {
      expect(() => new RetainedWriteBinding(noAliases()).prepare(operation, body, "k")).toThrow(
        /does not advertise aliases/,
      );
    });

    it("still reports and prepares aliases for a provider that advertises them", () => {
      const binding = new RetainedWriteBinding(options());
      expect(binding.aliasesSupported).toBe(true);
      expect(binding.prepare("deleteAlias", '{"alias":"ship"}', "k").url).toBe(
        target("deleteAlias"),
      );
    });
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

  it("bounds the discovery document before parsing", () => {
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
