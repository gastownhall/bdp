import { isProxy } from "node:util/types";
import { JsonNumberLiteral, type LosslessJsonValue } from "@bdp/protocol";

export const SCHEMA_GRAPH_CEILINGS = Object.freeze({
  schemaBytes: 16_777_216,
  syntaxNodes: 262_144,
  depth: 4096,
  nodes: 65_536,
  resources: 8192,
  anchors: 65_536,
  childEdges: 65_536,
  references: 65_536,
  descriptorRoots: 4096,
  uriBytes: 2048,
  uriCalls: 131_072,
  uriWork: 67_108_864,
  pointerSteps: 1_048_576,
  retainedBytes: 16_777_216,
  scanWork: 4_194_304,
});
export type SchemaGraphLimits = { readonly [K in keyof typeof SCHEMA_GRAPH_CEILINGS]: number };
export type SchemaGraphCounter = keyof SchemaGraphLimits;
export class SchemaGraphError extends Error {
  constructor(
    readonly code: string,
    readonly node?: number,
  ) {
    super(`schema resource index refused: ${code}`);
    this.name = "SchemaGraphError";
  }
}
export function refuseGraph(code: string, node?: number): never {
  throw new SchemaGraphError(code, node);
}
export class GraphBudget {
  readonly limits: SchemaGraphLimits;
  readonly counts: Record<SchemaGraphCounter, number>;
  constructor(input: SchemaGraphLimits) {
    if (
      input === null ||
      typeof input !== "object" ||
      isProxy(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    )
      refuseGraph("limits");
    const fields = Object.getOwnPropertyDescriptors(input);
    const values: Record<string, number> = Object.create(null);
    const counts: Record<string, number> = Object.create(null);
    if (Reflect.ownKeys(fields).length !== Object.keys(SCHEMA_GRAPH_CEILINGS).length)
      refuseGraph("limits");
    for (const key of Object.keys(SCHEMA_GRAPH_CEILINGS) as SchemaGraphCounter[]) {
      const f = fields[key];
      if (
        !f ||
        !Object.hasOwn(f, "value") ||
        typeof f.value !== "number" ||
        !Number.isSafeInteger(f.value) ||
        f.value < 0 ||
        f.value > SCHEMA_GRAPH_CEILINGS[key]
      )
        refuseGraph("limits");
      values[key] = f.value;
      counts[key] = 0;
    }
    this.limits = Object.freeze(values) as SchemaGraphLimits;
    this.counts = counts as Record<SchemaGraphCounter, number>;
  }
  charge(key: SchemaGraphCounter, n = 1): void {
    if (!Number.isSafeInteger(n) || n < 0 || n > this.limits[key] - this.counts[key])
      refuseGraph(`limit-${key}`);
    this.counts[key] += n;
  }
  bound(key: SchemaGraphCounter, n: number): void {
    if (n > this.limits[key]) refuseGraph(`limit-${key}`);
    this.counts[key] = Math.max(this.counts[key], n);
  }
}
export type SchemaObject = { readonly [key: string]: LosslessJsonValue };
export function isSchemaObject(v: LosslessJsonValue): v is SchemaObject {
  return (
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonNumberLiteral)
  );
}
export function schema(v: LosslessJsonValue): void {
  if (typeof v !== "boolean" && !isSchemaObject(v)) refuseGraph("schema-shape");
}
type Rule =
  | "string"
  | "boolean"
  | "any"
  | "array"
  | "enum"
  | "type"
  | "number"
  | "positive"
  | "count"
  | "names"
  | "names-map"
  | "vocabulary"
  | "schema"
  | "schema-array"
  | "schema-map"
  | "unsupported";
