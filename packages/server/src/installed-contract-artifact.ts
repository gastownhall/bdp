import { createHash } from "node:crypto";
import { isProxy, isUint8Array } from "node:util/types";
import {
  createTypeConformanceIndex,
  decodeJsonDocument,
  JsonNumberLiteral,
  JsonSyntaxError,
  type LosslessJsonValue,
  parseCanonicalHttpUrl,
  parseTypeDescriptor,
  ProtocolArtifactValidationError,
  type MeasuredTypeConformanceIndex,
  type TypeConformanceStatistics,
  type TypeDescriptor,
} from "@bdp/protocol";

/** Private administrative candidate, never a compiled/installed registry. */
export const CONTRACT_ARTIFACT_FORMAT = "bdp-contract-artifacts-1";
export const CONTRACT_ARTIFACT_CEILINGS = Object.freeze({
  submittedArtifacts: 8192,
  descriptors: 4096,
  schemas: 4096,
  artifactBytes: 1048576,
  totalBytes: 16777216,
  descriptorDepth: 32,
  schemaDepth: 4096,
  syntaxNodes: 1048576,
  dependencyReferences: 65536,
  conformanceEdges: 65536,
  conformanceDepth: 4096,
  effectiveMemberships: 262144,
  unionAttempts: 1048576,
  maxOwnershipMax: Number.MAX_SAFE_INTEGER,
});
export type ContractArtifactLimits = {
  readonly [K in keyof typeof CONTRACT_ARTIFACT_CEILINGS]: number;
};
export interface ContractArtifactInput {
  readonly retrievalUri: string;
  readonly utf8Bytes: Uint8Array;
}
export interface ContractArtifactBundleInput {
  readonly descriptors: readonly ContractArtifactInput[];
  readonly schemas: readonly ContractArtifactInput[];
  readonly limits: ContractArtifactLimits;
}
/** Codes identify stable refusal categories, not a particular administrative knob.
 * Conformance covers invalid relations and exhaustion of its configured bounds. */
export type ContractArtifactErrorCode =
  | "input-shape"
  | "limit"
  | "retrieval-uri"
  | "utf8"
  | "json-syntax"
  | "descriptor-number"
  | "descriptor"
  | "identity-conflict"
  | "descriptor-dependency"
  | "conformance";
