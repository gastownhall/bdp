/** Test-only ownership of the real-bd matrix work deadline and ordered cleanup.
 * The Vitest emergency timeout remains outside this helper: a cleanup deadline
 * is not proof that an uncooperative operation has settled. */
export interface MatrixPhase {
  readonly phase: string;
  readonly event:
    | "work"
    | "work-deadline"
    | "parent-abort"
    | "cleanup"
    | "cleanup-settled"
    | "cleanup-failed";
  readonly elapsedMs: number;
}

interface MatrixLifecycleOptions {
  readonly signal: AbortSignal;
  readonly workTimeoutMs: number;
  readonly report: (event: MatrixPhase) => void;
  readonly cleanup: readonly { readonly phase: string; readonly run: () => void | Promise<void> }[];
}

export interface MatrixWork {
  readonly signal: AbortSignal;
  /** Records the next work phase, refusing any new work after cancellation. */
  phase(name: string): void;
  /** Cleanup must remain observable and executable after cancellation. */
  cleanupPhase(name: string): void;
}

export async function withMatrixLifecycle(
  options: MatrixLifecycleOptions,
  work: (context: MatrixWork) => Promise<void>,
): Promise<void> {
  const started = performance.now();
  let phase = "starting";
  const controller = new AbortController();
  const diagnosticErrors: unknown[] = [];
  const report = (event: MatrixPhase["event"]) => {
    try {
      options.report({ phase, event, elapsedMs: performance.now() - started });
    } catch (error) {
      // A broken diagnostic sink must fail the run, but cannot prevent a
      // deadline abort or skip any cleanup entry, especially withdrawal.
      diagnosticErrors.push(error);
    }
  };
  const abort = () => {
    report("parent-abort");
    controller.abort(options.signal.reason);
  };
  if (options.signal.aborted) abort();
  else options.signal.addEventListener("abort", abort, { once: true });
  const expire = () => {
    if (controller.signal.aborted) return;
    report("work-deadline");
    controller.abort(
      new Error(`bdpbd matrix work exceeded ${options.workTimeoutMs}ms in ${phase}`),
    );
  };
  const check = () => {
    // A busy event loop may delay the timer. Crossing a work boundary must not
    // admit successful work beyond the budget merely because it has not fired.
    if (performance.now() - started >= options.workTimeoutMs) expire();
    controller.signal.throwIfAborted();
  };
  const deadline = setTimeout(expire, options.workTimeoutMs);
  deadline.unref();
  let failed = false;
  let failure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    check();
    await work({
      signal: controller.signal,
      phase(name) {
        check();
        phase = name;
        report("work");
        if (diagnosticErrors.length > 0) {
          controller.abort(diagnosticErrors[0]);
          throw diagnosticErrors[0];
        }
      },
      cleanupPhase(name) {
        phase = name;
        report("cleanup");
      },
    });
    check();
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    clearTimeout(deadline);
    options.signal.removeEventListener("abort", abort);
    // Await work settlement before cleanup; never abandon its promise in a race.
    // All entries run even if an earlier cleanup fails (withdrawal belongs last).
    for (const cleanup of options.cleanup) {
      phase = cleanup.phase;
      report("cleanup");
      try {
        await cleanup.run();
        report("cleanup-settled");
      } catch (error) {
        cleanupErrors.push(error);
        report("cleanup-failed");
      }
    }
  }
  const secondaryErrors = [...cleanupErrors, ...diagnosticErrors].filter(
    (error) => !failed || error !== failure,
  );
  if (secondaryErrors.length > 0)
    throw new AggregateError(
      failed ? [failure, ...secondaryErrors] : secondaryErrors,
      "bdpbd matrix work, cleanup or diagnostics failed",
      ...(failed ? [{ cause: failure }] : []),
    );
  if (failed) throw failure;
}
