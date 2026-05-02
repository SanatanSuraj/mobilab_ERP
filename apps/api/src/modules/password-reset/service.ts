/**
 * PasswordResetService — three operations:
 *
 *   forgot()  — accept email, queue reset email if identity exists. Always
 *               returns 200 OK so the response can't be used to enumerate
 *               registered emails.
 *
 *   preview() — accept raw token, return the email address it belongs to
 *               (so the reset page can show "Resetting password for X").
 *               404 on unknown / expired / consumed token.
 *
 *   reset()   — accept raw token + new password, replace password_hash,
 *               consume token, wipe all refresh tokens for the identity
 *               (force re-login on every device).
 *
 * Tenant isolation is N/A here — the affected tables (user_identities,
 * password_reset_tokens, refresh_tokens) are all global. The service
 * uses a bare Pool, never withOrg.
 */

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { FastifyRequest } from "fastify";
import type pg from "pg";

import { enqueueOutbox } from "@instigenie/db";
import { NotFoundError, ValidationError } from "@instigenie/errors";
import type {
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ResetPasswordPreviewQuery,
  ResetPasswordPreviewResponse,
  ResetPasswordRequest,
  ResetPasswordResponse,
} from "@instigenie/contracts";

import {
  consumeTokenAndInvalidateSessions,
  countRecentRequests,
  findActiveTokenByHash,
  findIdentityByEmail,
  insertToken,
} from "./repository.js";

// ─── Tunables ───────────────────────────────────────────────────────────────
// Conservative defaults. Adjust here, not at the call sites.
const TOKEN_TTL_MIN          = 60;        // 1 hour
const RATE_LIMIT_WINDOW_HOUR = 1;
const RATE_LIMIT_MAX         = 5;
const BCRYPT_ROUNDS          = 12;

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function clientIp(req: FastifyRequest): string | null {
  // Fastify already honours X-Forwarded-For when trustProxy is on (it is
  // for this app — Caddy sits in front in prod). Falls back to the socket
  // peer when no header is present.
  const ip = req.ip;
  if (!ip) return null;
  // Strip IPv6 mapping prefix so the inet column doesn't store ::ffff:1.2.3.4.
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

// ─── Service ────────────────────────────────────────────────────────────────

export interface PasswordResetServiceDeps {
  pool: pg.Pool;
  /** Web origin used to render the reset URL into the email body. */
  webOrigin: string;
  /**
   * In non-prod, attach a `devResetUrl` to the response so dashboard /
   * curl loops can advance the flow without a real mailbox. NEVER true
   * in production.
   */
  includeDevResetUrl: boolean;
}

export interface ForgotResponseWithDev extends ForgotPasswordResponse {
  /** Set ONLY when includeDevResetUrl is true AND the email matched an
   *  existing identity. Surfaced so dev/QA can advance the flow without
   *  a real inbox. Must NEVER appear in a production build's response. */
  devResetUrl?: string;
}

export class PasswordResetService {
  constructor(private readonly deps: PasswordResetServiceDeps) {}

  /** POST /auth/forgot-password — body validated by the route. */
  async forgot(
    req: FastifyRequest,
    input: ForgotPasswordRequest,
  ): Promise<ForgotResponseWithDev> {
    const identity = await findIdentityByEmail(this.deps.pool, input.email);

    if (!identity || identity.status !== "ACTIVE") {
      // Silently no-op for unknown / locked / disabled identities.
      // Return shape MUST be identical to the success path so a network
      // observer can't tell the difference.
      req.log.info(
        { email: input.email, reason: identity ? identity.status : "unknown" },
        "auth.password_reset.requested ignored (no active identity)",
      );
      return { ok: true };
    }

    // Per-identity rate limit — guard against an attacker spamming a known
    // user with reset emails. Doesn't try to be a global limiter; the
    // global API rate limit registered in apps/api/src/index.ts handles
    // that surface.
    const recent = await countRecentRequests(
      this.deps.pool,
      identity.id,
      RATE_LIMIT_WINDOW_HOUR,
    );
    if (recent >= RATE_LIMIT_MAX) {
      req.log.warn(
        { identityId: identity.id, recent },
        "auth.password_reset.rate_limited",
      );
      // Still return 200 — never tell the caller why a reset wasn't queued.
      // The legitimate user already has a recent email in their inbox; an
      // attacker shouldn't learn that the account exists or that we're
      // throttling them.
      return { ok: true };
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60_000);

    // Single transaction: token row + outbox event must commit together so
    // listen-notify never sees an event whose token we forgot to persist.
    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await insertToken(client, {
        identityId: identity.id,
        tokenHash,
        expiresAt,
        createdIp: clientIp(req),
      });
      await enqueueOutbox(client, {
        aggregateType: "user_identity",
        aggregateId: identity.id,
        eventType: "user.password_reset.requested",
        payload: {
          tokenId: inserted.id,
          identityId: identity.id,
          recipient: identity.email,
          rawToken,
          expiresAt: expiresAt.toISOString(),
        },
        idempotencyKey: `user.password_reset.requested:${inserted.id}`,
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    req.log.info(
      { identityId: identity.id, tokenTtlMin: TOKEN_TTL_MIN },
      "auth.password_reset.requested queued",
    );

    const response: ForgotResponseWithDev = { ok: true };
    if (this.deps.includeDevResetUrl) {
      response.devResetUrl = buildResetUrl(this.deps.webOrigin, rawToken);
    }
    return response;
  }

  /** GET /auth/reset-password/preview?token=... */
  async preview(
    query: ResetPasswordPreviewQuery,
  ): Promise<ResetPasswordPreviewResponse> {
    const tokenHash = sha256(query.token);
    const row = await findActiveTokenByHash(this.deps.pool, tokenHash);
    if (!row) {
      throw new NotFoundError("reset token is invalid or has expired");
    }
    return {
      email: row.email,
      expiresAt: row.expires_at.toISOString(),
    };
  }

  /** POST /auth/reset-password — token + new password. */
  async reset(
    req: FastifyRequest,
    input: ResetPasswordRequest,
  ): Promise<ResetPasswordResponse> {
    const tokenHash = sha256(input.token);
    const row = await findActiveTokenByHash(this.deps.pool, tokenHash);
    if (!row) {
      throw new NotFoundError("reset token is invalid or has expired");
    }

    // Defensive: the schema-level min is 10, but a future regression in the
    // contract shouldn't be able to produce a 1-char hash silently.
    if (input.newPassword.length < 10) {
      throw new ValidationError("password must be at least 10 characters");
    }

    const newHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      await consumeTokenAndInvalidateSessions(client, {
        tokenId: row.id,
        identityId: row.identity_id,
        passwordHash: newHash,
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    req.log.info(
      { identityId: row.identity_id, tokenId: row.id },
      "auth.password_reset.completed",
    );

    return { ok: true };
  }
}

// Exported separately so the worker handler can reuse the exact same URL
// shape (and a regression in one stays in sync with the other).
export function buildResetUrl(webOrigin: string, rawToken: string): string {
  const url = new URL("/auth/reset-password", webOrigin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}

