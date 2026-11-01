# "Complete BDP v0.1 schema bundle"

Format: markdown-json-schema/0.6

<a id="schema-root"></a>
## Root schema

Value: object

Definitions: present

### Keywords

| Keyword | JSON value |
| --- | --- |
| $id | "https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json" |
| $schema | "https://json-schema.org/draft/2020-12/schema" |
| description | "Staged JSON Schema2020-12 artifact for the v0.1 selected-contract binding. Version and optional capability discovery are explicit; remaining inherited profile, Type, Event and advanced grammar is not an adoption or retention commitment. Complete retained-surface composition is required before advertising v0.1. The separate v0 artifact remains unchanged for held runtime/evidence." |
| title | "BDP v0.1 staged schema bundle" |
| x-bdp-core-definitions | ["absoluteHttpUrl","absoluteUri","bdpVersion","beadCollection","beadRecord","capabilityAdvertisements","capabilityVersionAdvertisements","contextMessage","contextString","contextTime","coreAdvertisedLimits","coreDiscovery","countResult","currentBeadCollection","currentBeadRecord","currentLinkCollection","currentLinkRecord","dateTime","exactTypeDefinitionRecord","historicalBeadRecord","historicalLinkRecord","historyCapability","historyMissing","historyMissingItem","historyVersionRow","historyVersionsPage","historyWindow","iso8601Duration","jsonPointer","linkCollection","linkRecord","maximumEndpointMultiplicityPolicy","metadata","pinnedReference","pinnedTypeReference","positiveInteger","projectedBeadCollection","projectedBeadRecord","projectedLinkCollection","projectedLinkRecord","properties","readProblem","readProblemCode","reference","resourceIdentity","resourceKind","resourceProjectionCapabilityProblem","resourceProjectionCapabilityV1","resourceProjectionInventoryQueryV1","resourceProjectionMask","resourceProjectionPointQueryV1","resourceProjectionProblem","resourceProjectionSelection","retainedDeltaEffect","retainedDeltaEvent","retainedEvent","retainedEventCommon","retainedEventCoverage","retainedEventDeleted","retainedEventDerived","retainedEventPage","retainedEventPolicy","retainedEventProblem","retainedEventQuery","retainedEventSelection","retainedPostimageEffect","retainedPostimageEvent","retryDisposition","revision","revisionActor","revisionProvenance","selector","typeDefinitionReadCapabilityProblem","typeDefinitionReadCapabilityV1","typeDefinitionReadProblem","typeDefinitionReadQueryV1","typeDefinitionReadResult","typeDefinitionReadSelection","typeReference","wireToken"] |

<a id="schema-def-ImFic29sdXRlSHR0cFVybCI"></a>
## Schema: "absoluteHttpUrl"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Absolute HTTP(S) URL used for canonical in-Scope identities and discovered navigation. Equality, canonical path spelling, ownership and non-reuse are additionally governed by the Scope rules." |
| format | "uri" |
| pattern | "^https?://.+" |
| type | "string" |

<a id="schema-def-ImFic29sdXRlVXJpIg"></a>
## Schema: "absoluteUri"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Absolute URI carried for an opaque out-of-Scope Link endpoint or other explicitly URI-valued context. This syntax supplies no existence, kind, access or immutability guarantee." |
| format | "uri" |
| pattern | "^[A-Za-z][A-Za-z0-9+.-]*:" |
| type | "string" |

<a id="schema-def-ImFkdmVydGlzZWRMaW1pdHMi"></a>
## Schema: "advertisedLimits"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "page" | schema | no | — | — |
| "patch" | schema | no | — | — |
| "request" | schema | no | — | — |
| "resource" | schema | no | — | — |
| "retention" | schema | no | — | — |
| "selector" | schema | no | — | — |
| "sequence" | schema | no | — | — |
| "transaction" | schema | no | — | — |

### Advanced

```json-schema
{
  "properties": {
    "page": {
      "type": "object",
      "properties": {
        "defaultItems": {
          "$ref": "#/$defs/positiveInteger"
        },
        "maximumItems": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "patch": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathDepth": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "request": {
      "type": "object",
      "properties": {
        "targetBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "bodyBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "resource": {
      "type": "object",
      "properties": {
        "representationBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "propertiesBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "retention": {
      "type": "object",
      "properties": {
        "idempotency": {
          "$ref": "#/$defs/iso8601Duration"
        },
        "receipt": {
          "$ref": "#/$defs/iso8601Duration"
        },
        "maximumSnapshotLifetime": {
          "$ref": "#/$defs/iso8601Duration"
        },
        "replay": {
          "$ref": "#/$defs/iso8601Duration"
        }
      },
      "additionalProperties": false
    },
    "selector": {
      "type": "object",
      "properties": {
        "bytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "depth": {
          "$ref": "#/$defs/positiveInteger"
        },
        "nodes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "sequence": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "transaction": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        },
        "examinedResources": {
          "$ref": "#/$defs/positiveInteger"
        },
        "matchedResources": {
          "$ref": "#/$defs/positiveInteger"
        },
        "mutatedResources": {
          "$ref": "#/$defs/positiveInteger"
        },
        "inducedEvents": {
          "$ref": "#/$defs/positiveInteger"
        },
        "duration": {
          "$ref": "#/$defs/iso8601Duration"
        }
      },
      "additionalProperties": false
    }
  }
}
```

<a id="schema-def-ImFsaWFzUmVzdWx0Ig"></a>
## Schema: "aliasResult"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Read+Update alias result" |
| type | "object" |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/aliasResultMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-ImFsaWFzUmVzdWx0TWVtYmVycyI"></a>
## Schema: "aliasResultMembers"

Value: object

Required order: ["outcome","alias"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "alias" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "outcome" | ref "#/$defs/mutationOutcome" | yes | — | — |
| "target" | ref "#/$defs/absoluteHttpUrl" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "outcome": {
            "const": "deleted"
          }
        },
        "required": [
          "outcome"
        ]
      },
      "then": {
        "properties": {
          "target": false
        }
      },
      "else": {
        "required": [
          "target"
        ]
      }
    }
  ]
}
```

<a id="schema-def-ImFsbG9jYXRlZElkZW50aXR5Ig"></a>
## Schema: "allocatedIdentity"

Value: object

Other fields: not allowed

Required order: ["operationIndex"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "operationIndex" | schema | yes | — | — |
| "operationName" | ref "#/$defs/localName" | no | — | — |
| "type" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "withheld" | schema | no | — | — |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "required": [
        "id",
        "type"
      ],
      "properties": {
        "id": true,
        "type": true,
        "withheld": false
      }
    },
    {
      "required": [
        "withheld"
      ],
      "properties": {
        "withheld": true,
        "id": false,
        "type": false
      }
    }
  ],
  "properties": {
    "operationIndex": {
      "type": "integer",
      "minimum": 0
    },
    "withheld": {
      "const": true
    }
  }
}
```

<a id="schema-def-ImF0b21pY0JhdGNoQ2FwYWJpbGl0eVByb2JsZW0i"></a>
## Schema: "atomicBatchCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","capability","capabilityVersion","pointer"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | — |
| "capabilityVersion" | schema | yes | — | — |
| "code" | schema | yes | — | — |
| "detail" | text | no | — | — |
| "instance" | ref "#/$defs/absoluteUri" | no | — | — |
| "pointer" | schema | yes | — | — |
| "retry" | schema | yes | — | — |
| "status" | schema | yes | — | — |
| "title" | text | no | — | — |
| "type" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/atomic-batch"
    },
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    },
    "code": {
      "const": "capability-not-supported"
    },
    "pointer": {
      "const": "/capabilityVersion"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```

<a id="schema-def-ImF0b21pY0JhdGNoQ2FwYWJpbGl0eVYxIg"></a>
## Schema: "atomicBatchCapabilityV1"

Value: object

Other fields: not allowed

Required order: ["operation","operations"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "maximumOperations" | schema | no | — | — |
| "maximumResultBytes" | schema | no | — | — |
| "operation" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "operations" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "maximumOperations": {
      "type": "integer",
      "minimum": 1
    },
    "maximumResultBytes": {
      "type": "integer",
      "minimum": 1
    },
    "operations": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "#/$defs/atomicBatchOperationName"
      }
    }
  }
}
```

<a id="schema-def-ImF0b21pY0JhdGNoT3BlcmF0aW9uTmFtZSI"></a>
## Schema: "atomicBatchOperationName"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["createBead","updateBead","deleteBead","createLink","updateLink","deleteLink"] |

<a id="schema-def-ImF0b21pY0JhdGNoT3BlcmF0aW9uUHJvYmxlbSI"></a>
## Schema: "atomicBatchOperationProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","operation","pointer"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "code" | schema | yes | — | — |
| "detail" | text | no | — | — |
| "instance" | ref "#/$defs/absoluteUri" | no | — | — |
| "operation" | ref "#/$defs/atomicBatchOperationName" | yes | — | — |
| "pointer" | schema | yes | — | — |
| "retry" | schema | yes | — | — |
| "status" | schema | yes | — | — |
| "title" | text | no | — | — |
| "type" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "code": {
      "const": "operation-not-supported"
    },
    "pointer": {
      "type": "string",
      "pattern": "^/operations/(0|[1-9][0-9]*)/operation$"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```

<a id="schema-def-ImF0b21pY0JhdGNoUHJvYmxlbSI"></a>
## Schema: "atomicBatchProblem"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Existing ordinary Write Problems or the two feature-specific refusal forms; no public receipt failure carrier." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/readUpdateProblem"
    },
    {
      "$ref": "#/$defs/atomicBatchCapabilityProblem"
    },
    {
      "$ref": "#/$defs/atomicBatchOperationProblem"
    }
  ]
}
```

<a id="schema-def-ImF0b21pY0JhdGNoUmVzb3VyY2VSZXN1bHQi"></a>
## Schema: "atomicBatchResourceResult"

Value: object

Other fields: not allowed

Required order: ["id","resourceKind","outcome","changed"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "changed" | boolean | yes | — | — |
| "deleted" | ref "#/$defs/deletedIdentity" | no | — | — |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "outcome" | schema | yes | — | — |
| "ownerRevisions" | ref "#/$defs/ownerRevisions" | no | — | — |
| "resource" | schema | no | — | — |
| "resourceKind" | ref "#/$defs/resourceKind" | yes | — | — |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "required": [
        "resource"
      ],
      "properties": {
        "resource": true,
        "outcome": {
          "enum": [
            "created",
            "updated"
          ]
        },
        "changed": {
          "const": true
        },
        "deleted": false
      },
      "type": "object"
    },
    {
      "required": [
        "resource"
      ],
      "properties": {
        "resource": true,
        "outcome": {
          "const": "unchanged"
        },
        "changed": {
          "const": false
        },
        "deleted": false
      },
      "type": "object"
    },
    {
      "required": [
        "deleted"
      ],
      "properties": {
        "deleted": true,
        "outcome": {
          "const": "deleted"
        },
        "changed": {
          "const": true
        },
        "resource": false
      },
      "type": "object"
    },
    {
      "properties": {
        "outcome": {
          "const": "allocated"
        },
        "changed": {
          "const": true
        },
        "resource": false,
        "deleted": false,
        "ownerRevisions": false
      }
    }
  ],
  "allOf": [
    {
      "if": {
        "required": [
          "resourceKind"
        ],
        "properties": {
          "resourceKind": {
            "const": "bead"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "resource": {
            "$ref": "#/$defs/beadRecord"
          },
          "deleted": {
            "type": "object",
            "properties": {
              "resourceKind": {
                "const": "bead"
              }
            }
          },
          "ownerRevisions": false
        }
      }
    },
    {
      "if": {
        "required": [
          "resourceKind"
        ],
        "properties": {
          "resourceKind": {
            "const": "link"
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "resource": {
            "$ref": "#/$defs/linkRecord"
          },
          "deleted": {
            "type": "object",
            "properties": {
              "resourceKind": {
                "const": "link"
              }
            }
          }
        }
      }
    }
  ],
  "properties": {
    "outcome": {
      "enum": [
        "created",
        "updated",
        "unchanged",
        "deleted",
        "allocated"
      ]
    },
    "resource": {
      "oneOf": [
        {
          "allOf": [
            {
              "$ref": "#/$defs/beadRecord"
            },
            {
              "type": "object",
              "properties": {
                "links": false
              }
            }
          ]
        },
        {
          "$ref": "#/$defs/linkRecord"
        }
      ]
    }
  }
}
```

<a id="schema-def-ImF0b21pY0JhdGNoUmVzdWx0Ig"></a>
## Schema: "atomicBatchResult"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","changed","results","resources"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |
| "changed" | boolean | yes | — | — |
| "resources" | schema | yes | — | — |
| "results" | schema | yes | — | — |
| "transaction" | ref "#/$defs/revision" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "required": [
          "changed"
        ],
        "properties": {
          "changed": {
            "const": false
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "transaction": false,
          "resources": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "changed": {
                  "const": false
                }
              }
            }
          }
        }
      },
      "else": {
        "required": [
          "transaction"
        ],
        "properties": {
          "transaction": true,
          "resources": {
            "type": "array",
            "contains": {
              "type": "object",
              "required": [
                "changed"
              ],
              "properties": {
                "changed": {
                  "const": true
                }
              }
            }
          }
        },
        "type": "object"
      }
    }
  ],
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "resources": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "$ref": "#/$defs/atomicBatchResourceResult"
      }
    },
    "results": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/atomicBatchResultEntry"
      }
    }
  }
}
```

<a id="schema-def-ImF0b21pY0JhdGNoUmVzdWx0RW50cnki"></a>
## Schema: "atomicBatchResultEntry"

Value: object

Other fields: not allowed

Required order: ["operationIndex","operation","id"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "operation" | ref "#/$defs/atomicBatchOperationName" | yes | — | — |
| "operationIndex" | schema | yes | — | — |
| "operationName" | ref "#/$defs/localName" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "type": "object",
        "required": [
          "operation"
        ],
        "properties": {
          "operation": {
            "enum": [
              "updateBead",
              "deleteBead",
              "updateLink",
              "deleteLink"
            ]
          }
        }
      },
      "then": {
        "properties": {
          "operationName": false
        }
      }
    }
  ],
  "properties": {
    "operationIndex": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```

<a id="schema-def-ImF0b21pY0JhdGNoU2VsZWN0aW9uIg"></a>
## Schema: "atomicBatchSelection"

Value: object

Other fields: allowed

Required order: ["capabilityVersion"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Prefix selection only, not admission as a complete request. Unknown well-formed versions refuse without interpreting their body." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-ImJhdGNoT3BlcmF0aW9uIg"></a>
## Schema: "batchOperation"

Value: object

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/createBeadOperation"
    },
    {
      "$ref": "#/$defs/updateBeadOperation"
    },
    {
      "$ref": "#/$defs/deleteBeadOperation"
    },
    {
      "$ref": "#/$defs/createLinkOperation"
    },
    {
      "$ref": "#/$defs/updateLinkOperation"
    },
    {
      "$ref": "#/$defs/deleteLinkOperation"
    }
  ]
}
```

<a id="schema-def-ImJhdGNoUmVxdWVzdCI"></a>
## Schema: "batchRequest"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","operations"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP optional atomic batch version 1 request" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | — |
| "operations" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "operations": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/batchOperation"
      }
    }
  }
}
```

<a id="schema-def-ImJkcFZlcnNpb24i"></a>
## Schema: "bdpVersion"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| const | "0.1" |
| description | "Exact protocol-version discriminator. Version 0.1 selects this complete draft contract rather than an executable, a Git revision or a capability range." |

<a id="schema-def-ImJlYWRDb2xsZWN0aW9uIg"></a>
## Schema: "beadCollection"

Value: object

Other fields: not allowed

Required order: ["items","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One finite page of complete Bead records and an absolute continuation URL or explicit null on observed exhaustion. Items do not acquire a separate href/value wrapper." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/beadRecord") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |

### Advanced

```json-schema
{
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-ImJlYWRSZWNvcmQi"></a>
## Schema: "beadRecord"

Value: object

Other fields: not allowed

Required order: ["id","type","revision","properties","metadata"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete Bead representation, including identity, affiliation, revision, application properties, common metadata and optional recorded provenance or captured owned-Link state. Included incident links are a separately selected current aggregate." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "links" | ref "#/$defs/linkCollection" | no | — | "Separately selected current incident-Link aggregate. It is not captured owned state or an exact historical graph." |
| "metadata" | ref "#/$defs/metadata" | yes | — | "Common mutable object content, independent of Type-specific properties." |
| "ownedLinks" | schema | no | — | "Recorded revision-covered owned-Link capture, grouped by nominal Link-Type identity. It is derived state, not directly writable input." |
| "properties" | ref "#/$defs/properties" | yes | — | "Application-authored object content selected by the containing representation." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

### Advanced

```json-schema
{
  "properties": {
    "ownedLinks": {
      "type": "object",
      "propertyNames": {
        "$ref": "#/$defs/absoluteHttpUrl"
      },
      "additionalProperties": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/linkRecord"
        }
      }
    },
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-ImNhcGFiaWxpdHlBZHZlcnRpc2VtZW50cyI"></a>
## Schema: "capabilityAdvertisements"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Map from absolute capability identity URI to explicitly supported versions. Unknown optional capabilities can be ignored without changing known base behavior; advertisement is neither request selection nor permission." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "https://github.com/gastownhall/bdp/capabilities/atomic-batch" | schema | no | — | "Supported atomic-batch versions and their admission detail. Core-only discovery separately prohibits advertising version 1." |
| "https://github.com/gastownhall/bdp/capabilities/resource-projection" | schema | no | — | "Supported projection versions and their point/exact/inventory support flags." |
| "https://github.com/gastownhall/bdp/capabilities/type-definition-read" | schema | no | — | "Supported exact-definition lookup versions and their independently advertised operation navigation." |

### Advanced

```json-schema
{
  "propertyNames": {
    "$ref": "#/$defs/absoluteUri"
  },
  "additionalProperties": {
    "$ref": "#/$defs/capabilityVersionAdvertisements"
  },
  "properties": {
    "https://github.com/gastownhall/bdp/capabilities/atomic-batch": {
      "allOf": [
        {
          "$ref": "#/$defs/capabilityVersionAdvertisements"
        },
        {
          "type": "object",
          "properties": {
            "1": {
              "$ref": "#/$defs/atomicBatchCapabilityV1"
            }
          }
        }
      ]
    },
    "https://github.com/gastownhall/bdp/capabilities/resource-projection": {
      "allOf": [
        {
          "$ref": "#/$defs/capabilityVersionAdvertisements"
        },
        {
          "type": "object",
          "properties": {
            "1": {
              "$ref": "#/$defs/resourceProjectionCapabilityV1"
            }
          }
        }
      ]
    },
    "https://github.com/gastownhall/bdp/capabilities/type-definition-read": {
      "allOf": [
        {
          "$ref": "#/$defs/capabilityVersionAdvertisements"
        },
        {
          "type": "object",
          "properties": {
            "1": {
              "$ref": "#/$defs/typeDefinitionReadCapabilityV1"
            }
          }
        }
      ]
    }
  }
}
```

<a id="schema-def-ImNhcGFiaWxpdHlWZXJzaW9uQWR2ZXJ0aXNlbWVudHMi"></a>
## Schema: "capabilityVersionAdvertisements"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Map from exact nonempty version string to that version’s detail object. Versions are opaque, unordered and have no implicit compatibility range." |
| minProperties | 1 |
| type | "object" |

### Advanced

```json-schema
{
  "propertyNames": {
    "type": "string",
    "minLength": 1
  },
  "additionalProperties": {
    "type": "object"
  }
}
```

<a id="schema-def-ImNhcmRpbmFsaXR5Ig"></a>
## Schema: "cardinality"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| minProperties | 1 |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "max" | schema | no | — | — |
| "min" | schema | no | — | — |

### Advanced

```json-schema
{
  "properties": {
    "max": {
      "type": "integer",
      "minimum": 0
    },
    "min": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```

<a id="schema-def-ImNoYW5nZUdyb3VwIg"></a>
## Schema: "changeGroup"

Value: object

Other fields: not allowed

Required order: ["scopeEpoch","authorizationView","checkpoint","position","previousPosition","projectionAdvance","eventCount","changes","erasures","events"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP change group" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "authorizationView" | ref "#/$defs/wireToken" | yes | — | — |
| "changes" | array of (ref "#/$defs/stateChange") | yes | — | — |
| "checkpoint" | ref "#/$defs/wireToken" | yes | — | — |
| "erasures" | array of (ref "#/$defs/erasureRecord") | yes | — | — |
| "eventCount" | schema | yes | — | — |
| "events" | array of (ref "#/$defs/event") | yes | — | — |
| "position" | ref "#/$defs/wireToken" | yes | — | — |
| "previousPosition" | ref "#/$defs/wireToken" | yes | — | — |
| "projectionAdvance" | boolean | yes | — | — |
| "scopeEpoch" | ref "#/$defs/wireToken" | yes | — | — |
| "transaction" | ref "#/$defs/wireToken" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "projectionAdvance": {
            "const": true
          }
        },
        "required": [
          "projectionAdvance"
        ]
      },
      "then": {
        "properties": {
          "transaction": false,
          "eventCount": {
            "const": 0
          },
          "changes": {
            "type": "array",
            "maxItems": 0
          },
          "erasures": {
            "type": "array",
            "maxItems": 0
          },
          "events": {
            "type": "array",
            "maxItems": 0
          }
        }
      },
      "else": {
        "type": "object",
        "required": [
          "transaction"
        ],
        "properties": {
          "transaction": true
        },
        "anyOf": [
          {
            "properties": {
              "changes": {
                "type": "array",
                "minItems": 1
              }
            }
          },
          {
            "properties": {
              "erasures": {
                "type": "array",
                "minItems": 1
              }
            }
          },
          {
            "properties": {
              "events": {
                "type": "array",
                "minItems": 1
              }
            }
          }
        ]
      }
    }
  ],
  "properties": {
    "eventCount": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```

<a id="schema-def-ImNoYW5nZWZlZWRQYWdlIg"></a>
## Schema: "changefeedPage"

Value: object

Other fields: not allowed

Required order: ["scope","scopeEpoch","authorizationView","after","observedHeadPosition","groups","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP changefeed page" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "after" | ref "#/$defs/wireToken" | yes | — | — |
| "authorizationView" | ref "#/$defs/wireToken" | yes | — | — |
| "groups" | array of (ref "#/$defs/changeGroup") | yes | — | — |
| "next" | schema | yes | — | — |
| "observedHeadPosition" | ref "#/$defs/wireToken" | yes | — | — |
| "scope" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "scopeEpoch" | ref "#/$defs/wireToken" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-ImNvbnRleHRNZXNzYWdlIg"></a>
## Schema: "contextMessage"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicit immutable message context: present carries a string, including an empty message; absent and undetermined distinguish known absence from unavailable knowledge." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "state": {
          "const": "present"
        },
        "value": {
          "type": "string"
        }
      },
      "required": [
        "state",
        "value"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "state": {
          "enum": [
            "absent",
            "undetermined"
          ]
        }
      },
      "required": [
        "state"
      ],
      "additionalProperties": false
    }
  ]
}
```

<a id="schema-def-ImNvbnRleHRTdHJpbmci"></a>
## Schema: "contextString"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicit immutable context value: present carries a nonempty string, absent records known absence, and undetermined records unavailable knowledge. No state authenticates an agent." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "state": {
          "const": "present"
        },
        "value": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "state",
        "value"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "state": {
          "enum": [
            "absent",
            "undetermined"
          ]
        }
      },
      "required": [
        "state"
      ],
      "additionalProperties": false
    }
  ]
}
```

