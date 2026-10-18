/** Private identity registry. Never exported by a package entry. */
import type { PreparedReferenceDeployment } from "./reference-deployment.js";
import type { captureInstalledReferenceConfiguration } from "./installed-reference-configuration.js";
import type { captureInstalledTransactionConfiguration } from "./transaction-installed-configuration.js";
import type { captureTransactionRuntimeConfiguration } from "./transaction-runtime-configuration.js";

export type ReferenceDeploymentState =
  | {
      readonly profile: "read-update";
      readonly projectedInput: Readonly<Record<string, unknown>>;
      readonly installed: ReturnType<typeof captureInstalledReferenceConfiguration>;
    }
  | {
      readonly profile: "transactional";
      readonly projectedInput: Readonly<Record<string, unknown>>;
      readonly installed: ReturnType<typeof captureInstalledTransactionConfiguration>;
      readonly preflight: ReturnType<typeof captureTransactionRuntimeConfiguration>;
    };

const states = new WeakMap<object, ReferenceDeploymentState>();
export function registerReferenceDeployment(
  handle: PreparedReferenceDeployment,
  state: ReferenceDeploymentState,
): void {
  if (states.has(handle)) throw new TypeError("reference deployment already registered");
  states.set(handle, Object.freeze(state));
}
export function referenceDeploymentState(handle: unknown): ReferenceDeploymentState {
  const state = handle !== null && typeof handle === "object" ? states.get(handle) : undefined;
  if (state === undefined) throw new TypeError("registered reference deployment required");
  return state;
}
