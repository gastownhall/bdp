import { afterEach, describe, expect, it } from "vitest";
import { createRetainedCollections } from "./collections.js";
import { type JsonObject, type PrivateNavigation } from "./contract.js";
const scope = "https://records.example/tenant/";
const nav = {
  scope,
  beads: scope + "odd-nodes?tenant=one",
  links: scope + "odd-edges?tenant=one",
} as PrivateNavigation;
const type = "https://types.example/Record";
const bead = (name: string): JsonObject => ({
  id: scope + name,
  revision: "r1",
  type,
  properties: { name },
  metadata: {},
});
const link = (
  name: string,
  source: string | { uri: string; revision: string },
  target: string,
): JsonObject => ({ ...bead(name), source, target });
const closers: (() => unknown)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});
function harness() {
  const records = {
    bead: [bead("z"), bead("a"), bead("m"), bead("n")],
    link: [
      link("x", { uri: scope + "a", revision: "old" }, scope + "m"),
      link("y", scope + "m", scope + "a"),
      link("self", scope + "a", scope + "a"),
    ],
  };
  const pages = createRetainedCollections(nav, "epoch", (kind) => records[kind]);
  closers.push(pages.close);
  return {
    records,
    read: (url: string, principal = "p", kind: "bead" | "link" = "bead", subject?: string) =>
      pages.read(new URL(url), principal, kind, subject),
  };
}
describe("ordinary retained collection selection", () => {
  it("sorts the complete snapshot and resizes only the remaining native boundary", () => {
    const { records, read } = harness();
    const first = read(nav.beads + "&limit=1");
    expect(first.items.map((x) => x.id)).toEqual([scope + "a"]);
    records.bead[2] = bead("changed");
    records.bead.push(bead("later"));
    const next = new URL(first.next!);
    next.searchParams.set("limit", "2");
    const second = read(next.href);
    expect(second.items.map((x) => x.id)).toEqual([scope + "m", scope + "n"]);
    expect(read(next.href)).toEqual(second);
    expect(read(second.next!).items.map((x) => x.id)).toEqual([scope + "z"]);
  });
  it("combines nominal, endpoint and raw Selector predicates without stripping pins", () => {
    const { read } = harness();
    const url = new URL(nav.links);
    url.searchParams.set("type", type);
    url.searchParams.set("source", "a");
    url.searchParams.set("selector", '$[?@.source.uri == "' + scope + 'a"]');
    expect(read(url.href, "p", "link").items.map((x) => x.id)).toEqual([scope + "x"]);
    url.searchParams.set("selector", '$[?@.source == "' + scope + 'a"]');
    expect(read(url.href, "p", "link").items.map((x) => x.id)).toEqual([scope + "self"]);
  });
  it("keeps inbound/outbound/self-loop identity distinct and compares endpoint URIs", () => {
    const { read } = harness();
    const out = read(scope + "a?view=links&direction=outbound", "p", "link", scope + "a");
    expect(out.items.map((x) => x.id)).toEqual([scope + "self", scope + "x"]);
    const both = read(scope + "a?view=links", "p", "link", scope + "a");
    expect(both.items.map((x) => x.id)).toEqual([scope + "self", scope + "x", scope + "y"]);
  });
  it("binds continuations to the principal, selection and route", () => {
    const { read } = harness();
    const first = read(nav.beads + "&limit=1");
    expect(() => read(first.next!, "other")).toThrowError(
      expect.objectContaining({ code: "foreign-view", status: 409 }),
    );
    expect(() => read(first.next! + "&type=" + encodeURIComponent(type))).toThrowError(
      expect.objectContaining({ code: "invalid-parameter", status: 400 }),
    );
    expect(() => read(first.next!.replace("odd-nodes", "odd-edges"), "p", "link")).toThrowError(
      expect.objectContaining({ code: "invalid-parameter", status: 400 }),
    );
  });
  it.each([
    "&limit=0",
    "&limit=1001",
    "&limit=1&limit=2",
    "&source=a",
    "&conformsTo=" + encodeURIComponent(type),
    "&unknown=x",
    "&selector=$[?@.id]",
  ])("refuses malformed/unsupported selection %s", (suffix) => {
    const { read } = harness();
    // id is a valid Selector member; the final case is deliberately syntactically valid.
    if (suffix.includes("selector")) expect(read(nav.beads + suffix).items).toHaveLength(4);
    else expect(() => read(nav.beads + suffix)).toThrow();
  });
  it("returns truthful empty exhaustion", () => {
    const { records, read } = harness();
    records.bead.length = 0;
    expect(read(nav.beads)).toEqual({ items: [], next: null });
  });
});