export class ContractArtifactError extends Error {
  constructor(readonly code: ContractArtifactErrorCode) {
    // Never copy parser errors, URI strings or artifact content into local reports.
    super(`contract artifact ingestion refused: ${code}`);
    this.name = "ContractArtifactError";
  }
}
/** Unexpected dependency/invariant failures are not malformed input or wire Problems. */
export class ContractArtifactLocalError extends Error {
  readonly code = "local-failure";
  constructor() {
    // Preserve neither arbitrary exception text nor its payload-bearing cause.
    super("contract artifact ingestion failed locally");
    this.name = "ContractArtifactLocalError";
  }
}
export interface ContractArtifactEntry {
  readonly kind: "descriptor" | "schema";
  readonly retrievalUri: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly bytesBase64: string;
}
export interface ContractArtifactCandidate {
  readonly format: typeof CONTRACT_ARTIFACT_FORMAT;
  readonly sha256: string;
  readonly artifacts: readonly ContractArtifactEntry[];
  readonly descriptors: readonly TypeDescriptor[];
  readonly conformance: MeasuredTypeConformanceIndex;
  readonly receipt: {
    readonly limits: ContractArtifactLimits;
    readonly submittedArtifacts: number;
    readonly submittedBytes: number;
    /** Separate URI counter: per URI <= artifactBytes, total <= totalBytes.
     * URI bytes enter the digest; this measured counter and limits do not. */
    readonly submittedUriBytes: number;
    readonly syntaxNodes: number;
    readonly dependencyReferences: number;
    readonly conformance: TypeConformanceStatistics;
  };
}
const limitKeys = Object.keys(CONTRACT_ARTIFACT_CEILINGS) as (keyof ContractArtifactLimits)[];
const positiveLimits = new Set<keyof ContractArtifactLimits>([
  "artifactBytes",
  "totalBytes",
  "descriptorDepth",
  "schemaDepth",
  "conformanceDepth",
  "maxOwnershipMax",
]);
const byteLengthGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
function refuse(code: ContractArtifactErrorCode): never {
  throw new ContractArtifactError(code);
}
/** Only plain data is input: accessors/proxies are not an administrative API. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || isProxy(value)) refuse("input-shape");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) refuse("input-shape");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length) refuse("input-shape");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = fields[key];
    if (field === undefined || !Object.hasOwn(field, "value")) refuse("input-shape");
    result[key] = field.value;
  }
  return result;
}
function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value)) refuse("input-shape");
  if (value.length > maximum) refuse("limit");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== value.length + 1) refuse("input-shape");
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const field = fields[String(i)];
    if (field === undefined || !Object.hasOwn(field, "value")) refuse("input-shape");
    result.push(field.value);
  }
  return result;
}
function snapshotLimits(input: unknown): ContractArtifactLimits {
  const values = record(input, limitKeys);
  for (const key of limitKeys) {
    const value = values[key];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > CONTRACT_ARTIFACT_CEILINGS[key] ||
      (positiveLimits.has(key) && value === 0)
    )
      refuse("limit");
  }
  return Object.freeze(values) as unknown as ContractArtifactLimits;
}
function exactInteger(literal: string): number {
  // Syntax is already checked. Strip zeroes and adjust a bounded decimal scale;
  // never form 10**exponent or an exponent-sized expanded coefficient.
  const negative = literal.startsWith("-");
  const unsigned = negative ? literal.slice(1) : literal;
  const atExponent = unsigned.search(/[eE]/);
  const mantissa = atExponent === -1 ? unsigned : unsigned.slice(0, atExponent);
  const exponentText = atExponent === -1 ? "0" : unsigned.slice(atExponent + 1);
  const point = mantissa.indexOf(".");
  const fraction = point === -1 ? 0 : mantissa.length - point - 1;
  const digits = mantissa.replace(".", "").replace(/^0+/, "");
  if (digits.length === 0) return negative ? -0 : 0;
  const exponentDigits = exponentText.replace(/^[+-]/, "").replace(/^0+/, "");
  // Input bytes are capped at 1 MiB; a >7 digit exponent cannot cancel its scale.
  if (exponentDigits.length > 7) refuse("descriptor-number");
  const exponent = Number(exponentText);
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 48) end--;
  const significant = digits.slice(0, end);
  const scale = exponent - fraction + digits.length - significant.length;
  if (scale < 0 || significant.length + scale > 16) refuse("descriptor-number");
  const magnitude = significant + "0".repeat(scale);
  if (magnitude.length === 16 && magnitude > "9007199254740991") refuse("descriptor-number");
  const value = Number(magnitude);
  return negative ? -value : value;
}
type MutableJson = unknown[] | Record<string, unknown>;
/** Keep every member, including unknown names, for the canonical closed parser. */
function descriptorValue(root: LosslessJsonValue): unknown {
  const holder: Record<string, unknown> = Object.create(null);
  const pending: { source: LosslessJsonValue; target: MutableJson; key: string | number }[] = [
    { source: root, target: holder, key: "value" },
  ];
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined) throw new Error("missing descriptor frame");
    const { source, target, key } = item;
    let value: unknown = source;
    if (source instanceof JsonNumberLiteral) value = exactInteger(source.literal);
    else if (source !== null && typeof source === "object") {
      const child: MutableJson = Array.isArray(source) ? [] : Object.create(null);
      value = child;
      for (const [name, entry] of Object.entries(source))
        pending.push({ source: entry as LosslessJsonValue, target: child, key: name });
    }
    Object.defineProperty(target, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  return holder.value;
}
function countSyntax(
  root: LosslessJsonValue,
  maximumDepth: number,
  remainingNodes: number,
): number {
  let nodes = 0;
  const pending = [{ value: root, parentDepth: 0 }];
  const count = (): void => {
    if (nodes >= remainingNodes) refuse("limit");
    nodes++;
  };
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined) throw new Error("missing syntax frame");
    count();
    const value = item.value;
    if (value === null || typeof value !== "object" || value instanceof JsonNumberLiteral) continue;
    const depth = item.parentDepth + 1;
    if (depth > maximumDepth) refuse("limit");
    const isArray = Array.isArray(value);
    // Every child and already pending frame needs at least one more syntax node.
    // Refuse wide arrays before allocating their values/pending-frame arrays.
    if (isArray && value.length > remainingNodes - nodes - pending.length) refuse("limit");
    for (const child of Object.values(value)) {
      if (!isArray) count(); // Each member key is a syntax position too.
      pending.push({ value: child as LosslessJsonValue, parentDepth: depth });
    }
  }
  return nodes;
}
interface CapturedArtifact {
  readonly entry: ContractArtifactEntry;
  readonly bytes: Uint8Array;
  readonly uriBytes: Buffer;
  readonly descriptor?: TypeDescriptor;
}
function digest(artifacts: readonly CapturedArtifact[]): string {
  const hash = createHash("sha256").update(`${CONTRACT_ARTIFACT_FORMAT}\0`, "ascii");
  const count = Buffer.alloc(4);
  count.writeUInt32BE(artifacts.length);
  hash.update(count);
  for (const artifact of artifacts) {
    const header = Buffer.alloc(5);
    header[0] = artifact.entry.kind === "descriptor" ? 0 : 1;
    header.writeUInt32BE(artifact.uriBytes.length, 1);
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(artifact.bytes.length));
    hash.update(header).update(artifact.uriBytes).update(size).update(artifact.bytes);
  }
  return hash.digest("hex");
}
function checkDependencies(descriptors: readonly TypeDescriptor[], maximum: number): number {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  let count = 0;
  const requireType = (id: string, category: "bead" | "link"): void => {
    if (count >= maximum) refuse("limit");
    count++;
    if (byId.get(id)?.describes !== category) refuse("descriptor-dependency");
  };
  for (const descriptor of descriptors) {
    for (const parent of descriptor.conformsTo) requireType(parent, descriptor.describes);
    if (descriptor.describes === "link") {
      for (const requirement of descriptor.source.conformsTo) requireType(requirement, "bead");
      for (const requirement of descriptor.target.conformsTo) requireType(requirement, "bead");
    } else if (descriptor.ownsOutgoing !== undefined) {
      for (const id of Object.keys(descriptor.ownsOutgoing))
        if (id !== "*") requireType(id, "link");
    }
  }
  return count;
}

