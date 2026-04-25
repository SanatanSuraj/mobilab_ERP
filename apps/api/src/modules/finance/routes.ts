/**
 * Finance routes. Mounted at /finance/*.
 *
 * Scope (Phase 2):
 *   - sales_invoices (+ lines, lifecycle)
 *   - purchase_invoices (+ lines, lifecycle)
 *   - customer_ledger (read-only list + balance)
 *   - vendor_ledger   (read-only list + balance)
 *   - payments (polymorphic + void)
 *   - overview (flat dashboard KPIs)
 *
 * Permission strategy:
 *   - GET  /finance/sales-invoices/**             → sales_invoices:read
 *   - POST/PATCH/DELETE sales-invoices            → sales_invoices:create
 *   - POST .../submit-for-posting | .../cancel    → sales_invoices:approve
 *     (terminal POST happens via /approvals/:id/act → invoice finaliser)
 *   - GET  /finance/purchase-invoices/** → purchase_invoices:read
 *   - POST/PATCH/DELETE purchase-invoices → purchase_invoices:create
 *   - POST .../post | .../cancel        → purchase_invoices:approve
 *   - GET  /finance/customer-ledger/**  → sales_invoices:read
 *   - GET  /finance/vendor-ledger/**    → purchase_invoices:read
 *   - GET  /finance/payments/**         → payments:read
 *   - POST /finance/payments            → payments:create
 *   - POST /finance/payments/:id/void   → payments:reconcile
 *   - DELETE /finance/payments/:id      → payments:reconcile
 *   - GET  /finance/overview            → sales_invoices:read (AR + AP view)
 *
 * No single Phase-2 module flag gates finance — it's a CORE module (every
 * tenant needs it). No `requireFeature` wrapping.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CancelPurchaseInvoiceSchema,
  CancelSalesInvoiceSchema,
  CreatePaymentSchema,
  CreatePurchaseInvoiceLineSchema,
  CreatePurchaseInvoiceSchema,
  CreateSalesInvoiceLineSchema,
  CreateSalesInvoiceSchema,
  CustomerLedgerListQuerySchema,
  EwayBillListQuerySchema,
  FinanceReportsQuerySchema,
  PaymentListQuerySchema,
  PostPurchaseInvoiceSchema,
  PurchaseInvoiceListQuerySchema,
  SalesInvoiceListQuerySchema,
  SubmitSalesInvoiceForPostingSchema,
  UpdatePurchaseInvoiceLineSchema,
  UpdatePurchaseInvoiceSchema,
  UpdateSalesInvoiceLineSchema,
  UpdateSalesInvoiceSchema,
  VendorLedgerListQuerySchema,
  VoidPaymentSchema,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { SalesInvoicesService } from "./sales-invoices.service.js";
import type { PurchaseInvoicesService } from "./purchase-invoices.service.js";
import type { PaymentsService } from "./payments.service.js";
import type {
  CustomerLedgerService,
  VendorLedgerService,
} from "./ledger.service.js";
import type { FinanceOverviewService } from "./overview.service.js";
import type { EwayBillsService } from "./eway-bills.service.js";
import type { FinanceReportsService } from "./reports.service.js";

export interface RegisterFinanceRoutesOptions {
  salesInvoices: SalesInvoicesService;
  purchaseInvoices: PurchaseInvoicesService;
  payments: PaymentsService;
  customerLedger: CustomerLedgerService;
  vendorLedger: VendorLedgerService;
  overview: FinanceOverviewService;
  ewayBills: EwayBillsService;
  reports: FinanceReportsService;
  guardInternal: AuthGuardOptions;
}

const IdParamSchema = z.object({ id: z.string().uuid() });
const CustomerIdParamSchema = z.object({ customerId: z.string().uuid() });
const VendorIdParamSchema = z.object({ vendorId: z.string().uuid() });
const InvoiceParamSchema = z.object({ invoiceId: z.string().uuid() });
const InvoiceLineParamSchema = z.object({
  invoiceId: z.string().uuid(),
  lineId: z.string().uuid(),
});

export async function registerFinanceRoutes(
  app: FastifyInstance,
  opts: RegisterFinanceRoutesOptions,
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);

  const siRead = [authGuard, requirePermission("sales_invoices:read")];
  const siWrite = [authGuard, requirePermission("sales_invoices:create")];
  const siApprove = [authGuard, requirePermission("sales_invoices:approve")];

  const piRead = [authGuard, requirePermission("purchase_invoices:read")];
  const piWrite = [authGuard, requirePermission("purchase_invoices:create")];
  const piApprove = [authGuard, requirePermission("purchase_invoices:approve")];

  const payRead = [authGuard, requirePermission("payments:read")];
  const payWrite = [authGuard, requirePermission("payments:create")];
  const payReconcile = [authGuard, requirePermission("payments:reconcile")];

  // ─── Finance Overview (dashboard KPIs) ─────────────────────────────────────

  app.get(
    "/finance/overview",
    { preHandler: siRead },
    async (req, reply) => {
      return reply.send(await opts.overview.get(req));
    },
  );

  // ─── Sales Invoices ────────────────────────────────────────────────────────

  app.get(
    "/finance/sales-invoices",
    { preHandler: siRead },
    async (req, reply) => {
      const query = SalesInvoiceListQuerySchema.parse(req.query);
      return reply.send(await opts.salesInvoices.list(req, query));
    },
  );

  app.get(
    "/finance/sales-invoices/:id",
    { preHandler: siRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.salesInvoices.getById(req, id));
    },
  );

  app.post(
    "/finance/sales-invoices",
    { preHandler: siWrite },
    async (req, reply) => {
      const body = CreateSalesInvoiceSchema.parse(req.body);
      return reply.code(201).send(await opts.salesInvoices.create(req, body));
    },
  );

  app.patch(
    "/finance/sales-invoices/:id",
    { preHandler: siWrite },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateSalesInvoiceSchema.parse(req.body);
      return reply.send(await opts.salesInvoices.update(req, id, body));
    },
  );

  app.delete(
    "/finance/sales-invoices/:id",
    { preHandler: siWrite },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.salesInvoices.remove(req, id);
      return reply.code(204).send();
    },
  );

  app.post(
    "/finance/sales-invoices/:id/submit-for-posting",
    { preHandler: siApprove },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = SubmitSalesInvoiceForPostingSchema.parse(req.body);
      return reply.send(
        await opts.salesInvoices.submitForPosting(req, id, body),
      );
    },
  );

  app.post(
    "/finance/sales-invoices/:id/cancel",
    { preHandler: siApprove },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = CancelSalesInvoiceSchema.parse(req.body);
      return reply.send(await opts.salesInvoices.cancel(req, id, body));
    },
  );

  // ─── Sales Invoice Lines (sibling) ─────────────────────────────────────────

  app.get(
    "/finance/sales-invoices/:invoiceId/lines",
    { preHandler: siRead },
    async (req, reply) => {
      const { invoiceId } = InvoiceParamSchema.parse(req.params);
      return reply.send({
        data: await opts.salesInvoices.listLines(req, invoiceId),
      });
    },
  );

  app.post(
    "/finance/sales-invoices/:invoiceId/lines",
    { preHandler: siWrite },
    async (req, reply) => {
      const { invoiceId } = InvoiceParamSchema.parse(req.params);
      const body = CreateSalesInvoiceLineSchema.parse(req.body);
      return reply
        .code(201)
        .send(await opts.salesInvoices.addLine(req, invoiceId, body));
    },
  );

  app.patch(
    "/finance/sales-invoices/:invoiceId/lines/:lineId",
    { preHandler: siWrite },
    async (req, reply) => {
      const { invoiceId, lineId } = InvoiceLineParamSchema.parse(req.params);
      const body = UpdateSalesInvoiceLineSchema.parse(req.body);
      return reply.send(
        await opts.salesInvoices.updateLine(req, invoiceId, lineId, body),
      );
    },
  );

  app.delete(
    "/finance/sales-invoices/:invoiceId/lines/:lineId",
    { preHandler: siWrite },
    async (req, reply) => {
      const { invoiceId, lineId } = InvoiceLineParamSchema.parse(req.params);
      await opts.salesInvoices.deleteLine(req, invoiceId, lineId);
      return reply.code(204).send();
    },
  );

  // ─── Purchase Invoices (Vendor Bills) ──────────────────────────────────────

  app.get(
    "/finance/purchase-invoices",
    { preHandler: piRead },
    async (req, reply) => {
      const query = PurchaseInvoiceListQuerySchema.parse(req.query);
      return reply.send(await opts.purchaseInvoices.list(req, query));
    },
  );

  app.get(
    "/finance/purchase-invoices/:id",
    { preHandler: piRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.purchaseInvoices.getById(req, id));
    },
  );

  app.post(
    "/finance/purchase-invoices",
    { preHandler: piWrite },
    async (req, reply) => {
      const body = CreatePurchaseInvoiceSchema.parse(req.body);
      return reply
        .code(201)
        .send(await opts.purchaseInvoices.create(req, body));
    },
  );

  app.patch(
    "/finance/purchase-invoices/:id",
    { preHandler: piWrite },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdatePurchaseInvoiceSchema.parse(req.body);
      return reply.send(await opts.purchaseInvoices.update(req, id, body));
    },
  );

  app.delete(
    "/finance/purchase-invoices/:id",
    { preHandler: piWrite },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.purchaseInvoices.remove(req, id);
      return reply.code(204).send();
    },
  );

  app.post(
    "/finance/purchase-invoices/:id/post",
    { preHandler: piApprove },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = PostPurchaseInvoiceSchema.parse(req.body);
      return reply.send(await opts.purchaseInvoices.post(req, id, body));
    },
  );

  app.post(
    "/finance/purchase-invoices/:id/cancel",
    { preHandler: piApprove },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = CancelPurchaseInvoiceSchema.parse(req.body);
      return reply.send(await opts.purchaseInvoices.cancel(req, id, body));
    },
  );

  // ─── Purchase Invoice Lines (sibling) ──────────────────────────────────────

  app.get(
    "/finance/purchase-invoices/:invoiceId/lines",
    { preHandler: piRead },
    async (req, reply) => {
      const { invoiceId } = InvoiceParamSchema.parse(req.params);
      return reply.send({
        data: await opts.purchaseInvoices.listLines(req, invoiceId),
      });
    },
  );

  app.post(
    "/finance/purchase-invoices/:invoiceId/lines",
    { preHandler: piWrite },
    async (req, reply) => {
      const { invoiceId } = InvoiceParamSchema.parse(req.params);
      const body = CreatePurchaseInvoiceLineSchema.parse(req.body);
      return reply
        .code(201)
        .send(await opts.purchaseInvoices.addLine(req, invoiceId, body));
    },
  );

  app.patch(
    "/finance/purchase-invoices/:invoiceId/lines/:lineId",
    { preHandler: piWrite },
    async (req, reply) => {
      const { invoiceId, lineId } = InvoiceLineParamSchema.parse(req.params);
      const body = UpdatePurchaseInvoiceLineSchema.parse(req.body);
      return reply.send(
        await opts.purchaseInvoices.updateLine(req, invoiceId, lineId, body),
      );
    },
  );

  app.delete(
    "/finance/purchase-invoices/:invoiceId/lines/:lineId",
    { preHandler: piWrite },
    async (req, reply) => {
      const { invoiceId, lineId } = InvoiceLineParamSchema.parse(req.params);
      await opts.purchaseInvoices.deleteLine(req, invoiceId, lineId);
      return reply.code(204).send();
    },
  );

  // ─── Customer Ledger (read-only) ───────────────────────────────────────────

  app.get(
    "/finance/customer-ledger",
    { preHandler: siRead },
    async (req, reply) => {
      const query = CustomerLedgerListQuerySchema.parse(req.query);
      return reply.send(await opts.customerLedger.list(req, query));
    },
  );

  app.get(
    "/finance/customer-ledger/:id",
    { preHandler: siRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.customerLedger.getById(req, id));
    },
  );

  app.get(
    "/finance/customer-ledger/customers/:customerId/balance",
    { preHandler: siRead },
    async (req, reply) => {
      const { customerId } = CustomerIdParamSchema.parse(req.params);
      return reply.send(await opts.customerLedger.getBalance(req, customerId));
    },
  );

  // ─── Vendor Ledger (read-only) ─────────────────────────────────────────────

  app.get(
    "/finance/vendor-ledger",
    { preHandler: piRead },
    async (req, reply) => {
      const query = VendorLedgerListQuerySchema.parse(req.query);
      return reply.send(await opts.vendorLedger.list(req, query));
    },
  );

  app.get(
    "/finance/vendor-ledger/:id",
    { preHandler: piRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.vendorLedger.getById(req, id));
    },
  );

  app.get(
    "/finance/vendor-ledger/vendors/:vendorId/balance",
    { preHandler: piRead },
    async (req, reply) => {
      const { vendorId } = VendorIdParamSchema.parse(req.params);
      return reply.send(await opts.vendorLedger.getBalance(req, vendorId));
    },
  );

  // ─── Payments (polymorphic) ────────────────────────────────────────────────

  app.get(
    "/finance/payments",
    { preHandler: payRead },
    async (req, reply) => {
      const query = PaymentListQuerySchema.parse(req.query);
      return reply.send(await opts.payments.list(req, query));
    },
  );

  app.get(
    "/finance/payments/:id",
    { preHandler: payRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.payments.getById(req, id));
    },
  );

  app.post(
    "/finance/payments",
    { preHandler: payWrite },
    async (req, reply) => {
      const body = CreatePaymentSchema.parse(req.body);
      return reply.code(201).send(await opts.payments.create(req, body));
    },
  );

  app.post(
    "/finance/payments/:id/void",
    { preHandler: payReconcile },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = VoidPaymentSchema.parse(req.body);
      return reply.send(await opts.payments.void(req, id, body));
    },
  );

  app.delete(
    "/finance/payments/:id",
    { preHandler: payReconcile },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.payments.remove(req, id);
      return reply.code(204).send();
    },
  );

  // ─── E-Way Bills (Phase 5, read-only) ─────────────────────────────────────

  app.get(
    "/finance/eway-bills",
    { preHandler: siRead },
    async (req, reply) => {
      const query = EwayBillListQuerySchema.parse(req.query);
      return reply.send(await opts.ewayBills.list(req, query));
    },
  );

  app.get(
    "/finance/eway-bills/:id",
    { preHandler: siRead },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.ewayBills.getById(req, id));
    },
  );

  // ─── Finance reports ───────────────────────────────────────────────────────
  // Date-window P&L / ageing / top customers roll-up. `from`/`to` optional —
  // service defaults to last 90 days when absent.

  app.get(
    "/finance/reports",
    { preHandler: siRead },
    async (req, reply) => {
      const query = FinanceReportsQuerySchema.parse(req.query);
      return reply.send(await opts.reports.summary(req, query));
    },
  );
}
