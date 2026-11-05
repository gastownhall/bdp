/** Explicit private fixture, deliberately incomplete. Never public profile admission. */

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { HISTORICAL_UPDATE_CAPABILITY, HISTORICAL_UPDATE_MEDIA } from "@bdp/protocol";
import { conditionalReadStatus } from "../read-http.js";
import { prepareAlias } from "./alias-contract.js";
import {
  BATCH_CAPABILITY,
  BATCH_LIMITS,
  BATCH_OPERATIONS,
  prepareBatch,
} from "./batch-contract.js";
import { createRetainedCollections, inventoryRoute, REFERENCE_READ_LIMITS } from "./collections.js";
import {
  captureNavigation,
  ORDINARY_OPERATIONS,
  prepareCreate,
  prepareDelete,
  prepareUpdate,
  prepareHistoricalUpdate,
  problem,
  RETAINED_MEDIA,
  RetainedFixtureGap,
  RetainedRequestError,
  serialized,
} from "./contract.js";
import { parseEventSelection } from "./events.js";
import { prepareLink } from "./link-contract.js";
import { openPrivateRetainedStore, type PrivateStoreOptions } from "./store.js";

export interface PrivateFixtureOptions extends PrivateStoreOptions {
  readonly credentials: readonly { readonly token: string; readonly principal: string }[];
  readonly authentication?: "required" | "disabled";
  readonly specRevision?: string;
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
function accepts(value: string | undefined, selected = RETAINED_MEDIA, explicit = false): boolean {
  if (value === undefined) return !explicit;
  let rank = -1;
  let quality = 0;
  for (const part of value.split(",")) {
    const [media, ...parameters] = part
      .trim()
      .toLowerCase()
      .split(";")
      .map((p) => p.trim());
    const specificity =
      media === selected
        ? 2
        : explicit
          ? -1
          : media === "application/*"
            ? 1
            : media === "*/*"
              ? 0
              : -1;
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
  representationMediaType: string | null = RETAINED_MEDIA,
): boolean {
  const etag = headers.etag;
  const conditions = new Headers();
  for (const name of ["if-match", "if-none-match"] as const) {
    const value = request.headers[name];
    if (typeof value === "string") conditions.set(name, value);
  }
  const status = conditionalReadStatus(conditions, etag ?? null);
  if (status === 200) return false;
  response.writeHead(status, {
    ...headers,
    "cache-control": "private, no-store",
    ...fixtureHeaders(response),
    ...(status === 304
      ? representationMediaType === null
        ? {}
        : { "content-type": headers["content-type"] ?? representationMediaType }
      : { "content-length": "0" }),
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
  const specRevision = options.specRevision ?? process.env.BDP_SPEC_REVISION;
  if (typeof specRevision !== "string" || !/^[0-9a-f]{40}$/.test(specRevision))
    throw new TypeError("a full lowercase BDP_SPEC_REVISION commit SHA is required");
  const navigation = captureNavigation(options.navigation);
  const credentials = options.credentials.map((credential) => {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(credential.token) || !credential.principal)
      throw new TypeError("explicit private credential/principal mapping required");
    return Object.freeze({ ...credential });
  });
  const authentication = options.authentication ?? "required";
  if (
    (authentication !== "required" && authentication !== "disabled") ||
    (authentication === "required" && credentials.length === 0) ||
    (authentication === "disabled" && credentials.length !== 0) ||
    new Set(credentials.map((c) => c.token)).size !== credentials.length
  )
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
    ...(options.referenceCore === true
      ? [[signature(navigation.scope + "bdp/batch"), "batch"] as const]
      : []),
    ...ORDINARY_OPERATIONS.map(
      (operation) => [signature(navigation.targets[operation]), operation] as const,
    ),
  ]);
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (options.referenceCore === true) referenceResponses.add(response);
    try {
      const authorization = one(request, "authorization") ?? "";
      const principal =
        authentication === "disabled"
          ? "anonymous"
          : credentials.find((credential) => {
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
        route === "batch" ||
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
        const selected = one(request, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        const historical = route === "updateBead" && selected === HISTORICAL_UPDATE_MEDIA;
        if (selected !== RETAINED_MEDIA && !historical)
          throw new RetainedRequestError("unsupported-media-type", 415);
        if (
          !accepts(
            request.headers.accept,
            historical ? HISTORICAL_UPDATE_MEDIA : RETAINED_MEDIA,
            historical,
          )
        ) {
          empty(response, 406);
          return;
        }
        const key = one(request, "idempotency-key");
        if (key === undefined) throw new RetainedRequestError("malformed-request", 400);
        const text = await receive(request);
        const result =
          route === "batch"
            ? store.batch(principal, prepareBatch(navigation.scope, text, key))
            : route === "createBead"
              ? store.create(principal, prepareCreate(navigation.scope, text, key))
              : route === "updateBead"
                ? store.update(
                    principal,
                    (historical ? prepareHistoricalUpdate : prepareUpdate)(
                      navigation.scope,
                      text,
                      key,
                    ),
                  )
                : route === "deleteBead"
                  ? store.deleteBead(principal, prepareDelete(navigation.scope, text, key))
                  : route === "putAlias" || route === "deleteAlias"
                    ? store[route](principal, prepareAlias(navigation.scope, route, text, key))
                    : store[route](principal, prepareLink(navigation.scope, route, text, key));
        if (!response.destroyed)
          json(
            response,
            result.status,
            result.text,
            historical && result.status === 200
              ? { "content-type": HISTORICAL_UPDATE_MEDIA, vary: "Accept" }
              : {},
          );
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        empty(response, 405, "GET, HEAD");
        return;
      }
      if (route === "scope") {
        const headers = {
          link: `<${navigation.description}>; rel="service-desc"; type="${RETAINED_MEDIA}"`,
          "cache-control": "private, no-store",
        };
        if (conditionalRead(request, response, headers, null)) return;
        response.writeHead(204, { ...headers, ...fixtureHeaders(response) });
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
      const historicalRead =
        route === undefined &&
        resource !== undefined &&
        inventory === undefined &&
        !scopeEventRoute &&
        accepts(request.headers.accept, HISTORICAL_UPDATE_MEDIA, true) &&
        !accepts(request.headers.accept);
      if (!historicalRead && !accepts(request.headers.accept)) {
        empty(response, 406);
        return;
      }
      if (
        historicalRead &&
        url.search &&
        (url.searchParams.get("view") !== "terminal" ||
          url.searchParams.getAll("view").length !== 1 ||
          [...url.searchParams.keys()].some((name) => name !== "view"))
      )
        throw new RetainedRequestError("invalid-parameter", 400);
      if (route === "description") {
        if (conditionalRead(request, response, {})) return;
        json(
          response,
          200,
          serialized({
            bdpVersion: "0.1",
            profile: "write",
            scope: navigation.scope,
            specRevision,
            aliases: navigation.aliases,
            ...(options.referenceCore === true
              ? {
                  limits: REFERENCE_READ_LIMITS,
                  ...(store.historicalUpdateEnabled
                    ? {
                        capabilities: {
                          [HISTORICAL_UPDATE_CAPABILITY]: { "1": { atomicBatch: false } },
                        },
                      }
                    : {}),
                  ...(store.atomicBatchEnabled
                    ? {
                        capabilities: {
                          [BATCH_CAPABILITY]: {
                            "1": {
                              operation: navigation.scope + "bdp/batch",
                              operations: BATCH_OPERATIONS,
                              ...BATCH_LIMITS,
                            },
                          },
                        },
                      }
                    : {}),
                }
              : { events: navigation.events }),
            operations: navigation.operations,
          }),
        );
        return;
      }
      if (route === "directory") {
        if (conditionalRead(request, response, {})) return;
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
      if (historicalRead) {
        const terminalRead = url.searchParams.get("view") === "terminal";
        if (
          url.search &&
          (!terminalRead ||
            url.searchParams.getAll("view").length !== 1 ||
            [...url.searchParams.keys()].some((name) => name !== "view"))
        )
          throw new RetainedRequestError("invalid-parameter", 400);
        if (!store.historicalUpdateEnabled) {
          json(
            response,
            422,
            serialized({
              ...problem("capability-not-supported", 422, "after-state-change"),
              capability: HISTORICAL_UPDATE_CAPABILITY,
              capabilityVersion: "1",
            }),
          );
          return;
        }
        const version = store.readHistoricalVersion(resource);
        if (
          version === undefined ||
          (terminalRead ? version.terminal === undefined : version.resource === undefined)
        )
          throw new RetainedRequestError("resource-not-found", 404, "after-state-change");
        const body = serialized(version);
        const headers = {
          "content-type": HISTORICAL_UPDATE_MEDIA,
          vary: "Accept",
          "bdp-resource-kind": "bead",
          etag: `"historical-${createHash("sha256").update(body).digest("hex")}"`,
          link: `<${navigation.description}>; rel="service-desc"; type="${RETAINED_MEDIA}"`,
        };
        if (conditionalRead(request, response, headers)) return;
        json(response, 200, body, headers);
        return;
      }
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
        vary: "Accept",
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
