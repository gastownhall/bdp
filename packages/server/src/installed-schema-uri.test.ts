import { createRequire } from "node:module";
import uri from "fast-uri";
import { describe, expect, it } from "vitest";
import { GraphBudget, SCHEMA_GRAPH_CEILINGS } from "./installed-schema-shape.js";
import { resolveSchemaUri } from "./installed-schema-uri.js";
const resolve = (base: string, ref: string) =>
  resolveSchemaUri(base, ref, new GraphBudget(SCHEMA_GRAPH_CEILINGS));
describe("bounded generic URI identity", () => {
  it.each(["data", "accessor", "prototype", "replaced-export"])(
    "refuses a registered generic handler without invoking it: %s",
    (kind) => {
      const dependency = createRequire(import.meta.url)("fast-uri/lib/schemes.js") as {
        SCHEMES: Record<string, unknown>;
      };
      const registry = dependency.SCHEMES;
      const prior = Object.getOwnPropertyDescriptor(registry, "null");
      const priorPrototype = Object.getPrototypeOf(registry);
      const priorExport = Object.getOwnPropertyDescriptor(uri, "SCHEMES");
      let calls = 0;
      const handler = {
        parse(component: unknown) {
          calls++;
          return component;
        },
        serialize(component: unknown) {
          calls++;
          return component;
        },
      };
      try {
        if (kind === "prototype") Object.setPrototypeOf(registry, { null: handler });
        else if (kind === "accessor")
          Object.defineProperty(registry, "null", {
            configurable: true,
            get() {
              calls++;
              return handler;
            },
          });
        else Object.defineProperty(registry, "null", { configurable: true, value: handler });
        if (kind === "replaced-export")
          Object.defineProperty(uri, "SCHEMES", { configurable: true, value: {} });
        expect(() => resolve("https://a.test/", "child")).toThrow("uri-handler-registry");
        expect(calls).toBe(0);
      } finally {
        if (prior) Object.defineProperty(registry, "null", prior);
        else delete registry.null;
        Object.setPrototypeOf(registry, priorPrototype);
        if (priorExport) Object.defineProperty(uri, "SCHEMES", priorExport);
      }
      expect(resolve("https://a.test/", "child").uri).toBe("https://a.test/child");
    },
  );
  it.each([
    ["https://Host.test:443/a/b", "../C?X=%2f", "https://host.test/C?X=%2f"],
    ["https://host.test", "", "https://host.test/"],
    ["https://host.test/a", "#", "https://host.test/a"],
    ["https://host.test/a", "%2e%2e/%2f/%41", "https://host.test/%2E%2E/%2F/A"],
    ["urn:example:A:B", "#name", "urn:example:A:B#name"],
    ["file:///a/b", "../C", "file:///C"],
    ["https://a.test/a", "//B.test:443/X", "https://b.test/X"],
    ["https://a.test/a", "https://%61.test/X", "https://a.test/X"],
    ["https://a.test/a", "https://[2001:db8::1]/X", "https://[2001:db8::1]/X"],
  ])("resolves %s + %s exactly", (base, ref, expected) =>
    expect(resolve(base, ref).uri).toBe(expected),
  );
  it("names the unsupported valid IPvFuture literal boundary", () => {
    expect(() => resolve("https://a.test/", "https://[v1.alpha]/")).toThrow(
      "unsupported-uri-ip-literal",
    );
  });
  it("keeps path, anchor and URN NSS case and decodes fragments only once", () => {
    expect(resolve("urn:example:A", "").uri).not.toBe(resolve("urn:example:a", "").uri);
    expect(resolve("https://a.test/A", "#A").uri).not.toBe(resolve("https://a.test/a", "#a").uri);
    expect(resolve("https://a.test/a", "#/%252F")).toMatchObject({
      fragment: "/%2F",
      uri: "https://a.test/a#/%252F",
      fragmentKind: "pointer",
    });
  });
  it.each([
    "https://a.test:xyz/a",
    "https://a.test:65536/a",
    "https://a.test/[x]",
    "https://a.test/a?[]",
    "https://a.test/a#[]",
    "https://[:::1]/a",
    "https://[1::2::3]/a",
    "https://a.test\\evil/",
    "https://a.test/ x",
    "https://a.test/%xz",
    "https://a.test/☃",
    "https://a.test/a##x",
    "http:/a",
    "1bad:stuff",
    "//a@b@c/",
    "#%FF",
  ])("refuses malformed URI %s", (ref) => expect(() => resolve("https://a.test/", ref)).toThrow());
  it.each([
    "https://a%252fb.test/",
    "https://a%2fb.test/",
    "https://a%5bb.test/",
    "https://[fe80::1%25zone]/",
  ])("names unsupported host normalization %s", (ref) =>
    expect(() => resolve("https://a.test/", ref)).toThrow("unsupported-uri-host-escape"),
  );
  it("admits exactly 2048-byte worst-shaped paths and rejects the next byte", () => {
    const prefix = "https://a.test/";
    const remaining = 2048 - prefix.length;
    for (const pattern of ["a/../", "%2F", "a/"]) {
      const body = pattern.repeat(Math.floor(remaining / pattern.length)).padEnd(remaining, "a");
      const text = prefix + body;
      const b = new GraphBudget(SCHEMA_GRAPH_CEILINGS);
      expect(text.length).toBe(2048);
      expect(resolveSchemaUri(prefix, text, b).uri.length).toBeLessThanOrEqual(2048);
      expect(b.counts.uriBytes).toBe(2048);
      expect(() => resolve(prefix, `${text}a`)).toThrow("limit-uriBytes");
    }
    const fragment = `${prefix}#${"a".repeat(2048 - prefix.length - 1)}`;
    expect(resolve(prefix, fragment).uri).toBe(fragment);
    const authority = `https://${"a".repeat(2048 - "https:///".length)}/`;
    expect(resolve(prefix, authority).uri).toBe(authority);
  });
  it("bounds maximum-shaped paths, escapes, authority and fragments before dependency work", () => {
    for (const part of ["a/../".repeat(350), "%2f".repeat(550), "a".repeat(1750)]) {
      const uri = `https://a.test/${part}`;
      const b = new GraphBudget(SCHEMA_GRAPH_CEILINGS);
      expect(resolveSchemaUri("https://a.test/", uri, b).uri.length).toBeLessThanOrEqual(2048);
      expect(b.counts.uriCalls).toBe(1);
    }
    expect(() => resolve("https://a.test/", "a".repeat(2049))).toThrow("limit-uriBytes");
    const b = new GraphBudget({ ...SCHEMA_GRAPH_CEILINGS, uriWork: 0 });
    expect(() => resolveSchemaUri("https://a.test/", "", b)).toThrow("limit-uriWork");
    expect(b.counts.uriCalls).toBe(1);
  });
  it("keeps cumulative URI work independent from per-URI and call ceilings", () => {
    const uri = `https://a.test/${"a".repeat(2048 - "https://a.test/".length)}`;
    const budget = new GraphBudget(SCHEMA_GRAPH_CEILINGS);
    const work = (uri.length + uri.length + 1) ** 2;
    expect(Math.floor(SCHEMA_GRAPH_CEILINGS.uriWork / work)).toBe(3);
    for (let i = 0; i < 3; i++) expect(resolveSchemaUri(uri, uri, budget).uri).toBe(uri);
    expect(budget.counts.uriWork).toBe(3 * work);
    expect(() => resolveSchemaUri(uri, uri, budget)).toThrow(
      "schema resource index refused: limit-uriWork",
    );
    expect(budget.counts.uriWork).toBe(3 * work);
    expect(budget.counts.uriCalls).toBe(4);
    expect(budget.counts.uriBytes).toBe(2048);
  });
});
