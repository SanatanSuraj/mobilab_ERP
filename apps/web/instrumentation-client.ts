/**
 * Next.js client-side instrumentation hook (Next 15.3+). Runs after HTML
 * loads, before React hydrates — the right window to attach error tracking
 * before any user code executes.
 *
 * DSN comes from NEXT_PUBLIC_SENTRY_DSN so it's compiled into the browser
 * bundle. When unset, init() is called with an empty DSN; the SDK treats
 * that as a disabled state, so dev/preview builds without an account stay
 * functional with zero overhead.
 *
 * Captured automatically by the SDK:
 *   - window 'error' / 'unhandledrejection' (runtime errors)
 *   - failed fetch() / XHR via BrowserTracing (API failures)
 *   - React render errors via the App Router boundary (re-thrown to here)
 *
 * onRouterTransitionStart is the App Router navigation hook — required so
 * Sentry's tracing can stitch a single trace across client-side route
 * changes.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

Sentry.init({
  dsn,
  enabled: dsn.length > 0,
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
    process.env.NODE_ENV ??
    "development",
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: Number(
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1,
  ),
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: Number(
    process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? 0,
  ),
  initialScope: { tags: { surface: "web-client" } },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
