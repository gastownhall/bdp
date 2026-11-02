# Link type: Reviewed reference

Format: bdp-type-markdown-0.1
Mode: authoring

## Definition

| Field | Value (JSON) |
| --- | --- |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/link-type","revision":"link-type-2"} |

## Descriptor

| Field | Value (JSON) |
| --- | --- |
| description | "A reviewed relationship with a whole endpoint-pair contract." |
| version | "0.1.0" |
| abstract | false |
| x-editor | {"state":"draft","identityAssigned":false} |

## Properties schema

Source: JSON: reviewed-reference-properties.schema.json

## Schema resources

| Retrieval URI | Source |
| --- | --- |
| https://schemas.example/shared-fields.json | JSON: shared-fields.schema.json |

## Selectors

| Name | Match | Type URI | Revision (JSON) |
| --- | --- | --- | --- |
| work-items | family | https://types.example/work-item | "work-2" |
| notes | family | https://types.example/note | — |

## Property access

| Pointer | Access |
| --- | --- |
| /annotation | writable |

## Link constraints

| Field | Value (JSON) |
| --- | --- |
| sourceMax | 4 |
| targetMax | 8 |
| unique | false |
| acyclic | true |
| allowSelf | false |

## Endpoint pairs

| Source kind | Source scope | Source selector | Target kind | Target scope | Target selector |
| --- | --- | --- | --- | --- | --- |
| bead | same | work-items | bead | either | notes |
| bead | same | notes | resource | — | — |

## Metadata

```json
{"review":{"status":"draft"}}
```

## Refines

### Declaration: reference-parent

| Field | Value (JSON) |
| --- | --- |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/refines","revision":"refines-2"} |
| target | {"uri":"https://types.example/reference","revision":"reference-1"} |

#### Properties

```json
{}
```
