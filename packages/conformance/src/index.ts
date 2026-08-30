/** Identifies the portable, black-box conformance package. */
export const packageName = "@bdp/conformance";

export {
  type CatalogIssue,
  CatalogValidationError,
  type CitationSourceLoader,
  loadScenarioCatalogJson,
  parseScenarioCatalog,
  type RequirementCitation,
  type ScenarioCatalog,
  type ScenarioKind,
  type ScenarioMetadata,
  validateCatalogCitations,
} from "./catalog.js";
export {
  type ConformanceArtifactBundle,
  ConformanceArtifactBundleError,
  type ConformanceArtifactBundleSources,
  type ConformanceArtifactDigests,
  type ConformanceArtifactSource,
  type ConformanceFixture,
  createConformanceArtifactBundle,
} from "./artifact-bundle.js";
export {
  assertCanonicalReadCohortBytes,
  type BdIdentityPin,
  createReadCohortArtifact,
  deriveReadCohortNotApplicableRows,
  deriveReadCohortRequiredScenarioIds,
  deriveReadCohortSelfCertifiableIds,
  READ_COHORT_ADMISSIONS,
  READ_COHORT_ARTIFACT_VERSION,
  type ReadCohortAdmission,
  READ_COHORT_HEADER_NAME_ALLOWLIST,
  READ_COHORT_TARGETS,
  type ReadCohortArtifact,
  ReadCohortArtifactError,
  type ReadCohortArtifactInput,
  type ReadCohortBindings,
  type ReadCohortExchange,
  type ReadCohortScenario,
  type ReadCohortSegment,
  type ReadCohortTarget,
  type ReadCohortTargetEntry,
  type ReadCohortNotApplicableRow,
  type ReadCohortTargetInput,
  type ReadCohortUncoveredVariant,
  readCohortArtifactDigest,
  readCohortEvidenceConstant,
  SELF_CERTIFIED_NOTE,
  serializeReadCohortArtifact,
} from "./cohort-artifact.js";
export {
  type ReadCohortVerificationInput,
  ReadCohortVerificationError,
  verifyReadCohortEvidence,
} from "./cohort-verification.js";
export {
  CONFORMANCE_RESULT_STATES,
  type ConformanceResultState,
  isConformanceResultState,
} from "./result-state.js";
export {
  profileIncludes,
  selectApplicableScenariosForProfile,
  selectDiagnosticScenariosForProfile,
  selectNormativeScenariosForProfile,
} from "./selection.js";
export {
  isSymbolicUrl,
  SYMBOLIC_URLS,
  type SymbolicUrl,
} from "./symbolic-url.js";
export {
  decodeScenarioRawRequestTarget,
  EXECUTABLE_MANIFEST_VERSION,
  type ExecutableScenario,
  type ExecutableScenarioManifest,
  type JsonPrimitive,
  type JsonValue,
  loadExecutableScenarioManifestJson,
  type ManifestIssue,
  ManifestValidationError,
  parseExecutableScenarioManifest,
  type ScenarioApplicability,
  type ScenarioAssertion,
  type ScenarioCapture,
  type ScenarioRawRequestTarget,
  type ScenarioRawRequestTargetBytes,
  materializeScenarioRawRequestTarget,
  type ScenarioRequest,
  type ScenarioSetup,
  type ScenarioTarget,
} from "./executable-manifest.js";
export type {
  ScenarioAction,
  ScenarioActionExecution,
  ScenarioActionExecutor,
  ScenarioActionFamily,
  ScenarioHttpAction,
  ScenarioJsonAssertion,
  ScenarioJsonCapture,
  ScenarioProgrammaticAction,
} from "./scenario-action.js";
export {
  createFetchHttpExchangeExecutor,
  createRawHttpExchangeExecutor,
  type HttpExchangeExecutor,
  type HttpExchangeRequest,
  type HttpExchangeResponse,
  HttpTransportError,
  type HttpTransportErrorCategory,
  type RawHttpDialRoute,
  type RawHttpExchangeExecutorOptions,
} from "./http-executor.js";
export {
  createRawHttpScenarioTarget,
  type RawHttpScenarioSession,
  type RawHttpScenarioTarget,
  type RawHttpScenarioTargetOptions,
  type StartRawHttpScenarioSession,
} from "./raw-http-scenario-target.js";
export {
  type AssertionOutcome,
  type ConformanceRunResult,
  ConformanceRunnerError,
  type FixturePreparation,
  type ObservedAction,
  type ObservedExchange,
  runConformanceMatrix,
  type ScenarioHarness,
  type ScenarioRunOptions,
  type ScenarioRunResult,
  type ScenarioRunState,
  ScenarioObservationFailure,
  ScenarioUnsupportedProfileError,
} from "./runner.js";
export {
  createJsonSchemaValidator,
  type SchemaValidationFailure,
  type SchemaValidator,
  SchemaValidatorError,
} from "./schema-validator.js";
export { serializeConformanceReport } from "./report.js";
