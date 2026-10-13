/** Real HTTP only. The shared runner owns all result and afterstate assertions. */
import {
  createRawHttpExchangeExecutor,
  snapshotExactHttpMode,
  type ExactHttpModeOptions,
  type RawHttpDialRoute,
  type ScenarioActionExecutor,
} from "@bdp/conformance";

import {
  parseCanonicalHttpUrl,
  parseCanonicalScope,
  resolveCanonicalLocalResourceId,
} from "@bdp/protocol";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("record required");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw Error("observed string required");
  return value;
}

export function createInstalledExactClient(
  inputMode: ExactHttpModeOptions,
  inputDialRoute: RawHttpDialRoute,
  observe: (value: unknown) => void,
): ScenarioActionExecutor {
  const mode = snapshotExactHttpMode(inputMode);
  const dialRoute = Object.freeze({ ...inputDialRoute });
  return async (execution) => {
    if (
      execution.family !== "client" ||
      execution.operation !== "installed.exact-request" ||
      execution.scope !== mode.scope
    )
      throw Error("unsupported installed client operation");
    const input = record(execution.input);
    const allowed = new Set([
      "targetBinding",
      "targetBaseBinding",
      "method",
      "body",
      "bodyBindings",
      "idempotencyKey",
      "credentialRef",
      "query",
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key))) throw Error("unknown client input");
    const targetBinding = string(input.targetBinding);
    const target = string(execution.bindings[targetBinding]);
    const base =
      input.targetBaseBinding === undefined
        ? mode.scope
        : string(execution.bindings[string(input.targetBaseBinding)]);
    const url = new URL(target, base);
    const root = new URL(mode.scope);
    if (
      url.origin !== root.origin ||
      !url.pathname.startsWith(root.pathname) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      parseCanonicalHttpUrl(url.href) !== url.href
    )
      throw Error("observed target escaped canonical Scope");
    const method = input.method;
    if (method !== "GET" && method !== "POST") throw Error("unsupported client method");
    if (
      method === "GET" &&
      !mode.routes.some((route) => route.method === method && route.url === url.href) &&
      (target !== url.href || !/^beads\/[^/]+$/.test(url.pathname.slice(root.pathname.length)))
    )
      throw Error("captured read target must be a Bead identity");
    if (
      method === "POST" &&
      !mode.routes.some((route) => route.method === method && route.url === url.href)
    )
      throw Error("mutation route was not installed");
    if (
      method === "GET" &&
      !mode.routes.some((route) => route.method === method && route.url === url.href)
    ) {
      if (
        resolveCanonicalLocalResourceId(
          parseCanonicalScope(mode.scope),
          "bead",
          url.pathname.slice(root.pathname.length),
        ) !== url.href
      )
        throw Error("captured identity is not canonical");
    }
    if (input.query !== undefined) {
      const query = record(input.query);
      if (
        method !== "GET" ||
        Object.keys(query).length !== 1 ||
        !["properties", "links"].includes(string(query.view))
      )
        throw Error("unsupported observation view");
      url.searchParams.set("view", string(query.view));
    }
    const body = input.body === undefined ? undefined : structuredClone(record(input.body));
    const bindingSources = input.bodyBindings === undefined ? {} : record(input.bodyBindings);
    for (const [field, binding] of Object.entries(bindingSources)) {
      if (
        !body ||
        !["type", "bead", "link", "source", "target", "expectedRevision"].includes(field) ||
        Object.hasOwn(body, field)
      )
        throw Error("invalid or shadowed body binding");
      body[field] = string(execution.bindings[string(binding)]);
    }
    if ((method === "POST") !== (body !== undefined)) throw Error("request body/method mismatch");
    const credentialRef = string(input.credentialRef);
    const route = Object.freeze({ method, url: url.href });
    // A captured allocated Bead URL gets one exact route, never a wildcard.
    const execute = createRawHttpExchangeExecutor(dialRoute, {
      exactMode: { ...mode, routes: [route] },
      requestTimeoutMs: 5000,
    });
    const response = await execute({
      method,
      url: url.href,
      signal: execution.signal,
      credentialRef,
      raw: {
        headerLines:
          body === undefined
            ? []
            : [
                { name: "content-type", value: "application/json" },
                ...(input.idempotencyKey === undefined
                  ? []
                  : [{ name: "idempotency-key", value: string(input.idempotencyKey) }]),
              ],
        ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
      },
    });
    const actual = response.exactRequest;
    if (!actual) throw Error("exact serializer observation missing");
    const observation = {
      source: actual.source,
      writeState: actual.writeState,
      bodyPresent: actual.bodyPresent,
      bodyOctets: actual.bodyOctets,
      ...(actual.bodyDigest === undefined ? {} : { bodyDigest: actual.bodyDigest }),
    };
    const output = {
      request: {
        method,
        url: url.href,
        targetBinding,
        bodyBindings: bindingSources,
        credentialRef,
        ...(body === undefined ? {} : { body }),
      },
      route,
      observation,
      status: response.status,
      headers: Object.fromEntries(
        Object.entries(response.headers).filter(([key]) =>
          ["content-type", "etag", "location"].includes(key),
        ),
      ),
      ...(response.bodyText === "" ? {} : { body: JSON.parse(response.bodyText) }),
    };
    // Synthetic fixture data only; never copy secret-bearing exact header lines.
    observe(structuredClone(output));
    return output;
  };
}
