/** Source-private one-frame-at-a-time pump for change groups and Events. */
import { constants } from "node:buffer";
import { setTimeout as delay, setImmediate as yieldTurn } from "node:timers/promises";
import { stringifyJsonValue } from "@bdp/protocol";
import {
  TRANSACTION_CHANGEFEED_BYTES,
  type TransactionChangefeedPage,
} from "./transaction-changefeed.js";

import { TRANSACTION_EVENT_STREAM } from "./transaction-events.js";
import type { TransactionEvent } from "./transaction-batch.js";
import type { TransactionEventPacket, TransactionEventScan } from "./transaction-store.js";

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
export const TRANSACTION_EVENT_FRAME_BYTES = TRANSACTION_EVENT_STREAM.packetBytes + 512;
if (TRANSACTION_EVENT_FRAME_BYTES >= constants.MAX_STRING_LENGTH)
  throw new Error("pinned runtime cannot encode the bounded Event frame");
if (TRANSACTION_SSE_FRAME_BYTES >= constants.MAX_STRING_LENGTH)
  throw new Error("pinned runtime cannot encode the bounded changefeed frame");

export function transactionChangeFrame(group: TransactionChangefeedPage["groups"][number]): string {
  return `id: ${group.checkpoint}\nevent: change-group\ndata: ${stringifyJsonValue(group)}\n\n`;
}

export function transactionEventFrame(event: TransactionEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${stringifyJsonValue(event)}\n\n`;
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

interface Packet<Item, Cursor> {
  readonly items: readonly Item[];
  readonly continuation: Cursor;
  readonly caughtUp: boolean;
}
type Timers = { readonly pollMilliseconds: number; readonly heartbeatMilliseconds: number };
/** One private delivery loop. It retains only the current packet; continuations
 * advance after its final drain, never on a speculative owner pull. */
async function pump<Item, Cursor>(
  sink: Sink,
  initial: Packet<Item, Cursor> | undefined,
  next: (cursor: Cursor, signal: AbortSignal) => Promise<Packet<Item, Cursor>>,
  frame: (item: Item) => string,
  signal: AbortSignal,
  settings: Timers,
): Promise<void> {
  validateTransactionStreamTimers(settings);
  let packet = initial;
  initial = undefined;
  let lastWrite = performance.now();
  while (packet && !signal.aborted) {
    for (const item of packet.items) {
      await write(sink, frame(item), signal);
      lastWrite = performance.now();
    }
    const continuation = packet.continuation,
      caughtUp = packet.caughtUp;
    packet = undefined;
    // Empty historical packets must keep this check active too. Comments obey
    // the same write/drain barrier; no timer queues independent writes.
    if (performance.now() - lastWrite >= settings.heartbeatMilliseconds) {
      await write(sink, ": heartbeat\n\n", signal);
      lastWrite = performance.now();
    }
    if (caughtUp) await delay(settings.pollMilliseconds, undefined, { signal });
    else await yieldTurn(undefined, { signal });
    signal.throwIfAborted();
    packet = await next(continuation, signal);
  }
}
function changePacket(page: TransactionChangefeedPage) {
  return {
    items: page.groups,
    continuation: page.groups.at(-1)?.checkpoint ?? page.after,
    caughtUp: page.groups.length === 0,
  };
}
function eventPacket(packet: TransactionEventPacket) {
  return { items: packet.events, continuation: packet.scan, caughtUp: packet.caughtUp };
}
export function pumpTransactionChanges(
  sink: Sink,
  initial: TransactionChangefeedPage,
  next: (after: string, signal: AbortSignal) => Promise<TransactionChangefeedPage>,
  signal: AbortSignal,
  settings: Timers = TRANSACTION_SSE_DEFAULTS,
): Promise<void> {
  return pump(
    sink,
    changePacket(initial),
    async (after, signal) => changePacket(await next(after, signal)),
    transactionChangeFrame,
    signal,
    settings,
  );
}
export function pumpTransactionEvents(
  sink: Sink,
  initial: TransactionEventPacket,
  next: (scan: TransactionEventScan, signal: AbortSignal) => Promise<TransactionEventPacket>,
  signal: AbortSignal,
  settings: Timers = TRANSACTION_SSE_DEFAULTS,
): Promise<void> {
  return pump(
    sink,
    eventPacket(initial),
    async (scan, signal) => eventPacket(await next(scan, signal)),
    transactionEventFrame,
    signal,
    settings,
  );
}
