import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Writable } from "node:stream";
import type { CanonicalInputReader } from "./canonical-input.js";

/** Acquisition, rather than just the decoded value, is bounded. */
export async function readBoundedFile(path: string, maximum: number): Promise<Uint8Array> {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum) throw new Error("input exceeds file bound");
    const bytes = new Uint8Array(maximum + 1);
    let used = 0;
    while (used <= maximum) {
      const result = await file.read(bytes, used, maximum + 1 - used);
      if (result.bytesRead === 0) return bytes.slice(0, used);
      used += result.bytesRead;
    }
    throw new Error("input exceeds file bound");
  } finally {
    await file.close();
  }
}

export function canonicalInputReader(signal?: AbortSignal): CanonicalInputReader {
  let consumed = false;
  return {
    readFile: readBoundedFile,
    async readStdin(maximum) {
      if (consumed) throw new Error("stdin has already been consumed");
      consumed = true;
      const chunks: Uint8Array[] = [];
      let length = 0;
      signal?.throwIfAborted();
      const interrupt = () => process.stdin.destroy(signal?.reason);
      signal?.addEventListener("abort", interrupt, { once: true });
      try {
        for await (const chunk of process.stdin) {
          const bytes = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Uint8Array);
          length += bytes.byteLength;
          if (length > maximum) throw new Error("stdin exceeds input bound");
          chunks.push(bytes);
        }
        return Buffer.concat(chunks);
      } finally {
        signal?.removeEventListener("abort", interrupt);
      }
    },
  };
}

/** Private recovery records are published durably before the first POST. No
 * credentials are written. Never overwrite a record or follow a supplied path. */
export async function saveCanonicalJournal(value: unknown): Promise<string> {
  const root = join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "bdp",
    "retry",
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, `${randomUUID()}.json`);
  const temporary = `${path}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return path;
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export class CanonicalOutputError extends Error {
  constructor() {
    super("BDP output failed");
  }
}
/** Await the write callback, which settles only after queued bytes drain. Keep
 * an error listener through the error event following a failed callback. */
export function writeCanonicalOutput(
  stream: Writable,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const interrupt = () => {
      signal?.removeEventListener("abort", interrupt);
      // A consumer that stops draining must not make Ctrl-C wait forever.
      stream.destroy();
      reject(signal?.reason);
    };
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener("abort", interrupt, { once: true });
    const failed = () => {
      signal?.removeEventListener("abort", interrupt);
      stream.removeListener("error", failed);
      reject(new CanonicalOutputError());
    };
    stream.once("error", failed);
    try {
      stream.write(text, (error) => {
        if (error) {
          reject(new CanonicalOutputError());
          return;
        }
        signal?.removeEventListener("abort", interrupt);
        stream.removeListener("error", failed);
        resolve();
      });
    } catch {
      signal?.removeEventListener("abort", interrupt);
      stream.removeListener("error", failed);
      reject(new CanonicalOutputError());
    }
  });
}
