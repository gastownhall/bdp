import { stringifyJsonValue } from "@bdp/protocol";
import { assertAliasDiagnosticLimits } from "./alias-evaluator.js";
import { assertRetainedOutcomeCompatible } from "./member-executor.js";
import type { RecoveryStore } from "./recovery-store.js";
import { readStoredResource } from "./resource-evaluator.js";

export interface ReadUpdateRuntimeLimits {
  readonly requestBodyBytes: number;
  readonly propertiesBytes: number;
  readonly diagnosticBytes: number;
  readonly diagnosticCount?: number;
}
export interface ReadUpdateRuntimeLimitSnapshot extends ReadUpdateRuntimeLimits {
  readonly maximumFirstDiagnosticBytes: number;
}

/** Numerical witness only. R is declared here, not enforced. The actual owner must
 * enforce that exact request bound before parse/claims, qualify every emitter's
 * instance-location provenance and encoded metadata, and advertise the same bounds.
 * Type/schema-location/message allowances include JSON quotes and escapes.
 */
export function snapshotReadUpdateRuntimeLimits(
  input: ReadUpdateRuntimeLimits,
): ReadUpdateRuntimeLimitSnapshot {
  const { requestBodyBytes, propertiesBytes, diagnosticBytes, diagnosticCount } = input;
  for (const value of [requestBodyBytes, propertiesBytes, diagnosticBytes])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new TypeError("runtime byte bounds must be positive safe integers");
  const limits = {
    requestBodyBytes,
    propertiesBytes,
    diagnosticBytes,
    ...(diagnosticCount !== undefined ? { diagnosticCount } : {}),
  };
  assertAliasDiagnosticLimits(limits);
  const instanceBytes = requestBodyBytes + propertiesBytes;
  const pointerBytes = 2 * instanceBytes + 2;
  const maximumFirstDiagnosticBytes = pointerBytes + 4096 + 16384 + 1024 + 256;
  if (![instanceBytes, pointerBytes, maximumFirstDiagnosticBytes].every(Number.isSafeInteger))
    throw new RangeError("runtime diagnostic feasibility arithmetic exceeds safe integers");
  if (diagnosticBytes < maximumFirstDiagnosticBytes)
    throw new RangeError("diagnostic bound cannot hold the qualified first diagnostic");
  return Object.freeze({ ...limits, maximumFirstDiagnosticBytes });
}

/** Owner-only, synchronous compatibility scan; never a readiness certificate.
 * Caller lawfully expires at one captured time BEFORE this call, then completes
 * all other startup checks before transfer, closing/refusing on any failure.
 * No clock, expiry, migration or time-filtering occurs here. The two scans must
 * not nest within each other or any S6 reader/member access.
 *
 * This does not qualify actual R enforcement, installed emitter/location/metadata
 * correctness, complete graph/Type validity, population/lineage/old fingerprints,
 * retained successful postimage properties bytes, full response bounds or mandatory
 * transfer. Lowering B does not bound replayed successful bodies; their startup,
 * advertisement and complete-response compatibility remains an owner obligation.
 * S5 does not require this call.
 * resources() materializes rows and embedded owned bodies; parsing/snapshots and
 * duplicate inline content amplify memory/work. No streaming or fixed-memory bound.
 */
export function assertReadUpdateRuntimeCompatibility(
  store: RecoveryStore,
  input: ReadUpdateRuntimeLimits,
): void {
  const limits = snapshotReadUpdateRuntimeLimits(input);
  const scope = store.scope;
  store.read((reader) => {
    for (const row of reader.resources()) {
      const resource = readStoredResource(row, scope);
      // Owned Links are charged once to their own canonical row, not to the owner.
      if (Buffer.byteLength(stringifyJsonValue(resource.properties)) > limits.propertiesBytes)
        throw new RangeError("live Resource properties exceed configured bound");
    }
  });
  store.visitRetainedOutcomes((row) => assertRetainedOutcomeCompatible(row, scope, limits));
}
