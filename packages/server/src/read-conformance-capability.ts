export type ReadServerTarget = "bdptest" | "bdpbd";

/**
 * The Read cohort evidence constant: the content digest (SHA-256 truncated to
 * its first 40 hex characters) of the committed two-target cohort artifact at
 * docs/design/evidence/read-cohort/read-v1.json. The artifact records, per
 * target, the packaged rows proved against the launched payloads, the
 * self-certified in-process rows, and each honestly not-applicable
 * capability-gated row, per the ruled provenance split; the sealed artifact
 * itself carries the authoritative counts.
 *
 * `pnpm evidence:verify` is the gate: it re-derives the self-certifiable set
 * from the bound manifest, checks canonical artifact bytes against this value
 * for both targets, and confines the run-head-to-evidence-commit delta to the
 * artifact and this file. Regenerate with `pnpm evidence:generate`; any edit
 * here without a matching artifact fails the gate closed.
 *
 * One value for both targets, never populated independently: one cohort covers
 * both, so the two entries must always agree. This internal-but-shipped module
 * is deliberately deep-imported by the smoke and E2E gate scripts; the record
 * itself stays private to prevent runtime callers from manufacturing evidence.
 */
const READ_COHORT_EVIDENCE_CONSTANT = "90c7da7b85916cb215e4400d922fe23b072826aa";

const READ_CONFORMANCE_EVIDENCE_BY_TARGET: Readonly<Record<ReadServerTarget, string | undefined>> =
  Object.freeze({
    bdptest: READ_COHORT_EVIDENCE_CONSTANT,
    bdpbd: READ_COHORT_EVIDENCE_CONSTANT,
  });

function evidenceFor(target: ReadServerTarget): string | undefined {
  if (!Object.hasOwn(READ_CONFORMANCE_EVIDENCE_BY_TARGET, target)) return undefined;
  const evidence = READ_CONFORMANCE_EVIDENCE_BY_TARGET[target];
  return typeof evidence === "string" && /^[0-9a-f]{40}$/.test(evidence) ? evidence : undefined;
}

/** Narrow capability query for composition roots and smoke tooling. */
export function hasReadConformanceEvidence(target: ReadServerTarget): boolean {
  return evidenceFor(target) !== undefined;
}

/**
 * The recorded value exactly as shipped, unvalidated, for the evidence gate
 * only. Admission never reads this: it goes through `hasReadConformanceEvidence`,
 * which validates shape. Returning the raw value here is what lets the gate
 * treat a malformed committed constant as a claim that fails verification
 * rather than as absence.
 */
export function recordedReadConformanceEvidence(target: ReadServerTarget): string | undefined {
  if (!Object.hasOwn(READ_CONFORMANCE_EVIDENCE_BY_TARGET, target)) return undefined;
  return READ_CONFORMANCE_EVIDENCE_BY_TARGET[target];
}
