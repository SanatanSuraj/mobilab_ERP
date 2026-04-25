"use client";

/**
 * App Router root error boundary. Triggered when an error escapes every
 * other error.tsx in the tree and reaches the layout. We forward the
 * error to Sentry before rendering the fallback so it lands in the
 * dashboard alongside the auto-captured window errors.
 *
 * This file MUST contain its own <html>/<body> because it replaces the
 * root layout when invoked (the layout is the very thing that crashed).
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    Sentry.captureException(error);
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
