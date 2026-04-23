/**
 * QC certificate hash-chain — ARCHITECTURE.md §4.2.
 *
 * Forward-linked SHA-256 chain over `qc_certs`. Each cert's
 * `signature_hash` is derived from the *previous* cert's hash plus a
 * canonical JSON encoding of the current cert's business content:
 *
 *     signature_hash = sha256( prev_hash || "|" || canonical_json(content) )
 *
 * The first cert in a per-org chain uses the sentinel string
 * {@link GENESIS_HASH} in place of `prev_hash`. Re-walking the chain
 * and recomputing each row's hash is the tamper-detection primitive
 * ({@link verifyQcCertChain}); any single-row mutation, row deletion,
 * or row insertion out-of-order breaks the chain at the first offending
 * cert.
 *
 * Canonical encoding rules (so an auditor with a different codebase can
 * re-verify):
 *   - Keys are JSON-stringified in ASCII-lexicographic order.
 *   - Arrays preserve insertion order (device_serials ordering IS
 *     business-meaningful — physical sequence of unit labels).
 *   - No whitespace; standard `JSON.stringify` with sorted keys.
 *   - Timestamps rendered as ISO-8601 UTC with millisecond precision.
 *
 * This module is intentionally a pure compute + one read-only SQL
 * helper. The *write* side (stamping signature_hash at issue time)
 * lives in `certs.service.ts`, which takes a per-org advisory lock
 * to serialize chain-head reads across concurrent issuers.
 *
 * Chain axis: rows are walked ORDER BY issued_at ASC, id ASC.
 * `issued_at` (not `created_at`) is the canonical axis — see the
 * preamble on {@link verifyQcCertChain} for the race-condition
 * argument.
 */

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

/**
 * Business fields that participate in the hash. Deliberately excludes:
 *   - id              (DB-generated UUID; cert_number already carries
 *                      a per-org unique identity)
 *   - pdf_minio_key   (filled later by worker-pdf; not cert content)
 *   - signature_hash  (the output)
 *   - created_at / updated_at / deleted_at (infrastructure, not content)
 */
export interface QcCertHashContent {
  certNumber: string;
  inspectionId: string;
  workOrderId: string | null;
  productId: string | null;
  productName: string | null;
  woPid: string | null;
  deviceSerials: string[];
  signedBy: string | null;
  signedByName: string | null;
  notes: string | null;
  /** ISO-8601 UTC string (e.g. "2026-04-22T10:00:00.000Z"). */
  issuedAt: string;
}

/** Sentinel prepended to the first cert's hash input. */
export const GENESIS_HASH = "GENESIS";

/** Canonical JSON with sorted keys, whitespace-free. */
function canonicalize(content: QcCertHashContent): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(content).sort()) {
    sorted[key] = (content as unknown as Record<string, unknown>)[key];
  }
  return JSON.stringify(sorted);
}

export function computeCertHash(
  prevHash: string | null,
  content: QcCertHashContent,
): string {
  const seed = prevHash ?? GENESIS_HASH;
  const bytes = Buffer.concat([
    Buffer.from(seed, "utf8"),
    Buffer.from("|", "utf8"),
    Buffer.from(canonicalize(content), "utf8"),
  ]);
  return createHash("sha256").update(bytes).digest("hex");
}

export interface VerifyChainResult {
  ok: boolean;
  /** Number of certs walked that matched their recomputed hash. */
  verifiedCount: number;
  /** Total non-deleted certs in the chain. */
  totalCount: number;
  /** Present only when ok=false. Identifies the first cert that failed. */
  firstBroken?: {
    id: string;
    certNumber: string;
    expected: string;
    actual: string | null;
  };
}

interface ChainRow {
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
  signature_hash: string | null;
}

/**
 * Walk every non-deleted cert for {@link orgId} in chain order (issued_at
 * ASC, id ASC as a stable tiebreaker when two certs commit in the same
 * microsecond) and recompute each signature_hash. Returns `ok:false` at
 * the first mismatch, with the offending cert identified.
 *
 * Why `issued_at` and not `created_at`: `created_at DEFAULT now()` takes
 * the *transaction-start* timestamp. Under the per-org advisory lock
 * (see certs.service.issue), two concurrent issuers may have started
 * their transactions in the opposite order from which they acquired
 * the lock — so created_at can misorder the chain. `issued_at` is
 * stamped in the service AFTER lock acquisition (with `new Date()` in
 * Node, passed explicitly into the INSERT), so it reflects the true
 * within-lock ordering and is the canonical chain axis.
 *
 * Caller is responsible for:
 *   - Running inside a withOrg() tx so RLS scopes the SELECT.
 *   - Holding a snapshot consistent view (REPEATABLE READ) if the
 *     verification must not race concurrent issuances. For the daily
 *     pg_cron job a single-statement read at READ COMMITTED is enough
 *     since certs are never back-dated.
 */
export async function verifyQcCertChain(
  client: PoolClient,
  orgId: string,
): Promise<VerifyChainResult> {
  const { rows } = await client.query<ChainRow>(
    `SELECT id, cert_number, inspection_id, work_order_id, product_id,
            product_name, wo_pid, device_serials, signed_by, signed_by_name,
            notes, issued_at, signature_hash
       FROM qc_certs
      WHERE org_id = $1 AND deleted_at IS NULL
      ORDER BY issued_at ASC, id ASC`,
    [orgId],
  );

  let prevHash: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const content: QcCertHashContent = {
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
    };
    const expected = computeCertHash(prevHash, content);
    if (expected !== r.signature_hash) {
      return {
        ok: false,
        verifiedCount: i,
        totalCount: rows.length,
        firstBroken: {
          id: r.id,
          certNumber: r.cert_number,
          expected,
          actual: r.signature_hash,
        },
      };
    }
    prevHash = r.signature_hash;
  }
  return { ok: true, verifiedCount: rows.length, totalCount: rows.length };
}
