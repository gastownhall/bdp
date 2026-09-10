import type { ValidationDiagnostic } from "./read-update-problems.js";

/** Lossless JSON syntax, separate from per-operation BDP numeric admission.
 * The caller bounds transport bytes. This iterative parser imposes no hidden
 * nesting/wire limit and never constructs a rounded executable number.
 */
export class JsonSyntaxError extends SyntaxError {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} at JSON offset ${offset}`);
    this.name = "JsonSyntaxError";
  }
}

export class JsonNumberLiteral {
  constructor(readonly literal: string) {
    if (!JSON_NUMBER.test(literal)) throw new TypeError("invalid JSON number literal");
    Object.freeze(this);
  }
}
export type LosslessJsonValue =
  | null
  | boolean
  | string
  | JsonNumberLiteral
  | readonly LosslessJsonValue[]
  | { readonly [key: string]: LosslessJsonValue };
export type AdmittedJsonValue =
  | null
  | boolean
  | string
  | number
  | readonly AdmittedJsonValue[]
  | { readonly [key: string]: AdmittedJsonValue };
export interface JsonNumberOccurrence {
  readonly pointer: string;
  readonly literal: string;
}
/** The caller supplies the actual wire entry, including its property-relative
 * location. Bounds count entries and UTF-8 bytes of the serialized list, not
 * internal occurrences. Omitting both bounds explicitly requests the full list.
 */
export interface JsonNumberDiagnosticBudget {
  readonly diagnostics?: number;
  readonly diagnosticBytes?: number;
  readonly diagnostic: (occurrence: JsonNumberOccurrence) => ValidationDiagnostic;
}
/** A local caller/configuration failure, never a BDP wire error code. The caller
 * must configure a feasible advertised budget for every permitted request;
 * transport integration must not expose this as an unhandled input exception.
 */
export class JsonDiagnosticBudgetError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "JsonDiagnosticBudgetError";
  }
}
export type JsonNumericAdmission =
  | { readonly ok: true; readonly value: AdmittedJsonValue }
  | {
      readonly ok: false;
      readonly offending: readonly JsonNumberOccurrence[];
      readonly diagnostics: readonly ValidationDiagnostic[];
      readonly diagnosticsTruncated: boolean;
    };
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const NUMBER_PREFIX = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/** RFC7493/I-JSON forbids lone UTF-16 surrogates, including decoded keys. */
export function isUnicodeScalarString(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

type MutableContainer = LosslessJsonValue[] | Record<string, LosslessJsonValue>;
interface Frame {
  readonly value: MutableContainer;
  readonly object: boolean;
  state: "first" | "next" | "after";
  readonly keys: Set<string>;
}

/** Decode syntax before duplicate names or decimal precision can be lost.
 * Numbers remain explicit literal nodes, including overflow/underflow literals.
 */
export function decodeJsonDocument(text: string): LosslessJsonValue {
  if (typeof text !== "string") throw new TypeError("JSON input must be text");
  let at = 0;
  const frames: Frame[] = [];
  const whitespace = (): void => {
    while (at < text.length && /[\x20\t\r\n]/.test(text[at] ?? "")) at++;
  };
  const fail = (message: string): never => {
    throw new JsonSyntaxError(message, at);
  };
  const string = (): string => {
    const start = at++;
    let escaped = false;
    while (at < text.length) {
      const char = text[at++];
      if (char === '"' && !escaped) {
        let value: string;
        try {
          value = JSON.parse(text.slice(start, at)) as string;
        } catch {
          return fail("invalid JSON string");
        }
        if (!isUnicodeScalarString(value)) fail("unpaired surrogate");
        return value;
      }
      if (char === "\\" && !escaped) escaped = true;
      else escaped = false;
    }
    return fail("unterminated JSON string");
  };
  const value = (): LosslessJsonValue => {
    whitespace();
    const char = text[at];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      at++;
      const object = char === "{";
      const result: MutableContainer = object
        ? (Object.create(null) as Record<string, LosslessJsonValue>)
        : [];
      frames.push({ value: result, object, state: "first", keys: new Set() });
      return result;
    }
    for (const [token, literal] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(token, at)) {
        at += token.length;
        return literal;
      }
    }
    NUMBER_PREFIX.lastIndex = at;
    const matched = NUMBER_PREFIX.exec(text);
    if (matched) {
      at = NUMBER_PREFIX.lastIndex;
      return new JsonNumberLiteral(matched[0]);
    }
    return fail("expected JSON value");
  };
  const root = value();
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (!frame) throw new Error("missing JSON frame");
    whitespace();
    const close = frame.object ? "}" : "]";
    if (text[at] === close && frame.state !== "next") {
      at++;
      Object.freeze(frame.value);
      frames.pop();
      continue;
    }
    if (frame.state === "after") {
      if (text[at++] !== ",") fail("expected comma or closing delimiter");
      frame.state = "next";
      continue;
    }
    let key: string | undefined;
    if (frame.object) {
      if (text[at] !== '"') fail("expected object member name");
      key = string();
      if (frame.keys.has(key)) fail("duplicate decoded object member name");
      frame.keys.add(key);
      whitespace();
      if (text[at++] !== ":") fail("expected colon");
    }
    frame.state = "after";
    const child = value();
    if (Array.isArray(frame.value)) frame.value.push(child);
    else if (key !== undefined) frame.value[key] = child;
  }
  whitespace();
  if (at !== text.length) fail("trailing JSON input");
  return root;
}

/** The exact side uses coefficient strings, never an expanded power of ten.
 * An exponent outside safe integer range cannot cancel a JS string's bounded
 * coefficient length into the finite binary64 range. Zero is handled first.
 */
function exactDecimal(literal: string): string | undefined {
  const negative = literal.startsWith("-");
  const [mantissa = "", exponentText = "0"] = (negative ? literal.slice(1) : literal).split(/[eE]/);
  const [integer = "", fraction = ""] = mantissa.split(".");
  const significant = `${integer}${fraction}`.replace(/^0+/, "");
  if (significant === "") return "0";
  const trailing = /0*$/.exec(significant)?.[0].length ?? 0;
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) return undefined;
  return `${negative ? "-" : ""}${significant.slice(0, significant.length - trailing)}e${exponent - fraction.length + trailing}`;
}

/** BDP Revisions: exact decimal == shortest binary64 serialization's decimal. */
export function isAdmissibleJsonNumber(literal: string): boolean {
  if (!JSON_NUMBER.test(literal)) throw new TypeError("invalid JSON number literal");
  const nearest = Number(literal);
  if (!Number.isFinite(nearest)) return false;
  const exact = exactDecimal(literal);
  return exact !== undefined && exact === exactDecimal(JSON.stringify(nearest));
}

interface Path {
  readonly parent: Path | undefined;
  readonly key: string;
}
function pointer(path: Path | undefined): string {
  const parts: string[] = [];
  for (let p = path; p; p = p.parent) parts.push(p.key.replace(/~/g, "~0").replace(/\//g, "~1"));
  return parts.length ? `/${parts.reverse().join("/")}` : "";
}

/** Iterative transformation also avoids recursive snapshot/freeze overflow. */
export function mapLosslessJson(
  root: LosslessJsonValue,
  number: (value: JsonNumberLiteral, pointer: () => string) => number,
): AdmittedJsonValue {
  type Box = { value?: AdmittedJsonValue };
  const box: Box = {};
  const tasks: Array<
    | { value: LosslessJsonValue; path: Path | undefined; put: (value: AdmittedJsonValue) => void }
    | { freeze: object }
  > = [
    {
      value: root,
      path: undefined,
      put: (value) => {
        box.value = value;
      },
    },
  ];
  while (tasks.length) {
    const task = tasks.pop();
    if (!task) break;
    if ("freeze" in task) {
      Object.freeze(task.freeze);
      continue;
    }
    const { value, path, put } = task;
    if (value instanceof JsonNumberLiteral) {
      put(number(value, () => pointer(path)));
      continue;
    }
    if (value === null || typeof value !== "object") {
      put(value);
      continue;
    }
    const target: AdmittedJsonValue[] | Record<string, AdmittedJsonValue> = Array.isArray(value)
      ? []
      : (Object.create(null) as Record<string, AdmittedJsonValue>);
    put(target);
    tasks.push({ freeze: target });
    const entries = Object.entries(value);
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (!entry) continue;
      const [key, child] = entry;
      tasks.push({
        value: child,
        path: { parent: path, key },
        put: (item) => {
          Object.defineProperty(target, key, {
            value: item,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        },
      });
    }
  }
  if (box.value === undefined) throw new TypeError("invalid lossless JSON value");
  return box.value;
}

/** Per-operation check, never a carrier syntax error. No rounded value escapes
 * on refusal. Pointers are relative to the provided document/operation root.
 */
export function admitJsonNumbers(
  root: LosslessJsonValue,
  budget: JsonNumberDiagnosticBudget,
): JsonNumericAdmission {
  // A formatter may close over and mutate its caller-owned policy. Select the
  // entire policy once, before validation or any callback, without freezing it.
  const {
    diagnostics: countLimit,
    diagnosticBytes: byteLimit,
    diagnostic: formatDiagnostic,
  } = budget;
  for (const limit of [countLimit, byteLimit])
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
      throw new JsonDiagnosticBudgetError("diagnostic bounds must be positive safe integers");
  const offending: JsonNumberOccurrence[] = [];
  const diagnostics: ValidationDiagnostic[] = [];
  let bytes = 2; // The serialized list's opening and closing brackets.
  let truncated = false;
  const stop = Symbol("diagnostic budget exhausted");
  const refusal = (): JsonNumericAdmission =>
    Object.freeze({
      ok: false,
      offending: Object.freeze(offending),
      diagnostics: Object.freeze(diagnostics),
      diagnosticsTruncated: truncated,
    });
  try {
    const value = mapLosslessJson(root, (number, path) => {
      if (!isAdmissibleJsonNumber(number.literal)) {
        // Only a further refusal proves that entries were omitted. Do not
        // materialize its pointer when the entry count is already exhausted.
        if (countLimit !== undefined && diagnostics.length >= countLimit) {
          truncated = true;
          throw stop;
        }
        const occurrence = Object.freeze({ pointer: path(), literal: number.literal });
        // Copy the closed fields so later caller mutation cannot change the
        // measured entry, and no arbitrary extension/toJSON influences bytes.
        const formatted = formatDiagnostic(occurrence);
        const diagnostic: ValidationDiagnostic = Object.freeze({
          ...(formatted.type !== undefined ? { type: formatted.type } : {}),
          ...(formatted.schemaLocation !== undefined
            ? { schemaLocation: formatted.schemaLocation }
            : {}),
          ...(formatted.instanceLocation !== undefined
            ? { instanceLocation: formatted.instanceLocation }
            : {}),
          message: formatted.message,
        });
        const nextBytes =
          bytes +
          (diagnostics.length ? 1 : 0) +
          new TextEncoder().encode(JSON.stringify(diagnostic)).byteLength;
        if (byteLimit !== undefined && nextBytes > byteLimit) {
          if (diagnostics.length === 0)
            throw new JsonDiagnosticBudgetError(
              "diagnostic byte bound cannot retain the first entry",
            );
          truncated = true;
          throw stop;
        }
        bytes = nextBytes;
        offending.push(occurrence);
        diagnostics.push(diagnostic);
      }
      const nearest = Number(number.literal);
      return nearest === 0 ? 0 : nearest;
    });
    return offending.length ? refusal() : Object.freeze({ ok: true, value });
  } catch (error) {
    if (error !== stop) throw error;
    // The partially built value is discarded; no rounded executable tree or
    // omitted occurrence leaks out, and no tail traversal is needed.
    return refusal();
  }
}
