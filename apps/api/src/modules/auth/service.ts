/**
 * Auth service — pure functions over (db, args). No Fastify types here, so
 * the logic is testable without booting the server.
 *
 * Contracts (ARCHITECTURE.md §3.1a):
 *   - login(email, password, surface) → access + refresh
 *   - refresh(refreshToken)           → new access + rotated refresh
 *   - logout(refreshToken)            → revoke
 *   - me(userId)                      → user + permissions
 */

import pg from "pg";
import bcrypt from "bcrypt";
import {
  AUDIENCE,
  ROLE_PERMISSIONS,
  type Audience,
  type Role,
  isInternalRole,
} from "@mobilab/contracts";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from "@mobilab/errors";
import { TokenFactory } from "./tokens.js";

export interface AuthServiceDeps {
  pool: pg.Pool;
  tokens: TokenFactory;
  refreshTtlSec: number;
}

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  async login(args: {
    email: string;
    password: string;
    surface: "internal" | "portal";
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; email: string; name: string; roles: Role[] };
  }> {
    // Note: no withOrg here — login is a cross-tenant query by email.
    // RLS is not applicable because the authenticator itself establishes
    // which org the user belongs to.
    const { rows } = await this.deps.pool.query<{
      id: string;
      org_id: string;
      email: string;
      name: string;
      password_hash: string;
      is_active: boolean;
      capabilities: {
        permittedLines: string[];
        tier?: "T1" | "T2" | "T3";
        canPCBRework: boolean;
        canOCAssembly: boolean;
      };
    }>(
      // Bypass RLS for this one query via SET ROLE — in dev we just
      // query directly because RLS keys on a non-existent setting
      // returns zero rows; safer is to use a superuser conn but that's
      // phase-2 hardening.
      `SELECT id, org_id, email, name, password_hash, is_active, capabilities
         FROM users
        WHERE lower(email) = lower($1)
        LIMIT 1`,
      [args.email]
    );
    const u = rows[0];
    // bcrypt.compare with a dummy hash when user is missing, to keep timing
    // (roughly) constant. Not a silver bullet but better than a quick fail.
    const ok = u
      ? u.is_active && (await bcrypt.compare(args.password, u.password_hash))
      : await bcrypt.compare(
          args.password,
          "$2b$10$1111111111111111111111111111111111111111111111111111u"
        );
    if (!u || !ok) {
      throw new UnauthorizedError("invalid credentials");
    }

    const roles = await this.loadRoles(u.id);
    if (roles.length === 0) {
      throw new ForbiddenError("user has no roles");
    }
    const internal = roles.some(isInternalRole);
    const requestedInternal = args.surface === "internal";
    // Portal tokens can only be issued to CUSTOMER-only users; internal
    // tokens can only be issued to internal-role users. A user with both
    // (rare) gets whichever matches `surface`.
    if (requestedInternal && !internal) {
      throw new ForbiddenError("user cannot access internal surface");
    }
    if (!requestedInternal && roles.every(isInternalRole)) {
      throw new ForbiddenError("user cannot access portal surface");
    }
    const audience: Audience = requestedInternal
      ? AUDIENCE.internal
      : AUDIENCE.portal;

    const { token: accessToken, expiresIn } = await this.deps.tokens.issueAccess({
      userId: u.id,
      orgId: u.org_id,
      audience,
      roles,
      capabilities: u.capabilities,
    });

    const { raw, hash } = this.deps.tokens.mintRefresh();
    const expiresAt = new Date(Date.now() + this.deps.refreshTtlSec * 1000);
    await this.deps.pool.query(
      `INSERT INTO refresh_tokens (user_id, org_id, token_hash, audience, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [u.id, u.org_id, hash, audience, args.userAgent ?? null, args.ipAddress ?? null, expiresAt]
    );

    return {
      accessToken,
      refreshToken: raw,
      expiresIn,
      user: { id: u.id, email: u.email, name: u.name, roles },
    };
  }

  async refresh(args: {
    refreshToken: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; email: string; name: string; roles: Role[] };
  }> {
    const hash = this.deps.tokens.hashRefresh(args.refreshToken);
    const { rows } = await this.deps.pool.query<{
      id: string;
      user_id: string;
      org_id: string;
      audience: Audience;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, org_id, audience, expires_at, revoked_at
         FROM refresh_tokens
        WHERE token_hash = $1
        LIMIT 1`,
      [hash]
    );
    const rt = rows[0];
    if (!rt) throw new UnauthorizedError("refresh token invalid");
    if (rt.revoked_at) throw new UnauthorizedError("refresh token revoked");
    if (rt.expires_at.getTime() < Date.now())
      throw new UnauthorizedError("refresh token expired");

    // Rotate: revoke the old, issue a new one.
    const { rows: userRows } = await this.deps.pool.query<{
      id: string;
      email: string;
      name: string;
      capabilities: {
        permittedLines: string[];
        tier?: "T1" | "T2" | "T3";
        canPCBRework: boolean;
        canOCAssembly: boolean;
      };
    }>(
      `SELECT id, email, name, capabilities FROM users WHERE id = $1 AND is_active = true`,
      [rt.user_id]
    );
    const u = userRows[0];
    if (!u) throw new UnauthorizedError("user no longer active");
    const roles = await this.loadRoles(u.id);

    const { token: accessToken, expiresIn } = await this.deps.tokens.issueAccess({
      userId: u.id,
      orgId: rt.org_id,
      audience: rt.audience,
      roles,
      capabilities: u.capabilities,
    });

    const next = this.deps.tokens.mintRefresh();
    const expiresAt = new Date(Date.now() + this.deps.refreshTtlSec * 1000);
    // Revoke old + insert new in a single txn.
    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
        [rt.id]
      );
      await client.query(
        `INSERT INTO refresh_tokens (user_id, org_id, token_hash, audience, user_agent, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          rt.user_id,
          rt.org_id,
          next.hash,
          rt.audience,
          args.userAgent ?? null,
          args.ipAddress ?? null,
          expiresAt,
        ]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    return {
      accessToken,
      refreshToken: next.raw,
      expiresIn,
      user: { id: u.id, email: u.email, name: u.name, roles },
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.deps.tokens.hashRefresh(refreshToken);
    await this.deps.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hash]
    );
  }

  async me(userId: string): Promise<{
    id: string;
    orgId: string;
    email: string;
    name: string;
    roles: Role[];
    permissions: string[];
    capabilities?: {
      permittedLines: string[];
      tier?: "T1" | "T2" | "T3";
      canPCBRework: boolean;
      canOCAssembly: boolean;
    };
  }> {
    const { rows } = await this.deps.pool.query<{
      id: string;
      org_id: string;
      email: string;
      name: string;
      capabilities: {
        permittedLines: string[];
        tier?: "T1" | "T2" | "T3";
        canPCBRework: boolean;
        canOCAssembly: boolean;
      };
    }>(
      `SELECT id, org_id, email, name, capabilities
         FROM users WHERE id = $1`,
      [userId]
    );
    const u = rows[0];
    if (!u) throw new NotFoundError("user");
    const roles = await this.loadRoles(u.id);
    const perms = new Set<string>();
    for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) perms.add(p);
    return {
      id: u.id,
      orgId: u.org_id,
      email: u.email,
      name: u.name,
      roles,
      permissions: [...perms],
      capabilities: u.capabilities,
    };
  }

  private async loadRoles(userId: string): Promise<Role[]> {
    const { rows } = await this.deps.pool.query<{ role_id: string }>(
      `SELECT role_id FROM user_roles WHERE user_id = $1`,
      [userId]
    );
    return rows.map((r) => r.role_id as Role);
  }
}
