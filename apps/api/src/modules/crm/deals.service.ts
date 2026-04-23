/**
 * Deals service.
 *
 * Key behaviors:
 *   - create()             generates DEAL-YYYY-NNNN via repo (atomic UPSERT).
 *   - update()             optimistic-lock (expectedVersion). 409 on conflict.
 *   - transitionStage()    validates the stage graph (§13.1.3) then applies.
 *                          CLOSED_LOST requires a lostReason.
 *
 * Valid stage transitions:
 *   DISCOVERY   → PROPOSAL | CLOSED_LOST
 *   PROPOSAL    → NEGOTIATION | CLOSED_LOST | DISCOVERY
 *   NEGOTIATION → CLOSED_WON | CLOSED_LOST | PROPOSAL
 *   CLOSED_*    → (terminal)
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  CreateDeal,
  Deal,
  DealListQuerySchema,
  DealStage,
  TransitionDealStage,
  UpdateDeal,
} from "@instigenie/contracts";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { enqueueOutbox } from "@instigenie/db";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { dealsRepo } from "./deals.repository.js";
import { requireUser } from "../../context/request-context.js";

type DealListQuery = z.infer<typeof DealListQuerySchema>;

const DEAL_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  dealNumber: "deal_number",
  value: "value",
  expectedClose: "expected_close",
};

const ALLOWED_STAGE_TRANSITIONS: Record<DealStage, DealStage[]> = {
  DISCOVERY: ["PROPOSAL", "CLOSED_LOST"],
  PROPOSAL: ["NEGOTIATION", "CLOSED_LOST", "DISCOVERY"],
  NEGOTIATION: ["CLOSED_WON", "CLOSED_LOST", "PROPOSAL"],
  CLOSED_WON: [],
  CLOSED_LOST: [],
};

export class DealsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: DealListQuery
  ): Promise<ReturnType<typeof paginated<Deal>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, DEAL_SORTS, "createdAt");
      const { data, total } = await dealsRepo.list(
        client,
        {
          stage: query.stage,
          assignedTo: query.assignedTo,
          accountId: query.accountId,
          search: query.search,
        },
        plan
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<Deal> {
    return withRequest(req, this.pool, async (client) => {
      const row = await dealsRepo.getById(client, id);
      if (!row) throw new NotFoundError("deal");
      return row;
    });
  }

  async create(req: FastifyRequest, input: CreateDeal): Promise<Deal> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      return dealsRepo.create(client, user.orgId, input);
    });
  }

  async update(
    req: FastifyRequest,
    id: string,
    input: UpdateDeal
  ): Promise<Deal> {
    return withRequest(req, this.pool, async (client) => {
      const result = await dealsRepo.updateWithVersion(client, id, input);
      if (result === null) throw new NotFoundError("deal");
      if (result === "version_conflict") {
        throw new ConflictError("deal was modified by someone else");
      }
      return result;
    });
  }

  async remove(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const ok = await dealsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("deal");
    });
  }

  async transitionStage(
    req: FastifyRequest,
    id: string,
    input: TransitionDealStage
  ): Promise<Deal> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const cur = await dealsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("deal");
      if (cur.version !== input.expectedVersion) {
        throw new ConflictError("deal was modified by someone else");
      }
      const allowed = ALLOWED_STAGE_TRANSITIONS[cur.stage];
      if (!allowed.includes(input.stage)) {
        throw new StateTransitionError(
          `cannot transition deal from ${cur.stage} to ${input.stage}`
        );
      }
      if (input.stage === "CLOSED_LOST" && !input.lostReason) {
        throw new ValidationError("lostReason is required for CLOSED_LOST");
      }
      const result = await dealsRepo.transitionStage(client, id, {
        stage: input.stage,
        expectedVersion: input.expectedVersion,
        lostReason: input.lostReason ?? null,
      });
      if (result === null) throw new NotFoundError("deal");
      if (result === "version_conflict") {
        throw new ConflictError("deal was modified by someone else");
      }

      // Track 1 emit #2 (automate.md): broadcast every stage transition.
      // The idempotency key is pinned to the *new* version so version-conflict
      // retries dedupe via outbox.events.idempotency_key.
      await enqueueOutbox(client, {
        aggregateType: "deal",
        aggregateId: id,
        eventType: "deal.stage_changed",
        payload: {
          orgId: result.orgId,
          dealId: id,
          dealNumber: result.dealNumber,
          fromStage: cur.stage,
          toStage: result.stage,
          lostReason: input.lostReason ?? null,
          actorId: user.id,
        },
        idempotencyKey: `deal.stage_changed:${id}:v${result.version}`,
      });

      // Track 1 emit #3 (automate.md): on CLOSED_WON, deal.won is the signal
      // that drives production.createWorkOrder + procurement.createMrpIndent.
      //
      // Part D #1 fix: the DealWonPayload needs productId / bomId /
      // bomVersionLabel / quantity, but quotation_line_items stores only
      // `product_code` text (no FK). We resolve that at emit time:
      //
      //   1. Find the latest ACCEPTED quotation for this deal.
      //   2. Take its primary (first-by-created_at) line.
      //   3. Resolve product_code → products.id (lowercase match on the
      //      partial-unique index `products_code_org_unique`).
      //   4. Read products.active_bom_id → bom_versions.version_label.
      //
      // Any miss in that chain (no quotation, no line, no product, no
      // active BOM) aborts the transition with a ValidationError. That's
      // the *point* of fail-fast here — a CLOSED_WON without a buildable
      // downstream WO would strand the outbox handler in a perpetual
      // retry loop on NOT NULL violations, and an errored transition is
      // better than a poisoned queue.
      if (input.stage === "CLOSED_WON") {
        const { rows: qRows } = await client.query<{
          id: string;
          quotation_number: string;
        }>(
          `SELECT id, quotation_number
             FROM quotations
            WHERE deal_id = $1
              AND status = 'ACCEPTED'
              AND deleted_at IS NULL
            ORDER BY version DESC, created_at DESC
            LIMIT 1`,
          [id]
        );
        const quotation = qRows[0];
        if (!quotation) {
          throw new ValidationError(
            "deal cannot be CLOSED_WON without a linked ACCEPTED quotation"
          );
        }

        const { rows: lineRows } = await client.query<{
          product_code: string;
          quantity: number;
        }>(
          `SELECT product_code, quantity
             FROM quotation_line_items
            WHERE quotation_id = $1
            ORDER BY created_at ASC
            LIMIT 1`,
          [quotation.id]
        );
        const primaryLine = lineRows[0];
        if (!primaryLine) {
          throw new ValidationError(
            `accepted quotation ${quotation.quotation_number} has no line items — cannot derive deal.won payload`
          );
        }

        const { rows: productRows } = await client.query<{
          id: string;
          active_bom_id: string | null;
        }>(
          `SELECT id, active_bom_id
             FROM products
            WHERE org_id = $1
              AND lower(product_code) = lower($2)
              AND deleted_at IS NULL
              AND is_active = true
            LIMIT 1`,
          [result.orgId, primaryLine.product_code]
        );
        const product = productRows[0];
        if (!product) {
          throw new ValidationError(
            `no active product matches quotation line product_code "${primaryLine.product_code}" — add the product master row before winning the deal`
          );
        }
        if (!product.active_bom_id) {
          throw new ValidationError(
            `product "${primaryLine.product_code}" has no ACTIVE BOM — publish a BOM version before winning the deal`
          );
        }

        const { rows: bomRows } = await client.query<{
          version_label: string;
        }>(
          `SELECT version_label
             FROM bom_versions
            WHERE id = $1
              AND status = 'ACTIVE'
              AND deleted_at IS NULL
            LIMIT 1`,
          [product.active_bom_id]
        );
        const bom = bomRows[0];
        if (!bom) {
          throw new ValidationError(
            `product "${primaryLine.product_code}" points at BOM ${product.active_bom_id} but it is not ACTIVE — re-promote a BOM version`
          );
        }

        await enqueueOutbox(client, {
          aggregateType: "deal",
          aggregateId: id,
          eventType: "deal.won",
          payload: {
            orgId: result.orgId,
            dealId: id,
            dealNumber: result.dealNumber,
            productId: product.id,
            bomId: product.active_bom_id,
            bomVersionLabel: bom.version_label,
            quantity: String(primaryLine.quantity),
            requestedBy: user.id,
          },
          idempotencyKey: `deal.won:${id}:v${result.version}`,
        });
      }

      return result;
    });
  }
}
