/** Fresh packed Snapshot baseline/exclusive changefeed rendezvous; no persistent replica. */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_RENDEZVOUS_PRODUCT_INSTALLED_ENTRY;
const source = process.env.BDP_RENDEZVOUS_PRODUCT_SOURCE;
const build = process.env.BDP_RENDEZVOUS_PRODUCT_BUILD;
const evidence = process.env.BDP_RENDEZVOUS_PRODUCT_EVIDENCE;
const fixtureBytes = await readFile(
  new URL("../test-support/transactional-snapshot-rendezvous-fixture.json", import.meta.url),
);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const scope = "https://reference.invalid/acme/",
  beadType = `${scope}types/task`,
  linkType = `${scope}types/link`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);
type Row = {
  id: string;
  type: string;
  revision: string;
  properties: Record<string, string>;
  metadata: Record<string, unknown>;
  source?: string;
  target?: string;
};
type Page = { items: Row[]; next: string | null };
type Manifest = {
  id: string;
  scope: string;
  scopeEpoch: string;
  authorizationView: string;
  scopePosition: string;
  checkpoint: string;
  expiresAt: string;
  erasures: unknown[];
  beads: Page;
  links: Page;
};
function baseline(
  actual: { beads: Row[]; links: Row[] },
  expected: { beads: Row[]; links: Row[] },
) {
  expect(actual).toEqual(expected);
  for (const rows of [actual.beads, actual.links])
    expect(rows.map((row) => row.id)).toEqual([...rows.map((row) => row.id)].sort());
  const ids = new Set(actual.beads.map((row) => row.id));
  for (const row of actual.links) {
    expect(ids.has(String(row.source))).toBe(true);
    expect(ids.has(String(row.target))).toBe(true);
  }
}
it("baseline oracle rejects omitted/duplicate/reordered rows, changed revisions and changed endpoint identity", () => {
  const a: Row = {
      id: `${scope}beads/a`,
      type: beadType,
      revision: "a1",
      properties: { title: "a" },
      metadata: {},
    },
    b = { ...a, id: `${scope}beads/b`, revision: "b1" },
    l: Row = {
      ...a,
      id: `${scope}links/l`,
      type: linkType,
      revision: "l1",
      source: a.id,
      target: b.id,
    };
  const expected = { beads: [a, b], links: [l] };
  baseline(expected, expected);
  for (const wrong of [
    { beads: [a], links: [l] },
    { beads: [a, a, b], links: [l] },
    { beads: [b, a], links: [l] },
    { beads: [{ ...a, revision: "changed" }, b], links: [l] },
    { beads: [a, b], links: [{ ...l, target: `${scope}beads/missing` }] },
  ])
    expect(() => baseline(wrong, expected)).toThrow();
});
it.skipIf(!entry)(
  "packed Snapshot streams rendezvous with exactly the later exclusive changefeed group",
  async () => {
    if (!entry || !source || !build || !evidence)
      throw Error("explicit installed source/build/evidence required");
    const modules = [];
    for (const name of (await readdir(build)).filter((f) => f.endsWith(".js")).sort()) {
      const bytes = await readFile(path.join(path.dirname(entry), name));
      expect(bytes.equals(await readFile(path.join(build, name))), name).toBe(true);
      modules.push({ name, bytes: bytes.length, sha256: sha(bytes) });
    }
    const schemaBytes = await readFile(
      path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json"),
    );
    expect(schemaBytes.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(
      true,
    );
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-snapshot-rendezvous-")),
      token = randomBytes(32).toString("base64url");
    const configuration = {
      scope,
      directory,
      create: true,
      artifacts: fixture.artifacts,
      credentials: [{ token, principal: "writer", canMutate: true }],
    };
    const controller = new AbortController(),
      watchdog = setTimeout(() => controller.abort(Error("Snapshot rendezvous deadline")), 45000);
    const wires: unknown[] = [],
      failures: unknown[] = [];
    let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined,
      terminal: unknown,
      drained: Promise<void> | undefined,
      binding: unknown,
      result: unknown;
    try {
      child = await launchInstalledTransaction(entry, configuration, controller.signal);
      const serving = child.child;
      drained = new Promise<void>((resolve) =>
        serving.once("close", (code: number | null, signal: string | null) => {
          terminal = {
            code,
            signal,
            stdoutEOF: serving.stdout?.readableEnded,
            stderrEOF: serving.stderr?.readableEnded,
          };
          resolve();
        }),
      );
      binding = installedTransactionBinding(child.ready, source, { bytes: fixtureBytes });
      const address = new URL(String(child.ready.listenUrl));
      async function exchange(target: string, method: HttpMethod = "GET", body?: unknown) {
        const url = new URL(target, scope).href;
        if (
          new URL(url).origin !== new URL(scope).origin ||
          !new URL(url).pathname.startsWith("/acme/") ||
          wires.length >= 24
        )
          throw Error("unbound/excess rendezvous request");
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
        const response = await execute({
          method,
          url,
          signal: controller.signal,
          raw: {
            headerLines:
              body === undefined
                ? []
                : [
                    { name: "Content-Type", value: "application/json" },
                    { name: "Idempotency-Key", value: `rendezvous-${wires.length}` },
                  ],
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
          },
        });
        wires.push({
          method,
          url,
          requestBody: body,
          status: response.status,
          headers: response.headers,
          bodyText: response.bodyText,
          wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
        });
        expect(response.exactRequest?.writeState).toBe("complete");
        expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
        expect(response.status, response.bodyText).toBe(200);
        return { body: JSON.parse(response.bodyText), headers: response.headers };
      }
      const beads = Array.from({ length: 34 }, (_, i) => ({
        operation: "createBead",
        id: `beads/b${String(i).padStart(2, "0")}`,
        type: beadType,
        properties: { title: `bead-${i}` },
      }));
      const links = Array.from({ length: 33 }, (_, i) => ({
        operation: "createLink",
        id: `links/l${String(i).padStart(2, "0")}`,
        type: linkType,
        source: "beads/b00",
        target: "beads/b01",
        properties: { title: `link-${i}` },
      }));
      const expected: { beads: Row[]; links: Row[] } = { beads: [], links: [] };
      const operations = [...beads, ...links];
      for (let start = 0; start < operations.length; start += 32) {
        const selected = operations.slice(start, start + 32),
          seeded = await exchange("operations/batch", "POST", { operations: selected });
        expect(seeded.body.status).toBe("completed");
        expect(seeded.body.results).toHaveLength(selected.length);
        selected.forEach((op, i) => {
          const resource = seeded.body.results[i].resource as Row;
          expect(typeof resource.revision).toBe("string");
          expect(resource.revision.length).toBeGreaterThan(0);
          const wanted = {
            id: new URL(op.id, scope).href,
            type: op.type,
            revision: resource.revision,
            properties: op.properties,
            metadata: {},
            ...("source" in op ? { source: `${scope}beads/b00`, target: `${scope}beads/b01` } : {}),
          };
          expect(resource).toEqual(wanted);
          expected[op.operation === "createBead" ? "beads" : "links"].push(wanted);
        });
      }
      const captured = await exchange("snapshot"),
        manifest = captured.body as Manifest;
      expect(manifest.scope).toBe(scope);
      expect(manifest.scopePosition).toBe("pos-3");
      expect(manifest.erasures).toEqual([]);
      expect(typeof manifest.checkpoint).toBe("string");
      expect(manifest.checkpoint.length).toBeGreaterThan(0);
      for (const [name, value] of [
        ["bdp-scope-epoch", manifest.scopeEpoch],
        ["bdp-authorization-view", manifest.authorizationView],
        ["bdp-scope-position", manifest.scopePosition],
      ])
        expect(captured.headers[name!]).toBe(value);
      expect(manifest.beads.next).not.toBeNull();
      expect(manifest.links.next).not.toBeNull();
      const pages: unknown[] = [];
      async function collect(first: Page, position: string) {
        const items = [...first.items];
        let next = first.next;
        const visited = new Set<string>();
        while (next !== null) {
          expect(visited.size).toBeLessThan(4);
          expect(visited.has(next)).toBe(false);
          visited.add(next);
          const page = await exchange(next);
          expect(page.headers["bdp-scope-epoch"]).toBe(manifest.scopeEpoch);
          expect(page.headers["bdp-authorization-view"]).toBe(manifest.authorizationView);
          expect(page.headers["bdp-scope-position"]).toBe(position);
          expect(Object.keys(page.body).sort()).toEqual(["items", "next"]);
          items.push(...page.body.items);
          pages.push({ url: next, body: page.body });
          next = page.body.next;
        }
        return items;
      }
      const original = {
        beads: await collect(manifest.beads, "pos-3"),
        links: await collect(manifest.links, "pos-3"),
      };
      baseline(original, expected);
      expect(original.beads).toHaveLength(34);
      expect(original.links).toHaveLength(33);
      const laterOperations = [
        {
          operation: "updateBead",
          bead: "beads/b00",
          propertiesChange: [{ op: "replace", path: "/title", value: "after-bead" }],
        },
        {
          operation: "updateLink",
          link: "links/l00",
          propertiesChange: [{ op: "replace", path: "/title", value: "after-link" }],
        },
        {
          operation: "createBead",
          id: "beads/new",
          type: beadType,
          properties: { title: "after-new" },
        },
      ];
      const later = await exchange("operations/batch", "POST", { operations: laterOperations });
      expect(later.body.status).toBe("completed");
      expect(later.body.effectPosition).toBe("pos-4");
      expect(later.body.results).toHaveLength(3);
      const oldBead = expected.beads[0]!,
        oldLink = expected.links[0]!;
      const changed = [
        {
          ...oldBead,
          revision: later.body.results[0].resource.revision,
          properties: { title: "after-bead" },
        },
        {
          ...oldLink,
          revision: later.body.results[1].resource.revision,
          properties: { title: "after-link" },
        },
        {
          id: `${scope}beads/new`,
          type: beadType,
          revision: later.body.results[2].resource.revision,
          properties: { title: "after-new" },
          metadata: {},
        },
      ];
      expect(changed[0]!.revision).not.toBe(oldBead.revision);
      expect(changed[1]!.revision).not.toBe(oldLink.revision);
      later.body.results.forEach((item: { resource: Row }, i: number) => {
        expect(item.resource).toEqual(changed[i]);
      });
      const after = new URL("changes/", scope);
      after.searchParams.set("after", manifest.checkpoint);
      let next: string | null = after.href;
      const groups = [],
        feedPages = [],
        visited = new Set<string>();
      while (next !== null) {
        expect(visited.size).toBeLessThan(4);
        expect(visited.has(next)).toBe(false);
        visited.add(next);
        const requested = new URL(next).searchParams.get("after"),
          page = await exchange(next);
        expect(page.body.after).toBe(requested);
        expect(page.body.scope).toBe(scope);
        expect(page.body.scopeEpoch).toBe(manifest.scopeEpoch);
        expect(page.body.authorizationView).toBe(manifest.authorizationView);
        expect(page.body.observedHeadPosition).toBe("pos-4");
        expect(page.headers["bdp-scope-epoch"]).toBe(manifest.scopeEpoch);
        expect(page.headers["bdp-authorization-view"]).toBe(manifest.authorizationView);
        expect(page.headers["bdp-scope-position"]).toBe("pos-4");
        groups.push(...page.body.groups);
        feedPages.push(page.body);
        next = page.body.next;
      }
      expect(groups).toHaveLength(1);
      const group = groups[0]!;
      expect(group).toMatchObject({
        scopeEpoch: manifest.scopeEpoch,
        authorizationView: manifest.authorizationView,
        position: "pos-4",
        previousPosition: manifest.scopePosition,
        transaction: later.body.transaction,
        projectionAdvance: false,
        eventCount: 3,
        erasures: [],
      });
      expect(group.checkpoint).not.toBe(manifest.checkpoint);
      expect([...group.changes].sort((a, b) => (a.resource.id < b.resource.id ? -1 : 1))).toEqual(
        changed
          .map((resource) => ({
            operation: "upsert",
            resourceKind: resource.type === beadType ? "bead" : "link",
            resource,
          }))
          .sort((a, b) => (a.resource.id < b.resource.id ? -1 : 1)),
      );
      expect(
        group.events.map((event: { ordinal: number; type: string; subject: string }) => [
          event.ordinal,
          event.type,
          event.subject,
        ]),
      ).toEqual([
        [0, "updated", oldBead.id],
        [1, "updated", oldLink.id],
        [2, "created", `${scope}beads/new`],
      ]);
      expect(group.events[0].data).toMatchObject({
        previousRevision: oldBead.revision,
        revision: changed[0]!.revision,
      });
      expect(group.events[1].data).toMatchObject({
        previousRevision: oldLink.revision,
        revision: changed[1]!.revision,
      });
      for (const event of group.events) expect(event.transaction).toBe(group.transaction);
      const refetched = await exchange(manifest.id);
      expect(refetched.body).toEqual(manifest);
      expect(refetched.headers["bdp-scope-position"]).toBe("pos-4");
      const retained = {
        beads: await collect(refetched.body.beads, "pos-4"),
        links: await collect(refetched.body.links, "pos-4"),
      };
      baseline(retained, expected);
      baseline(original, expected);
      for (const resource of changed) {
        const fresh = await exchange(resource.id);
        expect(fresh.body).toEqual(resource);
      }
      result = {
        manifest,
        original,
        retained,
        pages,
        feedPages,
        groups,
        expectedLaterPostimages: changed,
        baselineCount: { beads: 34, links: 33 },
        checkpointSource:
          "The one actual manifest.checkpoint, verbatim; no genesis/start-now/substitute feed.",
      };
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(watchdog);
      try {
        if (child) {
          await child.close();
          await drained;
          expect(terminal).toMatchObject({
            code: 0,
            signal: null,
            stdoutEOF: true,
            stderrEOF: true,
          });
        }
      } catch (error) {
        failures.push(error);
      }
      try {
        await writeFile(
          path.join(evidence, "observation.json"),
          JSON.stringify(
            {
              source,
              entry,
              modules,
              schemaSHA256: sha(schemaBytes),
              fixtureSHA256: sha(fixtureBytes),
              configuration: {
                ...configuration,
                credentials: [{ credentialRef: "writer", principal: "writer", canMutate: true }],
              },
              binding,
              terminal,
              result,
              wires,
              failures: failures.map((error) => inspect(error, { depth: 8 })),
              wholeProfile: false,
              persistentReplica: false,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      } catch (error) {
        failures.push(error);
      } finally {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "installed Snapshot rendezvous or cleanup failed");
  },
  45000,
);
