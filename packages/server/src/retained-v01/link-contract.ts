/** Private Core-only Link admission; no Types interpretation or remote lookup. */
import {
  admitJsonNumbers,
  decodeJsonDocument,
  snapshotJsonValue,
  type LosslessJsonValue,
} from "@bdp/protocol";
import { encodeSemanticValue, type SemanticValue } from "../semantic-identity.js";
import {
  canonicalCreatedId,
  canonicalSubject,
  closed,
  nonempty,
  numericDiagnostic,
  problem,
  provenanceInput,
  record,
  RETAINED_MEDIA,
  RETAINED_SPEC,
  RetainedFixtureGap,
  RetainedRequestError,
  typeReference,
  type EndpointReference,
  type JsonObject,
} from "./contract.js";
import { assertObjectChange } from "./object-edits.js";
import { inputReferenceUri } from "./reference-input.js";
import { captureReferenceComparison, type SemanticReferenceSlots } from "./reference-comparison.js";

export type LinkOperation = "createLink" | "updateLink" | "deleteLink";
export interface PreparedLink {
  readonly scope: string;
  readonly key: string;
  readonly identity: string;
  readonly operation: LinkOperation;
  readonly value: JsonObject;
  readonly refusal?: JsonObject;
}
const capturedLinks = new WeakSet<PreparedLink>();
export function assertPreparedLink(
  scope: string,
  operation: LinkOperation,
  input: PreparedLink,
): void {
  if (!capturedLinks.has(input) || input.scope !== scope || input.operation !== operation)
    throw new TypeError("foreign or forged prepared Link invocation");
}
function endpoint(scope: string, input: LosslessJsonValue): EndpointReference {
  if (typeof input === "string") return inputReferenceUri(scope, input);
  const value = record(input);
  closed(value, ["uri", "revision"]);
  nonempty(value.uri);
  nonempty(value.revision);
  return Object.freeze({ uri: inputReferenceUri(scope, value.uri), revision: value.revision });
}
export function prepareLink(
  scope: string,
  operation: LinkOperation,
  text: string,
  key: string,
): PreparedLink {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(key)) throw new RetainedRequestError("malformed-request", 400);
  let input: Record<string, LosslessJsonValue>;
  try {
    input = record(decodeJsonDocument(text));
    const common = ["type", "properties", "metadata", "revisionProvenance", "source", "target"];
    closed(
      input,
      operation === "createLink"
        ? ["id", ...common]
        : operation === "updateLink"
          ? ["link", ...common, "expectedRevision", "propertiesChange", "metadataChange"]
          : ["link", "expectedRevision", "revisionProvenance"],
    );
    if (operation === "createLink") {
      typeReference(input.type);
      if (input.source === undefined || input.target === undefined)
        throw new TypeError("missing endpoint");
      if (input.id !== undefined) nonempty(input.id);
    } else {
      nonempty(input.link);
      if (input.expectedRevision !== undefined) nonempty(input.expectedRevision);
      if (input.type !== undefined) typeReference(input.type);
      if (
        operation === "updateLink" &&
        ![
          "type",
          "properties",
          "metadata",
          "propertiesChange",
          "metadataChange",
          "source",
          "target",
        ].some((name) => Object.hasOwn(input, name))
      )
        throw new TypeError("no mutation member");
    }
    if (input.revisionProvenance !== undefined) provenanceInput(input.revisionProvenance);
    for (const name of ["properties", "metadata"] as const) {
      const value = input[name];
      const change = input[`${name}Change`];
      if (value !== undefined && change !== undefined) throw new TypeError("exclusive edit modes");
      if (value !== undefined) record(value);
      if (change !== undefined) assertObjectChange(change);
    }
    input = {
      ...input,
      ...(input.id === undefined ? {} : { id: canonicalCreatedId(scope, input.id as string) }),
      ...(input.link === undefined ? {} : { link: canonicalSubject(scope, input.link as string) }),
      ...(input.source === undefined ? {} : { source: endpoint(scope, input.source) }),
      ...(input.target === undefined ? {} : { target: endpoint(scope, input.target) }),
      ...(operation === "createLink"
        ? { properties: input.properties ?? {}, metadata: input.metadata ?? {} }
        : {}),
    };
  } catch (error) {
    if (error instanceof RetainedRequestError || error instanceof RetainedFixtureGap) throw error;
    throw new RetainedRequestError("malformed-request", 400);
  }
  const identityFor = (references: SemanticReferenceSlots) =>
    encodeSemanticValue({
      format: "retained-v01-link-1",
      specification: RETAINED_SPEC,
      media: RETAINED_MEDIA,
      capabilities: {},
      operation,
      input: { ...input, ...references } as SemanticValue,
    });
  const identity = identityFor({});
  const admitted = admitJsonNumbers(input, {
    diagnostics: 8,
    diagnosticBytes: 4096,
    diagnostic: ({ pointer }) => numericDiagnostic(pointer),
  });
  const prepared: PreparedLink = Object.freeze({
    scope,
    key,
    identity,
    operation,
    value: admitted.ok ? (snapshotJsonValue(admitted.value) as JsonObject) : Object.freeze({}),
    ...(admitted.ok
      ? {}
      : {
          refusal: snapshotJsonValue({
            ...problem("validation-failed", 422),
            diagnostics: admitted.diagnostics,
            ...(admitted.diagnosticsTruncated ? { diagnosticsTruncated: true } : {}),
          }) as JsonObject,
        }),
  });
  capturedLinks.add(prepared);
  const references: Partial<Record<"source" | "target", EndpointReference>> = {};
  for (const name of ["source", "target"] as const) {
    if (input[name] !== undefined) references[name] = input[name] as EndpointReference;
  }
  captureReferenceComparison(prepared, references, identityFor);
  return prepared;
}
