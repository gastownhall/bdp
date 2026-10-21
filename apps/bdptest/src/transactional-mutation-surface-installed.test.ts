/** Clause-specific inherited RU behavior on actual installed TX; not profile qualification. */
import { type ChildProcess, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createJsonSchemaValidator,
  createRawHttpExchangeExecutor,
  type HttpExchangeResponse,
  type HttpMethod,
} from "@bdp/conformance";
import { parseTransactionalDiscovery, parseTransactionalOperationDirectory } from "@bdp/protocol";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal: AbortSignal,
  ): Promise<{ child: ChildProcess; ready: Record<string, unknown>; close(): Promise<void> }>;
};
const scope = "https://reference.invalid/acme/",
  type = `${scope}types/task`;
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
function context(response: Pick<HttpExchangeResponse, "headers">, position: string) {
  for (const name of contextNames) expect(response.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(response.headers["bdp-scope-position"]).toBe(position);
}
function methodOracle(
  response: Pick<HttpExchangeResponse, "status" | "headers" | "bodyText" | "bodyOctets">,
  allow: string,
) {
  expect(response.status).toBe(405);
  expect(response.headers.allow).toBe(allow);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.bodyText).toBe("");
  expect(response.bodyOctets).toBe(0);
}
function receiptOracle(
  value: Record<string, unknown>,
  status: "completed" | "failed",
  code?: string,
  retry?: string,
) {
  expect(value.status).toBe(status);
  if (status === "failed") {
    expect(value).not.toHaveProperty("next");
    expect(value).not.toHaveProperty("results");
    expect(value.problem).toMatchObject({ code, retry });
  } else {
    expect(value.next).toBeNull();
    expect(value.results).toHaveLength(1);
  }
}
function nonAdmissionOracle(
  before: Pick<HttpExchangeResponse, "status" | "bodyText">,
  accepted: Record<string, unknown>,
  replay: Record<string, unknown>,
) {
  expect(before.status).toBe(401);
  expect(JSON.parse(before.bodyText)).toMatchObject({
    code: "unauthenticated",
    status: 401,
    retry: "after-state-change",
  });
  receiptOracle(accepted, "completed");
  expect(accepted.results).toMatchObject([
    {
      outcome: "created",
      resource: { id: `${scope}beads/anonymous-key`, properties: { title: "only-effect" } },
    },
  ]);
  expect(replay).toEqual(accepted);
}

it("mutation surface negative oracles reject method, disposition, context and uniqueness corruption", () => {
  const response = {
    status: 405,
    headers: { allow: "POST", "cache-control": "private, no-store" },
    bodyText: "",
    bodyOctets: 0,
  };
  methodOracle(response, "POST");
  for (const bad of [
    { ...response, status: 200 },
    { ...response, headers: { ...response.headers, allow: "GET" } },
    { ...response, bodyText: "leak", bodyOctets: 4 },
  ])
    expect(() => methodOracle(bad, "POST")).toThrow();
  const accepted = {
    status: "completed",
    next: null,
    results: [
      {
        outcome: "created",
        resource: { id: `${scope}beads/anonymous-key`, properties: { title: "only-effect" } },
      },
    ],
  };
  const anonymous = {
    status: 401,
    bodyText: JSON.stringify({ code: "unauthenticated", status: 401, retry: "after-state-change" }),
  };
  nonAdmissionOracle(anonymous, accepted, accepted);
  for (const bad of [
    { ...accepted, status: "failed" },
    { ...accepted, results: [] },
    { ...accepted, id: "different-replay" },
  ])
    expect(() => nonAdmissionOracle(anonymous, accepted, bad)).toThrow();
  const failed = {
    status: "failed",
    problem: { code: "identity-taken", retry: "never" },
  };
  receiptOracle(failed, "failed", "identity-taken", "never");
  expect(() =>
    receiptOracle({ ...failed, next: null }, "failed", "identity-taken", "never"),
  ).toThrow();
  expect(() =>
    receiptOracle(
      { ...failed, problem: { code: "resource-not-found", retry: "after-state-change" } },
      "failed",
      "identity-taken",
      "never",
    ),
  ).toThrow();
  expect(() =>
    receiptOracle(
      { ...failed, problem: { code: "identity-taken", retry: "after-state-change" } },
      "failed",
      "identity-taken",
      "never",
    ),
  ).toThrow();
  expect(() =>
    context(
      {
        headers: {
          "bdp-scope-epoch": "e",
          "bdp-authorization-view": "v",
          "bdp-scope-position": "pos-2",
        },
      },
      "pos-1",
    ),
  ).toThrow();
  expect(() => context({ headers: {} }, "pos-1")).toThrow();
});

