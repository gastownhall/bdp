import { createHash } from "node:crypto";

import type { ScenarioCatalog } from "./catalog.js";
import type { ExecutableScenarioManifest } from "./executable-manifest.js";
import type { ConformanceRunResult, ScenarioRunResult } from "./runner.js";

/**
 * The reviewed two-target Read evidence cohort.
 *
 * This module is a *projection*, not a report. `ConformanceRunResult` carries
 * header values, response URLs and transport messages; none of those may reach a
 * checked-in artifact, so the cohort types below have no field capable of holding
 * them. Redaction is structural rather than a filter applied on the way out: a
 * later caller cannot widen it without changing these types, which is the point.
 */
export const READ_COHORT_ARTIFACT_VERSION = 1;

export const READ_COHORT_TARGETS = ["bdptest", "bdpbd"] as const;
export type ReadCohortTarget = (typeof READ_COHORT_TARGETS)[number];

/**
 * How the row under test was exercised.
 *
 * Recorded per row, not per target. Eight rows cannot be driven against a
 * packaged target — they mutate target state mid-run through a control channel
 * that exists only in test support — so the cohort is assembled from a packaged
 * run and a self-certified in-process run.
 *
 * A row may be `in-process` only if it is self-certifiable, and that set is
 * derived from the bound manifest rather than supplied. One rule then does two
 * jobs: it implements the split, and it refuses the bootstrap artifact
 * automatically, since the bootstrap's packaged-required rows are in-process.
 * Cherry-pick that commit and admission still fails closed.
 */
export const READ_COHORT_ADMISSIONS = ["in-process", "packaged"] as const;
export type ReadCohortAdmission = (typeof READ_COHORT_ADMISSIONS)[number];

const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const EVIDENCE_CONSTANT_HEX_LENGTH = 40;

/**
 * Header names admissible in the artifact. Only names are ever retained (D5), so
 * this list is a second barrier rather than the only one: it stops a target from
 * widening the artifact's vocabulary by inventing a header whose *name* encodes
 * instance identity. Derived from the headers the bound matrix actually asserts
 * on — request headers it sets, and response headers it reads.
 */
export const READ_COHORT_HEADER_NAME_ALLOWLIST: readonly string[] = Object.freeze([
  "accept",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "access-control-max-age",
  "access-control-request-method",
  "allow",
  "cache-control",
  "content-length",
  "content-type",
  "link",
  "origin",
  "x-bdp-conformance-epoch",
  "x-bdp-conformance-view",
]);

const ALLOWED_HEADER_NAMES = new Set(READ_COHORT_HEADER_NAME_ALLOWLIST);

/**
 * Every binding the cohort must pin. A run proves nothing unless the things that
 * produced it are named: the same 33 rows over a different payload, validator or
 * `bd` is a different experiment.
 */
export interface ReadCohortBindings {
  readonly catalog: string;
  readonly manifest: string;
  readonly fixture: string;
  readonly schema: string;
  readonly validator: string;
  readonly runner: string;
  readonly harness: string;
  readonly executor: string;
  /**
   * Packaged runs only. There is no installed payload, no launched target
   * process and no fixture workspace behind a test grant, so these are absent
   * rather than optional there -- a bootstrap run that supplied them would be
   * fabricating the very provenance the cohort exists to establish.
   */
  readonly installedPayload?: string;
  readonly targetProcess?: string;
  readonly workspace?: string;
  /** `bdpbd` only: the actual `bd` executable that served the run. */
  readonly bdExecutable?: string;
}

const ALWAYS_REQUIRED_BINDING_KEYS = Object.freeze([
  "catalog",
  "manifest",
  "fixture",
  "schema",
  "validator",
  "runner",
  "harness",
  "executor",
] as const satisfies readonly (keyof ReadCohortBindings)[]);

/** Meaningful only for a packaged run; forbidden on a test-granted one. */
const PACKAGED_ONLY_BINDING_KEYS = Object.freeze([
  "installedPayload",
  "targetProcess",
  "workspace",
] as const satisfies readonly (keyof ReadCohortBindings)[]);

/** D4: the exact `bd` identity `bdpbd` ran against. Any drift closes both targets. */
export interface BdIdentityPin {
  readonly version: string;
  readonly schemaVersion: number;
  readonly observationsDigest: string;
}

