/**
 * Gate 24 — ARCHITECTURE.md Phase 1 Gate 7 "OTel traces connect".
 *
 * Spec:
 *   "A single HTTP request appears as one trace with child spans for pg
 *    query and Redis get. Verified against Jaeger in CI."
 *
 * Redis auto-instrumentation isn't in the current stack (see
 * packages/observability/src/tracing.ts), so this gate covers what IS
 * wired: HTTP + pg. When redis instrumentation lands, extend this file
 * with the redis arm rather than creating a parallel test.
 *
 * How we do it without Jaeger:
 *   1. Inject a SimpleSpanProcessor(InMemorySpanExporter) into @mobilab/
 *      observability's initTracing(). Synchronous export, no 5s batch
 *      delay, and nothing leaves the process.
 *   2. DYNAMICALLY import `pg` AFTER initTracing runs so the
 *      PgInstrumentation's require hook fires and patches the module.
 *      A static `import pg from "pg"` at the top of this file would
 *      resolve the module before beforeAll() executes and skip patching.
 *   3. Open an HTTP server with a route that does a pg query.
 *   4. Fetch that URL from the same process — the HTTP auto-instrumentation
 *      creates a parent span; the pg driver creates child spans for the
 *      query.
 *   5. Read the exporter's .getFinishedSpans(), assert traceId shared and
 *      that the pg span is a descendant of the HTTP server span.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { initTracing, shutdownTracing } from "@mobilab/observability/tracing";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace, SpanKind } from "@opentelemetry/api";
import type * as HttpModule from "node:http";

// Inline the dev URL rather than importing from _helpers (which pulls pg at
// the top level). We need pg's first load to happen AFTER initTracing().
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://mobilab_app:mobilab_dev@localhost:5434/mobilab";

type PgPool = import("pg").Pool;

describe("gate-24 (arch-7): OTel traces connect (HTTP → pg child)", () => {
  const exporter = new InMemorySpanExporter();
  let server: HttpModule.Server;
  let serverUrl = "";
  let pool: PgPool;

  beforeAll(async () => {
    // Wire the in-memory exporter BEFORE pg or any http server is created.
    // Use SimpleSpanProcessor so spans export synchronously — BatchSpan-
    // Processor's default 5s flush window would blow our test timeout.
    initTracing({
      serviceName: "gate-24",
      spanProcessor: new SimpleSpanProcessor(exporter),
    });

    // Vitest uses its own module loader which bypasses Node's native
    // require-in-the-middle hook — so `import pg from "pg"` (or `import
    // http from "node:http"`) won't trigger the OpenTelemetry auto-
    // instrumentations. Using createRequire forces a real CJS require
    // through Node's native loader, where the OTel require hook is
    // installed and can patch the module.
    const cjsRequire = createRequire(import.meta.url);
    const pg = cjsRequire("pg") as typeof import("pg");
    const http = cjsRequire("node:http") as typeof HttpModule;
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 2,
      application_name: "gate-24",
    });

    server = http.createServer((_req, res) => {
      void (async () => {
        try {
          await pool.query("SELECT 1 AS one");
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      })();
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const addr = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${addr.port}/ping`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (pool) await pool.end();
    await shutdownTracing();
  });

  it("HTTP parent + pg child share a trace id, with pg parented by the HTTP span", async () => {
    exporter.reset();

    const res = await fetch(serverUrl);
    expect(res.status).toBe(200);
    await res.json();

    // Auto-instrumentations finish their spans asynchronously. Give them a
    // couple of event-loop ticks and a short wall-clock window to flush
    // into the SimpleSpanProcessor.
    await waitForSpans(exporter, { minSpans: 2, timeoutMs: 2_000 });

    const spans = exporter.getFinishedSpans();
    // In a healthy setup we expect: 1 server HTTP span + 1 client HTTP
    // (outgoing fetch) + 1+ pg span. We don't pin the exact count.
    expect(spans.length).toBeGreaterThanOrEqual(2);

    const httpServerSpans = spans.filter((s) => s.kind === SpanKind.SERVER);
    expect(httpServerSpans.length).toBeGreaterThanOrEqual(1);
    const httpServer = httpServerSpans[0]!;

    const pgSpans = spans.filter((s) => /pg\.query|SELECT/i.test(s.name));
    expect(pgSpans.length).toBeGreaterThanOrEqual(1);
    const pgSpan = pgSpans[0]!;

    // Shared trace id.
    expect(pgSpan.spanContext().traceId).toBe(
      httpServer.spanContext().traceId
    );

    // pg is a descendant of the http server span. It might be direct or
    // one hop (pg-pool). Walk up by matching parentSpanId until we hit
    // the http server span or run out of spans.
    expect(isDescendantOf(pgSpan, httpServer, spans)).toBe(true);
  });

  it("manual parent span + nested pg query: child's parent is the manual span", async () => {
    exporter.reset();
    const tracer = trace.getTracer("gate-24");
    await tracer.startActiveSpan("gate-24.manual-root", async (root) => {
      await pool.query("SELECT 2 AS two");
      root.end();
    });

    await waitForSpans(exporter, { minSpans: 2, timeoutMs: 1_000 });

    const spans = exporter.getFinishedSpans();
    const rootSpan = spans.find((s) => s.name === "gate-24.manual-root");
    expect(rootSpan).toBeDefined();
    const pgSpan = spans.find((s) => /pg\.query|SELECT/i.test(s.name));
    expect(pgSpan).toBeDefined();

    expect(pgSpan!.spanContext().traceId).toBe(
      rootSpan!.spanContext().traceId
    );
    // Direct parent linkage.
    expect(pgSpan!.parentSpanId).toBe(rootSpan!.spanContext().spanId);
  });
});

async function waitForSpans(
  exporter: InMemorySpanExporter,
  opts: { minSpans: number; timeoutMs: number }
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    if (exporter.getFinishedSpans().length >= opts.minSpans) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

type ReadableSpan = ReturnType<InMemorySpanExporter["getFinishedSpans"]>[number];

function isDescendantOf(
  child: ReadableSpan,
  ancestor: ReadableSpan,
  all: readonly ReadableSpan[]
): boolean {
  let currentParent = child.parentSpanId;
  for (let hops = 0; hops < 10 && currentParent; hops++) {
    if (currentParent === ancestor.spanContext().spanId) return true;
    const next = all.find((s) => s.spanContext().spanId === currentParent);
    if (!next) return false;
    currentParent = next.parentSpanId;
  }
  return false;
}