<a id="schema-def-ImNvbnRleHRUaW1lIg"></a>
## Schema: "contextTime"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicit immutable commit-time context: present carries a date-time and undetermined records unavailable knowledge. There is no absent time arm. This envelope is not a timestamp string or a revision-order proof." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "state": {
          "const": "present"
        },
        "value": {
          "$ref": "#/$defs/dateTime"
        }
      },
      "required": [
        "state",
        "value"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "state": {
          "enum": [
            "undetermined"
          ]
        }
      },
      "required": [
        "state"
      ],
      "additionalProperties": false
    }
  ]
}
```

<a id="schema-def-ImNvcmVBZHZlcnRpc2VkTGltaXRzIg"></a>
## Schema: "coreAdvertisedLimits"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Optional grouped Core read bounds. Omission means a bound is not pre-advertised, never infinite capacity or permission for silent truncation." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "page" | schema | no | — | "Positive default and maximum Resource-record page sizes, when declared." |
| "request" | schema | no | — | "Positive encoded request-target and representation-body byte limits, when declared." |
| "resource" | schema | no | — | "Positive complete-representation and properties-only UTF-8 byte bounds, when declared." |
| "retention" | schema | no | — | "Declared pagination snapshot lifetime; this group does not advertise Event or replica retention." |
| "selector" | schema | no | — | "Optional positive bounds on decoded Selector bytes, parsed depth and parsed node count." |

### Advanced

```json-schema
{
  "properties": {
    "page": {
      "type": "object",
      "properties": {
        "defaultItems": {
          "$ref": "#/$defs/positiveInteger"
        },
        "maximumItems": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "request": {
      "type": "object",
      "properties": {
        "targetBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "bodyBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "resource": {
      "type": "object",
      "properties": {
        "representationBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "propertiesBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "retention": {
      "type": "object",
      "properties": {
        "maximumSnapshotLifetime": {
          "$ref": "#/$defs/iso8601Duration"
        }
      },
      "additionalProperties": false
    },
    "selector": {
      "type": "object",
      "properties": {
        "bytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "depth": {
          "$ref": "#/$defs/positiveInteger"
        },
        "nodes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    }
  }
}
```

<a id="schema-def-ImNvcmVEaXNjb3Zlcnki"></a>
## Schema: "coreDiscovery"

Value: object

Other fields: not allowed

Required order: ["bdpVersion","profile","scope","beads","links"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Closed Core discovery object. Inventory URLs navigate collections rather than reserve Resource-ID prefixes. Events, History and other capabilities are optional and bind their full obligations only when advertised." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "aliases" | ref "#/$defs/absoluteHttpUrl" | no | — | "Advertised in-Scope alias-resolution namespace, possibly the Scope itself. A spelling requires an actual alias binding." |
| "bdpVersion" | ref "#/$defs/bdpVersion" | yes | — | "Exact complete protocol discriminator, not a nearest-version negotiation." |
| "beads" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute Bead inventory URL. It is navigation, not a Resource-ID base or required path prefix." |
| "capabilities" | schema | no | — | "Independently versioned feature advertisements. Support does not select an invocation or grant permission." |
| "events" | ref "#/$defs/absoluteHttpUrl" | no | — | "Optional absolute finite Event-source URL. Presence promises the complete Event contract; absence supplies no Event support." |
| "historicalResolution" | ref "#/$defs/historyCapability" | no | — | "Explicit History support advertisement; omission carries no History obligation." |
| "limits" | ref "#/$defs/coreAdvertisedLimits" | no | — | "Optional declared operational bounds. Omitted values are not infinite and failures cannot silently truncate data." |
| "links" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute Link inventory URL; it reserves no Link Resource-ID prefix." |
| "maximumEndpointMultiplicity" | array of (ref "#/$defs/maximumEndpointMultiplicityPolicy") | no | — | "Native endpoint incidence policies enforced against the storing Scope’s authoritative in-Scope state." |
| "order" | schema | no | — | "Advertised stable collection order. Omission uses canonical-uri under Core." |
| "profile" | schema | yes | — | "Base Core/Write profile discriminator, independent of optional capabilities." |
| "scope" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Canonical HTTP(S) Scope URL used for local identity resolution and ownership navigation." |

### Advanced

```json-schema
{
  "properties": {
    "capabilities": {
      "allOf": [
        {
          "$ref": "#/$defs/capabilityAdvertisements"
        },
        {
          "type": "object",
          "properties": {
            "https://github.com/gastownhall/bdp/capabilities/atomic-batch": {
              "type": "object",
              "properties": {
                "1": false
              }
            }
          }
        }
      ]
    },
    "order": {
      "enum": [
        "canonical-uri"
      ]
    },
    "profile": {
      "const": "core"
    }
  }
}
```

<a id="schema-def-ImNvdW50UmVzdWx0Ig"></a>
## Schema: "countResult"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Exact nonnegative integral count of the complete admitted authorized selection. A cutoff or partial scan cannot be reported as a successful count." |
| minimum | 0 |
| type | "integer" |

<a id="schema-def-ImNyZWF0ZUJlYWRNZW1iZXJzIg"></a>
## Schema: "createBeadMembers"

Value: object

Required order: ["type"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/durableResourceReference" | no | — | — |
| "metadata" | ref "#/$defs/metadata" | no | — | — |
| "properties" | ref "#/$defs/properties" | no | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "type" | ref "#/$defs/typeReference" | yes | — | — |

<a id="schema-def-ImNyZWF0ZUJlYWRPcGVyYXRpb24i"></a>
## Schema: "createBeadOperation"

Value: object

Required order: ["operation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "name" | ref "#/$defs/localName" | no | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "createBead"
    }
  }
}
```

<a id="schema-def-ImNyZWF0ZUJlYWRSZXF1ZXN0Ig"></a>
## Schema: "createBeadRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createBeadMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-ImNyZWF0ZUxpbmtNZW1iZXJzIg"></a>
## Schema: "createLinkMembers"

Value: object

Required order: ["type","source","target"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/durableResourceReference" | no | — | — |
| "metadata" | ref "#/$defs/metadata" | no | — | — |
| "properties" | ref "#/$defs/properties" | no | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "source" | ref "#/$defs/inputReference" | yes | — | — |
| "target" | ref "#/$defs/inputReference" | yes | — | — |
| "type" | ref "#/$defs/typeReference" | yes | — | — |

<a id="schema-def-ImNyZWF0ZUxpbmtPcGVyYXRpb24i"></a>
## Schema: "createLinkOperation"

Value: object

Required order: ["operation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "name" | ref "#/$defs/localName" | no | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "createLink"
    }
  }
}
```

<a id="schema-def-ImNyZWF0ZUxpbmtSZXF1ZXN0Ig"></a>
## Schema: "createLinkRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "source" | ref "#/$defs/durableInputReference" | no | — | — |
| "target" | ref "#/$defs/durableInputReference" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createLinkMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-ImNyZWF0ZWREYXRhIg"></a>
## Schema: "createdData"

Value: object

Other fields: not allowed

Required order: ["revision","properties"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| dependentRequired | {"source":["target"],"target":["source"]} |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "metadata" | ref "#/$defs/metadata" | no | — | — |
| "properties" | ref "#/$defs/properties" | yes | — | — |
| "revision" | ref "#/$defs/revision" | yes | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | — |
| "source" | ref "#/$defs/reference" | no | — | — |
| "target" | ref "#/$defs/reference" | no | — | — |

<a id="schema-def-ImN1cnJlbnRCZWFkQ29sbGVjdGlvbiI"></a>
## Schema: "currentBeadCollection"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Current Bead inventory page whose items use current Bead carriers. Its continuation retains the admitted selection and authorization context." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/beadCollection"
    },
    {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/currentBeadRecord"
          }
        }
      }
    }
  ]
}
```

<a id="schema-def-ImN1cnJlbnRCZWFkUmVjb3JkIg"></a>
## Schema: "currentBeadRecord"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Current Bead read carrier. Common metadata is present and any included incident or owned Links use complete current Link carriers; this helper adds no read operation." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/beadRecord"
    },
    {
      "type": "object",
      "required": [
        "metadata"
      ],
      "properties": {
        "metadata": {
          "$ref": "#/$defs/metadata"
        },
        "links": {
          "$ref": "#/$defs/currentLinkCollection"
        },
        "ownedLinks": {
          "type": "object",
          "additionalProperties": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/currentLinkRecord"
            }
          }
        }
      }
    }
  ]
}
```

<a id="schema-def-ImN1cnJlbnRMaW5rQ29sbGVjdGlvbiI"></a>
## Schema: "currentLinkCollection"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Current Link inventory page whose items use current Link carriers. An empty page is not proof of exhaustion when next is nonnull." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/linkCollection"
    },
    {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/currentLinkRecord"
          }
        }
      }
    }
  ]
}
```

<a id="schema-def-ImN1cnJlbnRMaW5rUmVjb3JkIg"></a>
## Schema: "currentLinkRecord"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Current Link read carrier, including common metadata. This helper adds no identity, mutation or traversal behavior." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/linkRecord"
    },
    {
      "type": "object",
      "required": [
        "metadata"
      ],
      "properties": {
        "metadata": {
          "$ref": "#/$defs/metadata"
        }
      }
    }
  ]
}
```

<a id="schema-def-ImRhdGVUaW1lIg"></a>
## Schema: "dateTime"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "RFC 3339 date-time carrier. Emission uses a valid calendar and clock, uppercase T and Z; the prose governs accepted spellings and precision." |
| format | "date-time" |
| type | "string" |

<a id="schema-def-ImRlbGV0ZUFsaWFzTWVtYmVycyI"></a>
## Schema: "deleteAliasMembers"

Value: object

Required order: ["alias"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "alias" | ref "#/$defs/durableResourceReference" | yes | — | — |

<a id="schema-def-ImRlbGV0ZUFsaWFzUmVxdWVzdCI"></a>
## Schema: "deleteAliasRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteAliasMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-ImRlbGV0ZUJlYWRNZW1iZXJzIg"></a>
## Schema: "deleteBeadMembers"

Value: object

Required order: ["bead"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "#/$defs/resourceReference" | yes | — | — |
| "expectedRevision" | ref "#/$defs/expectedRevision" | no | — | — |

<a id="schema-def-ImRlbGV0ZUJlYWRPcGVyYXRpb24i"></a>
## Schema: "deleteBeadOperation"

Value: object

Required order: ["operation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "deleteBead"
    }
  }
}
```

<a id="schema-def-ImRlbGV0ZUJlYWRSZXF1ZXN0Ig"></a>
## Schema: "deleteBeadRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "#/$defs/durableResourceReference" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteBeadMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-ImRlbGV0ZUxpbmtNZW1iZXJzIg"></a>
## Schema: "deleteLinkMembers"

Value: object

Required order: ["link"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expectedRevision" | ref "#/$defs/expectedRevision" | no | — | — |
| "link" | ref "#/$defs/resourceReference" | yes | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |

<a id="schema-def-ImRlbGV0ZUxpbmtPcGVyYXRpb24i"></a>
## Schema: "deleteLinkOperation"

Value: object

Required order: ["operation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "deleteLink"
    }
  }
}
```

<a id="schema-def-ImRlbGV0ZUxpbmtSZXF1ZXN0Ig"></a>
## Schema: "deleteLinkRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "link" | ref "#/$defs/durableResourceReference" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteLinkMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-ImRlbGV0ZVdoZXJlTWVtYmVycyI"></a>
## Schema: "deleteWhereMembers"

Value: object

Required order: ["collection","selector"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "cardinality" | ref "#/$defs/cardinality" | no | — | — |
| "collection" | schema | yes | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "selector" | ref "#/$defs/selector" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "collection": {
      "enum": [
        "beads",
        "links"
      ]
    }
  }
}
```

<a id="schema-def-ImRlbGV0ZVdoZXJlT3BlcmF0aW9uIg"></a>
## Schema: "deleteWhereOperation"

Value: object

Required order: ["operation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteWhereMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "deleteWhere"
    }
  }
}
```

<a id="schema-def-ImRlbGV0ZVdoZXJlUmVxdWVzdCI"></a>
## Schema: "deleteWhereRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Transactional delete-where request" |
| type | "object" |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteWhereMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-ImRlbGV0ZWREYXRhIg"></a>
## Schema: "deletedData"

Value: object

Other fields: not allowed

Required order: ["revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "revision" | ref "#/$defs/revision" | yes | — | — |

<a id="schema-def-ImRlbGV0ZWRJZGVudGl0eSI"></a>
## Schema: "deletedIdentity"

Value: object

Other fields: not allowed

Required order: ["resourceKind","resource"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "resource" | ref "#/$defs/resourceIdentity" | yes | — | — |
| "resourceKind" | ref "#/$defs/resourceKind" | yes | — | — |

<a id="schema-def-ImRpcmVjdFByb2JsZW1Db2RlIg"></a>
## Schema: "directProblemCode"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","unsupported-media-type","idempotency-conflict","event-history-expired","catch-up-timeout","revision-unknown","revision-unretained","revision-reorganized","revision-not-tracked","revision-unrepresentable","revision-allocation-unsafe"] |

<a id="schema-def-ImR1cmFibGVJbnB1dFBpbm5lZFJlZmVyZW5jZSI"></a>
## Schema: "durableInputPinnedReference"

Value: object

Other fields: not allowed

Required order: ["uri","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "revision" | schema | yes | — | — |
| "uri" | ref "#/$defs/durableResourceReference" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-ImR1cmFibGVJbnB1dFJlZmVyZW5jZSI"></a>
## Schema: "durableInputReference"

Value: object

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/durableResourceReference"
    },
    {
      "$ref": "#/$defs/durableInputPinnedReference"
    }
  ]
}
```

<a id="schema-def-ImR1cmFibGVSZXNvdXJjZVJlZmVyZW5jZSI"></a>
## Schema: "durableResourceReference"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| minLength | 1 |
| pattern | "^[^@]" |
| type | "string" |

<a id="schema-def-ImVuZHBvaW50Q29uc3RyYWludCI"></a>
## Schema: "endpointConstraint"

Value: object

Other fields: not allowed

Required order: ["conformsTo"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "conformsTo" | ref "#/$defs/typeIdArray" | yes | — | — |
| "external" | schema | no | — | — |

### Advanced

```json-schema
{
  "properties": {
    "external": {
      "enum": [
        "none",
        "opaque",
        "bead"
      ]
    }
  }
}
```

<a id="schema-def-ImVyYXN1cmVEaWdlc3Qi"></a>
## Schema: "erasureDigest"

Value: object

Other fields: not allowed

Required order: ["scheme","value"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "scheme" | schema | yes | — | — |
| "value" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "scheme": {
      "enum": [
        "sha-256-jcs"
      ]
    },
    "value": {
      "type": "string",
      "pattern": "^[0-9a-f]{64}$"
    }
  }
}
```

<a id="schema-def-ImVyYXN1cmVSZWNvcmQi"></a>
## Schema: "erasureRecord"

Value: object

Other fields: not allowed

Required order: ["subject","revision","digest"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "digest" | ref "#/$defs/erasureDigest" | yes | — | — |
| "revision" | ref "#/$defs/revision" | yes | — | — |
| "subject" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

<a id="schema-def-ImV2ZW50Ig"></a>
## Schema: "event"

Value: object

Other fields: not allowed

Required order: ["id","ordinal","type","source","subject","subjectType","transaction","time","data"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Event" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "data" | object | yes | — | — |
| "id" | ref "#/$defs/wireToken" | yes | — | — |
| "ordinal" | schema | yes | — | — |
| "source" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "subject" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "subjectType" | ref "#/$defs/typeReference" | yes | — | — |
| "time" | ref "#/$defs/dateTime" | yes | — | — |
| "transaction" | ref "#/$defs/wireToken" | yes | — | — |
| "type" | ref "#/$defs/eventType" | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "type": {
            "const": "created"
          }
        },
        "required": [
          "type"
        ]
      },
      "then": {
        "properties": {
          "data": {
            "$ref": "#/$defs/createdData"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "type": {
            "const": "updated"
          }
        },
        "required": [
          "type"
        ]
      },
      "then": {
        "properties": {
          "data": {
            "$ref": "#/$defs/updatedData"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "type": {
            "const": "deleted"
          }
        },
        "required": [
          "type"
        ]
      },
      "then": {
        "properties": {
          "data": {
            "$ref": "#/$defs/deletedData"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "type": {
            "enum": [
              "linked",
              "unlinked"
            ]
          }
        },
        "required": [
          "type"
        ]
      },
      "then": {
        "properties": {
          "data": {
            "$ref": "#/$defs/linkDeltaData"
          }
        }
      }
    }
  ],
  "properties": {
    "ordinal": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```

