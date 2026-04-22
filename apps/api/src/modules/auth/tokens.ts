/**
 * JWT signing / verifying helpers. ARCHITECTURE.md §3.1a.
 *
 * Three token classes:
 *   access         — short (15m), HS256, aud ∈ {instigenie-internal, instigenie-portal}
 *   refresh        — opaque 64B, SHA-256-stored, rotated per refresh call
 *   tenantPicker   — short (5m), HS256, aud = instigenie-tenant-picker,
 *                    subject = user_identities.id; exchanged for an access
 *                    pair at POST /auth/select-tenant.
 *
 * `idn` (user_identities.id) is embedded in access tokens as an optional
 * claim so the refresh path can prove "same human" across tenant switches
 * without a DB round-trip.
 */

import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { UnauthorizedError } from "@instigenie/errors";
import {
  AUDIENCE,
  type Audience,
  type Role,
  JwtClaimsSchema,
  TenantPickerClaimsSchema,
  VendorAdminClaimsSchema,
  type JwtClaims,
  type TenantPickerClaims,
  type VendorAdminClaims,
} from "@instigenie/contracts";

export interface IssueAccessTokenInput {
  userId: string;
  identityId: string;
  orgId: string;
  audience: Audience;
  roles: Role[];
  capabilities?: JwtClaims["capabilities"];
}

export interface IssueTenantPickerInput {
  identityId: string;
  surface: "internal" | "portal";
}

export interface TokenFactoryConfig {
  secret: Uint8Array;
  issuer: string;
  accessTokenTtlSec: number;
  /** Tenant-picker token TTL in seconds. Default 5 minutes. */
  tenantPickerTtlSec?: number;
}

export class TokenFactory {
  constructor(private readonly cfg: TokenFactoryConfig) {}

  async issueAccess(input: IssueAccessTokenInput): Promise<{
    token: string;
    expiresIn: number;
    jti: string;
  }> {
    const jti = crypto.randomUUID();
    const token = await new SignJWT({
      roles: input.roles,
      // `org` and `idn` are non-standard but we need them for the RLS GUC
      // and for cross-tenant identity continuity.
      org: input.orgId,
      idn: input.identityId,
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(input.userId)
      .setIssuer(this.cfg.issuer)
      .setAudience(input.audience)
      .setExpirationTime(`${this.cfg.accessTokenTtlSec}s`)
      .setIssuedAt()
      .setJti(jti)
      .sign(this.cfg.secret);
    return {
      token,
      expiresIn: this.cfg.accessTokenTtlSec,
      jti,
    };
  }

  async verifyAccess(token: string, expectedAud: Audience): Promise<JwtClaims> {
    try {
      const { payload } = await jwtVerify(token, this.cfg.secret, {
        issuer: this.cfg.issuer,
        audience: expectedAud,
      });
      const parsed = JwtClaimsSchema.safeParse({
        ...payload,
        aud: Array.isArray(payload.aud) ? payload.aud[0] : payload.aud,
        org: (payload as { org?: string }).org ?? "",
        idn: (payload as { idn?: string }).idn,
      });
      if (!parsed.success) {
        throw new UnauthorizedError("invalid token claims", {
          issues: parsed.error.issues,
        });
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError("invalid or expired token");
    }
  }

  // ─── Tenant-picker ─────────────────────────────────────────────────────

  async issueTenantPicker(input: IssueTenantPickerInput): Promise<{
    token: string;
    expiresIn: number;
  }> {
    const ttl = this.cfg.tenantPickerTtlSec ?? 300;
    const jti = crypto.randomUUID();
    const token = await new SignJWT({ surface: input.surface })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(input.identityId)
      .setIssuer(this.cfg.issuer)
      .setAudience(AUDIENCE.tenantPicker)
      .setExpirationTime(`${ttl}s`)
      .setIssuedAt()
      .setJti(jti)
      .sign(this.cfg.secret);
    return { token, expiresIn: ttl };
  }

  async verifyTenantPicker(token: string): Promise<TenantPickerClaims> {
    try {
      const { payload } = await jwtVerify(token, this.cfg.secret, {
        issuer: this.cfg.issuer,
        audience: AUDIENCE.tenantPicker,
      });
      const parsed = TenantPickerClaimsSchema.safeParse({
        ...payload,
        aud: Array.isArray(payload.aud) ? payload.aud[0] : payload.aud,
      });
      if (!parsed.success) {
        throw new UnauthorizedError("invalid tenant picker token", {
          issues: parsed.error.issues,
        });
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError("invalid or expired tenant picker token");
    }
  }

  // ─── Vendor-admin ──────────────────────────────────────────────────────
  // Separate from issueAccess because vendor tokens carry NO `org` / `roles`
  // / `capabilities`. They authorize /vendor-admin/* against the
  // instigenie_vendor BYPASSRLS pool, not the tenant pool.

  async issueVendorAccess(input: {
    vendorAdminId: string;
    email: string;
    name: string;
  }): Promise<{ token: string; expiresIn: number; jti: string }> {
    const jti = crypto.randomUUID();
    const token = await new SignJWT({
      email: input.email,
      name: input.name,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(input.vendorAdminId)
      .setIssuer(this.cfg.issuer)
      .setAudience(AUDIENCE.vendor)
      .setExpirationTime(`${this.cfg.accessTokenTtlSec}s`)
      .setIssuedAt()
      .setJti(jti)
      .sign(this.cfg.secret);
    return { token, expiresIn: this.cfg.accessTokenTtlSec, jti };
  }

  async verifyVendorAccess(token: string): Promise<VendorAdminClaims> {
    try {
      const { payload } = await jwtVerify(token, this.cfg.secret, {
        issuer: this.cfg.issuer,
        audience: AUDIENCE.vendor,
      });
      const parsed = VendorAdminClaimsSchema.safeParse({
        ...payload,
        aud: Array.isArray(payload.aud) ? payload.aud[0] : payload.aud,
      });
      if (!parsed.success) {
        throw new UnauthorizedError("invalid vendor token claims", {
          issues: parsed.error.issues,
        });
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError("invalid or expired vendor token");
    }
  }

  // ─── Refresh (opaque) ──────────────────────────────────────────────────

  /**
   * Generate an opaque refresh token (base64url, 64 bytes). Return both
   * the raw value (sent to the client) and its sha256 hash (stored in DB).
   */
  mintRefresh(): { raw: string; hash: string } {
    const raw = crypto.randomBytes(64).toString("base64url");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    return { raw, hash };
  }

  hashRefresh(raw: string): string {
    return crypto.createHash("sha256").update(raw).digest("hex");
  }
}

export const AUDIENCE_VALUES = AUDIENCE;