/**
 * D2: a variant the cohort deliberately does not cover, declared rather than left
 * implicit. Authoring an absent-variant scenario was ruled out; saying so in the
 * artifact is what keeps the gap honest.
 */
export interface ReadCohortUncoveredVariant {
  readonly scenarioId: string;
  readonly variant: string;
  readonly reason: string;
}

/** A single observed exchange, reduced to what D5 permits. */
export interface ReadCohortExchange {
  readonly requestId: string;
  readonly method: string;
  readonly requestHeaderNames: readonly string[];
  readonly status: number;
  readonly responseHeaderNames: readonly string[];
  readonly bodyKind: string;
  readonly decodedBodyBytes: number;
}

export interface ReadCohortScenario {
  readonly id: string;
  /** D1: `pass` is the only state a cohort member can carry. */
  readonly state: "pass";
  readonly admission: ReadCohortAdmission;
  readonly exchanges: readonly ReadCohortExchange[];
}

/** One run contributing rows to a target. */
export interface ReadCohortSegment {
  readonly admission: ReadCohortAdmission;
  readonly targetLabel: string;
  readonly scope: string;
  readonly profile: string;
  readonly seed: number;
  readonly bindings: ReadCohortBindings;
  readonly bdIdentity?: BdIdentityPin;
  readonly scenarios: readonly ReadCohortScenario[];
}

export interface ReadCohortNotApplicableRow {
  readonly scenarioId: string;
  /** The manifest applicability capabilities this target's fixture does not declare. */
  readonly missingCapabilities: readonly string[];
}

export interface ReadCohortTargetEntry {
  readonly target: ReadCohortTarget;
  /** D1: rendered as `N pass / M other`, never as a bare ratio. */
  readonly scores: { readonly pass: number; readonly other: number };
  /** Also rendered split, so a reader never has to infer how much was packaged. */
  readonly packagedRows: number;
  readonly selfCertifiedRows: number;
  /**
   * Rows honestly inapplicable to this target: the bound manifest gates them
   * on capabilities the target's bound fixture does not declare. Derived,
   * never supplied, and recomputable by the verifier from committed bytes.
   * Never counted as pass.
   */
  readonly notApplicable: readonly ReadCohortNotApplicableRow[];
  readonly segments: readonly ReadCohortSegment[];
}

export interface ReadCohortArtifact {
  readonly cohortVersion: typeof READ_COHORT_ARTIFACT_VERSION;
  readonly catalogId: string;
  /** Rows exercised in-process. Derived from the manifest, never supplied. */
  readonly selfCertified: readonly string[];
  /** The binding callout. Stated in the artifact so a reader cannot miss it. */
  readonly selfCertifiedNote: string;
  /** The reviewed run head. D3's verifier requires it to be an ancestor of `HEAD`. */
  readonly runHead: string;
  readonly requiredScenarioIds: readonly string[];
  readonly uncovered: readonly ReadCohortUncoveredVariant[];
  readonly targets: readonly ReadCohortTargetEntry[];
}

export class ReadCohortArtifactError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ReadCohortArtifactError";
  }
}

export interface ReadCohortTargetInput {
  readonly target: ReadCohortTarget;
  readonly run: ConformanceRunResult;
  readonly bindings: ReadCohortBindings;
  readonly bdIdentity?: BdIdentityPin;
  readonly admission: ReadCohortAdmission;
  /** The rows this run contributes. Their union per target must be the whole applicable set. */
  readonly rows: readonly string[];
  /** The bound fixture's declared capabilities, for the not-applicable derivation. */
  readonly capabilities: readonly string[];
}

export interface ReadCohortArtifactInput {
  /** The bound catalog. The required set is derived from it, never supplied. */
  readonly catalog: ScenarioCatalog;
  /** The bound manifest. The self-certifiable set is derived from it, never supplied. */
  readonly manifest: ExecutableScenarioManifest;
  readonly runHead: string;
  readonly uncovered: readonly ReadCohortUncoveredVariant[];
  readonly targets: readonly ReadCohortTargetInput[];
}

