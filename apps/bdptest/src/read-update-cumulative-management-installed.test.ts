/** NEW packed RU management observations. No ordinary runtime identity or whole-profile award. */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import type { TypeDescriptor } from "@bdp/protocol";
import { expect, it } from "vitest";
import {
  cumulativeRUConfiguration,
  type RUCampaignCredentials,
} from "../test-support/read-update-cumulative-management-configuration.js";
import { launchRUManagement } from "../test-support/read-update-cumulative-management-launch.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const helpers = await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
);
const entry = process.env.BDP_RU_MANAGEMENT_ENTRY,
  build = process.env.BDP_RU_MANAGEMENT_BUILD,
  output = process.env.BDP_RU_MANAGEMENT_OUTPUT,
  bankPath = process.env.BDP_RU_MANAGEMENT_CREDENTIALS;
const scope = "https://reference.invalid/acme/",
  type = scope + "types/task",
  BASE = 1700000000000,
  DAY = 86400000;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const fixtureBytes = await readFile(
  new URL("../test-support/read-update-cumulative-management-fixture.json", import.meta.url),
);
if (fixtureBytes.length > 4194304) throw Error("fixture 4MiB bound");
const fixture = JSON.parse(fixtureBytes.toString());
const todo = [{ value: fixture, depth: 0 }];
let nodes = 0;
while (todo.length) {
  const { value, depth } = todo.pop()!;
  if (++nodes > 100000 || depth > 128) throw Error("fixture node/depth bound");
  if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      if (!Array.isArray(value) && ++nodes > 100000) throw Error("fixture key bound");
      if (k.length > 65536) throw Error("fixture key bytes");
      todo.push({ value: v, depth: depth + 1 });
    }
}

