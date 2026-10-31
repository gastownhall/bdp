import { markdownSection } from "./markdown.js";
import { isProtocolProfile, type ProtocolProfile } from "@bdp/protocol";

/**
 * This is an implementation-artifact category, not a BDP wire value.
 * Normative entries may contribute to a conformance claim; diagnostic entries
 * exercise a harness or implementation without contributing to that claim.
 */
export type ScenarioKind = "normative" | "diagnostic";

export interface RequirementCitation {
  /** Repository-relative path to the Markdown source of the requirement. */
  readonly source: string;
  /** A Markdown heading fragment within `source`. */
  readonly anchor: string;
  /**
   * Evidence excerpt for review and reports. `source` plus `anchor` remains
   * authoritative; repository validation detects excerpt drift.
   */
  readonly selectedText: string;
}

export interface ScenarioMetadata {
  /** Stable lowercase identifier used by filtering and reports. */
  readonly id: string;
  readonly title: string;
  readonly kind: ScenarioKind;
  /** Lowest cumulative protocol profile to which this scenario applies. */
  readonly requiredProfile: ProtocolProfile;
  readonly requirements: readonly RequirementCitation[];
  /**
   * The ids of lower-profile rows this row supersedes, when a higher profile
   * contradicts an obligation a lower profile binds. A claim that includes
   * this row's profile excludes every retired row, under `selection.ts`.
   * The retired rows live in their own profile's catalog; this member names
   * them and does not restate them.
   */
  readonly retires?: readonly string[];
}

/**
 * Metadata only. This catalog deliberately does not define eventual scenario
 * setup, requests, assertions, cleanup, or evidence collection.
 */
export interface ScenarioCatalog {
  /** Version of this non-normative metadata shape, not the BDP version. */
  readonly catalogVersion: 1;
  readonly scenarios: readonly ScenarioMetadata[];
}

export interface CatalogIssue {
  readonly path: string;
  readonly message: string;
}

export class CatalogValidationError extends Error {
  readonly issues: readonly CatalogIssue[];

  constructor(issues: readonly CatalogIssue[], sourceLabel?: string) {
    super(
      `${sourceLabel === undefined ? "scenario catalog" : sourceLabel}: validation failed (${issues.length} issue(s))`,
    );
    this.name = "CatalogValidationError";
    this.issues = issues;
  }
}

/** Injected by repository tooling; the conformance package performs no file I/O. */
export type CitationSourceLoader = (source: string) => string | undefined;

const CATALOG_KEYS = new Set(["catalogVersion", "scenarios"]);
const SCENARIO_KEYS = new Set([
  "id",
  "title",
  "kind",
  "requiredProfile",
  "requirements",
  "retires",
]);
const CITATION_KEYS = new Set(["source", "anchor", "selectedText"]);
const SCENARIO_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SCENARIO_ID_MAX_LENGTH = 128;

/** Parse JSON and validate the complete metadata-catalog shape. */
export function loadScenarioCatalogJson(text: string, sourceLabel?: string): ScenarioCatalog {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "unknown JSON parse failure";
    throw new CatalogValidationError(
      [{ path: "$", message: `invalid JSON: ${detail}` }],
      sourceLabel,
    );
  }
  return parseScenarioCatalog(value, sourceLabel);
}