/**
 * Build the cohort artifact, or throw. Every failure here closes the cohort for
 * *both* targets by design: one cohort covers both, so a disagreement is not a
 * partial result to be recorded, it is an invalid experiment.
 */
export function createReadCohortArtifact(input: ReadCohortArtifactInput): ReadCohortArtifact {
  if (!COMMIT_SHA.test(input.runHead)) {
    throw new ReadCohortArtifactError("runHead must be a 40-hex commit sha");
  }

  const requiredScenarioIds = deriveReadCohortRequiredScenarioIds(input.catalog);
  const catalogId = `read-v${input.catalog.catalogVersion}`;

  const selfCertifiable = deriveReadCohortSelfCertifiableIds(input.manifest, requiredScenarioIds);

  for (const entry of input.targets) {
    if (!READ_COHORT_TARGETS.includes(entry.target)) {
      throw new ReadCohortArtifactError(`unknown cohort target '${entry.target}'`);
    }
  }

  const uncovered = normalizeUncovered(input.uncovered, requiredScenarioIds);

  const targets = READ_COHORT_TARGETS.map((target) => {
    const inputs = input.targets.filter((entry) => entry.target === target);
    if (inputs.length === 0) {
      throw new ReadCohortArtifactError(`cohort is missing required target '${target}'`);
    }
    const [firstInput, ...restInputs] = inputs;
    if (firstInput === undefined) {
      throw new ReadCohortArtifactError(`cohort is missing required target '${target}'`);
    }
    for (const entry of restInputs) {
      if (
        entry.capabilities.length !== firstInput.capabilities.length ||
        entry.capabilities.some((value, index) => value !== firstInput.capabilities[index])
      ) {
        throw new ReadCohortArtifactError(
          `target '${target}' runs disagree on the bound fixture's capabilities`,
        );
      }
    }
    const notApplicable = deriveReadCohortNotApplicableRows(
      input.manifest,
      requiredScenarioIds,
      firstInput.capabilities,
    );
    return projectTargetSegments(
      target,
      inputs,
      requiredScenarioIds,
      selfCertifiable,
      notApplicable,
    );
  });

  // One cohort, one experiment: every segment must agree on the catalog and
  // manifest that bound it. The fixture is deliberately per-realization — the
  // accepted design binds read-reference-v1 for bdptest and read-bdpbd-v1 for
  // bdpbd, preserving the same logical topology through different projected
  // identifiers — so each segment's fixture digest is cross-checked against
  // its own run's measurement instead, and per-target fixture agreement is
  // enforced below.
  const allSegments = targets.flatMap((entry) => entry.segments);
  const [first, ...rest] = allSegments;
  if (first === undefined) throw new ReadCohortArtifactError("cohort has no runs");
  for (const segment of rest) {
    for (const key of ["catalog", "manifest"] as const) {
      if (segment.bindings[key] !== first.bindings[key]) {
        throw new ReadCohortArtifactError(
          `runs disagree on the bound ${key}; one cohort covers both targets`,
        );
      }
    }
  }
  // Within one target, every run observed the same realization: a packaged
  // and an in-process segment that bound different fixtures would be evidence
  // about two different experiments wearing one target's name.
  for (const entry of targets) {
    const [firstSegment, ...restSegments] = entry.segments;
    if (firstSegment === undefined) continue;
    for (const segment of restSegments) {
      if (segment.bindings.fixture !== firstSegment.bindings.fixture) {
        throw new ReadCohortArtifactError(
          `target '${entry.target}' runs disagree on the bound fixture`,
        );
      }
    }
  }

  return deepFreeze({
    cohortVersion: READ_COHORT_ARTIFACT_VERSION,
    catalogId,
    selfCertified: selfCertifiable,
    selfCertifiedNote: SELF_CERTIFIED_NOTE,
    runHead: input.runHead,
    requiredScenarioIds,
    uncovered,
    targets,
  }) satisfies ReadCohortArtifact;
}

export const SELF_CERTIFIED_NOTE =
  "The self-certified rows were exercised in-process rather than against the packaged target, because they drive a control channel the packaged server does not expose. They are evidence about the implementation, not about the packaged boundary, and must not be presented as black-box conformance.";

