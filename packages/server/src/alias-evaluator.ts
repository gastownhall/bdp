import {
  type BeadRecord,
  type ReadUpdateAliasResult,
  type ReadUpdateInputs,
  type ReadUpdateProblem,
  ProtocolArtifactValidationError,
  assertCanonicalPathSegments,
  parseBeadRecord,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  parseReadUpdateAliasResult,
  parseReadUpdateProblem,
} from "@bdp/protocol";
import {
  type ResourceMutationPolicy,
  type ResourceTransaction,
  isResourceVisible,
} from "./resource-evaluator.js";

export type AliasMutation = {
  [K in "putAlias" | "deleteAlias"]: { readonly operation: K; readonly input: ReadUpdateInputs[K] };
}["putAlias" | "deleteAlias"];
/** Structural subset of the S6 owned-member facade. Paths omit alias/; target
 * IDs include beads/. This module owns no table, cache, key or transaction.
 */
export interface AliasTransaction
  extends Pick<ResourceTransaction, "resource" | "alias" | "identityWasCommitted"> {
  putAlias(path: string, beadId: string): void;
  deleteAlias(path: string): void;
}
export interface AliasEvaluationOptions {
  readonly scope: string;
  /** Same captured current authority policy/principal as the Resource facet.
   * canWriteBead means permission to write the touched Bead for an alias
   * operation, not approval of a particular unchanged Resource transition.
   */
  readonly policy: Pick<ResourceMutationPolicy, "canRead"> & {
    canWriteBead(record: BeadRecord): boolean;
  };
  readonly limits: { readonly diagnosticCount?: number; readonly diagnosticBytes?: number };
}
export type AliasEvaluation =
  | { readonly effect: "success"; readonly outcome: ReadUpdateAliasResult }
  | { readonly effect: "failure"; readonly outcome: ReadUpdateProblem };

class AliasFailure extends Error {
  constructor(readonly problem: ReadUpdateProblem) {
    super(problem.code);
  }
}
const failures = {
  "resource-not-found": ["not-found", 404, "after-state-change"],
  "identity-taken": ["conflict", 409, "never"],
  forbidden: ["authorization", 403, "after-state-change"],
} as const;
function fail(code: keyof typeof failures): never {
  const [family, status, retry] = failures[code];
  throw new AliasFailure(
    parseReadUpdateProblem({
      type: `https://github.com/gastownhall/bdp/problems/${family}`,
      code,
      status,
      retry,
    }),
  );
}
const targetDiagnostics = Object.freeze([
  Object.freeze({
    message:
      "an alias put's target must be a canonical in-Scope Bead reference; an alias, a Link, or an external URI is not admitted",
  }),
]);
const targetDiagnosticBytes = Buffer.byteLength(JSON.stringify(targetDiagnostics));
function badTarget(): never {
  throw new AliasFailure(
    parseReadUpdateProblem({
      type: "https://github.com/gastownhall/bdp/problems/validation",
      code: "validation-failed",
      status: 422,
      retry: "never",
      diagnostics: targetDiagnostics,
    }),
  );
}
function assertAdmittedPath(path: string, uri?: string): void {
  try {
    if (uri !== undefined) parseCanonicalHttpUrl(uri);
    assertCanonicalPathSegments(path, "admitted alias reference");
  } catch (cause) {
    if (cause instanceof ProtocolArtifactValidationError)
      throw new TypeError("S1/Scope preflight must reject malformed alias references", { cause });
    throw cause;
  }
}
function canonical(scope: string, reference: string): string {
  if (reference.startsWith("@"))
    throw new TypeError("S5 must resolve bindings before alias evaluation");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference)) return reference;
  assertAdmittedPath(reference);
  return new URL(reference, scope).href;
}
function pathInScope(scope: string, uri: string, root: "alias/" | "beads/"): string | undefined {
  if (!uri.startsWith(scope)) return undefined;
  const path = uri.slice(scope.length);
  assertAdmittedPath(path, uri);
  return path.startsWith(root) && path.length > root.length ? path : undefined;
}

/** Invoke only inside S6 executeMember after whole-carrier S1/Scope preflight
 * and S4 normalization in this same transaction. S5 substitutes valid @bindings;
 * S4 owns failed/successful identity retention and replay (including alias results).
 * Every ordinary refusal occurs before an alias write. Unexpected errors escape
 * so the owner rolls back, never retaining a guessed failure or partial effect.
 */
export function evaluateAliasMutation(
  tx: AliasTransaction,
  mutation: AliasMutation,
  options: AliasEvaluationOptions,
): AliasEvaluation {
  const { scope, policy } = options;
  const { diagnosticCount, diagnosticBytes } = options.limits;
  parseCanonicalScope(scope);
  for (const limit of [diagnosticCount, diagnosticBytes])
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
      throw new TypeError("positive usable diagnostic limits required");
  if (diagnosticBytes !== undefined && diagnosticBytes < targetDiagnosticBytes)
    throw new TypeError("diagnostic configuration cannot retain one complete diagnostic");
  const loadVisible = (id: string): BeadRecord => {
    const stored = tx.resource(id);
    if (stored?.kind !== "bead") fail("resource-not-found");
    const record = parseBeadRecord(JSON.parse(stored.bodyJson));
    if (record.id !== `${scope}${id}` || stored.id !== id)
      throw new Error("stored Bead identity differs from its index");
    if (!isResourceVisible(tx, record, scope, policy)) fail("resource-not-found");
    return record;
  };
  try {
    const alias = canonical(scope, mutation.input.alias);
    const localAlias = pathInScope(scope, alias, "alias/");
    if (localAlias === undefined) fail("resource-not-found");
    const path = localAlias.slice("alias/".length);
    // The deliberate uniqueness disclosure precedes target/category/visibility checks.
    if (mutation.operation === "putAlias" && tx.identityWasCommitted(`beads/${path}`))
      fail("identity-taken");
    const currentId = tx.alias(path);
    let proposed: BeadRecord | undefined;
    let proposedId: string | undefined;
    if (mutation.operation === "putAlias") {
      const target = canonical(scope, mutation.input.target);
      proposedId = pathInScope(scope, target, "beads/");
      if (proposedId === undefined) badTarget();
      proposed = loadVisible(proposedId);
    }
    if (mutation.operation === "deleteAlias" && currentId === undefined) fail("resource-not-found");
    const current = currentId === undefined ? undefined : loadVisible(currentId);
    // Complete both closure checks before disclosing a write-policy refusal.
    if (proposed && !policy.canWriteBead(proposed)) fail("forbidden");
    if (current && currentId !== proposedId && !policy.canWriteBead(current)) fail("forbidden");
    let outcome: ReadUpdateAliasResult;
    if (mutation.operation === "putAlias") {
      if (proposed === undefined || proposedId === undefined)
        throw new Error("putAlias lost its validated target");
      if (currentId !== proposedId) tx.putAlias(path, proposedId);
      outcome = {
        outcome: currentId === undefined ? "created" : "updated",
        alias,
        target: proposed.id,
      };
    } else {
      tx.deleteAlias(path);
      outcome = { outcome: "deleted", alias };
    }
    return Object.freeze({ effect: "success", outcome: parseReadUpdateAliasResult(outcome) });
  } catch (error) {
    if (error instanceof AliasFailure)
      return Object.freeze({ effect: "failure", outcome: error.problem });
    throw error;
  }
}
