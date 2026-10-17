/** Bounded private installed alias observations, not discovery or profile qualification. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal: AbortSignal,
  ): Promise<{
    child: ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("installed alias override requires explicit source commit");
const source =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const scope = "https://reference.invalid/acme/",
  bead = `${scope}types/bead`,
  link = `${scope}types/link`,
  propertiesSchema = `${scope}schemas/n`;
const artifacts = {
  descriptors: [
    { id: bead, name: "Bead", describes: "bead", conformsTo: [], propertiesSchema },
    {
      id: link,
      name: "Link",
      describes: "link",
      conformsTo: [],
      propertiesSchema,
      source: { conformsTo: [bead], external: "none" },
      target: { conformsTo: [bead], external: "none" },
    },
  ].map((value) => ({ retrievalUri: value.id, utf8: JSON.stringify(value) })),
  schemas: [
    {
      retrievalUri: propertiesSchema,
      utf8: JSON.stringify({
        $id: propertiesSchema,
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
        additionalProperties: false,
      }),
    },
  ],
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
ajv.addSchema(bundle);
const validators = Object.fromEntries(
  [
    "transactionalSequenceResponse",
    "mutationReceipt",
    "transactionalProblem",
    "currentBeadRecord",
    "currentLinkRecord",
  ].map((name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })]),
);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected object");
  return value as Record<string, unknown>;
}
function sameResource(actual: unknown, expected: unknown) {
  expect(actual).toEqual(expected);
}
function results(value: Record<string, unknown>) {
  if (!Array.isArray(value.results)) throw new Error("expected results");
  return value.results.map(object);
}
it("installed sequence aliases resolve at turns and retain targets/misses across exact retries and restart", async () => {
  // Matches the adjacent installed Set cohort, not a universal service timeout.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("installed alias observation deadline")),
    90000,
  );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-alias-installed-"));
  const token = randomBytes(32).toString("base64url");
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts,
    credentials: [{ token, principal: "writer", canMutate: true }],
  };
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  const localSensitivityControls: string[] = [];
  const observations: {
      method: string;
      url: string;
      status: number;
      bodyOctets: number;
      bodySha256: string;
      wireSha256: string;
      scopePosition: string | undefined;
    }[] = [],
    sessions: { pid: number | undefined; exit: number | null }[] = [],
    failures: unknown[] = [];
  async function close() {
    if (!child) return;
    const closing = child;
    try {
      await closing.close();
    } finally {
      sessions.push({ pid: closing.child.pid, exit: closing.child.exitCode });
      child = undefined;
    }
  }
  async function launch(create: boolean) {
    child = await launchInstalledTransaction(
      entry,
      { ...configuration, create },
      controller.signal,
    );
    const actual = installedTransactionBinding(child.ready, source, fixture);
    expect(child.ready.claimEligible).toBe(false);
    expect(child.ready.profile).toBe("transactional");
    expect(child.ready.history).toBe(false);
    if (binding) expect(actual).toEqual(binding);
    else binding = actual;
  }
  // Test-authored closed targets; neither caller input nor returned locators broaden this set.
  const targets = new Set([
    "operations/batch",
    "operations/sequence",
    "operations/update-bead",
    "operations/put-alias",
    "beads/a",
    "beads/b",
    "beads/tail",
    "links/edge",
    "alias/work",
    "alias/fresh",
  ]);
  async function exchange(
    relative: string,
    input?: unknown,
    key?: string,
    status = 200,
    schemaName?: string,
  ) {
    if (!targets.has(relative) || !child) throw new Error("unbound installed alias request");
    const method = input === undefined ? ("GET" as const) : ("POST" as const),
      url = `${scope}${relative}`,
      address = new URL(child.ready.listenUrl as string);
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
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
    expect(observations.length).toBeLessThan(60);
    const response = await execute({
      method,
      url,
      signal: controller.signal,
      credentialRef: "writer",
      raw: {
        headerLines:
          input === undefined
            ? []
            : [
                { name: "content-type", value: "application/json" },
                ...(key === undefined ? [] : [{ name: "idempotency-key", value: key }]),
              ],
        ...(input === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(input)) }),
      },
    });
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(
      response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
    ).toBe("reference.invalid");
    if (!response.wireResponseBytes?.length) throw new Error("missing actual wire response");
    if (
      response.bodyOctets === undefined ||
      !Number.isSafeInteger(response.bodyOctets) ||
      response.bodyOctets < 0
    )
      throw new Error("completed response body octets unavailable");
    observations.push({
      method,
      url,
      status: response.status,
      bodyOctets: response.bodyOctets,
      scopePosition: response.headers["bdp-scope-position"],
      bodySha256: hash(response.bodyText),
      wireSha256: hash(response.wireResponseBytes),
    });
    expect(observations.length).toBeLessThanOrEqual(60);
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    expect(response.status, response.bodyText).toBe(status);
    if (status === 200) {
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(response.headers[name]?.length, name).toBeGreaterThan(0);
      // Seed batch commits once; sequence update+Link add two; tail adds one;
      // fresh update adds one. Alias writes, refusals, reads and replay add none.
      const position =
        observations.length <= 3
          ? 1
          : observations.length <= 19
            ? 3
            : observations.length <= 25
              ? 4
              : 5;
      expect(response.headers["bdp-scope-position"]).toBe(`pos-${position}`);
    }
    const value = response.bodyText === "" ? undefined : JSON.parse(response.bodyText);
    if (schemaName) {
      const validate = validators[schemaName];
      if (!validate) throw new Error("missing schema");
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    }
    return { response, value };
  }
  const sequence = async (operations: unknown[]) =>
    object(
      (
        await exchange(
          "operations/sequence",
          { operations },
          undefined,
          200,
          "transactionalSequenceResponse",
        )
      ).value,
    );
  const command = async (target: string, input: unknown, key: string) => {
    const receipt = object(
      (await exchange(`operations/${target}`, input, key, 200, "mutationReceipt")).value,
    );
    expect(receipt.status).toBe("completed");
    return receipt;
  };
  const get = async (id: string, expected: unknown, kind = "currentBeadRecord") => {
    const value = (await exchange(id, undefined, undefined, 200, kind)).value;
    expect(value).toMatchObject(object(expected));
    return value;
  };
  const update = {
    bead: "alias/work",
    propertiesChange: [{ op: "replace", path: "/n", value: 1 }],
  };
  try {
    await launch(true);
    await command(
      "batch",
      {
        operations: [
          ...["a", "b"].map((id) => ({
            operation: "createBead",
            id: `beads/${id}`,
            type: bead,
            properties: { n: 0 },
          })),
        ],
      },
      "seed",
    );
    await command("put-alias", { alias: "alias/work", target: "beads/a" }, "seed-alias");
    const initial = await exchange("alias/work", undefined, undefined, 307);
    expect(initial.response.headers.location).toBe(`${scope}beads/a`);
    const operations = [
      { operation: "putAlias", alias: "alias/work", target: "beads/b", idempotencyKey: "turn-put" },
      { operation: "updateBead", ...update, idempotencyKey: "turn-update" },
      {
        operation: "createLink",
        id: "links/edge",
        type: link,
        source: "alias/work",
        target: { uri: "alias/work", revision: "opaque-pin" },
        properties: { n: 2 },
        idempotencyKey: "turn-link",
      },
    ];
    const first = await sequence(operations),
      members = results(first);
    expect(members).toHaveLength(3);
    expect(members[1]).toMatchObject({
      operationIndex: 1,
      outcome: "updated",
      resource: { id: `${scope}beads/b`, type: bead, properties: { n: 1 } },
    });
    expect(members[2]).toMatchObject({
      operationIndex: 2,
      outcome: "created",
      resource: {
        id: `${scope}links/edge`,
        type: link,
        source: `${scope}beads/b`,
        target: { uri: `${scope}beads/b`, revision: "opaque-pin" },
        properties: { n: 2 },
      },
    });
    await get("beads/a", { id: `${scope}beads/a`, type: bead, properties: { n: 0 } });
    const observedB = await get("beads/b", { properties: { n: 1 } });
    sameResource(observedB, members[1]?.resource);
    const wrongAdmissionTarget = structuredClone(object(members[1]?.resource));
    wrongAdmissionTarget.id = `${scope}beads/a`;
    expect(() => sameResource(observedB, wrongAdmissionTarget)).toThrow();
    localSensitivityControls.push("admission-target");
    expect(await get("links/edge", { source: `${scope}beads/b` }, "currentLinkRecord")).toEqual(
      members[2]?.resource,
    );
    await command("put-alias", { alias: "alias/work", target: "beads/a" }, "repoint");
    expect(
      (await exchange("alias/work", undefined, undefined, 307)).response.headers.location,
    ).toBe(`${scope}beads/a`);
    expect(await sequence(operations)).toEqual(first);
    // A retained prefix must not rerun its alias write.
    expect(
      (await exchange("alias/work", undefined, undefined, 307)).response.headers.location,
    ).toBe(`${scope}beads/a`);
    const retained = await command("update-bead", update, "turn-update");
    sameResource(results(retained)[0]?.resource, members[1]?.resource);
    const stalePostimage = structuredClone(object(results(retained)[0]?.resource));
    object(stalePostimage.properties).n = 0;
    expect(() => sameResource(results(retained)[0]?.resource, stalePostimage)).toThrow();
    localSensitivityControls.push("stale-postimage");
    await command("put-alias", { alias: "alias/fresh", target: "beads/b" }, "fresh-put");
    expect(
      (await exchange("alias/fresh", undefined, undefined, 307)).response.headers.location,
    ).toBe(`${scope}beads/b`);
    expect(await command("update-bead", { ...update, bead: "alias/fresh" }, "turn-update")).toEqual(
      retained,
    );
    await command("put-alias", { alias: "alias/fresh", target: "beads/a" }, "fresh-repoint");
    expect(
      (await exchange("alias/fresh", undefined, undefined, 307)).response.headers.location,
    ).toBe(`${scope}beads/a`);
    const conflict = await exchange(
      "operations/update-bead",
      { ...update, bead: "alias/fresh" },
      "turn-update",
      409,
      "transactionalProblem",
    );
    expect(conflict.value).toMatchObject({ code: "idempotency-conflict" });
    await get("beads/a", { properties: { n: 0 } });
    const failedOperations = [
      { operation: "deleteAlias", alias: "alias/work", idempotencyKey: "drop" },
      { operation: "updateBead", ...update, idempotencyKey: "miss" },
      {
        operation: "createBead",
        id: "beads/tail",
        type: bead,
        properties: { n: 3 },
        idempotencyKey: "tail",
      },
    ];
    const failed = await sequence(failedOperations),
      failedMembers = results(failed);
    expect(failedMembers[1]).toMatchObject({
      operationIndex: 1,
      code: "resource-not-found",
      status: 404,
    });
    expect(failedMembers[2]).toMatchObject({
      operationIndex: 2,
      outcome: "created",
      resource: { id: `${scope}beads/tail`, type: bead, properties: { n: 3 } },
    });
    await exchange("alias/work", undefined, undefined, 404, "transactionalProblem");
    expect(await get("beads/tail", { properties: { n: 3 } })).toEqual(failedMembers[2]?.resource);
    await command("put-alias", { alias: "alias/work", target: "beads/b" }, "restore");
    expect(
      (await exchange("alias/work", undefined, undefined, 307)).response.headers.location,
    ).toBe(`${scope}beads/b`);
    expect(await sequence(failedOperations)).toEqual(failed);
    // A fresh key proves that the same locator is live despite its retained miss.
    const freshInput = { ...update, propertiesChange: [{ op: "replace", path: "/n", value: 4 }] };
    const fresh = await command("update-bead", freshInput, "fresh-update");
    expect(results(fresh)[0]).toMatchObject({
      outcome: "updated",
      resource: { id: `${scope}beads/b`, properties: { n: 4 } },
    });
    expect(await get("beads/b", { properties: { n: 4 } })).toEqual(results(fresh)[0]?.resource);
    expect(await command("update-bead", update, "turn-update")).toEqual(retained);
    await close();
    await launch(false);
    expect(await sequence(operations)).toEqual(first);
    expect(await sequence(failedOperations)).toEqual(failed);
    expect(await command("update-bead", update, "turn-update")).toEqual(retained);
    expect(
      (await exchange("alias/work", undefined, undefined, 307)).response.headers.location,
    ).toBe(`${scope}beads/b`);
    expect(await get("beads/b", { properties: { n: 4 } })).toEqual(results(fresh)[0]?.resource);
    await get("beads/a", { properties: { n: 0 } });
    expect(
      await get(
        "links/edge",
        { target: { uri: `${scope}beads/b`, revision: "opaque-pin" } },
        "currentLinkRecord",
      ),
    ).toEqual(members[2]?.resource);
    expect(await get("beads/tail", { properties: { n: 3 } })).toEqual(failedMembers[2]?.resource);
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
    clearTimeout(timer);
    rmSync(directory, { recursive: true, force: true });
    if (controller.signal.aborted && !failures.includes(controller.signal.reason))
      failures.push(controller.signal.reason);
    if (failures.length === 0) {
      try {
        expect(sessions).toHaveLength(2);
        expect(sessions.every((session) => session.exit === 0)).toBe(true);
        expect(observations).toHaveLength(36);
        expect(localSensitivityControls).toEqual(["admission-target", "stale-postimage"]);
        expect(sessions[0]?.pid).not.toBe(sessions[1]?.pid);
        expect(new Set(observations.map((observation) => observation.url))).toEqual(
          new Set([...targets].map((target) => `${scope}${target}`)),
        );
      } catch (error) {
        failures.push(error);
      }
    }
    console.log(
      JSON.stringify({
        observation: "private-installed-sequence-alias",
        declaredSourceCommit: source,
        workspaceDirty,
        entry,
        entrySha256: hash(readFileSync(entry)),
        binding,
        sessions,
        exchanges: observations.length,
        completedResponses: observations,
        localSensitivityControls,
        outcome: failures.length ? "failed" : "passed",
        claimEligible: false,
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, "installed alias observation or cleanup failed");
}, 120000);

it("observes installed live alias opaque minima without redirect shortcuts", async () => {
  const controller = new AbortController();
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-alias-opaque-installed-"));
  const ownedDirectory = realpathSync(directory);
  const token = randomBytes(32).toString("base64url");
  const failures: unknown[] = [];
  const failureCategories: string[] = [];
  function fail(category: string, error: unknown) {
    if (!failures.includes(error)) {
      failures.push(error);
      failureCategories.push(category);
    }
  }
  let deadlineFired = false;
  const workTimer = setTimeout(() => {
    deadlineFired = true;
    const error = new Error("installed opaque alias work deadline");
    fail("work-deadline", error);
    controller.abort(error);
  }, 45000);
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let launchAttempted = false,
    attempted = 0,
    settledExchanges = 0,
    cleanClose = false,
    cleanupDeadlineExceeded = false,
    pendingDrained = false,
    directoryRemoved = false,
    assertionsCompleted = false;
  const processEvents: {
    exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    close: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  } = { exit: undefined, close: undefined };
  let childDrain: Promise<void> | undefined;
  let lateCleanupRejectionObserved = false;
  const pending = new Set<Promise<unknown>>();
  const responses: {
    method: string;
    url: string;
    status: number;
    bodyOctets: number;
    bodySha256: string;
    wireSha256: string;
    headers: Record<string, string | null>;
  }[] = [];
  const safeHeaders = [
    "bdp-scope-epoch",
    "bdp-authorization-view",
    "bdp-scope-position",
    "content-length",
    "content-type",
    "cache-control",
    "retry-after",
    "location",
    "etag",
    "x-bdp-development",
  ];
  const routes = [
    { method: "POST" as const, url: `${scope}operations/batch` },
    { method: "POST" as const, url: `${scope}operations/put-alias` },
    { method: "GET" as const, url: `${scope}alias/work` },
    { method: "HEAD" as const, url: `${scope}alias/work` },
    { method: "GET" as const, url: `${scope}alias/missing` },
  ];
  try {
    launchAttempted = true;
    child = await launchInstalledTransaction(
      entry,
      {
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [{ token, principal: "writer", canMutate: true }],
      },
      controller.signal,
    );
    child.child.once("exit", (code, signal) => {
      processEvents.exit = { code, signal };
    });
    const ownedProcess = child.child;
    childDrain = new Promise<void>((resolve) => {
      ownedProcess.once("close", (code, signal) => {
        processEvents.close = { code, signal };
        resolve();
      });
    });
    expect(child.ready.scope).toBe(scope);
    expect(child.ready.claimEligible).toBe(false);
    expect(child.ready.profile).toBe("transactional");
    expect(child.ready.history).toBe(false);
    binding = installedTransactionBinding(child.ready, source, fixture);
    const address = new URL(child.ready.listenUrl as string);
    // Exactly one executor owns this callback's closed route set. It never follows redirects.
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 131072,
        exactMode: {
          scope,
          profile: "transactional",
          routes,
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "writer",
          credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
          resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
        },
      },
    );
    async function exchange(
      method: "GET" | "HEAD" | "POST",
      suffix: string,
      status: number,
      headers: Record<string, string> = {},
      input?: unknown,
      schemaName?: string,
    ) {
      const url = `${scope}${suffix}`;
      if (!routes.some((route) => route.method === method && route.url === url) || attempted >= 6)
        throw new Error("unbound or excess installed opaque alias request");
      controller.signal.throwIfAborted();
      attempted++;
      const operation = execute({
        method,
        url,
        signal: controller.signal,
        credentialRef: "writer",
        raw: {
          headerLines: Object.entries(headers).map(([name, value]) => ({ name, value })),
          ...(input === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(input)) }),
        },
      });
      pending.add(operation);
      void operation.then(
        () => {
          pending.delete(operation);
          settledExchanges++;
        },
        () => {
          pending.delete(operation);
          settledExchanges++;
        },
      );
      const response = await operation;
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(
        response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
      ).toBe("reference.invalid");
      if (!response.wireResponseBytes?.length) throw new Error("missing actual wire response");
      if (
        response.bodyOctets === undefined ||
        !Number.isSafeInteger(response.bodyOctets) ||
        response.bodyOctets < 0
      )
        throw new Error("completed body octets unavailable");
      responses.push({
        method,
        url,
        status: response.status,
        bodyOctets: response.bodyOctets,
        bodySha256: hash(response.bodyText),
        wireSha256: hash(response.wireResponseBytes),
        headers: Object.fromEntries(
          safeHeaders.map((name) => [name, response.headers[name] ?? null]),
        ),
      });
      expect(response.url).toBe(url);
      expect(response.status, response.bodyText).toBe(status);
      expect(response.headers["x-bdp-development"]).toBe("non-attesting");
      const value: unknown = response.bodyText === "" ? undefined : JSON.parse(response.bodyText);
      if (schemaName) {
        const validate = validators[schemaName];
        if (!validate) throw new Error("missing schema");
        expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      }
      return { response, value };
    }
    const seeded = await exchange(
      "POST",
      "operations/batch",
      200,
      { "content-type": "application/json", "idempotency-key": "opaque-alias-seed" },
      {
        operations: [{ operation: "createBead", id: "beads/a", type: bead, properties: { n: 0 } }],
      },
      "mutationReceipt",
    );
    expect(seeded.value).toMatchObject({ status: "completed", effectPosition: "pos-1" });
    const current = Object.fromEntries(
      ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"].map((name) => {
        const value = seeded.response.headers[name];
        if (!value) throw new Error("missing actual installed context");
        return [name, value];
      }),
    );
    expect(current["bdp-scope-position"]).toBe("pos-1");
    const aliased = await exchange(
      "POST",
      "operations/put-alias",
      200,
      { "content-type": "application/json", "idempotency-key": "opaque-alias-put" },
      { alias: "alias/work", target: "beads/a" },
      "mutationReceipt",
    );
    expect(aliased.value).toMatchObject({ status: "completed", requiredPosition: "pos-1" });
    function assertContext(response: typeof seeded.response) {
      for (const [name, value] of Object.entries(current))
        expect(response.headers[name]).toBe(value);
    }
    assertContext(aliased.response);
    function currentHeader(name: string): string {
      const value = current[name];
      if (value === undefined) throw new Error("missing captured installed context");
      return value;
    }
    const minimum: Record<string, string> = {
      "bdp-scope-epoch": currentHeader("bdp-scope-epoch"),
      "bdp-authorization-view": currentHeader("bdp-authorization-view"),
      "bdp-minimum-scope-position": currentHeader("bdp-scope-position"),
    };
    const eligible = await exchange("GET", "alias/work", 307, minimum);
    assertContext(eligible.response);
    expect(eligible.response.headers.location).toBe(`${scope}beads/a`);
    expect(eligible.response.headers["cache-control"]).toBe("private, no-store");
    expect(eligible.response.headers["content-length"]).toBe("0");
    expect(eligible.response.headers.etag).toBeUndefined();
    expect(eligible.response.bodyOctets).toBe(0);
    expect(eligible.response.bodyText).toBe("");
    const opaque = {
      ...minimum,
      "bdp-minimum-scope-position": "unknown",
      "if-none-match": "*",
      "if-match": '"different"',
      accept: "text/plain",
    };
    const get = await exchange("GET", "alias/work", 503, opaque, undefined, "transactionalProblem");
    expect(get.value).toMatchObject({
      code: "catch-up-timeout",
      status: 503,
      retry: "after-delay",
    });
    assertContext(get.response);
    expect(get.response.bodyOctets).toBeGreaterThan(0);
    expect(get.response.headers["content-length"]).toBe(String(get.response.bodyOctets));
    const head = await exchange("HEAD", "alias/work", 503, opaque);
    assertContext(head.response);
    expect(head.response.bodyOctets).toBe(0);
    expect(head.response.bodyText).toBe("");
    for (const response of [get.response, head.response]) {
      expect(response.headers["retry-after"]).toBe("1");
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers.location).toBeUndefined();
      expect(response.headers.etag).toBeUndefined();
    }
    for (const name of ["content-type", "content-length", "cache-control", "retry-after"])
      expect(head.response.headers[name]).toBe(get.response.headers[name]);
    const missing = await exchange(
      "GET",
      "alias/missing",
      404,
      { ...minimum, "bdp-minimum-scope-position": "unknown" },
      undefined,
      "transactionalProblem",
    );
    assertContext(missing.response);
    expect(missing.value).toMatchObject({ code: "resource-not-found", status: 404 });
    expect(missing.response.headers.location).toBeUndefined();
    expect(attempted).toBe(6);
    expect(responses).toHaveLength(6);
    expect(settledExchanges).toBe(6);
    controller.signal.throwIfAborted();
    assertionsCompleted = true;
  } catch (error) {
    fail("work", error);
  } finally {
    clearTimeout(workTimer);
    controller.abort();
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleaning = (async () => {
      await Promise.allSettled([...pending]);
      pendingDrained = pending.size === 0;
      if (!pendingDrained) throw new Error("raw exchanges remain pending");
      // Executor settlement destroys the socket; it does not expose a socket-close census.
      if (child) {
        await child.close();
        if (!childDrain) throw new Error("child close observer unavailable");
        await childDrain;
      } else if (launchAttempted) throw new Error("pre-ready child ownership remains unknown");
    })();
    void cleaning.catch((error: unknown) => {
      lateCleanupRejectionObserved = cleanupDeadlineExceeded;
      fail(cleanupDeadlineExceeded ? "late-cleanup" : "cleanup", error);
    });
    try {
      await Promise.race([
        cleaning,
        new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => {
            cleanupDeadlineExceeded = true;
            child?.child.kill("SIGKILL");
            reject(new Error("installed opaque alias total cleanup deadline"));
          }, 10000);
        }),
      ]);
      if (
        cleanupDeadlineExceeded ||
        !child ||
        child.child.exitCode !== 0 ||
        child.child.signalCode !== null ||
        processEvents.exit?.code !== 0 ||
        processEvents.exit.signal !== null ||
        processEvents.close?.code !== 0 ||
        processEvents.close.signal !== null
      )
        fail("unclean-close", new Error("installed opaque alias clean exit was not established"));
      else cleanClose = true;
    } catch (error) {
      fail("cleanup", error);
    } finally {
      if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    }
    try {
      if (cleanClose && pendingDrained && assertionsCompleted && failures.length === 0) {
        if (!existsSync(directory) || realpathSync(directory) !== ownedDirectory) {
          fail(
            "directory-ownership",
            new Error("installed opaque alias directory ownership changed"),
          );
        } else {
          rmSync(directory, { recursive: true, force: false });
          directoryRemoved = !existsSync(directory);
          if (!directoryRemoved)
            fail("directory-cleanup", new Error("installed opaque alias directory remains"));
        }
      }
    } catch (error) {
      fail("directory-cleanup", error);
    }
    const lifecycleAtReport = {
      launchAttempted,
      returnedChild: child !== undefined,
      pid: child?.child.pid ?? null,
      exitCode: child?.child.exitCode ?? null,
      signalCode: child?.child.signalCode ?? null,
      observedExit: processEvents.exit ?? null,
      observedClose: processEvents.close ?? null,
      childStdioDrainObserved: processEvents.close !== undefined,
      closure: cleanupDeadlineExceeded || !cleanClose ? "unknown-or-failed" : "clean",
      cleanClose,
      cleanupDeadlineExceeded,
      pendingExchanges: pending.size,
      pendingDrained,
      settledExchanges,
      socketCloseCensusAvailable: false,
      transportSettlementContract: "executor destroys socket before exchange settles",
      lateCleanupRejectionObserved,
      directory,
      directoryRemoved,
      directoryPresent: existsSync(directory),
    };
    console.log(
      JSON.stringify({
        observation: "private-installed-alias-opaque-minimum",
        declaredSourceCommit: source,
        workspaceDirty,
        entry,
        entrySha256: hash(readFileSync(entry)),
        artifactSha256: hash(JSON.stringify(artifacts)),
        binding,
        attempted,
        exchanges: responses.length,
        completedResponses: responses,
        assertionsCompleted,
        deadlineFired,
        lifecycleAtReport,
        failureCategories,
        outcome: failures.length ? "failed" : "passed",
        claimEligible: false,
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, "installed opaque alias observation or cleanup failed");
}, 60000);
