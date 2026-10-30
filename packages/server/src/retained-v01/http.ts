/** Explicit private fixture, deliberately incomplete. Never public profile admission. */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  captureNavigation,
  ORDINARY_OPERATIONS,
  prepareCreate,
  prepareUpdate,
  prepareDelete,
  problem,
  RETAINED_MEDIA,
  RetainedRequestError,
  RetainedFixtureGap,
  serialized,
} from "./contract.js";
import { parseEventSelection } from "./events.js";
import { prepareLink } from "./link-contract.js";
import { prepareAlias } from "./alias-contract.js";
import { openPrivateRetainedStore, type PrivateStoreOptions } from "./store.js";

export interface PrivateFixtureOptions extends PrivateStoreOptions {
  readonly credentials: readonly { readonly token: string; readonly principal: string }[];
}
export const PRIVATE_FIXTURE_GAPS = Object.freeze([
  "Reference absolute-URI/local-path overlap awaiting paired-source clarification",
  "general Core reads",
  "complete authorization/disclosure",
  "Event retention administration",
  "expiry/compaction",
  "Types",
  "History",
  "projection",
  "batch",
]);
function one(request: IncomingMessage, name: string): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]?.toLowerCase() === name) values.push(request.rawHeaders[i + 1] ?? "");
  if (values.length > 1) throw new RetainedRequestError("malformed-request", 400);
  return values[0];
}
function accepts(value: string | undefined): boolean {
  if (value === undefined) return true;
  let rank = -1;
  let quality = 0;
  for (const part of value.split(",")) {
    const [media, ...parameters] = part
      .trim()
      .toLowerCase()
      .split(";")
      .map((p) => p.trim());
    const specificity =
      media === RETAINED_MEDIA ? 2 : media === "application/*" ? 1 : media === "*/*" ? 0 : -1;
    if (specificity < 0) continue;
    const weights = parameters.filter((p) => p.startsWith("q="));
    const raw = weights[0]?.slice(2) ?? "1";
    const q =
      weights.length > 1 || !/^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/.test(raw) ? 0 : Number(raw);
    if (specificity > rank) {
      rank = specificity;
      quality = q;
    } else if (specificity === rank) quality = Math.max(quality, q);
  }
  return quality > 0;
}
function empty(response: ServerResponse, status: number, allow?: string): void {
  response.writeHead(status, {
    "content-length": "0",
    "x-bdp-private-fixture": "incomplete",
    ...(allow === undefined ? {} : { allow }),
  });
  response.end();
}
function json(
  response: ServerResponse,
  status: number,
  text: string,
  extra: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": status >= 400 ? "application/problem+json" : RETAINED_MEDIA,
    "cache-control": "private, no-store",
    "content-length": String(Buffer.byteLength(text)),
    "x-bdp-private-fixture": "incomplete",
    ...extra,
  });
  response.end(response.req.method === "HEAD" ? undefined : text);
}
async function receive(request: IncomingMessage): Promise<string> {
  const length = one(request, "content-length");
  if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > 65536))
    throw new RetainedRequestError("request-too-large", 413);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 65536) throw new RetainedRequestError("request-too-large", 413);
    chunks.push(chunk);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new RetainedRequestError("malformed-request", 400);
  }
}
export async function startPrivateRetainedFixture(options: PrivateFixtureOptions) {
  const navigation = captureNavigation(options.navigation);
  const credentials = options.credentials.map((credential) => {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(credential.token) || !credential.principal)
      throw new TypeError("explicit private credential/principal mapping required");
    return Object.freeze({ ...credential });
  });
  if (!credentials.length || new Set(credentials.map((c) => c.token)).size !== credentials.length)
    throw new TypeError("unique private credentials required");
  const store = openPrivateRetainedStore({ ...options, navigation });
  const signature = (url: string) => {
    const target = new URL(url);
    return target.host + target.pathname + target.search;
  };
  const known = new Map([
    [signature(navigation.scope), "scope"],
    [signature(navigation.description), "description"],
    [signature(navigation.operations), "directory"],
    [signature(navigation.events), "events"],
    ...ORDINARY_OPERATIONS.map(
      (operation) => [signature(navigation.targets[operation]), operation] as const,
    ),
  ]);
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const authorization = one(request, "authorization") ?? "";
      const principal = credentials.find((credential) => {
        const expected = Buffer.from(`Bearer ${credential.token}`);
        const supplied = Buffer.from(authorization);
        return expected.length === supplied.length && timingSafeEqual(expected, supplied);
      })?.principal;
      if (principal === undefined) {
        json(response, 401, serialized(problem("unauthenticated", 401, "after-state-change")), {
          "www-authenticate": 'Bearer realm="private-retained-fixture"',
        });
        return;
      }
      const host = one(request, "host");
      const raw = request.url ?? "";
      if (!host || !raw.startsWith("/") || raw.startsWith("//"))
        throw new RetainedRequestError("malformed-request", 400);
      const url = new URL(raw, `http://${host}`);
      if (url.pathname + url.search !== raw || url.hash)
        throw new RetainedRequestError("malformed-request", 400);
      const route = known.get(host + raw);
      const eventBase = new URL(navigation.events);
      const scopeEventQuery = new URL(url);
      let scopeEventRoute = host === eventBase.host && url.pathname === eventBase.pathname;
      for (const [name, value] of eventBase.searchParams) {
        if (url.searchParams.getAll(name).length !== 1 || url.searchParams.get(name) !== value)
          scopeEventRoute = false;
        scopeEventQuery.searchParams.delete(name);
      }
      const method = request.method ?? "GET";
      if (
        route === "createBead" ||
        route === "updateBead" ||
        route === "deleteBead" ||
        route === "createLink" ||
        route === "updateLink" ||
        route === "deleteLink" ||
        route === "putAlias" ||
        route === "deleteAlias"
      ) {
        if (method !== "POST") {
          empty(response, 405, "POST");
          return;
        }
        if (one(request, "content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== RETAINED_MEDIA)
          throw new RetainedRequestError("unsupported-media-type", 415);
        if (!accepts(request.headers.accept)) {
          empty(response, 406);
          return;
        }
        const key = one(request, "idempotency-key");
        if (key === undefined) throw new RetainedRequestError("malformed-request", 400);
        const text = await receive(request);
        const result =
          route === "createBead"
            ? store.create(principal, prepareCreate(navigation.scope, text, key))
            : route === "updateBead"
              ? store.update(principal, prepareUpdate(navigation.scope, text, key))
              : route === "deleteBead"
                ? store.deleteBead(principal, prepareDelete(navigation.scope, text, key))
                : route === "putAlias" || route === "deleteAlias"
                  ? store[route](principal, prepareAlias(navigation.scope, route, text, key))
                  : store[route](principal, prepareLink(navigation.scope, route, text, key));
        if (!response.destroyed) json(response, result.status, result.text);
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        empty(response, 405, "GET, HEAD");
        return;
      }
      if (route === "scope") {
        response.writeHead(204, {
          link: `<${navigation.description}>; rel="service-desc"; type="${RETAINED_MEDIA}"`,
          "x-bdp-private-fixture": "incomplete",
        });
        response.end();
        return;
      }
      const scope = new URL(navigation.scope);
      const subjectUrl = new URL(url.pathname, scope.origin);
      const resource =
        host === scope.host && subjectUrl.href.startsWith(navigation.scope)
          ? subjectUrl.href
          : undefined;
      if (resource !== undefined && route === undefined && !scopeEventRoute) {
        const target = store.resolveAlias(resource);
        if (target === null || (target !== undefined && url.search))
          throw new RetainedRequestError("resource-not-found", 404, "after-state-change");
        if (target !== undefined) {
          response.writeHead(307, {
            location: target,
            "content-length": "0",
            "cache-control": "private, no-store",
            "x-bdp-private-fixture": "incomplete",
          });
          response.end();
          return;
        }
      }
      if (!accepts(request.headers.accept)) {
        empty(response, 406);
        return;
      }
      if (route === "description") {
        json(
          response,
          200,
          serialized({
            bdpVersion: "0.1",
            profile: "write",
            scope: navigation.scope,
            beads: navigation.beads,
            links: navigation.links,
            aliases: navigation.aliases,
            events: navigation.events,
            operations: navigation.operations,
          }),
        );
        return;
      }
      if (route === "directory") {
        json(response, 200, serialized(navigation.targets));
        return;
      }
      const isSubjectEvents = resource !== undefined && url.searchParams.get("view") === "events";
      if (scopeEventRoute || isSubjectEvents) {
        const source = scopeEventRoute ? navigation.events : `${resource}?view=events`;
        json(
          response,
          200,
          serialized(
            store.events(
              principal,
              source,
              isSubjectEvents ? (resource as string) : "",
              parseEventSelection(scopeEventRoute ? scopeEventQuery : url, isSubjectEvents),
            ),
          ),
        );
        return;
      }
      if (resource === undefined)
        throw new RetainedRequestError("resource-not-found", 404, "after-state-change");
      // This bounded source increment implements current full/properties reads.
      // History/aggregate selection remains an explicit private fixture gap.
      if (url.searchParams.has("revision") || url.searchParams.has("include"))
        throw new RetainedFixtureGap("History and aggregate reads remain unimplemented");
      const propertiesView = url.searchParams.get("view") === "properties";
      if (
        url.search &&
        (!propertiesView ||
          url.searchParams.getAll("view").length !== 1 ||
          [...url.searchParams.keys()].some((name) => name !== "view"))
      )
        throw new RetainedRequestError("invalid-parameter", 400);
      const record = store.readRecord(resource);
      if (record === undefined)
        throw new RetainedRequestError("resource-not-found", 404, "after-state-change");
      const current = JSON.parse(record.body);
      const body = propertiesView ? serialized(current.properties) : record.body;
      const etag = `"${current.revision}"`;
      const headers = {
        etag,
        "bdp-resource-kind": record.kind,
        link: `<${navigation.description}>; rel="service-desc"; type="${RETAINED_MEDIA}"`,
      };
      const ifMatch = request.headers["if-match"];
      if (
        typeof ifMatch === "string" &&
        ifMatch !== "*" &&
        !ifMatch
          .split(",")
          .map((v) => v.trim())
          .includes(etag)
      ) {
        empty(response, 412);
        return;
      }
      const ifNone = request.headers["if-none-match"];
      if (
        typeof ifNone === "string" &&
        (ifNone === "*" ||
          ifNone
            .split(",")
            .map((v) => v.trim().replace(/^W\//, ""))
            .includes(etag))
      ) {
        response.writeHead(304, {
          ...headers,
          "cache-control": "private, no-store",
          "content-type": RETAINED_MEDIA,
        });
        response.end();
        return;
      }
      json(response, 200, body, headers);
    } catch (error) {
      if (response.destroyed) return;
      if (error instanceof RetainedFixtureGap) empty(response, 501);
      else if (error instanceof RetainedRequestError)
        json(response, error.status, serialized(problem(error.code, error.status, error.retry)));
      else {
        for (const name of response.getHeaderNames()) response.removeHeader(name);
        empty(response, 500);
      }
    }
  }
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch (error) {
    store.close();
    throw error;
  }
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    store.close();
    throw new Error("private listener unavailable");
  }
  let closing: Promise<void> | undefined;
  return {
    claimEligible: false as const,
    missing: PRIVATE_FIXTURE_GAPS,
    navigation,
    listenUrl: `http://127.0.0.1:${address.port}`,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => {
          try {
            store.close();
          } catch (failure) {
            reject(failure);
            return;
          }
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
