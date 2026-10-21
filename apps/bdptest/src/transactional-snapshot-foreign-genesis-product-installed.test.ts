/** New nonordinary installed regression: unexpired foreign-view Snapshot/page retains409 with actual current tuple+genesis. */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { expect, it } from "vitest";
import { launchSnapshotForeignGenesis } from "../test-support/transactional-snapshot-foreign-genesis-product-launch.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_SNAPSHOT_FOREIGN_PRODUCT_INSTALLED_ENTRY;
const source = process.env.BDP_SNAPSHOT_FOREIGN_PRODUCT_SOURCE;
const build = process.env.BDP_SNAPSHOT_FOREIGN_PRODUCT_BUILD;
const evidence = process.env.BDP_SNAPSHOT_FOREIGN_PRODUCT_EVIDENCE;
const fixtureBytes = await readFile(
  new URL(
    "../test-support/transactional-snapshot-foreign-genesis-product-fixture.json",
    import.meta.url,
  ),
);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const scope = "https://reference.invalid/acme/";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

it.skipIf(!entry)(
  "packed unexpired foreign-view Snapshot and issued page retain409 with current tuple genesis",
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
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-snapshot-foreign-installed-")),
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
    let child: ReturnType<typeof launchSnapshotForeignGenesis> | undefined,
      terminal: unknown,
      binding: unknown,
      ready: Record<string, unknown> | undefined;
    const controls: unknown[] = [];
    try {
      child = launchSnapshotForeignGenesis(entry, configuration);
      ready = await child.ready;
      expect(ready.event).toBe("snapshot-foreign.ready");
      expect(ready.ordinaryDeployment).toBe(false);
      expect(ready.ordinaryConfigurationMetadataAvailable).toBe(false);
      expect(ready.payloadIdentity).toMatch(/^[0-9a-f]{64}$/);
      expect(ready.selectedSeams).toEqual([
        "fixed-trusted-clock",
        "existing-authorization-policy-replacement",
      ]);
      binding = {
        source,
        payloadIdentity: ready.payloadIdentity,
        fixture: { id: fixture.id, bytes: fixtureBytes.length, sha256: sha(fixtureBytes) },
        ordinaryDeployment: false,
        ordinaryConfigurationMetadataAvailable: false,
        selectedSeams: ready.selectedSeams,
      };
      const address = new URL(String(ready.listenUrl));
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
          throw Error("unbound/excess Snapshot request");
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
      const ids = Array.from({ length: 33 }, (_, i) => `r${String(i).padStart(2, "0")}`);
      const requests = ids.map((id) => ({
        operation: "createBead",
        id: `beads/${id}`,
        type: `${scope}types/accept`,
        properties: { title: id },
      }));
      expect(
        (
          await exchange(
            "operations/batch",
            "POST",
            JSON.stringify({ operations: requests.slice(0, 32) }),
            "snapshot-foreign-seed32",
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await exchange(
            "operations/create-bead",
            "POST",
            JSON.stringify({
              id: "beads/r32",
              type: `${scope}types/accept`,
              properties: { title: "r32" },
            }),
            "snapshot-foreign-seed33",
          )
        ).status,
      ).toBe(200);
      const created = await exchange("snapshot");
      expect(created.status).toBe(200);
      const saved = created.body;
      expect(saved.scopePosition).toBe("pos-2");
      expect(saved.beads.items.map((v: { id: string }) => v.id)).toEqual(
        ids.slice(0, 32).map((id) => scope + "beads/" + id),
      );
      expect(saved.links).toEqual({ items: [], next: null });
      expect(saved.beads.next).toEqual(expect.any(String));
      const issued = await exchange(saved.beads.next);
      expect(issued.status).toBe(200);
      expect(issued.body.items.map((v: { id: string }) => v.id)).toEqual([scope + "beads/r32"]);
      expect(issued.body.next).toBeNull();
      expect((await exchange(saved.id)).body).toEqual(saved);
      controls.push(await child.control({ command: "rotate" }));
      const current = await exchange("snapshot");
      expect(current.status).toBe(200);
      const actual = current.body;
      expect(actual.scopeEpoch).toBe(saved.scopeEpoch);
      expect(actual.authorizationView).not.toBe(saved.authorizationView);
      expect(actual.scopePosition).toBe("pos-2");
      expect(actual.beads).toEqual({ items: [], next: null });
      expect(actual.links).toEqual({ items: [], next: null });
      const minimum = {
        "bdp-scope-epoch": actual.scopeEpoch,
        "bdp-authorization-view": actual.authorizationView,
        "bdp-minimum-scope-position": "genesis",
      };
      const foreignProblem = {
        type: "https://github.com/gastownhall/bdp/problems/conflict",
        code: "foreign-view",
        status: 409,
        retry: "after-state-change",
      };
      for (const target of [saved.id, saved.beads.next])
        for (const method of ["GET", "HEAD"] as const) {
          const baseline = await exchange(target, method);
          const response = await exchange(target, method, undefined, undefined, minimum);
          for (const v of [baseline, response]) {
            expect.soft(v.status).toBe(409);
            expect.soft(v.headers["bdp-scope-epoch"]).toBe(actual.scopeEpoch);
            expect.soft(v.headers["bdp-authorization-view"]).toBe(actual.authorizationView);
            expect.soft(v.headers["bdp-scope-position"]).toBe(actual.scopePosition);
            expect.soft(v.headers["cache-control"]).toBe("private, no-store");
            if (method === "HEAD") expect.soft(v.bodyText).toBe("");
            else expect.soft(v.body).toEqual(foreignProblem);
          }
          caseResults.push({ target, method, baseline, minimumResponse: response });
        }
      const retained = await exchange(actual.id, "GET", undefined, undefined, minimum);
      expect(retained.status).toBe(200);
      expect(retained.body).toEqual(actual);
      const currentHead = await exchange(actual.id, "HEAD", undefined, undefined, minimum);
      expect(currentHead.status).toBe(200);
      expect(currentHead.bodyText).toBe("");
      expect(currentHead.headers["content-length"]).toBe(
        String(Buffer.byteLength(retained.bodyText)),
      );
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
          terminal = await child.close();
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
              ready,
              controls,
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
