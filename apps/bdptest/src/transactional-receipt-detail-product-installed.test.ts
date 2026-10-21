/** NEW nonordinary installed receipt detail fixture; trusted seams are explicit, never public. */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import { expect, it } from "vitest";
import { launchReceiptDetail } from "../test-support/receipt-detail-installed-launch.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry = process.env.BDP_RECEIPT_DETAIL_PRODUCT_ENTRY;
const source = process.env.BDP_RECEIPT_DETAIL_PRODUCT_SOURCE;
const build = process.env.BDP_RECEIPT_DETAIL_PRODUCT_BUILD;
const output = process.env.BDP_RECEIPT_DETAIL_PRODUCT_OUTPUT;
const scope = "https://reference.invalid/acme/";
const type = `${scope}types/receipt-detail`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

it.skipIf(!entry)(
  "installed receipt/page detail follows real erase empty-policy and exact retention boundary",
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
      new URL("../test-support/transactional-receipt-detail-fixture.json", import.meta.url),
    );
    const fixture = JSON.parse(fixtureBytes.toString("utf8"));
    const directory = await mkdtemp(path.join(tmpdir(), "bdp-receipt-detail-product-"));
    const tokens = {
      writer: randomBytes(32).toString("base64url"),
      other: randomBytes(32).toString("base64url"),
    };
    const configuration = {
      scope,
      directory,
      create: true,
      credentials: Object.entries(tokens).map(([principal, token]) => ({
        principal,
        token,
        canMutate: principal === "writer",
      })),
      artifacts: fixture.artifacts,
    };
    const controller = new AbortController();
    const watchdog = setTimeout(
      () => controller.abort(Error("receipt detail product deadline")),
      30000,
    );
    let run: ReturnType<typeof launchReceiptDetail> | undefined;
    let ready: Record<string, unknown> | undefined, binding: unknown, terminal: unknown;
    const wires: unknown[] = [],
      controls: unknown[] = [],
      failures: unknown[] = [];
    let epoch: string | undefined, originalView: string | undefined, view: string | undefined;
    let position = "pos-0";
    try {
      run = launchReceiptDetail(entry, configuration);
      ready = await run.ready;
      expect(ready.event).toBe("receipt-detail.ready");
      expect(ready.ordinaryDeployment).toBe(false);
      expect(ready.fixture).toBe("installed-receipt-private-clock-policy-administration");
      expect(ready.facadeKeys).toEqual([
        "close",
        "configurationMetadata",
        "listenUrl",
        "replaceAuthorizationPolicy",
        "scope",
        "targets",
      ]);
      // A trusted clock seam intentionally disables ordinary configurationMetadata.
      // Retain these direct fixture facts without inventing ordinary deployment identity.
      expect(ready.ordinaryConfigurationMetadataAvailable).toBe(false);
      expect(ready.payloadIdentity).toMatch(/^[0-9a-f]{64}$/);
      expect(ready.selectedSeams).toEqual([
        "trusted-clock",
        "same-facade-private-administration",
        "existing-empty-authorization-policy",
      ]);
      binding = {
        source,
        payloadIdentity: ready.payloadIdentity,
        fixture: { bytes: fixtureBytes.length, sha256: sha(fixtureBytes), id: fixture.id },
        selectedSeams: ready.selectedSeams,
        ordinaryConfigurationMetadataAvailable: false,
        ordinaryDeployment: false,
        claimEligible: false,
      };
      const address = new URL(String(ready.listenUrl));
      async function send(
        target: string,
        method: "GET" | "HEAD" | "POST" = "GET",
        body?: unknown,
        key?: string,
        principal: keyof typeof tokens = "writer",
      ) {
        expect(wires.length).toBeLessThan(40);
        const url = new URL(target, scope).href;
        expect(new URL(url).origin).toBe(new URL(scope).origin);
        expect(new URL(url).pathname.startsWith("/acme/")).toBe(true);
        if (body !== undefined && typeof key !== "string")
          throw Error("explicit new receipt key required");
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
                    { name: "Idempotency-Key", value: key ?? "" },
                  ],
            ...(raw === undefined ? {} : { bodyBytes: Buffer.from(raw) }),
          },
        });
        wires.push({
          method,
          url,
          principal,
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
        if (raw !== undefined)
          expect(response.exactRequest?.bodyDigest).toBe(sha(Buffer.from(raw)));
        for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
          expect(response.headers[name], name).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
        epoch ??= response.headers["bdp-scope-epoch"];
        view ??= response.headers["bdp-authorization-view"];
        originalView ??= view;
        expect(response.headers["bdp-scope-epoch"]).toBe(epoch);
        expect(response.headers["bdp-authorization-view"]).toBe(view);
        expect(response.headers["bdp-scope-position"]).toBe(position);
        return {
          wire: response,
          value: response.bodyText ? JSON.parse(response.bodyText) : undefined,
        };
      }
      async function pair(url: string, body: unknown) {
        const get = await send(url);
        expect(get.wire.status).toBe(200);
        expect(get.value).toEqual(body);
        const head = await send(url, "HEAD");
        expect(head.wire.status).toBe(200);
        expect(head.wire.bodyText).toBe("");
        for (const response of [get.wire, head.wire]) {
          expect(response.headers["cache-control"]).toBe("private, no-store");
          expect(response.headers.etag).toBeUndefined();
          expect(response.headers["last-modified"]).toBeUndefined();
        }
        expect(head.wire.headers["content-length"]).toBe(
          String(Buffer.byteLength(get.wire.bodyText)),
        );
      }
      async function foreign(url: string) {
        const denied = await send(url, "GET", undefined, undefined, "other");
        expect(denied.wire.status).toBe(404);
        expect(denied.value.code).toBe("resource-not-found");
      }
      const ids = Array.from({ length: 32 }, (_, i) => `r${String(i).padStart(2, "0")}`);
      position = "pos-1";
      const seeded = await send(
        "operations/batch",
        "POST",
        {
          operations: ids.map((id) => ({
            operation: "createBead",
            id: `beads/${id}`,
            type,
            properties: { label: id, n: 0 },
            metadata: { stage: "retained" },
          })),
        },
        "detail-seed",
      );
      expect(seeded.wire.status).toBe(200);
      expect(seeded.value.status).toBe("completed");
      const set = (before: number, after: number) => ({
        collection: "beads",
        selector: `$[?@.properties.n == ${before}]`,
        change: [{ op: "replace", path: "/n", value: after }],
        cardinality: { min: 32, max: 32 },
      });
      const oldRequest = set(0, 1);
      position = "pos-2";
      const old = await send("operations/update-where", "POST", oldRequest, "detail-old");
      expect(old.wire.status).toBe(200);
      expect(old.value.status).toBe("completed");
      expect(old.value.results).toHaveLength(32);
      const oldPageUrl = old.value.next;
      expect(typeof oldPageUrl).toBe("string");
      expect(oldPageUrl.startsWith(`${old.value.id}/pages/`)).toBe(true);
      const oldPage = await send(oldPageUrl);
      expect(oldPage.wire.status).toBe(200);
      expect(oldPage.value.results).toHaveLength(1);
      expect(oldPage.value.next).toBeNull();
      const oldEntries = [...old.value.results, ...oldPage.value.results];
      expect(oldEntries[0]).toEqual({ operationIndex: 0, outcome: "matched", count: 32 });
      for (const [index, row] of oldEntries.slice(1).entries())
        expect(row).toEqual({
          operationIndex: 0,
          outcome: "updated",
          resource: {
            id: `${scope}beads/${ids[index]}`,
            type,
            revision: expect.any(String),
            properties: { label: ids[index], n: 1 },
            metadata: { stage: "retained" },
          },
        });
      const expires = 1000000 + 86400000;
      expect(old.value.expiresAt).toBe(new Date(expires).toISOString());
      position = "pos-3";
      const successor = await send("operations/update-where", "POST", set(1, 2), "detail-current");
      expect(successor.wire.status).toBe(200);
      expect(successor.value.status).toBe("completed");
      const successorPage = await send(successor.value.next);
      expect(successorPage.wire.status).toBe(200);
      const currentEntries = [...successor.value.results, ...successorPage.value.results];
      expect(currentEntries).toHaveLength(33);
      for (const [index, row] of currentEntries.slice(1).entries()) {
        expect(row).toEqual({
          operationIndex: 0,
          outcome: "updated",
          resource: {
            id: `${scope}beads/${ids[index]}`,
            type,
            revision: expect.any(String),
            properties: { label: ids[index], n: 2 },
            metadata: { stage: "retained" },
          },
        });
        expect(row.resource.revision).not.toBe(oldEntries[index + 1].resource.revision);
      }
      const selected = [oldEntries[1].resource, oldEntries[32].resource];
      const erased = await run.control({
        command: "erase",
        subjects: selected.map((row) => ({ subject: row.id, revision: row.revision })),
      });
      controls.push(erased);
      expect(erased.event).toBe("erased");
      position = "pos-4";
      const projected = await send(old.value.id),
        projectedPage = await send(oldPageUrl);
      expect(projected.wire.status).toBe(200);
      expect(projectedPage.wire.status).toBe(200);
      // Permission for erased identity disclosure is unresolved. Only content absence and
      // the two conditional normative shapes are checked here; no history grant is inferred.
      const conditionalMarker = (
        actual: unknown,
        original: { id: string; type: string; revision: string },
      ) => {
        expect(actual).not.toHaveProperty("resource");
        if ((actual as { outcome?: unknown }).outcome === "erased")
          expect(actual).toEqual({
            operationIndex: 0,
            outcome: "erased",
            erased: { id: original.id, type: original.type, revision: original.revision },
          });
        else expect(actual).toEqual({ operationIndex: 0, outcome: "withheld" });
      };
      conditionalMarker(projected.value.results[1], selected[0]);
      conditionalMarker(projectedPage.value.results[0], selected[1]);
      expect(projected.value.results.slice(2)).toEqual(old.value.results.slice(2));
      expect(projected.value.results[0]).toEqual(old.value.results[0]);
      expect(projected.value).toEqual({ ...old.value, results: projected.value.results });
      expect(projectedPage.value).toEqual({
        ...oldPage.value,
        results: projectedPage.value.results,
      });
      const duplicate = await send("operations/update-where", "POST", oldRequest, "detail-old");
      expect(duplicate.wire.status).toBe(200);
      expect(duplicate.value).toEqual(projected.value);
      for (const index of [0, 31]) {
        const healthy = await send(`beads/${ids[index]}`);
        expect(healthy.wire.status).toBe(200);
        expect(healthy.value).toEqual(currentEntries[index + 1].resource);
      }
      await foreign(old.value.id);
      await foreign(oldPageUrl);
      const rotated = await run.control({ command: "empty-policy" });
      controls.push(rotated);
      expect(rotated.event).toBe("empty-policy");
      view = undefined;
      const hiddenRoot = {
        ...old.value,
        results: [
          old.value.results[0],
          ...old.value.results.slice(1).map(() => ({ operationIndex: 0, outcome: "withheld" })),
        ],
      };
      const hiddenPage = {
        ...oldPage.value,
        results: [{ operationIndex: 0, outcome: "withheld" }],
      };
      await pair(old.value.id, hiddenRoot);
      expect(view).not.toBe(originalView);
      await pair(oldPageUrl, hiddenPage);
      const at = await run.control({ command: "at-expiry" });
      controls.push(at);
      expect(at).toEqual({ event: "at-expiry", now: expires });
      await pair(old.value.id, hiddenRoot);
      await pair(oldPageUrl, hiddenPage);
      const after = await run.control({ command: "after-expiry" });
      controls.push(after);
      expect(after).toEqual({ event: "after-expiry", now: expires + 1 });
      const { results: _results, next: _next, expiresAt: _expiresAt, ...compact } = old.value;
      await pair(old.value.id, { ...compact, detail: "expired", allocated: [] });
      for (const method of ["GET", "HEAD"] as const) {
        const expiredPage = await send(oldPageUrl, method);
        expect(expiredPage.wire.status).toBe(410);
        if (method === "GET")
          expect(expiredPage.value).toMatchObject({ code: "cursor-expired", status: 410 });
        else expect(expiredPage.wire.bodyText).toBe("");
      }
      await foreign(old.value.id);
      await foreign(oldPageUrl);
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(watchdog);
      try {
        if (run) {
          terminal = await run.close();
          expect(terminal).toMatchObject({
            code: 0,
            signal: null,
            overflow: false,
            forced: false,
            stdoutEOF: true,
            stderrEOF: true,
            reaped: true,
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
              fixtureSHA256: sha(fixtureBytes),
              fixtureId: fixture.id,
              configuration: {
                ...configuration,
                credentials: [
                  { principal: "writer", credentialRef: "writer", canMutate: true },
                  { principal: "other", credentialRef: "other", canMutate: false },
                ],
              },
              binding,
              ready,
              terminal,
              controls,
              wires,
              failures: failures.map((error) => inspect(error, { depth: 10 })),
              ordinaryDeployment: false,
              historyDisclosurePermissionQualified: false,
              allVisibleIdentityPermission:
                "UNRESOLVED; content absence only, not identity-grant acceptance",
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
      throw new AggregateError(failures, "receipt detail observation/cleanup failed");
  },
  45000,
);
