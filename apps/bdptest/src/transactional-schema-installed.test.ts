/** Private installed exact schema traversal; no public discovery or profile qualification. */
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
  throw new Error("installed schema override requires explicit source commit");
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
  rootSchema = `${scope}schemas/root`,
  referencedSchema = `${scope}schemas/value`;
const descriptor = {
  id: task,
  name: "Task",
  describes: "bead",
  conformsTo: [],
  propertiesSchema: rootSchema,
};
const rootBytes = `{\n "$id": "${rootSchema}", "type": "object", "properties": {"title": {"$ref": "value"}}, "required": ["title"], "additionalProperties": false\n}\n`;
const referencedBytes = `{ "$id": "${referencedSchema}", "description": "café", "type": "string", "minLength": 1e0 }\n`;
const artifacts = {
  descriptors: [{ retrievalUri: task, utf8: JSON.stringify(descriptor) }],
  schemas: [
    { retrievalUri: rootSchema, utf8: rootBytes },
    { retrievalUri: referencedSchema, utf8: referencedBytes },
  ],
};
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
const schema = JSON.parse(
  readFileSync(path.join(root, "specs/profiles/core/bdp-v0.schema.json"), "utf8"),
);
ajv.addSchema(schema);
const validators = Object.fromEntries(
  ["typesInventory", "typeDescriptor", "mutationReceipt", "readProblem"].map((name) => [
    name,
    ajv.compile({ $ref: `${schema.$id}#/$defs/${name}` }),
  ]),
);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected object");
  return value as Record<string, unknown>;
}
function checked(text: string, name: string) {
  const value = record(JSON.parse(text));
  const validate = validators[name];
  if (!validate) throw new Error("unbound schema");
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  return value;
}
function confinedObserved(value: unknown, expected: string): string {
  if (typeof value !== "string" || value.length > 8192 || Buffer.byteLength(value) > 8192)
    throw new Error("unbound schema traversal identity");
  const url = new URL(value);
  if (
    url.href !== value ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value !== expected ||
    !value.startsWith(scope)
  )
    throw new Error("unbound schema traversal identity");
  return value;
}
it("confines observed Type and schema traversal to exact administrative identities", () => {
  for (const value of [task, rootSchema, referencedSchema])
    expect(confinedObserved(value, value)).toBe(value);
  for (const value of [
    rootSchema + "?x=1",
    rootSchema + "#fragment",
    rootSchema + "/",
    rootSchema.replace("root", "%72oot"),
    rootSchema.replace("reference.invalid", "user@reference.invalid"),
    rootSchema.replace("reference.invalid", "other.invalid"),
    rootSchema.replace("reference.invalid", "REFERENCE.invalid"),
    rootSchema + "?",
  ])
    expect(() => confinedObserved(value, rootSchema)).toThrow("unbound schema traversal identity");
});
it("traverses installed local schema bytes with current context within14requests", async () => {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("installed schema cohort deadline")),
    90000,
  );
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-schema-installed-"));
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
  const failures: unknown[] = [],
    observations: Record<string, unknown>[] = [];
  const sessions: { pid: number | undefined; exit: number | null; signal: string | null }[] = [];
  const routes = [
    { method: "GET", url: `${scope}types/?limit=32` },
    { method: "HEAD", url: rootSchema },
    { method: "GET", url: `${scope}schemas/unknown` },
    { method: "POST", url: rootSchema },
    { method: "GET", url: scope },
    { method: "POST", url: `${scope}operations/create-bead` },
  ];
  const grants = new Set<string>();
  let requests = 0;
  let epoch: string | undefined, view: string | undefined;
  async function exchange(
    label: string,
    method: "GET" | "HEAD" | "POST",
    url: string,
    headers: Record<string, string> = {},
    input?: unknown,
    wrongCredential = false,
  ) {
    if (!child) throw new Error("installed child missing");
    if (
      !routes.some((r) => r.method === method && r.url === url) &&
      !(method === "GET" && grants.has(url))
    )
      throw new Error("unbound installed schema route");
    if (++requests > 14) throw new Error("installed schema request ceiling");
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
          resolveCredentials: () => ({
            authorization: `Bearer ${wrongCredential ? "wrong-credential" : token}`,
          }),
        },
      },
    );
    const bodyBytes = input === undefined ? undefined : Buffer.from(JSON.stringify(input));
    const response = await execute({
      method,
      url,
      signal: controller.signal,
      credentialRef: "writer",
      raw: {
        headerLines: Object.entries(headers).map(([name, value]) => ({ name, value })),
        ...(bodyBytes ? { bodyBytes } : {}),
      },
    });
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(
      response.exactRequest?.headerLines.find((h) => h.name.toLowerCase() === "host")?.value,
    ).toBe("reference.invalid");
    if (
      !response.wireResponseBytes?.length ||
      !Number.isSafeInteger(response.bodyOctets) ||
      response.bodyOctets === undefined ||
      response.bodyOctets < 0
    )
      throw new Error("missing exact schema wire evidence");
    observations.push({
      label,
      method,
      url,
      status: response.status,
      requestBodyBytes: bodyBytes?.length ?? 0,
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
    return response;
  }
  type Wire = Awaited<ReturnType<typeof exchange>>;
  function context(response: Wire, position: string) {
    for (const [key, value] of Object.entries({
      "bdp-scope-epoch": epoch,
      "bdp-authorization-view": view,
      "bdp-scope-position": position,
    })) {
      expect(typeof response.headers[key], `schema context presence: ${key}`).toBe("string");
      expect(response.headers[key], `schema current context: ${key}`).toBe(value);
    }
  }
  function exact(response: Wire, bytes: string) {
    expect(response.status, "known installed schema status").toBe(200);
    expect(response.bodyText, "exact installed schema bytes").toBe(bytes);
    expect(response.bodyOctets).toBe(Buffer.byteLength(bytes));
    expect(response.headers["content-length"]).toBe(String(Buffer.byteLength(bytes)));
    expect(hash(response.bodyText)).toBe(hash(bytes));
    expect(response.headers["content-type"]).toBe("application/json");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.vary).toBe("Accept");
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers["last-modified"]).toBeUndefined();
  }
  try {
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
    binding = installedTransactionBinding(child.ready, declaredSourceCommit, fixture);
    expect(child.ready.claimEligible).toBe(false);
    const inventory = await exchange("types", "GET", routes[0]!.url);
    expect(inventory.status).toBe(200);
    expect(checked(inventory.bodyText, "typesInventory")).toEqual({
      items: [{ id: task, name: "Task", describes: "bead" }],
      next: null,
    });
    const observedType = confinedObserved(
      record((record(JSON.parse(inventory.bodyText)).items as unknown[])[0]).id,
      task,
    );
    grants.add(observedType);
    const typeResponse = await exchange("type", "GET", observedType);
    expect(typeResponse.status).toBe(200);
    const actualDescriptor = checked(typeResponse.bodyText, "typeDescriptor");
    expect(actualDescriptor).toEqual(descriptor);
    const observedRoot = confinedObserved(actualDescriptor.propertiesSchema, rootSchema);
    grants.add(observedRoot);
    const schemaResponse = await exchange("root", "GET", observedRoot);
    exact(schemaResponse, rootBytes);
    const parsedRoot = record(JSON.parse(schemaResponse.bodyText));
    expect(parsedRoot.$id).toBe(rootSchema);
    expect(parsedRoot).toEqual({
      $id: rootSchema,
      type: "object",
      properties: { title: { $ref: "value" } },
      required: ["title"],
      additionalProperties: false,
    });
    const actualRef = record(record(parsedRoot.properties).title).$ref;
    expect(actualRef).toBe("value");
    const resolved = confinedObserved(
      new URL(actualRef as string, parsedRoot.$id as string).href,
      referencedSchema,
    );
    grants.add(resolved);
    epoch = schemaResponse.headers["bdp-scope-epoch"];
    view = schemaResponse.headers["bdp-authorization-view"];
    context(schemaResponse, "pos-0");
    const referenced = await exchange("referenced", "GET", resolved);
    exact(referenced, referencedBytes);
    context(referenced, "pos-0");
    expect(JSON.parse(referenced.bodyText)).toEqual({
      $id: referencedSchema,
      description: "café",
      type: "string",
      minLength: 1,
    });
    const head = await exchange("head", "HEAD", observedRoot);
    expect(head.status).toBe(200);
    expect(head.bodyText).toBe("");
    expect(head.bodyOctets).toBe(0);
    expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(rootBytes)));
    expect(head.headers["content-type"]).toBe("application/json");
    expect(head.headers["cache-control"]).toBe("private, no-store");
    expect(head.headers.vary).toBe("Accept");
    expect(head.headers.etag).toBeUndefined();
    context(head, "pos-0");
    for (const [label, headers, status] of [
      ["unacceptable", { accept: "text/plain" }, 406],
      ["not-modified", { "if-none-match": "*" }, 304],
      ["precondition", { "if-match": '"missing"' }, 412],
    ] as const) {
      const selected = await exchange(label, "GET", observedRoot, headers);
      expect(selected.status).toBe(status);
      expect(selected.bodyText).toBe("");
      expect(selected.bodyOctets).toBe(0);
      context(selected, "pos-0");
      expect(selected.headers["content-type"]).toBeUndefined();
      expect(selected.headers["content-length"]).toBe(status === 304 ? undefined : "0");
      expect(selected.headers["cache-control"]).toBe("private, no-store");
      expect(selected.headers.vary).toBe("Accept");
      expect(selected.headers.etag).toBeUndefined();
    }
    const unknown = await exchange("unknown", "GET", `${scope}schemas/unknown`);
    expect(unknown.status).toBe(404);
    expect(checked(unknown.bodyText, "readProblem")).toMatchObject({
      status: 404,
      code: "resource-not-found",
    });
    expect(
      (await exchange("unauthenticated", "GET", observedRoot, {}, undefined, true)).status,
    ).toBe(401);
    const method = await exchange("method", "POST", observedRoot);
    expect(method.status).toBe(405);
    expect(method.headers.allow).toBe("GET, HEAD");
    expect(method.bodyText).toBe("");
    const discovery = await exchange("discovery", "GET", scope);
    expect(discovery.status).toBe(500);
    expect(discovery.bodyText).toBe("");
    expect(discovery.headers["x-bdp-development-limit"]).toBe("transactional-discovery");
    const mutation = await exchange(
      "create",
      "POST",
      `${scope}operations/create-bead`,
      { "content-type": "application/json", "idempotency-key": "schema-valid" },
      { id: "beads/a", type: task, properties: { title: "café" } },
    );
    expect(mutation.status).toBe(200);
    const receipt = checked(mutation.bodyText, "mutationReceipt");
    expect(receipt).toMatchObject({
      status: "completed",
      detail: "available",
      requiredPosition: "pos-1",
      effectPosition: "pos-1",
      next: null,
    });
    const results = receipt.results as unknown[];
    expect(results).toHaveLength(1);
    const created = record(results[0]);
    expect(created).toMatchObject({ operationIndex: 0, outcome: "created" });
    expect(record(created.resource)).toMatchObject({
      id: `${scope}beads/a`,
      type: task,
      properties: { title: "café" },
      metadata: {},
    });
    context(mutation, "pos-1");
    const after = await exchange("root-after", "GET", observedRoot);
    exact(after, rootBytes);
    context(after, receipt.effectPosition as string);
    expect(requests).toBe(14);
    expect(observations.map((o) => o.label)).toEqual([
      "types",
      "type",
      "root",
      "referenced",
      "head",
      "unacceptable",
      "not-modified",
      "precondition",
      "unknown",
      "unauthenticated",
      "method",
      "discovery",
      "create",
      "root-after",
    ]);
    expect(new Set(observations.map((o) => `${o.method} ${o.url}`))).toEqual(
      new Set([
        ...routes.map((r) => `${r.method} ${r.url}`),
        ...[...grants].map((url) => `GET ${url}`),
      ]),
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
        failures.push(new Error("installed schema child remains active"));
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
      if (!directoryAbsent) failures.push(new Error("schema store remains"));
    } catch (error) {
      failures.push(error);
    }
    if (controller.signal.aborted && !failures.includes(controller.signal.reason))
      failures.push(controller.signal.reason);
    console.log(
      JSON.stringify({
        observation: "private-installed-local-schemas",
        declaredSourceCommit,
        workspaceDirty,
        entry,
        entrySha256,
        binding,
        routes,
        observedGrants: [...grants],
        artifactBytes: artifacts.schemas.map((a) => ({
          uri: a.retrievalUri,
          bytes: Buffer.byteLength(a.utf8),
          sha256: hash(a.utf8),
        })),
        sessions,
        attemptedRequests: requests,
        completedResponses: observations,
        directoryAbsent,
        outcome: failures.length ? "failed" : "passed",
        claimEligible: false,
        evidenceRetention:
          "Response fingerprints/context only; full wire/body bytes are not retained",
      }),
    );
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "installed schema or cleanup failed");
}, 120000);
