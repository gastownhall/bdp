/** Actual installed G2 HTTP observations; partial coverage, never profile qualification. */
import { type ChildProcess, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { expect, it } from "vitest";
import { recordRawSse } from "../../../packages/server/test-support/raw-sse-recorder.js";
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
const entry = realpathSync(
  process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY ??
    path.join(root, "packages/server/dist/transaction-installed-process.js"),
);
const source =
  process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
if (
  Boolean(process.env.BDP_TRANSACTIONAL_INSTALLED_ENTRY) !==
  Boolean(process.env.BDP_TRANSACTIONAL_SOURCE_COMMIT)
)
  throw new Error("installed overrides must be paired");
const fixture = {
  bytes: readFileSync(
    path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
  ),
};
const scope = "https://reference.invalid/acme/",
  type = `${scope}types/task`,
  linkType = `${scope}types/link`;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected HTTP object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw new Error("missing HTTP identity");
  return value;
}
function context(headers: Readonly<Record<string, string>>) {
  const epoch = text(headers["bdp-scope-epoch"]),
    view = text(headers["bdp-authorization-view"]),
    position = text(headers["bdp-scope-position"]);
  expect(epoch).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(view).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(position).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  return { epoch, view, position };
}

it.each([false, true])(
  "installed G2 endpoint metadata finite/SSE/reconnect and no-op (owned=%s)",
  async (owned) => {
    const controller = new AbortController(),
      directory = mkdtempSync(path.join(tmpdir(), "bdp-incident-installed-")),
      token = randomBytes(32).toString("base64url");
    const timer = setTimeout(() => controller.abort(new Error("incident cohort deadline")), 45000);
    const observations: unknown[] = [],
      streams: unknown[] = [],
      failures: unknown[] = [];
    let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined,
      live: ReturnType<typeof recordRawSse> | undefined,
      binding: unknown,
      complete = false;
    const descriptors = [
      {
        id: type,
        name: "Task",
        describes: "bead",
        conformsTo: [],
        ...(owned ? { ownsOutgoing: { [linkType]: { max: 32 } } } : {}),
      },
      {
        id: linkType,
        name: "Link",
        describes: "link",
        conformsTo: [],
        source: { conformsTo: [], external: "opaque" },
        target: { conformsTo: [], external: "opaque" },
      },
    ];
    try {
      child = await launchInstalledTransaction(
        entry,
        {
          scope,
          directory,
          create: true,
          artifacts: {
            descriptors: descriptors.map((d) => ({ retrievalUri: d.id, utf8: JSON.stringify(d) })),
            schemas: [],
          },
          credentials: [{ token, principal: "writer", canMutate: true }],
        },
        controller.signal,
      );
      binding = installedTransactionBinding(child.ready, source, fixture);
      expect(child.ready.profile).toBe("transactional");
      const address = new URL(text(child.ready.listenUrl));
      let count = 0,
        key = 0;
      const exchange = async (target: string, operations?: unknown[]) => {
        if (++count > 48) throw new Error("incident request ceiling");
        const url = new URL(target, scope).href,
          method = operations ? ("POST" as const) : ("GET" as const);
        if (!url.startsWith(scope)) throw new Error("escaped scope");
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
              defaultCredentialRef: "writer",
              credentialHandles: [{ id: "writer", headerNames: ["authorization"] }],
              resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
            },
          },
        );
        const body = operations ? JSON.stringify({ operations }) : undefined;
        const r = await execute({
          method,
          url,
          signal: controller.signal,
          credentialRef: "writer",
          raw: {
            headerLines: operations
              ? [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: `incident_${key++}` },
                ]
              : [],
            ...(body ? { bodyBytes: Buffer.from(body) } : {}),
          },
        });
        observations.push({
          target,
          method,
          requestBody: body,
          status: r.status,
          headers: r.headers,
          body: r.bodyText,
          wireResponseBase64: Buffer.from(r.wireResponseBytes ?? []).toString("base64"),
          writeState: r.exactRequest?.writeState,
        });
        expect(r.status, r.bodyText).toBe(200);
        expect(r.exactRequest?.writeState).toBe("complete");
        expect(r.wireResponseBytes?.length).toBeGreaterThan(0);
        for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          text(r.headers[name]);
        const parsed = object(JSON.parse(r.bodyText));
        if (operations) expect(parsed.status).toBe("completed");
        return { r, parsed };
      };
      const page = async (target: string) => {
        const { r, parsed } = await exchange(target);
        expect(parsed.next).toBeNull();
        if (!Array.isArray(parsed.events)) throw new Error("missing Events");
        return { r, events: parsed.events.map(object) };
      };
      const create = (id: string) => ({
        operation: "createBead",
        id: `beads/${id}`,
        type,
        properties: { n: 0 },
      });
      const link = (id: string, target: unknown) => ({
        operation: "createLink",
        id: `links/${id}`,
        type: linkType,
        source: "beads/a",
        target,
        properties: { n: 0 },
      });
      await exchange("operations/batch", [
        create("a"),
        create("b"),
        link("l", "beads/b"),
        link("self", "beads/a"),
        link("external", { uri: "https://outside.invalid/beads/x", revision: "r-external" }),
      ]);
      const first = [{ op: "add", path: "/note", value: "first" }],
        second = [{ op: "replace", path: "/note", value: "second" }],
        equal = [{ op: "replace", path: "/n", value: 0 }];
      await exchange("operations/batch", [
        { operation: "updateLink", link: "links/l", metadataChange: first },
      ]);
      await exchange("operations/batch", [
        {
          operation: "updateLink",
          link: "links/l",
          propertiesChange: equal,
          metadataChange: second,
        },
      ]);
      const allLink = await page("links/l?view=events"),
        updates = allLink.events.filter((e) => e.type === "updated");
      expect(updates).toHaveLength(2);
      expect(updates[0]?.data).toMatchObject({ metadataChange: first });
      expect(updates[0]?.data).not.toHaveProperty("change");
      expect(updates[1]?.data).toMatchObject({ metadataChange: second, change: equal });
      const frames = (s: ReturnType<typeof recordRawSse>) =>
        s.frames.filter((f) => f.startsWith("id: "));
      const parse = (f: string) => object(JSON.parse(text(f.split("\ndata: ")[1])));
      const remember = (s: ReturnType<typeof recordRawSse>, target: string, after?: string) =>
        streams.push({
          target,
          after,
          status: s.status,
          headers: s.headers,
          frames: s.frames,
          wireResponseBase64: s.wireBytes.toString("base64"),
          wireSha256: createHash("sha256").update(s.wireBytes).digest("hex"),
          elapsedMilliseconds: s.elapsedMs,
          closed: s.destroyed,
        });
      const open = (target: string, after?: string) =>
        recordRawSse({
          dial: address.href,
          host: "reference.invalid",
          target: `/acme/${target}`,
          headers: [
            ["Authorization", `Bearer ${token}`],
            ["Accept", "text/event-stream"],
            ...(after ? [["Last-Event-ID", after] as [string, string]] : []),
          ],
          signal: controller.signal,
          timeoutMs: 10000,
        });
      const endpoints: Record<string, Record<string, unknown>[]> = {};
      for (const id of ["a", "b"]) {
        const target = `beads/${id}?view=events`,
          finite = await page(target);
        endpoints[id] = finite.events;
        const incident = finite.events.filter(
          (e) => e.subject === `${scope}links/l` && e.type === "updated",
        );
        expect(incident).toHaveLength(2);
        expect(incident.map((e) => [e.transaction, e.ordinal, e.data])).toEqual(
          updates.map((e) => [e.transaction, e.ordinal, e.data]),
        );
        live = open(target);
        const firstStream = live;
        await firstStream.until(() => frames(firstStream).length >= finite.events.length);
        expect(live.status).toBe(200);
        expect(live.headers).toMatchObject({
          "content-type": "text/event-stream",
          "cache-control": "no-store, no-transform",
          vary: "Accept",
        });
        expect(context(live.headers)).toEqual(context(finite.r.headers));
        expect(frames(live).map(parse)).toEqual(finite.events);
        for (const f of frames(live))
          expect(finite.r.bodyText).toContain(text(f.split("\ndata: ")[1]));
        await live.close();
        remember(live, target);
        live = undefined;
        const after = text(incident[0]?.id);
        live = open(target, after);
        const reconnect = live;
        const resumeIndex = finite.events.findIndex((e) => e.id === after);
        expect(resumeIndex).toBeGreaterThanOrEqual(0);
        const successors = finite.events.slice(resumeIndex + 1);
        await reconnect.until(() => frames(reconnect).length >= successors.length);
        expect(frames(reconnect).map(parse)).toEqual(successors);
        await live.close();
        remember(live, target, after);
        live = undefined;
      }
      const before = await page("events/");
      await exchange("operations/batch", [
        {
          operation: "updateLink",
          link: "links/l",
          propertiesChange: equal,
          metadataChange: second,
        },
      ]);
      const noop = await page("events/");
      expect(noop.events).toEqual(before.events);
      expect(noop.r.headers["bdp-scope-position"]).toBe(before.r.headers["bdp-scope-position"]);
      for (const id of ["a", "b"]) {
        const target = `beads/${id}?view=events`,
          unchanged = await page(target);
        expect(unchanged.events).toEqual(endpoints[id]);
        live = open(target);
        const noOpStream = live;
        await noOpStream.until(() => frames(noOpStream).length >= unchanged.events.length);
        expect(frames(noOpStream).map(parse)).toEqual(unchanged.events);
        expect(context(noOpStream.headers)).toEqual(context(unchanged.r.headers));
        await noOpStream.close();
        remember(noOpStream, target);
        live = undefined;
      }
      for (const id of ["self", "external"])
        await exchange("operations/batch", [
          {
            operation: "updateLink",
            link: `links/${id}`,
            metadataChange: [{ op: "add", path: "/note", value: id }],
          },
        ]);
      const a = (await page("beads/a?view=events")).events,
        b = (await page("beads/b?view=events")).events;
      for (const id of ["self", "external"]) {
        const expected = (await page(`links/${id}?view=events`)).events.filter(
          (e) => e.type === "updated",
        );
        expect(expected).toHaveLength(1);
        const actual = a.filter((e) => e.subject === `${scope}links/${id}` && e.type === "updated");
        expect(actual).toHaveLength(1);
        expect(actual.map((e) => [e.transaction, e.ordinal, e.data])).toEqual(
          expected.map((e) => [e.transaction, e.ordinal, e.data]),
        );
        expect(b.filter((e) => e.subject === `${scope}links/${id}`)).toHaveLength(0);
      }
      complete = true;
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await live?.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await child?.close();
      } catch (error) {
        failures.push(error);
      }
      clearTimeout(timer);
      const lifecycle = child
        ? {
            pid: child.child.pid,
            exit: child.child.exitCode,
            signal: child.child.signalCode,
            bothEOF: child.child.stdout?.readableEnded && child.child.stderr?.readableEnded,
          }
        : undefined;
      if (child) {
        try {
          expect(lifecycle).toMatchObject({ exit: 0, signal: null, bothEOF: true });
        } catch (error) {
          failures.push(error);
        }
      }
      if (!failures.length) rmSync(directory, { recursive: true, force: true });
      const report = {
        observation: "installed-G2-incident-metadata",
        claimEligible: false,
        owned,
        source,
        entry,
        entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
        binding,
        ready: child?.ready,
        complete,
        failureCount: failures.length,
        observations,
        streams,
        lifecycle,
        directoryRetained: failures.length ? directory : undefined,
        node: process.version,
      };
      const encoded = JSON.stringify(report);
      if (encoded.includes(token)) {
        failures.push(new Error("credential escaped report"));
        console.log(JSON.stringify({ observation: report.observation, credentialLeak: true }));
      } else console.log(encoded);
    }
    if (failures.length)
      throw new AggregateError(failures, "installed incident metadata observation failed");
  },
  60000,
);
