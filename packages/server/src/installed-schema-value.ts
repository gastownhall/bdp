import { isProxy, isUint8Array } from "node:util/types";
import { decodeJsonDocument, JsonNumberLiteral, type LosslessJsonValue } from "@bdp/protocol";
import { decimal, compareDecimal, type Decimal } from "./installed-schema-decimal.js";
export const EVALUATOR_CEILINGS = Object.freeze({
  inputBytes: 1048576,
  valueNodes: 262144,
  states: 1048576,
  frames: 1048576,
  logicalBytes: 16777216,
  coefficientDigits: 4096,
  work: 16777216,
  diagnostics: 1024,
  diagnosticBytes: 1048576,
});
export type EvaluatorLimits = { readonly [K in keyof typeof EVALUATOR_CEILINGS]: number };
export class EvaluationRefusal extends Error {
  constructor(readonly code: string) {
    super(`private schema evaluation refused: ${code}`);
  }
}
/** logicalBytes is cumulative logical allocation, never reclaimed: 64-byte value/
 * call records, 96-byte facts, 16-byte name/failure slots, 32-byte links/annotations/memo entries,
 * and two bytes per retained JS string unit (or actual encoded diagnostic bytes).
 * It is neither JS heap measurement nor a parser/immutable-graph allocation cap. */
export class EvaluationBudget {
  readonly limits: EvaluatorLimits;
  readonly counts: Record<keyof EvaluatorLimits, number>;
  constructor(input: EvaluatorLimits) {
    if (
      !input ||
      typeof input !== "object" ||
      isProxy(input) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(input))
    )
      throw new EvaluationRefusal("limits");
    const fields = Object.getOwnPropertyDescriptors(input),
      values: Record<string, number> = Object.create(null),
      counts: Record<string, number> = Object.create(null);
    if (Reflect.ownKeys(fields).length !== Object.keys(EVALUATOR_CEILINGS).length)
      throw new EvaluationRefusal("limits");
    for (const key of Object.keys(EVALUATOR_CEILINGS) as (keyof EvaluatorLimits)[]) {
      const f = fields[key];
      if (
        !f ||
        !Object.hasOwn(f, "value") ||
        typeof f.value !== "number" ||
        !Number.isSafeInteger(f.value) ||
        f.value < 0 ||
        f.value > EVALUATOR_CEILINGS[key]
      )
        throw new EvaluationRefusal("limits");
      values[key] = f.value;
      counts[key] = 0;
    }
    this.limits = Object.freeze(values) as EvaluatorLimits;
    this.counts = counts as Record<keyof EvaluatorLimits, number>;
  }
  charge(key: keyof EvaluatorLimits, n = 1): void {
    if (!Number.isSafeInteger(n) || n < 0 || n > this.limits[key] - this.counts[key])
      throw new EvaluationRefusal(`limit-${key}`);
    this.counts[key] += n;
  }
  bound(key: keyof EvaluatorLimits, n: number): void {
    if (n > this.limits[key]) throw new EvaluationRefusal(`limit-${key}`);
    this.counts[key] = Math.max(this.counts[key], n);
  }
  work = (n = 1): void => this.charge("work", n);
}
/** Invocation-owned memo accounting. Every constructed key, including a temporary
 * lookup key on a hit, reserves two logical bytes per ASCII unit. Each insertion
 * reserves a 32-byte logical map entry; reusing its already reserved key does not
 * allocate a second key. Digit traversal/construction and each lookup/insertion
 * charge work before the operation. These are explicit logical costs, not heap
 * measurements or guarantees about the JavaScript Map implementation. */
export class EvaluationMemo<T> {
  readonly #entries = new Map<string, T>();
  readonly #budget: EvaluationBudget;
  constructor(budget: EvaluationBudget) {
    this.#budget = budget;
  }
  key(node: number, instance: number): string {
    const length = this.#digits(node) + this.#digits(instance) + 1;
    this.#budget.work(length);
    this.#budget.charge("logicalBytes", 2 * length);
    return `${node}:${instance}`;
  }
  get(key: string): T | undefined {
    this.#budget.work(key.length + 1);
    return this.#entries.get(key);
  }
  set(key: string, value: T): void {
    this.#budget.work(key.length + 1);
    this.#budget.charge("logicalBytes", 32);
    this.#entries.set(key, value);
  }
  #digits(value: number): number {
    this.#budget.work();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid memo identity");
    let digits = 0;
    do {
      this.#budget.work();
      digits++;
      value = Math.floor(value / 10);
    } while (value !== 0);
    return digits;
  }
}
const typedLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
export interface Instance {
  readonly value: LosslessJsonValue;
  readonly parent: number | null;
  readonly segment: string;
  readonly children: ReadonlyMap<string, number>;
  readonly actual: number;
}
/** Every byte is copied before decode. The byte envelope bounds parser allocation;
 * post-parse nodes and logicalBytes do not measure/prevent that earlier heap use. */
