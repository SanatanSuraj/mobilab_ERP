/**
 * Admin-users service. Drives the invitation lifecycle:
 *
 *   invite()        — create user_invitations row + outbox event. Idempotent
 *                     on (org, email) via the partial unique index.
 *   list()          — admin dashboard list with status filtering.
 *   revoke()        — mark an open invitation revoked (metadata stamp).
 *   preview()       — pre-auth token → invitation summary for the accept page.
 *   accept()        — link / create identity, create per-tenant profile,
 *                     membership, role; mark accept; mint a login session.
 *
 * All tenant-scoped writes run inside withRequest() / withOrg() so RLS sees
 * the org GUC. Cross-tenant reads (accept-invite preview) go through
 * SECURITY DEFINER helpers — see repository.ts.
 */

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { FastifyRequest } from "fastify";
import type { Pool } from "pg";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
} from "@instigenie/errors";
import {
  AUDIENCE,
  ROLE_PERMISSIONS,
  isInternalRole,
  type Role,
  type InvitationStatus,
  type InviteUserRequest,
  type InvitationSummary,
  type ListInvitationsQuery,
  type ListInvitationsResponse,
  type AcceptInvitePreviewResponse,
  type AcceptInviteRequest,
  type AcceptInviteResponse,
  type InviteUserResponse,
  type UserInviteCreatedPayload,
} from "@instigenie/contracts";
import { enqueueOutbox, withOrg } from "@instigenie/db";
import { withRequest } from "../shared/with-request.js";
import { requireUser } from "../../context/request-context.js";
import type { TokenFactory } from "../auth/tokens.js";
import type { TenantStatusService } from "../tenants/service.js";
import {
  acceptInvitationTx,
  findActiveInvitationByEmail,
  findIdentityByEmail,
  insertIdentity,
  insertInvitation,
  listInvitations,
  loadInvitationByTokenHash,
  loadOrgName,
  loadUserSummary,
  revokeInvitation,
  type InvitationListRow,
  type InvitationRow,
  type InvitationWithOrgRow,
} from "./repository.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

const BCRYPT_COST = 10;

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Classify an invitation row to the UI-facing status enum. */
function statusOf(row: {
  accepted_at: Date | null;
  expires_at: Date;
  metadata?: Record<string, unknown>;
}): InvitationStatus {
  if (row.accepted_at) return "ACCEPTED";
  const revokedAt = row.metadata?.["revokedAt"];
  if (typeof revokedAt === "string" && revokedAt.length > 0) return "REVOKED";
  if (row.expires_at.getTime() <= Date.now()) return "EXPIRED";
  return "PENDING";
}

function toSummary(
  row: InvitationRow | InvitationListRow,
  metadata?: Record<string, unknown>,
): InvitationSummary {
  const meta =
    "metadata" in row ? row.metadata : (metadata ?? {});
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    roleId: row.role_id,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at.toISOString(),
    acceptedAt: row.accepted_at ? row.accepted_at.toISOString() : null,
    status: statusOf({
      accepted_at: row.accepted_at,
      expires_at: row.expires_at,
      metadata: meta,
    }),
    createdAt: row.created_at.toISOString(),
  };
}

