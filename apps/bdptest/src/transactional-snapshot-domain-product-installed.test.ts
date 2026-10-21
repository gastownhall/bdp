/** New installed regression: unknown retained Snapshot identities preserve uniform404 with a satisfied known minimum. */
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
const entry = process.env.BDP_SNAPSHOT_DOMAIN_PRODUCT_INSTALLED_ENTRY;
const source = process.env.BDP_SNAPSHOT_DOMAIN_PRODUCT_SOURCE;
const build = process.env.BDP_SNAPSHOT_DOMAIN_PRODUCT_BUILD;
const evidence = process.env.BDP_SNAPSHOT_DOMAIN_PRODUCT_EVIDENCE;
const fixtureBytes = await readFile(
  new URL("../test-support/transactional-snapshot-domain-product-fixture.json", import.meta.url),
);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const scope = "https://reference.invalid/acme/";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);

it.skipIf(!entry)(
  "packed unknown Snapshot and unissued stream identities retain404 under satisfied minima",
  async () => {
    if (!entry || !source || !build || !evidence)
      throw Error("explicit installed/source/build/evidence required");
    const modules = [];
    for (const name of (await readdir(build)).filter((n) => n.endsWith(".js")).sort()) {
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
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-snapshot-domain-installed-")),
      token = randomBytes(32).toString("base64url");
    const configuration = {
      scope,
      directory,
      create: true,
      artifacts: fixture.artifacts,
      credentials: [{ token, principal: "writer", canMutate: true }],
    };
    const controller = new AbortController(),
      watchdog = setTimeout(() => controller.abort(Error("Snapshot identity deadline")), 45000);
    const wires: unknown[] = [],
      failures: unknown[] = [],
      caseResults: unknown[] = [];
    let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined,
      terminal: unknown,
      drained: Promise<void> | undefined,
      binding: unknown;
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
      async function exchange(
        target: string,
        method: HttpMethod = "GET",
        rawBody?: string,
        key?: string,
        minimum?: Record<string, string>,
      ) {
        const url = new URL(target, scope).href;
        if (
          new URL(url).origin !== new URL(scope).origin ||
          !new URL(url).pathname.startsWith("/acme/") ||
          wires.length >= 64
        )
          throw Error("unbound/excess Accept request");
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
        const bytes = rawBody === undefined ? undefined : Buffer.from(rawBody, "utf8");
        const response = await execute({
          method,
          url,
          signal: controller.signal,
          raw: {
            headerLines: [
              { name: "Accept", value: "application/json" },
              ...Object.entries(minimum ?? {}).map(([name, value]) => ({ name, value })),
              ...(bytes === undefined
                ? []
                : [
                    { name: "Content-Type", value: "application/json" },
                    { name: "Idempotency-Key", value: key ?? "missing" },
                  ]),
            ],
            ...(bytes === undefined ? {} : { bodyBytes: bytes }),
          },
        });
        const exact = response.exactRequest;
        wires.push({
          method,
          url,
          key,
          minimum,
          rawBody,
          requestBytesBase64: bytes?.toString("base64"),
          requestSHA256: bytes === undefined ? undefined : sha(bytes),
          exactBody: exact
            ? {
                source: exact.source,
                bodyPresent: exact.bodyPresent,
                bodyOctets: exact.bodyOctets,
                bodyDigest: exact.bodyDigest,
                writeState: exact.writeState,
              }
            : null,
          status: response.status,
          headers: response.headers,
          bodyText: response.bodyText,
          wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
        });
        expect(exact?.writeState).toBe("complete");
        expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
        if (bytes) {
          expect(exact?.bodyOctets).toBe(bytes.length);
          expect(exact?.bodyDigest).toBe(sha(bytes));
        }
        return {
          status: response.status,
          body: response.bodyText === "" ? null : JSON.parse(response.bodyText),
          bodyText: response.bodyText,
          headers: response.headers,
        };
      }
      const created = await exchange("snapshot");
      expect(created.status).toBe(200);
      const saved = created.body;
      expect(saved.scopePosition).toBe("pos-0");
      expect(saved.beads).toEqual({ items: [], next: null });
      expect(saved.links).toEqual({ items: [], next: null });
      const minimum = {
        "bdp-scope-epoch": saved.scopeEpoch,
        "bdp-authorization-view": saved.authorizationView,
        "bdp-minimum-scope-position": "genesis",
      };
      const unknown = new URL(saved.id);
      unknown.searchParams.set("snapshot", "00000000-0000-4000-8000-000000000000");
      const unknownPage = new URL(unknown);
      unknownPage.searchParams.set("stream", "beads");
      unknownPage.searchParams.set("page", "sp_0_" + "A".repeat(43));
      const unissuedPage = new URL(saved.id);
      unissuedPage.searchParams.set("stream", "beads");
      unissuedPage.searchParams.set("page", "sp_0_" + "A".repeat(43));
      const invalid = new URL(saved.id);
      invalid.searchParams.set("snapshot", "not-an-issued-snapshot");
      for (const target of [unknown, unknownPage, unissuedPage, invalid]) {
        for (const method of ["GET", "HEAD"] as const) {
          const before = await exchange(target.href, method);
          const after = await exchange(target.href, method, undefined, undefined, minimum);
          for (const response of [before, after]) {
            expect.soft(response.status).toBe(404);
            expect.soft(response.headers["bdp-scope-epoch"]).toBe(saved.scopeEpoch);
            expect.soft(response.headers["bdp-authorization-view"]).toBe(saved.authorizationView);
            expect.soft(response.headers["bdp-scope-position"]).toBe(saved.scopePosition);
            if (method === "HEAD") expect.soft(response.bodyText).toBe("");
            else
              expect.soft(response.body).toEqual({
                type: "https://github.com/gastownhall/bdp/problems/not-found",
                code: "resource-not-found",
                status: 404,
                retry: "after-state-change",
              });
          }
          caseResults.push({
            target: target.href,
            method,
            baseline: before,
            minimumResponse: after,
          });
        }
      }
      const retained = await exchange(saved.id, "GET", undefined, undefined, minimum);
      expect(retained.status).toBe(200);
      expect(retained.body).toEqual(saved);
      const feed = await exchange("changes/?after=genesis");
      expect(feed.status).toBe(200);
      expect(feed.body.groups).toEqual([]);
      expect(feed.body.next).toBeNull();
      expect(feed.body.observedHeadPosition).toBe(saved.scopePosition);
      for (const module of modules)
        expect(sha(await readFile(path.join(path.dirname(entry), module.name)))).toBe(
          module.sha256,
        );
      expect(
        sha(
          await readFile(
            path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json"),
          ),
        ),
      ).toBe(sha(schemaBytes));
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
      let storeRemoved = false;
      try {
        await rm(directory, { recursive: true, force: true });
        storeRemoved = true;
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
              storeRemoved,
              caseResults,
              wires,
              failures: failures.map((error) => inspect(error, { depth: 8 })),
              wholeProfile: false,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "installed Snapshot identity or cleanup failed");
  },
  45000,
);
