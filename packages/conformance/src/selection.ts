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

/** All catalog entries applicable to a claimed profile, preserving catalog order. */
export function selectApplicableScenariosForProfile(
  catalog: ScenarioCatalog,
  claimedProfile: ProtocolProfile,
): readonly ScenarioMetadata[] {
  profileRank(claimedProfile);
  return catalog.scenarios.filter((scenario) =>
    profileIncludes(claimedProfile, scenario.requiredProfile),
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
