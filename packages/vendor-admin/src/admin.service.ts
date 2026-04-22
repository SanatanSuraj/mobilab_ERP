/**
 * VendorAdminService — the business logic behind /vendor-admin/tenants/*.
 *
 * All queries run against the BYPASSRLS `instigenie_vendor` pool, so they see
 * every tenant. Each mutation opens a transaction, performs the SQL, and
 * records to vendor.action_log INSIDE the same transaction — if the audit
 * insert fails for any reason, the mutation rolls back too.
 *
 * Plan resolution: change-plan takes a PlanCode (e.g. "PRO"), not a planId.
 * The vendor UI shouldn't have to know UUIDs; we look them up here.
 *
 * Cache: changing a tenant's plan invalidates the FeatureSnapshot cached by
 * FeatureFlagService. We call `cacheInvalidate(orgId)` after a successful
 * change so the tenant's very next request sees the new plan. Suspend /
 * reinstate flip organizations.status which is read directly by the auth
 * guard (no cache) — nothing to invalidate there.
 */

import type pg from "pg";
import { NotFoundError, ValidationError } from "@instigenie/errors";
import type {
  PlanCode,
  VendorActionType,
  VendorAuditListQuery,
  VendorTenantListQuery,
} from "@instigenie/contracts";
import { recordVendorAction } from "./audit.js";

export interface VendorAdminContext {
  vendorAdminId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface VendorAdminServiceDeps {
  /** BYPASSRLS instigenie_vendor pool. */
  pool: pg.Pool;
  /**
   * Optional. If provided, the service calls `invalidate(orgId)` after a
   * plan change so FeatureFlagService refetches the snapshot on next hit.
   */
  cacheInvalidate?: (orgId: string) => Promise<void> | void;
}

export class VendorAdminService {
  constructor(private readonly deps: VendorAdminServiceDeps) {}

  // ─── List tenants ─────────────────────────────────────────────────────

