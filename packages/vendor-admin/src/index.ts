/**
 * @mobilab/vendor-admin — service layer for the /vendor-admin/* surface.
 *
 * Sibling of @mobilab/quotas: Fastify-agnostic business logic over the
 * BYPASSRLS `mobilab_vendor` pool. The Fastify routes / guards live in
 * apps/api/src/modules/vendor/ and inject these services.
 *
 * Public exports:
 *   - VendorAuthService           login / refresh / logout / me
 *   - VendorAdminService          suspend / reinstate / change-plan / list / audit
 *   - recordVendorAction          one-shot audit log INSERT (txn-bound)
 *   - recordVendorActionStandalone same, but on the pool (best-effort)
 *   - types for Deps and the narrow TokenFactory interface
 */

export {
  VendorAuthService,
  type VendorAuthServiceDeps,
  type VendorAuthenticatedStep,
  type VendorTokenFactoryLike,
} from "./auth.service.js";

export {
  VendorAdminService,
  type VendorAdminServiceDeps,
  type VendorAdminContext,
} from "./admin.service.js";

export {
  recordVendorAction,
  recordVendorActionStandalone,
  type VendorAuditEntry,
} from "./audit.js";
