/** Source-private one-frame-at-a-time changefeed pump. No Event Source SSE. */
import { constants } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import { stringifyJsonValue } from "@bdp/protocol";
import {
  TRANSACTION_CHANGEFEED_BYTES,
  type TransactionChangefeedPage,
} from "./transaction-changefeed.js";

export const TRANSACTION_SSE_DEFAULTS = Object.freeze({
  pollMilliseconds: 100,
  heartbeatMilliseconds: 5000,
  maximumStreams: 1,
});
/** Node timers clamp invalid/out-of-range values; refuse rather than busy-poll. */
export function validateTransactionStreamTimers(
  settings: { readonly pollMilliseconds: number; readonly heartbeatMilliseconds: number },
  idleTimeout?: number,
): void {
  for (const value of [settings.pollMilliseconds, settings.heartbeatMilliseconds])
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
      throw new TypeError("invalid transaction stream timer");
  if (idleTimeout !== undefined && settings.heartbeatMilliseconds >= idleTimeout)
    throw new TypeError("stream heartbeat must precede socket idle timeout");
}
// Includes id/event/data framing beyond the already bounded finite page. This
// is a source-derived proof, never a new post-commit rejection of a legal group.
export const TRANSACTION_SSE_FRAME_BYTES = TRANSACTION_CHANGEFEED_BYTES + 512;
if (TRANSACTION_SSE_FRAME_BYTES >= constants.MAX_STRING_LENGTH)
  throw new Error("pinned runtime cannot encode the bounded changefeed frame");

export function transactionChangeFrame(group: TransactionChangefeedPage["groups"][number]): string {
  return `id: ${group.checkpoint}\nevent: change-group\ndata: ${stringifyJsonValue(group)}\n\n`;
}

interface Sink {
  readonly destroyed: boolean;
  write(value: string): boolean;
  once(event: "drain" | "close", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  removeListener(
    event: "drain" | "error" | "close",
    listener: (() => void) | ((error: Error) => void),
  ): unknown;
}
/** write(false) accepted this frame into Node, but permits no subsequent owner
 * read/comment until drain. It is not a client replica acknowledgement. */
async function write(sink: Sink, value: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (sink.destroyed) throw new Error("stream transport closed");
  if (sink.write(value)) return;
  await new Promise<void>((resolve, reject) => {
    const clean = () => {
      sink.removeListener("drain", drained);
      sink.removeListener("error", failed);
      sink.removeListener("close", closed);
      signal.removeEventListener("abort", aborted);
    };
    const drained = () => {
      clean();
      resolve();
    };
    const failed = (error: unknown) => {
      clean();
      reject(error);
    };
    const closed = () => failed(new Error("stream transport closed"));
    const aborted = () => failed(signal.reason);
    sink.once("drain", drained);
    sink.once("error", failed);
    sink.once("close", closed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else if (sink.destroyed) closed();
  });
}

export async function pumpTransactionChanges(
  sink: Sink,
  initial: TransactionChangefeedPage,
  next: (after: string, signal: AbortSignal) => Promise<TransactionChangefeedPage>,
  signal: AbortSignal,
  settings: {
    readonly pollMilliseconds: number;
    readonly heartbeatMilliseconds: number;
  } = TRANSACTION_SSE_DEFAULTS,
): Promise<void> {
  validateTransactionStreamTimers(settings);
  let page = initial;
  let after = page.after;
  let lastWrite = performance.now();
  while (!signal.aborted) {
    for (const group of page.groups) {
      await write(sink, transactionChangeFrame(group), signal);
      after = group.checkpoint;
      lastWrite = performance.now();
    }
    if (page.groups.length === 0) {
      if (performance.now() - lastWrite >= settings.heartbeatMilliseconds) {
        await write(sink, ": heartbeat\n\n", signal);
        lastWrite = performance.now();
      }
      await delay(settings.pollMilliseconds, undefined, { signal });
    }
    signal.throwIfAborted();
    page = await next(after, signal);
  }
}
