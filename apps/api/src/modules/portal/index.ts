/**
 * Portal module barrel. ARCHITECTURE.md §3.7 (Phase 3) + §13.9.
 *
 * The portal is a second audience on the same apps/api process:
 *   - Audience: instigenie-portal (JWT aud claim)
 *   - Paths:    /portal/*
 *   - RLS:      app.current_portal_customer (set by withPortalUser)
 *   - Rate:     60 rpm/user (registered separately from the global limiter)
 */

export { PortalService } from "./portal.service.js";
export {
  createPortalCustomerHook,
  blockPortalTokensFromInternalRoutes,
} from "./portal.service.js";
export { portalRepo, type PortalInvoiceSummary } from "./portal.repository.js";
export { registerPortalRoutes } from "./routes.js";
export type { RegisterPortalRoutesOptions } from "./routes.js";
export { withPortalRequest } from "./with-portal-request.js";
