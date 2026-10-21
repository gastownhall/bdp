/** Own disposable fixture only. Namespace stays child-local and never enters IPC/logs. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

let retainedFailure: unknown;
async function main() {
  const installed = process.env.BDP_RU_ALLOCATION_RUNTIME;
  if (!installed || !process.send || !process.connected) throw Error("installed IPC required");
  const input = await new Promise<{ configuration: any }>((resolve) =>
    process.once("message", resolve),
  );
  const load = (name: string) => import(pathToFileURL(path.join(installed, name + ".js")).href);
  const { captureInstalledReferenceConfiguration } = await load(
    "installed-reference-configuration",
  );
  const { createDevelopmentComposition } = await load("development-composition");
  const { startDevelopmentReferenceRuntime, assemblePreparedDevelopmentArguments } =
    await load("development-runtime");
  const { installedPayloadIdentity } = await load("installed-payload");
  const captured = captureInstalledReferenceConfiguration(input.configuration);
  const composition = createDevelopmentComposition(new URL(captured.scope).pathname);
  const [options, actualComposition, deployment, transport] = assemblePreparedDevelopmentArguments(
    captured,
    composition,
  );
  const raw = await readFile(path.join(installed, "recovery-store.js"));
  const sourcePin = {
    file: "recovery-store.js",
    bytes: raw.length,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
  let runtime = await startDevelopmentReferenceRuntime(
    options,
    undefined,
    undefined,
    actualComposition,
    deployment,
    transport,
  );
  let count = 0,
    chain = Promise.resolve(),
    closing: Promise<void> | undefined;
  const send = (value: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(value, (e: Error | null) => (e ? reject(e) : resolve())),
    );
  const close = () =>
    (closing ??= (async () => {
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  function observeClosedNative() {
    const db = new DatabaseSync(path.join(options.directory, "reference.sqlite"), {
      readOnly: true,
    });
    try {
      // No SELECT of the whole metadata table, no metadata write, no rewind/reseed.
      const namespace = db
        .prepare("SELECT value FROM metadata WHERE name='namespace'")
        .get()?.value;
      const counter = db
        .prepare("SELECT value FROM metadata WHERE name='nextIdentity'")
        .get()?.value;
      if (
        typeof namespace !== "string" ||
        namespace.length === 0 ||
        typeof counter !== "string" ||
        !/^\d{1,128}$/.test(counter)
      )
        throw Error("native allocation metadata refused");
      // Exact pinned source expression recovery-store.ts877-891. Planning only,
      // not production allocator approval: the real loop must independently skip.
      const candidates = [1n, 2n].map(
        (delta) =>
          captured.scope +
          "beads/" +
          createHash("sha256")
            .update(`${namespace}:identity:${BigInt(counter) + delta}`)
            .digest("hex"),
      );
      const identities = db.prepare("SELECT id FROM identities ORDER BY id").all();
      const aliases = db.prepare("SELECT path,bead_id FROM aliases ORDER BY path").all();
      const resources = db
        .prepare("SELECT id,kind,body,source,target FROM resources ORDER BY id")
        .all();
      if (identities.length > 4 || aliases.length > 2 || resources.length > 4)
        throw Error("closed native observation bound");
      return {
        candidates,
        counter,
        sourcePin,
        identities,
        aliases,
        resources,
        readOnly: true,
        observedOnlyAfterOwnerClose: true,
      };
    } finally {
      db.close();
    }
  }
  process.on("message", (value: { command?: unknown }) => {
    chain = chain
      .then(async () => {
        if (value.command === "close") return close();
        if (value.command !== "observe" || ++count > 4)
          throw Error("unselected allocation observation");
        await runtime.close();
        const observation = observeClosedNative();
        runtime = await startDevelopmentReferenceRuntime(
          { ...options, create: false },
          undefined,
          undefined,
          actualComposition,
          deployment,
          transport,
        );
        await send({ event: "allocation.observed", observation });
      })
      .catch(async (error: unknown) => {
        retainedFailure = error; // Never format a potentially namespace-bearing exception.
        process.exitCode = 2;
        process.stderr.write("ALLOCATION_FIXTURE_CONTROL_REFUSED\n");
        try {
          await close();
        } catch (closingError) {
          retainedFailure = new AggregateError([error, closingError], "owned close refused");
        }
      });
  });
  process.once("SIGTERM", () => {
    void close();
  });
  process.once("disconnect", () => {
    void close();
  });
  await send({
    event: "allocation.ready",
    ordinaryDeployment: false,
    ordinaryRuntimeConfigurationIdentity: null,
    nativeConfigurationIdentity: captured.identity,
    artifactIdentity: captured.artifactIdentity,
    policyIdentity: captured.policyIdentity,
    authenticationIdentity: captured.authenticationIdentity,
    payloadIdentity: await installedPayloadIdentity(),
    scope: runtime.scope,
    facadeKeys: Object.keys(runtime).sort(),
    sourcePin,
    listenerInput: { host: captured.host, port: captured.port },
    control:
      "closed-owner readonly native planning; actual allocation remains installed native loop",
    namespaceExported: false,
  });
}
void main().catch((error: unknown) => {
  retainedFailure = error;
  process.stderr.write("ALLOCATION_FIXTURE_STARTUP_REFUSED\n");
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
// Keep genuine failures owned through process terminal; no exception projection is evidence of their full contents.
process.once("exit", () => {
  void retainedFailure;
});
