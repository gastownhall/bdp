/** Partial read.alias.resolution over real installed TX HTTP; no profile claim. */
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
import { createJsonSchemaValidator, createRawHttpExchangeExecutor } from "@bdp/conformance";
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
  ): Promise<{
    child: ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const scope = "https://reference.invalid/acme/";
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"] as const;
type Response = {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  bodyText: string;
  bodyOctets?: number;
};
function context(headers: Response["headers"]) {
  return Object.fromEntries(
    contextNames.map((name) => {
      const value = headers[name];
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value))
        throw new Error(`invalid observed context: ${name}`);
      return [name, value];
    }),
  );
}
function redirect(response: Response, target: string, expectedContext: Record<string, string>) {
  expect(response.status).toBe(307);
  expect(response.headers.location).toBe(target);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers["content-length"]).toBe("0");
  expect(response.headers.etag).toBeUndefined();
  expect(response.bodyOctets).toBe(0);
  expect(response.bodyText).toBe("");
  expect(context(response.headers)).toEqual(expectedContext);
}

it("alias redirect oracle rejects representation, wrong target, missing fields and body", () => {
  const headers = {
    location: scope + "beads/a",
    "cache-control": "private, no-store",
    "content-length": "0",
    "bdp-scope-epoch": "epoch",
    "bdp-authorization-view": "view",
    "bdp-scope-position": "pos-1",
  };
  const valid = { status: 307, headers, bodyText: "", bodyOctets: 0 };
  const expected = context(headers);
  redirect(valid, scope + "beads/a", expected);
  for (const changed of [
    { ...valid, status: 200 },
    { ...valid, headers: { ...headers, location: scope + "beads/b" } },
    { ...valid, bodyText: "{}", bodyOctets: 2 },
    ...Object.keys(headers).map((name) => ({
      ...valid,
      headers: Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name)),
    })),
    ...contextNames.map((name) => ({ ...valid, headers: { ...headers, [name]: "" } })),
  ])
    expect(() => redirect(changed, scope + "beads/a", expected)).toThrow();
});

type AliasReceivingPlan = { stage: string; method: string; url: string };
function queryRefusal(plan: AliasReceivingPlan, response: Response) {
  // Donna's exact receiving-stage ruling; never derive this exception from status/code.
  if (
    plan.stage !== "PRE_OWNER_QUERY_ALIAS" ||
    (plan.method !== "GET" && plan.method !== "HEAD") ||
    plan.url !== `${scope}alias/work?query=1`
  )
    throw new Error("not the declared pre-owner query-alias probe");
  expect(response.status).toBe(404);
  expect(response.headers.location).toBeUndefined();
  expect(response.headers["cache-control"]).toBe("private, no-store");
  for (const name of contextNames) expect(response.headers[name]).toBeUndefined();
  if (plan.method === "GET")
    expect(JSON.parse(response.bodyText)).toMatchObject({
      code: "resource-not-found",
      status: 404,
    });
  else {
    expect(response.bodyText).toBe("");
    expect(response.bodyOctets).toBe(0);
  }
}
it("alias query receiving oracle cannot exempt owner404 or stale200", () => {
  const plan = { stage: "PRE_OWNER_QUERY_ALIAS", method: "GET", url: `${scope}alias/work?query=1` };
  const response = {
    status: 404,
    headers: { "cache-control": "private, no-store" },
    bodyText: JSON.stringify({ code: "resource-not-found", status: 404 }),
    bodyOctets: 42,
  };
  queryRefusal(plan, response);
  for (const other of [
    { ...plan, stage: "OWNER_OBSERVED" },
    { ...plan, url: `${scope}alias/missing` },
    { ...plan, url: `${scope}alias/work` },
    { ...plan, method: "POST" },
  ])
    expect(() => queryRefusal(other, response)).toThrow();
  expect(() => queryRefusal(plan, { ...response, status: 200 })).toThrow();
  for (const name of contextNames)
    expect(() =>
      queryRefusal(plan, { ...response, headers: { ...response.headers, [name]: "observed" } }),
    ).toThrow();
});

