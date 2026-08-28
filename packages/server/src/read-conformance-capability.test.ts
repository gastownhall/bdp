import { describe, expect, it, vi } from "vitest";

// This is the one suite that must prove the unmocked shipping import directly.
vi.unmock("./read-conformance-capability.js");

import {
  hasReadConformanceEvidence,
  recordedReadConformanceEvidence,
} from "./read-conformance-capability.js";
import { admitReadServerProfile } from "./index.js";
import { readConformanceMockState } from "../test-support/read-conformance-mock-state.js";

describe("shipping Read conformance evidence", () => {
  it("records one well-formed constant shared by both targets", () => {
    const bdptest = recordedReadConformanceEvidence("bdptest");
    expect(bdptest).toMatch(/^[0-9a-f]{40}$/);
    // One cohort covers both targets: the two entries must always agree, and a
    // divergence here is a divergence the evidence gate would also refuse.
    expect(recordedReadConformanceEvidence("bdpbd")).toBe(bdptest);
    expect(hasReadConformanceEvidence("bdptest")).toBe(true);
    expect(hasReadConformanceEvidence("bdpbd")).toBe(true);
  });

  it("still fails closed for a target that carries no evidence", () => {
    expect(hasReadConformanceEvidence("toString" as never)).toBe(false);
    expect(recordedReadConformanceEvidence("toString" as never)).toBeUndefined();
    expect(() => admitReadServerProfile("read", "imposter" as never)).toThrow(
      "cumulative black-box Read matrix",
    );
  });

  it("admits through the unmocked shipping import without any test grant", () => {
    const state = readConformanceMockState();
    expect(state.grants.get("bdptest") ?? 0).toBe(0);
    expect(admitReadServerProfile("read", "bdptest")).toMatchObject({ profile: "read" });
  });
});
