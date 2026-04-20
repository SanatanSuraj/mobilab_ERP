/**
 * Permission catalogue. ARCHITECTURE.md §9.4.
 *
 * Format: `resource:action` — resource is snake_case plural, action is
 * snake_case verb. Never use a verb by itself; never use camelCase.
 *
 * New permissions must be added in THREE places:
 *   1. `PERMISSIONS` (below) — declares the string
 *   2. `ROLE_PERMISSIONS` (below) — maps role(s) that hold it
 *   3. The SQL `permissions` seed (ops/sql/seed/permissions.sql)
 *
 * The CI Gate 6 test (tests/gates/gate-6-rbac.test.ts) verifies these
 * three lists stay in sync. Keep them in alphabetical order within each
 * resource.
 */

import { ROLES, type Role } from "./roles.js";

// ─── Permission literals ──────────────────────────────────────────────────────

export const PERMISSIONS = [
  // customers
  "customers:create",
  "customers:read",
  "customers:update",
  "customers:delete",

  // quotations
  "quotations:create",
  "quotations:read",
  "quotations:update",
  "quotations:approve",
  "quotations:convert_to_so",

  // sales_orders
  "sales_orders:create",
  "sales_orders:read",
  "sales_orders:update",
  "sales_orders:approve_finance",
  "sales_orders:convert_to_wo",

  // work_orders
  "work_orders:create",
  "work_orders:read",
  "work_orders:release",
  "work_orders:close",
  "work_orders:transition",
  "work_orders:assign_operator",

  // bmr
  "bmr:read",
  "bmr:sign_production",
  "bmr:sign_qc",
  "bmr:close",

  // devices
  "devices:create",
  "devices:read",
  "devices:update",
  "devices:recall",

  // qc
  "qc:inspect",
  "qc:approve",
  "qc:reject",

  // ncr
  "ncr:create",
  "ncr:read",
  "ncr:investigate",
  "ncr:sign_rca",
  "ncr:disposition",
  "ncr:close",

  // inventory
  "inventory:read",
  "inventory:adjust",
  "inventory:transfer",
  "inventory:receive",
  "inventory:issue",

  // purchase_orders
  "purchase_orders:create",
  "purchase_orders:read",
  "purchase_orders:update",
  "purchase_orders:approve_finance",

  // purchase_invoices
  "purchase_invoices:create",
  "purchase_invoices:read",
  "purchase_invoices:approve",

  // sales_invoices
  "sales_invoices:create",
  "sales_invoices:read",
  "sales_invoices:approve",
  "sales_invoices:credit_note",

  // payments
  "payments:create",
  "payments:read",
  "payments:reconcile",

  // reports
  "reports:read",
  "reports:export",

  // admin
  "admin:users:manage",
  "admin:roles:manage",
  "admin:settings:manage",
  "admin:audit:read",

  // portal (CUSTOMER)
  "portal:orders:read",
  "portal:invoices:read",
  "portal:devices:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ─── Role → permissions mapping ───────────────────────────────────────────────
// Keep each role's list alphabetized. Tests rely on it.

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS, // everything

  MANAGEMENT: [
    "customers:read",
    "quotations:read",
    "sales_orders:read",
    "work_orders:read",
    "bmr:read",
    "devices:read",
    "ncr:read",
    "inventory:read",
    "purchase_orders:read",
    "purchase_invoices:read",
    "sales_invoices:read",
    "payments:read",
    "reports:read",
    "reports:export",
    "admin:audit:read",
  ],

  SALES_REP: [
    "customers:create",
    "customers:read",
    "customers:update",
    "quotations:create",
    "quotations:read",
    "quotations:update",
    "quotations:convert_to_so",
    "sales_orders:create",
    "sales_orders:read",
    "sales_orders:update",
    "sales_invoices:read",
    "payments:read",
  ],

  SALES_MANAGER: [
    "customers:create",
    "customers:read",
    "customers:update",
    "customers:delete",
    "quotations:create",
    "quotations:read",
    "quotations:update",
    "quotations:approve",
    "quotations:convert_to_so",
    "sales_orders:create",
    "sales_orders:read",
    "sales_orders:update",
    "sales_orders:convert_to_wo",
    "sales_invoices:read",
    "payments:read",
    "reports:read",
  ],

  FINANCE: [
    "customers:read",
    "sales_orders:read",
    "sales_orders:approve_finance",
    "purchase_orders:read",
    "purchase_orders:approve_finance",
    "purchase_invoices:create",
    "purchase_invoices:read",
    "purchase_invoices:approve",
    "sales_invoices:create",
    "sales_invoices:read",
    "sales_invoices:approve",
    "sales_invoices:credit_note",
    "payments:create",
    "payments:read",
    "payments:reconcile",
    "reports:read",
    "reports:export",
  ],

  PRODUCTION: [
    "work_orders:read",
    "work_orders:transition",
    "bmr:read",
    "bmr:sign_production",
    "devices:create",
    "devices:read",
    "devices:update",
    "ncr:create",
    "ncr:read",
    "inventory:read",
    "inventory:issue",
  ],

  PRODUCTION_MANAGER: [
    "work_orders:create",
    "work_orders:read",
    "work_orders:release",
    "work_orders:close",
    "work_orders:transition",
    "work_orders:assign_operator",
    "bmr:read",
    "bmr:sign_production",
    "bmr:close",
    "devices:create",
    "devices:read",
    "devices:update",
    "devices:recall",
    "ncr:create",
    "ncr:read",
    "ncr:investigate",
    "inventory:read",
    "inventory:issue",
    "inventory:adjust",
    "reports:read",
  ],

  RD: [
    "customers:read",
    "quotations:read",
    "devices:read",
    "work_orders:read",
    "bmr:read",
  ],

  QC_INSPECTOR: [
    "work_orders:read",
    "bmr:read",
    "devices:read",
    "devices:update",
    "qc:inspect",
    "ncr:create",
    "ncr:read",
  ],

  QC_MANAGER: [
    "work_orders:read",
    "bmr:read",
    "bmr:sign_qc",
    "devices:read",
    "devices:update",
    "devices:recall",
    "qc:inspect",
    "qc:approve",
    "qc:reject",
    "ncr:create",
    "ncr:read",
    "ncr:investigate",
    "ncr:sign_rca",
    "ncr:disposition",
    "ncr:close",
    "reports:read",
  ],

  STORES: [
    "inventory:read",
    "inventory:adjust",
    "inventory:transfer",
    "inventory:receive",
    "inventory:issue",
    "purchase_orders:read",
  ],

  CUSTOMER: [
    "portal:orders:read",
    "portal:invoices:read",
    "portal:devices:read",
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function hasPermission(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  return out;
}

/** Sanity check called at boot — catches typos between the two sources of truth. */
export function validatePermissionMap(): void {
  const declared = new Set<string>(PERMISSIONS);
  for (const role of ROLES) {
    for (const perm of ROLE_PERMISSIONS[role]) {
      if (!declared.has(perm)) {
        throw new Error(
          `permission map inconsistency: role ${role} references "${perm}" which is not in PERMISSIONS`
        );
      }
    }
  }
}
