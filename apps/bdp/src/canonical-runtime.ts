import { createHash, randomUUID } from "node:crypto";
import {
  createHistoricalUpdateFetchTransport,
  createRetainedFetchTransport,
  type PreparedRetainedWrite,
  RetainedClient,
  RetainedClientError,
  type RetainedPageValue,
  type RetainedReply,
  RetainedTransportError,
} from "@bdp/client";
import type { CanonicalCliConfig } from "@bdp/config";
import {
  admitJsonNumbers,
  decodeJsonDocument,
  parseCanonicalScope,
  RETAINED_V01_SPECIFICATION,
  RETAINED_WRITE_OPERATIONS,
  type RetainedJsonObject,
  type RetainedResourceKind,
} from "@bdp/protocol";
import type { CanonicalInvocation } from "./canonical-command.js";
import {
  CanonicalInputError,
  CanonicalUnsupportedInputError,
  parseHistoricalSourceSelector,
  compileCanonicalInput,
  parseCanonicalReference,
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
function problemExit(problem: RetainedJsonObject): number {
  const code = problem.code;
  if (code === "resource-not-found" || code === "revision-not-found" || code === "alias-not-found")
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
  let specification: string | null = null;
  let descriptor = mutation
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
  const output = async (value: CanonicalOutput): Promise<void> => {
    const rendered = renderCanonicalOutput(value, options, scope);
    await io.stdout(rendered, value.outcome === "success" ? io.signal : failureSignal());
    const raw = Array.isArray(options.omit) && options.omit.includes("envelope");
    if (
      value.outcome !== "success" &&
      (raw || (options.outputFormat !== "json" && options.outputFormat !== "jsonl"))
    )
      await io.stderr(
        `${JSON.stringify({ error: value.error, ...(value.context?.recovery === undefined ? {} : { recovery: value.context.recovery }) })}\n`,
        failureSignal(),
      );
  };
  try {
    const format = options.outputFormat ?? "default";
    if (
      !["default", "detail", "table", "json", "jsonl"].includes(String(format)) ||
      (format === "table" && !collection)
    )
      return refuse("invalid_arguments", 2, "output format is not admitted for this command");
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
      const allowed = new Set(["retryFile", "config", "cliProfile", "outputFormat", "long"]);
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
        ["show", "update", "delete"].includes(leaf ?? "")
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
      (!mutation && !collection && !alias && command[0] !== "scope") ||
      (!alias && (leaf === "update" || leaf === "delete"));
    const initial = subjectCommand ? invocation.positionals[0] : undefined;
    const current =
      initial !== undefined &&
      !mutation &&
      !/^https?:/.test(initial) &&
      initial.endsWith("@current");
    const initialRef =
      initial === undefined
        ? undefined
        : parseCanonicalReference(
            current
              ? initial.startsWith("[")
                ? initial.slice(1, -9)
                : initial.slice(0, -8)
              : initial,
            scope,
            { mutationSubject: mutation && !(leaf === "delete" && options.force !== true) },
          );
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
      known = {
        schema_version: 2,
        bdp_spec: specification,
        result_kind: "scope",
        outcome: "success",
        context: httpContext(reply.http, scope),
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
      if (options.type !== undefined && options.type !== "any")
        return refuse(
          "unsupported_capability",
          5,
          "Type-family filtering requires the Types capability",
        );
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
      for (const [flag, field] of [
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
            allowOpaqueUri: flag !== "exactType",
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
          if (!options.allRevisions && !/^https?:/.test(operand) && operand.includes("@"))
            return refuse(
              "unsupported_capability",
              5,
              "revision-aware incidence requires a coherent endpoint authority",
            );
          const withoutSelector =
            options.allRevisions && !/^https?:/.test(operand)
              ? (operand.split("@", 1)[0] ?? "")
              : operand;
          const resolved = parseCanonicalReference(withoutSelector, scope, {
            mutationSubject: true,
          });
          const uri = referenceUri(resolved);
          return uri;
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
      if (
        options.includeLinks ||
        options.linksLimit ||
        options.direction ||
        (masked && !options.propertiesOnly)
      )
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
      const ref = initialRef ?? parseCanonicalReference(raw, scope);
      const reply = await client.read({
        ...call,
        reference: ref,
        allowExactRevision: true,
        followAlias: true,
        ...(link ? { expectedKind: "link" as const } : {}),
        ...(options.propertiesOnly ? { view: "properties" as const } : {}),
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
      message = "command failed",
      unknown = submitted && known === undefined;
    let nativeProblem: RetainedJsonObject | undefined;
    if (error instanceof CliError) {
      status = error.status;
      code = error.code;
      message = error.message;
    } else if (error instanceof CanonicalUnsupportedInputError) {
      status = 5;
      code = "unsupported_capability";
      message = error.message;
    } else if (error instanceof CanonicalInputError || error instanceof CanonicalProjectionError) {
      status = 2;
      code = "invalid_value";
      message = error.message;
    } else if (error instanceof RetainedClientError || error instanceof RetainedTransportError) {
      unknown = error.submission === "unknown";
      status = error.code === "unsupported-feature" ? 5 : error.code === "invalid-input" ? 2 : 1;
      code = unknown
        ? "write_outcome_unknown"
        : error.code === "unsupported-feature"
          ? "unsupported_capability"
          : "invalid_value";
      message = unknown
        ? "Write disposition is unknown; recover the saved invocation with the same key"
        : "BDP delivery failed";
    } else if (
      typeof error === "object" &&
      error !== null &&
      "kind" in error &&
      error.kind === "problem"
    ) {
      const reply = error as unknown as { problem: RetainedJsonObject };
      nativeProblem = reply.problem;
      status = problemExit(reply.problem);
      unknown =
        submitted &&
        (String(reply.problem.code).startsWith("idempotency-") ||
          reply.problem.code === "temporarily-unavailable");
    }
    if (unknown && nativeProblem === undefined) {
      code = "write_outcome_unknown";
      message = "Write disposition is unknown; recover the saved invocation with the same key";
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
