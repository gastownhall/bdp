/** Private installed sequence refusal observations; no discovery or profile qualification. */
import { execFileSync } from "node:child_process";
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
    child: import("node:child_process").ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
if (process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("installed refusal override requires explicit source commit");
const declaredSourceCommit =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(declaredSourceCommit)) throw new Error("invalid declared source commit");
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const entrySha256 = hash(readFileSync(entry));
const scope = "https://reference.invalid/acme/",
  task = `${scope}types/task`,
  propertiesSchema = `${scope}schemas/title`;
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const artifacts = {
  descriptors: [
    {
      retrievalUri: task,
      utf8: JSON.stringify({
        id: task,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        propertiesSchema,
      }),
    },
  ],
  schemas: [
    {
      retrievalUri: propertiesSchema,
      utf8: JSON.stringify({
        $id: propertiesSchema,
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      }),
    },
  ],
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const schema = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
ajv.addSchema(schema);
const validators = Object.fromEntries(
  ["mutationReceipt", "transactionalProblem", "currentBeadCollection", "eventPage"].map((name) => [
    name,
    ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` }),
  ]),
);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected record");
  return value as Record<string, unknown>;
}
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("expected array");
  return value.map(record);
}
function checked(text: string, name: string) {
  const value = record(JSON.parse(text)),
    validate = validators[name];
  if (!validate) throw new Error("unbound response schema");
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  return value;
}
// Local mirror of the existing source-private receipt-root confinement contract.
function observedReceiptRoot(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192 || Buffer.byteLength(value) > 8192)
    throw new Error("invalid observed receipt root");
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new Error("invalid observed receipt root", { cause });
  }
  const prefix = `${scope}receipts/`;
  if (
    url.href !== value ||
    !value.startsWith(prefix) ||
    !/^[A-Za-z0-9_-]+$/.test(value.slice(prefix.length)) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("invalid observed receipt root");
  return value;
}
it("confines the observed receipt target to one canonical bounded root", () => {
  const prefix = `${scope}receipts/`;
  for (const value of [`${prefix}root_1-A`, prefix + "a".repeat(8192 - prefix.length)])
    expect(observedReceiptRoot(value)).toBe(value);
  for (const value of [
    undefined,
    1,
    "not a URL",
    prefix,
    `${prefix}root/pages/child`,
    `${prefix}root/`,
    `${prefix}root?view=other`,
    `${prefix}root?`,
    `${prefix}root#fragment`,
    `${prefix}root#`,
    `${prefix}%72oot`,
    `${prefix}root.name`,
    `${prefix}røot`,
    `${prefix}../root`,
    ` ${prefix}root`,
    "https://user:password@reference.invalid/acme/receipts/root",
    "https://reference.invalid/acme-other/receipts/root",
    "https://other.invalid/acme/receipts/root",
    "https://REFERENCE.invalid/acme/receipts/root",
    prefix + "a".repeat(8193 - prefix.length),
  ])
    expect(() => observedReceiptRoot(value), "invalid receipt-root fixture").toThrow(
      "invalid observed receipt root",
    );
});

const titleFor = (id: string) => (id === "c" ? "corrected-c" : id);
const create = (id: string, title = id) => ({
  id: `beads/${id}`,
  type: task,
  properties: { title },
});
const overCount = (prefix: string) => ({
  operations: Array.from({ length: 33 }, (_, i) => ({
    operation: "createBead",
    ...create(`rejected-${i}`),
    idempotencyKey: `${prefix}-${i}`,
  })),
});
const negotiation = (key: string) => ({
  operations: [{ operation: "createBead", ...create("c", "original-c"), idempotencyKey: key }],
});