  async listTenants(
    query: VendorTenantListQuery,
    ctx: VendorAdminContext
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
  }> {
    // Build the WHERE clause dynamically. BYPASSRLS means we skip the
    // app.current_org dance entirely.
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.status) {
      params.push(query.status);
      where.push(`o.status = $${params.length}`);
    }
    if (query.plan) {
      params.push(query.plan);
      where.push(`p.code = $${params.length}`);
    }
    if (query.q) {
      params.push(`%${query.q}%`);
      where.push(`o.name ILIKE $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(query.limit);
    const limitIdx = params.length;
    params.push(query.offset);
    const offsetIdx = params.length;

    // The subscription join is LATERAL + LIMIT 1 to pick the live one if
    // there are multiple rows (past cancel + current). Ordered by
    // current_period_end DESC so the newest wins.
    const itemsQ = this.deps.pool.query<{
      id: string;
      name: string;
      status: string;
      trial_ends_at: Date | null;
      suspended_at: Date | null;
      deleted_at: Date | null;
      created_at: Date;
      plan_code: string | null;
      plan_name: string | null;
      subscription_status: string | null;
      current_period_end: Date | null;
      cancel_at_period_end: boolean | null;
    }>(
      `SELECT o.id, o.name, o.status, o.trial_ends_at, o.suspended_at,
              o.deleted_at, o.created_at,
              p.code AS plan_code, p.name AS plan_name,
              s.status AS subscription_status,
              s.current_period_end, s.cancel_at_period_end
         FROM organizations o
         LEFT JOIN LATERAL (
           SELECT s.plan_id, s.status, s.current_period_end,
                  s.cancel_at_period_end
             FROM subscriptions s
            WHERE s.org_id = o.id
            ORDER BY s.current_period_end DESC NULLS LAST
            LIMIT 1
         ) s ON TRUE
         LEFT JOIN plans p ON p.id = s.plan_id
         ${whereSql}
        ORDER BY o.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const totalParams = params.slice(0, params.length - 2);
    const totalQ = this.deps.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM organizations o
         LEFT JOIN LATERAL (
           SELECT s.plan_id
             FROM subscriptions s
            WHERE s.org_id = o.id
            ORDER BY s.current_period_end DESC NULLS LAST
            LIMIT 1
         ) s ON TRUE
         LEFT JOIN plans p ON p.id = s.plan_id
         ${whereSql}`,
      totalParams
    );

    const [itemsRes, totalRes] = await Promise.all([itemsQ, totalQ]);

    // Audit the list call so we can prove "who browsed customer X's page
    // on date Y". Standalone (non-tx) because listing is read-only.
    await recordVendorAction(this.deps.pool, {
      vendorAdminId: ctx.vendorAdminId,
      action: "tenant.list",
      targetType: "organization",
      details: {
        filters: {
          status: query.status ?? null,
          plan: query.plan ?? null,
          q: query.q ?? null,
        },
        returned: itemsRes.rows.length,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      items: itemsRes.rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        trialEndsAt: r.trial_ends_at ? r.trial_ends_at.toISOString() : null,
        suspendedAt: r.suspended_at ? r.suspended_at.toISOString() : null,
        deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
        createdAt: r.created_at.toISOString(),
        plan:
          r.plan_code && r.plan_name
            ? { code: r.plan_code, name: r.plan_name }
            : null,
        subscription:
          r.subscription_status && r.current_period_end
            ? {
                status: r.subscription_status,
                currentPeriodEnd: r.current_period_end.toISOString(),
                cancelAtPeriodEnd: r.cancel_at_period_end ?? false,
              }
            : null,
      })),
      total: Number(totalRes.rows[0]?.count ?? 0),
    };
  }

  // ─── Suspend ──────────────────────────────────────────────────────────

  async suspendTenant(
    orgId: string,
    args: { reason: string },
    ctx: VendorAdminContext
  ): Promise<void> {
    await this.withTxn(async (client) => {
      const existing = await this.loadOrgForMutation(client, orgId);

      // Idempotency: suspending a SUSPENDED tenant is a no-op but still
      // writes an audit entry — "vendor reconfirmed suspension".
      await client.query(
        `UPDATE organizations
            SET status           = 'SUSPENDED',
                suspended_at     = COALESCE(suspended_at, now()),
                suspended_reason = $2,
                updated_at       = now()
          WHERE id = $1`,
        [orgId, args.reason]
      );

      await this.audit(client, ctx, "tenant.suspend", {
        targetId: orgId,
        orgId,
        details: {
          reason: args.reason,
          previousStatus: existing.status,
        },
      });
    });
  }

  // ─── Reinstate ────────────────────────────────────────────────────────

  async reinstateTenant(
    orgId: string,
    args: { reason: string },
    ctx: VendorAdminContext
  ): Promise<void> {
    await this.withTxn(async (client) => {
      const existing = await this.loadOrgForMutation(client, orgId);
      if (existing.deleted_at || existing.status === "DELETED") {
        // Hard-deleted tenants don't come back via reinstate — they need a
        // dedicated restore flow (not in Sprint 3 scope).
        throw new ValidationError(
          "cannot reinstate a deleted tenant",
          { orgId, status: existing.status }
        );
      }

      await client.query(
        `UPDATE organizations
            SET status           = 'ACTIVE',
                suspended_at     = NULL,
                suspended_reason = NULL,
                updated_at       = now()
          WHERE id = $1`,
        [orgId]
      );

      await this.audit(client, ctx, "tenant.reinstate", {
        targetId: orgId,
        orgId,
        details: {
          reason: args.reason,
          previousStatus: existing.status,
        },
      });
    });
  }

  // ─── Change plan ──────────────────────────────────────────────────────

  async changePlan(
    orgId: string,
    args: { planCode: PlanCode; reason: string },
    ctx: VendorAdminContext
  ): Promise<{ oldPlanCode: string | null; newPlanCode: PlanCode }> {
    const result = await this.withTxn(
      async (client): Promise<{
        oldPlanCode: string | null;
        newPlanCode: PlanCode;
      }> => {
        // Resolve the target plan id.
        const { rows: planRows } = await client.query<{
          id: string;
          code: string;
        }>(`SELECT id, code FROM plans WHERE code = $1 AND is_active = true`, [
          args.planCode,
        ]);
        const newPlan = planRows[0];
        if (!newPlan) {
          throw new NotFoundError("plan not found", {
            planCode: args.planCode,
          });
        }

        // Org existence gate (doubles as fk safety).
        await this.loadOrgForMutation(client, orgId);

        // Pick the live subscription row. Match the "most recent
        // current_period_end" heuristic used in listTenants so both UIs
        // agree on which row is active.
        const { rows: subRows } = await client.query<{
          id: string;
          plan_id: string;
          plan_code: string;
        }>(
          `SELECT s.id, s.plan_id, p.code AS plan_code
             FROM subscriptions s
             JOIN plans p ON p.id = s.plan_id
            WHERE s.org_id = $1
            ORDER BY s.current_period_end DESC NULLS LAST
            LIMIT 1`,
          [orgId]
        );
        const existingSub = subRows[0];
        const oldPlanCode = existingSub?.plan_code ?? null;

        if (existingSub) {
          await client.query(
            `UPDATE subscriptions
                SET plan_id    = $2,
                    status     = 'ACTIVE',
                    updated_at = now()
              WHERE id = $1`,
            [existingSub.id, newPlan.id]
          );
        } else {
          // No subscription yet — create one starting today, 1y period.
          await client.query(
            `INSERT INTO subscriptions (
               org_id, plan_id, status,
               current_period_start, current_period_end, cancel_at_period_end
             ) VALUES ($1, $2, 'ACTIVE', now(), now() + interval '1 year', false)`,
            [orgId, newPlan.id]
          );
        }

        await this.audit(client, ctx, "tenant.change_plan", {
          targetId: existingSub?.id ?? null,
          orgId,
          details: {
            reason: args.reason,
            oldPlanCode,
            newPlanCode: args.planCode,
          },
        });

        return { oldPlanCode, newPlanCode: args.planCode };
      }
    );

    // Best-effort cache invalidation AFTER the txn commits. If it fails the
    // tenant just gets a 60s stale read at worst, not a correctness bug.
    if (this.deps.cacheInvalidate) {
      try {
        await this.deps.cacheInvalidate(orgId);
      } catch {
        // Swallowed — the cache has a TTL; next pull will recover.
      }
    }

    return result;
  }

  // ─── Audit log read-back ──────────────────────────────────────────────

  async listAudit(
    query: VendorAuditListQuery,
    ctx: VendorAdminContext
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
  }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.orgId) {
      params.push(query.orgId);
      where.push(`al.org_id = $${params.length}`);
    }
    if (query.action) {
      params.push(query.action);
      where.push(`al.action = $${params.length}`);
    }
    if (query.vendorAdminId) {
      params.push(query.vendorAdminId);
      where.push(`al.vendor_admin_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(query.limit);
    const limitIdx = params.length;
    params.push(query.offset);
    const offsetIdx = params.length;

    const itemsQ = this.deps.pool.query<{
      id: string;
      vendor_admin_id: string;
      admin_email: string;
      action: string;
      target_type: string;
      target_id: string | null;
      org_id: string | null;
      details: Record<string, unknown> | null;
      ip_address: string | null;
      user_agent: string | null;
      created_at: Date;
    }>(
      `SELECT al.id, al.vendor_admin_id,
              va.email  AS admin_email,
              al.action, al.target_type, al.target_id, al.org_id,
              al.details,
              host(al.ip_address) AS ip_address,
              al.user_agent, al.created_at
         FROM vendor.action_log al
         LEFT JOIN vendor.admins va ON va.id = al.vendor_admin_id
         ${whereSql}
        ORDER BY al.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const totalParams = params.slice(0, params.length - 2);
    const totalQ = this.deps.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM vendor.action_log al
         ${whereSql}`,
      totalParams
    );

    const [itemsRes, totalRes] = await Promise.all([itemsQ, totalQ]);

    // Viewing the audit is itself an audit event. Keep this lightweight —
    // don't include filters in details to avoid a write-storm if the UI
    // polls.
    await recordVendorAction(this.deps.pool, {
      vendorAdminId: ctx.vendorAdminId,
      action: "tenant.view_audit",
      targetType: "organization",
      targetId: query.orgId ?? null,
      orgId: query.orgId ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      items: itemsRes.rows.map((r) => ({
        id: r.id,
        vendorAdminId: r.vendor_admin_id,
        vendorAdminEmail: r.admin_email,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        orgId: r.org_id,
        details: r.details,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        createdAt: r.created_at.toISOString(),
      })),
      total: Number(totalRes.rows[0]?.count ?? 0),
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private async withTxn<T>(
    fn: (client: pg.PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async loadOrgForMutation(
    client: pg.PoolClient,
    orgId: string
  ): Promise<{
    id: string;
    status: string;
    deleted_at: Date | null;
  }> {
    const { rows } = await client.query<{
      id: string;
      status: string;
      deleted_at: Date | null;
    }>(
      `SELECT id, status, deleted_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    const o = rows[0];
    if (!o) throw new NotFoundError("tenant not found", { orgId });
    return o;
  }

  private async audit(
    client: pg.PoolClient,
    ctx: VendorAdminContext,
    action: VendorActionType,
    args: {
      targetId?: string | null;
      orgId?: string | null;
      details?: Record<string, unknown> | null;
    }
  ): Promise<void> {
    await recordVendorAction(client, {
      vendorAdminId: ctx.vendorAdminId,
      action,
      targetType: "organization",
      targetId: args.targetId ?? null,
      orgId: args.orgId ?? null,
      details: args.details ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
