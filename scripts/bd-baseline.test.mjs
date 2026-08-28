import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertIdentityPin, IDENTITY_PIN, observationsDigest } from "./bd-baseline.mjs";

const roots = [];

function directory(entries) {
  const root = mkdtempSync(path.join(tmpdir(), "bdp-baseline-digest-"));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  for (const [name, contents] of Object.entries(entries)) {
    writeFileSync(path.join(root, name), contents);
  }
  return root;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("baseline observations digest", () => {
  it("reduces the same records to the same digest regardless of creation order", () => {
    const forward = directory({ "00-a.json": "alpha", "01-b.json": "beta", "02-c.txt": "gamma" });
    const reverse = directory({ "02-c.txt": "gamma", "01-b.json": "beta", "00-a.json": "alpha" });
    expect(observationsDigest(forward)).toBe(observationsDigest(reverse));
  });

  it("distinguishes content shifted across a filename boundary", () => {
    // Without length framing these two directories serialize to the same byte stream,
    // so this is the case that proves the framing is load-bearing rather than decorative.
    const left = directory({ "a.txt": "xy", "ab.txt": "y" });
    const right = directory({ "a.txt": "x", "ab.txt": "yy" });
    expect(observationsDigest(left)).not.toBe(observationsDigest(right));
  });

  it("changes when any observation's bytes change", () => {
    const before = directory({ "00-a.json": "alpha", "01-b.json": "beta" });
    const after = directory({ "00-a.json": "alpha", "01-b.json": "betaa" });
    expect(observationsDigest(before)).not.toBe(observationsDigest(after));
  });

  it("changes when an observation is added or removed", () => {
    const fewer = directory({ "00-a.json": "alpha" });
    const more = directory({ "00-a.json": "alpha", "01-b.json": "" });
    expect(observationsDigest(fewer)).not.toBe(observationsDigest(more));
  });

  it("is a 64-character lowercase hex SHA-256", () => {
    expect(observationsDigest(directory({ "00-a.json": "alpha" }))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("baseline identity pin", () => {
  it("holds against the committed observations", () => {
    expect(assertIdentityPin()).toEqual({
      version: "1.0.5",
      schema_version: 1,
      observations_digest: IDENTITY_PIN.observations_digest,
    });
  });

  it("pins the exact release the cohort cites", () => {
    expect(IDENTITY_PIN.version).toBe("1.0.5");
    expect(IDENTITY_PIN.schema_version).toBe(1);
    expect(IDENTITY_PIN.observations_digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