/**
 * Rows that may be exercised in-process: precisely those whose manifest plan
 * carries a `lifecycle`-family action, which is what needs the control channel
 * the packaged server does not expose.
 *
 * Derived, never supplied. A hand-maintained list could be extended to hide a
 * packaged failure; this set can only move when the manifest moves, and the
 * manifest digest is already bound.
 *
 * Exported for the evidence gate, which must re-derive the set from the
 * committed manifest rather than trust the artifact's declared list.
 */
export function deriveReadCohortSelfCertifiableIds(
  manifest: ExecutableScenarioManifest,
  requiredScenarioIds: readonly string[],
): readonly string[] {
  const required = new Set(requiredScenarioIds);
  const ids: string[] = [];
  for (const scenario of manifest.scenarios) {
    const actions = (scenario as { actions?: readonly { family?: string }[] }).actions ?? [];
    if (!actions.some((action) => action.family === "lifecycle")) continue;
    if (!required.has(scenario.id)) {
      throw new ReadCohortArtifactError(`manifest row '${scenario.id}' is not a catalog scenario`);
    }
    ids.push(scenario.id);
  }
  return Object.freeze(ids.sort(compareCodeUnits));
}

/** Assemble one target from its runs, proving they tile the required set exactly. */
function projectTargetSegments(
  target: ReadCohortTarget,
  inputs: readonly ReadCohortTargetInput[],
  requiredScenarioIds: readonly string[],
  selfCertifiable: readonly string[],
  notApplicable: readonly ReadCohortNotApplicableRow[],
): ReadCohortTargetEntry {
  const selfSet = new Set(selfCertifiable);
  const notApplicableIds = new Set(notApplicable.map(({ scenarioId }) => scenarioId));
  const claimed = new Map<string, ReadCohortAdmission>();
  const segments = [...inputs]
    .sort((left, right) => compareCodeUnits(left.admission, right.admission))
    .map((entry) => {
      for (const row of entry.rows) {
        if (claimed.has(row)) {
          throw new ReadCohortArtifactError(
            `target '${target}' attributes row '${row}' to more than one run`,
          );
        }
        claimed.set(row, entry.admission);
      }
      return projectSegment(entry, selfSet);
    });

  for (const id of requiredScenarioIds) {
    if (notApplicableIds.has(id)) {
      if (claimed.has(id)) {
        throw new ReadCohortArtifactError(
          `target '${target}' claims row '${id}' despite a missing applicability capability`,
        );
      }
      continue;
    }
    if (!claimed.has(id)) {
      throw new ReadCohortArtifactError(
        `target '${target}' is missing required scenario '${id}'; absent closes the cohort`,
      );
    }
  }
  for (const id of claimed.keys()) {
    if (!requiredScenarioIds.includes(id)) {
      throw new ReadCohortArtifactError(
        `target '${target}' contributes row '${id}', which the bound catalog does not require`,
      );
    }
  }

  const rows = [...claimed.values()];
  return Object.freeze({
    target,
    scores: Object.freeze({ pass: rows.length, other: 0 }),
    packagedRows: rows.filter((admission) => admission === "packaged").length,
    selfCertifiedRows: rows.filter((admission) => admission === "in-process").length,
    notApplicable: Object.freeze(notApplicable.map((row) => Object.freeze(row))),
    segments: Object.freeze(segments),
  }) as ReadCohortTargetEntry;
}

/**
 * The not-applicable set for one target: required rows whose manifest
 * applicability gate names a capability the target's bound fixture does not
 * declare. Derived, never supplied; the verifier recomputes it from the
 * committed catalog, manifest, and fixture bytes.
 */
export function deriveReadCohortNotApplicableRows(
  manifest: ExecutableScenarioManifest,
  requiredScenarioIds: readonly string[],
  capabilities: readonly string[],
): readonly ReadCohortNotApplicableRow[] {
  const declared = new Set(capabilities);
  const rows: ReadCohortNotApplicableRow[] = [];
  for (const id of requiredScenarioIds) {
    const scenario = manifest.scenarios.find((entry) => entry.id === id);
    if (scenario === undefined) continue;
    const missing = (scenario.applicability?.requires ?? []).filter(
      (capability) => !declared.has(capability),
    );
    if (missing.length > 0)
      rows.push(
        Object.freeze({ scenarioId: id, missingCapabilities: Object.freeze([...missing].sort()) }),
      );
  }
  return Object.freeze(rows);
}

