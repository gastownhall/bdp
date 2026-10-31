/** Private ordinary Read+Update witness; no cumulative or public qualification. */
import { execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request, type ClientRequest, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { expect, it } from "vitest";
import {
  parseBeadRecord,
  parseReadUpdateDiscovery,
  parseReadUpdateMutationResult,
  parseReadUpdateOperationDirectory,
  parseReadUpdateProblem,
  type BeadRecord,
} from "@bdp/protocol";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scope = "https://reference.invalid/acme/";
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Configuration = { scope: string; listener: { host: string; port: number } };
type Exit = { code: number | null; signal: NodeJS.Signals | null };
type Launched = { child: ChildProcess; ready: Record<string, unknown>; close(): Promise<Exit> };
// Existing emitted launcher imports only when the selected test module is loaded, after build.
const helpers = (await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
)) as {
  availablePort(): Promise<number>;
  referenceConfiguration(directory: string, port: number, token: string): Configuration;
  launchInstalledReference(entry: string, configuration: Configuration): Promise<Launched>;
};
type Classification =
  | "oracle"
  | "work-deadline"
  | "exchange-deadline"
  | "transport"
  | "startup"
  | "cleanup";
class WitnessError extends Error {
  constructor(
    readonly classification: Classification,
    readonly code: string,
  ) {
    super(code);
  }
}
type Kind =
  | "invoked"
  | "end-called"
  | "socket-assigned"
  | "connected"
  | "finish"
  | "response-start"
  | "response-end"
  | "error"
  | "aborted"
  | "request-close"
  | "response-close"
  | "settled"
  | "socket-close";
type Pair = "A" | "B";
type Milestone = { ordinal: number; request: Pair; kind: Kind; socket?: number };
type Response = { status: number; headers: IncomingMessage["headers"]; body: unknown };
const expectedProblem = {
  type: "https://github.com/gastownhall/bdp/problems/conflict",
  code: "revision-mismatch",
  status: 409,
  retry: "after-state-change",
};
const absentMutationHeaders = [
  "etag",
  "location",
  "bdp-scope-epoch",
  "bdp-authorization-view",
  "bdp-scope-position",
];
function grant(value: string): string {
  const url = new URL(value);
  if (
    url.href !== value ||
    !value.startsWith(scope) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.length > 8192 ||
    Buffer.byteLength(value) > 8192
  )
    throw new WitnessError("oracle", "overlap:canonical-target");
  return value;
}
function mutation(response: Response): void {
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers["x-bdp-development"]).toBe("non-attesting");
  expect(response.headers["content-type"]).toBe(
    response.status === 200 ? "application/json" : "application/problem+json",
  );
  for (const name of absentMutationHeaders) expect(response.headers[name]).toBeUndefined();
}
function completeUpdate(response: Response, seed: BeadRecord, n: number): BeadRecord | undefined {
  if (response.status !== 200 && response.status !== 409)
    throw new WitnessError("transport", "overlap:unexpected-mutation-status");
  mutation(response);
  if (response.status === 409) {
    parseReadUpdateProblem(response.body);
    return undefined;
  }
  const result = parseReadUpdateMutationResult(response.body);
  expect(result.outcome).toBe("updated");
  const resource = parseBeadRecord(result.resource);
  expect(resource.id).toBe(seed.id);
  expect(resource.type).toBe(seed.type);
  expect(resource.properties).toStrictEqual({ n });
  expect(resource.metadata).toStrictEqual(seed.metadata);
  expect(resource.ownedLinks).toStrictEqual(seed.ownedLinks);
  expect(resource.links).toStrictEqual(seed.links);
  expect(resource.revision).not.toBe(seed.revision);
  return resource;
}

function writeObservation(output: string, record: unknown): void {
  if (!path.isAbsolute(output)) throw new Error("overlap:absolute-output");
  writeFileSync(output, `${JSON.stringify(record)}\n`, { flag: "wx" });
}

