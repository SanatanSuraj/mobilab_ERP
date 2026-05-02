/**
 * vendor-password-reset repository — SQL over vendor.admins +
 * vendor.password_reset_tokens + vendor.refresh_tokens.
 *
 * The whole module runs against the BYPASSRLS `instigenie_vendor` pool
 * (see packages/vendor-admin/src/auth.service.ts for the pool wiring
 * rationale). The vendor schema has no RLS, so DELETEs / SELECTs see
 * every row directly without any GUC dance.
 */

import type { Pool, PoolClient } from "pg";

export interface VendorAdminRow {
  id: string;
  email: string;
  is_active: boolean;
}

export interface VendorPasswordResetTokenRow {
  id: string;
  vendor_admin_id: string;
  email: string; // joined
  expires_at: Date;
  consumed_at: Date | null;
}

export async function findVendorAdminByEmail(
  pool: Pool,
  email: string,
): Promise<VendorAdminRow | null> {
  const { rows } = await pool.query<VendorAdminRow>(
    `SELECT id, email, is_active
       FROM vendor.admins
      WHERE lower(email) = lower($1)
      LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function countRecentRequests(
  pool: Pool,
  vendorAdminId: string,
  hours: number,
): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM vendor.password_reset_tokens
      WHERE vendor_admin_id = $1
        AND consumed_at IS NULL
        AND created_at > now() - ($2::int * interval '1 hour')`,
    [vendorAdminId, hours],
  );
  return Number(rows[0]?.n ?? "0");
}

export async function insertToken(
  client: PoolClient,
  args: {
    vendorAdminId: string;
    tokenHash: string;
    expiresAt: Date;
    createdIp: string | null;
  },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO vendor.password_reset_tokens
       (vendor_admin_id, token_hash, expires_at, created_ip)
     VALUES ($1, $2, $3, $4::inet)
     RETURNING id`,
    [args.vendorAdminId, args.tokenHash, args.expiresAt, args.createdIp],
  );
  return rows[0]!;
}

export async function findActiveTokenByHash(
  pool: Pool,
  tokenHash: string,
): Promise<VendorPasswordResetTokenRow | null> {
  const { rows } = await pool.query<VendorPasswordResetTokenRow>(
    `SELECT t.id, t.vendor_admin_id, a.email, t.expires_at, t.consumed_at
       FROM vendor.password_reset_tokens t
       JOIN vendor.admins                a ON a.id = t.vendor_admin_id
      WHERE t.token_hash  = $1
        AND t.consumed_at IS NULL
        AND t.expires_at  > now()
        AND a.is_active   = true
      LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

/**
 * Mark token consumed + nuke other open tokens for the same admin + update
 * password_hash + wipe every refresh token (force re-login on every device).
 * All in one transaction.
 *
 * No SECURITY DEFINER helper needed for the refresh-token DELETE — the
 * vendor schema has no RLS and the connecting role (instigenie_vendor)
 * is BYPASSRLS regardless.
 */
export async function consumeTokenAndInvalidateSessions(
  client: PoolClient,
  args: { tokenId: string; vendorAdminId: string; passwordHash: string },
): Promise<void> {
  await client.query(
    `UPDATE vendor.password_reset_tokens
        SET consumed_at = now()
      WHERE id = $1`,
    [args.tokenId],
  );
  await client.query(
    `DELETE FROM vendor.password_reset_tokens
      WHERE vendor_admin_id = $1 AND id <> $2 AND consumed_at IS NULL`,
    [args.vendorAdminId, args.tokenId],
  );
  await client.query(
    `UPDATE vendor.admins
        SET password_hash = $2, updated_at = now()
      WHERE id = $1`,
    [args.vendorAdminId, args.passwordHash],
  );
  await client.query(
    `DELETE FROM vendor.refresh_tokens WHERE vendor_admin_id = $1`,
    [args.vendorAdminId],
  );
}
