/**
 * @instigenie/observability — logger + tracer + metrics, wired together.
 *
 * Service entrypoint order matters:
 *   1. import { initTracing } from "@instigenie/observability/tracing";
 *      initTracing({ serviceName: "api" });
 *   2. ...any other import that does I/O
 *   3. import { createLogger, registry } from "@instigenie/observability";
 */

export { createLogger, type Logger } from "./logger.js";
export { initTracing, shutdownTracing } from "./tracing.js";
export {
  registry,
  httpRequestsTotal,
  httpRequestDurationMs,
  outboxDepth,
  jobsProcessedTotal,
  jobDurationMs,
  auditChainBreakTotal,
  auditChainRunDurationMs,
  dlqWritesTotal,
  dlqDepth,
} from "./metrics.js";
