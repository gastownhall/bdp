import type { CallableDeclaration, CallableParameter, CallableValueSchema } from "@bdp/client";
import { CALLABLE_QUERY_TYPE } from "@bdp/client";
import { type AdmittedJsonValue, admitJsonNumbers, decodeJsonDocument } from "@bdp/protocol";
import { CanonicalInputError } from "./canonical-input.js";

/** Flags §10 gives every Callable; a parameter deriving one is reachable only by `--arguments`. */
const RESERVED_FLAGS = new Set(["--arguments", "--help"]);
/** Literal client spellings, safe to name in a diagnostic. They belong before NAME (§10). */
const CLIENT_FLAGS = new Set([
  "--actor",
  "--cli-profile",
  "--config",
  "--idempotency-key",
  "--output-format",
  "--output-mode",
  "--revision-provenance",
  "--scope",
]);

/** Diagnostics name flags a declaration owns and never echo a supplied value. */
export class CallableUsageError extends CanonicalInputError {}
const refuse = (message: string): never => {
  throw new CallableUsageError(message);
};

/** §10: split at `_`, `-` and lower-to-upper boundaries, lowercase, join with `-`. */
export function parameterFlag(name: string): string {
  const words = name
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1-$2")
    .split(/[_-]+/)
    .filter((word) => word.length > 0);
  return `--${words.join("-").toLowerCase()}`;
}

type SchemaObject = Readonly<Record<string, AdmittedJsonValue>>;
const asObject = (schema: unknown): SchemaObject | undefined =>
  schema !== null && typeof schema === "object" && !Array.isArray(schema)
    ? (schema as SchemaObject)
    : undefined;

/** Follow `$ref`s, which §2.3 confines to the document that carries them. */
function dereference(schema: unknown, root: CallableValueSchema): SchemaObject | undefined {
  const seen = new Set<string>();
  let current = asObject(schema);
  while (current !== undefined && typeof current.$ref === "string" && current.type === undefined) {
    const ref: string = current.$ref;
    if (seen.has(ref) || !ref.startsWith("#/")) return undefined;
    seen.add(ref);
    let target: unknown = root;
    for (const part of ref.slice(2).split("/"))
      target = asObject(target)?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    current = asObject(target);
  }
  return current;
}

/** Whether a schema admits strings and nothing else, however it says so. */
function onlyStrings(schema: unknown, root: CallableValueSchema): boolean {
  const node = dereference(schema, root);
  if (node === undefined) return false;
  if (node.type !== undefined) return node.type === "string";
  if (Array.isArray(node.enum))
    return node.enum.length > 0 && node.enum.every((value) => typeof value === "string");
  if (Object.hasOwn(node, "const")) return typeof node.const === "string";
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = node[keyword];
    if (Array.isArray(branches))
      return branches.length > 0 && branches.every((branch) => onlyStrings(branch, root));
  }
  return Array.isArray(node.allOf) && node.allOf.some((branch) => onlyStrings(branch, root));
}

type ItemForm = "text" | "json";
type ValueForm =
  | { readonly kind: "boolean" }
  | { readonly kind: "array"; readonly item: ItemForm }
  | { readonly kind: "single"; readonly item: ItemForm };

/** The §10 table: boolean, array, string, and JSON for any other non-string schema. */
function valueForm({ schema }: CallableParameter): ValueForm {
  const node = dereference(schema, schema);
  if (node?.type === "boolean") return { kind: "boolean" };
  if (node?.type === "array")
    return { kind: "array", item: onlyStrings(node.items, schema) ? "text" : "json" };
  return { kind: "single", item: onlyStrings(schema, schema) ? "text" : "json" };
}

interface FlagBinding {
  readonly parameter: CallableParameter;
  readonly form: ValueForm;
  readonly negated: boolean;
  /** A `cliMapping.fromFile` spelling: its value is a path, and `-` means stdin. */
  readonly file: boolean;
}
interface FlagTable {
  /** undefined marks a spelling two parameters share: no use of it can be honest. */
  readonly flags: ReadonlyMap<string, FlagBinding | undefined>;
  readonly collisions: ReadonlySet<string>;
}

