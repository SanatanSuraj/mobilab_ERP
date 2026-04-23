/**
 * Gate 41 — Phase 4 §4.2 daily hash-chain audit sweep.
 *
 * Gate 40 locked down the hash-chain math + the `verifyQcCertChain`
 * pure primitive; this gate locks down the SCHEDULED SWEEP around it:
 *
 *   (41.1) A clean chain across all orgs with data yields a COMPLETED
 *          run row with orgs_broken=0, empty breaks[] array, and no
 *          bump on the erp_audit_chain_break_total counter.
 *
 *   (41.2) A tampered cert on one org yields a COMPLETED run row with
 *          orgs_broken=1, a `breaks` jsonb entry carrying that org's
 *          firstBroken details (certId, certNumber, expected, actual,
 *          verifiedCount, totalCount), and a +1 on the per-org metric.
 *
 *   (41.3) A mix of clean + broken orgs reports the partition correctly
 *          — orgs_ok + orgs_broken === orgs_total, and only the broken
 *          org surfaces in `breaks`.
 *
 *   (41.4) Run-row lifecycle is written in full: trigger ('SCHEDULED'
 *          or 'MANUAL'), status transition to COMPLETED, completed_at
 *          stamped, returned runId resolves to exactly one row.
 *
 * We call `runAuditHashchain()` directly — not through BullMQ — because
 * the sweep logic is the compliance-critical surface. BullMQ wiring is
 * a thin adapter in createAuditHashchainProcessor and doesn't touch
 * any chain semantics.
 *
 * Isolation strategy: two pre-seeded dev orgs can carry qc_certs rows
 * — the main dev org (a001, reused here as ORG_ID) plus the vendor
 * "WithCheck Other" org (d1) from Phase 3 gates. Both are scrubbed in
 * beforeEach so the sweep only sees what this gate seeded. Gate 40
 * uses the same wipe pattern; running Gate 40 → Gate 41 in sequence
 * does not disturb either.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { installNumericTypeParser, withOrg } from "@instigenie/db";
import {
  computeCertHash,
  type QcCertHashContent,
} from "@instigenie/api/qc/cert-hash";
import { runAuditHashchain } from "@instigenie/worker/processors/audit-hashchain";
import {
  auditChainBreakTotal,
  createLogger,
} from "@instigenie/observability";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://instigenie_app:instigenie_dev@localhost:5434/instigenie";

/**
 * Per-org seed bundle. Both dev orgs (`a001` = Instigenie Dev, `d1` =
 * WithCheck Other) carry their own product + active bom + qc-manager
 * user rows from the Phase 3 seeds, so the sweep can walk a real
 * multi-tenant population without this gate re-seeding half the
 * catalogue. IDs here are the ones emitted by ops/sql/seed/*.
 */
interface OrgFixture {
  orgId: string;
  userId: string;
  productId: string;
  bomId: string;
  signedByName: string;
}

const ORG_PRIMARY: OrgFixture = {
  orgId: "00000000-0000-0000-0000-00000000a001",
  userId: "00000000-0000-0000-0000-00000000b00a", // Dev QC Manager
  productId: "00000000-0000-0000-0000-000000fc0001",
  bomId: "00000000-0000-0000-0000-000000fc0101", // v3 ACTIVE
  signedByName: "Dev QC Manager",
};

// Second dev org from Phase 3 seeds. Scrubbed in beforeEach so its
// stale null-signature_hash rows don't inflate orgsBroken when this
// gate's sweep runs.
const ORG_SECONDARY: OrgFixture = {
  orgId: "00000000-0000-0000-0000-0000000000d1",
  userId: "00000000-0000-0000-0000-0000000000d3",
  productId: "00000000-0000-0000-0000-00000000d301",
  bomId: "00000000-0000-0000-0000-00000000d302",
  signedByName: "WithCheck QC",
};

// Back-compat alias for Gate 41.1/41.2/41.4 (single-org tests).
const ORG_ID = ORG_PRIMARY.orgId;

let pool: pg.Pool;
const log = createLogger({ service: "gate-41", level: "silent" });

/**
 * Shape of a single entry in the `breaks` jsonb array. Mirrors
 * apps/worker/src/processors/audit-hashchain.ts. Duplicated here
 * because that field is an internal detail of the processor rather
 * than an exported contract.
 */
interface BreakEntry {
  orgId: string;
  certId: string;
  certNumber: string;
  expected: string;
  actual: string | null;
  verifiedCount: number;
  totalCount: number;
}

beforeAll(async () => {
  installNumericTypeParser();
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 4,
    application_name: "gate-41",
  });
});

