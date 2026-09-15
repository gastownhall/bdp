import { createHash } from "node:crypto";
import { decodeJsonDocument, JsonNumberLiteral, type LosslessJsonValue } from "@bdp/protocol";
import {
  ingestContractArtifacts,
  ContractArtifactError,
  type ContractArtifactBundleInput,
} from "./installed-contract-artifact.js";
import { BUILTIN_SCHEMA_DIGEST, BUILTIN_SCHEMA_DOCUMENTS } from "./installed-schema-builtins.js";
import {
  GraphBudget,
  isSchemaObject,
  refuseGraph,
  schema,
  SchemaGraphError,
  type SchemaGraphLimits,
  visitSchemaChildren,
} from "./installed-schema-shape.js";
import { checkAnchor, resolveSchemaUri, type ResolvedSchemaUri } from "./installed-schema-uri.js";

/** Private implementation revision, not a normative BDP version. See the
 * source-pin guard/version rule in test-support/schema-graph-policy.json. */
export const SCHEMA_GRAPH_POLICY = "schema-resource-index-2";
const DIALECT = "https://json-schema.org/draft/2020-12/schema";
const deferred = Object.freeze([
  "string-semantics",
  "instance-evaluation",
  "dynamic-execution",
  "regex",
  "termination-and-work",
  "root-openness",
  "population",
  "ownership",
] as const);
export interface SchemaPointer {
  readonly parent: number | null;
  readonly segment: string;
}
export interface SchemaNode {
  readonly id: number;
  readonly resource: number;
  readonly documentPointer: number;
  readonly resourceRootPointer: number;
  readonly value: LosslessJsonValue;
  readonly keywords: readonly {
    readonly name: string;
    readonly value: LosslessJsonValue;
    readonly pointer: number;
  }[];
}
export interface SchemaResource {
  readonly id: number;
  readonly artifact: string;
  readonly node: number;
  readonly canonicalUri: string;
  readonly retrievalAlias?: string;
  readonly containingResource?: number;
  readonly dialect: typeof DIALECT;
  readonly dialectSource: "explicit" | "inherited" | "bdp-default";
  readonly anchors: Readonly<Record<string, number>>;
  readonly dynamicAnchors: Readonly<Record<string, number>>;
}
export interface SchemaReference {
  readonly node: number;
  readonly keyword: "$ref" | "$dynamicRef";
  readonly raw: string;
  readonly resolvedUri: string;
  readonly target: number;
  readonly fragmentKind: ResolvedSchemaUri["fragmentKind"];
  readonly kind: "static" | "dynamic-anchor";
  readonly anchor?: string;
}
export interface SchemaGraphCandidate {
  readonly stage: typeof SCHEMA_GRAPH_POLICY;
  readonly artifactDigest: string;
  readonly builtinDigest: string;
  readonly identity: string;
  readonly pointers: readonly SchemaPointer[];
  readonly nodes: readonly SchemaNode[];
  readonly resources: readonly SchemaResource[];
  readonly children: readonly {
    readonly node: number;
    readonly keyword: string;
    readonly member?: string;
    readonly target: number;
    readonly relation: string;
  }[];
  readonly references: readonly SchemaReference[];
  readonly descriptorRoots: readonly {
    readonly descriptor: string;
    readonly originalUri: string;
    readonly resolvedUri: string;
    readonly node: number;
    readonly resource: number;
  }[];
  readonly receipt: {
    readonly policy: typeof SCHEMA_GRAPH_POLICY;
    readonly limits: SchemaGraphLimits;
    readonly counters: SchemaGraphLimits;
    readonly deferred: typeof deferred;
  };
}
/** Explicit parent links; never concatenate every ancestor while indexing. */
export function formatSchemaPointer(
  pointers: readonly SchemaPointer[],
  id: number,
  root: number,
  maximum: number,
): string {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    maximum > 16_777_216 ||
    !Number.isSafeInteger(id) ||
    !Number.isSafeInteger(root) ||
    !pointers[id] ||
    !pointers[root]
  )
    refuseGraph("pointer-location");
  const segments: string[] = [];
  let length = 0,
    visited = 0;
  while (id !== root) {
    const p = pointers[id];
    if (!p || p.parent === null || ++visited > pointers.length) refuseGraph("pointer-location");
    let encodedLength = 1;
    for (const c of p.segment) encodedLength += c === "~" || c === "/" ? 2 : c.length;
    length += encodedLength;
    if (length > maximum) refuseGraph("limit-location");
    const escaped = p.segment.replace(/~/g, "~0").replace(/\//g, "~1");
    segments.push(escaped);
    id = p.parent;
  }
  return segments.length ? `/${segments.reverse().join("/")}` : "";
}
/** Bounded static keyword location; this is never a runtime validation path. */
export function formatSchemaKeywordUri(
  graph: SchemaGraphCandidate,
  nodeId: number,
  keyword: string,
  maximum = 2048,
): string {
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 2048)
    refuseGraph("pointer-location");
  const node = graph.nodes[nodeId];
  const entry = node?.keywords.find((k) => k.name === keyword);
  if (!node || !entry) refuseGraph("pointer-location");
  const resource = graph.resources[node.resource];
  if (!resource) refuseGraph("pointer-location");
  const pointer = formatSchemaPointer(
    graph.pointers,
    entry.pointer,
    node.resourceRootPointer,
    maximum,
  );
  let encodedLength = resource.canonicalUri.length + 1;
  for (const c of pointer) {
    const cp = c.codePointAt(0) as number;
    if (cp >= 0xd800 && cp <= 0xdfff) refuseGraph("location-encoding");
    encodedLength += /^[A-Za-z0-9!'()*._~/-]$/.test(c) ? 1 : Buffer.byteLength(c) * 3;
    if (encodedLength > maximum) refuseGraph("limit-location");
  }
  return `${resource.canonicalUri}#${encodeURIComponent(pointer).replace(/%2F/g, "/")}`;
}
export function buildInstalledSchemaGraph(
  input: ContractArtifactBundleInput,
  limits: SchemaGraphLimits,
): SchemaGraphCandidate {
  try {
    return build(input, new GraphBudget(limits));
  } catch (error) {
    if (error instanceof SchemaGraphError || error instanceof ContractArtifactError) throw error;
    // Never carry arbitrary dependency payloads or a fake instance Problem.
    throw new SchemaGraphError("local-failure");
  }
}
function build(input: ContractArtifactBundleInput, b: GraphBudget): SchemaGraphCandidate {
  const artifact = ingestContractArtifacts(input);
  // Verify the aggregate against the same immutable rows indexed below. Keep
  // this per-build and charged; no shared parsed prelude or readiness cache.
  const builtinHash = createHash("sha256");
  for (const doc of BUILTIN_SCHEMA_DOCUMENTS) {
    b.charge("scanWork", doc.uri.length + doc.sha256.length + 2);
    builtinHash.update(`${doc.uri}\0${doc.sha256}\n`);
  }
  if (builtinHash.digest("hex") !== BUILTIN_SCHEMA_DIGEST) refuseGraph("internal-invariant");
  const documents = [
    ...artifact.artifacts
      .filter((a) => a.kind === "schema")
      .map((a) => ({ uri: a.retrievalUri, bytesBase64: a.bytesBase64, sha256: a.sha256 })),
    ...BUILTIN_SCHEMA_DOCUMENTS,
  ];
  const pointers: SchemaPointer[] = [];
  const values: LosslessJsonValue[] = [];
  const positions = new Map<number, Map<string, number>>();
  const pointer = (parent: number | null, segment: string, value: LosslessJsonValue): number => {
    b.charge("retainedBytes", Buffer.byteLength(segment));
    b.charge("scanWork", segment.length + 1);
    const id = pointers.length;
    pointers.push(Object.freeze({ parent, segment }));
    values[id] = value;
    if (parent !== null) {
      let entries = positions.get(parent);
      if (!entries) {
        entries = new Map();
        positions.set(parent, entries);
      }
      entries.set(segment, id);
    }
    return id;
  };
  const childPointer = (parent: number, key: string): number => {
    const id = positions.get(parent)?.get(key);
    if (id === undefined) refuseGraph("internal-invariant");
    return id;
  };
  const nodes: SchemaNode[] = [],
    resources: SchemaResource[] = [];
  const children: {
    node: number;
    keyword: string;
    member?: string;
    target: number;
    relation: string;
  }[] = [];
  const references: SchemaReference[] = [];
  const nodeAt = new Map<number, number>();
  const resourceAt = new Map<number, number>();
  const identities = new Map<string, number>();
  const unresolved: { node: number; keyword: "$ref" | "$dynamicRef"; raw: string }[] = [];
  const roots: { pointer: number; uri: string }[] = [];
  const retain = (s: string): void => {
    b.charge("retainedBytes", Buffer.byteLength(s));
  };
  for (const doc of documents) {
    const size = Buffer.byteLength(doc.bytesBase64, "base64");
    b.charge("schemaBytes", size);
    const bytes = Buffer.from(doc.bytesBase64, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== doc.sha256)
      refuseGraph("internal-invariant");
    const value = decodeJsonDocument(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    );
    schema(value);
    b.charge("syntaxNodes");
    const root = pointer(null, "", value);
    roots.push({ pointer: root, uri: doc.uri });
    const pending = [{ id: root, value, depth: 0 }];
    while (pending.length) {
      const item = pending.pop();
      if (!item) refuseGraph("internal-invariant");
      b.charge("scanWork");
      if (
        item.value === null ||
        typeof item.value !== "object" ||
        item.value instanceof JsonNumberLiteral
      )
        continue;
      const depth = item.depth + 1;
      b.bound("depth", depth);
      const array = Array.isArray(item.value);
      for (const key of Object.keys(item.value)) {
        b.charge("syntaxNodes", array ? 1 : 2);
        const child = (item.value as Record<string, LosslessJsonValue>)[key] as LosslessJsonValue;
        pending.push({ id: pointer(item.id, key, child), value: child, depth });
      }
      Object.freeze(item.value);
    }
  }
  for (const document of roots) {
    const pending: {
      pointer: number;
      resource?: number;
      parent?: number;
      keyword?: string;
      member?: string;
    }[] = [{ pointer: document.pointer }];
    while (pending.length) {
      const item = pending.pop();
      if (!item) refuseGraph("internal-invariant");
      const value = values[item.pointer] as LosslessJsonValue;
      schema(value);
      b.charge("nodes");
      const id = nodes.length;
      nodeAt.set(item.pointer, id);
      const record = isSchemaObject(value) ? value : undefined;
      let resourceId = item.resource;
      if (resourceId === undefined || record?.$id !== undefined) {
        b.charge("resources");
        const base =
          resourceId === undefined
            ? document.uri
            : (resources[resourceId] as SchemaResource).canonicalUri;
        if (record?.$id !== undefined && typeof record.$id !== "string")
          refuseGraph("keyword-shape", id);
        const canonical = resolveSchemaUri(
          base,
          typeof record?.$id === "string" ? record.$id : "",
          b,
        );
        if (canonical.fragment !== "") refuseGraph("id-fragment", id);
        const containingResource = resourceId;
        resourceId = resources.length;
        const anchors: Record<string, number> = Object.create(null),
          dynamicAnchors: Record<string, number> = Object.create(null);
        const resource: SchemaResource = {
          id: resourceId,
          artifact: document.uri,
          node: id,
          canonicalUri: canonical.resource,
          dialect: DIALECT,
          dialectSource:
            record?.$schema !== undefined
              ? "explicit"
              : containingResource === undefined
                ? "bdp-default"
                : "inherited",
          anchors,
          dynamicAnchors,
          ...(containingResource === undefined
            ? { retrievalAlias: document.uri }
            : { containingResource }),
        };
        resources.push(resource);
        resourceAt.set(item.pointer, resourceId);
        retain(canonical.resource);
        const aliases =
          containingResource === undefined
            ? [canonical.resource, resolveSchemaUri(document.uri, "", b).resource]
            : [canonical.resource];
        for (const alias of aliases) {
          b.charge("scanWork", alias.length);
          const old = identities.get(alias);
          if (old !== undefined && old !== resourceId) refuseGraph("resource-collision", id);
          retain(alias);
          identities.set(alias, resourceId);
        }
      }
      const resource = resources[resourceId] as SchemaResource;
      const rootPointer = nodes[resource.node]?.documentPointer ?? item.pointer;
      const keywords = record
        ? Object.keys(record).map((name) => {
            b.charge("scanWork", name.length + 1);
            return Object.freeze({
              name,
              value: record[name] as LosslessJsonValue,
              pointer: childPointer(item.pointer, name),
            });
          })
        : [];
      nodes.push(
        Object.freeze({
          id,
          resource: resourceId,
          documentPointer: item.pointer,
          resourceRootPointer: rootPointer,
          value,
          keywords: Object.freeze(keywords),
        }),
      );
      if (item.parent !== undefined && item.keyword !== undefined) {
        const relation =
          item.keyword === "$defs" || item.keyword === "definitions"
            ? "reserved"
            : item.keyword === "contentSchema"
              ? "content-schema"
              : item.keyword === "propertyNames"
                ? "property-name"
                : ["items", "prefixItems", "contains", "unevaluatedItems"].includes(item.keyword)
                  ? "array-item"
                  : [
                        "properties",
                        "patternProperties",
                        "additionalProperties",
                        "unevaluatedProperties",
                      ].includes(item.keyword)
                    ? "object-value"
                    : "in-place";
        children.push(
          Object.freeze({
            node: item.parent,
            keyword: item.keyword,
            ...(item.member === undefined ? {} : { member: item.member }),
            target: id,
            relation,
          }),
        );
      }
      if (!record) continue;
      if (record.$schema !== undefined) {
        if (resource.node !== id) refuseGraph("schema-placement", id);
        if (typeof record.$schema !== "string" || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(record.$schema))
          refuseGraph("dialect", id);
        if (resolveSchemaUri(resource.canonicalUri, record.$schema, b).uri !== DIALECT)
          refuseGraph("unsupported-dialect", id);
      }
      if (record.$vocabulary !== undefined) {
        if (item.pointer !== document.pointer) refuseGraph("vocabulary-placement", id);
        if (!isSchemaObject(record.$vocabulary)) refuseGraph("keyword-shape", id);
        for (const name of Object.keys(record.$vocabulary)) {
          if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(name)) refuseGraph("vocabulary-uri", id);
          resolveSchemaUri(resource.canonicalUri, name, b);
        }
      }
      for (const key of ["$anchor", "$dynamicAnchor"] as const) {
        const name = record[key];
        if (name === undefined) continue;
        if (typeof name !== "string") refuseGraph("keyword-shape", id);
        b.charge("anchors");
        checkAnchor(name, b);
        retain(name);
        if (Object.hasOwn(resource.anchors, name)) refuseGraph("anchor-collision", id);
        (resource.anchors as Record<string, number>)[name] = id;
        if (key === "$dynamicAnchor")
          (resource.dynamicAnchors as Record<string, number>)[name] = id;
      }
      for (const keyword of ["$ref", "$dynamicRef"] as const) {
        const raw = record[keyword];
        if (raw === undefined) continue;
        if (typeof raw !== "string") refuseGraph("keyword-shape", id);
        b.charge("references");
        unresolved.push({ node: id, keyword, raw });
      }
      visitSchemaChildren(record, b, (child) => {
        let location = childPointer(item.pointer, child.keyword);
        if (child.member !== undefined) location = childPointer(location, child.member);
        pending.push({
          pointer: location,
          resource: resourceId,
          parent: id,
          keyword: child.keyword,
          ...(child.member === undefined ? {} : { member: child.member }),
        });
      });
    }
  }
  const resolve = (
    base: string,
    raw: string,
    location: number | string,
  ): { resolved: ResolvedSchemaUri; target: number; dynamic: boolean } => {
    try {
      const resolved = resolveSchemaUri(base, raw, b);
      retain(resolved.uri);
      b.charge("scanWork", resolved.resource.length);
      const rid = identities.get(resolved.resource);
      if (rid === undefined) refuseGraph("missing-resource");
      const resource = resources[rid] as SchemaResource;
      let target = resource.node;
      if (resolved.fragmentKind === "plain-name") {
        const found = resource.anchors[resolved.fragment];
        if (found === undefined) refuseGraph("missing-anchor");
        target = found;
      } else if (resolved.fragmentKind === "pointer") {
        let p = (nodes[target] as SchemaNode).documentPointer;
        for (const rawToken of resolved.fragment.slice(1).split("/")) {
          b.charge("pointerSteps");
          b.charge("scanWork", rawToken.length + 1);
          let token = "";
          for (let i = 0; i < rawToken.length; i++) {
            const c = rawToken[i];
            if (c !== "~") token += c;
            else {
              const next = rawToken[++i];
              if (next !== "0" && next !== "1") refuseGraph("pointer");
              token += next === "0" ? "~" : "/";
            }
          }
          const value = values[p];
          if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(token)) refuseGraph("pointer");
          const next = positions.get(p)?.get(token);
          if (next === undefined) refuseGraph("pointer");
          p = next;
          const crossed = resourceAt.get(p);
          if (crossed !== undefined && crossed !== rid)
            refuseGraph("unsupported-cross-resource-pointer");
        }
        const found = nodeAt.get(p);
        if (found === undefined) refuseGraph("unsupported-reference-position");
        target = found;
      }
      return {
        resolved,
        target,
        dynamic:
          resolved.fragmentKind === "plain-name" &&
          Object.hasOwn(resource.dynamicAnchors, resolved.fragment),
      };
    } catch (error) {
      if (error instanceof SchemaGraphError)
        throw new SchemaGraphError(
          error.code,
          error.node ?? (typeof location === "number" ? location : undefined),
          error.descriptor ?? (typeof location === "string" ? location : undefined),
        );
      throw error;
    }
  };
  for (const ref of unresolved) {
    const node = nodes[ref.node] as SchemaNode;
    const r = resolve((resources[node.resource] as SchemaResource).canonicalUri, ref.raw, ref.node);
    const dynamic = ref.keyword === "$dynamicRef" && r.dynamic;
    references.push(
      Object.freeze({
        ...ref,
        resolvedUri: r.resolved.uri,
        target: r.target,
        fragmentKind: r.resolved.fragmentKind,
        kind: dynamic ? "dynamic-anchor" : "static",
        ...(dynamic ? { anchor: r.resolved.fragment } : {}),
      }),
    );
  }
  const descriptorRoots = [];
  for (const d of artifact.descriptors)
    if (d.propertiesSchema !== undefined) {
      b.charge("descriptorRoots");
      const r = resolve(d.id, d.propertiesSchema, d.id);
      descriptorRoots.push(
        Object.freeze({
          descriptor: d.id,
          originalUri: d.propertiesSchema,
          resolvedUri: r.resolved.uri,
          node: r.target,
          resource: (nodes[r.target] as SchemaNode).resource,
        }),
      );
    }
  for (const r of resources) {
    Object.freeze(r.anchors);
    Object.freeze(r.dynamicAnchors);
    Object.freeze(r);
  }
  const identity = createHash("sha256")
    .update(`${SCHEMA_GRAPH_POLICY}\0${artifact.sha256}\0${BUILTIN_SCHEMA_DIGEST}`)
    .digest("hex");
  return Object.freeze({
    stage: SCHEMA_GRAPH_POLICY,
    artifactDigest: artifact.sha256,
    builtinDigest: BUILTIN_SCHEMA_DIGEST,
    identity,
    pointers: Object.freeze(pointers),
    nodes: Object.freeze(nodes),
    resources: Object.freeze(resources),
    children: Object.freeze(children),
    references: Object.freeze(references),
    descriptorRoots: Object.freeze(descriptorRoots),
    receipt: Object.freeze({
      policy: SCHEMA_GRAPH_POLICY,
      limits: b.limits,
      counters: Object.freeze({ ...b.counts }),
      deferred,
    }),
  });
}
