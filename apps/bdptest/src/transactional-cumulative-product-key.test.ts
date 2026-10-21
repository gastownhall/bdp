/** Existing key grammar positive assertions on one new cumulative installed configuration. */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createRawHttpExchangeExecutor,
  type ExactHttpExchangeRequest,
  type HttpExchangeResponse,
} from "@bdp/conformance";
import {
  createCumulativeTransactionalArtifactBundle,
  loadProfileContractSelection,
} from "@bdp/conformance/testing";
import {
  withProductCampaign,
  productEntry,
  productFixtureSource,
  sha,
  productScope as scope,
} from "../test-support/transactional-cumulative-product-runtime.js";
const type = scope + "types/task";
const bundle = createCumulativeTransactionalArtifactBundle(
  loadProfileContractSelection("transactional"),
  {
    manifest: {
      bytes: readFileSync(
        new URL(
          "../test-support/transactional-cumulative-product-read-manifest.json",
          import.meta.url,
        ),
      ),
    },
    fixture: productFixtureSource,
  },
);
function transport(
  address: URL,
  token: string,
  signal: AbortSignal,
  wires: unknown[],
  observe: (request: ExactHttpExchangeRequest, response: HttpExchangeResponse) => void,
  state: { position: string; epoch?: string | undefined; view?: string | undefined },
) {
  return async function exchange(
    target: string,
    body?: unknown,
    keys: readonly string[] = [],
    plan: "observed" | "pre-owner-key-refusal" = "observed",
  ) {
    expect(wires.length).toBeLessThan(96);
    const method = body === undefined ? "GET" : "POST";
    const url = new URL(target, scope).href;
    expect(new URL(url).origin).toBe(new URL(scope).origin);
    expect(new URL(url).pathname.startsWith("/acme/")).toBe(true);
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 1048576,
        exactMode: {
          scope,
          profile: "transactional",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "writer",
          credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
        },
      },
    );
    const request: ExactHttpExchangeRequest = {
      method,
      url,
      signal,
      raw: {
        headerLines:
          raw === undefined
            ? []
            : [
                { name: "Content-Type", value: "application/json" },
                ...keys.map((value) => ({ name: "Idempotency-Key", value })),
              ],
        ...(raw === undefined ? {} : { bodyBytes: Buffer.from(raw) }),
      },
    };
    const wire = await execute(request);
    observe(request, wire);
    wires.push({
      method,
      url,
      requestBody: raw,
      keys,
      plan,
      keyHeaderLines: wire.exactRequest?.headerLines.filter(
        (line) => line.name.toLowerCase() === "idempotency-key",
      ),
      requestWriteState: wire.exactRequest?.writeState,
      requestBodyDigest: wire.exactRequest?.bodyDigest,
      status: wire.status,
      headers: wire.headers,
      bodyText: wire.bodyText,
      wireBase64: Buffer.from(wire.wireResponseBytes ?? []).toString("base64"),
    });
    expect(wire.exactRequest?.writeState).toBe("complete");
    expect(
      wire.exactRequest?.headerLines
        .filter((line) => line.name.toLowerCase() === "idempotency-key")
        .map((line) => line.value),
    ).toEqual(keys);
    expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
    if (raw !== undefined) expect(wire.exactRequest?.bodyDigest).toBe(sha(Buffer.from(raw)));
    if (plan === "observed") {
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(wire.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      state.epoch ??= wire.headers["bdp-scope-epoch"];
      state.view ??= wire.headers["bdp-authorization-view"];
      expect(wire.headers["bdp-scope-epoch"]).toBe(state.epoch);
      expect(wire.headers["bdp-authorization-view"]).toBe(state.view);
      expect(wire.headers["bdp-scope-position"]).toBe(state.position);
    } else {
      expect(method).toBe("POST");
      expect(
        ["operations/create-bead", "operations/batch", "operations/sequence"].map((p) => scope + p),
      ).toContain(url);
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(wire.headers[name]).toBeUndefined();
    }
    return { wire, value: wire.bodyText === "" ? undefined : JSON.parse(wire.bodyText) };
  };
}
type Context = {
  exchange: ReturnType<typeof transport>;
  batch: (operations: unknown[], key: string) => ReturnType<ReturnType<typeof transport>>;
  position(value: string): void;
};

