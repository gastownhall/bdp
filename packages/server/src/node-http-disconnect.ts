interface NodeHttpDisconnectSource {
  once(event: "aborted", listener: () => void): unknown;
}

interface NodeHttpResponseCloseSource {
  readonly writableFinished: boolean;
  once(event: "close", listener: () => void): unknown;
}

/** Propagates either Node-side disconnect signal into one Web AbortSignal. */
export function createNodeHttpDisconnectSignal(
  incoming: NodeHttpDisconnectSource,
  outgoing: NodeHttpResponseCloseSource,
): AbortSignal {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("client disconnected"));
  incoming.once("aborted", abort);
  outgoing.once("close", () => {
    if (!outgoing.writableFinished) abort();
  });
  return controller.signal;
}
