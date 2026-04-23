/**
 * Gate 40 — Phase 4 §4.2 QC certificate SHA-256 hash-chain.
 *
 * ARCHITECTURE.md §4.2 defines a forward-linked hash chain over
 * `qc_certs.signature_hash`:
 *
 *     signature_hash_n = sha256(
 *         signature_hash_{n-1} || "|" || canonical_json(content_n)
 *     )
 *
 * with the sentinel `"GENESIS"` in place of `signature_hash_{n-1}` for
 * the first cert of an org. Any mutation to a cert's business content,
 * or a row insert/delete in the middle of the chain, MUST be detectable
 * by re-walking the chain and recomputing each hash.
 *
 * This gate covers:
 *
 *   (40.1) computeCertHash is deterministic and canonical — same content
 *          + same prev produce the same digest, any business-field
 *          change produces a different digest, GENESIS sentinel is used
 *          when prev is null. Pure unit-level checks, no DB.
 *
 *   (40.2) A freshly-built chain (seeded with hand-computed hashes)
 *          verifies clean via verifyQcCertChain — ok=true, verifiedCount
 *          equals totalCount.
 *
 *   (40.3) Tamper detection — mutating any single business field on a
 *          middle cert produces ok=false with firstBroken pointing at
 *          the mutated row.
 *
 *   (40.4) Deletion detection — hard-DELETE'ing a middle cert orphans
 *          the next cert's prev_hash assumption, and verifyQcCertChain
 *          flags the broken row.
 *
 *   (40.5) Service integration — calling QcCertsService.issue() through
 *          the real service path (advisory lock + chain-head read +
 *          computeCertHash + INSERT) for multiple inspections in
 *          sequence produces a chain that verifies clean.
 *
 *   (40.6) Concurrent issuance for the same org does NOT fork the chain.
 *          Two parallel issue() calls, each for a distinct inspection,
 *          must serialise on the per-org advisory lock so verifyQcCertChain
 *          still returns ok=true afterwards. Absent the lock this test
 *          would observe both callers reading the same chain head and
 *          forking the chain at the second cert.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { installNumericTypeParser, withOrg } from "@instigenie/db";
import {
  computeCertHash,
  verifyQcCertChain,
  GENESIS_HASH,
  type QcCertHashContent,
} from "@instigenie/api/qc/cert-hash";
import { QcCertsService } from "@instigenie/api/qc/certs.service";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://instigenie_app:instigenie_dev@localhost:5434/instigenie";

const ORG_ID = "00000000-0000-0000-0000-00000000a001";
const USER_ID = "00000000-0000-0000-0000-00000000b00a"; // Dev QC Manager
const PRODUCT_ID = "00000000-0000-0000-0000-000000fc0001";
const BOM_ID = "00000000-0000-0000-0000-000000fc0101"; // v3 ACTIVE

let pool: pg.Pool;

beforeAll(async () => {
  installNumericTypeParser();
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 6,
    application_name: "gate-40",
  });
});

afterAll(async () => {
  await pool.end();
});

/**
 * Gate-40 tests share the main dev org's qc_certs table. Gate 39 leaves
 * rows with null signature_hash that would immediately fail
 * verifyQcCertChain (which walks ALL non-deleted certs for the org). To
 * keep each test deterministic we wipe the org's certs at the start of
 * every chain-dependent test. pdf_render_runs / pdf_render_dlq do NOT
 * FK to qc_certs.id, so the wipe is a simple DELETE.
 */
async function wipeOrgCerts(): Promise<void> {
  await withOrg(pool, ORG_ID, async (client) => {
    await client.query(`DELETE FROM qc_certs WHERE org_id = $1`, [ORG_ID]);
  });
}

/** Fixture for a ready-to-issue PASSED FINAL_QC inspection. */
interface Inspection {
  inspectionId: string;
  workOrderId: string;
  woPid: string;
  deviceSerials: string[];
  productName: string;
}

