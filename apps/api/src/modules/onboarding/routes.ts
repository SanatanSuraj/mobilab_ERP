/**
 * Onboarding routes — guided post-invite setup. Mounted at /onboarding/*.
 *
 *   GET  /onboarding              admin:settings:manage  → progress, 404 if not started
 *   POST /onboarding/start        admin:settings:manage  → idempotent: creates row, optionally seeds sample data
 *   POST /onboarding/progress     admin:settings:manage  → mark a step complete (Stage 2+ wizard pages call this)
 *
 * All routes require an authenticated admin. The vendor-admin surface
 * provisions the tenant + the admin invite separately; by the time a
 * request lands here the inviting org and the admin role are both real.
 */

import type { FastifyInstance } from "fastify";
import {
  StartOnboardingRequestSchema,
  SubmitOnboardingFeedbackRequestSchema,
  UpdateOnboardingProgressRequestSchema,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { OnboardingService } from "./service.js";

export interface RegisterOnboardingRoutesOptions {
  service: OnboardingService;
  guardInternal: AuthGuardOptions;
}

export async function registerOnboardingRoutes(
  app: FastifyInstance,
  opts: RegisterOnboardingRoutesOptions,
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);
  // Onboarding is administrative setup — gate behind the same
  // permission used by /admin/settings/* and the vendor-admin surface
  // for tenant configuration. SUPER_ADMIN holds it via ROLE_PERMISSIONS;
  // a limited Sales / Production / Finance role never reaches here.
  const guards = [authGuard, requirePermission("admin:settings:manage")];

  app.get(
    "/onboarding",
    { preHandler: guards },
    async (req, reply) => {
      const progress = await opts.service.getOrThrow(req);
      return reply.code(200).send(progress);
    },
  );

  app.post(
    "/onboarding/start",
    { preHandler: guards },
    async (req, reply) => {
      const body = StartOnboardingRequestSchema.parse(req.body ?? {});
      const progress = await opts.service.start(req, body);
      // 200 (not 201) because the call is idempotent — a re-call against
      // an already-started org returns the same row, and 201 would
      // misleadingly suggest "we just created something".
      return reply.code(200).send(progress);
    },
  );

  app.post(
    "/onboarding/progress",
    { preHandler: guards },
    async (req, reply) => {
      const body = UpdateOnboardingProgressRequestSchema.parse(req.body ?? {});
      const progress = await opts.service.markStep(req, body);
      return reply.code(200).send(progress);
    },
  );

  app.post(
    "/onboarding/feedback",
    { preHandler: guards },
    async (req, reply) => {
      const body = SubmitOnboardingFeedbackRequestSchema.parse(req.body ?? {});
      const feedback = await opts.service.submitFeedback(req, body);
      return reply.code(201).send(feedback);
    },
  );
}
