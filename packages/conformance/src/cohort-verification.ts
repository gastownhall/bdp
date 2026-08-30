import {
  assertCanonicalReadCohortBytes,
  READ_COHORT_HEADER_NAME_ALLOWLIST,
  READ_COHORT_TARGETS,
  type ReadCohortTarget,
  readCohortEvidenceConstant,
} from "./cohort-artifact.js";

/**
 * D3's evidence check over the committed artifact bytes plus facts a caller has
 * already gathered. Git access lives in the calling script; everything
 * decidable from the bytes lives here.
 *
 * Every branch fails closed. A cohort that cannot be proved is not a cohort that
 * is merely unproved — it is one that does not admit.
 *
 * `createReadCohortArtifact` enforces structure at generation time, but the
 * committed file is what admits, and the evidence delta deliberately permits
 * edits to exactly that file. Verification therefore re-proves the structural
 * claims from the committed bytes directly — the verifier parses the artifact
 * itself rather than trusting caller-flattened projections, so a field the
 * caller forgot to surface can never become a field a forgery may edit freely.
 * Deleting a failing row, relabeling an in-process row as packaged, or
 * stripping the packaged bindings are all strictly easier forgeries than the
 * ones the digest already refuses; each is refused here from the bytes.
 */
export class ReadCohortVerificationError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ReadCohortVerificationError";
  }
}

export interface ReadCohortVerificationInput {
  /** Exact committed bytes of the cohort artifact. */
  readonly artifactBytes: Uint8Array;
  /** The evidence constant recorded for each target, as shipped. */
  readonly evidenceByTarget: Readonly<Partial<Record<ReadCohortTarget, string | undefined>>>;
  /** The required scenario set, derived from the bound catalog by the caller. */
  readonly requiredScenarioIds: readonly string[];
  /**
   * Per target, the rows the bound manifest gates on capabilities that
   * target's committed fixture does not declare — derived by the gate from
   * committed bytes, never trusted from the artifact.
   */
  readonly derivedNotApplicableByTarget: Readonly<
    Record<string, readonly { scenarioId: string; missingCapabilities: readonly string[] }[]>
  >;
  /** The self-certifiable set derived independently from the bound manifest. */
  readonly derivedSelfCertifiable: readonly string[];
  /**
   * D4: the pinned bd identity, recomputed by the caller from the committed
   * baseline observations. Every bdpbd segment must record exactly this
   * identity — any drift closes bdpbd and therefore both targets.
   */
  readonly expectedBdIdentity: {
    readonly version: string;
    readonly schemaVersion: number;
    readonly observationsDigest: string;
  };
  /** Whether the recorded run head is an ancestor of the commit being verified. */
  readonly runHeadIsAncestor: boolean;
  /** Repo-relative paths changed between the run head and the evidence commit. */
  readonly changedPathsSinceRunHead: readonly string[];
  /** The only paths that delta may touch. */
  readonly allowedDeltaPaths: readonly string[];
}

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const EVIDENCE_CONSTANT = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const ALWAYS_REQUIRED_BINDING_KEYS = [
  "catalog",
  "manifest",
  "fixture",
  "schema",
  "validator",
  "runner",
  "harness",
  "executor",
] as const;

const PACKAGED_ONLY_BINDING_KEYS = ["installedPayload", "targetProcess", "workspace"] as const;

/**
 * D5 is structural: the artifact types have no field able to carry a header
 * value, body, body digest, or URL. The committed file is not typed, so the
 * same closure is re-proved here by rejecting unknown keys at every level —
 * an extra nested member is exactly how retained content would smuggle in.
 */
