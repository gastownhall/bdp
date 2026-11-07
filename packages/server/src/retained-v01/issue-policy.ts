/**
 * The Issue and Dependency Types package (`specs/types/issue/issue.md`), preview-1, enforced
 * as native Scope policy under Core. A fixed catalog; no Types1 activation and no Callables.
 */
import { type JsonObject, problem, referenceUri, type RetainedLink } from "./contract.js";
import type { ScopePolicy, ScopePolicyChange } from "./store.js";

const ISSUE = "https://github.com/gastownhall/bdp/types/issue/";
const DEPENDENCY = "https://github.com/gastownhall/bdp/types/dependency/";
const ABSTRACT_ISSUE = `${ISSUE}issue`;
const ABSTRACT_DEPENDENCY = `${DEPENDENCY}dependency`;
const ISSUE_TYPES = new Set(
  [
    "task",
    "bug",
    "feature",
    "epic",
    "chore",
    "decision",
    "message",
    "molecule",
    "gate",
    "spike",
    "story",
    "milestone",
    "event",
  ].map((name) => ISSUE + name),
);
const DEPENDENCY_TYPES = new Set(
  [
    "blocks",
    "parent-child",
    "conditional-blocks",
    "waits-for",
    "related",
    "discovered-from",
    "replies-to",
    "relates-to",
    "duplicates",
    "supersedes",
    "authored-by",
    "assigned-to",
    "approved-by",
    "attests",
    "tracks",
    "until",
    "caused-by",
    "validates",
    "delegated-from",
  ].map((name) => DEPENDENCY + name),
);
/** Issue §3.3. */
const SERVICE_MANAGED_ISSUE = [
  "created_at",
  "created_by",
  "updated_at",
  "started_at",
  "closed_at",
  "close_reason",
  "arrival_seq",
  "closed_by_session",
  "compaction_level",
  "compacted_at",
  "compacted_at_commit",
  "original_size",
];
const SERVICE_MANAGED_DEPENDENCY = ["created_at", "created_by"];
/** Issue §3.4: operational observations are never properties. */
const OBSERVATIONS = ["lease_expires_at", "heartbeat_at", "lease_granted_node", "is_blocked"];
/** Combined by the native cycle rule (Issue §4.4). */
const CYCLIC_KINDS = new Set(
  ["blocks", "conditional-blocks", "parent-child"].map((name) => DEPENDENCY + name),
);

const refuse = (message: string, instanceLocation?: string, extra: object = {}): JsonObject =>
  ({
    ...problem("validation-failed", 422),
    diagnostics: [
      {
        message,
        ...(instanceLocation === undefined ? {} : { instanceLocation }),
        ...extra,
      },
    ],
  }) as unknown as JsonObject;

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function managedRefusal(
  managed: readonly string[],
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>>,
): JsonObject | undefined {
  for (const name of managed)
    if (!same(before?.[name], after[name]))
      return refuse(`\`${name}\` is service-managed and cannot be authored`, `/${name}`);
  return undefined;
}

function issueRefusal(change: ScopePolicyChange): JsonObject | undefined {
  const properties = change.after.resource.properties as Readonly<Record<string, unknown>>;
  if (Object.hasOwn(properties, "issue_type"))
    return refuse("`issue_type` is not a property: the record's `type` carries it", "/issue_type");
  for (const name of OBSERVATIONS)
    if (Object.hasOwn(properties, name))
      return refuse(`\`${name}\` is an operational observation, not a property`, `/${name}`);
  if (typeof properties.title !== "string" || properties.title === "")
    return refuse("`title` is required and nonempty", "/title");
  if (typeof properties.status !== "string" || properties.status === "")
    return refuse("`status` is required and nonempty", "/status");
  if (
    typeof properties.priority !== "number" ||
    !Number.isInteger(properties.priority) ||
    properties.priority < 0 ||
    properties.priority > 4
  )
    return refuse("`priority` is required, an integer from 0 to 4", "/priority");
  if (properties.labels !== undefined) {
    const labels = properties.labels;
    if (
      !Array.isArray(labels) ||
      labels.some((label) => typeof label !== "string" || label === "") ||
      new Set(labels).size !== labels.length
    )
      return refuse("`labels` must be distinct nonempty strings", "/labels");
  }
  const before =
    change.before === undefined
      ? undefined
      : (change.before.resource.properties as Readonly<Record<string, unknown>>);
  const managed = managedRefusal(SERVICE_MANAGED_ISSUE, before, properties);
  if (managed) return managed;
  if (properties.status === "closed" && before?.status !== "closed")
    return refuse(
      "a direct edit to `closed` needs `closed_at`, which only the close operation sets",
      "/status",
    );
  return undefined;
}

