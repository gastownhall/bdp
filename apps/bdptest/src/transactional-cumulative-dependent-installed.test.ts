/** NEW fixed installed dependent companion; no ordinary configuration identity or whole profile award. */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { launchCumulativeDependent } from "../test-support/transactional-cumulative-dependent-launch.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_CUMULATIVE_DEPENDENT_ENTRY,
  source = process.env.BDP_CUMULATIVE_DEPENDENT_SOURCE,
  build = process.env.BDP_CUMULATIVE_DEPENDENT_BUILD,
  output = process.env.BDP_CUMULATIVE_DEPENDENT_OUTPUT,
  bankPath = process.env.BDP_CUMULATIVE_DEPENDENT_CREDENTIALS;
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
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-cumulative-dependent-" + name + "-"));
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts: fixture.artifacts,
    credentials: bank.map(({ ref: _ref, ...r }) => r),
  };
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(Error("dependent cohort deadline")), 90000);
  const pendingExchanges: Promise<unknown>[] = [];
  const wires: unknown[] = [],
    controls: unknown[] = [],
    facts: Record<string, unknown> = {},
    failures: unknown[] = [];
  let run: ReturnType<typeof launchCumulativeDependent> | undefined,
    ready: Record<string, unknown> | undefined,
    address: URL | undefined,
    terminal: unknown;
  async function launch() {
    run = launchCumulativeDependent(entry!, configuration);
    ready = await run.ready;
    expect(ready.event).toBe("dependent.ready");
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
    expect(v.event).toBe("dependent.done");
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
    if (!address || wires.length >= 64) throw Error("dependent request bound");
    const url = new URL(target, scope).href;
    if (
      new URL(url).origin !== new URL(scope).origin ||
      !new URL(url).pathname.startsWith("/acme/")
    )
      throw Error("dependent request namespace");
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
    const started = performance.now();
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
      elapsedMs: performance.now() - started,
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
      elapsedMs: performance.now() - started,
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
    if (Buffer.byteLength(text) > 4194304) throw Error("dependent capture exceeds 4MiB");
    const agenda = [{ value, depth: 0 }];
    let count = 0;
    while (agenda.length) {
      const { value: v, depth } = agenda.pop()!;
      if (++count > 100000 || depth > 128) throw Error("dependent capture nodes/depth");
      if (v && typeof v === "object")
        for (const [key, child] of Object.entries(v)) {
          if (!Array.isArray(v) && ++count > 100000) throw Error("dependent capture key nodes");
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
    const settled = await Promise.allSettled(pendingExchanges);
    facts.exchangeSettlements = settled.map((s) =>
      s.status === "fulfilled"
        ? { status: s.status }
        : { status: s.status, reason: inspect(s.reason, { depth: 8 }) },
    );
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
    if (failures.length) throw new AggregateError(failures, "dependent case or cleanup failed");
  }
  return { launch, send, pair, control, finish, facts, failures };
}

const title =
  "waits at the native comparison deadline then resolves allocated creator dependent identities";
it.runIf(Boolean(entry))(
  title,
  async () => {
    const h = await start("allocated-dependents");
    let sequence: ReturnType<Harness["send"]> | undefined;
    try {
      await h.launch();
      const create = {
        type,
        properties: { title: "allocated", label: "pinned-creator", n: 1 },
        metadata: { witness: "native-dependency" },
      };
      const change = (bead: string, n: number) => ({
        bead,
        propertiesChange: [{ op: "replace", path: "/n", value: n }],
      });
      const members = [
        { operation: "createBead", name: "made", idempotencyKey: "dependent-creator", ...create },
        {
          operation: "updateBead",
          idempotencyKey: "dependent-first",
          ...change("@made", 2),
        },
        {
          operation: "updateBead",
          idempotencyKey: "dependent-second",
          ...change("@made", 3),
        },
      ];
      sequence = h.send("operations/sequence", "POST", { operations: members });
      void sequence.catch(() => {});
      const admitted = await h.control("await", { ordinal: 1 });
      expect(admitted.state).toEqual([{ ordinal: 1, cancelled: false, released: false }]);
      const creator = await h.send("operations/create-bead", "POST", create, "dependent-creator");
      function pending(r: Awaited<ReturnType<Harness["send"]>>, key: string, position: string) {
        expect(r.status).toBe(202);
        expect(r.value).toEqual({
          id: expect.stringMatching(/^https:\/\/reference.invalid\/acme\/receipts\/.+$/),
          status: "pending",
          idempotencyKey: key,
          scopeEpoch: r.headers["bdp-scope-epoch"],
          authorizationView: r.headers["bdp-authorization-view"],
          transaction: expect.stringMatching(/.+/),
        });
        expect(r.headers.location).toBe(r.value.id);
        expect(r.headers["retry-after"]).toBe("1");
        expect(r.headers["bdp-scope-position"]).toBe(position);
        return r.value;
      }
      const pendingCreator = pending(creator, "dependent-creator", "pos-0");
      const empty = await h.send("beads/");
      expect(empty.value.items).toEqual([]);
      expect(empty.value.next).toBeNull();
      const placeholder = "beads/unresolved-literal";
      const conflict = await h.send(
        "operations/update-bead",
        "POST",
        change(placeholder, 99),
        "dependent-first",
      );
      expect(conflict.status).toBe(409);
      expect(conflict.value).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "idempotency-conflict",
        status: 409,
        retry: "never",
      });
      const unresolved = await Promise.all([
        h.send("operations/update-bead", "POST", change(placeholder, 2), "dependent-first"),
        h.send(
          "operations/batch",
          "POST",
          { operations: [{ operation: "updateBead", ...change(placeholder, 3) }] },
          "dependent-second",
        ),
      ]);
      for (const r of unresolved) {
        expect(r.status).toBe(503);
        expect(r.value).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/unavailable",
          code: "temporarily-unavailable",
          status: 503,
          retry: "after-delay",
        });
        expect(r.headers.location).toBeUndefined();
        expect(r.headers["bdp-scope-position"]).toBe("pos-0");
        expect(r.headers["bdp-scope-epoch"]).toBe(pendingCreator.scopeEpoch);
        expect(r.headers["bdp-authorization-view"]).toBe(pendingCreator.authorizationView);
        expect(r.elapsedMs).toBeGreaterThanOrEqual(1000);
      }
      expect((await h.control("await", { ordinal: 1 })).state).toEqual(admitted.state);
      expect((await h.send(pendingCreator.id)).value).toEqual(pendingCreator);
      expect((await h.send("beads/")).value.items).toEqual([]);
      // No comparison timeout released, executed, or retracted the owning attempt.
      await h.control("release", { ordinal: 1 });
      await h.control("await", { ordinal: 2 });
      const allocated = await h.send("beads/");
      expect(allocated.value.items).toHaveLength(1);
      expect(allocated.value.next).toBeNull();
      const r0 = allocated.value.items[0];
      expect(r0).toEqual({
        id: expect.stringMatching(/^https:\/\/reference.invalid\/acme\/beads\/[^/?#]+$/),
        type,
        revision: expect.stringMatching(/.+/),
        properties: create.properties,
        metadata: create.metadata,
      });
      expect(r0.id).not.toBe(scope + placeholder);
      const nowConflict = await h.send(
        "operations/update-bead",
        "POST",
        change(placeholder, 2),
        "dependent-first",
      );
      expect(nowConflict.status).toBe(409);
      expect(nowConflict.value).toEqual(conflict.value);
      const first = await h.send(
        "operations/update-bead",
        "POST",
        change(r0.id, 2),
        "dependent-first",
      );
      const second = await h.send(
        "operations/batch",
        "POST",
        { operations: [{ operation: "updateBead", ...change(r0.id, 3) }] },
        "dependent-second",
      );
      const pendingFirst = pending(first, "dependent-first", "pos-1"),
        pendingSecond = pending(second, "dependent-second", "pos-1");
      expect(new Set([pendingCreator.id, pendingFirst.id, pendingSecond.id]).size).toBe(3);
      expect(
        new Set([pendingCreator.transaction, pendingFirst.transaction, pendingSecond.transaction])
          .size,
      ).toBe(3);
      await h.control("release", { ordinal: 2 });
      await h.control("await", { ordinal: 3 });
      const middle = await h.send(r0.id);
      const r1 = middle.value;
      expect(r1).toEqual({
        ...r0,
        revision: expect.stringMatching(/.+/),
        properties: { ...create.properties, n: 2 },
      });
      expect(r1.revision).not.toBe(r0.revision);
      expect((await h.send(pendingSecond.id)).value).toEqual(pendingSecond);
      await h.control("release", { ordinal: 3 });
      const done = await sequence;
      expect(done.status).toBe(200);
      const final = await h.send(r0.id);
      const r2 = final.value;
      expect(r2).toEqual({
        ...r0,
        revision: expect.stringMatching(/.+/),
        properties: { ...create.properties, n: 3 },
      });
      expect(new Set([r0.revision, r1.revision, r2.revision]).size).toBe(3);
      const records = [r0, r1, r2];
      const outcomes = ["created", "updated", "updated"];
      expect(done.value).toEqual({
        results: records.map((resource, i) => ({
          operationIndex: i,
          ...(i === 0 ? { operationName: "made" } : {}),
          outcome: outcomes[i],
          resource,
        })),
      });
      const receipts: unknown[] = [];
      for (const [i, prior] of [pendingCreator, pendingFirst, pendingSecond].entries()) {
        const terminal = await h.send(prior.id);
        expect(terminal.status).toBe(200);
        expect(terminal.value).toEqual({
          ...prior,
          status: "completed",
          detail: "available",
          requiredPosition: `pos-${i + 1}`,
          effectPosition: `pos-${i + 1}`,
          expiresAt: expect.any(String),
          results: [
            {
              operationIndex: 0,
              ...(i === 0 ? { operationName: "made" } : {}),
              outcome: outcomes[i],
              resource: records[i],
            },
          ],
          next: null,
        });
        receipts.push(terminal.value);
      }
      const retry = await h.send(
        "operations/update-bead",
        "POST",
        change(r0.id, 2),
        "dependent-first",
      );
      expect(retry.status).toBe(200);
      expect(retry.value).toEqual(receipts[1]);
      const retryBatch = await h.send(
        "operations/batch",
        "POST",
        { operations: [{ operation: "updateBead", ...change(r0.id, 3) }] },
        "dependent-second",
      );
      expect(retryBatch.status).toBe(200);
      expect(retryBatch.value).toEqual(receipts[2]);
      const all = await h.send("beads/");
      expect(all.value.items).toEqual([r2]);
      expect(all.value.next).toBeNull();
      const feedPages: unknown[] = [],
        groups: { position: string; changes: unknown; transaction: string }[] = [];
      let next: string | null = "changes/?after=genesis";
      for (let page = 0; next !== null; page++) {
        expect(page).toBeLessThan(4);
        const response = await h.send(next);
        expect(response.status).toBe(200);
        feedPages.push(response.value);
        groups.push(...response.value.groups);
        next = response.value.next;
        expect(next === null || typeof next === "string").toBe(true);
      }
      expect(groups.map((g) => g.position)).toEqual(["pos-1", "pos-2", "pos-3"]);
      expect(groups.map((g) => g.changes)).toEqual(
        records.map((resource) => [{ operation: "upsert", resourceKind: "bead", resource }]),
      );
      expect(groups.map((g) => g.transaction)).toEqual([
        pendingCreator.transaction,
        pendingFirst.transaction,
        pendingSecond.transaction,
      ]);
      h.facts.unresolvedElapsedMs = unresolved.map((r) => r.elapsedMs);
      h.facts.pending = [pendingCreator, pendingFirst, pendingSecond];
      h.facts.records = records;
      h.facts.receipts = receipts;
      h.facts.feedPages = feedPages;
    } catch (error) {
      h.failures.push(error);
    } finally {
      await h.finish();
      if (sequence) await Promise.allSettled([sequence]);
    }
  },
  90000,
);