async function withCumulative(name: string, run: (c: Context) => Promise<void>) {
  await withProductCampaign("key-" + name, bundle, async (campaign) => {
    const child = await campaign.launch("key-" + name, false, campaign.signal),
      state = { position: "pos-0" },
      wires: unknown[] = [];
    const exchange = transport(
      new URL(String(child.ready.listenUrl)),
      campaign.roles.find((r) => r.ref === "operator")!.token,
      campaign.signal,
      wires,
      (request, response) => campaign.observe("key-" + name, request, response),
      state,
    );
    try {
      await run({
        exchange,
        batch: (operations, key) => exchange("operations/batch", { operations }, [key]),
        position(value) {
          state.position = value;
        },
      });
      campaign.results[name] = {
        state: "pass",
        wireCount: wires.length,
        assertionSource: "transactional-key-grammar-product-installed.test.ts",
        wholeRowsComplete: false,
      };
    } finally {
      await child.close();
    }
  });
}
const maxKey = "Aa09_-".repeat(43).slice(0, 256);
const create = (id: string) => ({
  operation: "createBead",
  id: `beads/${id}`,
  type,
  properties: { label: id, n: 0 },
  metadata: { stage: "seed" },
});
const record = (id: string) => ({
  id: `${scope}beads/${id}`,
  type,
  revision: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
  properties: { label: id, n: 0 },
  metadata: { stage: "seed" },
});
function malformed(response: { wire: { status: number }; value: unknown }) {
  expect(response.wire.status).toBe(400);
  expect(response.value).toEqual({
    type: "https://github.com/gastownhall/bdp/problems/request",
    code: "malformed-request",
    status: 400,
    retry: "never",
  });
}
async function feed(c: Context) {
  const all: Array<{ position: string; events: Array<{ type: string; subject: string }> }> = [];
  let target: string | null = "changes/?after=genesis";
  const visited = new Set<string>();
  while (target !== null) {
    expect(visited.size).toBeLessThan(16);
    expect(visited.has(target)).toBe(false);
    visited.add(target);
    const r = await c.exchange(target);
    expect(r.wire.status).toBe(200);
    expect(Array.isArray(r.value.groups)).toBe(true);
    expect(r.value.next === null || typeof r.value.next === "string").toBe(true);
    all.push(...r.value.groups);
    target = r.value.next;
  }
  return all;
}

it("grammar refusal oracle rejects success, stale success and a wrong direct problem", () => {
  const problem = {
    type: "https://github.com/gastownhall/bdp/problems/request",
    code: "malformed-request",
    status: 400,
    retry: "never",
  };
  malformed({ wire: { status: 400 }, value: problem });
  for (const wrong of [
    { wire: { status: 200 }, value: problem },
    { wire: { status: 200 }, value: { status: "completed", results: [] } },
    { wire: { status: 400 }, value: { ...problem, code: "invalid-parameter" } },
  ])
    expect(() => malformed(wrong)).toThrow();
});

it.skipIf(!productEntry)(
  "packed singleton and batch require one bare key and preserve min/max length byte-case identity",
  async () =>
    withCumulative("http-fields", async (c) => {
      expect(await feed(c)).toEqual([]);
      const invalid: Array<[string, string[]]> = [
        ["absent", []],
        ["repeated-equal", ["RepeatA", "RepeatA"]],
        ["repeated-distinct", ["RepeatA", "RepeatB"]],
        ["empty", [""]],
        ["long", [maxKey + "Z"]],
        ["quoted", ['"QuotedKey"']],
        ["space", ["white space"]],
        ["punctuation", ["dot.key"]],
        ["nonascii", ["é"]],
      ];
      const missing: string[] = [];
      for (const carrier of ["singleton", "batch"] as const) {
        for (const [name, keys] of invalid) {
          const id = `${carrier}-${name}`;
          missing.push(id);
          const op = create(id);
          const r = await c.exchange(
            carrier === "singleton" ? "operations/create-bead" : "operations/batch",
            carrier === "singleton"
              ? { id: op.id, type: op.type, properties: op.properties, metadata: op.metadata }
              : { operations: [op] },
            keys,
            "pre-owner-key-refusal",
          );
          malformed(r);
        }
      }
      for (const id of missing) {
        const r = await c.exchange(`beads/${id}`);
        expect(r.wire.status).toBe(404);
        expect(r.value.code).toBe("resource-not-found");
      }
      expect(await feed(c)).toEqual([]);
      const positives: Array<[string, "singleton" | "batch", string]> = [
        ["min-singleton", "singleton", "Z"],
        ["min-batch", "batch", "_"],
        ["max-singleton", "singleton", "Q".repeat(256)],
        ["max-batch", "batch", maxKey],
        ["repeat-a", "batch", "RepeatA"],
        ["repeat-b", "singleton", "RepeatB"],
        ["unquoted", "singleton", "QuotedKey"],
        ["unspaced", "batch", "whitespace"],
        ["unpunctuated", "singleton", "dotkey"],
        ["ascii", "batch", "e"],
        ["upper", "singleton", "CaseKey"],
        ["lower", "batch", "casekey"],
      ];
      const expectedSubjects: string[] = [],
        receipts: string[] = [];
      for (const [i, [id, carrier, key]] of positives.entries()) {
        c.position(`pos-${i + 1}`);
        const op = create(id),
          target = carrier === "singleton" ? "operations/create-bead" : "operations/batch",
          body =
            carrier === "singleton"
              ? { id: op.id, type: op.type, properties: op.properties, metadata: op.metadata }
              : { operations: [op] };
        const r = await c.exchange(target, body, [key]);
        expect(r.wire.status).toBe(200);
        expect(r.value).toMatchObject({
          status: "completed",
          detail: "available",
          idempotencyKey: key,
          requiredPosition: `pos-${i + 1}`,
          effectPosition: `pos-${i + 1}`,
          next: null,
        });
        expect(r.value.results).toEqual([
          { operationIndex: 0, outcome: "created", resource: record(id) },
        ]);
        expect(receipts).not.toContain(r.value.id);
        receipts.push(r.value.id);
        expectedSubjects.push(`${scope}beads/${id}`);
        const retry = await c.exchange(target, body, [key]);
        expect(retry.wire.status).toBe(200);
        expect(retry.wire.bodyText).toBe(r.wire.bodyText);
        const read = await c.exchange(`beads/${id}`);
        expect(read.wire.status).toBe(200);
        expect(read.value).toEqual(record(id));
        expect(read.value.revision).toBe(r.value.results[0].resource.revision);
      }
      const groups = await feed(c);
      expect(groups.map((g) => g.position)).toEqual(positives.map((_, i) => `pos-${i + 1}`));
      expect(groups.flatMap((g) => g.events.map((e) => [e.type, e.subject]))).toEqual(
        expectedSubjects.map((id) => ["created", id]),
      );
    }),
  30000,
);

