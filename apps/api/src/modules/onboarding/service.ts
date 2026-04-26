/**
 * Onboarding service. Composes:
 *   - onboardingRepo (the progress row)
 *   - warehousesRepo / itemsRepo / accountsRepo / vendorsRepo (sample seed)
 *
 * Single transaction per /start call: the row insert AND any sample-data
 * inserts share one `withRequest()` so a partial failure rolls back
 * everything. A retried /start against an org that already has a row
 * returns the existing row unchanged — no duplicate seed, no error.
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import {
  ONBOARDING_STEPS,
  type OnboardingFeedback,
  type OnboardingProgress,
  type OnboardingStep,
  type StartOnboardingRequest,
  type SubmitOnboardingFeedbackRequest,
  type UpdateOnboardingProgressRequest,
} from "@instigenie/contracts";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import { withRequest } from "../shared/with-request.js";
import { requireUser } from "../../context/request-context.js";
import { onboardingRepo } from "./repository.js";
import { warehousesRepo } from "../inventory/warehouses.repository.js";
import { itemsRepo } from "../inventory/items.repository.js";
import { accountsRepo } from "../crm/accounts.repository.js";
import { vendorsRepo } from "../procurement/vendors.repository.js";

export interface OnboardingServiceDeps {
  pool: pg.Pool;
}

export class OnboardingService {
  constructor(private readonly deps: OnboardingServiceDeps) {}

  /**
   * Idempotent.
   *
   *   first call:  creates row, optionally seeds sample data, returns row
   *   subsequent:  returns existing row UNCHANGED — never re-seeds, never
   *                throws. Stage 1 wizard re-mounts can reload safely.
   */
  async start(
    req: FastifyRequest,
    input: StartOnboardingRequest,
  ): Promise<OnboardingProgress> {
    const user = requireUser(req);
    return withRequest(req, this.deps.pool, async (client) => {
      const existing = await onboardingRepo.getByOrg(client, user.orgId);
      if (existing) {
        // Already started — return as-is. We deliberately do NOT change
        // the industry on a re-call: that would let an admin silently
        // flip a tenant's classification post-setup. If they need to
        // change it, they can hit /onboarding/restart (Stage 2 follow-up).
        return existing;
      }

      const stepsCompleted: OnboardingStep[] = ["company_setup"];

      if (input.useSampleData) {
        const sampleSteps = await this.seedSampleData(client, user.orgId);
        stepsCompleted.push(...sampleSteps);
      }

      return onboardingRepo.insert(client, {
        orgId: user.orgId,
        industry: input.industry,
        sampleDataSeeded: input.useSampleData,
        stepsCompleted,
        createdBy: user.id,
      });
    });
  }

  async getOrThrow(req: FastifyRequest): Promise<OnboardingProgress> {
    const user = requireUser(req);
    return withRequest(req, this.deps.pool, async (client) => {
      const row = await onboardingRepo.getByOrg(client, user.orgId);
      if (!row) {
        throw new NotFoundError(
          "onboarding has not been started for this org",
        );
      }
      return row;
    });
  }

  /**
   * Capture a "was onboarding easy?" pulse. Append-only — an admin who
   * resubmits creates a second row rather than overwriting, so vendor-
   * admin trend reports see the full timeline. The org_id constraint
   * comes from the caller's JWT, not the body.
   */
  async submitFeedback(
    req: FastifyRequest,
    input: SubmitOnboardingFeedbackRequest,
  ): Promise<OnboardingFeedback> {
    return withRequest(req, this.deps.pool, async (client) => {
      const user = requireUser(req);
      return onboardingRepo.insertFeedback(client, {
        orgId: user.orgId,
        userId: user.id,
        easy: input.easy,
        comment: input.comment ?? null,
      });
    });
  }

  async markStep(
    req: FastifyRequest,
    input: UpdateOnboardingProgressRequest,
  ): Promise<OnboardingProgress> {
    return withRequest(req, this.deps.pool, async (client) => {
      const user = requireUser(req);
      const updated = await onboardingRepo.markStep(
        client,
        user.orgId,
        input.step,
      );
      if (!updated) {
        // No row to update — the caller hit /progress before /start.
        // 409 (not 404) because the conflict is "you skipped step 1",
        // not "this resource doesn't exist generically".
        throw new ConflictError(
          "onboarding has not been started — POST /onboarding/start first",
        );
      }
      return updated;
    });
  }

  // ─── Sample-data seed ──────────────────────────────────────────────────

  /**
   * Seed minimal sample data so the wizard's first-flow walkthrough
   * (Stage 3) has something to operate on. Returns the step keys to
   * mark as complete on the progress row.
   *
   * Defensive against pre-populated tenants: for each entity type we
   * first check whether the org already has at least one row, and
   * skip creation if so. This matters in two cases:
   *   1. Re-seeding the dev org, which already has fixtures from
   *      ops/sql/seed/* (warehouses, items, customers, vendors).
   *   2. A vendor admin re-runs onboarding for a tenant where the
   *      previous attempt half-completed before crashing.
   *
   * In both cases we still return the step keys as "complete" because
   * the *user-visible* invariant ("the org has at least one of each")
   * is satisfied — what matters is that the wizard's checklist is
   * truthful, not that we wrote fresh rows.
   */
  private async seedSampleData(
    client: pg.PoolClient,
    orgId: string,
  ): Promise<OnboardingStep[]> {
    const completed: OnboardingStep[] = [];

    // ── Warehouse ────────────────────────────────────────────────────
    let warehouseId: string | null = null;
    const existingWh = await client.query<{ id: string }>(
      `SELECT id FROM warehouses
        WHERE org_id = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [orgId],
    );
    if (existingWh.rows[0]) {
      warehouseId = existingWh.rows[0].id;
    } else {
      const w = await warehousesRepo.create(client, orgId, {
        code: "WH-MAIN",
        name: "Main Warehouse",
        kind: "PRIMARY",
        country: "IN",
        // First warehouse for this org → safe to mark default. The partial
        // unique index `warehouses_single_default` is keyed on (org_id)
        // WHERE is_default — so this is the one and only.
        isDefault: true,
        isActive: true,
      });
      warehouseId = w.id;
    }
    completed.push("warehouse_added");

    // ── Item ─────────────────────────────────────────────────────────
    const existingItem = await client.query<{ id: string }>(
      `SELECT id FROM items
        WHERE org_id = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [orgId],
    );
    if (!existingItem.rows[0]) {
      await itemsRepo.create(client, orgId, {
        sku: "SKU-0001",
        name: "Sample Product",
        description: "Example item — rename or delete once you add your own.",
        category: "FINISHED_GOOD",
        uom: "EA",
        unitCost: "0",
        defaultWarehouseId: warehouseId,
        isSerialised: false,
        isBatched: false,
        isActive: true,
      });
    }
    completed.push("product_added");

    // ── Customer (account) ───────────────────────────────────────────
    const existingAcct = await client.query<{ id: string }>(
      `SELECT id FROM accounts
        WHERE org_id = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [orgId],
    );
    if (!existingAcct.rows[0]) {
      await accountsRepo.create(client, orgId, {
        name: "Sample Customer Co",
        country: "IN",
        healthScore: 50,
        isKeyAccount: false,
      });
    }
    completed.push("customer_added");

    // ── Vendor ───────────────────────────────────────────────────────
    const existingVendor = await client.query<{ id: string }>(
      `SELECT id FROM vendors
        WHERE org_id = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [orgId],
    );
    if (!existingVendor.rows[0]) {
      await vendorsRepo.create(client, orgId, {
        code: "V-0001",
        name: "Sample Vendor Co",
        vendorType: "SUPPLIER",
        country: "IN",
        paymentTermsDays: 30,
        creditLimit: "0",
        isMsme: false,
        isActive: true,
      });
    }
    completed.push("vendor_added");

    return completed;
  }

  /** Total number of steps — referenced by tests + the UI checklist. */
  static readonly TOTAL_STEPS = ONBOARDING_STEPS.length;
}