it("preserves one guarded winner and both retained dispositions across overlapping ordinary Read+Update requests", async () => {
  const failures: unknown[] = [];
  const cleanupFailures: string[] = [];
  let classification: Classification | null = null;
  let startupPhase = true;
  let namedOracle: string | null = null;
  let directory: string | undefined;
  let launched: Launched | undefined;
  let exit: Exit | undefined;
  let entry: string | undefined;
  let entrySha256: string | undefined;
  let sourceCommit: string | undefined;
  let workspaceDirty: boolean | undefined;
  let mode: "default-emitted-CI" | "fresh-consumer-positive" | "emitted-derivative" | undefined;
  let configuration: Configuration | undefined;
  let attempted = 0;
  let bodyBytes = 0;
  let revisionJsonBytes: number | undefined;
  let winner: Pair | null = null;
  let pairSchemasValid = false;
  let overlapObserved: boolean | null = null;
  let connectionsBeforeResponse: boolean | null = null;
  let finishesBeforeResponse: boolean | null = null;
  let eventOverflow = false;
  let droppedEvents = 0;
  let socketSerial = 0;
  const milestones: Milestone[] = [];
  const seen = new Set<string>();
  const records: {
    number: number;
    method: string;
    url: string;
    status: number;
    bodyOctets: number;
    bodySha256: string;
    requestBodyOctets: number;
    requestBodySha256: string | null;
    headers: Record<string, string | null>;
  }[] = [];
  const active = new Set<ClientRequest>();
  const pending: Promise<Response>[] = [];
  const closing: Promise<void>[] = [];
  const controller = new AbortController();
  let workDeadline = false;
  const timer = setTimeout(() => {
    workDeadline = true;
    controller.abort(new WitnessError("work-deadline", "overlap:work-deadline"));
  }, 30000);
  function mark(pair: Pair | undefined, kind: Kind, socket?: number): void {
    if (!pair) return;
    const key = `${pair}:${kind}`;
    if (seen.has(key)) return;
    if (milestones.length >= 32) {
      eventOverflow = true;
      droppedEvents++;
      return;
    }
    seen.add(key);
    milestones.push({
      ordinal: milestones.length + 1,
      request: pair,
      kind,
      ...(socket === undefined ? {} : { socket }),
    });
  }
  const granted = new Set<string>([scope]);
  const token = randomBytes(32).toString("base64url");
  function send(
    url: string,
    method: "GET" | "POST" = "GET",
    body?: string,
    key?: string,
    pair?: Pair,
  ): Promise<Response> {
    controller.signal.throwIfAborted();
    if (!configuration || !granted.has(url) || grant(url) !== url || attempted >= 10)
      throw new WitnessError("oracle", "overlap:dispatch-allowlist");
    const bytes = body === undefined ? 0 : Buffer.byteLength(body);
    if (
      bytes > 65536 ||
      (method === "POST") !== (body !== undefined) ||
      (body !== undefined) !== (key !== undefined)
    )
      throw new WitnessError("oracle", "overlap:request-shape-bound");
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      connection: "close",
      ...(body === undefined
        ? {}
        : {
            "content-type": "application/json",
            "content-length": String(bytes),
            "idempotency-key": key!,
          }),
    };
    if (Buffer.byteLength(JSON.stringify(headers)) > 16384)
      throw new WitnessError("oracle", "overlap:request-header-bound");
    const number = ++attempted;
    bodyBytes += bytes;
    mark(pair, "invoked");
    let req: ClientRequest | undefined;
    let incoming: IncomingMessage | undefined;
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    closing.push(closed);
    const promise = new Promise<Response>((resolve, reject) => {
      const finish = (error?: unknown, response?: Response) => {
        if (settled) return;
        settled = true;
        if (deadline) clearTimeout(deadline);
        controller.signal.removeEventListener("abort", abort);
        mark(pair, "settled");
        if (error !== undefined) reject(error);
        else resolve(response!);
      };
      const fail = (error: WitnessError) => {
        incoming?.destroy();
        req?.destroy();
        finish(error);
      };
      const abort = () =>
        fail(new WitnessError(workDeadline ? "work-deadline" : "cleanup", "overlap:aborted"));
      deadline = setTimeout(
        () => fail(new WitnessError("exchange-deadline", "overlap:exchange-deadline")),
        5000,
      );
      controller.signal.addEventListener("abort", abort, { once: true });
      try {
        const target = new URL(url);
        req = request(
          {
            hostname: configuration!.listener.host,
            port: configuration!.listener.port,
            path: target.pathname,
            method,
            headers,
            agent: false,
            maxHeaderSize: 16384,
          },
          (response) => {
            incoming = response;
            mark(pair, "response-start");
            const chunks: Buffer[] = [];
            let received = 0;
            response.on("data", (chunk: Buffer) => {
              received += chunk.length;
              if (received > 32768) {
                fail(new WitnessError("transport", "overlap:response-body-bound"));
                return;
              }
              if (!settled) chunks.push(chunk);
            });
            response.once("aborted", () => {
              mark(pair, "aborted");
              fail(new WitnessError("transport", "overlap:response-aborted"));
            });
            response.once("error", () => {
              mark(pair, "error");
              fail(new WitnessError("transport", "overlap:response-error"));
            });
            response.once("close", () => {
              mark(pair, "response-close");
              if (!response.complete)
                fail(new WitnessError("transport", "overlap:premature-close"));
            });
            response.once("end", () => {
              mark(pair, "response-end");
              if (settled) return;
              try {
                const data = Buffer.concat(chunks);
                const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
                const value: unknown = data.length ? JSON.parse(text) : undefined;
                const status = response.statusCode ?? 0;
                const safeHeaders = Object.fromEntries(
                  [
                    "content-type",
                    "cache-control",
                    "content-length",
                    "x-bdp-development",
                    ...absentMutationHeaders,
                  ].map((name) => [
                    name,
                    typeof response.headers[name] === "string" ? response.headers[name] : null,
                  ]),
                );
                records.push({
                  number,
                  method,
                  url,
                  status,
                  bodyOctets: data.length,
                  bodySha256: digest(data),
                  requestBodyOctets: bytes,
                  requestBodySha256: body === undefined ? null : digest(body),
                  headers: safeHeaders,
                });
                finish(undefined, { status, headers: response.headers, body: value });
              } catch {
                fail(new WitnessError("transport", "overlap:response-json"));
              }
            });
          },
        );
        active.add(req);
        req.once("socket", (socket) => {
          const id = ++socketSerial;
          mark(pair, "socket-assigned", id);
          socket.once("connect", () => mark(pair, "connected", id));
          socket.once("close", () => mark(pair, "socket-close", id));
        });
        req.once("finish", () => mark(pair, "finish"));
        req.once("error", () => {
          mark(pair, "error");
          finish(new WitnessError("transport", "overlap:request-error"));
        });
        req.once("close", () => {
          mark(pair, "request-close");
          active.delete(req!);
          resolveClosed();
        });
        mark(pair, "end-called");
        req.end(body);
      } catch {
        fail(new WitnessError("transport", "overlap:request-construction"));
        if (!req) resolveClosed();
      }
    });
    // Attach a rejection handler immediately, including A before constructing B.
    void promise.catch(() => undefined);
    pending.push(promise);
    return promise;
  }
  try {
    const defaultEntry = realpathSync(
      path.join(root, "packages/server/dist/installed-reference-process.js"),
    );
    const override = process.env.BDP_RU_GUARDED_OVERLAP_ENTRY;
    if (override !== undefined && !path.isAbsolute(override))
      throw new WitnessError("startup", "overlap:absolute-entry");
    entry = realpathSync(override ?? defaultEntry);
    if (!statSync(entry).isFile()) throw new WitnessError("startup", "overlap:regular-entry");
    if (override === undefined) {
      expect(entry).toBe(defaultEntry);
      mode = "default-emitted-CI";
    } else {
      const declaredMode = process.env.BDP_RU_GUARDED_OVERLAP_MODE;
      if (declaredMode !== "fresh-consumer-positive" && declaredMode !== "emitted-derivative")
        throw new WitnessError("startup", "overlap:external-entry-mode");
      mode = declaredMode;
    }
    entrySha256 = digest(readFileSync(entry));
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    workspaceDirty =
      execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", timeout: 5000 })
        .length !== 0;
    directory = mkdtempSync(path.join(tmpdir(), "bdp-ru-guarded-overlap-"));
    configuration = helpers.referenceConfiguration(directory, await helpers.availablePort(), token);
    controller.signal.throwIfAborted();
    try {
      launched = await helpers.launchInstalledReference(entry, configuration);
    } catch (error) {
      classification = workDeadline ? "work-deadline" : "startup";
      throw error;
    }
    startupPhase = false;
    controller.signal.throwIfAborted();
    const probe = await send(scope);
    expect(probe.status).toBe(204);
    expect(probe.headers["x-bdp-development"]).toBe("non-attesting");
    const link = probe.headers.link;
    if (typeof link !== "string") throw new WitnessError("oracle", "overlap:service-description");
    const matched = /^<([^>]+)>; rel="service-desc"; type="application\/json"$/.exec(link);
    if (!matched?.[1]) throw new WitnessError("oracle", "overlap:service-description");
    const descriptor = grant(new URL(matched[1], scope).href);
    granted.add(descriptor);
    const discoveryResponse = await send(descriptor);
    expect(discoveryResponse.status).toBe(200);
    const discovery = parseReadUpdateDiscovery(discoveryResponse.body);
    expect(discovery.scope).toBe(scope);
    expect(discovery.profile).toBe("read-update");
    expect(discovery).not.toHaveProperty("historicalResolution");
    expect(discovery.limits?.request).toStrictEqual({ bodyBytes: 65536 });
    const directoryUrl = grant(discovery.operations);
    granted.add(directoryUrl);
    const directoryResponse = await send(directoryUrl);
    expect(directoryResponse.status).toBe(200);
    const operations = parseReadUpdateOperationDirectory(directoryResponse.body);
    const create = grant(new URL(operations.createBead, directoryUrl).href);
    const update = grant(new URL(operations.updateBead, directoryUrl).href);
    granted.add(create);
    granted.add(update);
    const seedBody = JSON.stringify({
      id: "beads/overlap",
      type: `${scope}types/task`,
      properties: { n: 0 },
    });
    expect(Buffer.byteLength(seedBody)).toBe(94);
    const made = await send(create, "POST", seedBody, "overlap-seed");
    expect(made.status).toBe(200);
    mutation(made);
    const created = parseReadUpdateMutationResult(made.body);
    expect(created.outcome).toBe("created");
    const seed = parseBeadRecord(created.resource);
    expect(seed.id).toBe(`${scope}beads/overlap`);
    expect(seed.type).toBe(`${scope}types/task`);
    expect(seed.properties).toStrictEqual({ n: 0 });
    granted.add(grant(seed.id));
    revisionJsonBytes = Buffer.byteLength(JSON.stringify(seed.revision));
    const makeBody = (value: number) =>
      JSON.stringify({
        bead: seed.id,
        expectedRevision: seed.revision,
        propertiesChange: [{ op: "replace", path: "/n", value }],
      });
    const aBody = makeBody(1);
    const bBody = makeBody(2);
    expect(Buffer.byteLength(aBody)).toBe(135 + revisionJsonBytes);
    expect(Buffer.byteLength(bBody)).toBe(135 + revisionJsonBytes);
    const aPending = send(update, "POST", aBody, "overlap-a", "A");
    const bPending = send(update, "POST", bBody, "overlap-b", "B");
    const pair = await Promise.allSettled([aPending, bPending]);
    const rejected = pair.filter(
      (value): value is PromiseRejectedResult => value.status === "rejected",
    );
    if (rejected.length) {
      classification = workDeadline
        ? "work-deadline"
        : rejected.some(
              (value) =>
                value.reason instanceof WitnessError &&
                value.reason.classification === "exchange-deadline",
            )
          ? "exchange-deadline"
          : "transport";
      throw new AggregateError(
        rejected.map((value) => value.reason),
        "overlap:pair-transport",
      );
    }
    const a = (pair[0] as PromiseFulfilledResult<Response>).value;
    const b = (pair[1] as PromiseFulfilledResult<Response>).value;
    const firstSettle = Math.min(
      ...milestones.filter((e) => e.kind === "settled").map((e) => e.ordinal),
    );
    const milestone = (id: Pair, kind: Kind) =>
      milestones.find((e) => e.request === id && e.kind === kind);
    const required = (["A", "B"] as const).every((id) =>
      ["invoked", "end-called", "socket-assigned", "settled"].every((kind) =>
        milestone(id, kind as Kind),
      ),
    );
    overlapObserved = required
      ? !eventOverflow &&
        (["A", "B"] as const).every(
          (id) =>
            milestone(id, "end-called")!.ordinal < firstSettle &&
            milestone(id, "invoked")!.ordinal < firstSettle,
        ) &&
        milestone("A", "socket-assigned")!.socket !== milestone("B", "socket-assigned")!.socket
      : null;
    const firstResponse = Math.min(
      ...milestones.filter((e) => e.kind === "response-start").map((e) => e.ordinal),
    );
    const beforeResponse = (kind: Kind) =>
      (["A", "B"] as const).every((id) => milestone(id, kind))
        ? (["A", "B"] as const).every((id) => milestone(id, kind)!.ordinal < firstResponse)
        : null;
    connectionsBeforeResponse = beforeResponse("connected");
    finishesBeforeResponse = beforeResponse("finish");
    if (overlapObserved !== true)
      throw new WitnessError("transport", "overlap:incomplete-observation");
    const aResource = completeUpdate(a, seed, 1);
    const bResource = completeUpdate(b, seed, 2);
    pairSchemasValid = true;
    const valid =
      (a.status === 200 && b.status === 409 && isDeepStrictEqual(b.body, expectedProblem)) ||
      (b.status === 200 && a.status === 409 && isDeepStrictEqual(a.body, expectedProblem));
    namedOracle = "overlap:exactly-one-winner";
    expect(valid, namedOracle).toBe(true);
    namedOracle = null;
    winner = a.status === 200 ? "A" : "B";
    const winningResource = winner === "A" ? aResource : bResource;
    const current = await send(seed.id);
    expect(current.status).toBe(200);
    expect(parseBeadRecord(current.body)).toStrictEqual(winningResource);
    const replayA = await send(update, "POST", aBody, "overlap-a");
    mutation(replayA);
    expect(replayA.status).toBe(a.status);
    expect(replayA.body).toStrictEqual(a.body);
    const replayB = await send(update, "POST", bBody, "overlap-b");
    mutation(replayB);
    expect(replayB.status).toBe(b.status);
    expect(replayB.body).toStrictEqual(b.body);
    const final = await send(seed.id);
    expect(final.status).toBe(200);
    expect(parseBeadRecord(final.body)).toStrictEqual(winningResource);
    expect(attempted).toBe(10);
    expect(bodyBytes).toBe(634 + 4 * revisionJsonBytes);
  } catch (error) {
    failures.push(error);
    classification ??=
      error instanceof WitnessError
        ? error.classification
        : workDeadline
          ? "work-deadline"
          : startupPhase
            ? "startup"
            : "oracle";
  } finally {
    clearTimeout(timer);
    controller.abort(new WitnessError("cleanup", "overlap:aborted"));
    for (const req of active) req.destroy();
    // Both teardown branches run even if the other fails; no additional runtime is started.
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    const drain = Promise.race([
      Promise.all([Promise.allSettled(pending), Promise.all(closing)]),
      new Promise<never>((_resolve, reject) => {
        drainTimer = setTimeout(
          () => reject(new WitnessError("cleanup", "overlap:request-drain-deadline")),
          5000,
        );
      }),
    ]).finally(() => {
      if (drainTimer) clearTimeout(drainTimer);
    });
    const close = (async () => {
      if (!launched) return;
      exit = await launched.close();
      if (exit.code !== 0 || exit.signal !== null)
        throw new WitnessError("cleanup", "overlap:child-exit");
    })();
    const cleanup = await Promise.allSettled([drain, close]);
    for (const [index, result] of cleanup.entries())
      if (result.status === "rejected") {
        failures.push(result.reason);
        cleanupFailures.push(index === 0 ? "request-drain" : "child-close");
      }
    if (directory) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
        cleanupFailures.push("directory-remove");
      }
    }
    if (eventOverflow && classification === null) {
      failures.push(new WitnessError("transport", "overlap:event-overflow"));
      classification = "transport";
    }
    const record = {
      observation: "private-installed-read-update-guarded-overlap",
      claimEligible: false,
      outcome: failures.length ? "failed" : "passed",
      mode: mode ?? null,
      entry: entry ?? null,
      entrySha256: entrySha256 ?? null,
      sourceCommit: sourceCommit ?? null,
      workspaceDirty: workspaceDirty ?? null,
      ready: launched
        ? Object.fromEntries(
            [
              "event",
              "scope",
              "profile",
              "history",
              "claimEligible",
              "configurationIdentity",
              "payloadIdentity",
              "artifactIdentity",
              "policyIdentity",
              "authenticationIdentity",
            ].map((key) => [key, launched?.ready[key] ?? null]),
          )
        : null,
      attempted,
      completedResponses: records.sort((a, b) => a.number - b.number),
      bodyBytes,
      revisionJsonBytes: revisionJsonBytes ?? null,
      pairSchemasValid,
      winner,
      overlapObserved,
      connectionsBeforeResponse,
      finishesBeforeResponse,
      eventOverflow,
      droppedEvents,
      milestones,
      missingMilestones: (["A", "B"] as const).flatMap((id) =>
        (
          [
            "invoked",
            "end-called",
            "socket-assigned",
            "connected",
            "finish",
            "response-start",
            "response-end",
            "settled",
            "request-close",
            "response-close",
            "socket-close",
          ] as const
        )
          .filter((kind) => !seen.has(`${id}:${kind}`))
          .map((kind) => `${id}:${kind}`),
      ),
      terminationClass: classification ?? (cleanupFailures.length ? "cleanup" : null),
      namedOracle,
      cleanupFailures,
      failureCount: failures.length,
      workDeadline,
      childPid: launched?.child.pid ?? null,
      childExitCode: exit?.code ?? null,
      childSignalCode: exit?.signal ?? null,
      directory: directory ?? null,
      directoryAbsent: directory === undefined ? null : !existsSync(directory),
      startupLimitation:
        "Before readiness PID unavailable; inherited launcher may mask original startup failure. Only surfaced failure plus external process evidence retained.",
      retention:
        "Full schemas/replay/Resource assertions in memory; safe fingerprints and milestone ordinals retained. Client outstanding overlap only; no simultaneous admission/fairness claim. Losing replay equality cannot distinguish reevaluation. Source attribution externally verified, not child attested. Entry hash alone does not bind emitted bytes to sourceCommit.",
    };
    const output = process.env.BDP_RU_GUARDED_OVERLAP_OUTPUT;
    if (output) {
      try {
        writeObservation(output, record);
      } catch (error) {
        failures.push(error);
        record.outcome = "failed";
        record.failureCount = failures.length;
        record.cleanupFailures.push("report-write");
        record.terminationClass ??= "cleanup";
      }
    }
    console.log(JSON.stringify(record));
  }
  if (failures.length)
    throw new AggregateError(failures, "ordinary Read+Update guarded overlap witness failed");
}, 45000);