const ROOT_KEYS = new Set([
  "cohortVersion",
  "catalogId",
  "selfCertified",
  "selfCertifiedNote",
  "runHead",
  "requiredScenarioIds",
  "uncovered",
  "targets",
]);
const UNCOVERED_KEYS = new Set(["scenarioId", "variant", "reason"]);
const TARGET_KEYS = new Set([
  "target",
  "scores",
  "packagedRows",
  "selfCertifiedRows",
  "notApplicable",
  "segments",
]);
const NOT_APPLICABLE_KEYS = new Set(["scenarioId", "missingCapabilities"]);
const SCORES_KEYS = new Set(["pass", "other"]);
const SEGMENT_KEYS = new Set([
  "admission",
  "targetLabel",
  "scope",
  "profile",
  "seed",
  "bindings",
  "bdIdentity",
  "scenarios",
]);
const BINDING_KEYS = new Set([
  ...ALWAYS_REQUIRED_BINDING_KEYS,
  ...PACKAGED_ONLY_BINDING_KEYS,
  "bdExecutable",
]);
const BD_IDENTITY_KEYS = new Set(["version", "schemaVersion", "observationsDigest"]);
const SCENARIO_KEYS = new Set(["id", "state", "admission", "exchanges"]);
const EXCHANGE_KEYS = new Set([
  "requestId",
  "method",
  "requestHeaderNames",
  "status",
  "responseHeaderNames",
  "bodyKind",
  "decodedBodyBytes",
]);
const BODY_KINDS = new Set(["empty", "json", "invalid-json", "unrepresentable-json"]);
const ALLOWED_HEADER_NAMES = new Set(READ_COHORT_HEADER_NAME_ALLOWLIST);

