/** Private static acyclic subset, not an installed Type/receiver or full dialect.
 * Compilation and each invocation own independent budgets. No user callback,
 * code generation, schema-pattern RegExp, fetch, registry or production wiring. */
import { isProxy } from "node:util/types";
import { JsonNumberLiteral, type LosslessJsonValue } from "@bdp/protocol";
import {
  type ContractArtifactBundleInput,
  ContractArtifactError,
  ContractArtifactLocalError,
} from "./installed-contract-artifact.js";
import { BUILTIN_SCHEMA_DOCUMENTS } from "./installed-schema-builtins.js";
import {
  buildInstalledSchemaGraph,
  formatSchemaPointer,
  type SchemaGraphCandidate,
  type SchemaNode,
} from "./installed-schema-graph.js";
import { type SchemaGraphLimits, SchemaGraphError } from "./installed-schema-shape.js";
import {
  compareDecimal,
  isInteger,
  multipleOf,
  DecimalLimitError,
  decimal,
} from "./installed-schema-decimal.js";
import {
  EvaluationBudget,
  EvaluationMemo,
  EvaluationRefusal,
  type EvaluatorLimits,
  type Instance,
  instanceIndex,
  objectValue,
  equalValue,
  numberValue,
  pointer,
} from "./installed-schema-value.js";
export { EVALUATOR_CEILINGS, type EvaluatorLimits } from "./installed-schema-value.js";
const stage = "private-static-schema-evaluation-1";
const deferred = Object.freeze([
  "full-vocabulary",
  "dynamic",
  "contains",
  "unevaluated",
  "regex",
  "mime",
  "production-work-and-heap",
  "root-openness",
  "receiver",
  "registry",
  "ownership",
]);
type Entry =
  | { readonly kind: "descriptor"; readonly typeId: string }
  | { readonly kind: "schema"; readonly retrievalUri: string };
interface Compilation {
  readonly bundle: ContractArtifactBundleInput;
  readonly graphLimits: SchemaGraphLimits;
  readonly entry: Entry;
  readonly limits: EvaluatorLimits;
}
interface Diagnostic {
  readonly schemaLocation: string;
  readonly instanceLocation: string;
  readonly message: string;
}
interface Annotation {
  readonly keyword: string;
  readonly value: LosslessJsonValue;
  readonly schemaLocation: string;
  readonly instanceLocation: string;
  readonly validationPath: string;
}
export type EvaluationOutcome =
  | {
      readonly kind: "evaluated";
      readonly stage: typeof stage;
      readonly valid: boolean;
      readonly diagnostics: readonly Diagnostic[];
      readonly diagnosticsComplete: boolean;
      readonly annotations: readonly Annotation[];
      readonly counters: EvaluatorLimits;
      readonly deferred: typeof deferred;
    }
  | {
      readonly kind: "refused";
      readonly stage: typeof stage;
      readonly phase: "compile" | "instance";
      readonly reason: string;
    };
export type CompilationOutcome =
  | {
      readonly kind: "compiled";
      readonly stage: typeof stage;
      readonly deferred: typeof deferred;
      readonly evaluateUtf8: (input: Uint8Array) => EvaluationOutcome;
    }
  | Extract<EvaluationOutcome, { kind: "refused" }>;