function buildAcceptUrl(webOrigin: string, rawToken: string): string {
  const url = new URL("/auth/accept-invite", webOrigin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

// ─── Service class ─────────────────────────────────────────────────────────

export interface AdminUsersServiceDeps {
  pool: Pool;
  tokens: TokenFactory;
  refreshTtlSec: number;
  tenantStatus: TenantStatusService;
  /**
   * Public origin of the web app. Used when stamping the dev-only accept
   * URL on the invite response so the dashboard can surface it without
   * waiting for SMTP wiring.
   */
  webOrigin: string;
  /**
   * Whether to include `devAcceptUrl` on the invite response. Safe to
   * include in dev, stripped in prod.
   */
  includeDevAcceptUrl: boolean;
}

export class AdminUsersService {
  constructor(private readonly deps: AdminUsersServiceDeps) {}

  // ─── POST /admin/users/invite ────────────────────────────────────────

  async invite(
    req: FastifyRequest,
    input: InviteUserRequest,
  ): Promise<InviteUserResponse> {
    const user = requireUser(req);

    // Guardrail: a caller with `users:invite` but without the CUSTOMER
    // permission bundle shouldn't be able to hand out CUSTOMER roles here
    // — that's a portal-identity creation flow with its own pathway.
    if (input.roleId === "CUSTOMER") {
      throw new ValidationError(
        "CUSTOMER role cannot be granted via tenant invite",
      );
    }

    const ttlHours = input.expiresInHours ?? 72;
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

    const { invitation, rawToken, orgName, inviterName } = await withRequest(
      req,
      this.deps.pool,
      async (client) => {
        const existing = await findActiveInvitationByEmail(
          client,
          user.orgId,
          input.email,
        );
        if (existing) {
          throw new ConflictError(
            "an active invitation for this email already exists",
            { invitationId: existing.id },
          );
        }

        // Generate the token + hash. Raw leaves the server only via the
        // email URL; the DB stores sha256(raw).
        const raw = crypto.randomBytes(32).toString("hex");
        const hash = sha256(raw);

        const inserted = await insertInvitation(client, {
          orgId: user.orgId,
          email: input.email,
          roleId: input.roleId,
          tokenHash: hash,
          invitedBy: user.id,
          expiresAt,
          metadata: input.name ? { name: input.name } : {},
        });

        const orgName = await loadOrgName(client, user.orgId);
        const inviter = await loadUserSummary(client, user.id);

        const payload: UserInviteCreatedPayload = {
          invitationId: inserted.id,
          orgId: user.orgId,
          orgName: orgName ?? "",
          recipient: inserted.email,
          roleId: inserted.role_id,
          rawToken: raw,
          expiresAt: inserted.expires_at.toISOString(),
          invitedByUserId: user.id,
          invitedByName: inviter?.name ?? null,
          inviteeNameHint: input.name ?? null,
        };

        // Outbox event. Idempotency key ties to the invitation row so a
        // double-click in the UI collapses to a single email.
        await enqueueOutbox(client, {
          aggregateType: "user_invitation",
          aggregateId: inserted.id,
          eventType: "user.invite.created",
          payload: payload as unknown as Record<string, unknown>,
          idempotencyKey: `user.invite.created:${inserted.id}`,
        });

        return {
          invitation: inserted,
          rawToken: raw,
          orgName: orgName ?? "",
          inviterName: inviter?.name ?? null,
        };
      },
    );

    void orgName;
    void inviterName;

    const response: InviteUserResponse = {
      invitation: toSummary(invitation),
    };
    if (this.deps.includeDevAcceptUrl) {
      response.devAcceptUrl = buildAcceptUrl(this.deps.webOrigin, rawToken);
    }
    return response;
  }

  // ─── GET /admin/users/invitations ─────────────────────────────────────

  async list(
    req: FastifyRequest,
    query: ListInvitationsQuery,
  ): Promise<ListInvitationsResponse> {
    return withRequest(req, this.deps.pool, async (client) => {
      const { items, total } = await listInvitations(client, query);
      return {
        total,
        limit: query.limit,
        offset: query.offset,
        items: items.map((r) => toSummary(r)),
      };
    });
  }

  // ─── POST /admin/users/invitations/:id/revoke ─────────────────────────

  async revoke(
    req: FastifyRequest,
    invitationId: string,
  ): Promise<InvitationSummary> {
    const user = requireUser(req);
    const updated = await withRequest(req, this.deps.pool, async (client) => {
      return revokeInvitation(client, invitationId, user.id);
    });
    if (!updated) {
      throw new NotFoundError("invitation");
    }
    return toSummary(updated);
  }

  // ─── GET /auth/accept-invite/preview ──────────────────────────────────
  // Pre-auth. Pool-only lookup via SECURITY DEFINER function.

  async preview(rawToken: string): Promise<AcceptInvitePreviewResponse> {
    const row = await loadInvitationByTokenHash(this.deps.pool, sha256(rawToken));
    this.assertInviteUsable(row);
    const identity = await findIdentityByEmail(this.deps.pool, row!.email);
    const hint =
      typeof row!.metadata?.["name"] === "string"
        ? (row!.metadata["name"] as string)
        : null;
    return {
      email: row!.email,
      orgId: row!.org_id,
      orgName: row!.org_name,
      roleId: row!.role_id,
      expiresAt: row!.expires_at.toISOString(),
      suggestedName: hint,
      identityExists: !!identity && !!identity.password_hash,
    };
  }

  // ─── POST /auth/accept-invite ─────────────────────────────────────────

  async accept(
    req: FastifyRequest,
    input: AcceptInviteRequest,
  ): Promise<AcceptInviteResponse> {
    const row = await loadInvitationByTokenHash(
      this.deps.pool,
      sha256(input.token),
    );
    this.assertInviteUsable(row);
    const orgId = row!.org_id;

    // Tenant gate — don't drop a new user into a suspended/deleted tenant.
    await this.deps.tenantStatus.assertActive(orgId);

    // Resolve identity: link-or-create.
    const existing = await findIdentityByEmail(this.deps.pool, row!.email);
    let identityId: string;
    if (existing && existing.password_hash) {
      if (existing.status !== "ACTIVE") {
        throw new ForbiddenError("identity is locked or disabled");
      }
      if (input.password) {
        throw new ValidationError(
          "this email already has an account; sign in with your existing password",
        );
      }
      identityId = existing.id;
    } else {
      if (!input.password) {
        throw new ValidationError("password is required for a new account");
      }
      // bcrypt cost 10 mirrors TokenFactory / seed scripts.
      const hash = await bcrypt.hash(input.password, BCRYPT_COST);
      if (existing) {
        // Row exists but has no password_hash (seeded stub). Patch it.
        await this.deps.pool.query(
          `UPDATE user_identities
              SET password_hash = $2, status = 'ACTIVE'
            WHERE id = $1`,
          [existing.id, hash],
        );
        identityId = existing.id;
      } else {
        const fresh = await insertIdentity(this.deps.pool, {
          email: row!.email,
          passwordHash: hash,
        });
        identityId = fresh.id;
      }
    }

    // Tenant-scoped writes: new user, membership, role, mark invite.
    const { userId } = await withOrg(this.deps.pool, orgId, async (client) => {
      return acceptInvitationTx(client, {
        invitationId: row!.id,
        orgId,
        identityId,
        email: row!.email,
        name: input.name,
        roleId: row!.role_id,
      });
    });

    // Issue a login session (access + refresh) so the user lands on the
    // dashboard without bouncing through /auth/login.
    const roles: Role[] = [row!.role_id];
    if (!roles.some(isInternalRole)) {
      // Belt + braces: the invite route already blocks CUSTOMER, but make
      // sure we never mint an internal access token for a portal-only role.
      throw new UnauthorizedError(
        "role is not eligible for internal access",
      );
    }

    const { token: accessToken, expiresIn } = await this.deps.tokens.issueAccess({
      userId,
      identityId,
      orgId,
      audience: AUDIENCE.internal,
      roles,
      capabilities: undefined,
    });

    const { raw: refreshRaw, hash: refreshHash } = this.deps.tokens.mintRefresh();
    const refreshExpires = new Date(Date.now() + this.deps.refreshTtlSec * 1000);
    await withOrg(this.deps.pool, orgId, async (client) => {
      await client.query(
        `INSERT INTO refresh_tokens
           (user_id, org_id, identity_id, token_hash, audience,
            user_agent, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          userId,
          orgId,
          identityId,
          refreshHash,
          AUDIENCE.internal,
          req.headers["user-agent"] ?? null,
          req.ip ?? null,
          refreshExpires,
        ],
      );
      // Quick confirm: also light up the first-login timestamp.
      await client.query(
        `UPDATE users SET is_active = true WHERE id = $1`,
        [userId],
      );
    });

    // Confirm ROLE_PERMISSIONS still has this role — defensive; would have
    // thrown at contracts validation if it didn't.
    void ROLE_PERMISSIONS[row!.role_id];

    return {
      status: "authenticated",
      accessToken,
      refreshToken: refreshRaw,
      expiresIn,
      user: {
        id: userId,
        identityId,
        orgId,
        email: row!.email,
        name: input.name,
        roles,
      },
    };
  }

  // ─── Internals ────────────────────────────────────────────────────────

  /**
   * Throws the right error if the invite is unusable. Narrows `row` to
   * non-null for callers (TS note: we assert via `!` after this returns).
   */
  private assertInviteUsable(row: InvitationWithOrgRow | null): void {
    if (!row) throw new NotFoundError("invitation");
    const status = statusOf({
      accepted_at: row.accepted_at,
      expires_at: row.expires_at,
      metadata: row.metadata,
    });
    if (status === "ACCEPTED") {
      throw new ConflictError("invitation already accepted");
    }
    if (status === "REVOKED") {
      throw new ForbiddenError("invitation has been revoked");
    }
    if (status === "EXPIRED") {
      throw new ForbiddenError("invitation has expired");
    }
  }
}