export function verifyReadCohortEvidence(input: ReadCohortVerificationInput): void {
  // A reformatted artifact would still parse and still satisfy every field check
  // below while digesting to something the constant does not match.
  assertCanonicalReadCohortBytes(input.artifactBytes);

  const expected = readCohortEvidenceConstant(input.artifactBytes);
  const artifact = closedRecord(
    JSON.parse(new TextDecoder().decode(input.artifactBytes)),
    ROOT_KEYS,
    "artifact root",
  );
  requireString(artifact.catalogId, "artifact catalogId");

  const recordedRunHead = requireString(artifact.runHead, "artifact runHead");
  if (!COMMIT_SHA.test(recordedRunHead)) {
    throw new ReadCohortVerificationError("artifact records a malformed run head");
  }
  if (artifact.cohortVersion !== 1) {
    throw new ReadCohortVerificationError("artifact records an unknown cohort version");
  }

  if (input.requiredScenarioIds.length === 0) {
    throw new ReadCohortVerificationError("the derived required scenario set is empty");
  }
  const required = new Set(input.requiredScenarioIds);
  if (required.size !== input.requiredScenarioIds.length) {
    throw new ReadCohortVerificationError("the derived required scenario set repeats ids");
  }

  // The recorded required set is re-derived rather than trusted, exactly like
  // the self-certified list below: a cohort claims coverage of the bound
  // catalog, so a catalog that has moved past the artifact closes the cohort.
  const recordedRequired = stringArray(
    artifact.requiredScenarioIds,
    "artifact requiredScenarioIds",
  );
  if (!sameSorted(recordedRequired, input.requiredScenarioIds)) {
    throw new ReadCohortVerificationError(
      "artifact required scenario ids do not match the set derived from the bound catalog",
    );
  }

  // The declared list is re-derived rather than trusted. A list editable
  // independently of the manifest could be extended to excuse a packaged
  // failure, which is the whole reason the set is derived at all.
  const declared = stringArray(artifact.selfCertified, "artifact selfCertified");
  if (!sameSorted(declared, input.derivedSelfCertifiable)) {
    throw new ReadCohortVerificationError(
      "declared self-certified rows do not match the set derived from the bound manifest",
    );
  }
  const selfCertifiable = new Set(input.derivedSelfCertifiable);

  // The callout is binding: these rows are not independently verified and the
  // artifact has to say so where a reader will see it.
  if (requireString(artifact.selfCertifiedNote, "artifact selfCertifiedNote").trim().length === 0) {
    throw new ReadCohortVerificationError("artifact states no self-certification callout");
  }

  // D2: the deliberately uncovered variants are declared rather than implicit;
  // an emptied list would silently assert total coverage.
  const uncovered = array(artifact.uncovered, "artifact uncovered");
  if (uncovered.length === 0) {
    throw new ReadCohortVerificationError(
      "artifact declares no uncovered variants; an empty list would assert total coverage",
    );
  }
  for (const entry of uncovered) {
    const variant = closedRecord(entry, UNCOVERED_KEYS, "uncovered variant");
    const scenarioId = requireString(variant.scenarioId, "uncovered scenarioId");
    if (!required.has(scenarioId)) {
      throw new ReadCohortVerificationError(
        `uncovered variant names '${scenarioId}', which is not a catalog scenario`,
      );
    }
    if (
      requireString(variant.variant, "uncovered variant name").length === 0 ||
      requireString(variant.reason, "uncovered reason").length === 0
    ) {
      throw new ReadCohortVerificationError("uncovered variants must name a variant and a reason");
    }
  }

  // Exactly the two public targets, each present once. A missing target is a
  // half-cohort; an extra one is a claim about a target that does not exist.
  const targets = array(artifact.targets, "artifact targets").map((entry) =>
    closedRecord(entry, TARGET_KEYS, "target entry"),
  );
  const seenTargets = new Set<string>();
  for (const entry of targets) {
    const target = requireString(entry.target, "target name");
    if (!(READ_COHORT_TARGETS as readonly string[]).includes(target)) {
      throw new ReadCohortVerificationError(`artifact carries rows for unknown target '${target}'`);
    }
    if (seenTargets.has(target)) {
      throw new ReadCohortVerificationError(`artifact carries target '${target}' more than once`);
    }
    seenTargets.add(target);
  }
  for (const target of READ_COHORT_TARGETS) {
    if (!seenTargets.has(target)) {
      throw new ReadCohortVerificationError(`artifact is missing required target '${target}'`);
    }
  }

  // Cross-run agreement: one catalog and manifest bind the whole cohort; each
  // target's segments agree on their own fixture realization.
  let boundCatalog: string | undefined;
  let boundManifest: string | undefined;

  for (const entry of targets) {
    const targetName = requireString(entry.target, "target name");
    const segments = array(entry.segments, `target '${targetName}' segments`).map((segment) =>
      closedRecord(segment, SEGMENT_KEYS, `target '${targetName}' segment`),
    );
    if (segments.length === 0) {
      throw new ReadCohortVerificationError(`target '${targetName}' carries no runs`);
    }

    let boundFixture: string | undefined;
    const claimed = new Map<string, string>();
    for (const segment of segments) {
      const admission = requireString(segment.admission, "segment admission");
      if (admission !== "packaged" && admission !== "in-process") {
        throw new ReadCohortVerificationError(
          `target '${targetName}' declares an unknown admission '${admission}'`,
        );
      }
      requireString(segment.targetLabel, "segment targetLabel");
      requireString(segment.scope, "segment scope");
      requireString(segment.profile, "segment profile");
      if (!Number.isSafeInteger(segment.seed)) {
        throw new ReadCohortVerificationError("segment seed must be a safe integer");
      }
      const bindings = closedRecord(segment.bindings, BINDING_KEYS, "segment bindings");
      for (const key of ALWAYS_REQUIRED_BINDING_KEYS) {
        const digest = bindings[key];
        if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
          throw new ReadCohortVerificationError(
            `target '${targetName}' binding '${key}' must be a sha-256 hex digest`,
          );
        }
      }
      // A packaged run must name the payload, process and workspace behind it;
      // an in-process one has none of those and must not claim any. Relabeling
      // an in-process segment as packaged therefore fails here: the bindings it
      // could not honestly carry are exactly the ones now demanded.
      for (const key of PACKAGED_ONLY_BINDING_KEYS) {
        const digest = bindings[key];
        if (admission === "packaged") {
          if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
            throw new ReadCohortVerificationError(
              `packaged target '${targetName}' binding '${key}' must be a sha-256 hex digest`,
            );
          }
        } else if (digest !== undefined) {
          throw new ReadCohortVerificationError(
            `in-process run for '${targetName}' must not claim binding '${key}'`,
          );
        }
      }
      // bd is what separates the two targets: bdpbd serves a real executable
      // and must name and pin it on every segment; bdptest must not claim one.
      if (targetName === "bdpbd") {
        if (typeof bindings.bdExecutable !== "string" || !SHA256_HEX.test(bindings.bdExecutable)) {
          throw new ReadCohortVerificationError(
            "target 'bdpbd' must bind the sha-256 digest of the bd executable that served the run",
          );
        }
        const identity = closedRecord(segment.bdIdentity, BD_IDENTITY_KEYS, "bdpbd bdIdentity");
        // D4 is an exact pin, not a shape: the identity must equal the one
        // recomputed from the committed baseline observations. Any drift —
        // version, schema, or observation bytes — closes bdpbd and therefore
        // both targets.
        if (
          identity.version !== input.expectedBdIdentity.version ||
          identity.schemaVersion !== input.expectedBdIdentity.schemaVersion ||
          identity.observationsDigest !== input.expectedBdIdentity.observationsDigest
        ) {
          throw new ReadCohortVerificationError(
            "target 'bdpbd' records a bd identity that is not the pinned baseline identity",
          );
        }
      } else if (bindings.bdExecutable !== undefined || segment.bdIdentity !== undefined) {
        throw new ReadCohortVerificationError(
          `target '${targetName}' must not claim a bd binding; it serves no bd executable`,
        );
      }

      boundCatalog ??= bindings.catalog as string;
      boundManifest ??= bindings.manifest as string;
      if (bindings.catalog !== boundCatalog || bindings.manifest !== boundManifest) {
        throw new ReadCohortVerificationError(
          "runs disagree on the bound catalog or manifest; one cohort covers both targets",
        );
      }
      boundFixture ??= bindings.fixture as string;
      if (bindings.fixture !== boundFixture) {
        throw new ReadCohortVerificationError(
          `target '${targetName}' runs disagree on the bound fixture`,
        );
      }

      for (const scenarioEntry of array(segment.scenarios, "segment scenarios")) {
        const row = closedRecord(scenarioEntry, SCENARIO_KEYS, "scenario row");
        const id = requireString(row.id, "scenario id");
        // D5 re-proof: exchanges may carry only the redacted projection, and
        // header NAMES only from the reviewed allowlist. Any other member or
        // any unlisted name is retained content wearing a field name.
        for (const exchangeEntry of array(row.exchanges, `row '${id}' exchanges`)) {
          const exchange = closedRecord(exchangeEntry, EXCHANGE_KEYS, `row '${id}' exchange`);
          requireString(exchange.requestId, "exchange requestId");
          requireString(exchange.method, "exchange method");
          if (
            !Number.isSafeInteger(exchange.status) ||
            (exchange.status as number) < 100 ||
            (exchange.status as number) > 599
          ) {
            throw new ReadCohortVerificationError(
              `row '${id}' records an implausible exchange status`,
            );
          }
          if (!BODY_KINDS.has(exchange.bodyKind as string)) {
            throw new ReadCohortVerificationError(
              `row '${id}' records an unknown exchange body kind`,
            );
          }
          if (
            !Number.isSafeInteger(exchange.decodedBodyBytes) ||
            (exchange.decodedBodyBytes as number) < 0
          ) {
            throw new ReadCohortVerificationError(
              `row '${id}' records a malformed exchange body size`,
            );
          }
          for (const list of ["requestHeaderNames", "responseHeaderNames"] as const) {
            for (const name of array(exchange[list], `exchange ${list}`)) {
              if (typeof name !== "string" || !ALLOWED_HEADER_NAMES.has(name)) {
                throw new ReadCohortVerificationError(
                  `row '${id}' retains a header name outside the reviewed allowlist`,
                );
              }
            }
          }
        }
        // Deleting a failing row is the cheapest forgery; a non-pass state is
        // the next cheapest. Both close the cohort here, from committed bytes.
        if (row.state !== "pass") {
          throw new ReadCohortVerificationError(
            `target '${targetName}' records row '${id}' as '${String(row.state)}'; pass is the only admissible state`,
          );
        }
        // A row's admission is its segment's admission; a disagreement means
        // the artifact is describing a run that did not happen.
        if (row.admission !== admission) {
          throw new ReadCohortVerificationError(
            `target '${targetName}' row '${id}' admission disagrees with its segment`,
          );
        }
        if (!required.has(id)) {
          throw new ReadCohortVerificationError(
            `target '${targetName}' carries row '${id}', which the bound catalog does not require`,
          );
        }
        if (claimed.has(id)) {
          throw new ReadCohortVerificationError(
            `target '${targetName}' carries row '${id}' more than once`,
          );
        }
        claimed.set(id, admission);
        // A row that is not self-certifiable must have been proved against the
        // packaged target. This also refuses the bootstrap artifact, whose
        // packaged-required rows are in-process, so no separate rule is needed.
        if (admission === "in-process" && !selfCertifiable.has(id)) {
          throw new ReadCohortVerificationError(
            `row '${id}' was exercised in-process but is not self-certifiable`,
          );
        }
      }
    }

    // Honest absence: the artifact's recorded not-applicable rows must equal
    // the set the gate derived from the committed manifest and this target's
    // committed fixture — element for element — and no recorded-inapplicable
    // row may also be claimed.
    const derivedNotApplicable = input.derivedNotApplicableByTarget[targetName] ?? [];
    const recordedNotApplicable = array(
      entry.notApplicable ?? [],
      `target '${targetName}' notApplicable`,
    ).map((row) => closedRecord(row, NOT_APPLICABLE_KEYS, `target '${targetName}' notApplicable`));
    if (recordedNotApplicable.length !== derivedNotApplicable.length) {
      throw new ReadCohortVerificationError(
        `target '${targetName}' notApplicable rows do not match the committed manifest and fixture`,
      );
    }
    for (const [index, derived] of derivedNotApplicable.entries()) {
      const recorded = recordedNotApplicable[index];
      const recordedId = requireString(recorded?.scenarioId, "notApplicable scenarioId");
      const recordedMissing = array(
        recorded?.missingCapabilities,
        "notApplicable missingCapabilities",
      ).map((value) => requireString(value, "notApplicable capability"));
      if (
        recordedId !== derived.scenarioId ||
        !sameSorted(recordedMissing, [...derived.missingCapabilities].sort())
      ) {
        throw new ReadCohortVerificationError(
          `target '${targetName}' notApplicable rows do not match the committed manifest and fixture`,
        );
      }
      if (claimed.has(recordedId)) {
        throw new ReadCohortVerificationError(
          `target '${targetName}' claims row '${recordedId}' despite a missing applicability capability`,
        );
      }
    }
    const notApplicableIds = new Set(derivedNotApplicable.map(({ scenarioId }) => scenarioId));
    for (const id of input.requiredScenarioIds) {
      if (notApplicableIds.has(id)) continue;
      if (!claimed.has(id)) {
        throw new ReadCohortVerificationError(
          `target '${targetName}' is missing required row '${id}'; absent closes the cohort`,
        );
      }
    }

    // D1: scores render split so a non-pass or in-process share cannot hide
    // inside a ratio. The committed numbers must agree with the committed rows.
    const packagedCount = [...claimed.values()].filter((value) => value === "packaged").length;
    const inProcessCount = claimed.size - packagedCount;
    const scores = closedRecord(entry.scores, SCORES_KEYS, `target '${targetName}' scores`);
    if (
      scores.pass !== claimed.size ||
      scores.other !== 0 ||
      entry.packagedRows !== packagedCount ||
      entry.selfCertifiedRows !== inProcessCount
    ) {
      throw new ReadCohortVerificationError(
        `target '${targetName}' scores disagree with its recorded rows`,
      );
    }
  }

  // Ancestry, not equality: the evidence commit is necessarily a descendant of
  // the run head, because committing the constant is itself a commit.
  if (!input.runHeadIsAncestor) {
    throw new ReadCohortVerificationError(
      `recorded run head ${recordedRunHead} is not an ancestor of the commit under verification`,
    );
  }

  // Delta confinement is what stops the window between running and committing
  // from being used to change the implementation the run observed.
  const allowed = new Set(input.allowedDeltaPaths);
  const escaped = [...new Set(input.changedPathsSinceRunHead)]
    .filter((path) => !allowed.has(path))
    .sort();
  if (escaped.length > 0) {
    throw new ReadCohortVerificationError(
      `changes since the run head escape the evidence delta: ${escaped.join(", ")}`,
    );
  }

  // Both targets, one cohort, one digest. A per-target constant is how a cohort
  // silently becomes two half-cohorts.
  const seen = new Map<ReadCohortTarget, string>();
  for (const target of READ_COHORT_TARGETS) {
    const evidence = input.evidenceByTarget[target];
    if (typeof evidence !== "string" || !EVIDENCE_CONSTANT.test(evidence)) {
      throw new ReadCohortVerificationError(
        `target '${target}' carries no well-formed evidence constant`,
      );
    }
    if (evidence !== expected) {
      throw new ReadCohortVerificationError(
        `target '${target}' evidence does not match the artifact's content digest`,
      );
    }
    seen.set(target, evidence);
  }
  const distinct = new Set(seen.values());
  if (distinct.size !== 1) {
    throw new ReadCohortVerificationError(
      "targets carry different evidence constants; one cohort covers both",
    );
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReadCohortVerificationError(`${label} must be a record`);
  }
  return value as Record<string, unknown>;
}

function closedRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): Record<string, unknown> {
  const parsed = record(value, label);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) {
      throw new ReadCohortVerificationError(`${label} carries unknown member '${key}'`);
    }
  }
  return parsed;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new ReadCohortVerificationError(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ReadCohortVerificationError(`${label} must be a string`);
  }
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  return array(value, label).map((entry) => requireString(entry, `${label} entry`));
}

function sameSorted(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}
