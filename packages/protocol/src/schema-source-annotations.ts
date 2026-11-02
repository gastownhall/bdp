import type { Ajv2020 } from "ajv/dist/2020.js";

/** Admit only BDP's passive schema-authoring metadata; instance assertions and
 * unknown keywords retain the caller's strict Ajv policy. This selects no wire
 * profile or optional feature and does not mutate the source schema resource.
 */
export function withBdpSourceAnnotations<Validator extends Ajv2020>(
  validator: Validator,
): Validator {
  const names = { type: "array", items: { type: "string" }, uniqueItems: true };
  for (const keyword of ["x-bdp-schema-definitions", "x-bdp-core-definitions"])
    validator.addKeyword({ keyword, schemaType: "array", metaSchema: names, valid: true });
  validator.addKeyword({
    keyword: "x-bdp-schema-sources",
    schemaType: "object",
    metaSchema: { type: "object", additionalProperties: names },
    valid: true,
  });
  return validator;
}