function data(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    throw new EvaluationRefusal("input-shape");
  const fields = Object.getOwnPropertyDescriptors(value),
    out: Record<string, unknown> = Object.create(null);
  if (Reflect.ownKeys(fields).length !== keys.length) throw new EvaluationRefusal("input-shape");
  for (const k of keys) {
    const f = fields[k];
    if (!f || !Object.hasOwn(f, "value")) throw new EvaluationRefusal("input-shape");
    out[k] = f.value;
  }
  return out;
}
function refusal(
  error: unknown,
  phase: "compile" | "instance",
): Extract<EvaluationOutcome, { kind: "refused" }> {
  const reason =
    error instanceof EvaluationRefusal
      ? error.code
      : error instanceof DecimalLimitError
        ? "limit-coefficientDigits"
        : error instanceof SchemaGraphError
          ? `graph:${error.code}`
          : error instanceof ContractArtifactError
            ? `artifact:${error.code}`
            : error instanceof ContractArtifactLocalError
              ? "local-failure"
              : "local-failure";
  return Object.freeze({ kind: "refused", stage, phase, reason });
}
const excluded = new Set([
  "pattern",
  "patternProperties",
  "contains",
  "minContains",
  "maxContains",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contentMediaType",
]);
const reserved = new Set(["$defs", "definitions", "contentSchema"]);
export function compilePrivateSchemaEvaluator(input: Compilation): CompilationOutcome {
  try {
    const fields = data(input, ["bundle", "graphLimits", "entry", "limits"]);
    const budget = new EvaluationBudget(fields.limits as EvaluatorLimits);
    // Select the entry via data descriptors, without invoking a supplied getter.
    const raw = fields.entry;
    if (!raw || typeof raw !== "object" || isProxy(raw)) throw new EvaluationRefusal("entry");
    const kind = Object.getOwnPropertyDescriptor(raw, "kind")?.value;
    const entry = data(raw, kind === "descriptor" ? ["kind", "typeId"] : ["kind", "retrievalUri"]);
    if (kind !== "descriptor" && kind !== "schema") throw new EvaluationRefusal("entry");
    const identifier = kind === "descriptor" ? entry.typeId : entry.retrievalUri;
    if (typeof identifier !== "string") throw new EvaluationRefusal("entry");
    const graph = buildInstalledSchemaGraph(
      fields.bundle as ContractArtifactBundleInput,
      fields.graphLimits as SchemaGraphLimits,
    );
    budget.work(graph.descriptorRoots.length + graph.resources.length);
    const root =
      kind === "descriptor"
        ? graph.descriptorRoots.find((r) => r.descriptor === identifier)?.node
        : graph.resources.find((r) => r.retrievalAlias === identifier)?.node;
    if (root === undefined) throw new EvaluationRefusal("entry");
    const children = new Map<number, (typeof graph.children)[number][]>(),
      refs = new Map<number, (typeof graph.references)[number][]>();
    for (const edge of graph.children) {
      budget.work();
      budget.charge("logicalBytes", 64);
      const list = children.get(edge.node) ?? [];
      list.push(edge);
      children.set(edge.node, list);
    }
    for (const edge of graph.references) {
      budget.work();
      budget.charge("logicalBytes", 64);
      const list = refs.get(edge.node) ?? [];
      list.push(edge);
      refs.set(edge.node, list);
    }
    for (const node of graph.nodes) {
      budget.work(9 + node.keywords.length);
      const resource = graph.resources[node.resource];
      // String-semantic qualification includes unused supplied schema declarations.
      if (BUILTIN_SCHEMA_DOCUMENTS.some((builtin) => builtin.uri === resource?.artifact)) continue;
      for (const k of node.keywords)
        if (k.name === "pattern" || k.name === "patternProperties" || k.name === "contentMediaType")
          throw new EvaluationRefusal(`unsupported-${k.name}`);
    }
    const colors = new Map<number, number>();
    budget.bound("frames", 1);
    const pending: { id: number; exit: boolean }[] = [{ id: root, exit: false }];
    while (pending.length) {
      budget.bound("frames", pending.length);
      const frame = pending.pop();
      if (!frame) throw new Error("compile frame");
      budget.work();
      if (frame.exit) {
        colors.set(frame.id, 2);
        continue;
      }
      const color = colors.get(frame.id);
      if (color === 1) throw new EvaluationRefusal("nonqualified-cycle");
      if (color === 2) continue;
      const node = graph.nodes[frame.id];
      if (!node) throw new Error("compile node");
      budget.charge("states");
      budget.charge("logicalBytes", 64);
      colors.set(frame.id, 1);
      budget.bound("frames", pending.length + 1);
      pending.push({ id: frame.id, exit: true });
      for (const k of node.keywords)
        if (excluded.has(k.name)) throw new EvaluationRefusal(`unsupported-${k.name}`);
      for (const edge of refs.get(frame.id) ?? []) {
        if (edge.kind === "dynamic-anchor") throw new EvaluationRefusal("unsupported-dynamic");
        budget.bound("frames", pending.length + 1);
        pending.push({ id: edge.target, exit: false });
      }
      for (const edge of children.get(frame.id) ?? [])
        if (!reserved.has(edge.keyword)) {
          budget.bound("frames", pending.length + 1);
          pending.push({ id: edge.target, exit: false });
        }
    }
    const limits = budget.limits;
    return Object.freeze({
      kind: "compiled",
      stage,
      deferred,
      evaluateUtf8: (bytes: Uint8Array) => {
        try {
          return evaluate(graph, root, children, refs, bytes, new EvaluationBudget(limits));
        } catch (error) {
          return refusal(error, "instance");
        }
      },
    });
  } catch (error) {
    return refusal(error, "compile");
  }
}
interface Request {
  node: number;
  instance: number;
  path: string;
}
interface Child {
  fact: Fact;
  path: string;
}
interface Fact {
  node: number;
  instance: number;
  valid: boolean;
  local: string[];
  failures: Child[];
  successes: Child[];
  annotations: { keyword: string; value: LosslessJsonValue }[];
}
function evaluate(
  graph: SchemaGraphCandidate,
  root: number,
  children: Map<number, (typeof graph.children)[number][]>,
  refs: Map<number, (typeof graph.references)[number][]>,
  bytes: Uint8Array,
  b: EvaluationBudget,
): Extract<EvaluationOutcome, { kind: "evaluated" }> {
  const instances = instanceIndex(bytes, b);
  const memo = new EvaluationMemo<Fact>(b);
  // All mutable state, including IDs and memoized facts, belongs to this invocation.
  function* run(nodeId: number, instanceId: number): Generator<Request, Fact, Fact> {
    const node = graph.nodes[nodeId] as SchemaNode,
      current = instances[instanceId] as Instance,
      v = current.value;
    const fact: Fact = {
      node: nodeId,
      instance: instanceId,
      valid: true,
      local: [],
      failures: [],
      successes: [],
      annotations: [],
    };
    b.charge("logicalBytes", 96);
    const fail = (keyword: string): void => {
      fact.valid = false;
      b.charge("logicalBytes", 16);
      fact.local.push(keyword);
    };
    const annotate = (keyword: string, value: LosslessJsonValue): void => {
      b.charge("logicalBytes", 32);
      fact.annotations.push({ keyword, value });
    };
    const take = (child: Fact, path: string): void => {
      b.charge("logicalBytes", 32 + 2 * path.length);
      if (child.valid) fact.successes.push({ fact: child, path });
      else {
        fact.valid = false;
        fact.failures.push({ fact: child, path });
      }
    };
    if (typeof node.value === "boolean") {
      if (!node.value) fail("");
      return fact;
    }
    const obj = node.value as Record<string, LosslessJsonValue>;
    const edges = children.get(nodeId) ?? [];
    const targets = (key: string) =>
      edges.filter((e) => {
        b.work();
        return e.keyword === key;
      });
    const target = (key: string, member?: string) =>
      targets(key).find((e) => e.member === member)?.target;
    for (const ref of refs.get(nodeId) ?? [])
      take(yield { node: ref.target, instance: instanceId, path: ref.keyword }, ref.keyword);
    for (const k of node.keywords) {
      b.work();
      const name = k.name,
        x = k.value;
      if (name === "type") {
        const types = typeof x === "string" ? [x] : (x as readonly string[]);
        const actual =
          v instanceof JsonNumberLiteral
            ? "number"
            : v === null
              ? "null"
              : Array.isArray(v)
                ? "array"
                : typeof v;
        if (
          !types.some(
            (t) =>
              t === actual ||
              (t === "integer" &&
                v instanceof JsonNumberLiteral &&
                isInteger(numberValue(v, b), b.work)),
          )
        )
          fail(name);
      } else if (name === "const") {
        if (!equalValue(v, x, b)) fail(name);
      } else if (name === "enum") {
        let match = false;
        for (const choice of x as readonly LosslessJsonValue[])
          if (equalValue(v, choice, b)) {
            match = true;
            break;
          }
        if (!match) fail(name);
      } else if (
        ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"].includes(
          name,
        ) &&
        v instanceof JsonNumberLiteral
      ) {
        const a = numberValue(v, b),
          z = numberValue(x as JsonNumberLiteral, b),
          cmp = compareDecimal(a, z, b.work);
        if (
          name === "multipleOf"
            ? !multipleOf(a, z, b.work)
            : name === "minimum"
              ? cmp < 0
              : name === "maximum"
                ? cmp > 0
                : name === "exclusiveMinimum"
                  ? cmp <= 0
                  : cmp >= 0
        )
          fail(name);
      } else if (
        [
          "minLength",
          "maxLength",
          "minItems",
          "maxItems",
          "minProperties",
          "maxProperties",
        ].includes(name)
      ) {
        let count: number | undefined;
        if (name.endsWith("Length") && typeof v === "string") {
          count = 0;
          for (const _ of v) {
            b.work();
            count++;
          }
        } else if (name.endsWith("Items") && Array.isArray(v)) count = v.length;
        else if (name.endsWith("Properties") && objectValue(v)) count = current.children.size;
        if (count !== undefined) {
          const cmp = compareDecimal(
            decimal(String(count), b.work, b.limits.coefficientDigits),
            numberValue(x as JsonNumberLiteral, b),
            b.work,
          );
          if (name.startsWith("min") ? cmp < 0 : cmp > 0) fail(name);
        }
      } else if (name === "required" && objectValue(v)) {
        for (const key of x as readonly string[]) {
          b.work(key.length + 1);
          if (!Object.hasOwn(v, key)) {
            fail(name);
            break;
          }
        }
      } else if (name === "dependentRequired" && objectValue(v)) {
        let missing = false;
        for (const [key, names] of Object.entries(x as Record<string, readonly string[]>)) {
          b.work(key.length + 1);
          if (Object.hasOwn(v, key))
            for (const required of names) {
              b.work(required.length + 1);
              if (!Object.hasOwn(v, required)) {
                missing = true;
                break;
              }
            }
        }
        // The generic diagnostic identifies this keyword/instance, not each dependency.
        if (missing) fail(name);
      } else if (name === "uniqueItems" && x === true && Array.isArray(v)) {
        let duplicate = false;
        for (let i = 0; i < v.length && !duplicate; i++)
          for (let j = 0; j < i; j++)
            if (equalValue(v[i] as LosslessJsonValue, v[j] as LosslessJsonValue, b)) {
              duplicate = true;
              break;
            }
        if (duplicate) fail(name);
      }
    }
    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      const branch = targets(keyword);
      if (!branch.length) continue;
      const evaluated: Child[] = [];
      for (const edge of branch) {
        const path = `${keyword}/${edge.member}`;
        const child = yield { node: edge.target, instance: instanceId, path };
        b.charge("logicalBytes", 32 + 2 * path.length);
        evaluated.push({ fact: child, path });
      }
      const good = evaluated.filter((x) => x.fact.valid);
      if (keyword === "allOf") {
        for (const x of evaluated) take(x.fact, x.path);
      } else if (keyword === "anyOf" ? good.length > 0 : good.length === 1) {
        for (const x of good) {
          b.charge("logicalBytes", 32);
          fact.successes.push(x);
        }
      } else {
        fail(keyword);
        for (const x of evaluated)
          if (!x.fact.valid) {
            b.charge("logicalBytes", 32);
            fact.failures.push(x);
          }
      }
    }
    const not = target("not");
    if (not !== undefined) {
      const result = yield { node: not, instance: instanceId, path: "not" };
      if (result.valid) fail("not");
    }
    const condition = target("if");
    if (condition !== undefined) {
      const result = yield { node: condition, instance: instanceId, path: "if" };
      if (result.valid) {
        b.charge("logicalBytes", 32);
        fact.successes.push({ fact: result, path: "if" });
      }
      const key = result.valid ? "then" : "else",
        selected = target(key);
      if (selected !== undefined)
        take(yield { node: selected, instance: instanceId, path: key }, key);
    }
    if (objectValue(v)) {
      for (const e of targets("dependentSchemas"))
        if (Object.hasOwn(v, e.member as string)) {
          const path = `dependentSchemas/${escapePointer(e.member as string)}`;
          take(yield { node: e.target, instance: instanceId, path }, path);
        }
      const properties = targets("properties"),
        names: string[] = [];
      for (const e of properties) {
        const id = current.children.get(e.member as string);
        if (id !== undefined) {
          names.push(e.member as string);
          const path = `properties/${escapePointer(e.member as string)}`;
          take(yield { node: e.target, instance: id, path }, path);
        }
      }
      if (Object.hasOwn(obj, "properties")) {
        b.charge("logicalBytes", 16 * names.length);
        annotate("properties", Object.freeze(names));
      }
      const extra = target("additionalProperties");
      if (extra !== undefined) {
        const applied: string[] = [];
        const known = new Set(properties.map((e) => e.member));
        b.work(properties.length);
        for (const [key, id] of current.children) {
          b.work(key.length + 1);
          if (!known.has(key)) {
            applied.push(key);
            take(
              yield { node: extra, instance: id, path: "additionalProperties" },
              "additionalProperties",
            );
          }
        }
        b.charge("logicalBytes", 16 * applied.length);
        annotate("additionalProperties", Object.freeze(applied));
      }
      const propertyNames = target("propertyNames");
      if (propertyNames !== undefined)
        for (const key of current.children.keys()) {
          b.charge("valueNodes");
          b.charge("logicalBytes", 64 + 2 * key.length);
          const id = instances.length;
          instances.push({
            value: key,
            parent: null,
            segment: "",
            children: new Map(),
            actual: instanceId,
          });
          take(yield { node: propertyNames, instance: id, path: "propertyNames" }, "propertyNames");
        }
    }
    if (Array.isArray(v)) {
      const prefix = targets("prefixItems");
      let used = 0;
      for (const e of prefix) {
        const id = current.children.get(e.member as string);
        if (id !== undefined) {
          used++;
          const path = `prefixItems/${e.member}`;
          take(yield { node: e.target, instance: id, path }, path);
        }
      }
      if (used > 0) annotate("prefixItems", new JsonNumberLiteral(String(used - 1)));
      const items = target("items");
      if (items !== undefined) {
        let applied = false;
        for (let i = prefix.length; i < v.length; i++) {
          applied = true;
          take(
            yield {
              node: items,
              instance: current.children.get(String(i)) as number,
              path: "items",
            },
            "items",
          );
        }
        if (applied) annotate("items", true);
      }
    }
    for (const k of node.keywords) {
      b.work();
      if (
        [
          "title",
          "description",
          "default",
          "deprecated",
          "readOnly",
          "writeOnly",
          "examples",
          "format",
        ].includes(k.name)
      )
        annotate(k.name, k.value);
      else if (k.name === "contentEncoding" && typeof v === "string") annotate(k.name, k.value);
      else if (!knownKeyword(k.name)) annotate(k.name, k.value);
    }
    return fact;
  }
  const stack: { key: string; iterator: Generator<Request, Fact, Fact>; next?: Fact }[] = [];
  const push = (node: number, instance: number, key: string): void => {
    b.charge("states");
    b.charge("logicalBytes", 64);
    b.bound("frames", stack.length + 1);
    stack.push({ key, iterator: run(node, instance) });
  };
  push(root, 0, memo.key(root, 0));
  let result: Fact | undefined;
  while (stack.length) {
    b.work();
    const frame = stack[stack.length - 1];
    if (!frame) throw new Error("evaluation frame");
    const step = frame.iterator.next(frame.next as Fact);
    delete frame.next;
    if (step.done) {
      memo.set(frame.key, step.value);
      stack.pop();
      if (stack.length) (stack[stack.length - 1] as typeof frame).next = step.value;
      else result = step.value;
    } else {
      const key = memo.key(step.value.node, step.value.instance);
      const hit = memo.get(key);
      if (hit) frame.next = hit;
      else push(step.value.node, step.value.instance, key);
    }
  }
  if (!result) throw new Error("evaluation result");
  const diagnostics: Diagnostic[] = [],
    annotations: Annotation[] = [];
  let diagnosticsComplete = true;
  type Path = { parent: Path | null; segment: string; length: number };
  const appendPath = (parent: Path | null, segment: string): Path => {
    b.charge("logicalBytes", 32 + 2 * segment.length);
    return { parent, segment, length: (parent?.length ?? 0) + segment.length + 1 };
  };
  const renderPath = (path: Path): string => {
    b.work(path.length);
    b.charge("logicalBytes", 2 * path.length);
    const parts: string[] = [];
    let current: Path | null = path;
    while (current) {
      b.work();
      parts.push(current.segment);
      current = current.parent;
    }
    return `/${parts.reverse().join("/")}`;
  };
  b.bound("frames", 1);
  const pending: { fact: Fact; path: Path | null }[] = [{ fact: result, path: null }];
  while (pending.length) {
    b.bound("frames", pending.length);
    b.work();
    const occurrence = pending.pop();
    if (!occurrence) throw new Error("projection");
    const f = occurrence.fact;
    if (result.valid) {
      for (const a of f.annotations) {
        const schemaLocation = location(graph, f.node, a.keyword, b),
          instanceLocation = pointer(instances, f.instance, b);
        b.charge("logicalBytes", 64 + 2 * (schemaLocation.length + instanceLocation.length));
        annotations.push(
          Object.freeze({
            ...a,
            schemaLocation,
            instanceLocation,
            validationPath: renderPath(appendPath(occurrence.path, escapePointer(a.keyword))),
          }),
        );
      }
      for (let i = f.successes.length - 1; i >= 0; i--) {
        const child = f.successes[i] as Child;
        b.work(child.path.length);
        b.bound("frames", pending.length + 1);
        pending.push({ fact: child.fact, path: appendPath(occurrence.path, child.path) });
      }
    } else {
      for (const key of f.local) {
        const entry = Object.freeze({
          schemaLocation: location(graph, f.node, key, b),
          instanceLocation: pointer(instances, f.instance, b),
          message: key ? `Schema assertion failed: ${key}` : "Schema rejects every instance",
        });
        const size = Buffer.byteLength(JSON.stringify(entry)) + (diagnostics.length ? 1 : 2);
        b.work(size);
        if (
          diagnostics.length >= b.limits.diagnostics ||
          size > b.limits.diagnosticBytes - b.counts.diagnosticBytes
        ) {
          if (!diagnostics.length) throw new EvaluationRefusal("first-diagnostic-fit");
          diagnosticsComplete = false;
          pending.length = 0;
          break;
        }
        b.charge("diagnostics");
        b.charge("diagnosticBytes", size);
        b.charge("logicalBytes", size);
        diagnostics.push(entry);
      }
      if (!diagnosticsComplete) break;
      for (let i = f.failures.length - 1; i >= 0; i--) {
        const child = f.failures[i] as Child;
        b.charge("logicalBytes", 32);
        b.bound("frames", pending.length + 1);
        pending.push({ fact: child.fact, path: null });
      }
    }
  }
  return Object.freeze({
    kind: "evaluated",
    stage,
    valid: result.valid,
    diagnostics: Object.freeze(diagnostics),
    diagnosticsComplete,
    annotations: Object.freeze(annotations),
    counters: Object.freeze({ ...b.counts }),
    deferred,
  });
}
const escapePointer = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");
function location(
  graph: SchemaGraphCandidate,
  nodeId: number,
  keyword: string,
  b: EvaluationBudget,
): string {
  const node = graph.nodes[nodeId] as SchemaNode,
    resource = graph.resources[node.resource];
  if (!resource) throw new Error("resource");
  const ptr = keyword
    ? node.keywords.find((k) => k.name === keyword)?.pointer
    : node.documentPointer;
  if (ptr === undefined) throw new Error("keyword");
  const path = formatSchemaPointer(graph.pointers, ptr, node.resourceRootPointer, 16384);
  b.work(path.length + resource.canonicalUri.length);
  const value = `${resource.canonicalUri}#${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  if (Buffer.byteLength(value) > 16384) throw new EvaluationRefusal("schema-location");
  return value;
}
const known = new Set([
  "$id",
  "$schema",
  "$ref",
  "$dynamicRef",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
  "$defs",
  "definitions",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "properties",
  "additionalProperties",
  "propertyNames",
  "prefixItems",
  "items",
  "type",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "required",
  "dependentRequired",
  "uniqueItems",
  "contentSchema",
  "contentEncoding",
  "contentMediaType",
]);
function knownKeyword(name: string): boolean {
  return known.has(name) || excluded.has(name);
}
