/** NEW fixed installed dependent companion; no ordinary configuration identity or whole profile award. */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { launchCumulativePendingSequence } from "../test-support/transactional-cumulative-pending-sequence-launch.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_CUMULATIVE_PENDING_SEQUENCE_ENTRY,
  source = process.env.BDP_CUMULATIVE_PENDING_SEQUENCE_SOURCE,
  build = process.env.BDP_CUMULATIVE_PENDING_SEQUENCE_BUILD,
  output = process.env.BDP_CUMULATIVE_PENDING_SEQUENCE_OUTPUT,
  bankPath = process.env.BDP_CUMULATIVE_PENDING_SEQUENCE_CREDENTIALS;
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
  const directory = await mkdtemp(
    path.join(tmpdir(), "bdp-cumulative-pending-sequence-" + name + "-"),
  );
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
  let run: ReturnType<typeof launchCumulativePendingSequence> | undefined,
    ready: Record<string, unknown> | undefined,
    address: URL | undefined,
    terminal: unknown;
  async function launch() {
    run = launchCumulativePendingSequence(entry!, configuration);
    ready = await run.ready;
    expect(ready.event).toBe("pending-sequence.ready");
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
    expect(v.event).toBe("pending-sequence.done");
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
        const closed = (await run.close()) as { pid: number };
        let pidAbsent = false;
        try {
          process.kill(closed.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          pidAbsent = true;
        }
        terminal = { ...closed, pidAbsent };
        expect(terminal).toMatchObject({
          code: 0,
          signal: null,
          forced: false,
          overflow: false,
          stdoutEOF: true,
          stderrEOF: true,
          reaped: true,
          pidAbsent: true,
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
      await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
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

const title = "NEW pending sequence precedence and key isolation";
function resource(value: any, id: string, properties: unknown) {
  expect(value.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(value).toEqual({
    id: scope + id,
    type,
    revision: value.revision,
    properties,
    metadata: {},
  });
  return value;
}
function complete(
  response: any,
  key: string,
  position: string,
  outcome: string,
  record: any,
  name?: string,
) {
  expect(response.status).toBe(200);
  expect(response.value).toEqual({
    id: expect.stringMatching(
      /^https:\/\/reference.invalid\/acme\/receipts\/[A-Za-z0-9_-]{1,256}$/,
    ),
    status: "completed",
    idempotencyKey: key,
    scopeEpoch: response.headers["bdp-scope-epoch"],
    authorizationView: response.headers["bdp-authorization-view"],
    transaction: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
    detail: "available",
    requiredPosition: position,
    effectPosition: position,
    results: [
      { operationIndex: 0, ...(name ? { operationName: name } : {}), outcome, resource: record },
    ],
    next: null,
    expiresAt: expect.any(String),
  });
  expect(Number.isFinite(Date.parse(response.value.expiresAt))).toBe(true);
  expect(response.headers["bdp-scope-position"]).toBe(position);
  return response.value;
}
async function feed(h: Harness) {
  const groups: any[] = [];
  let next: string | null = "changes/?after=genesis";
  for (let page = 0; next !== null; page++) {
    expect(page).toBeLessThan(5);
    const r = await h.send(next);
    expect(r.status).toBe(200);
    groups.push(...r.value.groups);
    next = r.value.next;
    expect(next === null || typeof next === "string").toBe(true);
  }
  return groups;
}
function committedGroup(
  g: any,
  receipt: any,
  record: any,
  index: number,
  eventType: string,
  change?: unknown,
  previous?: any,
) {
  expect(g).toMatchObject({
    position: `pos-${index}`,
    previousPosition: `pos-${index - 1}`,
    projectionAdvance: false,
    transaction: receipt.transaction,
    erasures: [],
    eventCount: 1,
  });
  expect(g.changes).toEqual([{ operation: "upsert", resourceKind: "bead", resource: record }]);
  expect(g.events).toHaveLength(1);
  expect(g.events[0]).toMatchObject({
    ordinal: 0,
    type: eventType,
    subject: record.id,
    transaction: receipt.transaction,
    source: scope + "events/",
  });
  expect(g.events[0].data).toEqual(
    eventType === "created"
      ? { revision: record.revision, properties: record.properties, metadata: {} }
      : { previousRevision: previous.revision, revision: record.revision, change },
  );
}
it.runIf(Boolean(entry))(
  title,
  async () => {
    const h = await start("pending-precedence");
    let original: ReturnType<Harness["send"]> | undefined,
      competing: ReturnType<Harness["send"]> | undefined;
    try {
      await h.launch();
      const seedBody = { id: "beads/seed", type, properties: { label: "seed", n: 0 } };
      const seeded = await h.send("operations/create-bead", "POST", seedBody, "pending-seed");
      const s0 = resource(seeded.value.results[0].resource, "beads/seed", seedBody.properties);
      const seedReceipt = complete(seeded, "pending-seed", "pos-1", "created", s0);
      const change1 = [{ op: "replace", path: "/n", value: 1 }];
      const oldBody = {
        bead: "beads/seed",
        expectedRevision: s0.revision,
        propertiesChange: change1,
      };
      const oldResponse = await h.send(
        "operations/update-bead",
        "POST",
        oldBody,
        "existing-dependent",
      );
      const s1 = resource(oldResponse.value.results[0].resource, "beads/seed", {
        label: "seed",
        n: 1,
      });
      expect(s1.revision).not.toBe(s0.revision);
      const oldReceipt = complete(oldResponse, "existing-dependent", "pos-2", "updated", s1);
      const before = await h.send("beads/");
      expect(before.value).toEqual({ items: [s1], next: null });
      const beforeGroups = await feed(h);
      expect(beforeGroups).toHaveLength(2);
      committedGroup(beforeGroups[0], seedReceipt, s0, 1, "created");
      committedGroup(beforeGroups[1], oldReceipt, s1, 2, "updated", change1, s0);
      const ownerBody = { type, properties: { label: "owner-original", n: 7 } };
      const ownerKey = "foreign-pending-creator";
      original = h.send("operations/sequence", "POST", {
        operations: [
          { operation: "createBead", ...ownerBody, name: "owner", idempotencyKey: ownerKey },
        ],
      });
      void original.catch(() => {});
      const held = await h.control("await", { ordinal: 1 });
      expect(held.state).toEqual([{ ordinal: 1, cancelled: false, released: false }]);
      const pending = await h.send("operations/create-bead", "POST", ownerBody, ownerKey);
      expect(pending.status).toBe(202);
      expect(pending.value).toEqual({
        id: expect.stringMatching(/^https:\/\/reference.invalid\/acme\/receipts\/.+$/),
        status: "pending",
        idempotencyKey: ownerKey,
        scopeEpoch: pending.headers["bdp-scope-epoch"],
        authorizationView: pending.headers["bdp-authorization-view"],
        transaction: expect.stringMatching(/.+/),
      });
      expect(pending.headers["bdp-scope-position"]).toBe("pos-2");
      const candidate = [
        {
          operation: "createBead",
          ...ownerBody,
          properties: { label: "DO-NOT-CREATE", n: 99 },
          name: "candidate",
          idempotencyKey: ownerKey,
        },
        {
          operation: "updateBead",
          bead: "@candidate",
          propertiesChange: [{ op: "replace", path: "/n", value: 999 }],
          idempotencyKey: "existing-dependent",
        },
        {
          operation: "updateBead",
          bead: "@candidate",
          propertiesChange: [{ op: "replace", path: "/n", value: 123 }],
          idempotencyKey: "fresh-dependent",
        },
      ];
      competing = h.send("operations/sequence", "POST", { operations: candidate });
      void competing.catch(() => {});
      for (const ordinal of [2, 3, 4]) {
        await h.control("await", { ordinal });
        await h.control("release", { ordinal });
      }
      const projected = await competing;
      expect(projected.status).toBe(200);
      expect(projected.value).toEqual({
        results: candidate.map((_, operationIndex) => ({
          type: "https://github.com/gastownhall/bdp/problems/conflict",
          code: "idempotency-in-progress",
          status: 409,
          retry: "after-delay",
          operationIndex,
          ...(operationIndex === 0 ? { operationName: "candidate" } : {}),
        })),
      });
      expect(projected.headers["bdp-scope-position"]).toBe("pos-2");
      const ownerStillPending = await h.send(pending.value.id);
      expect(ownerStillPending.status).toBe(200);
      expect(ownerStillPending.value).toEqual(pending.value);
      const oldStillTerminal = await h.send(oldReceipt.id);
      expect(oldStillTerminal.status).toBe(200);
      expect(oldStillTerminal.value).toEqual(oldReceipt);
      expect((await h.send("beads/")).value).toEqual(before.value);
      expect(await feed(h)).toEqual(beforeGroups);
      const change2 = [{ op: "replace", path: "/n", value: 2 }];
      const freshBody = {
        bead: "beads/seed",
        expectedRevision: s1.revision,
        propertiesChange: change2,
      };
      const fresh = await h.send("operations/update-bead", "POST", freshBody, "fresh-dependent");
      const s2 = resource(fresh.value.results[0].resource, "beads/seed", { label: "seed", n: 2 });
      expect(s2.revision).not.toBe(s1.revision);
      const freshReceipt = complete(fresh, "fresh-dependent", "pos-3", "updated", s2);
      expect(freshReceipt.id).not.toBe(oldReceipt.id);
      await h.control("release", { ordinal: 1 });
      const ownerDone = await original;
      expect(ownerDone.status).toBe(200);
      expect(ownerDone.value.results).toHaveLength(1);
      const ownerRecord = ownerDone.value.results[0].resource;
      expect(ownerRecord.id).toMatch(
        /^https:\/\/reference.invalid\/acme\/beads\/[A-Za-z0-9_-]{1,256}$/,
      );
      expect(ownerRecord.id).not.toBe(s2.id);
      resource(ownerRecord, ownerRecord.id.slice(scope.length), ownerBody.properties);
      expect(ownerDone.value).toEqual({
        results: [
          { operationIndex: 0, operationName: "owner", outcome: "created", resource: ownerRecord },
        ],
      });
      const ownerObserved = await h.send(pending.value.id);
      const terminal = complete(ownerObserved, ownerKey, "pos-4", "created", ownerRecord, "owner");
      for (const k of ["id", "transaction", "idempotencyKey", "scopeEpoch", "authorizationView"])
        expect(terminal[k]).toBe(pending.value[k]);
      expect(
        (await h.send("operations/update-bead", "POST", oldBody, "existing-dependent")).value,
      ).toEqual(oldReceipt);
      expect(
        (await h.send("operations/update-bead", "POST", freshBody, "fresh-dependent")).value,
      ).toEqual(freshReceipt);
      const after = await h.send("beads/");
      expect(after.value).toEqual({
        items: [s2, ownerRecord].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        next: null,
      });
      const finalGroups = await feed(h);
      expect(finalGroups).toHaveLength(4);
      expect(finalGroups.slice(0, 2)).toEqual(beforeGroups);
      committedGroup(finalGroups[2], freshReceipt, s2, 3, "updated", change2, s1);
      committedGroup(finalGroups[3], terminal, ownerRecord, 4, "created");
      h.facts.pendingPrecedence = {
        candidate,
        projected: projected.value,
        held,
        pending: pending.value,
        ownerStillPending: ownerStillPending.value,
        oldReceipt,
        oldStillTerminal: oldStillTerminal.value,
        freshReceipt,
        terminal,
        before: before.value,
        after: after.value,
        beforeGroups,
        finalGroups,
        ownerRecord,
      };
    } catch (error) {
      h.failures.push(error);
    } finally {
      await h.finish();
    }
  },
  90000,
);
