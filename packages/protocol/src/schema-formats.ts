// The full RFC 3986 table is a pinned deep entry guarded by installed-package smoke tests.
import { fullFormats } from "ajv-formats/dist/formats.js";

const validateUri = fullFormats.uri;
if (typeof validateUri !== "function")
  throw new Error("ajv-formats full URI validator is not callable");
const callUriValidator = validateUri as (value: string) => boolean;

/** RFC 3986 URI assertion shared by every validator compiled from the BDP schema bundle. */
export function isJsonSchemaUri(value: string): boolean {
  return callUriValidator(value);
}

const dateTimeFormat: unknown = fullFormats["date-time"];
const validateDateTime =
  typeof dateTimeFormat === "object" && dateTimeFormat !== null
    ? (dateTimeFormat as { validate?: unknown }).validate
    : dateTimeFormat;
if (typeof validateDateTime !== "function")
  throw new Error("ajv-formats full date-time validator is not callable");
const callDateTimeValidator = validateDateTime as (value: string) => boolean;

/**
 * RFC 3339 `date-time` assertion from ajv-formats' full mode — the calendar
 * and the clock are validated, and the lowercase `t` and `z` RFC 3339 permits
 * are accepted — registered beside `uri` in every validator compiled from the
 * BDP schema bundle (Transactional apply, T45).
 */
export function isJsonSchemaDateTime(value: string): boolean {
  return callDateTimeValidator(value);
}
