/**
 * Prometheus metrics. Each service exposes /metrics (or pushes via sidecar)
 * with a shared registry. ARCHITECTURE.md §7.
 *
 * Conventions (OpenTelemetry / Prometheus naming):
 *   - counters         end in `_total`
 *   - histograms (ms)  end in `_duration_ms`
 *   - gauges           descriptive noun (e.g. `outbox_queue_depth`)
 *
 * Register per-metric in the owning module — never define metrics inline in
 * request handlers (they'd re-register on reload).
 */

import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from "prom-client";

export const registry = new Registry();

// Default node metrics — event loop lag, GC, heap, etc. Cheap, high signal.
collectDefaultMetrics({ register: registry, prefix: "instigenie_" });

// ─── Standard metrics used across services ────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: "instigenie_http_requests_total",
  help: "HTTP requests by method / route / status.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationMs = new Histogram({
  name: "instigenie_http_request_duration_ms",
  help: "HTTP request duration in ms, excluding keep-alive idle.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [registry],
});

/** Outbox rows that haven't been dispatched yet. Alert if > threshold. */
export const outboxDepth = new Gauge({
  name: "instigenie_outbox_depth",
  help: "Rows in outbox.events where dispatched_at IS NULL.",
  registers: [registry],
});

/** Job processing stats for BullMQ workers. */
export const jobsProcessedTotal = new Counter({
  name: "instigenie_jobs_processed_total",
  help: "Completed / failed jobs by queue.",
  labelNames: ["queue", "status"] as const,
  registers: [registry],
});

export const jobDurationMs = new Histogram({
  name: "instigenie_job_duration_ms",
  help: "Job processing latency in ms.",
  labelNames: ["queue"] as const,
  buckets: [10, 50, 100, 500, 1000, 5000, 15000, 60000, 300000],
  registers: [registry],
});

/**
 * ARCHITECTURE.md §10.3 CRITICAL alert `erp_audit_chain_break` fires when
 * the daily qc_certs hash-chain sweep (see apps/worker audit-hashchain
 * processor, Phase 4 §4.2) finds one or more tampered chains. The counter
 * is bumped once per (org_id) detected as broken during a run — this is
 * a compliance incident, not a performance metric.
 *
 * Alertmanager rule (abridged):
 *   rate(erp_audit_chain_break_total[15m]) > 0   →   page on-call
 */
export const auditChainBreakTotal = new Counter({
  name: "erp_audit_chain_break_total",
  help: "Hash-chain break events detected by the daily audit sweep, by org.",
  labelNames: ["org_id"] as const,
  registers: [registry],
});

/** Wall-clock duration of the full audit sweep — not per-org. */
export const auditChainRunDurationMs = new Histogram({
  name: "instigenie_audit_chain_run_duration_ms",
  help: "End-to-end hash-chain audit sweep duration.",
  buckets: [100, 500, 1000, 5000, 15000, 60000, 300000],
  registers: [registry],
});
