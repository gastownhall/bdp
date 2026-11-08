/**
 * The Callables profile mechanism (`specs/profiles/callables/callables.md`), preview-1.
 * Generic: it knows declarations, mounts, argument checking, results and problems, and
 * nothing of what any operation means. A provider binds a name to its implementation;
 * that binding is no part of a declaration (§6) and is not stored.
 */
import {
  admitJsonNumbers,
  type AdmittedJsonValue,
  decodeJsonDocument,
  JsonNumberLiteral,
  type LosslessJsonValue,
  parseRetainedRevisionProvenanceInput,
  type RetainedRevisionProvenanceInput,
  snapshotJsonValue,
} from "@bdp/protocol";
import { CONTRACT_ARTIFACT_CEILINGS } from "../installed-contract-artifact.js";
import {
  compilePrivateSchemaEvaluator,
  EVALUATOR_CEILINGS,
} from "../installed-schema-evaluator.js";
import { SCHEMA_GRAPH_CEILINGS } from "../installed-schema-shape.js";
import { encodeSemanticValue, type SemanticValue } from "../semantic-identity.js";
import {
  canonicalLocalReference,
  closed,
  type JsonObject,
  problem,
  RETAINED_MEDIA,
  record,
  RetainedRequestError,
  serialized,
} from "./contract.js";

export const CALLABLES_CAPABILITY = "https://github.com/gastownhall/bdp/capabilities/callables";
const TYPE_ROOT = "https://github.com/gastownhall/bdp/types/callable/";
export const CALLABLE_ABSTRACT_TYPE = `${TYPE_ROOT}callable`;
export const CALLABLE_QUERY_TYPE = `${TYPE_ROOT}callable-query`;
export const CALLABLE_BATCH_TYPE = `${TYPE_ROOT}callable-batch`;
export const OPENAPI_MEDIA = "application/vnd.oai.openapi+json";
export type CallableKind = "query" | "batch";
/** Local name of the §7 root Bead. */
export const CALLABLES_ROOT = "sys/callables";

export interface Diagnostic {
  readonly message: string;
  readonly instanceLocation?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof JsonNumberLiteral);
const isValueSchema = (value: unknown): boolean => typeof value === "boolean" || isObject(value);

interface CompiledSchema {
  check(text: string): "valid" | "invalid" | "refused";
}
const compiledSchemas = new Map<string, CompiledSchema | string>();
const utf8 = new TextEncoder();
/** A compiled evaluator, or the true reason this schema cannot be served. */
function compileSchema(schema: unknown): CompiledSchema | string {
  const text = serialized(schema);
  const cached = compiledSchemas.get(text);
  if (cached !== undefined) return cached;
  const retrievalUri = "https://callables.invalid/value-schema";
  const compiled = compilePrivateSchemaEvaluator({
    bundle: {
      descriptors: [],
      schemas: [{ retrievalUri, utf8Bytes: utf8.encode(text) }],
      limits: CONTRACT_ARTIFACT_CEILINGS,
    },
    graphLimits: SCHEMA_GRAPH_CEILINGS,
    entry: { kind: "schema", retrievalUri },
    limits: EVALUATOR_CEILINGS,
  });
  const outcome: CompiledSchema | string =
    compiled.kind === "refused"
      ? `this schema cannot be evaluated (${compiled.reason}); a $ref must resolve inside its document`
      : {
          check(value) {
            const result = compiled.evaluateUtf8(utf8.encode(value));
            return result.kind === "refused" ? "refused" : result.valid ? "valid" : "invalid";
          },
        };
  if (compiledSchemas.size >= 4096) compiledSchemas.clear();
  compiledSchemas.set(text, outcome);
  return outcome;
}

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .split(/[_-]/)
    .filter(Boolean)
    .join("-")
    .toLowerCase();
}

/**
 * §§2.2-2.5: the structural shape and the semantic checks the schema cannot express.
 * An empty list means this is a declaration a provider may serve.
 */
