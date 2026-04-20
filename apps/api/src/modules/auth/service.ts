/**
 * Auth service — pure functions over (pool, args). No Fastify types here,
 * so the logic is testable without booting the server.
 *
 * Identity model (Option 2):
 *   user_identities    — one row per human, global (email + password_hash)
 *   memberships        — identity ↔ org links (status: ACTIVE/INVITED/…)
 *   users              — per-tenant profile (name, capabilities, roles via user_roles)
 *
 * Login flow:
 *   POST /auth/login
 *     body:  { email, password, surface }
 *     steps:
 *       1. Look up user_identity by lower(email).
 *       2. bcrypt.compare — constant-time via dummy hash on miss.
 *       3. Load ACTIVE memberships for this identity, filtered by surface
 *          (internal ⇒ any role in INTERNAL_ROLES; portal ⇒ CUSTOMER).
 *       4. If 0 memberships on this surface → 403.
 *          If 1 membership                   → short-circuit: issue access+refresh.
 *          If 2+ memberships                 → return tenantToken + membership list.
 *
 *   POST /auth/select-tenant
 *     body:  { tenantToken, orgId }
 *     steps:
 *       1. Verify tenantToken (aud = mobilab-tenant-picker, 5m TTL).
 *       2. Confirm the claimed identity has an ACTIVE membership in orgId
 *          matching the surface recorded on the picker token.
 *       3. Mint access+refresh bound to (user_id, org_id, identity_id).
 *
 * Cross-tenant queries (login, select-tenant, picker) deliberately bypass
 * withOrg() because the tenant has not yet been chosen. All subsequent
 * tenant-scoped access goes through withOrg/withRequest.
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
import { withOrg } from "@mobilab/db";
import { TokenFactory } from "./tokens.js";
import type { TenantStatusService } from "../tenants/service.js";

export interface AuthServiceDeps {
  pool: pg.Pool;
  tokens: TokenFactory;
  refreshTtlSec: number;
  /**
   * Sprint 1B. Before minting a new access+refresh pair the service
   * confirms the tenant is ACTIVE / trial-not-expired. Keeps suspended
   * and deleted tenants out even if the membership row is still ACTIVE
   * (memberships lag behind org status in practice).
   */
  tenantStatus: TenantStatusService;
}

/**
 * Shape returned by login when auth succeeds and the identity has ≥2
 * active memberships on the requested surface.
 */
interface MultiTenantStep {
  status: "multi-tenant";
  tenantToken: string;
  memberships: Array<{
    orgId: string;
    orgName: string;
    roles: Role[];
  }>;
}

/**
 * Shape returned by login (single-membership short-circuit) and
 * select-tenant (always). A regular authenticated session.
 */
interface AuthenticatedStep {
  status: "authenticated";
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    identityId: string;
    orgId: string;
    email: string;
    name: string;
    roles: Role[];
  };
}

