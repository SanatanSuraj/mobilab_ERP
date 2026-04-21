/**
 * Ledger service (read-only).
 *
 * Ledgers are append-only, so this service only exposes list + getById.
 * Writes happen as a side-effect of posting invoices / recording payments
 * inside sales-invoices.service / purchase-invoices.service / payments.service.
 *
 * Phase 2 surface:
 *   - GET /finance/customer-ledger            — filter by customer/type/date
 *   - GET /finance/customer-ledger/:id
 *   - GET /finance/customer-ledger/customers/:customerId/balance
 *   - GET /finance/vendor-ledger              — filter by vendor/type/date
 *   - GET /finance/vendor-ledger/:id
 *   - GET /finance/vendor-ledger/vendors/:vendorId/balance
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { NotFoundError } from "@mobilab/errors";
import {
  paginated,
  type CustomerLedgerEntry,
  type CustomerLedgerListQuerySchema,
  type VendorLedgerEntry,
  type VendorLedgerListQuerySchema,
} from "@mobilab/contracts";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { customerLedgerRepo } from "./customer-ledger.repository.js";
import { vendorLedgerRepo } from "./vendor-ledger.repository.js";

type CustomerLedgerListQuery = z.infer<typeof CustomerLedgerListQuerySchema>;
type VendorLedgerListQuery = z.infer<typeof VendorLedgerListQuerySchema>;

const LEDGER_SORTS: Record<string, string> = {
  createdAt: "created_at",
  entryDate: "entry_date",
  entryType: "entry_type",
};

export class CustomerLedgerService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: CustomerLedgerListQuery,
  ): Promise<ReturnType<typeof paginated<CustomerLedgerEntry>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, LEDGER_SORTS, "entryDate");
      const { data, total } = await customerLedgerRepo.list(
        client,
        {
          customerId: query.customerId,
          entryType: query.entryType,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(
    req: FastifyRequest,
    id: string,
  ): Promise<CustomerLedgerEntry> {
    return withRequest(req, this.pool, async (client) => {
      const entry = await customerLedgerRepo.getById(client, id);
      if (!entry) throw new NotFoundError("customer ledger entry");
      return entry;
    });
  }

  async getBalance(
    req: FastifyRequest,
    customerId: string,
  ): Promise<{ customerId: string; balance: string }> {
    return withRequest(req, this.pool, async (client) => {
      const balance = await customerLedgerRepo.currentBalance(client, customerId);
      return { customerId, balance };
    });
  }
}

export class VendorLedgerService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: VendorLedgerListQuery,
  ): Promise<ReturnType<typeof paginated<VendorLedgerEntry>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, LEDGER_SORTS, "entryDate");
      const { data, total } = await vendorLedgerRepo.list(
        client,
        {
          vendorId: query.vendorId,
          entryType: query.entryType,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(
    req: FastifyRequest,
    id: string,
  ): Promise<VendorLedgerEntry> {
    return withRequest(req, this.pool, async (client) => {
      const entry = await vendorLedgerRepo.getById(client, id);
      if (!entry) throw new NotFoundError("vendor ledger entry");
      return entry;
    });
  }

  async getBalance(
    req: FastifyRequest,
    vendorId: string,
  ): Promise<{ vendorId: string; balance: string }> {
    return withRequest(req, this.pool, async (client) => {
      const balance = await vendorLedgerRepo.currentBalance(client, vendorId);
      return { vendorId, balance };
    });
  }
}
