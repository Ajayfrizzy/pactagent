export async function runWithJobDeadline<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Job exceeded ${timeoutMs}ms execution deadline.`));
  }, timeoutMs);
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => {
        reject(controller.signal.reason instanceof Error ? controller.signal.reason : new Error('Job aborted.'));
      }, { once: true })),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