async function seedInspection(tag = "G40"): Promise<Inspection> {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  return withOrg(pool, ORG_ID, async (client) => {
    const {
      rows: [wo],
    } = await client.query<{ id: string; pid: string }>(
      `INSERT INTO work_orders
         (org_id, pid, product_id, bom_id, bom_version_label,
          quantity, status, device_serials)
       VALUES ($1, $2, $3, $4, 'v3', 2, 'IN_PROGRESS',
               ARRAY[$5::text, $6::text])
       RETURNING id, pid`,
      [
        ORG_ID,
        `WO-${tag}-${suffix}`,
        PRODUCT_ID,
        BOM_ID,
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
      [ORG_ID, `QCI-${tag}-${suffix}`, wo!.id, PRODUCT_ID],
    );
    // Product name comes from the main dev seed (Phase 2 QC seed
    // 11-qc-dev-data.sql). We re-query rather than hardcode in case the
    // seed name ever changes.
    const {
      rows: [prod],
    } = await client.query<{ name: string }>(
      `SELECT name FROM products WHERE id = $1`,
      [PRODUCT_ID],
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
 * Build a RequestUser-stub sufficient for `withRequest` + `requireUser`.
 * The service only reaches in via `requireUser(req).{id, orgId}`; the
 * remaining RequestUser fields are never touched by issue(), so we stub
 * them minimally and cast through unknown to sidestep the Fastify type
 * without pulling the whole Fastify runtime into the gates package.
 */
function fakeReq(): Parameters<QcCertsService["issue"]>[0] {
  return {
    user: {
      id: USER_ID,
      orgId: ORG_ID,
      email: "qcmgr@instigenie.local",
      roles: [],
      permissions: new Set(),
      audience: "internal",
    },
  } as unknown as Parameters<QcCertsService["issue"]>[0];
}

/**
 * Hand-seed a single cert row with an explicit signature_hash. Used by
 * the pure-chain-math tests so we can build a chain without going
 * through the service layer.
 */
async function insertCertRow(
  inspection: Inspection,
  certNumber: string,
  prevHash: string | null,
  notes: string,
): Promise<{ id: string; signatureHash: string }> {
  const issuedAt = new Date();
  const content: QcCertHashContent = {
    certNumber,
    inspectionId: inspection.inspectionId,
    workOrderId: inspection.workOrderId,
    productId: PRODUCT_ID,
    productName: inspection.productName,
    woPid: inspection.woPid,
    deviceSerials: inspection.deviceSerials,
    signedBy: USER_ID,
    signedByName: "Dev QC Manager",
    notes,
    issuedAt: issuedAt.toISOString(),
  };
  const signatureHash = computeCertHash(prevHash, content);
  return withOrg(pool, ORG_ID, async (client) => {
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
        ORG_ID,
        certNumber,
        inspection.inspectionId,
        inspection.workOrderId,
        PRODUCT_ID,
        inspection.productName,
        inspection.woPid,
        inspection.deviceSerials,
        issuedAt,
        USER_ID,
        "Dev QC Manager",
        signatureHash,
        notes,
      ],
    );
    return { id: r!.id, signatureHash };
  });
}

// ─── Gate 40.1 — Pure hash determinism ───────────────────────────────────

describe("Gate 40.1 — computeCertHash is deterministic + canonical", () => {
  const sampleContent: QcCertHashContent = {
    certNumber: "QCC-2026-0001",
    inspectionId: "11111111-1111-1111-1111-111111111111",
    workOrderId: "22222222-2222-2222-2222-222222222222",
    productId: "33333333-3333-3333-3333-333333333333",
    productName: "ECG Patient Monitor v2",
    woPid: "WO-2026-0001",
    deviceSerials: ["SN-A01", "SN-A02"],
    signedBy: "44444444-4444-4444-4444-444444444444",
    signedByName: "Dev QC Manager",
    notes: "routine issue",
    issuedAt: "2026-04-22T10:00:00.000Z",
  };

  test("same content + same prev → same digest (no randomness)", () => {
    const a = computeCertHash(null, sampleContent);
    const b = computeCertHash(null, sampleContent);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("GENESIS sentinel drives first-cert hash (prev=null)", () => {
    const genesis = computeCertHash(null, sampleContent);
    // Re-derive by hand using the explicit sentinel — proves null is not
    // an alias for empty-string or something weaker than "GENESIS".
    const explicit = computeCertHash(GENESIS_HASH, sampleContent);
    expect(genesis).toBe(explicit);
    expect(GENESIS_HASH).toBe("GENESIS");
  });

  test("different prev_hash → different digest even for same content", () => {
    const withA = computeCertHash("a".repeat(64), sampleContent);
    const withB = computeCertHash("b".repeat(64), sampleContent);
    expect(withA).not.toBe(withB);
  });

  test("changing any business field changes the digest", () => {
    const baseline = computeCertHash(null, sampleContent);
    const mutations: Array<Partial<QcCertHashContent>> = [
      { certNumber: "QCC-2026-0002" },
      { inspectionId: "99999999-9999-9999-9999-999999999999" },
      { workOrderId: null },
      { productId: null },
      { productName: "ECG Patient Monitor v3" },
      { woPid: "WO-2026-0999" },
      { deviceSerials: ["SN-A01", "SN-A03"] }, // swapped SN
      { deviceSerials: ["SN-A02", "SN-A01"] }, // different order
      { signedBy: null },
      { signedByName: "Someone Else" },
      { notes: "different notes" },
      { issuedAt: "2026-04-22T10:00:00.001Z" }, // +1 ms
    ];
    for (const delta of mutations) {
      const mutated = computeCertHash(null, { ...sampleContent, ...delta });
      expect(
        mutated,
        `mutation ${JSON.stringify(delta)} should change the hash`,
      ).not.toBe(baseline);
    }
  });

  test("empty deviceSerials vs missing-equivalent is handled", () => {
    const empty = computeCertHash(null, {
      ...sampleContent,
      deviceSerials: [],
    });
    const one = computeCertHash(null, {
      ...sampleContent,
      deviceSerials: ["SN-A01"],
    });
    expect(empty).not.toBe(one);
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Gate 40.2 — Clean chain verifies ────────────────────────────────────

describe("Gate 40.2 — verifyQcCertChain on a hand-seeded clean chain", () => {
  beforeEach(wipeOrgCerts);

  test("three linked certs verify clean (ok=true, verifiedCount=totalCount)", async () => {
    const i1 = await seedInspection("G40-2A");
    const i2 = await seedInspection("G40-2B");
    const i3 = await seedInspection("G40-2C");

    const c1 = await insertCertRow(i1, "QCC-G40-2-0001", null, "first");
    const c2 = await insertCertRow(i2, "QCC-G40-2-0002", c1.signatureHash, "second");
    const c3 = await insertCertRow(i3, "QCC-G40-2-0003", c2.signatureHash, "third");

    const res = await withOrg(pool, ORG_ID, (client) =>
      verifyQcCertChain(client, ORG_ID),
    );
    expect(res.ok).toBe(true);
    expect(res.totalCount).toBe(3);
    expect(res.verifiedCount).toBe(3);
    expect(res.firstBroken).toBeUndefined();

    // Sanity check that the chain row ordering is what we expect.
    expect(c1.signatureHash).not.toBe(c2.signatureHash);
    expect(c2.signatureHash).not.toBe(c3.signatureHash);
  });
});

// ─── Gate 40.3 — Tamper detection ────────────────────────────────────────

describe("Gate 40.3 — verifyQcCertChain detects single-row tampering", () => {
  beforeEach(wipeOrgCerts);

  test("UPDATE middle cert's signed_by_name → verify returns firstBroken", async () => {
    const i1 = await seedInspection("G40-3A");
    const i2 = await seedInspection("G40-3B");
    const i3 = await seedInspection("G40-3C");

    const c1 = await insertCertRow(i1, "QCC-G40-3-0001", null, "ok");
    const c2 = await insertCertRow(i2, "QCC-G40-3-0002", c1.signatureHash, "ok");
    const c3 = await insertCertRow(i3, "QCC-G40-3-0003", c2.signatureHash, "ok");

    // Clean chain verifies first.
    const before = await withOrg(pool, ORG_ID, (client) =>
      verifyQcCertChain(client, ORG_ID),
    );
    expect(before.ok).toBe(true);

    // Tamper: mutate signed_by_name on the middle cert. Because this
    // field feeds into the content hash, the stored signature_hash is
    // now orphaned from what re-computation would produce.
    await withOrg(pool, ORG_ID, async (client) => {
      await client.query(
        `UPDATE qc_certs SET signed_by_name = $2 WHERE id = $1`,
        [c2.id, "Totally Different Signer"],
      );
    });

    const after = await withOrg(pool, ORG_ID, (client) =>
      verifyQcCertChain(client, ORG_ID),
    );
    expect(after.ok).toBe(false);
    expect(after.firstBroken?.id).toBe(c2.id);
    expect(after.firstBroken?.certNumber).toBe("QCC-G40-3-0002");
    expect(after.firstBroken?.actual).toBe(c2.signatureHash);
    // Expected hash (recomputed from the tampered content) ≠ stored.
    expect(after.firstBroken?.expected).not.toBe(c2.signatureHash);
    // Walked through c1 successfully before hitting the broken row.
    expect(after.verifiedCount).toBe(1);
    expect(after.totalCount).toBe(3);
    // c3 is not the firstBroken — the walk short-circuits at c2.
    expect(after.firstBroken?.id).not.toBe(c3.id);
  });
});

// ─── Gate 40.4 — Deletion detection ──────────────────────────────────────

describe("Gate 40.4 — verifyQcCertChain detects middle-row deletion", () => {
  beforeEach(wipeOrgCerts);

  test("DELETE middle cert → next cert's prev_hash no longer lines up", async () => {
    const i1 = await seedInspection("G40-4A");
    const i2 = await seedInspection("G40-4B");
    const i3 = await seedInspection("G40-4C");

    const c1 = await insertCertRow(i1, "QCC-G40-4-0001", null, "a");
    const c2 = await insertCertRow(i2, "QCC-G40-4-0002", c1.signatureHash, "b");
    const c3 = await insertCertRow(i3, "QCC-G40-4-0003", c2.signatureHash, "c");

    // Hard delete the middle cert. Soft-delete (deleted_at) would
    // exclude it from the chain walk but also from the first-N ordering
    // — we want the "chain gap" scenario where c3 is present but the
    // prev it was bound to is gone.
    await withOrg(pool, ORG_ID, async (client) => {
      await client.query(`DELETE FROM qc_certs WHERE id = $1`, [c2.id]);
    });

    const after = await withOrg(pool, ORG_ID, (client) =>
      verifyQcCertChain(client, ORG_ID),
    );
    expect(after.ok).toBe(false);
    // c1 verified; the walk then lands on c3 whose stored hash was
    // anchored to c2, not c1.
    expect(after.verifiedCount).toBe(1);
    expect(after.totalCount).toBe(2);
    expect(after.firstBroken?.id).toBe(c3.id);
    expect(after.firstBroken?.actual).toBe(c3.signatureHash);
  });

  test("soft-delete of trailing cert leaves remaining chain clean", async () => {
    // Complement: soft-deleting the newest cert shrinks the visible
    // chain. The preceding certs still verify because their hashes
    // don't depend on descendants.
    const i1 = await seedInspection("G40-4D");
    const i2 = await seedInspection("G40-4E");

    const c1 = await insertCertRow(i1, "QCC-G40-4-0101", null, "a");
    const c2 = await insertCertRow(i2, "QCC-G40-4-0102", c1.signatureHash, "b");

    await withOrg(pool, ORG_ID, async (client) => {
      await client.query(
        `UPDATE qc_certs SET deleted_at = now() WHERE id = $1`,
        [c2.id],
      );
    });

    const res = await withOrg(pool, ORG_ID, (client) =>
      verifyQcCertChain(client, ORG_ID),
    );
    expect(res.ok).toBe(true);
    expect(res.totalCount).toBe(1);
    expect(res.verifiedCount).toBe(1);
  });
});

// ─── Gate 40.5 — Service integration ─────────────────────────────────────

describe("Gate 40.5 — QcCertsService.issue() writes verifiable chain rows", () => {
  beforeEach(wipeOrgCerts);

  test("sequential issue() calls build a chain that verifies clean", async () => {
    const service = new QcCertsService(pool);

    const i1 = await seedInspection("G40-5A");
    const i2 = await seedInspection("G40-5B");
    const i3 = await seedInspection("G40-5C");

    const cert1 = await service.issue(fakeReq(), {
      inspectionId: i1.inspectionId,
      notes: "first issue",
    });
    const cert2 = await service.issue(fakeReq(), {
      inspectionId: i2.inspectionId,
      notes: "second issue",
    });
    const cert3 = await service.issue(fakeReq(), {
      inspectionId: i3.inspectionId,
      notes: "third issue",
    });

    // Each cert must have a 64-hex signature_hash (sha256 output).
    expect(cert1.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cert2.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cert3.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cert1.signatureHash).not.toBe(cert2.signatureHash);
    expect(cert2.signatureHash).not.toBe(cert3.signatureHash);

    // Chain verifies end-to-end.
    const res = await withOrg(pool, ORG_ID, (client) =>
      verifyQcCertChain(client, ORG_ID),
    );
    expect(res.ok).toBe(true);
    expect(res.totalCount).toBe(3);
    expect(res.verifiedCount).toBe(3);

    // Cross-check: recompute cert1's hash by hand using GENESIS as prev.
    // The service's canonical encoding must match what the standalone
    // pure function produces, else an external auditor's implementation
    // would diverge.
    const expectedC1 = computeCertHash(null, {
      certNumber: cert1.certNumber,
      inspectionId: cert1.inspectionId,
      workOrderId: cert1.workOrderId,
      productId: cert1.productId,
      productName: cert1.productName,
      woPid: cert1.woPid,
      deviceSerials: cert1.deviceSerials,
      signedBy: cert1.signedBy,
      signedByName: cert1.signedByName,
      notes: cert1.notes,
      issuedAt: cert1.issuedAt,
    });
    expect(expectedC1).toBe(cert1.signatureHash);
  });
});

// ─── Gate 40.6 — Advisory lock prevents chain forks ──────────────────────

describe("Gate 40.6 — concurrent issue() serialises via advisory lock", () => {
  beforeEach(wipeOrgCerts);

  test("two parallel issue() calls produce a linear chain, not a fork", async () => {
    const service = new QcCertsService(pool);

    // Two distinct inspections. Both calls race to INSERT into qc_certs
    // for the same org. Without the per-org advisory lock each call
    // would read a stale (or identical) chain head and emit children
    // that both point at the same prev_hash — the chain would fork and
    // verifyQcCertChain would fail at the second cert.
    const [ia, ib] = await Promise.all([
      seedInspection("G40-6A"),
      seedInspection("G40-6B"),
    ]);

    const results = await Promise.all([
      service.issue(fakeReq(), { inspectionId: ia.inspectionId }),
      service.issue(fakeReq(), { inspectionId: ib.inspectionId }),
    ]);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // The two hashes cannot be equal — that would only happen if both
    // computed over identical content (they didn't, different inspection
    // ids) or if the same row got returned twice somehow.
    expect(results[0]!.signatureHash).not.toBe(results[1]!.signatureHash);

    // The real assertion: the resulting chain verifies clean, i.e. one
    // cert is the genesis, the other is linked to it, and
    // verifyQcCertChain walks 2/2 successfully.
    const res = await withOrg(pool, ORG_ID, (client) =>
      verifyQcCertChain(client, ORG_ID),
    );
    expect(res.ok).toBe(true);
    expect(res.totalCount).toBe(2);
    expect(res.verifiedCount).toBe(2);
  });
});
