import { readFileSync } from "node:fs";

import {
  isProtocolProfile,
  PROTOCOL_PROFILES,
  type ProtocolProfile,
  parseCanonicalScope,
} from "@bdp/protocol";

export type { ProtocolProfile } from "@bdp/protocol";

export type Mode = "local-test" | "production";

/** Report formats a future conformance runner will emit. */
export type ReportFormat = "json" | "text";
const REPORT_FORMATS: readonly ReportFormat[] = ["json", "text"];

/**
 * Every role resolves the same shared contract. A role only narrows what may be
 * left to a default; it never adds a field or a separate schema. Structural
 * validation of the file — top-level section names and nested field names — is
 * always global, so a shape mistake stays loud in every role. Content
 * validation (grammars, ranges, enums) is role-owned: `ROLE_SECTIONS` records
 * which sections a role actually reads, and the loader defers content checks
 * for the rest so that an unrelated section's value cannot block an executable
 * that does not consume it.
 */
export type Role = "bdp" | "bdptest" | "bdpbd" | "conformance";

export interface ServerReadLimitsConfig {
  readonly page: {
    readonly defaultItems: number;
    readonly maximumItems: number;
  };
  readonly selector: {
    readonly bytes: number;
    readonly depth: number;
    readonly nodes: number;
  };
  readonly cursorTtlMilliseconds: number;
}

/** Public defaults used by both shipping server compositions and conformance. */
export const DEFAULT_SERVER_READ_LIMITS: ServerReadLimitsConfig = Object.freeze({
  page: Object.freeze({ defaultItems: 50, maximumItems: 200 }),
  selector: Object.freeze({ bytes: 16_384, depth: 32, nodes: 256 }),
  cursorTtlMilliseconds: 300_000,
});

/** Public safety ceilings for operator-configurable server Read limits. */
export const MAXIMUM_SERVER_READ_LIMITS: ServerReadLimitsConfig = Object.freeze({
  page: Object.freeze({ defaultItems: 1_000, maximumItems: 10_000 }),
  selector: Object.freeze({ bytes: 65_536, depth: 128, nodes: 4_096 }),
  cursorTtlMilliseconds: 86_400_000,
});

/**
 * The full shared contract, as it appears when no role is passed. Each
 * role-specific view below is a `Pick` of these same section types, so the
 * shape stays coherent across roles.
 */
export interface StartupConfig {
  readonly mode: Mode;
  readonly scope: { readonly url: string };
  readonly auth: { readonly token?: string };
  readonly server: {
    readonly host: string;
    readonly port: number;
    readonly advertisedProfile?: ProtocolProfile;
    readonly limits: ServerReadLimitsConfig;
    /**
     * Conformance launch flag: the one absolute resource URL whose read must
     * fail with a private internal fault. Composition roots wrap their Scope
     * port with a faulting proxy when this is set. It configures diagnostics
     * only and grants nothing: admission, profiles, and every other route are
     * untouched, and the injected detail never crosses the wire.
     */
    readonly internalFaultResource?: string;
  };
  readonly bd: { readonly executable: string; readonly workspace?: string };
  readonly bdptest: { readonly fixture?: string };
  readonly conformance: {
    readonly profile: ProtocolProfile;
    readonly scenarioFilter?: string;
    readonly seed: number;
    readonly reportFormat: ReportFormat;
  };
}

export type BdpStartupConfig = Pick<StartupConfig, "mode" | "scope" | "auth">;
export type BdptestStartupConfig = Pick<StartupConfig, "mode" | "scope" | "server" | "bdptest">;
export type BdpbdStartupConfig = Pick<StartupConfig, "mode" | "scope" | "server" | "bd">;
export type ConformanceStartupConfig = Pick<
  StartupConfig,
  "mode" | "scope" | "auth" | "conformance"
>;

