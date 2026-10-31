import { parseCanonicalHttpUrl, assertCanonicalPathSegments } from "@bdp/protocol";
/** Private sequence facts and partial identity comparison; no key authority. */
import {
  normalizeTransaction,
  transactionAliasOperands,
  transactionAliasFields,
  type PreparedTransaction,
  type PreparedTransactionSequence,
} from "./transaction-batch.js";
import { encodeSemanticValue, UNBOUND_SEMANTIC_REFERENCE } from "./semantic-identity.js";
import type { MemberCreatorBinding } from "./member-identity.js";
export type CreatorFact = MemberCreatorBinding;
export type ReferenceBindings = ReadonlyMap<string, string | typeof UNBOUND_SEMANTIC_REFERENCE>;
interface CreatorDependencyTemplate {
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
interface AliasDependencyTemplate extends CreatorDependencyTemplate {
  readonly form: "transaction-deferred-alias-1";
  readonly aliases: PreparedTransactionSequence["members"][number]["aliasOperands"];
  /** Fixed URI identities; deferred fields use private holes, never final witnesses. */
  readonly referenceIdentities: Readonly<Record<string, string>>;
}
export type DependencyTemplate = CreatorDependencyTemplate | AliasDependencyTemplate;
function aliasTemplate(template: DependencyTemplate): template is AliasDependencyTemplate {
  return "form" in template;
}
/** Pending-only data is consumed by its exclusive owner. Startup retracts it. */
export function parseDependencyTemplate(text: string, scope: string): DependencyTemplate {
  const value = JSON.parse(text) as DependencyTemplate;
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.attempt !== "string" ||
    typeof value.identity !== "string" ||
    typeof value.operation !== "string" ||
    !Array.isArray(value.dependencies) ||
    value.dependencies.length > 2 ||
    value.dependencies.some(
      (dependency) =>
        !dependency ||
        !["bead", "link", "source", "target"].includes(dependency.field) ||
        !Number.isSafeInteger(dependency.creator) ||
        dependency.creator < 0 ||
        dependency.operationSlot !== 0 ||
        (dependency.resourceKind !== "bead" && dependency.resourceKind !== "link") ||
        (dependency.suppliedId !== undefined && typeof dependency.suppliedId !== "string"),
    )
  )
    throw new Error("invalid pending dependency template");
  if (aliasTemplate(value)) {
    if (
      value.form !== "transaction-deferred-alias-1" ||
      !Array.isArray(value.aliases) ||
      value.aliases.length < 1 ||
      value.aliases.length > 2 ||
      !value.referenceIdentities ||
      typeof value.referenceIdentities !== "object" ||
      Array.isArray(value.referenceIdentities) ||
      Object.values(value.referenceIdentities).some((identity) => typeof identity !== "string") ||
      value.aliases.some(
        (alias) => !alias || typeof alias.field !== "string" || typeof alias.locator !== "string",
      )
    )
      throw new Error("invalid pending alias template");
    const fields = transactionAliasFields(value.operation);
    if (
      Object.keys(value).sort().join(",") !==
        "aliases,attempt,dependencies,form,identity,operation,referenceIdentities" ||
      new Set(value.aliases.map((alias) => alias.field)).size !== value.aliases.length ||
      value.aliases.some(
        (alias) =>
          Object.keys(alias).sort().join(",") !== "field,locator" ||
          !fields.includes(alias.field) ||
          !alias.locator.startsWith(`${scope}alias/`) ||
          !Object.hasOwn(value.referenceIdentities, alias.field) ||
          value.dependencies.some((dependency) => dependency.field === alias.field),
      ) ||
      Object.keys(value.referenceIdentities).some(
        (field) => !["id", "bead", "source", "target"].includes(field),
      )
    )
      throw new Error("invalid pending alias template");
    for (const identity of Object.values(value.referenceIdentities)) {
      // Admission stores only exact URI strings and explicit private holes here,
      // not arbitrary semantic documents or final alias-miss witnesses.
      let valid = identity === encodeSemanticValue(UNBOUND_SEMANTIC_REFERENCE);
      try {
        const encoded: unknown = JSON.parse(identity);
        if (
          Array.isArray(encoded) &&
          Array.isArray(encoded[1]) &&
          typeof encoded[1][1] === "string"
        )
          valid ||= identity === encodeSemanticValue(encoded[1][1]);
      } catch {
        // An invalid private record is an integrity fault, never a missing alias.
      }
      if (!valid) throw new Error("invalid pending alias reference identity");
    }
    for (const alias of value.aliases) {
      parseCanonicalHttpUrl(alias.locator);
      assertCanonicalPathSegments(alias.locator.slice(scope.length), "pending alias locator");
    }
  } else if (Object.keys(value).sort().join(",") !== "attempt,dependencies,identity,operation") {
    throw new Error("invalid pending dependency template");
  }
  return value;
}
export function dependencyTemplate(
  attempt: string,
  member: PreparedTransactionSequence["members"][number],
): DependencyTemplate {
  const references = new Map(
    member.dependencies.map((d) => [d.field, UNBOUND_SEMANTIC_REFERENCE] as const),
  );
  const base = {
    attempt,
    dependencies: member.dependencies.map((d) => ({ ...d, operationSlot: 0 as const })),
    operation: member.operation,
    identity: "",
  };
  if (member.aliasOperands.length === 0)
    return {
      ...base,
      identity: normalizeTransaction(
        member.request,
        () => {
          throw new Error("admission alias lookup");
        },
        undefined,
        references,
      ).identity,
    };
  for (const alias of member.aliasOperands) references.set(alias.field, UNBOUND_SEMANTIC_REFERENCE);
  const source = normalizeTransaction(
    member.request,
    () => {
      throw new Error("admission alias lookup");
    },
    undefined,
    references,
  );
  const masked = new Map(
    [...source.referenceIdentities.keys()].map(
      (field) => [field, UNBOUND_SEMANTIC_REFERENCE] as const,
    ),
  );
  return {
    ...base,
    form: "transaction-deferred-alias-1",
    aliases: member.aliasOperands,
    referenceIdentities: Object.fromEntries(source.referenceIdentities),
    identity: normalizeTransaction(
      member.request,
      () => {
        throw new Error("admission alias lookup");
      },
      undefined,
      masked,
    ).identity,
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
  if (aliasTemplate(template)) return compareAliasTemplate(template, request, resolveAlias, fact);
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
/** At most six reference slots. Symbols correlate by original locator/creator,
 * never by slot; a candidate occurrence of an original alias is symbolic too. */
function compareAliasTemplate(
  template: AliasDependencyTemplate,
  request: PreparedTransaction,
  resolveAlias: (locator: string) => string | undefined,
  fact: (creator: number) => CreatorFact | undefined,
): "conflict" | "pending" {
  const locators = new Set(template.aliases.map((alias) => alias.locator));
  const candidateAliases = transactionAliasOperands(request);
  const symbolic = new Map(
    candidateAliases
      .filter((alias) => locators.has(alias.locator))
      .map((alias) => [alias.field, alias.locator]),
  );
  const candidate = normalizeTransaction(
    request,
    (locator) => {
      if (locators.has(locator)) throw new Error("unresolved original alias lookup");
      return resolveAlias(locator);
    },
    undefined,
    new Map([...symbolic.keys()].map((field) => [field, UNBOUND_SEMANTIC_REFERENCE] as const)),
  );
  const masked = new Map(
    Object.keys(template.referenceIdentities).map(
      (field) => [field, UNBOUND_SEMANTIC_REFERENCE] as const,
    ),
  );
  // A symbol moved into a previously fixed slot must be masked there too. All
  // original reference slots are masked; identity still pins shape and pins.
  if (
    normalizeTransaction(
      request,
      () => {
        throw new Error("masked alias lookup");
      },
      undefined,
      masked,
    ).identity !== template.identity
  )
    return "conflict";
  type Term = { symbol: string } | { fixed: string };
  const parents = new Map<string, string>();
  const values = new Map<string, string>();
  const domains = new Map<string, ((value: string) => boolean)[]>();
  const root = (symbol: string): string => {
    const parent = parents.get(symbol);
    return parent === undefined || parent === symbol ? symbol : root(parent);
  };
  const stringIdentity = (value: string): string | undefined => {
    const encoded = JSON.parse(value) as [string, [string, unknown]];
    return encoded[1]?.[0] === "string" && typeof encoded[1][1] === "string"
      ? encoded[1][1]
      : undefined;
  };
  const variable = (symbol: string, permits: (value: string) => boolean): Term => {
    if (!parents.has(symbol)) {
      parents.set(symbol, symbol);
      domains.set(symbol, [permits]);
    }
    return { symbol };
  };
  const aliasTerm = (locator: string): Term =>
    variable(
      `alias:${locator}`,
      (value) =>
        stringIdentity(value)?.startsWith(`${request.carrier.scope}beads/`) === true ||
        value === encodeSemanticValue({ unresolvedAlias: locator }),
    );
  const compatible = (symbol: string, value: string) =>
    domains.get(root(symbol))!.every((permit) => permit(value));
  const unify = (left: Term, right: Term): boolean => {
    if ("fixed" in left && "fixed" in right) return left.fixed === right.fixed;
    if ("fixed" in left) return unify(right, left);
    const a = root(left.symbol);
    if ("fixed" in right) {
      if (!compatible(a, right.fixed) || (values.has(a) && values.get(a) !== right.fixed))
        return false;
      values.set(a, right.fixed);
      return true;
    }
    const b = root(right.symbol);
    if (a === b) return true;
    const av = values.get(a),
      bv = values.get(b);
    if (av !== undefined && bv !== undefined && av !== bv) return false;
    parents.set(b, a);
    domains.set(a, [...domains.get(a)!, ...domains.get(b)!]);
    const value = av ?? bv;
    if (value !== undefined) {
      if (!compatible(a, value)) return false;
      values.set(a, value);
    }
    return true;
  };
  const creatorTerms = new Map<number, Term>();
  for (const [field, fixed] of Object.entries(template.referenceIdentities)) {
    const alias = template.aliases.find((item) => item.field === field);
    const dependency = template.dependencies.find((item) => item.field === field);
    let original: Term = { fixed };
    if (alias) original = aliasTerm(alias.locator);
    else if (dependency) {
      let term = creatorTerms.get(dependency.creator);
      if (!term) {
        const captured = fact(dependency.creator);
        term =
          captured && captured.kind !== "transient"
            ? {
                fixed: encodeSemanticValue(
                  captured.kind === "bound" ? captured.id : UNBOUND_SEMANTIC_REFERENCE,
                ),
              }
            : variable(`creator:${dependency.creator}`, (value) => {
                const id = stringIdentity(value);
                return (
                  id?.startsWith(
                    `${request.carrier.scope}${dependency.resourceKind === "bead" ? "beads" : "links"}/`,
                  ) === true &&
                  (dependency.suppliedId === undefined || id === dependency.suppliedId)
                );
              });
        creatorTerms.set(dependency.creator, term);
      }
      original = term;
    }
    const locator = symbolic.get(field),
      identity = candidate.referenceIdentities.get(field);
    if (
      identity === undefined ||
      !unify(original, locator === undefined ? { fixed: identity } : aliasTerm(locator))
    )
      return "conflict";
  }
  // Even a satisfiable constraint is not an execution witness. Only the owner's
  // eligible turn replaces this pending template with a final identity.
  return "pending";
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
