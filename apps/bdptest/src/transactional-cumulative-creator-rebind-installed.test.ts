/** NEW fixed installed dependent companion; no ordinary configuration identity or whole profile award. */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { launchCumulativeCreatorRebind } from "../test-support/transactional-cumulative-creator-rebind-launch.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_CUMULATIVE_CREATOR_REBIND_ENTRY,
  source = process.env.BDP_CUMULATIVE_CREATOR_REBIND_SOURCE,
  build = process.env.BDP_CUMULATIVE_CREATOR_REBIND_BUILD,
  output = process.env.BDP_CUMULATIVE_CREATOR_REBIND_OUTPUT,
  bankPath = process.env.BDP_CUMULATIVE_CREATOR_REBIND_CREDENTIALS;
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
    path.join(tmpdir(), "bdp-cumulative-creator-rebind-" + name + "-"),
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
  let run: ReturnType<typeof launchCumulativeCreatorRebind> | undefined,
    ready: Record<string, unknown> | undefined,
    address: URL | undefined,
    terminal: unknown;
  async function launch() {
    run = launchCumulativeCreatorRebind(entry!, configuration);
    ready = await run.ready;
    expect(ready.event).toBe("creator-rebind.ready");
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
    expect(v.event).toBe("creator-rebind.done");
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

const title = "NEW failed creator forgetting and retained dependent rebinding";
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
const failedType = scope + "types/not-installed";
const problem = (code: string, status: number, family: string, retry: string) => ({
  type: "https://github.com/gastownhall/bdp/problems/" + family,
  status,
  code,
  retry,
});
const unavailable = problem("binding-unavailable", 400, "request", "never");
const missingType = problem("type-not-installed", 422, "validation", "after-state-change");
const conflict = problem("idempotency-conflict", 409, "conflict", "never");
function failed(response: any, key: string, expectedProblem: unknown, expires: number) {
  expect(response.status).toBe(200);
  expect(response.value).toEqual({
    id: expect.stringMatching(
      /^https:\/\/reference.invalid\/acme\/receipts\/[A-Za-z0-9_-]{1,256}$/,
    ),
    status: "failed",
    idempotencyKey: key,
    scopeEpoch: response.headers["bdp-scope-epoch"],
    authorizationView: response.headers["bdp-authorization-view"],
    transaction: expect.stringMatching(/^[A-Za-z0-9_-]{1,256}$/),
    detail: "available",
    requiredPosition: "pos-0",
    problem: { ...(expectedProblem as object), operationIndex: 0 },
    expiresAt: new Date(expires).toISOString(),
  });
  expect(response.headers["bdp-scope-position"]).toBe("pos-0");
  return response.value;
}
it.runIf(Boolean(entry))(
  title,
  async () => {
    const h = await start("failed-creator-rebind");
    try {
      await h.launch();
      // Valid request grammar; real terminal native Type failure, not parser refusal.
      const bad = { type: failedType, properties: { label: "must-not-exist" } };
      const first = await h.send("operations/create-bead", "POST", bad, "reused-creator");
      const firstReceipt = failed(first, "reused-creator", missingType, 87400000);
      h.facts.firstFailedCreator = firstReceipt;
      await h.control("advance", { now: 1300000 });
      const dependent = {
        operation: "updateBead",
        bead: "@before",
        propertiesChange: [{ op: "add", path: "/n", value: 9 }],
        idempotencyKey: "retained-dependent",
      };
      const originalMembers = [
        { operation: "createBead", ...bad, idempotencyKey: "reused-creator", name: "before" },
        dependent,
      ];
      const original = await h.send("operations/sequence", "POST", { operations: originalMembers });
      expect(original.status).toBe(200);
      const originalProjection = {
        results: [
          { ...missingType, operationIndex: 0, operationName: "before" },
          { ...unavailable, operationIndex: 1 },
        ],
      };
      expect(original.value).toEqual(originalProjection);
      expect(original.headers["bdp-scope-position"]).toBe("pos-0");
      // Replaying the creator did not renew its original terminal retention.
      expect((await h.send(firstReceipt.id)).value).toEqual(firstReceipt);
      expect((await h.send("beads/")).value).toEqual({ items: [], next: null });
      expect(await feed(h)).toEqual([]);
      h.facts.initialDependentProjection = original.value;
      await h.control("advance", { now: 87400001 });
      const forgotten = await h.send(firstReceipt.id);
      expect(forgotten.status).toBe(404);
      expect(forgotten.value).toEqual(
        problem("resource-not-found", 404, "not-found", "after-state-change"),
      );
      // This is after creator expiry but 299999ms before dependent expiry.
      h.facts.retention = {
        creatorExpiresAt: 87400000,
        dependentTerminalAt: 1300000,
        unchangedRetentionMs: 86400000,
        dependentExpiresAt: 87700000,
        presentationAt: 87400001,
      };
      const goodBody = { type, properties: { label: "new-creator", n: 1 } };
      const replacementMembers = [
        { operation: "createBead", ...goodBody, idempotencyKey: "reused-creator", name: "after" },
        { ...dependent, bead: "@after" },
      ];
      const replaced = await h.send("operations/sequence", "POST", {
        operations: replacementMembers,
      });
      expect(replaced.status).toBe(200);
      const created = replaced.value.results[0].resource;
      expect(created.id).toMatch(
        /^https:\/\/reference.invalid\/acme\/beads\/[A-Za-z0-9_-]{1,256}$/,
      );
      resource(created, created.id.slice(scope.length), goodBody.properties);
      expect(replaced.value).toEqual({
        results: [
          { operationIndex: 0, operationName: "after", outcome: "created", resource: created },
          { ...conflict, operationIndex: 1 },
        ],
      });
      expect(replaced.headers["bdp-scope-position"]).toBe("pos-1");
      const creatorReplay = await h.send(
        "operations/create-bead",
        "POST",
        goodBody,
        "reused-creator",
      );
      const newReceipt = complete(
        creatorReplay,
        "reused-creator",
        "pos-1",
        "created",
        created,
        "after",
      );
      expect(newReceipt.id).not.toBe(firstReceipt.id);
      expect(newReceipt.transaction).not.toBe(firstReceipt.transaction);
      expect(newReceipt.expiresAt).toBe(new Date(173800001).toISOString());
      expect((await h.send(newReceipt.id)).value).toEqual(newReceipt);
      const direct = await h.send(
        "operations/update-bead",
        "POST",
        { bead: created.id, propertiesChange: dependent.propertiesChange },
        "retained-dependent",
      );
      expect(direct.status).toBe(409);
      expect(direct.value).toEqual(conflict);
      const anotherFailure = await h.send("operations/sequence", "POST", {
        operations: [
          {
            operation: "createBead",
            ...bad,
            idempotencyKey: "another-failed-creator",
            name: "still-unbound",
          },
          { ...dependent, bead: "@still-unbound" },
        ],
      });
      expect(anotherFailure.status).toBe(200);
      expect(anotherFailure.value).toEqual({
        results: [
          { ...missingType, operationIndex: 0, operationName: "still-unbound" },
          { ...unavailable, operationIndex: 1 },
        ],
      });
      // Exact repeated new-creator presentation also cannot execute or rebind the dependent.
      const retry = await h.send("operations/sequence", "POST", { operations: replacementMembers });
      expect(retry.status).toBe(200);
      expect(retry.value).toEqual(replaced.value);
      expect((await h.send(created.id)).value).toEqual(created);
      expect((await h.send("beads/")).value).toEqual({ items: [created], next: null });
      const groups = await feed(h);
      expect(groups).toHaveLength(1);
      committedGroup(groups[0], newReceipt, created, 1, "created");
      expect((await h.send(firstReceipt.id)).status).toBe(404);
      expect((await h.send(newReceipt.id)).value).toEqual(newReceipt);
      h.facts.final = {
        created,
        newReceipt,
        oldCreatorUrl: firstReceipt.id,
        originalProjection,
        replacementProjection: replaced.value,
        anotherFailure: anotherFailure.value,
        groups,
      };
    } catch (error) {
      h.failures.push(error);
    } finally {
      await h.finish();
    }
  },
  90000,
);
