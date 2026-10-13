/** Bounded observation of a deliberately nonterminal raw HTTP/1.1 stream.
 * Separate from the finite exact executor: closing is not a completed response. */
import { connect } from "node:net";
export function recordRawSse(options: {
  dial: string;
  host: string;
  target: string;
  headers: readonly [string, string][];
  method?: "GET" | "HEAD";
  signal: AbortSignal;
  timeoutMs?: number;
}) {
  const started = performance.now();
  const ready = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  void ready.promise.catch(() => {});
  const address = new URL(options.dial);
  const socket = connect({ host: address.hostname, port: Number(address.port) });
  const chunks: Buffer[] = [];
  let total = 0,
    status = 0,
    headers: Record<string, string> = {},
    body = "",
    failure: unknown;
  const subscribers = new Set<() => void>();
  const abort = () =>
    socket.destroy(
      options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error("SSE observation aborted"),
    );
  const timer = setTimeout(
    () => socket.destroy(new Error("SSE observation deadline")),
    options.timeoutMs ?? 25000,
  );
  options.signal.addEventListener("abort", abort, { once: true });
  socket.once("connect", () => {
    if (options.signal.aborted) {
      abort();
      return;
    }
    const lines: readonly (readonly [string, string])[] = [
      ["Host", options.host],
      ["Connection", "close"],
      ...options.headers,
    ];
    if (lines.some(([k, v]) => /[\r\n]/.test(k + v)) || /[\r\n ]/.test(options.target)) {
      socket.destroy(new Error("invalid raw request fixture"));
      return;
    }
    socket.write(
      `${options.method ?? "GET"} ${options.target} HTTP/1.1\r\n${lines.map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`,
    );
  });
  socket.on("data", (chunk: Buffer) => {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) {
      socket.destroy(new Error("SSE observation wire bound"));
      return;
    }
    chunks.push(Buffer.from(chunk));
    try {
      const wire = Buffer.concat(chunks);
      const end = wire.indexOf("\r\n\r\n");
      if (end < 0) {
        if (wire.length > 16384) throw new Error("SSE header bound");
        return;
      }
      if (end > 16384) throw new Error("SSE header bound");
      const lines = wire.subarray(0, end).toString("latin1").split("\r\n");
      status = Number(lines.shift()?.split(" ")[1]);
      headers = Object.fromEntries(
        lines.map((line) => {
          const colon = line.indexOf(":");
          return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
        }),
      );
      const bytes = wire.subarray(end + 4);
      if (headers["transfer-encoding"] === "chunked") {
        const decoded: Buffer[] = [];
        let offset = 0;
        while (offset < bytes.length) {
          const lineEnd = bytes.indexOf("\r\n", offset);
          if (lineEnd < 0) break;
          const line = bytes.subarray(offset, lineEnd).toString("ascii");
          if (!/^[0-9a-f]+$/i.test(line)) throw new Error("unexpected chunk framing");
          const length = Number.parseInt(line, 16);
          if (bytes.length < lineEnd + 2 + length + 2) break;
          decoded.push(bytes.subarray(lineEnd + 2, lineEnd + 2 + length));
          offset = lineEnd + 2 + length + 2;
          if (length === 0) break;
        }
        body = Buffer.concat(decoded).toString("utf8");
      } else body = bytes.toString("utf8");
      ready.resolve();
      for (const notify of subscribers) notify();
    } catch (error) {
      socket.destroy(error instanceof Error ? error : new Error("SSE decoder failure"));
    }
  });
  socket.once("error", (error) => {
    failure = error;
    ready.reject(error);
  });
  socket.once("close", () => {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    ready.reject(failure ?? new Error("SSE socket closed before headers"));
    closed.resolve();
    for (const notify of subscribers) notify();
  });
  if (options.signal.aborted) abort();
  return {
    ready: ready.promise,
    closed: closed.promise,
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
    get body() {
      return body;
    },
    get frames() {
      return body.split("\n\n").slice(0, -1);
    },
    get wireBytes() {
      return Buffer.concat(chunks);
    },
    get elapsedMs() {
      return performance.now() - started;
    },
    get destroyed() {
      return socket.destroyed;
    },
    async until(predicate: () => boolean): Promise<void> {
      if (predicate()) return;
      await new Promise<void>((resolve, reject) => {
        const notify = () => {
          if (predicate()) {
            subscribers.delete(notify);
            resolve();
          } else if (socket.destroyed) {
            subscribers.delete(notify);
            reject(failure ?? new Error("SSE closed before observation"));
          }
        };
        subscribers.add(notify);
        notify();
      });
    },
    async close() {
      socket.destroy();
      await closed.promise;
    },
  };
}
