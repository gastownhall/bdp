# "dependencyProperties"

Format: markdown-json-schema/0.6

<a id="schema-root"></a>
## Root schema

Value: object

Other fields: allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Properties of a Dependency Link record. The root is open; the native kind discriminator is refused because the kind is the Link's type affiliation. Edge metadata is the Link's common metadata, not a property." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "created_at" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/dateTime" | no | — | "Row creation time, set by the provider." |
| "created_by" | text | no | — | "Native creator string; not a BDP attribution." |
| "thread_id" | text | no | — | "Conversation grouping field carried from the native row; writable." |

### Advanced

```json-schema
{
  "not": {"required": ["dep_type"]}
}
```
