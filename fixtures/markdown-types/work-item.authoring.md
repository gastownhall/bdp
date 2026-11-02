# Bead type: Work item

Format: bdp-type-markdown-0.1
Mode: authoring

## Definition

| Field | Value (JSON) |
| --- | --- |
| id | "https://types.example/work-item" |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/bead-type","revision":"bead-type-2"} |

## Descriptor

| Field | Value (JSON) |
| --- | --- |
| description | "" |
| version | "1.0.0-draft+types" |
| abstract | false |
| x-review | {"stage":"draft","notes":[]} |

## Properties schema

Source: Markdown: work-item-properties.md

## Schema resources

| Retrieval URI | Source |
| --- | --- |

## Selectors

| Name | Match | Type URI | Revision (JSON) |
| --- | --- | --- | --- |
| references | family | https://types.example/reference | — |

## Property access

| Pointer | Access |
| --- | --- |
| /referenceCode | init-only |
| /computedScore | service-managed |

## Incoming

| Selector | Min | Max |
| --- | --- | --- |
| references | 0 | 5 |

## Outgoing

| Selector | Min | Max |
| --- | --- | --- |
| references | 1 | — |

## Owns outgoing

| Selector |
| --- |
| references |

## Metadata

```json
{}
```

## Refines

### Declaration: base-work-item

| Field | Value (JSON) |
| --- | --- |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/refines","revision":"refines-2"} |
| target | {"uri":"https://types.example/base-work-item","revision":"base-1"} |

#### Properties

```json
{"evidence":"Author declares the base contract."}
```

#### Metadata

```json
{}
```
