import { BDP_PROBLEM_FAMILY_PREFIX } from "./index.js";

/** Accepted S1 amendment; this code belongs only to direct Transactional replies. */
export interface SnapshotPositionTooOldProblem {
  readonly type: `${typeof BDP_PROBLEM_FAMILY_PREFIX}conflict`;
  readonly title: "snapshot-position-too-old";
  readonly status: 409;
  readonly code: "snapshot-position-too-old";
  readonly retry: "after-state-change";
}

export function snapshotPositionTooOldProblem(): Readonly<SnapshotPositionTooOldProblem> {
  return Object.freeze({
    type: `${BDP_PROBLEM_FAMILY_PREFIX}conflict`,
    title: "snapshot-position-too-old",
    status: 409,
    code: "snapshot-position-too-old",
    retry: "after-state-change",
  });
}
