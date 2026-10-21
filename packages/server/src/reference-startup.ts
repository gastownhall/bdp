/** Supported trusted reference startup. This is a qualification target, not certification. */
import { loadReferenceDeployment, type ReferenceDeploymentInput } from "./reference-deployment.js";
import { startPreparedReferenceDeployment } from "./reference-deployment-runtime.js";

/** Capture configuration before acquiring the owner or exposing a listener. */
export async function startReferenceDeployment(
  input: ReferenceDeploymentInput,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const prepared = await loadReferenceDeployment(input);
  signal?.throwIfAborted();
  return startPreparedReferenceDeployment(prepared, signal);
}
