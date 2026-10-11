import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { createReadUpdateFetchTransport } from "@bdp/client";
import { parseReadUpdateSequenceResponse } from "@bdp/protocol";
import { createDevelopmentProcessHarness } from "../test-support/development-process.js";

const token = "development_disconnect_credential_0123456789";
const beadType = "https://bdp.example/development/bead";
const processes = createDevelopmentProcessHarness(token);
const { start, directory } = processes;
afterEach(() => processes.close());

function input() {
  return {
    operations: [
      {
        operation: "createBead",
        idempotencyKey: "prefix",
        id: "beads/prefix",
        name: "prefix",
        type: beadType,
      },
      { operation: "deleteBead", idempotencyKey: "failed-middle", bead: "beads/missing" },
      {
        operation: "putAlias",
        idempotencyKey: "alias-tail",
        alias: "alias/prefix-name",
        target: "@prefix",
      },
      {
        operation: "createBead",
        idempotencyKey: "independent-tail",
        id: "beads/tail",
        type: beadType,
      },
    ],
  };
}
function json(
  response: Awaited<ReturnType<ReturnType<typeof createReadUpdateFetchTransport>["get"]>>,
) {
  if (response.kind !== "json") throw new Error("expected JSON response");
  return response.body;
}
function lost(promise: Promise<unknown>) {
  return promise.then(
    () => ({ delivered: true }),
    () => ({ delivered: false }),
  );
}

describe("development HTTP disconnect and process recovery", () => {
  it("continues admitted work after a mid-sequence client disconnect and replays exactly", async () => {
    const h = await start(path.join(directory(), "store"));
    const controller = new AbortController();
    const delivery = lost(h.sequence(input(), controller.signal));
    await h.wait("parked", 2);
    const prefix = await h.get("beads/prefix");
    expect(prefix.status).toBe(200);
    expect(await h.get("beads/tail")).toMatchObject({ status: 404 });
    controller.abort();
    expect(await delivery).toEqual({ delivered: false });
    h.send("release");
    await h.wait("turn-completed", 4);
    expect(await h.get("beads/tail")).toMatchObject({ status: 200 });
    const replay = await h.sequence(input());
    if (replay.kind !== "json") throw new Error("missing replay JSON");
    const result = parseReadUpdateSequenceResponse(replay.body);
    expect(result.results).toMatchObject([
      { operationIndex: 0, outcome: "created" },
      { operationIndex: 1, code: "resource-not-found" },
      { operationIndex: 2, outcome: "created" },
      { operationIndex: 3, outcome: "created" },
    ]);
    expect(json(await h.sequence(input()))).toEqual(replay.body);
    expect(json(await h.get("beads/prefix"))).toEqual(json(prefix));
    h.send("close");
    await h.wait("closed");
    expect(await h.exited).toEqual({ code: 0, signal: null });
  }, 15000);

  it("graceful close drains an admitted sequence even after disconnecting its response", async () => {
    const store = path.join(directory(), "store");
    const h = await start(store);
    const delivery = lost(h.sequence(input()));
    await h.wait("parked", 2);
    expect(await h.get("beads/prefix")).toMatchObject({ status: 200 });
    expect(await h.get("beads/tail")).toMatchObject({ status: 404 });
    h.send("close");
    await h.wait("closing");
    expect(await delivery).toEqual({ delivered: false });
    expect(h.child.exitCode).toBeNull();
    h.send("release");
    await h.wait("closed");
    expect(await h.exited).toEqual({ code: 0, signal: null });
    const reopened = await start(store, Number(new URL(h.scope).port), false, false);
    expect(await reopened.get("beads/tail")).toMatchObject({ status: 200 });
    const replay = await reopened.sequence(input());
    expect(replay).toMatchObject({
      status: 200,
      body: {
        results: [
          { outcome: "created" },
          { code: "resource-not-found" },
          { outcome: "created" },
          { outcome: "created" },
        ],
      },
    });
    expect(json(await reopened.sequence(input()))).toEqual(json(replay));
    expect(await reopened.stop()).toEqual({ code: 0, signal: null });
  }, 15000);

  it("SIGKILL preserves the prefix but never resumes abandoned members until resubmission", async () => {
    const store = path.join(directory(), "store");
    const h = await start(store);
    const delivery = lost(h.sequence(input()));
    await h.wait("parked", 2);
    const prefix = await h.get("beads/prefix");
    expect(prefix.status).toBe(200);
    expect(await h.get("beads/tail")).toMatchObject({ status: 404 });
    h.child.kill("SIGKILL");
    expect(await h.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(await delivery).toEqual({ delivered: false });
    const reopened = await start(store, Number(new URL(h.scope).port), false, false);
    expect(json(await reopened.get("beads/prefix"))).toEqual(json(prefix));
    expect(await reopened.get("beads/tail")).toMatchObject({ status: 404 });
    expect(await reopened.get("alias/prefix-name")).toMatchObject({ status: 404 });
    // The ordinary executable has completed recovery and serves reads. Only this
    // explicit resubmission is allowed to execute the formerly abandoned tail.
    const retry = await reopened.sequence(input());
    expect(retry).toMatchObject({
      status: 200,
      body: {
        results: [
          { outcome: "created" },
          { code: "resource-not-found" },
          { outcome: "created" },
          { outcome: "created" },
        ],
      },
    });
    expect(await reopened.get("beads/tail")).toMatchObject({ status: 200 });
    expect(json(await reopened.sequence(input()))).toEqual(json(retry));
    expect(await reopened.stop()).toEqual({ code: 0, signal: null });
  }, 15000);
});
