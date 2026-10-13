/** Source-only canonical wire fixture. Never an installed launch/profile option. */
import type { DevelopmentServerOptions } from "../../../packages/server/src/development-runtime.js";
import type { LifecycleScheduler } from "../../../packages/server/src/sequence-executor.js";
// Load the actual emitted implementation, like the existing process harness.
const runtime = (await import(
  new URL("../../../packages/server/dist/development-runtime.js", import.meta.url).href
)) as typeof import("../../../packages/server/src/development-runtime.js");
const composition = (await import(
  new URL("../../../packages/server/dist/development-composition.js", import.meta.url).href
)) as typeof import("../../../packages/server/src/development-composition.js");
export const canonicalDevelopmentComposition = composition.createDevelopmentComposition("/acme/");

export function startCanonicalDevelopmentFixture(
  options: DevelopmentServerOptions,
  scheduler?: LifecycleScheduler,
) {
  return runtime.startDevelopmentReferenceRuntime(
    options,
    scheduler,
    undefined,
    canonicalDevelopmentComposition,
  );
}
export const startPrivateRuntime = runtime.startDevelopmentReferenceRuntime;
