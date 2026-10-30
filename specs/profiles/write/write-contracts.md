# Write schema contracts

This index applies the [Markdown JSON Schema notation](../../formats/markdown-json-schema.md) to the selected [Write entry](retained-write.md). The [complete schema companion](../core/bdp-v0.1.schema.md) preserves the entire canonical JSON bundle, including its original identity and reference topology. This index selects the actual entry points below; inherited definitions elsewhere in that bundle do not become selected operations. The JSON schema and protocol clauses keep their existing authority.

The notation describes value shape. Authorization, discovery, exact request selection, HTTP decision order, pagination, Type interpretation and durable retry remain protocol rules. A schema-valid value alone does not establish those behaviors or provider conformance.

## Operation correspondence

| Operation or read form | Request body | Success representation | Problem shape | Selection |
| --- | --- | --- | --- | --- |
| createBead | [createBeadRequest](../core/bdp-v0.1.schema.md#schema-def-ImNyZWF0ZUJlYWRSZXF1ZXN0Ig) | [mutationResult](../core/bdp-v0.1.schema.md#schema-def-Im11dGF0aW9uUmVzdWx0Ig) | [readUpdateProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg) | Write profile |
| updateBead | [updateBeadRequest](../core/bdp-v0.1.schema.md#schema-def-InVwZGF0ZUJlYWRSZXF1ZXN0Ig) | [mutationResult](../core/bdp-v0.1.schema.md#schema-def-Im11dGF0aW9uUmVzdWx0Ig) | [readUpdateProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg) | Write profile |
| deleteBead | [deleteBeadRequest](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUJlYWRSZXF1ZXN0Ig) | [mutationResult](../core/bdp-v0.1.schema.md#schema-def-Im11dGF0aW9uUmVzdWx0Ig) | [readUpdateProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg) | Write profile |
| createLink | [createLinkRequest](../core/bdp-v0.1.schema.md#schema-def-ImNyZWF0ZUxpbmtSZXF1ZXN0Ig) | [mutationResult](../core/bdp-v0.1.schema.md#schema-def-Im11dGF0aW9uUmVzdWx0Ig) | [readUpdateProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg) | Write profile |
| updateLink | [updateLinkRequest](../core/bdp-v0.1.schema.md#schema-def-InVwZGF0ZUxpbmtSZXF1ZXN0Ig) | [mutationResult](../core/bdp-v0.1.schema.md#schema-def-Im11dGF0aW9uUmVzdWx0Ig) | [readUpdateProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg) | Write profile |
| deleteLink | [deleteLinkRequest](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUxpbmtSZXF1ZXN0Ig) | [mutationResult](../core/bdp-v0.1.schema.md#schema-def-Im11dGF0aW9uUmVzdWx0Ig) | [readUpdateProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg) | Write profile |
| putAlias | [putAliasRequest](../core/bdp-v0.1.schema.md#schema-def-InB1dEFsaWFzUmVxdWVzdCI) | [aliasResult](../core/bdp-v0.1.schema.md#schema-def-ImFsaWFzUmVzdWx0Ig) | [readUpdateProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg) | Write profile |
| deleteAlias | [deleteAliasRequest](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUFsaWFzUmVxdWVzdCI) | [aliasResult](../core/bdp-v0.1.schema.md#schema-def-ImFsaWFzUmVzdWx0Ig) | [readUpdateProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg) | Write profile |
| atomicBatch | [batchRequest](../core/bdp-v0.1.schema.md#schema-def-ImJhdGNoUmVxdWVzdCI) | [atomicBatchResult](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoUmVzdWx0Ig) | [atomicBatchProblem](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoUHJvYmxlbSI) | Write plus atomic-batch1 |

GET and HEAD share read selection; HEAD has no representation body. Alias resolution uses its bodyless redirect. Native 204/304/405/406/412/500 branches retain their actual bodyless rules rather than acquiring a Problem body. The informative [HTTP catalog](../../openapi/README.md) records headers, media, native query carriers and complete transport branches.

Projection alternatives overlap and remain inclusive: an explicit request selects the applicable full or projected arm. Ordinary full output cannot silently become a projection. The optional History, exact-definition and batch entries retain their independent capability/context requirements; a row in this index never advertises them.

## Decoded query and dispatch shapes

The following helpers describe decoded query values or preliminary selection prefixes. A prefix is not a complete invocation, and these schemas do not add JSON bodies to GET requests. Raw query encoding, duplicate members, error precedence and capability admission remain in their protocol clauses.

- [atomicBatchSelection](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoU2VsZWN0aW9uIg)

Every mutation carries the ordinary [idempotencyKey](../core/bdp-v0.1.schema.md#schema-def-ImlkZW1wb3RlbmN5S2V5Ig) HTTP header; it is not a request-body field.

## Shared shapes used by these entries

The entry-point roots reach 83 named definitions in the canonical bundle. They are linked below without copying a partial bundle under the original schema identity. Every link names the same definition represented in the complete Markdown companion.

- [absoluteHttpUrl](../core/bdp-v0.1.schema.md#schema-def-ImFic29sdXRlSHR0cFVybCI)
- [absoluteUri](../core/bdp-v0.1.schema.md#schema-def-ImFic29sdXRlVXJpIg)
- [aliasResult](../core/bdp-v0.1.schema.md#schema-def-ImFsaWFzUmVzdWx0Ig)
- [aliasResultMembers](../core/bdp-v0.1.schema.md#schema-def-ImFsaWFzUmVzdWx0TWVtYmVycyI)
- [atomicBatchCapabilityProblem](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoQ2FwYWJpbGl0eVByb2JsZW0i)
- [atomicBatchOperationName](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoT3BlcmF0aW9uTmFtZSI)
- [atomicBatchOperationProblem](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoT3BlcmF0aW9uUHJvYmxlbSI)
- [atomicBatchProblem](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoUHJvYmxlbSI)
- [atomicBatchResourceResult](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoUmVzb3VyY2VSZXN1bHQi)
- [atomicBatchResult](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoUmVzdWx0Ig)
- [atomicBatchResultEntry](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoUmVzdWx0RW50cnki)
- [atomicBatchSelection](../core/bdp-v0.1.schema.md#schema-def-ImF0b21pY0JhdGNoU2VsZWN0aW9uIg)
- [batchOperation](../core/bdp-v0.1.schema.md#schema-def-ImJhdGNoT3BlcmF0aW9uIg)
- [batchRequest](../core/bdp-v0.1.schema.md#schema-def-ImJhdGNoUmVxdWVzdCI)
- [beadRecord](../core/bdp-v0.1.schema.md#schema-def-ImJlYWRSZWNvcmQi)
- [contextMessage](../core/bdp-v0.1.schema.md#schema-def-ImNvbnRleHRNZXNzYWdlIg)
- [contextString](../core/bdp-v0.1.schema.md#schema-def-ImNvbnRleHRTdHJpbmci)
- [contextTime](../core/bdp-v0.1.schema.md#schema-def-ImNvbnRleHRUaW1lIg)
- [createBeadMembers](../core/bdp-v0.1.schema.md#schema-def-ImNyZWF0ZUJlYWRNZW1iZXJzIg)
- [createBeadOperation](../core/bdp-v0.1.schema.md#schema-def-ImNyZWF0ZUJlYWRPcGVyYXRpb24i)
- [createBeadRequest](../core/bdp-v0.1.schema.md#schema-def-ImNyZWF0ZUJlYWRSZXF1ZXN0Ig)
- [createLinkMembers](../core/bdp-v0.1.schema.md#schema-def-ImNyZWF0ZUxpbmtNZW1iZXJzIg)
- [createLinkOperation](../core/bdp-v0.1.schema.md#schema-def-ImNyZWF0ZUxpbmtPcGVyYXRpb24i)
- [createLinkRequest](../core/bdp-v0.1.schema.md#schema-def-ImNyZWF0ZUxpbmtSZXF1ZXN0Ig)
- [dateTime](../core/bdp-v0.1.schema.md#schema-def-ImRhdGVUaW1lIg)
- [deleteAliasMembers](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUFsaWFzTWVtYmVycyI)
- [deleteAliasRequest](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUFsaWFzUmVxdWVzdCI)
- [deleteBeadMembers](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUJlYWRNZW1iZXJzIg)
- [deleteBeadOperation](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUJlYWRPcGVyYXRpb24i)
- [deleteBeadRequest](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUJlYWRSZXF1ZXN0Ig)
- [deleteLinkMembers](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUxpbmtNZW1iZXJzIg)
- [deleteLinkOperation](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUxpbmtPcGVyYXRpb24i)
- [deleteLinkRequest](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZUxpbmtSZXF1ZXN0Ig)
- [deletedIdentity](../core/bdp-v0.1.schema.md#schema-def-ImRlbGV0ZWRJZGVudGl0eSI)
- [durableInputPinnedReference](../core/bdp-v0.1.schema.md#schema-def-ImR1cmFibGVJbnB1dFBpbm5lZFJlZmVyZW5jZSI)
- [durableInputReference](../core/bdp-v0.1.schema.md#schema-def-ImR1cmFibGVJbnB1dFJlZmVyZW5jZSI)
- [durableResourceReference](../core/bdp-v0.1.schema.md#schema-def-ImR1cmFibGVSZXNvdXJjZVJlZmVyZW5jZSI)
- [expectedRevision](../core/bdp-v0.1.schema.md#schema-def-ImV4cGVjdGVkUmV2aXNpb24i)
- [historyMissing](../core/bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlNaXNzaW5nIg)
- [historyMissingItem](../core/bdp-v0.1.schema.md#schema-def-Imhpc3RvcnlNaXNzaW5nSXRlbSI)
- [idempotencyKey](../core/bdp-v0.1.schema.md#schema-def-ImlkZW1wb3RlbmN5S2V5Ig)
- [inputPinnedReference](../core/bdp-v0.1.schema.md#schema-def-ImlucHV0UGlubmVkUmVmZXJlbmNlIg)
- [inputReference](../core/bdp-v0.1.schema.md#schema-def-ImlucHV0UmVmZXJlbmNlIg)
- [jsonPointer](../core/bdp-v0.1.schema.md#schema-def-Impzb25Qb2ludGVyIg)
- [linkCollection](../core/bdp-v0.1.schema.md#schema-def-ImxpbmtDb2xsZWN0aW9uIg)
- [linkRecord](../core/bdp-v0.1.schema.md#schema-def-ImxpbmtSZWNvcmQi)
- [localBindingReference](../core/bdp-v0.1.schema.md#schema-def-ImxvY2FsQmluZGluZ1JlZmVyZW5jZSI)
- [localName](../core/bdp-v0.1.schema.md#schema-def-ImxvY2FsTmFtZSI)
- [metadata](../core/bdp-v0.1.schema.md#schema-def-Im1ldGFkYXRhIg)
- [mutationOutcome](../core/bdp-v0.1.schema.md#schema-def-Im11dGF0aW9uT3V0Y29tZSI)
- [mutationResult](../core/bdp-v0.1.schema.md#schema-def-Im11dGF0aW9uUmVzdWx0Ig)
- [mutationResultMembers](../core/bdp-v0.1.schema.md#schema-def-Im11dGF0aW9uUmVzdWx0TWVtYmVycyI)
- [ordinaryUpdateChange](../core/bdp-v0.1.schema.md#schema-def-Im9yZGluYXJ5VXBkYXRlQ2hhbmdlIg)
- [ownerRevision](../core/bdp-v0.1.schema.md#schema-def-Im93bmVyUmV2aXNpb24i)
- [ownerRevisions](../core/bdp-v0.1.schema.md#schema-def-Im93bmVyUmV2aXNpb25zIg)
- [pinnedReference](../core/bdp-v0.1.schema.md#schema-def-InBpbm5lZFJlZmVyZW5jZSI)
- [pinnedTypeReference](../core/bdp-v0.1.schema.md#schema-def-InBpbm5lZFR5cGVSZWZlcmVuY2Ui)
- [properties](../core/bdp-v0.1.schema.md#schema-def-InByb3BlcnRpZXMi)
- [propertyChange](../core/bdp-v0.1.schema.md#schema-def-InByb3BlcnR5Q2hhbmdlIg)
- [putAliasMembers](../core/bdp-v0.1.schema.md#schema-def-InB1dEFsaWFzTWVtYmVycyI)
- [putAliasRequest](../core/bdp-v0.1.schema.md#schema-def-InB1dEFsaWFzUmVxdWVzdCI)
- [readProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtIg)
- [readProblemCode](../core/bdp-v0.1.schema.md#schema-def-InJlYWRQcm9ibGVtQ29kZSI)
- [readUpdateProblem](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtIg)
- [readUpdateProblemCode](../core/bdp-v0.1.schema.md#schema-def-InJlYWRVcGRhdGVQcm9ibGVtQ29kZSI)
- [reference](../core/bdp-v0.1.schema.md#schema-def-InJlZmVyZW5jZSI)
- [resourceIdentity](../core/bdp-v0.1.schema.md#schema-def-InJlc291cmNlSWRlbnRpdHki)
- [resourceKind](../core/bdp-v0.1.schema.md#schema-def-InJlc291cmNlS2luZCI)
- [resourceReference](../core/bdp-v0.1.schema.md#schema-def-InJlc291cmNlUmVmZXJlbmNlIg)
- [retryDisposition](../core/bdp-v0.1.schema.md#schema-def-InJldHJ5RGlzcG9zaXRpb24i)
- [revision](../core/bdp-v0.1.schema.md#schema-def-InJldmlzaW9uIg)
- [revisionActor](../core/bdp-v0.1.schema.md#schema-def-InJldmlzaW9uQWN0b3Ii)
- [revisionProvenance](../core/bdp-v0.1.schema.md#schema-def-InJldmlzaW9uUHJvdmVuYW5jZSI)
- [revisionProvenanceInput](../core/bdp-v0.1.schema.md#schema-def-InJldmlzaW9uUHJvdmVuYW5jZUlucHV0Ig)
- [typeReference](../core/bdp-v0.1.schema.md#schema-def-InR5cGVSZWZlcmVuY2Ui)
- [updateBeadMembers](../core/bdp-v0.1.schema.md#schema-def-InVwZGF0ZUJlYWRNZW1iZXJzIg)
- [updateBeadOperation](../core/bdp-v0.1.schema.md#schema-def-InVwZGF0ZUJlYWRPcGVyYXRpb24i)
- [updateBeadRequest](../core/bdp-v0.1.schema.md#schema-def-InVwZGF0ZUJlYWRSZXF1ZXN0Ig)
- [updateLinkMembers](../core/bdp-v0.1.schema.md#schema-def-InVwZGF0ZUxpbmtNZW1iZXJzIg)
- [updateLinkOperation](../core/bdp-v0.1.schema.md#schema-def-InVwZGF0ZUxpbmtPcGVyYXRpb24i)
- [updateLinkRequest](../core/bdp-v0.1.schema.md#schema-def-InVwZGF0ZUxpbmtSZXF1ZXN0Ig)
- [validationDiagnostic](../core/bdp-v0.1.schema.md#schema-def-InZhbGlkYXRpb25EaWFnbm9zdGljIg)
- [validationDiagnostics](../core/bdp-v0.1.schema.md#schema-def-InZhbGlkYXRpb25EaWFnbm9zdGljcyI)

## Source and reproduction

Canonical source: [https://github.com/gastownhall/bdp/schemas/bdp-v0.1.schema.json](../core/bdp-v0.1.schema.json). The companion round-trips to that complete parsed source, preserving required order, omission, exact references, conditionals, annotations and closure. This is source-projection evidence, not executed HTTP, Type admission or storage behavior.

Generate or check with the pinned repository Node runtime:

```sh
# Regenerate the Markdown schema companion and selected profile indexes.
node scripts/generate-markdown-contracts.mjs

# Verify that checked-in projections match their sources.
node scripts/generate-markdown-contracts.mjs --check

```
