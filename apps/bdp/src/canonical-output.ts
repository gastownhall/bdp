import type { RetainedHttpContext } from "@bdp/client";

export interface CanonicalOutput {
  readonly schema_version: 2;
  readonly bdp_spec: string | null;
  readonly result_kind: string;
  readonly outcome: "success" | "failure" | "unknown";
  readonly data?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly completion?: {
    readonly returned: number;
    readonly exhausted: boolean | null;
    readonly stop_reason: "exhausted" | "page" | "limit" | "error";
  };
  readonly projection?: { readonly include?: readonly string[]; readonly omit?: readonly string[] };
  readonly error?: { readonly origin: "bdp" | "cli"; readonly problem: unknown };
}
export function httpContext(
  http: RetainedHttpContext,
  subject: string,
  kind?: string,
): Record<string, unknown> {
  return {
    subject,
    ...(kind === undefined ? {} : { resource_kind: kind }),
    httpStatus: http.status,
    headers: Object.fromEntries(Object.entries(http.headers).map(([key, value]) => [key, [value]])),
  };
}
type ObjectValue = Record<string, unknown>;
function record(value: unknown): ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
}
function ref(value: unknown, scope?: string, long = false): string {
  if (typeof value !== "string") {
    const pinned = record(value);
    if (typeof pinned.uri !== "string") return "";
    const identity = ref(pinned.uri, scope, long);
    return `${/^https?:\/\//.test(identity) ? `[${identity}]` : identity}@=${String(pinned.revision)}`;
  }
  return !long && scope && value.startsWith(scope) ? value.slice(scope.length) : value;
}
export function resourceRows(items: readonly unknown[], scope?: string, long = false): string {
  const links = items.some((item) => Object.hasOwn(record(item), "source"));
  const status = items.some((item) => Object.hasOwn(record(record(item).properties), "status"));
  const rows = items.map((item) => {
    const r = record(item),
      p = record(r.properties);
    return [
      ref(r.id, scope, long),
      ref(r.type, scope, long),
      typeof p.title === "string" ? p.title : "",
      ...(links ? [ref(r.source, scope, long), ref(r.target, scope, long)] : []),
      ...(status ? [p.status === undefined ? "" : String(p.status)] : []),
    ];
  });
  const headers = [
    "ID",
    "TYPE",
    "TITLE",
    ...(links ? ["SOURCE", "TARGET"] : []),
    ...(status ? ["STATUS"] : []),
  ];
  const clean = (text: string): string =>
    Array.from(text, (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || (code >= 127 && code <= 159) ? " " : character;
    }).join("");
  const grid = [headers, ...rows].map((row) => row.map(clean));
  const widths = headers.map((_, column) =>
    Math.max(...grid.map((row) => row[column]?.length ?? 0)),
  );
  return `${grid
    .map((row) =>
      row
        .map((cell, i) => cell.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n")}\n`;
}
function document(value: unknown, scope?: string, long = false): string {
  const r = record(value),
    p = record(r.properties);
  const lines = [`${ref(r.id, scope, long)} [${ref(r.type, scope, long)}]`];
  if (typeof p.title === "string") lines.push(p.title);
  if (r.revision !== undefined) lines.push(`Revision: ${String(r.revision)}`);
  if (r.source !== undefined)
    lines.push(`Source: ${ref(r.source, scope, long)}`, `Target: ${ref(r.target, scope, long)}`);
  if (typeof p.body === "string") lines.push("", p.body);
  const properties = Object.fromEntries(
    Object.entries(p).filter(
      ([key, val]) => !((key === "title" || key === "body") && typeof val === "string"),
    ),
  );
  if (Object.keys(properties).length)
    lines.push("", "Properties:", JSON.stringify(properties, null, 2));
  if (Object.keys(record(r.metadata)).length)
    lines.push("", "Metadata:", JSON.stringify(r.metadata, null, 2));
  if (r.links !== undefined) {
    const included = record(r.links);
    const rows = Array.isArray(included.items) ? included.items : [];
    lines.push(
      "",
      "Links:",
      rows.length === 0 ? "(none)" : resourceRows(rows, scope, long).trimEnd(),
    );
    if (typeof included.next === "string") lines.push(`More: ${included.next}`);
  }
  if (long) {
    const detail = Object.fromEntries(
      Object.entries(r).filter(
        ([key]) =>
          ![
            "id",
            "type",
            "revision",
            "source",
            "target",
            "properties",
            "metadata",
            "links",
          ].includes(key),
      ),
    );
    if (Object.keys(detail).length) lines.push("", "Context:", JSON.stringify(detail, null, 2));
  }
  return `${lines.join("\n")}\n`;
}