export function declarationDiagnostics(properties: unknown): readonly Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (message: string, instanceLocation?: string) =>
    out.push({ message, ...(instanceLocation === undefined ? {} : { instanceLocation }) });
  if (!isObject(properties)) return [{ message: "a declaration's properties must be an object" }];
  if (Object.hasOwn(properties, "body"))
    add("`body` is rejected in this edition of Callables", "/body");
  if (typeof properties.description !== "string") add("`description` is required", "/description");
  if (properties.title !== undefined && typeof properties.title !== "string")
    add("`title` must be text", "/title");
  for (const name of ["atomic", "idempotent"])
    if (properties[name] !== undefined && typeof properties[name] !== "boolean")
      add(`\`${name}\` must be boolean`, `/${name}`);
  for (const name of ["resultSchema", "errorSchema"]) {
    if (properties[name] === undefined) continue;
    if (!isValueSchema(properties[name]))
      add(`\`${name}\` must be an object or boolean`, `/${name}`);
    else {
      const compiled = compileSchema(properties[name]);
      if (typeof compiled === "string") add(`\`${name}\`: ${compiled}`, `/${name}`);
    }
  }
  const parameters = properties.parameters;
  const byName = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(parameters)) add("`parameters` is required", "/parameters");
  else
    for (const [index, candidate] of (parameters as readonly unknown[]).entries()) {
      const at = `/parameters/${index}`;
      if (!isObject(candidate)) {
        add("a parameter must be an object", at);
        continue;
      }
      for (const key of Object.keys(candidate))
        if (!["default", "description", "name", "required", "schema"].includes(key))
          add(`unknown parameter member \`${key}\``, `${at}/${key}`);
      const name = candidate.name;
      if (typeof name !== "string" || name === "") {
        add("a parameter needs a nonempty `name`", `${at}/name`);
        continue;
      }
      if (byName.has(name)) add(`duplicate parameter \`${name}\``, `${at}/name`);
      byName.set(name, candidate);
      if (candidate.description !== undefined && typeof candidate.description !== "string")
        add(`\`${name}\`: \`description\` must be text`, `${at}/description`);
      if (candidate.required !== undefined && typeof candidate.required !== "boolean")
        add(`\`${name}\`: \`required\` must be boolean`, `${at}/required`);
      if (candidate.required === true && Object.hasOwn(candidate, "default"))
        add(`\`${name}\`: \`required\` together with \`default\``, at);
      if (!isValueSchema(candidate.schema)) {
        add(`\`${name}\`: \`schema\` is required`, `${at}/schema`);
        continue;
      }
      const compiled = compileSchema(candidate.schema);
      if (typeof compiled === "string") {
        add(`\`${name}\`: ${compiled}`, `${at}/schema`);
        continue;
      }
      if (
        Object.hasOwn(candidate, "default") &&
        compiled.check(serialized(candidate.default)) !== "valid"
      )
        add(`\`${name}\`: its \`default\` fails its \`schema\``, `${at}/default`);
    }
  cliMappingDiagnostics(properties.cliMapping, byName, add);
  return out;
}

/** The members an object schema declares, through a reference inside its own document. */
function schemaMembers(schema: unknown): unknown {
  if (!isObject(schema)) return undefined;
  if (typeof schema.$ref === "string" && schema.$ref.startsWith("#/$defs/")) {
    const defs = schema.$defs;
    const target = isObject(defs) ? defs[schema.$ref.slice("#/$defs/".length)] : undefined;
    return isObject(target) ? target.properties : undefined;
  }
  return schema.properties;
}

