/**
 * Role catalogue. ARCHITECTURE.md §9.4 — locked verbatim. Do not rename,
 * reorder, or collapse these. Every identifier is referenced in SQL RLS
 * policies and in permission-check middleware.
 */

export const ROLES = [
  "SUPER_ADMIN",
  "MANAGEMENT",
  "SALES_REP",
  "SALES_MANAGER",
  "FINANCE",
  "PRODUCTION",
  "PRODUCTION_MANAGER",
  "RD",
  "QC_INSPECTOR",
  "QC_MANAGER",
  "STORES",
  "CUSTOMER",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Internal roles run the admin UI. CUSTOMER runs only the customer portal.
 * Used by the `aud` claim check in packages/api/src/modules/auth.
 */
export const INTERNAL_ROLES: readonly Role[] = ROLES.filter(
  (r) => r !== "CUSTOMER"
) as readonly Role[];

export const PORTAL_ROLES: readonly Role[] = ["CUSTOMER"];

export function isInternalRole(r: Role): boolean {
  return r !== "CUSTOMER";
}

/**
 * JWT audience tags — must match the API's `aud` claim verifier.
 *
 *   internal       — admin UI tokens (staff)
 *   portal         — customer portal tokens
 *   tenantPicker   — short-lived token from POST /auth/login when an
 *                    identity has 2+ active memberships; the client
 *                    exchanges it at POST /auth/select-tenant.
 *   vendor         — Mobilab employee admin console tokens. These sit
 *                    ABOVE the tenant boundary and carry NO `org` claim;
 *                    they authorize /vendor-admin/* only. See Sprint 3 /
 *                    packages/contracts/src/vendor-admin.ts.
 */
export const AUDIENCE = {
  internal: "mobilab-internal",
  portal: "mobilab-portal",
  tenantPicker: "mobilab-tenant-picker",
  vendor: "mobilab-vendor",
} as const;

/**
 * Audience union for tenant-scoped access tokens (the ones that authorize
 * /auth/*, /crm/* and other tenant API calls). `tenantPicker` and `vendor`
 * are NOT here — `tenantPicker` only unlocks /auth/select-tenant, and
 * `vendor` tokens belong on /vendor-admin/* with their own guard.
 */
export type Audience =
  | (typeof AUDIENCE)["internal"]
  | (typeof AUDIENCE)["portal"];

/** Audience constant for vendor-admin tokens. Type alias keeps callers tidy. */
export type VendorAudience = (typeof AUDIENCE)["vendor"];