/** Validate an untrusted value and return a closed, copied metadata catalog. */
export function parseScenarioCatalog(value: unknown, sourceLabel?: string): ScenarioCatalog {
  const issues: CatalogIssue[] = [];
  if (!isPlainRecord(value)) {
    throw new CatalogValidationError(
      [{ path: "$", message: "must be a plain record" }],
      sourceLabel,
    );
  }

  reportUnknownKeys(value, CATALOG_KEYS, "$", issues);
  if (ownValue(value, "catalogVersion") !== 1) {
    issues.push({ path: "$.catalogVersion", message: "must equal 1" });
  }

  const scenarios: ScenarioMetadata[] = [];
  const ids = new Set<string>();
  const scenarioValues = ownValue(value, "scenarios");
  if (!Array.isArray(scenarioValues)) {
    issues.push({ path: "$.scenarios", message: "must be an array" });
  } else {
    for (const [index, candidate] of scenarioValues.entries()) {
      const scenario = parseScenario(candidate, `$.scenarios[${index}]`, issues);
      if (scenario === undefined) continue;
      if (ids.has(scenario.id)) {
        issues.push({
          path: `$.scenarios[${index}].id`,
          message: `scenario identifier '${scenario.id}' must be unique`,
        });
      } else {
        ids.add(scenario.id);
      }
      scenarios.push(scenario);
    }
  }

  if (issues.length > 0) throw new CatalogValidationError(issues, sourceLabel);
  return { catalogVersion: 1, scenarios };
}

/**
 * Validate citations against repository content supplied by the caller.
 * Whitespace differences do not create false drift, but wording differences do.
 */
export function validateCatalogCitations(
  catalog: ScenarioCatalog,
  loadSource: CitationSourceLoader,
  sourceLabel?: string,
): void {
  const issues: CatalogIssue[] = [];
  const sourceCache = new Map<string, string | undefined>();

  for (const [scenarioIndex, scenario] of catalog.scenarios.entries()) {
    for (const [citationIndex, citation] of scenario.requirements.entries()) {
      const path = `$.scenarios[${scenarioIndex}].requirements[${citationIndex}]`;
      let markdown = sourceCache.get(citation.source);
      if (!sourceCache.has(citation.source)) {
        markdown = loadSource(citation.source);
        sourceCache.set(citation.source, markdown);
      }
      if (markdown === undefined) {
        issues.push({ path: `${path}.source`, message: "source could not be loaded" });
        continue;
      }

      let section: string | undefined;
      try {
        section = markdownSection(markdown, citation.anchor);
      } catch (error) {
        issues.push({ path: `${path}.anchor`, message: String(error) });
        continue;
      }
      if (section === undefined) {
        issues.push({ path: `${path}.anchor`, message: "Markdown anchor was not found" });
        continue;
      }
      if (!normalizeWhitespace(section).includes(normalizeWhitespace(citation.selectedText))) {
        issues.push({
          path: `${path}.selectedText`,
          message: "excerpt does not appear in the anchored Markdown section",
        });
      }
    }
  }

  if (issues.length > 0) throw new CatalogValidationError(issues, sourceLabel);
}

function parseScenario(
  value: unknown,
  path: string,
  issues: CatalogIssue[],
): ScenarioMetadata | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: "must be a plain record" });
    return undefined;
  }
  reportUnknownKeys(value, SCENARIO_KEYS, path, issues);

  const id = readNonemptyString(ownValue(value, "id"), `${path}.id`, issues);
  const idValid = id !== undefined && id.length <= SCENARIO_ID_MAX_LENGTH && SCENARIO_ID.test(id);
  if (id !== undefined && !idValid) {
    issues.push({
      path: `${path}.id`,
      message:
        "must be 1..128 lowercase ASCII alphanumeric characters grouped into segments separated by '.' or '-'",
    });
  }
  const title = readNonemptyString(ownValue(value, "title"), `${path}.title`, issues);
  const kind = readKind(ownValue(value, "kind"), `${path}.kind`, issues);
  const requiredProfile = readProfile(
    ownValue(value, "requiredProfile"),
    `${path}.requiredProfile`,
    issues,
  );
  const requirements = readCitations(
    ownValue(value, "requirements"),
    `${path}.requirements`,
    issues,
  );
  const retires = readRetires(ownValue(value, "retires"), `${path}.retires`, id, issues);

  if (
    !idValid ||
    title === undefined ||
    kind === undefined ||
    requiredProfile === undefined ||
    requirements === undefined ||
    retires === undefined
  ) {
    return undefined;
  }
  return retires.length === 0
    ? { id, title, kind, requiredProfile, requirements }
    : { id, title, kind, requiredProfile, requirements, retires };
}

