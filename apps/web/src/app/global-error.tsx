"use client";

/**
 * App Router root error boundary. Triggered when an error escapes every
 * other error.tsx in the tree and reaches the layout. Errors are POSTed
 * to a server endpoint that wraps Sentry on the server side — keeping
 * the client bundle out of @sentry/nextjs (which pulled ~150KB into the
 * shared client chunk just for this one captureException call).
 *
 * Server-side Sentry (instrumentation.ts) still captures SSR / Route
 * Handler / Server Action errors via Sentry.captureRequestError. The
 * thing this trades off is the in-browser SDK's auto-tagging of
 * client-only context (URL, user agent) — we send those manually below.
 *
 * This file MUST contain its own <html>/<body> because it replaces the
 * root layout when invoked (the layout is the very thing that crashed).
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    // Best-effort report. Failing the report must NOT crash again — the
    // error boundary is the last line of defence — so swallow everything.
    // `keepalive: true` lets the request finish if the user navigates away.
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        url: typeof window !== "undefined" ? window.location.href : null,
        userAgent:
          typeof window !== "undefined" ? window.navigator.userAgent : null,
      }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          padding: "2rem",
          color: "#0f172a",
        }}
      >
        <div style={{ maxWidth: 560, margin: "4rem auto" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ color: "#475569", marginBottom: 16 }}>
            The page failed to render. The error has been recorded and the
            engineering team has been notified.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: 12,
                color: "#64748b",
              }}
            >
              ref: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 24,
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
