/**
 * The Types BDP publishes under `https://github.com/gastownhall/bdp/types/`, by short name,
 * as far as this client knows them: the Issue and Dependency package (`specs/types/issue`),
 * the Callable Types and the type system. A client reads a short name against this table
 * first and the bound Scope's `types/` second, so nothing here is fetched, and the server
 * still judges every expansion.
 */
export const BDP_PUBLISHED_TYPES = "https://github.com/gastownhall/bdp/types/";

const ISSUE = [
  "issue",
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
];
const DEPENDENCY = [
  "dependency",
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
];
const CALLABLE = ["callable", "callable-query", "callable-batch"];
const TYPE_SYSTEM = [
  "type",
  "bead-type",
  "link-type",
  "refines",
  "bead-type-refines-type",
  "link-type-refines-type",
];

/** Short names, such as `issue/task`, of every Type in {@link BDP_PUBLISHED_TYPES}. */
export const BDP_PUBLISHED_TYPE_NAMES: ReadonlySet<string> = new Set([
  ...ISSUE.map((name) => `issue/${name}`),
  ...DEPENDENCY.map((name) => `dependency/${name}`),
  ...CALLABLE.map((name) => `callable/${name}`),
  ...TYPE_SYSTEM.map((name) => `type-system/${name}`),
]);
