/** Private observation wrappers; normative collection definitions stay unchanged. */
import { installedObservationSchema } from "./installed-body-schema.js";
export const cumulativeRUObservationSchema = {
  ...structuredClone(installedObservationSchema),
  $defs: {
    ...structuredClone(installedObservationSchema.$defs),
    ...Object.fromEntries(
      ["currentBeadCollection", "currentLinkCollection"].map((name) => [
        `harnessCumulative_${name}`,
        { type: "object", required: ["body"], properties: { body: { $ref: `#/$defs/${name}` } } },
      ]),
    ),
  },
};