export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(`invalid startup configuration (${issues.length} issue(s))`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const DEFAULT_PAGE_ITEMS = DEFAULT_SERVER_READ_LIMITS.page.defaultItems;
const DEFAULT_MAXIMUM_PAGE_ITEMS = DEFAULT_SERVER_READ_LIMITS.page.maximumItems;
const SELECTOR_BYTES = DEFAULT_SERVER_READ_LIMITS.selector.bytes;
const SELECTOR_DEPTH = DEFAULT_SERVER_READ_LIMITS.selector.depth;
const SELECTOR_NODES = DEFAULT_SERVER_READ_LIMITS.selector.nodes;
const CURSOR_TTL_MILLISECONDS = DEFAULT_SERVER_READ_LIMITS.cursorTtlMilliseconds;

/** Reserved first path segment. Production refuses it on any host. */
const LOCAL_TEST_SEGMENT = "local-test";

/** The local-test Scope URL under the default host and port. */
export const LOCAL_TEST_SCOPE_URL = localTestScopeUrl(DEFAULT_HOST, DEFAULT_PORT);
export const REDACTED = "<redacted>";

const FIELDS = [
  "mode",
  "scope.url",
  "auth.token",
  "server.host",
  "server.port",
  "server.advertisedProfile",
  "server.limits.page.defaultItems",
  "server.limits.page.maximumItems",
  "server.limits.selector.bytes",
  "server.limits.selector.depth",
  "server.limits.selector.nodes",
  "server.limits.cursorTtlMilliseconds",
  "server.internalFaultResource",
  "bd.executable",
  "bd.workspace",
  "bdptest.fixture",
  "conformance.profile",
  "conformance.scenarioFilter",
  "conformance.seed",
  "conformance.reportFormat",
] as const;

type Field = (typeof FIELDS)[number];
type Section = "scope" | "auth" | "server" | "bd" | "bdptest" | "conformance";

const ENV_VARIABLE: Record<Field, string> = {
  mode: "BDP_MODE",
  "scope.url": "BDP_SCOPE_URL",
  "auth.token": "BDP_AUTH_TOKEN",
  "server.host": "BDP_SERVER_HOST",
  "server.port": "BDP_SERVER_PORT",
  "server.advertisedProfile": "BDP_SERVER_ADVERTISED_PROFILE",
  "server.limits.page.defaultItems": "BDP_SERVER_PAGE_DEFAULT_ITEMS",
  "server.limits.page.maximumItems": "BDP_SERVER_PAGE_MAXIMUM_ITEMS",
  "server.limits.selector.bytes": "BDP_SERVER_SELECTOR_BYTES",
  "server.limits.selector.depth": "BDP_SERVER_SELECTOR_DEPTH",
  "server.limits.selector.nodes": "BDP_SERVER_SELECTOR_NODES",
  "server.limits.cursorTtlMilliseconds": "BDP_SERVER_CURSOR_TTL_MILLISECONDS",
  "server.internalFaultResource": "BDP_SERVER_INTERNAL_FAULT_RESOURCE",
  "bd.executable": "BDP_BD_EXECUTABLE",
  "bd.workspace": "BDP_BD_WORKSPACE",
  "bdptest.fixture": "BDP_BDPTEST_FIXTURE",
  "conformance.profile": "BDP_CONFORMANCE_PROFILE",
  "conformance.scenarioFilter": "BDP_CONFORMANCE_SCENARIO_FILTER",
  "conformance.seed": "BDP_CONFORMANCE_SEED",
  "conformance.reportFormat": "BDP_CONFORMANCE_REPORT_FORMAT",
};

const KNOWN_SECTIONS: ReadonlySet<Section> = new Set<Section>([
  "scope",
  "auth",
  "server",
  "bd",
  "bdptest",
  "conformance",
]);
const FIELD_SET = new Set<string>(FIELDS);

/**
 * Which sections each role actually reads. Sections outside this set are
 * silently ignored for that role: file values in those sections are stored
 * unvalidated (their content is never checked and never appears in the
 * returned view), and env values are not consulted — with one field-level
 * exception. When a role does not own `server` but is going to derive the
 * local-test Scope URL (mode is `local-test` and `scope.url` is absent),
 * `server.host` and `server.port` are still read from every source so all
 * roles agree on the derived identity; see `loadStartupConfig` for the
 * dependency. Structural vocabulary — unknown top-level sections and unknown
 * nested field names — is validated globally by the file parser, so a typo
 * like `bdptest.fixtre` cannot hide under an unrelated role. See "Loudness"
 * in `docs/design/startup-configuration.md` for the split.
 */
const ROLE_SECTIONS: Record<Role, ReadonlySet<Section>> = {
  bdp: new Set<Section>(["scope", "auth"]),
  bdptest: new Set<Section>(["scope", "server", "bdptest"]),
  bdpbd: new Set<Section>(["scope", "server", "bd"]),
  conformance: new Set<Section>(["scope", "auth", "conformance"]),
};

export interface ParsedConfigArgs {
  readonly configFile: string | undefined;
  readonly rest: readonly string[];
  readonly errors: readonly string[];
}

/** Split `--config <path>` out of an argv slice, leaving every other argument untouched. */
export function parseConfigArgs(argv: readonly string[]): ParsedConfigArgs {
  const rest: string[] = [];
  const errors: string[] = [];
  let configFile: string | undefined;
  let seen = false;

  const assign = (value: string): void => {
    if (value === "") errors.push("--config requires a non-empty path");
    else if (seen) errors.push("--config may be given only once");
    else {
      configFile = value;
      seen = true;
    }
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--config") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) errors.push("--config requires a path");
      else {
        assign(value);
        index += 1;
      }
    } else if (argument.startsWith("--config=")) {
      assign(argument.slice("--config=".length));
    } else {
      rest.push(argument);
    }
  }

  return { configFile, rest, errors };
}

