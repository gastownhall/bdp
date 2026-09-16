import type {
  SchemaGraphCandidate,
  SchemaNode,
  SchemaReference,
} from "./installed-schema-graph.js";
import { type EvaluationBudget, EvaluationRefusal } from "./installed-schema-value.js";

type ChildEdge = SchemaGraphCandidate["children"][number];
type Edge = ChildEdge | SchemaReference;

/** Only these seven calls select strict JSON children. propertyNames creates a
 * terminal synthetic string but is conservatively retained; relation tags are
 * insufficient (patternProperties has no qualified runtime implementation). */
function classify(edge: Edge): "reserved" | "descent" | "retained" {
  switch (edge.keyword) {
    case "$defs":
    case "definitions":
    case "contentSchema":
      return "reserved";
    case "properties":
    case "additionalProperties":
    case "prefixItems":
    case "items":
    case "contains":
    case "unevaluatedProperties":
    case "unevaluatedItems":
      return "descent";
    default:
      return "retained";
  }
}

/** Private qualification of the exact immutable nodes later evaluated. R marks
 * on scheduling; D/K share classification and include every reachable node.
 * Same-instance edges form a DAG; other calls strictly decrease JSON height.
 * Thus no active memo pair repeats and completed fact links are also acyclic.
 * Repeated projection paths remain bounded by the existing occurrence budget.
 *
 * Logical model: three containers64 each, record+Map entry64, each pushed ID16
 * (no reclamation). Every Map operation, push/pop, node inspection, keyword,
 * edge inspection/classification, degree/count update and final comparison costs
 * one work. A retained D/K edge costs4; reserved/descent edges cost2. Returning
 * the primitive coverage flag creates no result container. */
export function qualifyStaticRecursion(
  nodes: readonly SchemaNode[],
  root: number,
  children: ReadonlyMap<number, readonly ChildEdge[]>,
  refs: ReadonlyMap<number, readonly SchemaReference[]>,
  budget: EvaluationBudget,
  registerPattern: (node: number, value: unknown) => void,
): boolean {
  budget.work();
  budget.charge("logicalBytes", 64);
  const records = new Map<number, { id: number; indegree: number }>();
  budget.work();
  budget.charge("logicalBytes", 64);
  const pending: number[] = [];
  budget.work();
  budget.charge("logicalBytes", 64);
  const ready: number[] = [];
  let collectLocations = false;

  function push(queue: number[], id: number): void {
    budget.work();
    budget.bound("frames", queue.length + 1);
    budget.charge("logicalBytes", 16);
    queue.push(id);
  }
  function schedule(id: number): void {
    budget.work();
    if (records.has(id)) return;
    budget.charge("states");
    budget.charge("logicalBytes", 64);
    budget.work();
    records.set(id, { id, indegree: 0 });
    push(pending, id);
  }
  function visitEdges(id: number, phase: "reach" | "degree" | "remove"): void {
    // Both adjacency retrievals are charged even when no list is present. Never
    // allocate fallback arrays or a second copied edge/vertex graph.
    budget.work();
    const references = refs.get(id);
    if (references)
      for (let i = 0; i < references.length; i++) {
        budget.work(2); // inspect + classify before reading the edge
        visit(references[i] as SchemaReference, phase);
      }
    budget.work();
    const descendants = children.get(id);
    if (descendants)
      for (let i = 0; i < descendants.length; i++) {
        budget.work(2);
        visit(descendants[i] as ChildEdge, phase);
      }
  }
  function visit(edge: Edge, phase: "reach" | "degree" | "remove"): void {
    const kind = classify(edge);
    if (kind === "reserved") return;
    if (phase === "reach") {
      if ("kind" in edge && edge.kind === "dynamic-anchor")
        throw new EvaluationRefusal("unsupported-dynamic");
      schedule(edge.target);
      return;
    }
    if (kind === "descent") return;
    budget.work();
    const target = records.get(edge.target);
    if (!target) throw new Error("recursion invariant: missing reachable target");
    budget.work();
    if (phase === "degree") target.indegree++;
    else {
      if (target.indegree <= 0) throw new Error("recursion invariant: nonpositive indegree");
      target.indegree--;
      if (target.indegree === 0) push(ready, target.id);
    }
  }

  schedule(root);
  while (pending.length) {
    budget.work();
    const id = pending.pop();
    if (id === undefined) throw new Error("recursion invariant: missing scheduled ID");
    budget.work();
    const node = nodes[id];
    if (!node || node.id !== id) throw new Error("recursion invariant: missing node");
    for (let i = 0; i < node.keywords.length; i++) {
      budget.work();
      const keyword = node.keywords[i]?.name;
      if (keyword === "patternProperties")
        throw new EvaluationRefusal("unsupported-patternProperties");
      if (keyword === "pattern") {
        if (!registerPattern) throw new Error("pattern invariant: registration owner");
        budget.work();
        registerPattern(node.id, node.keywords[i]?.value);
      }
      if (keyword === "unevaluatedItems" || keyword === "unevaluatedProperties")
        collectLocations = true;
    }
    visitEdges(id, "reach");
  }
  for (let i = 0; i < nodes.length; i++) {
    budget.work();
    const node = nodes[i];
    if (!node || node.id !== i) throw new Error("recursion invariant: missing indexed node");
    budget.work();
    if (records.has(node.id)) visitEdges(node.id, "degree");
  }
  for (let i = 0; i < nodes.length; i++) {
    budget.work();
    const node = nodes[i];
    if (!node || node.id !== i) throw new Error("recursion invariant: missing seed node");
    budget.work();
    const record = records.get(node.id);
    if (record?.indegree === 0) push(ready, record.id);
  }
  let processed = 0;
  while (ready.length) {
    budget.work();
    const id = ready.pop();
    if (id === undefined) throw new Error("recursion invariant: missing ready ID");
    budget.work();
    processed++;
    visitEdges(id, "remove");
  }
  budget.work();
  if (processed !== records.size) throw new EvaluationRefusal("nonqualified-cycle");
  return collectLocations;
}
