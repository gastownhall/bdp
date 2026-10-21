/** NEW finite retained receipt management slice; genuine existing policy/clock child. */
import { createHash } from "node:crypto";
import { readFile, readdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { expect } from "vitest";
import { createRawHttpExchangeExecutor, createJsonSchemaValidator } from "@bdp/conformance";
import schema from "../../../schemas/bdp-v0.schema.json" with { type: "json" };
import { launchCumulativeManagement } from "./transactional-cumulative-management-product-launch.js";
export const installed = process.env.BDP_TX_RETAINED_INSTALLED;
export const scope = "https://reference.invalid/acme/";
export const validator = createJsonSchemaValidator(schema);
const sha = (raw: Uint8Array) => createHash("sha256").update(raw).digest("hex");
const fixtureBytes = await readFile(
  new URL("./transactional-cumulative-management-product-fixture.json", import.meta.url),
);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
export async function withRetained(name: string, run: (c: any) => Promise<void>) {
  const output = process.env.BDP_TX_RETAINED_EVIDENCE,
    bankPath = process.env.BDP_TX_RETAINED_CREDENTIALS,
    bindingPath = process.env.BDP_TX_RETAINED_SUBJECT_BINDING;
  if (!installed || !output || !bankPath || !bindingPath)
    throw Error("exact installed/bank/binding/output required");
  const errors: unknown[] = [],
    wires: unknown[] = [],
    controls: unknown[] = [],
    results: Record<string, unknown> = {};
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(Error("unchanged90s retained bound")), 90000);
  let directory: string | undefined,
    child: ReturnType<typeof launchCumulativeManagement> | undefined,
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
    directory = await mkdtemp(path.join(tmpdir(), `bdp-tx-retained-${name}-`));
    child = launchCumulativeManagement(path.join(installed, "transaction-installed-process.js"), {
      scope,
      directory,
      create: true,
      credentials: roles.map(({ token, principal, canMutate }) => ({
        token,
        principal,
        canMutate,
      })),
      artifacts: fixture.artifacts,
    });
    const owned = child;
    closed = new Promise((resolve, reject) => {
      owned.child.once("close", (code: number | null, signal: NodeJS.Signals | null) =>
        resolve({ code, signal }),
      );
      owned.child.once("error", reject);
    });
    ready = await child.ready;
    function checkReady(v: any) {
      expect(v.ordinaryDeployment).toBe(false);
      expect(v.ordinaryConfigurationMetadataAvailable).toBe(false);
      expect(v.claimEligible).toBe(false);
      expect(v.payloadIdentity).toBe(
        "cf800588db0c63b26c33647717eb44330647d4958fa7b8c6b3b23c0b82495e11",
      );
      expect(v.facadeKeys).toEqual([
        "close",
        "configurationMetadata",
        "listenUrl",
        "replaceAuthorizationPolicy",
        "scope",
        "targets",
      ]);
      expect(v.selectedSeams).toEqual([
        "trusted-clock",
        "same-facade-private-administration",
        "existing-empty-policy-replacement",
        "offline-native-backup-restore",
      ]);
    }
    expect(ready.event).toBe("management.ready");
    checkReady(ready);
    binding = {
      ordinaryDeployment: false,
      ordinaryRuntimeConfigurationIdentity: null,
      fixtureDigest: sha(fixtureBytes),
      payloadIdentity: ready.payloadIdentity,
      selectedControl:
        "ONE existing empty-policy transition; trustedclock fixed1000000,no advance/admin/restore executed",
    };
    let address = new URL(ready.listenUrl),
      token = roles.find((r) => r.ref === "operator")?.token;
    if (!token) throw Error("operator missing");
    let position = "pos-0",
      epoch: string | undefined,
      view: string | undefined;
    async function exchange(
      target: string,
      body?: unknown,
      key?: string,
      options: { method?: "GET" | "HEAD" | "POST"; minimum?: Record<string, string> } = {},
    ) {
      if (wires.length >= 30) throw Error("thirty requests per finite case");
      const url = new URL(target, scope).href;
      if (!url.startsWith(scope) || new URL(url).hash)
        throw Error("captured local target required");
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
        method = options.method ?? (bytes ? ("POST" as const) : ("GET" as const));
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
          headerLines: [
            ...(bytes
              ? [
                  { name: "content-type", value: "application/json" },
                  { name: "idempotency-key", value: key as string },
                ]
              : []),
            ...Object.entries(options.minimum ?? {}).map(([name, value]) => ({ name, value })),
          ],
          ...(bytes ? { bodyBytes: bytes } : {}),
        },
      };
      const wire = await execute(request);
      wires.push({
        method,
        url,
        requestBody: body ?? null,
        minimum: options.minimum ?? {},
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
      newView() {
        view = undefined;
      },
      async control() {
        const answer = await owned.control({ command: "empty-policy" });
        controls.push(answer);
        expect(answer.event).toBe("management.done");
        expect(answer.command).toBe("empty-policy");
        checkReady(answer.ready);
        ready = answer.ready;
        address = new URL(String(ready.listenUrl));
        return answer;
      },
    });
  } catch (error) {
    errors.push(error);
  }
  clearTimeout(timer);
  if (child) {
    try {
      results.nativeLauncherTerminal = await child.close();
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
      const pid = child.child.pid;
      if (typeof pid !== "number") throw Error("native PID unavailable");
      let pidAbsent = false;
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        pidAbsent = true;
      }
      terminal = {
        pid: child.child.pid,
        ...end,
        stdoutEOF: child.child.stdout?.readableEnded,
        stderrEOF: child.child.stderr?.readableEnded,
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
        source: "5f3a67e89d62a0dcb4e9a7b9a6cb78b2c0a3e50c",
        fixtureDigest: sha(fixtureBytes),
        fixtureArtifacts: fixture.artifacts,
        credentialBank: {
          bytes: (await readFile(bankPath)).length,
          sha256: sha(await readFile(bankPath)),
          private: true,
        },
        configuration: {
          scope,
          ordinary: false,
          ordinaryRuntimeConfigurationIdentity: null,
          managementControls:
            "existing233 clock/policy/admin child; only empty-policy command executed",
          roles: roles.map(({ token: _token, ...role }) => role),
        },
        ready,
        controls,
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
  for (const role of roles)
    if (text.includes(role.token)) throw Error("private credential evidence");
  await writeFile(path.join(output, `${name}.json`), text, { flag: "wx", mode: 0o600 });
  if (errors.length)
    throw new AggregateError(errors, "NEW private-management retained case failed");
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
