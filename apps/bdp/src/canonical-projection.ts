import {
  isUnicodeScalarString,
  snapshotJsonValue,
  type AdmittedJsonValue,
  type RetainedJsonObject,
} from "@bdp/protocol";

export interface CanonicalPropertiesMasks {
  readonly include?: readonly string[];
  readonly omit?: readonly string[];
}
export class CanonicalProjectionError extends Error {
  readonly code = "invalid-input";
  constructor(message: string) {
    super(message);
    this.name = "CanonicalProjectionError";
  }
}
interface MaskNode {
  whole: boolean;
  readonly children: Map<string, MaskNode>;
}
const node = (): MaskNode => ({ whole: false, children: new Map() });

function pointer(value: string): readonly string[] {
  if (
    typeof value !== "string" ||
    !isUnicodeScalarString(value) ||
    !/^(?:\/(?:[^~]|~[01])*)*$/.test(value)
  ) {
    throw new CanonicalProjectionError("mask must be an RFC6901 JSON Pointer");
  }
  return value === ""
    ? []
    : value
        .slice(1)
        .split("/")
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}
function paths(values: readonly string[] | undefined): readonly (readonly string[])[] {
  if (values === undefined) return [];
  if (!Array.isArray(values))
    throw new CanonicalProjectionError("masks must be arrays of JSON Pointers");
  return values.map(pointer);
}
function decodedMasks(masks: CanonicalPropertiesMasks): {
  readonly includes: readonly (readonly string[])[] | undefined;
  readonly omits: readonly (readonly string[])[];
} {
  const includes = masks.include === undefined ? undefined : paths(masks.include);
  const omits = paths(masks.omit);
  if (omits.some((path) => path.length === 0)) {
    throw new CanonicalProjectionError("properties root omission is not permitted");
  }
  return { includes, omits };
}
/** Validate data pointers only; the bare framing token `envelope` belongs to the caller. */
export function validateCanonicalPropertiesMasks(masks: CanonicalPropertiesMasks): void {
  decodedMasks(masks);
}
function insert(root: MaskNode, path: readonly string[]): void {
  let current = root;
  for (const key of path) {
    if (current.whole) return;
    let child = current.children.get(key);
    if (child === undefined) {
      child = node();
      current.children.set(key, child);
    }
    current = child;
  }
  current.whole = true;
  current.children.clear();
}
function child(value: AdmittedJsonValue, key: string): AdmittedJsonValue | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    // Array indexes are original canonical decimal positions, not object members,
    // append tokens, rounded numbers or local selectors.
    if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return undefined;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index >= value.length) return undefined;
    return value[index];
  }
  return Object.hasOwn(value, key) ? (value as RetainedJsonObject)[key] : undefined;
}
function exists(value: AdmittedJsonValue, path: readonly string[]): boolean {
  let current: AdmittedJsonValue | undefined = value;
  for (const key of path) {
    current = child(current, key);
    if (current === undefined) return false;
  }
  return true;
}
interface Frame {
  readonly original: AdmittedJsonValue;
  readonly include: MaskNode | undefined;
  readonly omit: MaskNode | undefined;
  readonly whole: boolean;
  readonly put: (value: AdmittedJsonValue) => void;
}

/**
 * Local rendering of an already admitted properties view, never a Resource mask
 * or a provider projection capability. All coordinates refer to the original.
 * Build selected ancestors first; remove paths without reevaluating compacted
 * arrays. No field name acquires protocol identity/protection here.
 */
export function projectCanonicalProperties(
  value: RetainedJsonObject,
  masks: CanonicalPropertiesMasks,
): RetainedJsonObject {
  const { includes, omits } = decodedMasks(masks);
  const original = snapshotJsonValue(value, "properties view");
  if (original === null || typeof original !== "object" || Array.isArray(original)) {
    throw new CanonicalProjectionError("properties view must be a JSON object");
  }
  const include = node();
  if (includes === undefined) include.whole = true;
  else
    for (const path of includes) {
      // A missing or wrong-shaped path does not manufacture its ancestors.
      if (exists(original, path)) insert(include, path);
    }
  const omit = node();
  for (const path of omits) insert(omit, path);
  let result: AdmittedJsonValue | undefined;
  const pending: (Frame | { readonly freeze: object })[] = [
    {
      original,
      include,
      omit,
      whole: include.whole,
      put: (projected) => {
        result = projected;
      },
    },
  ];
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === undefined) break;
    if ("freeze" in task) {
      Object.freeze(task.freeze);
      continue;
    }
    const { original: source, put } = task;
    if (source === null || typeof source !== "object") {
      put(source);
      continue;
    }
    const array = Array.isArray(source);
    const projected: AdmittedJsonValue[] | Record<string, AdmittedJsonValue> = array
      ? []
      : (Object.create(null) as Record<string, AdmittedJsonValue>);
    put(projected);
    pending.push({ freeze: projected });
    const keys = array ? source.map((_entry, index) => String(index)) : Object.keys(source);
    // LIFO tasks still append array elements in ascending original-index order.
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === undefined) continue;
      const selected = task.include?.children.get(key);
      const whole = task.whole || selected?.whole === true;
      const excluded = task.omit?.children.get(key);
      if ((!whole && selected === undefined) || excluded?.whole === true) continue;
      const entry = child(source, key);
      if (entry === undefined) continue;
      pending.push({
        original: entry,
        include: selected,
        omit: excluded,
        whole,
        put: array
          ? (item) => {
              (projected as AdmittedJsonValue[]).push(item);
            }
          : (item) => {
              Object.defineProperty(projected, key, {
                value: item,
                enumerable: true,
                configurable: true,
                writable: true,
              });
            },
      });
    }
  }
  return result as RetainedJsonObject;
}
