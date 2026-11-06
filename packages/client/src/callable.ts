import {
  type AdmittedJsonValue,
  admitJsonNumbers,
  assertCanonicalPathSegments,
  decodeJsonDocument,
  parseCanonicalHttpUrl,
  parseRetainedProblem,
  type RetainedJsonObject,
  snapshotJsonValue,
} from "@bdp/protocol";

export const CALLABLE_QUERY_TYPE =
  "https://github.com/gastownhall/bdp/types/callable/callable-query";
export const CALLABLE_BATCH_TYPE =
  "https://github.com/gastownhall/bdp/types/callable/callable-batch";

/** An embedded JSON Schema value whose every `$ref` resolves inside itself (Callables §2.3). */
export type CallableValueSchema = boolean | Readonly<Record<string, AdmittedJsonValue>>;

export interface CallableParameter {
  readonly name: string;
  readonly schema: CallableValueSchema;
  readonly required?: boolean;
  readonly default?: AdmittedJsonValue;
  readonly description?: string;
}

export interface CallableCliMapping {
  readonly flags?: readonly { readonly names: readonly string[]; readonly parameter: string }[];
  readonly positionals?: readonly { readonly position: number; readonly parameter: string }[];
  readonly fromFile?: readonly { readonly names: readonly string[]; readonly parameter: string }[];
}

/** A declaration in the Callables shape, plus its name and Type, however it was learned. */
export interface CallableDeclaration {
  readonly name: string;
  readonly type: typeof CALLABLE_QUERY_TYPE | typeof CALLABLE_BATCH_TYPE;
  readonly title?: string;
  readonly description: string;
  readonly parameters: readonly CallableParameter[];
  readonly resultSchema?: CallableValueSchema;
  readonly errorSchema?: CallableValueSchema;
  readonly idempotent?: boolean;
  readonly atomic?: boolean;
  readonly cliMapping?: CallableCliMapping;
}

/** What can be called. Nothing above this seam may assume where the declarations came from;
 * it is asynchronous because an implementation may read `GET <scope>/bdp/call` or Beads. */
export interface CallableCatalog {
  list(): Promise<readonly CallableDeclaration[]>;
  get(name: string): Promise<CallableDeclaration | undefined>;
}

/** A catalog over declarations the caller already holds. `load` runs once, at first use. */
export function createStaticCallableCatalog(
  load: () => readonly CallableDeclaration[],
): CallableCatalog {
  let index: ReadonlyMap<string, CallableDeclaration> | undefined;
  const declarations = (): ReadonlyMap<string, CallableDeclaration> => {
    index ??= new Map(load().map((declaration) => [declaration.name, declaration]));
    return index;
  };
  return Object.freeze({
    list: async () => [...declarations().values()],
    get: async (name: string) => declarations().get(name),
  });
}

const LITERAL_PATH_CHARACTER = /^[A-Za-z0-9._~!$&'()*+,;=:@-]$/;
const PROBLEM_FAMILIES = "https://github.com/gastownhall/bdp/problems/";
const ADDED_PROBLEMS: Readonly<
  Record<string, { readonly family: string; readonly status: number }>
> = Object.freeze({
  "callable-not-found": { family: "not-found", status: 404 },
  "callable-unavailable": { family: "unavailable", status: 503 },
  "callable-error": { family: "conflict", status: 409 },
});

function encodeSegment(segment: string): string {
  let encoded = "";
  for (const character of segment) {
    if (LITERAL_PATH_CHARACTER.test(character)) {
      encoded += character;
      continue;
    }
    for (const byte of new TextEncoder().encode(character))
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

/** Callables §3: `<scope>/bdp/call/` and the name, each segment encoded as in a canonical URL.
 * Throws on a name no canonical URL can spell. */
export function callableMount(scope: string, name: string): string {
  const path = name.split("/").map(encodeSegment).join("/");
  assertCanonicalPathSegments(path, "Callable name");
  return parseCanonicalHttpUrl(`${scope}bdp/call/${path}`);
}

function object(text: string): RetainedJsonObject {
  const admitted = admitJsonNumbers(decodeJsonDocument(text), {
    diagnostics: 1,
    diagnostic: () => ({ message: "inadmissible JSON number" }),
  });
  if (!admitted.ok) throw new TypeError("Callable response has an inadmissible number");
  const value = snapshotJsonValue(admitted.value);
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Callable response must be a JSON object");
  return value as RetainedJsonObject;
}

/** The closed `callableResult`. The value itself is not checked against `resultSchema`:
 * Callables §5 leaves that to a client that wants it. */
export function parseCallableResult(text: string, kind: "query" | "batch"): RetainedJsonObject {
  const value = object(text);
  if (
    !Object.hasOwn(value, "result") ||
    Object.keys(value).some((key) => key !== "result" && key !== "changed") ||
    (kind === "batch" ? typeof value.changed !== "boolean" : Object.hasOwn(value, "changed"))
  )
    throw new TypeError("invalid callableResult");
  return value;
}

/** A Problem from a mount: a code Callables adds, with its fixed family, status and retry, or
 * a Core or Write Problem. Every member, including `error`, is the received value. */
export function parseCallableProblem(text: string, status: number): RetainedJsonObject {
  const value = object(text);
  const added =
    typeof value.code === "string" && Object.hasOwn(ADDED_PROBLEMS, value.code)
      ? ADDED_PROBLEMS[value.code]
      : undefined;
  if (added === undefined) return parseRetainedProblem(text, status);
  if (
    status !== added.status ||
    (value.status !== undefined && value.status !== status) ||
    value.type !== `${PROBLEM_FAMILIES}${added.family}` ||
    value.retry !== "after-state-change" ||
    Object.hasOwn(value, "error") !== (value.code === "callable-error")
  )
    throw new TypeError("invalid Callables Problem");
  return value;
}
