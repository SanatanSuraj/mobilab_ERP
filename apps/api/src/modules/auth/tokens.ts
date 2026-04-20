/**
 * JWT signing / verifying helpers. ARCHITECTURE.md §3.1a.
 *
 * Access tokens:  short (default 15 min), stateless, HS256.
 * Refresh tokens: opaque random string; the SHA-256 hash is stored in
 *                 refresh_tokens and rotated on every refresh.
 */

import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { UnauthorizedError } from "@mobilab/errors";
import {
  AUDIENCE,
  type Audience,
  type Role,
  JwtClaimsSchema,
  type JwtClaims,
} from "@mobilab/contracts";

export interface IssueAccessTokenInput {
  userId: string;
  orgId: string;
  audience: Audience;
  roles: Role[];
  capabilities?: JwtClaims["capabilities"];
}

export interface TokenFactoryConfig {
  secret: Uint8Array;
  issuer: string;
  accessTokenTtlSec: number;
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
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(input.userId)
      .setIssuer(this.cfg.issuer)
      .setAudience(input.audience)
      .setExpirationTime(`${this.cfg.accessTokenTtlSec}s`)
      .setIssuedAt()
      .setJti(jti)
      // `org` is non-standard but we need it for the RLS GUC.
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
      // Validate the shape we actually depend on.
      const parsed = JwtClaimsSchema.safeParse({
        ...payload,
        // jose payloads omit the `aud` on the parsed object occasionally;
        // normalize.
        aud: Array.isArray(payload.aud) ? payload.aud[0] : payload.aud,
        // `org` is expected on our side but might live in the payload as-is.
        org: (payload as { org?: string }).org ?? "",
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
