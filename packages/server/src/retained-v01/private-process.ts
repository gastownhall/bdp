/** Private acceptance-process entry. No bin, export, public startup or profile admission. */
import { writeSync } from "node:fs";
import { startPrivateRetainedFixture, type PrivateFixtureOptions } from "./http.js";

let fixture: Awaited<ReturnType<typeof startPrivateRetainedFixture>> | undefined;
process.once(
  "message",
  (
    input: PrivateFixtureOptions & {
      readonly barrier?: "resource-staged" | "alias-staged" | "committed";
    },
  ) => {
    void startPrivateRetainedFixture({
      ...input,
      onPhase: (phase) => {
        if (phase === input.barrier) {
          writeSync(1, `${JSON.stringify({ phase })}\n`);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000);
          throw new Error("unreleased private fault barrier");
        }
      },
    })
      .then((started) => {
        fixture = started;
        process.send?.({ kind: "ready", listenUrl: started.listenUrl, claimEligible: false });
      })
      .catch(() => {
        process.exitCode = 2;
        process.disconnect?.();
      });
  },
);
async function stop() {
  try {
    await fixture?.close();
    process.disconnect?.();
  } catch {
    process.exitCode = 2;
    process.disconnect?.();
  }
}
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
