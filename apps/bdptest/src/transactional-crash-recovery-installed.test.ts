/** NEW installed HTTP crash cohort; no store call substitutes for a public mutation/read. */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { CrashPhase } from "../test-support/crash-recovery-store.js";

const installed = process.env.BDP_CRASH_INSTALLED_SERVER;
const evidence = process.env.BDP_CRASH_EVIDENCE;
const childEntry = fileURLToPath(
  new URL("../test-support/crash-recovery-child.ts", import.meta.url),
);
type RecordValue = Record<string, unknown>;
async function installedBindings() {
  if (!installed) throw new Error("missing installed server directory");
  const emitted = fileURLToPath(new URL("../../../packages/server/dist/", import.meta.url));
  const names = (await readdir(emitted, { recursive: true }))
    .filter((name) => name.endsWith(".js"))
    .sort();
  expect(names.length).toBeGreaterThan(0);
  const bindings = [];
  for (const name of names) {
    const expected = await readFile(path.join(emitted, name));
    const actual = await readFile(path.join(installed, name));
    expect(actual.equals(expected), `installed module differs: ${name}`).toBe(true);
    bindings.push({
      name,
      bytes: actual.length,
      sha256: createHash("sha256").update(actual).digest("hex"),
    });
  }
  return bindings;
}
async function port() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  return address.port;
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-installed-crash-"));
  const p = await port(),
    scope = `http://127.0.0.1:${p}/acme/`;
  const token = randomBytes(32).toString("base64url");
  const store = path.join(directory, "store");
  await mkdir(store, { mode: 0o700 });
  const deploymentFile = path.join(directory, "deployment.json");
  const deployment = {
    format: "bdptest-reference-deployment-1",
    profile: "transactional",
    configuration: {
      directory: store,
      create: true,
      credentials: [{ token, principal: "writer", canMutate: true }],
      artifacts: {
        descriptors: [
          {
            retrievalUri: `${scope}types/bead`,
            utf8: JSON.stringify({
              id: `${scope}types/bead`,
              name: "Bead",
              describes: "bead",
              conformsTo: [],
              propertiesSchema: `${scope}schemas/n`,
            }),
          },
        ],
        schemas: [
          {
            retrievalUri: `${scope}schemas/n`,
            utf8: JSON.stringify({
              $id: `${scope}schemas/n`,
              type: "object",
              properties: { n: { type: "integer" } },
              additionalProperties: false,
            }),
          },
        ],
      },
    },
  };
  await writeFile(deploymentFile, JSON.stringify(deployment), { mode: 0o600 });
  const configuration = {
    deploymentFile,
    scope: { url: scope },
    server: {
      host: "127.0.0.1",
      port: p,
      advertisedProfile: "transactional",
      limits: {
        page: { defaultItems: 2, maximumItems: 32 },
        selector: { bytes: 4096, depth: 32, nodes: 256 },
        cursorTtlMilliseconds: 1000,
      },
    },
  };
  const exchanges: unknown[] = [];
  async function exchange(url: string, init?: RequestInit) {
    if (!url.startsWith(scope)) throw new Error("request escaped fixture");
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(3000),
      redirect: "manual",
      headers: { authorization: `Bearer ${token}`, ...init?.headers },
    });
    const text = await response.text();
    const observation = {
      url,
      method: init?.method ?? "GET",
      status: response.status,
      headers: Object.fromEntries(response.headers),
      text,
    };
    exchanges.push(observation);
    return { ...observation, body: text ? (JSON.parse(text) as RecordValue) : undefined };
  }
  return {
    directory,
    scope,
    token,
    deployment,
    deploymentFile,
    configuration,
    exchange,
    exchanges,
  };
}
function launch(configuration: unknown, phase: string) {
  if (!installed)
    throw new Error("BDP_CRASH_INSTALLED_SERVER must name offline-installed server/dist");
  const child = spawn(process.execPath, [childEntry], {
    cwd: "/tmp",
    stdio: ["ignore", "pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      BDP_CRASH_CONFIGURATION: JSON.stringify(configuration),
      BDP_CRASH_PHASE: phase,
    },
  });
  const raw = ["", "", ""];
  const records: RecordValue[] = [];
  let pending = "",
    overflow = false,
    total = 0;
  for (const [index, stream] of [child.stdout, child.stderr, child.stdio[3]].entries()) {
    if (!stream || !("setEncoding" in stream)) throw new Error("missing fixture pipe");
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      total += Buffer.byteLength(chunk);
      if (total > 65536) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      raw[index] += chunk;
      if (index === 2) {
        pending += chunk;
        let at = pending.indexOf("\n");
        while (at >= 0) {
          records.push(JSON.parse(pending.slice(0, at)) as RecordValue);
          pending = pending.slice(at + 1);
          at = pending.indexOf("\n");
        }
      }
    });
  }
  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 15000);
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        clearTimeout(watchdog);
        resolve({ code, signal });
      });
    },
  );
  async function wait(event: string) {
    for (let i = 0; i < 500; i++) {
      const found = records.find((r) => r.event === event);
      if (found) return found;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`child exited before ${event}: ${raw.join("")}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`deadline waiting for ${event}`);
  }
  async function stop(signal: NodeJS.Signals) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    const terminal = await done;
    expect(overflow).toBe(false);
    expect(timedOut).toBe(false);
    expect(pending).toBe("");
    return {
      ...terminal,
      stdout: raw[0],
      stderr: raw[1],
      control: raw[2],
      records,
      overflow,
      timedOut,
      eof: true,
      reaped: true,
    };
  }
  return { child, wait, stop };
}

for (const phase of ["after-admission", "after-commit"] as const satisfies readonly CrashPhase[]) {
  it.skipIf(!installed)(
    `installed HTTP ${phase} SIGKILL recovers without a second effect`,
    async () => {
      const bindings = await installedBindings();
      const f = await fixture();
      const runs: unknown[] = [];
      let active: ReturnType<typeof launch> | undefined;
      try {
        active = launch(f.configuration, phase);
        expect(await active.wait("ready")).toMatchObject({ scope: f.scope, claimEligible: false });
        const probe = await f.exchange(f.scope);
        expect(probe.status).toBe(204);
        const link = /^<([^>]+)>; rel="service-desc"; type="application\/json"$/.exec(
          probe.headers.link ?? "",
        );
        if (!link?.[1]) throw new Error("missing service description");
        const descriptorUrl = new URL(link[1], f.scope).href;
        const descriptor = (await f.exchange(descriptorUrl)).body;
        if (!descriptor || typeof descriptor.operations !== "string")
          throw new Error("missing operations");
        const directoryUrl = new URL(descriptor.operations, descriptorUrl).href;
        const operations = (await f.exchange(directoryUrl)).body;
        if (!operations || typeof operations.createBead !== "string")
          throw new Error("missing createBead");
        const target = new URL(operations.createBead, directoryUrl).href;
        const resource = `${f.scope}beads/one`;
        const payload = JSON.stringify({
          id: resource,
          type: `${f.scope}types/bead`,
          properties: { n: 7 },
        });
        const request = {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": "crash-key" },
          body: payload,
        };
        const original = f.exchange(target, request).then(
          (value) => ({ completed: true as const, value }),
          (error: unknown) => ({ completed: false as const, error: String(error) }),
        );
        const parked = await active.wait("parked");
        expect(parked.phase).toBe(phase);
        const killed = await active.stop("SIGKILL");
        runs.push({ phase, ...killed });
        active = undefined;
        expect(killed).toMatchObject({ code: null, signal: "SIGKILL" });
        expect(killed.records.filter((r) => r.event === "binding")).toHaveLength(1);
        expect(await original).toMatchObject({ completed: false });
        f.deployment.configuration.create = false;
        await writeFile(f.deploymentFile, JSON.stringify(f.deployment), { mode: 0o600 });
        const began = performance.now();
        active = launch(f.configuration, "none");
        await active.wait("ready");
        const recoveryMilliseconds = performance.now() - began;
        expect(recoveryMilliseconds).toBeLessThan(5000);

        const before = await f.exchange(resource);
        expect(before.status).toBe(phase === "after-admission" ? 404 : 200);
        expect(before.headers["bdp-scope-position"]).toBe(
          phase === "after-admission" ? "pos-0" : "pos-1",
        );
        if (phase === "after-admission") {
          const pending = parked.observation as RecordValue;
          expect(pending.status).toBe("pending");
          if (typeof pending.id !== "string") throw new Error("missing actual pending receipt URI");
          expect((await f.exchange(pending.id)).status).toBe(404);
        }
        const retry = await f.exchange(target, request);
        expect(retry.status).toBe(200);
        expect(retry.body?.status).toBe("completed");
        expect(retry.body?.effectPosition).toBe("pos-1");
        if (phase === "after-admission")
          expect(retry.body?.id).not.toBe((parked.observation as RecordValue).id);
        if (phase === "after-commit")
          expect(retry.body).toEqual((parked.observation as RecordValue).receipt);
        const after = await f.exchange(resource);
        expect(after.status).toBe(200);
        expect(after.body).toMatchObject({ properties: { n: 7 } });
        const replay = await f.exchange(target, request);
        expect(replay.status).toBe(200);
        expect(replay.body).toEqual(retry.body);
        const final = await f.exchange(resource);
        expect(final.body).toEqual(after.body);
        expect(final.headers["bdp-scope-position"]).toBe(after.headers["bdp-scope-position"]);
        const stopped = await active.stop("SIGTERM");
        runs.push({ phase: "reopen", ...stopped });
        active = undefined;
        expect(stopped).toMatchObject({ code: 0, signal: null });
        expect(
          stopped.records.some((r) => r.event === "binding" || r.event === "owner-opened"),
        ).toBe(false);
        if (evidence)
          await writeFile(
            path.join(evidence, `${phase}.json`),
            JSON.stringify(
              {
                phase,
                bindings,
                installed,
                configuration: f.configuration,
                deployment: {
                  ...f.deployment,
                  configuration: f.deployment.configuration,
                },
                payload,
                requestKey: "crash-key",
                parked,
                recoveryMilliseconds,
                runs,
                exchanges: f.exchanges,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
      } finally {
        if (active) runs.push(await active.stop("SIGKILL"));
        if (evidence)
          await writeFile(
            path.join(evidence, `${phase}-cleanup.json`),
            JSON.stringify({ runs, exchanges: f.exchanges }, null, 2),
            { mode: 0o600 },
          );
        await rm(f.directory, { recursive: true, force: true });
      }
    },
    20000,
  );
}
