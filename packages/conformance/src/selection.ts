import { PROTOCOL_PROFILES, type ProtocolProfile } from "@bdp/protocol";

import type { ScenarioCatalog, ScenarioMetadata } from "./catalog.js";

/** Whether a claimed cumulative profile includes the required lower profile. */
export function profileIncludes(
  claimedProfile: ProtocolProfile,
  requiredProfile: ProtocolProfile,
): boolean {
  const claimedRank = profileRank(claimedProfile);
  const requiredRank = profileRank(requiredProfile);
  return claimedRank >= requiredRank;
}

/**
 * The ids every applicable row of the claimed profile retires. A retired row
 * is a lower-profile obligation the higher profile contradicts, so the claim
 * that includes the retiring row never inherits it; a claim below the
 * retiring row's profile keeps it. The retired rows may live in another
 * catalog file, so a caller that selects across profiles concatenates the
 * catalogs before selecting.
 */
export function retiredScenarioIds(
  catalog: ScenarioCatalog,
  claimedProfile: ProtocolProfile,
): ReadonlySet<string> {
  profileRank(claimedProfile);
  const retired = new Set<string>();
  for (const scenario of catalog.scenarios) {
    if (!profileIncludes(claimedProfile, scenario.requiredProfile)) continue;
    for (const id of scenario.retires ?? []) retired.add(id);
  }
  return retired;
}

/**
 * All catalog entries applicable to a claimed profile, preserving catalog
 * order and excluding every row an applicable row retires.
 */
export function selectApplicableScenariosForProfile(
  catalog: ScenarioCatalog,
  claimedProfile: ProtocolProfile,
): readonly ScenarioMetadata[] {
  const retired = retiredScenarioIds(catalog, claimedProfile);
  return catalog.scenarios.filter(
    (scenario) =>
      profileIncludes(claimedProfile, scenario.requiredProfile) && !retired.has(scenario.id),
  );
}

/** Only normative obligations that may contribute to a conformance claim. */
export function selectNormativeScenariosForProfile(
  catalog: ScenarioCatalog,
  claimedProfile: ProtocolProfile,
): readonly ScenarioMetadata[] {
  return selectApplicableScenariosForProfile(catalog, claimedProfile).filter(
    ({ kind }) => kind === "normative",
  );
}

/** Only implementation/harness diagnostics applicable to a claimed profile. */
export function selectDiagnosticScenariosForProfile(
  catalog: ScenarioCatalog,
  claimedProfile: ProtocolProfile,
): readonly ScenarioMetadata[] {
  return selectApplicableScenariosForProfile(catalog, claimedProfile).filter(
    ({ kind }) => kind === "diagnostic",
  );
}

function profileRank(profile: ProtocolProfile): number {
  const rank = PROTOCOL_PROFILES.indexOf(profile);
  if (rank < 0) throw new RangeError("profile must be a member of PROTOCOL_PROFILES");
  return rank;
}
