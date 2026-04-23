/**
 * QC certificates service.
 *
 * Scope (Phase 2 + Phase 4 §4.2 extensions):
 *   - list / getById / getByInspectionId  — read
 *   - issue() — snapshots the linked PASSED FINAL_QC inspection into an
 *               immutable cert row. Auto-generates QCC-YYYY-NNNN, binds
 *               product_name / wo_pid / device_serials at issuance time so
 *               the cert survives edits to upstream rows. Additionally
 *               (Phase 4 §4.2) computes the SHA-256 forward-linked chain
 *               hash for the new row under a per-org advisory lock so
 *               concurrent issuers cannot fork the chain.
 *   - recall() — soft-delete. Phase 2 only, no formal "revoked" state.
 *
 * Invariants enforced here:
 *   - inspection must exist, status=PASSED, kind=FINAL_QC
 *   - at most one non-deleted cert per inspection (DB unique index
 *     `qc_certs_one_per_inspection` is the belt; this is the braces)
 *   - cert_number is auto-assigned via qc_number_sequences if caller
 *     didn't supply one
 *   - signature_hash = sha256(prev_hash || "|" || canonical_json(content)),
 *     with GENESIS sentinel for the first cert per org. The chain-head
 *     read is serialised by a per-org pg_advisory_xact_lock so two
 *     concurrent issuances cannot both observe the same head and race
 *     to produce forked children.
 *
 * Explicitly NOT in Phase 2:
 *   - pdf generation / signing / minio upload   (handled by Phase 4 §4.1
 *     worker-pdf pipeline via qc_cert.issued outbox event)
 */

import type pg from "pg";
import type { FastifyRequest } from "fastify";
import type {
  IssueQcCert,
  QcCert,
  QcCertListQuerySchema,
} from "@instigenie/contracts";
import { z } from "zod";
import { ConflictError, NotFoundError } from "@instigenie/errors";
import { paginated } from "@instigenie/contracts";
import { enqueueOutbox } from "@instigenie/db";
import { withRequest } from "../shared/with-request.js";
import { planPagination } from "../shared/pagination.js";
import { certsRepo } from "./certs.repository.js";
import { inspectionsRepo } from "./inspections.repository.js";
import { nextQcNumber } from "./numbering.js";
import { computeCertHash } from "./cert-hash.js";
import { requireUser } from "../../context/request-context.js";

type QcCertListQuery = z.infer<typeof QcCertListQuerySchema>;

const CERT_SORTS: Record<string, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  issuedAt: "issued_at",
  certNumber: "cert_number",
};

export class QcCertsService {
  constructor(private readonly pool: pg.Pool) {}

  async list(
    req: FastifyRequest,
    query: QcCertListQuery,
  ): Promise<ReturnType<typeof paginated<QcCert>>> {
    return withRequest(req, this.pool, async (client) => {
      const plan = planPagination(query, CERT_SORTS, "issuedAt");
      const { data, total } = await certsRepo.list(
        client,
        {
          workOrderId: query.workOrderId,
          productId: query.productId,
          inspectionId: query.inspectionId,
          from: query.from,
          to: query.to,
          search: query.search,
        },
        plan,
      );
      return paginated(data, { page: plan.page, limit: plan.limit }, total);
    });
  }

  async getById(req: FastifyRequest, id: string): Promise<QcCert> {
    return withRequest(req, this.pool, async (client) => {
      const cert = await certsRepo.getById(client, id);
      if (!cert) throw new NotFoundError("qc certificate");
      return cert;
    });
  }

  async getByInspectionId(
    req: FastifyRequest,
    inspectionId: string,
  ): Promise<QcCert | null> {
    return withRequest(req, this.pool, async (client) => {
      return certsRepo.getByInspectionId(client, inspectionId);
    });
  }