<a id="schema-def-ImV2ZW50UGFnZSI"></a>
## Schema: "eventPage"

Value: object

Other fields: not allowed

Required order: ["source","events","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Event Source page" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "events" | array of (ref "#/$defs/event") | yes | — | — |
| "next" | schema | yes | — | — |
| "source" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-ImV2ZW50VHlwZSI"></a>
## Schema: "eventType"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["created","updated","deleted","linked","unlinked"] |

<a id="schema-def-ImV4YWN0VHlwZURlZmluaXRpb25SZWNvcmQi"></a>
## Schema: "exactTypeDefinitionRecord"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Whole exact Type-definition Bead with recorded owned closure and pinned Type affiliations. Serving a global definition never transfers ownership to the responder." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/beadRecord"
    },
    {
      "type": "object",
      "required": [
        "ownedLinks"
      ],
      "properties": {
        "type": {
          "$ref": "#/$defs/pinnedTypeReference"
        },
        "links": false,
        "ownedLinks": {
          "type": "object",
          "additionalProperties": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": {
                  "$ref": "#/$defs/pinnedTypeReference"
                }
              }
            }
          }
        }
      }
    }
  ]
}
```

<a id="schema-def-ImV4cGVjdGVkUmV2aXNpb24i"></a>
## Schema: "expectedRevision"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| minLength | 1 |
| type | "string" |

<a id="schema-def-Imhpc3RvcmljYWxCZWFkUmVjb3JkIg"></a>
## Schema: "historicalBeadRecord"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete exact Bead representation. Current incident-Link aggregates are excluded; captured owned-Link state comes from that recorded version." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/beadRecord"
    },
    {
      "type": "object",
      "properties": {
        "links": false
      }
    }
  ]
}
```

<a id="schema-def-Imhpc3RvcmljYWxMaW5rUmVjb3JkIg"></a>
## Schema: "historicalLinkRecord"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| $ref | "#/$defs/linkRecord" |
| description | "Complete exact Link representation retaining its recorded whole source/target and Type References. Current defaults or pins cannot replace them." |

<a id="schema-def-Imhpc3RvcnlDYXBhYmlsaXR5Ig"></a>
## Schema: "historyCapability"

Value: object

Other fields: not allowed

Required order: ["version"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "History version-1 advertisement. It commits to the complete exact-read and retained-versions contract, not merely an event timeline or a current-record lookup." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "version" | schema | yes | — | "Exact selected feature version. No version ordering or implicit upgrade is defined." |

### Advanced

```json-schema
{
  "properties": {
    "version": {
      "const": 1
    }
  }
}
```

<a id="schema-def-Imhpc3RvcnlNaXNzaW5nIg"></a>
## Schema: "historyMissing"

Value: object

Other fields: not allowed

Required order: ["complete","items"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Bounded missing-state diagnosis for revision-unretained. Complete states whether the item list is exhaustive; it cannot falsely certify reconstruction or erase undisclosed dependencies." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "complete" | boolean | yes | — | "Whether the stated bounded information is exhaustive under the containing contract." |
| "items" | schema | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "complete": {
            "const": true
          }
        },
        "required": [
          "complete"
        ]
      },
      "then": {
        "properties": {
          "items": {
            "type": "array",
            "minItems": 1
          }
        }
      }
    }
  ],
  "properties": {
    "items": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/historyMissingItem"
      },
      "maxItems": 64,
      "uniqueItems": true
    }
  }
}
```

<a id="schema-def-Imhpc3RvcnlNaXNzaW5nSXRlbSI"></a>
## Schema: "historyMissingItem"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One unavailable component needed for an exact response: the subject record, a selected property path, or captured owned-Link state. The bounded diagnosis preserves known location without substituting current content." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "kind": {
          "const": "record"
        }
      },
      "required": [
        "kind"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "kind": {
          "const": "property"
        },
        "pointer": {
          "allOf": [
            {
              "$ref": "#/$defs/jsonPointer"
            },
            {
              "type": "string",
              "pattern": "^/(properties(?:/|$)|ownedLinks/([^/~]|~[01])+/(0|[1-9][0-9]*)/properties(?:/|$))"
            }
          ]
        }
      },
      "required": [
        "kind",
        "pointer"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "kind": {
          "const": "owned-links"
        },
        "type": {
          "$ref": "#/$defs/absoluteHttpUrl"
        }
      },
      "required": [
        "kind"
      ],
      "additionalProperties": false
    }
  ]
}
```

<a id="schema-def-Imhpc3RvcnlWZXJzaW9uUm93Ig"></a>
## Schema: "historyVersionRow"

Value: object

Other fields: not allowed

Required order: ["revision","lineage","body"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One retained Resource-version summary. Revision, lineage and body completeness describe actual retained version state; deletion is not represented as a synthetic version row." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "body" | schema | yes | — | "Whether the row’s retained version can currently produce its complete recorded representation, including required owned state." |
| "lineage" | schema | yes | — | "Whether the row belongs to the current or a replaced retained lineage; this is not a revision-order comparison." |
| "revision" | ref "#/$defs/revision" | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |

### Advanced

```json-schema
{
  "properties": {
    "body": {
      "enum": [
        "complete",
        "incomplete"
      ]
    },
    "lineage": {
      "enum": [
        "current",
        "replaced"
      ]
    }
  }
}
```

<a id="schema-def-Imhpc3RvcnlWZXJzaW9uc1BhZ2Ui"></a>
## Schema: "historyVersionsPage"

Value: object

Other fields: not allowed

Required order: ["subject","population","participation","window","items","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Finite all-retained History page. Subject, participation, window, items and next remain explicit, and nonparticipating/undetermined subjects do not acquire invented rows." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/historyVersionRow") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | (ref "#/$defs/absoluteHttpUrl") OR (null) | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |
| "participation" | schema | yes | — | "Whether this subject is tracked, not tracked or cannot be determined under the History contract." |
| "population" | schema | yes | — | "Explicit retained population selector; it does not assert current live membership." |
| "subject" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Canonical Resource identity to which this retained page or Resource-scoped observation applies." |
| "window" | ref "#/$defs/historyWindow" | yes | — | "Known retained-history boundaries and completeness, never a synthetic history." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "participation": {
            "enum": [
              "not-tracked",
              "undetermined"
            ]
          }
        },
        "required": [
          "participation"
        ]
      },
      "then": {
        "properties": {
          "items": {
            "type": "array",
            "maxItems": 0
          },
          "next": {
            "type": "null"
          },
          "window": {
            "type": "object",
            "properties": {
              "newest": {
                "type": "null"
              },
              "oldest": {
                "type": "null"
              }
            }
          }
        }
      }
    }
  ],
  "properties": {
    "participation": {
      "enum": [
        "tracked",
        "not-tracked",
        "undetermined"
      ]
    },
    "population": {
      "const": "all-retained"
    }
  }
}
```

<a id="schema-def-Imhpc3RvcnlXaW5kb3ci"></a>
## Schema: "historyWindow"

Value: object

Other fields: not allowed

Required order: ["newest","oldest","complete"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Known retained-version window and completeness. Null endpoints describe an empty or unavailable window under the participation rules; tokens are not ordered arithmetically." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "complete" | boolean | yes | — | "Whether the stated bounded information is exhaustive under the containing contract." |
| "newest" | (ref "#/$defs/revision") OR (null) | yes | — | "Newest known retained revision or explicit null under the stated window rules." |
| "oldest" | (ref "#/$defs/revision") OR (null) | yes | — | "Oldest known retained revision or explicit null under the stated window rules." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "newest": {
            "type": "null"
          }
        },
        "required": [
          "newest"
        ]
      },
      "then": {
        "properties": {
          "oldest": {
            "type": "null"
          }
        }
      },
      "else": {
        "properties": {
          "oldest": {
            "$ref": "#/$defs/revision"
          }
        }
      }
    }
  ]
}
```

<a id="schema-def-ImlkZW1wb3RlbmN5S2V5Ig"></a>
## Schema: "idempotencyKey"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| pattern | "^[A-Za-z0-9_-]{1,256}$" |
| type | "string" |

<a id="schema-def-ImlucHV0UGlubmVkUmVmZXJlbmNlIg"></a>
## Schema: "inputPinnedReference"

Value: object

Other fields: not allowed

Required order: ["uri","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "revision" | schema | yes | — | — |
| "uri" | ref "#/$defs/resourceReference" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-ImlucHV0UmVmZXJlbmNlIg"></a>
## Schema: "inputReference"

Value: object

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/resourceReference"
    },
    {
      "$ref": "#/$defs/inputPinnedReference"
    }
  ]
}
```

<a id="schema-def-Imlzbzg2MDFEdXJhdGlvbiI"></a>
## Schema: "iso8601Duration"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "ISO 8601 duration string used for advertised lifetimes. The containing contract determines the promised interval and forbids silently shortening issued obligations." |
| pattern | "^P(?!$)" |
| type | "string" |

<a id="schema-def-Impzb25Qb2ludGVyIg"></a>
## Schema: "jsonPointer"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "JSON Pointer carrier. Pointer evaluation, escaping and projection restrictions are defined by the selected operation; a syntactically valid pointer alone grants no access." |
| pattern | "^(/([^/~]\|~[01])*)*$" |
| type | "string" |

<a id="schema-def-ImxpbmtDb2xsZWN0aW9uIg"></a>
## Schema: "linkCollection"

Value: object

Other fields: not allowed

Required order: ["items","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One finite page of complete Link records and an absolute continuation URL or explicit null. Parallel Link identities remain distinct." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/linkRecord") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |

### Advanced

```json-schema
{
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-ImxpbmtEZWx0YURhdGEi"></a>
## Schema: "linkDeltaData"

Value: object

Other fields: not allowed

Required order: ["endpoint","link","source","target"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "endpoint" | schema | yes | — | — |
| "link" | ref "#/$defs/typedLinkReference" | yes | — | — |
| "source" | ref "#/$defs/reference" | yes | — | — |
| "target" | ref "#/$defs/reference" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "endpoint": {
      "enum": [
        "source",
        "target"
      ]
    }
  }
}
```

<a id="schema-def-ImxpbmtSZWNvcmQi"></a>
## Schema: "linkRecord"

Value: object

Other fields: not allowed

Required order: ["id","type","revision","source","target","properties","metadata"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete directed Link representation. Source and target are whole References; Link identity remains independent of their tuple. Current-state admission requires at least one live in-Scope Bead endpoint. Retained records and facts preserve their recorded endpoints without revalidating them against today’s live state." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "metadata" | ref "#/$defs/metadata" | yes | — | "Common mutable object content, independent of Type-specific properties." |
| "properties" | ref "#/$defs/properties" | yes | — | "Application-authored object content selected by the containing representation." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |
| "source" | ref "#/$defs/reference" | yes | — | "Whole source Reference of this directed Link, preserving any exact revision pin." |
| "target" | ref "#/$defs/reference" | yes | — | "Whole target Reference of a Link, preserving any exact revision pin." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-ImxvY2FsQmluZGluZ1JlZmVyZW5jZSI"></a>
## Schema: "localBindingReference"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| pattern | "^@[A-Za-z][A-Za-z0-9_-]*$" |
| type | "string" |

<a id="schema-def-ImxvY2FsTmFtZSI"></a>
## Schema: "localName"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| pattern | "^[A-Za-z][A-Za-z0-9_-]*$" |
| type | "string" |

<a id="schema-def-Im1heGltdW1FbmRwb2ludE11bHRpcGxpY2l0eVBvbGljeSI"></a>
## Schema: "maximumEndpointMultiplicityPolicy"

Value: object

Other fields: not allowed

Required order: ["linkConformsTo","endpoint","max"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Native Scope constraint over stored in-Scope Link incidence. It names the Link family, endpoint role and positive maximum; it does not inspect a foreign authority’s Link table." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "endpoint" | schema | yes | — | "Endpoint role to which the native incidence maximum applies." |
| "linkConformsTo" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Nominal Link-Type family constrained by this native policy." |
| "max" | ref "#/$defs/positiveInteger" | yes | — | "Positive maximum for the explicitly selected Scope policy." |

### Advanced

```json-schema
{
  "properties": {
    "endpoint": {
      "enum": [
        "source",
        "target"
      ]
    }
  }
}
```

<a id="schema-def-Im1ldGFkYXRhIg"></a>
## Schema: "metadata"

Value: object

Other fields: allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Common mutable object state independent of Type-specific properties. A complete read always includes it; the empty object records no metadata members." |
| type | "object" |

<a id="schema-def-Im11dGF0aW9uT3V0Y29tZSI"></a>
## Schema: "mutationOutcome"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["created","updated","deleted"] |

<a id="schema-def-Im11dGF0aW9uUmVjZWlwdCI"></a>
## Schema: "mutationReceipt"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Mutation Receipt" |
| type | "object" |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/receiptCore"
    }
  ],
  "oneOf": [
    {
      "type": "object",
      "required": [
        "id",
        "status",
        "idempotencyKey",
        "scopeEpoch",
        "authorizationView",
        "transaction"
      ],
      "properties": {
        "id": true,
        "status": {
          "const": "pending"
        },
        "idempotencyKey": true,
        "scopeEpoch": true,
        "authorizationView": true,
        "transaction": true,
        "detail": false,
        "requiredPosition": false,
        "effectPosition": false,
        "results": false,
        "next": false,
        "allocated": false,
        "problem": false,
        "expiresAt": false
      }
    },
    {
      "type": "object",
      "required": [
        "id",
        "status",
        "detail",
        "idempotencyKey",
        "scopeEpoch",
        "authorizationView",
        "transaction",
        "requiredPosition",
        "results",
        "next",
        "expiresAt"
      ],
      "properties": {
        "id": true,
        "status": {
          "const": "completed"
        },
        "detail": {
          "const": "available"
        },
        "idempotencyKey": true,
        "scopeEpoch": true,
        "authorizationView": true,
        "transaction": true,
        "requiredPosition": true,
        "effectPosition": true,
        "results": true,
        "next": true,
        "expiresAt": true,
        "allocated": false,
        "problem": false
      },
      "allOf": [
        {
          "if": {
            "properties": {
              "next": {
                "type": "null"
              }
            },
            "required": [
              "next"
            ]
          },
          "then": {
            "properties": {
              "results": {
                "type": "array",
                "minItems": 1
              }
            }
          }
        }
      ]
    },
    {
      "type": "object",
      "required": [
        "id",
        "status",
        "detail",
        "idempotencyKey",
        "scopeEpoch",
        "authorizationView",
        "transaction",
        "requiredPosition",
        "problem",
        "expiresAt"
      ],
      "properties": {
        "id": true,
        "status": {
          "const": "failed"
        },
        "detail": {
          "const": "available"
        },
        "idempotencyKey": true,
        "scopeEpoch": true,
        "authorizationView": true,
        "transaction": true,
        "requiredPosition": true,
        "problem": true,
        "expiresAt": true,
        "effectPosition": false,
        "results": false,
        "next": false,
        "allocated": false
      }
    },
    {
      "type": "object",
      "required": [
        "id",
        "status",
        "detail",
        "idempotencyKey",
        "scopeEpoch",
        "authorizationView",
        "transaction",
        "requiredPosition",
        "allocated"
      ],
      "properties": {
        "id": true,
        "status": {
          "const": "completed"
        },
        "detail": {
          "const": "expired"
        },
        "idempotencyKey": true,
        "scopeEpoch": true,
        "authorizationView": true,
        "transaction": true,
        "requiredPosition": true,
        "effectPosition": true,
        "allocated": true,
        "results": false,
        "next": false,
        "problem": false,
        "expiresAt": false
      }
    },
    {
      "type": "object",
      "required": [
        "id",
        "status",
        "detail",
        "idempotencyKey",
        "scopeEpoch",
        "authorizationView",
        "transaction",
        "requiredPosition"
      ],
      "properties": {
        "id": true,
        "status": {
          "const": "completed"
        },
        "detail": {
          "const": "withheld"
        },
        "idempotencyKey": true,
        "scopeEpoch": true,
        "authorizationView": true,
        "transaction": true,
        "requiredPosition": true,
        "effectPosition": true,
        "results": false,
        "next": false,
        "allocated": false,
        "problem": false,
        "expiresAt": false
      }
    }
  ]
}
```

<a id="schema-def-Im11dGF0aW9uUmVjZWlwdFBhZ2Ui"></a>
## Schema: "mutationReceiptPage"

Value: object

Other fields: not allowed

Required order: ["receipt","results","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Mutation Receipt page" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "next" | schema | yes | — | — |
| "receipt" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "results" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    },
    "results": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/receiptResult"
      }
    }
  }
}
```

<a id="schema-def-Im11dGF0aW9uUmVzdWx0Ig"></a>
## Schema: "mutationResult"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Read+Update mutation result" |
| type | "object" |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/mutationResultMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-Im11dGF0aW9uUmVzdWx0TWVtYmVycyI"></a>
## Schema: "mutationResultMembers"

Value: object

Required order: ["outcome","changed"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "changed" | boolean | yes | — | — |
| "deleted" | ref "#/$defs/deletedIdentity" | no | — | — |
| "outcome" | ref "#/$defs/mutationOutcome" | yes | — | — |
| "ownerRevisions" | ref "#/$defs/ownerRevisions" | no | — | — |
| "resource" | schema | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "outcome": {
            "const": "deleted"
          }
        },
        "required": [
          "outcome"
        ]
      },
      "then": {
        "required": [
          "deleted"
        ],
        "properties": {
          "deleted": {
            "$ref": "#/$defs/deletedIdentity"
          },
          "resource": false
        }
      },
      "else": {
        "required": [
          "resource"
        ],
        "properties": {
          "resource": {
            "oneOf": [
              {
                "$ref": "#/$defs/beadRecord"
              },
              {
                "$ref": "#/$defs/linkRecord"
              }
            ]
          },
          "deleted": false
        }
      }
    },
    {
      "if": {
        "required": [
          "resource"
        ],
        "properties": {
          "resource": {
            "$ref": "#/$defs/beadRecord"
          }
        }
      },
      "then": {
        "properties": {
          "ownerRevisions": false
        }
      }
    },
    {
      "if": {
        "required": [
          "deleted"
        ],
        "properties": {
          "deleted": {
            "type": "object",
            "required": [
              "resourceKind"
            ],
            "properties": {
              "resourceKind": {
                "const": "bead"
              }
            }
          }
        }
      },
      "then": {
        "properties": {
          "ownerRevisions": false
        }
      }
    },
    {
      "if": {
        "required": [
          "outcome"
        ],
        "properties": {
          "outcome": {
            "enum": [
              "created",
              "deleted"
            ]
          }
        }
      },
      "then": {
        "properties": {
          "changed": {
            "const": true
          }
        }
      }
    }
  ],
  "properties": {
    "resource": {
      "oneOf": [
        {
          "$ref": "#/$defs/beadRecord"
        },
        {
          "$ref": "#/$defs/linkRecord"
        }
      ]
    }
  }
}
```

<a id="schema-def-Im9yZGluYXJ5VXBkYXRlQ2hhbmdlIg"></a>
## Schema: "ordinaryUpdateChange"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "An ordinary update input may supply no patch operations; a supplied array member is still required." |
| type | "array" |

### Advanced

```json-schema
{
  "items": {
    "$ref": "#/$defs/propertyChange/items"
  }
}
```

<a id="schema-def-Im93bmVkTGlua0NoYW5nZSI"></a>
## Schema: "ownedLinkChange"

Value: object

Other fields: not allowed