type Session = {
  exchange(
    method: HttpMethod,
    url: string,
    body?: unknown,
    key?: string,
    anonymous?: boolean,
  ): Promise<HttpExchangeResponse>;
  targets: Record<string, string>;
  schema: ReturnType<typeof createJsonSchemaValidator>;
};
async function installed(label: string, body: (session: Session) => Promise<void>) {
  const entry = realpathSync(
    process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
      path.join(root, "packages/server/dist/transaction-installed-process.js"),
  );
  if (
    Boolean(process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY) !==
    Boolean(process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  )
    throw new Error("paired installed source overrides required");
  const sourceCommit =
    process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const schema = createJsonSchemaValidator(
    JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8")),
  );
  const fixture = {
    bytes: readFileSync(
      path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
    ),
  };
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-mutation-surface-")),
    controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("mutation surface cohort deadline")),
    30000,
  );
  const token = randomBytes(32).toString("base64url"),
    schemaUri = `${scope}schemas/title`;
  const configuration = {
    scope,
    directory,
    create: true,
    credentials: [{ token, principal: "writer", canMutate: true }],
    artifacts: {
      descriptors: [
        {
          retrievalUri: type,
          utf8: JSON.stringify({
            id: type,
            name: "Task",
            describes: "bead",
            conformsTo: [],
            propertiesSchema: schemaUri,
          }),
        },
      ],
      schemas: [
        {
          retrievalUri: schemaUri,
          utf8: JSON.stringify({
            $id: schemaUri,
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          }),
        },
      ],
    },
  };
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined,
    childClosed: Promise<void> | undefined,
    binding: unknown,
    failure: unknown;
  const observations: unknown[] = [],
    cleanupErrors: unknown[] = [];
  const channels = { stdout: [] as string[], stderr: [] as string[] };
  try {
    child = await launchInstalledTransaction(entry, configuration, controller.signal);
    childClosed = new Promise((resolve) => child?.child.once("close", () => resolve()));
    child.child.stdout?.on("data", (chunk: Buffer) =>
      channels.stdout.push(chunk.toString("base64")),
    );
    child.child.stderr?.on("data", (chunk: Buffer) =>
      channels.stderr.push(chunk.toString("base64")),
    );
    const bound = installedTransactionBinding(child.ready, sourceCommit, fixture);
    binding = bound;
    const dial = new URL(child.ready.listenUrl as string);
    const exchange: Session["exchange"] = async (method, url, input, key, anonymous = false) => {
      if (observations.length >= 100) throw new Error("mutation surface request bound");
      const credentialRef = anonymous ? "anonymous" : "writer";
      const execute = createRawHttpExchangeExecutor(
        { transport: "plain", host: dial.hostname, port: Number(dial.port) },
        {
          requestTimeoutMs: 5000,
          maximumBodyBytes: 131072,
          exactMode: {
            scope,
            profile: "transactional",
            routes: [{ method, url }],
            maximumRequestHeaderBytes: 16384,
            maximumRequestBodyBytes: 65536,
            defaultCredentialRef: credentialRef,
            credentialHandles: [
              { id: "writer", headerNames: ["authorization"] },
              { id: "anonymous", headerNames: [] },
            ],
            resolveCredentials: ({ credentialRef: selected }) =>
              selected === "anonymous" ? {} : { authorization: `Bearer ${token}` },
          },
        },
      );
      const bytes = input === undefined ? undefined : Buffer.from(JSON.stringify(input));
      const response = await execute({
        method,
        url,
        credentialRef,
        signal: controller.signal,
        raw: {
          headerLines: [
            { name: "accept", value: "application/json" },
            ...(bytes === undefined
              ? []
              : [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: key ?? "unused" },
                ]),
          ],
          ...(bytes === undefined ? {} : { bodyBytes: bytes }),
        },
      });
      observations.push({
        method,
        url,
        anonymous,
        key,
        requestBody: bytes?.toString(),
        requestHeaders: response.exactRequest?.headerLines.filter(
          (h) => h.name.toLowerCase() !== "authorization",
        ),
        status: response.status,
        headers: response.headers,
        bodyText: response.bodyText,
        bodyOctets: response.bodyOctets,
        wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
        writeState: response.exactRequest?.writeState,
      });
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      return response;
    };
    const discovery = await exchange("GET", `${scope}bdp.json`);
    expect(discovery.status).toBe(200);
    const document = parseTransactionalDiscovery(JSON.parse(discovery.bodyText));
    context(discovery, "pos-0");
    const directoryResponse = await exchange("GET", document.operations);
    expect(directoryResponse.status).toBe(200);
    const declaredTargets = parseTransactionalOperationDirectory(
      JSON.parse(directoryResponse.bodyText),
    );
    const targets = Object.fromEntries(
      Object.entries(declaredTargets).map(([name, reference]) => [
        name,
        new URL(reference, document.operations).href,
      ]),
    );
    expect(targets).toEqual(bound.operationTargets);
    expect(Object.keys(targets)).toHaveLength(12);
    await body({ exchange, targets: targets as unknown as Record<string, string>, schema });
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(timer);
    try {
      await child?.close();
      await childClosed;
      expect(child?.child.exitCode).toBe(0);
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    const report = {
      kind: "installed-mutation-surface-partial",
      label,
      sourceCommit,
      entry,
      entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
      binding,
      configuration: {
        ...configuration,
        credentials: [{ principal: "writer", canMutate: true, token: "<redacted>" }],
      },
      observations,
      channels,
      child: {
        pid: child?.child.pid,
        exit: child?.child.exitCode,
        signal: child?.child.signalCode,
        stdoutEOF: child?.child.stdout?.readableEnded,
        stderrEOF: child?.child.stderr?.readableEnded,
      },
      directoryAbsent: !existsSync(directory),
      failureCount: (failure === undefined ? 0 : 1) + cleanupErrors.length,
      claimEligible: false,
      wholeContract: false,
    };
    if (process.env.BDP_MUTATION_SURFACE_OUTPUT)
      writeFileSync(
        `${process.env.BDP_MUTATION_SURFACE_OUTPUT}-${label}.json`,
        `${JSON.stringify(report, null, 2)}\n`,
        { mode: 0o600 },
      );
    console.log(
      JSON.stringify({
        kind: report.kind,
        label,
        requests: observations.length,
        child: report.child,
        directoryAbsent: report.directoryAbsent,
        failureCount: report.failureCount,
      }),
    );
  }
  if (failure !== undefined || cleanupErrors.length)
    throw new AggregateError(
      [...(failure === undefined ? [] : [failure]), ...cleanupErrors],
      "installed mutation surface failed",
    );
}
function create(id: string) {
  return {
    id: `beads/${id}`,
    type,
    properties: { title: id === "anonymous-key" ? "only-effect" : id },
    metadata: {},
  };
}
async function receipt(
  session: Session,
  name: string,
  input: unknown,
  key: string,
  status: "completed" | "failed" = "completed",
  code?: string,
  retry?: string,
) {
  const response = await session.exchange(
    "POST",
    session.targets[name] ?? "missing-target",
    input,
    key,
  );
  expect(response.status, response.bodyText).toBe(200);
  const value = JSON.parse(response.bodyText) as Record<string, unknown>;
  expect(session.schema.validate("#/$defs/mutationReceipt", value)).toEqual([]);
  receiptOracle(value, status, code, retry);
  return { response, value };
}

