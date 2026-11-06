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
| description | "The properties object of every Callable declaration Bead: help, declared parameters, the result and error schemas, and any CLI additions. The root is open; a body is refused in this edition, and the binding from a name to an implementation is no part of a declaration." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "atomic" | boolean | no | — | "True when the operation commits all its effects or none; false when absent. Meaningful for a CallableBatch." |
| "cliMapping" | ref "#/$defs/cliMapping" | no | — | "Additions to the CLI form derived from parameters." |
| "description" | text | yes | — | "Standard help for the operation; an empty string is admitted and differs from absence." |
| "errorSchema" | ref "#/$defs/valueSchema" | no | — | "Schema of the value in a callable-error Problem's error member; absent means any JSON value." |
| "idempotent" | boolean | no | — | "True when repeating an invocation with the same arguments has no further effect, even if the result differs; false when absent. Meaningful for a CallableBatch." |
| "parameters" | array of (ref "#/$defs/parameter") | yes | — | "Declared named arguments; an empty array is admitted; names are distinct within one declaration." |
| "resultSchema" | ref "#/$defs/valueSchema" | no | — | "Schema of the invocation result; absent means any JSON value." |
| "title" | text | no | — | "Short human-readable name; the name itself is the local Resource ID." |

### Advanced

```json-schema
{
  "not": {"required": ["body"]}
}
```

<a id="schema-def-InZhbHVlU2NoZW1hIg"></a>
## Schema: "valueSchema"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An embedded JSON Schema Draft 2020-12 value: an object or a boolean. It validates one argument, one result or one error value; it establishes no Resource kind, Type membership or authorization. Every $ref resolves inside the document that carries it." |
| type | ["object","boolean"] |

<a id="schema-def-InBhcmFtZXRlciI"></a>
## Schema: "parameter"

Value: object

Other fields: not allowed

Required order: ["name","schema"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One declared argument of a Callable. Names are distinct within one declaration; a required parameter carries no default." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "default" | any | no | — | "The value supplied for an omitted argument; it must satisfy schema. Omission of this member is distinguishable from an explicit null default." |
| "description" | text | no | — | "Parameter help, reused by the CLI and OpenAPI projections." |
| "name" | schema | yes | — | "Nonempty exact argument name." |
| "required" | boolean | no | — | "Whether the argument must be supplied; false when absent." |
| "schema" | ref "#/$defs/valueSchema" | yes | — | "The argument's value schema." |

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
| description | "Adds one or more aliases, CLI flag spellings, for a declared parameter." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "names" | schema | yes | — | "Distinct nonempty flag spellings, such as -l." |
| "parameter" | schema | yes | — | "The name of a declared parameter of the same declaration." |

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
| "parameter" | schema | yes | — | "The name of a declared parameter of the same declaration." |
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

<a id="schema-def-ImZpbGVNYXBwaW5nIg"></a>
## Schema: "fileMapping"

Value: object

Other fields: not allowed

Required order: ["names","parameter"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Names flags that read a declared parameter's value from a file. The flag's value is a path, and - means stdin." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "names" | schema | yes | — | "Distinct nonempty flag spellings, such as --body-file." |
| "parameter" | schema | yes | — | "The name of a declared parameter of the same declaration." |

### Advanced

```json-schema
{
  "properties": {
    "names": {"type": "array", "minItems": 1, "uniqueItems": true, "items": {"type": "string", "minLength": 1}},
    "parameter": {"type": "string", "minLength": 1}
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
| description | "Additions to the CLI form derived from parameters. It chooses no command route and grants nothing; duplicate flags or positions, or a defaults member that names no parameter or fails its schema, make a declaration invalid." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "defaults" | object | no | — | "Parameter values the client sends when the invocation does not supply that parameter. An explicit flag or arguments member overrides one. CLI-only: it does not change what an HTTP caller gets when it omits a parameter." |
| "flags" | array of (ref "#/$defs/flagMapping") | no | — | "Aliases: additional flag spellings for parameters." |
| "fromFile" | array of (ref "#/$defs/fileMapping") | no | — | "Parameters whose value the client reads from a file or stdin." |
| "positionals" | array of (ref "#/$defs/positionalMapping") | no | — | "Positions mapped onto parameters." |
