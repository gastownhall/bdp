/** Fresh packaged HTTP numeric evidence. Raw decimal inputs never pass through Number. */
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
const entry = process.env.BDP_NUMERIC_PRODUCT_ENTRY;
const source = process.env.BDP_NUMERIC_PRODUCT_SOURCE;
const build = process.env.BDP_NUMERIC_PRODUCT_BUILD;
const output = process.env.BDP_NUMERIC_PRODUCT_OUTPUT;
const scope = "https://reference.invalid/acme/";
const type = `${scope}types/numeric`;
const schema = `${scope}schemas/numeric`;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);

it.skipIf(!entry)(
  "packaged numeric decimals retain revisions and reject unrepresentable nested values without effects",
  async () => {
    if (!entry || !source || !build || !output)
      throw Error("explicit installed/source/build/output required");
    const modules = [];
    for (const name of (await readdir(build)).filter((name) => name.endsWith(".js")).sort()) {
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
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-numeric-product-"));
    const token = randomBytes(32).toString("base64url");
    const configuration = {
      scope,
      directory,
      create: true,
      credentials: [{ token, principal: "numeric-writer", canMutate: true }],
      artifacts: {
        descriptors: [
          {
            retrievalUri: type,
            utf8: JSON.stringify({
              id: type,
              name: "Numeric",
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
              properties: {
                n: { type: "number" },
                z: { type: "number" },
                nested: {
                  type: "object",
                  properties: { values: { type: "array", items: { type: "number" } } },
                  required: ["values"],
                  additionalProperties: false,
                },
              },
              required: ["n", "z", "nested"],
              additionalProperties: false,
            }),
          },
        ],
      },
    };
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(Error("numeric product deadline")), 20000);
    const wires: unknown[] = [];
    const failures: unknown[] = [];
    let child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined;
    let terminal: unknown;
    let drained: Promise<void> | undefined;
    let binding: unknown;
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
      let epoch: string | undefined;
      let view: string | undefined;
      async function exchange(target: string, rawBody?: string) {
        expect(wires.length).toBeLessThan(28);
        const method: HttpMethod = rawBody === undefined ? "GET" : "POST";
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
        const result = await execute({
          method,
          url,
          signal: controller.signal,
          raw: {
            headerLines:
              rawBody === undefined
                ? []
                : [
                    { name: "Content-Type", value: "application/json" },
                    { name: "Idempotency-Key", value: `numeric-${wires.length}` },
                  ],
            ...(rawBody === undefined ? {} : { bodyBytes: Buffer.from(rawBody, "utf8") }),
          },
        });
        wires.push({
          method,
          url,
          rawBody,
          exactRequest: result.exactRequest,
          status: result.status,
          headers: result.headers,
          bodyText: result.bodyText,
          wireBase64: Buffer.from(result.wireResponseBytes ?? []).toString("base64"),
        });
        expect(result.exactRequest?.writeState).toBe("complete");
        if (rawBody !== undefined)
          expect(result.exactRequest?.bodyDigest).toBe(sha(Buffer.from(rawBody)));
        expect(result.wireResponseBytes?.length).toBeGreaterThan(0);
        for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(result.headers[name], name).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
        epoch ??= result.headers["bdp-scope-epoch"];
        view ??= result.headers["bdp-authorization-view"];
        expect(result.headers["bdp-scope-epoch"]).toBe(epoch);
        expect(result.headers["bdp-authorization-view"]).toBe(view);
        return { wire: result, value: JSON.parse(result.bodyText) };
      }
      const properties = (n: number) => ({ n, z: 0, nested: { values: [0.1, 1e300] } });
      const metadata = { nested: { zero: 0, label: "retained" } };
      const initial = await exchange(
        "operations/create-bead",
        `{"id":"beads/a","type":"${type}","properties":{"n":1.0,"z":-0.0,"nested":{"values":[0.1,1e300]}},"metadata":{"nested":{"zero":-0,"label":"retained"}}}`,
      );
      expect(initial.wire.status).toBe(200);
      expect(initial.value.status).toBe("completed");
      const original = initial.value.results[0].resource;
      expect(original).toEqual({
        id: `${scope}beads/a`,
        type,
        revision: expect.any(String),
        properties: properties(1),
        metadata,
      });
      const assertReceipt = (
        response: Awaited<ReturnType<typeof exchange>>,
        resource: unknown,
        position: string,
      ) => {
        expect(response.wire.status).toBe(200);
        expect(response.value.status).toBe("completed");
        expect(response.value.results).toEqual([
          { operationIndex: 0, outcome: "updated", resource },
        ]);
        expect(response.value.requiredPosition).toBe(position);
        expect(response.wire.headers["bdp-scope-position"]).toBe(position);
      };
      for (const literal of ["1", "1.0", "1e0"]) {
        const noop = await exchange(
          "operations/update-bead",
          `{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/n","value":${literal}}]}`,
        );
        assertReceipt(noop, original, "pos-1");
        expect(noop.value).not.toHaveProperty("effectPosition");
      }
      for (const literal of ["-0", "0"]) {
        const noop = await exchange(
          "operations/update-bead",
          `{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/z","value":${literal}}]}`,
        );
        assertReceipt(noop, original, "pos-1");
        expect(noop.value).not.toHaveProperty("effectPosition");
      }
      const changed = await exchange(
        "operations/update-bead",
        '{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/n","value":2}]}',
      );
      const current = changed.value.results[0].resource;
      expect(current.revision).not.toBe(original.revision);
      expect(current).toEqual({
        ...original,
        revision: current.revision,
        properties: properties(2),
      });
      assertReceipt(changed, current, "pos-2");
      expect(changed.value.effectPosition).toBe("pos-2");
      // The forbidden token remains text throughout request construction. JSON.parse is only
      // used for response oracles after the server has made its admission decision.
      const rejected = [
        {
          target: "operations/create-bead",
          body: `{"id":"beads/bad","type":"${type}","properties":{"n":9007199254740993,"z":0,"nested":{"values":[1]}}}`,
          pointer: "/properties/n",
          document: "properties",
        },
        {
          target: "operations/create-bead",
          body: `{"id":"beads/bad-nested","type":"${type}","properties":{"n":1,"z":0,"nested":{"values":[9007199254740993]}}}`,
          pointer: "/properties/nested/values/0",
          document: "properties",
        },
        {
          target: "operations/create-bead",
          body: `{"id":"beads/bad-meta","type":"${type}","properties":{"n":1,"z":0,"nested":{"values":[1]}},"metadata":{"nested":{"bad":9007199254740993}}}`,
          pointer: "/metadata/nested/bad",
          document: "metadata",
        },
        {
          target: "operations/update-bead",
          body: '{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/nested","value":{"values":[9007199254740993]}}]}',
          pointer: "/propertiesChange/0/value/values/0",
          document: "properties",
        },
      ];
      for (const refusal of rejected) {
        const response = await exchange(refusal.target, refusal.body);
        expect(response.wire.status).toBe(200);
        expect(response.value.status).toBe("failed");
        expect(response.value.problem).toMatchObject({ code: "validation-failed", status: 422 });
        expect(response.value).not.toHaveProperty("results");
        expect(response.value).not.toHaveProperty("effectPosition");
        expect(response.value.requiredPosition).toBe("pos-2");
        expect(response.wire.headers["bdp-scope-position"]).toBe("pos-2");
        const diagnostics = response.value.problem.diagnostics;
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toContain("unsupported number");
        if (refusal.target === "operations/create-bead")
          expect(diagnostics[0].instanceLocation).toBe(
            refusal.pointer.slice(`/${refusal.document}`.length),
          );
        else {
          expect(diagnostics[0].message).toContain(refusal.pointer);
          expect(diagnostics[0]).not.toHaveProperty("instanceLocation");
        }
        if (refusal.document === "metadata") expect(diagnostics[0].message).toContain("metadata");
        expect(diagnostics[0]).not.toHaveProperty("type");
        expect(diagnostics[0]).not.toHaveProperty("schemaLocation");
        expect(diagnostics[0].document ?? "properties").toBe(refusal.document);
        if (diagnostics[0].instanceLocation !== undefined)
          expect(diagnostics[0].instanceLocation).not.toMatch(
            /^\/(properties|metadata|propertiesChange)\//,
          );
      }
      for (const id of ["bad", "bad-nested", "bad-meta"]) {
        const missing = await exchange(`beads/${id}`);
        expect(missing.wire.status).toBe(404);
        expect(missing.value.code).toBe("resource-not-found");
      }
      const stored = await exchange("beads/a");
      expect(stored.value).toEqual(current);
      expect(stored.wire.bodyText).not.toContain("9007199254740992");
      async function changes() {
        const groups: { position: string; events: { type: string }[] }[] = [];
        let target: string | null = "changes/?after=genesis";
        for (let page = 0; target !== null; page++) {
          expect(page).toBeLessThan(5);
          const response = await exchange(target);
          expect(response.wire.status).toBe(200);
          expect(Array.isArray(response.value.groups)).toBe(true);
          groups.push(...response.value.groups);
          expect(response.value.next === null || typeof response.value.next === "string").toBe(
            true,
          );
          target = response.value.next;
        }
        return groups;
      }
      const priorGroups = await changes();
      expect(priorGroups.map((group) => group.position)).toEqual(["pos-1", "pos-2"]);
      expect(priorGroups.flatMap((group) => group.events.map((event) => event.type))).toEqual([
        "created",
        "updated",
      ]);
      const nearby = await exchange(
        "operations/update-bead",
        '{"bead":"beads/a","propertiesChange":[{"op":"replace","path":"/n","value":9007199254740992}]}',
      );
      const final = nearby.value.results[0].resource;
      expect(final.revision).not.toBe(current.revision);
      expect(final).toEqual({
        ...current,
        revision: final.revision,
        properties: properties(9007199254740992),
      });
      assertReceipt(nearby, final, "pos-3");
      const finalStored = await exchange("beads/a");
      expect(finalStored.value).toEqual(final);
      expect(finalStored.wire.bodyText).toContain('"n":9007199254740992');
      const finalGroups = await changes();
      expect(finalGroups.map((group) => group.position)).toEqual(["pos-1", "pos-2", "pos-3"]);
      expect(finalGroups.flatMap((group) => group.events.map((event) => event.type))).toEqual([
        "created",
        "updated",
        "updated",
      ]);
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
              failures: failures.map((error) => inspect(error, { depth: 10 })),
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
      throw new AggregateError(failures, "numeric product observation/cleanup failed");
  },
  30000,
);