it("observes current context on installed sequence refusals within13requests", async () => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("installed refusal cohort deadline")),
    90000,
  );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-sequence-refusal-installed-"));
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
  const failures: unknown[] = [];
  const observations: Record<string, unknown>[] = [];
  const sessions: { pid: number | undefined; exit: number | null; signal: string | null }[] = [];
  const routes = [
    { method: "POST", url: `${scope}operations/create-bead` },
    { method: "POST", url: `${scope}operations/sequence` },
    { method: "GET", url: `${scope}beads/?limit=32` },
    { method: "GET", url: `${scope}events/` },
  ];
  let receiptUrl: string | undefined;
  let expectedContext: Record<string, string> | undefined;
  let requests = 0;
  async function exchange(
    label: string,
    url: string,
    input?: unknown,
    key?: string,
    accept?: string,
  ) {
    if (!child) throw new Error("installed child missing");
    const method = input === undefined ? ("GET" as const) : ("POST" as const);
    if (
      !routes.some((r) => r.method === method && r.url === url) &&
      !(method === "GET" && url === receiptUrl)
    )
      throw new Error("unbound installed refusal route");
    if (++requests > 13) throw new Error("installed refusal request ceiling");
    const address = new URL(child.ready.listenUrl as string);
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
    const bodyBytes = input === undefined ? undefined : Buffer.from(JSON.stringify(input));
    if (bodyBytes) expect(bodyBytes.byteLength).toBeLessThanOrEqual(65536);
    const response = await execute({
      method,
      url,
      signal: controller.signal,
      credentialRef: "writer",
      raw: {
        headerLines: [
          ...(input === undefined ? [] : [{ name: "content-type", value: "application/json" }]),
          ...(key === undefined ? [] : [{ name: "idempotency-key", value: key }]),
          ...(accept === undefined ? [] : [{ name: "accept", value: accept }]),
        ],
        ...(bodyBytes ? { bodyBytes } : {}),
      },
    });
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(
      response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
    ).toBe("reference.invalid");
    if (!response.wireResponseBytes?.length) throw new Error("missing real response wire");
    if (
      !Number.isSafeInteger(response.bodyOctets) ||
      response.bodyOctets === undefined ||
      response.bodyOctets < 0
    )
      throw new Error("missing actual body octets");
    observations.push({
      label,
      method,
      url,
      status: response.status,
      requestBodyBytes: bodyBytes?.byteLength ?? 0,
      requestBodySha256: hash(bodyBytes ?? new Uint8Array()),
      responseBodyBytes: response.bodyOctets,
      responseBodySha256: hash(response.bodyText),
      wireSha256: hash(response.wireResponseBytes),
      context: {
        epoch: response.headers["bdp-scope-epoch"],
        view: response.headers["bdp-authorization-view"],
        position: response.headers["bdp-scope-position"],
      },
    });
    expect(response.headers["x-bdp-development"]).toBe("non-attesting");
    if (method === "POST") expect(response.headers.vary).toBe("Accept");
    return response;
  }
  type Wire = Awaited<ReturnType<typeof exchange>>;
  function context(response: Wire, position: string) {
    if (!expectedContext) throw new Error("seed context unavailable");
    for (const [name, value] of Object.entries({
      ...expectedContext,
      "bdp-scope-position": position,
    })) {
      expect(typeof response.headers[name], `sequence refusal context presence: ${name}`).toBe(
        "string",
      );
      expect(response.headers[name], `sequence refusal current context: ${name}`).toBe(value);
    }
  }
  function completed(response: Wire, name: string, position: string) {
    expect(response.status).toBe(200);
    const value = checked(response.bodyText, "mutationReceipt");
    expect(value).toMatchObject({
      status: "completed",
      detail: "available",
      requiredPosition: position,
      effectPosition: position,
      next: null,
    });
    const result = records(value.results);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ operationIndex: 0, outcome: "created" });
    const resource = record(result[0]!.resource);
    expect(resource.id).toBe(`${scope}beads/${name}`);
    expect(resource.type).toBe(task);
    expect(resource.properties).toEqual({ title: titleFor(name) });
    expect(resource.metadata).toEqual({});
    expect(typeof resource.revision).toBe("string");
    expect(resource.revision).not.toBe("");
    return value;
  }
  const receipts: Record<string, unknown>[] = [];
  function collection(response: Wire, names: string[], position: string) {
    expect(response.status).toBe(200);
    context(response, position);
    const value = checked(response.bodyText, "currentBeadCollection");
    expect(value.next).toBeNull();
    const items = records(value.items);
    expect(items.map((r) => r.id)).toEqual(names.map((name) => `${scope}beads/${name}`));
    expect(items).toEqual(receipts.map((receipt) => records(receipt.results)[0]!.resource));
  }
  function events(response: Wire, names: string[], position: string) {
    expect(response.status).toBe(200);
    context(response, position);
    const value = checked(response.bodyText, "eventPage");
    expect(value.next).toBeNull();
    const rows = records(value.events);
    expect(rows).toHaveLength(names.length);
    for (const [i, event] of rows.entries()) {
      expect(event).toMatchObject({
        type: "created",
        subject: `${scope}beads/${names[i]}`,
        source: `${scope}events/`,
        ordinal: 0,
        transaction: receipts[i]!.transaction,
      });
      const resource = record(records(receipts[i]!.results)[0]!.resource);
      expect(event.subjectType).toBe(task);
      expect(event.data).toEqual({
        revision: resource.revision,
        properties: { title: titleFor(names[i]!) },
        metadata: {},
        ...(resource.revisionProvenance ? { revisionProvenance: resource.revisionProvenance } : {}),
      });
      expect(typeof event.id).toBe("string");
      expect(event.id).not.toBe("");
    }
  }
  try {
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
    binding = installedTransactionBinding(child.ready, declaredSourceCommit, fixture);
    expect(child.ready.claimEligible).toBe(false);
    const seedResponse = await exchange("seed-a", routes[0]!.url, create("a"), "seed-a");
    const seed = completed(seedResponse, "a", "pos-1");
    expectedContext = {
      "bdp-scope-epoch": seed.scopeEpoch as string,
      "bdp-authorization-view": seed.authorizationView as string,
    };
    context(seedResponse, "pos-1");
    receipts.push(seed);
    receiptUrl = observedReceiptRoot(seed.id);
    const second = await exchange("seed-b", routes[0]!.url, create("b"), "seed-b");
    receipts.push(completed(second, "b", "pos-2"));
    context(second, "pos-2");
    async function capacity(label: string, prefix: string, position: string) {
      const response = await exchange(
        label,
        routes[1]!.url,
        overCount(prefix),
        undefined,
        "text/plain",
      );
      expect(response.status).toBe(413);
      // The old-payload negative must establish this exact branch before absence.
      expect(checked(response.bodyText, "transactionalProblem")).toMatchObject({
        code: "limit-exceeded",
        status: 413,
        limit: "sequence.operations",
      });
      context(response, position);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    async function unacceptable(label: string, key: string, position: string) {
      const response = await exchange(
        label,
        routes[1]!.url,
        negotiation(key),
        undefined,
        "text/plain",
      );
      expect(response.status).toBe(406);
      expect(response.bodyText).toBe("");
      expect(response.bodyOctets).toBe(0);
      expect(response.headers["content-type"]).toBeUndefined();
      context(response, position);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    await capacity("initial-capacity", "over", "pos-2");
    await unacceptable("initial-negotiation", "negotiation", "pos-2");
    const rootResponse = await exchange("retained-root", receiptUrl);
    expect(rootResponse.status).toBe(200);
    context(rootResponse, "pos-2");
    expect(checked(rootResponse.bodyText, "mutationReceipt")).toEqual(seed);
    collection(await exchange("unchanged-beads", routes[2]!.url), ["a", "b"], "pos-2");
    events(await exchange("unchanged-events", routes[3]!.url), ["a", "b"], "pos-2");
    const admittedC = await exchange(
      "reuse-negotiation-key",
      routes[0]!.url,
      create("c", "corrected-c"),
      "negotiation",
    );
    receipts.push(completed(admittedC, "c", "pos-3"));
    context(admittedC, "pos-3");
    const admittedD = await exchange("reuse-capacity-key", routes[0]!.url, create("d"), "over-0");
    receipts.push(completed(admittedD, "d", "pos-4"));
    context(admittedD, "pos-4");
    await capacity("repeat-capacity", "repeat-over", "pos-4");
    await unacceptable("repeat-negotiation", "repeat-negotiation", "pos-4");
    collection(await exchange("final-beads", routes[2]!.url), ["a", "b", "c", "d"], "pos-4");
    events(await exchange("final-events", routes[3]!.url), ["a", "b", "c", "d"], "pos-4");
    expect(requests).toBe(13);
    expect(observations.map((o) => o.label)).toEqual([
      "seed-a",
      "seed-b",
      "initial-capacity",
      "initial-negotiation",
      "retained-root",
      "unchanged-beads",
      "unchanged-events",
      "reuse-negotiation-key",
      "reuse-capacity-key",
      "repeat-capacity",
      "repeat-negotiation",
      "final-beads",
      "final-events",
    ]);
    expect(new Set(observations.map((o) => `${o.method} ${o.url}`))).toEqual(
      new Set([...routes.map((r) => `${r.method} ${r.url}`), `GET ${receiptUrl}`]),
    );
    controller.signal.throwIfAborted();
  } catch (error) {
    failures.push(error);
  } finally {
    if (child) {
      try {
        await child.close();
      } catch (error) {
        failures.push(error);
      }
      sessions.push({
        pid: child.child.pid,
        exit: child.child.exitCode,
        signal: child.child.signalCode,
      });
      if (child.child.exitCode === null && child.child.signalCode === null)
        failures.push(new Error("installed refusal child remains active"));
    }
    clearTimeout(timer);
    let directoryAbsent: boolean | undefined;
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    try {
      directoryAbsent = !existsSync(directory);
      if (!directoryAbsent) failures.push(new Error("installed refusal directory remains"));
    } catch (error) {
      failures.push(error);
    }
    if (controller.signal.aborted && !failures.includes(controller.signal.reason))
      failures.push(controller.signal.reason);
    console.log(
      JSON.stringify({
        observation: "private-installed-sequence-refusal-context",
        declaredSourceCommit,
        workspaceDirty,
        entry,
        entrySha256,
        directoryAbsent,
        evidenceRetention:
          "Response fingerprints and context only; complete wire and body bytes are not retained",
        binding,
        routes,
        sessions,
        attemptedRequests: requests,
        completedResponses: observations,
        outcome: failures.length ? "failed" : "passed",
        claimEligible: false,
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, "installed refusal observation or cleanup failed");
}, 120000);