Required order: ["operation","link"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "link" | object | yes | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "operation": {
            "const": "created"
          }
        },
        "required": [
          "operation"
        ]
      },
      "then": {
        "properties": {
          "link": {
            "$ref": "#/$defs/linkRecord"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "operation": {
            "const": "updated"
          }
        },
        "required": [
          "operation"
        ]
      },
      "then": {
        "properties": {
          "link": {
            "$ref": "#/$defs/ownedLinkDelta"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "operation": {
            "const": "deleted"
          }
        },
        "required": [
          "operation"
        ]
      },
      "then": {
        "properties": {
          "link": {
            "$ref": "#/$defs/resourceIdentity"
          }
        }
      }
    }
  ],
  "properties": {
    "operation": {
      "enum": [
        "created",
        "updated",
        "deleted"
      ]
    }
  }
}
```

<a id="schema-def-Im93bmVkTGlua0RlY2xhcmF0aW9uIg"></a>
## Schema: "ownedLinkDeclaration"

Value: object

Other fields: not allowed

Required order: ["max"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "label" | schema | no | — | — |
| "max" | ref "#/$defs/positiveInteger" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "label": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-Im93bmVkTGlua0RlbHRhIg"></a>
## Schema: "ownedLinkDelta"

Value: object

Other fields: not allowed

Required order: ["id","type","previousRevision","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "change" | ref "#/$defs/propertyChange" | no | — | — |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "metadataChange" | ref "#/$defs/propertyChange" | no | — | — |
| "previousRevision" | ref "#/$defs/revision" | yes | — | — |
| "revision" | ref "#/$defs/revision" | yes | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | — |
| "type" | ref "#/$defs/typeReference" | yes | — | — |

### Advanced

```json-schema
{
  "anyOf": [
    {
      "required": [
        "change"
      ],
      "properties": {
        "change": true
      }
    },
    {
      "required": [
        "metadataChange"
      ],
      "properties": {
        "metadataChange": true
      }
    }
  ]
}
```

<a id="schema-def-Im93bmVkV2lsZGNhcmREZWNsYXJhdGlvbiI"></a>
## Schema: "ownedWildcardDeclaration"

Value: object

Other fields: not allowed

Required order: ["max"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "max" | ref "#/$defs/positiveInteger" | yes | — | — |

<a id="schema-def-Im93bmVyUmV2aXNpb24i"></a>
## Schema: "ownerRevision"

Value: object

Other fields: not allowed

Required order: ["id","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "revision" | ref "#/$defs/revision" | yes | — | — |

<a id="schema-def-Im93bmVyUmV2aXNpb25zIg"></a>
## Schema: "ownerRevisions"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| maxItems | 2 |
| minItems | 1 |
| type | "array" |
| uniqueItems | true |

### Advanced

```json-schema
{
  "items": {
    "$ref": "#/$defs/ownerRevision"
  }
}
```

<a id="schema-def-InBpbm5lZFJlZmVyZW5jZSI"></a>
## Schema: "pinnedReference"

Value: object

Other fields: not allowed

Required order: ["uri","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete exact Reference. Both URI and nonempty opaque revision are mandatory, with no undeclared members. Its revision denotes recorded content, not an implicit current selector." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "uri" | ref "#/$defs/absoluteUri" | yes | — | "Complete target identity carried by this Reference. Relative paths and partial Reference objects are not admitted." |

### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InBpbm5lZFR5cGVSZWZlcmVuY2Ui"></a>
## Schema: "pinnedTypeReference"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Exact Type affiliation using an absolute HTTP(S) Type identity and a nonempty opaque revision. Both members travel together." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/pinnedReference"
    },
    {
      "type": "object",
      "properties": {
        "uri": {
          "$ref": "#/$defs/absoluteHttpUrl"
        }
      }
    }
  ]
}
```

<a id="schema-def-InBvc2l0aXZlSW50ZWdlciI"></a>
## Schema: "positiveInteger"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Positive integral JSON number used for a declared bound or count. Implementations must preserve the specified numeric value rather than rely on a language-specific integer class." |
| minimum | 1 |
| type | "integer" |

<a id="schema-def-InByb2plY3RlZEJlYWRDb2xsZWN0aW9uIg"></a>
## Schema: "projectedBeadCollection"

Value: object

Other fields: not allowed

Required order: ["items","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Finite page of explicitly projected Bead carriers. Projection changes representation, not membership or exhaustion." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/projectedBeadRecord") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |

### Advanced

```json-schema
{
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-InByb2plY3RlZEJlYWRSZWNvcmQi"></a>
## Schema: "projectedBeadRecord"

Value: object

Other fields: not allowed

Required order: ["id","type","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicitly projected Bead representation. Identity, Type affiliation and revision stay mandatory; selected content may be omitted only under the projection contract." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "metadata" | ref "#/$defs/metadata" | no | — | "Common mutable object content, independent of Type-specific properties." |
| "ownedLinks" | schema | no | — | "Recorded revision-covered owned-Link capture, grouped by nominal Link-Type identity. It is derived state, not directly writable input." |
| "properties" | ref "#/$defs/properties" | no | — | "Application-authored object content selected by the containing representation." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

### Advanced

```json-schema
{
  "properties": {
    "ownedLinks": {
      "type": "object",
      "propertyNames": {
        "$ref": "#/$defs/absoluteHttpUrl"
      },
      "additionalProperties": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/linkRecord"
        }
      }
    },
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InByb2plY3RlZExpbmtDb2xsZWN0aW9uIg"></a>
## Schema: "projectedLinkCollection"

Value: object

Other fields: not allowed

Required order: ["items","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Finite page of explicitly projected Link carriers. Projection does not merge parallel Links or alter endpoint identity." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/projectedLinkRecord") | yes | — | "Finite ordered members of this page or bounded diagnosis. Meaning and completeness follow the containing operation." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |

### Advanced

```json-schema
{
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-InByb2plY3RlZExpbmtSZWNvcmQi"></a>
## Schema: "projectedLinkRecord"

Value: object

Other fields: not allowed

Required order: ["id","type","revision","source","target"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Explicitly projected Link representation. Identity, Type affiliation and revision stay mandatory and endpoint rules follow the selected projection mask." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "metadata" | ref "#/$defs/metadata" | no | — | "Common mutable object content, independent of Type-specific properties." |
| "properties" | ref "#/$defs/properties" | no | — | "Application-authored object content selected by the containing representation." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |
| "source" | ref "#/$defs/reference" | yes | — | "Whole source Reference of this directed Link, preserving any exact revision pin." |
| "target" | ref "#/$defs/reference" | yes | — | "Whole target Reference of a Link, preserving any exact revision pin." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InByb3BlcnRpZXMi"></a>
## Schema: "properties"

Value: object

Other fields: allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Application-authored object state. A URI-valued property does not create a Link, and the Core carrier imposes no Type-specific property schema." |
| type | "object" |

<a id="schema-def-InByb3BlcnR5Q2hhbmdlIg"></a>
## Schema: "propertyChange"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| minItems | 1 |
| type | "array" |

### Advanced

```json-schema
{
  "items": {
    "oneOf": [
      {
        "type": "object",
        "required": [
          "op",
          "path",
          "value"
        ],
        "properties": {
          "op": {
            "enum": [
              "add",
              "replace"
            ]
          },
          "path": {
            "$ref": "#/$defs/jsonPointer"
          },
          "value": true
        },
        "additionalProperties": false
      },
      {
        "type": "object",
        "required": [
          "op",
          "path"
        ],
        "properties": {
          "op": {
            "const": "remove"
          },
          "path": {
            "$ref": "#/$defs/jsonPointer"
          }
        },
        "additionalProperties": false
      }
    ]
  }
}
```

<a id="schema-def-InByb3RvY29sUHJvZmlsZSI"></a>
## Schema: "protocolProfile"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["read","read-update","transactional"] |

<a id="schema-def-InB1dEFsaWFzTWVtYmVycyI"></a>
## Schema: "putAliasMembers"

Value: object

Required order: ["alias","target"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "alias" | ref "#/$defs/durableResourceReference" | yes | — | — |
| "target" | ref "#/$defs/resourceReference" | yes | — | — |

<a id="schema-def-InB1dEFsaWFzUmVxdWVzdCI"></a>
## Schema: "putAliasRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "target" | ref "#/$defs/durableResourceReference" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/putAliasMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-InJlYWREaXNjb3Zlcnki"></a>
## Schema: "readDiscovery"

Value: object

Other fields: not allowed

Required order: ["bdpVersion","profile","scope","beads","links","types"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "aliases" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "bdpVersion" | ref "#/$defs/bdpVersion" | yes | — | — |
| "beads" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "capabilities" | ref "#/$defs/capabilityAdvertisements" | no | — | — |
| "historicalResolution" | ref "#/$defs/historyCapability" | no | — | — |
| "limits" | ref "#/$defs/advertisedLimits" | no | — | — |
| "links" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "maximumEndpointMultiplicity" | array of (ref "#/$defs/maximumEndpointMultiplicityPolicy") | no | — | — |
| "order" | schema | no | — | — |
| "profile" | schema | yes | — | — |
| "scope" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "types" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "order": {
      "enum": [
        "canonical-uri"
      ]
    },
    "profile": {
      "const": "read"
    }
  }
}
```

<a id="schema-def-InJlYWRQcm9ibGVtIg"></a>
## Schema: "readProblem"

Value: object

Required order: ["type","code","retry"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Core Problem Details carrier. Type/code/status/retry combinations and History-specific fields are constrained together; schema validity alone does not prove the original request was authorized." |
| title | "BDP Read Problem Details" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "code" | ref "#/$defs/readProblemCode" | yes | — | "Stable machine-readable Problem diagnosis, interpreted with type and retry." |
| "detail" | text | no | — | "Human-readable detail that obeys authorization and non-disclosure." |
| "instance" | ref "#/$defs/absoluteUri" | no | — | "Optional URI identifying this failure occurrence." |
| "retry" | ref "#/$defs/retryDisposition" | yes | — | "Required retry disposition for this exact diagnosis; it does not authorize changing intent." |
| "status" | schema | no | — | "HTTP status associated with this Problem; protocol decision order remains binding." |
| "title" | text | no | — | "Short human-readable Problem summary." |
| "type" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute stable Problem-type identity URI for this diagnosis, consistent with code/status/retry." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "code": {
            "const": "malformed-request"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/request"
          },
          "status": {
            "const": 400
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "invalid-parameter"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/request"
          },
          "status": {
            "const": 400
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "unauthenticated"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/authentication"
          },
          "status": {
            "const": 401
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "forbidden"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/authorization"
          },
          "status": {
            "const": 403
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-not-found"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/not-found"
          },
          "status": {
            "const": 404
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "foreign-view"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "cursor-expired"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "request-too-large"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/size"
          },
          "status": {
            "const": 413
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "limit-exceeded"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/size"
          },
          "status": {
            "const": 413
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "rate-limited"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/rate-limit"
          },
          "status": {
            "const": 429
          },
          "retry": {
            "const": "after-delay"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "temporarily-unavailable"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/unavailable"
          },
          "status": {
            "const": 503
          },
          "retry": {
            "const": "after-delay"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-pruned"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-erased"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-unknown"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/not-found"
          },
          "status": {
            "const": 404
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-unretained"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-reorganized"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-not-tracked"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-unrepresentable"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-pruned"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "archivedAt": {
            "$ref": "#/$defs/reference"
          }
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "resource-pruned"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "archivedAt": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-erased"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "pointer": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-unretained"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "required": [
          "missing"
        ],
        "properties": {
          "missing": {
            "$ref": "#/$defs/historyMissing"
          }
        }
      },
      "else": {
        "properties": {
          "missing": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "enum": [
              "revision-unknown",
              "revision-unretained",
              "revision-reorganized",
              "revision-not-tracked",
              "revision-unrepresentable"
            ]
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "window": false,
          "mayChangeAfterSync": false,
          "resource": false,
          "properties": false,
          "ownedLinks": false,
          "archivedAt": false,
          "pointer": false,
          "revisionProvenance": false
        }
      }
    }
  ],
  "properties": {
    "status": {
      "type": "integer",
      "enum": [
        400,
        401,
        403,
        404,
        409,
        410,
        413,
        429,
        503
      ]
    }
  }
}
```

<a id="schema-def-InJlYWRQcm9ibGVtQ29kZSI"></a>
## Schema: "readProblemCode"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Closed vocabulary of Core read diagnoses, including bounded History missing-state failures. HTTP disclosure and precedence rules still govern which diagnosis can be exposed." |
| enum | ["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","revision-unknown","revision-unretained","revision-reorganized","revision-not-tracked","revision-unrepresentable"] |

<a id="schema-def-InJlYWRVcGRhdGVBZHZlcnRpc2VkTGltaXRzIg"></a>
## Schema: "readUpdateAdvertisedLimits"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "page" | schema | no | — | — |
| "patch" | schema | no | — | — |
| "request" | schema | no | — | — |
| "resource" | schema | no | — | — |
| "retention" | schema | no | — | — |
| "selector" | schema | no | — | — |
| "sequence" | schema | no | — | — |
| "validation" | schema | no | — | — |

### Advanced

```json-schema
{
  "properties": {
    "page": {
      "type": "object",
      "properties": {
        "defaultItems": {
          "$ref": "#/$defs/positiveInteger"
        },
        "maximumItems": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "patch": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathDepth": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "request": {
      "type": "object",
      "properties": {
        "targetBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "bodyBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "resource": {
      "type": "object",
      "properties": {
        "representationBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "propertiesBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "retention": {
      "type": "object",
      "properties": {
        "idempotency": {
          "$ref": "#/$defs/iso8601Duration"
        },
        "maximumSnapshotLifetime": {
          "$ref": "#/$defs/iso8601Duration"
        }
      },
      "additionalProperties": false
    },
    "selector": {
      "type": "object",
      "properties": {
        "bytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "depth": {
          "$ref": "#/$defs/positiveInteger"
        },
        "nodes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "sequence": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "validation": {
      "type": "object",
      "properties": {
        "diagnostics": {
          "$ref": "#/$defs/positiveInteger"
        },
        "diagnosticBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    }
  }
}
```

<a id="schema-def-InJlYWRVcGRhdGVEaXNjb3Zlcnki"></a>
## Schema: "readUpdateDiscovery"

Value: object

Other fields: not allowed

Required order: ["bdpVersion","profile","scope","beads","links","types","operations","aliases"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "aliases" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "bdpVersion" | ref "#/$defs/bdpVersion" | yes | — | — |
| "beads" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "capabilities" | ref "#/$defs/capabilityAdvertisements" | no | — | — |
| "historicalResolution" | ref "#/$defs/historyCapability" | no | — | — |
| "limits" | ref "#/$defs/readUpdateAdvertisedLimits" | no | — | — |
| "links" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "maximumEndpointMultiplicity" | array of (ref "#/$defs/maximumEndpointMultiplicityPolicy") | no | — | — |
| "operations" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "order" | schema | no | — | — |
| "profile" | schema | yes | — | — |
| "scope" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "types" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "order": {
      "enum": [
        "canonical-uri"
      ]
    },
    "profile": {
      "const": "read-update"
    }
  }
}
```

<a id="schema-def-InJlYWRVcGRhdGVPcGVyYXRpb25EaXJlY3Rvcnki"></a>
## Schema: "readUpdateOperationDirectory"

Value: object

Other fields: not allowed

Required order: ["createBead","updateBead","deleteBead","createLink","updateLink","deleteLink","putAlias","deleteAlias","sequence"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "createBead" | schema | yes | — | — |
| "createLink" | schema | yes | — | — |
| "deleteAlias" | schema | yes | — | — |
| "deleteBead" | schema | yes | — | — |
| "deleteLink" | schema | yes | — | — |
| "putAlias" | schema | yes | — | — |
| "sequence" | schema | yes | — | — |
| "updateBead" | schema | yes | — | — |
| "updateLink" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "createBead": {
      "const": "create-bead"
    },
    "createLink": {
      "const": "create-link"
    },
    "deleteAlias": {
      "const": "delete-alias"
    },
    "deleteBead": {
      "const": "delete-bead"
    },
    "deleteLink": {
      "const": "delete-link"
    },
    "putAlias": {
      "const": "put-alias"
    },
    "sequence": {
      "const": "sequence"
    },
    "updateBead": {
      "const": "update-bead"
    },
    "updateLink": {
      "const": "update-link"
    }
  }
}
```

<a id="schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg"></a>
## Schema: "readUpdateProblem"

Value: object

Required order: ["type","code","retry"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Read+Update Problem Details" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "code" | ref "#/$defs/readUpdateProblemCode" | yes | — | — |
| "detail" | text | no | — | — |
| "diagnostics" | ref "#/$defs/validationDiagnostics" | no | — | — |
| "diagnosticsTruncated" | boolean | no | — | — |
| "instance" | ref "#/$defs/absoluteUri" | no | — | — |
| "retry" | ref "#/$defs/retryDisposition" | yes | — | — |
| "retryAfter" | schema | no | — | — |
| "status" | schema | no | — | — |
| "title" | text | no | — | — |
| "type" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "code": {
            "$ref": "#/$defs/readProblemCode"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "$ref": "#/$defs/readProblem"
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "unsupported-media-type"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/request"
          },
          "status": {
            "const": 415
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "binding-unavailable"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/request"
          },
          "status": {
            "const": 400
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "validation-failed"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/validation"
          },
          "status": {
            "const": 422
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "type-not-installed"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/validation"
          },
          "status": {
            "const": 422
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "identity-taken"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "alias-path-taken"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-mismatch"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "incident-links-exist"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "aggregate-constraint-violation"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "idempotency-conflict"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "idempotency-in-progress"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-delay"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "idempotency-expired"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-allocation-unsafe"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "validation-failed"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "required": [
          "diagnostics"
        ],
        "properties": {
          "diagnostics": {
            "$ref": "#/$defs/validationDiagnostics"
          }
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "validation-failed"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "diagnostics": false,
          "diagnosticsTruncated": false
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "resource-pruned"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "archivedAt": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "retry": {
            "const": "after-delay"
          }
        },
        "required": [
          "retry"
        ]
      },
      "else": {
        "properties": {
          "retryAfter": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "revision-allocation-unsafe"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "missing": false,
          "window": false,
          "resource": false,
          "properties": false,
          "ownedLinks": false,
          "pointer": false,
          "identity": false,
          "revision": false,
          "revisionProvenance": false
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "revision-unretained"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "missing": false
        }
      }
    }
  ],
  "properties": {
    "retryAfter": {
      "type": "integer",
      "minimum": 0
    },
    "status": {
      "type": "integer",
      "enum": [
        400,
        401,
        403,
        404,
        409,
        410,
        413,
        415,
        422,
        429,
        503
      ]
    }
  }
}
```

<a id="schema-def-InJlYWRVcGRhdGVQcm9ibGVtQ29kZSI"></a>
## Schema: "readUpdateProblemCode"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["malformed-request","invalid-parameter","unauthenticated","forbidden","resource-not-found","resource-pruned","resource-erased","foreign-view","cursor-expired","request-too-large","limit-exceeded","rate-limited","temporarily-unavailable","revision-unknown","revision-unretained","revision-reorganized","revision-not-tracked","revision-unrepresentable","unsupported-media-type","binding-unavailable","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","idempotency-conflict","idempotency-in-progress","idempotency-expired","revision-allocation-unsafe"] |

<a id="schema-def-InJlY2VpcHRDb3JlIg"></a>
## Schema: "receiptCore"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "allocated" | array of (ref "#/$defs/allocatedIdentity") | no | — | — |
| "authorizationView" | ref "#/$defs/wireToken" | no | — | — |
| "detail" | ref "#/$defs/receiptDetail" | no | — | — |
| "effectPosition" | ref "#/$defs/wireToken" | no | — | — |
| "expiresAt" | ref "#/$defs/dateTime" | no | — | — |
| "id" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "idempotencyKey" | ref "#/$defs/idempotencyKey" | no | — | — |
| "next" | schema | no | — | — |
| "problem" | ref "#/$defs/receiptProblem" | no | — | — |
| "requiredPosition" | ref "#/$defs/wireToken" | no | — | — |
| "results" | array of (ref "#/$defs/receiptResult") | no | — | — |
| "scopeEpoch" | ref "#/$defs/wireToken" | no | — | — |
| "status" | ref "#/$defs/receiptStatus" | no | — | — |
| "transaction" | ref "#/$defs/wireToken" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "status": {
            "const": "failed"
          }
        },
        "required": [
          "status"
        ]
      },
      "then": {
        "properties": {
          "effectPosition": false,
          "detail": {
            "const": "available"
          }
        }
      }
    }
  ],
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-InJlY2VpcHREZXRhaWwi"></a>
## Schema: "receiptDetail"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["available","expired","withheld"] |

<a id="schema-def-InJlY2VpcHRFbnRyeU91dGNvbWUi"></a>
## Schema: "receiptEntryOutcome"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["created","updated","deleted","matched","withheld","erased"] |

<a id="schema-def-InJlY2VpcHRQcm9ibGVtIg"></a>
## Schema: "receiptProblem"

Value: object

Required order: ["type","code","status","retry"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| dependentRequired | {"operationName":["operationIndex"]} |
| title | "BDP Mutation Receipt problem" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "code" | ref "#/$defs/receiptProblemCode" | yes | — | — |
| "detail" | text | no | — | — |
| "diagnostics" | ref "#/$defs/validationDiagnostics" | no | — | — |
| "diagnosticsTruncated" | boolean | no | — | — |
| "instance" | ref "#/$defs/absoluteUri" | no | — | — |
| "limit" | schema | no | — | — |
| "operationIndex" | schema | no | — | — |
| "operationName" | ref "#/$defs/localName" | no | — | — |
| "pointer" | ref "#/$defs/jsonPointer" | no | — | — |
| "retry" | ref "#/$defs/retryDisposition" | yes | — | — |
| "status" | schema | yes | — | — |
| "title" | text | no | — | — |
| "type" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "code": {
            "$ref": "#/$defs/readUpdateProblemCode"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "$ref": "#/$defs/readUpdateProblem"
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "cardinality-violated"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "diagnostics": false,
          "diagnosticsTruncated": false,
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/conflict"
          },
          "status": {
            "const": 409
          },
          "retry": {
            "const": "after-state-change"
          }
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "enum": [
                "limit-exceeded",
                "aggregate-constraint-violation"
              ]
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "required": [
          "operationIndex"
        ],
        "properties": {
          "operationIndex": true
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "limit-exceeded"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "limit": false
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "revision-unretained"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "missing": false
        }
      }
    }
  ],
  "properties": {
    "limit": {
      "type": "string",
      "pattern": "^[a-z]+\\.[A-Za-z]+$"
    },
    "operationIndex": {
      "type": "integer",
      "minimum": 0
    },
    "status": {
      "type": "integer",
      "enum": [
        400,
        403,
        404,
        409,
        413,
        422
      ]
    }
  }
}
```

<a id="schema-def-InJlY2VpcHRQcm9ibGVtQ29kZSI"></a>
## Schema: "receiptProblemCode"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["forbidden","resource-not-found","limit-exceeded","binding-unavailable","validation-failed","type-not-installed","identity-taken","alias-path-taken","revision-mismatch","incident-links-exist","aggregate-constraint-violation","cardinality-violated","revision-allocation-unsafe"] |

<a id="schema-def-InJlY2VpcHRSZXN1bHQi"></a>
## Schema: "receiptResult"

Value: object

Other fields: not allowed

Required order: ["operationIndex","outcome"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| dependentRequired | {"source":["sourceRevision"],"sourceRevision":["source"]} |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "alias" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "count" | schema | no | — | — |
| "deleted" | ref "#/$defs/deletedIdentity" | no | — | — |
| "erased" | ref "#/$defs/resourceIdentity" | no | — | — |
| "operationIndex" | schema | yes | — | — |
| "operationName" | ref "#/$defs/localName" | no | — | — |
| "outcome" | ref "#/$defs/receiptEntryOutcome" | yes | — | — |
| "resource" | schema | no | — | — |
| "source" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "sourceRevision" | ref "#/$defs/revision" | no | — | — |
| "target" | ref "#/$defs/absoluteHttpUrl" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "outcome": {
            "enum": [
              "created",
              "updated"
            ]
          }
        },
        "required": [
          "outcome"
        ],
        "not": {
          "properties": {
            "alias": true
          },
          "required": [
            "alias"
          ]
        }
      },
      "then": {
        "required": [
          "resource"
        ],
        "properties": {
          "resource": true,
          "deleted": false,
          "erased": false,
          "count": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "outcome": {
            "const": "deleted"
          }
        },
        "required": [
          "outcome"
        ],
        "not": {
          "properties": {
            "alias": true
          },
          "required": [
            "alias"
          ]
        }
      },
      "then": {
        "required": [
          "deleted"
        ],
        "properties": {
          "deleted": true,
          "resource": false,
          "erased": false,
          "count": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "outcome": {
            "const": "erased"
          }
        },
        "required": [
          "outcome"
        ]
      },
      "then": {
        "required": [
          "erased"
        ],
        "properties": {
          "erased": true,
          "resource": false,
          "deleted": false,
          "count": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "outcome": {
            "const": "matched"
          }
        },
        "required": [
          "outcome"
        ]
      },
      "then": {
        "required": [
          "count"
        ],
        "properties": {
          "count": true,
          "operationName": false,
          "resource": false,
          "deleted": false,
          "erased": false,
          "source": false,
          "sourceRevision": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "outcome": {
            "const": "withheld"
          }
        },
        "required": [
          "outcome"
        ]
      },
      "then": {
        "properties": {
          "resource": false,
          "deleted": false,
          "erased": false,
          "source": false,
          "sourceRevision": false,
          "count": false
        }
      }
    },
    {
      "if": {
        "required": [
          "resource"
        ],
        "properties": {
          "resource": {
            "$ref": "#/$defs/beadRecord"
          }
        }
      },
      "then": {
        "properties": {
          "source": false,
          "sourceRevision": false
        }
      }
    },
    {
      "if": {
        "required": [
          "deleted"
        ],
        "properties": {
          "deleted": {
            "type": "object",
            "required": [
              "resourceKind"
            ],
            "properties": {
              "resourceKind": {
                "const": "bead"
              }
            }
          }
        }
      },
      "then": {
        "properties": {
          "source": false,
          "sourceRevision": false
        }
      }
    },
    {
      "if": {
        "required": [
          "alias"
        ]
      },
      "then": {
        "allOf": [
          {
            "$ref": "#/$defs/aliasResultMembers"
          }
        ],
        "properties": {
          "operationIndex": {
            "const": 0
          },
          "operationName": false,
          "resource": false,
          "deleted": false,
          "erased": false,
          "source": false,
          "sourceRevision": false,
          "count": false
        }
      },
      "else": {
        "properties": {
          "target": false
        }
      }
    }
  ],
  "properties": {
    "count": {
      "type": "integer",
      "minimum": 0
    },
    "operationIndex": {
      "type": "integer",
      "minimum": 0
    },
    "resource": {
      "oneOf": [
        {
          "allOf": [
            {
              "$ref": "#/$defs/beadRecord"
            },
            {
              "type": "object",
              "properties": {
                "links": false
              }
            }
          ]
        },
        {
          "$ref": "#/$defs/linkRecord"
        }
      ]
    }
  }
}
```

