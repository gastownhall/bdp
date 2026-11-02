/** Explicit private fixture, deliberately incomplete. Never public profile admission. */
import { createHash, timingSafeEqual } from "node:crypto";
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
import { createRetainedCollections, inventoryRoute, REFERENCE_READ_LIMITS } from "./collections.js";
import { parseEventSelection } from "./events.js";
import { prepareLink } from "./link-contract.js";
import { prepareAlias } from "./alias-contract.js";
import { openPrivateRetainedStore, type PrivateStoreOptions } from "./store.js";

export interface PrivateFixtureOptions extends PrivateStoreOptions {
  readonly credentials: readonly { readonly token: string; readonly principal: string }[];
}
export const PRIVATE_FIXTURE_GAPS = Object.freeze([
  "complete authorization/disclosure",
  "Event retention administration",
  "expiry/compaction",
  "Types",
  "History",
  "projection",
  "batch",
]);
const referenceResponses = new WeakSet<ServerResponse>();
function fixtureHeaders(response: ServerResponse): Record<string, string> {
  return referenceResponses.has(response) ? {} : { "x-bdp-private-fixture": "incomplete" };
}
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
    ...fixtureHeaders(response),
    ...(allow === undefined ? {} : { allow }),
  });
  response.end();
}
function conditionalRead(
  request: IncomingMessage,
  response: ServerResponse,
  headers: Record<string, string>,
): boolean {
  const etag = headers.etag;
  const ifMatch = request.headers["if-match"];
  const ifNone = request.headers["if-none-match"];
  let status: 304 | 412 | undefined;
  if (
    typeof ifMatch === "string" &&
    ifMatch !== "*" &&
    (etag === undefined ||
      !ifMatch
        .split(",")
        .map((v) => v.trim())
        .includes(etag))
  )
    status = 412;
  else if (
    typeof ifNone === "string" &&
    (ifNone === "*" ||
      (etag !== undefined &&
        ifNone
          .split(",")
          .map((v) => v.trim().replace(/^W\//, ""))
          .includes(etag)))
  )
    status = 304;
  if (status === undefined) return false;
  response.writeHead(status, {
    ...headers,
    "cache-control": "private, no-store",
    ...fixtureHeaders(response),
    ...(status === 304 ? { "content-type": RETAINED_MEDIA } : { "content-length": "0" }),
  });
  response.end();
  return true;
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
    ...fixtureHeaders(response),
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
export async function startRetainedListener(options: PrivateFixtureOptions) {
  const navigation = captureNavigation(options.navigation);
  const credentials = options.credentials.map((credential) => {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(credential.token) || !credential.principal)
      throw new TypeError("explicit private credential/principal mapping required");
    return Object.freeze({ ...credential });
  });
  if (!credentials.length || new Set(credentials.map((c) => c.token)).size !== credentials.length)
    throw new TypeError("unique private credentials required");
  const store = openPrivateRetainedStore({ ...options, navigation });
  const collections = (() => {
    try {
      return createRetainedCollections(navigation, options.instance, (kind) =>
        store.listRecords(kind),
      );
    } catch (error) {
      store.close();
      throw error;
    }
  })();
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
    if (options.referenceCore === true) referenceResponses.add(response);
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
      if (
        options.referenceCore === true &&
        Buffer.byteLength(raw) > REFERENCE_READ_LIMITS.request.targetBytes
      )
        throw new RetainedRequestError("request-too-large", 413);
      const url = new URL(raw, `http://${host}`);
      if (url.pathname + url.search !== raw || url.hash)
        throw new RetainedRequestError("malformed-request", 400);
      const route = known.get(host + raw);
      const inventory = inventoryRoute(url, navigation);
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
          ...fixtureHeaders(response),
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
      if (
        resource !== undefined &&
        route === undefined &&
        !scopeEventRoute &&
        inventory === undefined
      ) {
        const target = store.resolveAlias(resource);
        if (target === null || (target !== undefined && url.search))
          throw new RetainedRequestError("resource-not-found", 404, "after-state-change");
        if (target !== undefined) {
          response.writeHead(307, {
            location: target,
            "content-length": "0",
            "cache-control": "private, no-store",
            ...fixtureHeaders(response),
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
            ...(options.referenceCore === true
              ? { limits: REFERENCE_READ_LIMITS }
              : { events: navigation.events }),
            operations: navigation.operations,
          }),
        );
        return;
      }
      if (route === "directory") {
        json(response, 200, serialized(navigation.targets));
        return;
      }
      const incident =
        inventory === undefined &&
        resource !== undefined &&
        url.searchParams.get("view") === "links";
      if (inventory !== undefined || incident) {
        if (incident) {
          const subject = store.readRecord(resource!);
          if (subject === undefined)
            throw new RetainedRequestError("resource-not-found", 404, "after-state-change");
          if (subject.kind !== "bead") throw new RetainedRequestError("invalid-parameter", 400);
        }
        const page = collections.read(
          url,
          principal,
          inventory ?? "link",
          incident ? resource : undefined,
        );
        const body = serialized(page);
        const headers = {
          "bdp-collection-kind": inventory ?? "link",
          ...(incident ? { "bdp-resource-kind": "bead" } : {}),
          etag: `"${createHash("sha256").update(body).digest("hex")}"`,
          link: `<${navigation.description}>; rel="service-desc"; type="${RETAINED_MEDIA}"`,
        };
        if (conditionalRead(request, response, headers)) {
          collections.discardUnissued(page);
          return;
        }
        if (method === "HEAD") collections.discardUnissued(page);
        json(response, 200, body, headers);
        return;
      }
      const isSubjectEvents = resource !== undefined && url.searchParams.get("view") === "events";
      if (scopeEventRoute || isSubjectEvents) {
        if (options.referenceCore === true)
          throw new RetainedRequestError(
            isSubjectEvents ? "invalid-parameter" : "resource-not-found",
            isSubjectEvents ? 400 : 404,
            isSubjectEvents ? "never" : "after-state-change",
          );
        const source = scopeEventRoute ? navigation.events : `${resource}?view=events`;
        // Resolve the authorized selection/cursor before a conditional shortcut.
        const body = serialized(
          store.events(
            principal,
            source,
            isSubjectEvents ? (resource as string) : "",
            parseEventSelection(scopeEventRoute ? scopeEventQuery : url, isSubjectEvents),
          ),
        );
        const headers = {
          link: `<${navigation.description}>; rel="service-desc"; type="${RETAINED_MEDIA}"`,
        };
        if (conditionalRead(request, response, headers)) return;
        json(response, 200, body, headers);
        return;
      }
      if (resource === undefined)
        throw new RetainedRequestError("resource-not-found", 404, "after-state-change");
      // This bounded source increment implements current full/properties reads.
      // History/aggregate selection remains an explicit private fixture gap.
      if (url.searchParams.has("revision") || url.searchParams.has("include")) {
        if (options.referenceCore === true)
          throw new RetainedRequestError("invalid-parameter", 400);
        throw new RetainedFixtureGap("History and aggregate reads remain unimplemented");
      }
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
      if (conditionalRead(request, response, headers)) return;
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
  // The selected reference must be able to read every identity whose complete
  // record fits the existing262144-byte store bound. The private fixture keeps
  // its original Node default; this is a finite product transport policy.
  const server = createServer(
    options.referenceCore === true ? { maxHeaderSize: 1024 * 1024 } : {},
    (request, response) => {
      void handle(request, response);
    },
  );
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
    collections.close();
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
    navigation,
    listenUrl: `http://127.0.0.1:${address.port}`,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => {
          try {
            collections.close();
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

/** Historical fixture remains explicitly nonattesting. */
export async function startPrivateRetainedFixture(options: PrivateFixtureOptions) {
  return {
    claimEligible: false as const,
    missing: PRIVATE_FIXTURE_GAPS,
    ...(await startRetainedListener(options)),
  };
}
