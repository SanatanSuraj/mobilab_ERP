/**
 * VendorPasswordResetService — vendor-side mirror of
 * apps/api/src/modules/password-reset/service.ts. Same wire contract,
 * different storage (vendor.* tables) and different reset URL path
 * (/vendor-admin/reset-password instead of /auth/reset-password).
 *
 * Three operations: forgot / preview / reset. All public (token IS the
 * auth). Same anti-enumeration "always 200 OK on forgot" semantics, same
 * 1-hour TTL, same per-admin rate limit.
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
  findVendorAdminByEmail,
  insertToken,
} from "./repository.js";

const TOKEN_TTL_MIN          = 60;
const RATE_LIMIT_WINDOW_HOUR = 1;
const RATE_LIMIT_MAX         = 5;
const BCRYPT_ROUNDS          = 12;

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function clientIp(req: FastifyRequest): string | null {
  const ip = req.ip;
  if (!ip) return null;
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

export interface VendorPasswordResetServiceDeps {
  /** The BYPASSRLS instigenie_vendor pool. */
  pool: pg.Pool;
  webOrigin: string;
  includeDevResetUrl: boolean;
}

export interface VendorForgotResponseWithDev extends ForgotPasswordResponse {
  devResetUrl?: string;
}

export class VendorPasswordResetService {
  constructor(private readonly deps: VendorPasswordResetServiceDeps) {}

  async forgot(
    req: FastifyRequest,
    input: ForgotPasswordRequest,
  ): Promise<VendorForgotResponseWithDev> {
    const admin = await findVendorAdminByEmail(this.deps.pool, input.email);

    if (!admin || !admin.is_active) {
      req.log.info(
        { email: input.email, reason: admin ? "inactive" : "unknown" },
        "vendor.password_reset.requested ignored (no active admin)",
      );
      return { ok: true };
    }

    const recent = await countRecentRequests(
      this.deps.pool,
      admin.id,
      RATE_LIMIT_WINDOW_HOUR,
    );
    if (recent >= RATE_LIMIT_MAX) {
      req.log.warn(
        { vendorAdminId: admin.id, recent },
        "vendor.password_reset.rate_limited",
      );
      return { ok: true };
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60_000);

    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await insertToken(client, {
        vendorAdminId: admin.id,
        tokenHash,
        expiresAt,
        createdIp: clientIp(req),
      });
      await enqueueOutbox(client, {
        aggregateType: "vendor_admin",
        aggregateId: admin.id,
        eventType: "vendor.password_reset.requested",
        payload: {
          tokenId: inserted.id,
          vendorAdminId: admin.id,
          recipient: admin.email,
          rawToken,
          expiresAt: expiresAt.toISOString(),
        },
        idempotencyKey: `vendor.password_reset.requested:${inserted.id}`,
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    req.log.info(
      { vendorAdminId: admin.id, tokenTtlMin: TOKEN_TTL_MIN },
      "vendor.password_reset.requested queued",
    );

    const response: VendorForgotResponseWithDev = { ok: true };
    if (this.deps.includeDevResetUrl) {
      response.devResetUrl = buildVendorResetUrl(this.deps.webOrigin, rawToken);
    }
    return response;
  }

  async preview(
    query: ResetPasswordPreviewQuery,
  ): Promise<ResetPasswordPreviewResponse> {
    const tokenHash = sha256(query.token);
    const row = await findActiveTokenByHash(this.deps.pool, tokenHash);
    if (!row) {
      throw new NotFoundError("reset token is invalid or has expired");
    }
    return { email: row.email, expiresAt: row.expires_at.toISOString() };
  }

  async reset(
    req: FastifyRequest,
    input: ResetPasswordRequest,
  ): Promise<ResetPasswordResponse> {
    const tokenHash = sha256(input.token);
    const row = await findActiveTokenByHash(this.deps.pool, tokenHash);
    if (!row) {
      throw new NotFoundError("reset token is invalid or has expired");
    }
    if (input.newPassword.length < 10) {
      throw new ValidationError("password must be at least 10 characters");
    }

    const newHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);

    const client = await this.deps.pool.connect();
    try {
      await client.query("BEGIN");
      await consumeTokenAndInvalidateSessions(client, {
        tokenId: row.id,
        vendorAdminId: row.vendor_admin_id,
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
      { vendorAdminId: row.vendor_admin_id, tokenId: row.id },
      "vendor.password_reset.completed",
    );

    return { ok: true };
  }
}

export function buildVendorResetUrl(webOrigin: string, rawToken: string): string {
  const url = new URL("/vendor-admin/reset-password", webOrigin);
  url.searchParams.set("token", rawToken);
  return url.toString();
}
