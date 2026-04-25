/**
 * Sentry — edge runtime initialisation. Loaded by `instrumentation.ts`
 * register() when NEXT_RUNTIME === "edge". The init contract is identical
 * to the node side; the SDK swaps internal transports automatically.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? "";

Sentry.init({
  dsn,
  enabled: dsn.length > 0,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  initialScope: { tags: { surface: "web-edge" } },
});
