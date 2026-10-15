/** Private installed dispatch witness; no profile qualification or server-join claim. */
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
const key = "same-key-overlap";
const singleton =
  '{"type":"https://reference.invalid/acme/types/task","properties":{"title":"same-key-overlap"},"metadata":{}}';
const batch =
  '{"operations":[{"operation":"createBead","type":"https://reference.invalid/acme/types/task","properties":{"title":"same-key-overlap"},"metadata":{}}]}';
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
  throw new Error("same-key entry override requires declared source commit");
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
const mode = process.env.BDP_TRANSACTIONAL_SAME_KEY_OVERLAP_MODE ?? "positive";
if (mode !== "positive" && mode !== "second-key-distinct") throw new Error("invalid same-key mode");
const output = process.env.BDP_TRANSACTIONAL_SAME_KEY_OVERLAP_OUTPUT;
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
    throw new Error("same-key evidence/store path must be outside protected directory");
}
function resolvedOutput(filename: string) {
  if (!path.isAbsolute(filename)) throw new Error("same-key output must be absolute");
  const resolved = path.join(realpathSync(path.dirname(filename)), path.basename(filename));
  outside(resolved, root);
  if (existsSync(resolved)) throw new Error("same-key output must be exclusive");
  return resolved;
}
const reportPath = output === undefined ? undefined : resolvedOutput(output);
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("same-key expected JSON object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length)
    throw new Error("same-key expected nonempty string");
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
    throw new Error("same-key invalid issued authority URL");
  return literal;
}
function position(value: unknown) {
  const literal = text(value);
  if (!/^pos-(0|[1-9][0-9]*)$/.test(literal) || !Number.isSafeInteger(Number(literal.slice(4))))
    throw new Error("same-key invalid position");
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
  resource: Record<string, unknown> | null;
  effect: number | null;
  pending: boolean;
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

it("preserves one allocated effect and receipt across same-key singleton and batch requests dispatched without awaiting", async () => {
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
    pending: boolean;
    resourceId: string | null;
    revision: string | null;
    effectPosition: string | null;
    requiredPosition: string | null;
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
  let currentAssertion = "same-key-overlap:setup",
    failedAssertion: string | null = null;
  type Phase = "setup" | "launch" | "transport" | "oracle" | "inconclusive";
  let phase: Phase = "setup",
    failedPhase: Phase | null = null;
  let reportWriteFailed = false,
    reportOverflow = false;
  let inconclusiveBothPending = false,
    pendingObserved = false,
    controlPrerequisites = false;
  let receiptIdsDiffer: boolean | null = null,
    bothConnectedBeforeFirstResponse = false,
    bothWritesPrecededFirstResponse = false;
  const deadline = setTimeout(() => {
    deadlineExceeded = true;
    work.abort(new Error("same-key work deadline"));
  }, 45000);
  function destroyActive() {
    for (const req of active) req.destroy();
    for (const socket of liveSockets) socket.destroy();
  }
  work.signal.addEventListener("abort", destroyActive);
  function mark(index: number, kind: string) {
    if (index > 2 || milestones.some((m) => m.request === index && m.kind === kind)) return;
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
    currentAssertion = `same-key-overlap:${name}`;
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
    const bundle = JSON.parse(readFileSync(path.join(root, "schemas/bdp-v0.schema.json"), "utf8"));
    ajv.addSchema(bundle);
    const validators = Object.fromEntries(
      ["mutationReceipt", "beadRecord", "currentBeadCollection", "eventPage"].map(
        (name) => [name, ajv.compile({ $ref: `${bundle.$id}#/$defs/${name}` })] as const,
      ),
    );
    function checked(value: unknown, name: string) {
      const validate = validators[name];
      if (!validate) throw new Error("same-key unbound schema");
      expect(validate(value), `same-key-overlap:schema:${name}`).toBe(true);
      return record(value);
    }
    check("literal-inputs", () => {
      expect([Buffer.byteLength(singleton), sha(singleton)]).toStrictEqual([
        108,
        "387ed98ffa4e2603db3358ac9a41a1acd815f64bf8e2dc3f233ef5c132328649",
      ]);
      expect([Buffer.byteLength(batch), sha(batch)]).toStrictEqual([
        150,
        "278716c3e493fbdee5adb3ef532fc296bf929111200bf85bfedf56fc6f6d012b",
      ]);
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
    directory = realpathSync(
      mkdtempSync(path.join(temporaryRoot, "bdp-same-key-overlap-installed-")),
    );
    outside(directory, root);
    if (reportPath) outside(reportPath, directory);
    for (let i = 0; i < process.argv.length; i++) {
      const argument = process.argv[i]!;
      let filename: string | undefined;
      if (argument === "--outputFile") {
        filename = process.argv[++i];
        if (filename?.startsWith("-")) throw new Error("same-key missing outputFile value");
      } else if (argument.startsWith("--outputFile=")) filename = argument.slice(13);
      else continue;
      if (!filename) throw new Error("same-key missing outputFile value");
      outside(path.resolve(filename), directory);
    }
    const token = randomBytes(24).toString("base64url");
    expect(/^[A-Za-z0-9_-]{32}$/.test(token), "same-key token shape").toBe(true);
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
    currentAssertion = "same-key-overlap:launch";
    launchAttempted = true;
    child = await launchInstalledTransaction(entry, configuration, work.signal);
    binding = installedTransactionBinding(child.ready, declaredSourceCommit, fixture);
    check("ready-targets", () => {
      expect(child?.ready.scope).toBe(scope);
      expect(child?.ready.authorityMode).toBe("canonical");
      expect(child?.ready.claimEligible).toBe(false);
      expect(binding?.operationTargets.createBead).toBe(`${scope}operations/create-bead`);
      expect(binding?.operationTargets.batch).toBe(`${scope}operations/batch`);
    });
    const address = new URL(text(child.ready.listenUrl));
    // installedTransactionBinding independently checks the exact loopback URL and all targets.
    let receiptUrl: string | undefined;
    const secondKey = mode === "second-key-distinct" ? `${key}-other` : key;
    function send(index: number): Promise<Wire> {
      work.signal.throwIfAborted();
      if (attempted >= 6 || index !== attempted + 1)
        throw new Error("same-key dispatch ceiling/order");
      const method = index <= 2 || index === 6 ? "POST" : "GET";
      const literal =
        index === 1
          ? `${scope}operations/create-bead`
          : index === 2 || index === 6
            ? `${scope}operations/batch`
            : index === 3
              ? receiptUrl
              : index === 4
                ? `${scope}beads/?limit=32`
                : `${scope}events/`;
      if (!literal) throw new Error("same-key missing issued receipt root");
      const url = new URL(literal);
      if (
        url.href !== literal ||
        url.origin !== new URL(scope).origin ||
        url.hash ||
        url.username ||
        url.password ||
        (index === 4 ? url.search !== "?limit=32" : !!url.search)
      )
        throw new Error("same-key route grant");
      if (index === 3) ownedUrl(literal, "receipts");
      const body = index === 1 ? singleton : index === 2 || index === 6 ? batch : undefined;
      const sentKey = index === 2 ? secondKey : method === "POST" ? key : undefined;
      const headers: Record<string, string> = {
        Host: url.host,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Connection: "close",
      };
      if (body !== undefined) {
        if (Buffer.byteLength(body) > 65536) throw new Error("same-key request body ceiling");
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
        throw new Error("same-key request header ceiling");
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
        const timeout = setTimeout(() => fail(new Error("same-key request deadline")), 5000);
        const onAbort = () => fail(new Error("same-key request aborted"));
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
              fail(new Error("same-key response body ceiling"));
              return;
            }
            bytes += chunk.length;
            chunks.push(chunk);
          });
          response.once("aborted", () => {
            mark(index, "aborted");
            fail(new Error("same-key response aborted"));
          });
          response.once("error", (error) => fail(error));
          response.once("close", () => {
            mark(index, "response-close");
            if (!ended) fail(new Error("same-key incomplete response"));
          });
          response.once("end", () => {
            ended = true;
            mark(index, "response-end");
            if (settled) return;
            try {
              if (!response.complete || !bytes)
                throw new Error("same-key empty or incomplete response");
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
              if (value === null) throw new Error("same-key null response body");
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
      if (wire.index <= 2 || wire.index === 6)
        expect(header(wire, "vary").toLowerCase()).toBe("accept");
      return position(header(wire, "bdp-scope-position"));
    }
    function receipt(wire: Wire, sentKey: string): Receipt {
      phase = "oracle";
      currentAssertion = `same-key-overlap:receipt-${wire.index}`;
      const body = checked(wire.body, "mutationReceipt");
      const id = ownedUrl(body.id, "receipts"),
        transaction = text(body.transaction),
        epoch = text(body.scopeEpoch),
        view = text(body.authorizationView);
      expect(body.idempotencyKey).toBe(sentKey);
      const serving = current(wire, epoch, view);
      const isPending = body.status === "pending";
      let resource: Record<string, unknown> | null = null,
        effect: number | null = null;
      if (isPending) {
        expect(wire.status).toBe(202);
        expect(mode).toBe("positive");
        expect([0, 1]).toContain(serving);
        expect(body).toStrictEqual({
          id,
          status: "pending",
          idempotencyKey: sentKey,
          scopeEpoch: epoch,
          authorizationView: view,
          transaction,
        });
        expect(header(wire, "location")).toBe(id);
        expect(header(wire, "retry-after")).toBe("1");
      } else {
        expect(wire.status).toBe(200);
        expect(body.status).toBe("completed");
        expect(body.detail).toBe("available");
        expect(Array.isArray(body.results)).toBe(true);
        const results = body.results as unknown[];
        expect(results).toHaveLength(1);
        resource = checked(record(results[0]).resource, "beadRecord");
        const resourceId = ownedUrl(resource.id, "beads"),
          revision = text(resource.revision);
        expect(resource).toStrictEqual({
          id: resourceId,
          type: beadType,
          revision,
          properties: { title: "same-key-overlap" },
          metadata: {},
        });
        effect = position(body.effectPosition);
        expect(position(body.requiredPosition)).toBe(effect);
        expect(effect).toBeGreaterThanOrEqual(1);
        expect(serving).toBeGreaterThanOrEqual(effect);
        expect(serving).toBeLessThanOrEqual(mode === "positive" ? 1 : 2);
        expect(body).toStrictEqual({
          id,
          status: "completed",
          detail: "available",
          idempotencyKey: sentKey,
          scopeEpoch: epoch,
          authorizationView: view,
          transaction,
          requiredPosition: body.requiredPosition,
          effectPosition: body.effectPosition,
          results: [{ operationIndex: 0, outcome: "created", resource }],
          next: null,
          expiresAt: body.expiresAt,
        });
      }
      pendingObserved ||= isPending;
      receiptObservations.push({
        index: wire.index,
        id,
        transaction,
        key: sentKey,
        pending: isPending,
        resourceId: resource === null ? null : text(resource.id),
        revision: resource === null ? null : text(resource.revision),
        effectPosition: effect === null ? null : text(body.effectPosition),
        requiredPosition: effect === null ? null : text(body.requiredPosition),
      });
      performed.push(`receipt-${wire.index}-schema-and-literals`);
      return {
        body,
        id,
        transaction,
        epoch,
        view,
        key: sentKey,
        resource,
        effect,
        pending: isPending,
      };
    }
    phase = "transport";
    currentAssertion = "same-key-overlap:pair-transport";
    const aPromise = send(1),
      bPromise = send(2);
    const pair = await Promise.allSettled([aPromise, bPromise]);
    const pairErrors = pair.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (pairErrors.length) throw new AggregateError(pairErrors, "same-key pair transport failed");
    const aWire = (pair[0] as PromiseFulfilledResult<Wire>).value;
    const bWire = (pair[1] as PromiseFulfilledResult<Wire>).value;
    await Promise.all(closing);
    check("dispatch-discipline", () => {
      expect(milestoneOverflow).toBe(false);
      const firstSettled = milestones.find((m) => m.kind === "settled")!.order;
      for (const index of [1, 2])
        for (const kind of ["invoked", "end-called"])
          expect(
            milestones.find((m) => m.request === index && m.kind === kind)?.order,
          ).toBeLessThan(firstSettled);
      expect(requestSockets.size).toBe(2);
      expect(maximumLiveSockets).toBeLessThanOrEqual(2);
      expect(requestSockets.get(1)).not.toBe(requestSockets.get(2));
      expect(milestones.filter((m) => m.kind === "response-end")).toHaveLength(2);
    });
    const firstResponse = milestones.find((m) => m.kind === "response-start")!.order;
    bothConnectedBeforeFirstResponse = [1, 2].every((i) =>
      milestones.some((m) => m.request === i && m.kind === "connected" && m.order < firstResponse),
    );
    bothWritesPrecededFirstResponse = [1, 2].every((i) =>
      milestones.some((m) => m.request === i && m.kind === "finish" && m.order < firstResponse),
    );
    const a = receipt(aWire, key),
      b = receipt(bWire, secondKey);
    pendingObserved = a.pending || b.pending;
    receiptIdsDiffer = a.id !== b.id;
    if (mode === "second-key-distinct")
      check("control-prerequisites", () => {
        expect([a.pending, b.pending]).toStrictEqual([false, false]);
        expect([a.effect, b.effect].sort()).toStrictEqual([1, 2]);
        expect(a.transaction).not.toBe(b.transaction);
        expect(a.resource?.id).not.toBe(b.resource?.id);
        expect(a.epoch).toBe(b.epoch);
        expect(a.view).toBe(b.view);
        controlPrerequisites = true;
      });
    // Distinct-key control must reach this exact oracle only after successful independent effects.
    check("shared-receipt-id", () => expect(a.id, "same-key-overlap:shared-receipt-id").toBe(b.id));
    check("shared-identity", () => {
      expect([a.transaction, a.epoch, a.view, a.key]).toStrictEqual([
        b.transaction,
        b.epoch,
        b.view,
        b.key,
      ]);
      for (const r of [a, b]) if (!r.pending) expect(r.effect).toBe(1);
    });
    if (a.pending && b.pending) {
      phase = "inconclusive";
      inconclusiveBothPending = true;
      currentAssertion = "same-key-overlap:inconclusive-both-pending";
      throw new Error("same-key-overlap:inconclusive-both-pending");
    }
    const terminal = a.pending ? b : a;
    if (!a.pending && !b.pending)
      check("pair-full-terminal-equality", () => expect(a.body).toStrictEqual(b.body));
    receiptUrl = terminal.id;
    phase = "transport";
    currentAssertion = "same-key-overlap:transport-3";
    const r3 = await send(3);
    await Promise.all(closing);
    const recovered = receipt(r3, key);
    check("issued-receipt-full-equality", () => {
      expect(recovered.pending).toBe(false);
      expect(recovered.body).toStrictEqual(terminal.body);
      expect(current(r3, terminal.epoch, terminal.view)).toBe(1);
    });
    phase = "transport";
    currentAssertion = "same-key-overlap:transport-4";
    const r4 = await send(4);
    await Promise.all(closing);
    check("complete-resource-collection", () => {
      expect(r4.status).toBe(200);
      expect(current(r4, terminal.epoch, terminal.view)).toBe(1);
      expect(checked(r4.body, "currentBeadCollection")).toStrictEqual({
        items: [terminal.resource],
        next: null,
      });
    });
    phase = "transport";
    currentAssertion = "same-key-overlap:transport-5";
    const r5 = await send(5);
    await Promise.all(closing);
    check("complete-event-linkage", () => {
      expect(r5.status).toBe(200);
      expect(current(r5, terminal.epoch, terminal.view)).toBe(1);
      const page = checked(r5.body, "eventPage");
      expect(page.source).toBe(`${scope}events/`);
      expect(Array.isArray(page.events)).toBe(true);
      const events = page.events as unknown[];
      expect(events).toHaveLength(1);
      const event = record(events[0]),
        resource = terminal.resource!;
      const hash = (tag: string, value: string) =>
        createHash("sha256")
          .update(JSON.stringify([tag, value]))
          .digest("base64url");
      const id = `ev_${hash("epoch", header(r5, "bdp-scope-epoch"))}_${hash("view", header(r5, "bdp-authorization-view"))}_${hash("source", text(page.source))}_pos-1_0`;
      expect(page).toStrictEqual({
        source: `${scope}events/`,
        events: [
          {
            id,
            ordinal: 0,
            type: "created",
            source: `${scope}events/`,
            subject: resource.id,
            subjectType: resource.type,
            transaction: terminal.transaction,
            time: event.time,
            data: {
              revision: resource.revision,
              properties: resource.properties,
              metadata: resource.metadata,
            },
          },
        ],
        next: null,
      });
    });
    phase = "transport";
    currentAssertion = "same-key-overlap:transport-6";
    const r6 = await send(6);
    await Promise.all(closing);
    const replayed = receipt(r6, key);
    check("retained-batch-full-equality", () => {
      expect(replayed.pending).toBe(false);
      expect(replayed.body).toStrictEqual(terminal.body);
      expect(current(r6, terminal.epoch, terminal.view)).toBe(1);
    });
    check("complete-fixed-schedule", () => {
      expect(attempted).toBe(6);
      expect(responses).toHaveLength(6);
      expect(sockets.size).toBe(6);
      expect(maximumLiveSockets).toBeLessThanOrEqual(2);
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
          addFailure(new Error("same-key request cleanup deadline"));
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
          addFailure(new Error("same-key cleanup deadline"));
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
      addFailure(new Error("same-key child did not exit cleanly"));
    if (launchAttempted && child === undefined)
      addFailure(new Error("same-key pre-ready child stop unknown"));
    if (directory !== undefined && stopped) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        addFailure(error);
      }
    }
    if (directory !== undefined && existsSync(directory))
      addFailure(new Error("same-key owned directory retained"));
    if (deadlineExceeded) addFailure(new Error("same-key work deadline exceeded"));
    if (milestoneOverflow) addFailure(new Error("same-key milestone ceiling"));
    if (liveSockets.size) addFailure(new Error("same-key owned sockets remain"));
    const cleanupFailureCount = failures.length - primaryFailureCount;
    const ready = child?.ready;
    // Explicit allowlist: never retain credentials, runtime configuration, arbitrary errors or raw requests.
    const observation = () => ({
      label: "private-installed-same-key-overlap",
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
      pendingObserved,
      inconclusiveBothPending,
      controlPrerequisites,
      receiptIdsDiffer,
      performed,
      failedAssertion,
      failedPhase,
      primaryFailureCount,
      cleanupFailureCount,
      reportWriteFailed,
      reportOverflow,
      failureCount: failures.length,
      outcome: inconclusiveBothPending
        ? "inconclusive-both-pending"
        : failures.length
          ? "failed"
          : "passed",
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
        maximumRequests: 6,
        responseBodyBytes: 32768,
        responseHeaderBytes: 16384,
        reportBytes: 65536,
      },
      claimEligible: false,
    });
    let serialized = JSON.stringify(observation());
    if (Buffer.byteLength(serialized) + 1 > 65536) {
      reportOverflow = true;
      addFailure(new Error("same-key report ceiling"));
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
      addFailure(new Error("same-key report ceiling"));
      console.log(
        JSON.stringify({
          label: "private-installed-same-key-overlap",
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
  if (failures.length) throw new AggregateError(failures, "same-key installed observation failed");
}, 60000);
