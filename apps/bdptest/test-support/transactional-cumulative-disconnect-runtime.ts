/** NEW fixed installed disconnect companion; no ordinary configuration identity or whole profile award. */
import { connect, type Socket } from "node:net";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect } from "vitest";
import { launchCumulativeDisconnect } from "./transactional-cumulative-disconnect-launch.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_CUMULATIVE_DISCONNECT_ENTRY,
  source = process.env.BDP_CUMULATIVE_DISCONNECT_SOURCE,
  build = process.env.BDP_CUMULATIVE_DISCONNECT_BUILD,
  output = process.env.BDP_CUMULATIVE_DISCONNECT_OUTPUT,
  bankPath = process.env.BDP_CUMULATIVE_DISCONNECT_CREDENTIALS;
const scope = "https://reference.invalid/acme/";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const fixtureBytes = await readFile(
    new URL("../test-support/transactional-cumulative-product-fixture.json", import.meta.url),
  ),
  fixture = JSON.parse(fixtureBytes.toString());
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
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-cumulative-disconnect-" + name + "-"));
  const configuration = {
    scope,
    directory,
    create: true,
    artifacts: fixture.artifacts,
    credentials: bank.map(({ ref: _ref, ...r }) => r),
  };
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(Error("disconnect cohort deadline")), 90000);
  const pendingExchanges: Promise<unknown>[] = [];
  const sockets = new Set<Socket>();
  const socketClosures: Promise<void>[] = [];
  const wires: unknown[] = [],
    controls: unknown[] = [],
    facts: Record<string, unknown> = {},
    failures: unknown[] = [];
  let run: ReturnType<typeof launchCumulativeDisconnect> | undefined,
    ready: Record<string, unknown> | undefined,
    address: URL | undefined,
    terminal: unknown;
  async function launch() {
    run = launchCumulativeDisconnect(entry!, configuration);
    ready = await run.ready;
    expect(ready.event).toBe("disconnect.ready");
    checkReady(ready);
    address = new URL(String(ready.listenUrl));
  }
  function checkReady(r: Record<string, unknown>) {
    expect(r.ordinaryDeployment).toBe(false);
    expect(r.ordinaryConfigurationMetadataAvailable).toBe(false);
    expect(r.payloadIdentity).toBe(
      "34e0966cfd3cb5b8d0cb1d8c685418fadf45dda6bacdca839aa03bb8093ce258",
    );
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
    expect(v.event).toBe("disconnect.done");
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
    if (!address || wires.length >= 64) throw Error("disconnect request bound");
    const url = new URL(target, scope).href;
    if (
      new URL(url).origin !== new URL(scope).origin ||
      !new URL(url).pathname.startsWith("/acme/")
    )
      throw Error("disconnect request namespace");
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
    const started = performance.now();
    const responsePromise = execute({
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
    pendingExchanges.push(responsePromise);
    const response = await responsePromise;
    wires.push({
      method,
      url,
      ref,
      key,
      minimum,
      rawBody: raw,
      elapsedMs: performance.now() - started,
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
    expect(response.headers["cache-control"]).toBe("private, no-store");
    if (method === "POST" || url.includes("/receipts/") || url.includes("/changes/")) {
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["last-modified"]).toBeUndefined();
    }
    for (const field of ["bdp-scope-epoch", "bdp-authorization-view"])
      expect(response.headers[field]).toMatch(/^.+$/);
    expect(response.headers["bdp-scope-position"]).toMatch(/^pos-[0-9]+$/);
    expect(response.exactRequest?.writeState).toBe("complete");
    expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
    if (bytes) expect(response.exactRequest?.bodyDigest).toBe(sha(bytes));
    return {
      elapsedMs: performance.now() - started,
      status: response.status,
      value: response.bodyText ? JSON.parse(response.bodyText) : undefined,
      bodyText: response.bodyText,
      headers: response.headers,
    };
  }
  async function submitLost(body: unknown) {
    if (!address) throw Error("ready endpoint required");
    const credential = bank.find((r) => r.ref === "operator");
    if (!credential) throw Error("operator binding required");
    const bodyBytes = Buffer.from(JSON.stringify(body));
    if (bodyBytes.length > 65536) throw Error("fixed request body bound");
    const head = `POST /acme/operations/sequence HTTP/1.1\r\nHost: reference.invalid\r\nAuthorization: Bearer ${credential.token}\r\nContent-Type: application/json\r\nAccept: application/json\r\nContent-Length: ${bodyBytes.length}\r\nConnection: close\r\n\r\n`;
    const request = Buffer.concat([Buffer.from(head), bodyBytes]);
    if (request.length > 65536) throw Error("fixed raw request bound");
    // Authentic full sent bytes stay private and are never included in public archive.
    await writeFile(path.join(output!, "submitted-request.private.bin"), request, {
      mode: 0o600,
      flag: "wx",
    });
    const partial: Buffer[] = [];
    const errors: string[] = [];
    let received = 0,
      writeComplete = false,
      deliberatelyDestroyed = false;
    const socket = connect({ host: address.hostname, port: Number(address.port) });
    sockets.add(socket);
    const timer = setTimeout(
      () => socket.destroy(Error("original5000ms raw transport bound")),
      5000,
    );
    const evidence: Record<string, unknown> = {
      method: "POST",
      target: "/acme/operations/sequence",
      host: "reference.invalid",
      requestBytes: request.length,
      requestSHA256: sha(request),
      bodyBytes: bodyBytes.length,
      bodySHA256: sha(bodyBytes),
      bodyText: bodyBytes.toString(),
      requestRedactedBase64: Buffer.concat([
        Buffer.from(head.replace(credential.token, "<PRIVATE-OPERATOR-CREDENTIAL>")),
        bodyBytes,
      ]).toString("base64"),
      redactedBytesAreNotOriginalWire: true,
      privateOriginal: "submitted-request.private.bin",
    };
    facts.lostTransport = evidence;
    const closed = new Promise<void>((resolve) => {
      socket.on("error", (error) => errors.push(inspect(error, { depth: 4 })));
      socket.on("data", (chunk: Buffer) => {
        partial.push(Buffer.from(chunk));
        received += chunk.length;
        if (received > 1048576) socket.destroy(Error("raw response1MiB bound"));
      });
      socket.once("close", (hadError) => {
        clearTimeout(timer);
        sockets.delete(socket);
        Object.assign(evidence, {
          writeComplete,
          bytesWritten: socket.bytesWritten,
          deliberatelyDestroyed,
          closed: true,
          hadError,
          destroyed: socket.destroyed,
          readableEnded: socket.readableEnded,
          responsePrefixBytes: received,
          responsePrefixBase64: Buffer.concat(partial).toString("base64"),
          errors,
          responseComplete: false,
          outcomeFromTransport: "UNKNOWN",
        });
        resolve();
      });
    });
    socketClosures.push(closed);
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", () =>
        socket.write(request, (error) => {
          if (error) reject(error);
          else {
            writeComplete = true;
            resolve();
          }
        }),
      );
      socket.once("close", () => {
        if (!writeComplete) reject(Error("socket closed before write callback"));
      });
    });
    return {
      evidence,
      async destroyBeforeResponse() {
        evidence.beforeDestroyResponseBytes = received;
        deliberatelyDestroyed = true;
        socket.destroy();
        await closed;
      },
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
  function boundedCapture(value: unknown) {
    const text = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(text) > 4194304) throw Error("disconnect capture exceeds 4MiB");
    const agenda = [{ value, depth: 0 }];
    let count = 0;
    while (agenda.length) {
      const { value: v, depth } = agenda.pop()!;
      if (++count > 100000 || depth > 128) throw Error("disconnect capture nodes/depth");
      if (v && typeof v === "object")
        for (const [key, child] of Object.entries(v)) {
          if (!Array.isArray(v) && ++count > 100000) throw Error("disconnect capture key nodes");
          void key;
          agenda.push({ value: child, depth: depth + 1 });
        }
    }
    return text;
  }
  async function finish() {
    clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await Promise.allSettled(socketClosures);
    try {
      if (run) {
        const closed = await run.close();
        if (!closed || typeof closed !== "object" || Array.isArray(closed))
          throw Error("native terminal shape");
        const pid = run.child.pid;
        if (typeof pid !== "number") throw Error("native PID unavailable");
        let pidAbsent = false;
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          pidAbsent = true;
        }
        terminal = { ...closed, pid, pidAbsent };
        expect(pidAbsent).toBe(true);
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
    await Promise.allSettled(pendingExchanges);
    let storeRemoved = false;
    try {
      await rm(directory, { recursive: true, force: true });
      await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
      storeRemoved = true;
    } catch (e) {
      failures.push(e);
    }
    try {
      await writeFile(
        path.join(output!, name + ".json"),
        boundedCapture({
          name,
          source,
          entry,
          modules,
          schemaSHA256: sha(schema),
          fixture: { id: fixture.id, bytes: fixtureBytes.length, sha256: sha(fixtureBytes) },

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
        }),
        { mode: 0o600 },
      );
    } catch (e) {
      failures.push(e);
    }
    if (failures.length) throw new AggregateError(failures, "disconnect case or cleanup failed");
  }
  return { launch, send, pair, control, finish, submitLost, facts, failures };
}

export { start, scope, entry };
