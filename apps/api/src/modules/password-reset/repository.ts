/**
 * password-reset repository — SQL over user_identities + password_reset_tokens
 * + refresh_tokens.
 *
 * Identity-scoped, not org-scoped — all queries use a bare Pool because the
 * tables involved (user_identities, password_reset_tokens, refresh_tokens)
 * have no RLS. A successful reset invalidates every refresh token across
 * every tenant for the identity, so the user is forced to re-login on every
 * device they were signed in on.
 */

import type { Pool, PoolClient } from "pg";

export interface IdentityRow {
  id: string;
  email: string;
  status: string;
}

export interface PasswordResetTokenRow {
  id: string;
  identity_id: string;
  email: string; // joined from user_identities
  expires_at: Date;
  consumed_at: Date | null;
}

/** Look up identity by email (lowercased). Returns null when not found. */
export async function findIdentityByEmail(
  pool: Pool,
  email: string,
): Promise<IdentityRow | null> {
  const { rows } = await pool.query<IdentityRow>(
    `SELECT id, email, status
       FROM user_identities
      WHERE lower(email) = lower($1) AND deleted_at IS NULL
      LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

/**
 * Count un-consumed tokens created for this identity within the last `hours`.
 * Used as a per-identity rate-limit floor in the service.
 */
export async function countRecentRequests(
  pool: Pool,
  identityId: string,
  hours: number,
): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM password_reset_tokens
      WHERE identity_id = $1
        AND consumed_at IS NULL
        AND created_at > now() - ($2::int * interval '1 hour')`,
    [identityId, hours],
  );
  return Number(rows[0]?.n ?? "0");
}

/**
 * Insert a new token row. Token hash is unique — duplicate would mean a
 * 32-byte randomBytes() collision, which is operationally impossible.
 */
export async function insertToken(
  client: PoolClient,
  args: {
    identityId: string;
    tokenHash: string;
    expiresAt: Date;
    createdIp: string | null;
  },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO password_reset_tokens (identity_id, token_hash, expires_at, created_ip)
     VALUES ($1, $2, $3, $4::inet)
     RETURNING id`,
    [args.identityId, args.tokenHash, args.expiresAt, args.createdIp],
  );
  return rows[0]!;
}

/**
 * Look up a token by its hash. Joined with user_identities so the caller
 * gets the email back (for the preview endpoint and for logging).
 *
 * Returns null when no row matches OR when the matching row is consumed
 * or expired — callers always treat those uniformly as "invalid token"
 * to avoid leaking which case applies.
 */
export async function findActiveTokenByHash(
  pool: Pool,
  tokenHash: string,
): Promise<PasswordResetTokenRow | null> {
  const { rows } = await pool.query<PasswordResetTokenRow>(
    `SELECT t.id, t.identity_id, i.email, t.expires_at, t.consumed_at
       FROM password_reset_tokens t
       JOIN user_identities       i ON i.id = t.identity_id
      WHERE t.token_hash  = $1
        AND t.consumed_at IS NULL
        AND t.expires_at  > now()
        AND i.deleted_at  IS NULL
      LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

/**
 * Mark the token consumed AND nuke every other open token for the same
 * identity AND wipe every refresh token for the identity. Done in one
 * client/transaction so a crash mid-update can't leave the password updated
 * but the token re-usable.
 *
 * The caller does the password_hash UPDATE in the same transaction
 * (see service.reset).
 */
export async function consumeTokenAndInvalidateSessions(
  client: PoolClient,
  args: { tokenId: string; identityId: string; passwordHash: string },
): Promise<void> {
  await client.query(
    `UPDATE password_reset_tokens
        SET consumed_at = now()
      WHERE id = $1`,
    [args.tokenId],
  );
  await client.query(
    `DELETE FROM password_reset_tokens
      WHERE identity_id = $1 AND id <> $2 AND consumed_at IS NULL`,
    [args.identityId, args.tokenId],
  );
  await client.query(
    `UPDATE user_identities
        SET password_hash = $2,
            failed_login_count = 0,
            locked_until = NULL,
            updated_at = now()
      WHERE id = $1`,
    [args.identityId, args.passwordHash],
  );
  // Bypass RLS via SECURITY DEFINER function — the bare DELETE is blocked
  // by `refresh_tokens_tenant_isolation` (org_id = current_setting('app.current_org'))
  // because password reset has no single tenant context. Function returns
  // the row count for ops logging; we discard it here.
  await client.query(
    `SELECT public.auth_revoke_refresh_tokens_for_identity($1)`,
    [args.identityId],
  );
}
