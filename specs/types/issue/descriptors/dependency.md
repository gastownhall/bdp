# Link type: dependency (preview-1 authoring intent)

```text
Format: bdp-type-markdown-0.1
Mode: authoring
```

## Definition

| Field | Value (JSON) |
| --- | --- |
| id | "https://github.com/gastownhall/bdp/types/dependency/dependency" |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/link-type","revision":"link-type-2"} |

## Descriptor

| Field | Value (JSON) |
| --- | --- |
| description | "A relationship between two work records." |
| version | "preview-1" |
| abstract | true |

## Properties schema

Source: Markdown: ../dependency-properties.md

## Selectors

| Name | Match | Type URI | Revision (JSON) |
| --- | --- | --- | --- |
| issues | family | https://github.com/gastownhall/bdp/types/issue/issue | — |

## Property access

| Pointer | Access |
| --- | --- |
| /created_at | service-managed |
| /created_by | service-managed |

## Link constraints

| Field | Value (JSON) |
| --- | --- |
| unique | true |
| allowSelf | false |

## Endpoint pairs

| Source kind | Source scope | Source selector | Target kind | Target scope | Target selector |
| --- | --- | --- | --- | --- | --- |
| bead | same | issues | bead | same | issues |
| bead | same | issues | resource | — | — |

## Refines