afterAll(async () => {
  await pool.end();
});

async function wipeCerts(): Promise<void> {
  for (const fix of [ORG_PRIMARY, ORG_SECONDARY]) {
    await withOrg(pool, fix.orgId, async (client) => {
      await client.query(`DELETE FROM qc_certs WHERE org_id = $1`, [fix.orgId]);
    });
  }
}

/**
 * Read the current value of erp_audit_chain_break_total{org_id=<orgId>}.
 * Returns 0 when no sample has been recorded yet. Used to capture a
 * baseline before the sweep and assert the delta, since prom-client
 * counters are process-global and may carry bumps from prior gates.
 */
async function readBreakCounter(orgId: string): Promise<number> {
  const snap = await auditChainBreakTotal.get();
  const sample = snap.values.find((v) => v.labels?.org_id === orgId);
  return sample?.value ?? 0;
}

interface Inspection {
  inspectionId: string;
  workOrderId: string;
  woPid: string;
  deviceSerials: string[];
  productName: string;
}

async function seedInspection(
  fix: OrgFixture,
  tag = "G41",
): Promise<Inspection> {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  return withOrg(pool, fix.orgId, async (client) => {
    const {
      rows: [wo],
    } = await client.query<{ id: string; pid: string }>(
      `INSERT INTO work_orders
         (org_id, pid, product_id, bom_id, bom_version_label,
          quantity, status, device_serials)
       VALUES ($1, $2, $3, $4, 'v1', 2, 'IN_PROGRESS',
               ARRAY[$5::text, $6::text])
       RETURNING id, pid`,
      [
        fix.orgId,
        `WO-${tag}-${suffix}`,
        fix.productId,
        fix.bomId,
        `SN-${tag}-${suffix}-01`,
        `SN-${tag}-${suffix}-02`,
      ],
    );
    const {
      rows: [insp],
    } = await client.query<{ id: string }>(
      `INSERT INTO qc_inspections
         (org_id, inspection_number, kind, status, source_type, source_id,
          product_id, work_order_id, verdict, completed_at)
       VALUES ($1, $2, 'FINAL_QC', 'PASSED', 'WO', $3,
               $4, $3, 'PASS', now())
       RETURNING id`,
      [fix.orgId, `QCI-${tag}-${suffix}`, wo!.id, fix.productId],
    );
    const {
      rows: [prod],
    } = await client.query<{ name: string }>(
      `SELECT name FROM products WHERE id = $1`,
      [fix.productId],
    );
    return {
      inspectionId: insp!.id,
      workOrderId: wo!.id,
      woPid: wo!.pid,
      deviceSerials: [`SN-${tag}-${suffix}-01`, `SN-${tag}-${suffix}-02`],
      productName: prod!.name,
    };
  });
}

/**
 * Hand-seed one cert row with a valid hash chained onto `prevHash`.
 * Mirrors Gate 40's insertCertRow: by-passing the service lets us
 * construct a known-shape chain without racing the advisory-lock
 * serialization.
 */
