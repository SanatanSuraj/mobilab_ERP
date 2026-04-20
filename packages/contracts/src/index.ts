/**
 * @mobilab/contracts — the source of truth for wire shapes.
 *
 * Import from the barrel for convenience:
 *   import { LoginRequestSchema, ROLE_PERMISSIONS } from "@mobilab/contracts";
 *
 * Or from the subpath for smaller surface area:
 *   import { hasPermission } from "@mobilab/contracts/permissions";
 */

export * from "./roles.js";
export * from "./permissions.js";
export * from "./auth.js";
export * from "./pagination.js";
export * from "./crm.js";
export * from "./billing.js";
export * from "./vendor-admin.js";