export interface LoadOptions {
  readonly configFile?: string | undefined;
  readonly env: NodeJS.ProcessEnv;
  readonly readFile?: (path: string) => string;
  /**
   * Restricts validation and output to sections the role reads. Omitting it
   * loads the full shared contract, which is the test seam that proves every
   * field parses coherently in isolation.
   */
  readonly role?: Role;
}

/**
 * Resolve startup configuration from environment variables, then an optional JSON
 * file, then compiled-in local-test defaults. Precedence and names are pinned in
 * docs/design/startup-configuration.md.
 *
 * When a role is supplied, only the sections that role owns are *validated for
 * content* and *emitted*. But structural vocabulary (top-level sections and
 * nested field names) is validated globally by the file parser, so a nested
 * typo like `{"bdptest":{"fixtre":"x"}}` is still surfaced when loading as
 * `bdp`. A single field-level dependency exists: `server.host` and
 * `server.port` are consulted by *any* role when they contribute to the
 * derived local-test Scope URL — otherwise a shared local-test configuration
 * where the port is `9000` would let `bdptest` derive port 9000 while `bdp`
 * dialed port 8080, breaking the one-identity contract.
 */
export function loadStartupConfig(options: LoadOptions & { role: "bdp" }): BdpStartupConfig;
export function loadStartupConfig(options: LoadOptions & { role: "bdptest" }): BdptestStartupConfig;
export function loadStartupConfig(options: LoadOptions & { role: "bdpbd" }): BdpbdStartupConfig;
export function loadStartupConfig(
  options: LoadOptions & { role: "conformance" },
): ConformanceStartupConfig;
export function loadStartupConfig(options: LoadOptions & { role?: undefined }): StartupConfig;
export function loadStartupConfig(
  options: LoadOptions,
):
  | StartupConfig
  | BdpStartupConfig
  | BdptestStartupConfig
  | BdpbdStartupConfig
  | ConformanceStartupConfig {
  const activeSections: ReadonlySet<Section> =
    options.role === undefined ? KNOWN_SECTIONS : ROLE_SECTIONS[options.role];

  const issues: ConfigIssue[] = [];
  const configFile = selectConfigFile(options, issues);
  // Structural vocabulary validation is global; content validation is
  // deferred to the per-field consumption below.
  const fromFile =
    configFile === undefined
      ? new Map<Field, unknown>()
      : readConfigFile(configFile, options.readFile ?? defaultReadFile, issues);

  const rawRead = (field: Field): { value: unknown; explicit: boolean } => {
    const fromEnv = options.env[ENV_VARIABLE[field]];
    if (fromEnv !== undefined) return { value: fromEnv, explicit: true };
    if (fromFile.has(field)) return { value: fromFile.get(field), explicit: true };
    return { value: undefined, explicit: false };
  };

  // Every role consumes `mode` and `scope.url`. We read them first because the
  // derivation rule below depends on both.
  const mode = readMode(rawRead("mode").value, issues);
  const scopeUrl = rawRead("scope.url");
  const scopeExplicit = scopeUrl.explicit;

  const serverOwned = activeSections.has("server");
  // Field-level dependency: `server.host` and `server.port` are shared inputs
  // to the derived local-test Scope URL. Whenever that derivation is going to
  // fire, every role must consult them so all four role views resolve to the
  // same Scope. When `scope.url` is explicit, the derivation is skipped and
  // non-server roles ignore host/port entirely, preserving role isolation.
  const hostPortConsulted = serverOwned || (!scopeExplicit && mode === "local-test");
  const host = hostPortConsulted ? readHost(rawRead("server.host").value, issues) : DEFAULT_HOST;
  const port = hostPortConsulted ? readPort(rawRead("server.port").value, issues) : DEFAULT_PORT;

  // `server.advertisedProfile` is server-only: an invalid value in a
  // non-server role's environment must not block startup.
  const advertisedProfile = serverOwned
    ? readOptionalProfile(rawRead("server.advertisedProfile").value, issues)
    : undefined;
  const pageDefaultItems = serverOwned
    ? readBoundedPositiveInteger(
        "server.limits.page.defaultItems",
        rawRead("server.limits.page.defaultItems").value,
        DEFAULT_PAGE_ITEMS,
        MAXIMUM_SERVER_READ_LIMITS.page.defaultItems,
        issues,
      )
    : DEFAULT_PAGE_ITEMS;
  const pageMaximumItems = serverOwned
    ? readBoundedPositiveInteger(
        "server.limits.page.maximumItems",
        rawRead("server.limits.page.maximumItems").value,
        DEFAULT_MAXIMUM_PAGE_ITEMS,
        MAXIMUM_SERVER_READ_LIMITS.page.maximumItems,
        issues,
      )
    : DEFAULT_MAXIMUM_PAGE_ITEMS;
  const selectorBytes = serverOwned
    ? readBoundedPositiveInteger(
        "server.limits.selector.bytes",
        rawRead("server.limits.selector.bytes").value,
        SELECTOR_BYTES,
        MAXIMUM_SERVER_READ_LIMITS.selector.bytes,
        issues,
      )
    : SELECTOR_BYTES;
  const selectorDepth = serverOwned
    ? readBoundedPositiveInteger(
        "server.limits.selector.depth",
        rawRead("server.limits.selector.depth").value,
        SELECTOR_DEPTH,
        MAXIMUM_SERVER_READ_LIMITS.selector.depth,
        issues,
      )
    : SELECTOR_DEPTH;
  const selectorNodes = serverOwned
    ? readBoundedPositiveInteger(
        "server.limits.selector.nodes",
        rawRead("server.limits.selector.nodes").value,
        SELECTOR_NODES,
        MAXIMUM_SERVER_READ_LIMITS.selector.nodes,
        issues,
      )
    : SELECTOR_NODES;
  const cursorTtlMilliseconds = serverOwned
    ? readBoundedPositiveInteger(
        "server.limits.cursorTtlMilliseconds",
        rawRead("server.limits.cursorTtlMilliseconds").value,
        CURSOR_TTL_MILLISECONDS,
        MAXIMUM_SERVER_READ_LIMITS.cursorTtlMilliseconds,
        issues,
      )
    : CURSOR_TTL_MILLISECONDS;

  const internalFaultResource = serverOwned
    ? readInternalFaultResource(rawRead("server.internalFaultResource").value, issues)
    : undefined;

  if (serverOwned && pageDefaultItems > pageMaximumItems) {
    issues.push({
      path: "server.limits.page",
      message: "server.limits.page.defaultItems must not exceed server.limits.page.maximumItems",
    });
  }

  const authOwned = activeSections.has("auth");
  const token = authOwned
    ? readOptionalString("auth.token", rawRead("auth.token").value, issues)
    : undefined;

  const bdOwned = activeSections.has("bd");
  const executable = bdOwned
    ? (readOptionalString("bd.executable", rawRead("bd.executable").value, issues) ?? "bd")
    : "bd";
  const workspace = bdOwned
    ? readOptionalString("bd.workspace", rawRead("bd.workspace").value, issues)
    : undefined;

  const bdptestOwned = activeSections.has("bdptest");
  const fixture = bdptestOwned ? readFixture(rawRead("bdptest.fixture").value, issues) : undefined;

  const conformanceOwned = activeSections.has("conformance");
  const conformanceProfile = conformanceOwned
    ? readEnum<ProtocolProfile>(
        "conformance.profile",
        rawRead("conformance.profile").value,
        PROTOCOL_PROFILES,
        isProtocolProfile,
        "read",
        issues,
      )
    : "read";
  const scenarioFilter = conformanceOwned
    ? readScenarioFilter(rawRead("conformance.scenarioFilter").value, issues)
    : undefined;
  const seed = conformanceOwned ? readSeed(rawRead("conformance.seed").value, issues) : 0;
  const reportFormat = conformanceOwned
    ? readEnum<ReportFormat>(
        "conformance.reportFormat",
        rawRead("conformance.reportFormat").value,
        REPORT_FORMATS,
        (value): value is ReportFormat =>
          typeof value === "string" && (REPORT_FORMATS as readonly string[]).includes(value),
        "json",
        issues,
      )
    : "json";

  // An absent local-test Scope URL is derived from the listener the process will
  // actually bind, so the advertised identity cannot drift from the address. The
  // derived value goes through the same validator as a supplied one: one function
  // decides what a Scope URL is, and a derived URL is not exempt from it.
  const url = readScopeUrl(scopeExplicit ? scopeUrl.value : localTestScopeUrl(host, port), issues);

  // A derived URL only means something if a client can dial it. A wildcard host is
  // every interface and none in particular, and port 0 is not chosen until listen,
  // so neither can be advertised as an identity.
  if (!scopeExplicit) {
    const undialable = isWildcardHost(host)
      ? "server.host is a wildcard address"
      : port === 0
        ? "server.port is 0"
        : undefined;
    if (undialable !== undefined) {
      issues.push({
        path: "scope.url",
        message: `${ENV_VARIABLE["scope.url"]} must be set explicitly when ${undialable}, because the derived local-test URL would not be dialable`,
      });
    }
  }

  if (mode === "production") {
    if (!scopeExplicit) {
      issues.push({
        path: "scope.url",
        message: `production mode requires an explicit Scope URL via ${ENV_VARIABLE["scope.url"]} or a config file`,
      });
    } else if (url !== undefined && usesReservedLocalTestPath(url)) {
      issues.push({
        path: "scope.url",
        message: `scope.url must not use the reserved local-test path /${LOCAL_TEST_SEGMENT}/ in production mode`,
      });
    }
  }

  if (options.role === "bdpbd" && mode === "production" && workspace === undefined) {
    issues.push({
      path: "bd.workspace",
      message: `bdpbd in production mode requires an explicit bd workspace via ${ENV_VARIABLE["bd.workspace"]} or a config file`,
    });
  }

  // The fault flag exists for conformance generation only. A production server
  // that silently fails one configured resource is an outage wearing a test
  // harness, so the combination is refused like every other test-only
  // affordance rather than validated and honored.
  if (mode === "production" && internalFaultResource !== undefined) {
    issues.push({
      path: "server.internalFaultResource",
      message:
        "server.internalFaultResource is a conformance launch flag and is refused in production mode",
    });
  }

  // `url` is undefined only when readScopeUrl recorded why, so `issues` is non-empty.
  if (url === undefined || issues.length > 0) throw new ConfigError(issues);

  const authSection = token === undefined ? {} : { token };
  const limits: ServerReadLimitsConfig = {
    page: { defaultItems: pageDefaultItems, maximumItems: pageMaximumItems },
    selector: { bytes: selectorBytes, depth: selectorDepth, nodes: selectorNodes },
    cursorTtlMilliseconds,
  };
  const serverSection = {
    host,
    port,
    ...(advertisedProfile === undefined ? {} : { advertisedProfile }),
    limits,
    ...(internalFaultResource === undefined ? {} : { internalFaultResource }),
  };
  const bdSection = workspace === undefined ? { executable } : { executable, workspace };
  const bdptestSection = fixture === undefined ? {} : { fixture };
  const conformanceSection = {
    profile: conformanceProfile,
    ...(scenarioFilter === undefined ? {} : { scenarioFilter }),
    seed,
    reportFormat,
  };

  const result: Record<string, unknown> = { mode, scope: { url } };
  if (authOwned) result.auth = authSection;
  if (serverOwned) result.server = serverSection;
  if (bdOwned) result.bd = bdSection;
  if (bdptestOwned) result.bdptest = bdptestSection;
  if (conformanceOwned) result.conformance = conformanceSection;
  // The concrete role views omit sections; the overload signature above narrows
  // the caller-visible type back to the exact view for each role. Every branch
  // above populates precisely the sections the role owns.
  return result as unknown as StartupConfig;
}

