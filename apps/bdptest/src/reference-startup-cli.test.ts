/** New ordinary CLI/config observations; no old qualification pipeline invocation. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const entry =
  process.env.BDP_REFERENCE_STARTUP_TEST_ENTRY ?? path.join(root, "apps/bdptest/dist/main.js");

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("missing discovered fixture value");
  return value;
}

async function port() {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("missing fixture listener");
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function fixture(profile: "read-update" | "transactional") {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-product-startup-"));
  const p = await port(),
    scope = `http://127.0.0.1:${p}/acme/`;
  const token = randomBytes(32).toString("base64url");
  const store = path.join(directory, "store");
  if (profile === "transactional") await mkdir(store, { mode: 0o700 });
  const artifacts = {
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
  };
  const configuration =
    profile === "transactional"
      ? {
          directory: store,
          create: true,
          credentials: [{ token, principal: "writer", canMutate: true }],
          artifacts,
        }
      : {
          directory: store,
          create: true,
          credentials: [{ token, principal: "writer" }],
          policies: { writer: { create: true, write: true, hidden: [], readOnly: [] } },
          contracts: artifacts,
          maximumEndpointMultiplicity: [],
        };
  const deploymentFile = path.join(directory, "deployment.json");
  await writeFile(
    deploymentFile,
    JSON.stringify({ format: "bdptest-reference-deployment-1", profile, configuration }),
    { mode: 0o600 },
  );
  const config = {
    scope: { url: scope },
    server: {
      host: "127.0.0.1",
      port: p,
      advertisedProfile: profile,
      limits: {
        page:
          profile === "transactional"
            ? { defaultItems: 2, maximumItems: 32 }
            : { defaultItems: 20, maximumItems: 100 },
        selector: { bytes: 4096, depth: 32, nodes: 256 },
        cursorTtlMilliseconds: profile === "transactional" ? 1000 : 60000,
      },
    },
    bdptest: { deploymentFile },
  };
  const configFile = path.join(directory, "startup.json");
  await writeFile(configFile, JSON.stringify(config));
  return { directory, scope, token, config, configFile, deploymentFile };
}

function launch(configFile: string, serve = true) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("BDP_")),
  );
  const child = spawn(
    process.execPath,
    [entry, ...(serve ? ["--serve"] : []), "--config", configFile],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const output: string[] = ["", ""];
  let overflow = false;
  [child.stdout, child.stderr].forEach((stream, i) => {
    stream.on("data", (data) => {
      output[i] += data.toString("utf8");
      if (Buffer.byteLength(required(output[i])) > 65536) {
        overflow = true;
        child.kill("SIGKILL");
      }
    });
  });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 10000);
  void done.finally(() => clearTimeout(watchdog));
  async function waitFor(event: string) {
    const until = performance.now() + 8000;
    while (performance.now() < until) {
      for (const line of required(output[1]).split("\n").filter(Boolean)) {
        const value = JSON.parse(line);
        if (value.event === event) return value;
      }
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`CLI exited before ${event}: ${output[1]}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`CLI readiness deadline for ${event}`);
  }
  async function close() {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const result = await done;
    expect(overflow).toBe(false);
    return result;
  }
  return { child, done, output, waitFor, close };
}

for (const profile of ["read-update", "transactional"] as const) {
  it(`ordinary CLI starts configured ${profile}, cold-discovers and mutates over HTTP`, async () => {
    const f = await fixture(profile);
    const child = launch(f.configFile);
    try {
      const ready = await child.waitFor("server.started");
      expect(ready).toMatchObject({
        profile,
        scope: f.scope,
        claimEligible: false,
        history: false,
      });
      const exchange = async (url: string, init?: RequestInit) => {
        if (!url.startsWith(f.scope)) throw new Error("discovered URL escaped fixture Scope");
        return fetch(url, {
          ...init,
          signal: AbortSignal.timeout(3000),
          redirect: "manual",
          headers: { authorization: `Bearer ${f.token}`, ...init?.headers },
        });
      };
      const probe = await exchange(f.scope);
      expect(probe.status).toBe(204);
      const link = /^<([^>]+)>; rel="service-desc"; type="application\/json"$/.exec(
        probe.headers.get("link") ?? "",
      );
      expect(link).not.toBeNull();
      const descriptorUrl = new URL(required(required(link)[1]), f.scope).href;
      const discoveryResponse = await exchange(descriptorUrl);
      expect(discoveryResponse.status).toBe(200);
      const discovery = (await discoveryResponse.json()) as Record<string, string>;
      expect(discovery.profile).toBe(profile);
      const directoryUrl = new URL(required(discovery.operations), descriptorUrl).href;
      const directoryResponse = await exchange(directoryUrl);
      expect(directoryResponse.status).toBe(200);
      const operations = (await directoryResponse.json()) as Record<string, string>;
      const typesResponse = await exchange(new URL(required(discovery.types), descriptorUrl).href);
      expect(typesResponse.status).toBe(200);
      const types = (await typesResponse.json()) as { items: { id: string; describes: string }[] };
      const bead = types.items.find((item) => item.describes === "bead");
      expect(bead).toBeDefined();
      const resourceUrl = new URL("new", new URL(required(discovery.beads), descriptorUrl)).href;
      const command = {
        body: { id: resourceUrl, type: required(bead).id, properties: { n: 7 } },
        key: "ordinary-create",
      };
      const mutation = await exchange(new URL(required(operations.createBead), directoryUrl).href, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": command.key },
        body: JSON.stringify(command.body),
      });
      expect(mutation.status, await mutation.text()).toBe(200);
      const record = await exchange(resourceUrl);
      expect(record.status).toBe(200);
      expect(await record.json()).toMatchObject({ properties: { n: 7 } });
      expect(child.output[1]).not.toContain(f.token);
    } finally {
      const stopped = await child.close();
      await rm(f.directory, { recursive: true, force: true });
      expect(stopped).toEqual({ code: 0, signal: null });
    }
  }, 20000);
}

it("ordinary startup refuses a missing deployment without exposing credentials or binding", async () => {
  const f = await fixture("transactional");
  await rm(f.deploymentFile);
  const child = launch(f.configFile);
  try {
    expect(await child.done).toEqual({ code: 2, signal: null });
    expect(child.output[1]).toContain('"event":"startup.reference_refused"');
    expect(child.output[1]).not.toContain('"event":"server.started"');
    expect(child.output[1]).not.toContain(f.token);
  } finally {
    await child.close();
    await rm(f.directory, { recursive: true, force: true });
  }
}, 15000);

it("no-serve lifecycle does not open the configured deployment", async () => {
  const f = await fixture("transactional");
  await rm(f.deploymentFile);
  const child = launch(f.configFile, false);
  try {
    await child.waitFor("lifecycle.started");
    expect(child.output[1]).not.toContain("reference_refused");
  } finally {
    const stopped = await child.close();
    await rm(f.directory, { recursive: true, force: true });
    expect(stopped).toEqual({ code: 0, signal: null });
  }
}, 15000);