function cliMappingDiagnostics(
  mapping: unknown,
  parameters: ReadonlyMap<string, Record<string, unknown>>,
  add: (message: string, location?: string) => void,
): void {
  if (mapping === undefined) return;
  if (!isObject(mapping)) {
    add("`cliMapping` must be an object", "/cliMapping");
    return;
  }
  const declared = new Map<string, string>();
  const noForms = new Set<string>();
  // Duplicates are judged over derived and added spellings together (§2.5).
  for (const [name, parameter] of parameters) {
    if (name === "actor") continue;
    declared.set(`--${kebab(name)}`, name);
    if (isObject(parameter.schema) && parameter.schema.type === "boolean")
      noForms.add(`--no-${kebab(name)}`);
  }
  const claim = (spelling: string, owner: string, location: string) => {
    const holder = declared.get(spelling);
    if (holder !== undefined && holder !== owner)
      add(`duplicate flag spelling \`${spelling}\``, location);
    declared.set(spelling, owner);
  };
  const named = (value: unknown, location: string): value is string => {
    if (typeof value === "string" && parameters.has(value)) return true;
    add("a mapping names an undeclared parameter", location);
    return false;
  };
  const list = (key: string, keys: readonly string[]) => {
    const value = mapping[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      add(`\`cliMapping.${key}\` must be an array`, `/cliMapping/${key}`);
      return [];
    }
    return value.flatMap((entry: unknown, index) => {
      const at = `/cliMapping/${key}/${index}`;
      if (!isObject(entry) || Object.keys(entry).some((name) => !keys.includes(name))) {
        add(`malformed \`cliMapping.${key}\` entry`, at);
        return [];
      }
      return [{ entry, at }];
    });
  };
  for (const key of Object.keys(mapping))
    if (!["flags", "fromFile", "memberFlags", "positionals"].includes(key))
      add(`unknown cliMapping member \`${key}\``, `/cliMapping/${key}`);
  for (const group of ["flags", "fromFile"]) {
    for (const { entry, at } of list(group, ["names", "parameter"])) {
      if (!named(entry.parameter, `${at}/parameter`)) continue;
      if (!Array.isArray(entry.names) || entry.names.length === 0) {
        add("`names` needs at least one spelling", `${at}/names`);
        continue;
      }
      for (const spelling of entry.names) {
        if (typeof spelling !== "string" || spelling === "")
          add("a flag spelling must be nonempty", `${at}/names`);
        else if (declared.get(spelling) === entry.parameter && group === "flags")
          add(`duplicate flag spelling \`${spelling}\``, `${at}/names`);
        else claim(spelling, entry.parameter as string, `${at}/names`);
      }
    }
  }
  const positions = new Set<number>();
  for (const { entry, at } of list("positionals", ["parameter", "position"])) {
    named(entry.parameter, `${at}/parameter`);
    const position =
      entry.position instanceof JsonNumberLiteral ? Number(entry.position.literal) : entry.position;
    if (typeof position !== "number" || !Number.isInteger(position) || position < 0)
      add("`position` must be an integer of at least 0", `${at}/position`);
    else if (positions.has(position)) add(`duplicate position ${position}`, `${at}/position`);
    else positions.add(position);
  }
  for (const { entry, at } of list("memberFlags", ["member", "names", "parameter"])) {
    if (!named(entry.parameter, `${at}/parameter`)) continue;
    const parameter = parameters.get(entry.parameter as string);
    const members = schemaMembers(parameter?.schema);
    const member = entry.member;
    if (typeof member !== "string" || !isObject(members) || !Object.hasOwn(members, member)) {
      add("a member mapping names a member the parameter's schema does not declare", at);
      continue;
    }
    if (member === "actor" || member === "author") add(`a member named \`${member}\``, at);
    const spellings = [`--${kebab(member)}`, ...(Array.isArray(entry.names) ? entry.names : [])];
    for (const spelling of spellings) {
      if (typeof spelling !== "string" || spelling === "") continue;
      if (["--actor", "--author", "--arguments", "--help"].includes(spelling))
        add(`a member flag spelled \`${spelling}\``, at);
      else claim(spelling, `${entry.parameter as string}.${member}`, at);
    }
  }
  // A derived `--no-x` yields to a declared parameter (§2.5, §10); nothing to record.
  void noForms;
}

export interface CallableDeclaration {
  readonly id: string;
  readonly name: string;
  readonly kind: CallableKind;
  readonly revision: string;
  readonly properties: JsonObject;
}

export function callableKind(type: unknown): CallableKind | undefined {
  const uri = isObject(type) ? type.uri : type;
  return uri === CALLABLE_QUERY_TYPE ? "query" : uri === CALLABLE_BATCH_TYPE ? "batch" : undefined;
}

interface ParameterView {
  readonly name: string;
  readonly required: boolean;
  readonly hasDefault: boolean;
  readonly default?: AdmittedJsonValue;
  readonly description?: string;
  readonly schema: unknown;
}
function parameterViews(properties: JsonObject): readonly ParameterView[] {
  return (properties.parameters as unknown as readonly Record<string, AdmittedJsonValue>[]).map(
    (parameter) => ({
      name: parameter.name as string,
      required: parameter.required === true,
      hasDefault: Object.hasOwn(parameter, "default"),
      ...(Object.hasOwn(parameter, "default")
        ? { default: parameter.default as AdmittedJsonValue }
        : {}),
      ...(typeof parameter.description === "string" ? { description: parameter.description } : {}),
      schema: parameter.schema,
    }),
  );
}

