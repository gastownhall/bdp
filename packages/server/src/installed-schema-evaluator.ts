/** Private guarded schema subset, not an installed Type/receiver or full dialect.
 * Compilation and each invocation own independent budgets. No user callback,
 * code generation, schema-pattern RegExp, fetch, registry or production wiring. */
import {
  compilePattern,
  matchPattern,
  PATTERN_POLICY,
  type PatternProgram,
} from "./installed-schema-pattern.js";
import {
  qualifyStaticRecursion,
  qualifyDynamicRecursion,
  type DynamicQualification,
} from "./installed-schema-recursion.js";
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
  type SchemaReference,
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
  EvaluationLocations,
  EvaluationRefusal,
  type EvaluatorLimits,
  type Instance,
  instanceIndex,
  objectValue,
  equalValue,
  numberValue,
  pointer,
  chargeAnnotationBytes,
} from "./installed-schema-value.js";
export { EVALUATOR_CEILINGS, type EvaluatorLimits } from "./installed-schema-value.js";
const stage = "private-schema-evaluation-5";
// Private administrative output policy revision; no new BDP validity rule.
const annotationPolicy = Object.freeze({
  revision: "bounded-annotation-output-2",
  format: "annotation-only",
  contentEncoding: "annotation-only-no-decoding",
  contentRevision: "annotation-only-content-1",
  contentMediaType: "annotation-only-no-media-type-parsing",
  contentSchema: "annotation-only-with-adjacent-media-type-no-validation",
  output: "complete-or-refused",
  encodedBytes: "JSON.stringify-UTF8-lossless-number-objects",
  order: "graph-edge-occurrence-order",
} as const);
// Admitting static unevaluated keywords intentionally removes that broad deferred
// label from every outcome. Annotation representation/order remains revision 2.
const deferred = Object.freeze([
  "full-vocabulary",
  "regex",
  // Media/content processing remains deferred; declared annotation values are retained.
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
/** Pattern scratch alone costs 256 + 64*S logical bytes per actual match.
 * At the 16,777,216 ceiling, S=2/10/100/765/4096 permits at most
 * 43690/18724/2520/340/63 completed calls. These are upper bounds only:
 * other logical allocations and work limits can refuse earlier. This is
 * cumulative allocation accounting, not peak heap or a success guarantee. */
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
      readonly annotationPolicy: typeof annotationPolicy;
      // limit-patternUnits/limit-patternStates are fixed policy ceilings, not
      // caller-settable EvaluatorLimits keys. Scratch is charged cumulatively.
      readonly patternPolicy: typeof PATTERN_POLICY;
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
      readonly annotationPolicy: typeof annotationPolicy;
      // Fixed patternUnits/patternStates limits are not EvaluatorLimits keys.
      // Admission qualifies all supplied declarations, including unused ones;
      // immutable builtin patterns register only when reached.
      readonly patternPolicy: typeof PATTERN_POLICY;
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
interface PatternProperty {
  readonly member: string;
  readonly target: number;
  readonly program: PatternProgram;
}
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
    // All supplied programs are retained under the compile budget, including
    // unused declarations. Trusted builtin programs are registered only by R.
    let programs: Map<number, PatternProgram> | undefined;
    const registerPattern = (id: number, value: unknown): void => {
      budget.work(2);
      if (typeof value !== "string") throw new Error("pattern invariant: certified declaration");
      if (!programs) {
        budget.work();
        budget.charge("logicalBytes", 64);
        programs = new Map();
      }
      budget.work();
      if (programs.has(id)) return;
      const program = compilePattern(value, budget);
      budget.work();
      budget.charge("logicalBytes", 32);
      programs.set(id, program);
    };
    // Compile-owned, lazily allocated and never mutated after this compilation
    // returns. Frozen records/arrays are shared; each invocation owns its matches.
    // A readonly Map view is not a claim that Object.freeze seals Map entries.
    let propertyPrograms: Map<number, readonly PatternProperty[]> | undefined;
    const registerPatternProperties = (id: number, value: unknown): void => {
      budget.work(2); // R0: certified map and owning node
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        value instanceof JsonNumberLiteral ||
        graph.nodes[id]?.id !== id
      )
        throw new Error("patternProperties invariant: certified declaration");
      if (!propertyPrograms) {
        budget.work(); // R1
        budget.charge("logicalBytes", 64);
        propertyPrograms = new Map();
      }
      budget.work(); // R2: an empty registered array is also present
      if (propertyPrograms.get(id) !== undefined) return;
      budget.work(); // R3
      budget.charge("logicalBytes", 64);
      const records: PatternProperty[] = [];
      budget.work();
      const edges = children.get(id);
      let i = 0;
      for (;;) {
        budget.work(); // R4 includes the terminal inspection
        if (!edges || i === edges.length) break;
        budget.work(2);
        const edge = edges[i++];
        if (!edge || edge.keyword !== "patternProperties") continue;
        budget.work(3); // R5: member, indexed target, certified relation
        if (
          typeof edge.member !== "string" ||
          !Number.isSafeInteger(edge.target) ||
          graph.nodes[edge.target]?.id !== edge.target ||
          edge.relation !== "object-value"
        )
          throw new Error("patternProperties invariant: certified edge");
        const program = compilePattern(edge.member, budget);
        budget.work(3);
        budget.charge("logicalBytes", 80); // frozen record64 + retained slot16
        records.push(Object.freeze({ member: edge.member, target: edge.target, program }));
      }
      budget.work(records.length + 1); // R6
      Object.freeze(records);
      budget.work();
      budget.charge("logicalBytes", 32);
      propertyPrograms.set(id, records);
    };
    for (const node of graph.nodes) {
      budget.work(9 + node.keywords.length);
      const resource = graph.resources[node.resource];
      // String-semantic qualification includes unused supplied schema declarations.
      if (BUILTIN_SCHEMA_DOCUMENTS.some((builtin) => builtin.uri === resource?.artifact)) continue;
      for (const k of node.keywords)
        if (k.name === "patternProperties") {
          budget.work();
          registerPatternProperties(node.id, k.value);
        } else if (k.name === "pattern") {
          budget.work();
          registerPattern(node.id, k.value);
        }
    }
    let collectLocations: boolean;
    let specialization: DynamicQualification | undefined;
    try {
      collectLocations = qualifyStaticRecursion(
        graph.nodes,
        root,
        children,
        refs,
        budget,
        registerPattern,
        registerPatternProperties,
      );
    } catch (error) {
      if (!(error instanceof EvaluationRefusal) || error.code !== "unsupported-dynamic")
        throw error;
      specialization = qualifyDynamicRecursion(
        graph.nodes,
        graph.resources,
        root,
        children,
        refs,
        budget,
        registerPattern,
        registerPatternProperties,
      );
      collectLocations = specialization.collectLocations;
    }
    const limits = budget.limits;
    return Object.freeze({
      kind: "compiled",
      stage,
      deferred,
      annotationPolicy,
      patternPolicy: PATTERN_POLICY,
      evaluateUtf8: (bytes: Uint8Array) => {
        try {
          return evaluate(
            graph,
            root,
            children,
            refs,
            bytes,
            new EvaluationBudget(limits),
            collectLocations,
            programs,
            propertyPrograms,
            specialization,
          );
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
  locations?: EvaluationLocations;
}
function evaluate(
  graph: SchemaGraphCandidate,
  root: number,
  children: Map<number, (typeof graph.children)[number][]>,
  refs: Map<number, (typeof graph.references)[number][]>,
  bytes: Uint8Array,
  b: EvaluationBudget,
  collectLocations: boolean,
  programs: ReadonlyMap<number, PatternProgram> | undefined,
  propertyPrograms: ReadonlyMap<number, readonly PatternProperty[]> | undefined,
  specialization: DynamicQualification | undefined,
): Extract<EvaluationOutcome, { kind: "evaluated" }> {
  const instances = instanceIndex(bytes, b);
  const memo = new EvaluationMemo<Fact>(b);
  // All mutable state, including IDs and memoized facts, belongs to this invocation.
  function* run(evaluationId: number, instanceId: number): Generator<Request, Fact, Fact> {
    let nodeId = evaluationId;
    if (specialization) {
      b.work(2);
      const state = specialization.states[evaluationId];
      if (!state) throw new Error("dynamic invariant: runtime state");
      nodeId = state.node;
    }
    const transition = (target: number, reference?: SchemaReference): number => {
      if (!specialization) return target;
      b.work(2);
      const state = specialization.states[evaluationId];
      const selected = reference ? state?.refs.get(reference) : state?.children.get(target);
      if (selected === undefined) throw new Error("dynamic invariant: runtime transition");
      return selected;
    };
    const node = graph.nodes[nodeId] as SchemaNode,
      current = instances[instanceId] as Instance,
      v = current.value;
    const tracked = collectLocations && (objectValue(v) || Array.isArray(v));
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
    const locations = (): EvaluationLocations =>
      (fact.locations ??= EvaluationLocations.create(instanceId, Array.isArray(v), b));
    const candidates = <T>(): T[] => {
      b.charge("logicalBytes", 64);
      return [];
    };
    const stage = <T>(list: T[] | undefined, value: T): void => {
      if (list) {
        b.work();
        b.charge("logicalBytes", 16);
        list.push(value);
      }
    };
    const merge = (child: Fact): void => {
      if (tracked && child.valid && child.locations) locations().merge(child.locations);
    };
    const commit = (list: readonly number[] | undefined, valid: boolean): void => {
      if (list && valid)
        for (let i = 0; i < list.length; i++) {
          b.work();
          locations().mark(list[i] as number);
        }
    };
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
    for (const ref of refs.get(nodeId) ?? []) {
      const child = yield {
        node: transition(ref.target, ref),
        instance: instanceId,
        path: ref.keyword,
      };
      take(child, ref.keyword);
      merge(child);
    }
    for (const k of node.keywords) {
      b.work();
      const name = k.name,
        x = k.value;
      if (name === "pattern") {
        if (typeof v === "string") {
          b.work();
          const program = programs?.get(nodeId);
          if (!program) throw new Error("pattern invariant: compiled program");
          if (!matchPattern(program, v, b)) fail(name);
        }
      } else if (name === "type") {
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
        const child = yield { node: transition(edge.target), instance: instanceId, path };
        b.charge("logicalBytes", 32 + 2 * path.length);
        evaluated.push({ fact: child, path });
      }
      const good = evaluated.filter((x) => x.fact.valid);
      if (keyword === "allOf") {
        for (const x of evaluated) take(x.fact, x.path);
        if (tracked && good.length === evaluated.length)
          for (const x of evaluated) {
            b.work();
            merge(x.fact);
          }
      } else if (keyword === "anyOf" ? good.length > 0 : good.length === 1) {
        for (const x of good) {
          b.charge("logicalBytes", 32);
          fact.successes.push(x);
          merge(x.fact);
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
      const result = yield { node: transition(not), instance: instanceId, path: "not" };
      if (result.valid) fail("not");
    }
    const condition = target("if");
    if (condition !== undefined) {
      const result = yield { node: transition(condition), instance: instanceId, path: "if" };
      if (result.valid) {
        b.charge("logicalBytes", 32);
        fact.successes.push({ fact: result, path: "if" });
        merge(result);
      }
      const key = result.valid ? "then" : "else",
        selected = target(key);
      if (selected !== undefined) {
        const child = yield { node: transition(selected), instance: instanceId, path: key };
        take(child, key);
        merge(child);
      }
    }
    if (objectValue(v)) {
      const dependencies = tracked ? candidates<Fact>() : undefined;
      let dependenciesValid = true;
      for (const e of targets("dependentSchemas"))
        if (Object.hasOwn(v, e.member as string)) {
          const path = `dependentSchemas/${escapePointer(e.member as string)}`;
          const child = yield { node: transition(e.target), instance: instanceId, path };
          take(child, path);
          dependenciesValid = dependenciesValid && child.valid;
          stage(dependencies, child);
        }
      if (dependencies && dependenciesValid)
        for (let i = 0; i < dependencies.length; i++) {
          b.work();
          merge(dependencies[i] as Fact);
        }
      const properties = targets("properties"),
        names: string[] = [],
        propertyIds = tracked ? candidates<number>() : undefined;
      let propertiesValid = true;
      for (const e of properties) {
        const id = current.children.get(e.member as string);
        if (id !== undefined) {
          if (tracked) b.charge("logicalBytes", 16);
          names.push(e.member as string);
          const path = `properties/${escapePointer(e.member as string)}`;
          const child = yield { node: transition(e.target), instance: id, path };
          take(child, path);
          propertiesValid = propertiesValid && child.valid;
          stage(propertyIds, id);
        }
      }
      commit(propertyIds, propertiesValid);
      if (Object.hasOwn(obj, "properties")) {
        // Tracked name slots were charged before each push; freezing reuses the array.
        // The untracked path retains its original aggregate charge.
        if (!tracked) b.charge("logicalBytes", 16 * names.length);
        annotate("properties", Object.freeze(names));
      }
      // Absent PP retains the existing charged path exactly. Recognition is
      // independent of successful coverage: even a failing matched child is not
      // additional. Programs belong to compilation; these containers do not.
      let matchedProperties: Map<number, string> | undefined;
      if (Object.hasOwn(obj, "patternProperties")) {
        b.work(2); // T0
        const records = propertyPrograms?.get(nodeId);
        if (!records) throw new Error("patternProperties invariant: compiled records");
        b.work(); // T1
        b.charge("logicalBytes", 64);
        matchedProperties = new Map();
        b.work();
        b.charge("logicalBytes", 64);
        const matchedNames: string[] = [];
        b.work();
        let patternsValid = true;
        b.work(); // T2: reverse Object.keys(schema-map) graph order
        const recordIterator = records.values();
        for (;;) {
          b.work();
          const nextRecord = recordIterator.next();
          if (nextRecord.done) break;
          b.work();
          const record = nextRecord.value;
          b.work();
          const keyIterator = current.children.entries();
          for (;;) {
            b.work();
            const nextKey = keyIterator.next();
            if (nextKey.done) break;
            b.work();
            const [name, id] = nextKey.value;
            const yes = matchPattern(record.program, name, b);
            b.work();
            if (!yes) continue;
            b.work(); // T3: unique names, but every match evaluates its child
            const prior = matchedProperties.has(id);
            if (!prior) {
              b.work(2);
              b.charge("logicalBytes", 48);
              matchedProperties.set(id, name);
              matchedNames.push(name);
            }
            // T4 reserves both fixed pointer replacements and final path before
            // constructing them. Existing take/projection charges remain below.
            const n = record.member.length;
            b.work(18 + 6 * n);
            b.charge("logicalBytes", 36 + 12 * n);
            const path = `patternProperties/${escapePointer(record.member)}`;
            const child = yield { node: transition(record.target), instance: id, path };
            take(child, path);
            b.work(2); // T5: no short circuit after either success or failure
            if (!child.valid) patternsValid = false;
          }
        }
        if (tracked && patternsValid) {
          b.work(); // T6: commit only whole-keyword successful coverage
          const iterator = matchedProperties.keys();
          for (;;) {
            b.work();
            const next = iterator.next();
            if (next.done) break;
            b.work();
            locations().mark(next.value);
          }
        }
        b.work(matchedNames.length + 1); // T7
        annotate("patternProperties", Object.freeze(matchedNames));
      }
      const extra = target("additionalProperties");
      if (extra !== undefined) {
        const applied: string[] = [];
        const extraIds = tracked ? candidates<number>() : undefined;
        let extraValid = true;
        const known = new Set(properties.map((e) => e.member));
        b.work(properties.length);
        for (const [key, id] of current.children) {
          b.work(key.length + 1);
          if (!known.has(key)) {
            if (matchedProperties) {
              b.work(); // T8, only otherwise-undeclared names with PP present
              if (matchedProperties.has(id)) continue;
            }
            if (tracked) b.charge("logicalBytes", 16);
            applied.push(key);
            const child = yield {
              node: transition(extra),
              instance: id,
              path: "additionalProperties",
            };
            take(child, "additionalProperties");
            extraValid = extraValid && child.valid;
            stage(extraIds, id);
          }
        }
        // Reuse the tracked name slots already charged before push, with no copy.
        // The untracked path retains its original aggregate charge.
        if (!tracked) b.charge("logicalBytes", 16 * applied.length);
        annotate("additionalProperties", Object.freeze(applied));
        commit(extraIds, extraValid);
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
          take(
            yield { node: transition(propertyNames), instance: id, path: "propertyNames" },
            "propertyNames",
          );
        }
    }
    if (Array.isArray(v)) {
      const prefix = targets("prefixItems");
      const prefixIds = tracked ? candidates<number>() : undefined;
      let prefixValid = true;
      let used = 0;
      for (const e of prefix) {
        const id = current.children.get(e.member as string);
        if (id !== undefined) {
          used++;
          const path = `prefixItems/${e.member}`;
          const child = yield { node: transition(e.target), instance: id, path };
          take(child, path);
          prefixValid = prefixValid && child.valid;
          stage(prefixIds, id);
        }
      }
      if (used > 0) annotate("prefixItems", new JsonNumberLiteral(String(used - 1)));
      commit(prefixIds, prefixValid);
      const items = target("items");
      if (items !== undefined) {
        let applied = false;
        let itemsValid = true;
        for (let i = prefix.length; i < v.length; i++) {
          applied = true;
          const child = yield {
            node: transition(items),
            instance: current.children.get(String(i)) as number,
            path: "items",
          };
          take(child, "items");
          itemsValid = itemsValid && child.valid;
        }
        if (applied) annotate("items", true);
        if (tracked && applied && itemsValid) locations().markAllItems();
      }
      const contains = target("contains");
      if (contains !== undefined) {
        b.work();
        b.charge("logicalBytes", 64);
        const matched: JsonNumberLiteral[] = [];
        const matchedIds = tracked ? candidates<number>() : undefined;
        for (let i = 0; i < v.length; i++) {
          // A bounded instance index needs at most 16 decimal digits. Reserve
          // its construction work before making even the temporary lookup key.
          b.work(16);
          const index = String(i);
          const child = yield {
            node: transition(contains),
            instance: current.children.get(index) as number,
            path: "contains",
          };
          if (child.valid) {
            b.work(index.length + 1);
            b.charge("valueNodes");
            b.charge("logicalBytes", 64 + 16 + 2 * index.length);
            matched.push(new JsonNumberLiteral(index));
            b.charge("logicalBytes", 32 + 2 * "contains".length);
            fact.successes.push({ fact: child, path: "contains" });
            stage(matchedIds, child.instance);
          }
          // A failed trial is not a parent assertion failure. Visit every item
          // even after a minimum succeeds or a maximum is exceeded.
        }
        const count = decimal(String(matched.length), b.work, b.limits.coefficientDigits);
        const min = obj.minContains;
        const minimum = min instanceof JsonNumberLiteral ? numberValue(min, b) : undefined;
        const zeroMinimum =
          minimum !== undefined &&
          compareDecimal(minimum, decimal("0", b.work, b.limits.coefficientDigits), b.work) === 0;
        if (matched.length === 0 && !zeroMinimum) fail("contains");
        // Contains success is independent of adjacent count failures and of
        // unrelated Fact failures. A later invalid Fact still exports nothing.
        commit(matchedIds, matched.length > 0 || zeroMinimum);
        if (minimum !== undefined && compareDecimal(count, minimum, b.work) < 0)
          fail("minContains");
        const max = obj.maxContains;
        if (
          max instanceof JsonNumberLiteral &&
          compareDecimal(count, numberValue(max, b), b.work) > 0
        )
          fail("maxContains");
        // Always-array annotation makes its length the adjacent count operand.
        // Projection discards all annotations if the enclosing result is invalid.
        annotate("contains", Object.freeze(matched));
      }
    }
    // These commit points define this private evaluator's invalid-parent
    // diagnostics, not a universal output law. Failed keyword candidates are
    // never incoming coverage; all discarded work remains charged.
    // With no coverage container, optional chaining performs no membership lookup.
    // Each object or array candidate traversal still consumes work below.
    if (tracked && objectValue(v)) {
      const unevaluated = target("unevaluatedProperties");
      if (unevaluated !== undefined) {
        const names = candidates<string>();
        const ids = candidates<number>();
        let valid = true;
        for (const [key, id] of current.children) {
          b.work(key.length + 1);
          if (fact.locations?.covers(id)) continue;
          stage(names, key);
          stage(ids, id);
          const child = yield {
            node: transition(unevaluated),
            instance: id,
            path: "unevaluatedProperties",
          };
          take(child, "unevaluatedProperties");
          valid = valid && child.valid;
        }
        if (valid) {
          commit(ids, true);
          // stage already charged these name slots; freezing reuses them without a copy.
          annotate("unevaluatedProperties", Object.freeze(names));
        }
      }
    }
    if (tracked && Array.isArray(v)) {
      const unevaluated = target("unevaluatedItems");
      if (unevaluated !== undefined && !fact.locations?.allItems) {
        let applied = false;
        let valid = true;
        for (const id of current.children.values()) {
          b.work();
          if (fact.locations?.covers(id)) continue;
          applied = true;
          const child = yield {
            node: transition(unevaluated),
            instance: id,
            path: "unevaluatedItems",
          };
          take(child, "unevaluatedItems");
          valid = valid && child.valid;
        }
        if (applied && valid) {
          locations().markAllItems();
          annotate("unevaluatedItems", true);
        }
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
      else if (
        typeof v === "string" &&
        (k.name === "contentEncoding" ||
          k.name === "contentMediaType" ||
          (k.name === "contentSchema" && typeof obj.contentMediaType === "string"))
      )
        annotate(k.name, k.value);
      else if (!knownKeyword(k.name)) annotate(k.name, k.value);
    }
    if (fact.valid) fact.locations?.seal();
    else delete fact.locations;
    return fact;
  }
  const stack: { key: string; iterator: Generator<Request, Fact, Fact>; next?: Fact }[] = [];
  const push = (node: number, instance: number, key: string): void => {
    b.charge("states");
    b.charge("logicalBytes", 64);
    b.bound("frames", stack.length + 1);
    stack.push({ key, iterator: run(node, instance) });
  };
  const entry = specialization?.entry ?? root;
  push(entry, 0, memo.key(entry, 0));
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
  // Even an empty annotation array has an encoded representation.
  b.charge("annotationBytes", 2);
  b.charge("occurrences");
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
        const entry = Object.freeze({
          ...a,
          schemaLocation,
          instanceLocation,
          validationPath: renderPath(appendPath(occurrence.path, escapePointer(a.keyword))),
        });
        b.charge("annotations");
        if (annotations.length) b.charge("annotationBytes");
        chargeAnnotationBytes(entry, b);
        annotations.push(entry);
      }
      for (let i = f.successes.length - 1; i >= 0; i--) {
        const child = f.successes[i] as Child;
        b.work(child.path.length);
        b.bound("frames", pending.length + 1);
        b.charge("occurrences");
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
        b.charge("occurrences");
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
    annotationPolicy,
    patternPolicy: PATTERN_POLICY,
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
  "pattern",
  "patternProperties",
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
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "minContains",
  "maxContains",
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
  return known.has(name);
}
