/** New packed key grammar cases; unchanged public HTTP, limits, clock and configuration. */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_KEY_GRAMMAR_PRODUCT_ENTRY;
const source = process.env.BDP_KEY_GRAMMAR_PRODUCT_SOURCE;
const build = process.env.BDP_KEY_GRAMMAR_PRODUCT_BUILD;
const output = process.env.BDP_KEY_GRAMMAR_PRODUCT_OUTPUT;
const scope = "https://reference.invalid/acme/";
const type = `${scope}types/key-task`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);

function transport(
  address: URL,
  token: string,
  signal: AbortSignal,
  wires: unknown[],
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
    const wire = await execute({
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
    });
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
    }
    return { wire, value: wire.bodyText === "" ? undefined : JSON.parse(wire.bodyText) };
  };
}
type Context = {
  exchange: ReturnType<typeof transport>;
  batch: (operations: unknown[], key: string) => ReturnType<ReturnType<typeof transport>>;
  position(value: string): void;
};
async function withInstalled(name: string, scenario: (c: Context) => Promise<void>) {
  if (!entry || !source || !build || !output)
    throw Error("explicit installed/source/build/output required");
  const fixtureBytes = await readFile(
    new URL("../test-support/transactional-key-grammar-fixture.json", import.meta.url),
  );
  const fixture = JSON.parse(fixtureBytes.toString("utf8")),
    modules = [];
  for (const name of (await readdir(build)).filter((n) => n.endsWith(".js")).sort()) {
    const b = await readFile(path.join(path.dirname(entry), name));
    expect(b.equals(await readFile(path.join(build, name))), name).toBe(true);
    modules.push({ name, bytes: b.length, sha256: sha(b) });
  }
  const schema = await readFile(
    path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json"),
  );
  expect(schema.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(true);
  const failures: unknown[] = [],
    wires: unknown[] = [],
    state = { position: "pos-0" };
  const controller = new AbortController(),
    watchdog = setTimeout(() => controller.abort(Error("key grammar installed deadline")), 20000);
  let directory: string | undefined,
    configuration: unknown,
    ready: unknown,
    binding: unknown,
    terminal: unknown;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined,
    drained: Promise<void> | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "bdp-key-grammar-product-"));
    const token = randomBytes(32).toString("base64url");
    configuration = {
      scope,
      directory,
      create: true,
      credentials: [{ token, principal: "writer", canMutate: true }],
      artifacts: fixture.artifacts,
    };
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
    ready = child.ready;
    const serving = child.child;
    drained = new Promise<void>((resolve) =>
      serving.once("close", (code: number | null, signal: string | null) => {
        terminal = {
          code,
          signal,
          stdoutEOF: serving.stdout?.readableEnded,
          stderrEOF: serving.stderr?.readableEnded,
        };
        resolve();
      }),
    );
    binding = installedTransactionBinding(child.ready, source, { bytes: fixtureBytes });
    const exchange = transport(
      new URL(String(child.ready.listenUrl)),
      token,
      controller.signal,
      wires,
      state,
    );
    await scenario({
      exchange,
      batch: (operations, key) => exchange("operations/batch", { operations }, [key]),
      position: (value) => {
        state.position = value;
      },
    });
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(watchdog);
    try {
      if (child) {
        await child.close();
        await drained;
        expect(terminal).toMatchObject({ code: 0, signal: null, stdoutEOF: true, stderrEOF: true });
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      await writeFile(
        path.join(output, `${name}-observation.json`),
        JSON.stringify(
          {
            source,
            entry,
            modules,
            schemaSHA256: sha(schema),
            fixtureSHA256: sha(fixtureBytes),
            fixtureId: fixture.id,
            configuration: directory
              ? {
                  scope,
                  directory,
                  create: true,
                  credentials: [{ credentialRef: "writer", principal: "writer", canMutate: true }],
                  artifacts: fixture.artifacts,
                }
              : undefined,
            ready,
            binding,
            terminal,
            wires,
            failures: failures.map((error) => inspect(error, { depth: 10 })),
            wholeRowsComplete: false,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch (error) {
      failures.push(error);
    }
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "key grammar installed observation or cleanup failed");
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

it.skipIf(!entry)(
  "packed singleton and batch require one bare key and preserve min/max length byte-case identity",
  async () =>
    withInstalled("http-fields", async (c) => {
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

it.skipIf(!entry)(
  "packed sequence validates all member keys before effects without a carrier HTTP key",
  async () =>
    withInstalled("sequence-members", async (c) => {
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
