/** Packed Accept refusal before new mutation admission. */
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
const entry = process.env.BDP_ACCEPT_PRODUCT_INSTALLED_ENTRY;
const source = process.env.BDP_ACCEPT_PRODUCT_SOURCE;
const build = process.env.BDP_ACCEPT_PRODUCT_BUILD;
const evidence = process.env.BDP_ACCEPT_PRODUCT_EVIDENCE;
const fixtureBytes = await readFile(
  new URL("../test-support/transactional-accept-product-fixture.json", import.meta.url),
);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const scope = "https://reference.invalid/acme/",
  beadType = `${scope}types/accept`;
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
function assertBodyless406(response: { status: number; bodyText: string; body: unknown }) {
  expect(response.status).toBe(406);
  expect(response.bodyText).toBe("");
  expect(response.body).toBeNull();
}
it("bodyless oracle refuses a problem, an accidental receipt and a wrong status", () => {
  for (const value of [
    { status: 406, bodyText: '{"code":"bad"}', body: { code: "bad" } },
    { status: 406, bodyText: '{"status":"completed"}', body: { status: "completed" } },
    { status: 200, bodyText: "", body: null },
  ])
    expect(() => assertBodyless406(value)).toThrow();
});
it.skipIf(!entry)(
  "packed bodyless Accept refusal precedes new admission and preserves retained replies",
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
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-accept-installed-")),
      token = randomBytes(32).toString("base64url");
    const configuration = {
      scope,
      directory,
      create: true,
      artifacts: fixture.artifacts,
      credentials: [{ token, principal: "writer", canMutate: true }],
    };
    const controller = new AbortController(),
      watchdog = setTimeout(() => controller.abort(Error("Accept receiving deadline")), 45000);
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
        accept = "application/json",
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
              { name: "Accept", value: accept },
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
          accept,
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
      const request = JSON.stringify({
        id: "beads/candidate",
        type: beadType,
        properties: { title: "candidate" },
      });
      const seeded = await exchange(
        "operations/create-bead",
        "POST",
        JSON.stringify({ id: "beads/anchor", type: beadType, properties: { title: "anchor" } }),
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
      const initial = await exchange("changes/?after=genesis");
      expect(initial.status).toBe(200);
      expect(initial.body.groups).toHaveLength(1);
      expect(initial.body.next).toBeNull();
      const checkpoint = String(initial.body.groups[0].checkpoint),
        position = String(seeded.body.effectPosition),
        epoch = seeded.headers["bdp-scope-epoch"],
        view = seeded.headers["bdp-authorization-view"];
      const suffix = new URL("changes/", scope);
      suffix.searchParams.set("after", checkpoint);
      const refused = await exchange(
        "operations/create-bead",
        "POST",
        request,
        "accept-candidate",
        "text/plain",
      );
      assertBodyless406(refused);
      const unchanged = await exchange("beads/?limit=32");
      expect(unchanged.status).toBe(200);
      expect(unchanged.body).toEqual({ items: [anchor], next: null });
      expect(unchanged.headers["bdp-scope-position"]).toBe(position);
      expect(unchanged.headers["bdp-scope-epoch"]).toBe(epoch);
      expect(unchanged.headers["bdp-authorization-view"]).toBe(view);
      const absent = await exchange("beads/candidate");
      expect(absent.status).toBe(404);
      expect(absent.body.code).toBe("resource-not-found");
      expect(absent.headers["bdp-scope-position"]).toBe(position);
      const empty = await exchange(suffix.href);
      expect(empty.status).toBe(200);
      expect(empty.body).toMatchObject({
        scope,
        scopeEpoch: epoch,
        authorizationView: view,
        after: checkpoint,
        observedHeadPosition: position,
        groups: [],
        next: null,
      });
      const created = await exchange("operations/create-bead", "POST", request, "accept-candidate");
      expect(created.status).toBe(200);
      expect(created.body.status).toBe("completed");
      expect(created.body.results).toHaveLength(1);
      expect(created.body.results[0].outcome).toBe("created");
      const row: Row = created.body.results[0].resource;
      const wanted = {
        id: `${scope}beads/candidate`,
        type: beadType,
        revision: row.revision,
        properties: { title: "candidate" },
        metadata: {},
      };
      expect(typeof row.revision).toBe("string");
      expect(row.revision.length).toBeGreaterThan(0);
      expect(row).toEqual(wanted);
      expect(String(created.body.effectPosition)).not.toBe(position);
      const current = await exchange("beads/candidate");
      expect(current.status).toBe(200);
      expect(current.body).toEqual(wanted);
      // Explicit retained matching-request branch: negotiation changes no receipt.
      const retainedRefusal = await exchange(
        "operations/create-bead",
        "POST",
        request,
        "accept-candidate",
        "text/plain",
      );
      assertBodyless406(retainedRefusal);
      const replay = await exchange("operations/create-bead", "POST", request, "accept-candidate");
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(created.body);
      const committed = await exchange(suffix.href);
      expect(committed.status).toBe(200);
      expect(committed.body.after).toBe(checkpoint);
      expect(committed.body.observedHeadPosition).toBe(String(created.body.effectPosition));
      expect(committed.body.groups).toHaveLength(1);
      expect(committed.body.next).toBeNull();
      const group = committed.body.groups[0];
      expect(group).toMatchObject({
        scopeEpoch: epoch,
        authorizationView: view,
        position: String(created.body.effectPosition),
        previousPosition: position,
        transaction: created.body.transaction,
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
        transaction: created.body.transaction,
        data: { revision: wanted.revision, properties: wanted.properties, metadata: {} },
      });
      caseResults.push({
        initialPosition: position,
        checkpoint,
        refused,
        unchanged: unchanged.body,
        empty: empty.body,
        created: created.body,
        retainedRefusal,
        replay: replay.body,
        group,
      });
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
      throw new AggregateError(failures, "installed Accept receiving or cleanup failed");
  },
  45000,
);
