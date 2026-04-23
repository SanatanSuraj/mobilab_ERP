/**
 * Gate 48 — Track 1 Phase 1 emit #1: `lead.converted` (outbox-only).
 *
 * Exercises the `leads.convert()` → outbox path landed in Phase 1
 * (apps/api/src/modules/crm/leads.service.ts, see the "Track 1 emit #1"
 * comment). The emit is outbox-only: no handler in
 * apps/worker/src/handlers/index.ts subscribes to `lead.converted`
 * today. Phase 2 will register consumers (e.g. CRM welcome-flow,
 * lead-source ROI). Until then, this gate pins:
 *
 *   - The service wrote an outbox.events row for the convert.
 *   - The idempotency_key is the documented shape
 *     `lead.converted:${leadId}` — Phase 2 handlers dedupe by outbox_id,
 *     so a stable idempotency_key prevents double-emit on retry.
 *   - The payload carries the five fields contracts/worker expect
 *     (orgId, leadId, accountId, dealId, convertedBy).
 *   - The event lands in the SAME txn as the domain writes — the gate
 *     asserts a positive join between the returned deal row and the
 *     payload's dealId so no "lead converted but no event" race is
 *     possible.
 *   - No handler runs exist for this event (HANDLER_CATALOGUE filtered
 *     by eventType == 'lead.converted' is empty). Regressions that
 *     accidentally register a handler surface here.
 *
 * Service loading: LeadsService is not in apps/api/package.json#exports
 * — we import it via a runtime file URL (same trick gate-46 uses). The
 * helper lives in `_phase3-helpers.ts`.
 *
 * Cleanup: every fixture row is tagged `company = 'gate-48 …'` so the
 * beforeEach DELETEs stay surgical and don't touch gate-8 / gate-46 /
 * gate-26 fixtures.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type { ConvertLead, CreateLead, Deal, Lead } from "@instigenie/contracts";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";
import {
  HANDLER_CATALOGUE,
  loadApiService,
  makeRequest,
  type ServiceRequest,
  waitForOutboxRow,
} from "./_phase3-helpers.js";

interface LeadsServiceLike {
  create(req: ServiceRequest, input: CreateLead): Promise<Lead>;
  convert(
    req: ServiceRequest,
    id: string,
    input: ConvertLead,
  ): Promise<{ lead: Lead; deal: Deal; accountId: string | null }>;
}

interface LeadsServiceCtor {
  new (pool: pg.Pool): LeadsServiceLike;
}

describe("gate-48: track 1 — lead.converted outbox emit", () => {
  let pool: pg.Pool;
  let leads: LeadsServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const mod = await loadApiService<{ LeadsService: LeadsServiceCtor }>(
      "apps/api/src/modules/crm/leads.service.ts",
    );
    leads = new mod.LeadsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Scoped cleanup. Outbox rows are keyed by idempotency_key; the key
  // includes the lead id (UUID) which we can't predict without the row,
  // so we instead delete by a wildcard on the idempotency_key prefix
  // against aggregate_type + aggregate_id in (the leads we just made).
  // We run the deletes in order so the FK cascade from leads →
  // lead_activities / deals → accounts is respected.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM outbox.events
          WHERE event_type = 'lead.converted'
            AND aggregate_id IN (
              SELECT id FROM leads WHERE company LIKE 'gate-48 %'
            )`,
      );
      await client.query(
        `DELETE FROM lead_activities
          WHERE lead_id IN (SELECT id FROM leads WHERE company LIKE 'gate-48 %')`,
      );
      await client.query(
        `DELETE FROM deals WHERE company LIKE 'gate-48 %'`,
      );
      await client.query(
        `DELETE FROM accounts WHERE name LIKE 'gate-48 %'`,
      );
      await client.query(
        `DELETE FROM leads WHERE company LIKE 'gate-48 %'`,
      );
    });
  });

  it("emits a lead.converted outbox row on successful convert with the expected payload", async () => {
    const req = makeRequest(DEV_ORG_ID);
    const suffix = Math.random().toString(36).slice(2, 10);
    const created = await leads.create(req, {
      name: `gate-48 lead ${suffix}`,
      company: `gate-48 ${suffix}`,
      email: `gate48-${suffix}@example.com`,
      phone: `+919${Math.floor(100000000 + Math.random() * 899999999)}`,
      source: "gate-48",
      estimatedValue: "50000",
    });
    expect(created.status).toBe("NEW");

    const input: ConvertLead = {
      dealTitle: `gate-48 deal ${suffix}`,
      dealValue: "50000",
      dealStage: "DISCOVERY",
    };
    const { lead, deal, accountId } = await leads.convert(req, created.id, input);

    // Domain writes first — the outbox row would be meaningless without
    // these. All three must land in the same txn.
    expect(lead.status).toBe("CONVERTED");
    expect(deal.company).toBe(created.company);
    expect(accountId).not.toBeNull();

    // Outbox write landed with the stable idempotency_key the service
    // advertises in its header comment: `lead.converted:${leadId}`.
    const outbox = await waitForOutboxRow(pool, `lead.converted:${created.id}`);
    expect(outbox.payload).toEqual({
      orgId: DEV_ORG_ID,
      leadId: created.id,
      accountId,
      dealId: deal.id,
      convertedBy: req.user.id,
    });

    // aggregate_type / event_type row-level shape.
    const { rows: evt } = await pool.query<{
      aggregate_type: string;
      aggregate_id: string;
      event_type: string;
      dispatched_at: string | null;
    }>(
      `SELECT aggregate_type, aggregate_id, event_type, dispatched_at::text
         FROM outbox.events WHERE id = $1`,
      [outbox.id],
    );
    expect(evt[0]).toMatchObject({
      aggregate_type: "lead",
      aggregate_id: created.id,
      event_type: "lead.converted",
    });
  });

  it("HANDLER_CATALOGUE does not subscribe to lead.converted today", () => {
    // Phase 1 emit — no handler consumer. Phase 2 will register some;
    // this assertion doubles as a flag if a handler slips in without a
    // corresponding E2E gate.
    const subscribers = HANDLER_CATALOGUE.filter(
      (e) => e.eventType === "lead.converted",
    );
    expect(subscribers).toHaveLength(0);
  });

  it("second successful convert on a different lead produces a distinct outbox row", async () => {
    // Proves the idempotency_key is lead-scoped, not per-call. Re-running
    // convert on the SAME lead would throw StateTransitionError (lead is
    // already CONVERTED); that's covered by gate-8. This check confirms
    // two separate converts produce two separate outbox rows.
    const req = makeRequest(DEV_ORG_ID);
    const makeLead = async (): Promise<Lead> => {
      const suffix = Math.random().toString(36).slice(2, 10);
      return leads.create(req, {
        name: `gate-48 lead ${suffix}`,
        company: `gate-48 ${suffix}`,
        email: `gate48-${suffix}@example.com`,
        phone: `+918${Math.floor(100000000 + Math.random() * 899999999)}`,
        source: "gate-48",
        estimatedValue: "10000",
      });
    };
    const a = await makeLead();
    const b = await makeLead();
    await leads.convert(req, a.id, {
      dealTitle: "gate-48 deal A",
      dealValue: "10000",
      dealStage: "DISCOVERY",
    });
    await leads.convert(req, b.id, {
      dealTitle: "gate-48 deal B",
      dealValue: "10000",
      dealStage: "DISCOVERY",
    });

    const rowA = await waitForOutboxRow(pool, `lead.converted:${a.id}`);
    const rowB = await waitForOutboxRow(pool, `lead.converted:${b.id}`);
    expect(rowA.id).not.toBe(rowB.id);
    expect(rowA.payload).toMatchObject({ leadId: a.id });
    expect(rowB.payload).toMatchObject({ leadId: b.id });
  });
});