/** One shape/position census. Unknown values remain opaque annotations. */
export const SCHEMA_KEYWORDS: Readonly<Record<string, Rule>> = Object.freeze(
  Object.assign(Object.create(null), {
    $id: "string",
    $schema: "string",
    $ref: "string",
    $dynamicRef: "string",
    $anchor: "string",
    $dynamicAnchor: "string",
    $vocabulary: "vocabulary",
    $comment: "string",
    $defs: "schema-map",
    definitions: "schema-map",
    allOf: "schema-array",
    anyOf: "schema-array",
    oneOf: "schema-array",
    prefixItems: "schema-array",
    not: "schema",
    if: "schema",
    // biome-ignore lint/suspicious/noThenProperty: Fixed JSON Schema keyword name; its value is a noncallable shape tag.
    then: "schema",
    else: "schema",
    dependentSchemas: "schema-map",
    items: "schema",
    contains: "schema",
    additionalProperties: "schema",
    propertyNames: "schema",
    properties: "schema-map",
    patternProperties: "schema-map",
    unevaluatedItems: "schema",
    unevaluatedProperties: "schema",
    contentSchema: "schema",
    type: "type",
    enum: "enum",
    const: "any",
    multipleOf: "positive",
    minimum: "number",
    maximum: "number",
    exclusiveMinimum: "number",
    exclusiveMaximum: "number",
    minLength: "count",
    maxLength: "count",
    minItems: "count",
    maxItems: "count",
    minContains: "count",
    maxContains: "count",
    minProperties: "count",
    maxProperties: "count",
    uniqueItems: "boolean",
    required: "names",
    dependentRequired: "names-map",
    pattern: "string",
    title: "string",
    description: "string",
    default: "any",
    deprecated: "boolean",
    readOnly: "boolean",
    writeOnly: "boolean",
    examples: "array",
    format: "string",
    contentEncoding: "string",
    contentMediaType: "string",
    dependencies: "unsupported",
    $recursiveRef: "unsupported",
    $recursiveAnchor: "unsupported",
  }),
);
const types = new Set(["null", "boolean", "object", "array", "number", "string", "integer"]);
/** Only shape predicates; retains arbitrary-precision tokens and never expands exponents. */
export function numberShape(
  v: LosslessJsonValue,
  kind: "number" | "positive" | "count",
  b: GraphBudget,
): void {
  if (!(v instanceof JsonNumberLiteral)) refuseGraph("keyword-shape");
  if (kind === "number") return;
  const s = v.literal;
  b.charge("scanWork", s.length * 4);
  const negative = s[0] === "-";
  let fraction = 0,
    trailing = 0,
    nonzero = false,
    afterPoint = false,
    i = negative ? 1 : 0;
  for (; i < s.length && s[i] !== "e" && s[i] !== "E"; i++) {
    const c = s[i];
    if (c === ".") {
      afterPoint = true;
      continue;
    }
    if (afterPoint) fraction++;
    if (c === "0") trailing++;
    else {
      nonzero = true;
      trailing = 0;
    }
  }
  if (!nonzero) {
    if (kind === "positive") refuseGraph("keyword-shape");
    return;
  }
  if (negative) refuseGraph("keyword-shape");
  if (kind === "positive") return;
  let exp = i === s.length ? "0" : s.slice(i + 1);
  const expNegative = exp[0] === "-";
  let start = exp[0] === "+" || exp[0] === "-" ? 1 : 0;
  while (start < exp.length && exp[start] === "0") start++;
  exp = exp.slice(start);
  const threshold = fraction - trailing;
  // The threshold is bounded by token bytes; only short exponents reach Number.
  let enough: boolean;
  if (exp.length > String(Math.abs(threshold)).length) enough = !expNegative;
  else enough = (expNegative ? -1 : 1) * Number(exp || "0") >= threshold;
  if (!enough) refuseGraph("keyword-shape");
}
export interface SchemaChild {
  readonly keyword: string;
  readonly member?: string;
  readonly value: LosslessJsonValue;
}
export function visitSchemaChildren(
  value: SchemaObject,
  b: GraphBudget,
  emit: (child: SchemaChild) => void,
): void {
  const names = (v: LosslessJsonValue): void => {
    if (!Array.isArray(v)) refuseGraph("keyword-shape");
    const seen = new Set<string>();
    for (const n of v) {
      b.charge("scanWork");
      if (typeof n !== "string") refuseGraph("keyword-shape");
      b.charge("scanWork", n.length);
      if (seen.has(n)) refuseGraph("keyword-shape");
      seen.add(n);
    }
  };
  for (const key of Object.keys(value)) {
    b.charge("scanWork", key.length + 1);
    const v = value[key] as LosslessJsonValue;
    const rule = SCHEMA_KEYWORDS[key];
    if (rule === "unsupported")
      refuseGraph(
        key === "dependencies"
          ? "unsupported-transitional-dependencies"
          : "unsupported-recursive-keyword",
      );
    if (rule === "string" && typeof v !== "string") refuseGraph("keyword-shape");
    if (rule === "boolean" && typeof v !== "boolean") refuseGraph("keyword-shape");
    if ((rule === "array" || rule === "enum") && !Array.isArray(v)) refuseGraph("keyword-shape");
    if (rule === "number" || rule === "positive" || rule === "count") numberShape(v, rule, b);
    if (rule === "names") names(v);
    if (rule === "type") {
      if (typeof v === "string") {
        if (!types.has(v)) refuseGraph("keyword-shape");
      } else {
        names(v);
        if (!(v as readonly unknown[]).length) refuseGraph("keyword-shape");
        for (const n of v as readonly string[]) if (!types.has(n)) refuseGraph("keyword-shape");
      }
    }
    if (rule === "names-map" || rule === "vocabulary") {
      if (!isSchemaObject(v)) refuseGraph("keyword-shape");
      for (const name of Object.keys(v)) {
        b.charge("scanWork", name.length + 1);
        const entry = v[name] as LosslessJsonValue;
        if (rule === "names-map") names(entry);
        else if (typeof entry !== "boolean") refuseGraph("keyword-shape");
      }
    }
    const child = (member: string | undefined, childValue: LosslessJsonValue): void => {
      schema(childValue);
      b.charge("childEdges");
      emit({ keyword: key, ...(member === undefined ? {} : { member }), value: childValue });
    };
    if (rule === "schema") child(undefined, v);
    if (rule === "schema-array") {
      if (!Array.isArray(v) || v.length === 0) refuseGraph("keyword-shape");
      for (let i = 0; i < v.length; i++) {
        b.charge("scanWork");
        child(String(i), v[i] as LosslessJsonValue);
      }
    }
    if (rule === "schema-map") {
      if (!isSchemaObject(v)) refuseGraph("keyword-shape");
      for (const name of Object.keys(v)) {
        b.charge("scanWork", name.length + 1);
        child(name, v[name] as LosslessJsonValue);
      }
    }
  }
}