it(
  "installed mutation methods advertise exact Allow over all twelve discovered targets",
  async () =>
    installed("methods", async ({ exchange, targets }) => {
      const methods: HttpMethod[] = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"];
      for (const target of Object.values(targets))
        for (const method of methods) methodOracle(await exchange(method, target), "POST");
      for (const method of ["POST", "OPTIONS", "PUT", "PATCH", "DELETE"] as const)
        methodOracle(await exchange(method, `${scope}operations/`), "GET, HEAD");
      const state = await exchange("GET", `${scope}beads/?limit=32`);
      expect(state.status).toBe(200);
      context(state, "pos-0");
      expect(JSON.parse(state.bodyText)).toEqual({ items: [], next: null });
    }),
  45000,
);

it(
  "installed anonymous mutation creates no disposition before same-key authenticated success",
  async () =>
    installed("anonymous", async (session) => {
      const input = create("anonymous-key"),
        key = "same-key-after-anonymous";
      const anonymous = await session.exchange(
        "POST",
        session.targets.createBead ?? "missing",
        input,
        key,
        true,
      );
      expect(anonymous.status).toBe(401);
      const missing = await session.exchange("GET", `${scope}beads/anonymous-key`);
      expect(missing.status).toBe(404);
      context(missing, "pos-0");
      const accepted = await receipt(session, "createBead", input, key);
      context(accepted.response, "pos-1");
      const current = await session.exchange("GET", `${scope}beads/anonymous-key`);
      expect(current.status).toBe(200);
      context(current, "pos-1");
      expect(JSON.parse(current.bodyText)).toEqual(
        (accepted.value.results as { resource: unknown }[])[0]?.resource,
      );
      const replay = await receipt(session, "createBead", input, key);
      context(replay.response, "pos-1");
      nonAdmissionOracle(anonymous, accepted.value, replay.value);
      const listing = await session.exchange("GET", `${scope}beads/?limit=32`);
      context(listing, "pos-1");
      expect(JSON.parse(listing.bodyText)).toEqual({
        items: [JSON.parse(current.bodyText)],
        next: null,
      });
    }),
  45000,
);

