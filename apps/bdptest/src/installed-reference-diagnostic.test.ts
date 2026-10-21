/** Focused qualification diagnostics, not a claim about an earlier CI cause. */

import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const entry = fileURLToPath(
  new URL("../../../packages/server/dist/installed-reference-process.js", import.meta.url),
);
const { qualificationFailureDiagnostic } = (await import(new URL(`file://${entry}`).href)) as {
  qualificationFailureDiagnostic(
    error: unknown,
    phase: "configuration" | "candidate-start",
  ): unknown;
};
const helpers = (await import(
  new URL("../../../scripts/installed-reference-observation.mjs", import.meta.url).href
)) as {
  referenceConfiguration(directory: string, port: number, token: string): unknown;
  launchInstalledReference(
    entry: string,
    configuration: unknown,
  ): Promise<{ close(): Promise<unknown> }>;
};
it("qualification diagnostic exposes only fixed phase, class and allowlisted errno", () => {
  const original = Object.assign(new Error("sentinel secret path and credential"), {
    code: "EADDRINUSE",
    address: "sentinel-secret",
    port: 1234,
  });
  expect(
    qualificationFailureDiagnostic(
      new Error("wrapper secret", { cause: original }),
      "candidate-start",
    ),
  ).toEqual({
    event: "qualification.failed",
    phase: "candidate-start",
    errorClass: "Error",
    code: "EADDRINUSE",
  });
  const unknown = Object.assign(new TypeError("sentinel-secret"), { code: "sentinel-secret" });
  expect(qualificationFailureDiagnostic(unknown, "configuration")).toEqual({
    event: "qualification.failed",
    phase: "configuration",
    errorClass: "TypeError",
    code: null,
  });
});
it("qualification diagnostic never invokes code/cause accessors or formats arbitrary input", () => {
  let reads = 0;
  const original = new Error("sentinel-secret");
  Object.defineProperties(original, {
    code: {
      get() {
        reads++;
        throw new Error("sentinel-secret");
      },
    },
    cause: {
      get() {
        reads++;
        throw new Error("sentinel-secret");
      },
    },
  });
  expect(qualificationFailureDiagnostic(original, "configuration")).toEqual({
    event: "qualification.failed",
    phase: "configuration",
    errorClass: "Error",
    code: null,
  });
  expect(reads).toBe(0);
});
it("actual occupied listener reports EADDRINUSE without configuration or credential text", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "bdp-start-diagnostic-")),
    reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (address === null || typeof address === "string") throw new Error("missing held listener");
  let unexpected: Awaited<ReturnType<typeof helpers.launchInstalledReference>> | undefined;
  try {
    const configuration = helpers.referenceConfiguration(
      path.join(directory, "store"),
      address.port,
      "sentinel-secret-token-0123456789",
    );
    let failure: unknown;
    try {
      unexpected = await helpers.launchInstalledReference(entry, configuration);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const diagnostic = failure as Error & {
      qualification?: unknown;
      qualificationProcess?: unknown;
    };
    expect(diagnostic.qualification).toEqual({
      phase: "candidate-start",
      errorClass: "unknown",
      code: "EADDRINUSE",
    });
    expect(diagnostic.message).toContain('"code":"EADDRINUSE"');
    expect(diagnostic.message).toContain("installed child exited:");
    expect(diagnostic.message).toContain("installed reference qualification failed");
    expect(Object.keys(diagnostic)).not.toContain("qualificationProcess");
    expect(diagnostic.qualificationProcess).toMatchObject({ stdoutEOF: true, stderrEOF: true });
    expect(diagnostic.message).not.toContain("sentinel-secret");
    expect(diagnostic.message).not.toContain(directory);
    if (process.env.BDP_STARTUP_DIAG_OUTPUT)
      writeFileSync(
        process.env.BDP_STARTUP_DIAG_OUTPUT,
        `${JSON.stringify({ qualification: diagnostic.qualification, process: diagnostic.qualificationProcess }, null, 2)}\n`,
        { mode: 0o600 },
      );
  } finally {
    await unexpected?.close();
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
