import type { ReadProblem, ReadProblemCode, RetryDisposition } from "./index.js";
import { parseReadUpdateShape } from "./read-update-values.js";

export type ReadUpdateProblemCode =
  | ReadProblemCode
  | "unsupported-media-type"
  | "binding-unavailable"
  | "validation-failed"
  | "type-not-installed"
  | "identity-taken"
  | "alias-path-taken"
  | "revision-mismatch"
  | "incident-links-exist"
  | "aggregate-constraint-violation"
  | "idempotency-conflict"
  | "idempotency-in-progress"
  | "idempotency-expired"
  | "revision-allocation-unsafe";
export interface ValidationDiagnostic {
  readonly message: string;
  readonly type?: string;
  readonly schemaLocation?: string;
  readonly instanceLocation?: string;
}
/** RFC9457 extensions remain open; the owning schema constrains known codes
 * and their conditionally legal fields (including erased-pointer prohibition).
 */
export interface ReadUpdateProblem extends Omit<ReadProblem, "code" | "status" | "retry"> {
  readonly type: ReadProblem["type"];
  readonly code: ReadUpdateProblemCode;
  readonly status?: number;
  readonly retry: RetryDisposition;
  readonly retryAfter?: number;
  readonly diagnostics?: readonly ValidationDiagnostic[];
  readonly diagnosticsTruncated?: boolean;
}
export function parseReadUpdateProblem(value: unknown): ReadUpdateProblem {
  return parseReadUpdateShape(value, "problem") as unknown as ReadUpdateProblem;
}
export type ReadUpdateSequenceMemberProblem = ReadUpdateProblem & {
  readonly status: number;
  readonly operationIndex: number;
  readonly operationName?: string;
};
export function parseReadUpdateSequenceMemberProblem(
  value: unknown,
): ReadUpdateSequenceMemberProblem {
  return parseReadUpdateShape(
    value,
    "sequenceMemberProblem",
  ) as unknown as ReadUpdateSequenceMemberProblem;
}
