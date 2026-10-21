/** One fixed source-selected RU campaign policy; credentials are owned once by its caller. */
import type { TypeDescriptor } from "@bdp/protocol";
import { withSchemaCohort } from "./installed-schema-cohort.js";
export type RUCampaignCredentials = Readonly<Record<"operator" | "restricted" | "other", string>>;
export function cumulativeRUConfiguration(
  base: Record<string, unknown>,
  descriptors: readonly TypeDescriptor[],
  credentials: RUCampaignCredentials,
) {
  if (typeof base.scope !== "string") throw Error("fixed campaign Scope required");
  return {
    ...withSchemaCohort(base, descriptors),
    credentials: (["operator", "restricted", "other"] as const).map((principal) => ({
      principal,
      token: credentials[principal],
    })),
    policies: {
      operator: { create: true, write: true, hidden: [], readOnly: [] },
      restricted: {
        create: true,
        write: true,
        hidden: ["beads/ru-hidden", "links/ru-hidden-link"],
        readOnly: ["beads/ru-read-only"],
      },
      other: { create: true, write: true, hidden: [], readOnly: [] },
    },
    maximumEndpointMultiplicity: [
      { endpoint: "source", linkConformsTo: `${base.scope}types/relates`, max: 8 },
    ],
  };
}
