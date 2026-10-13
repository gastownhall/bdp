import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const entry = new URL(
  "../../../packages/server/dist/installed-reference-process.js",
  import.meta.url,
);
function run(args: string[], ipc = false) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: "/tmp",
      stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("import probe deadline"));
    }, 5000);
    child.stdout?.on("data", (b) => (stdout += b));
    child.stderr?.on("data", (b) => (stderr += b));
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
it.each([false, true])(
  "non-entry import leaves process state and listeners unchanged (IPC=%s)",
  async (ipc) => {
    const dir = mkdtempSync(path.join(tmpdir(), "bdp-inert-import-"));
    const source = path.join(dir, "importer.mjs");
    writeFileSync(
      source,
      `const events=["message","disconnect","SIGTERM","SIGINT"]; const before=events.map(e=>process.listenerCount(e)); const code=process.exitCode; await import(${JSON.stringify(entry.href)}); console.log(JSON.stringify({sameCode:process.exitCode===code,before,after:events.map(e=>process.listenerCount(e))})); if(process.connected)process.disconnect();`,
    );
    try {
      const result = await run([source], ipc);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      const observed = JSON.parse(result.stdout);
      expect(observed.sameCode).toBe(true);
      expect(observed.after).toEqual(observed.before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
it("direct execution without inherited IPC refuses without exposing input", async () => {
  const result = await run([fileURLToPath(entry)]);
  expect(result.code).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("installed reference qualification failed\n");
});
