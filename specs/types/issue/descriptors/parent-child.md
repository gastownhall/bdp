# Link type: parent-child (preview-1 authoring intent)

```text
Format: bdp-type-markdown-0.1
Mode: authoring
```

## Definition

| Field | Value (JSON) |
| --- | --- |
| id | "https://github.com/gastownhall/bdp/types/dependency/parent-child" |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/link-type","revision":"link-type-2"} |

## Descriptor

| Field | Value (JSON) |
| --- | --- |
| description | "Child-to-parent hierarchy: the source is the child and the target the parent. It participates in readiness propagation but is not an ordinary hard-blocking edge. It refuses an external target." |
| version | "preview-1" |

## Endpoint pairs

| Source kind | Source scope | Source selector | Target kind | Target scope | Target selector |
| --- | --- | --- | --- | --- | --- |
| bead | same | issues | bead | same | issues |

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
