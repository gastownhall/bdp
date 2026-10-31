/** Test-only cumulative cohort. No descriptor installation through BDP requests. */
import {
  parseCanonicalScope,
  parseTypeDescriptor,
  stringifyJsonValue,
  type TypeDescriptor,
} from "@bdp/protocol";

export function schemaCohortArtifacts(scopeInput: string) {
  const scope = parseCanonicalScope(scopeInput);
  const descriptors: TypeDescriptor[] = [];
  const schemas: { retrievalUri: string; utf8: string }[] = [];
  for (const kind of ["bead", "link"] as const) {
    for (const level of ["base", "child"] as const) {
      const segment = `schema-${kind}-${level}`;
      const schemaId = `${scope}schemas/${segment}`;
      descriptors.push(
        parseTypeDescriptor({
          id: `${scope}types/${segment}`,
          name: `Schema ${kind} ${level}`,
          describes: kind,
          conformsTo: level === "base" ? [] : [`${scope}types/schema-${kind}-base`],
          propertiesSchema: schemaId,
          ...(kind === "link"
            ? {
                source: { conformsTo: [`${scope}types/task`], external: "none" },
                target: { conformsTo: [`${scope}types/task`], external: "none" },
              }
            : {}),
        }),
      );
      const body = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: schemaId,
        type: "object",
        ...(level === "base"
          ? {
              required: ["n"],
              properties: { n: { type: "integer", minimum: 0 } },
            }
          : {
              required: ["enabled"],
              properties: { enabled: { type: "boolean" }, detail: { type: "string" } },
              if: { properties: { enabled: { const: true } } },
              // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then vocabulary
              then: { required: ["detail"] },
            }),
      };
      schemas.push({ retrievalUri: schemaId, utf8: stringifyJsonValue(body) });
    }
  }
  return { descriptors, schemas };
}

export function withSchemaCohort(
  configuration: Record<string, unknown>,
  shipped: readonly TypeDescriptor[],
) {
  if (typeof configuration.scope !== "string") throw new TypeError("cohort Scope required");
  const additions = schemaCohortArtifacts(configuration.scope);
  return {
    ...configuration,
    contracts: {
      descriptors: [...shipped, ...additions.descriptors].map((descriptor) => ({
        retrievalUri: descriptor.id,
        utf8: stringifyJsonValue(descriptor),
      })),
      schemas: additions.schemas,
    },
  };
}
