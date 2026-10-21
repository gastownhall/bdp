/** NEW listener allocation cases, not replay of existing RU carrier obligations. */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const helpers = await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
);
const configModule = await import(
  new URL("../../../packages/server/dist/installed-reference-configuration.js", import.meta.url)
    .href
);
const entry =
  process.env.BDP_RU_LISTENER_ENTRY ??
  fileURLToPath(
    new URL("../../../packages/server/dist/installed-reference-process.js", import.meta.url),
  );
const token = "listener_allocation_private_0123456789";
it("NEW RU listener capture accepts OS allocation without changing configuration identity or accepting nonloopback ports", () => {
  const input = helpers.referenceConfiguration("/tmp/ru-listener-capture-only", 0, token);
  const zero = configModule.captureInstalledReferenceConfiguration(input);
  const explicit = configModule.captureInstalledReferenceConfiguration({
    ...input,
    listener: { host: "127.0.0.1", port: 32123 },
  });
  expect(zero.port).toBe(0);
  expect(explicit.port).toBe(32123);
  expect(zero.identity).toBe(explicit.identity);
  for (const port of [-1, 65536, 1.5])
    expect(() =>
      configModule.captureInstalledReferenceConfiguration({
        ...input,
        listener: { host: "127.0.0.1", port },
      }),
    ).toThrow("explicit loopback listener required");
  expect(() =>
    configModule.captureInstalledReferenceConfiguration({
      ...input,
      listener: { host: "0.0.0.0", port: 0 },
    }),
  ).toThrow("explicit loopback listener required");
});
it("NEW RU ready dial rejects unbound or escaped listener addresses and preserves explicit port requests", () => {
  const configuration = helpers.referenceConfiguration("/tmp/ru-listener-dial-only", 0, token);
  const ready = { scope: configuration.scope, listenUrl: "http://127.0.0.1:32123/" };
  expect(helpers.installedReferenceDialRoute(ready, configuration)).toEqual({
    transport: "plain",
    host: "127.0.0.1",
    port: 32123,
  });
  expect(
    helpers.installedReferenceDialRoute(
      { ...ready, listenUrl: "http://127.0.0.1:80/" },
      configuration,
    ).port,
  ).toBe(80);
  for (const listenUrl of [
    "http://127.0.0.1:0/",
    "http://example.invalid:32123/",
    "http://127.0.0.1:32123/path",
    "http://user@127.0.0.1:32123/",
  ])
    expect(() =>
      helpers.installedReferenceDialRoute({ ...ready, listenUrl }, configuration),
    ).toThrow();
  expect(() =>
    helpers.installedReferenceDialRoute(ready, {
      ...configuration,
      listener: { host: "127.0.0.1", port: 32124 },
    }),
  ).toThrow();
  expect(() =>
    helpers.installedReferenceDialRoute(
      { ...ready, scope: "https://other.invalid/" },
      configuration,
    ),
  ).toThrow();
});
it("NEW RU children allocate distinct live listeners in-child, retain canonical discovery and reopen at an explicit owned port", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bdp-ru-child-listener-"));
  const children: any[] = [],
    terminals: unknown[] = [],
    responses: unknown[] = [],
    errors: unknown[] = [];
  let expectedRefusal: unknown,
    removed = false;
  async function launch(configuration: any) {
    const running = await helpers.launchInstalledReference(entry, configuration);
    const terminal = new Promise((resolve, reject) => {
      running.child.once("close", (code: unknown, signal: unknown) => resolve({ code, signal }));
      running.child.once("error", reject);
    });
    const record = { running, configuration, terminal, closed: false };
    children.push(record);
    return record;
  }
  async function close(record: any) {
    if (record.closed) return;
    try {
      await record.running.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      const result = await record.terminal;
      let pidAbsent = false;
      try {
        process.kill(record.running.child.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        pidAbsent = true;
      }
      const actual = {
        pid: record.running.child.pid,
        ...(result as object),
        stdoutEOF: record.running.child.stdout.readableEnded,
        stderrEOF: record.running.child.stderr.readableEnded,
        pidAbsent,
        output: record.running.output(),
      };
      terminals.push(actual);
      expect(actual).toMatchObject({
        code: 0,
        signal: null,
        stdoutEOF: true,
        stderrEOF: true,
        pidAbsent: true,
        output: { stdout: "", stderr: "" },
      });
    } catch (error) {
      errors.push(error);
    }
    record.closed = true;
  }
  try {
    for (let i = 0; i < 3; i++) {
      const configuration = helpers.referenceConfiguration(
        path.join(directory, `store-${i}`),
        0,
        token,
      );
      const record = await launch(configuration);
      expect(record.configuration.listener.port).toBe(0);
      expect(new URL(record.running.ready.listenUrl).port).not.toBe("0");
    }
    expect(new Set(children.map((c) => c.running.dialRoute.port)).size).toBe(3);
    expect(new Set(children.map((c) => c.running.ready.configurationIdentity)).size).toBe(1);
    for (const record of children) {
      const response = await helpers.requestInstalled(
        { ...record.configuration, listener: record.running.dialRoute },
        token,
        record.configuration.scope + "bdp.json",
        "GET",
        undefined,
        undefined,
        { host: new URL(record.configuration.scope).host },
      );
      expect(response.status).toBe(200);
      expect(response.value.scope).toBe(record.configuration.scope);
      expect(response.value.profile).toBe("read-update");
      responses.push({
        listenUrl: record.running.ready.listenUrl,
        ready: record.running.ready,
        response,
      });
    }
    const first = children[0],
      explicit = {
        ...first.configuration,
        listener: { host: "127.0.0.1", port: first.running.dialRoute.port },
      };
    try {
      await helpers.launchInstalledReference(entry, {
        ...explicit,
        directory: path.join(directory, "occupied"),
      });
      throw Error("occupied live child port unexpectedly available");
    } catch (error) {
      const cause = error as Error & { qualification?: unknown; qualificationProcess?: any };
      expectedRefusal = { qualification: cause.qualification, process: cause.qualificationProcess };
      expect(cause.qualification).toMatchObject({ phase: "candidate-start", code: "EADDRINUSE" });
      expect(cause.qualificationProcess).toMatchObject({ stdoutEOF: true, stderrEOF: true });
      // The unchanged launcher kills on a refused ready message. Either the
      // child's diagnostic exit2 or that explicit SIGKILL can win this race.
      expect(
        (cause.qualificationProcess.code === 2 && cause.qualificationProcess.signal === null) ||
          (cause.qualificationProcess.code === null &&
            cause.qualificationProcess.signal === "SIGKILL"),
      ).toBe(true);
      let absent: unknown;
      try {
        process.kill(cause.qualificationProcess.pid, 0);
      } catch (error) {
        absent = error;
      }
      expect(absent).toMatchObject({ code: "ESRCH" });
    }
    await close(first);
    const reopened = await launch({ ...explicit, create: false });
    expect(reopened.running.dialRoute.port).toBe(explicit.listener.port);
    expect(reopened.running.ready.configurationIdentity).toBe(
      first.running.ready.configurationIdentity,
    );
    const response = await helpers.requestInstalled(
      { ...explicit, listener: reopened.running.dialRoute },
      token,
      explicit.scope + "bdp.json",
      "GET",
      undefined,
      undefined,
      { host: new URL(explicit.scope).host },
    );
    expect(response.status).toBe(200);
    expect(response.value.scope).toBe(explicit.scope);
    responses.push({
      listenUrl: reopened.running.ready.listenUrl,
      ready: reopened.running.ready,
      response,
    });
  } catch (error) {
    errors.push(error);
  } finally {
    for (const record of children) await close(record);
    try {
      await rm(directory, { recursive: true, force: true });
      await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
      removed = true;
    } catch (error) {
      errors.push(error);
    }
  }
  const report = {
    entry,
    childCount: children.length,
    ready: children.map((c) => c.running.ready),
    requestedPorts: children.map((c) => c.configuration.listener.port),
    responses,
    expectedRefusal,
    terminals,
    directory,
    removed,
    errors: errors.map((e) => inspect(e, { depth: 6 })),
    qualificationClaim: false,
  };
  if (process.env.BDP_RU_LISTENER_EVIDENCE)
    await writeFile(
      path.join(process.env.BDP_RU_LISTENER_EVIDENCE, "listeners.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  if (errors.length)
    throw new AggregateError(errors, "NEW RU listener allocation or cleanup failed");
}, 90000);
