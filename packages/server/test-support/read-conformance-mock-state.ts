import type { ReadServerTarget } from "../src/read-conformance-capability.js";

export interface ReadConformanceMockState {
  readonly grants: Map<ReadServerTarget, number>;
  installedMock: ((target: ReadServerTarget) => boolean) | undefined;
}

export const readConformanceMockStateSymbol = Symbol.for("bdp.test.read-conformance-mock");

export function readConformanceMockState(): ReadConformanceMockState {
  const state = Reflect.get(globalThis, readConformanceMockStateSymbol) as
    | ReadConformanceMockState
    | undefined;
  if (state === undefined)
    throw new Error("test-support module loaded before the Read conformance mock setup");
  return state;
}
