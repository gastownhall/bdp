import type { AdmittedJsonValue } from "@bdp/protocol";

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
