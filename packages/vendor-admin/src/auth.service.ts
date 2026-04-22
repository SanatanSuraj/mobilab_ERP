/**
 * VendorAuthService — login / refresh / logout / me for Instigenie vendor admins.
 *
 * Differences vs. tenant-side AuthService:
 *   - No tenant picker. A vendor admin IS the identity — there's no "which
 *     tenant are you logging into" step.
 *   - No roles / permissions / capabilities in the token. Permissions for
 *     vendor-admin actions are enforced route-by-route (Sprint 3 surface is
 *     tiny; extend to a role catalogue in Sprint 4 if the team grows).
 *   - Refresh tokens live in `vendor.refresh_tokens`, NOT `refresh_tokens`.
 *   - Pool is the BYPASSRLS `instigenie_vendor` pool — queries see every row.
 *
 * Session lifecycle:
 *   POST /vendor-admin/auth/login    { email, password }  → access + refresh
 *   POST /vendor-admin/auth/refresh  { refreshToken }     → rotated pair
 *   POST /vendor-admin/auth/logout   { refreshToken }     → 204
 *   GET  /vendor-admin/auth/me       (Bearer token)       → identity snapshot
 *
 * Every successful login and logout writes one row to vendor.action_log so
 * there's an independent trail separate from refresh_tokens (which is
 * mutable).
 */

import pg from "pg";
import bcrypt from "bcrypt";
import { ForbiddenError, UnauthorizedError } from "@instigenie/errors";
import { recordVendorActionStandalone } from "./audit.js";

/**
 * Narrow interface over the apps/api `TokenFactory` — we only need the three
 * methods that vendor auth actually touches. Keeping this as a structural
 * type means the package stays decoupled from Fastify wiring and can be
 * unit-tested with a trivial in-memory stub.
 */
export interface VendorTokenFactoryLike {
  issueVendorAccess(input: {
    vendorAdminId: string;
    email: string;
    name: string;
  }): Promise<{ token: string; expiresIn: number; jti: string }>;
  mintRefresh(): { raw: string; hash: string };
  hashRefresh(raw: string): string;
}

export interface VendorAuthServiceDeps {
  /** The BYPASSRLS instigenie_vendor pool. */
  pool: pg.Pool;
  tokens: VendorTokenFactoryLike;
  refreshTtlSec: number;
}

export interface VendorAuthenticatedStep {
  status: "authenticated";
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  admin: {
    id: string;
    email: string;
    name: string;
  };
}

export class VendorAuthService {
  constructor(private readonly deps: VendorAuthServiceDeps) {}

  // ─── Login ─────────────────────────────────────────────────────────────