function defaultReadFile(path: string): string {
  return readFileSync(path, "utf8");
}

function selectConfigFile(options: LoadOptions, issues: ConfigIssue[]): string | undefined {
  if (options.configFile !== undefined) return options.configFile;
  const fromEnv = options.env.BDP_CONFIG;
  if (fromEnv === undefined) return undefined;
  if (fromEnv === "") {
    issues.push({ path: "BDP_CONFIG", message: "BDP_CONFIG must not be empty when it is set" });
    return undefined;
  }
  return fromEnv;
}

/** Bracket a bare IPv6 literal so the authority is parseable. */
function toAuthorityHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function localTestScopeUrl(host: string, port: number): string {
  return new URL(`http://${toAuthorityHost(host)}:${port}/${LOCAL_TEST_SEGMENT}/`).href;
}

function usesReservedLocalTestPath(url: string): boolean {
  return new URL(url).pathname.startsWith(`/${LOCAL_TEST_SEGMENT}/`);
}

/**
 * Parse a config file and return every known field's raw value.
 *
 * Structural vocabulary — top-level section names and nested field names —
 * is validated globally regardless of role. A typo like `scope.uri` or
 * `bdptest.fixtre` is always surfaced, because it is a mistake in the file's
 * *shape*, not a role-specific value that another deployment might legitimately
 * consume. Content validation (grammars, ranges, enums) is deferred to the
 * loader, which only enforces it for fields the active role actually consumes.
 * That split is what lets one shared config file serve every role: a valid
 * `bdptest.fixture` that fails only its content check under `bdp` is silently
 * ignored, while a `bdptest.fixtre` typo remains loud everywhere.
 */
