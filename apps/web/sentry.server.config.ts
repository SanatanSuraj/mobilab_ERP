/**
 * Sentry — server runtime initialisation.
 *
 * Loaded by `instrumentation.ts` register() the first time the Next server
 * boots in node runtime. DSN is read from SENTRY_DSN at boot. When the env
 * var is unset (e.g. local dev without an account) we still call init() with
 * an empty DSN so Sentry stays a no-op rather than throwing — the SDK
 * special-cases empty DSN as "disabled".
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? "";

Sentry.init({
  dsn,
  enabled: dsn.length > 0,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // Tag errors with the surface so an alert can route to the right team.
  initialScope: { tags: { surface: "web-server" } },
});
