/**
 * Vendor audit recorder — writes one row to vendor.action_log per action.
 *
 * Why a separate module (not a DB trigger):
 *   - We want the request-time metadata (ip, user-agent, target details)
 *     written in one place with the rest of the business logic. A trigger
 *     can't see the request.
 *   - Gate 18 asserts the row lands inside the same transaction as the
 *     mutation it describes. Calling `record()` from within the same
 *     `pool.connect()`/`BEGIN`/`COMMIT` block as the suspend/reinstate SQL
 *     gives us that guarantee — if the INSERT fails, the mutation rolls
 *     back too.
 *
 * The caller owns the transaction boundary. If you need a fire-and-forget
 * log entry (e.g. for `vendor.login` which has no mutation to protect),
 * pass a plain `pool.query` via a one-off client. See recordStandalone().
 */

import type pg from "pg";
import type {
  VendorActionType,
  VendorTargetType,
} from "@mobilab/contracts";

export interface VendorAuditEntry {
  vendorAdminId: string;
  action: VendorActionType;
  targetType: VendorTargetType;
  /** Usually the affected row's PK. Nullable for session events. */
  targetId?: string | null;
  /** Denormalized for filtering; set when the action affects a tenant. */
  orgId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

type Queryable = Pick<pg.PoolClient, "query"> | pg.Pool;

/**
 * Insert one row into vendor.action_log. Call this from WITHIN the same
 * client/transaction as the mutation it audits so a failure of either
 * rolls back the other.
 */
export async function recordVendorAction(
  client: Queryable,
  entry: VendorAuditEntry
): Promise<void> {
  await client.query(
    `INSERT INTO vendor.action_log (
       vendor_admin_id, action, target_type, target_id,
       org_id, details, ip_address, user_agent
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.vendorAdminId,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      entry.orgId ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ]
  );
}

/**
 * Convenience wrapper for actions that don't wrap a mutation — e.g. login,
 * logout, read-only `tenant.view`. Uses a fresh client off the pool. Still
 * fully synchronous from the caller's perspective: awaits until the INSERT
 * is durable, so a gate test that reads back immediately will see the row.
 */
export async function recordVendorActionStandalone(
  pool: pg.Pool,
  entry: VendorAuditEntry
): Promise<void> {
  await recordVendorAction(pool, entry);
}
