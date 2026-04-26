/**
 * Onboarding contracts — guided post-invite setup flow.
 *
 * One row per tenant in `onboarding_progress` (migration 0003). The flow:
 *
 *   1. Vendor-admin provisions tenant + admin user-invitation (existing).
 *   2. Admin accepts invite via /auth/accept-invite (existing).
 *   3. First login lands on /onboarding/start, which calls
 *      POST /onboarding/start with their picked industry. If
 *      `useSampleData=true`, the backend seeds a minimal demo set
 *      (1 warehouse, 1 item, 1 customer, 1 vendor) inside the same
 *      transaction so a re-attempted start that crashes mid-seed
 *      doesn't leave half-rows behind.
 *   4. Subsequent steps mark themselves complete via /onboarding/progress.
 *
 * The step list is a string-literal union — adding a step is a change
 * here + a wizard page; no DB migration. Order is the canonical
 * checklist order rendered in the UI.
 */

import { z } from "zod";

// ─── Industry ────────────────────────────────────────────────────────────────

export const OnboardingIndustrySchema = z.enum(["MANUFACTURING", "TRADING"]);
export type OnboardingIndustry = z.infer<typeof OnboardingIndustrySchema>;

// ─── Step keys ───────────────────────────────────────────────────────────────

/**
 * Canonical list — the wizard renders the checklist in this order. New
 * steps go at the end unless inserting changes a Phase milestone.
 */
export const ONBOARDING_STEPS = [
  "company_setup",
  "warehouse_added",
  "product_added",
  "customer_added",
  "vendor_added",
  "first_so_created",
  "first_invoice_created",
  "first_payment_recorded",
] as const;

export const OnboardingStepSchema = z.enum(ONBOARDING_STEPS);
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;

// ─── API: start ──────────────────────────────────────────────────────────────

export const StartOnboardingRequestSchema = z.object({
  industry: OnboardingIndustrySchema,
  /**
   * When true, seed 1 warehouse + 1 item + 1 customer + 1 vendor inside
   * the same transaction as the progress row. Idempotent: a second
   * /start call against an org that already has a row never re-seeds.
   */
  useSampleData: z.boolean().default(false),
});
export type StartOnboardingRequest = z.infer<typeof StartOnboardingRequestSchema>;

// ─── API: mark a step complete ───────────────────────────────────────────────

export const UpdateOnboardingProgressRequestSchema = z.object({
  step: OnboardingStepSchema,
});
export type UpdateOnboardingProgressRequest = z.infer<
  typeof UpdateOnboardingProgressRequestSchema
>;

// ─── Response shape ──────────────────────────────────────────────────────────

// ─── API: feedback ───────────────────────────────────────────────────────────

/**
 * 3-bucket pulse, not a 5-star rating. Star ratings cluster at the
 * extremes and lose signal; "yes / somewhat / no" maps cleanly to
 * "ship more / fix the friction / fix the blockers".
 */
export const OnboardingEaseSchema = z.enum(["YES", "SOMEWHAT", "NO"]);
export type OnboardingEase = z.infer<typeof OnboardingEaseSchema>;

export const SubmitOnboardingFeedbackRequestSchema = z.object({
  easy: OnboardingEaseSchema,
  /** Free text. Capped at 4 KiB to bound row size. */
  comment: z.string().trim().max(4096).optional(),
});
export type SubmitOnboardingFeedbackRequest = z.infer<
  typeof SubmitOnboardingFeedbackRequestSchema
>;

export const OnboardingFeedbackSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  easy: OnboardingEaseSchema,
  comment: z.string().nullable(),
  createdAt: z.string(),
});
export type OnboardingFeedback = z.infer<typeof OnboardingFeedbackSchema>;

// ─── Response shape ──────────────────────────────────────────────────────────

export const OnboardingProgressSchema = z.object({
  orgId: z.string().uuid(),
  industry: OnboardingIndustrySchema,
  stepsCompleted: z.array(OnboardingStepSchema),
  sampleDataSeeded: z.boolean(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Server-computed convenience: `stepsCompleted.length / ONBOARDING_STEPS.length`,
   * rounded down to the nearest percent. The UI renders this directly so
   * "100%" can never disagree with `completedAt !== null`.
   */
  percentComplete: z.number().int().min(0).max(100),
});
export type OnboardingProgress = z.infer<typeof OnboardingProgressSchema>;