it.each(["normal", "query"] as const)(
  "installed alias Read (%s)",
  async (mode) => {
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
    const fixture = {
      bytes: readFileSync(
        path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
      ),
    };
    const schema = createJsonSchemaValidator(
      JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8")),
    );
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("alias Read cohort deadline")),
      30000,
    );
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-alias-read-"));
    const token = randomBytes(32).toString("base64url");
    const type = scope + "types/task",
      propertiesSchema = scope + "schemas/title";
    const artifacts = {
      descriptors: [
        {
          retrievalUri: type,
          utf8: JSON.stringify({
            id: type,
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
    const configuration = {
      scope,
      directory,
      create: true,
      artifacts,
      credentials: [{ token, principal: "writer", canMutate: true }],
    };
    let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
    let childClosed: Promise<void> | undefined;
    let binding: unknown, failure: unknown;
    const cleanupErrors: unknown[] = [],
      observations: unknown[] = [];
    const childChannels = { stdout: [] as string[], stderr: [] as string[] };
    let directoryAbsent = false;
    try {
      child = await launchInstalledTransaction(entry, configuration, controller.signal);
      const process = child.child;
      childClosed = new Promise((resolve) => process.once("close", () => resolve()));
      process.stdout?.on("data", (chunk: Buffer) =>
        childChannels.stdout.push(chunk.toString("base64")),
      );
      process.stderr?.on("data", (chunk: Buffer) =>
        childChannels.stderr.push(chunk.toString("base64")),
      );
      binding = installedTransactionBinding(child.ready, sourceCommit, fixture);
      const address = new URL(child.ready.listenUrl as string);
      let attempts = 0;
      const exchange = async (
        method: "GET" | "HEAD" | "POST",
        relative: string,
        input?: unknown,
      ) => {
        if (++attempts > 14) throw new Error("alias exchange ceiling");
        const url = new URL(relative, scope).href;
        if (
          !new Set([
            scope + "bdp.json",
            scope + "operations/batch",
            scope + "operations/put-alias",
            scope + "alias/work",
            scope + "alias/missing",
            scope + "alias/work?query=1",
          ]).has(url)
        )
          throw new Error("undeclared alias test route");
        const body = input === undefined ? undefined : JSON.stringify(input);
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
        const response = await execute({
          method,
          url,
          signal: controller.signal,
          credentialRef: "writer",
          raw: {
            headerLines: [
              { name: "accept", value: "application/json" },
              ...(body === undefined
                ? []
                : [
                    { name: "content-type", value: "application/json" },
                    { name: "idempotency-key", value: `alias_read_${attempts}` },
                  ]),
            ],
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(body) }),
          },
        });
        observations.push({
          method,
          url,
          requestBody: body,
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
      const discovery = await exchange("GET", "bdp.json");
      expect(discovery.status).toBe(200);
      const discovered = JSON.parse(discovery.bodyText);
      expect(schema.validate("#/$defs/transactionalDiscovery", discovered)).toEqual([]);
      expect(discovered.aliases).toBe(scope + "alias/");
      const mutate = async (relative: string, input: unknown) => {
        const response = await exchange("POST", relative, input);
        expect(response.status, response.bodyText).toBe(200);
        const receipt = JSON.parse(response.bodyText);
        expect(schema.validate("#/$defs/mutationReceipt", receipt)).toEqual([]);
        expect(receipt.status).toBe("completed");
        expect(context(response.headers)["bdp-scope-position"]).toBe("pos-1");
        return response;
      };
      await mutate("operations/batch", {
        operations: ["a", "b"].map((id) => ({
          operation: "createBead",
          id: `beads/${id}`,
          type,
          properties: { title: id },
        })),
      });
      const aliased = await mutate("operations/put-alias", {
        alias: "alias/work",
        target: "beads/a",
      });
      const expected = context(aliased.headers);
      if (mode === "normal") {
        for (const method of ["GET", "HEAD"] as const)
          redirect(await exchange(method, "alias/work"), scope + "beads/a", expected);
        const repointed = await mutate("operations/put-alias", {
          alias: "alias/work",
          target: "beads/b",
        });
        expect(context(repointed.headers)).toEqual(expected);
        for (const method of ["GET", "HEAD"] as const)
          redirect(await exchange(method, "alias/work"), scope + "beads/b", expected);
        for (const relative of ["alias/missing"]) {
          for (const method of ["GET", "HEAD"] as const) {
            const response = await exchange(method, relative);
            expect(response.status).toBe(404);
            expect(response.headers.location).toBeUndefined();
            expect(response.headers["cache-control"]).toBe("private, no-store");
            expect(context(response.headers)).toEqual(expected);
            if (method === "HEAD") {
              expect(response.bodyOctets).toBe(0);
              expect(response.bodyText).toBe("");
            } else {
              const problem = JSON.parse(response.bodyText);
              expect(schema.validate("#/$defs/transactionalProblem", problem)).toEqual([]);
              expect(problem).toMatchObject({ code: "resource-not-found", status: 404 });
            }
          }
        }
        expect(attempts).toBe(10);
      } else {
        const pair = [];
        for (const method of ["GET", "HEAD"] as const) {
          const response = await exchange(method, "alias/work?query=1");
          queryRefusal(
            { stage: "PRE_OWNER_QUERY_ALIAS", method, url: `${scope}alias/work?query=1` },
            response,
          );
          if (method === "GET")
            expect(
              schema.validate("#/$defs/transactionalProblem", JSON.parse(response.bodyText)),
            ).toEqual([]);
          pair.push(response);
        }
        for (const name of ["content-type", "content-length", "cache-control"])
          expect(pair[1]?.headers[name]).toBe(pair[0]?.headers[name]);
        expect(attempts).toBe(5);
      }
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      try {
        await child?.close();
        await childClosed;
        expect(child?.child.exitCode).toBe(0);
        expect(child?.child.signalCode).toBeNull();
        expect(child?.child.stdout?.readableEnded).toBe(true);
        expect(child?.child.stderr?.readableEnded).toBe(true);
        rmSync(directory, { recursive: true, force: false });
        directoryAbsent = !existsSync(directory);
        expect(directoryAbsent).toBe(true);
      } catch (error) {
        cleanupErrors.push(error);
      }
      const report = {
        kind: "installed-read-alias-resolution-partial",
        mode,
        sourceCommit,
        entry,
        entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
        binding,
        configuration: {
          ...configuration,
          credentials: configuration.credentials.map(({ principal, canMutate }) => ({
            principal,
            canMutate,
            token: "<redacted>",
          })),
        },
        artifacts,
        observations,
        childChannels,
        child: {
          pid: child?.child.pid,
          exit: child?.child.exitCode,
          signal: child?.child.signalCode,
          stdoutEOF: child?.child.stdout?.readableEnded,
          stderrEOF: child?.child.stderr?.readableEnded,
        },
        directoryAbsent,
        failureCount: (failure === undefined ? 0 : 1) + cleanupErrors.length,
        wholeContract: false,
        claimEligible: false,
      };
      if (process.env.BDP_ALIAS_READ_OUTPUT)
        writeFileSync(
          `${process.env.BDP_ALIAS_READ_OUTPUT}.${mode}.json`,
          JSON.stringify(report, null, 2) + "\n",
          {
            mode: 0o600,
          },
        );
      console.log(
        JSON.stringify({
          kind: report.kind,
          requests: observations.length,
          child: report.child,
          directoryAbsent,
          failureCount: report.failureCount,
          claimEligible: false,
        }),
      );
    }
    if (failure !== undefined || cleanupErrors.length)
      throw new AggregateError(
        [...(failure === undefined ? [] : [failure]), ...cleanupErrors],
        "installed alias Read failed",
      );
  },
  45000,
);
