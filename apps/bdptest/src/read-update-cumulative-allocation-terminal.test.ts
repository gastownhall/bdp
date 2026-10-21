/** NEW synthetic helper failure controls only; no installed allocator/product credit. */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { launchRUAllocation } from "../test-support/read-update-cumulative-allocation-launch.js";

for (const scenario of ["startup-and-close", "signal-close", "output-overflow"] as const) {
  it(`retains safe owned terminal reporting for ${scenario}`, async () => {
    const failures: unknown[] = [];
    let directory: string | undefined;
    let run: ReturnType<typeof launchRUAllocation> | undefined;
    let terminal: unknown;
    try {
      directory = await mkdtemp(path.join(tmpdir(), "allocation-helper-negative-"));
      const modules = {
        "installed-reference-configuration.js":
          "export const captureInstalledReferenceConfiguration = x => x;",
        "development-composition.js": "export const createDevelopmentComposition = () => ({});",
        "development-runtime.js": `export const assemblePreparedDevelopmentArguments = () => [{},{},{},{}];
export const startDevelopmentReferenceRuntime = async () => {
${scenario === "output-overflow" ? 'process.stdout.write("x".repeat(70000)); await new Promise(r => setTimeout(r,10000));' : ""}
return {scope:'https://fixture.invalid/',close:async()=>{throw Error('SYNTHETIC_PRIVATE_CLOSE_DETAIL')}};
};`,
        "installed-payload.js":
          scenario === "startup-and-close"
            ? "export const installedPayloadIdentity = async () => {throw Error('SYNTHETIC_PRIVATE_STARTUP_DETAIL')};"
            : "export const installedPayloadIdentity = async () => 'synthetic-helper-only';",
        "recovery-store.js": "// synthetic control; never a native allocator witness\n",
      };
      for (const [name, source] of Object.entries(modules))
        await writeFile(path.join(directory, name), source);
      run = launchRUAllocation(path.join(directory, "unused-entry.js"), {
        scope: "https://fixture.invalid/",
        host: "127.0.0.1",
        port: 1,
      });
      if (scenario === "signal-close") {
        await run.ready;
        expect(run.child.kill("SIGTERM")).toBe(true);
      } else await expect(run.ready).rejects.toThrow("exited before ready");
      terminal = await run.close();
      const result = terminal as {
        code: number | null;
        signal: string | null;
        stderr: string;
        overflow: boolean;
        forced: boolean;
        forcedReason: string | null;
        stdoutEOF: boolean;
        stderrEOF: boolean;
        reaped: boolean;
      };
      expect(result).toMatchObject({ stdoutEOF: true, stderrEOF: true, reaped: true });
      if (scenario === "output-overflow") {
        expect(result).toMatchObject({
          signal: "SIGKILL",
          overflow: true,
          forced: true,
          forcedReason: "output-overflow",
        });
      } else {
        expect(result).toMatchObject({
          code: 2,
          signal: null,
          overflow: false,
          forced: false,
          forcedReason: null,
        });
        expect(result.stderr).toContain("ALLOCATION_FIXTURE_CLOSE_REFUSED\n");
        if (scenario === "startup-and-close")
          expect(result.stderr).toContain("ALLOCATION_FIXTURE_STARTUP_REFUSED\n");
        expect(result.stderr).not.toMatch(/SYNTHETIC_PRIVATE|Unhandled|AggregateError|Error:/);
      }
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        if (run) terminal = await run.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        if (directory) {
          await rm(directory, { recursive: true, force: true });
          await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "synthetic terminal control failed");
    expect(terminal).toBeDefined();
  }, 20000);
}