/**
 * The required set, derived from the bound catalog and never supplied. Exported
 * for the evidence gate alongside the self-certifiable derivation.
 */
export function deriveReadCohortRequiredScenarioIds(catalog: ScenarioCatalog): readonly string[] {
  const ids = catalog.scenarios.map((scenario) => scenario.id).sort(compareCodeUnits);
  if (ids.length === 0) {
    throw new ReadCohortArtifactError("bound catalog declares no scenarios");
  }
  if (new Set(ids).size !== ids.length) {
    throw new ReadCohortArtifactError("bound catalog declares duplicate scenario ids");
  }
  return Object.freeze(ids);
}

function normalizeUncovered(
  uncovered: readonly ReadCohortUncoveredVariant[],
  requiredScenarioIds: readonly string[],
): readonly ReadCohortUncoveredVariant[] {
  if (uncovered.length === 0) {
    throw new ReadCohortArtifactError(
      "cohort must declare its uncovered variants; an empty list would assert total coverage",
    );
  }
  const required = new Set(requiredScenarioIds);
  const seen = new Set<string>();
  for (const entry of uncovered) {
    if (!required.has(entry.scenarioId)) {
      throw new ReadCohortArtifactError(
        `uncovered variant names '${entry.scenarioId}', which is not a catalog scenario`,
      );
    }
    const key = `${entry.scenarioId} ${entry.variant}`;
    if (seen.has(key)) {
      throw new ReadCohortArtifactError(
        `uncovered variant '${entry.variant}' is declared twice for '${entry.scenarioId}'`,
      );
    }
    seen.add(key);
    if (entry.variant.length === 0 || entry.reason.length === 0) {
      throw new ReadCohortArtifactError("uncovered variants must name a variant and a reason");
    }
  }
  return Object.freeze(
    [...uncovered]
      .sort(
        (left, right) =>
          compareCodeUnits(left.scenarioId, right.scenarioId) ||
          compareCodeUnits(left.variant, right.variant),
      )
      .map((entry) =>
        Object.freeze({
          scenarioId: entry.scenarioId,
          variant: entry.variant,
          reason: entry.reason,
        }),
      ),
  );
}

function projectSegment(
  entry: ReadCohortTargetInput,
  selfCertifiable: ReadonlySet<string>,
): ReadCohortSegment {
  const { run, target, admission } = entry;

  if (!READ_COHORT_ADMISSIONS.includes(admission)) {
    throw new ReadCohortArtifactError(
      `target '${target}' declares an unknown admission '${admission}'`,
    );
  }
  if (entry.rows.length === 0) {
    throw new ReadCohortArtifactError(`target '${target}' declares a run contributing no rows`);
  }

  const selected = new Set(run.selectedScenarioIds);
  const bindings = normalizeBindings(entry);

  const byId = new Map<string, ScenarioRunResult>();
  for (const scenario of run.scenarios) {
    if (byId.has(scenario.id)) {
      throw new ReadCohortArtifactError(
        `target '${target}' reported scenario '${scenario.id}' more than once`,
      );
    }
    byId.set(scenario.id, scenario);
  }

  const scenarios: ReadCohortScenario[] = [];
  for (const id of [...entry.rows].sort(compareCodeUnits)) {
    // Self-certification is a property of the row, not a choice of the caller.
    // Anything else must be proved against the packaged target.
    if (admission === "in-process" && !selfCertifiable.has(id)) {
      throw new ReadCohortArtifactError(
        `row '${id}' is not self-certifiable and must be exercised against the packaged target`,
      );
    }
    if (!selected.has(id)) {
      throw new ReadCohortArtifactError(
        `target '${target}' claims row '${id}', which its run did not select`,
      );
    }
    const scenario = byId.get(id);
    if (scenario === undefined) {
      throw new ReadCohortArtifactError(
        `target '${target}' is missing required scenario '${id}'; absent closes the cohort`,
      );
    }
    if (scenario.state !== "pass") {
      throw new ReadCohortArtifactError(
        `target '${target}' reported '${id}' as '${scenario.state}'; pass is the only admissible state`,
      );
    }
    scenarios.push(projectScenario(scenario, target, admission));
  }

  return Object.freeze({
    admission,
    targetLabel: run.declarations.targetLabel,
    scope: run.scope,
    profile: run.profile,
    seed: run.seed,
    bindings,
    ...(entry.bdIdentity === undefined
      ? {}
      : { bdIdentity: normalizeBdIdentity(entry.bdIdentity) }),
    scenarios: Object.freeze(scenarios),
  }) as ReadCohortSegment;
}