<a id="schema-def-InJlY2VpcHRTdGF0dXMi"></a>
## Schema: "receiptStatus"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["pending","completed","failed"] |

<a id="schema-def-InJlZmVyZW5jZSI"></a>
## Schema: "reference"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A floating absolute URI or an exact URI-and-revision pair. The containing field determines whether only HTTP(S) identities are admissible; a pin is never merged with another Reference." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/absoluteUri"
    },
    {
      "$ref": "#/$defs/pinnedReference"
    }
  ]
}
```

<a id="schema-def-InJlc291cmNlSWRlbnRpdHki"></a>
## Schema: "resourceIdentity"

Value: object

Other fields: not allowed

Required order: ["id","type","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete identity, Type affiliation and concrete revision recorded for a Resource, including a deletion fact. It is not a live Resource postimage and carries no mutable properties." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute canonical immutable Resource identity URL." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource version." |
| "type" | ref "#/$defs/typeReference" | yes | — | "Complete recorded Type affiliation, preserving any revision pin." |

### Advanced

```json-schema
{
  "properties": {
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InJlc291cmNlS2luZCI"></a>
## Schema: "resourceKind"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "The two protocol Resource kinds. Kind is immutable and established by the resolved Resource, never inferred from its URL path." |
| enum | ["bead","link"] |

<a id="schema-def-InJlc291cmNlUHJvamVjdGlvbkNhcGFiaWxpdHlQcm9ibGVtIg"></a>
## Schema: "resourceProjectionCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","code","retry","status","capability","capabilityVersion"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Problem carrier for unsupported projection capability or version selection. Unsupported meaning cannot silently downgrade." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | "Exact capability identity associated with this refusal. It does not advertise that capability as supported." |
| "capabilityVersion" | schema | yes | — | "Exact nonempty capability version selected by this request or diagnosed by this Problem. It has no implicit ordering or upgrade." |
| "code" | schema | yes | — | "Stable machine-readable Problem diagnosis, interpreted with type and retry." |
| "detail" | text | no | — | "Human-readable detail that obeys authorization and non-disclosure." |
| "instance" | ref "#/$defs/absoluteUri" | no | — | "Optional URI identifying this failure occurrence." |
| "retry" | schema | yes | — | "Required retry disposition for this exact diagnosis; it does not authorize changing intent." |
| "status" | schema | yes | — | "HTTP status associated with this Problem; protocol decision order remains binding." |
| "title" | text | no | — | "Short human-readable Problem summary." |
| "type" | schema | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/resource-projection"
    },
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    },
    "code": {
      "const": "capability-not-supported"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```

<a id="schema-def-InJlc291cmNlUHJvamVjdGlvbkNhcGFiaWxpdHlWMSI"></a>
## Schema: "resourceProjectionCapabilityV1"

Value: object

Other fields: not allowed

Required order: ["current","exact","list"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Version-1 projection support flags for current, exact and inventory reads. At least one form is supported; each true flag commits to its complete representation semantics." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "current" | boolean | yes | — | "Whether this capability supports current point reads." |
| "exact" | boolean | yes | — | "Whether this capability supports exact retained point reads." |
| "list" | boolean | yes | — | "Whether this capability supports inventory pages." |

### Advanced

```json-schema
{
  "anyOf": [
    {
      "required": [
        "current"
      ],
      "properties": {
        "current": {
          "const": true
        }
      }
    },
    {
      "required": [
        "exact"
      ],
      "properties": {
        "exact": {
          "const": true
        }
      }
    },
    {
      "required": [
        "list"
      ],
      "properties": {
        "list": {
          "const": true
        }
      }
    }
  ]
}
```

<a id="schema-def-InJlc291cmNlUHJvamVjdGlvbkludmVudG9yeVF1ZXJ5VjEi"></a>
## Schema: "resourceProjectionInventoryQueryV1"

Value: object

Other fields: not allowed

Required order: ["projectionVersion"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete decoded version-1 inventory projection query. Continuations preserve the admitted mask, selection, ordering and read context." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "conformsTo" | ref "#/$defs/absoluteHttpUrl" | no | — | "Explicit nominal Type-family inventory filter. It selects membership and is not a projected Resource property." |
| "cursor" | schema | no | — | "Opaque issued inventory continuation token preserving the selected mask, filters, order and authorization context." |
| "endpoint" | schema | no | — | "Decoded incident-endpoint filter string, selecting Links at either end under the ordinary inventory rules." |
| "fields" | ref "#/$defs/resourceProjectionMask" | no | — | "Explicit content projection mask, evaluated under the shared include/omit rules." |
| "limit" | ref "#/$defs/positiveInteger" | no | — | "Positive admitted Resource-record page bound; continuation and exhaustion obey the ordinary inventory rules." |
| "projectionVersion" | schema | yes | — | "Explicit projection version selector. Missing or unsupported selection cannot be treated as version 1." |
| "selector" | schema | no | — | "Nonempty decoded ordinary Selector string, using its bounded candidate-local grammar rather than the structured Query AST." |
| "source" | schema | no | — | "Decoded source-endpoint filter string under the ordinary Link inventory rules; it is not a Link record member." |
| "target" | schema | no | — | "Decoded target-endpoint filter string under the ordinary Link inventory rules; it is not a Link record member." |
| "type" | ref "#/$defs/absoluteHttpUrl" | no | — | "Exact nominal Type-identity inventory filter. This is not a returned Resource affiliation or a version pin." |

### Advanced

```json-schema
{
  "properties": {
    "cursor": {
      "type": "string",
      "minLength": 1
    },
    "endpoint": {
      "type": "string",
      "minLength": 1
    },
    "projectionVersion": {
      "const": "1"
    },
    "selector": {
      "type": "string",
      "minLength": 1
    },
    "source": {
      "type": "string",
      "minLength": 1
    },
    "target": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InJlc291cmNlUHJvamVjdGlvbk1hc2si"></a>
## Schema: "resourceProjectionMask"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Nonempty include/omit JSON Pointer mask. Mask syntax does not allow partial mutation, implicit admission changes or a forged full record." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "include" | schema | no | — | "Nonempty paths whose selected content enters the projection." |
| "omit" | schema | no | — | "Nonempty paths removed after include selection; identity carrier rules still apply." |

### Advanced

```json-schema
{
  "anyOf": [
    {
      "required": [
        "include"
      ],
      "properties": {
        "include": true
      }
    },
    {
      "required": [
        "omit"
      ],
      "properties": {
        "omit": true
      }
    }
  ],
  "properties": {
    "include": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/jsonPointer"
      }
    },
    "omit": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/jsonPointer"
      }
    }
  }
}
```

<a id="schema-def-InJlc291cmNlUHJvamVjdGlvblBvaW50UXVlcnlWMSI"></a>
## Schema: "resourceProjectionPointQueryV1"

Value: object

Other fields: not allowed

Required order: ["projectionVersion"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete decoded version-1 point projection query, optionally selecting an exact revision. Unsupported projection must refuse rather than return an unlabelled full representation." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "fields" | ref "#/$defs/resourceProjectionMask" | no | — | "Explicit content projection mask, evaluated under the shared include/omit rules." |
| "projectionVersion" | schema | yes | — | "Explicit projection version selector. Missing or unsupported selection cannot be treated as version 1." |
| "revision" | ref "#/$defs/revision" | no | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |

### Advanced

```json-schema
{
  "properties": {
    "projectionVersion": {
      "const": "1"
    }
  }
}
```

<a id="schema-def-InJlc291cmNlUHJvamVjdGlvblByb2JsZW0i"></a>
## Schema: "resourceProjectionProblem"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Problem carrier for admitted projection reads, retaining ordinary read and History diagnoses." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/readProblem"
    },
    {
      "$ref": "#/$defs/resourceProjectionCapabilityProblem"
    }
  ]
}
```

<a id="schema-def-InJlc291cmNlUHJvamVjdGlvblNlbGVjdGlvbiI"></a>
## Schema: "resourceProjectionSelection"

Value: object

Required order: ["projectionVersion"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Projection-version admission discriminator. It is only a preliminary selector; complete decoded point or inventory parameters have their own closed shapes." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "projectionVersion" | schema | yes | — | "Explicit projection version selector. Missing or unsupported selection cannot be treated as version 1." |

### Advanced

```json-schema
{
  "properties": {
    "projectionVersion": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InJlc291cmNlUmVmZXJlbmNlIg"></a>
## Schema: "resourceReference"

Value: object

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/durableResourceReference"
    },
    {
      "$ref": "#/$defs/localBindingReference"
    }
  ]
}
```

<a id="schema-def-InJldGFpbmVkRGVsdGFFZmZlY3Qi"></a>
## Schema: "retainedDeltaEffect"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One realized create, update or deletion effect in optional delta form. It records actual admitted changes and never becomes a command to execute again." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "required": [
        "operation",
        "id",
        "type",
        "properties",
        "metadata"
      ],
      "properties": {
        "operation": {
          "const": "createBead"
        },
        "id": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "type": {
          "$ref": "#/$defs/typeReference"
        },
        "properties": {
          "$ref": "#/$defs/properties"
        },
        "metadata": {
          "$ref": "#/$defs/metadata"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "bead"
      ],
      "properties": {
        "operation": {
          "const": "updateBead"
        },
        "bead": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "type": {
          "$ref": "#/$defs/typeReference"
        },
        "properties": {
          "$ref": "#/$defs/properties"
        },
        "metadata": {
          "$ref": "#/$defs/metadata"
        },
        "propertiesChange": {
          "$ref": "#/$defs/propertyChange"
        },
        "metadataChange": {
          "$ref": "#/$defs/propertyChange"
        }
      },
      "additionalProperties": false,
      "allOf": [
        {
          "not": {
            "required": [
              "properties",
              "propertiesChange"
            ],
            "type": "object",
            "properties": {
              "properties": true,
              "propertiesChange": true
            }
          }
        },
        {
          "not": {
            "required": [
              "metadata",
              "metadataChange"
            ],
            "type": "object",
            "properties": {
              "metadata": true,
              "metadataChange": true
            }
          }
        }
      ]
    },
    {
      "type": "object",
      "required": [
        "operation",
        "bead",
        "deleted"
      ],
      "properties": {
        "operation": {
          "const": "deleteBead"
        },
        "bead": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "deleted": {
          "allOf": [
            {
              "$ref": "#/$defs/retainedEventDeleted"
            },
            {
              "type": "object",
              "properties": {
                "resourceKind": {
                  "const": "bead"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "id",
        "type",
        "properties",
        "metadata",
        "source",
        "target"
      ],
      "properties": {
        "operation": {
          "const": "createLink"
        },
        "id": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "type": {
          "$ref": "#/$defs/typeReference"
        },
        "properties": {
          "$ref": "#/$defs/properties"
        },
        "metadata": {
          "$ref": "#/$defs/metadata"
        },
        "source": {
          "$ref": "#/$defs/reference"
        },
        "target": {
          "$ref": "#/$defs/reference"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "link"
      ],
      "properties": {
        "operation": {
          "const": "updateLink"
        },
        "link": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "type": {
          "$ref": "#/$defs/typeReference"
        },
        "properties": {
          "$ref": "#/$defs/properties"
        },
        "metadata": {
          "$ref": "#/$defs/metadata"
        },
        "propertiesChange": {
          "$ref": "#/$defs/propertyChange"
        },
        "metadataChange": {
          "$ref": "#/$defs/propertyChange"
        },
        "source": {
          "$ref": "#/$defs/reference"
        },
        "target": {
          "$ref": "#/$defs/reference"
        }
      },
      "additionalProperties": false,
      "allOf": [
        {
          "not": {
            "required": [
              "properties",
              "propertiesChange"
            ],
            "type": "object",
            "properties": {
              "properties": true,
              "propertiesChange": true
            }
          }
        },
        {
          "not": {
            "required": [
              "metadata",
              "metadataChange"
            ],
            "type": "object",
            "properties": {
              "metadata": true,
              "metadataChange": true
            }
          }
        }
      ],
      "anyOf": [
        {
          "required": [
            "type"
          ],
          "type": "object",
          "properties": {
            "type": true
          }
        },
        {
          "required": [
            "properties"
          ],
          "type": "object",
          "properties": {
            "properties": true
          }
        },
        {
          "required": [
            "metadata"
          ],
          "type": "object",
          "properties": {
            "metadata": true
          }
        },
        {
          "required": [
            "propertiesChange"
          ],
          "type": "object",
          "properties": {
            "propertiesChange": true
          }
        },
        {
          "required": [
            "metadataChange"
          ],
          "type": "object",
          "properties": {
            "metadataChange": true
          }
        },
        {
          "required": [
            "source"
          ],
          "type": "object",
          "properties": {
            "source": true
          }
        },
        {
          "required": [
            "target"
          ],
          "type": "object",
          "properties": {
            "target": true
          }
        }
      ]
    },
    {
      "type": "object",
      "required": [
        "operation",
        "link",
        "deleted"
      ],
      "properties": {
        "operation": {
          "const": "deleteLink"
        },
        "link": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "deleted": {
          "allOf": [
            {
              "$ref": "#/$defs/retainedEventDeleted"
            },
            {
              "type": "object",
              "properties": {
                "resourceKind": {
                  "const": "link"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    }
  ]
}
```

