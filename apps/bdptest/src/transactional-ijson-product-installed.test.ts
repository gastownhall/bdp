/** Packed I-JSON receiving with authored UTF-8 bytes. */
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
const entry = process.env.BDP_IJSON_PRODUCT_INSTALLED_ENTRY;
const source = process.env.BDP_IJSON_PRODUCT_SOURCE;
const build = process.env.BDP_IJSON_PRODUCT_BUILD;
const evidence = process.env.BDP_IJSON_PRODUCT_EVIDENCE;
const fixtureBytes = await readFile(
  new URL("../test-support/transactional-ijson-product-fixture.json", import.meta.url),
);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const scope = "https://reference.invalid/acme/",
  beadType = `${scope}types/ijson`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);

type Row = {
  id: string;
  type: string;
  revision: string;
  properties: Record<string, unknown>;
  metadata: Record<string, unknown>;
};
const cases = [
  { name: "duplicate-name", properties: `{"title":"first","title":"second"}` },
  {
    name: "escaped-equivalent-name",
    properties: String.raw`{"title":"first","\u0074itle":"second"}`,
  },
  { name: "surrogate-string", properties: String.raw`{"title":"\uD800"}` },
  { name: "surrogate-member", properties: String.raw`{"title":"first","\uDC00":"second"}` },
  {
    name: "nested-duplicate",
    properties: String.raw`{"title":"first","nested":[{"x":1,"\u0078":2}]}`,
  },
];
const request = (id: string, properties: string) =>
  `{"id":"beads/${id}","type":"${beadType}","properties":${properties}}`;
