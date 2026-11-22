// Independent reference semantics for the spec's Filter / QueryExpr wire AST.
import { isDeepStrictEqual } from "node:util";
import { requireThat, record, reference, string } from "./contract.mjs";
export const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? "{" +
        Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(",") +
        "}"
      : JSON.stringify(value);
export function identity(ref, scope) {
  reference(ref);
  return ref.scope === "uri" ? ref.id : new URL(ref.id, ref.scope ?? scope).href;
}
export function field(value, path) {
  let found = value;
  for (const p of path) {
    if (found === null || typeof found !== "object" || !Object.hasOwn(found, p))
      return { present: false };
    found = found[p];
  }
  return { present: true, value: found };
}
function lexical(a, b) {
  const left = [...String(a)],
    right = [...String(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === right[i]) continue;
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    return left[i].codePointAt(0) - right[i].codePointAt(0);
  }
  return 0;
}
export function condition(c, r) {
  if (c.kind === "is-type")
    return r.type === c.type || (c.match !== "exact" && r.type.startsWith(`${c.type}/`));
  const f = field(r, c.field);
  if (c.kind === "has") return f.present;
  if (c.kind === "missing") return !f.present;
  if (!f.present) return false;
  const value = f.value;
  if (c.kind === "compare") {
    if (c.op === "eq") return isDeepStrictEqual(value, c.value);
    if (c.op === "ne") return !isDeepStrictEqual(value, c.value);
    if (c.op === "in") return c.value.some((v) => isDeepStrictEqual(v, value));
    if (
      !["string", "number", "boolean"].includes(typeof value) ||
      !["string", "number", "boolean"].includes(typeof c.value)
    )
      return false;
    const order = lexical(value, c.value);
    return { lt: order < 0, le: order <= 0, gt: order > 0, ge: order >= 0 }[c.op];
  }
  if (c.kind === "contains")
    return Array.isArray(value) && value.some((v) => isDeepStrictEqual(v, c.value));
  if (c.kind === "contains-any")
    return Array.isArray(value) && value.some((v) => c.values.some((w) => isDeepStrictEqual(v, w)));
  if (c.kind === "excludes")
    return Array.isArray(value) && value.every((v) => !isDeepStrictEqual(v, c.value));
  if (c.kind === "matches") {
    if (typeof value !== "string") return false;
    if (c.using === "substring") return value.includes(c.pattern);
    if (c.using === "regex") return new RegExp(c.pattern, "u").test(value);
    // Independent dynamic-programming glob evaluator; no backtracking regex.
    const pattern=[...c.pattern], text=[...value];
    let previous=new Uint8Array(pattern.length+1);previous[0]=1;
    for(let j=1;j<=pattern.length;j++)previous[j]=pattern[j-1]==='*'?previous[j-1]:0;
    for(const ch of text){
      const next=new Uint8Array(pattern.length+1);
      for(let j=1;j<=pattern.length;j++)next[j]=pattern[j-1]==='*'?(previous[j]||next[j-1]):(pattern[j-1]==='?'||pattern[j-1]===ch)&&previous[j-1];
      previous=next;
    }
    return !!previous[pattern.length];
  }
  throw Error("Unknown reference condition");
}
export const filter = (where, r) => where.every((c) => condition(c, r));
export function query(expr, r, resources, scope) {
  switch (expr.kind) {
    case "all":
      return expr.of.every((e) => query(e, r, resources, scope));
    case "any":
      return expr.of.some((e) => query(e, r, resources, scope));
    case "not":
      return !query(expr.expr, r, resources, scope);
    case "cond":
      return condition(expr.condition, r);
    case "via":
      return resources.some((edge) => {
        if (edge.type !== expr.edge || !edge.body?.source || !edge.body?.target) return false;
        const [from, to] =
          expr.direction === "in"
            ? [edge.body.target, edge.body.source]
            : [edge.body.source, edge.body.target];
        if (identity(from, scope) !== identity(r.id, scope)) return false;
        const neighbor = resources.find((v) => identity(v.id, scope) === identity(to, scope));
        return (
          neighbor !== undefined &&
          (expr.where === undefined || query(expr.where, neighbor, resources, scope))
        );
      });
  }
  throw Error("Unknown reference QueryExpr");
}
export function projected(resource, selector) {
  let result = structuredClone(resource);
  const parts = (pointer) =>
    pointer === ""
      ? []
      : pointer
          .slice(1)
          .split("/")
          .map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (selector.include) {
    result = { id: structuredClone(resource.id), type: resource.type };
    for (const pointer of selector.include) {
      const path = parts(pointer);
      if (!path.length) {
        result = structuredClone(resource);
        continue;
      }
      const f = field(resource, path);
      if (!f.present) continue;
      let dest = result,
        original = resource;
      for (const key of path.slice(0, -1)) {
        original = original[key];
        if (!Object.hasOwn(dest, key))
          Object.defineProperty(dest, key, {
            value: Array.isArray(original) ? [] : {},
            writable: true,
            enumerable: true,
            configurable: true,
          });
        dest = dest[key];
      }
      Object.defineProperty(dest, path.at(-1), {
        value: structuredClone(f.value),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }
  for (const pointer of selector.omit ?? []) {
    const path = parts(pointer);
    if (!path.length) {
      result = { id: structuredClone(resource.id), type: resource.type };
      continue;
    }
    if (["id", "type"].includes(path[0])) continue;
    let dest = result;
    for (const key of path.slice(0, -1)) dest = dest?.[key];
    if (dest && typeof dest === "object") delete dest[path.at(-1)];
  }
  return result;
}
export function validateCondition(value) {
  requireThat(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Condition must be a record",
  );
  const spec = {
    compare: ["field", "op", "value"],
    matches: ["field", "pattern", "using"],
    has: ["field"],
    missing: ["field"],
    contains: ["field", "value"],
    "contains-any": ["field", "values"],
    excludes: ["field", "value"],
    "is-type": ["type", "match"],
  };
  requireThat(Object.hasOwn(spec, value.kind), "Unknown condition");
  const keys = spec[value.kind];
  record(value, ["kind", ...keys], ["kind", ...keys.filter((k) => k !== "match")]);
  if (value.kind === "is-type") {
    string(value.type);
    requireThat(
      value.match === undefined || ["prefix", "exact"].includes(value.match),
      "Invalid type match",
    );
    return;
  }
  requireThat(
    Array.isArray(value.field) && value.field.every((v) => typeof v === "string"),
    "Invalid FieldPath",
  );
  if (value.kind === "compare") {
    requireThat(
      ["eq", "ne", "lt", "le", "gt", "ge", "in"].includes(value.op),
      "Invalid comparison",
    );
    if (value.op === "in") requireThat(Array.isArray(value.value), "in expects an array");
  }
  if (value.kind === "matches") {
    string(value.pattern);
    requireThat(["substring", "glob", "regex"].includes(value.using), "Invalid matching mode");
  }
  if (value.kind === "contains-any")
    requireThat(Array.isArray(value.values), "contains-any expects an array");
}
