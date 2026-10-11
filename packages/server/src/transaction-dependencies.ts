/** Private sequence facts and partial identity comparison; no key authority. */
import {
  normalizeTransaction,
  type PreparedTransaction,
  type PreparedTransactionSequence,
} from "./transaction-batch.js";
import { encodeSemanticValue, UNBOUND_SEMANTIC_REFERENCE } from "./semantic-identity.js";
import type { MemberCreatorBinding } from "./member-identity.js";
export type CreatorFact = MemberCreatorBinding;
export type ReferenceBindings = ReadonlyMap<string, string | typeof UNBOUND_SEMANTIC_REFERENCE>;
export interface DependencyTemplate {
  readonly attempt: string;
  readonly dependencies: readonly {
    readonly field: string;
    readonly creator: number;
    readonly resourceKind: "bead" | "link";
    readonly suppliedId?: string;
    readonly operationSlot: 0;
  }[];
  readonly identity: string;
  readonly operation: string;
}
export function dependencyTemplate(
  attempt: string,
  member: PreparedTransactionSequence["members"][number],
): DependencyTemplate {
  const references = new Map(
    member.dependencies.map((d) => [d.field, UNBOUND_SEMANTIC_REFERENCE] as const),
  );
  return {
    attempt,
    dependencies: member.dependencies.map((d) => ({ ...d, operationSlot: 0 })),
    operation: member.operation,
    identity: normalizeTransaction(member.request, () => undefined, undefined, references).identity,
  };
}
/** A hole masks only its reference URI, never its pin or surrounding structure. */
export function compareDependencyTemplate(
  template: DependencyTemplate,
  request: PreparedTransaction,
  resolveAlias: (locator: string) => string | undefined,
  fact: (creator: number) => CreatorFact | undefined,
): "conflict" | "equal" | "pending" {
  if (
    request.carrier.operations.length !== 1 ||
    request.carrier.operations[0]?.operation !== template.operation
  )
    return "conflict";
  const candidate = normalizeTransaction(request, resolveAlias);
  const byCreator = new Map<number, string>();
  let unresolved = false;
  for (const d of template.dependencies) {
    const value = candidate.referenceIdentities.get(d.field);
    if (value === undefined) return "conflict";
    const encoded = JSON.parse(value) as [string, [string, string]];
    if (
      encoded[1][0] !== "string" ||
      !encoded[1][1].startsWith(
        `${request.carrier.scope}${d.resourceKind === "bead" ? "beads" : "links"}/`,
      )
    )
      return "conflict";
    if (d.suppliedId !== undefined && value !== encodeSemanticValue(d.suppliedId))
      return "conflict";
    const captured = fact(d.creator);
    if (!captured || captured.kind === "transient") unresolved = true;
    else if (captured.kind === "unbound" || value !== encodeSemanticValue(captured.id))
      return "conflict";
    const previous = byCreator.get(d.creator);
    if (previous !== undefined && previous !== value) return "conflict";
    byCreator.set(d.creator, value);
  }
  const different =
    normalizeTransaction(
      request,
      resolveAlias,
      undefined,
      new Map(template.dependencies.map((d) => [d.field, UNBOUND_SEMANTIC_REFERENCE] as const)),
    ).identity !== template.identity;
  return different ? "conflict" : unresolved ? "pending" : "equal";
}
export function resolveDependencies(
  template: DependencyTemplate,
  fact: (creator: number) => CreatorFact,
): ReferenceBindings | undefined {
  const bindings = new Map<string, string | typeof UNBOUND_SEMANTIC_REFERENCE>();
  for (const dependency of template.dependencies) {
    const value = fact(dependency.creator);
    if (value.kind === "transient") return undefined;
    bindings.set(dependency.field, value.kind === "bound" ? value.id : UNBOUND_SEMANTIC_REFERENCE);
  }
  return bindings;
}