export function instanceIndex(input: Uint8Array, b: EvaluationBudget): Instance[] {
  if (!isUint8Array(input) || isProxy(input) || !typedLength)
    throw new EvaluationRefusal("input-domain");
  const length = typedLength.call(input) as number;
  b.bound("inputBytes", length);
  const copy = new Uint8Array(length);
  Uint8Array.prototype.set.call(copy, input);
  let value: LosslessJsonValue;
  try {
    value = decodeJsonDocument(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(copy),
    );
  } catch {
    throw new EvaluationRefusal("input-domain");
  }
  b.charge("valueNodes");
  b.charge("logicalBytes", 64);
  b.bound("frames", 1);
  const nodes: Instance[] = [];
  const pending: { value: LosslessJsonValue; parent: number | null; segment: string }[] = [
    { value, parent: null, segment: "" },
  ];
  while (pending.length) {
    b.bound("frames", pending.length);
    const x = pending.pop();
    if (!x) throw new Error("instance frame");
    b.work();
    const id = nodes.length,
      children = new Map<string, number>();
    nodes.push({ ...x, children, actual: id });
    if (x.parent !== null)
      ((nodes[x.parent] as Instance).children as Map<string, number>).set(x.segment, id);
    if (typeof x.value === "string") b.charge("logicalBytes", 2 * x.value.length);
    else if (x.value instanceof JsonNumberLiteral)
      b.charge("logicalBytes", 2 * x.value.literal.length);
    else if (x.value !== null && typeof x.value === "object") {
      const keys = Object.keys(x.value);
      b.work(keys.length);
      b.charge("logicalBytes", 16 * keys.length);
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i] as string;
        b.bound("frames", pending.length + 1);
        b.charge("valueNodes");
        b.charge("logicalBytes", 64 + 2 * key.length);
        pending.push({
          value: (x.value as Record<string, LosslessJsonValue>)[key] as LosslessJsonValue,
          parent: id,
          segment: key,
        });
      }
    }
  }
  return nodes;
}
export function objectValue(v: LosslessJsonValue): v is Record<string, LosslessJsonValue> {
  return (
    v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonNumberLiteral)
  );
}
export function numberValue(v: JsonNumberLiteral, b: EvaluationBudget): Decimal {
  const result = decimal(v.literal, b.work, b.limits.coefficientDigits);
  b.bound("coefficientDigits", result.coefficient.length);
  return result;
}
export function equalValue(
  a: LosslessJsonValue,
  z: LosslessJsonValue,
  b: EvaluationBudget,
): boolean {
  b.bound("frames", 1);
  const pending: [LosslessJsonValue, LosslessJsonValue][] = [[a, z]];
  while (pending.length) {
    b.bound("frames", pending.length);
    const pair = pending.pop();
    if (!pair) throw new Error("equality frame");
    const [x, y] = pair;
    b.work();
    if (x instanceof JsonNumberLiteral || y instanceof JsonNumberLiteral) {
      if (
        !(x instanceof JsonNumberLiteral) ||
        !(y instanceof JsonNumberLiteral) ||
        compareDecimal(numberValue(x, b), numberValue(y, b), b.work) !== 0
      )
        return false;
    } else if (x === null || y === null || typeof x !== "object" || typeof y !== "object") {
      if (typeof x === "string" && typeof y === "string") b.work(x.length + y.length);
      if (x !== y) return false;
    } else {
      if (Array.isArray(x) !== Array.isArray(y)) return false;
      const keys = Object.keys(x);
      b.work(keys.length);
      if (keys.length !== Object.keys(y).length) return false;
      for (const key of keys) {
        b.work(key.length);
        if (!Object.hasOwn(y, key)) return false;
        b.bound("frames", pending.length + 1);
        b.charge("logicalBytes", 32);
        pending.push([
          (x as Record<string, LosslessJsonValue>)[key] as LosslessJsonValue,
          (y as Record<string, LosslessJsonValue>)[key] as LosslessJsonValue,
        ]);
      }
    }
  }
  return true;
}
export function pointer(nodes: readonly Instance[], id: number, b: EvaluationBudget): string {
  const parts: string[] = [];
  let current = nodes[id];
  if (!current) throw new Error("instance location");
  current = nodes[current.actual];
  while (current?.parent !== null && current !== undefined) {
    b.work(current.segment.length + 1);
    parts.push(current.segment.replace(/~/g, "~0").replace(/\//g, "~1"));
    current = nodes[current.parent];
  }
  return parts.length ? `/${parts.reverse().join("/")}` : "";
}
