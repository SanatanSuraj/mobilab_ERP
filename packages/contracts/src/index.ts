/**
 * @instigenie/contracts — the source of truth for wire shapes.
 *
 * Import from the barrel for convenience:
 *   import { LoginRequestSchema, ROLE_PERMISSIONS } from "@instigenie/contracts";
 *
 * Or from the subpath for smaller surface area:
 *   import { hasPermission } from "@instigenie/contracts/permissions";
 *
 * Note: explicit ".js" extensions on re-exports are required because downstream
 * consumers (apps/api, packages/quotas, packages/vendor-admin) use
 * `moduleResolution: "NodeNext"` which rejects bare relative imports, while
 * `moduleResolution: "Bundler"` (used by contracts itself and apps/web) accepts
 * both styles.
 */

export * from "./roles.js";
export * from "./permissions.js";
export * from "./auth.js";
export * from "./pagination.js";
export * from "./crm.js";
export * from "./inventory.js";
export * from "./procurement.js";
export * from "./production.js";
export * from "./qc.js";
export * from "./finance.js";
export * from "./notifications.js";
export * from "./approvals.js";
export * from "./billing.js";
export * from "./vendor-admin.js";
export * from "./admin-audit.js";
export * from "./admin-users.js";
export * from "./portal.js";