export type LoginResult = AuthenticatedStep | MultiTenantStep;

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  // ─── Login (step 1) ──────────────────────────────────────────────────

  async login(args: {
    email: string;
    password: string;
    surface: "internal" | "portal";
    userAgent?: string;
    ipAddress?: string;
  }): Promise<LoginResult> {
    // 1. Look up identity. Cross-tenant query — user_identities has no RLS.
    const { rows } = await this.deps.pool.query<{
      id: string;
      email: string;
      password_hash: string | null;
      status: string;
      locked_until: Date | null;
    }>(
      `SELECT id, email, password_hash, status, locked_until
         FROM user_identities
        WHERE lower(email) = lower($1)
          AND deleted_at IS NULL
        LIMIT 1`,
      [args.email]
    );
    const id = rows[0];

    // 2. Verify password with constant-time dummy on miss.
    const ok = id?.password_hash
      ? await bcrypt.compare(args.password, id.password_hash)
      : await bcrypt.compare(
          args.password,
          "$2b$10$1111111111111111111111111111111111111111111111111111u"
        );
    if (!id || !ok) {
      throw new UnauthorizedError("invalid credentials");
    }
    if (id.status !== "ACTIVE") {
      throw new ForbiddenError("identity is locked or disabled");
    }
    if (id.locked_until && id.locked_until.getTime() > Date.now()) {
      throw new ForbiddenError("identity is temporarily locked");
    }

    // 3. Load ACTIVE memberships for this identity, join to users + roles.
    //    Cross-tenant read — skips withOrg because the identity has not
    //    yet picked a tenant. This is the one place outside of vendor
    //    admin that reads across tenants, and it's bounded to "rows owned
    //    by this one identity".
    const memberships = await this.loadActiveMemberships(id.id);

    // 4. Filter by surface. Internal tokens require at least one non-CUSTOMER
    //    role in that org; portal tokens require CUSTOMER.
    const eligible = memberships.filter((m) =>
      args.surface === "internal"
        ? m.roles.some(isInternalRole)
        : m.roles.some((r) => r === "CUSTOMER")
    );
    if (eligible.length === 0) {
      throw new ForbiddenError(
        `no ${args.surface} membership for this identity`
      );
    }

    if (eligible.length === 1) {
      return this.issueAuthenticatedSession({
        identityId: id.id,
        membership: eligible[0]!,
        surface: args.surface,
        userAgent: args.userAgent,
        ipAddress: args.ipAddress,
      });
    }

    // 2+ eligible memberships: hand back a tenant picker token.
    const { token } = await this.deps.tokens.issueTenantPicker({
      identityId: id.id,
      surface: args.surface,
    });
    return {
      status: "multi-tenant",
      tenantToken: token,
      memberships: eligible.map((m) => ({
        orgId: m.orgId,
        orgName: m.orgName,
        roles: m.roles,
      })),
    };
  }

  // ─── Login (step 2) ──────────────────────────────────────────────────

  async selectTenant(args: {
    tenantToken: string;
    orgId: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<AuthenticatedStep> {
    const claims = await this.deps.tokens.verifyTenantPicker(args.tenantToken);
    const memberships = await this.loadActiveMemberships(claims.sub);
    const pick = memberships.find((m) => m.orgId === args.orgId);
    if (!pick) {
      throw new ForbiddenError(
        "identity has no active membership in the requested org"
      );
    }

    // Re-verify surface: picker token surface must agree with picked
    // membership's eligible roles. Prevents a portal-picker being used
    // to claim an internal session.
    const surfaceOk =
      claims.surface === "internal"
        ? pick.roles.some(isInternalRole)
        : pick.roles.some((r) => r === "CUSTOMER");
    if (!surfaceOk) {
      throw new ForbiddenError(
        `identity cannot access ${claims.surface} surface in this org`
      );
    }

    return this.issueAuthenticatedSession({
      identityId: claims.sub,
      membership: pick,
      surface: claims.surface,
      userAgent: args.userAgent,
      ipAddress: args.ipAddress,
    });
  }

  // ─── Refresh ────────────────────────────────────────────────────────

  async refresh(args: {
    refreshToken: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<AuthenticatedStep> {
    // Initial lookup is cross-tenant — we don't know the org yet; the
    // refresh row TELLS us. Route through the SECURITY DEFINER helper
    // (ops/sql/rls/03-auth-cross-tenant.sql) so RLS doesn't filter the
    // row away. Everything downstream runs under withOrg once we know
    // the org.
    const hash = this.deps.tokens.hashRefresh(args.refreshToken);
    const { rows } = await this.deps.pool.query<{
      id: string;
      user_id: string;
      org_id: string;
      identity_id: string;
      audience: Audience;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, org_id, identity_id, audience, expires_at, revoked_at
         FROM public.auth_load_refresh_token($1)`,
      [hash]
    );
    const rt = rows[0];
    if (!rt) throw new UnauthorizedError("refresh token invalid");
    if (rt.revoked_at) throw new UnauthorizedError("refresh token revoked");
    if (rt.expires_at.getTime() < Date.now())
      throw new UnauthorizedError("refresh token expired");

    // Tenant-lifecycle gate (Sprint 1B). A refresh for a suspended/deleted
    // tenant is rejected HERE so the rotation doesn't mint a fresh access
    // token that outlives the admin action by up to one TTL.
    await this.deps.tenantStatus.assertActive(rt.org_id);

    // Everything below — user profile, roles, token rotation — runs
    // under app.current_org = rt.org_id so RLS passes cleanly.
    const { u, roles, accessToken, expiresIn, next } = await withOrg(
      this.deps.pool,
      rt.org_id,
      async (client) => {
        const { rows: userRows } = await client.query<{
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
          `SELECT id, email, name, capabilities
             FROM users
            WHERE id = $1 AND is_active = true`,
          [rt.user_id]
        );
        const user = userRows[0];
        if (!user) throw new UnauthorizedError("user no longer active");

        const { rows: roleRows } = await client.query<{ role_id: string }>(
          `SELECT role_id FROM user_roles WHERE user_id = $1`,
          [user.id]
        );
        const userRoles = roleRows.map((r) => r.role_id as Role);

        const issued = await this.deps.tokens.issueAccess({
          userId: user.id,
          identityId: rt.identity_id,
          orgId: rt.org_id,
          audience: rt.audience,
          roles: userRoles,
          capabilities: user.capabilities,
        });

        const rotated = this.deps.tokens.mintRefresh();
        const expiresAt = new Date(Date.now() + this.deps.refreshTtlSec * 1000);
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
          [rt.id]
        );
        await client.query(
          `INSERT INTO refresh_tokens (
             user_id, org_id, identity_id, token_hash, audience,
             user_agent, ip_address, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            rt.user_id,
            rt.org_id,
            rt.identity_id,
            rotated.hash,
            rt.audience,
            args.userAgent ?? null,
            args.ipAddress ?? null,
            expiresAt,
          ]
        );
        return {
          u: user,
          roles: userRoles,
          accessToken: issued.token,
          expiresIn: issued.expiresIn,
          next: rotated,
        };
      }
    );

    return {
      status: "authenticated",
      accessToken,
      refreshToken: next.raw,
      expiresIn,
      user: {
        id: u.id,
        identityId: rt.identity_id,
        orgId: rt.org_id,
        email: u.email,
        name: u.name,
        roles,
      },
    };
  }

  // ─── Logout ────────────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    // Lookup is cross-tenant (caller may no longer know the org) but
    // the UPDATE must be tenant-scoped so RLS WITH CHECK passes. Look
    // up the row via the SECURITY DEFINER helper to discover org_id,
    // then UPDATE inside withOrg. If the hash doesn't match anything,
    // silently succeed — logout is idempotent by design.
    const hash = this.deps.tokens.hashRefresh(refreshToken);
    const { rows } = await this.deps.pool.query<{ org_id: string }>(
      `SELECT org_id FROM public.auth_load_refresh_token($1)`,
      [hash]
    );
    const orgId = rows[0]?.org_id;
    if (!orgId) return;
    await withOrg(this.deps.pool, orgId, async (client) => {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
          WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hash]
      );
    });
  }

  // ─── /me ───────────────────────────────────────────────────────────

  async me(
    userId: string,
    orgId: string
  ): Promise<{
    id: string;
    identityId: string;
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
    // users + user_roles are tenant-scoped; the authGuard already
    // verified this caller's access token and passed claims.org as
    // orgId. Running under withOrg guarantees RLS lets us see our
    // own row and rejects any attempt to spoof a different orgId in
    // userId (the RLS predicate requires org_id matches).
    return withOrg(this.deps.pool, orgId, async (client) => {
      const { rows } = await client.query<{
        id: string;
        org_id: string;
        identity_id: string;
        email: string;
        name: string;
        capabilities: {
          permittedLines: string[];
          tier?: "T1" | "T2" | "T3";
          canPCBRework: boolean;
          canOCAssembly: boolean;
        };
      }>(
        `SELECT id, org_id, identity_id, email, name, capabilities
           FROM users WHERE id = $1`,
        [userId]
      );
      const u = rows[0];
      if (!u) throw new NotFoundError("user");
      const { rows: roleRows } = await client.query<{ role_id: string }>(
        `SELECT role_id FROM user_roles WHERE user_id = $1`,
        [u.id]
      );
      const roles = roleRows.map((r) => r.role_id as Role);
      const perms = new Set<string>();
      for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) perms.add(p);
      return {
        id: u.id,
        identityId: u.identity_id,
        orgId: u.org_id,
        email: u.email,
        name: u.name,
        roles,
        permissions: [...perms],
        capabilities: u.capabilities,
      };
    });
  }

  // ─── Internals ─────────────────────────────────────────────────────

  private async issueAuthenticatedSession(args: {
    identityId: string;
    membership: InternalMembership;
    surface: "internal" | "portal";
    userAgent?: string;
    ipAddress?: string;
  }): Promise<AuthenticatedStep> {
    const { identityId, membership, surface } = args;
    const audience: Audience =
      surface === "internal" ? AUDIENCE.internal : AUDIENCE.portal;

    // Gate every new session on tenant status. SUSPENDED/DELETED → throws;
    // TRIAL with expired trial_ends_at → throws 402. ACTIVE and live
    // TRIAL continue to token minting below.
    await this.deps.tenantStatus.assertActive(membership.orgId);

    const { token: accessToken, expiresIn } = await this.deps.tokens.issueAccess({
      userId: membership.userId,
      identityId,
      orgId: membership.orgId,
      audience,
      roles: membership.roles,
      capabilities: membership.capabilities,
    });

    const { raw, hash } = this.deps.tokens.mintRefresh();
    const expiresAt = new Date(Date.now() + this.deps.refreshTtlSec * 1000);

    // refresh_tokens has RLS with WITH CHECK on org_id. The tenant HAS
    // been picked by this point (we're about to mint the session for it),
    // so withOrg is the correct wrapper — it sets app.current_org inside
    // a txn so the RLS policy accepts the INSERT.
    await withOrg(this.deps.pool, membership.orgId, async (client) => {
      await client.query(
        `INSERT INTO refresh_tokens (
           user_id, org_id, identity_id, token_hash, audience,
           user_agent, ip_address, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          membership.userId,
          membership.orgId,
          identityId,
          hash,
          audience,
          args.userAgent ?? null,
          args.ipAddress ?? null,
          expiresAt,
        ]
      );
    });

    // Bump identity.last_login_at for audit / suspicious-login detection.
    // user_identities is a GLOBAL table (no RLS), so a raw pool query is
    // fine here — see ops/sql/rls/01-enable-rls.sql.
    await this.deps.pool.query(
      `UPDATE user_identities
          SET last_login_at     = now(),
              failed_login_count = 0
        WHERE id = $1`,
      [identityId]
    );

    return {
      status: "authenticated",
      accessToken,
      refreshToken: raw,
      expiresIn,
      user: {
        id: membership.userId,
        identityId,
        orgId: membership.orgId,
        email: membership.email,
        name: membership.name,
        roles: membership.roles,
      },
    };
  }

  /**
   * Cross-tenant load of every ACTIVE membership belonging to one
   * identity, joined to the per-tenant profile and its roles. Run
   * without withOrg — tenant has not been chosen yet.
   *
   * The join (memberships + organizations + users + user_roles)
   * crosses four RLS-protected tables, so a raw query from the
   * RLS-enabled pool returns zero rows at login time (no
   * `app.current_org` set yet). We route through
   * `public.auth_load_active_memberships(uuid)`, a SECURITY DEFINER
   * function that bypasses RLS for exactly this shape — see
   * ops/sql/rls/03-auth-cross-tenant.sql for the safety argument.
   * The caller (login / select-tenant) has already verified the
   * identity's password before we reach this method.
   */
  private async loadActiveMemberships(
    identityId: string
  ): Promise<InternalMembership[]> {
    const { rows } = await this.deps.pool.query<{
      org_id: string;
      org_name: string;
      user_id: string;
      email: string;
      name: string;
      capabilities: InternalMembership["capabilities"];
      roles: string[];
    }>(
      `SELECT org_id, org_name, user_id, email, name, capabilities, roles
         FROM public.auth_load_active_memberships($1::uuid)`,
      [identityId]
    );
    return rows.map((r) => ({
      orgId: r.org_id,
      orgName: r.org_name,
      userId: r.user_id,
      email: r.email,
      name: r.name,
      capabilities: r.capabilities,
      roles: r.roles as Role[],
    }));
  }

}

interface InternalMembership {
  orgId: string;
  orgName: string;
  userId: string;
  email: string;
  name: string;
  roles: Role[];
  capabilities: {
    permittedLines: string[];
    tier?: "T1" | "T2" | "T3";
    canPCBRework: boolean;
    canOCAssembly: boolean;
  };
}