export interface ParsedInvocation {
  readonly arguments: Readonly<Record<string, LosslessJsonValue>>;
  readonly provenance?: RetainedRevisionProvenanceInput;
  readonly provenanceInput?: LosslessJsonValue;
  /** Stable meaning of this invocation under its key. */
  identity(name: string): string;
}

/** §3: the closed `callableInvocation`. Anything else is `malformed-request`. */
export function parseInvocation(text: string): ParsedInvocation {
  let body: Record<string, LosslessJsonValue>;
  try {
    body = record(decodeJsonDocument(text));
  } catch (error) {
    if (error instanceof RetainedRequestError) throw error;
    throw new RetainedRequestError("malformed-request", 400);
  }
  closed(body, ["arguments", "revisionProvenance"]);
  if (!Object.hasOwn(body, "arguments")) throw new RetainedRequestError("malformed-request", 400);
  const args = record(body.arguments);
  let provenance: RetainedRevisionProvenanceInput | undefined;
  if (Object.hasOwn(body, "revisionProvenance")) {
    try {
      provenance = parseRetainedRevisionProvenanceInput(
        snapshotJsonValue(body.revisionProvenance as LosslessJsonValue),
      );
    } catch {
      throw new RetainedRequestError("malformed-request", 400);
    }
  }
  return {
    arguments: args,
    ...(provenance === undefined
      ? {}
      : { provenance, provenanceInput: body.revisionProvenance as LosslessJsonValue }),
    identity: (name) =>
      encodeSemanticValue({
        format: "retained-v01-callable-1",
        operation: "callable",
        name,
        invocation: body as SemanticValue,
      }),
  };
}

function validationFailed(diagnostics: readonly Diagnostic[]): RetainedRequestErrorWithBody {
  return new RetainedRequestErrorWithBody(422, {
    ...problem("validation-failed", 422),
    diagnostics: diagnostics as unknown as AdmittedJsonValue,
  } as JsonObject);
}

/** A refusal carrying more than the code, retry and family of an ordinary request error. */
export class RetainedRequestErrorWithBody extends Error {
  constructor(
    readonly status: number,
    readonly body: JsonObject,
  ) {
    super(String(body.code));
  }
}