<a id="schema-def-InJldGFpbmVkRGVsdGFFdmVudCI"></a>
## Schema: "retainedDeltaEvent"

Value: object

Required order: ["representation","effect"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete Event carrying a realized delta effect. A supplied previous revision denotes the actual observed predecessor, not an invented immediate mutation." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "derived" | ref "#/$defs/retainedEventDerived" | no | — | "Recorded derived owned-Link state accompanying this published Bead revision, when required by the effect." |
| "effect" | ref "#/$defs/retainedDeltaEffect" | yes | — | "Exactly one realized published mutation effect. It records final state or admitted change and is never an executable write request." |
| "representation" | schema | yes | — | "Explicit Event representation, postimage or delta." |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | "Immutable carried attribution for this concrete version; it authenticates no principal." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/retainedEventCommon"
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "createBead",
                  "createLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "properties": {
          "previousRevision": false
        }
      }
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "updateBead",
                  "updateLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "required": [
          "previousRevision"
        ],
        "type": "object",
        "properties": {
          "previousRevision": true
        }
      }
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "deleteBead",
                  "deleteLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "properties": {
          "previousRevision": false
        }
      }
    },
    {
      "if": {
        "required": [
          "derived"
        ],
        "type": "object",
        "properties": {
          "derived": true
        }
      },
      "then": {
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "createBead",
                  "updateBead"
                ]
              }
            }
          }
        }
      }
    },
    {
      "if": {
        "required": [
          "effect"
        ],
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "const": "updateBead"
              }
            }
          }
        },
        "type": "object"
      },
      "then": {
        "anyOf": [
          {
            "required": [
              "derived"
            ],
            "type": "object",
            "properties": {
              "derived": true
            }
          },
          {
            "properties": {
              "effect": {
                "type": "object",
                "anyOf": [
                  {
                    "required": [
                      "type"
                    ],
                    "type": "object",
                    "properties": {
                      "type": true
                    }
                  },
                  {
                    "required": [
                      "properties"
                    ],
                    "type": "object",
                    "properties": {
                      "properties": true
                    }
                  },
                  {
                    "required": [
                      "propertiesChange"
                    ],
                    "type": "object",
                    "properties": {
                      "propertiesChange": true
                    }
                  },
                  {
                    "required": [
                      "metadata"
                    ],
                    "type": "object",
                    "properties": {
                      "metadata": true
                    }
                  },
                  {
                    "required": [
                      "metadataChange"
                    ],
                    "type": "object",
                    "properties": {
                      "metadataChange": true
                    }
                  }
                ]
              }
            }
          }
        ]
      }
    },
    {
      "if": {
        "required": [
          "effect"
        ],
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "deleteBead",
                  "deleteLink"
                ]
              }
            }
          }
        },
        "type": "object"
      },
      "then": {
        "properties": {
          "revisionProvenance": false
        }
      }
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "representation": {
      "const": "delta"
    }
  }
}
```

<a id="schema-def-InJldGFpbmVkRGlzY292ZXJ5Ig"></a>
## Schema: "retainedDiscovery"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "Selected retained Core or Write discovery" |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/coreDiscovery"
    },
    {
      "$ref": "#/$defs/writeDiscovery"
    }
  ]
}
```

<a id="schema-def-InJldGFpbmVkRXZlbnQi"></a>
## Schema: "retainedEvent"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Union of the supported complete postimage and delta Event shapes. Schema acceptance does not prove truthful coverage, retention or atomic production." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/retainedPostimageEvent"
    },
    {
      "$ref": "#/$defs/retainedDeltaEvent"
    }
  ]
}
```

<a id="schema-def-InJldGFpbmVkRXZlbnRDb21tb24i"></a>
## Schema: "retainedEventCommon"

Value: object

Required order: ["id","source","time","origin","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Shared immutable fact envelope. Write-origin facts carry commit correlation; observation-origin facts describe the source’s truthful observation limitations." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "annotations" | schema | no | — | "Explicit extension annotations. Unsupported required meaning cannot silently become known meaning." |
| "id" | ref "#/$defs/wireToken" | yes | — | "Opaque immutable fact identity scoped to this Event source; it is not a Resource ID or resume cursor." |
| "origin" | schema | yes | — | "Whether this fact came from Write’s own committed transition or truthful external observation." |
| "previousRevision" | ref "#/$defs/revision" | no | — | "Actual known observed predecessor; omission never invents intermediate revisions." |
| "revision" | ref "#/$defs/revision" | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "source" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute URL of the observation source that emitted this fact." |
| "time" | ref "#/$defs/dateTime" | yes | — | "Recorded Event time, not a global ordering or an authentication proof." |
| "transaction" | ref "#/$defs/wireToken" | no | — | "Opaque commit correlation for Write-origin facts. It is neither a receipt nor a public replica-log position." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "origin": {
            "const": "write"
          }
        },
        "required": [
          "origin"
        ],
        "type": "object"
      },
      "then": {
        "required": [
          "transaction"
        ],
        "type": "object",
        "properties": {
          "transaction": true
        }
      }
    }
  ],
  "properties": {
    "annotations": {
      "type": "object",
      "additionalProperties": true
    },
    "origin": {
      "enum": [
        "write",
        "observation"
      ]
    }
  }
}
```

<a id="schema-def-InJldGFpbmVkRXZlbnRDb3ZlcmFnZSI"></a>
## Schema: "retainedEventCoverage"

Value: object

Other fields: not allowed

Required order: ["start","retainedFrom","through"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Opaque start, retained replay floor and captured upper boundary for the observation regime. These fields never imply a cross-source global position." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "retainedFrom" | ref "#/$defs/wireToken" | yes | — | "Opaque current replay floor under the retention promises." |
| "start" | ref "#/$defs/wireToken" | yes | — | "Opaque boundary where the described observation regime begins." |
| "through" | ref "#/$defs/wireToken" | yes | — | "Opaque fixed upper boundary captured for this finite traversal." |

<a id="schema-def-InJldGFpbmVkRXZlbnREZWxldGVkIg"></a>
## Schema: "retainedEventDeleted"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Deleted Resource identity and recorded affiliation/revision context. Write-origin deletion uses its actual final-live context; observation-origin disappearance uses the last complete observed sample and does not claim an unseen final backend edition. This is not a live postimage or permission to reuse identity." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "required": [
        "resourceKind",
        "resource"
      ],
      "properties": {
        "resourceKind": {
          "const": "bead"
        },
        "resource": {
          "$ref": "#/$defs/resourceIdentity"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "resourceKind",
        "resource",
        "source",
        "target"
      ],
      "properties": {
        "resourceKind": {
          "const": "link"
        },
        "resource": {
          "$ref": "#/$defs/resourceIdentity"
        },
        "source": {
          "$ref": "#/$defs/reference"
        },
        "target": {
          "$ref": "#/$defs/reference"
        }
      },
      "additionalProperties": false
    }
  ]
}
```

<a id="schema-def-InJldGFpbmVkRXZlbnREZXJpdmVkIg"></a>
## Schema: "retainedEventDerived"

Value: object

Other fields: not allowed

Required order: ["ownedLinks"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Realized owned-Link state for the published Bead revision. Null and an object retain their explicit meanings; omitted state is not fabricated." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "ownedLinks" | schema | yes | — | "Recorded revision-covered owned-Link capture, grouped by nominal Link-Type identity. It is derived state, not directly writable input." |

### Advanced

```json-schema
{
  "properties": {
    "ownedLinks": {
      "oneOf": [
        {
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/absoluteHttpUrl"
          },
          "additionalProperties": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/linkRecord"
            }
          }
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-InJldGFpbmVkRXZlbnRQYWdlIg"></a>
## Schema: "retainedEventPage"

Value: object

Other fields: not allowed

Required order: ["source","selection","policy","coverage","events","cursor","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Finite Event page with selected representation, truthful policy and coverage, ordered facts, a resume cursor and explicit continuation. Null next means the captured interval is exhausted." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "coverage" | ref "#/$defs/retainedEventCoverage" | yes | — | "Actual observation boundaries, not a fabricated complete mutation history." |
| "cursor" | ref "#/$defs/wireToken" | yes | — | "Opaque resume token covering the facts/scanned positions claimed by this page." |
| "events" | array of (ref "#/$defs/retainedEvent") | yes | — | "Required ordered array of the facts delivered in this finite page. An empty array alone does not establish exhaustion or uninterrupted coverage." |
| "next" | schema | yes | — | "Absolute continuation URL, or explicit null only when the admitted finite traversal is exhausted." |
| "policy" | ref "#/$defs/retainedEventPolicy" | yes | — | "Truthful observation mechanism and durable retention/cursor promises." |
| "selection" | ref "#/$defs/retainedEventSelection" | yes | — | "Complete admitted traversal/representation selection echoed by the response." |
| "source" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Absolute URL of this observation source; each delivered fact must agree with it." |
| "subject" | ref "#/$defs/absoluteHttpUrl" | no | — | "Canonical Resource identity to which this retained page or Resource-scoped observation applies." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "selection": {
            "type": "object",
            "properties": {
              "representation": {
                "const": "postimage"
              }
            },
            "required": [
              "representation"
            ]
          }
        },
        "required": [
          "selection"
        ],
        "type": "object"
      },
      "then": {
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/retainedPostimageEvent"
            }
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "selection": {
            "type": "object",
            "properties": {
              "representation": {
                "const": "delta"
              }
            },
            "required": [
              "representation"
            ]
          }
        },
        "required": [
          "selection"
        ],
        "type": "object"
      },
      "then": {
        "properties": {
          "events": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/retainedDeltaEvent"
            }
          },
          "policy": {
            "type": "object",
            "properties": {
              "representations": {
                "type": "array",
                "contains": {
                  "const": "delta"
                }
              }
            }
          }
        }
      }
    }
  ],
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-InJldGFpbmVkRXZlbnRQb2xpY3ki"></a>
## Schema: "retainedEventPolicy"

Value: object

Other fields: not allowed

Required order: ["observation","description","minimumRetentionSeconds","minimumCursorLifetimeSeconds","representations"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Truthful observation mechanism and positive retention/cursor promises. Postimage support is mandatory once Events is advertised; delta is optional." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "description" | schema | yes | — | "Human-readable explanation of the advertised mechanism or limitation." |
| "maximumPageSize" | schema | no | — | "Optional positive Event-page bound without permission to split or truncate a fact." |
| "minimumCursorLifetimeSeconds" | schema | yes | — | "Positive minimum lifetime preserving issued cursor context and its captured range." |
| "minimumRetentionSeconds" | schema | yes | — | "Positive minimum retention promise for admitted Event facts." |
| "observation" | schema | yes | — | "Truthful observation mode: committed or observed, with its complete coverage obligations." |
| "representations" | schema | yes | — | "Supported Event representations, necessarily including postimage." |

### Advanced

```json-schema
{
  "properties": {
    "description": {
      "type": "string",
      "minLength": 1
    },
    "maximumPageSize": {
      "type": "integer",
      "minimum": 1
    },
    "minimumCursorLifetimeSeconds": {
      "type": "integer",
      "minimum": 1
    },
    "minimumRetentionSeconds": {
      "type": "integer",
      "minimum": 1
    },
    "observation": {
      "enum": [
        "committed",
        "observed"
      ]
    },
    "representations": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": {
        "enum": [
          "postimage",
          "delta"
        ]
      },
      "contains": {
        "const": "postimage"
      }
    }
  }
}
```

<a id="schema-def-InJldGFpbmVkRXZlbnRQcm9ibGVtIg"></a>
## Schema: "retainedEventProblem"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Event-read Problem carrier. It retains Core authentication, disclosure, bounds and cursor diagnosis rules; failure never certifies consumer progress." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/readProblem"
    },
    {
      "type": "object",
      "properties": {
        "code": {
          "enum": [
            "malformed-request",
            "invalid-parameter",
            "unauthenticated",
            "forbidden",
            "resource-not-found",
            "resource-erased",
            "foreign-view",
            "cursor-expired",
            "request-too-large",
            "limit-exceeded",
            "rate-limited",
            "temporarily-unavailable"
          ]
        }
      }
    }
  ]
}
```

<a id="schema-def-InJldGFpbmVkRXZlbnRRdWVyeSI"></a>
## Schema: "retainedEventQuery"

Value: object

Other fields: not allowed

Required order: []

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Decoded finite Event query. From and after are mutually exclusive; selection, cursor binding and raw HTTP duplicate-parameter refusal remain semantic rules." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "after" | ref "#/$defs/wireToken" | no | — | "Opaque issued resume cursor, bound to its original source, selection and context." |
| "from" | schema | no | — | "Initial Event boundary selection, retained or now; mutually exclusive with after." |
| "limit" | schema | no | — | "Positive admitted per-page bound. It does not permit partial facts or false exhaustion." |
| "representation" | schema | no | — | "Explicit Event representation, postimage or delta." |

### Advanced

```json-schema
{
  "not": {
    "required": [
      "from",
      "after"
    ],
    "type": "object",
    "properties": {
      "from": true,
      "after": true
    }
  },
  "properties": {
    "from": {
      "enum": [
        "retained",
        "now"
      ]
    },
    "limit": {
      "type": "integer",
      "minimum": 1
    },
    "representation": {
      "enum": [
        "postimage",
        "delta"
      ]
    }
  }
}
```

<a id="schema-def-InJldGFpbmVkRXZlbnRTZWxlY3Rpb24i"></a>
## Schema: "retainedEventSelection"

Value: object

Other fields: not allowed

Required order: ["representation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete selected Event representation echoed by a finite traversal. A continuation cannot silently switch postimage and delta semantics." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "representation" | schema | yes | — | "Explicit Event representation, postimage or delta." |

### Advanced

```json-schema
{
  "properties": {
    "representation": {
      "enum": [
        "postimage",
        "delta"
      ]
    }
  }
}
```

<a id="schema-def-InJldGFpbmVkUG9zdGltYWdlRWZmZWN0Ig"></a>
## Schema: "retainedPostimageEffect"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "One published create, update or deletion effect expressed using the mutation vocabulary. Live effects contain complete final postimages, not transient staging state." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "required": [
        "operation",
        "id",
        "resource"
      ],
      "properties": {
        "operation": {
          "const": "createBead"
        },
        "id": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "resource": {
          "allOf": [
            {
              "$ref": "#/$defs/beadRecord"
            },
            {
              "type": "object",
              "required": [
                "metadata"
              ],
              "properties": {
                "metadata": true,
                "links": false
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "bead",
        "resource"
      ],
      "properties": {
        "operation": {
          "const": "updateBead"
        },
        "bead": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "resource": {
          "allOf": [
            {
              "$ref": "#/$defs/beadRecord"
            },
            {
              "type": "object",
              "required": [
                "metadata"
              ],
              "properties": {
                "metadata": true,
                "links": false
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "bead",
        "deleted"
      ],
      "properties": {
        "operation": {
          "const": "deleteBead"
        },
        "bead": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "deleted": {
          "allOf": [
            {
              "$ref": "#/$defs/retainedEventDeleted"
            },
            {
              "type": "object",
              "properties": {
                "resourceKind": {
                  "const": "bead"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "id",
        "resource"
      ],
      "properties": {
        "operation": {
          "const": "createLink"
        },
        "id": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "resource": {
          "allOf": [
            {
              "$ref": "#/$defs/linkRecord"
            },
            {
              "type": "object",
              "required": [
                "metadata"
              ],
              "properties": {
                "metadata": true
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "link",
        "resource"
      ],
      "properties": {
        "operation": {
          "const": "updateLink"
        },
        "link": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "resource": {
          "allOf": [
            {
              "$ref": "#/$defs/linkRecord"
            },
            {
              "type": "object",
              "required": [
                "metadata"
              ],
              "properties": {
                "metadata": true
              }
            }
          ]
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "operation",
        "link",
        "deleted"
      ],
      "properties": {
        "operation": {
          "const": "deleteLink"
        },
        "link": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "deleted": {
          "allOf": [
            {
              "$ref": "#/$defs/retainedEventDeleted"
            },
            {
              "type": "object",
              "properties": {
                "resourceKind": {
                  "const": "link"
                }
              }
            }
          ]
        }
      },
      "additionalProperties": false
    }
  ]
}
```

<a id="schema-def-InJldGFpbmVkUG9zdGltYWdlRXZlbnQi"></a>
## Schema: "retainedPostimageEvent"

Value: object

Required order: ["representation","effect"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete Event carrying a postimage effect. The Event’s source, representation, revision and envelope must agree with its page and actual published transition." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "effect" | ref "#/$defs/retainedPostimageEffect" | yes | — | "Exactly one realized published mutation effect. It records final state or admitted change and is never an executable write request." |
| "representation" | schema | yes | — | "Explicit Event representation, postimage or delta." |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/retainedEventCommon"
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "createBead",
                  "createLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "properties": {
          "previousRevision": false
        }
      }
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "updateBead",
                  "updateLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "required": [
          "previousRevision"
        ],
        "type": "object",
        "properties": {
          "previousRevision": true
        }
      }
    },
    {
      "if": {
        "type": "object",
        "properties": {
          "effect": {
            "type": "object",
            "required": [
              "operation"
            ],
            "properties": {
              "operation": {
                "enum": [
                  "deleteBead",
                  "deleteLink"
                ]
              }
            }
          }
        },
        "required": [
          "effect"
        ]
      },
      "then": {
        "properties": {
          "previousRevision": false
        }
      }
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "representation": {
      "const": "postimage"
    }
  }
}
```

<a id="schema-def-InJldHJ5RGlzcG9zaXRpb24i"></a>
## Schema: "retryDisposition"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Protocol retry guidance. A refusal does not authorize changing semantic intent or minting a fresh execution key to evade durable no-reexecution." |
| enum | ["never","after-state-change","after-delay"] |

<a id="schema-def-InJldmlzaW9uIg"></a>
## Schema: "revision"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Nonempty opaque Resource-version token. Clients compare it for exact equality and cannot infer order, time, allocation or a special current value from its spelling." |
| minLength | 1 |
| type | "string" |

<a id="schema-def-InJldmlzaW9uQWN0b3Ii"></a>
## Schema: "revisionActor"

Value: object

Other fields: not allowed

Required order: ["id","basis"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Recorded principal and explicit attribution basis. Writer-supplied and unknown describe how the value was carried; neither asserts authentication." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "basis" | schema | yes | — | "How the principal value was carried: writer-supplied or unknown. Neither means authenticated." |
| "id" | schema | yes | — | "Opaque recorded principal identifier, such as agent:planner. It is not a Resource URL or an authentication assertion." |

### Advanced

```json-schema
{
  "properties": {
    "basis": {
      "type": "string",
      "enum": [
        "writer-supplied",
        "unknown"
      ]
    },
    "id": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InJldmlzaW9uQWxsb2NhdGlvblVuc2FmZVByb2JsZW0i"></a>
## Schema: "revisionAllocationUnsafeProblem"

Value: object

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/readUpdateProblem"
    },
    {
      "type": "object",
      "properties": {
        "code": {
          "const": "revision-allocation-unsafe"
        }
      }
    }
  ]
}
```

<a id="schema-def-InJldmlzaW9uUHJvdmVuYW5jZSI"></a>
## Schema: "revisionProvenance"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| dependentRequired | {"committedAt":["agent","message"],"agent":["committedAt","message"],"message":["committedAt","agent"]} |
| description | "Optional per-version attribution envelope. Actor attribution is independent of the optional complete committedAt/agent/message tuple; omission does not invent an actor or context." |
| minProperties | 1 |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "actor" | ref "#/$defs/revisionActor" | no | — | "Carried principal attribution and explicit basis, independent of the optional History context tuple." |
| "agent" | ref "#/$defs/contextString" | no | — | "Immutable carried agent label, not an authentication result." |
| "committedAt" | ref "#/$defs/contextTime" | no | — | "Immutable recorded commit-time context, present with agent and message as one complete tuple." |
| "message" | ref "#/$defs/contextMessage" | no | — | "Immutable carried change message, present with committedAt and agent." |

<a id="schema-def-InJldmlzaW9uUHJvdmVuYW5jZUlucHV0Ig"></a>
## Schema: "revisionProvenanceInput"

Value: object

Other fields: not allowed

Required order: []

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "actor" | ref "#/$defs/revisionActor" | no | — | — |
| "agent" | schema | no | — | — |
| "message" | schema | no | — | — |

### Advanced

```json-schema
{
  "properties": {
    "agent": {
      "anyOf": [
        {
          "type": "string",
          "minLength": 1
        },
        {
          "type": "null"
        }
      ]
    },
    "message": {
      "type": [
        "string",
        "null"
      ]
    }
  }
}
```

<a id="schema-def-InNlbGVjdG9yIg"></a>
## Schema: "selector"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Nonempty ordinary bounded Selector string. Its candidate-local grammar, limits and admitted operators are defined by Selection; it never silently becomes the structured Query AST." |
| minLength | 1 |
| type | "string" |

<a id="schema-def-InNlcXVlbmNlQWxsb2NhdGVkSWRlbnRpdHki"></a>
## Schema: "sequenceAllocatedIdentity"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP sequence expired-creation identity projection" |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "required": [
        "id",
        "type"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        "type": {
          "$ref": "#/$defs/absoluteHttpUrl"
        }
      },
      "additionalProperties": false
    },
    {
      "type": "object",
      "required": [
        "withheld"
      ],
      "properties": {
        "withheld": {
          "const": true
        }
      },
      "additionalProperties": false
    }
  ]
}
```