it("authored bytes preserve escaped-equivalent names and surrogate escapes without stringify", () => {
  expect(cases[0]?.properties).toBe('{"title":"first","title":"second"}');
  for (const [i, token] of [
    [1, String.raw`"\u0074itle"`],
    [2, String.raw`"\uD800"`],
    [3, String.raw`"\uDC00"`],
    [4, String.raw`"\u0078"`],
  ] as const)
    expect(cases[i]?.properties).toContain(token);
  for (const item of cases)
    expect(Buffer.from(item.properties, "utf8").toString("utf8")).toBe(item.properties);
});
it.skipIf(!entry)(
  "packed I-JSON refusals leave no effects or key binding before corrected first execution and replay",
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
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-ijson-installed-")),
      token = randomBytes(32).toString("base64url");
    const configuration = {
      scope,
      directory,
      create: true,
      artifacts: fixture.artifacts,
      credentials: [{ token, principal: "writer", canMutate: true }],
    };
    const controller = new AbortController(),
      watchdog = setTimeout(() => controller.abort(Error("I-JSON receiving deadline")), 45000);
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
      ) {
        const url = new URL(target, scope).href;
        if (
          new URL(url).origin !== new URL(scope).origin ||
          !new URL(url).pathname.startsWith("/acme/") ||
          wires.length >= 64
        )
          throw Error("unbound/excess I-JSON request");
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
            headerLines:
              bytes === undefined
                ? []
                : [
                    { name: "Content-Type", value: "application/json" },
                    { name: "Idempotency-Key", value: key ?? "missing" },
                  ],
            ...(bytes === undefined ? {} : { bodyBytes: bytes }),
          },
        });
        const exact = response.exactRequest;
        wires.push({
          method,
          url,
          key,
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
          body: JSON.parse(response.bodyText),
          headers: response.headers,
        };
      }
      const seeded = await exchange(
        "operations/create-bead",
        "POST",
        request("anchor", '{"title":"anchor"}'),
        "anchor-key",
      );
      expect(seeded.status).toBe(200);
      expect(seeded.body.status).toBe("completed");
      const anchor: Row = seeded.body.results[0].resource;
      expect(anchor).toEqual({
        id: `${scope}beads/anchor`,
        type: beadType,
        revision: anchor.revision,
        properties: { title: "anchor" },
        metadata: {},
      });
      expect(typeof anchor.revision).toBe("string");
      const initial = await exchange("changes/?after=genesis");
      expect(initial.status).toBe(200);
      expect(initial.body.groups).toHaveLength(1);
      expect(initial.body.next).toBeNull();
      let checkpoint = String(initial.body.groups[0].checkpoint),
        headPosition = String(seeded.body.effectPosition);
      const expected: Row[] = [anchor],
        epoch = seeded.headers["bdp-scope-epoch"],
        view = seeded.headers["bdp-authorization-view"];
      for (const [index, item] of cases.entries()) {
        const id = `case-${index}`,
          key = `syntax-${index}`,
          beforePosition = headPosition,
          beforeCheckpoint = checkpoint,
          startWire = wires.length;
        const refused = await exchange(
          "operations/create-bead",
          "POST",
          request(id, item.properties),
          key,
        );
        expect(refused.status).toBe(400);
        expect(refused.body).toMatchObject({
          type: "https://github.com/gastownhall/bdp/problems/request",
          code: "malformed-request",
          status: 400,
          retry: "never",
        });
        expect(refused.body).not.toHaveProperty("id");
        expect(refused.body).not.toHaveProperty("results");
        expect(refused.headers.location).toBeUndefined();
        const collection = await exchange("beads/?limit=32");
        expect(collection.status).toBe(200);
        expect(collection.body).toEqual({
          items: [...expected].sort((a, b) => (a.id < b.id ? -1 : 1)),
          next: null,
        });
        expect(collection.headers["bdp-scope-position"]).toBe(beforePosition);
        expect(collection.headers["bdp-scope-epoch"]).toBe(epoch);
        expect(collection.headers["bdp-authorization-view"]).toBe(view);
        const absent = await exchange(`beads/${id}`);
        expect(absent.status).toBe(404);
        expect(absent.body.code).toBe("resource-not-found");
        expect(absent.headers["bdp-scope-position"]).toBe(beforePosition);
        const suffix = new URL("changes/", scope);
        suffix.searchParams.set("after", beforeCheckpoint);
        const empty = await exchange(suffix.href);
        expect(empty.status).toBe(200);
        expect(empty.body).toMatchObject({
          scope,
          scopeEpoch: epoch,
          authorizationView: view,
          after: beforeCheckpoint,
          observedHeadPosition: beforePosition,
          groups: [],
          next: null,
        });
        const valid = String.raw`{"title":"valid-😀-${index}","\uD83D\uDE00":"scalar-member"}`;
        const corrected = await exchange("operations/create-bead", "POST", request(id, valid), key);
        expect(corrected.status).toBe(200);
        expect(corrected.body.status).toBe("completed");
        expect(corrected.body.results).toHaveLength(1);
        expect(corrected.body.results[0].outcome).toBe("created");
        const row = corrected.body.results[0].resource as Row;
        const wanted = {
          id: `${scope}beads/${id}`,
          type: beadType,
          revision: row.revision,
          properties: { title: `valid-😀-${index}`, "😀": "scalar-member" },
          metadata: {},
        };
        expect(typeof row.revision).toBe("string");
        expect(row.revision.length).toBeGreaterThan(0);
        expect(row).toEqual(wanted);
        headPosition = String(corrected.body.effectPosition);
        expect(headPosition).not.toBe(beforePosition);
        const current = await exchange(`beads/${id}`);
        expect(current.status).toBe(200);
        expect(current.body).toEqual(wanted);
        const replay = await exchange("operations/create-bead", "POST", request(id, valid), key);
        expect(replay.status).toBe(200);
        expect(replay.body).toEqual(corrected.body);
        const committed = await exchange(suffix.href);
        expect(committed.status).toBe(200);
        expect(committed.body.after).toBe(beforeCheckpoint);
        expect(committed.body.observedHeadPosition).toBe(headPosition);
        expect(committed.body.groups).toHaveLength(1);
        expect(committed.body.next).toBeNull();
        const group = committed.body.groups[0];
        expect(group).toMatchObject({
          scopeEpoch: epoch,
          authorizationView: view,
          position: headPosition,
          previousPosition: beforePosition,
          transaction: corrected.body.transaction,
          projectionAdvance: false,
          eventCount: 1,
          erasures: [],
          changes: [{ operation: "upsert", resourceKind: "bead", resource: wanted }],
        });
        expect(group.events).toHaveLength(1);
        expect(group.events[0]).toMatchObject({
          ordinal: 0,
          type: "created",
          subject: wanted.id,
          transaction: corrected.body.transaction,
          data: { revision: wanted.revision, properties: wanted.properties, metadata: {} },
        });
        checkpoint = String(group.checkpoint);
        expected.push(wanted);
        caseResults.push({
          name: item.name,
          startWireIndex: startWire,
          requestSHA256: sha(Buffer.from(request(id, item.properties), "utf8")),
          refusal: refused.body,
          correctedReceipt: corrected.body,
          replayReceipt: replay.body,
          previousPosition: beforePosition,
          position: headPosition,
          previousCheckpoint: beforeCheckpoint,
          checkpoint,
        });
      }
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
      } finally {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "installed I-JSON receiving or cleanup failed");
  },
  45000,
);