function normalizeBindings(entry: ReadCohortTargetInput): ReadCohortBindings {
  const { bindings, run, target } = entry;
  for (const key of ALWAYS_REQUIRED_BINDING_KEYS) {
    const digest = bindings[key];
    if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
      throw new ReadCohortArtifactError(
        `target '${target}' binding '${key}' must be a sha-256 hex digest`,
      );
    }
  }

  // A packaged run must name the payload, process and workspace behind it; a
  // test-granted one has none of those and must not claim any. Absent rather
  // than optional -- supplying them would fabricate the provenance the packaged
  // seal is supposed to establish.
  for (const key of PACKAGED_ONLY_BINDING_KEYS) {
    const digest = bindings[key];
    if (entry.admission === "packaged") {
      if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
        throw new ReadCohortArtifactError(
          `packaged target '${target}' binding '${key}' must be a sha-256 hex digest`,
        );
      }
    } else if (digest !== undefined) {
      throw new ReadCohortArtifactError(
        `in-process run for '${target}' must not claim binding '${key}'`,
      );
    }
  }

  // The run already measured three of these; a caller-supplied disagreement means
  // the artifact would describe a run that did not happen.
  const measured = {
    catalog: run.artifacts.catalogDigest,
    manifest: run.artifacts.manifestDigest,
    fixture: run.artifacts.fixtureDigest,
  } as const;
  for (const [key, digest] of Object.entries(measured) as [keyof typeof measured, string][]) {
    if (bindings[key] !== digest) {
      throw new ReadCohortArtifactError(
        `target '${target}' binding '${key}' does not match the digest the run measured`,
      );
    }
  }

  // `bd` is what separates the two targets: `bdpbd` serves a real executable and
  // must name it, `bdptest` has none and must not claim one.
  if (target === "bdpbd") {
    if (bindings.bdExecutable === undefined || !SHA256_HEX.test(bindings.bdExecutable)) {
      throw new ReadCohortArtifactError(
        "target 'bdpbd' must bind the sha-256 digest of the bd executable that served the run",
      );
    }
    if (entry.bdIdentity === undefined) {
      throw new ReadCohortArtifactError("target 'bdpbd' must carry the pinned bd identity");
    }
  } else if (bindings.bdExecutable !== undefined || entry.bdIdentity !== undefined) {
    throw new ReadCohortArtifactError(
      `target '${target}' must not claim a bd binding; it serves no bd executable`,
    );
  }

  const normalized: Record<string, string> = {};
  for (const key of ALWAYS_REQUIRED_BINDING_KEYS) normalized[key] = bindings[key] as string;
  for (const key of PACKAGED_ONLY_BINDING_KEYS) {
    if (bindings[key] !== undefined) normalized[key] = bindings[key] as string;
  }
  if (bindings.bdExecutable !== undefined) normalized.bdExecutable = bindings.bdExecutable;
  return Object.freeze(normalized) as unknown as ReadCohortBindings;
}

function normalizeBdIdentity(identity: BdIdentityPin): BdIdentityPin {
  if (identity.version.length === 0) {
    throw new ReadCohortArtifactError("bd identity must name a version");
  }
  if (!Number.isSafeInteger(identity.schemaVersion) || identity.schemaVersion < 0) {
    throw new ReadCohortArtifactError("bd schemaVersion must be a non-negative integer");
  }
  if (!SHA256_HEX.test(identity.observationsDigest)) {
    throw new ReadCohortArtifactError("bd observationsDigest must be a sha-256 hex digest");
  }
  return Object.freeze({
    version: identity.version,
    schemaVersion: identity.schemaVersion,
    observationsDigest: identity.observationsDigest,
  });
}

