import {
  type AdmittedJsonValue,
  admitJsonNumbers,
  assertCanonicalPathSegments,
  decodeJsonDocument,
  isJsonSchemaUri,
  isUnicodeScalarString,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  stringifyJsonValue,
} from "@bdp/protocol";

export type CanonicalOperation =
  | "createBead"
  | "updateBead"
  | "deleteBead"
  | "createLink"
  | "updateLink"
  | "deleteLink"
  | "putAlias"
  | "deleteAlias";
export type CanonicalReference = string | { readonly uri: string; readonly revision: string };
export interface CanonicalInputReader {
  /** The reader must bound acquisition to maxBytes, not read an unlimited file first. */
  readFile(path: string, maxBytes: number): Promise<Uint8Array>;
  readStdin(maxBytes: number): Promise<Uint8Array>;
}
export interface CanonicalInputRequest {
  readonly command: readonly string[] | string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly positionals?: readonly string[];
  readonly scope: string;
  readonly reader?: CanonicalInputReader;
  /** Bounds cumulative JSON inputs and each emitted body; no provider-limit claim. */
  readonly maxInputBytes?: number;
}
export interface CompiledCanonicalInput {
  readonly operation: CanonicalOperation;
  readonly bodyText: string;
  readonly batchMemberText?: string;
}
export class CanonicalInputError extends Error {
  readonly code = "invalid-input";
  constructor(message: string) {
    super(message);
    this.name = "CanonicalInputError";
  }
}
function refuse(message: string): never {
  throw new CanonicalInputError(message);
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || !isUnicodeScalarString(value))
    return refuse(`${label} must be a nonempty Unicode string`);
  return value;
}
function object(value: AdmittedJsonValue, label: string): Record<string, AdmittedJsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return refuse(`${label} must be a JSON object`);
  return value as Record<string, AdmittedJsonValue>;
}
function absolute(input: string, scope: string): string {
  if (/^https?:\/\//i.test(input)) {
    parseCanonicalHttpUrl(input);
    return input; // Never round-trip/normalize an already authored identity.
  }
  assertCanonicalPathSegments(input, "local Reference");
  const result = `${scope}${input}`;
  parseCanonicalHttpUrl(result);
  return result;
}
const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** No lookup: ordinals/current selection deliberately refuse at this offline boundary. */
export function parseCanonicalReference(
  input: string,
  scope: string,
  policy: {
    readonly mutationSubject?: boolean;
    readonly allowBatchReference?: boolean;
    readonly allowOpaqueUri?: boolean;
  } = {},
): CanonicalReference {
  parseCanonicalScope(scope);
  text(input, "Reference");
  if (input.startsWith("batch-ref::")) {
    const name = input.slice("batch-ref::".length);
    if (!policy.allowBatchReference || !NAME.test(name))
      return refuse("batch reference is not legal in this position or mode");
    return `@${name}`;
  }
  if (/^https?:\/\//i.test(input)) return absolute(input, scope);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(input)) {
    if (!policy.allowOpaqueUri || !isJsonSchemaUri(input))
      return refuse("opaque URI is not admitted in this Reference position");
    return input;
  }
  let identity: string;
  let suffix: string | undefined;
  if (input.startsWith("[")) {
    const close = input.indexOf("]");
    if (close < 0 || input[close + 1] !== "@")
      return refuse("bracketed absolute Reference requires a revision suffix");
    identity = input.slice(1, close);
    if (!/^https?:\/\//i.test(identity)) return refuse("brackets require an absolute HTTP URL");
    suffix = input.slice(close + 2);
  } else {
    const at = input.indexOf("@");
    identity = at < 0 ? input : input.slice(0, at);
    suffix = at < 0 ? undefined : input.slice(at + 1);
  }
  const uri = absolute(text(identity, "Reference identity"), scope);
  if (suffix === undefined) return uri;
  if (policy.mutationSubject)
    return refuse("mutation subjects must be unpinned; use --if-revision");
  if (!suffix.startsWith("="))
    return refuse("revision selector requires an exact @=TOKEN; no history lookup is available");
  return Object.freeze({ uri, revision: text(suffix.slice(1), "revision token") });
}
function json(textValue: string): AdmittedJsonValue {
  try {
    const admitted = admitJsonNumbers(decodeJsonDocument(textValue), {
      diagnostics: 1,
      diagnostic: () => ({ message: "inadmissible exact JSON number" }),
    });
    if (!admitted.ok) return refuse("inadmissible exact JSON number");
    return admitted.value;
  } catch (error) {
    if (error instanceof CanonicalInputError) throw error;
    return refuse("invalid JSON input (syntax, duplicate member or Unicode)");
  }
}
function list(value: unknown, label: string): readonly string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => {
    if (typeof entry !== "string" || !isUnicodeScalarString(entry))
      return refuse(`${label} must be Unicode strings`);
    return entry;
  });
}
function patch(value: AdmittedJsonValue): AdmittedJsonValue {
  if (!Array.isArray(value)) return refuse("patch must be an ordered JSON array");
  for (const entry of value) {
    const record = object(entry, "patch operation");
    const op = record.op;
    if (op !== "add" && op !== "replace" && op !== "remove")
      return refuse("unsupported patch operation");
    if (typeof record.path !== "string" || !/^(?:\/(?:[^~]|~[01])*)*$/.test(record.path))
      return refuse("patch path must be an RFC6901 pointer");
    const keys = Object.keys(record);
    if (
      keys.some((key) => !["op", "path", ...(op === "remove" ? [] : ["value"])].includes(key)) ||
      (op !== "remove" && !Object.hasOwn(record, "value"))
    )
      return refuse("patch operation has missing or unsupported members");
  }
  return value;
}
function pointer(key: string): string {
  return `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}
function keyedValue(value: string): AdmittedJsonValue {
  if (
    value === "null" ||
    value === "true" ||
    value === "false" ||
    /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value)
  )
    return json(value);
  return value;
}
function provenance(value: AdmittedJsonValue): Record<string, AdmittedJsonValue> {
  const record = object(value, "revision provenance");
  if (Object.keys(record).some((key) => !["actor", "agent", "message"].includes(key)))
    return refuse("unsupported revision provenance member");
  if (Object.hasOwn(record, "agent") && record.agent !== null)
    text(record.agent, "provenance agent");
  if (
    Object.hasOwn(record, "message") &&
    record.message !== null &&
    typeof record.message !== "string"
  )
    return refuse("provenance message must be a string or null");
  if (Object.hasOwn(record, "actor")) {
    const actor = object(record.actor as AdmittedJsonValue, "provenance actor");
    if (
      Object.keys(actor).some((key) => !["id", "basis"].includes(key)) ||
      (actor.basis !== "unknown" && actor.basis !== "writer-supplied")
    )
      return refuse("invalid provenance actor");
    text(actor.id, "provenance actor id");
  }
  return { ...record };
}

/** Freeze one ordinary Write invocation, without discovery, allocation, keys or I/O beyond injected inputs. */
export async function compileCanonicalInput(
  request: CanonicalInputRequest,
): Promise<CompiledCanonicalInput> {
  try {
    return await compile(request);
  } catch (error) {
    if (error instanceof CanonicalInputError) throw error;
    // Input/file errors cannot leak file contents, paths or incidental credentials.
    throw new CanonicalInputError("cannot compile canonical input");
  }
}
async function compile(request: CanonicalInputRequest): Promise<CompiledCanonicalInput> {
  const scope = parseCanonicalScope(request.scope);
  const options = Object.fromEntries(
    Object.entries(request.options).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
  const args = [...(request.positionals ?? [])];
  const command = typeof request.command === "string" ? request.command : request.command.join(" ");
  const operations: Readonly<Record<string, CanonicalOperation>> = {
    create: "createBead",
    update: "updateBead",
    delete: "deleteBead",
    "link create": "createLink",
    "link update": "updateLink",
    "link delete": "deleteLink",
    "alias put": "putAlias",
    "alias delete": "deleteAlias",
  };
  const operation = operations[command];
  if (!operation) return refuse("unsupported canonical mutation command");
  const has = (name: string): boolean => options[name] !== undefined;
  if (has("scope") && options.scope !== scope)
    return refuse("explicit Scope contradicts selected Scope");
  const option = (name: string): string => text(options[name], `--${name}`);
  for (const flag of [
    "revision",
    "typeRevision",
    "sourceRevision",
    "targetRevision",
    "fromRevision",
    "source",
  ])
    if (has(flag)) return refuse(`unsupported canonical option --${flag}`);
  const mode = has("dryRunMode") ? option("dryRunMode") : undefined;
  if (mode !== undefined && mode !== "batch" && mode !== "bdp")
    return refuse("invalid dry-run mode");
  const batch = mode === "batch";
  if (
    mode !== undefined &&
    ["idempotencyKey", "retryFile", "outputFormat", "long", "fields", "include", "exclude"].some(
      has,
    )
  )
    return refuse("emission conflicts with execution, retry or explicit display controls");
  if (has("retryFile")) return refuse("retry input must use the frozen recovery path");
  const bound = request.maxInputBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(bound) || bound < 1)
    return refuse("input byte bound must be a positive safe integer");
  let remaining = bound;
  let stdinUsed = false;
  const files = new Map<string, Uint8Array>();
  const charge = (bytes: number): void => {
    remaining -= bytes;
    if (remaining < 0) refuse("input byte bound exceeded");
  };
  const read = async (value: string): Promise<AdmittedJsonValue> => {
    let source: string;
    if (value.startsWith("@")) {
      if (!request.reader) return refuse("file/stdin input requires an injected bounded reader");
      const path = value.slice(1);
      if (!path) return refuse("file input requires a path");
      let bytes: Uint8Array;
      if (path === "-") {
        if (stdinUsed) return refuse("stdin may have only one consumer");
        stdinUsed = true;
        bytes = new Uint8Array(await request.reader.readStdin(remaining));
      } else {
        const frozen = files.get(path);
        bytes = frozen ?? new Uint8Array(await request.reader.readFile(path, remaining));
        if (!frozen) files.set(path, bytes);
      }
      charge(bytes.byteLength);
      source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } else {
      charge(new TextEncoder().encode(value).byteLength);
      source = value;
    }
    return json(source);
  };
  const body: Record<string, AdmittedJsonValue> = Object.create(null) as Record<
    string,
    AdmittedJsonValue
  >;
  const create = operation === "createBead" || operation === "createLink";
  const update = operation === "updateBead" || operation === "updateLink";
  const alias = operation === "putAlias" || operation === "deleteAlias";
  const link = operation.endsWith("Link");
  if (batch && alias) return refuse("atomic-batch1 admits six CRUD operations, not aliases");
  const ref = (
    value: string,
    mutationSubject = false,
    handles = false,
    endpoint = false,
  ): CanonicalReference =>
    parseCanonicalReference(value, scope, {
      mutationSubject,
      allowBatchReference: batch && handles,
      allowOpaqueUri: endpoint,
    });
  if (create) {
    if (operation === "createBead" && args.length === 1) {
      if (args[0] !== scope) return refuse("explicit creation Scope contradicts selected Scope");
      args.pop();
    }
    body.type = ref(option("type")) as AdmittedJsonValue;
    if (has("id") && has("idRoot")) return refuse("--id and --id-root are mutually exclusive");
    for (const key of ["id", "idRoot"])
      if (has(key)) {
        const value = option(key);
        if (value.includes("@") || value.startsWith("batch-ref::"))
          return refuse("new IDs/roots must not contain selectors or handles");
        if (key === "idRoot" && batch) return refuse("version-1 batch has no idRoot member");
        if (key === "idRoot") assertCanonicalPathSegments(value, "idRoot");
        const id = absolute(value, scope);
        if (!id.startsWith(scope) || new URL(id).search)
          return refuse("creation identity must be inside the selected Scope");
        body[key] = key === "idRoot" ? value : id;
      }
  } else {
    const subject = args.shift();
    body[alias ? "alias" : link ? "link" : "bead"] = ref(
      text(subject, "mutation subject"),
      true,
      !alias,
    ) as AdmittedJsonValue;
  }
  if (operation === "createLink") {
    // The only three admitted shapes: A B, A --to B, --from A --to B.
    if (has("from")) {
      if (args.length !== 0 || !has("to"))
        return refuse("duplicate or incomplete Link endpoint bindings");
      body.source = ref(option("from"), false, true, true) as AdmittedJsonValue;
      body.target = ref(option("to"), false, true, true) as AdmittedJsonValue;
    } else {
      const source = args.shift();
      const target = has("to") ? option("to") : args.shift();
      body.source = ref(text(source, "source"), false, true, true) as AdmittedJsonValue;
      body.target = ref(text(target, "target"), false, true, true) as AdmittedJsonValue;
    }
  } else if (operation === "updateLink") {
    if (has("from")) body.source = ref(option("from"), false, true, true) as AdmittedJsonValue;
    if (has("to")) body.target = ref(option("to"), false, true, true) as AdmittedJsonValue;
  } else if (has("from") || has("to")) return refuse("endpoint flags require a Link create/update");
  if (args.length !== 0)
    return refuse("unexpected positional arguments or duplicate endpoint bindings");
  if (operation === "putAlias") body.target = ref(option("target"), true) as AdmittedJsonValue;
  else if (has("target")) return refuse("--target is only an alias put operand");
  if (alias) {
    for (const key of operation === "putAlias" ? ["alias", "target"] : ["alias"]) {
      const identity = body[key];
      if (typeof identity !== "string" || !identity.startsWith(scope))
        return refuse("alias and target must be in the selected Scope");
      assertCanonicalPathSegments(identity.slice(scope.length), key);
    }
  }
  if (!create && has("type")) {
    if (!update) return refuse("Type input requires create/update");
    body.type = ref(option("type")) as AdmittedJsonValue;
  }
  if (!create && (has("id") || has("idRoot"))) return refuse("identity flags require creation");
  for (const plane of ["properties", "metadata"] as const) {
    const title = plane === "properties" ? "Properties" : "Metadata";
    const singular = plane === "properties" ? "Property" : "Metadata";
    const merge = has(plane),
      replace = has(`replace${title}`),
      strict = has(`patch${title}`);
    const sets = list(options[`set${singular}`], `set ${plane}`);
    const unsets = list(options[`unset${singular}`], `unset ${plane}`);
    const keyed = sets.length > 0 || unsets.length > 0;
    if ([merge, replace, strict, keyed].filter(Boolean).length > 1)
      return refuse(`conflicting ${plane} edit modes`);
    if (!create && !update && (merge || replace || strict || keyed))
      return refuse("object edits require create/update");
    if (create && (replace || strict || keyed))
      return refuse("creation admits object initialization only");
    if (merge) {
      const record = object(await read(option(plane)), plane);
      if (create) body[plane] = record;
      else
        body[`${plane}Change`] = Object.keys(record)
          .sort()
          .map((key) => ({
            op: "add",
            path: pointer(key),
            value: record[key] as AdmittedJsonValue,
          }));
    } else if (replace) body[plane] = object(await read(option(`replace${title}`)), plane);
    else if (strict) body[`${plane}Change`] = patch(await read(option(`patch${title}`)));
    else if (keyed) {
      const values = new Map<string, AdmittedJsonValue>();
      for (const entry of sets) {
        charge(new TextEncoder().encode(entry).byteLength);
        const at = entry.indexOf("=");
        if (at < 0) return refuse("set input requires KEY=VALUE");
        values.set(entry.slice(0, at), keyedValue(entry.slice(at + 1)));
      }
      const changes: AdmittedJsonValue[] = [...values].map(([key, value]) => ({
        op: "add",
        path: pointer(key),
        value,
      }));
      for (const key of new Set(unsets)) {
        charge(new TextEncoder().encode(key).byteLength);
        changes.push(
          { op: "add", path: pointer(key), value: null },
          { op: "remove", path: pointer(key) },
        );
      }
      body[`${plane}Change`] = changes;
    }
  }
  if (has("ifRevision")) {
    if (create || alias) return refuse("Resource guards require update/delete");
    body.expectedRevision = option("ifRevision"); // A bare opaque token, not a Reference selector.
  }
  const attributes = has("revisionProvenance") || has("actor");
  if (attributes) {
    if (alias || operation === "deleteBead")
      return refuse("operation admits no caller attribution");
    const input = has("revisionProvenance")
      ? provenance(await read(option("revisionProvenance")))
      : {};
    if (has("actor")) {
      const actor = { id: option("actor"), basis: "writer-supplied" };
      if (
        input.actor !== undefined &&
        stringifyJsonValue(input.actor) !== stringifyJsonValue(actor)
      ) {
        const explicit = object(input.actor, "actor");
        if (explicit.id !== actor.id || explicit.basis !== actor.basis)
          return refuse("--actor conflicts with explicit provenance actor");
      }
      input.actor = actor;
    }
    body.revisionProvenance = input;
  }
  if (
    update &&
    ![
      "type",
      "source",
      "target",
      "properties",
      "metadata",
      "propertiesChange",
      "metadataChange",
    ].some((key) => Object.hasOwn(body, key))
  )
    return refuse("update requires a mutation input, not just guard or provenance");
  if (has("batchBind") && (!batch || !create || !NAME.test(option("batchBind"))))
    return refuse("batch binding requires batch-mode creation and a valid name");
  if (
    (operation === "deleteAlias" ||
      (batch && (operation === "deleteBead" || operation === "deleteLink"))) &&
    options.force !== true
  )
    return refuse("alias deletion and emitted Resource deletes require --force");
  const bodyText = stringifyJsonValue(body);
  if (new TextEncoder().encode(bodyText).byteLength > bound)
    return refuse("compiled body byte bound exceeded");
  if (!batch) return Object.freeze({ operation, bodyText });
  const member = { operation, ...(has("batchBind") ? { name: option("batchBind") } : {}), ...body };
  const batchMemberText = stringifyJsonValue(member);
  if (new TextEncoder().encode(batchMemberText).byteLength > bound)
    return refuse("compiled batch member byte bound exceeded");
  return Object.freeze({ operation, bodyText, batchMemberText });
}
