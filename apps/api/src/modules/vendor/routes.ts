/**
 * Vendor-admin routes. Mounted at /vendor-admin/*.
 *
 *   POST /vendor-admin/auth/login            { email, password }
 *   POST /vendor-admin/auth/refresh          { refreshToken }
 *   POST /vendor-admin/auth/logout           { refreshToken }
 *   GET  /vendor-admin/auth/me               (Bearer vendor token)
 *
 *   GET  /vendor-admin/tenants               ?status=&plan=&q=&limit=&offset=
 *   POST /vendor-admin/tenants/:orgId/suspend     { reason }
 *   POST /vendor-admin/tenants/:orgId/reinstate   { reason }
 *   POST /vendor-admin/tenants/:orgId/change-plan { planCode, reason }
 *
 *   GET  /vendor-admin/audit                 ?orgId=&action=&vendorAdminId=&limit=&offset=
 *
 * Every route EXCEPT /auth/login, /auth/refresh, /auth/logout is guarded by
 * `vendorGuard`. The /auth/login route is intentionally un-rate-limited at
 * this layer — global @fastify/rate-limit already protects it per-IP.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  VendorLoginRequestSchema,
  CreateTenantRequestSchema,
  SuspendTenantRequestSchema,
  ReinstateTenantRequestSchema,
  ChangePlanRequestSchema,
  VendorTenantListQuerySchema,
  VendorAuditListQuerySchema,
} from "@instigenie/contracts";
import type { VendorAuthService, VendorAdminService } from "@instigenie/vendor-admin";
import {
  createVendorGuard,
  requireVendorAdmin,
  type VendorGuardOptions,
} from "./guard.js";

export interface RegisterVendorRoutesOptions {
  authService: VendorAuthService;
  adminService: VendorAdminService;
  guard: VendorGuardOptions;
}

export async function registerVendorRoutes(
  app: FastifyInstance,
  opts: RegisterVendorRoutesOptions
): Promise<void> {
  const vendorGuard = createVendorGuard(opts.guard);

  // ─── Auth ─────────────────────────────────────────────────────────────

  app.post("/vendor-admin/auth/login", async (req, reply) => {
    const body = VendorLoginRequestSchema.parse(req.body);
    const result = await opts.authService.login({
      email: body.email,
      password: body.password,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    return reply.code(200).send(result);
  });

  app.post("/vendor-admin/auth/refresh", async (req, reply) => {
    const body = z
      .object({ refreshToken: z.string().min(1) })
      .parse(req.body);
    const result = await opts.authService.refresh({
      refreshToken: body.refreshToken,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
    });
    return reply.code(200).send(result);
  });

  app.post("/vendor-admin/auth/logout", async (req, reply) => {
    const body = z
      .object({ refreshToken: z.string().min(1) })
      .parse(req.body);
    await opts.authService.logout({
      refreshToken: body.refreshToken,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return reply.code(204).send();
  });

  app.get(
    "/vendor-admin/auth/me",
    { preHandler: [vendorGuard] },
    async (req, reply) => {
      const admin = requireVendorAdmin(req);
      const me = await opts.authService.me(admin.id);
      return reply.code(200).send(me);
    }
  );

  // ─── Tenants ──────────────────────────────────────────────────────────

  app.get(
    "/vendor-admin/tenants",
    { preHandler: [vendorGuard] },
    async (req, reply) => {
      const admin = requireVendorAdmin(req);
      const query = VendorTenantListQuerySchema.parse(req.query ?? {});
      const result = await opts.adminService.listTenants(query, {
        vendorAdminId: admin.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return reply.code(200).send(result);
    }
  );

  const orgIdParamSchema = z.object({ orgId: z.string().uuid() });

  // Provision a brand-new tenant. Vendor-admin gated; the response
  // carries an invite link the vendor admin hands to the customer's
  // primary admin (dev only — production sends email).
  app.post(
    "/vendor-admin/tenants",
    { preHandler: [vendorGuard] },
    async (req, reply) => {
      const admin = requireVendorAdmin(req);
      const body = CreateTenantRequestSchema.parse(req.body ?? {});
      const result = await opts.adminService.createTenant(body, {
        vendorAdminId: admin.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return reply.code(201).send(result);
    }
  );

  app.post(
    "/vendor-admin/tenants/:orgId/suspend",
    { preHandler: [vendorGuard] },
    async (req, reply) => {
      const admin = requireVendorAdmin(req);
      const { orgId } = orgIdParamSchema.parse(req.params);
      const body = SuspendTenantRequestSchema.parse(req.body);
      await opts.adminService.suspendTenant(orgId, body, {
        vendorAdminId: admin.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return reply.code(204).send();
    }
  );

  app.post(
    "/vendor-admin/tenants/:orgId/reinstate",
    { preHandler: [vendorGuard] },
    async (req, reply) => {
      const admin = requireVendorAdmin(req);
      const { orgId } = orgIdParamSchema.parse(req.params);
      const body = ReinstateTenantRequestSchema.parse(req.body);
      await opts.adminService.reinstateTenant(orgId, body, {
        vendorAdminId: admin.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return reply.code(204).send();
    }
  );

  app.post(
    "/vendor-admin/tenants/:orgId/change-plan",
    { preHandler: [vendorGuard] },
    async (req, reply) => {
      const admin = requireVendorAdmin(req);
      const { orgId } = orgIdParamSchema.parse(req.params);
      const body = ChangePlanRequestSchema.parse(req.body);
      const result = await opts.adminService.changePlan(orgId, body, {
        vendorAdminId: admin.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return reply.code(200).send(result);
    }
  );

  // ─── Audit ────────────────────────────────────────────────────────────

  app.get(
    "/vendor-admin/audit",
    { preHandler: [vendorGuard] },
    async (req, reply) => {
      const admin = requireVendorAdmin(req);
      const query = VendorAuditListQuerySchema.parse(req.query ?? {});
      const result = await opts.adminService.listAudit(query, {
        vendorAdminId: admin.id,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return reply.code(200).send(result);
    }
  );
}
