# Read schema contracts

This index applies the [Markdown JSON Schema notation](../../formats/markdown-json-schema.md) to the selected [Core/Read entry](retained-core.md). The [complete schema companion](bdp-v0.1.schema.md) preserves the entire canonical JSON bundle, including its original identity and reference topology. This index selects the actual entry points below; inherited definitions elsewhere in that bundle do not become selected operations. The JSON schema and protocol clauses keep their existing authority.

The notation describes value shape. Authorization, discovery, exact request selection, HTTP decision order, pagination, Type interpretation and durable retry remain protocol rules. A schema-valid value alone does not establish those behaviors or provider conformance.

## Operation correspondence

| Operation or read form | Request body | Success representation | Problem shape | Selection |
| --- | --- | --- | --- | --- |
| scopeLanding | No JSON request body | Optional human landing body; no BDP JSON schema | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Required retained Core |
| discovery | No JSON request body | [retainedDiscovery](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRGlzY292ZXJ5Ig) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Required retained Core |
| writeDirectory | No JSON request body | [writeOperationDirectory](bdp-v0.1.schema.md#schema-def-IndyaXRlT3BlcmF0aW9uRGlyZWN0b3J5Ig) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Write profile |
| currentBead | No JSON request body | [currentBeadRecord](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRCZWFkUmVjb3JkIg) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Required retained Core |
| beadProperties | No JSON request body | [properties](bdp-v0.1.schema.md#schema-def-InByb3BlcnRpZXMi) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Required retained Core |
| beadInventory | No JSON request body | [currentBeadCollection](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRCZWFkQ29sbGVjdGlvbiI) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Required retained Core |
| historicalBead | No JSON request body | [historicalBeadRecord](bdp-v0.1.schema.md#schema-def-Imhpc3RvcmljYWxCZWFkUmVjb3JkIg) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Complete historicalResolution.version=1 |
| beadVersions | No JSON request body | [historyVersionsPage](bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlWZXJzaW9uc1BhZ2Ui) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Complete historicalResolution.version=1 |
| beadEvents | No JSON request body | [retainedEventPage](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRQYWdlIg) | [retainedEventProblem](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRQcm9ibGVtIg) | Required retained Core |
| projectedBead | No JSON request body | [projectedBeadRecord](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZEJlYWRSZWNvcmQi) or [currentBeadRecord](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRCZWFkUmVjb3JkIg) | [resourceProjectionProblem](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblByb2JsZW0i) | Resource projection1 current:true |
| projectedHistoricalBead | No JSON request body | [projectedBeadRecord](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZEJlYWRSZWNvcmQi) or [historicalBeadRecord](bdp-v0.1.schema.md#schema-def-Imhpc3RvcmljYWxCZWFkUmVjb3JkIg) | [resourceProjectionProblem](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblByb2JsZW0i) | Resource projection1 exact:true plus complete History |
| projectedBeadInventory | No JSON request body | [projectedBeadCollection](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZEJlYWRDb2xsZWN0aW9uIg) or [currentBeadCollection](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRCZWFkQ29sbGVjdGlvbiI) | [resourceProjectionProblem](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblByb2JsZW0i) | Resource projection1 list:true |
| currentLink | No JSON request body | [currentLinkRecord](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRMaW5rUmVjb3JkIg) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Required retained Core |
| linkProperties | No JSON request body | [properties](bdp-v0.1.schema.md#schema-def-InByb3BlcnRpZXMi) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Required retained Core |
| linkInventory | No JSON request body | [currentLinkCollection](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRMaW5rQ29sbGVjdGlvbiI) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Required retained Core |
| historicalLink | No JSON request body | [historicalLinkRecord](bdp-v0.1.schema.md#schema-def-Imhpc3RvcmljYWxMaW5rUmVjb3JkIg) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Complete historicalResolution.version=1 |
| linkVersions | No JSON request body | [historyVersionsPage](bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlWZXJzaW9uc1BhZ2Ui) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Complete historicalResolution.version=1 |
| linkEvents | No JSON request body | [retainedEventPage](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRQYWdlIg) | [retainedEventProblem](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRQcm9ibGVtIg) | Required retained Core |
| projectedLink | No JSON request body | [projectedLinkRecord](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZExpbmtSZWNvcmQi) or [currentLinkRecord](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRMaW5rUmVjb3JkIg) | [resourceProjectionProblem](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblByb2JsZW0i) | Resource projection1 current:true |
| projectedHistoricalLink | No JSON request body | [projectedLinkRecord](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZExpbmtSZWNvcmQi) or [historicalLinkRecord](bdp-v0.1.schema.md#schema-def-Imhpc3RvcmljYWxMaW5rUmVjb3JkIg) | [resourceProjectionProblem](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblByb2JsZW0i) | Resource projection1 exact:true plus complete History |
| projectedLinkInventory | No JSON request body | [projectedLinkCollection](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZExpbmtDb2xsZWN0aW9uIg) or [currentLinkCollection](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRMaW5rQ29sbGVjdGlvbiI) | [resourceProjectionProblem](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblByb2JsZW0i) | Resource projection1 list:true |
| incidentLinks | No JSON request body | [currentLinkCollection](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRMaW5rQ29sbGVjdGlvbiI) | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Required retained Core |
| beadAggregate | No JSON request body | [currentBeadRecord](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRCZWFkUmVjb3JkIg); links is additionally required | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Outside minimum Core; no invented capability advertisement |
| aliasResolve | No JSON request body | Bodyless alias redirect | [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg) | Advertised aliases navigation |
| scopeEvents | No JSON request body | [retainedEventPage](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRQYWdlIg) | [retainedEventProblem](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRQcm9ibGVtIg) | Required retained Core |
| exactDefinition | No JSON request body | [typeDefinitionReadResult](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZFJlc3VsdCI) | [typeDefinitionReadProblem](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZFByb2JsZW0i) | Narrow type-definition-read1; not Types or application History |

GET and HEAD share read selection; HEAD has no representation body. Alias resolution uses its bodyless redirect. Native 204/304/405/406/412/500 branches retain their actual bodyless rules rather than acquiring a Problem body. The informative [HTTP catalog](../../openapi/README.md) records headers, media, native query carriers and complete transport branches.

Projection alternatives overlap and remain inclusive: an explicit request selects the applicable full or projected arm. Ordinary full output cannot silently become a projection. The optional History, exact-definition and batch entries retain their independent capability/context requirements; a row in this index never advertises them.

## Decoded query and dispatch shapes

The following helpers describe decoded query values or preliminary selection prefixes. A prefix is not a complete invocation, and these schemas do not add JSON bodies to GET requests. Raw query encoding, duplicate members, error precedence and capability admission remain in their protocol clauses.

- [resourceProjectionInventoryQueryV1](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvbkludmVudG9yeVF1ZXJ5VjEi)
- [resourceProjectionMask](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvbk1hc2si)
- [resourceProjectionPointQueryV1](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblBvaW50UXVlcnlWMSI)
- [resourceProjectionSelection](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblNlbGVjdGlvbiI)
- [retainedEventQuery](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRRdWVyeSI)
- [typeDefinitionReadQueryV1](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZFF1ZXJ5VjEi)
- [typeDefinitionReadSelection](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZFNlbGVjdGlvbiI)

## Shared shapes used by these entries

The entry-point roots reach 84 named definitions in the canonical bundle. They are linked below without copying a partial bundle under the original schema identity. Every link names the same definition represented in the complete Markdown companion.

- [absoluteHttpUrl](bdp-v0.1.schema.md#schema-def-ImFic29sdXRlSHR0cFVybCI)
- [absoluteUri](bdp-v0.1.schema.md#schema-def-ImFic29sdXRlVXJpIg)
- [atomicBatchCapabilityV1](bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoQ2FwYWJpbGl0eVYxIg)
- [atomicBatchOperationName](bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoT3BlcmF0aW9uTmFtZSI)
- [bdpVersion](bdp-v0.1.schema.md#schema-def-ImJkcFZlcnNpb24i)
- [beadCollection](bdp-v0.1.schema.md#schema-def-ImJlYWRDb2xsZWN0aW9uIg)
- [beadRecord](bdp-v0.1.schema.md#schema-def-ImJlYWRSZWNvcmQi)
- [capabilityAdvertisements](bdp-v0.1.schema.md#schema-def-ImNhcGFiaWxpdHlBZHZlcnRpc2VtZW50cyI)
- [capabilityVersionAdvertisements](bdp-v0.1.schema.md#schema-def-ImNhcGFiaWxpdHlWZXJzaW9uQWR2ZXJ0aXNlbWVudHMi)
- [contextMessage](bdp-v0.1.schema.md#schema-def-ImNvbnRleHRNZXNzYWdlIg)
- [contextString](bdp-v0.1.schema.md#schema-def-ImNvbnRleHRTdHJpbmci)
- [contextTime](bdp-v0.1.schema.md#schema-def-ImNvbnRleHRUaW1lIg)
- [coreAdvertisedLimits](bdp-v0.1.schema.md#schema-def-ImNvcmVBZHZlcnRpc2VkTGltaXRzIg)
- [coreDiscovery](bdp-v0.1.schema.md#schema-def-ImNvcmVEaXNjb3Zlcnki)
- [currentBeadCollection](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRCZWFkQ29sbGVjdGlvbiI)
- [currentBeadRecord](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRCZWFkUmVjb3JkIg)
- [currentLinkCollection](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRMaW5rQ29sbGVjdGlvbiI)
- [currentLinkRecord](bdp-v0.1.schema.md#schema-def-ImN1cnJlbnRMaW5rUmVjb3JkIg)
- [dateTime](bdp-v0.1.schema.md#schema-def-ImRhdGVUaW1lIg)
- [exactTypeDefinitionRecord](bdp-v0.1.schema.md#schema-def-ImV4YWN0VHlwZURlZmluaXRpb25SZWNvcmQi)
- [historicalBeadRecord](bdp-v0.1.schema.md#schema-def-Imhpc3RvcmljYWxCZWFkUmVjb3JkIg)
- [historicalLinkRecord](bdp-v0.1.schema.md#schema-def-Imhpc3RvcmljYWxMaW5rUmVjb3JkIg)
- [historyCapability](bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlDYXBhYmlsaXR5Ig)
- [historyMissing](bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlNaXNzaW5nIg)
- [historyMissingItem](bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlNaXNzaW5nSXRlbSI)
- [historyVersionRow](bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlWZXJzaW9uUm93Ig)
- [historyVersionsPage](bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlWZXJzaW9uc1BhZ2Ui)
- [historyWindow](bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlXaW5kb3ci)
- [iso8601Duration](bdp-v0.1.schema.md#schema-def-Imlzbzg2MDFEdXJhdGlvbiI)
- [jsonPointer](bdp-v0.1.schema.md#schema-def-Impzb25Qb2ludGVyIg)
- [linkCollection](bdp-v0.1.schema.md#schema-def-ImxpbmtDb2xsZWN0aW9uIg)
- [linkRecord](bdp-v0.1.schema.md#schema-def-ImxpbmtSZWNvcmQi)
- [maximumEndpointMultiplicityPolicy](bdp-v0.1.schema.md#schema-def-Im1heGltdW1FbmRwb2ludE11bHRpcGxpY2l0eVBvbGljeSI)
- [metadata](bdp-v0.1.schema.md#schema-def-Im1ldGFkYXRhIg)
- [pinnedReference](bdp-v0.1.schema.md#schema-def-InBpbm5lZFJlZmVyZW5jZSI)
- [pinnedTypeReference](bdp-v0.1.schema.md#schema-def-InBpbm5lZFR5cGVSZWZlcmVuY2Ui)
- [positiveInteger](bdp-v0.1.schema.md#schema-def-InBvc2l0aXZlSW50ZWdlciI)
- [projectedBeadCollection](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZEJlYWRDb2xsZWN0aW9uIg)
- [projectedBeadRecord](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZEJlYWRSZWNvcmQi)
- [projectedLinkCollection](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZExpbmtDb2xsZWN0aW9uIg)
- [projectedLinkRecord](bdp-v0.1.schema.md#schema-def-InByb2plY3RlZExpbmtSZWNvcmQi)
- [properties](bdp-v0.1.schema.md#schema-def-InByb3BlcnRpZXMi)
- [propertyChange](bdp-v0.1.schema.md#schema-def-InByb3BlcnR5Q2hhbmdlIg)
- [readProblem](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg)
- [readProblemCode](bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtQ29kZSI)
- [reference](bdp-v0.1.schema.md#schema-def-InJlZmVyZW5jZSI)
- [resourceIdentity](bdp-v0.1.schema.md#schema-def-InJlc291cmNlSWRlbnRpdHki)
- [resourceProjectionCapabilityProblem](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvbkNhcGFiaWxpdHlQcm9ibGVtIg)
- [resourceProjectionCapabilityV1](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvbkNhcGFiaWxpdHlWMSI)
- [resourceProjectionInventoryQueryV1](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvbkludmVudG9yeVF1ZXJ5VjEi)
- [resourceProjectionMask](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvbk1hc2si)
- [resourceProjectionPointQueryV1](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblBvaW50UXVlcnlWMSI)
- [resourceProjectionProblem](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblByb2JsZW0i)
- [resourceProjectionSelection](bdp-v0.1.schema.md#schema-def-InJlc291cmNlUHJvamVjdGlvblNlbGVjdGlvbiI)
- [retainedDeltaEffect](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRGVsdGFFZmZlY3Qi)
- [retainedDeltaEvent](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRGVsdGFFdmVudCI)
- [retainedDiscovery](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRGlzY292ZXJ5Ig)
- [retainedEvent](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnQi)
- [retainedEventCommon](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRDb21tb24i)
- [retainedEventCoverage](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRDb3ZlcmFnZSI)
- [retainedEventDeleted](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnREZWxldGVkIg)
- [retainedEventDerived](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnREZXJpdmVkIg)
- [retainedEventPage](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRQYWdlIg)
- [retainedEventPolicy](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRQb2xpY3ki)
- [retainedEventProblem](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRQcm9ibGVtIg)
- [retainedEventQuery](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRRdWVyeSI)
- [retainedEventSelection](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkRXZlbnRTZWxlY3Rpb24i)
- [retainedPostimageEffect](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkUG9zdGltYWdlRWZmZWN0Ig)
- [retainedPostimageEvent](bdp-v0.1.schema.md#schema-def-InJldGFpbmVkUG9zdGltYWdlRXZlbnQi)
- [retryDisposition](bdp-v0.1.schema.md#schema-def-InJldHJ5RGlzcG9zaXRpb24i)
- [revision](bdp-v0.1.schema.md#schema-def-InJldmlzaW9uIg)
- [revisionActor](bdp-v0.1.schema.md#schema-def-InJldmlzaW9uQWN0b3Ii)
- [revisionProvenance](bdp-v0.1.schema.md#schema-def-InJldmlzaW9uUHJvdmVuYW5jZSI)
- [typeDefinitionReadCapabilityProblem](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZENhcGFiaWxpdHlQcm9ibGVtIg)
- [typeDefinitionReadCapabilityV1](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZENhcGFiaWxpdHlWMSI)
- [typeDefinitionReadProblem](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZFByb2JsZW0i)
- [typeDefinitionReadQueryV1](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZFF1ZXJ5VjEi)
- [typeDefinitionReadResult](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZFJlc3VsdCI)
- [typeDefinitionReadSelection](bdp-v0.1.schema.md#schema-def-InR5cGVEZWZpbml0aW9uUmVhZFNlbGVjdGlvbiI)
- [typeReference](bdp-v0.1.schema.md#schema-def-InR5cGVSZWZlcmVuY2Ui)
- [wireToken](bdp-v0.1.schema.md#schema-def-IndpcmVUb2tlbiI)
- [writeAdvertisedLimits](bdp-v0.1.schema.md#schema-def-IndyaXRlQWR2ZXJ0aXNlZExpbWl0cyI)
- [writeDiscovery](bdp-v0.1.schema.md#schema-def-IndyaXRlRGlzY292ZXJ5Ig)
- [writeOperationDirectory](bdp-v0.1.schema.md#schema-def-IndyaXRlT3BlcmF0aW9uRGlyZWN0b3J5Ig)

## Source and reproduction

Canonical source: [https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json](bdp-v0.1.schema.json). The companion round-trips to that complete parsed source, preserving required order, omission, exact references, conditionals, annotations and closure. This is source-projection evidence, not executed HTTP, Type admission or storage behavior.

Generate or check with the pinned repository Node runtime:

```sh
# Regenerate the Markdown schema companion and selected profile indexes.
node scripts/generate-markdown-contracts.mjs

# Verify that checked-in projections match their sources.
node scripts/generate-markdown-contracts.mjs --check

```
