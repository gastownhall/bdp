import type {
  SchemaGraphCandidate,
  SchemaNode,
  SchemaReference,
} from "./installed-schema-graph.js";
import { type EvaluationBudget, EvaluationRefusal } from "./installed-schema-value.js";

type ChildEdge = SchemaGraphCandidate["children"][number];
type Edge = ChildEdge | SchemaReference;

/** Only these eight calls select strict JSON children. propertyNames creates a
 * terminal synthetic string but is conservatively retained. Explicit runtime
 * child selection, rather than relation tags alone, justifies descent. */
function classify(edge: Edge): "reserved" | "descent" | "retained" {
  switch (edge.keyword) {
    case "$defs":
    case "definitions":
    case "contentSchema":
      return "reserved";
    case "properties":
    case "patternProperties":
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
  registerPatternProperties: (node: number, value: unknown) => void,
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
      if (keyword === "patternProperties") {
        if (!registerPatternProperties)
          throw new Error("patternProperties invariant: registration owner");
        budget.work();
        registerPatternProperties(node.id, node.keywords[i]?.value);
      }
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

// Private identities are deliberately separate even though their representations
// are dense numbers. Facts/programs/locations always retain OriginalNodeId.
declare const identity: unique symbol;
type OriginalNodeId = number & { readonly [identity]: "original" };
type StateId = number & { readonly [identity]: "state" };
type ContextId = number & { readonly [identity]: "context" };
type NameId = number & { readonly [identity]: "name" };
interface DynamicState {
  readonly node: OriginalNodeId;
  readonly context: ContextId;
  indegree: number;
  readonly refs: Map<SchemaReference, StateId>;
  readonly children: Map<number, StateId>;
}
export interface DynamicQualification {
  readonly entry: number;
  readonly states: readonly DynamicState[];
  readonly collectLocations: boolean;
}

/** Compilation-owned first-binding specialization. Unlike the unchanged static
 * owner, these loops prepay guards including terminal checks. Only classification
 * is shared; their work macros are intentionally different. All declared names
 * participate, including unreferenced anchors: conservative extra states/charges
 * are an accepted private budget tradeoff. Maps remain private after return;
 * Object.freeze is not claimed to seal Map entries. */
export function qualifyDynamicRecursion(
  nodes: readonly SchemaNode[],
  resources: SchemaGraphCandidate["resources"],
  root: number,
  children: ReadonlyMap<number, readonly ChildEdge[]>,
  refs: ReadonlyMap<number, readonly SchemaReference[]>,
  budget: EvaluationBudget,
  registerPattern: (node: number, value: unknown) => void,
  registerPatternProperties: (node: number, value: unknown) => void,
): DynamicQualification {
  budget.work(7);
  budget.charge("logicalBytes", 7 * 64);
  const names = new Map<string, NameId>();
  const ordered: string[] = [];
  const vectors: (readonly number[])[] = [];
  const contexts: { id: ContextId; vector: readonly number[] }[] = [];
  const states: DynamicState[] = [];
  const pending: StateId[] = [];
  const ready: StateId[] = [];
  for (let i = 0; i < nodes.length; i++) {
    budget.work(3);
    const node = nodes[i];
    if (!node || node.id !== i) throw new Error("dynamic invariant: original node");
    budget.work(2 * node.keywords.length);
    for (const keyword of node.keywords) {
      if (keyword.name !== "$dynamicAnchor") continue;
      const name = keyword.value;
      if (typeof name !== "string") throw new Error("dynamic invariant: anchor name");
      budget.work(name.length + 2);
      if (names.get(name) !== undefined) continue;
      budget.work(name.length + 2);
      budget.charge("logicalBytes", 48);
      names.set(name, ordered.length as NameId);
      ordered.push(name);
    }
  }
  budget.work(1);
  budget.work(ordered.length + 1);
  Object.freeze(ordered);
  const width = ordered.length;
  for (const resource of resources) {
    budget.work(6 + width);
    budget.charge("logicalBytes", 80 + 16 * width);
    const vector: number[] = [];
    for (const name of ordered) {
      budget.work(name.length + 5);
      vector.push(
        Object.hasOwn(resource.dynamicAnchors, name)
          ? (resource.dynamicAnchors[name] as number)
          : -1,
      );
    }
    vectors.push(Object.freeze(vector));
  }
  budget.work(1);
  budget.work(4 + 2 * width);
  budget.charge("logicalBytes", 144 + 16 * width);
  contexts.push({ id: 0 as ContextId, vector: Object.freeze(Array<number>(width).fill(-1)) });

  function enter(parent: ContextId, resource: number): ContextId {
    const previous = contexts[parent]?.vector,
      supplied = vectors[resource];
    if (!previous || !supplied) throw new Error("dynamic invariant: resource context");
    budget.work(1);
    budget.charge("logicalBytes", 64 + 16 * width);
    const candidate: number[] = [];
    budget.work(4 * width + 1);
    for (let i = 0; i < width; i++) {
      const prior = previous[i] as number;
      candidate.push(prior >= 0 ? prior : (supplied[i] as number));
    }
    budget.work(contexts.length * (2 + 2 * width) + 1);
    let found: ContextId | undefined;
    for (const context of contexts) {
      let same = true;
      for (let i = 0; i < width; i++) {
        // Do not short-circuit cell comparisons after a mismatch.
        const equal = context.vector[i] === candidate[i];
        same = equal && same;
      }
      if (same) {
        if (found !== undefined) throw new Error("dynamic invariant: duplicate context");
        found = context.id;
      }
    }
    if (found !== undefined) return found;
    budget.work(width + 1);
    Object.freeze(candidate);
    budget.work(2);
    budget.charge("logicalBytes", 80);
    const id = contexts.length as ContextId;
    contexts.push({ id, vector: candidate });
    return id;
  }
  function schedule(node: number, context: ContextId): StateId {
    budget.work(2 * states.length + 1);
    let found: StateId | undefined;
    for (let i = 0; i < states.length; i++) {
      const state = states[i] as DynamicState;
      const sameNode = state.node === node,
        sameContext = state.context === context;
      if (sameNode && sameContext) {
        if (found !== undefined) throw new Error("dynamic invariant: duplicate state");
        found = i as StateId;
      }
    }
    if (found !== undefined) return found;
    budget.charge("states");
    budget.charge("logicalBytes", 224);
    budget.bound("frames", pending.length + 1);
    budget.work(4);
    const id = states.length as StateId;
    states.push({
      node: node as OriginalNodeId,
      context,
      indegree: 0,
      refs: new Map(),
      children: new Map(),
    });
    pending.push(id);
    return id;
  }
  budget.work(2);
  const entryNode = nodes[root];
  if (!entryNode) throw new Error("dynamic invariant: entry");
  const entry = schedule(root, enter(0 as ContextId, entryNode.resource));
  let collectLocations = false;
  for (;;) {
    budget.work();
    if (!pending.length) break;
    budget.work(2);
    const id = pending.pop() as StateId,
      state = states[id] as DynamicState;
    const node = nodes[state.node];
    if (!node || node.id !== state.node) throw new Error("dynamic invariant: scheduled node");
    budget.work(2 * node.keywords.length + 1);
    for (const keyword of node.keywords) {
      if (keyword.name === "pattern") {
        budget.work();
        registerPattern(node.id, keyword.value);
      }
      if (keyword.name === "patternProperties") {
        budget.work();
        registerPatternProperties(node.id, keyword.value);
      }
      if (keyword.name === "unevaluatedItems" || keyword.name === "unevaluatedProperties")
        collectLocations = true;
    }
    budget.work(2);
    const references = refs.get(node.id),
      descendants = children.get(node.id);
    function visit(edge: Edge): void {
      budget.work(3);
      if (classify(edge) === "reserved") return;
      let target: number;
      if ("kind" in edge && edge.kind === "dynamic-anchor") {
        const name = edge.anchor;
        if (name === undefined) throw new Error("dynamic invariant: reference name");
        budget.work(name.length + 4);
        const key = names.get(name);
        if (key === undefined) throw new Error("dynamic invariant: missing name");
        const binding = contexts[state.context]?.vector[key];
        if (binding === undefined) throw new Error("dynamic invariant: missing binding");
        target = binding >= 0 ? binding : edge.target;
      } else {
        budget.work();
        target = edge.target;
      }
      budget.work(2);
      const selected = nodes[target];
      if (!selected) throw new Error("dynamic invariant: selected node");
      const next = schedule(target, enter(state.context, selected.resource));
      budget.work();
      budget.charge("logicalBytes", 32);
      if ("kind" in edge) state.refs.set(edge, next);
      else {
        const prior = state.children.get(edge.target);
        if (prior !== undefined && prior !== next)
          throw new Error("dynamic invariant: child identity");
        state.children.set(edge.target, next);
      }
    }
    if (references) for (const edge of references) visit(edge);
    budget.work();
    if (descendants) for (const edge of descendants) visit(edge);
    budget.work();
  }
  function edges(state: DynamicState, remove: boolean): void {
    function visit(edge: Edge): void {
      budget.work(3);
      if (classify(edge) !== "retained") return;
      budget.work(3);
      const id = "kind" in edge ? state.refs.get(edge) : state.children.get(edge.target);
      const target = id === undefined ? undefined : states[id];
      if (!target) throw new Error("dynamic invariant: retained target");
      if (!remove) target.indegree++;
      else {
        if (target.indegree <= 0) throw new Error("dynamic invariant: nonpositive degree");
        target.indegree--;
        if (target.indegree === 0) pushReady(id as StateId);
      }
    }
    const references = refs.get(state.node),
      descendants = children.get(state.node);
    if (references) for (const edge of references) visit(edge);
    if (descendants) for (const edge of descendants) visit(edge);
  }
  function pushReady(id: StateId): void {
    budget.work();
    budget.charge("logicalBytes", 16);
    budget.bound("frames", ready.length + 1);
    ready.push(id);
  }
  for (const state of states) {
    budget.work(6);
    edges(state, false);
  }
  budget.work();
  for (let i = 0; i < states.length; i++) {
    budget.work(3);
    if ((states[i] as DynamicState).indegree === 0) pushReady(i as StateId);
  }
  budget.work();
  let processed = 0;
  while (ready.length) {
    budget.work(7);
    const id = ready.pop() as StateId;
    processed++;
    edges(states[id] as DynamicState, true);
  }
  budget.work();
  budget.work();
  if (processed !== states.length) throw new EvaluationRefusal("nonqualified-cycle");
  budget.work(2 * states.length + 2);
  budget.charge("logicalBytes", 64);
  for (const state of states) Object.freeze(state);
  Object.freeze(states);
  return Object.freeze({ entry, states, collectLocations });
}
