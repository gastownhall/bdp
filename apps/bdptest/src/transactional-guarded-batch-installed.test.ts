/** Private installed guarded-batch witness; no profile qualification or server-admission claim. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request, type ClientRequest, type IncomingHttpHeaders } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isJsonSchemaDateTime, isJsonSchemaUri } from "@bdp/protocol";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
const { launchInstalledTransaction } = (await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
)) as {
  launchInstalledTransaction(
    entry: string,
    configuration: unknown,
    signal?: AbortSignal,
  ): Promise<{
    child: ChildProcess;
    ready: Record<string, unknown>;
    close(): Promise<void>;
  }>;
};
const scope = "https://reference.invalid/acme/";
const beadType = `${scope}types/task`;
const schemaUri = `${scope}schemas/properties`;
const seedKey = "guarded-seed";
const seedId = `${scope}beads/guarded-seed`;
const seedBody =
  '{"operations":[{"operation":"createBead","id":"beads/guarded-seed","type":"https://reference.invalid/acme/types/task","properties":{"title":"guarded-seed"},"metadata":{}}]}';
function contenderBody(side: "a" | "b", revision: string, guarded: boolean) {
  return JSON.stringify({
    operations: [
      {
        operation: "createBead",
        id: `beads/marker-${side}`,
        type: beadType,
        properties: { title: `marker-${side}` },
        metadata: {},
      },
      {
        operation: "updateBead",
        bead: seedId,
        ...(guarded ? { expectedRevision: revision } : {}),
        propertiesChange: [{ op: "replace", path: "/title", value: `winner-${side}` }],
      },
    ],
  });
}
const artifacts = {
  descriptors: [
    {
      retrievalUri: beadType,
      utf8: '{"id":"https://reference.invalid/acme/types/task","name":"Task","describes":"bead","conformsTo":[],"propertiesSchema":"https://reference.invalid/acme/schemas/properties"}',
    },
  ],
  schemas: [
    {
      retrievalUri: schemaUri,
      utf8: '{"$id":"https://reference.invalid/acme/schemas/properties","type":"object","properties":{"title":{"type":"string"}},"required":["title"],"additionalProperties":false}',
    },
  ],
};
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const entryOverride = process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY;
if (entryOverride && !process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
  throw new Error("guarded-batch entry override requires declared source commit");
const entry = realpathSync(
  entryOverride ?? path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
const entrySha256 = sha(readFileSync(entry));
const declaredSourceCommit =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(declaredSourceCommit)) throw new Error("invalid declared source commit");
const workspaceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).length > 0;
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const mode = process.env.BDP_TRANSACTIONAL_GUARDED_BATCH_MODE ?? "positive";
if (mode !== "positive" && mode !== "unguarded-contenders")
  throw new Error("invalid guarded-batch mode");
const output = process.env.BDP_TRANSACTIONAL_GUARDED_BATCH_OUTPUT;
const safeHeaderNames = [
  "content-type",
  "content-length",
  "cache-control",
  "x-bdp-development",
  "vary",
  "location",
  "retry-after",
  "bdp-scope-epoch",
  "bdp-authorization-view",
  "bdp-scope-position",
] as const;
function outside(candidate: string, parent: string) {
  const relative = path.relative(parent, candidate);
  if (
    !relative ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
    throw new Error("guarded-batch evidence/store path must be outside protected directory");
}
function resolvedOutput(filename: string) {
  if (!path.isAbsolute(filename)) throw new Error("guarded-batch output must be absolute");
  const resolved = path.join(realpathSync(path.dirname(filename)), path.basename(filename));
  outside(resolved, root);
  if (existsSync(resolved)) throw new Error("guarded-batch output must be exclusive");
  return resolved;
}
const reportPath = output === undefined ? undefined : resolvedOutput(output);
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("guarded-batch expected JSON object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length)
    throw new Error("guarded-batch expected nonempty string");
  return value;
}
function ownedUrl(value: unknown, collection: "receipts" | "beads") {
  const literal = text(value),
    url = new URL(literal),
    prefix = `${scope}${collection}/`;
  if (
    literal.length > 8192 ||
    Buffer.byteLength(literal) > 8192 ||
    url.href !== literal ||
    !literal.startsWith(prefix) ||
    !/^[A-Za-z0-9_-]+$/.test(literal.slice(prefix.length)) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("guarded-batch invalid issued authority URL");
  return literal;
}
function position(value: unknown) {
  const literal = text(value);
  if (!/^pos-(0|[1-9][0-9]*)$/.test(literal) || !Number.isSafeInteger(Number(literal.slice(4))))
    throw new Error("guarded-batch invalid position");
  return Number(literal.slice(4));
}
type Wire = { index: number; status: number; headers: IncomingHttpHeaders; body: unknown };
type Receipt = {
  body: Record<string, unknown>;
  id: string;
  transaction: string;
  epoch: string;
  view: string;
  key: string;
  resources: Record<string, unknown>[];
  effect: number | null;
  failed: boolean;
};
type Milestone = {
  order: number;
  request: number;
  kind: string;
  elapsedMs: number;
  socket: number | null;
};
type ResponseObservation = {
  index: number;
  method: string;
  url: string;
  sentKey: string | null;
  requestBodyBytes: number;
  requestBodySha256: string | null;
  status: number;
  bodyBytes: number;
  bodySha256: string;
  headers: Record<string, string | null>;
};

it("preserves one guarded batch winner and rolls back the losing marker through installed HTTP", async () => {
  const started = performance.now(),
    work = new AbortController();
  const failures: unknown[] = [],
    active = new Set<ClientRequest>();
  const pending: Promise<Wire>[] = [],
    closing: Promise<void>[] = [];
  const responses: ResponseObservation[] = [],
    milestones: Milestone[] = [];
  const receiptObservations: {
    index: number;
    id: string;
    transaction: string;
    key: string;
    status: string;
    resources: { id: string; revision: string }[];
    effectPosition: string | null;
    requiredPosition: string;
    servingPosition: string;
    problem: Record<string, unknown> | null;
  }[] = [];
  const performed: string[] = [];
  const requestSockets = new Map<number, number>();
  const sockets = new Map<object, number>();
  const liveSockets = new Set<Socket>();
  let maximumLiveSockets = 0;
  let milestoneOverflow = false,
    deadlineExceeded = false,
    cleanupExceeded = false,
    drainExceeded = false;
  let directory: string | undefined, temporaryRoot: string | undefined;
  let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
  let binding: ReturnType<typeof installedTransactionBinding> | undefined;
  let projectionSha256: string | null = null;
  let launchAttempted = false,
    closed = false,
    attempted = 0;
  let currentAssertion = "guarded-batch:setup",
    failedAssertion: string | null = null;
  type Phase = "setup" | "launch" | "transport" | "oracle" | "inconclusive";
  let phase: Phase = "setup",
    failedPhase: Phase | null = null;
  let reportWriteFailed = false,
    reportOverflow = false;
  let inconclusivePending = false;
  const prerequisites = {
    seedSchemaAndLiterals: false,
    pairSchemasAndLiterals: false,
    dispatchDiscipline: false,
    controlTwoCompletedEffects: false,
  };
  let completedContenderCount: number | null = null,
    failedContenderCount: number | null = null;
  let selectedWinner: string | null = null,
    selectedLoser: string | null = null;
  let revisionEncodingBytes: number | null = null;
  let bothConnectedBeforeFirstResponse = false,
    bothWritesPrecededFirstResponse = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    work.abort(new Error("guarded-batch work deadline"));
  }, 45000);
  function destroyActive() {
    for (const req of active) req.destroy();
    for (const socket of liveSockets) socket.destroy();
  }
  work.signal.addEventListener("abort", destroyActive);
  function mark(index: number, kind: string) {
    if (index < 2 || index > 3 || milestones.some((m) => m.request === index && m.kind === kind))
      return;
    if (milestones.length >= 32) {
      milestoneOverflow = true;
      return;
    }
    milestones.push({
      order: milestones.length,
      request: index,
      kind,
      elapsedMs: performance.now() - started,
      socket: requestSockets.get(index) ?? null,
    });
  }
  function check(name: string, assertion: () => void) {
    phase = "oracle";
    currentAssertion = `guarded-batch:${name}`;
    assertion();
    performed.push(name);
  }
  function addFailure(error: unknown) {
    if (!failures.includes(error)) failures.push(error);
  }
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addFormat("uri", { type: "string", validate: isJsonSchemaUri });
    ajv.addFormat("date-time", { type: "string", validate: isJsonSchemaDateTime });
    const bundle = JSON.parse(
      readFileSync(path.join(root, "specs/profiles/core/bdp-v0.schema.json"), "utf8"),
    );
    ajv.addSchema(bundle);
    const validators = Object.fromEntries(
      ["mutationReceipt", "beadRecord", "currentBeadCollection", "eventPage"].map(
        (name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })] as const,
      ),
    );
    function checked(value: unknown, name: string) {
      const validate = validators[name];
      if (!validate) throw new Error("guarded-batch unbound schema");
      expect(validate(value), `guarded-batch:schema:${name}`).toBe(true);
      return record(value);
    }
    check("literal-inputs", () => {
      expect([Buffer.byteLength(seedBody), sha(seedBody)]).toStrictEqual([
        172,
        "a1937453b366087694cc040cc81534d1d073fed0e0bcc09b0fc6de39304ef3f0",
      ]);
      // A reference specimen measures construction only; it is never sent.
      const reference = "00000000-0000-4000-8000-000000000000";
      for (const [side, guardedHash, controlHash] of [
        [
          "a",
          "386fc744c79e39fe4428c6a77c4d7b7b885dc18b41e2b90f1acdf0e0df5fb226",
          "f707e87dc9ec95f6f564940d3fc097b6880aeeeda9ac493981d9a4344bb5a91d",
        ],
        [
          "b",
          "59f91799860c3fa0957c4e93fe3bd57fd94621b992da4772b67307329bde0e70",
          "bbc04ffd826ba2519b86b4a22e47eff5566d2bb5ec90f45fe6ecb8779f6148a5",
        ],
      ] as const) {
        const guarded = contenderBody(side, reference, true),
          unguarded = contenderBody(side, reference, false);
        expect([Buffer.byteLength(guarded), sha(guarded)]).toStrictEqual([381, guardedHash]);
        expect([Buffer.byteLength(unguarded), sha(unguarded)]).toStrictEqual([323, controlHash]);
        const withoutGuard = JSON.parse(guarded);
        delete withoutGuard.operations[1].expectedRevision;
        expect(JSON.parse(unguarded)).toStrictEqual(withoutGuard);
      }
      expect(
        artifacts.descriptors.map((a) => [Buffer.byteLength(a.utf8), sha(a.utf8)]),
      ).toStrictEqual([[170, "f448e126550b2809d01dc6b24811d1796e82b2599c35b438550ed3bec65a2a22"]]);
      expect(artifacts.schemas.map((a) => [Buffer.byteLength(a.utf8), sha(a.utf8)])).toStrictEqual([
        [166, "1ed8b24d90a8c278bc466fd48ba1e849afac01326c377e5c6985855e62373f95"],
      ]);
    });
    phase = "setup";
    temporaryRoot = realpathSync(tmpdir());
    outside(temporaryRoot, root);
    directory = realpathSync(mkdtempSync(path.join(temporaryRoot, "bdp-guarded-batch-installed-")));
    outside(directory, root);
    if (reportPath) outside(reportPath, directory);
    for (let i = 0; i < process.argv.length; i++) {
      const argument = process.argv[i]!;
      let filename: string | undefined;
      if (argument === "--outputFile") {
        filename = process.argv[++i];
        if (filename?.startsWith("-")) throw new Error("guarded-batch missing outputFile value");
      } else if (argument.startsWith("--outputFile=")) filename = argument.slice(13);
      else continue;
      if (!filename) throw new Error("guarded-batch missing outputFile value");
      outside(path.resolve(filename), directory);
    }
    const token = randomBytes(24).toString("base64url");
    expect(/^[A-Za-z0-9_-]{32}$/.test(token), "guarded-batch token shape").toBe(true);
    const configuration = {
      scope,
      directory,
      create: true,
      artifacts,
      credentials: [{ token, principal: "writer", canMutate: true }],
    };
    // Supplemental nonsecret projection; the actual served identities below remain authoritative.
    projectionSha256 = sha(
      JSON.stringify({
        scope,
        directory,
        create: true,
        artifacts,
        credentials: [
          { token: { length: 32, charset: "base64url" }, principal: "writer", canMutate: true },
        ],
      }),
    );
    work.signal.throwIfAborted();
    phase = "launch";
    currentAssertion = "guarded-batch:launch";
    launchAttempted = true;
    child = await launchInstalledTransaction(entry, configuration, work.signal);
    binding = installedTransactionBinding(child.ready, declaredSourceCommit, fixture);
    check("ready-targets", () => {
      expect(child?.ready.scope).toBe(scope);
      expect(child?.ready.authorityMode).toBe("canonical");
      expect(child?.ready.claimEligible).toBe(false);
      expect(binding?.operationTargets.batch).toBe(`${scope}operations/batch`);
    });
    const address = new URL(text(child.ready.listenUrl));
    // installedTransactionBinding independently checks the exact loopback URL and all targets.
    let receiptUrl: string | undefined,
      replayBody: string | undefined,
      replayKey: string | undefined;
    let aBody: string | undefined, bBody: string | undefined;
    function send(index: number): Promise<Wire> {
      work.signal.throwIfAborted();
      if (attempted >= (mode === "positive" ? 7 : 3) || index !== attempted + 1)
        throw new Error("guarded-batch dispatch ceiling/order");
      phase = "transport";
      currentAssertion = `guarded-batch:transport-${index}`;
      const method = index <= 4 ? "POST" : "GET";
      const literal =
        index <= 4
          ? `${scope}operations/batch`
          : index === 5
            ? receiptUrl
            : index === 6
              ? `${scope}beads/?limit=32`
              : `${scope}events/`;
      if (!literal) throw new Error("guarded-batch missing issued receipt root");
      const url = new URL(literal);
      if (
        url.href !== literal ||
        url.origin !== new URL(scope).origin ||
        url.hash ||
        url.username ||
        url.password ||
        (index === 6 ? url.search !== "?limit=32" : !!url.search)
      )
        throw new Error("guarded-batch route grant");
      if (index === 5) ownedUrl(literal, "receipts");
      const body =
        index === 1
          ? seedBody
          : index === 2
            ? aBody
            : index === 3
              ? bBody
              : index === 4
                ? replayBody
                : undefined;
      const sentKey =
        index === 1
          ? seedKey
          : index === 2
            ? "guarded-a"
            : index === 3
              ? "guarded-b"
              : index === 4
                ? replayKey
                : undefined;
      if (method === "POST" && (body === undefined || sentKey === undefined))
        throw new Error("guarded-batch missing frozen request");
      const headers: Record<string, string> = {
        Host: url.host,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Connection: "close",
      };
      if (body !== undefined) {
        if (Buffer.byteLength(body) > 65536) throw new Error("guarded-batch request body ceiling");
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(body));
        headers["Idempotency-Key"] = sentKey!;
      }
      if (
        Buffer.byteLength(
          Object.entries(headers)
            .map(([name, value]) => `${name}: ${value}\r\n`)
            .join("") + "\r\n",
        ) > 16384
      )
        throw new Error("guarded-batch request header ceiling");
      attempted++;
      mark(index, "invoked");
      const promise = new Promise<Wire>((resolve, reject) => {
        let settled = false;
        const req = request({
          host: address.hostname,
          port: Number(address.port),
          method,
          path: url.pathname + url.search,
          headers,
          agent: false,
          maxHeaderSize: 16384,
        });
        active.add(req);
        closing.push(
          new Promise<void>((done) =>
            req.once("close", () => {
              active.delete(req);
              mark(index, "request-close");
              done();
            }),
          ),
        );
        const timeout = setTimeout(() => fail(new Error("guarded-batch request deadline")), 5000);
        const onAbort = () => fail(new Error("guarded-batch request aborted"));
        function finish(error: unknown, result?: Wire) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          work.signal.removeEventListener("abort", onAbort);
          mark(index, "settled");
          if (error !== undefined) reject(error);
          else resolve(result!);
        }
        function fail(error: unknown) {
          req.destroy();
          finish(error);
        }
        work.signal.addEventListener("abort", onAbort, { once: true });
        req.once("socket", (socket) => {
          if (!sockets.has(socket)) sockets.set(socket, sockets.size + 1);
          requestSockets.set(index, sockets.get(socket)!);
          mark(index, "socket-assigned");
          socket.once("connect", () => mark(index, "connected"));
          liveSockets.add(socket);
          maximumLiveSockets = Math.max(maximumLiveSockets, liveSockets.size);
          closing.push(
            new Promise<void>((done) =>
              socket.once("close", () => {
                liveSockets.delete(socket);
                mark(index, "socket-close");
                done();
              }),
            ),
          );
        });
        req.once("finish", () => mark(index, "finish"));
        req.once("error", (error) => {
          mark(index, "error");
          finish(error);
        });
        req.once("response", (response) => {
          mark(index, "response-start");
          const chunks: Buffer[] = [];
          let bytes = 0,
            ended = false;
          response.on("data", (chunk: Buffer) => {
            if (settled) return;
            if (bytes + chunk.length > 32768) {
              response.destroy();
              fail(new Error("guarded-batch response body ceiling"));
              return;
            }
            bytes += chunk.length;
            chunks.push(chunk);
          });
          response.once("aborted", () => {
            mark(index, "aborted");
            fail(new Error("guarded-batch response aborted"));
          });
          response.once("error", (error) => fail(error));
          response.once("close", () => {
            mark(index, "response-close");
            if (!ended) fail(new Error("guarded-batch incomplete response"));
          });
          response.once("end", () => {
            ended = true;
            mark(index, "response-end");
            if (settled) return;
            try {
              if (!response.complete || !bytes)
                throw new Error("guarded-batch empty or incomplete response");
              const raw = Buffer.concat(chunks, bytes);
              const safeHeaders = Object.fromEntries(
                safeHeaderNames.map((name) => [
                  name,
                  typeof response.headers[name] === "string"
                    ? (response.headers[name] as string)
                    : null,
                ]),
              );
              // Retain actual completed fingerprints before decoding or any oracle can fail.
              responses.push({
                index,
                method,
                url: literal,
                sentKey: sentKey ?? null,
                requestBodyBytes: body === undefined ? 0 : Buffer.byteLength(body),
                requestBodySha256: body === undefined ? null : sha(body),
                status: response.statusCode ?? 0,
                bodyBytes: bytes,
                bodySha256: sha(raw),
                headers: safeHeaders,
              });
              const value: unknown = JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(raw),
              );
              if (value === null) throw new Error("guarded-batch null response body");
              finish(undefined, {
                index,
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: value,
              });
            } catch (error) {
              fail(error);
            }
          });
        });
        mark(index, "end-called");
        req.end(body);
      });
      // The second dispatch is synchronous; neither rejection waits for allSettled registration.
      void promise.catch(() => undefined);
      pending.push(promise);
      return promise;
    }
    function header(wire: Wire, name: string) {
      return text(wire.headers[name]);
    }
    function current(wire: Wire, epoch?: string, view?: string) {
      const e = header(wire, "bdp-scope-epoch"),
        v = header(wire, "bdp-authorization-view");
      if (epoch !== undefined) expect(e).toBe(epoch);
      if (view !== undefined) expect(v).toBe(view);
      expect(header(wire, "content-type")).toBe("application/json");
      expect(header(wire, "cache-control")).toBe("private, no-store");
      expect(header(wire, "x-bdp-development")).toBe("non-attesting");
      expect(Number(header(wire, "content-length"))).toBe(
        responses.find((r) => r.index === wire.index)?.bodyBytes,
      );
      if (wire.index <= 4) expect(header(wire, "vary").toLowerCase()).toBe("accept");
      return position(header(wire, "bdp-scope-position"));
    }
    let seedRevision: string | undefined;
    function receipt(wire: Wire, sentKey: string, side?: "a" | "b"): Receipt {
      phase = "oracle";
      currentAssertion = `guarded-batch:receipt-${wire.index}`;
      const body = checked(wire.body, "mutationReceipt");
      if (body.status === "pending") {
        inconclusivePending = true;
        phase = "inconclusive";
        throw new Error("guarded-batch unexpected pending receipt");
      }
      expect(wire.status).toBe(200);
      const id = ownedUrl(body.id, "receipts"),
        transaction = text(body.transaction),
        epoch = text(body.scopeEpoch),
        view = text(body.authorizationView);
      expect(body.idempotencyKey).toBe(sentKey);
      expect(body.detail).toBe("available");
      const serving = current(wire, epoch, view),
        required = position(body.requiredPosition);
      const resources: Record<string, unknown>[] = [];
      const failed = body.status === "failed";
      let effect: number | null = null;
      const core = {
        id,
        idempotencyKey: sentKey,
        scopeEpoch: epoch,
        authorizationView: view,
        transaction,
      };
      if (failed) {
        expect(mode).toBe("positive");
        expect(side).toBeDefined();
        expect(required).toBe(2);
        expect(serving).toBe(2);
        expect(body).toStrictEqual({
          ...core,
          status: "failed",
          detail: "available",
          requiredPosition: "pos-2",
          problem: {
            type: "https://github.com/gastownhall/bdp/problems/conflict",
            code: "revision-mismatch",
            status: 409,
            retry: "after-state-change",
            operationIndex: 1,
          },
          expiresAt: body.expiresAt,
        });
      } else {
        expect(body.status).toBe("completed");
        expect(Array.isArray(body.results)).toBe(true);
        const results = body.results as unknown[];
        expect(results).toHaveLength(side === undefined ? 1 : 2);
        for (const [i, result] of results.entries()) {
          const resource = checked(record(result).resource, "beadRecord");
          const revision = text(resource.revision);
          const id = side === undefined || i === 1 ? seedId : `${scope}beads/marker-${side}`;
          const title =
            side === undefined ? "guarded-seed" : i === 0 ? `marker-${side}` : `winner-${side}`;
          expect(resource).toStrictEqual({
            id,
            type: beadType,
            revision,
            properties: { title },
            metadata: {},
          });
          if (side !== undefined && i === 1) expect(revision).not.toBe(seedRevision);
          resources.push(resource);
        }
        effect = position(body.effectPosition);
        expect(required).toBe(effect);
        if (side === undefined) {
          expect(effect).toBe(1);
          expect(serving).toBe(1);
        } else if (mode === "positive") {
          expect(effect).toBe(2);
          expect(serving).toBe(2);
        } else {
          expect([2, 3]).toContain(effect);
          expect(serving).toBeGreaterThanOrEqual(effect);
          expect(serving).toBeLessThanOrEqual(3);
        }
        expect(body).toStrictEqual({
          ...core,
          status: "completed",
          detail: "available",
          requiredPosition: body.requiredPosition,
          effectPosition: body.effectPosition,
          results: resources.map((resource, i) => ({
            operationIndex: i,
            outcome: i === 0 ? "created" : "updated",
            resource,
          })),
          next: null,
          expiresAt: body.expiresAt,
        });
      }
      receiptObservations.push({
        index: wire.index,
        id,
        transaction,
        key: sentKey,
        status: text(body.status),
        resources: resources.map((r) => ({ id: text(r.id), revision: text(r.revision) })),
        effectPosition: effect === null ? null : text(body.effectPosition),
        requiredPosition: text(body.requiredPosition),
        servingPosition: header(wire, "bdp-scope-position"),
        problem: failed ? record(body.problem) : null,
      });
      performed.push(`receipt-${wire.index}-schema-and-literals`);
      return { body, id, transaction, epoch, view, key: sentKey, resources, effect, failed };
    }
    const seedWire = await send(1);
    await Promise.all(closing);
    const seed = receipt(seedWire, seedKey);
    prerequisites.seedSchemaAndLiterals = true;
    seedRevision = text(seed.resources[0]!.revision);
    revisionEncodingBytes = Buffer.byteLength(JSON.stringify(seedRevision));
    check("captured-revision-and-bodies", () => {
      expect(revisionEncodingBytes).toBeLessThanOrEqual(128);
      aBody = contenderBody("a", seedRevision!, mode === "positive");
      bBody = contenderBody("b", seedRevision!, mode === "positive");
      for (const body of [aBody, bBody]) {
        expect(Buffer.byteLength(body)).toBe(
          mode === "positive" ? 343 + revisionEncodingBytes! : 323,
        );
        const update = JSON.parse(body).operations[1];
        if (mode === "positive") expect(update.expectedRevision).toBe(seedRevision);
        else expect(Object.hasOwn(update, "expectedRevision")).toBe(false);
      }
    });
    const originals = [
      { side: "a", key: "guarded-a", body: aBody!, hash: sha(aBody!) },
      { side: "b", key: "guarded-b", body: bBody!, hash: sha(bBody!) },
    ] as const;
    const aPromise = send(2),
      bPromise = send(3);
    const pair = await Promise.allSettled([aPromise, bPromise]);
    const pairErrors = pair.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (pairErrors.length) {
      for (const error of pairErrors) addFailure(error);
      throw pairErrors[0];
    }
    const aWire = (pair[0] as PromiseFulfilledResult<Wire>).value,
      bWire = (pair[1] as PromiseFulfilledResult<Wire>).value;
    await Promise.all(closing);
    check("dispatch-discipline", () => {
      expect(milestoneOverflow).toBe(false);
      const firstSettled = milestones.find((m) => m.kind === "settled")!.order;
      for (const index of [2, 3])
        for (const kind of ["invoked", "end-called"])
          expect(
            milestones.find((m) => m.request === index && m.kind === kind)?.order,
          ).toBeLessThan(firstSettled);
      expect(requestSockets.get(2)).toBeDefined();
      expect(requestSockets.get(3)).toBeDefined();
      expect(requestSockets.get(2)).not.toBe(requestSockets.get(3));
      expect(milestones.filter((m) => m.kind === "response-end")).toHaveLength(2);
      expect(maximumLiveSockets).toBeLessThanOrEqual(2);
      prerequisites.dispatchDiscipline = true;
    });
    const firstResponse = milestones.find((m) => m.kind === "response-start")!.order;
    bothConnectedBeforeFirstResponse = [2, 3].every((i) =>
      milestones.some((m) => m.request === i && m.kind === "connected" && m.order < firstResponse),
    );
    bothWritesPrecededFirstResponse = [2, 3].every((i) =>
      milestones.some((m) => m.request === i && m.kind === "finish" && m.order < firstResponse),
    );
    const a = receipt(aWire, "guarded-a", "a"),
      b = receipt(bWire, "guarded-b", "b");
    completedContenderCount = [a, b].filter((r) => !r.failed).length;
    failedContenderCount = [a, b].filter((r) => r.failed).length;
    check("pair-identities", () => {
      expect(a.id).not.toBe(b.id);
      expect(a.transaction).not.toBe(b.transaction);
      for (const r of [a, b]) expect([r.epoch, r.view]).toStrictEqual([seed.epoch, seed.view]);
      prerequisites.pairSchemasAndLiterals = true;
    });
    if (mode === "unguarded-contenders")
      check("control-prerequisites", () => {
        expect(completedContenderCount).toBe(2);
        expect(failedContenderCount).toBe(0);
        expect([a.effect, b.effect].sort()).toStrictEqual([2, 3]);
        expect(a.resources[1]!.revision).not.toBe(b.resources[1]!.revision);
        expect(attempted).toBe(3);
        expect(responses).toHaveLength(3);
        expect(sockets.size).toBe(3);
        prerequisites.controlTwoCompletedEffects = true;
      });
    check("one-retained-revision-failure", () =>
      expect(failedContenderCount, "guarded-batch:one-retained-revision-failure").toBe(1),
    );
    const loserIndex = a.failed ? 0 : 1,
      winner = a.failed ? b : a,
      loser = a.failed ? a : b;
    const losingInput = originals[loserIndex],
      winningSide = originals[1 - loserIndex]!.side;
    selectedWinner = winner.key;
    selectedLoser = loser.key;
    receiptUrl = loser.id;
    replayBody = losingInput.body;
    replayKey = losingInput.key;
    const losingResponse = responses.find((response) => response.index === loserIndex + 2);
    check("frozen-loser-replay-input", () => {
      expect(losingResponse?.index).toBe((loserIndex === 0 ? aWire : bWire).index);
      expect(losingResponse?.sentKey).toBe(loser.key);
      expect(losingResponse?.sentKey).toBe(replayKey);
      expect(losingResponse?.requestBodySha256).toBe(losingInput.hash);
      expect(losingResponse?.requestBodySha256).toBe(sha(replayBody!));
      expect(losingResponse?.requestBodyBytes).toBe(Buffer.byteLength(replayBody!));
    });
    const replayWire = await send(4);
    await Promise.all(closing);
    const replay = receipt(replayWire, loser.key, losingInput.side);
    check("retained-failure-full-equality", () => {
      const replayResponse = responses.find((response) => response.index === replayWire.index);
      expect(replayResponse?.index).toBe(4);
      expect(replayResponse?.sentKey).toBe(losingResponse?.sentKey);
      expect(replayResponse?.requestBodySha256).toBe(losingResponse?.requestBodySha256);
      expect(replayResponse?.requestBodyBytes).toBe(losingResponse?.requestBodyBytes);
      expect(replay.body).toStrictEqual(loser.body);
    });
    const recoveredWire = await send(5);
    await Promise.all(closing);
    const recovered = receipt(recoveredWire, loser.key, losingInput.side);
    check("issued-failure-full-equality", () => expect(recovered.body).toStrictEqual(loser.body));
    const marker = winner.resources[0]!,
      seedAfter = winner.resources[1]!;
    const collectionWire = await send(6);
    await Promise.all(closing);
    check("complete-rollback-resource-collection", () => {
      expect(collectionWire.status).toBe(200);
      expect(current(collectionWire, seed.epoch, seed.view)).toBe(2);
      expect(checked(collectionWire.body, "currentBeadCollection")).toStrictEqual({
        items: [seedAfter, marker],
        next: null,
      });
    });
    const eventWire = await send(7);
    await Promise.all(closing);
    check("complete-rollback-event-linkage", () => {
      expect(eventWire.status).toBe(200);
      expect(current(eventWire, seed.epoch, seed.view)).toBe(2);
      const page = checked(eventWire.body, "eventPage");
      expect(Array.isArray(page.events)).toBe(true);
      const events = page.events as unknown[];
      expect(events).toHaveLength(3);
      const hash = (tag: string, value: string) =>
        createHash("sha256")
          .update(JSON.stringify([tag, value]))
          .digest("base64url");
      const source = `${scope}events/`;
      const eventId = (p: number, ordinal: number) =>
        `ev_${hash("epoch", header(eventWire, "bdp-scope-epoch"))}_${hash("view", header(eventWire, "bdp-authorization-view"))}_${hash("source", source)}_pos-${p}_${ordinal}`;
      const created = (resource: Record<string, unknown>) => ({
        revision: resource.revision,
        properties: resource.properties,
        metadata: resource.metadata,
      });
      expect(page).toStrictEqual({
        source,
        events: [
          {
            id: eventId(1, 0),
            ordinal: 0,
            type: "created",
            source,
            subject: seedId,
            subjectType: beadType,
            transaction: seed.transaction,
            time: record(events[0]).time,
            data: created(seed.resources[0]!),
          },
          {
            id: eventId(2, 0),
            ordinal: 0,
            type: "created",
            source,
            subject: `${scope}beads/marker-${winningSide}`,
            subjectType: beadType,
            transaction: winner.transaction,
            time: record(events[1]).time,
            data: created(marker),
          },
          {
            id: eventId(2, 1),
            ordinal: 1,
            type: "updated",
            source,
            subject: seedId,
            subjectType: beadType,
            transaction: winner.transaction,
            time: record(events[2]).time,
            data: {
              previousRevision: seedRevision,
              revision: seedAfter.revision,
              change: [{ op: "replace", path: "/title", value: `winner-${winningSide}` }],
            },
          },
        ],
        next: null,
      });
    });
    check("complete-fixed-schedule", () => {
      expect(attempted).toBe(7);
      expect(responses).toHaveLength(7);
      expect(sockets.size).toBe(7);
      expect(responses.map((r) => r.status)).toStrictEqual([200, 200, 200, 200, 200, 200, 200]);
      expect(maximumLiveSockets).toBeLessThanOrEqual(2);
      expect(responses.reduce((sum, r) => sum + r.requestBodyBytes, 0)).toBe(
        172 + 3 * (343 + revisionEncodingBytes!),
      );
    });
  } catch (error) {
    failedAssertion = currentAssertion;
    failedPhase = phase;
    addFailure(error);
  } finally {
    const primaryFailureCount = failures.length;
    clearTimeout(deadline);
    work.abort();
    destroyActive();
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    const drain = Promise.race([
      Promise.allSettled([...pending, ...closing]).then((results) => {
        for (const result of results) if (result.status === "rejected") addFailure(result.reason);
      }),
      new Promise<void>((resolve) => {
        drainTimer = setTimeout(() => {
          drainExceeded = true;
          addFailure(new Error("guarded-batch request cleanup deadline"));
          resolve();
        }, 5000);
      }),
    ]).finally(() => clearTimeout(drainTimer));
    const stop =
      child === undefined
        ? Promise.resolve()
        : child.close().then(() => {
            closed = true;
          }, addFailure);
    await Promise.race([
      Promise.allSettled([drain, stop]).then((results) => {
        for (const result of results) if (result.status === "rejected") addFailure(result.reason);
      }),
      new Promise<void>((resolve) => {
        cleanupTimer = setTimeout(() => {
          cleanupExceeded = true;
          addFailure(new Error("guarded-batch cleanup deadline"));
          child?.child.kill("SIGKILL");
          resolve();
        }, 10000);
      }),
    ]);
    clearTimeout(cleanupTimer);
    work.signal.removeEventListener("abort", destroyActive);
    const stopped =
      !launchAttempted ||
      (child !== undefined && (child.child.exitCode !== null || child.child.signalCode !== null));
    if (child !== undefined && (child.child.exitCode !== 0 || child.child.signalCode !== null))
      addFailure(new Error("guarded-batch child did not exit cleanly"));
    if (launchAttempted && child === undefined)
      addFailure(new Error("guarded-batch pre-ready child stop unknown"));
    if (directory !== undefined && stopped) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        addFailure(error);
      }
    }
    if (directory !== undefined && existsSync(directory))
      addFailure(new Error("guarded-batch owned directory retained"));
    if (deadlineExceeded) addFailure(new Error("guarded-batch work deadline exceeded"));
    if (milestoneOverflow) addFailure(new Error("guarded-batch milestone ceiling"));
    if (liveSockets.size) addFailure(new Error("guarded-batch owned sockets remain"));
    const cleanupFailureCount = failures.length - primaryFailureCount;
    const ready = child?.ready;
    // Explicit allowlist: never retain credentials, runtime configuration, arbitrary errors or raw requests.
    const observation = () => ({
      label: "private-installed-guarded-batch",
      mode,
      declaredSourceCommit,
      sourceAttribution: "caller label; supervisor must verify source/package equality",
      workspaceDirty,
      entry,
      entrySha256,
      executionMode: entryOverride ? "external-installed" : "workspace-emitted",
      binding: binding ?? null,
      servedIdentities:
        ready === undefined
          ? null
          : {
              runtimeConfigurationIdentity: ready.runtimeConfigurationIdentity,
              artifactIdentity: ready.artifactIdentity,
              policyIdentity: ready.policyIdentity,
              authenticationIdentity: ready.authenticationIdentity,
              payloadIdentity: ready.payloadIdentity,
            },
      credentialFreeConfigurationProjectionSha256: projectionSha256,
      artifacts,
      attempts: attempted,
      completedResponses: responses.length,
      responses,
      receiptObservations,
      milestones,
      milestoneOverflow,
      socketCount: sockets.size,
      maximumLiveSockets,
      liveSocketsAfterCleanup: liveSockets.size,
      requestSockets: [...requestSockets].map(([index, socket]) => ({ index, socket })),
      clientDispatchDisciplinePassed: performed.includes("dispatch-discipline"),
      bothConnectedBeforeFirstResponse,
      bothWritesPrecededFirstResponse,
      inconclusivePending,
      prerequisites,
      completedContenderCount,
      failedContenderCount,
      selectedWinner,
      selectedLoser,
      revisionEncodingBytes,
      performed,
      failedAssertion,
      namedAssertion: failedAssertion,
      failedPhase,
      primaryFailureCount,
      cleanupFailureCount,
      reportWriteFailed,
      reportOverflow,
      failureCount: failures.length,
      outcome: inconclusivePending ? "inconclusive-pending" : failures.length ? "failed" : "passed",
      retention:
        "Full parsed receipt/Resource/Event comparisons occur in memory; response fingerprints are not retained full-wire evidence.",
      launchAttempted,
      childPid: child?.child.pid ?? null,
      childExitCode: child?.child.exitCode ?? null,
      childSignalCode: child?.child.signalCode ?? null,
      stopKnowledge: stopped ? "known-stopped-or-never-launched" : "unknown",
      closed,
      temporaryRoot: temporaryRoot ?? null,
      directory: directory ?? null,
      directoryAbsent: directory === undefined ? null : !existsSync(directory),
      deadlineExceeded,
      cleanupExceeded,
      drainExceeded,
      elapsedMs: performance.now() - started,
      bounds: {
        workMs: 45000,
        requestMs: 5000,
        cleanupMs: 10000,
        requestDrainMs: 5000,
        testMs: 60000,
        maximumRequests: mode === "positive" ? 7 : 3,
        responseBodyBytes: 32768,
        responseHeaderBytes: 16384,
        reportBytes: 65536,
      },
      claimEligible: false,
    });
    let serialized = JSON.stringify(observation());
    if (Buffer.byteLength(serialized) + 1 > 65536) {
      reportOverflow = true;
      addFailure(new Error("guarded-batch report ceiling"));
    } else if (reportPath !== undefined) {
      try {
        writeFileSync(reportPath, serialized + "\n", { flag: "wx", mode: 0o600 });
      } catch (error) {
        reportWriteFailed = true;
        addFailure(error);
      }
    }
    serialized = JSON.stringify(observation());
    if (Buffer.byteLength(serialized) + 1 <= 65536) console.log(serialized);
    else {
      reportOverflow = true;
      addFailure(new Error("guarded-batch report ceiling"));
      console.log(
        JSON.stringify({
          label: "private-installed-guarded-batch",
          mode,
          outcome: "failed",
          reportOverflow: true,
          failureCount: failures.length,
          claimEligible: false,
        }),
      );
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, "guarded-batch installed observation failed");
}, 60000);
