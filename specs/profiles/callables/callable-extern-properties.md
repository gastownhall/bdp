# "callableExternProperties"

Format: markdown-json-schema/0.6

<a id="schema-root"></a>
## Root schema

Value: object

Definitions: present

Other fields: allowed

Required order: ["extern"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The local properties contract of callable-query and callable-batch in preview-1: an extern binding is required and a stored body is refused." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "extern" | ref "#/$defs/externBinding" | yes | — | "The implementation this definition invokes." |

### Advanced

```json-schema
{
  "not": {"required": ["body"]}
}
```

<a id="schema-def-ImV4dGVybkJpbmRpbmci"></a>
## Schema: "externBinding"

Value: object

Other fields: not allowed

Required order: ["binding"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The service-side implementation a definition binds to. The binding is an opaque name in the provider's registry; it freezes no behavior by itself." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "binding" | schema | yes | — | "Nonempty name in the provider's implementation registry." |
| "version" | schema | no | — | "Informational label distinguishing implementation editions; no ordering or compatibility meaning." |

### Advanced

```json-schema
{
  "properties": {
    "binding": {"type": "string", "minLength": 1},
    "version": {"type": "string", "minLength": 1}
  }
}
```