async function insertCertRow(
  fix: OrgFixture,
  inspection: Inspection,
  certNumber: string,
  prevHash: string | null,
  notes: string,
): Promise<{ id: string; signatureHash: string; issuedAt: Date }> {
  const issuedAt = new Date();
  const content: QcCertHashContent = {
    certNumber,
    inspectionId: inspection.inspectionId,
    workOrderId: inspection.workOrderId,
    productId: fix.productId,
    productName: inspection.productName,
    woPid: inspection.woPid,
    deviceSerials: inspection.deviceSerials,
    signedBy: fix.userId,
    signedByName: fix.signedByName,
    notes,
    issuedAt: issuedAt.toISOString(),
  };
  const signatureHash = computeCertHash(prevHash, content);
  return withOrg(pool, fix.orgId, async (client) => {
    const {
      rows: [r],
    } = await client.query<{ id: string }>(
      `INSERT INTO qc_certs
         (org_id, cert_number, inspection_id, work_order_id, product_id,
          product_name, wo_pid, device_serials, issued_at, signed_by,
          signed_by_name, signature_hash, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        fix.orgId,
        certNumber,
        inspection.inspectionId,
        inspection.workOrderId,
        fix.productId,
        inspection.productName,
        inspection.woPid,
        inspection.deviceSerials,
        issuedAt,
        fix.userId,
        fix.signedByName,
        signatureHash,
        notes,
      ],
    );
    return { id: r!.id, signatureHash, issuedAt };
  });
}

/**
 * Build a 3-cert clean chain in {@link fix.orgId}. Returns the cert ids
 * plus the middle cert's cert_number so callers can tamper with it and
 * observe the sweep reaction.
 */
async function seedCleanChain(
  fix: OrgFixture,
  tagPrefix: string,
): Promise<{ certIds: string[]; middleCertNumber: string }> {
  const i1 = await seedInspection(fix, `${tagPrefix}-A`);
  const i2 = await seedInspection(fix, `${tagPrefix}-B`);
  const i3 = await seedInspection(fix, `${tagPrefix}-C`);
  const middleCertNumber = `QCC-${tagPrefix}-0002`;
  const c1 = await insertCertRow(fix, i1, `QCC-${tagPrefix}-0001`, null, "a");
  const c2 = await insertCertRow(fix, i2, middleCertNumber, c1.signatureHash, "b");
  const c3 = await insertCertRow(fix, i3, `QCC-${tagPrefix}-0003`, c2.signatureHash, "c");
  return { certIds: [c1.id, c2.id, c3.id], middleCertNumber };
}

// ─── Gate 41.1 — Clean sweep ────────────────────────────────────────────

describe("Gate 41.1 — clean chain produces a no-break run row", () => {
  beforeEach(wipeCerts);

  test("orgs_broken=0, breaks=[], metric unchanged", async () => {
    await seedCleanChain(ORG_PRIMARY, "G41-1");

    const before = await readBreakCounter(ORG_ID);

    const result = await runAuditHashchain({ pool, log }, "MANUAL");
    expect(result.orgsTotal).toBe(1);
    expect(result.orgsOk).toBe(1);
    expect(result.orgsBroken).toBe(0);

    const { rows } = await pool.query<{
      status: string;
      trigger: string;
      orgs_total: number;
      orgs_ok: number;
      orgs_broken: number;
      breaks: BreakEntry[];
      completed_at: Date | null;
      error: string | null;
    }>(
      `SELECT status, trigger, orgs_total, orgs_ok, orgs_broken, breaks,
              completed_at, error
         FROM qc_cert_chain_audit_runs WHERE id = $1`,
      [result.runId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("COMPLETED");
    expect(row.trigger).toBe("MANUAL");
    expect(row.orgs_total).toBe(1);
    expect(row.orgs_ok).toBe(1);
    expect(row.orgs_broken).toBe(0);
    expect(row.breaks).toEqual([]);
    expect(row.completed_at).toBeInstanceOf(Date);
    expect(row.error).toBeNull();

    // Counter for our org must not advance when the chain is clean.
    const after = await readBreakCounter(ORG_ID);
    expect(after).toBe(before);
  });
});

// ─── Gate 41.2 — Tamper detection through the sweep ──────────────────────

describe("Gate 41.2 — tampered cert lands in breaks[] and bumps counter", () => {
  beforeEach(wipeCerts);

  test("UPDATE signed_by_name on middle cert → break recorded + metric +1", async () => {
    const { certIds, middleCertNumber } = await seedCleanChain(ORG_PRIMARY, "G41-2");
    const middleCertId = certIds[1]!;

    // Tamper: mutate the middle cert's signed_by_name. The stored
    // signature_hash now diverges from what recomputation would produce.
    await withOrg(pool, ORG_ID, async (client) => {
      await client.query(
        `UPDATE qc_certs SET signed_by_name = $2 WHERE id = $1`,
        [middleCertId, "Tampered Signer"],
      );
    });

    const beforeCounter = await readBreakCounter(ORG_ID);

    const result = await runAuditHashchain({ pool, log }, "MANUAL");
    expect(result.orgsTotal).toBe(1);
    expect(result.orgsOk).toBe(0);
    expect(result.orgsBroken).toBe(1);

    // Metric bumped for this org exactly once.
    const afterCounter = await readBreakCounter(ORG_ID);
    expect(afterCounter).toBe(beforeCounter + 1);

    // Run row carries the break details so a compliance auditor can
    // triage the row without re-running verifyQcCertChain themselves.
    const { rows } = await pool.query<{
      status: string;
      breaks: BreakEntry[];
    }>(
      `SELECT status, breaks FROM qc_cert_chain_audit_runs WHERE id = $1`,
      [result.runId],
    );
    const row = rows[0]!;
    expect(row.status).toBe("COMPLETED");
    expect(row.breaks).toHaveLength(1);
    const br = row.breaks[0]!;
    expect(br.orgId).toBe(ORG_ID);
    expect(br.certId).toBe(middleCertId);
    expect(br.certNumber).toBe(middleCertNumber);
    expect(br.totalCount).toBe(3);
    // Walk stopped at the middle cert → verifiedCount=1 (only the
    // first cert passed before the mismatch).
    expect(br.verifiedCount).toBe(1);
    // actual (stored) ≠ expected (recomputed over tampered content).
    expect(br.expected).toMatch(/^[0-9a-f]{64}$/);
    expect(br.actual).toMatch(/^[0-9a-f]{64}$/);
    expect(br.expected).not.toBe(br.actual);
  });
});

// ─── Gate 41.3 — Mixed orgs partition correctly ──────────────────────────

describe("Gate 41.3 — sweep partitions ok / broken across orgs", () => {
  beforeEach(wipeCerts);

  test("one clean org + one tampered org → counts + breaks[] reflect both", async () => {
    // Primary org: clean chain.
    await seedCleanChain(ORG_PRIMARY, "G41-3A");
    // Secondary org: chain with a hard-delete in the middle (Gate 40.4
    // style) — leaves the third cert pointing at a vanished prev_hash.
    const { certIds: otherIds } = await seedCleanChain(ORG_SECONDARY, "G41-3B");
    await withOrg(pool, ORG_SECONDARY.orgId, async (client) => {
      await client.query(`DELETE FROM qc_certs WHERE id = $1`, [otherIds[1]]);
    });

    const beforeThis = await readBreakCounter(ORG_PRIMARY.orgId);
    const beforeOther = await readBreakCounter(ORG_SECONDARY.orgId);

    const result = await runAuditHashchain({ pool, log }, "SCHEDULED");
    expect(result.orgsTotal).toBe(2);
    expect(result.orgsOk).toBe(1);
    expect(result.orgsBroken).toBe(1);
    expect(result.orgsOk + result.orgsBroken).toBe(result.orgsTotal);

    // Only the tampered org's counter should have moved.
    expect(await readBreakCounter(ORG_PRIMARY.orgId)).toBe(beforeThis);
    expect(await readBreakCounter(ORG_SECONDARY.orgId)).toBe(beforeOther + 1);

    const { rows } = await pool.query<{ breaks: BreakEntry[] }>(
      `SELECT breaks FROM qc_cert_chain_audit_runs WHERE id = $1`,
      [result.runId],
    );
    const breaks = rows[0]!.breaks;
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.orgId).toBe(ORG_SECONDARY.orgId);
    // The clean org must NOT appear.
    expect(breaks.some((b) => b.orgId === ORG_PRIMARY.orgId)).toBe(false);
  });
});

// ─── Gate 41.4 — Run-row lifecycle ───────────────────────────────────────

describe("Gate 41.4 — run row lifecycle + trigger provenance", () => {
  beforeEach(wipeCerts);

  test("trigger='SCHEDULED' by default, transitions to COMPLETED with timestamps", async () => {
    await seedCleanChain(ORG_PRIMARY, "G41-4");

    const before = new Date();
    const result = await runAuditHashchain({ pool, log }); // default trigger
    const after = new Date();

    const { rows } = await pool.query<{
      trigger: string;
      status: string;
      started_at: Date;
      completed_at: Date | null;
      error: string | null;
    }>(
      `SELECT trigger, status, started_at, completed_at, error
         FROM qc_cert_chain_audit_runs WHERE id = $1`,
      [result.runId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.trigger).toBe("SCHEDULED");
    expect(row.status).toBe("COMPLETED");
    // started_at and completed_at fall inside the wall-clock window we
    // measured around the call — proves the lifecycle writes actually
    // happened rather than inheriting stale defaults.
    expect(row.started_at.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1,
    );
    expect(row.completed_at).not.toBeNull();
    expect(row.completed_at!.getTime()).toBeLessThanOrEqual(
      after.getTime() + 1,
    );
    expect(row.completed_at!.getTime()).toBeGreaterThanOrEqual(
      row.started_at.getTime(),
    );
    expect(row.error).toBeNull();
  });

  test("runId is unique per invocation — two back-to-back calls produce two rows", async () => {
    await seedCleanChain(ORG_PRIMARY, "G41-4B");
    const r1 = await runAuditHashchain({ pool, log }, "MANUAL");
    const r2 = await runAuditHashchain({ pool, log }, "MANUAL");
    expect(r1.runId).not.toBe(r2.runId);

    const { rows } = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM qc_cert_chain_audit_runs WHERE id = ANY($1::uuid[])`,
      [[r1.runId, r2.runId]],
    );
    expect(rows[0]!.count).toBe(2);
  });
});
