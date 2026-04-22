/**
 * Tiny HTTP transport for external API clients. ARCHITECTURE.md §3.4.
 *
 * Goals:
 *   - a single place to add per-request timeout, so each client doesn't
 *     reinvent AbortController;
 *   - an injection seam (`HttpFetch`) so gate tests can supply a fake
 *     fetch that throws on command — breakers don't need real sockets to
 *     prove they trip.
 *
 * Non-goals:
 *   - retries: the `@instigenie/resilience` retry() wrapper handles that at
 *     a higher level. The HTTP transport is intentionally a single attempt.
 *   - auth: each client adds its own auth header; this transport just
 *     shuttles whatever headers it's handed.
 */

/**
 * Minimal fetch shape we depend on — matches the global `fetch` but lets
 * tests substitute a stub. `typeof fetch` drags in more than we want, and
 * mocking `Response` from a test is awkward; this is simpler.
 */
export type HttpFetch = (input: string, init?: HttpInit) => Promise<HttpResponse>;

export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
}

export interface HttpCallOptions {
  /** Milliseconds. Default 5000. */
  timeoutMs?: number;
  /** Injected transport. Defaults to global fetch. */
  transport?: HttpFetch;
}

export class HttpTimeoutError extends Error {
  override readonly name = "HttpTimeoutError";
  constructor(
    public readonly url: string,
    public readonly timeoutMs: number,
  ) {
    super(`HTTP request to ${url} timed out after ${timeoutMs}ms`);
  }
}

export class HttpStatusError extends Error {
  override readonly name = "HttpStatusError";
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
  }
}

/**
 * One-shot HTTP call with timeout. Throws HttpTimeoutError on timeout,
 * HttpStatusError on non-2xx. The returned value is the parsed JSON body
 * (caller typecheck at the boundary).
 */
export async function httpJson<T>(
  url: string,
  init: HttpInit,
  opts: HttpCallOptions = {},
): Promise<T> {
  const transport = opts.transport ?? (globalThis.fetch as unknown as HttpFetch);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await transport(url, { ...init, signal: ac.signal });
    const body = await res.text();
    if (!res.ok) {
      throw new HttpStatusError(url, res.status, body);
    }
    try {
      return body ? (JSON.parse(body) as T) : (undefined as unknown as T);
    } catch {
      // Non-JSON 2xx body — surface as status error so the caller can
      // decide what to do (most APIs always return JSON on success).
      throw new HttpStatusError(url, res.status, body);
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "AbortError" ||
        (err as { code?: string }).code === "ABORT_ERR")
    ) {
      throw new HttpTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
