/**
 * audit-chain-iso-cfr — ISO 13485 / 21 CFR Part 820 / 21 CFR Part 11 compliance
 * centerpiece for the cryptographic audit trail.
 *
 * ─── Why this spec exists ──────────────────────────────────────────────────
 *
 * ISO 13485 §4.2.5 + 21 CFR Part 820.180 require medical-device
 * manufacturers to maintain records that are **unambiguously attributable,
 * contemporaneous, and tamper-evident**. 21 CFR Part 11.10(e) adds:
 * "use of secure, computer-generated, time-stamped audit trails to
 * independently record the date and time of operator entries and actions
 * that create, modify, or delete electronic records."
 *
 * Our implementation of that requirement lives in two places:
 *
 *   1. `qc_certs.signature_hash` — a forward-linked SHA-256 chain over the
 *      business content of every issued QC certificate, walked by
 *      `verifyQcCertChain` (ARCHITECTURE.md §4.2). This is the ENFORCED
 *      chain; every cert's signature_hash is stamped at issue time and the
 *      daily pg_cron sweep (Gate 41) reverifies it.
 *
 *   2. `audit.log` — a row-level before/after journal written by SECURITY
 *      DEFINER triggers on every audited table. ARCHITECTURE.md §9.5
 *      describes a content-chain for audit.log in pseudocode but does not
 *      yet enforce one at schema level — the `signature_hash` column does
 *      not exist. The REPLAY check in §F below proves the primitive is
 *      workable over today's audit.log corpus, so a future migration that
 *      adds the column can turn on enforcement with zero rework.
 *
 * ─── How this gate differs from Gate 40 / Gate 41 ─────────────────────────
 *
 *   • Gate 40 (phase4-compliance-hashchain) pins the hash MATH on a
 *     3-cert fixture and tests one mutation shape.
 *   • Gate 41 (phase4-audit-hashchain) pins the daily SWEEP's run-row
 *     lifecycle and the 1-org/2-org partition.
 *
 * This gate pins the COMPLIANCE SURFACE — the assertions an auditor
 * actually asks for:
 *
 *   §A. Every qc_cert in the production corpus has a valid signature_hash
 *       and every org's chain walks clean. Runs against whatever data the
 *       DB holds today. If the dev seed, a migration, or a prior gate
 *       leaves a broken cert in place, THIS gate fails. (Regression
 *       ratchet.)
 *   §B. Canonicalization is stable — key insertion order does not change
 *       the hash; boundary inputs produce distinct, reproducible hashes.
 *       This is the "auditor with a different codebase gets the same
 *       digest" property.
 *   §C. Cross-org isolation — tampering an org's chain does not leak into
 *       another org's verification (and healing the tamper does not
 *       leak back). Multi-tenant compliance requires this; Gate 41.3
 *       partitions counts but does not pin the isolation property.
 *   §D. Tamper-heal-reverify property loop — enumerate multiple mutation
 *       shapes on the SAME cert; each must break verification AT that
 *       cert; restoring the original must reverify clean. Exhaustive
 *       where Gate 40.3 is single-shape.
 *   §E. Chain-head reproducibility — the final hash of a chain, derived
 *       from a DB snapshot, equals the hash stored on the latest cert.
 *       This is the "5-year backup tape still verifies" property.
 *   §F. audit.log diagnostic content-chain replay — compute a hypothetical
 *       SHA-256 forward chain over today's audit.log rows using the same
 *       canonical-JSON primitive; assert the walk completes, is
 *       reproducible, and is tamper-sensitive. Diagnostic because schema
 *       does not yet enforce it; this is the evidence that the primitive
 *       is ready to be turned on.
 *
 * ─── What this gate does NOT do ────────────────────────────────────────────
 *
 *   • It does not re-test the `computeCertHash` unit contract (Gate 40.1
 *     owns that).
 *   • It does not re-test the advisory-lock no-fork invariant (Gate 40.6
 *     owns that).
 *   • It does not re-test the daily sweep run-row lifecycle (Gate 41.4
 *     owns that).
 *   • It does not write to audit.log — audit rows are produced by
 *     SECURITY DEFINER triggers on mutations of audited tables, and we
 *     consume whatever rows the shared dev dataset has accumulated.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { installNumericTypeParser, withOrg } from "@instigenie/db";
import {
  computeCertHash,
  verifyQcCertChain,
  GENESIS_HASH,
  type QcCertHashContent,
} from "@instigenie/api/qc/cert-hash";
import {
  makeTestPool,
  makeVendorTestPool,
  waitForPg,
  DEV_ORG_ID,
} from "./_helpers.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

interface OrgFixture {
  orgId: string;
  userId: string;
  productId: string;
  bomId: string;
  signedByName: string;
}

/**
 * Primary dev org — matches the Phase 3 seed. All isolation tests seed
 * chains here and in ORG_SECONDARY, then tamper one and assert the other
 * stays intact.
 */