/** Exact JSON text of a received value: its number literals are checked as they arrived. */
function losslessText(value: LosslessJsonValue): string {
  if (value instanceof JsonNumberLiteral) return value.literal;
  if (Array.isArray(value)) return `[${value.map(losslessText).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, LosslessJsonValue>)
      .map(([name, entry]) => `${JSON.stringify(name)}:${losslessText(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** §4. The returned object omits what was omitted: absence is never a fabricated `null`. */
export function checkArguments(
  declaration: CallableDeclaration,
  supplied: Readonly<Record<string, LosslessJsonValue>>,
): Readonly<Record<string, AdmittedJsonValue>> {
  const parameters = parameterViews(declaration.properties);
  const declared = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const diagnostics: Diagnostic[] = [];
  const at = (name: string) => `/arguments/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
  for (const name of Object.keys(supplied))
    if (!declared.has(name))
      diagnostics.push({
        message: `\`${name}\` is not a declared parameter`,
        instanceLocation: at(name),
      });
  for (const parameter of parameters) {
    const given = Object.hasOwn(supplied, parameter.name);
    if (!given) {
      if (parameter.required)
        diagnostics.push({
          message: `required parameter \`${parameter.name}\` was not supplied`,
          instanceLocation: at(parameter.name),
        });
      continue;
    }
    const compiled = compileSchema(parameter.schema);
    if (typeof compiled === "string")
      throw new Error("a served declaration's parameter schema did not compile");
    const verdict = compiled.check(losslessText(supplied[parameter.name] as LosslessJsonValue));
    if (verdict === "refused") throw new RetainedRequestError("limit-exceeded", 413);
    if (verdict === "invalid")
      diagnostics.push({
        message: `\`${parameter.name}\` does not satisfy its schema`,
        instanceLocation: at(parameter.name),
      });
  }
  if (diagnostics.length > 0) throw validationFailed(diagnostics);
  const admitted = admitJsonNumbers(supplied as unknown as LosslessJsonValue, {
    diagnostics: 8,
    diagnosticBytes: 4096,
    diagnostic: ({ pointer }) => ({
      message: "arguments: numeric value is not exactly supported",
      instanceLocation: `/arguments${pointer}`,
    }),
  });
  if (!admitted.ok)
    throw new RetainedRequestErrorWithBody(422, {
      ...problem("validation-failed", 422),
      diagnostics: admitted.diagnostics as unknown as AdmittedJsonValue,
    } as JsonObject);
  const out: Record<string, AdmittedJsonValue> = {
    ...(snapshotJsonValue(admitted.value) as Record<string, AdmittedJsonValue>),
  };
  for (const parameter of parameters)
    if (!Object.hasOwn(out, parameter.name) && parameter.hasDefault)
      out[parameter.name] = parameter.default as AdmittedJsonValue;
  return out;
}

/** §5: a conforming implementation does not return a value its declaration rules out. */
export function satisfiesDeclaredSchema(schema: unknown, value: unknown): boolean {
  if (schema === undefined) return true;
  const compiled = compileSchema(schema);
  return typeof compiled !== "string" && compiled.check(serialized(value)) === "valid";
}

export function operationId(name: string): string {
  const [first = "", ...rest] = name.split(/[/\-_.]/).filter(Boolean);
  return (
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("")
  );
}

/** §14. A schema with a `$ref` moves to components, with its `#` references rewritten there. */
function placed(
  schema: unknown,
  key: string,
  components: Record<string, unknown>,
): Readonly<Record<string, unknown>> | boolean {
  const text = serialized(schema);
  const value = JSON.parse(text) as Record<string, unknown> | boolean;
  if (!text.includes('"$ref"')) return value;
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (!isObject(node)) return node;
    return Object.fromEntries(
      Object.entries(node).map(([name, entry]) => [
        name,
        name === "$ref" && typeof entry === "string" && entry.startsWith("#")
          ? `#/components/schemas/${key}${entry.slice(1)}`
          : rewrite(entry),
      ]),
    );
  };
  components[key] = rewrite(value);
  return { $ref: `#/components/schemas/${key}` };
}

const CALLABLE_PROBLEM = Object.freeze({
  type: "object",
  description: "A Core or Write Problem, or one carrying a code the Callables profile adds.",
  required: ["type", "code", "retry"],
  properties: {
    type: { type: "string", format: "uri" },
    code: { type: "string" },
    status: { type: "integer" },
    retry: { type: "string" },
    error: true,
  },
});