<a id="schema-def-InNlcXVlbmNlQ3JlYXRlQmVhZCI"></a>
## Schema: "sequenceCreateBead"

Value: object

Required order: ["operation","idempotencyKey"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idempotencyKey" | ref "#/$defs/idempotencyKey" | yes | — | — |
| "name" | ref "#/$defs/localName" | no | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "createBead"
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlQ3JlYXRlTGluayI"></a>
## Schema: "sequenceCreateLink"

Value: object

Required order: ["operation","idempotencyKey"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idempotencyKey" | ref "#/$defs/idempotencyKey" | yes | — | — |
| "name" | ref "#/$defs/localName" | no | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/createLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "createLink"
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlRGVsZXRlQWxpYXMi"></a>
## Schema: "sequenceDeleteAlias"

Value: object

Required order: ["operation","idempotencyKey"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idempotencyKey" | ref "#/$defs/idempotencyKey" | yes | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteAliasMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "deleteAlias"
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlRGVsZXRlQmVhZCI"></a>
## Schema: "sequenceDeleteBead"

Value: object

Required order: ["operation","idempotencyKey"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idempotencyKey" | ref "#/$defs/idempotencyKey" | yes | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "deleteBead"
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlRGVsZXRlTGluayI"></a>
## Schema: "sequenceDeleteLink"

Value: object

Required order: ["operation","idempotencyKey"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idempotencyKey" | ref "#/$defs/idempotencyKey" | yes | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/deleteLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "deleteLink"
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlTWVtYmVyIg"></a>
## Schema: "sequenceMember"

Value: object

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/sequenceCreateBead"
    },
    {
      "$ref": "#/$defs/sequenceUpdateBead"
    },
    {
      "$ref": "#/$defs/sequenceDeleteBead"
    },
    {
      "$ref": "#/$defs/sequenceCreateLink"
    },
    {
      "$ref": "#/$defs/sequenceUpdateLink"
    },
    {
      "$ref": "#/$defs/sequenceDeleteLink"
    },
    {
      "$ref": "#/$defs/sequencePutAlias"
    },
    {
      "$ref": "#/$defs/sequenceDeleteAlias"
    }
  ]
}
```

<a id="schema-def-InNlcXVlbmNlTWVtYmVyQWxpYXNSZXN1bHQi"></a>
## Schema: "sequenceMemberAliasResult"

Value: object

Required order: ["operationIndex"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operationIndex" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/aliasResultMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operationIndex": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlTWVtYmVyUHJvYmxlbSI"></a>
## Schema: "sequenceMemberProblem"

Value: object

Required order: ["status","operationIndex"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operationIndex" | schema | yes | — | — |
| "operationName" | ref "#/$defs/localName" | no | — | — |
| "outcome" | false | no | — | — |
| "status" | integer | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/readUpdateProblem"
    },
    {
      "properties": {
        "code": {
          "not": {
            "enum": [
              "revision-unknown",
              "revision-unretained",
              "revision-reorganized",
              "revision-not-tracked",
              "revision-unrepresentable"
            ]
          }
        }
      }
    }
  ],
  "properties": {
    "operationIndex": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlTWVtYmVyUmVzdWx0Ig"></a>
## Schema: "sequenceMemberResult"

Value: object

Required order: ["operationIndex"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operationIndex" | schema | yes | — | — |
| "operationName" | ref "#/$defs/localName" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/mutationResultMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operationIndex": {
      "type": "integer",
      "minimum": 0
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlUHV0QWxpYXMi"></a>
## Schema: "sequencePutAlias"

Value: object

Required order: ["operation","idempotencyKey"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idempotencyKey" | ref "#/$defs/idempotencyKey" | yes | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/putAliasMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "putAlias"
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlUmVxdWVzdCI"></a>
## Schema: "sequenceRequest"

Value: object

Other fields: not allowed

Required order: ["operations"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Read+Update sequence request" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operations" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "operations": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/sequenceMember"
      }
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlUmVzcG9uc2Ui"></a>
## Schema: "sequenceResponse"

Value: object

Other fields: not allowed

Required order: ["results"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Read+Update sequence response" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "results" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "results": {
      "type": "array",
      "minItems": 1,
      "items": {
        "oneOf": [
          {
            "$ref": "#/$defs/sequenceMemberResult"
          },
          {
            "$ref": "#/$defs/sequenceMemberAliasResult"
          },
          {
            "$ref": "#/$defs/sequenceMemberProblem"
          }
        ]
      }
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlVXBkYXRlQmVhZCI"></a>
## Schema: "sequenceUpdateBead"

Value: object

Required order: ["operation","idempotencyKey"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idempotencyKey" | ref "#/$defs/idempotencyKey" | yes | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "updateBead"
    }
  }
}
```

<a id="schema-def-InNlcXVlbmNlVXBkYXRlTGluayI"></a>
## Schema: "sequenceUpdateLink"

Value: object

Required order: ["operation","idempotencyKey"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "idempotencyKey" | ref "#/$defs/idempotencyKey" | yes | — | — |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "updateLink"
    }
  }
}
```

<a id="schema-def-InNuYXBzaG90TWFuaWZlc3Qi"></a>
## Schema: "snapshotManifest"

Value: object

Other fields: not allowed

Required order: ["id","scope","scopeEpoch","authorizationView","scopePosition","checkpoint","expiresAt","erasures","beads","links"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP snapshot manifest" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "authorizationView" | ref "#/$defs/wireToken" | yes | — | — |
| "beads" | schema | yes | — | — |
| "checkpoint" | ref "#/$defs/wireToken" | yes | — | — |
| "erasures" | array of (ref "#/$defs/erasureRecord") | yes | — | — |
| "expiresAt" | ref "#/$defs/dateTime" | yes | — | — |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "links" | ref "#/$defs/linkCollection" | yes | — | — |
| "scope" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "scopeEpoch" | ref "#/$defs/wireToken" | yes | — | — |
| "scopePosition" | ref "#/$defs/wireToken" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "beads": {
      "allOf": [
        {
          "$ref": "#/$defs/beadCollection"
        },
        {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "links": false
                }
              }
            }
          }
        }
      ]
    }
  }
}
```

<a id="schema-def-InN0YXRlQ2hhbmdlIg"></a>
## Schema: "stateChange"

Value: object

Other fields: not allowed

Required order: ["operation","resourceKind","resource"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |
| "resource" | object | yes | — | — |
| "resourceKind" | ref "#/$defs/resourceKind" | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "operation": {
            "const": "upsert"
          },
          "resourceKind": {
            "const": "bead"
          }
        },
        "required": [
          "operation",
          "resourceKind"
        ]
      },
      "then": {
        "properties": {
          "resource": {
            "allOf": [
              {
                "$ref": "#/$defs/beadRecord"
              },
              {
                "type": "object",
                "properties": {
                  "links": false
                }
              }
            ]
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "operation": {
            "const": "upsert"
          },
          "resourceKind": {
            "const": "link"
          }
        },
        "required": [
          "operation",
          "resourceKind"
        ]
      },
      "then": {
        "properties": {
          "resource": {
            "$ref": "#/$defs/linkRecord"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "operation": {
            "const": "tombstone"
          }
        },
        "required": [
          "operation"
        ]
      },
      "then": {
        "properties": {
          "resource": {
            "$ref": "#/$defs/resourceIdentity"
          }
        }
      }
    }
  ],
  "properties": {
    "operation": {
      "enum": [
        "upsert",
        "tombstone"
      ]
    }
  }
}
```

<a id="schema-def-InRyYW5zYWN0aW9uYWxBZHZlcnRpc2VkTGltaXRzIg"></a>
## Schema: "transactionalAdvertisedLimits"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "page" | schema | no | — | — |
| "patch" | schema | no | — | — |
| "request" | schema | no | — | — |
| "resource" | schema | no | — | — |
| "retention" | schema | no | — | — |
| "selector" | schema | no | — | — |
| "sequence" | schema | no | — | — |
| "transaction" | schema | no | — | — |
| "validation" | schema | no | — | — |

### Advanced

```json-schema
{
  "properties": {
    "page": {
      "type": "object",
      "properties": {
        "defaultItems": {
          "$ref": "#/$defs/positiveInteger"
        },
        "maximumItems": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "patch": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathDepth": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "request": {
      "type": "object",
      "properties": {
        "targetBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "bodyBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "resource": {
      "type": "object",
      "properties": {
        "representationBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "propertiesBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "retention": {
      "type": "object",
      "properties": {
        "receipt": {
          "$ref": "#/$defs/iso8601Duration"
        },
        "maximumSnapshotLifetime": {
          "$ref": "#/$defs/iso8601Duration"
        },
        "replay": {
          "$ref": "#/$defs/iso8601Duration"
        }
      },
      "additionalProperties": false
    },
    "selector": {
      "type": "object",
      "properties": {
        "bytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "depth": {
          "$ref": "#/$defs/positiveInteger"
        },
        "nodes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "sequence": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "transaction": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        },
        "examinedResources": {
          "$ref": "#/$defs/positiveInteger"
        },
        "matchedResources": {
          "$ref": "#/$defs/positiveInteger"
        },
        "mutatedResources": {
          "$ref": "#/$defs/positiveInteger"
        },
        "inducedEvents": {
          "$ref": "#/$defs/positiveInteger"
        },
        "duration": {
          "$ref": "#/$defs/iso8601Duration"
        }
      },
      "additionalProperties": false
    },
    "validation": {
      "type": "object",
      "properties": {
        "diagnostics": {
          "$ref": "#/$defs/positiveInteger"
        },
        "diagnosticBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    }
  }
}
```

<a id="schema-def-InRyYW5zYWN0aW9uYWxEaXNjb3Zlcnki"></a>
## Schema: "transactionalDiscovery"

Value: object

Other fields: not allowed

Required order: ["bdpVersion","profile","scope","beads","links","types","operations","aliases","scopeEpoch","authorizationView","headPosition","minimumReplayPosition","receipts","snapshot","changes","events"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Transactional discovery document" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "aliases" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "authorizationView" | ref "#/$defs/wireToken" | yes | — | — |
| "bdpVersion" | ref "#/$defs/bdpVersion" | yes | — | — |
| "beads" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "capabilities" | ref "#/$defs/capabilityAdvertisements" | no | — | — |
| "changes" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "events" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "headPosition" | ref "#/$defs/wireToken" | yes | — | — |
| "historicalResolution" | ref "#/$defs/historyCapability" | no | — | — |
| "limits" | ref "#/$defs/transactionalAdvertisedLimits" | no | — | — |
| "links" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "maximumEndpointMultiplicity" | array of (ref "#/$defs/maximumEndpointMultiplicityPolicy") | no | — | — |
| "minimumReplayPosition" | ref "#/$defs/wireToken" | yes | — | — |
| "operations" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "order" | schema | no | — | — |
| "profile" | schema | yes | — | — |
| "receipts" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "scope" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "scopeEpoch" | ref "#/$defs/wireToken" | yes | — | — |
| "snapshot" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "types" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "order": {
      "enum": [
        "canonical-uri"
      ]
    },
    "profile": {
      "const": "transactional"
    }
  }
}
```

<a id="schema-def-InRyYW5zYWN0aW9uYWxPbmx5UHJvYmxlbUNvZGUi"></a>
## Schema: "transactionalOnlyProblemCode"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| enum | ["cardinality-violated","event-history-expired","catch-up-timeout"] |

<a id="schema-def-InRyYW5zYWN0aW9uYWxPcGVyYXRpb25EaXJlY3Rvcnki"></a>
## Schema: "transactionalOperationDirectory"

Value: object

Other fields: not allowed

Required order: ["createBead","updateBead","deleteBead","createLink","updateLink","deleteLink","putAlias","deleteAlias","sequence","updateWhere","deleteWhere","batch"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Transactional Operation Directory" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "batch" | schema | yes | — | — |
| "createBead" | schema | yes | — | — |
| "createLink" | schema | yes | — | — |
| "deleteAlias" | schema | yes | — | — |
| "deleteBead" | schema | yes | — | — |
| "deleteLink" | schema | yes | — | — |
| "deleteWhere" | schema | yes | — | — |
| "putAlias" | schema | yes | — | — |
| "sequence" | schema | yes | — | — |
| "updateBead" | schema | yes | — | — |
| "updateLink" | schema | yes | — | — |
| "updateWhere" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "batch": {
      "const": "batch"
    },
    "createBead": {
      "const": "create-bead"
    },
    "createLink": {
      "const": "create-link"
    },
    "deleteAlias": {
      "const": "delete-alias"
    },
    "deleteBead": {
      "const": "delete-bead"
    },
    "deleteLink": {
      "const": "delete-link"
    },
    "deleteWhere": {
      "const": "delete-where"
    },
    "putAlias": {
      "const": "put-alias"
    },
    "sequence": {
      "const": "sequence"
    },
    "updateBead": {
      "const": "update-bead"
    },
    "updateLink": {
      "const": "update-link"
    },
    "updateWhere": {
      "const": "update-where"
    }
  }
}
```

<a id="schema-def-InRyYW5zYWN0aW9uYWxQcm9ibGVtIg"></a>
## Schema: "transactionalProblem"

Value: object

Required order: ["type","code","retry"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Transactional Problem Details" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "archivedAt" | ref "#/$defs/reference" | no | — | — |
| "code" | ref "#/$defs/directProblemCode" | yes | — | — |
| "detail" | text | no | — | — |
| "instance" | ref "#/$defs/absoluteUri" | no | — | — |
| "limit" | schema | no | — | — |
| "pointer" | ref "#/$defs/jsonPointer" | no | — | — |
| "retry" | ref "#/$defs/retryDisposition" | yes | — | — |
| "retryAfter" | schema | no | — | — |
| "status" | schema | no | — | — |
| "title" | text | no | — | — |
| "type" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "code": {
            "$ref": "#/$defs/readUpdateProblemCode"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "$ref": "#/$defs/readUpdateProblem"
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "event-history-expired"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "diagnostics": false,
          "diagnosticsTruncated": false,
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/gone"
          },
          "status": {
            "const": 410
          },
          "retry": {
            "const": "never"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "catch-up-timeout"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "diagnostics": false,
          "diagnosticsTruncated": false,
          "type": {
            "const": "https://github.com/gastownhall/bdp/problems/unavailable"
          },
          "status": {
            "const": 503
          },
          "retry": {
            "const": "after-delay"
          }
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-erased"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "pointer": false
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "limit-exceeded"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "limit": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "retry": {
            "const": "after-delay"
          }
        },
        "required": [
          "retry"
        ]
      },
      "else": {
        "properties": {
          "retryAfter": false
        }
      }
    },
    {
      "if": {
        "not": {
          "properties": {
            "code": {
              "const": "revision-unretained"
            }
          },
          "required": [
            "code"
          ]
        }
      },
      "then": {
        "properties": {
          "missing": false
        }
      }
    }
  ],
  "properties": {
    "limit": {
      "type": "string",
      "pattern": "^[a-z]+\\.[A-Za-z]+$"
    },
    "retryAfter": {
      "type": "integer",
      "minimum": 0
    },
    "status": {
      "type": "integer",
      "enum": [
        400,
        401,
        403,
        404,
        409,
        410,
        413,
        415,
        422,
        429,
        503
      ]
    }
  }
}
```

<a id="schema-def-InRyYW5zYWN0aW9uYWxQcm9ibGVtQ29kZSI"></a>
## Schema: "transactionalProblemCode"

Value: object

### Advanced

```json-schema
{
  "anyOf": [
    {
      "$ref": "#/$defs/readUpdateProblemCode"
    },
    {
      "$ref": "#/$defs/transactionalOnlyProblemCode"
    }
  ]
}
```

<a id="schema-def-InRyYW5zYWN0aW9uYWxTZXF1ZW5jZU1lbWJlclByb2JsZW0i"></a>
## Schema: "transactionalSequenceMemberProblem"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Transactional sequence member problem" |
| type | "object" |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/sequenceMemberProblem"
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "idempotency-expired"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "allocated": {
            "$ref": "#/$defs/sequenceAllocatedIdentity"
          }
        }
      },
      "else": {
        "properties": {
          "allocated": false
        }
      }
    },
    {
      "if": {
        "properties": {
          "code": {
            "const": "resource-erased"
          }
        },
        "required": [
          "code"
        ]
      },
      "then": {
        "properties": {
          "pointer": false
        }
      }
    }
  ]
}
```

<a id="schema-def-InRyYW5zYWN0aW9uYWxTZXF1ZW5jZVJlc3BvbnNlIg"></a>
## Schema: "transactionalSequenceResponse"

Value: object

Other fields: not allowed

Required order: ["results"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Transactional sequence response" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "results" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "results": {
      "type": "array",
      "minItems": 1,
      "items": {
        "oneOf": [
          {
            "$ref": "#/$defs/sequenceMemberResult"
          },
          {
            "$ref": "#/$defs/sequenceMemberAliasResult"
          },
          {
            "$ref": "#/$defs/transactionalSequenceMemberProblem"
          }
        ]
      }
    }
  }
}
```

<a id="schema-def-InR5cGVEZWZpbml0aW9uUmVhZENhcGFiaWxpdHlQcm9ibGVtIg"></a>
## Schema: "typeDefinitionReadCapabilityProblem"

Value: object

Other fields: not allowed

