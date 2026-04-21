/**
 * Auth contract: JWT claims shape + request/response schemas for the
 * login / select-tenant / refresh / me endpoints. ARCHITECTURE.md §3.1a.
 *
 * Identity model (Option 2 — Slack/Linear):
 *   - A human has one `user_identity` (global: email + password).
 *   - They can belong to N orgs via `memberships`.
 *   - Login is 2-step:
 *       POST /auth/login            → "multi-tenant" or "authenticated"
 *       POST /auth/select-tenant    → final JWT if "multi-tenant"
 *
 * The API validates requests against these schemas; the web app's fetch
 * wrappers import the same types so frontend + backend cannot drift.
 */

import { z } from "zod";
import { ROLES } from "./roles";

// ─── JWT payloads ─────────────────────────────────────────────────────────────

/**
 * Access-token claims. `aud` distinguishes internal (admin UI) from portal
 * (customer) tokens — a leaked portal token MUST NOT grant admin access.
 *
 * `idn` (identity id) is optional and lets the server recognise the same
 * human across tenant switches without re-authenticating.
 *
 * `capabilities` is the operator capability layer (ARCHITECTURE.md §9.4a).
 */
export const JwtClaimsSchema = z.object({
  sub: z.string().uuid(), // user id (per-tenant profile)
  org: z.string().uuid(), // tenant org id
  idn: z.string().uuid().optional(), // user_identities.id (global)
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

/**
 * Tenant-picker token. Short-lived (5 min), issued by POST /auth/login
 * when an identity has 2+ active memberships. Exchanged at
 * POST /auth/select-tenant for a regular access+refresh pair.
 */
export const TenantPickerClaimsSchema = z.object({
  sub: z.string().uuid(), // user_identities.id
  aud: z.literal("mobilab-tenant-picker"),
  iss: z.literal("mobilab-api"),
  surface: z.enum(["internal", "portal"]),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().uuid(),
});
export type TenantPickerClaims = z.infer<typeof TenantPickerClaimsSchema>;

// ─── Login ─────────────────────────────────────────────────────────────────

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
  surface: z.enum(["internal", "portal"]).default("internal"),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Shared envelope for an authenticated session. Used by /auth/login (when
 * there is exactly one membership) and /auth/select-tenant (always).
 */
export const AuthenticatedResponseSchema = z.object({
  status: z.literal("authenticated"),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(), // seconds
  user: z.object({
    id: z.string().uuid(), // per-tenant users.id
    identityId: z.string().uuid(), // global user_identities.id
    orgId: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    roles: z.array(z.enum(ROLES)),
  }),
});
export type AuthenticatedResponse = z.infer<typeof AuthenticatedResponseSchema>;

/**
 * Returned by /auth/login when the identity has 2+ active memberships
 * on the requested surface. The client shows a tenant picker, then calls
 * /auth/select-tenant with tenantToken + chosen orgId.
 */
export const MultiTenantResponseSchema = z.object({
  status: z.literal("multi-tenant"),
  tenantToken: z.string(),
  memberships: z
    .array(
      z.object({
        orgId: z.string().uuid(),
        orgName: z.string(),
        // Roles in THAT org — lets the client hint which surface suits
        // the user per tenant (e.g. they're a SUPER_ADMIN in one org,
        // CUSTOMER in another).
        roles: z.array(z.enum(ROLES)),
      })
    )
    .min(2),
});
export type MultiTenantResponse = z.infer<typeof MultiTenantResponseSchema>;

export const LoginResponseSchema = z.discriminatedUnion("status", [
  AuthenticatedResponseSchema,
  MultiTenantResponseSchema,
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ─── Select tenant ────────────────────────────────────────────────────────

export const SelectTenantRequestSchema = z.object({
  tenantToken: z.string().min(1),
  orgId: z.string().uuid(),
});
export type SelectTenantRequest = z.infer<typeof SelectTenantRequestSchema>;

export const SelectTenantResponseSchema = AuthenticatedResponseSchema;
export type SelectTenantResponse = z.infer<typeof SelectTenantResponseSchema>;

// ─── Refresh ──────────────────────────────────────────────────────────────

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = AuthenticatedResponseSchema;
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

// ─── /me ──────────────────────────────────────────────────────────────────

export const MeResponseSchema = z.object({
  id: z.string().uuid(),
  identityId: z.string().uuid(),
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

// AUDIENCE lives in ./roles.ts — see the re-export via the barrel (index.ts).

export type TenantPickerAudience = "mobilab-tenant-picker";
