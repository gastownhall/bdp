import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json.js";

interface DigestVector {
  readonly label: string;
  readonly record: Record<string, unknown>;
  readonly jcs: string;
  readonly sha256: string;
}

const { vectors } = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/transactional/erasure-digest-vectors.json", import.meta.url),
    "utf8",
  ),
) as { vectors: DigestVector[] };

// Perturb insertion order without computing expected canonical bytes. Array
// order is semantic and is preserved, including nested owned-Link arrays.
function reverseMemberInsertion(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseMemberInsertion);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseMemberInsertion(entry)]),
    );
  return value;
}

describe("T57 Transactional erasure vectors through the shared JCS implementation", () => {
  it("retains all eight independent expected vectors", () => {
    expect(vectors.map(({ label }) => label)).toEqual([
      "task-42-r7",
      "task-42-r8",
      "9c1e-r1",
      "2d4f-r1",
      "dec-9-r2",
      "vec-1-r1",
      "vec-2-r1",
      "rel-5-r1",
    ]);
  });

  for (const vector of vectors) {
    it(`canonicalizes ${vector.label} to its independent bytes and digest`, () => {
      const canonical = canonicalJson(vector.record);
      expect(canonical).toBe(vector.jcs);
      expect(createHash("sha256").update(canonical, "utf8").digest("hex")).toBe(vector.sha256);
      expect(canonicalJson(reverseMemberInsertion(vector.record))).toBe(vector.jcs);
    });
  }
});
