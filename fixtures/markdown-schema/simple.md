# "Simple"

Format: markdown-json-schema/0.6

<a id="schema-root"></a>
## Root schema

Value: object

Definitions: present

Other fields: not allowed

Required order: ["name"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| $id | "https://schemas.invalid/simple.json" |
| $schema | "https://json-schema.org/draft/2020-12/schema" |
| title | "Simple" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "name" | text | yes | "Notice" | "A name." |
| "token" | ref "#/$defs/Token" | no | — | — |

<a id="schema-def-IlRva2VuIg"></a>
## Schema: "Token"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| minLength | 1 |
| type | "string" |
