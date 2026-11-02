# "WorkItemProperties"

Format: markdown-json-schema/0.6

<a id="schema-root"></a>
## Root schema

Value: object

Required order: ["name"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| $schema | "https://json-schema.org/draft/2020-12/schema" |
| title | "WorkItemProperties" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "computedScore" | number | no | "WorkItem" | "A value supplied by the service." |
| "name" | text | yes | "WorkItem" | "A short human-readable name." |
| "referenceCode" | text | no | "WorkItem" | "The caller's initial reference code." |
