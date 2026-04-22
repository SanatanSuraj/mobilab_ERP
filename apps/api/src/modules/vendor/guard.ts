/**
 * Vendor-admin guard. Verifies a Bearer token with aud = instigenie-vendor and
 * attaches the vendor admin id/email/name to req.vendorAdmin.
 *
 * Kept separate from the tenant auth guard because:
 *   - The expected audience is different.
 *   - Vendor tokens carry no `org` claim — the tenant guard would blow up
 *     at JwtClaimsSchema.parse.
 *   - Vendor routes run against a different DB pool (BYPASSRLS); conflating
 *     the two surfaces invites mistakes where a tenant handler reads the
 *     BYPASSRLS pool by accident.
 *
 * Usage:
 *   preHandler: vendorGuard
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "@instigenie/errors";
import type { TokenFactory } from "../auth/tokens.js";

export interface VendorAdminContextOnRequest {
  id: string;
  email: string;
  name: string;
}

declare module "fastify" {
  interface FastifyRequest {
    vendorAdmin?: VendorAdminContextOnRequest;
  }
}

export interface VendorGuardOptions {
  tokens: TokenFactory;
}

export function createVendorGuard(opts: VendorGuardOptions) {
  return async function vendorGuard(
    req: FastifyRequest,
    _reply: FastifyReply
  ): Promise<void> {
    const h = req.headers.authorization;
    if (!h || !h.startsWith("Bearer ")) {
      throw new UnauthorizedError("missing bearer token");
    }
    const token = h.slice("Bearer ".length).trim();
    if (!token) throw new UnauthorizedError("empty bearer token");

    const claims = await opts.tokens.verifyVendorAccess(token);
    req.vendorAdmin = {
      id: claims.sub,
      email: claims.email,
      name: claims.name,
    };
  };
}

export function requireVendorAdmin(
  req: FastifyRequest
): VendorAdminContextOnRequest {
  if (!req.vendorAdmin) {
    throw new UnauthorizedError("vendor authentication required");
  }
  return req.vendorAdmin;
}