  async login(args: {
    email: string;
    password: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<VendorAuthenticatedStep> {
    const { rows } = await this.deps.pool.query<{
      id: string;
      email: string;
      name: string;
      password_hash: string | null;
      is_active: boolean;
    }>(
      `SELECT id, email, name, password_hash, is_active
         FROM vendor.admins
        WHERE lower(email) = lower($1)
        LIMIT 1`,
      [args.email]
    );
    const admin = rows[0];

    // Constant-time dummy compare on miss so attackers can't use response
    // timing to enumerate vendor admin emails.
    const ok = admin?.password_hash
      ? await bcrypt.compare(args.password, admin.password_hash)
      : await bcrypt.compare(
          args.password,
          "$2b$10$1111111111111111111111111111111111111111111111111111u"
        );
    if (!admin || !ok) {
      throw new UnauthorizedError("invalid vendor credentials");
    }
    if (!admin.is_active) {
      throw new ForbiddenError("vendor admin is disabled");
    }

    const session = await this.issueSession({
      adminId: admin.id,
      email: admin.email,
      name: admin.name,
      userAgent: args.userAgent,
      ipAddress: args.ipAddress,
    });

    // last_login_at — unrelated to audit, but handy for the admin console.
    await this.deps.pool.query(
      `UPDATE vendor.admins SET last_login_at = now(), updated_at = now()
        WHERE id = $1`,
      [admin.id]
    );

    await recordVendorActionStandalone(this.deps.pool, {
      vendorAdminId: admin.id,
      action: "vendor.login",
      targetType: "vendor_admin",
      targetId: admin.id,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    });

    return session;
  }

  // ─── Refresh ───────────────────────────────────────────────────────────

  async refresh(args: {
    refreshToken: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<VendorAuthenticatedStep> {
    const hash = this.deps.tokens.hashRefresh(args.refreshToken);
    const { rows } = await this.deps.pool.query<{
      id: string;
      vendor_admin_id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, vendor_admin_id, expires_at, revoked_at
         FROM vendor.refresh_tokens
        WHERE token_hash = $1
        LIMIT 1`,
      [hash]
    );
    const rt = rows[0];
    if (!rt) throw new UnauthorizedError("refresh token invalid");
    if (rt.revoked_at) throw new UnauthorizedError("refresh token revoked");
    if (rt.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedError("refresh token expired");
    }

    const { rows: adminRows } = await this.deps.pool.query<{
      id: string;
      email: string;
      name: string;
      is_active: boolean;
    }>(
      `SELECT id, email, name, is_active FROM vendor.admins WHERE id = $1`,
      [rt.vendor_admin_id]
    );
    const admin = adminRows[0];
    if (!admin || !admin.is_active) {
      throw new UnauthorizedError("vendor admin no longer active");
    }

    // Rotate: revoke old, issue new, inside one txn.
    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE vendor.refresh_tokens SET revoked_at = now() WHERE id = $1`,
        [rt.id]
      );
      const session = await this.issueSession(
        {
          adminId: admin.id,
          email: admin.email,
          name: admin.name,
          userAgent: args.userAgent,
          ipAddress: args.ipAddress,
        },
        client
      );
      await client.query("COMMIT");
      return session;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Logout ───────────────────────────────────────────────────────────

  async logout(args: {
    refreshToken: string;
    /** Optional — when present, we log a vendor.logout entry. */
    vendorAdminId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    const hash = this.deps.tokens.hashRefresh(args.refreshToken);
    const { rows } = await this.deps.pool.query<{
      id: string;
      vendor_admin_id: string;
    }>(
      `UPDATE vendor.refresh_tokens
          SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
      RETURNING id, vendor_admin_id`,
      [hash]
    );
    const revoked = rows[0];
    if (!revoked) return;

    await recordVendorActionStandalone(this.deps.pool, {
      vendorAdminId: args.vendorAdminId ?? revoked.vendor_admin_id,
      action: "vendor.logout",
      targetType: "vendor_admin",
      targetId: revoked.vendor_admin_id,
      ipAddress: args.ipAddress,
      userAgent: args.userAgent,
    });
  }

  // ─── /me ──────────────────────────────────────────────────────────────

  async me(vendorAdminId: string): Promise<{
    id: string;
    email: string;
    name: string;
    isActive: boolean;
    lastLoginAt: string | null;
  }> {
    const { rows } = await this.deps.pool.query<{
      id: string;
      email: string;
      name: string;
      is_active: boolean;
      last_login_at: Date | null;
    }>(
      `SELECT id, email, name, is_active, last_login_at
         FROM vendor.admins
        WHERE id = $1
        LIMIT 1`,
      [vendorAdminId]
    );
    const a = rows[0];
    if (!a) throw new UnauthorizedError("vendor admin not found");
    return {
      id: a.id,
      email: a.email,
      name: a.name,
      isActive: a.is_active,
      lastLoginAt: a.last_login_at ? a.last_login_at.toISOString() : null,
    };
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private async issueSession(
    args: {
      adminId: string;
      email: string;
      name: string;
      userAgent?: string;
      ipAddress?: string;
    },
    client?: pg.PoolClient
  ): Promise<VendorAuthenticatedStep> {
    const { token: accessToken, expiresIn } =
      await this.deps.tokens.issueVendorAccess({
        vendorAdminId: args.adminId,
        email: args.email,
        name: args.name,
      });

    const { raw, hash } = this.deps.tokens.mintRefresh();
    const expiresAt = new Date(Date.now() + this.deps.refreshTtlSec * 1000);
    const q = client ?? this.deps.pool;
    await q.query(
      `INSERT INTO vendor.refresh_tokens (
         vendor_admin_id, token_hash, user_agent, ip_address, expires_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        args.adminId,
        hash,
        args.userAgent ?? null,
        args.ipAddress ?? null,
        expiresAt,
      ]
    );

    return {
      status: "authenticated",
      accessToken,
      refreshToken: raw,
      expiresIn,
      admin: { id: args.adminId, email: args.email, name: args.name },
    };
  }
}