function flagTable(declaration: CallableDeclaration): FlagTable {
  const flags = new Map<string, FlagBinding | undefined>();
  const collisions = new Set<string>();
  const claim = (spelling: string, binding: FlagBinding): void => {
    if (RESERVED_FLAGS.has(spelling)) collisions.add(spelling);
    else if (flags.has(spelling)) {
      collisions.add(spelling);
      if (flags.get(spelling)?.parameter !== binding.parameter) flags.set(spelling, undefined);
    } else flags.set(spelling, binding);
  };
  const bindings = declaration.parameters.map((parameter) => ({
    parameter,
    form: valueForm(parameter),
    negated: false,
    file: false,
  }));
  for (const binding of bindings) claim(parameterFlag(binding.parameter.name), binding);
  for (const mapping of declaration.cliMapping?.flags ?? []) {
    const binding = bindings.find(({ parameter }) => parameter.name === mapping.parameter);
    if (binding !== undefined) for (const name of mapping.names) claim(name, binding);
  }
  for (const mapping of declaration.cliMapping?.fromFile ?? []) {
    const binding = bindings.find(({ parameter }) => parameter.name === mapping.parameter);
    if (binding !== undefined)
      for (const name of mapping.names) claim(name, { ...binding, file: true });
  }
  // §10: a parameter declared with the flag `--no-x` keeps it, and `x` then has no derived one.
  for (const binding of bindings)
    if (binding.form.kind === "boolean") {
      const spelling = `--no-${parameterFlag(binding.parameter.name).slice(2)}`;
      if (!flags.has(spelling) && !RESERVED_FLAGS.has(spelling))
        flags.set(spelling, { ...binding, negated: true });
    }
  return { flags, collisions };
}

/** The spellings §2.5 would call invalid: shared, or taken from a flag §10 reserves. */
export function callableFlagCollisions(declaration: CallableDeclaration): readonly string[] {
  return [...flagTable(declaration).collisions];
}

function jsonValue(text: string): AdmittedJsonValue | undefined {
  try {
    const admitted = admitJsonNumbers(decodeJsonDocument(text), {
      diagnostics: 1,
      diagnostic: () => ({ message: "inadmissible JSON number" }),
    });
    return admitted.ok ? admitted.value : undefined;
  } catch {
    return undefined;
  }
}

/** A `cliMapping.fromFile` flag whose content is that parameter's flag value (§10). */
export interface CallableFileInput {
  readonly spelling: string;
  readonly parameter: CallableParameter;
  readonly path: string;
}
export type ParsedCallableArguments =
  | { readonly help: true }
  | {
      readonly help: false;
      readonly arguments: Readonly<Record<string, AdmittedJsonValue>>;
      readonly files: readonly CallableFileInput[];
    };

/** One Callable's arguments from the tokens after NAME. Offline and without a schema check:
 * §4 makes checking the service's job. Omission stays omission here; files and
 * `cliMapping.defaults` are applied by completeCallableArguments. */
export function parseCallableArguments(
  declaration: CallableDeclaration,
  tokens: readonly string[],
): ParsedCallableArguments {
  const { flags } = flagTable(declaration);
  const supplied = new Map<string, AdmittedJsonValue>();
  const operands: string[] = [];
  const files: CallableFileInput[] = [];
  let whole: Record<string, AdmittedJsonValue> | undefined;
  const convert = (text: string, item: ItemForm, label: string): AdmittedJsonValue => {
    if (item === "text") return text;
    const value = jsonValue(text);
    return value === undefined ? refuse(`${label} requires a JSON value`) : value;
  };
  const bind = ({ name }: CallableParameter, form: ValueForm, value: AdmittedJsonValue): void => {
    const held = supplied.get(name);
    if (form.kind === "array")
      supplied.set(name, [...((held as AdmittedJsonValue[] | undefined) ?? []), value]);
    else if (supplied.has(name) || files.some(({ parameter }) => parameter.name === name))
      refuse(`${parameterFlag(name)} may be given only once`);
    else supplied.set(name, value);
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (token === "--") {
      operands.push(...tokens.slice(index + 1));
      break;
    }
    if (token === "--help" || (token === "-h" && !flags.has("-h"))) return { help: true };
    if (!token.startsWith("-") || token === "-" || /^-[0-9.]/.test(token)) {
      operands.push(token);
      continue;
    }
    const at = token.indexOf("=");
    const spelling = at < 0 ? token : token.slice(0, at);
    const inline = at < 0 ? undefined : token.slice(at + 1);
    const nextValue = (): string => {
      if (inline !== undefined) return inline;
      const next = tokens[index + 1];
      if (next === undefined || next.startsWith("--"))
        return refuse(`${spelling} requires a value`);
      index++;
      return next;
    };
    if (spelling === "--arguments") {
      if (whole !== undefined) refuse("--arguments may be given only once");
      const value = jsonValue(nextValue());
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return refuse("--arguments requires one JSON object");
      whole = value as Record<string, AdmittedJsonValue>;
      continue;
    }
    if (CLIENT_FLAGS.has(spelling) && !flags.has(spelling))
      return refuse(`that flag is a client option; put ${spelling} before the command`);
    if (!flags.has(spelling))
      return refuse("a flag is not a parameter of this Callable; use --help for its form");
    const binding = flags.get(spelling);
    if (binding === undefined)
      return refuse(`${spelling} belongs to more than one parameter; use --arguments`);
    if (binding.file) {
      const path = nextValue();
      if (path === "") refuse(`${spelling} requires a path`);
      if (path === "-" && files.some((file) => file.path === "-"))
        refuse("only one flag may read stdin");
      const held = binding.form.kind !== "array" && supplied.has(binding.parameter.name);
      if (held || (binding.form.kind !== "array" && files.some(sameParameter(binding))))
        refuse(`${parameterFlag(binding.parameter.name)} may be given only once`);
      files.push({ spelling, parameter: binding.parameter, path });
    } else if (binding.form.kind === "boolean") {
      if (inline !== undefined) refuse(`${spelling} takes no value`);
      bind(binding.parameter, binding.form, !binding.negated);
    } else bind(binding.parameter, binding.form, convert(nextValue(), binding.form.item, spelling));
  }
  const positions = declaration.cliMapping?.positionals ?? [];
  let unmapped = 0;
  operands.forEach((operand, position) => {
    const mapped = positions.find((entry) => entry.position === position);
    const parameter = declaration.parameters.find(({ name }) => name === mapped?.parameter);
    if (parameter === undefined) {
      unmapped++;
      return;
    }
    const form = valueForm(parameter);
    bind(
      parameter,
      form,
      convert(operand, form.kind === "boolean" ? "json" : form.item, parameterFlag(parameter.name)),
    );
  });
  if (unmapped > 0) refuse(`${unmapped} unmapped operand(s); use --help for this Callable's form`);
  return {
    help: false,
    arguments: Object.fromEntries([...Object.entries(whole ?? {}), ...supplied]),
    files,
  };
}

