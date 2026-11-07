# Link type: delegated-from (preview-1 authoring intent)

```text
Format: bdp-type-markdown-0.1
Mode: authoring
```

## Definition

| Field | Value (JSON) |
| --- | --- |
| id | "https://github.com/gastownhall/bdp/types/dependency/delegated-from" |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/link-type","revision":"link-type-2"} |

## Descriptor

| Field | Value (JSON) |
| --- | --- |
| description | "The native delegation relation; command and domain behavior is not supplied by its spelling." |
| version | "preview-1" |

## Endpoint pairs

| Source kind | Source scope | Source selector | Target kind | Target scope | Target selector |
| --- | --- | --- | --- | --- | --- |
| bead | same | issues | bead | same | issues |
| bead | same | issues | resource | — | — |

## Selectors

| Name | Match | Type URI | Revision (JSON) |
| --- | --- | --- | --- |
| issues | family | https://github.com/gastownhall/bdp/types/issue/issue | — |

## Refines

### Declaration: dependency

| Field | Value (JSON) |
| --- | --- |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/refines","revision":"refines-2"} |
| target | {"uri":"https://github.com/gastownhall/bdp/types/dependency/dependency","revision":"dependency-preview-1"} |

#### Properties

```json
{}
```
