import { describe, expect, it, vi } from "vitest";
import { resolveAliasReferences } from "./alias-witness.js";

const first = "https://scope.invalid/a";
const second = "https://scope.invalid/b";
const locator = "https://scope.invalid/decisions/latest";
const otherLocator = "https://scope.invalid/decisions/other";
describe("private original alias witnesses, without store or route admission", () => {
  it("captures actual alias classification once per locator, without interpreting path words", () => {
    const direct = "https://scope.invalid/alias/ordinary-canonical-identity";
    const lookup = vi.fn((uri: string) => (uri === locator ? first : undefined));
    const result = resolveAliasReferences(
      [locator, { uri: locator, revision: "opaque/+pin" }, direct],
      lookup,
    );
    expect(result.references).toEqual([
      { kind: "value", reference: first },
      { kind: "value", reference: { uri: first, revision: "opaque/+pin" } },
      { kind: "value", reference: direct },
    ]);
    expect(lookup.mock.calls.filter(([uri]) => uri === locator)).toHaveLength(1);
    expect(result.originalWitnesses).toEqual([{ locator, target: first }]);
  });
  it("uses an original hit across slots after repoint/removal, preserving whole pins", () => {
    const original = [{ locator, target: first }];
    const snapshot = JSON.stringify(original);
    const lookup = vi.fn(() => second);
    const retried = resolveAliasReferences(
      [{ uri: locator, revision: "old-token" }, locator],
      lookup,
      original,
    );
    expect(retried.references).toEqual([
      { kind: "value", reference: { uri: first, revision: "old-token" } },
      { kind: "value", reference: first },
    ]);
    expect(lookup).not.toHaveBeenCalled();
    expect(retried.originalWitnesses).toEqual(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
  it("resolves new retry locators afresh each turn without adding durable metadata", () => {
    const original = [{ locator, target: first }];
    for (const target of [first, second, null]) {
      const lookup = vi.fn(() => target);
      const retry = resolveAliasReferences(
        [otherLocator, { uri: otherLocator, revision: "pin" }],
        lookup,
        original,
      );
      expect(lookup).toHaveBeenCalledExactlyOnceWith(otherLocator);
      expect(retry.originalWitnesses).toEqual(original);
      expect(retry.references[0]).toEqual(
        target === null
          ? { kind: "missing-alias", locator: otherLocator }
          : { kind: "value", reference: target },
      );
      expect(retry.references[1]).toEqual(
        target === null
          ? { kind: "missing-alias", locator: otherLocator, revision: "pin" }
          : { kind: "value", reference: { uri: target, revision: "pin" } },
      );
    }
    expect(resolveAliasReferences([otherLocator], () => first, []).originalWitnesses).toEqual([]);
  });
  it("keeps recorded misses distinct and missing after later assignment", () => {
    const initial = resolveAliasReferences([locator, otherLocator], () => null);
    expect(initial.references).toEqual([
      { kind: "missing-alias", locator },
      { kind: "missing-alias", locator: otherLocator },
    ]);
    const lookup = vi.fn(() => first);
    const retry = resolveAliasReferences(
      [locator, otherLocator],
      lookup,
      initial.originalWitnesses,
    );
    expect(retry.references).toEqual(initial.references);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("snapshots pins and witnesses without mutating caller-owned inputs", () => {
    const pin = { uri: locator, revision: "authored" };
    const references = [pin];
    const output = resolveAliasReferences(references, () => first);
    pin.uri = otherLocator;
    pin.revision = "later";
    expect(output.references).toEqual([
      { kind: "value", reference: { uri: first, revision: "authored" } },
    ]);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.references)).toBe(true);
    expect(Object.isFrozen(output.references[0])).toBe(true);
    expect(
      output.references[0]?.kind === "value" && Object.isFrozen(output.references[0].reference),
    ).toBe(true);
    expect(Object.isFrozen(output.originalWitnesses[0])).toBe(true);
  });
  it("propagates lookup failure without changing original metadata or input pins", () => {
    const prior = [{ locator, target: first }];
    const inputs = [locator, { uri: otherLocator, revision: "pin" }];
    const before = JSON.stringify({ prior, inputs });
    expect(() =>
      resolveAliasReferences(
        inputs,
        () => {
          throw new Error("owner lookup failed");
        },
        prior,
      ),
    ).toThrow("owner lookup failed");
    expect(JSON.stringify({ prior, inputs })).toBe(before);
  });
  it("rejects incoherent duplicate durable witnesses before a lookup", () => {
    const lookup = vi.fn(() => first);
    expect(() =>
      resolveAliasReferences([locator], lookup, [
        { locator, target: first },
        { locator, target: second },
      ]),
    ).toThrow("duplicate original alias witness");
    expect(lookup).not.toHaveBeenCalled();
  });
});
