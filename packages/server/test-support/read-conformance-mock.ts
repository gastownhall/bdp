import { afterAll, vi } from "vitest";

import type { ReadServerTarget } from "../src/read-conformance-capability.js";
import {
  type ReadConformanceMockState,
  readConformanceMockStateSymbol,
} from "./read-conformance-mock-state.js";

/** Minimal global setup: install the non-emitted admission mock without loading @bdp/server. */
const conformance = vi.hoisted(() => ({
  grants: new Map<ReadServerTarget, number>(),
  installedMock: undefined as ((target: ReadServerTarget) => boolean) | undefined,
})) satisfies ReadConformanceMockState;

Reflect.set(globalThis, readConformanceMockStateSymbol, conformance);

vi.mock("../src/read-conformance-capability.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/read-conformance-capability.js")>();
  const installedMock = (target: ReadServerTarget): boolean =>
    (conformance.grants.get(target) ?? 0) > 0 || original.hasReadConformanceEvidence(target);
  conformance.installedMock = installedMock;
  return {
    ...original,
    hasReadConformanceEvidence: installedMock,
  };
});

afterAll(() => {
  const leaked = [...conformance.grants.entries()].filter(([, count]) => count !== 0);
  conformance.grants.clear();
  if (leaked.length > 0)
    throw new Error(
      `test-only Read conformance grants leaked: ${leaked
        .map(([target, count]) => `${target}=${count}`)
        .join(", ")}`,
    );
});
