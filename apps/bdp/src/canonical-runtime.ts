import { createHash, randomUUID } from "node:crypto";
import {
  BdpClient,
  BdpClientLocalError,
  bdpClientFailureReason,
  CALLABLE_QUERY_TYPE,
  type CallableCatalog,
  type CallableDeclaration,
  createFetchTransport,
  createHistoricalUpdateFetchTransport,
  createRetainedFetchTransport,
  isBdpClientProblem,
  type PreparedRetainedWrite,
  RetainedClient,
  RetainedClientError,
  type RetainedHttpContext,
  type RetainedPageValue,
  type RetainedReply,
  RetainedTransportError,
} from "@bdp/client";
import type { CanonicalCliConfig } from "@bdp/config";
import {
  type AdmittedJsonValue,
  admitJsonNumbers,
  decodeJsonDocument,
  type HistoryVersionRow,
  type HistoryVersionsPage,
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  RETAINED_V01_SPECIFICATION,
  RETAINED_WRITE_OPERATIONS,
  type RetainedJsonObject,
  type RetainedResourceKind,
} from "@bdp/protocol";
import {
  CallableUsageError,
  callableCatalogItem,
  completeCallableArguments,
  type ParsedCallableArguments,
  parseCallableArguments,
  renderCallableHelp,
} from "./canonical-call.js";
import type { CanonicalInvocation } from "./canonical-command.js";
import {
  CanonicalInputError,
  CanonicalUnsupportedInputError,
  compileCanonicalInput,
  lowerRevisionProvenance,
  parseCanonicalReference,
  parseCanonicalReferenceSelection,
  parseHistoricalSourceSelector,
} from "./canonical-input.js";
import {
  CanonicalOutputError,
  canonicalInputReader,
  readBoundedFile,
  saveCanonicalJournal,
} from "./canonical-io.js";
import { type CanonicalOutput, httpContext, renderCanonicalOutput } from "./canonical-output.js";
import {
  CanonicalProjectionError,
  projectCanonicalProperties,
  validateCanonicalPropertiesMasks,
} from "./canonical-projection.js";

