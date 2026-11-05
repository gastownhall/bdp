# "callableProperties"

Format: markdown-json-schema/0.6

<a id="schema-root"></a>
## Root schema

Value: object

Definitions: present

Other fields: allowed

Required order: ["description","parameters"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The properties object of every Callable definition Bead: help, declared parameters, the result schema and the optional CLI projection. The root is open so that refinements add their implementation member." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "cliMapping" | ref "#/$defs/cliMapping" | no | — | "Declarative CLI projection; it chooses no command route and grants nothing." |
| "description" | text | yes | — | "Standard help for the operation; an empty string is admitted and differs from absence." |
| "parameters" | array of (ref "#/$defs/parameter") | yes | — | "Declared named arguments; an empty array is admitted; names are distinct within one definition." |
| "result" | ref "#/$defs/valueSchema" | no | — | "Schema of the invocation result; absent means any JSON value." |

<a id="schema-def-InZhbHVlU2NoZW1hIg"></a>
## Schema: "valueSchema"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An embedded JSON Schema Draft 2020-12 value: an object or a boolean. It validates one argument or one result; it establishes no Resource kind, Type membership or authorization." |
| type | ["object","boolean"] |

<a id="schema-def-InBhcmFtZXRlciI"></a>
## Schema: "parameter"

Value: object

Other fields: not allowed

Required order: ["name","schema"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One declared argument of a Callable. Names are distinct within one definition; a required parameter carries no default." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "default" | any | no | — | "The value substituted for an omitted argument; it must satisfy schema. Omission of this member is distinguishable from an explicit null default." |
| "description" | text | no | — | "Parameter help, reused by CLI mappings." |
| "name" | schema | yes | — | "Nonempty exact argument name." |
| "required" | boolean | no | — | "Whether the argument must be supplied; false when absent." |
| "schema" | ref "#/$defs/valueSchema" | yes | — | "The argument's value schema; the selected parameter decision of October 30, 2026." |

### Advanced

```json-schema
{
  "properties": {
    "name": {"type": "string", "minLength": 1}
  }
}
```

<a id="schema-def-ImZsYWdNYXBwaW5nIg"></a>
## Schema: "flagMapping"

Value: object

Other fields: not allowed

Required order: ["names","parameter"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Maps one or more CLI flag spellings onto a declared parameter." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "names" | schema | yes | — | "Distinct nonempty flag spellings, such as --limit and -l." |
| "parameter" | schema | yes | — | "The name of a declared parameter of the same definition." |

### Advanced

```json-schema
{
  "properties": {
    "names": {"type": "array", "minItems": 1, "uniqueItems": true, "items": {"type": "string", "minLength": 1}},
    "parameter": {"type": "string", "minLength": 1}
  }
}
```

<a id="schema-def-InBvc2l0aW9uYWxNYXBwaW5nIg"></a>
## Schema: "positionalMapping"

Value: object

Other fields: not allowed

Required order: ["position","parameter"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Maps one zero-based CLI position onto a declared parameter." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "parameter" | schema | yes | — | "The name of a declared parameter of the same definition." |
| "position" | schema | yes | — | "Zero-based argument position." |

### Advanced

```json-schema
{
  "properties": {
    "parameter": {"type": "string", "minLength": 1},
    "position": {"type": "integer", "minimum": 0}
  }
}
```

<a id="schema-def-ImNsaU1hcHBpbmci"></a>
## Schema: "cliMapping"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Declarative flag and positional projection for clients. It chooses no command route and grants nothing; duplicate flags or positions refuse registration." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "flags" | array of (ref "#/$defs/flagMapping") | no | — | "Flag spellings mapped onto parameters." |
| "positionals" | array of (ref "#/$defs/positionalMapping") | no | — | "Positions mapped onto parameters." |