  /**
   * Issue a certificate for a PASSED FINAL_QC inspection.
   *
   * Snapshotted fields:
   *   - productName   ← products.name for inspection.productId
   *   - woPid         ← work_orders.pid for inspection.workOrderId
   *   - deviceSerials ← work_orders.device_serials for inspection.workOrderId
   *   - signedByName  ← users.name for signedBy (defaults to current user)
   *
   * These are snapshots: edits to the upstream rows never mutate the cert.
   */
  async issue(
    req: FastifyRequest,
    input: IssueQcCert,
  ): Promise<QcCert> {
    const user = requireUser(req);
    return withRequest(req, this.pool, async (client) => {
      const inspection = await inspectionsRepo.getById(
        client,
        input.inspectionId,
      );
      if (!inspection) throw new NotFoundError("qc inspection");

      if (inspection.kind !== "FINAL_QC") {
        throw new ConflictError(
          `can only issue certificates for FINAL_QC inspections (this is ${inspection.kind})`,
        );
      }
      if (inspection.status !== "PASSED") {
        throw new ConflictError(
          `can only issue certificates for PASSED inspections (status: ${inspection.status})`,
        );
      }
      if (inspection.verdict !== "PASS") {
        throw new ConflictError(
          `can only issue certificates for PASS verdict (verdict: ${inspection.verdict ?? "null"})`,
        );
      }

      // One cert per inspection (soft): DB also enforces via partial unique index.
      const existing = await certsRepo.getByInspectionId(
        client,
        input.inspectionId,
      );
      if (existing) {
        throw new ConflictError(
          `certificate ${existing.certNumber} already exists for this inspection`,
        );
      }

      // Snapshot fields from linked product + work order.
      let productName: string | null = null;
      let woPid: string | null = null;
      let deviceSerials: string[] = [];

      if (inspection.productId) {
        const { rows } = await client.query<{ name: string }>(
          `SELECT name FROM products
            WHERE id = $1 AND deleted_at IS NULL`,
          [inspection.productId],
        );
        productName = rows[0]?.name ?? null;
      }

      if (inspection.workOrderId) {
        const { rows } = await client.query<{
          pid: string;
          device_serials: string[];
          product_id: string;
          product_name: string | null;
        }>(
          `SELECT wo.pid,
                  wo.device_serials,
                  wo.product_id,
                  p.name AS product_name
             FROM work_orders wo
             LEFT JOIN products p ON p.id = wo.product_id AND p.deleted_at IS NULL
            WHERE wo.id = $1 AND wo.deleted_at IS NULL`,
          [inspection.workOrderId],
        );
        if (rows[0]) {
          woPid = rows[0].pid;
          deviceSerials = rows[0].device_serials ?? [];
          // Fall back to the WO's product if the inspection didn't set one.
          if (!productName) productName = rows[0].product_name;
        }
      }

      // Snapshot the signer's name.
      const signedBy = input.signedBy ?? user.id;
      let signedByName: string | null = input.signedByName ?? null;
      if (!signedByName && signedBy) {
        const { rows } = await client.query<{ name: string | null }>(
          `SELECT name FROM users WHERE id = $1`,
          [signedBy],
        );
        signedByName = rows[0]?.name ?? null;
      }

      const certNumber =
        input.certNumber ?? (await nextQcNumber(client, user.orgId, "QCC"));

      // ─── Phase 4 §4.2: hash-chain head + advisory lock ──────────────────
      // Take a per-org advisory lock keyed on the string
      // `qc_cert_chain:<orgId>` so two concurrent issuers cannot both read
      // the same chain head and emit forked children. Released at commit
      // (pg_advisory_xact_lock, not the session variant) so the lock
      // lifetime exactly matches this tx.
      //
      // `withRequest` runs this callback inside a transaction with RLS
      // already scoped to the requester's org, so the SELECT below sees
      // only this org's chain.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1::text))`,
        [`qc_cert_chain:${user.orgId}`],
      );
      // Order by issued_at, not created_at: `created_at DEFAULT now()`
      // captures the transaction-start time, but under the advisory lock
      // the true chain order is the order in which rows were INSERTED
      // post-lock-acquire. The service stamps issued_at explicitly with
      // `new Date()` *after* taking the lock (see below), so two
      // concurrent issuers will have issued_at values that monotonically
      // increase with lock acquire order. verifyQcCertChain uses the
      // same ordering.
      const {
        rows: [head],
      } = await client.query<{ signature_hash: string | null }>(
        `SELECT signature_hash
           FROM qc_certs
          WHERE org_id = $1 AND deleted_at IS NULL
          ORDER BY issued_at DESC, id DESC
          LIMIT 1`,
        [user.orgId],
      );

      // Canonicalise issuedAt in JS so the hash input and the stored column
      // cannot drift by sub-millisecond rounding (pg truncates to µs).
      const issuedAt = new Date();
      const notes = input.notes ?? null;
      const signatureHash = computeCertHash(head?.signature_hash ?? null, {
        certNumber,
        inspectionId: inspection.id,
        workOrderId: inspection.workOrderId,
        productId: inspection.productId,
        productName,
        woPid,
        deviceSerials,
        signedBy,
        signedByName,
        notes,
        issuedAt: issuedAt.toISOString(),
      });

      let cert: QcCert;
      try {
        cert = await certsRepo.create(client, user.orgId, {
          certNumber,
          inspectionId: inspection.id,
          workOrderId: inspection.workOrderId,
          productId: inspection.productId,
          productName,
          woPid,
          deviceSerials,
          signedBy,
          signedByName,
          signatureHash,
          issuedAt,
          notes,
        });
      } catch (err) {
        // 23505 on qc_certs_one_per_inspection or cert_number unique index.
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: string }).code === "23505"
        ) {
          throw new ConflictError(
            `certificate already exists or cert_number "${certNumber}" is taken`,
          );
        }
        throw err;
      }

      // Phase 4 §4.1 — emit qc_cert.issued so the worker-pdf pipeline can
      // render the certificate PDF and upload it to MinIO. Lives inside
      // the same withRequest txn as the INSERT above, so either both
      // commit or neither — no orphaned cert rows without a render job
      // and no render jobs for certs that never made it to disk.
      await enqueueOutbox(client, {
        aggregateType: "qc_cert",
        aggregateId: cert.id,
        eventType: "qc_cert.issued",
        payload: {
          orgId: cert.orgId,
          certId: cert.id,
          certNumber: cert.certNumber,
          inspectionId: cert.inspectionId,
          workOrderId: cert.workOrderId,
          productId: cert.productId,
        },
        idempotencyKey: `qc_cert.issued:${cert.id}`,
      });

      return cert;
    });
  }

  /**
   * Soft-delete ("recall") a certificate. Phase 2 only exposes a simple
   * soft-delete — no formal revocation workflow / revocation_reason column
   * yet. Phase 3 introduces proper recall with reason + audit.
   */
  async recall(req: FastifyRequest, id: string): Promise<void> {
    return withRequest(req, this.pool, async (client) => {
      const cur = await certsRepo.getById(client, id);
      if (!cur) throw new NotFoundError("qc certificate");
      const ok = await certsRepo.softDelete(client, id);
      if (!ok) throw new NotFoundError("qc certificate");
    });
  }
}
