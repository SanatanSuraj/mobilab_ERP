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

/** JWT audience tags — must match the API's `aud` claim verifier. */
export const AUDIENCE = {
  internal: "mobilab-internal",
  portal: "mobilab-portal",
} as const;

export type Audience = (typeof AUDIENCE)[keyof typeof AUDIENCE];