/**
 * An absent member reads as no retirement. A present member is a nonempty
 * array of unique scenario ids, none of them the row's own; whether each id
 * names a normative row of a lower profile is checked by selection against
 * the combined catalogs, since retired rows may live in another file.
 */
function readRetires(
  value: unknown,
  path: string,
  ownId: string | undefined,
  issues: CatalogIssue[],
): readonly string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: "must be a nonempty array of scenario identifiers" });
    return undefined;
  }
  const retired: string[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    const valid =
      typeof candidate === "string" &&
      candidate.length <= SCENARIO_ID_MAX_LENGTH &&
      SCENARIO_ID.test(candidate);
    if (!valid) {
      issues.push({ path: entryPath, message: "must be a scenario identifier" });
      continue;
    }
    if (candidate === ownId) {
      issues.push({ path: entryPath, message: "a scenario cannot retire itself" });
      continue;
    }
    if (seen.has(candidate)) {
      issues.push({ path: entryPath, message: `retired identifier '${candidate}' must be unique` });
      continue;
    }
    seen.add(candidate);
    retired.push(candidate);
  }
  return retired.length === value.length ? retired : undefined;
}

function readCitations(
  value: unknown,
  path: string,
  issues: CatalogIssue[],
): readonly RequirementCitation[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "must be an array" });
    return undefined;
  }
  if (value.length === 0) {
    issues.push({ path, message: "must contain at least one citation" });
    return undefined;
  }

  const citations: RequirementCitation[] = [];
  for (const [index, candidate] of value.entries()) {
    const citationPath = `${path}[${index}]`;
    if (!isPlainRecord(candidate)) {
      issues.push({ path: citationPath, message: "must be a plain record" });
      continue;
    }
    reportUnknownKeys(candidate, CITATION_KEYS, citationPath, issues);
    const source = readNonemptyString(
      ownValue(candidate, "source"),
      `${citationPath}.source`,
      issues,
    );
    const anchor = readNonemptyString(
      ownValue(candidate, "anchor"),
      `${citationPath}.anchor`,
      issues,
    );
    const selectedText = readNonemptyString(
      ownValue(candidate, "selectedText"),
      `${citationPath}.selectedText`,
      issues,
    );
    const anchorValid = anchor !== undefined && anchor.length > 1 && anchor.startsWith("#");
    if (anchor !== undefined && !anchorValid) {
      issues.push({
        path: `${citationPath}.anchor`,
        message: "must start with '#' and name an anchor",
      });
    }
    if (source !== undefined && anchorValid && selectedText !== undefined) {
      citations.push({ source, anchor, selectedText });
    }
  }
  return citations.length === value.length ? citations : undefined;
}

function readKind(value: unknown, path: string, issues: CatalogIssue[]): ScenarioKind | undefined {
  if (value === "normative" || value === "diagnostic") return value;
  issues.push({ path, message: "must be 'normative' or 'diagnostic'" });
  return undefined;
}

function readProfile(
  value: unknown,
  path: string,
  issues: CatalogIssue[],
): ProtocolProfile | undefined {
  if (isProtocolProfile(value)) return value;
  issues.push({ path, message: "must be 'read', 'read-update', or 'transactional'" });
  return undefined;
}

function readNonemptyString(
  value: unknown,
  path: string,
  issues: CatalogIssue[],
): string | undefined {
  if (typeof value === "string" && value.length > 0 && value.trim() === value) return value;
  issues.push({ path, message: "must be a non-empty string without surrounding whitespace" });
  return undefined;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function reportUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
  path: string,
  issues: CatalogIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!known.has(key)) issues.push({ path: memberPath(path, key), message: "unknown member" });
  }
}

function memberPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function ownValue(value: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
