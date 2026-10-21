/** One current minimum across installed read surfaces; no retained-context ruling. */
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
  "one installed current minimum binds active read surfaces and blocks premature streams",
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
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-minimum-cross-surface-"));
    const token = randomBytes(32).toString("base64url");
    const type = `${scope}types/task`,
      schema = `${scope}schemas/properties`;
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
                    { name: "Idempotency-Key", value: `minimum-cross-${wires.length}` },
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
            { operation: "createBead", id: "beads/a", type, properties: { title: "before" } },
          ],
        },
      );
      expect(seeded.status).toBe(200);
      const first = JSON.parse(seeded.bodyText);
      for (const name of contextNames)
        expect(seeded.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      expect(seeded.headers["bdp-scope-position"]).toBe("pos-1");
      const updated = await exchange(
        "operations/update-bead",
        "POST",
        {},
        { bead: "beads/a", propertiesChange: [{ op: "replace", path: "/title", value: "after" }] },
      );
      expect(updated.status).toBe(200);
      expect(updated.headers["bdp-scope-position"]).toBe("pos-2");
      const minimum = {
        "BDP-Scope-Epoch": seeded.headers["bdp-scope-epoch"]!,
        "BDP-Authorization-View": seeded.headers["bdp-authorization-view"]!,
        "BDP-Minimum-Scope-Position": "pos-2",
      };
      for (const target of [
        "",
        "bdp.json",
        "operations/",
        "types/task",
        "schemas/properties",
        "beads/a",
        "beads/a?view=properties",
        "beads/?limit=10",
        first.id,
        "snapshot",
        "changes/?after=genesis",
        "events/",
        "beads/a?view=events",
      ]) {
        const response = await exchange(target, "GET", minimum);
        expect(response.status, target).toBe(target === "" ? 204 : 200);
        expect(
          contextNames.map((k) => response.headers[k]),
          target,
        ).toEqual([minimum["BDP-Scope-Epoch"], minimum["BDP-Authorization-View"], "pos-2"]);
        expect(response.headers["x-bdp-development-limit"], target).toBeUndefined();
        if (target === "beads/a")
          expect(JSON.parse(response.bodyText).properties).toEqual({ title: "after" });
        if (target === "beads/a?view=properties")
          expect(JSON.parse(response.bodyText)).toEqual({ title: "after" });
        if (target === first.id) expect(JSON.parse(response.bodyText).id).toBe(first.id);
        if (target === "snapshot")
          expect(JSON.parse(response.bodyText).scopePosition).toBe("pos-2");
      }
      // These current, known-position paths have no retained-handle collision.
      // The same impossible-ahead tuple must fail before condition/media/SSE admission.
      let timeoutBody = "";
      for (const target of ["changes/?after=genesis", "events/", "beads/a?view=events"]) {
        for (const method of ["GET", "HEAD"] as const) {
          const response = await exchange(target, method, {
            ...minimum,
            "BDP-Minimum-Scope-Position": "pos-3",
            Accept: "text/event-stream",
            ...(method === "GET" ? { "If-None-Match": "*" } : { "If-Match": '"mismatch"' }),
          });
          expect(response.status, target).toBe(503);
          expect(response.headers["content-type"]).toBe("application/problem+json");
          expect(response.headers["retry-after"]).toBe("1");
          expect(contextNames.map((k) => response.headers[k])).toEqual([
            minimum["BDP-Scope-Epoch"],
            minimum["BDP-Authorization-View"],
            "pos-2",
          ]);
          expect(response.headers["x-bdp-development-limit"]).toBeUndefined();
          if (method === "GET") {
            timeoutBody = response.bodyText;
            expect(JSON.parse(timeoutBody)).toEqual({
              type: "https://github.com/gastownhall/bdp/problems/unavailable",
              status: 503,
              code: "catch-up-timeout",
              retry: "after-delay",
            });
          } else {
            expect(response.bodyText).toBe("");
            expect(response.headers["content-length"]).toBe(String(Buffer.byteLength(timeoutBody)));
          }
        }
      }
      expect(wires).toHaveLength(21);
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