function isIssueBead(state: ReturnType<ScopePolicyChange["read"]>): boolean {
  return state?.kind === "bead" && ISSUE_TYPES.has(referenceUri(state.resource.type));
}

function dependencyRefusal(change: ScopePolicyChange, scope: string): JsonObject | undefined {
  const resource = change.after.resource as RetainedLink;
  const properties = resource.properties as Readonly<Record<string, unknown>>;
  if (Object.hasOwn(properties, "dep_type"))
    return refuse("`dep_type` is not a property: the Link's `type` carries it", "/dep_type");
  if (typeof resource.source !== "string" || typeof resource.target !== "string")
    return refuse("pinned endpoints are outside preview-1");
  const managed = managedRefusal(
    SERVICE_MANAGED_DEPENDENCY,
    change.before?.resource.properties as Readonly<Record<string, unknown>> | undefined,
    properties,
  );
  if (managed) return managed;
  const { source, target } = resource;
  if (source === target) return refuse("a self-Link is refused");
  if (!isIssueBead(change.read(source)))
    return refuse("the source must be a live in-Scope Bead conforming to issue", "/source");
  const type = referenceUri(resource.type);
  if (target.startsWith(scope)) {
    if (!isIssueBead(change.read(target)))
      return refuse("an in-Scope target must be a live Bead conforming to issue", "/target");
  } else if (type === `${DEPENDENCY}parent-child`)
    return refuse("`parent-child` refuses an external target", "/target");
  const others = change
    .links()
    .filter((link) => link.id !== resource.id && DEPENDENCY_TYPES.has(referenceUri(link.type)));
  const occupying = others.find(
    (link) => referenceUri(link.source) === source && referenceUri(link.target) === target,
  );
  if (occupying)
    return refuse(`this ordered pair already holds ${occupying.id}`, undefined, {
      occupyingLink: occupying.id,
    });
  if (CYCLIC_KINDS.has(type)) {
    const next = new Map<string, string[]>();
    for (const link of others)
      if (CYCLIC_KINDS.has(referenceUri(link.type)))
        next.set(referenceUri(link.source), [
          ...(next.get(referenceUri(link.source)) ?? []),
          referenceUri(link.target),
        ]);
    const stack = [target];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const at = stack.pop() as string;
      if (at === source)
        return refuse("this Link would close a cycle", undefined, { reason: "dependency-cycle" });
      if (!seen.has(at)) {
        seen.add(at);
        stack.push(...(next.get(at) ?? []));
      }
    }
  }
  return undefined;
}

export function issueScopePolicy(scope: string): ScopePolicy {
  return {
    id: "issue-dependency-preview-1",
    admit(change) {
      const pinned = typeof change.after.resource.type !== "string";
      const type = referenceUri(change.after.resource.type);
      const issue = type === ABSTRACT_ISSUE || ISSUE_TYPES.has(type);
      const dependency = type === ABSTRACT_DEPENDENCY || DEPENDENCY_TYPES.has(type);
      if (!issue && !dependency) {
        if (type.startsWith(ISSUE) || type.startsWith(DEPENDENCY))
          return refuse("this classification has no identity in the package's table", "/type");
        return undefined;
      }
      if (type === ABSTRACT_ISSUE || type === ABSTRACT_DEPENDENCY)
        return refuse("an abstract Type admits no direct affiliation", "/type");
      if (pinned) return refuse("a pinned affiliation is outside this fixed catalog", "/type");
      if (issue !== (change.after.kind === "bead"))
        return refuse("this Type describes the other Resource kind", "/type");
      return issue ? issueRefusal(change) : dependencyRefusal(change, scope);
    },
    stamp(change, time) {
      const type = referenceUri(change.after.resource.type);
      const properties = change.after.resource.properties as JsonObject;
      if (ISSUE_TYPES.has(type))
        return {
          ...properties,
          created_at:
            (change.before?.resource.properties as JsonObject | undefined)?.created_at ?? time,
          updated_at: time,
        } as JsonObject;
      if (DEPENDENCY_TYPES.has(type))
        return {
          ...properties,
          created_at:
            (change.before?.resource.properties as JsonObject | undefined)?.created_at ?? time,
        } as JsonObject;
      return undefined;
    },
  };
}

/** Issue §8: this fixed family, for these identities and their children, under Core. */
export function issueConformsTo(family: string, type: string): boolean | undefined {
  if (family === ABSTRACT_ISSUE) return ISSUE_TYPES.has(type) || type === family;
  if (family === ABSTRACT_DEPENDENCY) return DEPENDENCY_TYPES.has(type) || type === family;
  if (ISSUE_TYPES.has(family) || DEPENDENCY_TYPES.has(family)) return type === family;
  return undefined;
}
