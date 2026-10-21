/** NEW ordinary installed alias transaction boundaries, not inherited proof execution. */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { expect, it } from "vitest";
import { installedTransactionBinding } from "../test-support/transactional-execution-binding.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_ALIAS_BOUNDARIES_PRODUCT_ENTRY;
const source = process.env.BDP_ALIAS_BOUNDARIES_PRODUCT_SOURCE;
const build = process.env.BDP_ALIAS_BOUNDARIES_PRODUCT_BUILD;
const output = process.env.BDP_ALIAS_BOUNDARIES_PRODUCT_OUTPUT;
const scope = "https://reference.invalid/acme/";
const type = `${scope}types/alias-boundary`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);

it.skipIf(!entry)(
  "packaged aliases reject batch admission and retain locator-only receipt identity without Resource history",
  async () => {
    if (!entry || !source || !build || !output)
      throw Error("explicit installed/source/build/output required");
    const modules = [];
    for (const name of (await readdir(build)).filter((n) => n.endsWith(".js")).sort()) {
      const b = await readFile(path.join(path.dirname(entry), name));
      expect(b.equals(await readFile(path.join(build, name))), name).toBe(true);
      modules.push({ name, bytes: b.length, sha256: sha(b) });
    }
    const schemaBytes = await readFile(
      path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json"),
    );
    expect(schemaBytes.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(
      true,
    );
    const fixtureBytes = await readFile(
      new URL("../test-support/transactional-alias-boundaries-fixture.json", import.meta.url),
    );
    const fixture = JSON.parse(fixtureBytes.toString("utf8"));
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-alias-boundaries-product-"));
    const tokens = {
      writer: randomBytes(32).toString("base64url"),
      other: randomBytes(32).toString("base64url"),
    };
    const configuration = {
      scope,
      directory,
      credentials: Object.entries(tokens).map(([principal, token]) => ({
        principal,
        token,
        canMutate: principal === "writer",
      })),
      artifacts: fixture.artifacts,
    };
    const controller = new AbortController();
    const watchdog = setTimeout(
      () => controller.abort(Error("alias boundaries product deadline")),
      20000,
    );
    const wires: unknown[] = [],
      generations: unknown[] = [],
      failures: unknown[] = [];
    let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
    let drained: Promise<void> | undefined;
    let terminal: unknown;
    let firstBinding: unknown;
    let address: URL;
    let epoch: string | undefined, view: string | undefined;
    let position = "pos-0";
    async function start(create: boolean) {
      child = await launchInstalledTransaction(
        entry!,
        { ...configuration, create },
        controller.signal,
      );
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
      const binding = installedTransactionBinding(child.ready, source!, { bytes: fixtureBytes });
      firstBinding ??= binding;
      expect(binding).toEqual(firstBinding);
      generations.push({ create, ready: child.ready, binding });
      address = new URL(String(child.ready.listenUrl));
    }
    async function stop() {
      if (!child) return;
      const current = child;
      try {
        await current.close();
        await drained;
        expect(terminal).toMatchObject({ code: 0, signal: null, stdoutEOF: true, stderrEOF: true });
      } finally {
        generations.push({ terminal });
        child = undefined;
      }
    }
    async function send(
      target: string,
      principal: keyof typeof tokens = "writer",
      method: "GET" | "HEAD" | "POST" = "GET",
      body?: unknown,
      key?: string,
      ownerObservation = true,
    ) {
      expect(wires.length).toBeLessThan(40);
      const url = new URL(target, scope).href;
      expect(new URL(url).origin).toBe(new URL(scope).origin);
      expect(new URL(url).pathname.startsWith("/acme/")).toBe(true);
      const raw = body === undefined ? undefined : JSON.stringify(body);
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
            defaultCredentialRef: principal,
            credentialHandles: [{ id: principal, headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${tokens[principal]}` }),
          },
        },
      );
      const response = await execute({
        method,
        url,
        signal: controller.signal,
        raw: {
          headerLines:
            raw === undefined
              ? []
              : [
                  { name: "Content-Type", value: "application/json" },
                  { name: "Idempotency-Key", value: key! },
                ],
          ...(raw === undefined ? {} : { bodyBytes: Buffer.from(raw) }),
        },
      });
      // Header values in exactRequest contain credentials; retain safe metadata and full response only.
      wires.push({
        principal,
        method,
        url,
        requestBody: raw,
        key,
        requestWriteState: response.exactRequest?.writeState,
        requestBodyDigest: response.exactRequest?.bodyDigest,
        status: response.status,
        headers: response.headers,
        bodyText: response.bodyText,
        wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
      });
      expect(response.exactRequest?.writeState).toBe("complete");
      expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
      if (raw !== undefined) expect(response.exactRequest?.bodyDigest).toBe(sha(Buffer.from(raw)));
      // The explicit malformed carrier probe has no owner-prefix assertion.
      // Its raw headers remain retained; generic syntax-header semantics are not this case.
      if (!ownerObservation) return response;
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(response.headers[name], name).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      epoch ??= response.headers["bdp-scope-epoch"];
      view ??= response.headers["bdp-authorization-view"];
      expect(response.headers["bdp-scope-epoch"]).toBe(epoch);
      expect(response.headers["bdp-authorization-view"]).toBe(view);
      expect(response.headers["bdp-scope-position"]).toBe(position);
      return response;
    }
    async function request(target: string, body?: unknown, key?: string, ownerObservation = true) {
      const response = await send(
        target,
        "writer",
        body === undefined ? "GET" : "POST",
        body,
        key,
        ownerObservation,
      );
      return { response, value: response.bodyText ? JSON.parse(response.bodyText) : undefined };
    }
    async function snapshot(expectedBeads: unknown[], expectedLinks: unknown[]) {
      const observed = await request("snapshot");
      expect(observed.response.status).toBe(200);
      const manifest = observed.value;
      expect(manifest.scope).toBe(scope);
      expect(manifest.scopeEpoch).toBe(epoch);
      expect(manifest.authorizationView).toBe(view);
      expect(manifest.scopePosition).toBe(position);
      expect(manifest.id.startsWith(`${scope}snapshot?snapshot=`)).toBe(true);
      expect(manifest.checkpoint).toMatch(/^cg_/);
      expect(manifest.beads).toEqual({ items: expectedBeads, next: null });
      expect(manifest.links).toEqual({ items: expectedLinks, next: null });
      return observed;
    }
    async function aliasReceipt(target: string, body: unknown, key: string, result: unknown) {
      const observed = await request(`operations/${target}`, body, key);
      expect(observed.response.status).toBe(200);
      const r = observed.value;
      expect(r.id).toMatch(/^https:\/\/reference\.invalid\/acme\/receipts\/[A-Za-z0-9_-]+$/);
      expect(r.transaction).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Number.isFinite(Date.parse(r.expiresAt))).toBe(true);
      expect(r).toEqual({
        id: r.id,
        status: "completed",
        idempotencyKey: key,
        scopeEpoch: epoch,
        authorizationView: view,
        transaction: r.transaction,
        detail: "available",
        requiredPosition: "pos-1",
        results: [result],
        next: null,
        expiresAt: r.expiresAt,
      });
      for (const name of ["etag", "last-modified"])
        expect(observed.response.headers[name]).toBeUndefined();
      expect(observed.response.headers["cache-control"]).toBe("private, no-store");
      return observed;
    }
    async function redirect(target: string) {
      const response = await send("alias/work");
      expect(response.status).toBe(307);
      expect(response.headers.location).toBe(`${scope}beads/${target}`);
      expect(response.bodyText).toBe("");
    }
    try {
      await start(true);
      const create = (id: string) => ({
        operation: "createBead",
        id: `beads/${id}`,
        type,
        properties: { label: id },
        metadata: { fixture: "alias-boundary" },
      });
      const malformed = await request(
        "operations/batch",
        {
          operations: [
            create("a"),
            { operation: "putAlias", alias: "alias/work", target: "beads/a" },
          ],
        },
        "alias-batch-key",
        false,
      );
      expect(malformed.response.status).toBe(400);
      expect(malformed.value).toMatchObject({ code: "malformed-request", status: 400 });
      const absent = await request("beads/a");
      expect(absent.response.status).toBe(404);
      expect(absent.value.code).toBe("resource-not-found");
      const noAlias = await request("alias/work");
      expect(noAlias.response.status).toBe(404);
      expect(noAlias.value.code).toBe("resource-not-found");
      position = "pos-1";
      const seeded = await request(
        "operations/batch",
        {
          operations: [
            create("a"),
            create("b"),
            {
              operation: "createLink",
              id: "links/edge",
              type: `${scope}types/alias-edge`,
              source: "beads/a",
              target: "beads/b",
              properties: { label: "edge" },
              metadata: { fixture: "alias-boundary" },
            },
          ],
        },
        "alias-batch-key",
      );
      expect(seeded.response.status).toBe(200);
      expect(seeded.value.status).toBe("completed");
      expect(seeded.value.requiredPosition).toBe(position);
      expect(seeded.value.effectPosition).toBe(position);
      expect(seeded.value.results).toHaveLength(3);
      expect(seeded.value.next).toBeNull();
      const resources = seeded.value.results.map(
        (r: { resource: Record<string, unknown> }) => r.resource,
      );
      for (const [index, id] of ["a", "b", "edge"].entries()) {
        const resource = resources[index];
        expect(resource.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
        const expected =
          index < 2
            ? {
                id: `${scope}beads/${id}`,
                type,
                revision: resource.revision,
                properties: { label: id },
                metadata: { fixture: "alias-boundary" },
              }
            : {
                id: `${scope}links/edge`,
                type: `${scope}types/alias-edge`,
                revision: resource.revision,
                source: `${scope}beads/a`,
                target: `${scope}beads/b`,
                properties: { label: "edge" },
                metadata: { fixture: "alias-boundary" },
              };
        expect(seeded.value.results[index]).toEqual({
          operationIndex: index,
          outcome: "created",
          resource: expected,
        });
      }
      const before = await snapshot(resources.slice(0, 2), resources.slice(2));
      const allFeed = await request("changes/?after=genesis");
      expect(allFeed.response.status).toBe(200);
      expect(allFeed.value.groups).toHaveLength(1);
      expect(allFeed.value.observedHeadPosition).toBe(position);
      expect(allFeed.value.next).toBeNull();
      expect(allFeed.value.groups[0]).toMatchObject({
        position: "pos-1",
        previousPosition: "pos-0",
        projectionAdvance: false,
        erasures: [],
      });
      expect(allFeed.value.groups[0].changes).toEqual(
        resources.map((resource: unknown, i: number) => ({
          operation: "upsert",
          resourceKind: i < 2 ? "bead" : "link",
          resource,
        })),
      );
      const events = await request("events/");
      expect(events.response.status).toBe(200);
      expect(events.value.source).toBe(`${scope}events/`);
      expect(events.value.events).toEqual(allFeed.value.groups[0].events);
      expect(events.value.events.length).toBeGreaterThan(0);
      expect(allFeed.value.groups[0].eventCount).toBe(events.value.events.length);
      expect(events.value.next).toBeNull();
      const emptyFeed = {
        scope,
        scopeEpoch: epoch,
        authorizationView: view,
        after: before.value.checkpoint,
        observedHeadPosition: position,
        groups: [],
        next: null,
      };
      const initialEmpty = await request(
        `changes/?after=${encodeURIComponent(before.value.checkpoint)}`,
      );
      expect(initialEmpty.value).toEqual(emptyFeed);
      const alias = `${scope}alias/work`;
      const putBody = { alias: "alias/work", target: "beads/a" };
      const putResult = { operationIndex: 0, outcome: "created", alias, target: `${scope}beads/a` };
      const put = await aliasReceipt("put-alias", putBody, "alias-put-key", putResult);
      const equalPut = await aliasReceipt("put-alias", putBody, "alias-put-key", putResult);
      expect(equalPut.response.bodyText).toBe(put.response.bodyText);
      const conflict = await request(
        "operations/put-alias",
        { ...putBody, target: "beads/b" },
        "alias-put-key",
      );
      expect(conflict.response.status).toBe(409);
      expect(conflict.value).toEqual({
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "idempotency-conflict",
        status: 409,
        retry: "never",
      });
      await redirect("a");
      const repointBody = { alias: "alias/work", target: "beads/b" };
      const repointResult = {
        operationIndex: 0,
        outcome: "updated",
        alias,
        target: `${scope}beads/b`,
      };
      const repointed = await aliasReceipt(
        "put-alias",
        repointBody,
        "alias-repoint-key",
        repointResult,
      );
      const equalRepoint = await aliasReceipt(
        "put-alias",
        repointBody,
        "alias-repoint-key",
        repointResult,
      );
      expect(equalRepoint.response.bodyText).toBe(repointed.response.bodyText);
      await redirect("b");
      const oldPut = await request(put.value.id);
      expect(oldPut.response.bodyText).toBe(put.response.bodyText);
      const replayAfterRepoint = await aliasReceipt(
        "put-alias",
        putBody,
        "alias-put-key",
        putResult,
      );
      expect(replayAfterRepoint.response.bodyText).toBe(put.response.bodyText);
      await redirect("b");
      const deletedResult = { operationIndex: 0, outcome: "deleted", alias };
      const deleted = await aliasReceipt(
        "delete-alias",
        { alias: "alias/work" },
        "alias-delete-key",
        deletedResult,
      );
      const equalDelete = await aliasReceipt(
        "delete-alias",
        { alias: "alias/work" },
        "alias-delete-key",
        deletedResult,
      );
      expect(equalDelete.response.bodyText).toBe(deleted.response.bodyText);
      const missing = await request("alias/work");
      expect(missing.response.status).toBe(404);
      expect(missing.value.code).toBe("resource-not-found");
      const after = await snapshot(resources.slice(0, 2), resources.slice(2));
      expect(after.value.checkpoint).toBe(before.value.checkpoint);
      expect((await request(before.value.id)).response.bodyText).toBe(before.response.bodyText);
      const finalFeed = await request("changes/?after=genesis");
      expect(finalFeed.response.bodyText).toBe(allFeed.response.bodyText);
      expect(
        (await request(`changes/?after=${encodeURIComponent(before.value.checkpoint)}`)).value,
      ).toEqual(emptyFeed);
      expect((await request("events/")).response.bodyText).toBe(events.response.bodyText);
      for (const resource of resources) {
        const current = await request(resource.id);
        expect(current.response.status).toBe(200);
        expect(current.value).toEqual(resource);
      }
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(watchdog);
      try {
        await stop();
      } catch (error) {
        failures.push(error);
      }
      try {
        await writeFile(
          output,
          JSON.stringify(
            {
              source,
              entry,
              modules,
              schemaSHA256: sha(schemaBytes),
              fixtureSHA256: sha(fixtureBytes),
              fixtureId: fixture.id,
              binding: firstBinding,
              configuration: {
                ...configuration,
                create: true,
                credentials: [
                  { principal: "writer", credentialRef: "writer", canMutate: true },
                  { principal: "other", credentialRef: "other", canMutate: false },
                ],
              },
              generations,
              wires,
              failures: failures.map((error) => inspect(error, { depth: 10 })),
              untested: [
                "pending/race joins",
                "alias receipt detail expiry",
                "History configuration",
                "complete status matrix",
              ],
              wholeRowsComplete: false,
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
      throw new AggregateError(failures, "alias boundary observation/cleanup failed");
  },
  30000,
);
