/**
 * Structured logging via pino. ARCHITECTURE.md §7.
 *
 * Every log line must carry enough context to correlate across services:
 *   - traceId / spanId — automatically injected by the OTel hook
 *   - orgId, userId   — injected by the API request context
 *   - service         — set at boot (api, worker, listen-notify)
 *
 * Redaction: password fields, tokens, and cookie headers are scrubbed
 * automatically. Do not rely on "I'll never log this" — rely on the list.
 */

import { pino, type Logger } from "pino";
import { trace } from "@opentelemetry/api";

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  "*.password",
  "*.passwordHash",
  "*.accessToken",
  "*.refreshToken",
  "*.apiKey",
  "*.secret",
  // nested once, e.g. { user: { password } }
  "*.*.password",
  "*.*.accessToken",
  "*.*.refreshToken",
  "*.*.apiKey",
];

export interface CreateLoggerOptions {
  /** `api`, `worker`, `listen-notify`. Tags every line with service=<value>. */
  service: string;
  /** Override log level. Defaults to LOG_LEVEL env var, then "info". */
  level?: string;
  /** NODE_ENV override for pretty printing. Auto-detected otherwise. */
  pretty?: boolean;
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const level =
    opts.level ?? process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info");
  const pretty = opts.pretty ?? process.env.NODE_ENV !== "production";

  return pino({
    level,
    base: {
      service: opts.service,
      env: process.env.NODE_ENV ?? "development",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    // Inject OTel trace context on every record when a span is active.
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const ctx = span.spanContext();
      return { traceId: ctx.traceId, spanId: ctx.spanId };
    },
    ...(pretty
      ? {
          transport: {
            target: "pino/file",
            options: { destination: 1 },
          },
        }
      : {}),
  });
}

export type { Logger };