/** The document `GET <scope>/bdp/call` serves: one operation per reachable Callable. */
export function projectOpenApi(
  scope: string,
  declarations: readonly CallableDeclaration[],
  idempotencyAdvertised: boolean,
): Record<string, unknown> {
  const scopeUrl = new URL(scope);
  const paths: Record<string, unknown> = {};
  const components: Record<string, unknown> = { callableProblem: CALLABLE_PROBLEM };
  const operationIds = new Set<string>();
  for (const declaration of declarations) {
    const id = operationId(declaration.name);
    // §14: a generator error, refused rather than served with one operation hiding the other.
    if (operationIds.has(id))
      throw new RetainedRequestError("temporarily-unavailable", 503, "after-delay");
    operationIds.add(id);
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const parameter of parameterViews(declaration.properties)) {
      const schema = placed(parameter.schema, `${id}.parameter.${parameter.name}`, components);
      properties[parameter.name] =
        typeof schema === "boolean"
          ? schema
          : {
              ...schema,
              ...(parameter.description === undefined
                ? {}
                : { description: parameter.description }),
              ...(parameter.hasDefault
                ? { default: JSON.parse(serialized(parameter.default)) }
                : {}),
            };
      if (parameter.required) required.push(parameter.name);
    }
    const batch = declaration.kind === "batch";
    const d = declaration.properties;
    const result =
      d.resultSchema === undefined ? true : placed(d.resultSchema, `${id}.result`, components);
    const error =
      d.errorSchema === undefined ? undefined : placed(d.errorSchema, `${id}.error`, components);
    paths[`${scopeUrl.pathname}bdp/call/${declaration.name}`] = {
      post: {
        operationId: id,
        ...(d.title === undefined ? {} : { summary: d.title }),
        description: d.description,
        ...(batch
          ? {
              parameters: [
                {
                  name: "Idempotency-Key",
                  in: "header",
                  required: idempotencyAdvertised,
                  description: idempotencyAdvertised
                    ? "Required: this Scope advertises idempotency."
                    : "Admitted and not retained: this Scope does not advertise idempotency.",
                  schema: { type: "string", minLength: 1 },
                },
              ],
            }
          : {}),
        requestBody: {
          required: true,
          content: {
            [RETAINED_MEDIA]: {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["arguments"],
                properties: {
                  arguments: {
                    type: "object",
                    additionalProperties: false,
                    properties,
                    ...(required.length === 0 ? {} : { required }),
                  },
                  ...(batch ? { revisionProvenance: { type: "object" } } : {}),
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "The operation succeeded",
            content: {
              [RETAINED_MEDIA]: {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: batch ? ["result", "changed"] : ["result"],
                  properties: {
                    result,
                    ...(batch ? { changed: { type: "boolean" } } : {}),
                  },
                },
              },
            },
          },
          "409": {
            description: "A Problem",
            content: {
              "application/problem+json": {
                schema:
                  error === undefined
                    ? { $ref: "#/components/schemas/callableProblem" }
                    : {
                        allOf: [
                          { $ref: "#/components/schemas/callableProblem" },
                          { properties: { error } },
                        ],
                      },
              },
            },
          },
          default: {
            description: "A Problem",
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/callableProblem" },
              },
            },
          },
        },
        "x-bdp-callable": {
          type: batch ? CALLABLE_BATCH_TYPE : CALLABLE_QUERY_TYPE,
          ...(d.idempotent === undefined ? {} : { idempotent: d.idempotent }),
          ...(d.atomic === undefined ? {} : { atomic: d.atomic }),
          ...(d.cliMapping === undefined
            ? {}
            : { cliMapping: JSON.parse(serialized(d.cliMapping)) }),
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: `Callables of ${scope}`, version: "preview-1" },
    servers: [{ url: scopeUrl.origin }],
    paths,
    components: { schemas: components },
  };
}

/** A mount's name, as its canonical local Resource ID; undefined when none can spell it. */
export function mountName(scope: string, pathname: string): string | undefined {
  const prefix = `${new URL(scope).pathname}bdp/call/`;
  if (!pathname.startsWith(prefix)) return undefined;
  try {
    const id = canonicalLocalReference(scope, pathname.slice(prefix.length));
    return id.slice(scope.length);
  } catch {
    return undefined;
  }
}

/** What an implementation sees of the Scope, and may do to it when it is a batch. */
export interface CallableEffects {
  createBead(body: Record<string, unknown>): EffectOutcome;
  updateBead(body: Record<string, unknown>): EffectOutcome;
  deleteBead(body: Record<string, unknown>): EffectOutcome;
  createLink(body: Record<string, unknown>): EffectOutcome;
  updateLink(body: Record<string, unknown>): EffectOutcome;
  deleteLink(body: Record<string, unknown>): EffectOutcome;
}
export interface EffectOutcome {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}
export interface CallableInvocationContext {
  readonly name: string;
  /** Defaults applied; an omitted parameter with no default is absent, never `null`. */
  readonly arguments: Readonly<Record<string, AdmittedJsonValue>>;
  readonly provenance?: RetainedRevisionProvenanceInput;
  readonly scope: string;
  read(id: string): Readonly<Record<string, unknown>> | undefined;
  list(kind: "bead" | "link"): readonly Readonly<Record<string, unknown>>[];
  /** Present only for a CallableBatch: a CallableQuery has no way to mutate. */
  readonly effects?: CallableEffects;
}
/**
 * `result` is the operation's value. `error` is its own failure, a `callable-error`.
 * `problem` is a Core or Write Problem the operation met, returned as such (§9).
 */
export type CallableAnswer =
  | { readonly result: unknown }
  | { readonly error: unknown }
  | { readonly problem: EffectOutcome };
export type CallableImplementation = (context: CallableInvocationContext) => CallableAnswer;