const MAX_BYTES = 8_388_608;
const MAX_INPUT_BYTES = 1_048_576;
const MAX_ORDINAL_HISTORY_PAGES = 100;
const utf8 = new TextDecoder("utf-8", { fatal: true });
class CliError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const refuse = (code: string, status: number, message: string): never => {
  throw new CliError(code, status, message);
};
const stringOption = (
  options: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => (typeof options[key] === "string" ? (options[key] as string) : undefined);
const referenceUri = (reference: ReturnType<typeof parseCanonicalReference>): string =>
  typeof reference === "string" ? reference : reference.uri;

function createHistoryClient(config: CanonicalCliConfig, scope: string): BdpClient {
  const token = config.auth.token;
  const scopedFetch: typeof fetch = (input, init) => {
    if (token === undefined) return fetch(input, init);
    const target =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : new URL(input, scope).href;
    if (!target.startsWith(scope)) return fetch(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
  return new BdpClient({
    scope: parseCanonicalScope(scope),
    transport: createFetchTransport(scopedFetch),
  });
}

async function resolveRevisionOrdinal(
  config: CanonicalCliConfig,
  scope: string,
  resource: "bead" | "link",
  id: string,
  ordinal: string,
  signal?: AbortSignal,
): Promise<string> {
  const client = createHistoryClient(config, scope);
  let remaining = BigInt(ordinal);
  let continuation: string | undefined;
  try {
    for (let pageNumber = 0; pageNumber < MAX_ORDINAL_HISTORY_PAGES; pageNumber++) {
      const request = {
        kind: "versions" as const,
        resource,
        id: parseCanonicalHttpUrl(id),
        ...(continuation === undefined
          ? {}
          : { continuation: parseCanonicalHttpUrl(continuation) }),
      };
      const page = await client.performHistory(request, signal === undefined ? {} : { signal });
      if (isBdpClientProblem(page)) throw { kind: "problem", problem: page };
      if (remaining <= BigInt(page.items.length)) {
        const selected = page.items[Number(remaining - 1n)];
        if (selected === undefined) break;
        return selected.revision;
      }
      remaining -= BigInt(page.items.length);
      if (page.next === null)
        return refuse(
          "revision_not_found",
          3,
          `revision @${ordinal} is outside the retained window; inspect it with bdp versions ${id}`,
        );
      continuation = page.next;
    }
    return refuse(
      "unsupported_capability",
      5,
      `revision @${ordinal} exceeds the ${MAX_ORDINAL_HISTORY_PAGES}-page resolution bound; use an exact token from bdp versions ${id}`,
    );
  } finally {
    await client.close();
  }
}
function integer(value: unknown, fallback: number, minimum: number): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < minimum
  )
    return refuse("invalid_value", 2, "paging values must be canonical bounded integers");
  return Number(value);
}
const answered = (http: RetainedHttpContext): string =>
  `${http.url} answered HTTP ${http.status}${http.contentType ? ` (${http.contentType})` : ""}`;
const TRANSPORT_FAILURES: Readonly<Record<string, string>> = Object.freeze({
  network: "could not connect, or the connection was lost",
  timeout: "the request timed out",
  aborted: "the request was interrupted",
  redirect: "the service answered with a redirect, which this client does not follow",
  "invalid-response": "the response could not be read",
  "response-too-large": `the response exceeded this client's limit of ${MAX_BYTES} bytes`,
  "invalid-input": "the request could not be formed",
});
/** What happened, for a failure with no Problem to show. Never a response body. */
function callFailure(
  error: RetainedClientError | RetainedTransportError,
  phase: "discovery" | "invocation" | "request",
  scope: string,
): string {
  if (error instanceof RetainedClientError && error.code === "unsupported-feature")
    return error.detail ?? "the Scope does not advertise what this invocation requires";
  if (error instanceof RetainedClientError && error.code === "invalid-input")
    return "the client refused this invocation's input before sending it";
  const stage =
    { discovery: `BDP discovery of ${scope} failed`, invocation: "Invocation failed" }[
      phase as "discovery"
    ] ?? `The request against ${scope} failed`;
  if (error instanceof RetainedTransportError) {
    if (error.code === "invalid-response" && error.httpStatus !== undefined)
      return `${stage}: the service answered HTTP ${error.httpStatus}${
        error.contentType ? ` (${error.contentType})` : ""
      }, which is not a BDP response`;
    return `${stage}: ${TRANSPORT_FAILURES[error.code] ?? error.code}`;
  }
  return [stage, error.http && answered(error.http), error.detail ?? "not a usable BDP response"]
    .filter((part) => part)
    .join(": ");
}
/** A legacy client failure, with the fixed reason its own checks give. */
const localFailure = (error: BdpClientLocalError): string => {
  const reason = bdpClientFailureReason(error);
  return reason === undefined ? error.message : `${error.message}: ${reason}`;
};
function problemExit(problem: RetainedJsonObject): number {
  const code = problem.code;
  if (
    code === "resource-not-found" ||
    code === "revision-not-found" ||
    code === "alias-not-found" ||
    code === "callable-not-found"
  )
    return 3;
  if (code === "revision-mismatch") return 4;
  if (
    code === "unsupported-capability" ||
    code === "capability-not-supported" ||
    code === "unsupported-operation" ||
    code === "unsupported-version"
  )
    return 5;
  return 1;
}
/** Same admission as a Write command's JSON input, with `@FILE` and `@-`. */
async function jsonInput(
  value: string,
  reader: ReturnType<typeof canonicalInputReader>,
  maxBytes: number,
): Promise<AdmittedJsonValue> {
  const path = value.startsWith("@") ? value.slice(1) : undefined;
  if (path === "") return refuse("invalid_value", 2, "file input requires a path");
  const text =
    path === undefined
      ? value
      : utf8.decode(
          await (path === "-" ? reader.readStdin(maxBytes) : reader.readFile(path, maxBytes)),
        );
  try {
    return json(text) as AdmittedJsonValue;
  } catch (error) {
    if (error instanceof CliError) throw error;
    return refuse("invalid_value", 2, "expected one admitted JSON object");
  }
}
function json(text: string): Record<string, unknown> {
  const admitted = admitJsonNumbers(decodeJsonDocument(text), {
    diagnostics: 1,
    diagnostic: () => ({ message: "inadmissible JSON number" }),
  });
  if (
    !admitted.ok ||
    admitted.value === null ||
    typeof admitted.value !== "object" ||
    Array.isArray(admitted.value)
  )
    return refuse("invalid_value", 2, "expected one admitted JSON object");
  return admitted.value as Record<string, unknown>;
}

interface Journal {
  readonly version: 1;
  readonly profile: "canonical";
  readonly command: readonly string[];
  readonly credentialBoundary: string;
  readonly credentialScope: string | null;
  readonly prepared: PreparedRetainedWrite;
}
/** This executable has no authenticated principal-discovery protocol. Until
 * one is supplied, a changed credential is conservatively refused on retry;
 * writer-supplied --actor is never used as a principal assertion. */
function credentialBoundary(config: CanonicalCliConfig, scope: string | null): string {
  return createHash("sha256")
    .update(JSON.stringify([scope, config.auth.token ?? null]))
    .digest("hex");
}

export async function runCanonicalInvocation(
  invocation: CanonicalInvocation,
  config: CanonicalCliConfig,
  io: {
    readonly stdout: (text: string, signal?: AbortSignal) => void | Promise<void>;
    readonly stderr: (text: string, signal?: AbortSignal) => void | Promise<void>;
    readonly signal?: AbortSignal;
  },
  callables?: CallableCatalog,
  /** The words that reached a Callable through the command tree, for its help. */
  callableCommand?: readonly string[],
): Promise<number> {
  const options = invocation.options;
  const command = [...invocation.command];
  // The executable uses `bd` as an optional domain spelling for this generic surface.
  if (command[0] === "bd") command.shift();
  const leaf = command.at(-1);
  const link = command[0] === "link";
  const alias = command[0] === "alias";
  const collection = leaf === "list";
  const mutation = ["create", "update", "delete", "put", "batch"].includes(leaf ?? "");
  const isCall = command[0] === "call";
  // The Callable being invoked and the key sent, once they are known.
  let callable: CallableDeclaration | undefined;
  let callableKey: string | undefined;
  let callPhase: "discovery" | "invocation" = "invocation";
  let specification: string | null = null;
  let descriptor = isCall
    ? "callable_result"
    : mutation
      ? "mutation"
      : collection
        ? "resource_collection"
        : alias
          ? "reference"
          : command[0] === "scope"
            ? "scope"
            : "resource";
  // Used only as an offline parser base until an absolute subject supplies its
  // verified owner. Never a network destination or a configured default.
  let scope = config.scope?.url ?? "https://unbound.invalid/";
  let pendingRecovery: string | undefined;
  let submitted = false;
  let known: CanonicalOutput | undefined;
  let stream: { raw: boolean; returned: number; next?: string | null } | undefined;
  const call = io.signal === undefined ? {} : { signal: io.signal };
  // After interruption, allow a short best-effort terminal/recovery flush.
  // A non-draining consumer must not prevent bounded cancellation settlement.
  const failureSignal = (): AbortSignal | undefined =>
    io.signal?.aborted ? AbortSignal.timeout(1000) : io.signal;
  const outputMode = options.outputMode;
  const format = options.outputFormat ?? (outputMode === "json" ? "json" : "default");
  const displayOptions = { ...options, outputFormat: format };
  const output = async (value: CanonicalOutput): Promise<void> => {
    const rendered = renderCanonicalOutput(value, displayOptions, scope);
    await io.stdout(rendered, value.outcome === "success" ? io.signal : failureSignal());
    const raw = Array.isArray(options.omit) && options.omit.includes("envelope");
    if (value.outcome !== "success" && (raw || (format !== "json" && format !== "jsonl")))
      await io.stderr(
        `${JSON.stringify({ error: value.error, ...(value.context?.recovery === undefined ? {} : { recovery: value.context.recovery }) })}\n`,
        failureSignal(),
      );
  };
  try {
    if (outputMode !== undefined && outputMode !== "human" && outputMode !== "json")
      return refuse("invalid_arguments", 2, "output mode must be human or json");
    if (
      !["default", "detail", "table", "json", "jsonl"].includes(String(format)) ||
      (format === "table" && !collection)
    )
      return refuse("invalid_arguments", 2, "output format is not admitted for this command");
    if (
      (outputMode === "human" && (format === "json" || format === "jsonl")) ||
      (outputMode === "json" && format !== "json" && format !== "jsonl")
    )
      return refuse("invalid_arguments", 2, "output mode conflicts with output format");
    let callableArguments: Readonly<Record<string, AdmittedJsonValue>> = {};
    let parsedCall: Extract<ParsedCallableArguments, { help: false }> | undefined;
    if (isCall) {
      if (callables === undefined)
        return refuse("unsupported_capability", 5, "no Callable catalog is configured");
      const name = invocation.positionals[0];
      if (name === undefined) {
        descriptor = "callable_catalog";
        await output({
          schema_version: 2,
          bdp_spec: null,
          result_kind: descriptor,
          outcome: "success",
          data: { items: (await callables.list()).map(callableCatalogItem) },
        });
        return 0;
      }
      callable =
        (await callables.get(name)) ??
        refuse("invalid_arguments", 2, "unknown Callable; run bdp call to list the names");
      const parsed = parseCallableArguments(callable, invocation.positionals.slice(1));
      if (parsed.help) {
        await io.stdout(renderCallableHelp(callable, callableCommand), io.signal);
        return 0;
      }
      parsedCall = parsed;
      if (
        callable.type === CALLABLE_QUERY_TYPE &&
        ["actor", "revisionProvenance", "idempotencyKey"].some((key) =>
          invocation.explicitOptions.includes(key),
        )
      )
        return refuse(
          "invalid_arguments",
          2,
          "attribution and keys apply only to a CallableBatch; this Callable is a CallableQuery",
        );
    }
    const scopePositional =
      command[0] === "scope" ||
      (!link && !alias && ["create", "list", "batch"].includes(leaf ?? ""))
        ? invocation.positionals[0]
        : undefined;
    const selectedScope = stringOption(options, "scope");
    if (scopePositional !== undefined && selectedScope !== undefined)
      return refuse("scope_binding_conflict", 2, "positional Scope conflicts with --scope");
    scope = parseCanonicalScope(scopePositional ?? selectedScope ?? scope);
    const retry = stringOption(options, "retryFile");
    if (retry !== undefined) {
      const allowed = new Set([
        "retryFile",
        "config",
        "cliProfile",
        "outputFormat",
        "outputMode",
        "long",
      ]);
      if (
        invocation.positionals.length ||
        invocation.explicitOptions.some((key) => !allowed.has(key))
      )
        return refuse(
          "retry_state_invalid",
          2,
          "retry accepts only its saved file and display controls",
        );
    }
    const directSubject = invocation.positionals[0];
    const absoluteSubject =
      directSubject !== undefined &&
      (/^https?:\/\//.test(directSubject) || /^\[https?:\/\//.test(directSubject));
    if (
      retry === undefined &&
      config.scope === undefined &&
      scopePositional === undefined &&
      selectedScope === undefined &&
      !(
        absoluteSubject &&
        !collection &&
        !alias &&
        ["show", "update", "delete", "versions"].includes(leaf ?? "")
      )
    )
      return refuse(
        "missing_target_scope",
        2,
        "supply a Scope or configure scope.url / BDP_SCOPE_URL",
      );
    const historicalSource = stringOption(options, "fromRevision");
    if (historicalSource !== undefined) parseHistoricalSourceSelector(historicalSource);
    const reader = canonicalInputReader(io.signal);
    if (callable !== undefined && parsedCall !== undefined)
      callableArguments = await completeCallableArguments(callable, parsedCall, (path) =>
        path === "-" ? reader.readStdin(MAX_INPUT_BYTES) : reader.readFile(path, MAX_INPUT_BYTES),
      );
    const dryRun = stringOption(options, "dryRunMode");
    if (dryRun !== undefined && !mutation)
      return refuse("invalid_arguments", 2, "emission requires a mutation");
    // Offline member compilation does not discover, read, generate a key, or touch state.
    if (dryRun === "batch" && leaf !== "batch") {
      const compiled = await compileCanonicalInput({
        command,
        options,
        positionals: invocation.positionals,
        scope,
        reader,
        maxInputBytes: MAX_INPUT_BYTES,
      });
      if (compiled.batchMemberText === undefined)
        return refuse("invalid_value", 2, "this command cannot be a batch member");
      await io.stdout(`${compiled.batchMemberText}\n`, io.signal);
      return 0;
    }

    let savedJournal: Journal | undefined;
    if (retry !== undefined) {
      const value = json(utf8.decode(await readBoundedFile(retry, MAX_BYTES)));
      const saved = value as unknown as Journal;
      if (
        Object.keys(value).sort().join(",") !==
          "command,credentialBoundary,credentialScope,prepared,profile,version" ||
        saved.version !== 1 ||
        saved.profile !== "canonical" ||
        JSON.stringify(saved.command) !== JSON.stringify(command) ||
        !saved.prepared ||
        saved.prepared.specification !== RETAINED_V01_SPECIFICATION
      )
        return refuse("retry_state_invalid", 2, "invalid or incompatible frozen invocation");
      scope = parseCanonicalScope(saved.prepared.scope);
      if (saved.credentialScope !== null && parseCanonicalScope(saved.credentialScope) !== scope)
        return refuse(
          "retry_state_invalid",
          2,
          "saved credential policy does not match the owning Scope",
        );
      savedJournal = saved;
    }
    const subjectCommand =
      (!mutation && !collection && !alias && command[0] !== "scope" && !isCall) ||
      (!alias && (leaf === "update" || leaf === "delete"));
    const initial = subjectCommand ? invocation.positionals[0] : undefined;
    let initialRef: ReturnType<typeof parseCanonicalReference> | undefined;
    if (initial !== undefined && leaf === "show") {
      const selected = parseCanonicalReferenceSelection(initial, scope);
      if (selected.selection?.kind === "ordinal") {
        if (
          config.scope?.url === undefined &&
          selectedScope === undefined &&
          selected.uri.startsWith("http")
        )
          return refuse(
            "missing_target_scope",
            2,
            "ordinal revision selection requires --scope or a configured default Scope",
          );
        const revision = await resolveRevisionOrdinal(
          config,
          scope,
          link ? "link" : "bead",
          selected.uri,
          selected.selection.ordinal,
          io.signal,
        );
        initialRef = { uri: selected.uri, revision };
      } else {
        initialRef = parseCanonicalReference(initial, scope, {
          mutationSubject: mutation,
          currentRead: !mutation && leaf === "show",
        });
      }
    } else if (initial !== undefined && leaf === "versions") {
      const selected = parseCanonicalReferenceSelection(initial, scope);
      if (selected.selection !== undefined)
        return refuse("invalid_arguments", 2, "versions requires an unpinned Resource identity");
      initialRef = selected.uri;
    } else if (initial !== undefined) {
      initialRef = parseCanonicalReference(initial, scope, { mutationSubject: mutation });
    }
    const anchor = initialRef === undefined ? scope : referenceUri(initialRef);
    const origin = new URL(anchor).origin;
    const credentialScope =
      savedJournal === undefined ? (config.scope?.url ?? null) : savedJournal.credentialScope;
    const transportOptions = {
      limits: {
        requestBodyBytes: MAX_INPUT_BYTES,
        responseBodyBytes: MAX_BYTES,
        responseTimeoutMs: 30_000,
        cleanupTimeoutMs: 1_000,
      },
      allowTarget: (target: string) => new URL(target).origin === origin,
      credentialForTarget: (target: string) =>
        credentialScope !== null && target.startsWith(credentialScope)
          ? config.auth.token
          : undefined,
    };
    const transport = createRetainedFetchTransport(transportOptions);
    const client = new RetainedClient({
      transport,
      historicalUpdateTransport: createHistoricalUpdateFetchTransport(transportOptions),
      maximumDocumentBytes: MAX_BYTES,
      maximumRequestBodyBytes: MAX_INPUT_BYTES,
      operationTimeoutMs: 60_000,
    });
    const consume = <T>(reply: RetainedReply<T>): T => {
      if (reply.kind !== "success") throw reply;
      specification = RETAINED_V01_SPECIFICATION;
      return reply.value;
    };
    if (mutation && retry === undefined && initial !== undefined && /^https?:\/\//.test(initial)) {
      // A selected historical mutation may name a deleted canonical identity.
      // Verify its configured owning Scope through bindWrite, without requiring
      // a successful current Resource read as an existence prerequisite.
      if (
        selectedScope !== undefined ||
        (historicalSource !== undefined &&
          config.scope?.url !== undefined &&
          initial.startsWith(scope))
      ) {
        if (!initial.startsWith(scope))
          return refuse(
            "scope_binding_conflict",
            2,
            "absolute mutation contradicts its selected owning Scope",
          );
      } else {
        const read = consume(
          await client.read({
            ...call,
            reference: initial,
            expectedKind: link ? "link" : "bead",
            followAlias: true,
          }),
        );
        scope = read.scope;
      }
    }
    if (command[0] === "scope") {
      const reply = await client.inspectScope(scope, call);
      const data = consume(reply);
      if (reply.kind !== "success") throw reply;
      const inspection = {
        ...data,
        beads: new URL("bdp/beads", scope).href,
        links: new URL("bdp/links", scope).href,
      };
      known = {
        schema_version: 2,
        bdp_spec: specification,
        result_kind: "scope",
        outcome: "success",
        context: httpContext(reply.http, scope),
        data: inspection,
      };
    } else if (isCall && callable !== undefined) {
      const actor = stringOption(options, "actor");
      const supplied = stringOption(options, "revisionProvenance");
      const key = stringOption(options, "idempotencyKey");
      const attributed = actor !== undefined || supplied !== undefined;
      const revisionProvenance = attributed
        ? lowerRevisionProvenance(
            supplied === undefined ? undefined : await jsonInput(supplied, reader, MAX_INPUT_BYTES),
            actor,
          )
        : undefined;
      callPhase = "discovery";
      const binding = consume(await client.bindCallables(scope, call));
      callPhase = "invocation";
      const prepared = binding.prepare({
        declaration: callable,
        arguments: callableArguments,
        ...(revisionProvenance === undefined ? {} : { revisionProvenance }),
        ...(key === undefined ? {} : { idempotencyKey: key }),
      });
      callableKey = prepared.idempotencyKey;
      submitted = prepared.kind === "batch";
      const reply = await client.invokeCallable(prepared, call);
      const data = consume(reply);
      if (reply.kind !== "success") throw reply;
      known = {
        schema_version: 2,
        bdp_spec: specification,
        result_kind: descriptor,
        outcome: "success",
        context: httpContext(reply.http, prepared.url),
        data,
      };
    } else if (alias && leaf === "resolve") {
      const operand = invocation.positionals[0];
      if (!operand) return refuse("invalid_arguments", 2, "alias name required");
      const reference = parseCanonicalReference(operand, scope, { mutationSubject: true });
      const reply = await client.resolveAlias(referenceUri(reference), scope, call);
      const data = consume(reply);
      if (reply.kind !== "success") throw reply;
      known = {
        schema_version: 2,
        bdp_spec: specification,
        result_kind: "reference",
        outcome: "success",
        context: httpContext(reply.http, data.alias),
        data: data.target,
      };
    } else if (collection) {
      if (options.paged && options.unpaged)
        return refuse("invalid_arguments", 2, "--paged and --unpaged conflict");
      const pageSize = integer(options.pageSize, 50, 1),
        limit = integer(options.limit, 0, 0);
      const unpaged = options.unpaged === true || (options.paged !== true && format === "jsonl");
      const continuation = stringOption(options, "continue");
      const selectors = [
        "type",
        "exactType",
        "selector",
        "from",
        "to",
        "endpoint",
        "incidentTo",
        "direction",
        "allRevisions",
        "include",
        "omit",
      ];
      if (
        continuation !== undefined &&
        (invocation.positionals.length ||
          invocation.explicitOptions.some((key) => selectors.includes(key)))
      )
        return refuse("invalid_arguments", 2, "continuation cannot reselect its population");
      if (
        options.include !== undefined ||
        (Array.isArray(options.omit) && options.omit.some((value) => value !== "envelope"))
      )
        return refuse(
          "unsupported_capability",
          5,
          "Resource masks require native projection support",
        );
      const kind: RetainedResourceKind = link ? "link" : "bead";
      const filters: Record<string, string> = {};
      // The family filter is the service's to interpret or refuse (Core, Issue §8), and never
      // falls back to exact matching. `--type any` applies no filter.
      for (const [flag, field] of [
        ...(options.type === "any" ? [] : [["type", "conformsTo"] as const]),
        ["exactType", "type"],
        ["from", "source"],
        ["to", "target"],
        ["endpoint", "endpoint"],
      ] as const) {
        const raw = stringOption(options, flag);
        if (raw !== undefined) {
          if (flag === "exactType" && raw === "any")
            return refuse("invalid_value", 2, "--exact-type any is not admitted");
          const ref = parseCanonicalReference(raw, scope, {
            mutationSubject: true,
            allowOpaqueUri: flag !== "exactType" && flag !== "type",
          });
          filters[field] = referenceUri(ref);
        }
      }
      const selector = stringOption(options, "selector");
      if (selector !== undefined) filters.selector = selector;
      const incidentTo = stringOption(options, "incidentTo");
      const incidentSubject =
        incidentTo === undefined
          ? undefined
          : referenceUri(parseCanonicalReference(incidentTo, scope, { mutationSubject: true }));
      if (incidentSubject !== undefined && !incidentSubject.startsWith(scope))
        return refuse("invalid_value", 2, "incident subject must be an in-Scope Bead");
      if (link && invocation.positionals.length) {
        const operands = [...invocation.positionals];
        const resolved = operands.map((operand) => {
          const parsed = parseCanonicalReferenceSelection(operand, scope);
          if (!options.allRevisions && parsed.selection !== undefined)
            return refuse(
              "unsupported_capability",
              5,
              "revision-aware incidence requires a coherent endpoint authority",
            );
          return parsed.uri;
        });
        const identity = (field: string, uri: string): string =>
          `(@.${field} == ${JSON.stringify(uri)} || @.${field}.uri == ${JSON.stringify(uri)})`;
        const orientation = (a: string, b?: string): string =>
          b === undefined
            ? identity("source", a)
            : `(${identity("source", a)} && ${identity("target", b)})`;
        const a = resolved[0] ?? refuse("invalid_arguments", 2, "incidence operand required"),
          b = resolved[1];
        const out = orientation(a, b),
          inbound = b === undefined ? identity("target", a) : orientation(b, a);
        const direction = options.direction ?? (b === undefined ? "both" : "out");
        const incidence =
          direction === "out" ? out : direction === "in" ? inbound : `(${out} || ${inbound})`;
        const raw = filters.selector;
        if (raw !== undefined && (!raw.startsWith("$[?") || !raw.endsWith("]")))
          return refuse("invalid_value", 2, "cannot compose the supplied Selector");
        filters.selector = `$[?${raw === undefined ? incidence : `(${raw.slice(3, -1)}) && ${incidence}`}]`;
      }
      const items: unknown[] = [];
      let next: string | null | undefined = continuation,
        stop: "exhausted" | "page" | "limit" = "page";
      let subject = incidentSubject;
      if (continuation !== undefined) {
        const issued = new URL(continuation);
        // `view=links` is the documented incident request shape; no cursor is
        // decoded and no path segment or inventory suffix is guessed.
        if (issued.searchParams.get("view") === "links")
          subject = `${issued.origin}${issued.pathname}`;
      }
      let latest: RetainedReply<RetainedPageValue> | undefined;
      do {
        const returned = stream?.returned ?? items.length;
        const size = limit === 0 ? pageSize : Math.min(pageSize, limit - returned);
        if (next !== undefined && next !== null) {
          // Change only the per-fetch limit, retaining the opaque cursor and selection.
          const page = resizePage(next, size);
          latest = await client.readPage({
            ...call,
            url: page,
            scope,
            collectionKind: kind,
            ...(subject === undefined ? {} : { subject }),
          });
        } else if (incidentSubject !== undefined) {
          const direction =
            options.direction === "in"
              ? "inbound"
              : options.direction === "out"
                ? "outbound"
                : "both";
          latest = await client.incident({
            ...call,
            scope,
            bead: incidentSubject,
            direction,
            filters,
            limit: size,
          });
        } else latest = await client.list({ ...call, scope, kind, filters, limit: size });
        const value = consume(latest),
          page = value.page;
        if (page === undefined || page.items.length > size)
          return refuse("invalid_value", 1, "provider exceeded the requested page budget");
        if (format === "jsonl") {
          if (stream === undefined) {
            stream = {
              raw: Array.isArray(options.omit) && options.omit.includes("envelope"),
              returned: 0,
            };
            if (!stream.raw)
              await io.stdout(
                `${JSON.stringify({ record_type: "header", schema_version: 2, bdp_spec: specification, result_kind: "resource_collection", context: httpContext(latest.http, subject ?? scope, kind) })}\n`,
                io.signal,
              );
          }
          // While inside a page there is no resumable native boundary.
          delete stream.next;
          for (const item of page.items) {
            io.signal?.throwIfAborted();
            await io.stdout(
              `${JSON.stringify(stream.raw ? item : { record_type: "item", data: item })}\n`,
              io.signal,
            );
            stream.returned++;
          }
          stream.next = page.next;
        } else items.push(...page.items);
        next = page.next;
        if (next === null) stop = "exhausted";
        else if (limit > 0 && (stream?.returned ?? items.length) >= limit) stop = "limit";
        else stop = "page";
        if (stop !== "page" || !unpaged) break;
      } while (next !== null);
      if (latest?.kind !== "success") throw latest;
      if (stream !== undefined) {
        if (!stream.raw)
          await io.stdout(
            `${JSON.stringify({ record_type: "terminal", outcome: "success", completion: { returned: stream.returned, exhausted: next === null, stop_reason: stop }, continuation: next })}\n`,
            io.signal,
          );
        return 0;
      }
      known = {
        schema_version: 2,
        bdp_spec: specification,
        result_kind: "resource_collection",
        outcome: "success",
        context: httpContext(latest.http, subject ?? scope, kind),
        data: { items, next },
        completion: { returned: items.length, exhausted: next === null, stop_reason: stop },
      };
    } else if (leaf === "versions") {
      const raw = invocation.positionals[0];
      if (!raw) return refuse("invalid_arguments", 2, "Resource identity required");
      const subject = parseCanonicalReferenceSelection(raw, scope);
      if (subject.selection !== undefined)
        return refuse("invalid_arguments", 2, "versions requires an unpinned Resource identity");
      const resource: "bead" | "link" = link ? "link" : "bead";
      const pageSize = options.pageSize === undefined ? undefined : integer(options.pageSize, 0, 1);
      const followAll = options.all === true;
      const history = createHistoryClient(config, scope);
      let pageNumber = 0;
      let next: string | null = null;
      let firstPage: HistoryVersionsPage | undefined;
      const items: HistoryVersionRow[] = [];
      try {
        let continuation: string | undefined;
        do {
          if (++pageNumber > MAX_ORDINAL_HISTORY_PAGES)
            return refuse(
              "unsupported_capability",
              5,
              `History traversal exceeds the ${MAX_ORDINAL_HISTORY_PAGES}-page CLI bound`,
            );
          const result = await history.performHistory(
            {
              kind: "versions",
              resource,
              id: parseCanonicalHttpUrl(subject.uri),
              ...(pageSize === undefined || continuation !== undefined ? {} : { limit: pageSize }),
              ...(continuation === undefined
                ? {}
                : { continuation: parseCanonicalHttpUrl(continuation) }),
            },
            call,
          );
          if (isBdpClientProblem(result)) {
            // This legacy read path cannot parse Core discovery. History is optional, so ask
            // the current reader whether the Scope advertises it before blaming the Scope.
            const current = await client.inspectScope(scope, call).catch(() => undefined);
            if (current?.kind === "success" && current.value.historicalResolution === undefined)
              return refuse(
                "unsupported_capability",
                5,
                `${scope} does not advertise History, so it has no versions to list`,
              );
            throw { kind: "problem", problem: result };
          }
          const page = result as HistoryVersionsPage;
          firstPage ??= page;
          items.push(...page.items);
          next = page.next;
          continuation = page.next ?? undefined;
        } while (followAll && next !== null);
      } finally {
        await history.close();
      }
      if (firstPage === undefined)
        return refuse("invalid_value", 1, "History returned no versions page");
      const data = {
        ...firstPage,
        items: items.map((row, index) => ({ ordinal: index + 1, ...row })),
        next,
      };
      known = {
        schema_version: 2,
        bdp_spec: specification,
        result_kind: "history_versions",
        outcome: "success",
        context: {
          subject: firstPage.subject,
          resource_kind: resource,
          pages: pageNumber,
          complete_traversal: next === null,
        },
        data,
        completion: {
          returned: items.length,
          exhausted: next === null,
          stop_reason: next === null ? "exhausted" : "page",
        },
      };
    } else if (
      !mutation ||
      (leaf === "delete" && options.force !== true && !alias && retry === undefined)
    ) {
      const include = Array.isArray(options.include) ? (options.include as string[]) : undefined;
      const omit = Array.isArray(options.omit)
        ? (options.omit as string[]).filter((value) => value !== "envelope")
        : undefined;
      const masks = {
        ...(include === undefined ? {} : { include }),
        ...(omit === undefined || omit.length === 0 ? {} : { omit }),
      };
      const masked = Object.keys(masks).length > 0;
      if (options.propertiesOnly) validateCanonicalPropertiesMasks(masks);
      if (masked && !options.propertiesOnly)
        return refuse(
          "unsupported_capability",
          5,
          "requested optional read representation is unsupported",
        );
      if (
        leaf === "delete" &&
        invocation.explicitOptions.some((key) =>
          ["actor", "ifRevision", "idempotencyKey", "dryRunMode", "revisionProvenance"].includes(
            key,
          ),
        )
      )
        return refuse("invalid_arguments", 2, "mutation-only options require --force");
      const raw = invocation.positionals[0];
      if (!raw) return refuse("invalid_arguments", 2, "Resource operand required");
      const ref =
        initialRef ?? parseCanonicalReference(raw, scope, { currentRead: leaf === "show" });
      if (options.includeLinks && typeof ref !== "string")
        return refuse(
          "invalid_arguments",
          2,
          "--include-links reads the current Bead; a historical read has no included Links",
        );
      const linksLimit =
        options.linksLimit === undefined ? undefined : integer(options.linksLimit, 0, 1);
      const linksDirection = ({ in: "inbound", out: "outbound", both: "both" } as const)[
        String(options.direction) as "in" | "out" | "both"
      ];
      const reply = await client.read({
        ...call,
        reference: ref,
        allowExactRevision: true,
        followAlias: true,
        ...(link ? { expectedKind: "link" as const } : {}),
        ...(options.propertiesOnly ? { view: "properties" as const } : {}),
        ...(options.includeLinks
          ? {
              includeLinks: {
                ...(linksDirection === undefined ? {} : { direction: linksDirection }),
                ...(linksLimit === undefined ? {} : { limit: linksLimit }),
              },
            }
          : {}),
        ...(selectedScope === undefined ? {} : { scope }),
      });
      const data = consume(reply);
      if (reply.kind !== "success") throw reply;
      scope = data.scope;
      descriptor = options.propertiesOnly ? "properties" : "resource";
      const body =
        options.propertiesOnly && data.body !== undefined && masked
          ? projectCanonicalProperties(data.body, masks)
          : data.body;
      known = {
        schema_version: 2,
        bdp_spec: specification,
        result_kind: descriptor,
        outcome: "success",
        context: {
          ...httpContext(reply.http, data.subject ?? referenceUri(ref), data.resourceKind),
          ...(leaf === "delete" ? { preview: "delete" } : {}),
        },
        ...(masked ? { projection: masks } : {}),
        data: body,
      };
    } else {
      if (leaf === "batch")
        return refuse(
          "unsupported_capability",
          5,
          "atomic batch is not yet received by this client",
        );
      let prepared: PreparedRetainedWrite;
      if (retry !== undefined) {
        const saved = savedJournal ?? refuse("retry_state_invalid", 2, "missing frozen invocation");
        if (saved.credentialBoundary !== credentialBoundary(config, credentialScope))
          return refuse(
            "retry_state_invalid",
            2,
            "credential boundary changed; original outcome is unresolved",
          );
        prepared = saved.prepared;
        pendingRecovery = retry;
      } else {
        const compiled = await compileCanonicalInput({
          command,
          options,
          positionals: invocation.positionals,
          scope,
          reader,
          maxInputBytes: MAX_INPUT_BYTES,
        });
        if (!RETAINED_WRITE_OPERATIONS.includes(compiled.operation))
          return refuse("unsupported_capability", 5, "unsupported mutation");
        const binding = consume(await client.bindWrite(scope, call));
        const historical = options.fromRevision !== undefined;
        if (historical && !binding.historicalUpdateSupported)
          return refuse("unsupported_capability", 5, "historical-update1 is not advertised");
        const prepare = (key: string): PreparedRetainedWrite =>
          historical
            ? binding.prepareHistoricalUpdate(compiled.bodyText, key)
            : binding.prepare(compiled.operation, compiled.bodyText, key);
        if (dryRun === "bdp") {
          const preview = prepare("preview");
          await io.stdout(
            `${JSON.stringify({ method: preview.method, url: preview.url, headers: { accept: preview.headers.accept, "content-type": preview.headers["content-type"] }, body: json(preview.bodyText) })}\n`,
            io.signal,
          );
          return 0;
        }
        prepared = prepare(stringOption(options, "idempotencyKey") ?? randomUUID());
        pendingRecovery = await saveCanonicalJournal({
          version: 1,
          profile: "canonical",
          command,
          credentialScope,
          credentialBoundary: credentialBoundary(config, credentialScope),
          prepared,
        } satisfies Journal);
      }
      submitted = true;
      specification = prepared.specification;
      const reply = await client.submit(prepared, call);
      const data = consume(reply);
      if (reply.kind !== "success") throw reply;
      known = {
        schema_version: 2,
        bdp_spec: specification,
        result_kind: "mutation",
        outcome: "success",
        context: httpContext(reply.http, scope),
        data,
      };
    }
    if (known) await output(known);
    return 0;
  } catch (error) {
    let status = 1,
      code = "invalid_value",
      message = `unexpected client failure (${error instanceof Error ? error.name : typeof error})`,
      unknown = submitted && known === undefined;
    let nativeProblem: RetainedJsonObject | undefined;
    let cause: string | undefined;
    if (error instanceof CliError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof CallableUsageError) {
      status = 2;
      code = "invalid_arguments";
      message = error.message;
    } else if (error instanceof CanonicalUnsupportedInputError) {
      status = 5;
      code = "unsupported_capability";
      message = error.message;
    } else if (error instanceof CanonicalInputError || error instanceof CanonicalProjectionError) {
      status = 2;
      code = "invalid_value";
      message = error.message;
    } else if (error instanceof BdpClientLocalError) {
      status = error.code === "invalid-request" ? 2 : 1;
      code = error.code;
      message = localFailure(error);
    } else if (error instanceof RetainedClientError || error instanceof RetainedTransportError) {
      // A CallableQuery changes nothing, so no outcome of one is uncertain.
      unknown = error.submission === "unknown" && callable?.type !== CALLABLE_QUERY_TYPE;
      status = error.code === "unsupported-feature" ? 5 : error.code === "invalid-input" ? 2 : 1;
      code = unknown
        ? "write_outcome_unknown"
        : error.code === "unsupported-feature"
          ? "unsupported_capability"
          : isCall
            ? "delivery_failed"
            : "invalid_value";
      cause = callFailure(error, isCall ? callPhase : "request", scope);
      message = unknown
        ? "Write disposition is unknown; recover the saved invocation with the same key"
        : cause;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "kind" in error &&
      error.kind === "http"
    ) {
      const { http } = error as unknown as { http: RetainedHttpContext };
      cause = `${answered(http)} with no Problem body`;
      if (isCall) code = "delivery_failed";
      message = cause;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "kind" in error &&
      error.kind === "problem"
    ) {
      const reply = error as unknown as {
        problem: RetainedJsonObject;
        http?: { status?: number };
      };
      nativeProblem = reply.problem;
      status = problemExit(reply.problem);
      const replay = String(reply.problem.code).startsWith("idempotency-");
      unknown =
        submitted &&
        (isCall
          ? // §5: a Problem from an atomic batch means nothing committed; §9: 503
            // callable-unavailable means the operation did not run.
            replay ||
            (callable?.atomic !== true &&
              (reply.http?.status ?? 0) >= 500 &&
              reply.problem.code !== "callable-unavailable")
          : replay || reply.problem.code === "temporarily-unavailable");
    }
    if (unknown && nativeProblem === undefined) {
      code = "write_outcome_unknown";
      message = isCall
        ? `${cause === undefined ? "" : `${cause}; `}the Callable's outcome is unknown; read before repeating, or repeat with the same key`
        : "Write disposition is unknown; recover the saved invocation with the same key";
    }
    if (io.signal?.aborted && !(error instanceof CanonicalOutputError)) {
      status = 130;
      if (!unknown) {
        code = "interrupted";
        message = "BDP delivery interrupted";
      }
    }
    if (error instanceof CanonicalOutputError) {
      status = 1;
      code = "output_failed";
      message = "BDP output failed";
    }
    const failure: CanonicalOutput = {
      schema_version: 2,
      bdp_spec: specification,
      result_kind: descriptor,
      outcome: unknown ? "unknown" : "failure",
      ...(known?.data === undefined ? {} : { data: known.data }),
      context: {
        ...(known === undefined ? {} : { operation_outcome: known.outcome }),
        ...(unknown && callableKey !== undefined ? { idempotency_key: callableKey } : {}),
        ...(isCall && submitted && !unknown && nativeProblem !== undefined
          ? { effects: callable?.atomic === true ? "none" : "not-established" }
          : {}),
        ...(unknown && pendingRecovery
          ? {
              recovery: {
                file: pendingRecovery,
                argv: ["bdp", ...command, "--retry-file", pendingRecovery],
              },
            }
          : {}),
      },
      error: nativeProblem
        ? { origin: "bdp", problem: nativeProblem }
        : { origin: "cli", problem: { code, message } },
    };
    const { data: _undeliverableData, ...failureDiagnostic } = failure;
    let diagnostic: unknown = failureDiagnostic;
    try {
      if (stream !== undefined) {
        const terminal = {
          record_type: "terminal",
          outcome: "failure",
          completion: {
            returned: stream.returned,
            exhausted: stream.next === undefined ? null : stream.next === null,
            stop_reason: "error",
          },
          ...(stream.next === undefined ? {} : { continuation: stream.next }),
          error: failure.error,
        };
        diagnostic = terminal;
        if (stream.raw) await io.stderr(`${JSON.stringify(terminal)}\n`, failureSignal());
        else await io.stdout(`${JSON.stringify(terminal)}\n`, failureSignal());
      } else await output(failure);
    } catch {
      await Promise.resolve(
        io.stderr(`${JSON.stringify(diagnostic)}\n`, AbortSignal.timeout(1000)),
      ).catch(() => undefined);
    }
    return status;
  }
}

/** Avoid URLSearchParams serialization of the opaque issued selection. */
function resizePage(issued: string, size: number): string {
  const parsed = new URL(issued);
  const matches = [...parsed.searchParams.keys()].filter((key) => key === "limit");
  if (matches.length > 1) return refuse("invalid_value", 2, "invalid continuation limit");
  if (matches.length === 1) return issued.replace(/([?&])limit=[^&#]*/, `$1limit=${size}`);
  return `${issued}${parsed.search === "" ? "?" : "&"}limit=${size}`;
}
