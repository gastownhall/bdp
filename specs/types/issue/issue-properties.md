# "issueProperties"

Format: markdown-json-schema/0.6

<a id="schema-root"></a>
## Root schema

Value: object

Other fields: allowed

Required order: ["title","status","priority"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Properties of an Issue record: the durable work fields with their native names and meanings. The root is open so that every durable native field survives projection; the native classification discriminator is refused because affiliation is the record's type." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "acceptance_criteria" | text | no | — | "Existing acceptance text." |
| "assignee" | schema | no | — | "The actor currently holding the Issue, if any; empty and unset follow native assignment behavior." |
| "close_reason" | text | no | — | "Why the Issue was closed; set by the close operation." |
| "closed_at" | schema | no | — | "When the Issue was closed; required by native validation exactly when status is the literal closed." |
| "created_at" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/dateTime" | no | — | "Creation time, set by the provider." |
| "created_by" | text | no | — | "Native creator string; not a BDP attribution." |
| "defer_until" | schema | no | — | "Scheduling exclusion until this time; not deletion." |
| "description" | text | no | — | "Main work description." |
| "design" | text | no | — | "Existing design text." |
| "due_at" | schema | no | — | "Intended completion time; not a command to close." |
| "estimated_minutes" | schema | no | — | "Optional nonnegative estimate; zero is a real estimate and null clears it." |
| "external_ref" | schema | no | — | "Literal integration reference; neither a URI nor a BDP Reference by itself." |
| "labels" | schema | no | — | "Distinct nonempty label strings on the record; edits are ordinary property patches and version the record." |
| "notes" | text | no | — | "Existing notes text; append and replacement are distinct native operations." |
| "owner" | schema | no | — | "Human owner; not the revision writer or the authenticated principal." |
| "priority" | schema | yes | — | "Integer 0 to 4; 0 is P0, never absence." |
| "spec_id" | text | no | — | "Literal specification reference; no URI coercion." |
| "started_at" | schema | no | — | "When work started; set by the claim operation." |
| "status" | schema | yes | — | "Workflow status: a built-in value or a configured custom value, admitted by the provider's configuration, never by this schema." |
| "title" | schema | yes | — | "Nonempty title; the provider's native byte bound is a native admission rule." |
| "updated_at" | ref "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json#/$defs/dateTime" | no | — | "Last change time, set by the provider on every committed change." |

### Advanced

```json-schema
{
  "not": {"required": ["issue_type"]},
  "properties": {
    "assignee": {"type": "string", "maxLength": 255},
    "closed_at": {"type": ["string", "null"], "format": "date-time"},
    "defer_until": {"type": ["string", "null"], "format": "date-time"},
    "due_at": {"type": ["string", "null"], "format": "date-time"},
    "estimated_minutes": {"type": ["integer", "null"], "minimum": 0},
    "external_ref": {"type": ["string", "null"]},
    "labels": {"type": "array", "items": {"type": "string", "minLength": 1}, "uniqueItems": true},
    "owner": {"type": "string", "maxLength": 255},
    "priority": {"type": "integer", "minimum": 0, "maximum": 4},
    "started_at": {"type": ["string", "null"], "format": "date-time"},
    "status": {"type": "string", "minLength": 1},
    "title": {"type": "string", "minLength": 1}
  }
}
```
