/**
 * Password-reset routes — three public (unauthenticated) endpoints.
 *
 *   POST /auth/forgot-password           — body: { email }
 *   GET  /auth/reset-password/preview    — query: ?token=...
 *   POST /auth/reset-password            — body: { token, newPassword }
 *
 * No authGuard: the user is by definition signed-out. The reset token in
 * the email IS the auth — single-use, 1-hour expiry, SHA-256 hashed at
 * rest. Per-identity rate limiting lives in the service. The global
 * 300/min/IP limit registered in apps/api/src/index.ts caps abuse against
 * this surface end-to-end.
 */

import type { FastifyInstance } from "fastify";

import {
  ForgotPasswordRequestSchema,
  ResetPasswordPreviewQuerySchema,
  ResetPasswordRequestSchema,
} from "@instigenie/contracts";

import type { PasswordResetService } from "./service.js";

export interface RegisterPasswordResetRoutesOptions {
  service: PasswordResetService;
  /**
   * @fastify/rate-limit per-route config (5/hour/email — see
   * apps/api/src/index.ts). Applied via route config.rateLimit on
   * /auth/forgot-password only. Preview + reset routes are gated by
   * token possession (a 32-byte unguessable secret), so they inherit
   * the global 300/min/IP limit.
   */
  forgotPasswordRateLimit: Record<string, unknown>;
}

export async function registerPasswordResetRoutes(
  app: FastifyInstance,
  opts: RegisterPasswordResetRoutesOptions,
): Promise<void> {
  app.post(
    "/auth/forgot-password",
    { config: { rateLimit: opts.forgotPasswordRateLimit } },
    async (req, reply) => {
      const body = ForgotPasswordRequestSchema.parse(req.body ?? {});
      const result = await opts.service.forgot(req, body);
      return reply.code(200).send(result);
    },
  );

  app.get("/auth/reset-password/preview", async (req, reply) => {
    const query = ResetPasswordPreviewQuerySchema.parse(req.query ?? {});
    const result = await opts.service.preview(query);
    return reply.code(200).send(result);
  });

  app.post("/auth/reset-password", async (req, reply) => {
    const body = ResetPasswordRequestSchema.parse(req.body ?? {});
    const result = await opts.service.reset(req, body);
    return reply.code(200).send(result);
  });
}
