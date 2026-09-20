import { afterEach, describe, expect, it, vi } from "vitest";
import { type MatrixPhase, withMatrixLifecycle } from "./matrix-lifecycle.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("matrix test lifecycle", () => {
  it("aborts owned work, drains settlement, cleans up and withdraws before rejecting", async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const remove = vi.spyOn(parent.signal, "removeEventListener");
    const order: string[] = [];
    const phases: MatrixPhase[] = [];
    const run = withMatrixLifecycle(
      {
        signal: parent.signal,
        workTimeoutMs: 90,
        report: (event) => phases.push(event),
        cleanup: [
          {
            phase: "close",
            run: () => {
              order.push("close");
            },
          },
          {
            phase: "withdraw",
            run: () => {
              order.push("withdraw");
            },
          },
        ],
      },
      async ({ signal, phase }) => {
        phase("scenario/wait");
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              order.push("abort");
              setTimeout(() => {
                order.push("settled");
                resolve();
              }, 5);
            },
            { once: true },
          );
        });
        phase("must-not-run");
        order.push("forbidden-work");
      },
    );
    const rejected = expect(run).rejects.toThrow("exceeded 90ms in scenario/wait");
    await vi.advanceTimersByTimeAsync(90);
    expect(order).toEqual(["abort"]);
    await vi.advanceTimersByTimeAsync(5);
    await rejected;
    expect(order).toEqual(["abort", "settled", "close", "withdraw"]);
    expect(phases.map(({ event, phase }) => `${event}:${phase}`)).toEqual([
      "work:scenario/wait",
      "work-deadline:scenario/wait",
      "cleanup:close",
      "cleanup-settled:close",
      "cleanup:withdraw",
      "cleanup-settled:withdraw",
    ]);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["work-deadline", "cleanup"] as const)(
    "a throwing %s diagnostic cannot prevent cancellation, cleanup or withdrawal",
    async (throwOn) => {
      vi.useFakeTimers();
      const diagnostic = new Error("stderr diagnostic failed");
      const order: string[] = [];
      let threw = false;
      let abortReason: unknown;
      const run = withMatrixLifecycle(
        {
          signal: new AbortController().signal,
          workTimeoutMs: 90,
          report: ({ event }) => {
            if (event === throwOn && !threw) {
              threw = true;
              throw diagnostic;
            }
          },
          cleanup: [
            {
              phase: "close",
              run: () => {
                order.push("close");
              },
            },
            {
              phase: "withdraw",
              run: () => {
                order.push("withdraw");
              },
            },
          ],
        },
        async ({ signal, phase }) => {
          phase("waiting");
          await new Promise<void>((resolve) =>
            signal.addEventListener(
              "abort",
              () => {
                abortReason = signal.reason;
                order.push("abort");
                resolve();
              },
              { once: true },
            ),
          );
          order.push("settled");
          signal.throwIfAborted();
        },
      );
      const result = run.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(90);
      const failure = await result;
      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure).toMatchObject({ cause: abortReason, errors: [abortReason, diagnostic] });
      expect(abortReason).toBeInstanceOf(Error);
      expect((abortReason as Error).message).toContain("exceeded 90ms in waiting");
      expect(order).toEqual(["abort", "settled", "close", "withdraw"]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["same", "different"] as const)(
    "cancels on a work diagnostic and preserves %s-instance cleanup diagnostics",
    async (repeated) => {
      const diagnostic = new Error("work report failed");
      const second = new Error("cleanup report failed");
      const order: string[] = [];
      const events: string[] = [];
      let operationSignal: AbortSignal | undefined;
      const failure = await withMatrixLifecycle(
        {
          signal: new AbortController().signal,
          workTimeoutMs: 90_000,
          report: ({ event, phase }) => {
            events.push(`${event}:${phase}`);
            if (event === "work" || repeated === "same") throw diagnostic;
            if (event === "cleanup") throw second;
          },
          cleanup: [
            {
              phase: "withdraw",
              run: () => {
                order.push("withdraw");
              },
            },
          ],
        },
        async ({ signal, phase }) => {
          operationSignal = signal;
          try {
            phase("refused");
          } catch {
            expect(signal.aborted).toBe(true);
            expect(signal.reason).toBe(diagnostic);
          }
          // A runner may classify the first prepare failure; the next phase must
          // refuse through the cancelled signal before producing another event.
          phase("must-not-report");
          order.push("forbidden-work");
        },
      ).catch((error: unknown) => error);
      expect(operationSignal?.aborted).toBe(true);
      expect(operationSignal?.reason).toBe(diagnostic);
      expect(order).toEqual(["withdraw"]);
      expect(events).toEqual(["work:refused", "cleanup:withdraw", "cleanup-settled:withdraw"]);
      if (repeated === "same") expect(failure).toBe(diagnostic);
      else expect(failure).toMatchObject({ cause: diagnostic, errors: [diagnostic, second] });
    },
  );

  it("preserves the primary failure and all cleanup errors while withdrawing last", async () => {
    const primary = new Error("matrix failure");
    const close = new Error("close failure");
    const remove = new Error("root removal failure");
    const order: string[] = [];
    const failure = await withMatrixLifecycle(
      {
        signal: new AbortController().signal,
        workTimeoutMs: 90_000,
        report: () => undefined,
        cleanup: [
          {
            phase: "close",
            run: () => {
              order.push("close");
              throw close;
            },
          },
          {
            phase: "root",
            run: () => {
              order.push("root");
              throw remove;
            },
          },
          {
            phase: "withdraw",
            run: () => {
              order.push("withdraw");
            },
          },
        ],
      },
      async () => {
        throw primary;
      },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({ cause: primary, errors: [primary, close, remove] });
    expect(order).toEqual(["close", "root", "withdraw"]);
  });

  it("preserves caller cancellation and never starts pre-aborted work", async () => {
    const parent = new AbortController();
    const reason = new Error("caller cancelled");
    parent.abort(reason);
    const work = vi.fn(async () => undefined);
    const withdraw = vi.fn();
    await expect(
      withMatrixLifecycle(
        {
          signal: parent.signal,
          workTimeoutMs: 90_000,
          report: () => undefined,
          cleanup: [{ phase: "withdraw", run: withdraw }],
        },
        work,
      ),
    ).rejects.toBe(reason);
    expect(work).not.toHaveBeenCalled();
    expect(withdraw).toHaveBeenCalledOnce();
  });

  it("relays a live parent abort and preserves its exact reason after cleanup", async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const reason = new Error("parent emergency abort");
    const order: string[] = [];
    const phases: MatrixPhase[] = [];
    const run = withMatrixLifecycle(
      {
        signal: parent.signal,
        workTimeoutMs: 90_000,
        report: (event) => phases.push(event),
        cleanup: [
          {
            phase: "withdraw",
            run: () => {
              order.push("withdraw");
            },
          },
        ],
      },
      async ({ signal }) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              order.push("abort");
              resolve();
            },
            { once: true },
          ),
        );
        order.push("settled");
        signal.throwIfAborted();
      },
    );
    const rejected = expect(run).rejects.toBe(reason);
    parent.abort(reason);
    await rejected;
    expect(order).toEqual(["abort", "settled", "withdraw"]);
    expect(phases.map(({ event, phase }) => `${event}:${phase}`)).toEqual([
      "parent-abort:starting",
      "cleanup:withdraw",
      "cleanup-settled:withdraw",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails on cleanup alone even after work completed", async () => {
    const close = new Error("close refused");
    const withdraw = vi.fn();
    await expect(
      withMatrixLifecycle(
        {
          signal: new AbortController().signal,
          workTimeoutMs: 90_000,
          report: () => undefined,
          cleanup: [
            {
              phase: "close",
              run: () => {
                throw close;
              },
            },
            { phase: "withdraw", run: withdraw },
          ],
        },
        async () => undefined,
      ),
    ).rejects.toMatchObject({ errors: [close] });
    expect(withdraw).toHaveBeenCalledOnce();
  });

  it("refuses elapsed work even when the event loop delayed the deadline timer", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const withdraw = vi.fn();
    await expect(
      withMatrixLifecycle(
        {
          signal: new AbortController().signal,
          workTimeoutMs: 90,
          report: () => undefined,
          cleanup: [{ phase: "withdraw", run: withdraw }],
        },
        async ({ phase }) => {
          phase("synchronous-work");
          now = 91;
        },
      ),
    ).rejects.toThrow("exceeded 90ms in synchronous-work");
    expect(withdraw).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes timer and caller listener after the exact successful phase sequence", async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const remove = vi.spyOn(parent.signal, "removeEventListener");
    const phases: MatrixPhase[] = [];
    await withMatrixLifecycle(
      {
        signal: parent.signal,
        workTimeoutMs: 90_000,
        report: (event) => phases.push(event),
        cleanup: [{ phase: "withdraw", run: () => undefined }],
      },
      async ({ phase }) => {
        phase("observed-work");
      },
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(phases.map(({ event, phase }) => `${event}:${phase}`)).toEqual([
      "work:observed-work",
      "cleanup:withdraw",
      "cleanup-settled:withdraw",
    ]);
  });
});
