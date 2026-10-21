/** NEW finite ordinary TX slice; unchanged installed launcher/HTTP/configuration. */
import { createHash } from "node:crypto";
import { readFile, readdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { expect } from "vitest";
import { createRawHttpExchangeExecutor, createJsonSchemaValidator } from "@bdp/conformance";
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
import { installedTransactionBinding } from "./transactional-execution-binding.js";
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);
export const installed = process.env.BDP_TX_SEMANTIC_LABELS_INSTALLED;
export const scope = "https://reference.invalid/acme/";
export const validator = createJsonSchemaValidator(schema);
const sha = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
const fixtureBytes = await readFile(
  new URL("./transactional-cumulative-product-fixture.json", import.meta.url),
);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
export async function withSemanticLabels(name: string, run: (c: any) => Promise<void>) {
  const output = process.env.BDP_TX_SEMANTIC_LABELS_EVIDENCE,
    bankPath = process.env.BDP_TX_SEMANTIC_LABELS_CREDENTIALS,
    bindingPath = process.env.BDP_TX_SEMANTIC_LABELS_SUBJECT_BINDING;
  if (!installed || !output || !bankPath || !bindingPath)
    throw Error("exact installed/bank/binding/output required");
  const errors: unknown[] = [],
    wires: unknown[] = [],
    results: Record<string, unknown> = {};
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(Error("unchanged90s semantic-labels bound")), 90000);
  let directory: string | undefined,
    child: Awaited<ReturnType<typeof launchInstalledTransaction>> | undefined,
    closed: Promise<any> | undefined,
    terminal: unknown,
    ready: any,
    binding: unknown,
    removed = false;
  let roles: Array<{ ref: string; principal: string; canMutate: boolean; token: string }> = [];
  let modules: unknown;
  try {
    roles = JSON.parse(await readFile(bankPath, "utf8"));
    expect(roles.map(({ ref, principal, canMutate }) => ({ ref, principal, canMutate }))).toEqual([
      { ref: "operator", principal: "same", canMutate: true },
      { ref: "reader", principal: "same", canMutate: false },
      { ref: "principal-a", principal: "principal-a", canMutate: true },
      { ref: "principal-a-rotated", principal: "principal-a", canMutate: true },
      { ref: "principal-b", principal: "principal-b", canMutate: true },
    ]);
    expect(new Set(roles.map((r) => r.token)).size).toBe(5);
    const selected = JSON.parse(await readFile(bindingPath, "utf8")).moduleBindings as Array<{
      name: string;
      bytes: number;
      sha256: string;
    }>;
    expect((await readdir(installed)).filter((n) => n.endsWith(".js")).sort()).toEqual(
      selected
        .filter((m) => m.name.endsWith(".js"))
        .map((m) => m.name)
        .sort(),
    );
    for (const m of selected) {
      const raw = await readFile(
        m.name.endsWith(".js")
          ? path.join(installed, m.name)
          : path.join(installed, "../../protocol/schemas/bdp-v0.schema.json"),
      );
      expect(raw.length).toBe(m.bytes);
      expect(sha(raw)).toBe(m.sha256);
    }
    modules = selected;
    directory = await mkdtemp(path.join(tmpdir(), `bdp-tx-semantic-labels-${name}-`));
    child = await launchInstalledTransaction(
      path.join(installed, "transaction-installed-process.js"),
      {
        scope,
        directory,
        create: true,
        credentials: roles.map(({ token, principal, canMutate }) => ({
          token,
          principal,
          canMutate,
        })),
        artifacts: fixture.artifacts,
      },
      controller.signal,
    );
    const owned = child;
    closed = new Promise((resolve, reject) => {
      owned.child.once("close", (code: number | null, signal: NodeJS.Signals | null) =>
        resolve({ code, signal }),
      );
      owned.child.once("error", reject);
    });
    ready = child.ready;
    binding = installedTransactionBinding(ready, "bb13be5206c60f27477e320c7d82db2f53643355", {
      bytes: fixtureBytes,
    });
    expect(ready.runtimeConfigurationIdentity).toBe(
      "73bdc0e24d65a8ab4444c5698b84d368a39cdcbbe2caad3ef7d913a317b1930b",
    );
    expect(ready.payloadIdentity).toBe(
      "34e0966cfd3cb5b8d0cb1d8c685418fadf45dda6bacdca839aa03bb8093ce258",
    );
    const address = new URL(ready.listenUrl),
      token = roles.find((r) => r.ref === "operator")?.token;
    if (!token) throw Error("operator missing");
    let position = "pos-0",
      epoch: string | undefined,
      view: string | undefined;
    async function exchange(target: string, body?: unknown, key?: string) {
      if (wires.length >= 30) throw Error("thirty requests per finite case");
      const url = new URL(target, scope).href;
      if (!url.startsWith(scope) || new URL(url).hash)
        throw Error("captured local target required");
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
        method = bytes ? ("POST" as const) : ("GET" as const);
      if (bytes && !key) throw Error("mutation key required");
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
            defaultCredentialRef: "operator",
            credentialHandles: [{ id: "operator", headerNames: ["authorization"] }],
            resolveCredentials: () => ({ authorization: `Bearer ${token}` }),
          },
        },
      );
      const request = {
        method,
        url,
        signal: controller.signal,
        credentialRef: "operator",
        raw: {
          headerLines: bytes
            ? [
                { name: "content-type", value: "application/json" },
                { name: "idempotency-key", value: key as string },
              ]
            : [],
          ...(bytes ? { bodyBytes: bytes } : {}),
        },
      };
      const wire = await execute(request);
      wires.push({
        method,
        url,
        requestBody: body ?? null,
        key: key ?? null,
        status: wire.status,
        headers: wire.headers,
        bodyText: wire.bodyText,
        wireBase64: Buffer.from(wire.wireResponseBytes ?? []).toString("base64"),
        requestBodySha256: bytes ? sha(bytes) : null,
        requestWriteState: wire.exactRequest?.writeState,
        actualSafeHeaders: wire.exactRequest?.headerLines.filter(
          (h) => h.name.toLowerCase() !== "authorization",
        ),
      });
      expect(wire.exactRequest?.writeState).toBe("complete");
      expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
      for (const n of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
        expect(wire.headers[n]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
      epoch ??= wire.headers["bdp-scope-epoch"];
      view ??= wire.headers["bdp-authorization-view"];
      expect(wire.headers["bdp-scope-epoch"]).toBe(epoch);
      expect(wire.headers["bdp-authorization-view"]).toBe(view);
      expect(wire.headers["bdp-scope-position"]).toBe(position);
      return { wire, value: wire.bodyText ? JSON.parse(wire.bodyText) : undefined };
    }
    await run({
      exchange,
      batch: (operations: unknown[], key: string) =>
        exchange("operations/batch", { operations }, key),
      position: (p: string) => {
        position = p;
      },
      results,
    });
  } catch (error) {
    errors.push(error);
  }
  clearTimeout(timer);
  if (child) {
    try {
      await child.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      if (!closed) throw Error("native close observer absent");
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      let end: any;
      try {
        end = await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            closeTimer = setTimeout(() => {
              child?.child.kill("SIGKILL");
              void closed?.then(() => reject(Error("native close10s bound")), reject);
            }, 10000);
          }),
        ]);
      } finally {
        clearTimeout(closeTimer);
      }
      let pidAbsent = false;
      try {
        process.kill(child.child.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        pidAbsent = true;
      }
      terminal = {
        pid: child.child.pid,
        ...end,
        stdoutEOF: child.child.stdout.readableEnded,
        stderrEOF: child.child.stderr.readableEnded,
        reaped: true,
        pidAbsent,
      };
      expect(terminal).toMatchObject({
        code: 0,
        signal: null,
        stdoutEOF: true,
        stderrEOF: true,
        reaped: true,
        pidAbsent: true,
      });
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
      removed = true;
    }
  } catch (error) {
    errors.push(error);
  }
  const text =
    JSON.stringify(
      {
        case: name,
        passed: errors.length === 0,
        source: "bb13be5206c60f27477e320c7d82db2f53643355",
        fixtureDigest: sha(fixtureBytes),
        fixtureArtifacts: fixture.artifacts,
        credentialBank: {
          bytes: (await readFile(bankPath)).length,
          sha256: sha(await readFile(bankPath)),
          private: true,
        },
        configuration: {
          scope,
          ordinary: true,
          managementControls: null,
          roles: roles.map(({ token: _token, ...role }) => role),
        },
        ready,
        binding,
        modules,
        wires,
        results,
        terminal,
        directory,
        removed,
        failures: errors.map((e) => inspect(e, { depth: 12 })),
        claimEligible: false,
      },
      null,
      2,
    ) + "\n";
  let nodes = 0;
  const count = (value: unknown, depth: number): void => {
    if (++nodes > 100000 || depth > 128) throw Error("original carrier node/depth bound");
    if (Array.isArray(value)) for (const child of value) count(child, depth + 1);
    else if (value !== null && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        count(key, depth + 1);
        count(child, depth + 1);
      }
  };
  if (Buffer.byteLength(text) > 4194304) throw Error("original4MiB carrier bound");
  count(JSON.parse(text), 0);
  for (const role of roles)
    if (text.includes(role.token)) throw Error("private credential evidence");
  await writeFile(path.join(output, `${name}.json`), text, { flag: "wx", mode: 0o600 });
  if (errors.length)
    throw new AggregateError(errors, "NEW ordinary TX semantic-labels case failed");
}
export function row(
  value: any,
  id: string,
  type: string,
  properties: unknown,
  extra: Record<string, unknown> = {},
) {
  expect(value.revision).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
  expect(value).toEqual({
    id: scope + id,
    type: scope + "types/" + type,
    revision: value.revision,
    properties,
    metadata: {},
    ...extra,
  });
  return value;
}
export function receipt(
  response: any,
  status: "completed" | "failed",
  position: string,
  key: string,
  effect?: string,
) {
  expect(response.wire.status).toBe(200);
  expect(validator.validate("#/$defs/mutationReceipt", response.value)).toEqual([]);
  expect(response.wire.headers["cache-control"]).toBe("private, no-store");
  expect(response.wire.headers.etag).toBeUndefined();
  expect(response.wire.headers["last-modified"]).toBeUndefined();
  expect(response.value).toMatchObject({
    status,
    detail: "available",
    requiredPosition: position,
    idempotencyKey: key,
  });
  if (effect === undefined) expect(response.value).not.toHaveProperty("effectPosition");
  else expect(response.value.effectPosition).toBe(effect);
  return response.value;
}
export async function feed(c: any) {
  const groups: any[] = [];
  let next: string | null = "changes/?after=genesis";
  for (let i = 0; next !== null; i++) {
    expect(i).toBeLessThan(8);
    const r: any = await c.exchange(next);
    expect(r.wire.status).toBe(200);
    expect(r.value.next === null || typeof r.value.next === "string").toBe(true);
    groups.push(...r.value.groups);
    next = r.value.next;
  }
  return groups;
}
