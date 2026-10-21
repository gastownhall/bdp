/** One actual packed receipt boundary/reopen cohort, without clocks or altered limits. */
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
const entry = process.env.BDP_RECEIPT_PAGES_PRODUCT_ENTRY;
const source = process.env.BDP_RECEIPT_PAGES_PRODUCT_SOURCE;
const build = process.env.BDP_RECEIPT_PAGES_PRODUCT_BUILD;
const output = process.env.BDP_RECEIPT_PAGES_PRODUCT_OUTPUT;
const scope = "https://reference.invalid/acme/";
const type = `${scope}types/receipt-page`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);

it.skipIf(!entry)(
  "packaged receipt retains its 32+1 ordered boundaries across HEAD foreign access and create:false reopen",
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
      new URL("../test-support/transactional-receipt-pages-fixture.json", import.meta.url),
    );
    const fixture = JSON.parse(fixtureBytes.toString("utf8"));
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-receipt-pages-product-"));
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
      () => controller.abort(Error("receipt page product deadline")),
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
    ) {
      expect(wires.length).toBeLessThan(24);
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
      for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(response.headers[name], name).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      epoch ??= response.headers["bdp-scope-epoch"];
      view ??= response.headers["bdp-authorization-view"];
      expect(response.headers["bdp-scope-epoch"]).toBe(epoch);
      expect(response.headers["bdp-authorization-view"]).toBe(view);
      expect(response.headers["bdp-scope-position"]).toBe(position);
      return response;
    }
    async function pair(url: string, expectedBody: string) {
      const get = await send(url);
      expect(get.status).toBe(200);
      expect(get.bodyText).toBe(expectedBody);
      const head = await send(url, "writer", "HEAD");
      expect(head.status).toBe(200);
      expect(head.bodyText).toBe("");
      for (const response of [get, head]) {
        expect(response.headers["cache-control"]).toBe("private, no-store");
        expect(response.headers.etag).toBeUndefined();
        expect(response.headers["last-modified"]).toBeUndefined();
        expect(response.headers["content-type"]).toBe("application/json");
      }
      expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(get.bodyText)));
    }
    async function foreign(url: string) {
      const get = await send(url, "other");
      expect(get.status).toBe(404);
      expect(JSON.parse(get.bodyText).code).toBe("resource-not-found");
      const head = await send(url, "other", "HEAD");
      expect(head.status).toBe(404);
      expect(head.bodyText).toBe("");
    }
    try {
      await start(true);
      const ids = Array.from({ length: 32 }, (_, i) => `r${String(i).padStart(2, "0")}`);
      position = "pos-1";
      const seed = await send(
        "operations/batch",
        "writer",
        "POST",
        {
          operations: ids.map((id) => ({
            operation: "createBead",
            id: `beads/${id}`,
            type,
            properties: { label: id, n: 0 },
            metadata: { stage: "seed" },
          })),
        },
        "receipt-pages-seed",
      );
      expect(seed.status).toBe(200);
      const seeded = JSON.parse(seed.bodyText);
      expect(seeded.status).toBe("completed");
      expect(seeded.results).toHaveLength(32);
      expect(seeded.next).toBeNull();
      position = "pos-2";
      const updated = await send(
        "operations/update-where",
        "writer",
        "POST",
        {
          collection: "beads",
          selector: "$[?@.properties.n == 0]",
          change: [{ op: "replace", path: "/n", value: 1 }],
          cardinality: { min: 32, max: 32 },
        },
        "receipt-pages-update",
      );
      expect(updated.status).toBe(200);
      const receipt = JSON.parse(updated.bodyText);
      expect(receipt.status).toBe("completed");
      expect(receipt.requiredPosition).toBe("pos-2");
      expect(receipt.effectPosition).toBe("pos-2");
      expect(receipt.results).toHaveLength(32);
      expect(receipt.results[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 32 });
      expect(typeof receipt.next).toBe("string");
      const pageUrl = receipt.next as string;
      expect(pageUrl.startsWith(`${receipt.id}/pages/`)).toBe(true);
      const pageResponse = await send(pageUrl);
      expect(pageResponse.status).toBe(200);
      const page = JSON.parse(pageResponse.bodyText);
      expect(Object.keys(page).sort()).toEqual(["next", "receipt", "results"]);
      expect(page.receipt).toBe(receipt.id);
      expect(page.next).toBeNull();
      expect(page.results).toHaveLength(1);
      const entries = [...receipt.results, ...page.results];
      expect(entries).toHaveLength(33);
      expect(entries.slice(1).map((result) => result.resource.id)).toEqual(
        ids.map((id) => `${scope}beads/${id}`),
      );
      for (const [index, result] of entries.slice(1).entries()) {
        const before = seeded.results[index].resource;
        expect(result).toEqual({
          operationIndex: 0,
          outcome: "updated",
          resource: {
            id: `${scope}beads/${ids[index]}`,
            type,
            revision: expect.any(String),
            properties: { label: ids[index], n: 1 },
            metadata: { stage: "seed" },
          },
        });
        expect(result.resource.revision).not.toBe(before.revision);
      }
      expect(receipt.results.at(-1).resource.id).toBe(`${scope}beads/r30`);
      expect(page.results[0].resource.id).toBe(`${scope}beads/r31`);
      await pair(receipt.id, updated.bodyText);
      await pair(pageUrl, pageResponse.bodyText);
      await foreign(receipt.id);
      await foreign(pageUrl);
      await stop();
      await start(false);
      await pair(receipt.id, updated.bodyText);
      await pair(pageUrl, pageResponse.bodyText);
      await foreign(receipt.id);
      await foreign(pageUrl);
      // A normal later commit changes serving context, never these retained boundaries/postimages.
      position = "pos-3";
      const later = await send(
        "operations/update-bead",
        "writer",
        "POST",
        { bead: "beads/r00", propertiesChange: [{ op: "replace", path: "/n", value: 2 }] },
        "receipt-pages-later",
      );
      expect(later.status).toBe(200);
      expect(JSON.parse(later.bodyText).status).toBe("completed");
      await pair(receipt.id, updated.bodyText);
      await pair(pageUrl, pageResponse.bodyText);
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
              generations,
              wires,
              failures: failures.map((error) => inspect(error, { depth: 10 })),
              untested: ["24h detail expiry", "rotated policy", "History configuration"],
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
      throw new AggregateError(failures, "receipt page observation/cleanup failed");
  },
  30000,
);
