# Link type: Refines (publication2 source record)

```text
Format: bdp-type-markdown-0.1
Mode: recorded
```

## Definition

| Field | Value (JSON) |
| --- | --- |
| id | "https://github.com/gastownhall/bdp/types/type-system/refines" |
| revision | "refines-2" |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/link-type","revision":"link-type-2"} |

## Properties schema

Source: JSON: ../intrinsic-2/refines.properties.schema.json

## Schema resources

| Retrieval URI | Source |
| --- | --- |
| https://json-schema.org/draft/2020-12/meta/applicator | JSON: schema-resources/applicator.schema.json |
| https://json-schema.org/draft/2020-12/meta/content | JSON: schema-resources/content.schema.json |
| https://json-schema.org/draft/2020-12/meta/core | JSON: schema-resources/core.schema.json |
| https://json-schema.org/draft/2020-12/meta/format-annotation | JSON: schema-resources/format-annotation.schema.json |
| https://json-schema.org/draft/2020-12/meta/meta-data | JSON: schema-resources/meta-data.schema.json |
| https://json-schema.org/draft/2020-12/meta/unevaluated | JSON: schema-resources/unevaluated.schema.json |
| https://json-schema.org/draft/2020-12/meta/validation | JSON: schema-resources/validation.schema.json |
| https://json-schema.org/draft/2020-12/schema | JSON: schema-resources/schema.schema.json |

## Selectors

| Name | Match | Type URI | Revision (JSON) |
| --- | --- | --- | --- |
| bead-type | family | https://github.com/gastownhall/bdp/types/type-system/bead-type | "bead-type-2" |
| link-type | family | https://github.com/gastownhall/bdp/types/type-system/link-type | "link-type-2" |

## Endpoint pairs

| Source kind | Source scope | Source selector | Target kind | Target scope | Target selector |
| --- | --- | --- | --- | --- | --- |
| bead | either | bead-type | bead | either | bead-type |
| bead | either | link-type | bead | either | link-type |

## Refines