function scopeDocument(value: unknown, long = false): string {
  const r = record(value);
  const lines: string[] = [];
  for (const [label, key] of [
    ["Scope", "scope"],
    ["BDP version", "bdpVersion"],
    ["Profile", "profile"],
    ["Beads inventory", "beads"],
    ["Links inventory", "links"],
    ["Aliases", "aliases"],
    ["Events", "events"],
    ["Operations", "operations"],
  ] as const) {
    const item = r[key];
    if (typeof item === "string") lines.push(`${label}: ${item}`);
  }
  if (r.limits !== undefined) lines.push("Limits:", JSON.stringify(r.limits, null, 2));
  const displayed = new Set([
    "scope",
    "bdpVersion",
    "profile",
    "beads",
    "links",
    "aliases",
    "events",
    "operations",
    "limits",
  ]);
  const other = Object.fromEntries(Object.entries(r).filter(([key]) => !displayed.has(key)));
  if (Object.keys(other).length > 0)
    lines.push("Other advertised fields:", JSON.stringify(other, null, 2));
  if (long) lines.push("", "Discovery:", JSON.stringify(r, null, 2));
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function versionsDocument(value: unknown, scope?: string, long = false): string {
  const page = record(value);
  const window = record(page.window);
  const lines = [
    `Subject: ${ref(page.subject, scope, long)}`,
    `Population: ${String(page.population ?? "")}`,
    `Participation: ${String(page.participation ?? "")}`,
    `Window: ${window.complete === true ? "complete" : "incomplete"}`,
    "ORDINAL  REVISION  LINEAGE   BODY",
  ];
  const items = Array.isArray(page.items) ? page.items : [];
  for (const item of items) {
    const row = record(item);
    lines.push(
      `${String(row.ordinal ?? "").padEnd(8)}${String(row.revision ?? "").padEnd(10)}${String(row.lineage ?? "").padEnd(10)}${String(row.body ?? "")}`,
    );
  }
  lines.push(`Next: ${page.next === null ? "none" : String(page.next ?? "unknown")}`);
  if (long && window.newest !== undefined)
    lines.push(`Bounds: newest=${String(window.newest)} oldest=${String(window.oldest)}`);
  return `${lines.join("\n")}\n`;
}

/** Finite serialization completes before stdout is touched. JSONL never puts
 * success in the header; a compound mutation remains a single item. */
const CELL_WIDTH = 48;

/** A result's text reaches the terminal without controls, whatever the service sent. */
function terminalText(text: string): string {
  return Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "\n" || (code >= 32 && code < 127) || code > 159 ? character : " ";
  }).join("");
}
const isTabular = (value: unknown): value is readonly ObjectValue[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item));
const isEmptyValue = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" && value !== null && Object.keys(value).length === 0);
const plain = (value: unknown): string =>
  terminalText(typeof value === "string" ? value : JSON.stringify(value));

