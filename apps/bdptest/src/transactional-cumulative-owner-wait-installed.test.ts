/** NEW fixed installed dependent companion; no ordinary configuration identity or whole profile award. */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { launchOwnerWaitBoundary } from "../test-support/transactional-cumulative-owner-wait-launch.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_OWNER_WAIT_ENTRY,
  source = process.env.BDP_OWNER_WAIT_SOURCE,
  build = process.env.BDP_OWNER_WAIT_BUILD,
  output = process.env.BDP_OWNER_WAIT_OUTPUT,
  bankPath = process.env.BDP_OWNER_WAIT_CREDENTIALS;
const scope = "https://reference.invalid/acme/",
  type = scope + "types/task";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const fixtureBytes = await readFile(
    new URL("../test-support/transactional-cumulative-product-fixture.json", import.meta.url),
  ),
  fixture = JSON.parse(fixtureBytes.toString());
function assertOwnerWaitModuleInventory(
  buildNames: readonly string[],
  installedNames: readonly string[],
) {
  expect(
    [...installedNames].sort(),
    "complete installed/build JavaScript module inventory",
  ).toEqual([...buildNames].sort());
}
it("NEW owner-wait module inventory rejects extra or missing installed modules", () => {
  expect(() => assertOwnerWaitModuleInventory(["a.js", "b.js"], ["b.js", "a.js"])).not.toThrow();
  expect(() => assertOwnerWaitModuleInventory(["a.js"], ["a.js", "extra.js"])).toThrow();
  expect(() => assertOwnerWaitModuleInventory(["a.js", "missing.js"], ["a.js"])).toThrow();
});
type Harness = Awaited<ReturnType<typeof start>>;
async function start(name: string, mode: "deadline" | "retract") {
  if (!entry || !source || !build || !output || !bankPath)
    throw Error("exact installed source/build/output/credentials required");
  const modules: { name: string; bytes: number; sha256: string }[] = [];
  const buildNames = (await readdir(build)).filter((n) => n.endsWith(".js")).sort();
  const installedNames = (await readdir(path.dirname(entry)))
    .filter((n) => n.endsWith(".js"))
    .sort();
  assertOwnerWaitModuleInventory(buildNames, installedNames);
  for (const n of buildNames) {
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
  let run: ReturnType<typeof launchOwnerWaitBoundary> | undefined,
    ready: Record<string, unknown> | undefined,
    address: URL | undefined,
    terminal: unknown;
  async function launch() {
    run = launchOwnerWaitBoundary(entry!, configuration, mode);
    ready = await run.ready;
    expect(ready.event).toBe("owner-wait.ready");
    checkReady(ready);
    address = new URL(String(ready.listenUrl));
  }
  function checkReady(r: Record<string, unknown>) {
    expect(r.ordinaryDeployment).toBe(false);
    expect(r.ordinaryConfigurationMetadataAvailable).toBe(false);
    expect(r.payloadIdentity).toBe(
      "55eecd3507f4e942ae8a09da72fc1c97afe6659d278461977e51a03932dd8857",
    );
    expect(r.runtimeConfigurationIdentity).toBeNull();
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
    expect(v.event).toBe("owner-wait.done");
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
    if (response.status !== 500)
      for (const field of ["bdp-scope-epoch", "bdp-authorization-view"])
        expect(response.headers[field]).toMatch(/^.+$/);
    if (response.status !== 500)
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
    if (Buffer.byteLength(text) > 1048576) throw Error("owner-wait capture exceeds 1MiB");
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
        const pid = (terminal as { pid: number }).pid;
        let pidAbsent = false;
        try {
          process.kill(pid, 0);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
          pidAbsent = true;
        }
        expect(pidAbsent).toBe(true);
        terminal = { ...(terminal as object), pidAbsent };
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
          actualCompiledSource: source,
          testBase: "4f2584b574af418dbd6938825245b7563e6d61fb",
          mode,
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
const relation = scope + "types/relationship";
const sequenceBody = {
  operations: [
    {
      operation: "createBead",
      type,
      id: "beads/independent",
      properties: { title: "independent" },
      idempotencyKey: "ow-prefix",
    },
    {
      operation: "createBead",
      type,
      name: "creator",
      properties: { title: "creator" },
      idempotencyKey: "ow-creator",
    },
    {
      operation: "createLink",
      type: relation,
      source: "@creator",
      target: "@creator",
      properties: { title: "dependent" },
      idempotencyKey: "ow-dependent",
    },
  ],
};
const directBody = {
  type: relation,
  source: scope + "beads/seed",
  target: scope + "beads/seed",
  properties: { title: "dependent" },
};
function complete(r: any, key: string) {
  expect(r.status).toBe(200);
  expect(r.value).toMatchObject({
    status: "completed",
    detail: "available",
    idempotencyKey: key,
    next: null,
    results: [{ operationIndex: 0 }],
  });
  expect(r.value.results).toHaveLength(1);
  return r.value;
}
function pending(r: any) {
  expect(r.status).toBe(202);
  expect(r.value).toEqual({
    id: expect.stringMatching(/\/receipts\/.+$/),
    status: "pending",
    idempotencyKey: "ow-creator",
    scopeEpoch: r.headers["bdp-scope-epoch"],
    authorizationView: r.headers["bdp-authorization-view"],
    transaction: expect.any(String),
  });
  expect(r.headers.location).toBe(r.value.id);
  return r.value;
}
async function observedGroup(h: Harness, count: number) {
  const groups: any[] = [],
    pages: unknown[] = [];
  let next: string | null = "changes/?after=genesis";
  for (let page = 0; next !== null; page++) {
    expect(page).toBeLessThan(4);
    const feed = await h.send(next);
    expect(feed.status).toBe(200);
    pages.push(feed.value);
    groups.push(...feed.value.groups);
    next = feed.value.next;
    expect(next === null || typeof next === "string").toBe(true);
  }
  expect(groups).toHaveLength(count);
  return { groups, pages };
}
for (const mode of ["deadline", "retract"] as const)
  it.runIf(Boolean(entry))(
    `NEW owner-wait ${mode} uses real unresolved comparison and original native reservation transitions`,
    async () => {
      const h = await start("owner-wait-" + mode, mode);
      let carrier: ReturnType<Harness["send"]> | undefined;
      let direct: ReturnType<Harness["send"]> | undefined;
      try {
        await h.launch();
        const seed = complete(
          await h.send(
            "operations/create-bead",
            "POST",
            { type, id: "beads/seed", properties: { title: "seed" } },
            "ow-seed",
          ),
          "ow-seed",
        );
        h.facts.seed = seed;
        carrier = h.send("operations/sequence", "POST", sequenceBody);
        void carrier.catch(() => {});
        const held = await h.control("held");
        expect((held.state as any).turns).toEqual([
          { ordinal: 1, released: false, cancelled: false },
        ]);
        const old = pending(
          await h.send(
            "operations/create-bead",
            "POST",
            { type, properties: { title: "creator" } },
            "ow-creator",
          ),
        );
        h.facts.originalPending = old;
        const mismatch = await h.send(
          "operations/create-link",
          "POST",
          { ...directBody, properties: { title: "different" } },
          "ow-dependent",
        );
        expect(mismatch.status).toBe(409);
        expect(mismatch.value).toMatchObject({ code: "idempotency-conflict" });
        // Arm completes before this direct request exists. Its first now() sample is
        // compareAndAdmitTransaction's original deadline start, not a mid-budget tick.
        await h.control("arm");
        let settled = false;
        direct = h.send("operations/create-link", "POST", directBody, "ow-dependent");
        void direct.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        const waiting = await h.control("waiting");
        expect(settled).toBe(false);
        expect((waiting.state as any).ticks.length).toBeGreaterThanOrEqual(3);
        expect((waiting.state as any).turns[0].released).toBe(false);
        h.facts.waiting = waiting.state;
        if (mode === "deadline") {
          const refused = await direct;
          expect(refused.status).toBe(503);
          expect(refused.value).toMatchObject({
            code: "temporarily-unavailable",
            retry: "after-delay",
          });
          expect(refused.value).not.toHaveProperty("transaction");
          expect(refused.value).not.toHaveProperty("idempotencyKey");
          const at = await h.control("state");
          const ticks = (at.state as any).ticks as number[];
          expect(ticks.at(-1)! - ticks[0]!).toBeGreaterThanOrEqual(1000);
          expect((at.state as any).faultFired).toBe(false);
          h.facts.deadline = at.state;
          const stillPending = await h.send(old.id);
          expect(stillPending.status).toBe(200);
          expect(stillPending.value).toEqual(old);
          expect((await h.send("beads/?limit=32")).value.items).toHaveLength(1);
          await h.control("release");
          const finished = await carrier;
          expect(finished.status).toBe(200);
          expect(finished.value.results.map((r: any) => r.outcome)).toEqual([
            "created",
            "created",
            "created",
          ]);
          h.facts.sequence = finished.value;
          const resolved = await h.send(
            "operations/create-link",
            "POST",
            directBody,
            "ow-dependent",
          );
          expect(resolved.status).toBe(409);
          expect(resolved.value).toMatchObject({ code: "idempotency-conflict" });
          h.facts.feed = await observedGroup(h, 4);
        } else {
          await h.control("release");
          const failed = await carrier;
          expect(failed.status).toBe(500);
          expect(failed.bodyText).toBe("");
          const won = complete(await direct, "ow-dependent");
          h.facts.freshDirectReceipt = won;
          expect((await h.send(old.id)).status).toBe(404);
          const state = await h.control("state");
          expect((state.state as any).faultFired).toBe(true);
          const ticks = (state.state as any).ticks as number[];
          expect(ticks.at(-1)! - ticks[0]!).toBeLessThan(1000);
          h.facts.retraction = state.state;
          const retry = complete(
            await h.send("operations/create-link", "POST", directBody, "ow-dependent"),
            "ow-dependent",
          );
          expect(retry).toEqual(won);
          expect((await h.send(won.id)).value).toEqual(won);
          const resource = won.results[0].resource;
          expect(resource).toEqual({
            revision: expect.any(String),
            id: expect.stringMatching(/\/links\/.+$/),
            type: relation,
            source: scope + "beads/seed",
            target: scope + "beads/seed",
            properties: { title: "dependent" },
            metadata: {},
          });
          expect((await h.send(resource.id)).value).toEqual(resource);
          const fresh = complete(
            await h.send(
              "operations/create-bead",
              "POST",
              { type, properties: { title: "creator" } },
              "ow-creator",
            ),
            "ow-creator",
          );
          expect(fresh.id).not.toBe(old.id);
          expect(fresh.transaction).not.toBe(old.transaction);
          h.facts.newCreator = fresh;
          expect((await h.send("beads/?limit=32")).value.items).toHaveLength(3);
          expect((await h.send("links/?limit=32")).value.items).toEqual([resource]);
          const prefix = complete(
            await h.send(
              "operations/create-bead",
              "POST",
              { type, id: "beads/independent", properties: { title: "independent" } },
              "ow-prefix",
            ),
            "ow-prefix",
          );
          h.facts.prefixRetained = prefix;
          h.facts.feed = await observedGroup(h, 4);
          expect((h.facts.feed as any).groups.map((g: any) => g.position)).toEqual([
            "pos-1",
            "pos-2",
            "pos-3",
            "pos-4",
          ]);
        }
      } catch (e) {
        h.failures.push(e);
      } finally {
        await h.finish();
      }
    },
    90000,
  );
