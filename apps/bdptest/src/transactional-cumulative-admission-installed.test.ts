/** NEW fixed installed admission companion; no ordinary configuration identity or whole profile award. */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { launchCumulativeAdmission } from "../test-support/transactional-cumulative-admission-launch.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_CUMULATIVE_ADMISSION_ENTRY,
  source = process.env.BDP_CUMULATIVE_ADMISSION_SOURCE,
  build = process.env.BDP_CUMULATIVE_ADMISSION_BUILD,
  output = process.env.BDP_CUMULATIVE_ADMISSION_OUTPUT,
  bankPath = process.env.BDP_CUMULATIVE_ADMISSION_CREDENTIALS;
const scope = "https://reference.invalid/acme/",
  type = scope + "types/task";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const fixtureBytes = await readFile(
    new URL("../test-support/transactional-cumulative-product-fixture.json", import.meta.url),
  ),
  fixture = JSON.parse(fixtureBytes.toString());
type Harness = Awaited<ReturnType<typeof start>>;
async function start(name: string) {
  if (!entry || !source || !build || !output || !bankPath)
    throw Error("exact installed source/build/output/credentials required");
  const modules: { name: string; bytes: number; sha256: string }[] = [];
  for (const n of (await readdir(build)).filter((n) => n.endsWith(".js")).sort()) {
    const b = await readFile(path.join(path.dirname(entry), n));
    expect(b.equals(await readFile(path.join(build, n))), n).toBe(true);
    modules.push({ name: n, bytes: b.length, sha256: sha(b) });
  }
  const schema = await readFile(
    path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json"),
  );
  expect(schema.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(true);
  const bankBytes = await readFile(bankPath),
    bank = JSON.parse(bankBytes.toString()) as {
      ref: string;
      principal: string;
      canMutate: boolean;
      token: string;
    }[];
  expect(bank.map(({ token: _token, ...r }) => r)).toEqual(
    fixture.campaign.credentialRoles.filter((r: { principal: unknown }) => r.principal !== null),
  );
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-cumulative-admission-" + name + "-"));
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts: fixture.artifacts,
    credentials: bank.map(({ ref: _ref, ...r }) => r),
  };
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(Error("admission cohort deadline")), 90000);
  const pendingExchanges: Promise<unknown>[] = [];
  const wires: unknown[] = [],
    controls: unknown[] = [],
    facts: Record<string, unknown> = {},
    failures: unknown[] = [];
  let run: ReturnType<typeof launchCumulativeAdmission> | undefined,
    ready: Record<string, unknown> | undefined,
    address: URL | undefined,
    terminal: unknown;
  async function launch() {
    run = launchCumulativeAdmission(entry!, configuration);
    ready = await run.ready;
    expect(ready.event).toBe("admission.ready");
    checkReady(ready);
    address = new URL(String(ready.listenUrl));
  }
  function checkReady(r: Record<string, unknown>) {
    expect(r.ordinaryDeployment).toBe(false);
    expect(r.ordinaryConfigurationMetadataAvailable).toBe(false);
    expect(r.payloadIdentity).toMatch(/^[a-f0-9]{64}$/);
    expect(r.facadeKeys).toEqual([
      "close",
      "configurationMetadata",
      "listenUrl",
      "replaceAuthorizationPolicy",
      "scope",
      "targets",
    ]);
  }
  async function control(command: string, extra: Record<string, unknown> = {}) {
    if (!run) throw Error("missing runtime");
    const v = await run.control({ command, ...extra });
    controls.push(v);
    expect(v.event).toBe("admission.done");
    expect(v.command).toBe(command);
    checkReady(v.ready as Record<string, unknown>);
    ready = v.ready as Record<string, unknown>;
    address = new URL(String(ready.listenUrl));
    return v;
  }
  async function send(
    target: string,
    method: HttpMethod = "GET",
    body?: unknown,
    key?: string,
    ref = "operator",
    minimum: Record<string, string> = {},
  ) {
    if (!address || wires.length >= 64) throw Error("admission request bound");
    const url = new URL(target, scope).href;
    if (
      new URL(url).origin !== new URL(scope).origin ||
      !new URL(url).pathname.startsWith("/acme/")
    )
      throw Error("admission request namespace");
    const credential = bank.find((r) => r.ref === ref);
    if (!credential) throw Error("unbound exact credential role");
    const raw = body === undefined ? undefined : JSON.stringify(body),
      bytes = raw === undefined ? undefined : Buffer.from(raw);
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
          defaultCredentialRef: ref,
          credentialHandles: [{ id: ref, headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${credential.token}` }),
        },
      },
    );
    const responsePromise = execute({
      method,
      url,
      signal: controller.signal,
      raw: {
        headerLines: [
          { name: "Accept", value: "application/json" },
          ...Object.entries(minimum).map(([name, value]) => ({ name, value })),
          ...(bytes
            ? [
                { name: "Content-Type", value: "application/json" },
                ...(key === undefined ? [] : [{ name: "Idempotency-Key", value: key }]),
              ]
            : []),
        ],
        ...(bytes ? { bodyBytes: bytes } : {}),
      },
    });
    pendingExchanges.push(responsePromise);
    const response = await responsePromise;
    wires.push({
      method,
      url,
      ref,
      key,
      minimum,
      rawBody: raw,
      status: response.status,
      headers: response.headers,
      bodyText: response.bodyText,
      wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
      exactBody: response.exactRequest
        ? {
            source: response.exactRequest.source,
            bodyPresent: response.exactRequest.bodyPresent,
            bodyOctets: response.exactRequest.bodyOctets,
            bodyDigest: response.exactRequest.bodyDigest,
            writeState: response.exactRequest.writeState,
          }
        : null,
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    if (method === "POST" || url.includes("/receipts/") || url.includes("/changes/")) {
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["last-modified"]).toBeUndefined();
    }
    for (const field of ["bdp-scope-epoch", "bdp-authorization-view"])
      expect(response.headers[field]).toMatch(/^.+$/);
    expect(response.headers["bdp-scope-position"]).toMatch(/^pos-[0-9]+$/);
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
    if (bytes) expect(response.exactRequest?.bodyDigest).toBe(sha(bytes));
    return {
      status: response.status,
      value: response.bodyText ? JSON.parse(response.bodyText) : undefined,
      bodyText: response.bodyText,
      headers: response.headers,
    };
  }
  async function pair(url: string, expected: unknown) {
    const get = await send(url);
    expect(get.status).toBe(200);
    expect(get.value).toEqual(expected);
    const head = await send(url, "HEAD");
    expect(head.status).toBe(200);
    expect(head.bodyText).toBe("");
    expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(get.bodyText)));
    for (const x of [get, head]) {
      expect(x.headers["cache-control"]).toBe("private, no-store");
      expect(x.headers.etag).toBeUndefined();
      expect(x.headers["last-modified"]).toBeUndefined();
    }
    return get;
  }
  function boundedCapture(value: unknown) {
    const text = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(text) > 4194304) throw Error("admission capture exceeds 4MiB");
    const agenda = [{ value, depth: 0 }];
    let count = 0;
    while (agenda.length) {
      const { value: v, depth } = agenda.pop()!;
      if (++count > 100000 || depth > 128) throw Error("admission capture nodes/depth");
      if (v && typeof v === "object")
        for (const [key, child] of Object.entries(v)) {
          if (!Array.isArray(v) && ++count > 100000) throw Error("admission capture key nodes");
          void key;
          agenda.push({ value: child, depth: depth + 1 });
        }
    }
    return text;
  }
  async function finish() {
    clearTimeout(timer);
    try {
      if (run) {
        terminal = await run.close();
        expect(terminal).toMatchObject({
          code: 0,
          signal: null,
          forced: false,
          overflow: false,
          stdoutEOF: true,
          stderrEOF: true,
          reaped: true,
        });
      }
    } catch (e) {
      failures.push(e);
    }
    await Promise.allSettled(pendingExchanges);
    let storeRemoved = false;
    try {
      await rm(directory, { recursive: true, force: true });
      storeRemoved = true;
    } catch (e) {
      failures.push(e);
    }
    try {
      await writeFile(
        path.join(output!, name + ".json"),
        boundedCapture({
          name,
          source,
          entry,
          modules,
          schemaSHA256: sha(schema),
          fixture: { id: fixture.id, bytes: fixtureBytes.length, sha256: sha(fixtureBytes) },

          credentialBank: {
            bytes: bankBytes.length,
            sha256: sha(bankBytes),
            roles: bank.map(({ token: _token, ...r }) => r),
          },
          configuration: {
            ...configuration,
            credentials: bank.map(({ token: _token, ...r }) => r),
          },
          ordinaryDeployment: false,
          runtimeConfigurationIdentity: null,
          ready,
          controls,
          facts,
          wires,
          terminal,
          storeRemoved,
          failures: failures.map((e) => inspect(e, { depth: 8 })),
          wholeProfile: false,
        }),
        { mode: 0o600 },
      );
    } catch (e) {
      failures.push(e);
    }
    if (failures.length) throw new AggregateError(failures, "admission case or cleanup failed");
  }
  return { launch, send, pair, control, finish, facts, failures };
}

const title =
  "joins genuinely held TX admission across singleton batch sequence and pending receipt";
it.runIf(Boolean(entry))(
  title,
  async () => {
    const h = await start("held-cross-carrier");
    let original: ReturnType<Harness["send"]> | undefined;
    let duplicate: ReturnType<Harness["send"]> | undefined;
    try {
      await h.launch();
      const body = {
        id: "beads/held",
        type,
        properties: { title: "held", label: "original", n: 1 },
        metadata: { witness: "native-admission" },
      };
      const key = "tx-held-shared-key";
      const member = { operation: "createBead", ...body, idempotencyKey: key, name: "original" };
      original = h.send("operations/sequence", "POST", { operations: [member] });
      // Attach a handler immediately; the stored original promise remains authoritative.
      void original.catch(() => {});
      const admitted = await h.control("await", { ordinal: 1 });
      expect(admitted.state).toEqual([{ ordinal: 1, cancelled: false, released: false }]);
      const singleton = await h.send("operations/create-bead", "POST", body, key);
      expect(singleton.status).toBe(202);
      expect(Object.keys(singleton.value).sort()).toEqual([
        "authorizationView",
        "id",
        "idempotencyKey",
        "scopeEpoch",
        "status",
        "transaction",
      ]);
      expect(singleton.value).toEqual({
        id: expect.stringMatching(/^https:\/\/reference.invalid\/acme\/receipts\/.+$/),
        status: "pending",
        idempotencyKey: key,
        scopeEpoch: expect.any(String),
        authorizationView: expect.any(String),
        transaction: expect.any(String),
      });
      for (const field of ["scopeEpoch", "authorizationView", "transaction"])
        expect(singleton.value[field].length).toBeGreaterThan(0);
      expect(singleton.headers.location).toBe(singleton.value.id);
      expect(singleton.headers["retry-after"]).toBe("1");
      expect(singleton.headers["bdp-scope-position"]).toBe("pos-0");
      const batch = await h.send(
        "operations/batch",
        "POST",
        { operations: [{ operation: "createBead", ...body }] },
        key,
      );
      expect(batch.status).toBe(202);
      expect(batch.value).toEqual(singleton.value);
      expect(batch.headers.location).toBe(singleton.value.id);
      const pending = await h.send(singleton.value.id);
      expect(pending.status).toBe(200);
      expect(pending.value).toEqual(singleton.value);
      const empty = await h.send("beads/");
      expect(empty.status).toBe(200);
      expect(empty.value.items).toEqual([]);
      for (const [route, request] of [
        ["operations/create-bead", { ...body, properties: { ...body.properties, n: 2 } }],
        [
          "operations/batch",
          {
            operations: [
              { operation: "createBead", ...body, properties: { ...body.properties, n: 2 } },
            ],
          },
        ],
      ] as const) {
        const mismatch = await h.send(route, "POST", request, key);
        expect(mismatch.status).toBe(409);
        expect(mismatch.value.code).toBe("idempotency-conflict");
        expect(mismatch.headers["bdp-scope-position"]).toBe("pos-0");
      }
      duplicate = h.send("operations/sequence", "POST", {
        operations: [{ ...member, name: "duplicate" }],
      });
      void duplicate.catch(() => {});
      await h.control("await", { ordinal: 2 });
      await h.control("release", { ordinal: 2 });
      const inProgress = await duplicate;
      expect(inProgress.status).toBe(200);
      expect(inProgress.value).toEqual({
        results: [
          {
            operationIndex: 0,
            operationName: "duplicate",
            type: "https://github.com/gastownhall/bdp/problems/conflict",
            status: 409,
            code: "idempotency-in-progress",
            retry: "after-delay",
          },
        ],
      });
      expect((await h.send(singleton.value.id)).value).toEqual(singleton.value);
      await h.control("release", { ordinal: 1 });
      const committed = await original;
      expect(committed.status).toBe(200);
      const record = {
        id: scope + "beads/held",
        type,
        revision: expect.stringMatching(/.+/),
        properties: body.properties,
        metadata: body.metadata,
      };
      expect(committed.value).toEqual({
        results: [
          { operationIndex: 0, operationName: "original", outcome: "created", resource: record },
        ],
      });
      const actualRecord = committed.value.results[0].resource;
      const terminal = await h.send(singleton.value.id);
      expect(terminal.status).toBe(200);
      expect(terminal.value).toEqual({
        ...singleton.value,
        status: "completed",
        detail: "available",
        requiredPosition: "pos-1",
        effectPosition: "pos-1",
        expiresAt: expect.any(String),
        results: [
          {
            operationIndex: 0,
            operationName: "original",
            outcome: "created",
            resource: actualRecord,
          },
        ],
        next: null,
      });
      for (const [route, request] of [
        ["operations/create-bead", body],
        ["operations/batch", { operations: [{ operation: "createBead", ...body }] }],
      ] as const) {
        const retry = await h.send(route, "POST", request, key);
        expect(retry.status).toBe(200);
        expect(retry.value).toEqual(terminal.value);
      }
      const terminalSequence = h.send("operations/sequence", "POST", {
        operations: [{ ...member, name: "terminal-retry" }],
      });
      void terminalSequence.catch(() => {});
      await h.control("await", { ordinal: 3 });
      await h.control("release", { ordinal: 3 });
      const projected = await terminalSequence;
      expect(projected.status).toBe(200);
      expect(projected.value).toEqual({
        results: [
          {
            operationIndex: 0,
            operationName: "terminal-retry",
            outcome: "created",
            resource: actualRecord,
          },
        ],
      });
      expect((await h.send(singleton.value.id)).value).toEqual(terminal.value);
      const get = await h.send("beads/held");
      expect(get.value).toEqual(actualRecord);
      expect(get.headers.etag).toBe(JSON.stringify(actualRecord.revision));
      const collection = await h.send("beads/");
      expect(collection.value.items).toEqual([actualRecord]);
      expect(collection.value.next).toBeNull();
      expect(collection.headers["bdp-scope-position"]).toBe("pos-1");
      const feed = await h.send("changes/?after=genesis");
      expect(feed.status).toBe(200);
      expect(feed.value.groups).toHaveLength(1);
      expect(feed.value.next).toBeNull();
      expect(feed.value.groups[0].position).toBe("pos-1");
      expect(feed.value.groups[0].changes).toEqual([
        { operation: "upsert", resourceKind: "bead", resource: actualRecord },
      ]);
      h.facts.feed = feed.value;
      h.facts.pending = singleton.value;
      h.facts.terminal = terminal.value;
      h.facts.record = actualRecord;
      h.facts.waitScope =
        "known-equal pending immediate return allowed; default comparison 1000ms unchanged, unresolved comparison NOT selected";
    } catch (error) {
      h.failures.push(error);
    } finally {
      await h.finish();
      await Promise.allSettled([original, duplicate].filter((p) => p !== undefined));
    }
  },
  90000,
);