const sameParameter =
  ({ parameter }: FlagBinding) =>
  (file: CallableFileInput): boolean =>
    file.parameter.name === parameter.name;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The invocation's final arguments: each `fromFile` content is treated as that parameter's flag
 * value, then `cliMapping.defaults` fills what is still not supplied. A supplied `null` counts. */
export async function completeCallableArguments(
  declaration: CallableDeclaration,
  parsed: Extract<ParsedCallableArguments, { help: false }>,
  read: (path: string) => Promise<Uint8Array>,
): Promise<Readonly<Record<string, AdmittedJsonValue>>> {
  const complete: Record<string, AdmittedJsonValue> = { ...parsed.arguments };
  for (const { spelling, parameter, path } of parsed.files) {
    let bytes: Uint8Array;
    try {
      bytes = await read(path);
    } catch (error) {
      const reason = (error as NodeJS.ErrnoException).code ?? "not readable";
      return refuse(`${spelling} could not read its input (${reason})`);
    }
    let text: string;
    try {
      text = utf8.decode(bytes);
    } catch {
      return refuse(`${spelling} requires UTF-8 text`);
    }
    const form = valueForm(parameter);
    const item = form.kind === "boolean" ? "json" : form.item;
    const value: AdmittedJsonValue =
      item === "text" ? text : (jsonValue(text) ?? refuse(`${spelling} requires a JSON value`));
    complete[parameter.name] =
      form.kind === "array"
        ? [...((complete[parameter.name] as AdmittedJsonValue[] | undefined) ?? []), value]
        : value;
  }
  for (const [name, value] of Object.entries(declaration.cliMapping?.defaults ?? {}))
    if (!Object.hasOwn(complete, name)) complete[name] = value;
  return complete;
}

export function callableKind({ type }: CallableDeclaration): "query" | "batch" {
  return type === CALLABLE_QUERY_TYPE ? "query" : "batch";
}

export function callableCatalogItem(declaration: CallableDeclaration): SchemaObject {
  return {
    name: declaration.name,
    kind: callableKind(declaration),
    type: declaration.type,
    ...(declaration.title === undefined ? {} : { title: declaration.title }),
  };
}

/** A catalog may come from a server, so its text reaches the terminal without controls. */
function clean(text: string): string {
  return Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "\n" || (code >= 32 && code < 127) || code > 159 ? character : " ";
  }).join("");
}

