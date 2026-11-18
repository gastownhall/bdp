# "Callable declaration"

Format: markdown-json-schema/0.6

<a id="schema-root"></a>
## Root schema

Value: object

Required order: ["parameters","resultSchema","errorSchema"]

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "description" | text | no | — | — |
| "errorSchema" | true | yes | — | — |
| "modes" | schema | no | — | — |
| "parameters" | schema | yes | — | — |
| "resultSchema" | true | yes | — | — |
| "title" | text | no | — | — |

### Advanced

```json-schema
{
  "properties": {
    "modes": {
      "type": "array",
      "items": {
        "enum": [
          "sync",
          "async"
        ]
      },
      "uniqueItems": true
    },
    "parameters": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "schema": true,
          "required": {
            "type": "boolean"
          },
          "default": true,
          "description": {
            "type": "string"
          }
        },
        "required": [
          "name",
          "schema"
        ],
        "additionalProperties": false
      }
    }
  }
}
```