/** Rows of one record kind. A column empty in every row says nothing and is left out. */
function callableTable(rows: readonly ObjectValue[], cut: { shortened: boolean }): string[] {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((column) =>
    rows.some((row) => !isEmptyValue(row[column])),
  );
  const cell = (value: unknown): string => {
    const text = isEmptyValue(value) ? "" : plain(value).replace(/\s+/g, " ");
    if (text.length <= CELL_WIDTH) return text;
    cut.shortened = true;
    return `${text.slice(0, CELL_WIDTH - 1)}…`;
  };
  const cells = rows.map((row) => columns.map((column) => cell(row[column])));
  const widths = columns.map((column, index) =>
    Math.max(terminalText(column).length, ...cells.map((row) => (row[index] ?? "").length)),
  );
  const line = (row: readonly string[]): string =>
    row
      .map((text, index) => text.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(columns.map(terminalText)), ...cells.map(line)];
}
function callableLines(value: unknown, cut: { shortened: boolean }): string[] {
  if (isTabular(value)) return callableTable(value, cut);
  if (Array.isArray(value))
    return value.length === 0 ? ["(none)"] : value.map((item) => plain(item));
  if (value === null || typeof value !== "object") return plain(value).split("\n");
  const members = Object.entries(value);
  if (members.length === 0) return ["(empty)"];
  return members.flatMap(([key, member]) => {
    const name = terminalText(key);
    if (isTabular(member)) return ["", `${name}:`, ...callableTable(member, cut), ""];
    if (Array.isArray(member))
      return [`${name}: ${member.length === 0 ? "(none)" : member.map(plain).join(", ")}`];
    if (member !== null && typeof member === "object" && Object.keys(member).length > 0)
      return [`${name}:`, ...callableLines(member, cut).map((text) => `  ${text}`)];
    const [first, ...others] = plain(member).split("\n");
    return [`${name}: ${first}`, ...others.map((text) => `  ${text}`)];
  });
}

/** Members of a v0 Problem carried in `error` that the first line already says. */
const SAID_MEMBERS = new Set(["type", "status", "title", "code", "detail"]);

/** A failed Callable in human mode: what was refused and why, in lines a person reads. Everything
 * but the wording comes from the failure, and `--output-mode json` carries all of it unchanged. */
export function renderCallableFailure(failure: CanonicalOutput): string {
  const problem = record(record(failure.error).problem);
  const operation = record(problem.error);
  const word = (value: unknown): string | undefined =>
    typeof value === "string" && value !== "" ? terminalText(value) : undefined;
  const codes = [word(problem.code), word(operation.code)].filter((code) => code !== undefined);
  const detail =
    word(problem.detail) ??
    word(operation.detail) ??
    word(problem.message) ??
    word(operation.title) ??
    word(problem.title);
  const diagnostics = Array.isArray(problem.diagnostics) ? problem.diagnostics.map(record) : [];
  const context = record(failure.context);
  const lines = [
    `error: ${[...codes, ...(detail === undefined ? [] : [detail])].join(": ") || "the Callable failed"}`,
    ...diagnostics.flatMap((diagnostic) => {
      const message = word(diagnostic.message);
      const location = word(diagnostic.instanceLocation);
      const repeated = message === undefined || (detail !== undefined && message.endsWith(detail));
      if (repeated && location === undefined) return [];
      return [`  ${[location, repeated ? undefined : message].filter(Boolean).join(": ")}`];
    }),
    ...Object.entries(operation)
      .filter(([member]) => !SAID_MEMBERS.has(member))
      .map(([member, value]) => `  ${terminalText(member)}: ${plain(value)}`),
    ...(diagnostics.some(({ instanceLocation }) => instanceLocation === "/revisionProvenance/actor")
      ? ["  Say who is acting with --actor NAME."]
      : []),
    ...(context.effects === "none" ? ["  Nothing was changed."] : []),
    ...(failure.outcome === "unknown" && record(failure.error).origin === "bdp"
      ? ["  The outcome is unknown; read before repeating, or repeat with the same key."]
      : []),
    ...(typeof context.idempotency_key === "string"
      ? [`  To recover, repeat with --idempotency-key ${terminalText(context.idempotency_key)}`]
      : []),
  ];
  return `${lines.join("\n")}\n`;
}

