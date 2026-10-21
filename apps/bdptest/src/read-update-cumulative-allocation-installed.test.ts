/** Actual installed allocator must skip a real live alias; no allocation-result callback. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor, type HttpMethod } from "@bdp/conformance";
import type { TypeDescriptor } from "@bdp/protocol";
import { expect, it } from "vitest";
import {
  cumulativeRUConfiguration,
  type RUCampaignCredentials,
} from "../test-support/read-update-cumulative-management-configuration.js";
import { launchRUAllocation } from "../test-support/read-update-cumulative-allocation-launch.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const helpers = await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
);
const entry = process.env.BDP_RU_ALLOCATION_ENTRY,
  build = process.env.BDP_RU_ALLOCATION_BUILD,
  output = process.env.BDP_RU_ALLOCATION_OUTPUT,
  bankPath = process.env.BDP_RU_ALLOCATION_CREDENTIALS;
const scope = "https://reference.invalid/acme/",
  type = scope + "types/task";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
type Data = Record<string, any>;
function bead(value: Data, id: string, properties: unknown) {
  expect(value.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(value).toEqual({ id, type, revision: value.revision, properties, metadata: {} });
  return value;
}
it.skipIf(!entry)(
  "skips the exact live alias candidate in the genuine installed native allocator",
  async () => {
    if (!entry || !build || !output || !bankPath) throw Error("exact installed inputs required");
    const evidence: Data = {
      ordinaryDeployment: false,
      ordinaryRuntimeConfigurationIdentity: null,
      source: process.env.BDP_RU_ALLOCATION_SOURCE,
      wires: [],
      controls: [],
      failures: [],
      observerMeaning: "fixture planning only, not allocator truth or an ordinary production port",
      namespaceExported: false,
    };
    const failures: unknown[] = [];
    let directory: string | undefined, run: ReturnType<typeof launchRUAllocation> | undefined;
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(Error("allocation90s cohort deadline")), 90000);
    let bank: RUCampaignCredentials | undefined;
    try {
      directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-allocator-livealias-"));
      const bankBytes = await readFile(bankPath);
      bank = JSON.parse(bankBytes.toString()) as RUCampaignCredentials;
      expect(Object.keys(bank).sort()).toEqual(["operator", "other", "restricted"]);
      expect(new Set(Object.values(bank)).size).toBe(3);
      for (const v of Object.values(bank)) expect(v.length).toBeGreaterThanOrEqual(32);
      evidence.credentialBank = {
        bytes: bankBytes.length,
        sha256: sha(bankBytes),
        roles: Object.keys(bank).sort(),
        valuesPublished: false,
      };
      const modules = [];
      for (const name of (await readdir(build)).filter((n) => n.endsWith(".js")).sort()) {
        const bytes = await readFile(path.join(path.dirname(entry), name));
        expect(bytes.equals(await readFile(path.join(build, name))), name).toBe(true);
        modules.push({ name, bytes: bytes.length, sha256: sha(bytes) });
      }
      evidence.modules = modules;
      const schema = await readFile(
        path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json"),
      );
      expect(schema.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(
        true,
      );
      evidence.protocolSchemaSHA256 = sha(schema);
      const installed = (await import(
        pathToFileURL(path.join(path.dirname(entry), "installed-reference-configuration.js")).href
      )) as {
        referenceTypeArtifacts(scope: string): TypeDescriptor[];
        captureInstalledReferenceConfiguration(input: unknown): Data;
      };
      const port = await helpers.availablePort();
      const configuration = cumulativeRUConfiguration(
        { scope, directory, create: true, listener: { host: "127.0.0.1", port } },
        installed.referenceTypeArtifacts(scope),
        bank,
      );
      const captured = installed.captureInstalledReferenceConfiguration(configuration);
      evidence.configuration = {
        ...configuration,
        credentials: configuration.credentials.map(({ token: _token, ...r }) => r),
      };
      evidence.capture = {
        identity: captured.identity,
        artifactIdentity: captured.artifactIdentity,
        policyIdentity: captured.policyIdentity,
        authenticationIdentity: captured.authenticationIdentity,
      };
      run = launchRUAllocation(entry, configuration);
      const ready = await run.ready;
      expect(ready).toMatchObject({
        event: "allocation.ready",
        ordinaryDeployment: false,
        ordinaryRuntimeConfigurationIdentity: null,
        nativeConfigurationIdentity: captured.identity,
        artifactIdentity: captured.artifactIdentity,
        policyIdentity: captured.policyIdentity,
        authenticationIdentity: captured.authenticationIdentity,
        namespaceExported: false,
        facadeKeys: ["close", "scope"],
        listenerInput: { host: "127.0.0.1", port },
      });
      const allocatorPin = modules.find((m) => m.name === "recovery-store.js");
      expect(ready.sourcePin).toEqual({
        file: "recovery-store.js",
        bytes: allocatorPin!.bytes,
        sha256: allocatorPin!.sha256,
      });
      evidence.ready = ready;
      async function send(
        target: string,
        method: HttpMethod = "GET",
        body?: unknown,
        key?: string,
      ) {
        if (evidence.wires.length >= 20) throw Error("twenty HTTP witness bound");
        const url = new URL(target, scope).href;
        if (!url.startsWith(scope) || new URL(url).hash)
          throw Error("exact local request required");
        const raw = body === undefined ? undefined : JSON.stringify(body),
          bytes = raw === undefined ? undefined : Buffer.from(raw);
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
              credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
              resolveCredentials: () => ({ authorization: `Bearer ${bank!.operator}` }),
            },
          },
        );
        const response = await execute({
          method,
          url,
          signal: controller.signal,
          raw: {
            headerLines: [
              { name: "Accept", value: "application/json" },
              ...(bytes
                ? [
                    { name: "Content-Type", value: "application/json" },
                    ...(key ? [{ name: "Idempotency-Key", value: key }] : []),
                  ]
                : []),
            ],
            ...(bytes ? { bodyBytes: bytes } : {}),
          },
        });
        evidence.wires.push({
          method,
          url,
          credentialRef: "operator",
          key,
          requestBody: raw,
          status: response.status,
          headers: response.headers,
          bodyText: response.bodyText,
          wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
          serializer: response.exactRequest
            ? {
                source: response.exactRequest.source,
                bodyPresent: response.exactRequest.bodyPresent,
                bodyOctets: response.exactRequest.bodyOctets,
                bodyDigest: response.exactRequest.bodyDigest,
                writeState: response.exactRequest.writeState,
              }
            : null,
        });
        expect(response.exactRequest?.writeState).toBe("complete");
        expect(response.wireResponseBytes?.length).toBeGreaterThan(0);
        if (bytes) expect(response.exactRequest?.bodyDigest).toBe(sha(bytes));
        return {
          status: response.status,
          headers: response.headers,
          bodyText: response.bodyText,
          value: response.bodyText ? (JSON.parse(response.bodyText) as Data) : undefined,
        };
      }
      async function observe() {
        const message = await run!.control({ command: "observe" });
        evidence.controls.push(message);
        expect(message.event).toBe("allocation.observed");
        const state = message.observation as Data;
        expect(state).toMatchObject({
          readOnly: true,
          observedOnlyAfterOwnerClose: true,
          sourcePin: ready.sourcePin,
        });
        expect(Object.keys(state).sort()).toEqual([
          "aliases",
          "candidates",
          "counter",
          "identities",
          "observedOnlyAfterOwnerClose",
          "readOnly",
          "resources",
          "sourcePin",
        ]);
        expect(state.counter).toMatch(/^\d+$/);
        expect(state.candidates).toHaveLength(2);
        for (const c of state.candidates)
          expect(c).toMatch(/^https:\/\/reference\.invalid\/acme\/beads\/[a-f0-9]{64}$/);
        expect(state.candidates[0]).not.toBe(state.candidates[1]);
        return state;
      }
      const discovery = await send("bdp.json");
      expect(discovery.status).toBe(200);
      expect(discovery.value).toMatchObject({
        scope,
        profile: "read-update",
        operations: scope + "operations/",
        aliases: scope + "alias/",
      });
      const operations = await send(discovery.value!.operations);
      expect(operations.status).toBe(200);
      expect(operations.value).toMatchObject({ createBead: "create-bead", putAlias: "put-alias" });
      const createRoute = new URL(operations.value!.createBead, discovery.value!.operations).href;
      const aliasRoute = new URL(operations.value!.putAlias, discovery.value!.operations).href;
      const madeTarget = await send(
        createRoute,
        "POST",
        { id: "beads/target", type, properties: { title: "healthy target" } },
        "target",
      );
      expect(madeTarget.status).toBe(200);
      expect(madeTarget.value!.outcome).toBe("created");
      const target = bead(madeTarget.value!.resource, scope + "beads/target", {
        title: "healthy target",
      });
      const planned = await observe();
      expect(planned.counter).toBe("0");
      expect(planned.identities).toEqual([{ id: "beads/target" }]);
      expect(planned.aliases).toEqual([]);
      const [candidate1, candidate2] = planned.candidates as string[];
      const suffix = candidate1!.slice((scope + "beads/").length),
        alias = scope + "alias/" + suffix;
      const aliasPut = await send(
        aliasRoute,
        "POST",
        { alias, target: target.id },
        "occupy-candidate",
      );
      expect(aliasPut.status).toBe(200);
      expect(aliasPut.value).toEqual({ outcome: "created", alias, target: target.id });
      for (const method of ["GET", "HEAD"] as const) {
        const response = await send(alias, method);
        expect(response.status).toBe(307);
        expect(response.headers.location).toBe(target.id);
        expect(response.headers["cache-control"]).toBe("private, no-store");
        expect(response.bodyText).toBe("");
      }
      const occupied = await observe();
      expect(occupied.counter).toBe("0");
      expect(occupied.candidates).toEqual(planned.candidates);
      expect(occupied.identities).toEqual(planned.identities);
      expect(occupied.aliases).toEqual([{ path: suffix, bead_id: "beads/target" }]);
      const creationInput = { type, properties: { title: "allocated after genuine collision" } };
      const result = await send(createRoute, "POST", creationInput, "allocate-after-alias");
      expect(result.status).toBe(200);
      expect(result.value!.outcome).toBe("created");
      const allocated = bead(result.value!.resource, candidate2!, creationInput.properties);
      expect(allocated.id).not.toBe(candidate1);
      expect((await send(allocated.id)).value).toEqual(allocated);
      expect((await send(target.id)).value).toEqual(target);
      const after = await observe();
      expect(after.counter).toBe("2");
      expect(after.identities).toEqual([
        { id: candidate2!.slice(scope.length) },
        { id: "beads/target" },
      ]);
      expect(after.aliases).toEqual(occupied.aliases);
      expect(after.resources.map((r: Data) => JSON.parse(r.body))).toEqual([allocated, target]);
      const retry = await send(createRoute, "POST", creationInput, "allocate-after-alias");
      expect(retry.status).toBe(200);
      expect(retry.value).toEqual(result.value);
      const afterRetry = await observe();
      expect(afterRetry.counter).toBe("2");
      expect(afterRetry.identities).toEqual(after.identities);
      expect(afterRetry.resources).toEqual(after.resources);
      expect(afterRetry.aliases).toEqual(after.aliases);
      const aliasStill = await send(alias);
      expect(aliasStill.status).toBe(307);
      expect(aliasStill.headers.location).toBe(target.id);
      expect(aliasStill.bodyText).toBe("");
      const collection = await send("beads/");
      expect(collection.status).toBe(200);
      expect(collection.value).toEqual({ items: [allocated, target], next: null });
      evidence.facts = {
        target,
        candidate1,
        candidate2,
        allocated,
        alias,
        collisionWitness:
          "same native counter0 plansC1/C2; real aliasC1; native allocation returnsC2 and counter2; retry remains2",
        actualRequests: evidence.wires.length,
      };
    } catch (error) {
      failures.push(error);
    }
    clearTimeout(timer);
    if (run) {
      try {
        evidence.terminal = await run.close();
        expect(evidence.terminal).toMatchObject({
          code: 0,
          signal: null,
          forced: false,
          overflow: false,
          stdoutEOF: true,
          stderrEOF: true,
          reaped: true,
        });
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      if (directory) {
        await rm(directory, { recursive: true, force: true });
        await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
        evidence.removed = true;
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      const text =
        JSON.stringify(
          { ...evidence, failures: failures.map((e) => inspect(e, { depth: 12 })) },
          null,
          2,
        ) + "\n";
      for (const token of Object.values(bank ?? {}))
        if (text.includes(token)) throw Error("credential in safe evidence");
      await writeFile(path.join(output, "allocation-livealias.json"), text);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(failures, "NEW allocator livealias witness failed");
  },
  90000,
);
