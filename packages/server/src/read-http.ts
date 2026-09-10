import type { HttpResponse } from "./index.js";

/** Apply shared HTTP rules only after routing, authorization and result validation.
 * This Read server selects parameter-free application/json on its 200 routes.
 * Its Scope port supplies no representation modification date, so neither date
 * precondition can be evaluated; Resource timestamps are not HTTP validators.
 * RFC 9110 sections 12.5.1, 13.1 and 13.2 govern negotiation and ordering.
 */
export function applyReadHttpSemantics(request: Request, response: HttpResponse): HttpResponse {
  let selected = response;
  if (response.status === 200 && response.headers.get("content-type") === "application/json") {
    const headers = new Headers(response.headers);
    const vary = headers.get("vary");
    if (vary !== "*" && !vary?.split(",").some((field) => field.trim().toLowerCase() === "accept"))
      headers.set("vary", vary ? `${vary}, Accept` : "Accept");
    const status = acceptsJson(request.headers.get("accept"))
      ? conditionalReadStatus(request.headers, headers.get("etag"))
      : 406;
    if (status !== 200) {
      headers.delete("content-type");
      // A 304 Content-Length may describe only the corresponding 200 body,
      // never an invented zero-length representation (RFC 9110 section 8.6).
      headers.delete("content-length");
      if (status !== 304) headers.set("content-length", "0");
      selected = { status, headers };
    } else selected = { ...response, headers };
  }
  // Keep the Fetch-level contract honest as well as the Node transport's final
  // defensive strip. HEAD has GET metadata, including the serialized length.
  if (request.method === "HEAD" && selected.body !== undefined) {
    const headers = new Headers(selected.headers);
    headers.set("content-length", String(Buffer.byteLength(JSON.stringify(selected.body))));
    return { status: selected.status, headers };
  }
  return selected;
}

function conditionalReadStatus(headers: Headers, etag: string | null): 200 | 304 | 412 {
  const match = headers.get("if-match");
  if (match !== null && !tagListMatches(match, etag, true)) return 412;
  const noneMatch = headers.get("if-none-match");
  if (noneMatch !== null && tagListMatches(noneMatch, etag, false)) return 304;
  return 200;
}

/** A tag's backslash is an opaque byte, not a quoted-string escape. Empty list
 * elements are ignored under RFC 9110 section 5.6.1; mixed '*' lists are invalid.
 * Invalid fields cannot produce a match (13.1.1/13.1.2's 'otherwise' branches).
 */
function tagListMatches(value: string, current: string | null, strong: boolean): boolean {
  if (value.trim() === "*") return true; // Called only for an existing 200 representation.
  const tag = /(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"/y;
  let offset = 0;
  let matched = false;
  while (offset < value.length) {
    while (/[\t ,]/.test(value[offset] ?? "") && offset < value.length) offset += 1;
    if (offset === value.length) break;
    tag.lastIndex = offset;
    const parsed = tag.exec(value);
    if (parsed === null) return false;
    const candidate = parsed[0];
    if (current !== null) {
      matched ||= strong
        ? !candidate.startsWith("W/") && !current.startsWith("W/") && candidate === current
        : candidate.replace(/^W\//, "") === current.replace(/^W\//, "");
    }
    offset = tag.lastIndex;
    while (value[offset] === " " || value[offset] === "\t") offset += 1;
    if (offset < value.length && value[offset] !== ",") return false;
  }
  return matched;
}

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const QUOTED = /^"(?:[\t\x20\x21\x23-\x5b\x5d-\x7e\x80-\xff]|\\[\t\x20-\x7e\x80-\xff])*"$/;
const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

function acceptsJson(value: string | null): boolean {
  if (value === null) return true;
  const ranges = splitQuoted(value, ",");
  if (ranges === undefined) return false;
  let specificity = -1;
  let quality = 0;
  for (const range of ranges) {
    const parsed = jsonRange(range);
    if (parsed === undefined) continue;
    if (parsed.specificity > specificity) {
      specificity = parsed.specificity;
      quality = parsed.quality;
    } else if (parsed.specificity === specificity) quality = Math.max(quality, parsed.quality);
  }
  return quality > 0;
}

/** Unsupported media parameters cannot match our parameter-free JSON. Malformed
 * ranges are not candidates; no BDP error code is invented for header recovery.
 */
function jsonRange(value: string): { specificity: number; quality: number } | undefined {
  const parts = splitQuoted(value, ";");
  if (parts === undefined) return undefined;
  const media = parts.shift()?.trim().toLowerCase();
  const specificity =
    media === "application/json" ? 2 : media === "application/*" ? 1 : media === "*/*" ? 0 : -1;
  if (specificity < 0) return undefined;
  let quality = 1;
  let hasWeight = false;
  let hasMediaParameters = false;
  for (const part of parts) {
    const parameter = part.trim();
    if (parameter === "") continue;
    const equal = parameter.indexOf("=");
    if (equal < 0) return undefined;
    const name = parameter.slice(0, equal);
    const raw = parameter.slice(equal + 1);
    if (!TOKEN.test(name) || (!TOKEN.test(raw) && !QUOTED.test(raw))) return undefined;
    if (name.toLowerCase() === "q") {
      if (hasWeight || !QUALITY.test(raw)) return undefined;
      quality = Number(raw);
      hasWeight = true;
    } else hasMediaParameters = true;
  }
  return hasMediaParameters ? undefined : { specificity, quality };
}

/** Split HTTP media syntax without mistaking quoted commas/semicolons for
 * separators. Quoted-pairs apply here, unlike the entity-tag grammar above.
 */
function splitQuoted(value: string, delimiter: string): string[] | undefined {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted && character === "\\") index += 1;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === delimiter) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted) return undefined;
  parts.push(value.slice(start));
  return parts;
}
