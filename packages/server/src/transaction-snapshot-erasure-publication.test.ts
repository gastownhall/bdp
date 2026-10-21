/** NEW actual NodeHTTP race through existing real-time observer and authentic local admin. */
import { randomBytes, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnection } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { parseTypeDescriptor } from "@bdp/protocol";
import {
  startTransactionRuntime,
  transactionRuntimeAdministration,
} from "./transaction-runtime.js";
it("NEW real NodeHTTP issued Snapshot page expires when authentic erasure wins after owner selection but before delivery", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-snapshot-publication-")),
    scope = "https://snapshot-publication.test/s/",
    type = scope + "types/task",
    token = randomBytes(32).toString("base64url");
  const timeline: unknown[] = [],
    wires: unknown[] = [];
  let armed = false,
    erasureFailure: unknown,
    erased: unknown,
    captureCount: number | undefined;
  let erase: (() => unknown) | undefined;
  const runtime = await startTransactionRuntime(
    {
      directory,
      scope,
      authorityMode: "canonical",
      port: 0,
      create: true,
      types: [parseTypeDescriptor({ id: type, name: "Task", describes: "bead", conformsTo: [] })],
      credentials: [{ token, principal: "p", canMutate: true }],
    },
    {
      clock: () => {
        const now = Date.now(); // Observe real time; no invented return, clock advance or deadline change.
        if (armed) {
          armed = false;
          timeline.push({ phase: "clock-observed", now });
          queueMicrotask(() => {
            timeline.push({ phase: "erasure-microtask-enter", now: Date.now() });
            try {
              if (!erase) throw Error("authentic administration not selected");
              erased = erase();
              timeline.push({ phase: "authentic-erasure-committed", erased });
            } catch (error) {
              erasureFailure = error;
            }
          });
        }
        return now;
      },
    },
  );
  let closed = false;
  async function request(target: string, method = "GET", body?: unknown, key?: string) {
    const url = new URL(target, scope),
      address = new URL(runtime.listenUrl),
      data = body === undefined ? undefined : JSON.stringify(body);
    const raw = Buffer.from(
      `${method} ${url.pathname + url.search} HTTP/1.1\r\nHost: ${new URL(scope).host}\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n${data === undefined ? "" : `Content-Type: application/json\r\nIdempotency-Key: ${key}\r\nContent-Length: ${Buffer.byteLength(data)}\r\n`}\r\n${data ?? ""}`,
    );
    const response = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let bytes = 0,
        ended = false;
      const socket = createConnection({ host: address.hostname, port: Number(address.port) }, () =>
        socket.write(raw),
      );
      const timer = setTimeout(() => socket.destroy(Error("NEW rawHTTP3s deadline")), 3000);
      socket.on("data", (b) => {
        bytes += b.length;
        if (bytes > 1048576) socket.destroy(Error("NEW rawHTTP1MiB cap"));
        else chunks.push(b);
      });
      socket.on("end", () => {
        ended = true;
      });
      socket.on("error", reject);
      socket.on("close", () => {
        clearTimeout(timer);
        if (ended) resolve(Buffer.concat(chunks));
        else reject(Error("NEW rawHTTP missing native EOF"));
      });
    });
    const split = response.indexOf("\r\n\r\n"),
      head = response.subarray(0, split).toString(),
      bodyText = response.subarray(split + 4).toString(),
      lines = head.split("\r\n"),
      status = Number(lines.shift()!.split(" ")[1]),
      headers = Object.fromEntries(
        lines.map((line) => {
          const at = line.indexOf(":");
          return [line.slice(0, at).toLowerCase(), line.slice(at + 1).trim()];
        }),
      );
    expect(Number(headers["content-length"])).toBe(
      method === "HEAD" ? Number(headers["content-length"]) : Buffer.byteLength(bodyText),
    );
    const observation = {
      method,
      target: url.href,
      requestBytes: raw.length,
      requestSHA256: createHash("sha256").update(raw).digest("hex"),
      requestContainsPrivateAuthorization: true,
      responseBase64: response.toString("base64"),
      status,
      headers,
      bodyText,
      nativeEOF: true,
    };
    wires.push(observation);
    console.log("SNAPSHOT_PUBLICATION_HTTP " + JSON.stringify(observation));
    return { status, headers, bodyText, value: bodyText ? JSON.parse(bodyText) : undefined };
  }
  try {
    const ids = Array.from({ length: 33 }, (_, i) => `r${String(i).padStart(2, "0")}`);
    let original: { id: string; revision: string } | undefined;
    for (const [i, chunk] of [ids.slice(0, 32), ids.slice(32)].entries()) {
      const seed = await request(
        "operations/batch",
        "POST",
        {
          operations: chunk.map((id) => ({
            operation: "createBead",
            id: `beads/${id}`,
            type,
            properties: { secret: id === "r32" ? "withheld-page-secret" : "safe" },
            metadata: {},
          })),
        },
        `seed-${i}`,
      );
      expect(seed.status).toBe(200);
      if (i === 1) original = seed.value.results[0].resource;
    }
    if (!original) throw Error("genuine old revision missing");
    const captured = await request("snapshot");
    expect(captured.status).toBe(200);
    const saved = captured.value,
      target = saved.beads.next;
    expect(typeof target).toBe("string");
    const updated = await request(
      "operations/batch",
      "POST",
      {
        operations: [
          {
            operation: "updateBead",
            bead: "beads/r32",
            propertiesChange: [{ op: "replace", path: "/secret", value: "healthy-successor" }],
          },
        ],
      },
      "update",
    );
    expect(updated.status).toBe(200);
    const baseline = await request(target);
    expect(baseline.status).toBe(200);
    expect(baseline.value.items[0]).toEqual({
      ...original,
      type,
      properties: { secret: "withheld-page-secret" },
      metadata: {},
    });
    const admin = transactionRuntimeAdministration(runtime);
    erase = () =>
      admin.eraseHistoricalVersions([{ subject: original!.id, revision: original!.revision }]);
    armed = true;
    const race = await request(target);
    timeline.push({ phase: "race-wire-complete", status: race.status });
    expect(armed).toBe(false);
    expect(erasureFailure).toBeUndefined();
    expect(erased).toMatchObject({ context: { scopePosition: "pos-4" } });
    expect.soft(race.status).toBe(410);
    expect.soft(race.bodyText).not.toContain("withheld-page-secret");
    expect.soft(race.value).toEqual({
      type: "https://github.com/gastownhall/bdp/problems/gone",
      code: "cursor-expired",
      status: 410,
      retry: "after-state-change",
    });
    expect.soft(race.headers["bdp-scope-epoch"]).toBe(saved.scopeEpoch);
    expect.soft(race.headers["bdp-authorization-view"]).toBe(saved.authorizationView);
    expect.soft(race.headers["bdp-scope-position"]).toBe("pos-4");
    const after = await request(target);
    expect(after.status).toBe(410);
    expect(after.value.code).toBe("cursor-expired");
    const head = await request(target, "HEAD");
    expect(head.status).toBe(410);
    expect(head.bodyText).toBe("");
    expect(head.headers["bdp-scope-position"]).toBe("pos-4");
    const healthy = await request("beads/r32");
    expect(healthy.status).toBe(200);
    expect(healthy.value.properties).toEqual({ secret: "healthy-successor" });
    await runtime.close();
    closed = true;
    const db = new DatabaseSync(path.join(directory, "transaction.sqlite"), { readOnly: true });
    try {
      const snapshots = db.prepare("SELECT id,disposition FROM snapshots").all();
      captureCount = snapshots.length;
      expect(snapshots).toHaveLength(1);
      const d = JSON.parse(String(snapshots[0]!.disposition));
      expect(d.expired).toBe(true);
      expect(new Date(d.expires).toISOString()).toBe(saved.expiresAt);
    } finally {
      db.close();
    }
  } finally {
    try {
      if (!closed) await runtime.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
      console.log(
        "SNAPSHOT_PUBLICATION_COMPLETION " +
          JSON.stringify({
            timeline,
            HTTP: wires.length,
            erasureFailure:
              erasureFailure instanceof Error ? erasureFailure.message : erasureFailure,
            realClockObserver: true,
            ordinaryConfigurationIdentity: null,
            retainedSnapshotCount: captureCount,
            cleanupCompleted: true,
          }),
      );
    }
  }
}, 15000);
