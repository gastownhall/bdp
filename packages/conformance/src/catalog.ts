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
const SCENARIO_KEYS = new Set(["id", "title", "kind", "requiredProfile", "requirements"]);
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

      const section = markdownSection(markdown, citation.anchor);
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

  if (
    !idValid ||
    title === undefined ||
    kind === undefined ||
    requiredProfile === undefined ||
    requirements === undefined
  ) {
    return undefined;
  }
  return { id, title, kind, requiredProfile, requirements };
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

function markdownSection(markdown: string, anchor: string): string | undefined {
  const target = anchor.slice(1);
  const visibleMarkdown = maskFencedCodeBlocks(markdown);
  const headings = [...visibleMarkdown.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)];
  const slugCounts = new Map<string, number>();
  for (const [index, heading] of headings.entries()) {
    const hashes = heading[1];
    const text = heading[2];
    if (hashes === undefined || text === undefined || heading.index === undefined) continue;
    const baseSlug = markdownAnchor(text);
    const duplicateIndex = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, duplicateIndex + 1);
    const slug = duplicateIndex === 0 ? baseSlug : `${baseSlug}-${duplicateIndex}`;
    if (slug !== target) continue;

    const level = hashes.length;
    const sectionStart = heading.index;
    let sectionEnd = markdown.length;
    for (const following of headings.slice(index + 1)) {
      if ((following[1]?.length ?? 7) <= level && following.index !== undefined) {
        sectionEnd = following.index;
        break;
      }
    }
    return markdown.slice(sectionStart, sectionEnd);
  }
  return undefined;
}

/**
 * Replace fenced-code content with spaces while retaining every original line
 * ending and code-unit offset. A closing fence must use the opening character
 * and contain at least as many markers.
 */
function maskFencedCodeBlocks(markdown: string): string {
  let result = "";
  let cursor = 0;
  let fenceCharacter: "`" | "~" | undefined;
  let minimumFenceLength = 0;

  while (cursor < markdown.length) {
    const newline = markdown.indexOf("\n", cursor);
    const lineEnd = newline < 0 ? markdown.length : newline + 1;
    const line = markdown.slice(cursor, lineEnd);
    const content = line.replace(/\r?\n$/, "");

    if (fenceCharacter === undefined) {
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(content)?.[1];
      if (opening === undefined) {
        result += line;
      } else {
        fenceCharacter = opening[0] as "`" | "~";
        minimumFenceLength = opening.length;
        result += maskLine(line);
      }
    } else {
      const closing = new RegExp(`^ {0,3}\\${fenceCharacter}{${minimumFenceLength},}[ \\t]*$`).test(
        content,
      );
      result += maskLine(line);
      if (closing) {
        fenceCharacter = undefined;
        minimumFenceLength = 0;
      }
    }
    cursor = lineEnd;
  }

  return result;
}

function maskLine(line: string): string {
  return line.replace(/[^\r\n]/g, " ");
}

function markdownAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/[ \t]+/g, "-");
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
