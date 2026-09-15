import { createHash } from "node:crypto";
import type { SchemaGraphCandidate } from "../src/installed-schema-graph.js";

/** Implementation-derived structural regression lock, never an independent
 * JSON Schema validity oracle. Raw input bytes and official outcomes are pinned
 * separately. Exclude policy/identity/counters so their administrative changes
 * do not disguise a change to indexed nodes, positions or reference targets.
 * Retained node and keyword values are also excluded: these locks do not prove
 * corpus-wide losslessness or correctness of indexed values. */
export function schemaGraphStructure(graph: SchemaGraphCandidate) {
  const structure = {
    pointers: graph.pointers,
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      resource: n.resource,
      documentPointer: n.documentPointer,
      resourceRootPointer: n.resourceRootPointer,
      keywords: n.keywords.map((k) => ({ name: k.name, pointer: k.pointer })),
    })),
    resources: graph.resources,
    children: graph.children,
    references: graph.references,
    descriptorRoots: graph.descriptorRoots,
  };
  return {
    nodes: graph.nodes.length,
    pointers: graph.pointers.length,
    resources: graph.resources.length,
    references: graph.references.length,
    childEdges: graph.children.length,
    anchors: graph.resources.reduce((n, r) => n + Object.keys(r.anchors).length, 0),
    dynamicAnchors: graph.resources.reduce((n, r) => n + Object.keys(r.dynamicAnchors).length, 0),
    sha256: createHash("sha256").update(JSON.stringify(structure)).digest("hex"),
  };
}
