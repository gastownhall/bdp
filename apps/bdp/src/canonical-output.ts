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
  if (long) {
    const detail = Object.fromEntries(
      Object.entries(r).filter(
        ([key]) =>
          !["id", "type", "revision", "source", "target", "properties", "metadata"].includes(key),
      ),
    );
    if (Object.keys(detail).length) lines.push("", "Context:", JSON.stringify(detail, null, 2));
  }
  return `${lines.join("\n")}\n`;
}

/** Finite serialization completes before stdout is touched. JSONL never puts
 * success in the header; a compound mutation remains a single item. */
export function renderCanonicalOutput(
  output: CanonicalOutput,
  options: Readonly<Record<string, unknown>>,
  scope?: string,
): string {
  const format = options.outputFormat ?? "default";
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
      output.result_kind === "resource_collection" && Array.isArray(data.items)
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
      ...(output.result_kind === "resource_collection" && Object.hasOwn(data, "next")
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
  if (output.result_kind === "resource") return document(output.data, scope, options.long === true);
  if (output.result_kind === "resource_collection") {
    const items = record(output.data).items;
    if (!Array.isArray(items)) return "";
    return format === "detail"
      ? items.map((item) => document(item, scope, options.long === true)).join("\n")
      : resourceRows(items, scope, options.long === true);
  }
  if (output.result_kind === "mutation") {
    const data = record(output.data);
    if (data.resource !== undefined)
      return `Success\n${resourceRows([data.resource], scope, options.long === true)}`;
  }
  return output.data === undefined ? "" : `${JSON.stringify(output.data, null, 2)}\n`;
}
