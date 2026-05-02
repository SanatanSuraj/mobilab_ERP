/**
 * Vendor password-reset routes — three public (unauthenticated) endpoints
 * mounted under the vendor-admin surface.
 *
 *   POST /vendor-admin/auth/forgot-password
 *   GET  /vendor-admin/auth/reset-password/preview
 *   POST /vendor-admin/auth/reset-password
 *
 * Wire shapes are identical to the tenant flow (Forgot/Preview/Reset
 * schemas reused from @instigenie/contracts) — only the endpoint paths
 * and the underlying tables differ.
 */

import type { FastifyInstance } from "fastify";

import {
  ForgotPasswordRequestSchema,
  ResetPasswordPreviewQuerySchema,
  ResetPasswordRequestSchema,
} from "@instigenie/contracts";

import type { VendorPasswordResetService } from "./service.js";

export interface RegisterVendorPasswordResetRoutesOptions {
  service: VendorPasswordResetService;
  /** Per-email rate limit config (5/hour) — see apps/api/src/index.ts. */
  forgotPasswordRateLimit: Record<string, unknown>;
}

export async function registerVendorPasswordResetRoutes(
  app: FastifyInstance,
  opts: RegisterVendorPasswordResetRoutesOptions,
): Promise<void> {
  app.post(
    "/vendor-admin/auth/forgot-password",
    { config: { rateLimit: opts.forgotPasswordRateLimit } },
    async (req, reply) => {
    const body = ForgotPasswordRequestSchema.parse(req.body ?? {});
    const result = await opts.service.forgot(req, body);
    return reply.code(200).send(result);
  });

  app.get("/vendor-admin/auth/reset-password/preview", async (req, reply) => {
    const query = ResetPasswordPreviewQuerySchema.parse(req.query ?? {});
    const result = await opts.service.preview(query);
    return reply.code(200).send(result);
  });

  app.post("/vendor-admin/auth/reset-password", async (req, reply) => {
    const body = ResetPasswordRequestSchema.parse(req.body ?? {});
    const result = await opts.service.reset(req, body);
    return reply.code(200).send(result);
  });
}
