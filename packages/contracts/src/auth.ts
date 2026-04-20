/**
 * Auth contract: JWT claims shape + request/response schemas for the
 * login/refresh/me endpoints. ARCHITECTURE.md §3.1a.
 *
 * The API module validates against these; the web app `fetch` wrappers
 * import the same types so the frontend stays in sync with backend.
 */

import { z } from "zod";
import { ROLES } from "./roles.js";

// ─── JWT payloads ─────────────────────────────────────────────────────────────

/**
 * Access-token claims. `aud` distinguishes internal (admin UI) from portal
 * (customer) tokens — a leaked portal token MUST NOT grant admin access.
 *
 * `capabilities` is the operator capability layer (ARCHITECTURE.md §9.4a):
 *   - permittedLines: assembly lines this user is cleared for
 *   - tier:           T1 / T2 / T3 production competency
 *   - canPCBRework:   rework-bay clearance
 *   - canOCAssembly:  optical-coupler clearance
 */
export const JwtClaimsSchema = z.object({
  sub: z.string().uuid(), // user id
  org: z.string().uuid(), // tenant org id
  aud: z.enum(["mobilab-internal", "mobilab-portal"]),
  iss: z.literal("mobilab-api"),
  roles: z.array(z.enum(ROLES)).min(1),
  capabilities: z
    .object({
      permittedLines: z.array(z.string()).default([]),
      tier: z.enum(["T1", "T2", "T3"]).optional(),
      canPCBRework: z.boolean().default(false),
      canOCAssembly: z.boolean().default(false),
    })
    .optional(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().uuid(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

// ─── Login / refresh ──────────────────────────────────────────────────────────

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
  surface: z.enum(["internal", "portal"]).default("internal"),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(), // seconds
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    roles: z.array(z.enum(ROLES)),
  }),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

// ─── /me ──────────────────────────────────────────────────────────────────────

export const MeResponseSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  roles: z.array(z.enum(ROLES)),
  permissions: z.array(z.string()),
  capabilities: z
    .object({
      permittedLines: z.array(z.string()),
      tier: z.enum(["T1", "T2", "T3"]).optional(),
      canPCBRework: z.boolean(),
      canOCAssembly: z.boolean(),
    })
    .optional(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// ─── Problem+JSON ─────────────────────────────────────────────────────────────
// RFC 7807 shape returned by the API on error. Frontend uses this to surface
// machine-readable codes.

export const ProblemSchema = z.object({
  type: z.string().url().or(z.string()),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;
