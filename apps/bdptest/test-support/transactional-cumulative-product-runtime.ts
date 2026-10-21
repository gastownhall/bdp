/** Composition of existing installed launcher/binding/raw transport; no target emulation. */
import { createHash } from "node:crypto";
import { readFile, readdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { expect } from "vitest";
import { createRawHttpExchangeExecutor } from "@bdp/conformance";
import type {
  ConformanceArtifactBundle,
  ExactHttpExchangeRequest,
  HttpExchangeResponse,
} from "@bdp/conformance";
import { assertSameServedProfileConfiguration } from "@bdp/conformance/testing";
import { installedTransactionBinding } from "./transactional-execution-binding.js";
const { launchInstalledTransaction } = await import(
  new URL("../../../scripts/transaction-installed-observation.mjs", import.meta.url).href
);
export const productEntry = process.env.BDP_CUMULATIVE_PRODUCT_ENTRY;
export const productScope = "https://reference.invalid/acme/";
export const productSource = process.env.BDP_CUMULATIVE_PRODUCT_SOURCE;
export const productFixtureSource = {
  bytes: await readFile(
    new URL("./transactional-cumulative-product-fixture.json", import.meta.url),
  ),
};
export const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
type Role = { ref: string; principal: string; canMutate: boolean; token: string };
export type Campaign = {
  fixtureSource: typeof productFixtureSource;
  directory: string;
  signal: AbortSignal;
  baseline: ReturnType<typeof installedTransactionBinding>;
  roles: readonly Readonly<Role>[];
  launch(
    scenario: string,
    reopen: boolean,
    signal: AbortSignal,
  ): ReturnType<typeof launchInstalledTransaction>;
  observe(
    scenario: string,
    request: ExactHttpExchangeRequest,
    response: HttpExchangeResponse,
  ): void;
  results: Record<string, unknown>;
};
/** Fixed bank belongs to the WHOLE invocation, never minted by a scenario callback. */
export async function withProductCampaign(
  name: string,
  bundle: ConformanceArtifactBundle,
  run: (c: Campaign) => Promise<void>,
) {
  const entry = productEntry,
    source = productSource,
    build = process.env.BDP_CUMULATIVE_PRODUCT_BUILD,
    output = process.env.BDP_CUMULATIVE_PRODUCT_OUTPUT,
    bankPath = process.env.BDP_CUMULATIVE_PRODUCT_CREDENTIALS;
  if (!entry || !source || !build || !output || !bankPath)
    throw Error("explicit packed/source/build/output/private credential bank required");
  const fixture = bundle.fixture;
  const bankBytes = await readFile(bankPath),
    rawBank: unknown = JSON.parse(bankBytes.toString("utf8"));
  if (!Array.isArray(rawBank) || rawBank.length !== 5)
    throw Error("invalid private credential bank");
  const roles: readonly Readonly<Role>[] = Object.freeze(
    rawBank.map((row: Role) => {
      if (
        !row ||
        typeof row !== "object" ||
        Object.keys(row).sort().join(",") !== "canMutate,principal,ref,token" ||
        typeof row.ref !== "string" ||
        typeof row.principal !== "string" ||
        typeof row.canMutate !== "boolean" ||
        typeof row.token !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(row.token)
      )
        throw Error("invalid private credential row");
      return Object.freeze({ ...row });
    }),
  );
  expect(roles.map(({ ref, principal, canMutate }) => ({ ref, principal, canMutate }))).toEqual([
    { ref: "operator", principal: "same", canMutate: true },
    { ref: "reader", principal: "same", canMutate: false },
    { ref: "principal-a", principal: "principal-a", canMutate: true },
    { ref: "principal-a-rotated", principal: "principal-a", canMutate: true },
    { ref: "principal-b", principal: "principal-b", canMutate: true },
  ]);
  if (new Set(roles.map((r) => r.token)).size !== roles.length)
    throw Error("credential bank contains duplicate credentials");
  const modules = [];
  for (const file of (await readdir(build)).filter((n) => n.endsWith(".js")).sort()) {
    const b = await readFile(path.join(path.dirname(entry), file));
    expect(b.equals(await readFile(path.join(build, file))), file).toBe(true);
    modules.push({ file, bytes: b.length, sha256: sha(b) });
  }
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const schema = await readFile(
    path.join(path.dirname(entry), "../../protocol/schemas/bdp-v0.schema.json"),
  );
  expect(schema.equals(await readFile(path.join(root, "schemas/bdp-v0.schema.json")))).toBe(true);
  expect(sha(productFixtureSource.bytes)).toBe(bundle.digests.fixtureDigest);
  const failures: unknown[] = [],
    sessions: Record<string, unknown>[] = [],
    wires: unknown[] = [],
    results: Record<string, unknown> = {};
  const closes: Array<() => Promise<void>> = [];
  let directory: string | undefined,
    baseline: ReturnType<typeof installedTransactionBinding> | undefined,
    removed = false;
  const controller = new AbortController(),
    watchdog = setTimeout(
      () => controller.abort(Error("NEW cumulative product aggregate60s deadline")),
      60000,
    );
  try {
    directory = await mkdtemp(path.join(tmpdir(), "bdp-cumulative-product-"));
    const owned = directory;
    const launch: Campaign["launch"] = async (scenario, reopen, signal) => {
      if (!/^[a-z0-9.-]+$/.test(scenario)) throw Error("invalid source scenario directory");
      const configuration = {
        scope: productScope,
        directory: path.join(owned, scenario),
        create: !reopen,
        credentials: roles.map(({ token, principal, canMutate }) => ({
          token,
          principal,
          canMutate,
        })),
        artifacts: fixture.artifacts,
      };
      const child = await launchInstalledTransaction(entry, configuration, signal);
      const terminal = new Promise<Record<string, unknown>>((resolve) =>
        child.child.once("close", (code: number | null, signal: string | null) =>
          resolve({
            pid: child.child.pid,
            code,
            signal,
            stdoutEOF: child.child.stdout?.readableEnded,
            stderrEOF: child.child.stderr?.readableEnded,
          }),
        ),
      );
      let closing: Promise<void> | undefined;
      const close = () =>
        (closing ??= (async () => {
          const errors: unknown[] = [];
          let observed: Record<string, unknown> | undefined;
          try {
            await child.close();
          } catch (error) {
            errors.push(error);
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            observed = await Promise.race([
              terminal,
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(Error("cumulative child EOF deadline")), 10000);
              }),
            ]);
            let pidAbsent = false;
            const pid = child.child.pid;
            if (!Number.isSafeInteger(pid) || !pid) throw Error("actual native child PID absent");
            try {
              process.kill(pid, 0);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
              pidAbsent = true;
            }
            observed = { ...observed, reaped: true, pidAbsent };
            expect(observed).toMatchObject({
              code: 0,
              signal: null,
              stdoutEOF: true,
              stderrEOF: true,
              reaped: true,
              pidAbsent: true,
            });
          } catch (error) {
            errors.push(error);
          } finally {
            clearTimeout(timer);
          }
          sessions.push({
            scenario,
            reopen,
            terminal: observed,
            closeFailures: errors.map((error) => inspect(error, { depth: 6 })),
          });
          if (errors.length)
            throw new AggregateError(errors, "cumulative child close/drain failed");
        })());
      closes.push(close);
      try {
        const actual = installedTransactionBinding(child.ready, source, productFixtureSource);
        if (baseline) {
          assertSameServedProfileConfiguration(baseline.served, actual.served);
          expect(actual.runtimeConfigurationIdentity).toBe(baseline.runtimeConfigurationIdentity);
        } else baseline = actual;
        sessions.push({ scenario, reopen, ready: child.ready, binding: actual });
        return { ...child, close };
      } catch (error) {
        try {
          await close();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "binding and cleanup failed");
        }
        throw error;
      }
    };
    const bootstrap = await launch("bootstrap", false, controller.signal);
    await bootstrap.close();
    if (!baseline) throw Error("missing genuine bootstrap binding");
    await run({
      fixtureSource: productFixtureSource,
      directory,
      signal: controller.signal,
      baseline,
      roles,
      launch,
      results,
      observe(scenario, request, response) {
        wires.push({
          scenario,
          method: request.method,
          url: request.url,
          credentialRef: request.credentialRef ?? "operator",
          authoredHeaders: request.raw.headerLines,
          actualSafeHeaders: response.exactRequest?.headerLines.filter(
            (h) => h.name.toLowerCase() !== "authorization",
          ),
          requestBody:
            request.raw.bodyBytes === undefined
              ? undefined
              : Buffer.from(request.raw.bodyBytes).toString("utf8"),
          requestWriteState: response.exactRequest?.writeState,
          requestBodyDigest: response.exactRequest?.bodyDigest,
          status: response.status,
          headers: response.headers,
          bodyText: response.bodyText,
          wireBase64: Buffer.from(response.wireResponseBytes ?? []).toString("base64"),
        });
      },
    });
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(watchdog);
    for (const close of closes)
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    try {
      if (directory) {
        await rm(directory, { recursive: true, force: true });
        await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
        removed = true;
      }
    } catch (error) {
      failures.push(error);
    }
    try {
      await writeFile(
        path.join(output, `${name}-campaign.json`),
        JSON.stringify(
          {
            source,
            entry,
            fixtureDigest: bundle.digests.fixtureDigest,
            credentialBank: { bytes: bankBytes.length, sha256: sha(bankBytes), private: true },
            modules,
            schemaSHA256: sha(schema),
            baseline,
            sessions,
            directory,
            removed,
            wires,
            results,
            failures: failures.map((error) => inspect(error, { depth: 8 })),
            claimEligible: false,
            historical17Executed: false,
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
    throw new AggregateError(failures, "NEW cumulative campaign or finalization failed");
}

/** Existing raw executor bound to the SAME campaign bank and installed session. */
export async function productSession(c: Campaign, scenario: string) {
  let child = await c.launch(scenario, false, c.signal);
  let address = new URL(String(child.ready.listenUrl));
  const state: { position: string; epoch?: string; view?: string } = { position: "pos-0" };
  let requests = 0;
  async function exchange(
    target: string,
    body?: unknown,
    key?: string,
    options: {
      method?: "GET" | "HEAD" | "POST" | "OPTIONS";
      role?: string;
      headers?: Array<{ name: string; value: string }>;
    } = {},
  ) {
    expect(++requests).toBeLessThanOrEqual(200);
    const method = options.method ?? (body === undefined ? "GET" : "POST"),
      url = new URL(target, productScope).href;
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const role = options.role ?? "operator";
    const execute = createRawHttpExchangeExecutor(
      { transport: "plain", host: address.hostname, port: Number(address.port) },
      {
        requestTimeoutMs: 5000,
        maximumBodyBytes: 1048576,
        exactMode: {
          scope: productScope,
          profile: "transactional",
          routes: [{ method, url }],
          maximumRequestHeaderBytes: 16384,
          maximumRequestBodyBytes: 65536,
          defaultCredentialRef: "operator",
          credentialHandles: [
            ...c.roles.map((r) => ({ id: r.ref, headerNames: ["authorization"] })),
            { id: "anonymous", headerNames: [] },
          ],
          resolveCredentials: ({ credentialRef }) => {
            if (credentialRef === "anonymous") return {};
            const r = c.roles.find((r) => r.ref === credentialRef);
            if (!r) throw Error("unknown campaign role");
            return { authorization: `Bearer ${r.token}` };
          },
        },
      },
    );
    const request: ExactHttpExchangeRequest = {
      method,
      url,
      signal: c.signal,
      credentialRef: role,
      raw: {
        headerLines: [
          ...(raw === undefined
            ? []
            : [
                { name: "Content-Type", value: "application/json" },
                { name: "Idempotency-Key", value: key! },
              ]),
          ...(options.headers ?? []),
        ],
        ...(raw === undefined ? {} : { bodyBytes: Buffer.from(raw) }),
      },
    };
    const wire = await execute(request);
    c.observe(scenario, request, wire);
    expect(wire.exactRequest?.writeState).toBe("complete");
    expect(wire.wireResponseBytes?.length).toBeGreaterThan(0);
    for (const name of ["bdp-scope-epoch", "bdp-authorization-view", "bdp-scope-position"])
      expect(wire.headers[name]).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    state.epoch ??= wire.headers["bdp-scope-epoch"]!;
    state.view ??= wire.headers["bdp-authorization-view"]!;
    expect(wire.headers["bdp-scope-epoch"]).toBe(state.epoch);
    expect(wire.headers["bdp-authorization-view"]).toBe(state.view);
    expect(wire.headers["bdp-scope-position"]).toBe(state.position);
    return { wire, value: wire.bodyText === "" ? undefined : JSON.parse(wire.bodyText) };
  }
  return {
    exchange,
    batch: (operations: unknown[], key: string) =>
      exchange("operations/batch", { operations }, key),
    position(value: string) {
      state.position = value;
    },
    close: () => child.close(),
    async reopen() {
      await child.close();
      child = await c.launch(scenario, true, c.signal);
      address = new URL(String(child.ready.listenUrl));
    },
  };
}
