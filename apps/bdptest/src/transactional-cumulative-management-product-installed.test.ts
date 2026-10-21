/** NEW fixed installed management companion; no ordinary configuration identity or whole profile award. */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { launchCumulativeManagement } from "../test-support/transactional-cumulative-management-product-launch.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_CUMULATIVE_MANAGEMENT_ENTRY,
  source = process.env.BDP_CUMULATIVE_MANAGEMENT_SOURCE,
  build = process.env.BDP_CUMULATIVE_MANAGEMENT_BUILD,
  output = process.env.BDP_CUMULATIVE_MANAGEMENT_OUTPUT,
  bankPath = process.env.BDP_CUMULATIVE_MANAGEMENT_CREDENTIALS;
const scope = "https://reference.invalid/acme/",
  type = scope + "types/task",
  linkType = scope + "types/wild";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const fixtureBytes = await readFile(
    new URL(
      "../test-support/transactional-cumulative-management-product-fixture.json",
      import.meta.url,
    ),
  ),
  fixture = JSON.parse(fixtureBytes.toString());
const selectionBytes = await readFile(
    new URL(
      "../test-support/transactional-cumulative-management-product-selection.json",
      import.meta.url,
    ),
  ),
  selection = JSON.parse(selectionBytes.toString());
if (selectionBytes.length > 1048576) throw Error("management selection manifest bytes");
const pending = [{ v: selection, d: 0 }];
let nodes = 0;
while (pending.length) {
  const { v, d } = pending.pop()!;
  if (++nodes > 100000 || d > 128) throw Error("management selection bound");
  if (v && typeof v === "object")
    for (const [_k, x] of Object.entries(v)) {
      if (!Array.isArray(v) && ++nodes > 100000) throw Error("manifest key nodes");
      pending.push({ v: x, d: d + 1 });
    }
}
expect(selection.activeCount).toBe(251);
expect(selection.sourceTouchedCount).toBe(42);
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
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-cumulative-management-" + name + "-"));
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts: fixture.artifacts,
    credentials: bank.map(({ ref: _ref, ...r }) => r),
  };
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(Error("management cohort deadline")), 45000);
  const wires: unknown[] = [],
    controls: unknown[] = [],
    facts: Record<string, unknown> = {},
    failures: unknown[] = [];
  let run: ReturnType<typeof launchCumulativeManagement> | undefined,
    ready: Record<string, unknown> | undefined,
    address: URL | undefined,
    terminal: unknown;
  async function launch() {
    run = launchCumulativeManagement(entry!, configuration);
    ready = await run.ready;
    expect(ready.event).toBe("management.ready");
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
    expect(v.event).toBe("management.done");
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
    if (!address || wires.length >= 64) throw Error("management request bound");
    const url = new URL(target, scope).href;
    if (
      new URL(url).origin !== new URL(scope).origin ||
      !new URL(url).pathname.startsWith("/acme/")
    )
      throw Error("management request namespace");
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
    const response = await execute({
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
        JSON.stringify(
          {
            name,
            source,
            entry,
            modules,
            schemaSHA256: sha(schema),
            fixture: { id: fixture.id, bytes: fixtureBytes.length, sha256: sha(fixtureBytes) },
            selection: { bytes: selectionBytes.length, sha256: sha(selectionBytes), nodes },
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
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch (e) {
      failures.push(e);
    }
    if (failures.length) throw new AggregateError(failures, "management case or cleanup failed");
  }
  return { launch, send, pair, control, finish, facts, failures };
}
async function seed(h: Harness) {
  const ids = Array.from({ length: 33 }, (_, i) => `r${String(i).padStart(2, "0")}`);
  const operations = ids.map((id) => ({
    operation: "createBead",
    id: "beads/" + id,
    type,
    properties: { title: id, label: id, n: id === "r32" ? 2 : 0 },
    metadata: { phase: "management" },
  }));
  const a = await h.send(
    "operations/batch",
    "POST",
    { operations: operations.slice(0, 32) },
    "management-seed32",
  );
  expect(a.status).toBe(200);
  expect(a.value.status).toBe("completed");
  const { operation: _operation, ...body } = operations[32]!;
  const b = await h.send("operations/create-bead", "POST", body, "management-extra");
  expect(b.status).toBe(200);
  expect(b.value.status).toBe("completed");
  return { ids, operations, extraBody: body, extraReceipt: b.value };
}
const set = {
  collection: "beads",
  selector: "$[?@.properties.n == 0]",
  change: [{ op: "replace", path: "/n", value: 1 }],
  cardinality: { min: 32, max: 32 },
};
async function receipt(h: Harness) {
  const r = await h.send("operations/update-where", "POST", set, "management-bulk");
  expect(r.status).toBe(200);
  expect(r.value.status).toBe("completed");
  expect(r.value.results).toHaveLength(32);
  const p = await h.send(r.value.next);
  expect(p.status).toBe(200);
  expect(p.value.results).toHaveLength(1);
  expect(p.value.next).toBeNull();
  const all = [...r.value.results, ...p.value.results];
  expect(all[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 32 });
  for (const [i, row] of all.slice(1).entries())
    expect(row).toEqual({
      operationIndex: 0,
      outcome: "updated",
      resource: {
        id: scope + `beads/r${String(i).padStart(2, "0")}`,
        type,
        revision: expect.any(String),
        properties: {
          title: `r${String(i).padStart(2, "0")}`,
          label: `r${String(i).padStart(2, "0")}`,
          n: 1,
        },
        metadata: { phase: "management" },
      },
    });
  return { root: r.value, page: p.value, entries: all };
}
function context(headers: Record<string, string>, epoch: string, view: string, position: string) {
  for (const k of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
    expect(headers[k]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(headers["bdp-scope-epoch"]).toBe(epoch);
  expect(headers["bdp-authorization-view"]).toBe(view);
  expect(headers["bdp-scope-position"]).toBe(position);
}
async function temporal(h: Harness) {
  const seeded = await seed(h),
    r = await receipt(h);
  const failureBody = {
    bead: "beads/missing",
    propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
  };
  const failed = await h.send("operations/update-bead", "POST", failureBody, "management-failed");
  expect(failed.status).toBe(200);
  expect(failed.value.status).toBe("failed");
  expect(failed.value.problem).toMatchObject({
    operationIndex: 0,
    code: "resource-not-found",
    status: 404,
  });
  const first = await h.send("snapshot");
  expect(first.status).toBe(200);
  const snap = first.value,
    page = await h.send(snap.beads.next);
  expect(page.status).toBe(200);
  expect(page.value.items.map((r: { id: string }) => r.id)).toEqual([scope + "beads/r32"]);
  for (let i = 1; i < 8; i++) expect((await h.send("snapshot")).status).toBe(200);
  const pressure = await h.send("snapshot");
  expect(pressure.status).toBe(503);
  expect(pressure.value).toMatchObject({
    code: "temporarily-unavailable",
    status: 503,
    retry: "after-delay",
  });
  expect(pressure.value.code).not.toBe("cursor-expired");
  await h.pair(snap.beads.next, page.value);
  await h.control("advance", { now: 1300000 });
  await h.pair(snap.id, snap);
  await h.pair(snap.beads.next, page.value);
  await h.control("advance", { now: 1300001 });
  for (const url of [snap.id, snap.beads.next]) {
    const v = await h.send(url);
    expect(v.status).toBe(410);
    expect(v.value.code).toBe("cursor-expired");
  }
  expect((await h.send("snapshot")).status).toBe(200);
  expect(r.root.expiresAt).toBe(new Date(87400000).toISOString());
  await h.control("advance", { now: 87400000 });
  await h.pair(r.root.id, r.root);
  await h.pair(r.root.next, r.page);
  expect((await h.send(failed.value.id)).value).toEqual(failed.value);
  await h.control("advance", { now: 87400001 });
  const { results: _results, next: _next, expiresAt: _expiresAt, ...compact } = r.root;
  const expired = { ...compact, detail: "expired", allocated: [] };
  await h.pair(r.root.id, expired);
  for (const method of ["GET", "HEAD"] as const) {
    const v = await h.send(r.root.next, method);
    expect(v.status).toBe(410);
    if (method === "GET") expect(v.value.code).toBe("cursor-expired");
    else expect(v.bodyText).toBe("");
  }
  const retry = await h.send("operations/update-where", "POST", set, "management-bulk");
  expect(retry.status).toBe(200);
  expect(retry.value).toEqual(expired);
  const extra = await h.send(
    "operations/create-bead",
    "POST",
    seeded.extraBody,
    "management-extra",
  );
  expect(extra.value).toMatchObject({
    id: seeded.extraReceipt.id,
    status: "completed",
    detail: "expired",
    allocated: [{ operationIndex: 0, id: scope + "beads/r32", type }],
  });
  const lost = await h.send(failed.value.id);
  expect(lost.status).toBe(404);
  const newFailure = await h.send(
    "operations/update-bead",
    "POST",
    failureBody,
    "management-failed",
  );
  expect(newFailure.value.status).toBe("failed");
  expect(newFailure.value.id).not.toBe(failed.value.id);
  const seq = await h.send("operations/sequence", "POST", {
    operations: [
      {
        operation: "createBead",
        idempotencyKey: "management-extra",
        name: "again",
        ...seeded.extraBody,
      },
    ],
  });
  expect(seq.status).toBe(200);
  expect(seq.value.results[0]).toMatchObject({
    operationIndex: 0,
    operationName: "again",
    code: "idempotency-expired",
    status: 410,
    allocated: { id: scope + "beads/r32", type },
  });
  const fresh = await h.send("snapshot");
  expect(fresh.value.scopePosition).toBe("pos-3");
  h.facts.temporal = {
    r,
    snap,
    page: page.value,
    pressure: pressure.value,
    expired,
    newFailure: newFailure.value,
    sequence: seq.value,
  };
}
async function policy(h: Harness) {
  await seed(h);
  const r = await receipt(h),
    before = await h.send("snapshot");
  expect(before.status).toBe(200);
  const snap = before.value,
    page = await h.send(snap.beads.next);
  expect(page.status).toBe(200);
  await h.control("reopen");
  await h.pair(r.root.next, r.page);
  await h.pair(snap.id, snap);
  await h.pair(snap.beads.next, page.value);
  const rotated = await h.control("empty-policy");
  const fresh = await h.send("snapshot");
  expect(fresh.status).toBe(200);
  const now = fresh.value;
  expect(now.scopeEpoch).toBe(snap.scopeEpoch);
  expect(now.authorizationView).not.toBe(snap.authorizationView);
  expect(now.scopePosition).toBe(snap.scopePosition);
  expect(now.beads).toEqual({ items: [], next: null });
  expect(now.links).toEqual({ items: [], next: null });
  const hide = (row: { operationIndex: number; outcome: string }) =>
    row.outcome === "matched" ? row : { operationIndex: row.operationIndex, outcome: "withheld" };
  const hidden = { ...r.root, results: r.root.results.map(hide) },
    hiddenPage = { ...r.page, results: r.page.results.map(hide) };
  for (const [url, expected] of [
    [r.root.id, hidden],
    [r.root.next, hiddenPage],
  ]) {
    const got = await h.pair(url, expected);
    context(got.headers, now.scopeEpoch, now.authorizationView, now.scopePosition);
    if (url === r.root.id) expect(got.value.authorizationView).toBe(r.root.authorizationView);
    const other = await h.send(url, "GET", undefined, undefined, "principal-b");
    expect(other.status).toBe(404);
  }
  const minimum = {
    "bdp-scope-epoch": now.scopeEpoch,
    "bdp-authorization-view": now.authorizationView,
    "bdp-minimum-scope-position": "genesis",
  };
  for (const url of [snap.id, snap.beads.next])
    for (const method of ["GET", "HEAD"] as const) {
      const v = await h.send(url, method, undefined, undefined, "operator", minimum);
      expect(v.status).toBe(409);
      context(v.headers, now.scopeEpoch, now.authorizationView, now.scopePosition);
      if (method === "GET")
        expect(v.value).toEqual({
          type: "https://github.com/gastownhall/bdp/problems/conflict",
          code: "foreign-view",
          status: 409,
          retry: "after-state-change",
        });
      else expect(v.bodyText).toBe("");
    }
  const oldFeed = await h.send("changes/?after=" + encodeURIComponent(snap.checkpoint));
  expect(oldFeed.status).toBe(409);
  expect(oldFeed.value.code).toBe("foreign-view");
  h.facts.policy = { r, snap, page: page.value, rotated, current: now, hidden, hiddenPage };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
async function erasureRestore(h: Harness) {
  const create = {
    id: "beads/r00",
    type,
    properties: { title: "management-erased-secret-value", n: 0 },
    metadata: { phase: "original" },
  };
  const made = await h.send("operations/create-bead", "POST", create, "management-original");
  expect(made.value.status).toBe("completed");
  const original = made.value.results[0].resource;
  const update = {
    bead: "beads/r00",
    propertiesChange: [{ op: "replace", path: "", value: { title: "management-healthy", n: 1 } }],
    metadataChange: [{ op: "replace", path: "", value: { phase: "healthy" } }],
  };
  const current = await h.send("operations/update-bead", "POST", update, "management-current");
  expect(current.value.status).toBe("completed");
  const healthy = current.value.results[0].resource;
  const setup = await h.send(
    "operations/batch",
    "POST",
    {
      operations: [
        {
          operation: "createBead",
          id: "beads/a",
          type: scope + "types/only",
          properties: { n: 0 },
        },
        {
          operation: "createBead",
          id: "beads/b",
          type: scope + "types/plain",
          properties: { n: 0 },
        },
        {
          operation: "createLink",
          id: "links/l",
          type: linkType,
          source: "beads/a",
          target: "beads/b",
          properties: { n: 1 },
          metadata: { secret: "management-old-link" },
        },
      ],
    },
    "management-owned",
  );
  expect(setup.value.status).toBe("completed");
  const old = setup.value.results[2].resource;
  const ownerBefore = await h.send("beads/a");
  expect(ownerBefore.value.ownedLinks[linkType]).toEqual([old]);
  const correction = await h.control("correct-link", { subject: old.id, revision: old.revision });
  const corrected = correction.result as {
    group: { changes: { resource?: ReturnType<typeof JSON.parse> }[]; erasures: unknown[] };
    receipt?: unknown;
  };
  expect(corrected).not.toHaveProperty("receipt");
  const successor = corrected.group.changes.find((r) => r.resource?.id === old.id)!.resource;
  expect(successor).toEqual({
    ...old,
    revision: expect.any(String),
    properties: { n: 2 },
    metadata: { corrected: true },
  });
  expect(successor.revision).not.toBe(old.revision);
  expect(corrected.group.erasures).toEqual(
    expect.arrayContaining([
      {
        subject: old.id,
        revision: old.revision,
        digest: { scheme: "sha-256-jcs", value: sha(Buffer.from(canonical(old))) },
      },
    ]),
  );
  const ownerAfter = await h.send("beads/a");
  expect(ownerAfter.value.ownedLinks[linkType]).toEqual([successor]);
  expect(corrected.group.erasures).toEqual(
    expect.arrayContaining([
      {
        subject: ownerBefore.value.id,
        revision: ownerBefore.value.revision,
        digest: { scheme: "sha-256-jcs", value: sha(Buffer.from(canonical(ownerBefore.value))) },
      },
    ]),
  );
  const deleted = await h.control("tombstone-link", {
    subject: successor.id,
    revision: successor.revision,
  });
  const tombstone = deleted.result as {
    group: {
      changes: unknown[];
      erasures: unknown[];
      events: { type: string; ordinal: number }[];
      erasurePruned: boolean;
      originalEventCount: number;
    };
    receipt?: unknown;
  };
  expect(tombstone).not.toHaveProperty("receipt");
  expect(tombstone.group.events.map((r) => [r.type, r.ordinal])).toEqual([
    ["deleted", 0],
    ["updated", 3],
  ]);
  expect(tombstone.group).toMatchObject({ erasurePruned: true, originalEventCount: 4 });
  const finalOwner = await h.send("beads/a");
  expect(finalOwner.value.ownedLinks[linkType]).toBeUndefined();
  expect((await h.send("links/l")).status).not.toBe(200);
  await h.control("save");
  const before = await h.send("snapshot");
  expect(before.status).toBe(200);
  const snap = before.value;
  const erased = await h.control("erase", { subject: original.id, revision: original.revision });
  const erasure = erased.result as {
    group: { position: string; changes: unknown[]; events: unknown[]; erasures: unknown[] };
  };
  expect(erasure.group).toMatchObject({ changes: [], events: [] });
  expect(erasure.group.erasures).toEqual([
    {
      subject: original.id,
      revision: original.revision,
      digest: { scheme: "sha-256-jcs", value: sha(Buffer.from(canonical(original))) },
    },
  ]);
  const newSnap = await h.send("snapshot");
  expect(newSnap.status).toBe(200);
  expect(newSnap.value.scopeEpoch).toBe(snap.scopeEpoch);
  expect(newSnap.value.erasures).toEqual(expect.arrayContaining(erasure.group.erasures));
  for (const target of [snap.id, "changes/?after=" + encodeURIComponent(snap.checkpoint)]) {
    const v = await h.send(target);
    expect(v.status).toBe(410);
    expect(v.value.code).toBe("cursor-expired");
  }
  const preserved = await h.send("beads/r00");
  expect(preserved.value).toEqual(healthy);
  const projected = await h.send(made.value.id);
  expect(projected.status).toBe(200);
  expect(projected.bodyText).not.toContain("management-erased-secret-value");
  expect(projected.value.results[0]).not.toHaveProperty("resource");
  const events = await h.send("events/");
  expect(events.status).toBe(200);
  expect(events.bodyText).not.toContain("management-old-link");
  h.facts.erasedIdentityPermission =
    "Unselected: only content absence, no actual erased marker interpreted as authorized History.";
  const restored = await h.control("restore");
  const fresh = await h.send("snapshot");
  expect(fresh.status).toBe(200);
  expect(fresh.value.scopeEpoch).not.toBe(newSnap.value.scopeEpoch);
  expect(fresh.value.scopePosition).toBe("pos-1");
  expect(fresh.value.erasures).toEqual(newSnap.value.erasures);
  expect((await h.send("beads/r00")).value).toEqual(healthy);
  expect((await h.send("beads/a")).value).toEqual(finalOwner.value);
  expect(fresh.value.beads.items).toEqual(newSnap.value.beads.items);
  expect(fresh.value.links).toEqual(newSnap.value.links);
  const feed = await h.send("changes/?after=genesis");
  expect(feed.status).toBe(200);
  expect(feed.value.groups).toHaveLength(1);
  expect(feed.value.groups[0]).toMatchObject({
    position: "pos-1",
    previousPosition: "pos-0",
    changes: [],
    events: [],
    eventCount: 0,
    erasures: fresh.value.erasures,
  });
  for (const target of [
    newSnap.value.id,
    "changes/?after=" + encodeURIComponent(newSnap.value.checkpoint),
  ]) {
    const v = await h.send(target);
    expect(v.status).toBe(410);
    expect(v.value.code).toBe("cursor-expired");
  }
  expect((await h.send(current.value.id)).status).toBe(404);
  const retry = await h.send("operations/update-bead", "POST", update, "management-current");
  expect(retry.value.status).toBe("completed");
  expect(retry.value.id).not.toBe(current.value.id);
  expect(retry.value.scopeEpoch).toBe(fresh.value.scopeEpoch);
  expect(retry.value).not.toHaveProperty("effectPosition");
  await h.control("reopen");
  const reopened = await h.send("snapshot");
  expect(reopened.value.scopeEpoch).toBe(fresh.value.scopeEpoch);
  expect(reopened.value.erasures).toEqual(fresh.value.erasures);
  expect(reopened.value.beads.items).toEqual(fresh.value.beads.items);
  h.facts.recovery = {
    original,
    healthy,
    old,
    ownerBefore: ownerBefore.value,
    ownerAfter: ownerAfter.value,
    correction: corrected,
    tombstone,
    snap,
    newSnap: newSnap.value,
    erasure,
    restored,
    restoredSnapshot: fresh.value,
    feed: feed.value,
    retry: retry.value,
  };
}
const cases = { temporal, policy, "erasure-restore": erasureRestore };
it.skipIf(!entry).each(Object.keys(cases) as (keyof typeof cases)[])(
  "packed cumulative management companion: %s",
  async (name) => {
    const h = await start(name);
    try {
      await h.launch();
      await cases[name](h);
    } catch (e) {
      h.failures.push(e);
    } finally {
      await h.finish();
    }
  },
  45000,
);
