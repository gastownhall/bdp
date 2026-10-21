/** Private installed RU clock/policy companion. Never an ordinary configuration or public seam. */
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";

const BASE = 1700000000000;
const DAY = 86400000;
async function main() {
  const directory = process.env.BDP_RU_MANAGEMENT_RUNTIME;
  if (!directory || !process.send || !process.connected)
    throw Error("installed IPC binding required");
  const configuration = await new Promise<any>((resolve) =>
    process.once("message", (v: { configuration: unknown }) => resolve(v.configuration)),
  );
  const load = (name: string) => import(pathToFileURL(path.join(directory, name)).href);
  const { captureInstalledReferenceConfiguration } = await load(
    "installed-reference-configuration.js",
  );
  const { createDevelopmentAccessPolicy } = await load("development-contracts.js");
  const { createDevelopmentComposition } = await load("development-composition.js");
  const { startDevelopmentReferenceRuntime, assemblePreparedDevelopmentArguments } =
    await load("development-runtime.js");
  const { installedPayloadIdentity } = await load("installed-payload.js");
  const { DEVELOPMENT_OWNER_LIMITS } = await load("development-authority.js");
  const captured = captureInstalledReferenceConfiguration(configuration);
  const policy = createDevelopmentAccessPolicy(configuration.policies);
  if (policy.policy.identity() !== captured.policyIdentity)
    throw Error("initial genuine policy identity differs");
  const composition = createDevelopmentComposition(new URL(captured.scope).pathname);
  const [options, actualComposition, deployment, transport] = assemblePreparedDevelopmentArguments(
    captured,
    composition,
  );
  const actualDeployment = {
    ...deployment,
    configuration: { ...deployment.configuration, access: policy.policy },
  };
  let now = BASE;
  let runtime = await startDevelopmentReferenceRuntime(
    options,
    undefined,
    () => now,
    actualComposition,
    actualDeployment,
    transport,
  );
  let hidden = false,
    count = 0,
    chain = Promise.resolve(),
    terminal: Promise<void> | undefined;
  const policies = () =>
    Object.fromEntries(
      ["operator", "restricted", "other"].map((p) => [p, policy.policy.capture(p)]),
    );
  const ready = async () => {
    const binding = {
      scope: captured.scope,
      profile: captured.profile,
      history: captured.history,
      artifactIdentity: captured.artifactIdentity,
      authenticationIdentity: captured.authenticationIdentity,
      policyIdentity: policy.policy.identity(),
      policies: policies(),
      now,
      sourceClock: "source-private installed startDevelopmentReferenceRuntime clock",
      ownerLimits: DEVELOPMENT_OWNER_LIMITS,
    };
    return {
      ...binding,
      managementIdentity: createHash("sha256").update(JSON.stringify(binding)).digest("hex"),
      ordinaryDeployment: false,
      ordinaryRuntimeConfigurationIdentity: null,
      claimEligible: false,
      payloadIdentity: await installedPayloadIdentity(),
      facadeKeys: Object.keys(runtime).sort(),
      listenerInput: { host: captured.host, port: captured.port },
    };
  };
  const send = (v: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(v, (e: Error | null) => (e ? reject(e) : resolve())),
    );
  const close = () =>
    (terminal ??= (async () => {
      await runtime.close();
      if (process.connected) process.disconnect();
    })());
  process.on("message", (v: { command?: unknown; now?: unknown }) => {
    chain = chain
      .then(async () => {
        if (v.command === "close") {
          await close();
          return;
        }
        if (++count > 16) throw Error("management control count exceeded");
        let result: unknown;
        if (v.command === "reopen" || v.command === "snapshot") {
          if (v.command === "reopen") {
            if (
              typeof v.now !== "number" ||
              ![BASE + DAY - 1, BASE + DAY].includes(v.now) ||
              v.now < now
            )
              throw Error("unselected clock transition");
            now = v.now;
          }
          await runtime.close();
          // The real owner is closed. This observer only reads the actual native file; it never writes expiry data.
          const db = new DatabaseSync(path.join(options.directory, "reference.sqlite"), {
            readOnly: true,
          });
          try {
            const keys = db.prepare("SELECT * FROM key_state ORDER BY principal,key").all();
            const resources = db.prepare("SELECT * FROM resources ORDER BY id").all();
            if (keys.length > 16 || resources.length > 8) throw Error("native observation bound");
            result = { beforeOwnerReopen: true, keys, resources };
          } finally {
            db.close();
          }
          runtime = await startDevelopmentReferenceRuntime(
            { ...options, create: false },
            undefined,
            () => now,
            actualComposition,
            actualDeployment,
            transport,
          );
        } else if (v.command === "hide" && !hidden) {
          hidden = true;
          policy.replace("operator", {
            ...configuration.policies.operator,
            hidden: ["beads/policy"],
          });
        } else if (v.command === "restore-policy" && hidden) {
          hidden = false;
          policy.replace("operator", configuration.policies.operator);
        } else throw Error("unselected management command");
        await send({ event: "management.done", command: v.command, result, ready: await ready() });
      })
      .catch(async (error: unknown) => {
        process.stderr.write(inspect(error, { depth: 8 }) + "\n");
        process.exitCode = 2;
        try {
          await close();
        } catch (closing) {
          process.stderr.write(inspect(closing, { depth: 8 }) + "\n");
        }
      });
  });
  process.once("disconnect", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
  await send({ event: "management.ready", ...(await ready()) });
}
void main().catch((error: unknown) => {
  process.stderr.write(inspect(error, { depth: 8 }) + "\n");
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