function readConfigFile(
  path: string,
  readFile: (path: string) => string,
  issues: ConfigIssue[],
): Map<Field, unknown> {
  const values = new Map<Field, unknown>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFile(path));
  } catch (cause) {
    issues.push({
      path: "--config",
      message: `could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
    return values;
  }

  if (!isPlainObject(parsed)) {
    issues.push({ path: "--config", message: `${path} must contain a JSON object` });
    return values;
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (key === "mode") {
      values.set("mode", value);
    } else if (!(KNOWN_SECTIONS as ReadonlySet<string>).has(key)) {
      issues.push({ path: key, message: `unknown configuration key ${key}` });
    } else if (!isPlainObject(value)) {
      issues.push({ path: key, message: `${key} must be a JSON object` });
    } else {
      readConfigSection(key, value, values, issues);
    }
  }

  return values;
}

function readConfigSection(
  prefix: string,
  value: Record<string, unknown>,
  values: Map<Field, unknown>,
  issues: ConfigIssue[],
): void {
  for (const [nested, nestedValue] of Object.entries(value)) {
    const field = `${prefix}.${nested}`;
    if (FIELD_SET.has(field)) {
      values.set(field as Field, nestedValue);
      continue;
    }
    const hasNestedFields = FIELDS.some((candidate) => candidate.startsWith(`${field}.`));
    if (hasNestedFields && isPlainObject(nestedValue)) {
      readConfigSection(field, nestedValue, values, issues);
      continue;
    }
    if (hasNestedFields) {
      issues.push({ path: field, message: `${field} must be a JSON object` });
    } else {
      issues.push({ path: field, message: `unknown configuration key ${field}` });
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMode(value: unknown, issues: ConfigIssue[]): Mode {
  if (value === undefined) return "local-test";
  if (value === "local-test" || value === "production") return value;
  issues.push({ path: "mode", message: "mode must be 'local-test' or 'production'" });
  return "local-test";
}

function readOptionalString(
  path: Field,
  value: unknown,
  issues: ConfigIssue[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.length > 0) return value;
  issues.push({ path, message: `${path} must be a non-empty string` });
  return undefined;
}

const POSITIVE_INTEGER_SPELLING = /^[1-9]\d*$/;

function readBoundedPositiveInteger(
  path: Field,
  value: unknown,
  fallback: number,
  maximum: number,
  issues: ConfigIssue[],
): number {
  if (value === undefined) return fallback;
  if (typeof value === "string") {
    if (POSITIVE_INTEGER_SPELLING.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed <= maximum) return parsed;
    }
    issues.push({
      path,
      message: `${path} written as text must be a canonical integer in 1..${maximum}`,
    });
    return fallback;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum)
    return value;
  issues.push({ path, message: `${path} must be an integer in 1..${maximum}` });
  return fallback;
}

/**
 * Enum choices are all short, non-secret vocabulary tokens, so a refusal names
 * the accepted alternatives. The refused value is not echoed: `BDP_*` variables
 * are printed on startup, and a fat-fingered environment can put a credential in
 * any of them.
 */
function readEnum<T extends string>(
  path: Field,
  value: unknown,
  accepted: readonly T[],
  isMember: (value: unknown) => value is T,
  fallback: T,
  issues: ConfigIssue[],
): T {
  if (value === undefined) return fallback;
  if (isMember(value)) return value;
  issues.push({
    path,
    message: `${path} must be one of ${accepted.map((choice) => `'${choice}'`).join(", ")}`,
  });
  return fallback;
}

/**
 * `server.advertisedProfile` deliberately has no default: silently defaulting
 * to `read` would let a server claim a profile the operator never asked for.
 * The server admission boundary requires an explicit value and established
 * cumulative capability before binding; config only stores and emits intent.
 */
function readOptionalProfile(value: unknown, issues: ConfigIssue[]): ProtocolProfile | undefined {
  if (value === undefined) return undefined;
  if (isProtocolProfile(value)) return value;
  issues.push({
    path: "server.advertisedProfile",
    message: `server.advertisedProfile must be one of ${PROTOCOL_PROFILES.map((choice) => `'${choice}'`).join(", ")}`,
  });
  return undefined;
}

/**
 * A fixture identifier is stored, not resolved: `@bdp/config` never touches the
 * filesystem for it. The grammar is a stable, implementation-only identifier —
 * 1..128 ASCII characters matching `^[A-Za-z0-9][A-Za-z0-9._-]*$`. It excludes
 * whitespace, path separators, and `..` traversal, so a mistyped identifier
 * cannot silently resolve to a different fixture at load time. It is not a
 * wire decision; a future fixture engine remains free to add richer selectors.
 */
const FIXTURE_GRAMMAR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FIXTURE_MAX_LENGTH = 128;

function readFixture(value: unknown, issues: ConfigIssue[]): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= FIXTURE_MAX_LENGTH &&
    FIXTURE_GRAMMAR.test(value)
  ) {
    return value;
  }
  issues.push({
    path: "bdptest.fixture",
    message: "bdptest.fixture must be 1..128 ASCII characters matching [A-Za-z0-9][A-Za-z0-9._-]*",
  });
  return undefined;
}

/** The conformance launch flag's grammar; the composition roots enforce the behavior. */
function readInternalFaultResource(value: unknown, issues: ConfigIssue[]): string | undefined {
  if (value === undefined) return undefined;
  const push = (): void => {
    issues.push({
      path: "server.internalFaultResource",
      message:
        "server.internalFaultResource must be a canonical absolute HTTP(S) URL without credentials, query, or fragment",
    });
  };
  if (typeof value !== "string" || value.length === 0 || !URL.canParse(value)) {
    push();
    return undefined;
  }
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.href !== value
  ) {
    push();
    return undefined;
  }
  return value;
}

/**
 * The scenario filter is a case-sensitive substring matched against a
 * scenario's stable identifier, and nothing else. It is not a glob, not a
 * regex, and never examines title or tags. Absent means "every scenario in the
 * selected profile"; an empty string is refused because it would match
 * everything without the operator meaning to; zero matches at runtime is a
 * runner error, so the field's contract stays deterministic. `@bdp/config`
 * only stores the value; the future runner enforces the match.
 */
function readScenarioFilter(value: unknown, issues: ConfigIssue[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.length > 0) return value;
  issues.push({
    path: "conformance.scenarioFilter",
    message:
      "conformance.scenarioFilter must be a non-empty case-sensitive substring of a scenario identifier",
  });
  return undefined;
}

/**
 * The seed follows the same split rule as `server.port`: a string keeps its
 * spelling and is held to canonical decimal form, while a JSON number has
 * already lost its spelling and is judged only as a value. The upper bound is
 * `Number.MAX_SAFE_INTEGER` — anything larger cannot be represented losslessly
 * in JavaScript, and a "seed" that silently rounds is worse than no seed at
 * all.
 */
function readSeed(value: unknown, issues: ConfigIssue[]): number {
  const bound = `0..${Number.MAX_SAFE_INTEGER}`;
  if (value === undefined) return 0;
  if (typeof value === "string") {
    if (PORT_SPELLING.test(value)) {
      const parsed = Number(value);
      if (isValidSeedNumber(parsed)) return parsed;
    }
    issues.push({
      path: "conformance.seed",
      message: `conformance.seed written as text must be a canonical decimal integer ${bound}`,
    });
    return 0;
  }
  if (typeof value === "number" && isValidSeedNumber(value)) return value;
  issues.push({
    path: "conformance.seed",
    message: `conformance.seed must be an integer ${bound}`,
  });
  return 0;
}

function isValidSeedNumber(seed: number): boolean {
  return Number.isInteger(seed) && seed >= 0 && seed <= Number.MAX_SAFE_INTEGER;
}

/** ASCII tab, LF, and CR are deleted from the input by the URL parser rather than
 * refused, so a host carrying them would pass every check below and then be dialed
 * as a different name. */
const STRIPPED_BY_URL_PARSER = /[\t\n\r]/;

/**
 * `server.host` names a listener address and nothing else. Parsing it as a URL is
 * not by itself a check: userinfo, a port, a path, a query, and a fragment all
 * parse happily, they just land in some *other* component. So every other
 * component has to come back empty. A malformed IPv6 literal fails the parse
 * outright, and a valid-but-uncompressed one — `0:0:0:0:0:0:0:0` — is a legitimate
 * address that is accepted and left to `URL` to canonicalize downstream.
 *
 * The message never echoes the value. Host and Scope URL are both printed on
 * startup, and a fat-fingered environment can put a credential in either one.
 */
function readHost(value: unknown, issues: ConfigIssue[]): string {
  const host = readOptionalString("server.host", value, issues) ?? DEFAULT_HOST;
  const refuse = (): string => {
    issues.push({
      path: "server.host",
      message:
        "server.host must be a bare host name, IP address, or bracketed IPv6 literal, with no scheme, credentials, port, path, query, or fragment",
    });
    return DEFAULT_HOST;
  };

  if (STRIPPED_BY_URL_PARSER.test(host)) return refuse();

  let parsed: URL;
  try {
    parsed = new URL(`http://${toAuthorityHost(host)}/`);
  } catch {
    return refuse();
  }

  const hostOnly =
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "";
  return hostOnly ? host : refuse();
}

/** Wildcards as `URL` canonicalizes them: `0`, `::0`, and `0:0:0:0:0:0:0:0` all land here. */
const WILDCARD_HOSTS = new Set(["0.0.0.0", "[::]"]);

function isWildcardHost(host: string): boolean {
  return WILDCARD_HOSTS.has(new URL(`http://${toAuthorityHost(host)}/`).hostname);
}

// Decimal only: no whitespace, sign, radix prefix, exponent, or leading zero.
const PORT_SPELLING = /^(?:0|[1-9]\d*)$/;

/**
 * How the port arrived decides what is left to check. A string still carries its
 * spelling, so it is held to one canonical form: `08080`, `+8080`, `0x1f90`, and
 * `8e3` are all refused even though `Number` would accept them. Every environment
 * value is a string, so that is the rule the environment gets. A JSON number has
 * already been through a JSON parser, which erases spelling — `8e3` and `8000`
 * both arrive as the number 8000 and nothing downstream can tell them apart — so
 * it is judged only as a value.
 */
function readPort(value: unknown, issues: ConfigIssue[]): number {
  if (value === undefined) return DEFAULT_PORT;
  if (typeof value === "string") {
    if (PORT_SPELLING.test(value) && inPortRange(Number(value))) return Number(value);
    issues.push({
      path: "server.port",
      message: "server.port written as text must be a canonical decimal integer 0..65535",
    });
    return DEFAULT_PORT;
  }
  if (typeof value === "number" && inPortRange(value)) return value;
  issues.push({ path: "server.port", message: "server.port must be an integer 0..65535" });
  return DEFAULT_PORT;
}

function inPortRange(port: number): boolean {
  return Number.isInteger(port) && port >= 0 && port <= 65535;
}

/**
 * A Scope URL is the deployment's canonical identity, so it is stored in one
 * serialization: `URL` normalization plus a trailing slash, which makes relative
 * resolution against it unambiguous. Spelling differences a URL parser erases —
 * scheme and host case, a written-out default port — are normalized rather than
 * refused. Parts that would make two deployments disagree about identity, or that
 * carry a secret, are refused. Returns undefined once it has recorded why.
 *
 * No message echoes the value. A Scope URL that failed to parse is exactly the
 * case where it may not be a URL at all — a shell-mangled line, or a token pasted
 * into the wrong variable — and these issues are written to stderr on startup.
 */
function readScopeUrl(value: unknown, issues: ConfigIssue[]): string | undefined {
  const push = (message: string): void => {
    issues.push({ path: "scope.url", message });
  };
  if (typeof value !== "string" || value.length === 0) {
    push("scope.url must be a non-empty string");
    return undefined;
  }
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]+/.test(value)) {
    push("scope.url must be an absolute URL");
    return undefined;
  }

  const originalPath = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/.exec(value)?.[1];

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    push("scope.url must be an absolute URL");
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    push("scope.url must use http or https");
    return undefined;
  }
  if (
    originalPath !== undefined &&
    originalPath !== url.pathname &&
    !(originalPath === "" && url.pathname === "/")
  ) {
    push("scope.url must use canonical path encoding");
    return undefined;
  }

  let refused = false;
  if (url.username !== "" || url.password !== "") {
    push("scope.url must not embed credentials");
    refused = true;
  }
  if (url.search !== "" || url.hash !== "") {
    push("scope.url must not carry a query string or fragment");
    refused = true;
  }
  if (refused) return undefined;

  if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
  try {
    parseCanonicalScope(url.href);
  } catch {
    push("scope.url must use canonical path encoding");
    return undefined;
  }
  return url.href;
}

type MaybeAuthSection = { readonly auth?: { readonly token?: string } };

/**
 * Copy `config` with the bearer token replaced, for anything that leaves the
 * process. Accepts every role's view: server-only views have no `auth`
 * section, so they are returned unchanged.
 */
export function redactStartupConfig<C extends object>(config: C): C {
  const auth = (config as MaybeAuthSection).auth;
  if (auth?.token === undefined) return config;
  return { ...config, auth: { ...auth, token: REDACTED } };
}

export function formatStartupDiagnostic(config: object, executable: string): string {
  return `${JSON.stringify({
    level: "info",
    event: "startup.config",
    executable,
    config: redactStartupConfig(config),
  })}\n`;
}

export function formatConfigError(error: ConfigError, executable: string): string {
  return `${JSON.stringify({
    level: "error",
    event: "startup.config_error",
    executable,
    issues: error.issues,
  })}\n`;
}
