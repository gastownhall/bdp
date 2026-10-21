/** Real default-policy expiry during a bound higher ordinary query minimum wait. */
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
const entry = process.env.BDP_MINIMUM_PRODUCT_ENTRY;
const source = process.env.BDP_MINIMUM_PRODUCT_SOURCE;
const build = process.env.BDP_MINIMUM_PRODUCT_BUILD;
const output = process.env.BDP_MINIMUM_PRODUCT_OUTPUT;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const scope = "https://reference.invalid/acme/";
const contextNames = ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"];
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);

it.skipIf(!entry)(
  "installed higher retained query minima wait until actual original expiry without stale conditional success",
  async () => {
    if (!entry || !source || !build || !output)
      throw Error("explicit installed/source/build/output required");
    const modules = [];
    for (const name of (await readdir(build)).filter((x) => x.endsWith(".js")).sort()) {
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
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-continuation-minimum-"));
    const token = randomBytes(32).toString("base64url");
    const type = `${scope}types/task`,
      schema = `${scope}schemas/properties`,
      linkType = `${scope}types/link`;
    const configuration = {
      scope,
      directory,
      create: true,
      credentials: [{ token, principal: "writer", canMutate: true }],
      artifacts: {
        descriptors: [
          {
            retrievalUri: type,
            utf8: JSON.stringify({
              id: type,
              name: "Task",
              describes: "bead",
              conformsTo: [],
              propertiesSchema: schema,
            }),
          },
          {
            retrievalUri: linkType,
            utf8: JSON.stringify({
              id: linkType,
              name: "Link",
              describes: "link",
              conformsTo: [],
              propertiesSchema: schema,
              source: { conformsTo: [type], external: "none" },
              target: { conformsTo: [type], external: "none" },
            }),
          },
        ],
        schemas: [
          {
            retrievalUri: schema,
            utf8: JSON.stringify({
              $id: schema,
              type: "object",
              properties: { title: { type: "string" } },
              required: ["title"],
              additionalProperties: false,
            }),
          },
        ],
      },
    };
    const controller = new AbortController();
    const watchdog = setTimeout(
      () => controller.abort(Error("cross-surface minimum deadline")),
      45000,
    );
    const wires: unknown[] = [],
      failures: unknown[] = [];
    let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
    let terminal: unknown, drained: Promise<void> | undefined, binding: unknown;
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
      binding = installedTransactionBinding(child.ready, source, {
        bytes: await readFile(
          path.join(root, "packages/conformance/test-support/transactional/fixture-v1.json"),
        ),
      });
      const address = new URL(String(child.ready.listenUrl));
      async function exchange(
        target: string,
        method: HttpMethod = "GET",
        fields: Record<string, string> = {},
        body?: unknown,
      ) {
        expect(wires.length).toBeLessThan(32);
        const url = new URL(target, scope).href;
        expect(new URL(url).origin).toBe(new URL(scope).origin);
        expect(new URL(url).pathname.startsWith("/acme/")).toBe(true);
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
        const started = performance.now();
        const response = await execute({
          method,
          url,
          signal: controller.signal,
          raw: {
            headerLines: [
              ...Object.entries(fields).map(([name, value]) => ({ name, value })),
              ...(body === undefined
                ? []
                : [
                    { name: "Content-Type", value: "application/json" },
                    { name: "Idempotency-Key", value: `continuation-minimum-${wires.length}` },
                  ]),
            ],
            ...(body === undefined ? {} : { bodyBytes: Buffer.from(JSON.stringify(body)) }),
          },
        });
        wires.push({
          method,
          url,
          fields,
          body,
          elapsedMs: performance.now() - started,
          status: response.status,
          headers: response.headers,
          bodyText: response.bodyText,
          wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
        });
        expect(response.exactRequest?.writeState).toBe("complete");
        expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
        return response;
      }
      const seeded = await exchange(
        "operations/batch",
        "POST",
        {},
        {
          operations: [
            ...["a", "b", "c"].map((id) => ({
              operation: "createBead",
              id: `beads/${id}`,
              type,
              properties: { title: id },
            })),
            ...["a", "b", "c"].map((id) => ({
              operation: "createLink",
              id: `links/${id}`,
              type: linkType,
              source: "beads/a",
              target: "beads/b",
              properties: { title: id },
            })),
          ],
        },
      );
      expect(seeded.status).toBe(200);
      expect(seeded.headers["bdp-scope-position"]).toBe("pos-1");
      for (const name of contextNames)
        expect(seeded.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      const originals = JSON.parse(seeded.bodyText).results.map(
        (r: { resource: unknown }) => r.resource,
      );
      const issued = [];
      for (const collection of ["beads", "links"] as const) {
        const first = await exchange(`${collection}/?limit=1`);
        expect(first.status).toBe(200);
        const value = JSON.parse(first.bodyText);
        expect(value.items).toEqual([originals[collection === "beads" ? 0 : 3]]);
        expect(value.next).toBeTypeOf("string");
        expect(new URL(value.next).origin).toBe(new URL(scope).origin);
        issued.push({
          collection,
          next: value.next as string,
          originalB: originals[collection === "beads" ? 1 : 4],
        });
      }
      const updated = await exchange(
        "operations/batch",
        "POST",
        {},
        {
          operations: [
            {
              operation: "updateBead",
              bead: "beads/b",
              propertiesChange: [{ op: "replace", path: "/title", value: "after-bead" }],
            },
            {
              operation: "updateLink",
              link: "links/b",
              propertiesChange: [{ op: "replace", path: "/title", value: "after-link" }],
            },
          ],
        },
      );
      expect(updated.status).toBe(200);
      expect(updated.headers["bdp-scope-position"]).toBe("pos-2");
      const epoch = seeded.headers["bdp-scope-epoch"],
        view = seeded.headers["bdp-authorization-view"];
      if (typeof epoch !== "string" || typeof view !== "string")
        throw Error("actual context required");
      const minimum = {
        "BDP-Scope-Epoch": epoch,
        "BDP-Authorization-View": view,
        "BDP-Minimum-Scope-Position": "pos-1",
      };
      const currentContext = (response: Awaited<ReturnType<typeof exchange>>) =>
        expect(contextNames.map((k) => response.headers[k])).toEqual([
          minimum["BDP-Scope-Epoch"],
          minimum["BDP-Authorization-View"],
          "pos-2",
        ]);
      // The actual installed default is one1s query expiry AND one1s minimum
      // budget. Both start with valid saved1 cursors while livehead is already2.
      // Run concurrently so each is genuinely bound before original expiry.
      const started = performance.now();
      const results = await Promise.all(
        issued.map((row, index) =>
          exchange(row.next, index === 0 ? "GET" : "HEAD", {
            ...minimum,
            "BDP-Minimum-Scope-Position": "pos-2",
            "If-None-Match": "*",
          }),
        ),
      );
      expect(performance.now() - started).toBeGreaterThan(500);
      for (const [index, response] of results.entries()) {
        expect(response.status).toBe(410);
        expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
        expect(response.headers["retry-after"]).toBeUndefined();
        currentContext(response);
        if (index === 0)
          expect(JSON.parse(response.bodyText)).toMatchObject({
            code: "cursor-expired",
            retry: "after-state-change",
          });
        else expect(response.bodyText).toBe("");
      }
      for (const row of issued) {
        const expired = await exchange(row.next);
        expect(expired.status).toBe(410);
        expect(JSON.parse(expired.bodyText).code).toBe("cursor-expired");
        currentContext(expired);
      }
      // Fresh initial reads remain healthy and show actual successor state;
      // refusing an old cursor never reanchors that old query to this new page.
      const fresh = await exchange("beads/?limit=2");
      expect(fresh.status).toBe(200);
      expect(JSON.parse(fresh.bodyText).items[1].properties).toEqual({ title: "after-bead" });
      currentContext(fresh);
      expect(wires).toHaveLength(9);
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
          output,
          JSON.stringify(
            {
              source,
              entry,
              modules,
              schemaSHA256: sha(schemaBytes),
              binding,
              terminal,
              wires,
              failures: failures.map((error) => inspect(error, { depth: 8 })),
              ordinaryInstalledLauncher: true,
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
      throw new AggregateError(failures, "minimum cross-surface observation/cleanup failed");
  },
  60000,
);
