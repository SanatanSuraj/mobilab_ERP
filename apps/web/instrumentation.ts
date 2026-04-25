/**
 * Next.js server-side instrumentation hook. Called once per server instance
 * before the first request is handled. We split node vs. edge so the
 * runtime-specific Sentry transport is only loaded where it's usable.
 *
 * onRequestError forwards every captured server error to Sentry — covers
 * Server Component renders, Route Handlers, Server Actions, and the proxy
 * layer. The SDK's captureRequestError walks the error + request shape and
 * stamps the right context.
 */

import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
