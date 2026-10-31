import { createHash } from "node:crypto";
import { canonicalJson, type ScenarioActionExecution } from "@bdp/conformance";
import { createDevelopmentProcessHarness } from "./development-process.js";

/** Controls only the existing process fixture; the manifest owns expectations. */
export function createDevelopmentProcessActions(token: string) {
  const processes = createDevelopmentProcessHarness(token);
  let active: Awaited<ReturnType<typeof processes.start>> | undefined;
  let store = "";
  let port = 0;
  let submission: unknown;
  const retentionEpoch = 1_700_000_000_000;
  let retentionElapsed: number | undefined;
  let controller: AbortController | undefined;
  let delivery: Promise<{ delivered: boolean }> | undefined;
  let original: Promise<Response | undefined> | undefined;
  const prefixDigests: string[] = [];
  const replayDigests: string[] = [];
  async function prepare(directory: string, assignedPort: number, retention = false) {
    store = directory;
    port = assignedPort;
    prefixDigests.length = 0;
    replayDigests.length = 0;
    retentionElapsed = retention ? 0 : undefined;
    active = await processes.start(store, port, true, true, retention ? retentionEpoch : undefined);
  }
  async function close() {
    controller?.abort();
    try {
      await processes.close();
    } finally {
      await delivery;
      active = undefined;
      delivery = undefined;
      original = undefined;
      controller = undefined;
      submission = undefined;
      retentionElapsed = undefined;
    }
  }
  async function execute(execution: ScenarioActionExecution) {
    if (
      execution.family !== "lifecycle" ||
      active === undefined ||
      active.scope !== execution.scope
    )
      throw new Error("process action requires its active disposable fixture Scope");
    if (execution.signal.aborted) throw new Error("process action was aborted");
    const child = active;
    if (retentionElapsed !== undefined && execution.operation !== "development.retention.reopen")
      throw new Error("retention fixture only supports its reopen control");
    switch (execution.operation) {
      case "development.retention.reopen": {
        const input = execution.input;
        if (
          retentionElapsed === undefined ||
          typeof input !== "object" ||
          input === null ||
          Array.isArray(input) ||
          Object.keys(input).length !== 1 ||
          !("elapsedMs" in input) ||
          typeof input.elapsedMs !== "number" ||
          !Number.isSafeInteger(input.elapsedMs) ||
          input.elapsedMs < retentionElapsed ||
          input.elapsedMs > 7 * 86_400_000
        )
          throw new Error(
            "retention reopen requires nondecreasing safe elapsedMs within the seven-day fixture window",
          );
        const elapsedMs = input.elapsedMs;
        child.send("close");
        await child.wait("closed");
        const exit = await child.waitForExit();
        if (exit.code !== 0 || exit.signal !== null)
          throw new Error("retention child did not close cleanly");
        if (execution.signal.aborted) throw new Error("retention reopen was aborted");
        active = await processes.start(store, port, false, true, retentionEpoch + elapsedMs);
        retentionElapsed = elapsedMs;
        if (execution.signal.aborted) throw new Error("retention reopen was aborted");
        return { elapsedMs, scope: active.scope, priorExit: exit };
      }
      case "development.process.submit": {
        if (delivery !== undefined) throw new Error("process fixture already has a submission");
        submission = execution.input;
        controller = new AbortController();
        // Consume rejection immediately; cleanup aborts/awaits this bounded
        // Fetch request even when a later assertion or runner action fails.
        original = child.sequence(submission, controller.signal).then(
          (response) => response,
          () => undefined,
        );
        delivery = original.then((response) => ({ delivered: response !== undefined }));
        const barrier = await child.wait("parked", 2);
        const prefix = await child.get("beads/prefix");
        prefixDigests.push(digest(prefix));
        const tail = await child.get("beads/tail");
        return { barrier, prefix: observation(prefix), tail: observation(tail) };
      }
      case "development.process.disconnect":
        controller?.abort();
        return await delivery;
      case "development.process.release":
        child.send("release");
        return child.wait("turn-completed", 4);
      case "development.process.release-response": {
        if (original === undefined) throw new Error("no original process request");
        child.send("release");
        // Competing requests change dispatch indices. Observe the original HTTP
        // response instead of treating an arbitrary scheduler turn as completion.
        // The existing Fetch transport bounds the complete response wait.
        const response = await original;
        if (response === undefined) throw new Error("original process response was not delivered");
        replayDigests.push(digest(response));
        return observation(response);
      }
      case "development.process.drain":
        child.send("close");
        await child.wait("closing");
        return {
          ...(await delivery),
          exitCode: child.child.exitCode,
          signalCode: child.child.signalCode,
        };
      case "development.process.release-drain":
        child.send("release");
        await child.wait("closed");
        return child.waitForExit();
      case "development.process.kill":
        child.child.kill("SIGKILL");
        return { ...(await child.waitForExit()), ...(await delivery) };
      case "development.process.reopen":
        active = await processes.start(store, port, false, false);
        return { scope: active.scope };
      case "development.process.prefix": {
        const response = await child.get("beads/prefix");
        prefixDigests.push(digest(response));
        return observation(response);
      }
      case "development.process.replay": {
        const response = await child.sequence(submission, execution.signal);
        replayDigests.push(digest(response));
        return observation(response);
      }
      case "development.process.digest-counts":
        // Counts describe observed canonical JSON equivalence classes. The
        // runner decides how many observations/classes the contract requires.
        return {
          prefixObservations: prefixDigests.length,
          prefixDistinctDigests: new Set(prefixDigests).size,
          replayObservations: replayDigests.length,
          replayDistinctDigests: new Set(replayDigests).size,
        };
      default:
        throw new Error("unknown development process action");
    }
  }
  return { prepare, execute, close };
}

type ProcessSession = Awaited<
  ReturnType<ReturnType<typeof createDevelopmentProcessHarness>["start"]>
>;
type Response = Awaited<ReturnType<ProcessSession["get"]>>;
function observation(response: Response) {
  return {
    status: response.status,
    headers: response.headers,
    ...(response.kind === "json" ? { body: response.body } : {}),
  };
}
function digest(response: Response): string {
  if (response.kind !== "json") throw new Error("process equality observation requires JSON");
  return createHash("sha256").update(canonicalJson(response.body)).digest("hex");
}
