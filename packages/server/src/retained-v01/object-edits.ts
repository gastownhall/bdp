/** Literal ordinary JSON Patch, independent of storage and Types policy. */
import {
  JsonNumberLiteral,
  snapshotJsonValue,
  stringifyJsonValue,
  type AdmittedJsonValue,
  type LosslessJsonValue,
} from "@bdp/protocol";

export type ObjectChange = readonly (
  | { readonly op: "add" | "replace"; readonly path: string; readonly value: AdmittedJsonValue }
  | { readonly op: "remove"; readonly path: string }
)[];
export const EDIT_LIMITS = Object.freeze({ operations: 100, pathBytes: 2048, pathDepth: 64 });

/** Carrier syntax only. Bounds and state-dependent patch checks follow key comparison. */
export function assertObjectChange(value: LosslessJsonValue): void {
  if (!Array.isArray(value)) throw new TypeError("patch must be an array");
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      item instanceof JsonNumberLiteral
    )
      throw new TypeError("patch member must be an object");
    const entry = item as Record<string, LosslessJsonValue>;
    const names = entry.op === "remove" ? ["op", "path"] : ["op", "path", "value"];
    if (
      typeof entry.op !== "string" ||
      !["add", "replace", "remove"].includes(entry.op) ||
      Object.keys(entry).some((name) => !names.includes(name)) ||
      (entry.op !== "remove" && !Object.hasOwn(entry, "value")) ||
      typeof entry.path !== "string" ||
      !/^(?:\/(?:[^/~]|~[01])*)*$/.test(entry.path)
    )
      throw new TypeError("invalid ordinary patch member");
  }
}
export function exceedsEditLimits(changes: readonly ObjectChange[]): boolean {
  return (
    changes.reduce((count, change) => count + change.length, 0) > EDIT_LIMITS.operations ||
    changes.some((change) =>
      change.some(
        ({ path }) =>
          Buffer.byteLength(path) > EDIT_LIMITS.pathBytes ||
          (path === "" ? 0 : path.split("/").length - 1) > EDIT_LIMITS.pathDepth,
      ),
    )
  );
}
export class ObjectEditFailure extends Error {
  constructor(
    message: string,
    readonly pointer: string,
  ) {
    super(message);
  }
}
function copy(value: AdmittedJsonValue): AdmittedJsonValue {
  return JSON.parse(stringifyJsonValue(value)) as AdmittedJsonValue;
}
export function applyObjectChange(
  before: Readonly<Record<string, AdmittedJsonValue>>,
  changes: ObjectChange,
): Readonly<Record<string, AdmittedJsonValue>> {
  let result: AdmittedJsonValue | undefined = copy(before);
  for (const change of changes) {
    const invalid = (message: string): never => {
      throw new ObjectEditFailure(message, change.path);
    };
    const tokens =
      change.path === ""
        ? []
        : change.path
            .slice(1)
            .split("/")
            .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (!tokens.length) {
      if (change.op !== "add" && result === undefined) invalid("patch target does not exist");
      result = change.op === "remove" ? undefined : copy(change.value);
      continue;
    }
    let parent: unknown = result;
    for (const token of tokens.slice(0, -1)) {
      if (
        !parent ||
        typeof parent !== "object" ||
        !Object.hasOwn(parent, token) ||
        (Array.isArray(parent) && !/^(?:0|[1-9][0-9]*)$/.test(token))
      )
        invalid("patch parent does not exist");
      parent = (parent as Record<string, unknown>)[token];
    }
    const key = tokens.at(-1);
    if (key === undefined || !parent || typeof parent !== "object")
      invalid("patch target does not exist");
    const name = key as string;
    if (Array.isArray(parent)) {
      const index =
        name === "-" && change.op === "add"
          ? parent.length
          : /^(?:0|[1-9][0-9]*)$/.test(name)
            ? Number(name)
            : NaN;
      if (
        !Number.isSafeInteger(index) ||
        index > parent.length ||
        (change.op !== "add" && index === parent.length)
      )
        invalid("patch array index does not exist");
      if (change.op === "add") parent.splice(index, 0, copy(change.value));
      else if (change.op === "remove") parent.splice(index, 1);
      else parent[index] = copy(change.value);
    } else {
      if (change.op !== "add" && !Object.hasOwn(parent as object, name))
        invalid("patch target does not exist");
      if (change.op === "remove") delete (parent as Record<string, unknown>)[name];
      else
        Object.defineProperty(parent, name, {
          value: copy(change.value),
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new ObjectEditFailure("resulting document must be an object", "");
  return snapshotJsonValue(result) as Readonly<Record<string, AdmittedJsonValue>>;
}
