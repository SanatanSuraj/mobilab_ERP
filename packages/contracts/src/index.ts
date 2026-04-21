/**
 * @mobilab/contracts — the source of truth for wire shapes.
 *
 * Import from the barrel for convenience:
 *   import { LoginRequestSchema, ROLE_PERMISSIONS } from "@mobilab/contracts";
 *
 * Or from the subpath for smaller surface area:
 *   import { hasPermission } from "@mobilab/contracts/permissions";
 */

export * from "./roles";
export * from "./permissions";
export * from "./auth";
export * from "./pagination";
export * from "./crm";
export * from "./billing";
export * from "./vendor-admin";
