import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { BDP_V0_SCHEMA_ID } from "./index.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "./schema-formats.js";

/** These are independent, narrated HTTP examples and corruption probes, not a
 * server implementation, an HTTP library, or executable conformance evidence.
 * Existing exchange fixtures retain their stricter required JSON-body shape.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name: string): string => readFileSync(path.join(root, name), "utf8");
type Body = Record<string, unknown>;
interface Example {
  id: string;
  profile: string;
  kind: string;
  source: { file: string; exchange: string };
  context: {
    ordinaryStatus: number;
    ordinaryRefusal?: string;
    supportedMedia: string[];
    entityTagAvailable: boolean;
    modificationDateAvailable: boolean;
    handle?: string;
    independentEmptyScope?: string;
    recovery?: {
      event: string;
      sameEpoch: boolean;
      detailAvailable: boolean;
      sameAuthorizationView: boolean;
      newErasure: boolean;
    };
    withheldIndexes?: number[];
    erasedIndexes?: number[];
  };
  request: { method: string; target: string; headers: Record<string, string> };
  response: {
    status: number;
    headers: Record<string, string>;
    schema?: string;
    body?: Body;
    bodyOmittedFromIllustration?: boolean;
    ended: boolean;
  };
  effects: {
    newAdmissions: number;
    stateChanges: number;
    checkpointBefore: string;
    checkpointAfter: string;
  };
}
const fixture = JSON.parse(read("fixtures/transactional/http-contracts.json")) as {
  fixtureVersion: number;
  cases: Example[];
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
ajv.addSchema(JSON.parse(read("schemas/bdp-v0.schema.json")));
const sourceExchangeFor = (example: Example) => {
  const source = JSON.parse(read(`fixtures/transactional/${example.source.file}`)) as {
    exchanges: { id: string; request: { target: string }; response: Example["response"] }[];
  };
  const exchange = source.exchanges.find(({ id }) => id === example.source.exchange);
  expect(exchange, example.source.exchange).toBeDefined();
  if (exchange === undefined) throw new Error("Missing source exchange");
  return exchange;
};

const sourceFor = (example: Example): Example["response"] => sourceExchangeFor(example).response;

// Deliberately bounded to the media ranges used by this fixture: no parameters
// except q, no quoted strings, and no claim to implement arbitrary Accept syntax.
function quality(accept: string | undefined, media: string): number {
  if (accept === undefined) return 1;
  const [type] = media.split("/");
  const matches = accept.split(",").flatMap((raw) => {
    const match = /^\s*([a-z*]+\/[a-z*-]+)\s*(?:;q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/.exec(
      raw,
    );
    expect(match, `fixture Accept grammar: ${raw}`).not.toBeNull();
    const range = match?.[1];
    const specificity = range === media ? 2 : range === `${type}/*` ? 1 : range === "*/*" ? 0 : -1;
    return specificity < 0 ? [] : [{ specificity, q: Number(match?.[2] ?? 1) }];
  });
  matches.sort((a, b) => b.specificity - a.specificity);
  return matches[0]?.q ?? 0;
}
function expectedStatus(example: Example): number {
  const { context, request } = example;
  if (context.ordinaryStatus !== 200) {
    const refusals: Record<string, number> = {
      authentication: 401,
      "undisclosed-target": 404,
      "foreign-view": 409,
      "expired-epoch": 410,
      "expired-detail": 410,
      "erasure-expiry": 410,
      "catch-up-timeout": 503,
      "service-failure": 503,
      "timed-expiry": 410,
      unknown: 404,
      undisclosed: 404,
      "service-failure-before-expiry": 503,
      "unsupported-request-media": 415,
      "retracted-receipt": 404,
      "forgotten-failed-receipt": 404,
      "prior-epoch-receipt": 404,
    };
    expect(context.ordinaryStatus).toBe(refusals[context.ordinaryRefusal ?? ""]);
    return context.ordinaryStatus;
  }
  if (context.supportedMedia.every((media) => quality(request.headers.Accept, media) === 0))
    return 406;
  // All preconditions in this fixture are read preconditions on existing
  // representations with no available entity tag or modification date.
  expect(context.entityTagAvailable).toBe(false);
  expect(context.modificationDateAvailable).toBe(false);
  const match = request.headers["If-Match"];
  if (match !== undefined && match !== "*") return 412;
  if (request.headers["If-None-Match"] === "*") return 304;
  return 200;
}
function check(example: Example): void {
  const { response, request, context, effects } = example;
  expect(response.status, example.id).toBe(expectedStatus(example));
  const headerNames = Object.keys(response.headers).map((name) => name.toLowerCase());
  if (["receipt", "receipt-page", "changes", "events", "resource-events"].includes(example.kind)) {
    expect(headerNames).not.toContain("etag");
    expect(headerNames).not.toContain("last-modified");
  }
  const nativeBodyless = [304, 406, 412].includes(response.status);
  if (nativeBodyless || request.method === "HEAD") {
    expect(response).not.toHaveProperty("body");
    expect(response).not.toHaveProperty("schema");
    expect(response).not.toHaveProperty("bodyOmittedFromIllustration");
    expect(effects.checkpointAfter).toBe(effects.checkpointBefore);
  }
  if (response.status === 406) {
    expect(effects.newAdmissions).toBe(0);
    expect(effects.stateChanges).toBe(0);
  }
  if (request.method === "HEAD") {
    expect(response.ended).toBe(true);
    expect(effects.newAdmissions).toBe(0);
    expect(effects.stateChanges).toBe(0);
  }
  if (response.status === 200) {
    const media = response.headers["Content-Type"] ?? "";
    expect(context.supportedMedia).toContain(media);
    expect(quality(request.headers.Accept, media)).toBeGreaterThan(0);
    if (request.method !== "HEAD" && media === "application/json")
      expect(response.body).toBeDefined();
  }
  const sse = response.headers["Content-Type"] === "text/event-stream";
  expect(response.headers["Cache-Control"]).toBe(
    sse ? "no-store, no-transform" : "private, no-store",
  );
  if (example.profile === "transactional") {
    for (const name of ["BDP-Scope-Epoch", "BDP-Authorization-View", "BDP-Scope-Position"]) {
      expect(response.headers[name], name).toBeTruthy();
    }
  }
  if (response.body !== undefined) {
    expect(response.schema).toBeDefined();
    const validate = ajv.getSchema(`${BDP_V0_SCHEMA_ID}${response.schema}`);
    expect(validate, response.schema).toBeDefined();
    expect(validate?.(response.body), JSON.stringify(validate?.errors)).toBe(true);
  }
  if (context.independentEmptyScope !== undefined) {
    expect(request.target).toBe(`${context.independentEmptyScope}events/`);
    if (response.body !== undefined) {
      expect(response.body).toEqual({ source: request.target, events: [], next: null });
    }
  }
  if (context.handle === "retained-manifest") {
    const original = sourceFor(example);
    expect(request.target).toBe(original.body?.id);
    if (request.method === "GET") expect(response.body).toEqual(original.body);
  }
  if (context.recovery !== undefined) {
    expect(effects.newAdmissions).toBe(0);
    expect(effects.stateChanges).toBe(0);
    expect(request.target).toBe(sourceExchangeFor(example).request.target);
    expect(context.recovery.sameEpoch).toBe(true);
    expect(context.recovery.detailAvailable).toBe(true);
    const original = sourceFor(example);
    expect(response.headers["BDP-Scope-Epoch"]).toBe(original.headers["bdp-scope-epoch"]);
    expect(response.body?.receipt).toBe(original.body?.receipt);
    expect(response.body?.next).toBe(original.body?.next);
    const recorded = original.body?.results as Body[];
    const projected = response.body?.results as Body[];
    expect(projected.length).toBe(recorded.length);
    for (const [index, entry] of recorded.entries()) {
      if (context.withheldIndexes?.includes(index) || context.erasedIndexes?.includes(index)) {
        expect(["created", "updated"]).toContain(entry.outcome);
      }
      const expected = context.erasedIndexes?.includes(index)
        ? {
            operationIndex: entry.operationIndex,
            ...(entry.operationName === undefined ? {} : { operationName: entry.operationName }),
            outcome: "erased",
            erased: Object.fromEntries(
              Object.entries(entry.resource as Body).filter(([key]) =>
                ["id", "type", "revision"].includes(key),
              ),
            ),
          }
        : context.withheldIndexes?.includes(index)
          ? Object.fromEntries([
              ...Object.entries(entry).filter(([key]) =>
                ["operationIndex", "operationName"].includes(key),
              ),
              ["outcome", "withheld"],
            ])
          : entry;
      expect(projected[index]).toEqual(expected);
    }
    if (context.recovery.sameAuthorizationView && !context.recovery.newErasure) {
      expect(response.body).toEqual(original.body);
    }
  }
}
function requiredBody(response: Example["response"]): Body {
  if (response.body === undefined) throw new Error("Expected a JSON body in this fixture");
  return response.body;
}
const example = (id: string): Example => {
  const found = fixture.cases.find((candidate) => candidate.id === id);
  expect(found, id).toBeDefined();
  return structuredClone(found) as Example;
};
describe("draft HTTP and retained-handle illustrations (not runtime conformance)", () => {
  it("keeps explicit all-profile negotiation and every affected GET/HEAD family", () => {
    expect(fixture.fixtureVersion).toBe(1);
    expect(new Set(fixture.cases.map(({ id }) => id)).size).toBe(68);
    expect(fixture.cases.length).toBe(68);
    for (const profile of ["read", "read-update", "transactional"]) {
      expect(
        fixture.cases.some((row) => row.profile === profile && row.response.status === 406),
      ).toBe(true);
    }
    for (const kind of [
      "receipt",
      "receipt-page",
      "changes",
      "events",
      "resource-events",
      "snapshot",
    ]) {
      expect(fixture.cases.some((row) => row.kind === kind && row.request.method === "HEAD")).toBe(
        true,
      );
    }
  });
  for (const row of fixture.cases) it(row.id, () => check(row));
  it("applies the same native conditional decision to HEAD without a body", () => {
    for (const candidate of fixture.cases.filter(
      (row) => row.request.method === "GET" && [304, 406, 412].includes(row.response.status),
    )) {
      const head = structuredClone(candidate);
      head.request.method = "HEAD";
      head.response.ended = true;
      check(head);
    }
  });
  it("keeps source and Resource Event pages distinct", () => {
    const row = example("events-match-star");
    row.response.body = structuredClone(requiredBody(sourceFor(row)));
    expect(() => check(row)).toThrow();
  });
  it("keeps HEAD response metadata aligned with the corresponding GET decision", () => {
    for (const row of fixture.cases.filter((candidate) => candidate.request.method === "HEAD")) {
      const get = structuredClone(row);
      get.request.method = "GET";
      expect(expectedStatus(get)).toBe(row.response.status);
      if (row.context.independentEmptyScope === undefined) {
        const original = sourceFor(row);
        for (const field of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"]) {
          const actual = Object.entries(row.response.headers).find(
            ([name]) => name.toLowerCase() === field,
          )?.[1];
          expect(actual, row.id).toBe(original.headers[field]);
        }
      }
    }
  });
  it.each([304, 406, 412])("rejects a JSON body on native %s", (status) => {
    const row = structuredClone(
      fixture.cases.find((candidate) => candidate.response.status === status),
    ) as Example;
    row.response.body = { code: "invented-native-code" };
    expect(() => check(row)).toThrow();
  });
  it("rejects mutation admission on unacceptable response media", () => {
    const row = example("transactional-unacceptable");
    row.effects.newAdmissions = 1;
    expect(() => check(row)).toThrow();
  });
  it("rejects request-media 415 substituted for response-media 406", () => {
    const row = example("read-update-unacceptable");
    row.response.status = 415;
    expect(() => check(row)).toThrow();
  });
  it("rejects accepting JSON excluded by a more-specific q=0 range", () => {
    const row = example("json-q-zero-refusal");
    row.response.status = 200;
    expect(() => check(row)).toThrow();
  });
  it.each(["ETag", "etag", "Last-Modified"])(
    "rejects an invented optional %s validator",
    (name) => {
      const row = example("receipt-page-match-star");
      row.response.headers[name] = '"transaction-is-not-a-validator"';
      expect(() => check(row)).toThrow();
    },
  );
  it.each([
    "expired-detail",
    "foreign-view",
    "erasure-expiry",
    "undisclosed-target",
    "catch-up-timeout",
  ])("rejects 304 bypassing %s", (guard) => {
    const row = example(`refusal-before-conditional-${guard}`);
    row.response.status = 304;
    expect(() => check(row)).toThrow();
  });
  it("rejects a 304 advancing the durable checkpoint", () => {
    const row = example("changes-none-match-star");
    row.effects.checkpointAfter = "not-delivered";
    expect(() => check(row)).toThrow();
  });
  it("rejects HEAD remaining open to stream SSE frames", () => {
    const row = example("changes-head-event-stream");
    row.response.ended = false;
    expect(() => check(row)).toThrow();
  });
  it.each(["id", "scopePosition", "checkpoint", "expiresAt", "beads"])(
    "rejects renewed or replaced manifest %s",
    (field) => {
      const row = example("manifest-refetch-get");
      const body = row.response.body as Body;
      if (field === "expiresAt") body[field] = "2026-09-10T00:00:00Z";
      else if (field === "beads") body[field] = { items: [], next: null };
      else
        body[field] =
          field === "id" ? "https://beads.example/acme/snapshot?replacement" : "replacement";
      expect(() => check(row)).toThrow();
    },
  );
  it("rejects a restarted page fetch executing the retained transaction again", () => {
    const row = example("receipt-page-restart");
    row.effects.newAdmissions = 1;
    expect(() => check(row)).toThrow();
  });
  it("rejects restart changing retained page boundaries", () => {
    const row = example("receipt-page-restart");
    (requiredBody(row.response).results as Body[]).pop();
    expect(() => check(row)).toThrow();
  });
  it("rejects replacing the issued page request URL after restart", () => {
    const row = example("receipt-page-restart");
    row.request.target = "receipts/replacement?page=2";
    expect(() => check(row)).toThrow();
  });
  it("rejects treating service inability before snapshot expiry as expiration", () => {
    const row = example("manifest-service-failure-before-expiry");
    row.context.ordinaryStatus = 410;
    row.response.status = 410;
    expect(() => check(row)).toThrow();
  });
  it("rejects failover returning a new continuation", () => {
    const row = example("receipt-page-failover");
    (row.response.body as Body).next =
      "https://beads.example/receipt-pagination/receipts/new?page=3";
    expect(() => check(row)).toThrow();
  });
  it("rejects resurrecting erased receipt content after restart", () => {
    const row = example("receipt-page-restart-erased");
    row.response.body = structuredClone(requiredBody(sourceFor(row)));
    expect(() => check(row)).toThrow();
  });
  it("rejects retaining content withheld under the current view after restart", () => {
    const row = example("receipt-page-restart-withheld");
    row.response.body = structuredClone(requiredBody(sourceFor(row)));
    expect(() => check(row)).toThrow();
  });
});