function errorLines(schema: CallableValueSchema): readonly string[] {
  const node = dereference(schema, schema);
  if (Array.isArray(node?.oneOf)) {
    const lines = node.oneOf.map((branch) => {
      const arm = dereference(branch, schema);
      const fixed = Object.entries(asObject(arm?.properties) ?? {}).find(([, member]) =>
        Object.hasOwn(asObject(member) ?? {}, "const"),
      );
      const label = fixed
        ? `${fixed[0]} ${JSON.stringify(asObject(fixed[1])?.const)}`
        : JSON.stringify(branch);
      return typeof arm?.description === "string" ? `${label}: ${arm.description}` : label;
    });
    return lines;
  }
  const fixed = Array.isArray(node?.allOf)
    ? node.allOf.flatMap((branch) =>
        Object.entries(asObject(dereference(branch, schema)?.properties) ?? {}).flatMap(
          ([member, value]) => {
            const held = asObject(value);
            return Array.isArray(held?.enum)
              ? [`${member}: ${held.enum.map((item) => String(item)).join(", ")}`]
              : [];
          },
        ),
      )
    : [];
  if (fixed.length > 0)
    return [...(typeof node?.description === "string" ? [node.description] : []), ...fixed];
  const { $defs: _defs, ...shown } = (asObject(schema) ?? { schema }) as Record<string, unknown>;
  return [JSON.stringify(shown)];
}

const positionalWords = (declaration: CallableDeclaration): string =>
  [...(declaration.cliMapping?.positionals ?? [])]
    .sort((left, right) => left.position - right.position)
    .map(({ parameter }) => {
      const word = parameterFlag(parameter).slice(2).toUpperCase();
      const required = declaration.parameters.find(({ name }) => name === parameter)?.required;
      return required ? `${word} ` : `[${word}] `;
    })
    .join("");

/** §10: title, description, the parameters and any declared errors, without invoking.
 * `command` is how the Callable was reached; it defaults to `call NAME`. */
export function renderCallableHelp(
  declaration: CallableDeclaration,
  command: readonly string[] = ["call", declaration.name],
): string {
  const { flags } = flagTable(declaration);
  const promises = [
    callableKind(declaration) === "query" ? "CallableQuery" : "CallableBatch",
    ...(declaration.idempotent ? ["idempotent"] : []),
    ...(declaration.atomic ? ["atomic"] : []),
  ];
  const lines = [
    ...(declaration.title === undefined ? [] : [declaration.title, ""]),
    `${declaration.name} (${promises.join("; ")})`,
    "",
    declaration.description,
    "",
    `Usage: bdp [client options] ${command.join(" ")} ${positionalWords(declaration)}[callable arguments]`,
    ...(command[0] === "call" ? [] : [`  Or:  bdp [client options] call ${declaration.name} ...`]),
    "",
  ];
  if (declaration.parameters.length > 0) lines.push("Parameters:");
  for (const parameter of declaration.parameters) {
    const form = valueForm(parameter);
    const spellings = [...flags].flatMap(([spelling, binding]) =>
      binding?.parameter === parameter && !binding.file ? [spelling] : [],
    );
    const fileSpellings = [...flags].flatMap(([spelling, binding]) =>
      binding?.parameter === parameter && binding.file ? [spelling] : [],
    );
    const defaults = declaration.cliMapping?.defaults;
    const shown = spellings.length > 0 ? spellings.join(", ") : "(--arguments only)";
    const placeholder = form.kind === "boolean" ? "" : form.item === "text" ? " TEXT" : " JSON";
    const position = declaration.cliMapping?.positionals?.find(
      (entry) => entry.parameter === parameter.name,
    )?.position;
    const notes = [
      ...(position === undefined ? [] : [`position ${position}`]),
      ...(parameter.required ? ["required"] : []),
      ...(form.kind === "array" ? ["repeatable"] : []),
      ...(Object.hasOwn(parameter, "default")
        ? [`default ${JSON.stringify(parameter.default)}`]
        : []),
      ...(defaults !== undefined && Object.hasOwn(defaults, parameter.name)
        ? [`client sends ${JSON.stringify(defaults[parameter.name])} when not given`]
        : []),
    ];
    lines.push(`  ${shown}${placeholder}${notes.length > 0 ? `  (${notes.join("; ")})` : ""}`);
    if (fileSpellings.length > 0)
      lines.push(`  ${fileSpellings.join(", ")} PATH  (the value read from a file; - is stdin)`);
    if (parameter.description !== undefined) lines.push(`      ${parameter.description}`);
  }
  lines.push(
    ...(declaration.parameters.length > 0 ? [""] : []),
    "Generic:",
    "  --arguments JSON  Supply the whole arguments object; explicit flags override its members.",
    "  --help            Print this help without invoking.",
    "",
  );
  if (declaration.errorSchema !== undefined)
    lines.push("Errors:", ...errorLines(declaration.errorSchema).map((line) => `  ${line}`), "");
  return `${clean(lines.join("\n"))}`;
}