export function ingestContractArtifacts(
  input: ContractArtifactBundleInput,
): ContractArtifactCandidate {
  try {
    return captureContractArtifacts(input);
  } catch (error) {
    if (error instanceof ContractArtifactError) throw error;
    throw new ContractArtifactLocalError();
  }
}
function captureContractArtifacts(input: ContractArtifactBundleInput): ContractArtifactCandidate {
  const fields = record(input, ["descriptors", "schemas", "limits"]);
  const limits = snapshotLimits(fields.limits);
  const descriptors = array(fields.descriptors, limits.descriptors);
  const schemas = array(fields.schemas, limits.schemas);
  const submittedArtifacts = descriptors.length + schemas.length;
  if (submittedArtifacts > limits.submittedArtifacts) refuse("limit");
  let submittedBytes = 0;
  let submittedUriBytes = 0;
  let syntaxNodes = 0;
  const captured = new Map<string, CapturedArtifact>();
  for (const [kind, entries] of [
    ["descriptor", descriptors],
    ["schema", schemas],
  ] as const) {
    for (const input of entries) {
      const fields = record(input, ["retrievalUri", "utf8Bytes"]);
      const uri = fields.retrievalUri;
      if (typeof uri !== "string") refuse("retrieval-uri");
      // Bound the separate local identifier before allocating URL/UTF-8 copies.
      if (uri.length > limits.artifactBytes) refuse("limit");
      const uriBytes = Buffer.byteLength(uri);
      if (uriBytes > limits.artifactBytes || uriBytes > limits.totalBytes - submittedUriBytes)
        refuse("limit");
      submittedUriBytes += uriBytes;
      try {
        parseCanonicalHttpUrl(uri);
      } catch (error) {
        if (error instanceof ProtocolArtifactValidationError) refuse("retrieval-uri");
        throw error;
      }
      const source = fields.utf8Bytes;
      if (!isUint8Array(source) || isProxy(source)) refuse("input-shape");
      if (byteLengthGetter === undefined) throw new Error("missing typed-array intrinsic");
      const byteLength = byteLengthGetter.call(source) as number;
      if (byteLength > limits.artifactBytes || byteLength > limits.totalBytes - submittedBytes)
        refuse("limit");
      submittedBytes += byteLength;
      const bytes = new Uint8Array(byteLength);
      // Intrinsic typed-array copy ignores a caller's iterator/length properties.
      try {
        Uint8Array.prototype.set.call(bytes, source);
      } catch (error) {
        // The intrinsic rejects a detached source with TypeError. The fresh
        // target has exactly the measured length; unrelated failures are local.
        if (error instanceof TypeError) refuse("input-shape");
        throw error;
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch (error) {
        // Node's fatal UTF-8 decoder identifies invalid input with this code.
        if (
          error instanceof TypeError &&
          "code" in error &&
          error.code === "ERR_ENCODING_INVALID_ENCODED_DATA"
        )
          refuse("utf8");
        throw error;
      }
      let syntax: LosslessJsonValue;
      try {
        syntax = decodeJsonDocument(text);
      } catch (error) {
        if (error instanceof JsonSyntaxError) refuse("json-syntax");
        throw error;
      }
      syntaxNodes += countSyntax(
        syntax,
        kind === "descriptor" ? limits.descriptorDepth : limits.schemaDepth,
        limits.syntaxNodes - syntaxNodes,
      );
      let descriptor: TypeDescriptor | undefined;
      if (kind === "descriptor") {
        const value = descriptorValue(syntax);
        try {
          descriptor = parseTypeDescriptor(value);
        } catch (error) {
          if (error instanceof ProtocolArtifactValidationError) refuse("descriptor");
          throw error;
        }
        if (descriptor.id !== uri) refuse("descriptor");
        if (descriptor.describes === "bead" && descriptor.ownsOutgoing !== undefined) {
          for (const declaration of Object.values(descriptor.ownsOutgoing))
            if (declaration.max > limits.maxOwnershipMax) refuse("limit");
        }
      }
      const prior = captured.get(uri);
      if (prior !== undefined) {
        if (prior.entry.kind !== kind || !Buffer.from(bytes).equals(prior.bytes))
          refuse("identity-conflict");
        continue;
      }
      const entry = Object.freeze({
        kind,
        retrievalUri: uri,
        byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytesBase64: Buffer.from(bytes).toString("base64"),
      });
      captured.set(uri, {
        entry,
        bytes,
        uriBytes: Buffer.from(uri),
        ...(descriptor === undefined ? {} : { descriptor }),
      });
    }
  }
  const artifacts = [...captured.values()].sort((a, b) => Buffer.compare(a.uriBytes, b.uriBytes));
  const parsed = Object.freeze(
    artifacts.flatMap((artifact) =>
      artifact.descriptor === undefined ? [] : [artifact.descriptor],
    ),
  );
  const dependencyReferences = checkDependencies(parsed, limits.dependencyReferences);
  let conformance: MeasuredTypeConformanceIndex;
  try {
    conformance = createTypeConformanceIndex(parsed, {
      nodes: limits.descriptors,
      edges: limits.conformanceEdges,
      depth: limits.conformanceDepth,
      memberships: limits.effectiveMemberships,
      unionAttempts: limits.unionAttempts,
    });
  } catch (error) {
    if (error instanceof ProtocolArtifactValidationError) refuse("conformance");
    throw error;
  }
  return Object.freeze({
    format: CONTRACT_ARTIFACT_FORMAT,
    sha256: digest(artifacts),
    artifacts: Object.freeze(artifacts.map((artifact) => artifact.entry)),
    descriptors: parsed,
    conformance,
    receipt: Object.freeze({
      limits,
      submittedArtifacts,
      submittedBytes,
      submittedUriBytes,
      syntaxNodes,
      dependencyReferences,
      conformance: conformance.statistics,
    }),
  });
}
