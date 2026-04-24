/**
 * RFC 7807 Problem+JSON error handler. ARCHITECTURE.md §5.
 *
 * Registered as a Fastify error handler — every uncaught error that reaches
 * the framework is translated here. AppErrors carry code+status+details;
 * anything else is a 500 `internal_error` with the stack logged but hidden
 * from the client.
 */

import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { isAppError } from "@instigenie/errors";
import { ZodError } from "zod";

export function registerProblemHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    // zod validation errors → 400
    if (err instanceof ZodError) {
      return sendProblem(req, reply, {
        code: "validation_error",
        status: 400,
        message: "Request failed validation",
        details: { issues: err.issues },
      });
    }

    if (isAppError(err)) {
      const p = err.toProblem();
      if (p.status >= 500) {
        req.log.error({ err }, "app error (5xx)");
      } else {
        req.log.warn({ err: { code: p.code, message: p.message } }, "app error");
      }
      return sendProblem(req, reply, p);
    }

    // Fastify's validation errors expose `validation` on FastifyError.
    const fErr = err as FastifyError;
    if (Array.isArray(fErr.validation)) {
      return sendProblem(req, reply, {
        code: "validation_error",
        status: fErr.statusCode ?? 400,
        message: fErr.message,
        details: { issues: fErr.validation },
      });
    }

    // Fastify's built-in framework errors — content-type parse failures,
    // body-limit exceeded, unsupported media type — arrive with a proper
    // 4xx `statusCode` and a `FST_ERR_*` code. Honor the status so the
    // client gets the right signal (400 / 413 / 415) instead of a generic
    // 500. We map to stable semantic codes rather than leaking Fastify's
    // internal identifiers.
    if (
      typeof fErr.code === "string" &&
      fErr.code.startsWith("FST_ERR_") &&
      typeof fErr.statusCode === "number" &&
      fErr.statusCode >= 400 &&
      fErr.statusCode < 500
    ) {
      const mapped = mapFastifyFrameworkError(fErr);
      req.log.warn({ err: { code: fErr.code, message: fErr.message } }, "fastify framework error");
      return sendProblem(req, reply, mapped);
    }

    // Unknown → 500. Do NOT leak the message — log it instead.
    //
    // NOTE: Fastify is booted with `logger: false` in apps/api/src/index.ts
    // so `req.log.*` is an abstract/no-op logger — nothing from the next
    // line reaches stdout. We additionally log to the process stderr via
    // console.error so unknown errors actually surface in dev. Once the
    // shared pino instance is wired into Fastify (options.loggerInstance),
    // the console.error can be dropped.
    console.error("[unhandled error]", req.method, req.url, err);
    req.log.error({ err }, "unhandled error");
    return sendProblem(req, reply, {
      code: "internal_error",
      status: 500,
      message: "Internal server error",
    });
  });
}

interface Problem {
  code: string;
  status: number;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Map Fastify framework errors (FST_ERR_*) to stable Problem shapes.
 * Keeps our external API surface stable — consumers shouldn't have to
 * recognise Fastify's internal error codes to handle a 400/413/415.
 */
function mapFastifyFrameworkError(err: FastifyError): Problem {
  const status = err.statusCode ?? 400;
  switch (err.code) {
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
    case "FST_ERR_CTP_INVALID_JSON_BODY":
    case "FST_ERR_CTP_INVALID_TYPE":
    case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
      return {
        code: "invalid_body",
        status,
        message: err.message,
      };
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return {
        code: "unsupported_media_type",
        status,
        message: err.message,
      };
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return {
        code: "payload_too_large",
        status,
        message: err.message,
      };
    default:
      // Any other 4xx Fastify error — fall back to a generic client_error
      // with the framework's message. Safe because these are framework-level
      // 4xx signals, not application errors that might leak internals.
      return {
        code: "client_error",
        status,
        message: err.message,
      };
  }
}

function sendProblem(
  req: FastifyRequest,
  reply: FastifyReply,
  p: Problem
): FastifyReply {
  return reply
    .code(p.status)
    .type("application/problem+json")
    .send({
      type: `https://instigenie.dev/problems/${p.code}`,
      title: p.code,
      status: p.status,
      detail: p.message,
      instance: req.url,
      code: p.code,
      ...(p.details ? { details: p.details } : {}),
    });
}
