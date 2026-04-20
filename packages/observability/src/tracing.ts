/**
 * OpenTelemetry tracing boot. Call initTracing() at the VERY TOP of the
 * service entrypoint, before any other import that does I/O. If you import
 * pg / fastify / redis before this, auto-instrumentation won't patch them.
 *
 * ARCHITECTURE.md §7. OTLP HTTP exporter points at OTEL_EXPORTER_OTLP_ENDPOINT,
 * which in dev is the otel-collector in docker-compose.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { Resource } from "@opentelemetry/resources";
import type {
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

export interface InitTracingOptions {
  serviceName: string;
  serviceVersion?: string;
  /**
   * Phase 1 Gate 7 — the gate test injects an InMemorySpanExporter here
   * so assertions can read back the exported spans. Production leaves it
   * unset and gets the OTLP HTTP exporter pointed at the collector.
   */
  traceExporter?: SpanExporter;
  /**
   * Optional explicit span processor. Use `SimpleSpanProcessor` in tests
   * so spans are exported synchronously instead of the default 5s batch.
   * If set, it takes priority over `traceExporter`.
   */
  spanProcessor?: SpanProcessor;
}

let sdk: NodeSDK | undefined;

export function initTracing(opts: InitTracingOptions): void {
  if (sdk) return; // idempotent

  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

  const sdkOptions: ConstructorParameters<typeof NodeSDK>[0] = {
    resource: new Resource({
      [ATTR_SERVICE_NAME]: opts.serviceName,
      [ATTR_SERVICE_VERSION]: opts.serviceVersion ?? "0.1.0",
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new PgInstrumentation({
        // Keep statements out of traces by default — they can carry PII.
        // Flip with OTEL_PG_ENHANCED=true in dev if you need to debug.
        enhancedDatabaseReporting:
          process.env.OTEL_PG_ENHANCED === "true",
      }),
    ],
  };

  if (opts.spanProcessor) {
    // NodeSDK bundles its own sdk-trace-base, one minor ahead of ours.
    // Private members (`_spanContext`) make the two SpanProcessor types
    // nominally incompatible even though they're structurally identical.
    // Cast is safe: at runtime there's one real class.
    sdkOptions.spanProcessor =
      opts.spanProcessor as unknown as typeof sdkOptions.spanProcessor;
  } else {
    sdkOptions.traceExporter =
      opts.traceExporter ??
      new OTLPTraceExporter({
        url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
      });
  }

  sdk = new NodeSDK(sdkOptions);
  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
