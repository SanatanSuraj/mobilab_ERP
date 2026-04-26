/**
 * Onboarding repository — single-row-per-tenant CRUD on
 * `onboarding_progress` (migration 0003).
 *
 * Every method takes a `client: PoolClient` so the caller controls the
 * transaction. The service composes get + insert + sample-data seed
 * inside one `withRequest()` so a crash mid-seed leaves the row absent
 * (idempotent retry works).
 */

import type { PoolClient } from "pg";
import type {
  OnboardingEase,
  OnboardingFeedback,
  OnboardingIndustry,
  OnboardingProgress,
  OnboardingStep,
} from "@instigenie/contracts";
import { ONBOARDING_STEPS } from "@instigenie/contracts";

interface Row {
  org_id: string;
  industry: OnboardingIndustry;
  steps_completed: string[];
  sample_data_seeded: boolean;
  started_at: Date;
  completed_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToProgress(r: Row): OnboardingProgress {
  // Filter out any historical step keys that have since been retired
  // from the union. Keeps the response strictly typed; in practice
  // ONBOARDING_STEPS only ever grows.
  const valid = new Set<string>(ONBOARDING_STEPS as readonly string[]);
  const steps = r.steps_completed.filter((s) =>
    valid.has(s),
  ) as OnboardingStep[];
  const total = ONBOARDING_STEPS.length;
  const percent = Math.floor((steps.length / total) * 100);
  return {
    orgId: r.org_id,
    industry: r.industry,
    stepsCompleted: steps,
    sampleDataSeeded: r.sample_data_seeded,
    startedAt: r.started_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    percentComplete: percent,
  };
}

export const onboardingRepo = {
  async getByOrg(
    client: PoolClient,
    orgId: string,
  ): Promise<OnboardingProgress | null> {
    const { rows } = await client.query<Row>(
      `SELECT org_id, industry, steps_completed, sample_data_seeded,
              started_at, completed_at, created_by, created_at, updated_at
         FROM onboarding_progress
        WHERE org_id = $1`,
      [orgId],
    );
    return rows[0] ? rowToProgress(rows[0]) : null;
  },

  /**
   * Insert the initial row. Caller has already verified no row exists.
   * `steps_completed` starts with `company_setup` (we know it's done —
   * the user just submitted the form) plus whichever sample-data
   * seeded steps the caller adds.
   */
  async insert(
    client: PoolClient,
    args: {
      orgId: string;
      industry: OnboardingIndustry;
      sampleDataSeeded: boolean;
      stepsCompleted: OnboardingStep[];
      createdBy: string | null;
    },
  ): Promise<OnboardingProgress> {
    const { rows } = await client.query<Row>(
      `INSERT INTO onboarding_progress
         (org_id, industry, steps_completed, sample_data_seeded, created_by)
       VALUES ($1, $2, $3::text[], $4, $5)
       RETURNING org_id, industry, steps_completed, sample_data_seeded,
                 started_at, completed_at, created_by, created_at, updated_at`,
      [
        args.orgId,
        args.industry,
        args.stepsCompleted,
        args.sampleDataSeeded,
        args.createdBy,
      ],
    );
    return rowToProgress(rows[0]!);
  },

  async insertFeedback(
    client: PoolClient,
    args: {
      orgId: string;
      userId: string | null;
      easy: OnboardingEase;
      comment: string | null;
    },
  ): Promise<OnboardingFeedback> {
    const { rows } = await client.query<{
      id: string;
      org_id: string;
      user_id: string | null;
      easy: OnboardingEase;
      comment: string | null;
      created_at: Date;
    }>(
      `INSERT INTO onboarding_feedback (org_id, user_id, easy, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING id, org_id, user_id, easy, comment, created_at`,
      [args.orgId, args.userId, args.easy, args.comment],
    );
    const r = rows[0]!;
    return {
      id: r.id,
      orgId: r.org_id,
      userId: r.user_id,
      easy: r.easy,
      comment: r.comment,
      createdAt: r.created_at.toISOString(),
    };
  },

  /**
   * Mark a step complete. Idempotent: re-marking an already-complete
   * step is a no-op (we use array_append-with-distinct semantics).
   * Sets completed_at when the last step lands.
   */
  async markStep(
    client: PoolClient,
    orgId: string,
    step: OnboardingStep,
  ): Promise<OnboardingProgress | null> {
    const totalSteps = ONBOARDING_STEPS.length;
    const { rows } = await client.query<Row>(
      `UPDATE onboarding_progress
          SET steps_completed = (
                SELECT ARRAY(SELECT DISTINCT unnest(
                  array_append(steps_completed, $2)
                ))
              ),
              completed_at = CASE
                WHEN array_length(
                       (SELECT ARRAY(SELECT DISTINCT unnest(
                          array_append(steps_completed, $2)))),
                       1
                     ) >= $3
                THEN COALESCE(completed_at, now())
                ELSE completed_at
              END,
              updated_at = now()
        WHERE org_id = $1
        RETURNING org_id, industry, steps_completed, sample_data_seeded,
                  started_at, completed_at, created_by, created_at, updated_at`,
      [orgId, step, totalSteps],
    );
    return rows[0] ? rowToProgress(rows[0]) : null;
  },
};
