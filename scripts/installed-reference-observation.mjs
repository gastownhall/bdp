/** Same bounded real-process observations for emitted and packed/installed bytes.
 * No store mutation or scheduler/control API. Not a conformance artifact. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, createConnection } from "node:net";
import { request } from "node:http";
import { once } from "node:events";
import path from "node:path";
export async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  return port;
}
export async function launchInstalledReference(entry, configuration) {
  const child = spawn(process.execPath, [entry], {
    cwd: "/tmp",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => {
    stdout += b;
    if (stdout.length > 65536) child.kill("SIGKILL");
  });
  child.stderr.on("data", (b) => {
    stderr += b;
    if (stderr.length > 65536) child.kill("SIGKILL");
  });
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const bounded = async (promise) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            child.kill("SIGKILL");
            reject(Error("installed child deadline"));
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const ready = await bounded(
      new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("message", resolve);
        void exited.then(() => reject(Error(`installed child exited: ${stderr}`)));
        child.send({ configuration });
      }),
    );
    assert.equal(ready.event, "qualification.ready");
    assert.equal(ready.claimEligible, false);
    assert.match(ready.configurationIdentity, /^[a-f0-9]{64}$/);
    assert.match(ready.payloadIdentity, /^[a-f0-9]{64}$/);
    assert.match(ready.artifactIdentity, /^development-schema5-[a-f0-9]{64}$/);
    assert.match(ready.policyIdentity, /^[a-f0-9]{64}$/);
    assert.match(ready.authenticationIdentity, /^[a-f0-9]{64}$/);
    assert.equal(ready.profile, "read-update");
    assert.equal(ready.history, false);
    return {
      child,
      ready,
      exited,
      wait: () => bounded(exited),
      output: () => ({ stdout, stderr }),
      close: async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        return bounded(exited);
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    await bounded(exited);
    throw error;
  }
}
export function referenceConfiguration(
  directory,
  port,
  token,
  scope = "https://reference.invalid/acme/",
) {
  return {
    scope,
    listener: { host: "127.0.0.1", port },
    directory,
    create: true,
    credentials: [{ token, principal: "operator" }],
    policies: { operator: { create: true, write: true, hidden: [], readOnly: [] } },
    contracts: { descriptors: [], schemas: [] },
    maximumEndpointMultiplicity: [],
  };
}
export function requestInstalled(config, token, target, method = "GET", value, key, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = value === undefined ? undefined : JSON.stringify(value);
    const incoming = request(
      {
        hostname: config.listener.host,
        port: config.listener.port,
        path: target,
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined
            ? {}
            : { "content-type": "application/json", "content-length": Buffer.byteLength(body) }),
          ...(key === undefined ? {} : { "idempotency-key": key }),
          ...headers,
        },
        timeout: 5000,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (b) => {
          text += b;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
            value: text ? JSON.parse(text) : undefined,
          }),
        );
        response.on("error", reject);
      },
    );
    incoming.on("timeout", () => incoming.destroy(Error("request deadline")));
    incoming.on("error", reject);
    incoming.end(body);
  });
}
export async function observeInstalledReference(entry, directory) {
  const token = randomBytes(32).toString("base64url");
  const config = referenceConfiguration(
    path.join(directory, "store"),
    await availablePort(),
    token,
  );
  let server = await launchInstalledReference(entry, config);
  const first = server.ready;
  const wire = (url, ...args) => requestInstalled(config, token, url, ...args);
  try {
    const scope = config.scope;
    const probe = await wire(scope, "GET", undefined, undefined, {
      host: "untrusted.invalid",
      origin: "https://origin.invalid",
      forwarded: "host=evil.invalid",
    });
    assert.equal(probe.status, 204);
    assert.equal(probe.headers["access-control-allow-origin"], undefined);
    const descriptor = probe.headers.link.match(/^<([^>]+)>/)[1];
    assert.equal(descriptor, `${scope}bdp.json`);
    const discovery = (await wire(descriptor)).value;
    assert.equal(discovery.profile, "read-update");
    assert.equal(discovery.scope, scope);
    assert.deepEqual(discovery.limits.request, { bodyBytes: 65536 });
    assert.deepEqual(discovery.limits.sequence, { operations: 32 });
    const operations = (await wire(discovery.operations)).value;
    assert.deepEqual(Object.keys(operations).sort(), [
      "createBead",
      "createLink",
      "deleteAlias",
      "deleteBead",
      "deleteLink",
      "putAlias",
      "sequence",
      "updateBead",
      "updateLink",
    ]);
    const target = (name) => new URL(operations[name], discovery.operations).href;
    const post = (name, value, key) => wire(target(name), "POST", value, key);
    const inventory = (await wire(`${scope}types/`)).value;
    assert.equal(inventory.items.length, 13);
    for (const summary of inventory.items) {
      assert.ok(summary.id.startsWith(`${scope}types/`));
      const type = await wire(summary.id);
      assert.equal(type.status, 200);
      assert.equal(type.value.id, summary.id);
      assert.equal((await wire(summary.id, "HEAD")).text, "");
      for (const id of [
        ...type.value.conformsTo,
        ...Object.keys(type.value.ownsOutgoing ?? {}).filter((id) => id !== "*"),
        ...(type.value.source?.conformsTo ?? []),
        ...(type.value.target?.conformsTo ?? []),
      ])
        assert.ok(id.startsWith(`${scope}types/`));
    }
    const bead = { id: "beads/a", type: `${scope}types/task`, properties: { n: 1 } };
    const made = await post("createBead", bead, "create");
    assert.equal(made.status, 200);
    const a = made.value.resource;
    assert.equal(a.id, `${scope}beads/a`);
    const changed = await post(
      "updateBead",
      {
        bead: a.id,
        expectedRevision: a.revision,
        propertiesChange: [{ op: "replace", path: "/n", value: 2 }],
      },
      "update",
    );
    assert.equal(changed.status, 200);
    assert.deepEqual((await wire(a.id)).value, changed.value.resource);
    const resource = await wire(a.id);
    assert.equal((await wire(a.id, "HEAD")).headers.etag, resource.headers.etag);
    assert.equal(
      (await wire(a.id, "GET", undefined, undefined, { "if-none-match": resource.headers.etag }))
        .status,
      304,
    );
    assert.equal(
      (await wire(a.id, "GET", undefined, undefined, { "if-match": '"not-current"' })).status,
      412,
    );
    assert.equal(
      (await wire(a.id, "GET", undefined, undefined, { accept: "text/plain" })).status,
      406,
    );
    const link = await post(
      "createLink",
      { id: "links/a", type: `${scope}types/relates`, source: a.id, target: a.id },
      "link",
    );
    assert.equal(link.status, 200);
    const updatedLink = await post(
      "updateLink",
      { link: link.value.resource.id, metadataChange: [{ op: "add", path: "/n", value: 2 }] },
      "update_link",
    );
    assert.equal(updatedLink.status, 200);
    assert.deepEqual((await wire(link.value.resource.id)).value, updatedLink.value.resource);
    assert.equal(
      (await post("putAlias", { alias: "alias/latest", target: a.id }, "alias")).status,
      200,
    );
    const alias = await wire(`${scope}alias/latest`);
    assert.equal(alias.status, 307);
    assert.equal(alias.headers["x-bdp-development"], "non-attesting");
    assert.equal(alias.headers.location, a.id);
    assert.equal(
      (await post("deleteAlias", { alias: "alias/latest" }, "delete_alias")).status,
      200,
    );
    assert.equal((await wire(`${scope}alias/latest`)).status, 404);
    assert.equal(
      (await post("deleteLink", { link: link.value.resource.id }, "delete_link")).status,
      200,
    );
    assert.equal((await wire(link.value.resource.id)).status, 404);
    const sequence = await post("sequence", {
      operations: [
        { operation: "createBead", idempotencyKey: "tail", id: "beads/tail", type: bead.type },
        {
          operation: "updateBead",
          idempotencyKey: "miss",
          bead: "beads/missing",
          metadataChange: [{ op: "add", path: "/n", value: 1 }],
        },
        {
          operation: "createBead",
          idempotencyKey: "independent",
          id: "beads/independent",
          type: bead.type,
        },
      ],
    });
    assert.equal(sequence.status, 200);
    assert.equal((await wire(`${scope}beads/tail`)).status, 200);
    assert.equal((await wire(`${scope}beads/independent`)).status, 200);
    assert.equal(
      (await post("deleteBead", { bead: `${scope}beads/tail` }, "delete_bead")).status,
      200,
    );
    assert.equal((await wire(`${scope}beads/tail`)).status, 404);
    for (const [url, allow] of [
      [descriptor, "GET, HEAD"],
      [discovery.operations, "GET, HEAD"],
      [target("createBead"), "POST"],
    ]) {
      const options = await wire(url, "OPTIONS", undefined, undefined, {
        origin: "https://origin.invalid",
      });
      assert.equal(options.status, 405);
      assert.equal(options.headers["x-bdp-development"], "non-attesting");
      assert.equal(options.headers.allow, allow);
      assert.equal(options.text, "");
    }
    const connect = await new Promise((resolve, reject) => {
      const socket = createConnection(config.listener.port, config.listener.host);
      let raw = "";
      socket.setEncoding("utf8");
      socket.setTimeout(5000, () => socket.destroy(Error("CONNECT response deadline")));
      socket.once("error", reject);
      socket.once("connect", () =>
        socket.end("CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n"),
      );
      socket.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 65536) socket.destroy(Error("CONNECT response bound"));
      });
      socket.once("end", () => {
        socket.destroy();
        resolve(raw);
      });
    });
    assert.match(connect, /^HTTP\/1\.1 405 Method Not Allowed\r\n/);
    assert.ok(connect.includes("\r\nAllow: GET, HEAD\r\n"));
    assert.ok(connect.includes("\r\nX-Bdp-Development: non-attesting\r\n"));
    assert.match(connect, /\r\nContent-Length: 0\r\n/i);
    assert.equal(connect.indexOf("\r\n\r\n"), connect.length - 4);
    // A detached CONNECT peer may reset before the refusal finishes writing.
    // The receiver must remain usable after a reset peer.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((resolve, reject) => {
        const socket = createConnection(config.listener.port, config.listener.host);
        socket.setTimeout(5000, () => socket.destroy(Error("CONNECT reset deadline")));
        socket.once("error", reject);
        socket.once("close", resolve);
        socket.once("connect", () =>
          socket.write(
            "CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n",
            () => socket.resetAndDestroy(),
          ),
        );
      });
    }
    assert.equal((await wire(`${scope}bdp.json`)).status, 200);
    const malformed = await wire("/acme/beads/%2e%2e/a");
    assert.equal(malformed.status, 400);
    assert.equal(
      (await wire(`${target("createBead")}?unexpected=1`, "POST", bead, "bad_target")).status,
      404,
    );
    const retry = { id: "beads/retry", type: bead.type };
    assert.equal(
      (await wire(target("createBead"), "POST", retry, "media", { "content-type": "text/plain" }))
        .status,
      415,
    );
    assert.equal((await post("createBead", retry, "media")).status, 200);
    assert.equal(
      (
        await wire(target("createBead"), "POST", { ...retry, id: "beads/duplicate" }, "dup", {
          "idempotency-key": ["dup", "dup"],
        })
      ).status,
      400,
    );
    assert.equal(
      (await post("createBead", { ...retry, id: "beads/duplicate" }, "dup")).status,
      200,
    );
    assert.equal(
      (
        await wire(target("createBead"), "POST", { ...retry, id: "beads/auth" }, "auth", {
          authorization: [`Bearer ${token}`, `Bearer ${token}`],
        })
      ).status,
      400,
    );
    assert.equal((await post("createBead", { ...retry, id: "beads/auth" }, "auth")).status, 200);
    assert.deepEqual(await server.close(), { code: 0, signal: null });
    assert.deepEqual(server.output(), { stdout: "", stderr: "" });
    config.create = false;
    config.listener.port = await availablePort();
    server = await launchInstalledReference(entry, config);
    assert.equal(server.ready.configurationIdentity, first.configurationIdentity);
    assert.equal(server.ready.payloadIdentity, first.payloadIdentity);
    assert.deepEqual((await post("createBead", bead, "create")).value, made.value);
    assert.deepEqual((await wire(a.id)).value, changed.value.resource);
    // Parent disappearance closes the owner and listener, allowing a real reopen.
    server.child.disconnect();
    assert.deepEqual(await server.wait(), { code: 0, signal: null });
    config.listener.port = await availablePort();
    server = await launchInstalledReference(entry, config);
    assert.deepEqual((await wire(a.id)).value, changed.value.resource);
    return {
      claimEligible: false,
      configurationIdentity: first.configurationIdentity,
      payloadIdentity: first.payloadIdentity,
      artifactIdentity: first.artifactIdentity,
      allNineTargets: true,
      stableScope: scope,
    };
  } finally {
    await server.close();
  }
}
