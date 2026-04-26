/**
 * Typed client for /onboarding/* — guided post-invite setup.
 *
 * All calls are admin-authed (the Fastify side gates with
 * `admin:settings:manage`). A non-admin token will get 403; we don't
 * try to recover, the wizard is admin-only.
 *
 * Wire shapes from @instigenie/contracts; never redeclare here.
 */

import type {
  OnboardingFeedback,
  OnboardingProgress,
  StartOnboardingRequest,
  SubmitOnboardingFeedbackRequest,
  UpdateOnboardingProgressRequest,
} from "@instigenie/contracts";
import { ApiProblem, tenantGet, tenantPost } from "./tenant-fetch";

/** GET /onboarding — null when the wizard hasn't been started yet. */
export async function apiGetOnboarding(): Promise<OnboardingProgress | null> {
  try {
    return await tenantGet<OnboardingProgress>("/onboarding");
  } catch (err) {
    if (err instanceof ApiProblem && err.problem.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * POST /onboarding/start — idempotent. First call creates the row + (if
 * `useSampleData`) seeds a minimal demo set. Subsequent calls return
 * the existing row unchanged — the UI can re-mount the start page
 * without worrying about double-seeding.
 */
export async function apiStartOnboarding(
  body: StartOnboardingRequest,
): Promise<OnboardingProgress> {
  return tenantPost<OnboardingProgress>("/onboarding/start", body);
}

/** POST /onboarding/progress — mark a wizard step complete. Idempotent. */
export async function apiMarkOnboardingStep(
  body: UpdateOnboardingProgressRequest,
): Promise<OnboardingProgress> {
  return tenantPost<OnboardingProgress>("/onboarding/progress", body);
}

/**
 * POST /onboarding/feedback — capture the "was this easy?" pulse.
 * Append-only; resubmitting writes a new row rather than overwriting.
 */
export async function apiSubmitOnboardingFeedback(
  body: SubmitOnboardingFeedbackRequest,
): Promise<OnboardingFeedback> {
  return tenantPost<OnboardingFeedback>("/onboarding/feedback", body);
}
