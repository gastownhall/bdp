import { createRequire } from "node:module";
import { isProxy } from "node:util/types";
import uri from "fast-uri";
import { type GraphBudget, SchemaGraphError, refuseGraph } from "./installed-schema-shape.js";

// The pinned dependency closes over this registry in lib/schemes.js. Its public
// SCHEMES export can be replaced independently, so inspect the original module's
// data property and retain that reference. Never freeze or modify shared state.
const schemeModule: unknown = createRequire(import.meta.url)("fast-uri/lib/schemes.js");
const registry: unknown =
  schemeModule !== null && typeof schemeModule === "object" && !isProxy(schemeModule)
    ? Object.getOwnPropertyDescriptor(schemeModule, "SCHEMES")?.value
    : undefined;
const generic = Object.freeze({ resolve: uri.resolve, parse: uri.parse, serialize: uri.serialize });
function checkRegistry(): void {
  if (
    registry === null ||
    typeof registry !== "object" ||
    isProxy(registry) ||
    Object.getPrototypeOf(registry) !== null ||
    Object.getOwnPropertyDescriptor(registry, "null") !== undefined
  )
    refuseGraph("uri-handler-registry");
}

const allowed = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&'()*+,;=%",
);
const hex = (c: string | undefined): boolean =>
  c !== undefined && ((c >= "0" && c <= "9") || (c >= "A" && c <= "F") || (c >= "a" && c <= "f"));
function check(text: string, budget: GraphBudget): void {
  budget.bound("uriBytes", text.length);
  budget.charge("scanWork", text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (!allowed.has(c)) refuseGraph("uri");
    if (c === "%") {
      if (!hex(text[i + 1]) || !hex(text[i + 2])) refuseGraph("uri");
      i += 2;
    }
  }
  // Validate authority before dependency normalization can repair malformed IPs.
  const authority = text.match(/^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/([^/?#]*)/);
  if (authority) {
    const parts = (authority[1] as string).split("@");
    if (parts.length > 2) refuseGraph("uri");
    const hostPort = parts[parts.length - 1] as string;
    if (hostPort.includes("%")) {
      // The dependency decodes hosts repeatedly. Only unreserved ASCII escapes
      // can safely pass that path; other host escapes are explicitly unsupported.
      for (let i = 0; i < hostPort.length; i++)
        if (hostPort[i] === "%") {
          const c = String.fromCharCode(Number.parseInt(hostPort.slice(i + 1, i + 3), 16));
          if (!/^[A-Za-z0-9._~-]$/.test(c)) refuseGraph("unsupported-uri-host-escape");
          i += 2;
        }
    }
    if (/^\[v[0-9a-f]+\.[A-Za-z0-9._~!$&'()*+,;=:-]+\](?::[0-9]*)?$/i.test(hostPort))
      refuseGraph("unsupported-uri-ip-literal");
    if (hostPort.startsWith("[")) {
      if (!/^\[[0-9A-Fa-f:.]+\](?::[0-9]*)?$/.test(hostPort)) refuseGraph("uri");
      try {
        new URL(`http://${hostPort}/`);
      } catch {
        refuseGraph("uri");
      }
    } else if (!/^[A-Za-z0-9._~!$&'()*+,;=%-]*(?::[0-9]*)?$/.test(hostPort)) refuseGraph("uri");
    if (parts.length === 2 && !/^[A-Za-z0-9._~!$&'()*+,;=:%-]*$/.test(parts[0] as string))
      refuseGraph("uri");
  }
  // Brackets are delimiters only inside an authority; they are not path/query
  // characters under RFC 3986 and must never be silently escaped by fast-uri.
  const rest = authority ? text.slice((authority[0] as string).length) : text;
  if (rest.includes("[") || rest.includes("]")) refuseGraph("uri");
  const hash = text.indexOf("#");
  if (hash !== -1 && text.indexOf("#", hash + 1) !== -1) refuseGraph("uri");
  const scheme = text.indexOf(":");
  const first = text.search(/[/?#]/);
  if (scheme >= 0 && (first === -1 || scheme < first)) {
    const s = text.slice(0, scheme);
    if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(s)) refuseGraph("uri");
  }
}
export interface ResolvedSchemaUri {
  readonly uri: string;
  readonly resource: string;
  readonly fragment: string;
  readonly fragmentKind: "empty" | "pointer" | "plain-name";
}
/** Generic resolution with fragments kept outside fast-uri's decode/re-encode path. */
export function resolveSchemaUri(
  base: string,
  reference: string,
  budget: GraphBudget,
): ResolvedSchemaUri {
  check(base, budget);
  check(reference, budget);
  budget.charge("uriCalls");
  budget.charge("uriWork", (base.length + reference.length + 1) ** 2);
  const hash = reference.indexOf("#");
  const rawFragment = hash < 0 ? "" : reference.slice(hash + 1);
  const ref = hash < 0 ? reference : reference.slice(0, hash);
  const baseResource = base.split("#", 1)[0] as string;
  let resource: string;
  try {
    checkRegistry();
    resource = generic.resolve(baseResource, ref, { scheme: "null" });
    checkRegistry();
    const parsed = generic.parse(resource, { scheme: "null" });
    if (parsed.error || !parsed.scheme) refuseGraph("uri");
    parsed.scheme = parsed.scheme.toLowerCase();
    if (parsed.scheme === "http" || parsed.scheme === "https") {
      if (!parsed.host) refuseGraph("uri");
      if (parsed.port === (parsed.scheme === "https" ? 443 : 80) || parsed.port === "")
        delete parsed.port;
      if (!parsed.path) parsed.path = "/";
    }
    // Strict authority validation: no repaired bracket syntax or user-info ambiguity.
    const authority = resource.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/);
    if (authority) {
      const hostPort = (authority[1] as string).split("@");
      if (hostPort.length > 2) refuseGraph("uri");
      const host = hostPort[hostPort.length - 1] as string;
      if (host.includes("%")) refuseGraph("unsupported-uri-host-escape");
      if (host.includes("[") || host.includes("]")) {
        // WHATWG is used only as an IP-literal syntax check, never for resolution.
        if (!/^\[[0-9A-Fa-f:.]+\](?::[0-9]*)?$/.test(host)) refuseGraph("uri");
        new URL(`http://${host}/`);
      }
    }
    checkRegistry();
    resource = generic.serialize(parsed, { scheme: "null", skipEscape: true });
  } catch (error) {
    if (error instanceof SchemaGraphError) throw error;
    refuseGraph("uri");
  }
  check(resource, budget);
  let fragment: string;
  try {
    fragment = decodeURIComponent(rawFragment);
  } catch {
    refuseGraph("uri-fragment");
  }
  budget.charge("scanWork", fragment.length);
  const encoded = encodeURIComponent(fragment).replace(/%2F/g, "/");
  const resolved = resource + (fragment === "" ? "" : `#${encoded}`);
  budget.bound("uriBytes", resolved.length);
  return Object.freeze({
    uri: resolved,
    resource,
    fragment,
    fragmentKind: fragment === "" ? "empty" : fragment.startsWith("/") ? "pointer" : "plain-name",
  });
}
export function checkAnchor(name: string, budget: GraphBudget): void {
  budget.charge("scanWork", name.length);
  for (let i = 0; i < name.length; i++) {
    const c = name[i] as string;
    if (
      !(
        (c >= "A" && c <= "Z") ||
        (c >= "a" && c <= "z") ||
        c === "_" ||
        (i > 0 && ((c >= "0" && c <= "9") || c === "." || c === "-"))
      )
    )
      refuseGraph("anchor");
  }
  if (!name.length) refuseGraph("anchor");
}