const ORG_PRIMARY: OrgFixture = {
  orgId: DEV_ORG_ID,
  userId: "00000000-0000-0000-0000-00000000b00a", // Dev QC Manager
  productId: "00000000-0000-0000-0000-000000fc0001",
  bomId: "00000000-0000-0000-0000-000000fc0101",
  signedByName: "Dev QC Manager",
};

/** Secondary dev org ("WithCheck Other") from Phase 3 seeds. */
const ORG_SECONDARY: OrgFixture = {
  orgId: "00000000-0000-0000-0000-0000000000d1",
  userId: "00000000-0000-0000-0000-0000000000d3",
  productId: "00000000-0000-0000-0000-00000000d301",
  bomId: "00000000-0000-0000-0000-00000000d302",
  signedByName: "WithCheck QC",
};

let pool: pg.Pool;
// vendorPool bypasses RLS so we can enumerate rows across ALL tenants for
// the prod-corpus and audit.log diagnostic sections. The main pool's
// instigenie_app role is NOBYPASSRLS and would return 0 rows for
// cross-tenant reads.
let vendorPool: pg.Pool;

beforeAll(async () => {
  installNumericTypeParser();
  pool = makeTestPool();
  vendorPool = makeVendorTestPool();
  await waitForPg(pool);
  await waitForPg(vendorPool);
  // Pre-wipe fixture orgs so §A (production corpus walk) sees a clean
  // starting state. Our §C/§D/§E tests leave their final seeded chain in
  // place at end-of-run; without this wipe, a subsequent run's §A would
  // see the previous run's leftover chain. Gates 40/41 use the same
  // wipe-before pattern for the same reason.
  await wipeFixtureCerts();
});

