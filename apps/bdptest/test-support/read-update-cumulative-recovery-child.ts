/** Test-only installed RU scheduler control. No member/store semantics are replaced. */
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";

type Cancel = () => void;
type Scheduler = {
  turn(callback: () => void): Cancel;
  delay(ms: number, callback: () => void): Cancel;
};

async function main() {
  const directory = process.env.BDP_RU_RECOVERY_INSTALLED;
  if (!directory || !process.send || !process.connected)
    throw Error("private scheduler binding required");
  let faultSecondTurn = false;
  const configuration = await new Promise<unknown>((resolve) =>
    process.once("message", (input: { configuration: unknown; faultSecondTurn?: boolean }) => {
      faultSecondTurn = input.faultSecondTurn === true;
      resolve(input.configuration);
    }),
  );
  const load = (name: string) => import(pathToFileURL(`${directory}/${name}.js`).href);
  const configurationModule = await load("installed-reference-configuration");
  const runtimeModule = await load("development-runtime");
  const compositionModule = await load("development-composition");
  const lifecycleModule = await load("sequence-executor");
  const captured = configurationModule.captureInstalledReferenceConfiguration(configuration);
  const nodeScheduler: Scheduler = lifecycleModule.createNodeLifecycleScheduler();
  const jobs = new Map<number, { callback: () => void; cancel?: Cancel }>();
  let ordinal = 0,
    released = 0,
    draining = false;
  const send = (value: unknown) =>
    new Promise<void>((resolve, reject) =>
      process.send!(value, (error: Error | null) => (error ? reject(error) : resolve())),
    );
  const emit = (value: unknown) => {
    void send(value).catch((error) => {
      process.stderr.write(`scheduler IPC failed: ${inspect(error)}\n`);
      process.exitCode = 2;
    });
  };
  function release(id: number) {
    const job = jobs.get(id);
    if (!job || job.cancel || ++released > 128)
      throw Error("invalid or repeated bounded scheduler release");
    job.cancel = nodeScheduler.turn(() => {
      jobs.delete(id);
      // This is the original lifecycle callback, not a reconstructed member operation.
      job.callback();
      emit({ event: "scheduler.ran", id, pending: [...jobs.keys()] });
    });
    emit({ event: "scheduler.released", id });
  }
  const scheduler: Scheduler = Object.freeze({
    turn(callback: () => void) {
      if (typeof callback !== "function" || ++ordinal > 128 || jobs.size >= 64)
        throw Error("bounded real scheduler queue exceeded");
      const id = ordinal;
      if (faultSecondTurn && id === 2) {
        emit({
          event: "scheduler.fault",
          id,
          phase: "real-turn-scheduling-before-original-callback",
        });
        throw Error("NEW selected scheduler infrastructure refusal after committed prefix");
      }
      jobs.set(id, { callback });
      emit({ event: "scheduler.queued", id });
      if (draining) release(id);
      return () => {
        const job = jobs.get(id);
        if (!job) return;
        job.cancel?.();
        jobs.delete(id);
        emit({ event: "scheduler.cancelled", id });
      };
    },
    delay(milliseconds, callback) {
      // Native maintenance timing and clock are unchanged.
      return nodeScheduler.delay(milliseconds, callback);
    },
  });
  const composition = compositionModule.createDevelopmentComposition(
    new URL(captured.scope).pathname,
  );
  const [options, actualComposition, deployment, transport] =
    runtimeModule.assemblePreparedDevelopmentArguments(captured, composition);
  const runtime = await runtimeModule.startDevelopmentReferenceRuntime(
    options,
    scheduler,
    undefined,
    actualComposition,
    deployment,
    transport,
  );
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      // Failure cleanup lets already-admitted original work drain; it never calls
      // a store operation or fabricates a transient/terminal result.
      draining = true;
      for (const [id, job] of jobs) if (!job.cancel) release(id);
      let closeFailure: string | null = null;
      try {
        await runtime.close();
      } catch (error) {
        // The real owner preserves its selected infrastructure fault on close.
        closeFailure = inspect(error, { depth: 20 });
        process.stderr.write(`actual installed close refusal: ${closeFailure}\n`);
        process.exitCode = 2;
      }
      await send({
        closeFailure,
        event: "scheduler.closed",
        scheduled: ordinal,
        released,
        pending: [...jobs.keys()],
      });
      if (process.connected) process.disconnect();
    })());
  let chain = Promise.resolve();
  process.on("message", (input: { command?: unknown; id?: unknown }) => {
    chain = chain
      .then(async () => {
        if (input.command === "close") return close();
        if (
          input.command !== "release" ||
          !Number.isSafeInteger(input.id) ||
          typeof input.id !== "number" ||
          closing
        )
          throw Error("unknown private scheduler command");
        release(input.id);
      })
      .catch(async (error) => {
        process.stderr.write(`private scheduler control failed: ${inspect(error, { depth: 8 })}\n`);
        process.exitCode = 2;
        await close();
      });
  });
  process.once("disconnect", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
  await send({
    event: "ru-recovery.ready",
    scope: runtime.scope,
    listenUrl: `http://${captured.host}:${captured.port}/`,
    configurationIdentity: captured.identity,
    artifactIdentity: captured.artifactIdentity,
    policyIdentity: captured.policyIdentity,
    authenticationIdentity: captured.authenticationIdentity,
    ordinaryDeployment: false,
    claimEligible: false,
    selectedSeam: "installed LifecycleScheduler.turn original callbacks only",
    clockInjected: false,
    policyChanged: false,
  });
}
void main().catch((error: unknown) => {
  process.stderr.write(`private RU scheduler startup failed: ${inspect(error, { depth: 8 })}\n`);
  process.exitCode = 2;
  if (process.connected) process.disconnect();
});
