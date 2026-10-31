import { stringifyJsonValue } from "@bdp/protocol";
import type { HttpResponse } from "./index.js";

/** Apply shared HTTP rules only after routing, authorization and result validation.
 * This Read server selects parameter-free application/json on its 200 routes.
 * Its Scope port supplies no representation modification date, so neither date
 * precondition can be evaluated; Resource timestamps are not HTTP validators.
 * RFC 9110 sections 12.5.1, 13.1 and 13.2 govern negotiation and ordering.
 */
export function applyReadHttpSemantics(request: Request, response: HttpResponse): HttpResponse {
  let selected = response;
  const json =
    response.status === 200 && response.headers.get("content-type") === "application/json";
  if (json || response.status === 204) {
    const headers = new Headers(response.headers);
    if (json) {
      const vary = headers.get("vary");
      if (
        vary !== "*" &&
        !vary?.split(",").some((field) => field.trim().toLowerCase() === "accept")
      )
        headers.set("vary", vary ? `${vary}, Accept` : "Accept");
    }
    // The Scope probe is an existing zero-length representation with no media
    // type to negotiate; it still evaluates entity-tag preconditions.
    const status =
      json && !acceptsJson(request.headers.get("accept"))
        ? 406
        : conditionalReadStatus(request.headers, headers.get("etag"));
    if (status !== 200) {
      headers.delete("content-type");
      if (status === 406) headers.delete("etag");
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
    headers.set("content-length", String(Buffer.byteLength(stringifyJsonValue(selected.body))));
    return { status: selected.status, headers };
  }
  return selected;
}

export function conditionalReadStatus(headers: Headers, etag: string | null): 200 | 304 | 412 {
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
  if (value.trim() === "*") return true; // Called only for an existing successful representation.
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

export function acceptsJson(value: string | null): boolean {
  return mediaQuality(value, "application/json") > 0;
}

/** Source-private representation selection; JSON wins ties and missing Accept. */
export function selectChangefeedMedia(value: string | null): "json" | "sse" | undefined {
  const json = mediaQuality(value, "application/json");
  const sse = mediaQuality(value, "text/event-stream");
  return json > 0 && json >= sse ? "json" : sse > 0 ? "sse" : undefined;
}

function mediaQuality(value: string | null, target: string): number {
  if (value === null) return 1;
  const ranges = splitQuoted(value, ",");
  if (ranges === undefined) return 0;
  let specificity = -1;
  let quality = 0;
  for (const range of ranges) {
    const parsed = mediaRange(range, target);
    if (parsed === undefined) continue;
    if (parsed.specificity > specificity) {
      specificity = parsed.specificity;
      quality = parsed.quality;
    } else if (parsed.specificity === specificity) quality = Math.max(quality, parsed.quality);
  }
  return quality;
}

/** Unsupported media parameters cannot match our parameter-free JSON. Malformed
 * ranges are not candidates; no BDP error code is invented for header recovery.
 */
function mediaRange(
  value: string,
  target: string,
): { specificity: number; quality: number } | undefined {
  const parts = splitQuoted(value, ";");
  if (parts === undefined) return undefined;
  const media = parts.shift()?.trim().toLowerCase();
  const specificity =
    media === target ? 2 : media === `${target.split("/")[0]}/*` ? 1 : media === "*/*" ? 0 : -1;
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

export function resourceRevisionEtag(revision: string): string {
  // RFC 9110 entity tags are quoted opaque byte sequences, not HTTP quoted-
  // strings: a quote or control byte cannot be escaped inside the tag. BDP's
  // ordinary ASCII revisions are emitted unchanged as shown in the spec. For
  // revisions outside the entity-tag character profile, use an unambiguous
  // base64url projection whose marker cannot collide with an unchanged tag.
  const bytes = Buffer.from(revision, "utf8");
  const unchanged =
    bytes.length === revision.length &&
    bytes.every((byte) => byte === 0x21 || (byte >= 0x23 && byte <= 0x7e));
  let opaque: string;
  if (unchanged && !revision.startsWith("bdp-b64_") && !revision.startsWith("bdp-u16_")) {
    opaque = revision;
  } else if (isWellFormedUnicode(revision)) {
    opaque = `bdp-b64_${bytes.toString("base64url")}`;
  } else {
    // JavaScript can represent lone UTF-16 surrogates, for which UTF-8's
    // replacement encoding is not injective. Preserve those otherwise-valid
    // JSON strings with a separate code-unit projection.
    const codeUnits = Buffer.allocUnsafe(revision.length * 2);
    for (let index = 0; index < revision.length; index += 1) {
      codeUnits.writeUInt16BE(revision.charCodeAt(index), index * 2);
    }
    opaque = `bdp-u16_${codeUnits.toString("base64url")}`;
  }
  return `"${opaque}"`;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || following < 0xdc00 || following > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}