/** The one human form of every Callable result: boring, generic, with no per-package view. */
function callableResultText(data: ObjectValue): string {
  const cut = { shortened: false };
  const result = record(data.result);
  // The envelope says `changed`, and a product's own result may too. One line when they agree;
  // when they do not, both, because which of them is right is not this client's to pick.
  const both = typeof data.changed === "boolean" && typeof result.changed === "boolean";
  const { changed: _said, ...rest } = result;
  const lines = [
    ...(both && data.changed !== result.changed
      ? [`changed (invocation): ${data.changed}`, `changed (result): ${result.changed}`]
      : typeof data.changed === "boolean"
        ? [`changed: ${data.changed}`]
        : []),
    ...(both && Object.keys(rest).length === 0
      ? []
      : callableLines(both ? rest : data.result, cut)),
  ];
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  if (cut.shortened)
    lines.push("", "(long values shortened; --output-mode json carries them whole)");
  return `${lines.join("\n")}\n`;
}

export function renderCanonicalOutput(
  output: CanonicalOutput,
  options: Readonly<Record<string, unknown>>,
  scope?: string,
): string {
  const format = options.outputFormat ?? (options.outputMode === "json" ? "json" : "default");
  const omit = Array.isArray(options.omit) ? options.omit : [];
  const raw = omit.includes("envelope");
  if (format === "json")
    return raw
      ? output.data === undefined
        ? ""
        : `${JSON.stringify(output.data)}\n`
      : `${JSON.stringify(output)}\n`;
  if (format === "jsonl") {
    const data = record(output.data);
    const items =
      ["resource_collection", "history_versions"].includes(output.result_kind) &&
      Array.isArray(data.items)
        ? data.items
        : output.data === undefined
          ? []
          : [output.data];
    if (raw) return items.map((item) => `${JSON.stringify(item)}\n`).join("");
    const { outcome, error, completion, data: ignored, ...identity } = output;
    const header = { record_type: "header", ...identity };
    const terminal = {
      record_type: "terminal",
      outcome,
      ...(completion === undefined ? {} : { completion }),
      ...(error === undefined ? {} : { error }),
      ...(["resource_collection", "history_versions"].includes(output.result_kind) &&
      Object.hasOwn(data, "next")
        ? { continuation: data.next }
        : {}),
    };
    return (
      [
        JSON.stringify(header),
        ...items.map((item) => JSON.stringify({ record_type: "item", data: item })),
        JSON.stringify(terminal),
      ].join("\n") + "\n"
    );
  }
  if (output.outcome !== "success") return "";
  if (output.result_kind === "scope") return scopeDocument(output.data, options.long === true);
  if (output.result_kind === "history_versions")
    return versionsDocument(output.data, scope, options.long === true);
  if (output.result_kind === "reference")
    return `${ref(output.data, scope, options.long === true)}\n`;
  if (output.result_kind === "resource") {
    const long = options.long === true;
    const text = document(output.data, scope, long);
    if (output.context?.preview !== "delete") return text;
    // A delete without --force is a read: say so, or it looks exactly like `show` and exit 0.
    const words = [
      "bdp",
      ...(output.context.resource_kind === "link" ? ["link"] : []),
      "delete",
      ref(record(output.data).id, scope, long),
      "--force",
      ...(typeof options.scope === "string" ? ["--scope", options.scope] : []),
    ];
    return `Preview only: nothing was deleted.\n\n${text}\nTo delete it, run: ${terminalText(words.join(" "))}\n`;
  }
  if (output.result_kind === "resource_collection") {
    const items = record(output.data).items;
    if (!Array.isArray(items)) return "";
    return format === "detail"
      ? items.map((item) => document(item, scope, options.long === true)).join("\n")
      : resourceRows(items, scope, options.long === true);
  }
  if (output.result_kind === "callable_catalog") {
    const items = record(output.data).items;
    if (!Array.isArray(items)) return "";
    const rows = items.map((item) => record(item));
    const width = Math.max(0, ...rows.map((row) => String(row.name).length));
    return rows.map((row) => `${String(row.name).padEnd(width)}  ${String(row.kind)}\n`).join("");
  }
  if (output.result_kind === "callable_result" && format === "default")
    return callableResultText(record(output.data));
  if (output.result_kind === "mutation") {
    const data = record(output.data);
    const result = data.result === undefined ? data : record(data.result);
    if (result.resource !== undefined)
      return `Success\n${resourceRows([result.resource], scope, options.long === true)}`;
  }
  return output.data === undefined ? "" : `${JSON.stringify(output.data, null, 2)}\n`;
}
