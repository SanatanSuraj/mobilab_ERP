/**
 * Admin-users repository — SQL over user_invitations, user_identities,
 * users, memberships, user_roles. The service is the only caller.
 *
 * Every function takes a PoolClient and expects the caller to have set up
 * the org GUC (via withRequest / withOrg) when needed. The ONE exception is
 * `loadInvitationByTokenHash`, which runs via the SECURITY DEFINER function
 * `public.auth_load_invitation(text)` — it's called pre-auth from the
 * accept-invite route, before any org context exists.
 */

import type { Pool, PoolClient } from "pg";
import type { Role } from "@instigenie/contracts";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InvitationRow {
  id: string;
  org_id: string;
  email: string;
  role_id: Role;
  token_hash: string;
  invited_by: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  metadata: { name?: string } & Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface InvitationWithOrgRow extends InvitationRow {
  org_name: string;
}

/** Hydrated row for the admin list endpoint. */
export interface InvitationListRow {
  id: string;
  org_id: string;
  email: string;
  role_id: Role;
  invited_by: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
}

// ─── Create invitation ─────────────────────────────────────────────────────

export async function insertInvitation(
  client: PoolClient,
  args: {
    orgId: string;
    email: string;
    roleId: Role;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
    metadata: Record<string, unknown>;
  },
): Promise<InvitationRow> {
  const { rows } = await client.query<InvitationRow>(
    `INSERT INTO user_invitations
       (org_id, email, role_id, token_hash, invited_by, expires_at, metadata)
     VALUES ($1, lower($2), $3, $4, $5, $6, $7)
     RETURNING id, org_id, email, role_id, token_hash, invited_by,
               expires_at, accepted_at, metadata, created_at, updated_at`,
    [
      args.orgId,
      args.email,
      args.roleId,
      args.tokenHash,
      args.invitedBy,
      args.expiresAt,
      args.metadata,
    ],
  );
  return rows[0]!;
}

/**
 * Is there already an OPEN invite for this (org, email)? The partial unique
 * index on user_invitations blocks the collision at write time; this check
 * gives us a clean 409 before the INSERT.
 */
export async function findActiveInvitationByEmail(
  client: PoolClient,
  orgId: string,
  email: string,
): Promise<InvitationRow | null> {
  const { rows } = await client.query<InvitationRow>(
    `SELECT id, org_id, email, role_id, token_hash, invited_by,
            expires_at, accepted_at, metadata, created_at, updated_at
       FROM user_invitations
      WHERE org_id = $1 AND lower(email) = lower($2)
        AND accepted_at IS NULL
      LIMIT 1`,
    [orgId, email],
  );
  return rows[0] ?? null;
}

// ─── List / revoke ─────────────────────────────────────────────────────────

export interface ListInvitationsArgs {
  status?: "PENDING" | "EXPIRED" | "ACCEPTED" | "REVOKED";
  limit: number;
  offset: number;
}

export async function listInvitations(
  client: PoolClient,
  args: ListInvitationsArgs,
): Promise<{ items: InvitationListRow[]; total: number }> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  // Status derivation: PENDING = accepted_at IS NULL AND expires_at > now().
  //                   EXPIRED = accepted_at IS NULL AND expires_at <= now().
  //                   ACCEPTED = accepted_at IS NOT NULL.
  //                   REVOKED  = metadata->>'revokedAt' IS NOT NULL
  //                             AND accepted_at IS NULL.
  if (args.status === "PENDING") {
    clauses.push(`accepted_at IS NULL AND expires_at > now()
                  AND (metadata->>'revokedAt') IS NULL`);
  } else if (args.status === "EXPIRED") {
    clauses.push(`accepted_at IS NULL AND expires_at <= now()
                  AND (metadata->>'revokedAt') IS NULL`);
  } else if (args.status === "ACCEPTED") {
    clauses.push(`accepted_at IS NOT NULL`);
  } else if (args.status === "REVOKED") {
    clauses.push(`accepted_at IS NULL AND (metadata->>'revokedAt') IS NOT NULL`);
  } else {
    // Default: hide ACCEPTED rows. Those tend to pile up and aren't
    // actionable from the dashboard anymore.
    clauses.push(`accepted_at IS NULL`);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;

  const countParamCount = params.length;
  const pageParams = [...params, args.limit, args.offset];

  const [countRes, rowsRes] = await Promise.all([
    client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM user_invitations ${where}`,
      params,
    ),
    client.query<InvitationListRow>(
      `SELECT id, org_id, email, role_id, invited_by, expires_at,
              accepted_at, created_at
         FROM user_invitations
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${countParamCount + 1} OFFSET $${countParamCount + 2}`,
      pageParams,
    ),
  ]);
  return {
    total: Number(countRes.rows[0]?.total ?? "0"),
    items: rowsRes.rows,
  };
}

/**
 * Mark an invitation as revoked. We don't delete the row — we stamp
 * metadata.revokedAt + metadata.revokedBy so the audit trail survives.
 * Returns the updated row, or null if nothing matched.
 */
export async function revokeInvitation(
  client: PoolClient,
  invitationId: string,
  revokedByUserId: string,
): Promise<InvitationRow | null> {
  const { rows } = await client.query<InvitationRow>(
    `UPDATE user_invitations
        SET metadata = metadata
          || jsonb_build_object('revokedAt', to_char(now(),
                                  'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                'revokedBy', $2::text)
      WHERE id = $1 AND accepted_at IS NULL
      RETURNING id, org_id, email, role_id, token_hash, invited_by,
                expires_at, accepted_at, metadata, created_at, updated_at`,
    [invitationId, revokedByUserId],
  );
  return rows[0] ?? null;
}

// ─── Accept flow (cross-tenant + tenant-scoped halves) ────────────────────

/**
 * Fetch an invitation by its token_hash via the SECURITY DEFINER function.
 * Runs OUTSIDE withOrg() because the caller has no JWT yet; RLS would
 * filter the row to zero if we queried user_invitations directly.
 */
export async function loadInvitationByTokenHash(
  pool: Pool,
  tokenHash: string,
): Promise<InvitationWithOrgRow | null> {
  const { rows } = await pool.query<InvitationWithOrgRow>(
    `SELECT id, org_id, email, role_id,
            NULL::text AS token_hash,
            invited_by, expires_at, accepted_at, metadata,
            NULL::timestamptz AS created_at,
            NULL::timestamptz AS updated_at,
            org_name
       FROM public.auth_load_invitation($1)`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

/**
 * Look up a user_identity by email. Global table, no RLS — safe to query
 * from any context. Returns enough to decide "link vs create".
 */
export async function findIdentityByEmail(
  pool: Pool,
  email: string,
): Promise<{
  id: string;
  email: string;
  password_hash: string | null;
  status: string;
} | null> {
  const { rows } = await pool.query<{
    id: string;
    email: string;
    password_hash: string | null;
    status: string;
  }>(
    `SELECT id, email, password_hash, status
       FROM user_identities
      WHERE lower(email) = lower($1) AND deleted_at IS NULL
      LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

/**
 * Insert a new identity — called when the invited email has no existing
 * identity. Global table, no RLS. Caller supplies the bcrypt hash.
 */
export async function insertIdentity(
  pool: Pool,
  args: { email: string; passwordHash: string },
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO user_identities (email, password_hash, status)
     VALUES (lower($1), $2, 'ACTIVE')
     RETURNING id`,
    [args.email, args.passwordHash],
  );
  return rows[0]!;
}

/**
 * Create the per-tenant user profile + membership + user_roles + mark the
 * invitation accepted — all inside a single transaction under the tenant's
 * RLS GUC. The caller runs this inside withOrg(pool, orgId, ...).
 */
export async function acceptInvitationTx(
  client: PoolClient,
  args: {
    invitationId: string;
    orgId: string;
    identityId: string;
    email: string;
    name: string;
    roleId: Role;
  },
): Promise<{ userId: string }> {
  // 1. Per-tenant user profile. users has identity_id FK + org_id FK. The
  //    unique-per-org email is enforced by a unique index (see
  //    ops/sql/init/01-schemas.sql), along with a unique (identity_id, org_id).
  //    Upsert on (identity_id, org_id): if this identity already has a profile
  //    in this org (e.g. an admin re-invited someone who once accepted and was
  //    later deactivated, or the row was pre-seeded), we reuse the existing
  //    row — flipping is_active back on and filling in name if it was null —
  //    instead of failing the whole accept with a duplicate-key.
  const { rows: userRows } = await client.query<{ id: string }>(
    `INSERT INTO users (org_id, identity_id, email, name, is_active, capabilities)
     VALUES ($1, $2, lower($3), $4, true, '{}'::jsonb)
     ON CONFLICT (identity_id, org_id) DO UPDATE
       SET is_active = true,
           name      = COALESCE(users.name, EXCLUDED.name),
           email     = EXCLUDED.email
     RETURNING id`,
    [args.orgId, args.identityId, args.email, args.name],
  );
  const userId = userRows[0]!.id;

  // 2. Membership row (identity ↔ org link) with status ACTIVE.
  //    Upsert because an INVITED membership row might already exist for
  //    this identity in this org (e.g. pre-§invite seeding); in that case
  //    we flip it to ACTIVE and wire joined_at.
  await client.query(
    `INSERT INTO memberships
       (org_id, identity_id, user_id, status, joined_at)
     VALUES ($1, $2, $3, 'ACTIVE', now())
     ON CONFLICT (identity_id, org_id) DO UPDATE
       SET status     = 'ACTIVE',
           user_id    = EXCLUDED.user_id,
           joined_at  = COALESCE(memberships.joined_at, now())`,
    [args.orgId, args.identityId, userId],
  );

  // 3. Role grant. user_roles has a NOT NULL org_id (see 01-schemas.sql) —
  //    the PK is (user_id, role_id), so ON CONFLICT targets that pair and
  //    leaves the existing row (and its org_id) untouched.
  await client.query(
    `INSERT INTO user_roles (user_id, role_id, org_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, args.roleId, args.orgId],
  );

  // 4. Mark invite consumed.
  await client.query(
    `UPDATE user_invitations
        SET accepted_at = now()
      WHERE id = $1 AND accepted_at IS NULL`,
    [args.invitationId],
  );

  return { userId };
}

// ─── Inviter metadata helper ───────────────────────────────────────────────

export async function loadUserSummary(
  client: PoolClient,
  userId: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const { rows } = await client.query<{
    id: string;
    email: string;
    name: string;
  }>(
    `SELECT id, email, name FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function loadOrgName(
  client: PoolClient,
  orgId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT name FROM organizations WHERE id = $1 LIMIT 1`,
    [orgId],
  );
  return rows[0]?.name ?? null;
}