Required order: ["type","status","code","retry","capability","capabilityVersion","parameter"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Problem carrier for unsupported exact-definition capability/version selection. It supplies no installation or application-History claim." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capability" | schema | yes | — | "Exact capability identity associated with this refusal. It does not advertise that capability as supported." |
| "capabilityVersion" | schema | yes | — | "Exact nonempty capability version selected by this request or diagnosed by this Problem. It has no implicit ordering or upgrade." |
| "code" | schema | yes | — | "Stable machine-readable Problem diagnosis, interpreted with type and retry." |
| "detail" | text | no | — | "Human-readable detail that obeys authorization and non-disclosure." |
| "instance" | ref "#/$defs/absoluteUri" | no | — | "Optional URI identifying this failure occurrence." |
| "parameter" | schema | yes | — | "Request parameter associated with the capability-selection diagnosis; its permitted literal is constrained here." |
| "retry" | schema | yes | — | "Required retry disposition for this exact diagnosis; it does not authorize changing intent." |
| "status" | schema | yes | — | "HTTP status associated with this Problem; protocol decision order remains binding." |
| "title" | text | no | — | "Short human-readable Problem summary." |
| "type" | schema | yes | — | "Complete nominal Type affiliation, preserving an exact revision pin when present. Core carries it without fetching a definition." |

### Advanced

```json-schema
{
  "properties": {
    "capability": {
      "const": "https://github.com/gastownhall/bdp/capabilities/type-definition-read"
    },
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    },
    "code": {
      "const": "capability-not-supported"
    },
    "parameter": {
      "const": "capabilityVersion"
    },
    "retry": {
      "const": "after-state-change"
    },
    "status": {
      "const": 422
    },
    "type": {
      "const": "https://github.com/gastownhall/bdp/problems/request"
    }
  }
}
```

<a id="schema-def-InR5cGVEZWZpbml0aW9uUmVhZENhcGFiaWxpdHlWMSI"></a>
## Schema: "typeDefinitionReadCapabilityV1"

Value: object

Other fields: not allowed

Required order: ["operation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Exact-definition version-1 advertisement. The service accepts complete exact-record servability obligations within its actual response and retained-dependency bounds." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Advertised absolute exact-definition lookup operation URL. It grants no permission and does not change the definition’s owner." |

<a id="schema-def-InR5cGVEZWZpbml0aW9uUmVhZFByb2JsZW0i"></a>
## Schema: "typeDefinitionReadProblem"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Problem carrier for exact-definition reads. Narrow missing-state diagnosis never substitutes current content or silently truncates the owned capture." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "allOf": [
        {
          "$ref": "#/$defs/readProblem"
        },
        {
          "type": "object",
          "properties": {
            "code": {
              "enum": [
                "malformed-request",
                "invalid-parameter",
                "unauthenticated",
                "forbidden",
                "resource-not-found",
                "resource-pruned",
                "resource-erased",
                "request-too-large",
                "limit-exceeded",
                "rate-limited",
                "temporarily-unavailable",
                "revision-unretained"
              ]
            }
          }
        }
      ]
    },
    {
      "$ref": "#/$defs/typeDefinitionReadCapabilityProblem"
    }
  ]
}
```

<a id="schema-def-InR5cGVEZWZpbml0aW9uUmVhZFF1ZXJ5VjEi"></a>
## Schema: "typeDefinitionReadQueryV1"

Value: object

Other fields: not allowed

Required order: ["capabilityVersion","uri","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Complete decoded exact-definition request: explicit version and a pinned Type Reference. It is a GET query carrier, not a new Resource write or installation command." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | "Exact nonempty capability version selected by this request or diagnosed by this Problem. It has no implicit ordering or upgrade." |
| "revision" | schema | yes | — | "Concrete nonempty opaque revision of the recorded Resource or exact target. It is not ordered or replaced by a current selector." |
| "uri" | ref "#/$defs/absoluteHttpUrl" | yes | — | "Complete target identity carried by this Reference. Relative paths and partial Reference objects are not admitted." |

### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "const": "1"
    },
    "revision": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InR5cGVEZWZpbml0aW9uUmVhZFJlc3VsdCI"></a>
## Schema: "typeDefinitionReadResult"

Value: object

Other fields: not allowed

Required order: ["definition"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Closed whole-record lookup wrapper. Optional originScope reports known owning context; the responder is not implicitly the definition owner." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "definition" | ref "#/$defs/exactTypeDefinitionRecord" | yes | — | "One complete exact Type-definition Bead including its required recorded owned closure." |
| "originScope" | ref "#/$defs/absoluteHttpUrl" | no | — | "Recorded owning-Scope context when known. The responding lookup service does not thereby become owner." |

<a id="schema-def-InR5cGVEZWZpbml0aW9uUmVhZFNlbGVjdGlvbiI"></a>
## Schema: "typeDefinitionReadSelection"

Value: object

Other fields: allowed

Required order: ["capabilityVersion"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Preliminary exact-definition-lookup discriminator. A selected request must satisfy the complete version-1 query shape and advertised lookup contract." |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "capabilityVersion" | schema | yes | — | "Exact nonempty capability version selected by this request or diagnosed by this Problem. It has no implicit ordering or upgrade." |

### Advanced

```json-schema
{
  "properties": {
    "capabilityVersion": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InR5cGVEZXNjcmlwdG9yIg"></a>
## Schema: "typeDescriptor"

Value: object

Other fields: not allowed

Required order: ["id","name","describes","conformsTo"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Type Descriptor" |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "conformsTo" | ref "#/$defs/typeIdArray" | yes | — | — |
| "describes" | schema | yes | — | — |
| "description" | text | no | — | — |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "name" | schema | yes | — | — |
| "ownsOutgoing" | schema | no | — | — |
| "propertiesSchema" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "source" | ref "#/$defs/endpointConstraint" | no | — | — |
| "target" | ref "#/$defs/endpointConstraint" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "if": {
        "properties": {
          "describes": {
            "const": "link"
          }
        },
        "required": [
          "describes"
        ]
      },
      "then": {
        "properties": {
          "source": {
            "$ref": "#/$defs/endpointConstraint"
          },
          "target": {
            "$ref": "#/$defs/endpointConstraint"
          }
        },
        "required": [
          "source",
          "target"
        ]
      },
      "else": {
        "properties": {
          "source": {
            "$ref": "#/$defs/endpointConstraint"
          },
          "target": {
            "$ref": "#/$defs/endpointConstraint"
          }
        },
        "not": {
          "anyOf": [
            {
              "required": [
                "source"
              ]
            },
            {
              "required": [
                "target"
              ]
            }
          ]
        }
      }
    },
    {
      "if": {
        "properties": {
          "describes": {
            "const": "link"
          }
        },
        "required": [
          "describes"
        ]
      },
      "then": {
        "properties": {
          "ownsOutgoing": false
        }
      }
    }
  ],
  "properties": {
    "describes": {
      "enum": [
        "bead",
        "link"
      ]
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "ownsOutgoing": {
      "type": "object",
      "minProperties": 1,
      "propertyNames": {
        "anyOf": [
          {
            "const": "*"
          },
          {
            "$ref": "#/$defs/absoluteHttpUrl"
          }
        ]
      },
      "properties": {
        "*": {
          "$ref": "#/$defs/ownedWildcardDeclaration"
        }
      },
      "additionalProperties": {
        "$ref": "#/$defs/ownedLinkDeclaration"
      }
    }
  }
}
```

<a id="schema-def-InR5cGVJZEFycmF5Ig"></a>
## Schema: "typeIdArray"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "array" |
| uniqueItems | true |

### Advanced

```json-schema
{
  "items": {
    "$ref": "#/$defs/absoluteHttpUrl"
  }
}
```

<a id="schema-def-InR5cGVSZWZlcmVuY2Ui"></a>
## Schema: "typeReference"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "A nominal Type affiliation: an absolute HTTP(S) Type identity or an exact pinned Type Reference. Carrying it does not activate Types interpretation." |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "$ref": "#/$defs/absoluteHttpUrl"
    },
    {
      "$ref": "#/$defs/pinnedTypeReference"
    }
  ]
}
```

<a id="schema-def-InR5cGVTdW1tYXJ5Ig"></a>
## Schema: "typeSummary"

Value: object

Other fields: not allowed

Required order: ["id","name","describes"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "describes" | schema | yes | — | — |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "name" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "describes": {
      "enum": [
        "bead",
        "link"
      ]
    },
    "name": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InR5cGVkTGlua1JlZmVyZW5jZSI"></a>
## Schema: "typedLinkReference"

Value: object

Other fields: not allowed

Required order: ["id","type"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "id" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "type" | ref "#/$defs/typeReference" | yes | — | — |

<a id="schema-def-InR5cGVzSW52ZW50b3J5Ig"></a>
## Schema: "typesInventory"

Value: object

Other fields: not allowed

Required order: ["items","next"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "items" | array of (ref "#/$defs/typeSummary") | yes | — | — |
| "next" | schema | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "next": {
      "oneOf": [
        {
          "$ref": "#/$defs/absoluteHttpUrl"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

<a id="schema-def-InVwZGF0ZUJlYWRNZW1iZXJzIg"></a>
## Schema: "updateBeadMembers"

Value: object

Required order: ["bead"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "#/$defs/resourceReference" | yes | — | — |
| "expectedRevision" | ref "#/$defs/expectedRevision" | no | — | — |
| "metadata" | ref "#/$defs/metadata" | no | — | — |
| "metadataChange" | ref "#/$defs/ordinaryUpdateChange" | no | — | — |
| "properties" | ref "#/$defs/properties" | no | — | — |
| "propertiesChange" | ref "#/$defs/ordinaryUpdateChange" | no | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "type" | ref "#/$defs/typeReference" | no | — | — |

### Advanced

```json-schema
{
  "anyOf": [
    {
      "required": [
        "type"
      ],
      "properties": {
        "type": true
      }
    },
    {
      "required": [
        "propertiesChange"
      ],
      "properties": {
        "propertiesChange": true
      }
    },
    {
      "required": [
        "metadataChange"
      ],
      "properties": {
        "metadataChange": true
      }
    },
    {
      "required": [
        "properties"
      ],
      "properties": {
        "properties": true
      }
    },
    {
      "required": [
        "metadata"
      ],
      "properties": {
        "metadata": true
      }
    }
  ],
  "allOf": [
    {
      "not": {
        "required": [
          "properties",
          "propertiesChange"
        ],
        "properties": {
          "properties": true,
          "propertiesChange": true
        }
      }
    },
    {
      "not": {
        "required": [
          "metadata",
          "metadataChange"
        ],
        "properties": {
          "metadata": true,
          "metadataChange": true
        }
      }
    }
  ]
}
```

<a id="schema-def-InVwZGF0ZUJlYWRPcGVyYXRpb24i"></a>
## Schema: "updateBeadOperation"

Value: object

Required order: ["operation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateBeadMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "updateBead"
    }
  }
}
```

<a id="schema-def-InVwZGF0ZUJlYWRSZXF1ZXN0Ig"></a>
## Schema: "updateBeadRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "bead" | ref "#/$defs/durableResourceReference" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateBeadMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-InVwZGF0ZUxpbmtNZW1iZXJzIg"></a>
## Schema: "updateLinkMembers"

Value: object

Required order: ["link"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "expectedRevision" | ref "#/$defs/expectedRevision" | no | — | — |
| "link" | ref "#/$defs/resourceReference" | yes | — | — |
| "metadata" | ref "#/$defs/metadata" | no | — | — |
| "metadataChange" | ref "#/$defs/ordinaryUpdateChange" | no | — | — |
| "properties" | ref "#/$defs/properties" | no | — | — |
| "propertiesChange" | ref "#/$defs/ordinaryUpdateChange" | no | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "source" | ref "#/$defs/inputReference" | no | — | — |
| "target" | ref "#/$defs/inputReference" | no | — | — |
| "type" | ref "#/$defs/typeReference" | no | — | — |

### Advanced

```json-schema
{
  "anyOf": [
    {
      "required": [
        "type"
      ],
      "properties": {
        "type": true
      }
    },
    {
      "required": [
        "propertiesChange"
      ],
      "properties": {
        "propertiesChange": true
      }
    },
    {
      "required": [
        "metadataChange"
      ],
      "properties": {
        "metadataChange": true
      }
    },
    {
      "required": [
        "properties"
      ],
      "properties": {
        "properties": true
      }
    },
    {
      "required": [
        "metadata"
      ],
      "properties": {
        "metadata": true
      }
    },
    {
      "required": [
        "source"
      ],
      "properties": {
        "source": true
      }
    },
    {
      "required": [
        "target"
      ],
      "properties": {
        "target": true
      }
    }
  ],
  "allOf": [
    {
      "not": {
        "required": [
          "properties",
          "propertiesChange"
        ],
        "properties": {
          "properties": true,
          "propertiesChange": true
        }
      }
    },
    {
      "not": {
        "required": [
          "metadata",
          "metadataChange"
        ],
        "properties": {
          "metadata": true,
          "metadataChange": true
        }
      }
    }
  ]
}
```

<a id="schema-def-InVwZGF0ZUxpbmtPcGVyYXRpb24i"></a>
## Schema: "updateLinkOperation"

Value: object

Required order: ["operation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateLinkMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "updateLink"
    }
  }
}
```

<a id="schema-def-InVwZGF0ZUxpbmtSZXF1ZXN0Ig"></a>
## Schema: "updateLinkRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "link" | ref "#/$defs/durableResourceReference" | no | — | — |
| "source" | ref "#/$defs/durableInputReference" | no | — | — |
| "target" | ref "#/$defs/durableInputReference" | no | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateLinkMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-InVwZGF0ZVdoZXJlTWVtYmVycyI"></a>
## Schema: "updateWhereMembers"

Value: object

Required order: ["collection","selector","change"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "cardinality" | ref "#/$defs/cardinality" | no | — | — |
| "change" | ref "#/$defs/propertyChange" | yes | — | — |
| "collection" | schema | yes | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenanceInput" | no | — | — |
| "selector" | ref "#/$defs/selector" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "collection": {
      "enum": [
        "beads",
        "links"
      ]
    }
  }
}
```

<a id="schema-def-InVwZGF0ZVdoZXJlT3BlcmF0aW9uIg"></a>
## Schema: "updateWhereOperation"

Value: object

Required order: ["operation"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "operation" | schema | yes | — | — |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateWhereMembers"
    }
  ],
  "unevaluatedProperties": false,
  "properties": {
    "operation": {
      "const": "updateWhere"
    }
  }
}
```

<a id="schema-def-InVwZGF0ZVdoZXJlUmVxdWVzdCI"></a>
## Schema: "updateWhereRequest"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| title | "BDP Transactional update-where request" |
| type | "object" |

### Advanced

```json-schema
{
  "allOf": [
    {
      "$ref": "#/$defs/updateWhereMembers"
    }
  ],
  "unevaluatedProperties": false
}
```

<a id="schema-def-InVwZGF0ZWREYXRhIg"></a>
## Schema: "updatedData"

Value: object

Other fields: not allowed

Required order: ["previousRevision","revision"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "change" | ref "#/$defs/propertyChange" | no | — | — |
| "metadataChange" | ref "#/$defs/propertyChange" | no | — | — |
| "ownedLink" | ref "#/$defs/ownedLinkChange" | no | — | — |
| "previousRevision" | ref "#/$defs/revision" | yes | — | — |
| "revision" | ref "#/$defs/revision" | yes | — | — |
| "revisionProvenance" | ref "#/$defs/revisionProvenance" | no | — | — |

### Advanced

```json-schema
{
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "change": true,
        "metadataChange": true,
        "ownedLink": false
      },
      "anyOf": [
        {
          "required": [
            "change"
          ],
          "properties": {
            "change": true
          }
        },
        {
          "required": [
            "metadataChange"
          ],
          "properties": {
            "metadataChange": true
          }
        }
      ]
    },
    {
      "type": "object",
      "required": [
        "ownedLink"
      ],
      "properties": {
        "ownedLink": true,
        "change": false,
        "metadataChange": false
      }
    }
  ]
}
```

<a id="schema-def-InZhbGlkYXRpb25EaWFnbm9zdGljIg"></a>
## Schema: "validationDiagnostic"

Value: object

Other fields: not allowed

Required order: ["message"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| dependentRequired | {"type":["schemaLocation"],"schemaLocation":["type"]} |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "document" | schema | no | — | — |
| "instanceLocation" | ref "#/$defs/jsonPointer" | no | — | — |
| "message" | schema | yes | — | — |
| "schemaLocation" | ref "#/$defs/absoluteUri" | no | — | — |
| "type" | ref "#/$defs/absoluteHttpUrl" | no | — | — |

### Advanced

```json-schema
{
  "properties": {
    "document": {
      "enum": [
        "properties",
        "metadata"
      ]
    },
    "message": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

<a id="schema-def-InZhbGlkYXRpb25EaWFnbm9zdGljcyI"></a>
## Schema: "validationDiagnostics"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| minItems | 1 |
| type | "array" |

### Advanced

```json-schema
{
  "items": {
    "$ref": "#/$defs/validationDiagnostic"
  }
}
```

<a id="schema-def-IndpcmVUb2tlbiI"></a>
## Schema: "wireToken"

Value: object

### Keywords

| Keyword | JSON value |
| --- | --- |
| description | "Nonempty opaque token whose scope and meaning are determined by its containing cursor, fact or correlation field. Tokens from different namespaces are not interchangeable." |
| pattern | "^[A-Za-z0-9_-]{1,256}$" |
| type | "string" |

<a id="schema-def-IndyaXRlQWR2ZXJ0aXNlZExpbWl0cyI"></a>
## Schema: "writeAdvertisedLimits"

Value: object

Other fields: not allowed

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "page" | schema | no | — | — |
| "patch" | schema | no | — | — |
| "request" | schema | no | — | — |
| "resource" | schema | no | — | — |
| "retention" | schema | no | — | — |
| "selector" | schema | no | — | — |
| "validation" | schema | no | — | — |

### Advanced

```json-schema
{
  "properties": {
    "page": {
      "type": "object",
      "properties": {
        "defaultItems": {
          "$ref": "#/$defs/positiveInteger"
        },
        "maximumItems": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "patch": {
      "type": "object",
      "properties": {
        "operations": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "pathDepth": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "request": {
      "type": "object",
      "properties": {
        "targetBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "bodyBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "resource": {
      "type": "object",
      "properties": {
        "representationBytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "propertiesBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "retention": {
      "type": "object",
      "properties": {
        "idempotency": {
          "$ref": "#/$defs/iso8601Duration"
        },
        "maximumSnapshotLifetime": {
          "$ref": "#/$defs/iso8601Duration"
        }
      },
      "additionalProperties": false
    },
    "selector": {
      "type": "object",
      "properties": {
        "bytes": {
          "$ref": "#/$defs/positiveInteger"
        },
        "depth": {
          "$ref": "#/$defs/positiveInteger"
        },
        "nodes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    },
    "validation": {
      "type": "object",
      "properties": {
        "diagnostics": {
          "$ref": "#/$defs/positiveInteger"
        },
        "diagnosticBytes": {
          "$ref": "#/$defs/positiveInteger"
        }
      },
      "additionalProperties": false
    }
  }
}
```

<a id="schema-def-IndyaXRlRGlzY292ZXJ5Ig"></a>
## Schema: "writeDiscovery"

Value: object

Other fields: not allowed

Required order: ["bdpVersion","profile","scope","beads","links","operations","aliases"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "aliases" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "bdpVersion" | ref "#/$defs/bdpVersion" | yes | — | — |
| "beads" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "capabilities" | ref "#/$defs/capabilityAdvertisements" | no | — | — |
| "events" | ref "#/$defs/absoluteHttpUrl" | no | — | — |
| "historicalResolution" | ref "#/$defs/historyCapability" | no | — | — |
| "limits" | ref "#/$defs/writeAdvertisedLimits" | no | — | — |
| "links" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "maximumEndpointMultiplicity" | array of (ref "#/$defs/maximumEndpointMultiplicityPolicy") | no | — | — |
| "operations" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "order" | schema | no | — | — |
| "profile" | schema | yes | — | — |
| "scope" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |

### Advanced

```json-schema
{
  "properties": {
    "order": {
      "enum": [
        "canonical-uri"
      ]
    },
    "profile": {
      "const": "write"
    }
  }
}
```

<a id="schema-def-IndyaXRlT3BlcmF0aW9uRGlyZWN0b3J5Ig"></a>
## Schema: "writeOperationDirectory"

Value: object

Other fields: not allowed

Required order: ["createBead","updateBead","deleteBead","createLink","updateLink","deleteLink","putAlias","deleteAlias"]

### Keywords

| Keyword | JSON value |
| --- | --- |
| type | "object" |

### Properties

| Name | Type | Required | Defined by | Meaning |
| --- | --- | --- | --- | --- |
| "createBead" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "createLink" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "deleteAlias" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "deleteBead" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "deleteLink" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "putAlias" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "updateBead" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
| "updateLink" | ref "#/$defs/absoluteHttpUrl" | yes | — | — |
