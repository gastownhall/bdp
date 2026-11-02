# Bead type: A recorded work item definition

Format: bdp-type-markdown-0.1
Mode: recorded

## Definition

| Field | Value (JSON) |
| --- | --- |
| id | "https://types.example/work-item" |
| revision | "work-2" |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/bead-type","revision":"bead-type-2"} |

## Descriptor

| Field | Value (JSON) |
| --- | --- |
| description | "Recorded exact definition; the local properties schema is absent." |
| version | "1.0.0" |
| abstract | false |
| x-preserved | {"empty":"","false":false,"zero":0,"null":null} |

## Property access

| Pointer | Access |
| --- | --- |

## Incoming

| Selector | Min | Max |
| --- | --- | --- |

## Owns outgoing

| Selector |
| --- |

## Metadata

```json
{"review":"captured"}
```

## Refines

### Declaration: exact-base

| Field | Value (JSON) |
| --- | --- |
| id | "https://types.example/work-item-refines-base" |
| revision | "declaration-2" |
| type | {"uri":"https://github.com/gastownhall/bdp/types/type-system/refines","revision":"refines-2"} |
| source | "https://types.example/work-item" |
| target | {"uri":"https://types.example/base-work-item","revision":"base-1"} |

#### Properties

```json
{"evidence":"Retained authored declaration."}
```

#### Metadata

```json
{}
```
