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
