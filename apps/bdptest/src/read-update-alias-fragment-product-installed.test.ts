/** Focused receiving oracle in the NEW fixed RU cumulative configuration. */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import { bindServedProfileConfiguration } from "@bdp/conformance/testing";
import type { TypeDescriptor } from "@bdp/protocol";
import { expect, it } from "vitest";
import { installedContractsDigest } from "../test-support/installed-contract-identity.js";
import {
  cumulativeRUConfiguration,
  type RUCampaignCredentials,
} from "../test-support/read-update-alias-fragment-product-configuration.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_RU_CUMULATIVE_INSTALLED_ENTRY;
const sourceCommit = process.env.BDP_RU_CUMULATIVE_SOURCE;
const build = process.env.BDP_RU_CUMULATIVE_BUILD;
const evidence = process.env.BDP_RU_CUMULATIVE_EVIDENCE;
const credentialFile = process.env.BDP_RU_CUMULATIVE_CREDENTIALS;
const fixture = await readFile(
  new URL("../test-support/read-update-alias-fragment-product-fixture.json", import.meta.url),
);
const scope = "https://reference.invalid/acme/";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const helpers = await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
);
it.skipIf(!entry)(
  "packed RU alias fragment has the same nonobserving404 boundary as unknown aliases",
  async () => {
    if (
      !entry ||
      !build ||
      !evidence ||
      !credentialFile ||
      !sourceCommit ||
      !/^[a-f0-9]{40}$/.test(sourceCommit)
    )
      throw Error("explicit packed RU inputs required");
    const runtime = (await import(
      pathToFileURL(path.join(path.dirname(entry), "installed-reference-configuration.js")).href
    )) as {
      referenceTypeArtifacts(scope: string): TypeDescriptor[];
      captureInstalledReferenceConfiguration(config: unknown): { identity: string };
    };
    const modules = [];
    for (const name of (await readdir(build)).filter((n) => n.endsWith(".js")).sort()) {
      const bytes = await readFile(path.join(path.dirname(entry), name));
      expect(bytes.equals(await readFile(path.join(build, name))), name).toBe(true);
      modules.push({ name, bytes: bytes.length, sha256: sha(bytes) });
    }
    const schema = await readFile(
      path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json"),
    );
    expect(schema.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(true);
    const credentials = JSON.parse(await readFile(credentialFile, "utf8")) as RUCampaignCredentials;
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-cumulative-"));
    const port = await helpers.availablePort();
    const config = cumulativeRUConfiguration(
      { scope, directory, create: true, listener: { host: "127.0.0.1", port } },
      runtime.referenceTypeArtifacts(scope),
      credentials,
    );
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(Error("RU receiving deadline")), 45000);
    const wires: unknown[] = [],
      failures: unknown[] = [];
    let child: Awaited<ReturnType<typeof helpers.launchInstalledReference>> | undefined;
    let terminal: unknown, closed: Promise<void> | undefined, binding: unknown, ready: unknown;
    try {
      child = await helpers.launchInstalledReference(entry, config);
      const serving = child.child;
      closed = new Promise<void>((resolve) =>
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
      ready = child.ready;
      expect(child.ready.configurationIdentity).toBe(
        runtime.captureInstalledReferenceConfiguration(config).identity,
      );
      binding = bindServedProfileConfiguration({
        scope,
        profile: "read-update",
        history: false,
        sourceCommit,
        installedPayloadDigest: child.ready.payloadIdentity,
        installedContractsDigest: installedContractsDigest(child.ready.artifactIdentity),
        policyDigest: child.ready.policyIdentity,
        authenticationDigest: child.ready.authenticationIdentity,
        fixture: { bytes: fixture },
      });
      async function exchange(
        target: string,
        method: HttpMethod = "GET",
        body?: unknown,
        key?: string,
        suffix?: string,
        credentialRef = "operator",
      ) {
        const url = new URL(target, scope).href;
        if (!url.startsWith(scope) || wires.length >= 16)
          throw Error("unbound/excess RU probe request");
        const execute = createRawHttpExchangeExecutor(
          { transport: "plain", host: "127.0.0.1", port },
          {
            requestTimeoutMs: 5000,
            maximumBodyBytes: 1048576,
            exactMode: {
              scope,
              profile: "read-update",
              routes: [{ method, url }],
              maximumRequestHeaderBytes: 16384,
              maximumRequestBodyBytes: 65536,
              defaultCredentialRef: "operator",
              credentialHandles: [
                { id: "operator", headerNames: ["authorization"] },
                { id: "anonymous", headerNames: [] },
              ],
              resolveCredentials: ({ credentialRef }) =>
                credentialRef === "anonymous"
                  ? {}
                  : { authorization: `Bearer ${credentials.operator}` },
            },
          },
        );
        const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        const rawTarget =
          suffix === undefined ? undefined : Buffer.from(new URL(url).pathname + suffix, "ascii");
        const response = await execute({
          method,
          url,
          credentialRef,
          signal: controller.signal,
          ...(rawTarget === undefined ? {} : { rawRequestTarget: rawTarget }),
          raw: {
            headerLines:
              bytes === undefined
                ? []
                : [
                    { name: "content-type", value: "application/json" },
                    { name: "idempotency-key", value: key ?? "missing" },
                  ],
            ...(bytes === undefined ? {} : { bodyBytes: bytes }),
          },
        });
        wires.push({
          method,
          url,
          key,
          credentialRef,
          body,
          rawRequestTargetBase64: rawTarget?.toString("base64"),
          requestBodySHA256: bytes && sha(bytes),
          writeState: response.exactRequest?.writeState,
          status: response.status,
          headers: response.headers,
          bodyText: response.bodyText,
          wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
        });
        expect(response.exactRequest?.writeState).toBe("complete");
        return {
          ...response,
          body: response.bodyText === "" ? null : JSON.parse(response.bodyText),
        };
      }
      const created = await exchange(
        "operations/create-bead",
        "POST",
        {
          id: "beads/ru-fragment-target",
          type: `${scope}types/task`,
          properties: { title: "retained RU target" },
        },
        "ru-fragment-target",
      );
      expect(created.status).toBe(200);
      expect(created.body.outcome).toBe("created");
      const put = await exchange(
        "operations/put-alias",
        "POST",
        { alias: "alias/ru-fragment", target: "beads/ru-fragment-target" },
        "ru-fragment-put",
      );
      expect(put.status).toBe(200);
      expect(put.body).toEqual({
        outcome: "created",
        alias: `${scope}alias/ru-fragment`,
        target: `${scope}beads/ru-fragment-target`,
      });
      for (const method of ["GET", "HEAD"] as const) {
        const resolved = await exchange("alias/ru-fragment", method);
        expect(resolved.status).toBe(307);
        expect(resolved.headers.location).toBe(`${scope}beads/ru-fragment-target`);
        expect(resolved.bodyText).toBe("");
      }
      const unknown = await exchange("alias/ru-never-created");
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe("resource-not-found");
      const fragment = await exchange(
        "alias/ru-fragment",
        "GET",
        undefined,
        undefined,
        "#fragment",
      );
      expect(fragment.status).toBe(404);
      expect(fragment.body.code).toBe("resource-not-found");
      expect(fragment.body).toEqual(unknown.body);
      const emptyFragment = await exchange("alias/ru-fragment", "GET", undefined, undefined, "#");
      expect(emptyFragment.status).toBe(404);
      expect(emptyFragment.body).toEqual(unknown.body);
      const fragmentHead = await exchange(
        "alias/ru-fragment",
        "HEAD",
        undefined,
        undefined,
        "#fragment",
      );
      expect(fragmentHead.status).toBe(404);
      expect(fragmentHead.bodyText).toBe("");
      expect(fragmentHead.headers.location).toBeUndefined();
      const missingFragment = await exchange(
        "alias/ru-never-created",
        "GET",
        undefined,
        undefined,
        "#fragment",
      );
      expect(missingFragment.status).toBe(404);
      expect(missingFragment.body).toEqual(unknown.body);
      const nonAlias = await exchange(
        "beads/ru-fragment-target",
        "GET",
        undefined,
        undefined,
        "#fragment",
      );
      expect(nonAlias.status).toBe(400);
      expect(nonAlias.body.code).toBe("malformed-request");
      const unsafeAlias = await exchange(
        "alias/ru-fragment",
        "GET",
        undefined,
        undefined,
        "/../x#fragment",
      );
      expect(unsafeAlias.status).toBe(400);
      expect(unsafeAlias.body.code).toBe("malformed-request");
      const unauthenticated = await exchange(
        "alias/ru-fragment",
        "GET",
        undefined,
        undefined,
        "#fragment",
        "anonymous",
      );
      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.body.code).toBe("unauthenticated");
      expect(fragment.headers.location).toBeUndefined();
      expect(fragment.body).not.toHaveProperty("target");
      expect(fragment.body).not.toHaveProperty("revision");
      const current = await exchange("beads/ru-fragment-target");
      expect(current.status).toBe(200);
      expect(current.body).toEqual(created.body.resource);
      for (const m of modules)
        expect(sha(await readFile(path.join(path.dirname(entry), m.name)))).toBe(m.sha256);
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(watchdog);
      try {
        if (child) {
          await child.close();
          await closed;
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
              runtimeSource: sourceCommit,
              entry,
              modules,
              schemaSHA256: sha(schema),
              fixtureSHA256: sha(fixture),
              configuration: {
                ...config,
                credentials: Object.keys(credentials).map((principal) => ({
                  principal,
                  credentialRef: principal,
                })),
              },
              ready,
              binding,
              terminal,
              storeRemoved,
              wires,
              failures: failures.map((e) => inspect(e, { depth: 8 })),
              finalCumulativeCampaign: false,
              wholeProfile: false,
            },
            null,
            2,
          ),
          { mode: 0o600, flag: "wx" },
        );
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "RU selected receiving boundary or cleanup failed");
  },
  45000,
);