it(
  "installed alias uniqueness precedes target lookup and alias deletion releases only its path",
  async () =>
    installed("uniqueness", async (session) => {
      const historical = await receipt(
        session,
        "createBead",
        create("reserved"),
        "reserved-create",
      );
      const original = (historical.value.results as { resource: { revision: string } }[])[0]
        ?.resource;
      expect(original?.revision).toBeTypeOf("string");
      await receipt(
        session,
        "deleteBead",
        { bead: "beads/reserved", expectedRevision: original?.revision },
        "reserved-delete",
      );
      const collision = await receipt(
        session,
        "putAlias",
        { alias: "alias/reserved", target: "beads/unknown" },
        "reserved-put",
        "failed",
        "identity-taken",
        "never",
      );
      context(collision.response, "pos-2");
      const target = await receipt(session, "createBead", create("target"), "target-create");
      const aliasCreated = await receipt(
        session,
        "putAlias",
        { alias: "alias/live", target: "beads/target" },
        "live-put",
      );
      context(aliasCreated.response, "pos-3");
      expect(aliasCreated.value).not.toHaveProperty("effectPosition");
      const held = await receipt(
        session,
        "createBead",
        create("live"),
        "live-collision",
        "failed",
        "alias-path-taken",
        "after-state-change",
      );
      context(held.response, "pos-3");
      const redirected = await session.exchange("GET", `${scope}alias/live`);
      expect(redirected.status).toBe(307);
      expect(redirected.headers.location).toBe(`${scope}beads/target`);
      context(redirected, "pos-3");
      const aliasDeleted = await receipt(
        session,
        "deleteAlias",
        { alias: "alias/live" },
        "live-delete",
      );
      context(aliasDeleted.response, "pos-3");
      expect(aliasDeleted.value).not.toHaveProperty("effectPosition");
      const released = await receipt(session, "createBead", create("live"), "live-new-key");
      context(released.response, "pos-4");
      const current = await session.exchange("GET", `${scope}beads/live`);
      expect(current.status).toBe(200);
      context(current, "pos-4");
      expect(JSON.parse(current.bodyText)).toEqual(
        (released.value.results as { resource: unknown }[])[0]?.resource,
      );
      const unchanged = await session.exchange("GET", `${scope}beads/target`);
      expect(unchanged.status).toBe(200);
      expect(JSON.parse(unchanged.bodyText)).toEqual(
        (target.value.results as { resource: unknown }[])[0]?.resource,
      );
      const reserved = await session.exchange("GET", `${scope}beads/reserved`);
      expect(reserved.status).toBe(404);
      context(reserved, "pos-4");
    }),
  45000,
);
