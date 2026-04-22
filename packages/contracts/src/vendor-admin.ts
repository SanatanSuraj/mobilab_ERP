/**
 * Vendor-admin contracts (Sprint 3).
 *
 * The vendor-admin surface is the Instigenie employee console used to onboard
 * and offboard real customers. It sits ABOVE the tenant boundary:
 *
 *   - Vendor tokens do NOT carry `org` — there is no "current tenant".
 *   - The DB role (instigenie_vendor) has BYPASSRLS — queries see every row
 *     regardless of the `app.current_org` GUC. RLS still protects tenant
 *     traffic because that still flows through `instigenie_app`.
 *   - Every mutation is recorded to `vendor.action_log` via the
 *     service layer (not a DB trigger) so the actor id + request
 *     metadata (ip, ua) land in one place.
 *
 * This file is the single source of truth for:
 *   - VENDOR_ACTION_TYPES   — enum of things a vendor admin can do
 *   - VendorAdminClaims     — JWT shape for instigenie-vendor tokens
 *   - Login / me schemas    — POST /vendor-admin/auth/login, GET /me
 *   - Tenant admin schemas  — suspend / reinstate / change plan / list
 *   - Audit log schema      — GET /vendor-admin/audit
 */

import { z } from "zod";
import { PLAN_CODES, TENANT_STATUSES } from "./billing.js";

// ─── Actions ────────────────────────────────────────────────────────────────

/**
 * Canonical action verbs logged to `vendor.action_log.action`. Adding a new
 * one is a three-step change:
 *   1. Add the literal here.
 *   2. Add the service method that records it.
 *   3. Add a Gate test that asserts the row lands.
 *
 * Naming convention: `<target_type>.<verb>` — all lowercase, dotted.
 */
export const VENDOR_ACTION_TYPES = [
  // Vendor session lifecycle
  "vendor.login",
  "vendor.logout",

  // Tenant lifecycle
  "tenant.suspend",
  "tenant.reinstate",
  "tenant.change_plan",
  "tenant.view",
  "tenant.view_audit",
  "tenant.list",
] as const;
export type VendorActionType = (typeof VENDOR_ACTION_TYPES)[number];

/** Target-type labels stored in `vendor.action_log.target_type`. */
export const VENDOR_TARGET_TYPES = [
  "vendor_admin",   // the vendor admin themselves (login/logout)
  "organization",   // a tenant org
  "subscription",   // a subscription row
] as const;
export type VendorTargetType = (typeof VENDOR_TARGET_TYPES)[number];

// ─── JWT ────────────────────────────────────────────────────────────────────

/**
 * Vendor access-token claims. Note the ABSENCE of `org` / `roles` /
 * `capabilities` — vendor admins are identity-level, not tenant-level.
 */
export const VendorAdminClaimsSchema = z.object({
  sub: z.string().uuid(),                  // vendor.admins.id
  aud: z.literal("instigenie-vendor"),
  iss: z.literal("instigenie-api"),
  email: z.string().email(),
  name: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().uuid(),
});
export type VendorAdminClaims = z.infer<typeof VendorAdminClaimsSchema>;

// ─── Auth (vendor side) ─────────────────────────────────────────────────────

export const VendorLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});
export type VendorLoginRequest = z.infer<typeof VendorLoginRequestSchema>;

export const VendorLoginResponseSchema = z.object({
  status: z.literal("authenticated"),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(), // seconds
  admin: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  }),
});
export type VendorLoginResponse = z.infer<typeof VendorLoginResponseSchema>;

export const VendorMeResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable().optional(),
});
export type VendorMeResponse = z.infer<typeof VendorMeResponseSchema>;

// ─── Tenant administration ──────────────────────────────────────────────────

/** POST /vendor-admin/tenants/:orgId/suspend */
export const SuspendTenantRequestSchema = z.object({
  // Free-text justification — ends up in vendor.action_log.details.reason.
  // Required: we do NOT let vendors suspend silently.
  reason: z.string().min(1).max(1000),
});
export type SuspendTenantRequest = z.infer<typeof SuspendTenantRequestSchema>;

/** POST /vendor-admin/tenants/:orgId/reinstate */
export const ReinstateTenantRequestSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type ReinstateTenantRequest = z.infer<typeof ReinstateTenantRequestSchema>;

/**
 * POST /vendor-admin/tenants/:orgId/change-plan — swap the live
 * subscription's plan_id. Kept in a separate endpoint from suspend/reinstate
 * so the audit entries stay semantically distinct.
 */
export const ChangePlanRequestSchema = z.object({
  planCode: z.enum(PLAN_CODES),
  reason: z.string().min(1).max(1000),
});
export type ChangePlanRequest = z.infer<typeof ChangePlanRequestSchema>;

/**
 * Row in GET /vendor-admin/tenants — the vendor dashboard's "all customers"
 * table. Joined across organizations + subscriptions + plans.
 */
export const VendorTenantRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(TENANT_STATUSES),
  trialEndsAt: z.string().nullable().optional(),
  suspendedAt: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  plan: z
    .object({
      code: z.enum(PLAN_CODES),
      name: z.string(),
    })
    .nullable(),
  subscription: z
    .object({
      status: z.string(), // SubscriptionStatus — kept as string so future codes don't break the wire shape
      currentPeriodEnd: z.string(),
      cancelAtPeriodEnd: z.boolean(),
    })
    .nullable(),
});
export type VendorTenantRow = z.infer<typeof VendorTenantRowSchema>;

export const VendorTenantListResponseSchema = z.object({
  items: z.array(VendorTenantRowSchema),
  total: z.number().int().nonnegative(),
});
export type VendorTenantListResponse = z.infer<
  typeof VendorTenantListResponseSchema
>;

// ─── Action log ─────────────────────────────────────────────────────────────

/** One row from vendor.action_log, shape returned by GET /vendor-admin/audit. */
export const VendorActionLogEntrySchema = z.object({
  id: z.string().uuid(),
  vendorAdminId: z.string().uuid(),
  vendorAdminEmail: z.string().email().optional(), // joined at read-time
  action: z.string(),          // VendorActionType literal OR future entries — keep open
  targetType: z.string(),      // VendorTargetType literal — ditto
  targetId: z.string().uuid().nullable(),
  orgId: z.string().uuid().nullable(),
  details: z.record(z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
});
export type VendorActionLogEntry = z.infer<typeof VendorActionLogEntrySchema>;

export const VendorAuditListResponseSchema = z.object({
  items: z.array(VendorActionLogEntrySchema),
  total: z.number().int().nonnegative(),
});
export type VendorAuditListResponse = z.infer<
  typeof VendorAuditListResponseSchema
>;

// ─── Query param schemas ────────────────────────────────────────────────────

/** GET /vendor-admin/tenants?status=SUSPENDED&plan=FREE&limit=50&offset=0 */
export const VendorTenantListQuerySchema = z.object({
  status: z.enum(TENANT_STATUSES).optional(),
  plan: z.enum(PLAN_CODES).optional(),
  q: z.string().max(200).optional(), // name ILIKE
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type VendorTenantListQuery = z.infer<typeof VendorTenantListQuerySchema>;

/** GET /vendor-admin/audit?orgId=...&action=tenant.suspend&limit=50&offset=0 */
export const VendorAuditListQuerySchema = z.object({
  orgId: z.string().uuid().optional(),
  action: z.string().max(80).optional(),
  vendorAdminId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type VendorAuditListQuery = z.infer<typeof VendorAuditListQuerySchema>;
