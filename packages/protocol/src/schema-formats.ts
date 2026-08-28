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
