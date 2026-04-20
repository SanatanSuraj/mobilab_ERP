/**
 * Retry with full jitter exponential backoff. ARCHITECTURE.md §6.
 *
 * Formula (AWS "full jitter"):
 *   sleep = random(0, min(cap, base * 2^attempt))
 *
 * This is provably better than "equal jitter" / "decorrelated" at spreading
 * load when many clients retry simultaneously.
 */

export interface RetryOptions {
  /** Maximum attempts, including the first. Default 3. */
  maxAttempts?: number;
  /** Initial delay ceiling in ms. Default 100. */
  baseMs?: number;
  /** Hard ceiling on any single sleep in ms. Default 5000. */
  capMs?: number;
  /** Return true if the error should be retried. Default: always retry. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Per-attempt callback — useful for logging. */
  onAttempt?: (err: unknown, attempt: number, sleepMs: number) => void;
  /** AbortSignal — abort propagates through. */
  signal?: AbortSignal;
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseMs = opts.baseMs ?? 100;
  const capMs = opts.capMs ?? 5000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    opts.signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const ceiling = Math.min(capMs, baseMs * 2 ** (attempt - 1));
      const sleepMs = Math.floor(Math.random() * ceiling);
      opts.onAttempt?.(err, attempt, sleepMs);
      await sleep(sleepMs, opts.signal);
    }
  }
  throw lastErr; // unreachable, but TS wants it
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true }
    );
  });
}