type Value = Record<string, any>;
function record(v: unknown): Value {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("object required");
  return v as Value;
}
function bead(value: unknown, id: string, properties: unknown) {
  const b = record(value);
  expect(Object.keys(b).sort()).toEqual(["id", "metadata", "properties", "revision", "type"]);
  expect(b).toEqual({ id, type, revision: expect.any(String), properties, metadata: {} });
  expect(b.revision).toMatch(/^.+$/);
  return b;
}
function problem(v: unknown, code: string, status: number) {
  const p = record(v);
  expect(p.code).toBe(code);
  expect(p.status).toBe(status);
  expect(p.resource).toBeUndefined();
  expect(p.outcome).toBeUndefined();
  return p;
}
class ManagementHarnessFailure extends AggregateError {
  constructor(
    readonly primary: unknown,
    readonly evidence: Value,
    closing: unknown[],
  ) {
    super([primary, ...closing], "management harness refused before ownership handoff", {
      cause: primary,
    });
  }
}
async function run(name: string, body: (h: Awaited<ReturnType<typeof harness>>) => Promise<void>) {
  if (!entry || !build || !output || !bankPath) throw Error("explicit packed bindings required");
  let h: Awaited<ReturnType<typeof harness>> | undefined;
  let startupEvidence: Value | undefined;
  const failures: unknown[] = [];
  // All allocation/startup is inside the owned failure/removal boundary.
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-management-"));
  try {
    h = await harness(name, directory);
    await body(h);
  } catch (error) {
    if (error instanceof ManagementHarnessFailure) startupEvidence = error.evidence;
    failures.push(error);
  }
  if (h) {
    try {
      await h.close();
    } catch (error) {
      failures.push(error);
    }
  }
  let removed = false;
  try {
    await rm(directory, { recursive: true, force: true });
    removed = true;
  } catch (error) {
    failures.push(error);
  }
  try {
    const evidence = h ? h.evidence : (startupEvidence ?? { startupFailed: true });
    const text =
      JSON.stringify(
        { name, ...evidence, removed, failures: failures.map((e) => inspect(e, { depth: 12 })) },
        null,
        2,
      ) + "\n";
    // Credential values never enter public observations or IPC summaries.
    const bank = JSON.parse(await readFile(bankPath, "utf8"));
    for (const token of Object.values(bank) as string[])
      if (text.includes(token)) throw Error("private credential in evidence");
    await writeFile(path.join(output, name + ".json"), text);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new AggregateError(failures, "RU management scenario failed");
}
async function harness(name: string, directory: string, injectedDiscoveryFailure?: Error) {
  const modules = [];
  for (const n of (await readdir(build!)).filter((n) => n.endsWith(".js")).sort()) {
    const b = await readFile(path.join(path.dirname(entry!), n));
    expect(b.equals(await readFile(path.join(build!, n))), n).toBe(true);
    modules.push({ name: n, bytes: b.length, sha256: sha(b) });
  }
  const schema = await readFile(
    path.join(path.dirname(entry!), "../../protocol/schemas/bdp-v0.schema.json"),
  );
  expect(schema.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(true);
  const bankBytes = await readFile(bankPath!),
    bank = JSON.parse(bankBytes.toString()) as RUCampaignCredentials;
  expect(Object.keys(bank).sort()).toEqual(["operator", "other", "restricted"]);
  expect(new Set(Object.values(bank)).size).toBe(3);
  for (const value of Object.values(bank)) expect(value.length).toBeGreaterThanOrEqual(32);
  const installed = (await import(
    pathToFileURL(path.join(path.dirname(entry!), "installed-reference-configuration.js")).href
  )) as {
    referenceTypeArtifacts(scope: string): TypeDescriptor[];
    captureInstalledReferenceConfiguration(value: unknown): {
      identity: string;
      artifactIdentity: string;
      policyIdentity: string;
      authenticationIdentity: string;
    };
  };
  const port = await helpers.availablePort();
  const configuration = cumulativeRUConfiguration(
    { scope, directory, create: true, listener: { host: "127.0.0.1", port } },
    installed.referenceTypeArtifacts(scope),
    bank,
  );
  expect(configuration.contracts.descriptors).toHaveLength(17);
  expect(configuration.contracts.schemas).toHaveLength(4);
  const captured = installed.captureInstalledReferenceConfiguration(configuration);
  const evidence: Value = {
    name,
    sourceCommit: process.env.BDP_RU_MANAGEMENT_SOURCE,
    entry,
    modules,
    schema: { bytes: schema.length, sha256: sha(schema) },
    fixture: { bytes: fixtureBytes.length, sha256: sha(fixtureBytes), nodes },
    credentialBank: {
      bytes: bankBytes.length,
      sha256: sha(bankBytes),
      principals: Object.keys(bank).sort(),
    },
    configuration: {
      ...configuration,
      credentials: configuration.credentials.map(({ token: _token, ...v }) => v),
    },
    initialCapture: {
      identity: captured.identity,
      artifactIdentity: captured.artifactIdentity,
      policyIdentity: captured.policyIdentity,
      authenticationIdentity: captured.authenticationIdentity,
    },
    ordinaryRuntimeConfigurationIdentity: null,
    ordinaryDeployment: false,
    wires: [],
    controls: [],
    facts: {},
    terminal: null,
  };
  const child = launchRUManagement(entry!, configuration);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(Error("RU 90s aggregate deadline")), 90000);
  function checkReady(r: Value) {
    expect(r.ordinaryRuntimeConfigurationIdentity).toBeNull();
    expect(r.ordinaryDeployment).toBe(false);
    expect(r.claimEligible).toBe(false);
    expect(r.profile).toBe("read-update");
    expect(r.history).toBe(false);
    expect(r.facadeKeys).toEqual(["close", "scope"]);
    expect(r.artifactIdentity).toBe(captured.artifactIdentity);
    expect(r.authenticationIdentity).toBe(captured.authenticationIdentity);
    expect(r.managementIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(r.payloadIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(r.ownerLimits.lifecycle.retentionMs).toBe(DAY);
    expect(r.ownerLimits.lifecycle.minimumRetentionMs).toBe(DAY);
    expect(r.listenerInput).toEqual({ host: "127.0.0.1", port });
  }
  async function refuseBeforeHandoff(primary: unknown): Promise<never> {
    clearTimeout(timer);
    evidence.timerClearedBeforeHandoffFailure = true;
    evidence.childPid = child.child.pid;
    const closing: unknown[] = [];
    try {
      evidence.terminal = await child.close();
    } catch (error) {
      closing.push(error);
    }
    // Retain the original receiving/discovery failure and every close cause.
    // The outer owner can remove the store only after this close/reap settles.
    throw new ManagementHarnessFailure(primary, evidence, closing);
  }
  let ready: Value;
  try {
    ready = await child.ready;
    checkReady(ready);
    evidence.initialReady = ready;
  } catch (error) {
    return refuseBeforeHandoff(error);
  }
  async function control(command: string, now?: number) {
    const result = await child.control({ command, ...(now === undefined ? {} : { now }) });
    evidence.controls.push(result);
    expect(result.event).toBe("management.done");
    expect(result.command).toBe(command);
    ready = record(result.ready);
    checkReady(ready);
    return record(result);
  }
  async function send(target: string, method: HttpMethod = "GET", body?: unknown, key?: string) {
    if (evidence.wires.length >= 32) throw Error("32 requests per fresh-store case bound");
    const url = new URL(target, scope).href;
    if (!url.startsWith(scope)) throw Error("request confinement");
    const raw = body === undefined ? undefined : JSON.stringify(body),
      bytes = raw === undefined ? undefined : Buffer.from(raw);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: "127.0.0.1", port },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 1048576,
        exactMode: {
          scope,
          profile: "read-update",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "operator",
          credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${bank.operator}` }),
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
    evidence.wires.push({
      method,
      url,
      credentialRef: "operator",
      key,
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
      managementIdentity: ready.managementIdentity,
      policyIdentity: ready.policyIdentity,
      now: ready.now,
    });
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
    if (bytes) expect(response.exactRequest?.bodyDigest).toBe(sha(bytes));
    return {
      status: response.status,
      value: response.bodyText ? (JSON.parse(response.bodyText) as Value) : undefined,
    };
  }
  try {
    const discovery = await send("bdp.json");
    expect(discovery.status).toBe(200);
    expect(discovery.value).toMatchObject({
      scope,
      profile: "read-update",
      operations: scope + "operations/",
    });
    if (injectedDiscoveryFailure) throw injectedDiscoveryFailure;
    const directoryResponse = await send("operations/");
    expect(directoryResponse.status).toBe(200);
    expect(directoryResponse.value).toMatchObject({
      createBead: "create-bead",
      updateBead: "update-bead",
      deleteBead: "delete-bead",
      sequence: "sequence",
    });
    evidence.operationDirectory = directoryResponse.value;
  } catch (error) {
    return refuseBeforeHandoff(error);
  }
  return {
    evidence,
    send,
    control,
    async close() {
      clearTimeout(timer);
      evidence.terminal = await child.close();
      expect(evidence.terminal).toMatchObject({
        code: 0,
        signal: null,
        forced: false,
        overflow: false,
        stdoutEOF: true,
        stderrEOF: true,
        reaped: true,
      });
    },
  };
}
const create = (properties: unknown, id?: string) => ({ type, ...(id ? { id } : {}), properties });
const change = (bead: string, n: number) => ({
  bead,
  propertiesChange: [{ op: "replace", path: "/n", value: n }],
});
const mutation = async (
  h: Awaited<ReturnType<typeof harness>>,
  route: string,
  body: unknown,
  key: string,
) => {
  const r = await h.send("operations/" + route, "POST", body, key);
  expect(r.status).toBe(200);
  return record(r.value);
};
function row(snapshot: Value, key: string) {
  const rows = record(snapshot.result).keys as Value[];
  const r = rows.find((r) => r.principal === "operator" && r.key === key);
  if (!r) throw Error("actual native key absent: " + key);
  return r;
}

it.skipIf(!entry)(
  "uses the genuine 24h floor and expired allocated creator for a later @name",
  async () => {
    await run("expired-creator", async (h) => {
      const request = create({ title: "original", n: 1 });
      const made = await mutation(h, "create-bead", request, "creator");
      expect(made.outcome).toBe("created");
      const id = record(made.resource).id;
      expect(id).toMatch(/^https:\/\/reference.invalid\/acme\/beads\/.+/);
      const original = bead(made.resource, id, { title: "original", n: 1 });
      const updated = await mutation(h, "update-bead", change(id, 2), "ordinary-update");
      const current = bead(updated.resource, id, { title: "original", n: 2 });
      expect(current.revision).not.toBe(original.revision);
      await h.control("reopen", BASE + DAY - 1);
      expect(await mutation(h, "create-bead", request, "creator")).toEqual(made);
      const before = row(await h.control("snapshot"), "creator");
      expect(before.state).toBe("retained");
      expect(before.retain_until).toBe(BASE + DAY);
      expect(JSON.parse(before.outcome).disposition).toEqual(made);
      await h.control("reopen", BASE + DAY);
      const expired = await h.send("operations/create-bead", "POST", request, "creator");
      expect(expired.status).toBe(410);
      problem(expired.value, "idempotency-expired", 410);
      const conflict = await h.send(
        "operations/create-bead",
        "POST",
        create({ title: "different", n: 9 }),
        "creator",
      );
      expect(conflict.status).toBe(409);
      problem(conflict.value, "idempotency-conflict", 409);
      const tombstone = row(await h.control("snapshot"), "creator");
      expect(tombstone).toMatchObject({
        state: "expired",
        effect: "success",
        identity: null,
        outcome: null,
        completed_at: null,
        retain_until: null,
      });
      expect(tombstone.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.parse(tombstone.resolutions).creation).toEqual({
        kind: "bound",
        id,
        resourceKind: "bead",
      });
      const seq = await h.send("operations/sequence", "POST", {
        operations: [
          { operation: "createBead", ...request, name: "creator", idempotencyKey: "creator" },
          { operation: "updateBead", ...change("@creator", 3), idempotencyKey: "dependent" },
        ],
      });
      expect(seq.status).toBe(200);
      const results = record(seq.value).results;
      expect(results).toHaveLength(2);
      problem(results[0], "idempotency-expired", 410);
      expect(results[0]).toMatchObject({ operationIndex: 0, operationName: "creator" });
      expect(results[1]).toMatchObject({ outcome: "updated", operationIndex: 1 });
      const final = bead(results[1].resource, id, { title: "original", n: 3 });
      expect(final.revision).not.toBe(current.revision);
      expect((await h.send(id)).value).toEqual(final);
      const native = record((await h.control("snapshot")).result);
      expect(native.resources).toHaveLength(1);
      expect(native.resources[0].id).toBe(id.slice(scope.length));
      h.evidence.facts = {
        original,
        current,
        final,
        allocatedKind: "bead",
        expiredCreatorResolvesSameAllocatedIdentity: true,
      };
    });
  },
  90000,
);

it.skipIf(!entry)(
  "observes selected MAY failure forgetting and mandatory successful no-op tombstone",
  async () => {
    await run("expired-failure", async (h) => {
      const id = scope + "beads/future",
        request = change(id, 2);
      const failure = await h.send("operations/update-bead", "POST", request, "old-failure");
      expect(failure.status).toBe(404);
      problem(failure.value, "resource-not-found", 404);
      const made = await mutation(
        h,
        "create-bead",
        create({ n: 1 }, "beads/future"),
        "create-future",
      );
      const original = bead(made.resource, id, { n: 1 });
      const replay = await h.send("operations/update-bead", "POST", request, "old-failure");
      expect(replay).toEqual(failure);
      const noop = await mutation(h, "update-bead", change(id, 1), "successful-noop");
      expect(noop).toEqual({ outcome: "updated", resource: original });
      const prior = await h.control("snapshot");
      expect(row(prior, "old-failure")).toMatchObject({
        state: "retained",
        effect: "failure",
        retain_until: BASE + DAY,
      });
      expect(row(prior, "successful-noop")).toMatchObject({
        state: "retained",
        effect: "success",
        retain_until: BASE + DAY,
      });
      await h.control("reopen", BASE + DAY);
      const after = record((await h.control("snapshot")).result);
      expect(after.keys.some((r: Value) => r.key === "old-failure")).toBe(false);
      expect(row({ result: after }, "successful-noop")).toMatchObject({
        state: "expired",
        effect: "success",
        outcome: null,
      });
      const newly = await mutation(h, "update-bead", request, "old-failure");
      const final = bead(newly.resource, id, { n: 2 });
      expect(final.revision).not.toBe(original.revision);
      const expired = await h.send(
        "operations/update-bead",
        "POST",
        change(id, 1),
        "successful-noop",
      );
      expect(expired.status).toBe(410);
      problem(expired.value, "idempotency-expired", 410);
      const conflict = await h.send(
        "operations/update-bead",
        "POST",
        change(id, 3),
        "successful-noop",
      );
      expect(conflict.status).toBe(409);
      problem(conflict.value, "idempotency-conflict", 409);
      expect((await h.send(id)).value).toEqual(final);
      h.evidence.facts = {
        original,
        final,
        selectedFailurePolicy: "forgotten after actual floor; MAY not universal MUST",
        noopTombstone: true,
      };
    });
  },
  90000,
);

it.skipIf(!entry)(
  "reauthorizes the original retained postimage across genuine policy changes after deletion",
  async () => {
    await run("authorization-view", async (h) => {
      const id = scope + "beads/policy",
        request = create({ n: 1 }, "beads/policy");
      const made = await mutation(h, "create-bead", request, "original");
      const original = bead(made.resource, id, { n: 1 });
      const update = await mutation(h, "update-bead", change(id, 2), "update");
      const current = bead(update.resource, id, { n: 2 });
      expect(await mutation(h, "create-bead", request, "original")).toEqual(made);
      const hidden = await h.control("hide");
      expect(record(hidden.ready).policyIdentity).not.toBe(h.evidence.initialReady.policyIdentity);
      const denied = await h.send("operations/create-bead", "POST", request, "original");
      expect(denied.status).toBe(403);
      problem(denied.value, "forbidden", 403);
      expect((await h.send(id)).status).toBe(404);
      const restored = await h.control("restore-policy");
      expect(record(restored.ready).policyIdentity).toBe(h.evidence.initialReady.policyIdentity);
      expect(await mutation(h, "create-bead", request, "original")).toEqual(made);
      expect((await h.send(id)).value).toEqual(current);
      const deletion = await mutation(h, "delete-bead", { bead: id }, "delete");
      expect(deletion).toEqual({
        outcome: "deleted",
        deleted: { resourceKind: "bead", resource: { id, type, revision: current.revision } },
      });
      expect(await mutation(h, "create-bead", request, "original")).toEqual(made);
      expect((await h.send(id)).status).toBe(404);
      await h.control("hide");
      const hiddenGone = await h.send("operations/create-bead", "POST", request, "original");
      expect(hiddenGone.status).toBe(403);
      problem(hiddenGone.value, "forbidden", 403);
      await h.control("restore-policy");
      expect(await mutation(h, "create-bead", request, "original")).toEqual(made);
      const snapshot = record((await h.control("snapshot")).result);
      expect(snapshot.resources).toHaveLength(0);
      expect(JSON.parse(row({ result: snapshot }, "original").outcome).disposition).toEqual(made);
      h.evidence.facts = {
        original,
        current,
        deletion,
        originalDispositionNotReplacedByForbidden: true,
        deletedResourceNotRecreated: true,
      };
    });
  },
  90000,
);

it.skipIf(!entry)(
  "reauthorizes an updated original postimage rather than the current or deleted Resource",
  async () => {
    await run("authorization-view-updated", async (h) => {
      const id = scope + "beads/policy";
      await mutation(h, "create-bead", create({ n: 1 }, "beads/policy"), "create");
      const rememberedRequest = change(id, 2);
      const remembered = await mutation(h, "update-bead", rememberedRequest, "remembered-update");
      const original = bead(remembered.resource, id, { n: 2 });
      const later = await mutation(h, "update-bead", change(id, 3), "later-update");
      const current = bead(later.resource, id, { n: 3 });
      expect(current.revision).not.toBe(original.revision);
      await h.control("hide");
      const denied = await h.send(
        "operations/update-bead",
        "POST",
        rememberedRequest,
        "remembered-update",
      );
      expect(denied.status).toBe(403);
      problem(denied.value, "forbidden", 403);
      await h.control("restore-policy");
      expect(await mutation(h, "update-bead", rememberedRequest, "remembered-update")).toEqual(
        remembered,
      );
      expect((await h.send(id)).value).toEqual(current);
      await mutation(h, "delete-bead", { bead: id }, "delete");
      await h.control("hide");
      const gone = await h.send(
        "operations/update-bead",
        "POST",
        rememberedRequest,
        "remembered-update",
      );
      expect(gone.status).toBe(403);
      problem(gone.value, "forbidden", 403);
      await h.control("restore-policy");
      expect(await mutation(h, "update-bead", rememberedRequest, "remembered-update")).toEqual(
        remembered,
      );
      expect((await h.send(id)).status).toBe(404);
      const native = record((await h.control("snapshot")).result);
      expect(native.resources).toHaveLength(0);
      expect(JSON.parse(row({ result: native }, "remembered-update").outcome).disposition).toEqual(
        remembered,
      );
      h.evidence.facts = {
        original,
        current,
        fullUpdatedDispositionRetained: true,
        deletedResourceNotRecreated: true,
      };
    });
  },
  90000,
);

it("rejects incorrect expiry and retained-record oracles", () => {
  for (const bad of [
    { outcome: "created", resource: { id: scope + "beads/x" } },
    { code: "idempotency-expired", status: 410, resource: { secret: 1 } },
    { code: "idempotency-conflict", status: 410 },
  ])
    expect(() => problem(bad, "idempotency-expired", 410)).toThrow();
  expect(() =>
    bead(
      { id: scope + "beads/policy", type, revision: "r", properties: { n: 2 } },
      scope + "beads/policy",
      { n: 1 },
    ),
  ).toThrow();
});

it.skipIf(!entry)(
  "closes a genuine ready owner when discovery refuses before harness handoff",
  async () => {
    if (!output) throw Error("evidence required");
    let directory: string | undefined,
      evidence: Value = {},
      removed = false;
    const failures: unknown[] = [],
      primary = Error("NEW deterministic test-only post-discovery refusal");
    try {
      directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-management-discovery-refusal-"));
      let caught: unknown;
      try {
        await harness("discovery-refusal", directory, primary);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ManagementHarnessFailure);
      const failure = caught as ManagementHarnessFailure;
      evidence = failure.evidence;
      expect(failure.primary).toBe(primary);
      expect(failure.cause).toBe(primary);
      expect(failure.errors).toEqual([primary]);
      expect(evidence.initialReady).toMatchObject({
        event: "management.ready",
        ordinaryDeployment: false,
      });
      expect(evidence.timerClearedBeforeHandoffFailure).toBe(true);
      expect(evidence.childPid).toBeGreaterThan(0);
      expect(evidence.wires).toHaveLength(1);
      expect(evidence.wires[0]).toMatchObject({
        method: "GET",
        url: scope + "bdp.json",
        status: 200,
      });
      expect(evidence.terminal).toMatchObject({
        code: 0,
        signal: null,
        forced: false,
        overflow: false,
        stdoutEOF: true,
        stderrEOF: true,
        reaped: true,
      });
      evidence.expectedPrimaryFailure = {
        message: primary.message,
        sameOriginalCause: true,
        noCloseFailure: true,
      };
    } catch (error) {
      failures.push(error);
    }
    try {
      if (directory) {
        await rm(directory, { recursive: true, force: true });
        await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
        removed = true;
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      const text =
        JSON.stringify(
          {
            ...evidence,
            removed,
            directory,
            failures: failures.map((e) => inspect(e, { depth: 12 })),
          },
          null,
          2,
        ) + "\n";
      const bank = JSON.parse(await readFile(bankPath!, "utf8"));
      for (const token of Object.values(bank) as string[])
        if (text.includes(token)) throw Error("private credential in evidence");
      await writeFile(path.join(output, "discovery-refusal.json"), text);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(failures, "discovery refusal cleanup regression failed");
  },
  90000,
);