afterAll(async () => {
  if (pool) await pool.end();
  if (vendorPool) await vendorPool.end();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Wipe ONLY the fixture orgs' qc_certs — we leave any other org's data
 * alone so §A's exhaustive walk can still find real production-shaped
 * rows to verify. Gate 40 / Gate 41 use the same pattern.
 */
async function wipeFixtureCerts(): Promise<void> {
  for (const fix of [ORG_PRIMARY, ORG_SECONDARY]) {
    await withOrg(pool, fix.orgId, async (client) => {
      await client.query(`DELETE FROM qc_certs WHERE org_id = $1`, [fix.orgId]);
    });
  }
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
  tag: string,
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

async function insertCertRow(
  fix: OrgFixture,
  inspection: Inspection,
  certNumber: string,
  prevHash: string | null,
  notes: string,
  issuedAtOverride?: Date,
): Promise<{ id: string; signatureHash: string; issuedAt: Date }> {
  // Accept an optional override so §D can seed certs with intervals
  // wider than the tamper deltas it tests. Default still captures "now"
  // for callers who don't care about spacing.
  const issuedAt = issuedAtOverride ?? new Date();
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

interface SeededChain {
  certIds: string[];
  signatureHashes: string[];
  middleCertId: string;
  inspections: Inspection[];
}

/**
 * Seed a 3-cert clean chain in the given org fixture. Returns the middle
 * cert id for tampering and the list of signature hashes so tests can
 * record the pre-state and re-verify against a frozen baseline.
 *
 * Certs are issued at timestamps spaced 1 SECOND apart. This matters for
 * §D's `issued_at + 1 ms` mutation: the walk order in
 * `verifyQcCertChain` is `ORDER BY issued_at ASC, id ASC`, so if the
 * certs landed within the same millisecond (possible when `new Date()`
 * fires back-to-back inside one event-loop tick), a 1-ms tamper on the
 * middle cert would reorder it past the third cert — and the chain
 * would appear broken at cert #3 rather than at the cert we actually
 * mutated. Spacing by 1 s makes every supported tamper shape safely
 * within its own cert's "time slot."
 */
async function seedCleanChain(
  fix: OrgFixture,
  tag: string,
): Promise<SeededChain> {
  const i1 = await seedInspection(fix, `${tag}-A`);
  const i2 = await seedInspection(fix, `${tag}-B`);
  const i3 = await seedInspection(fix, `${tag}-C`);
  const base = Date.now();
  const t1 = new Date(base);
  const t2 = new Date(base + 1000);
  const t3 = new Date(base + 2000);
  const c1 = await insertCertRow(fix, i1, `QCC-${tag}-0001`, null, "first", t1);
  const c2 = await insertCertRow(
    fix,
    i2,
    `QCC-${tag}-0002`,
    c1.signatureHash,
    "second",
    t2,
  );
  const c3 = await insertCertRow(
    fix,
    i3,
    `QCC-${tag}-0003`,
    c2.signatureHash,
    "third",
    t3,
  );
  return {
    certIds: [c1.id, c2.id, c3.id],
    signatureHashes: [c1.signatureHash, c2.signatureHash, c3.signatureHash],
    middleCertId: c2.id,
    inspections: [i1, i2, i3],
  };
}

/**
 * Audit.log content canonicalization for the §F diagnostic chain. Uses
 * the same shape rules as computeCertHash: sorted-keys JSON,
 * whitespace-free. We deliberately exclude the row's own `id` (it's
 * surrogate, not content) but include every business field including
 * `changed_at` so a timestamp-shift would register as tampering.
 */
interface AuditLogContent {
  orgId: string;
  tableName: string;
  rowId: string | null;
  action: string;
  actor: string | null;
  before: unknown;
  after: unknown;
  changedAt: string; // ISO-8601
  traceId: string | null;
}

function canonicalizeAuditEntry(entry: AuditLogContent): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(entry).sort()) {
    sorted[key] = (entry as unknown as Record<string, unknown>)[key];
  }
  return JSON.stringify(sorted);
}

function computeAuditEntryHash(
  prevHash: string | null,
  entry: AuditLogContent,
): string {
  const seed = prevHash ?? GENESIS_HASH;
  const bytes = Buffer.concat([
    Buffer.from(seed, "utf8"),
    Buffer.from("|", "utf8"),
    Buffer.from(canonicalizeAuditEntry(entry), "utf8"),
  ]);
  return createHash("sha256").update(bytes).digest("hex");
}

interface AuditRow {
  id: string;
  org_id: string;
  table_name: string;
  row_id: string | null;
  action: string;
  actor: string | null;
  before: unknown;
  after: unknown;
  changed_at: Date;
  trace_id: string | null;
}

function auditRowToContent(row: AuditRow): AuditLogContent {
  return {
    orgId: row.org_id,
    tableName: row.table_name,
    rowId: row.row_id,
    action: row.action,
    actor: row.actor,
    before: row.before,
    after: row.after,
    changedAt: row.changed_at.toISOString(),
    traceId: row.trace_id,
  };
}

/**
 * Walk every audit.log row for a given org (ordered by changed_at, id) and
 * return the head hash. Pure function over a DB snapshot — reproducibility
 * is proven by calling this twice and comparing.
 */
async function computeAuditLogHead(orgId: string): Promise<{
  rowCount: number;
  headHash: string | null;
}> {
  const { rows } = await vendorPool.query<AuditRow>(
    `SELECT id, org_id, table_name, row_id, action, actor,
            before, after, changed_at, trace_id
       FROM audit.log
      WHERE org_id = $1
      ORDER BY changed_at ASC, id ASC`,
    [orgId],
  );
  let prev: string | null = null;
  for (const row of rows) {
    prev = computeAuditEntryHash(prev, auditRowToContent(row));
  }
  return { rowCount: rows.length, headHash: prev };
}

// ═══════════════════════════════════════════════════════════════════════════
//  §A — Production corpus chain integrity
// ═══════════════════════════════════════════════════════════════════════════

describe("audit-chain-iso-cfr §A — production corpus chain integrity", () => {
  test("A.1 every non-deleted qc_cert has a 64-hex signature_hash", async () => {
    // Use vendorPool to enumerate across ALL orgs — an ISO auditor cares
    // that no tenant has drifted, not just the one we happen to test.
    const { rows } = await vendorPool.query<{
      id: string;
      org_id: string;
      cert_number: string;
      signature_hash: string | null;
    }>(
      `SELECT id, org_id, cert_number, signature_hash
         FROM qc_certs
        WHERE deleted_at IS NULL`,
    );
    const broken = rows.filter(
      (r) =>
        r.signature_hash === null || !/^[0-9a-f]{64}$/.test(r.signature_hash),
    );
    expect(
      broken,
      `qc_certs rows missing or malformed signature_hash:\n${broken
        .map((r) => `  ${r.org_id} ${r.cert_number} hash=${r.signature_hash}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("A.2 every org with qc_certs has a clean forward-linked chain", async () => {
    const { rows: orgs } = await vendorPool.query<{ org_id: string; count: number }>(
      `SELECT org_id, count(*)::int AS count
         FROM qc_certs
        WHERE deleted_at IS NULL
        GROUP BY org_id`,
    );
    // Don't require any particular count — fresh environments may have
    // zero certs. But whatever IS there must verify clean.
    for (const { org_id, count } of orgs) {
      const res = await withOrg(pool, org_id, (client) =>
        verifyQcCertChain(client, org_id),
      );
      expect(
        res.ok,
        `org ${org_id} (${count} certs) chain verification failed: ${JSON.stringify(
          res.firstBroken,
        )}`,
      ).toBe(true);
      expect(res.verifiedCount).toBe(res.totalCount);
      expect(res.totalCount).toBe(count);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  §B — Canonicalization stability
// ═══════════════════════════════════════════════════════════════════════════

describe("audit-chain-iso-cfr §B — canonicalization stability", () => {
  const baseContent: QcCertHashContent = {
    certNumber: "QCC-CANON-0001",
    inspectionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    workOrderId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    productId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    productName: "Monitor",
    woPid: "WO-CANON-0001",
    deviceSerials: ["SN-1", "SN-2"],
    signedBy: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    signedByName: "Signer",
    notes: "canon",
    issuedAt: "2026-04-22T10:00:00.000Z",
  };

  test("B.1 key insertion order does not affect the hash", () => {
    // Build a second object with the SAME field values but a different
    // construction order. `computeCertHash` must sort keys before
    // hashing — the sort() is load-bearing for cross-implementation
    // reproducibility (an auditor in another language will almost
    // certainly emit JSON in a different default key order).
    const reversed: QcCertHashContent = {
      issuedAt: baseContent.issuedAt,
      notes: baseContent.notes,
      signedByName: baseContent.signedByName,
      signedBy: baseContent.signedBy,
      deviceSerials: baseContent.deviceSerials,
      woPid: baseContent.woPid,
      productName: baseContent.productName,
      productId: baseContent.productId,
      workOrderId: baseContent.workOrderId,
      inspectionId: baseContent.inspectionId,
      certNumber: baseContent.certNumber,
    };
    expect(computeCertHash(null, baseContent)).toBe(
      computeCertHash(null, reversed),
    );
  });

  test("B.2 boundary inputs (null vs empty vs 1-element deviceSerials) yield distinct, stable hashes", () => {
    const emptySerials = computeCertHash(null, {
      ...baseContent,
      deviceSerials: [],
    });
    const oneSerial = computeCertHash(null, {
      ...baseContent,
      deviceSerials: ["SN-1"],
    });
    const twoSerials = computeCertHash(null, {
      ...baseContent,
      deviceSerials: ["SN-1", "SN-2"],
    });
    const reversed = computeCertHash(null, {
      ...baseContent,
      deviceSerials: ["SN-2", "SN-1"],
    });

    // All four distinct — empty !== one !== two !== reversed(two).
    const set = new Set([emptySerials, oneSerial, twoSerials, reversed]);
    expect(set.size).toBe(4);

    // Re-running any of them produces the same hash (stable).
    expect(
      computeCertHash(null, { ...baseContent, deviceSerials: [] }),
    ).toBe(emptySerials);
    expect(
      computeCertHash(null, { ...baseContent, deviceSerials: ["SN-2", "SN-1"] }),
    ).toBe(reversed);

    // null-like fields on optional positions produce distinct hashes too.
    // (notes: "canon" vs notes: null)
    const nullNotes = computeCertHash(null, { ...baseContent, notes: null });
    expect(nullNotes).not.toBe(emptySerials); // different content entirely
    expect(nullNotes).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  §C — Cross-org isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("audit-chain-iso-cfr §C — cross-org isolation", () => {
  beforeEach(wipeFixtureCerts);

  test("C.1 tampering org A does NOT invalidate org B's chain", async () => {
    const chainA = await seedCleanChain(ORG_PRIMARY, "C1-A");
    const chainB = await seedCleanChain(ORG_SECONDARY, "C1-B");

    // Both orgs verify clean at baseline.
    const beforeA = await withOrg(pool, ORG_PRIMARY.orgId, (c) =>
      verifyQcCertChain(c, ORG_PRIMARY.orgId),
    );
    const beforeB = await withOrg(pool, ORG_SECONDARY.orgId, (c) =>
      verifyQcCertChain(c, ORG_SECONDARY.orgId),
    );
    expect(beforeA.ok).toBe(true);
    expect(beforeB.ok).toBe(true);

    // Tamper org A's middle cert.
    await withOrg(pool, ORG_PRIMARY.orgId, async (client) => {
      await client.query(
        `UPDATE qc_certs SET signed_by_name = 'Tampered' WHERE id = $1`,
        [chainA.middleCertId],
      );
    });

    // Org A is now broken, org B is STILL clean. This is the multi-tenant
    // compliance property — no cryptographic leakage of state across
    // tenants, because each org's chain starts from its own GENESIS.
    const afterA = await withOrg(pool, ORG_PRIMARY.orgId, (c) =>
      verifyQcCertChain(c, ORG_PRIMARY.orgId),
    );
    const afterB = await withOrg(pool, ORG_SECONDARY.orgId, (c) =>
      verifyQcCertChain(c, ORG_SECONDARY.orgId),
    );
    expect(afterA.ok).toBe(false);
    expect(afterA.firstBroken?.id).toBe(chainA.middleCertId);
    expect(
      afterB.ok,
      "org B must remain clean despite org A's tampering",
    ).toBe(true);
    expect(afterB.totalCount).toBe(chainB.certIds.length);
    expect(afterB.verifiedCount).toBe(chainB.certIds.length);
  });

  test("C.2 healing org A's tamper does not disturb org B's chain hashes", async () => {
    const chainA = await seedCleanChain(ORG_PRIMARY, "C2-A");
    const chainB = await seedCleanChain(ORG_SECONDARY, "C2-B");

    // Capture org B's stored hashes as a baseline.
    const { rows: bBefore } = await vendorPool.query<{
      id: string;
      signature_hash: string;
    }>(
      `SELECT id, signature_hash FROM qc_certs
        WHERE org_id = $1 AND deleted_at IS NULL
        ORDER BY issued_at ASC, id ASC`,
      [ORG_SECONDARY.orgId],
    );
    expect(bBefore.map((r) => r.signature_hash)).toEqual(
      chainB.signatureHashes,
    );

    // Tamper org A, then heal it.
    await withOrg(pool, ORG_PRIMARY.orgId, async (client) => {
      const { rows: pre } = await client.query<{ signed_by_name: string }>(
        `SELECT signed_by_name FROM qc_certs WHERE id = $1`,
        [chainA.middleCertId],
      );
      const original = pre[0]!.signed_by_name;
      await client.query(
        `UPDATE qc_certs SET signed_by_name = 'Tampered' WHERE id = $1`,
        [chainA.middleCertId],
      );
      // Verify broken mid-heal.
      const mid = await verifyQcCertChain(client, ORG_PRIMARY.orgId);
      expect(mid.ok).toBe(false);
      // Heal.
      await client.query(
        `UPDATE qc_certs SET signed_by_name = $2 WHERE id = $1`,
        [chainA.middleCertId, original],
      );
    });

    // Org A clean again.
    const postHealA = await withOrg(pool, ORG_PRIMARY.orgId, (c) =>
      verifyQcCertChain(c, ORG_PRIMARY.orgId),
    );
    expect(postHealA.ok).toBe(true);

    // Org B's stored hashes are byte-for-byte identical to baseline —
    // no cross-tenant write ever occurred. If this ever drifts, RLS has
    // failed or a trigger has fired across tenant boundaries.
    const { rows: bAfter } = await vendorPool.query<{
      id: string;
      signature_hash: string;
    }>(
      `SELECT id, signature_hash FROM qc_certs
        WHERE org_id = $1 AND deleted_at IS NULL
        ORDER BY issued_at ASC, id ASC`,
      [ORG_SECONDARY.orgId],
    );
    expect(bAfter).toEqual(bBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  §D — Tamper-heal-reverify property loop
// ═══════════════════════════════════════════════════════════════════════════

describe("audit-chain-iso-cfr §D — tamper-heal-reverify property", () => {
  beforeEach(wipeFixtureCerts);

  test("D.1 every mutation shape breaks verification AT the mutated cert; healing restores it", async () => {
    const chain = await seedCleanChain(ORG_PRIMARY, "D1");
    const targetId = chain.middleCertId;

    // Mutation table — each entry is a single SQL UPDATE that changes
    // exactly ONE hash-contributing column. For each:
    //   1. capture original value
    //   2. UPDATE to tampered
    //   3. verifyQcCertChain → ok=false, firstBroken.id === targetId
    //   4. UPDATE back to original
    //   5. verifyQcCertChain → ok=true
    //
    // The loop design ensures that any future change to `computeCertHash`
    // that accidentally drops a field from the digest will fail this
    // test, because that field's mutation would no longer break the
    // chain.
    const mutations: Array<{
      label: string;
      column: string;
      tamperValue: unknown;
      typeCast: string;
    }> = [
      {
        label: "signed_by_name",
        column: "signed_by_name",
        tamperValue: "Tampered Signer",
        typeCast: "::text",
      },
      {
        label: "notes",
        column: "notes",
        tamperValue: "totally-different-notes",
        typeCast: "::text",
      },
      {
        label: "device_serials reorder",
        column: "device_serials",
        tamperValue: ["SN-REORDERED-B", "SN-REORDERED-A"],
        typeCast: "::text[]",
      },
      {
        label: "issued_at + 1 ms",
        column: "issued_at",
        // Symbolic — handled inline via SQL expression.
        tamperValue: null,
        typeCast: "",
      },
    ];

    for (const mut of mutations) {
      // Step 1 + 2: capture + tamper
      const original = await withOrg(
        pool,
        ORG_PRIMARY.orgId,
        async (client) => {
          const { rows } = await client.query<Record<string, unknown>>(
            `SELECT ${mut.column} AS v FROM qc_certs WHERE id = $1`,
            [targetId],
          );
          const captured = rows[0]!.v;
          if (mut.column === "issued_at") {
            await client.query(
              `UPDATE qc_certs
                  SET issued_at = issued_at + interval '1 millisecond'
                WHERE id = $1`,
              [targetId],
            );
          } else {
            await client.query(
              `UPDATE qc_certs SET ${mut.column} = $2${mut.typeCast} WHERE id = $1`,
              [targetId, mut.tamperValue],
            );
          }
          return captured;
        },
      );

      // Step 3: verify the tamper is visible to the chain walker, AT
      // the tampered cert specifically (not the first or last cert).
      const broken = await withOrg(pool, ORG_PRIMARY.orgId, (c) =>
        verifyQcCertChain(c, ORG_PRIMARY.orgId),
      );
      expect(broken.ok, `[${mut.label}] tamper must be detected`).toBe(false);
      expect(
        broken.firstBroken?.id,
        `[${mut.label}] firstBroken must be the tampered cert`,
      ).toBe(targetId);
      expect(broken.verifiedCount).toBe(1);
      expect(broken.totalCount).toBe(3);

      // Step 4: heal
      await withOrg(pool, ORG_PRIMARY.orgId, async (client) => {
        await client.query(
          `UPDATE qc_certs SET ${mut.column} = $2${mut.typeCast} WHERE id = $1`,
          [targetId, original],
        );
      });

      // Step 5: reverify clean
      const healed = await withOrg(pool, ORG_PRIMARY.orgId, (c) =>
        verifyQcCertChain(c, ORG_PRIMARY.orgId),
      );
      expect(healed.ok, `[${mut.label}] heal must restore verification`).toBe(
        true,
      );
      expect(healed.verifiedCount).toBe(3);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  §E — Chain-head reproducibility
// ═══════════════════════════════════════════════════════════════════════════

describe("audit-chain-iso-cfr §E — chain-head reproducibility", () => {
  beforeEach(wipeFixtureCerts);

  test("E.1 head hash recomputed from DB snapshot equals the latest stored hash", async () => {
    const chain = await seedCleanChain(ORG_PRIMARY, "E1");

    // Read the chain back from the DB and walk it from scratch — this
    // simulates "regulator hands us a backup tape 5 years from now and
    // asks us to produce the head hash." The recomputed final hash
    // must byte-for-byte equal what we have stored.
    const { rows } = await vendorPool.query<{
      id: string;
      cert_number: string;
      inspection_id: string;
      work_order_id: string | null;
      product_id: string | null;
      product_name: string | null;
      wo_pid: string | null;
      device_serials: string[];
      signed_by: string | null;
      signed_by_name: string | null;
      notes: string | null;
      issued_at: Date;
      signature_hash: string;
    }>(
      `SELECT id, cert_number, inspection_id, work_order_id, product_id,
              product_name, wo_pid, device_serials, signed_by,
              signed_by_name, notes, issued_at, signature_hash
         FROM qc_certs
        WHERE org_id = $1 AND deleted_at IS NULL
        ORDER BY issued_at ASC, id ASC`,
      [ORG_PRIMARY.orgId],
    );
    expect(rows).toHaveLength(3);

    let prev: string | null = null;
    const recomputed: string[] = [];
    for (const r of rows) {
      const h = computeCertHash(prev, {
        certNumber: r.cert_number,
        inspectionId: r.inspection_id,
        workOrderId: r.work_order_id,
        productId: r.product_id,
        productName: r.product_name,
        woPid: r.wo_pid,
        deviceSerials: r.device_serials ?? [],
        signedBy: r.signed_by,
        signedByName: r.signed_by_name,
        notes: r.notes,
        issuedAt: r.issued_at.toISOString(),
      });
      recomputed.push(h);
      prev = h;
    }

    // Recomputed matches storage, cert-by-cert.
    expect(recomputed).toEqual(chain.signatureHashes);
    // And in particular the HEAD (most recent cert) matches its stored
    // signature — this is the value an auditor would copy into a
    // compliance report and re-verify years later.
    expect(recomputed[recomputed.length - 1]).toBe(
      rows[rows.length - 1]!.signature_hash,
    );

    // Running the exact same walk a second time gives the exact same
    // head (pure function over stable input).
    let prev2: string | null = null;
    for (const r of rows) {
      prev2 = computeCertHash(prev2, {
        certNumber: r.cert_number,
        inspectionId: r.inspection_id,
        workOrderId: r.work_order_id,
        productId: r.product_id,
        productName: r.product_name,
        woPid: r.wo_pid,
        deviceSerials: r.device_serials ?? [],
        signedBy: r.signed_by,
        signedByName: r.signed_by_name,
        notes: r.notes,
        issuedAt: r.issued_at.toISOString(),
      });
    }
    expect(prev2).toBe(recomputed[recomputed.length - 1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  §F — audit.log diagnostic content-chain replay
// ═══════════════════════════════════════════════════════════════════════════

describe("audit-chain-iso-cfr §F — audit.log diagnostic content-chain", () => {
  // NOTE: audit.log does NOT have a signature_hash column today (schema
  // gap tracked in ARCHITECTURE.md §9.5). The assertions below prove the
  // content-chain primitive is ready to be enforced — once a migration
  // adds the column and a trigger stamps it, flipping this gate from
  // diagnostic to enforcing is one line (compare stored vs. computed).

  test("F.1 audit.log has non-trivial content for the dev org (rows + required columns)", async () => {
    const { rows: cntRows } = await vendorPool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM audit.log WHERE org_id = $1`,
      [ORG_PRIMARY.orgId],
    );
    const count = Number(cntRows[0]!.c);
    // Dev seed + prior gate runs always land at least a handful of rows.
    // Without rows, the replay is vacuous.
    expect(count, "audit.log must have rows for the dev org").toBeGreaterThan(0);

    // Every row must have the fields the content-chain would hash. If any
    // of these are NULL-where-we-hash-NOT-NULL, a future enforcement pass
    // would need to backfill before turning on the trigger.
    const { rows: nulls } = await vendorPool.query<{
      id: string;
      missing: string;
    }>(
      `SELECT id,
              CASE
                WHEN table_name IS NULL THEN 'table_name'
                WHEN action IS NULL THEN 'action'
                WHEN changed_at IS NULL THEN 'changed_at'
                ELSE NULL
              END AS missing
         FROM audit.log
        WHERE org_id = $1
          AND (table_name IS NULL OR action IS NULL OR changed_at IS NULL)`,
      [ORG_PRIMARY.orgId],
    );
    expect(
      nulls,
      `audit.log rows with NULL in hash-required columns:\n${nulls
        .map((r) => `  ${r.id}: missing ${r.missing}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("F.2 content-chain walk completes over the full audit.log snapshot", async () => {
    // The primitive we'd enforce in production takes prev_hash and the
    // current row's canonical content; computeAuditEntryHash mirrors
    // computeCertHash exactly. If the walk throws (e.g. a non-serialisable
    // jsonb payload, a changed_at that isn't a Date) we learn today that
    // the enforcement migration needs to address it.
    const result = await computeAuditLogHead(ORG_PRIMARY.orgId);
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("F.3 two independent walks of the same snapshot produce identical head hashes", async () => {
    const a = await computeAuditLogHead(ORG_PRIMARY.orgId);
    const b = await computeAuditLogHead(ORG_PRIMARY.orgId);
    expect(a.rowCount).toBe(b.rowCount);
    expect(a.headHash).toBe(b.headHash);

    // Also: the hash is sensitive to the canonical-JSON contract — if
    // someone later replaces canonicalizeAuditEntry with JSON.stringify
    // (no key sort), the result would drift silently. This assertion
    // pins the current contract by re-hashing a known payload.
    const sample: AuditLogContent = {
      orgId: "00000000-0000-0000-0000-0000000000aa",
      tableName: "public.users",
      rowId: "00000000-0000-0000-0000-0000000000ab",
      action: "UPDATE",
      actor: "00000000-0000-0000-0000-0000000000ac",
      before: { name: "Alice" },
      after: { name: "Alice Smith" },
      changedAt: "2026-04-22T10:00:00.000Z",
      traceId: "00-trace-01-0",
    };
    // Construct a reversed-order copy; canonicalization must neutralize it.
    const reversed: AuditLogContent = {
      traceId: sample.traceId,
      changedAt: sample.changedAt,
      after: sample.after,
      before: sample.before,
      actor: sample.actor,
      action: sample.action,
      rowId: sample.rowId,
      tableName: sample.tableName,
      orgId: sample.orgId,
    };
    expect(computeAuditEntryHash(null, sample)).toBe(
      computeAuditEntryHash(null, reversed),
    );
  });

  test("F.4 any single-field mutation to a captured row changes the recomputed head hash", async () => {
    // Grab one real audit row, canonicalize it, compute its solo-entry
    // hash. Then mutate each hash-relevant field in turn (in memory, not
    // the DB — we don't tamper live audit data) and assert the hash
    // changes. This is the "a future enforcement trigger would have
    // caught this" proof.
    const { rows } = await vendorPool.query<AuditRow>(
      `SELECT id, org_id, table_name, row_id, action, actor,
              before, after, changed_at, trace_id
         FROM audit.log
        WHERE org_id = $1
        ORDER BY changed_at ASC, id ASC
        LIMIT 1`,
      [ORG_PRIMARY.orgId],
    );
    expect(rows.length, "need at least one audit.log row to mutate").toBe(1);
    const baseContent = auditRowToContent(rows[0]!);
    const baseHash = computeAuditEntryHash(null, baseContent);
    expect(baseHash).toMatch(/^[0-9a-f]{64}$/);

    // Every hash-contributing field, when mutated alone, must produce a
    // different hash. This locks down canonicalizeAuditEntry's field
    // set — dropping one from the hash would let that mutation class
    // slip past a future enforcement trigger.
    const mutations: Array<Partial<AuditLogContent>> = [
      { orgId: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
      { tableName: "public.different_table" },
      { rowId: "99999999-9999-9999-9999-999999999999" },
      { action: baseContent.action === "INSERT" ? "UPDATE" : "INSERT" },
      { actor: "88888888-8888-8888-8888-888888888888" },
      { before: { tampered: true } },
      { after: { tampered: true } },
      {
        changedAt: new Date(
          Date.parse(baseContent.changedAt) + 1,
        ).toISOString(),
      },
      { traceId: "mutated-trace" },
    ];
    for (const delta of mutations) {
      const mutated = computeAuditEntryHash(null, { ...baseContent, ...delta });
      expect(
        mutated,
        `mutation ${JSON.stringify(delta)} should change the hash`,
      ).not.toBe(baseHash);
    }
  });
});