it.skipIf(!productEntry)(
  "packed sequence validates all member keys before effects without a carrier HTTP key",
  async () =>
    withCumulative("sequence-members", async (c) => {
      expect(await feed(c)).toEqual([]);
      const invalid: Array<[string, unknown]> = [
        ["absent", undefined],
        ["empty", ""],
        ["long", maxKey + "Z"],
        ["quoted", '"SeqQuoted"'],
        ["space", "seq space"],
        ["padding", " SeqPadded "],
        ["punctuation", "seq.key"],
        ["nonascii", "é"],
      ];
      const absent: string[] = [];
      for (const [name, key] of invalid) {
        const before = `before-${name}`,
          bad = `bad-${name}`;
        absent.push(before, bad);
        const members = [
          { ...create(before), idempotencyKey: `before_${name}` },
          { ...create(bad), ...(key === undefined ? {} : { idempotencyKey: key }) },
        ];
        malformed(
          await c.exchange(
            "operations/sequence",
            { operations: members },
            [],
            "pre-owner-key-refusal",
          ),
        );
      }
      const repeated = [
        { ...create("repeat-first"), idempotencyKey: "SeqRepeat" },
        { ...create("repeat-second"), idempotencyKey: "SeqRepeat" },
      ];
      absent.push("repeat-first", "repeat-second");
      malformed(
        await c.exchange(
          "operations/sequence",
          { operations: repeated },
          [],
          "pre-owner-key-refusal",
        ),
      );
      absent.push("stray");
      malformed(
        await c.exchange(
          "operations/sequence",
          { operations: [{ ...create("stray"), idempotencyKey: "SeqStray" }] },
          ["NotACarrierKey"],
          "pre-owner-key-refusal",
        ),
      );
      for (const id of absent) {
        const r = await c.exchange(`beads/${id}`);
        expect(r.wire.status).toBe(404);
        expect(r.value.code).toBe("resource-not-found");
      }
      expect(await feed(c)).toEqual([]);
      const positive = [
        ["seq-min", "S"],
        ["seq-max", maxKey],
        ["seq-upper", "SeqCase"],
        ["seq-lower", "seqcase"],
        ["seq-repeat", "SeqRepeat"],
        ["seq-unquoted", "SeqQuoted"],
        ["seq-unpadded", "SeqPadded"],
        ["seq-unspaced", "seqspace"],
        ["seq-unpunctuated", "seqkey"],
        ["seq-ascii", "e"],
        ["seq-first-reused", "before_empty"],
        ["seq-stray-reused", "SeqStray"],
      ];
      const subjects: string[] = [];
      for (const [i, [id, key]] of positive.entries()) {
        c.position(`pos-${i + 1}`);
        const body = { operations: [{ ...create(id!), idempotencyKey: key }] };
        const r = await c.exchange("operations/sequence", body);
        expect(r.wire.status).toBe(200);
        expect(r.value).toEqual({
          results: [{ operationIndex: 0, outcome: "created", resource: record(id!) }],
        });
        const retry = await c.exchange("operations/sequence", body);
        expect(retry.wire.status).toBe(200);
        expect(retry.wire.bodyText).toBe(r.wire.bodyText);
        const read = await c.exchange(`beads/${id}`);
        expect(read.wire.status).toBe(200);
        expect(read.value).toEqual(record(id!));
        expect(read.value.revision).toBe(r.value.results[0].resource.revision);
        subjects.push(`${scope}beads/${id}`);
      }
      const groups = await feed(c);
      expect(groups.map((g) => g.position)).toEqual(positive.map((_, i) => `pos-${i + 1}`));
      expect(groups.flatMap((g) => g.events.map((e) => [e.type, e.subject]))).toEqual(
        subjects.map((id) => ["created", id]),
      );
    }),
  30000,
);
