/** Private harness definitions for the actual transport wrapper's body.
 * Normative definitions are cloned unchanged; these are not protocol schemas. */
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
export const installedObservationSchema = {
  ...structuredClone(schema),
  $defs: {
    ...structuredClone(schema.$defs),
    ...Object.fromEntries(
      [
        "mutationResult",
        "sequenceResponse",
        "aliasResult",
        "currentBeadRecord",
        "currentLinkRecord",
        "readProblem",
        "readUpdateProblem",
      ].map((definition) => [
        `harnessInstalled_${definition}`,
        {
          type: "object",
          required: ["body"],
          properties: { body: { $ref: `#/$defs/${definition}` } },
        },
      ]),
    ),
  },
};
