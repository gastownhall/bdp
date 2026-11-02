import { describe, expect, it, vi } from "vitest";
import { prepareAlias } from "./alias-contract.js";
import { prepareCreate, prepareDelete, prepareUpdate } from "./contract.js";
import { prepareLink } from "./link-contract.js";
import { compareCapturedReferences } from "./reference-comparison.js";

const scope = "https://scope.invalid/acme/";
const a = `${scope}a`;
const b = `${scope}b`;
const locator = `${scope}names/latest`;
const otherLocator = `${scope}names/other`;
const type = "https://types.invalid/Node";
function update(bead: string, expectedRevision = "guard") {
  return prepareUpdate(
    scope,
    JSON.stringify({ bead, expectedRevision, properties: { literal: locator } }),
    "key",
  );
}
function link(source: unknown, target: unknown) {
  return prepareLink(scope, "createLink", JSON.stringify({ type, source, target }), "key");
}

describe("captured alias Reference comparison before owner execution", () => {
  it("preserves original direct identity for all eight ordinary carrier factories", () => {
    const invocations = [
      prepareCreate(scope, JSON.stringify({ type }), "key"),
      update(a),
      prepareDelete(scope, JSON.stringify({ bead: a }), "key"),
      link(a, b),
      prepareLink(scope, "updateLink", JSON.stringify({ link: "edge", properties: {} }), "key"),
      prepareLink(scope, "deleteLink", JSON.stringify({ link: "edge" }), "key"),
      prepareAlias(scope, "putAlias", JSON.stringify({ alias: "names/new", target: a }), "key"),
      prepareAlias(scope, "deleteAlias", JSON.stringify({ alias: "names/new" }), "key"),
    ];
    for (const invocation of invocations) {
      const compared = compareCapturedReferences(invocation, () => undefined);
      expect(compared.identity).toBe(invocation.identity);
      expect(compared.originalWitnesses).toEqual([]);
    }
  });
  it("compares an aliased Bead subject with the canonical complete input", () => {
    const invocation = update(locator);
    const compared = compareCapturedReferences(invocation, (uri) =>
      uri === locator ? a : undefined,
    );
    expect(compared.identity).toBe(update(a).identity);
    expect(compared.references).toEqual({ bead: { kind: "value", reference: a } });
    expect(compared.originalWitnesses).toEqual([{ locator, target: a }]);
    expect(compared.identity).not.toBe(update(a, "changed-guard").identity);
    expect(invocation.bead).toBe(locator);
    expect(invocation.properties).toEqual({ literal: locator });
  });
  it("uses original hits after repoint without consulting current lookup", () => {
    const original = compareCapturedReferences(update(locator), () => a);
    const lookup = vi.fn(() => b);
    const retry = compareCapturedReferences(update(locator), lookup, original.originalWitnesses);
    expect(retry.identity).toBe(original.identity);
    expect(retry.references).toEqual(original.references);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("resolves a new retry locator currently without appending original witnesses", () => {
    const original = compareCapturedReferences(update(locator), () => a);
    const retry = compareCapturedReferences(
      update(otherLocator),
      () => a,
      original.originalWitnesses,
    );
    expect(retry.identity).toBe(original.identity);
    expect(retry.originalWitnesses).toEqual(original.originalWitnesses);
    expect(
      compareCapturedReferences(update(otherLocator), () => b, original.originalWitnesses).identity,
    ).not.toBe(original.identity);
  });
  it("keeps distinct misses and original misses after later assignment", () => {
    const original = compareCapturedReferences(update(locator), () => null);
    const other = compareCapturedReferences(update(otherLocator), () => null);
    expect(original.identity).not.toBe(other.identity);
    expect(original.identity).not.toBe(update(a).identity);
    const lookup = vi.fn(() => a);
    expect(
      compareCapturedReferences(update(locator), lookup, original.originalWitnesses).identity,
    ).toBe(original.identity);
    expect(lookup).not.toHaveBeenCalled();
    expect(original.references).toEqual({ bead: { kind: "missing-alias", locator } });
  });
  it("preserves separate whole pins when one locator appears in both endpoint slots", () => {
    const source = { uri: locator, revision: "opaque/source+pin" };
    const target = { uri: locator, revision: "opaque/target+pin" };
    const invocation = link(source, target);
    const lookup = vi.fn(() => a);
    const compared = compareCapturedReferences(invocation, lookup);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(locator);
    expect(compared.identity).toBe(link({ ...source, uri: a }, { ...target, uri: a }).identity);
    expect(compared.references.source).toEqual({ kind: "value", reference: { ...source, uri: a } });
    expect(compared.references.target).toEqual({ kind: "value", reference: { ...target, uri: a } });
    expect(
      compareCapturedReferences(link({ ...source, revision: "different" }, target), () => a)
        .identity,
    ).not.toBe(compared.identity);
    expect(invocation.value.source).toEqual(source);
  });
  it("does not introduce omitted endpoint defaults or resolve Type, Link subject or data", () => {
    const body = {
      link: locator,
      source: locator,
      type: locator,
      properties: { literal: locator },
    };
    const invocation = prepareLink(scope, "updateLink", JSON.stringify(body), "key");
    const lookup = vi.fn(() => a);
    const compared = compareCapturedReferences(invocation, lookup);
    const direct = prepareLink(scope, "updateLink", JSON.stringify({ ...body, source: a }), "key");
    expect(compared.identity).toBe(direct.identity);
    expect(Object.keys(compared.references)).toEqual(["source"]);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(locator);
    const noReferences = [
      prepareCreate(
        scope,
        JSON.stringify({ type: locator, properties: { literal: locator } }),
        "key",
      ),
      prepareLink(scope, "deleteLink", JSON.stringify({ link: locator }), "key"),
      prepareAlias(
        scope,
        "putAlias",
        JSON.stringify({ alias: "names/new", target: locator }),
        "key",
      ),
    ];
    const forbiddenLookup = vi.fn(() => {
      throw new Error("ineligible reference resolved");
    });
    for (const input of noReferences)
      expect(compareCapturedReferences(input, forbiddenLookup).identity).toBe(input.identity);
    expect(forbiddenLookup).not.toHaveBeenCalled();
  });
  it("preserves refused numeric intent exactly through URI substitution", () => {
    const text = `{"bead":"${locator}","properties":{"n":9007199254740993}}`;
    const invocation = prepareUpdate(scope, text, "key");
    expect(invocation.refusal).toBeDefined();
    const compared = compareCapturedReferences(invocation, () => a);
    const direct = prepareUpdate(scope, text.replace(locator, a), "key");
    expect(compared.identity).toBe(direct.identity);
    const changed = prepareUpdate(
      scope,
      text.replace("9007199254740993", "9007199254740995"),
      "key",
    );
    expect(compareCapturedReferences(changed, () => a).identity).not.toBe(compared.identity);
  });
  it("rejects uncaptured clones before lookup and propagates owner lookup failures", () => {
    const invocation = update(locator);
    const before = JSON.stringify(invocation);
    const lookup = vi.fn(() => a);
    expect(() => compareCapturedReferences({ ...invocation }, lookup)).toThrow("uncaptured");
    expect(lookup).not.toHaveBeenCalled();
    expect(() =>
      compareCapturedReferences(invocation, () => {
        throw new Error("owner lookup failed");
      }),
    ).toThrow("owner lookup failed");
    expect(JSON.stringify(invocation)).toBe(before);
  });
});