/**
 * Reduce one observed scenario to the D5-permitted projection.
 *
 * Note what is *not* read here: `request.url`, `response.url`, every header value,
 * `transportError.message`, and `cleanupError`. URLs and transport messages carry
 * target-allocated instance identity; header values and bodies carry payload. A
 * passing scenario has no transport error to describe anyway.
 */
function projectScenario(
  scenario: ScenarioRunResult,
  target: ReadCohortTarget,
  admission: ReadCohortAdmission,
): ReadCohortScenario {
  const exchanges = scenario.exchanges.map((exchange) => {
    const response = exchange.response;
    if (response === undefined) {
      throw new ReadCohortArtifactError(
        `target '${target}' scenario '${scenario.id}' passed with an exchange that has no response`,
      );
    }
    return Object.freeze({
      requestId: exchange.request.id,
      method: exchange.request.method,
      requestHeaderNames: allowlistHeaderNames(exchange.request.headers),
      status: response.status,
      responseHeaderNames: allowlistHeaderNames(response.headers),
      bodyKind: response.bodyKind,
      decodedBodyBytes: response.decodedBodyBytes,
    });
  });

  return Object.freeze({
    id: scenario.id,
    state: "pass",
    admission,
    exchanges: Object.freeze(exchanges),
  }) as ReadCohortScenario;
}

/**
 * Keep the allowlisted header *names*, sorted; drop everything else. Values are
 * never read, so no branch of this function can leak one.
 */
function allowlistHeaderNames(headers: Readonly<Record<string, string>>): readonly string[] {
  const names = new Set<string>();
  for (const name of Object.keys(headers)) {
    const lowered = name.toLowerCase();
    if (ALLOWED_HEADER_NAMES.has(lowered)) names.add(lowered);
  }
  return Object.freeze([...names].sort(compareCodeUnits));
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Canonical bytes for the artifact: keys sorted by code unit, no insignificant
 * whitespace, one trailing newline so the file is a well-formed text file.
 *
 * The evidence constant is a digest over the *committed* bytes, so serialization
 * has to be the only way to produce them — otherwise a reformat would silently
 * invalidate the constant while the artifact still parsed. `assertCanonical`
 * below is what makes that check available to the verifier.
 */
export function serializeReadCohortArtifact(artifact: ReadCohortArtifact): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(artifact)}\n`);
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ReadCohortArtifactError("cohort artifact numbers must be finite");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new ReadCohortArtifactError(`cohort artifact cannot serialize ${typeof value}`);
}

/** SHA-256 over exact artifact bytes. */
export function readCohortArtifactDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * D3: the evidence constant is the artifact's content digest truncated to 40 hex
 * characters, preserving the existing evidence regex. 160 bits of a SHA-256 is a
 * second-preimage margin far beyond what this gate needs, and the artifact never
 * contains the constant — which is what breaks the bootstrapping circle.
 */
export function readCohortEvidenceConstant(bytes: Uint8Array): string {
  return readCohortArtifactDigest(bytes).slice(0, EVIDENCE_CONSTANT_HEX_LENGTH);
}

/**
 * Prove committed bytes are exactly what serialization produces. Without this a
 * pretty-printed or key-reordered artifact would parse, verify field-by-field,
 * and still digest to something the constant does not match.
 *
 * This works from bytes alone — parse, re-serialize, compare — so the verifier
 * can check a committed file without first rebuilding the typed artifact. Since
 * serialization sorts keys, a round-trip that reproduces the input byte for byte
 * is exactly the statement "these bytes are canonical".
 */
export function assertCanonicalReadCohortBytes(bytes: Uint8Array): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new ReadCohortArtifactError("cohort artifact bytes are not valid UTF-8 JSON", { cause });
  }
  const expected = new TextEncoder().encode(`${canonicalJson(parsed)}\n`);
  if (expected.byteLength !== bytes.byteLength) {
    throw new ReadCohortArtifactError("cohort artifact bytes are not canonical");
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== bytes[index]) {
      throw new ReadCohortArtifactError("cohort artifact bytes are not canonical");
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  const pending: object[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const entry of Object.values(current)) {
      if (typeof entry === "object" && entry !== null) pending.push(entry);
    }
    if (!Object.isFrozen(current)) Object.freeze(current);
  }
  return value;
}
