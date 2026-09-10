import { type AdmittedJsonValue, isUnicodeScalarString } from "./json-admission.js";
import { ProtocolArtifactValidationError } from "./protocol-errors.js";

type Container = AdmittedJsonValue[] | Record<string, AdmittedJsonValue>;
interface Path {
  readonly parent: Path | undefined;
  readonly key: string;
}
interface Frame {
  readonly source: object;
  readonly target: Container;
  readonly keys: readonly string[] | undefined;
  readonly length: number;
  readonly path: Path | undefined;
  index: number;
}
function location(label: string, path: Path | undefined): string {
  const keys: string[] = [];
  for (let current = path; current; current = current.parent)
    keys.push(current.key.replace(/~/g, "~0").replace(/\//g, "~1"));
  return keys.length ? `${label}/${keys.reverse().join("/")}` : label;
}

/** Immutable, unaliased JSON snapshot with no implicit wire depth/size limit.
 * Transport and resource owners must bound bytes/work before accepting input.
 * This accepts the existing protocol boundary's plain objects and arrays:
 * enumerable object keys and array length are captured once, each selected
 * value/accessor is read once, and schema validation uses only the snapshot.
 * Non-enumerable object members/symbols and non-index array members are outside
 * JSON. Plain-object prototypes, finite numbers, Unicode scalars, non-JSON
 * values and active-path cycles are checked without recursive calls.
 * Numeric values here have lost their original spelling: raw write requests
 * still require lossless numeric admission before reaching this boundary.
 */
export function snapshotJsonValue(value: unknown, label = "JSON value"): AdmittedJsonValue {
  const frames: Frame[] = [];
  const active = new WeakSet<object>();
  const fail = (path: Path | undefined, message: string): never => {
    throw new ProtocolArtifactValidationError(`${location(label, path)} ${message}`);
  };
  const start = (entry: unknown, path: Path | undefined): AdmittedJsonValue => {
    if (entry === null || typeof entry === "boolean") return entry;
    if (typeof entry === "string") {
      if (!isUnicodeScalarString(entry)) fail(path, "must not contain an unpaired surrogate");
      return entry;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) fail(path, "must contain a finite JSON number");
      return entry;
    }
    if (typeof entry !== "object") return fail(path, "must contain only JSON values");
    if (active.has(entry)) fail(path, "must not contain a cycle");
    const array = Array.isArray(entry);
    if (!array) {
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== null)
        fail(path, "must be a plain object");
    }
    const keys = array ? undefined : Object.keys(entry);
    const length = array ? entry.length : keys?.length;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0)
      return fail(path, "must have a valid JSON container length");
    const target: Container = array ? [] : {};
    active.add(entry);
    frames.push({ source: entry, target, keys, length, index: 0, path });
    return target;
  };
  const result = start(value, undefined);
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (!frame) break;
    if (frame.index === frame.length) {
      Object.freeze(frame.target);
      active.delete(frame.source);
      frames.pop();
      continue;
    }
    const index = frame.index++;
    const key = frame.keys === undefined ? String(index) : frame.keys[index];
    if (key === undefined) throw new Error("snapshot frame lost its captured key");
    const path = { parent: frame.path, key };
    if (!isUnicodeScalarString(key)) fail(path, "must not contain an unpaired surrogate");
    const child = (frame.source as Record<string, unknown>)[key];
    Object.defineProperty(frame.target, key, {
      value: start(child, path),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

/** Ordinary compact JSON encoding in ECMAScript property enumeration order.
 * This is NOT a canonical identity/hash serializer: it does not sort keys or
 * choose a revision scheme. Primitive escaping/number formatting is exactly
 * JSON.stringify's; containers are handled iteratively after a checked single
 * immutable snapshot, so accessors/toJSON cannot swap data after validation.
 * No implicit output bound is imposed: the caller owns its advertised limits.
 */
export function stringifyJsonValue(value: unknown, label = "JSON value"): string {
  type Task = string | { readonly value: AdmittedJsonValue };
  const pending: Task[] = [{ value: snapshotJsonValue(value, label) }];
  const chunks: string[] = [];
  while (pending.length) {
    const task = pending.pop();
    if (task === undefined) break;
    if (typeof task === "string") {
      chunks.push(task);
      continue;
    }
    const item = task.value;
    if (item === null || typeof item !== "object") {
      chunks.push(JSON.stringify(item));
      continue;
    }
    if (Array.isArray(item)) {
      chunks.push("[");
      pending.push("]");
      for (let i = item.length - 1; i >= 0; i--) {
        const child = item[i];
        if (child === undefined) throw new Error("snapshot contains a missing array value");
        pending.push({ value: child });
        if (i > 0) pending.push(",");
      }
    } else {
      chunks.push("{");
      pending.push("}");
      const record = item as Readonly<Record<string, AdmittedJsonValue>>;
      const keys = Object.keys(record);
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        const child = key === undefined ? undefined : record[key];
        if (key === undefined || child === undefined)
          throw new Error("snapshot lost an object member");
        pending.push({ value: child }, ":", JSON.stringify(key));
        if (i > 0) pending.push(",");
      }
    }
  }
  return chunks.join("");
}
