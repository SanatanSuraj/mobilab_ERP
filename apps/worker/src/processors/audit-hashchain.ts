/**
 * audit-hashchain processor — ARCHITECTURE.md §4.2.
 *
 * Daily (BullMQ scheduler, 02:00 local via upsertJobScheduler — see
 * §6.5 "No cron, No setInterval") sweep that walks every org's qc_certs
 * hash chain with `verifyQcCertChain` and persists the result into
 * `qc_cert_chain_audit_runs`. Any broken chain:
 *
 *   1. lands in the `breaks` jsonb array of the run row with enough
 *      context (orgId, certId, certNumber, expected, actual,
 *      verifiedCount, totalCount) for compliance triage;
 *   2. bumps `erp_audit_chain_break_total{org_id="…"}` so the §10.3
 *      CRITICAL alert fires;
 *   3. does NOT abort the sweep — we want the FULL picture per run,
 *      not just the first bad org.
 *
 * Contract:
 *   Job payload = AuditHashchainJob (may carry { trigger: "MANUAL" |
 *                 "SCHEDULED" } for debugging / re-runs).
 *   Returns   = { runId, orgsTotal, orgsOk, orgsBroken }.
 *   Retries   = default (5× exponential backoff); the run row ID is
 *               deterministic per day so retry writes land on the same
 *               row rather than producing duplicates.
 *
 * Deliberate non-behaviour:
 *   - No outbox event on chain break. The §10.3 alert pathway is the
 *     canonical notification; duplicating via outbox would double-page.
 *   - No auto-remediation. A broken chain indicates tampering or a
 *     code bug — human intervention (compliance lead) is required.
 */

import type { Processor } from "bullmq";
import type pg from "pg";
import type { Logger } from "@instigenie/observability";
import {
  auditChainBreakTotal,
  auditChainRunDurationMs,
  jobsProcessedTotal,
} from "@instigenie/observability";
import { withOrg } from "@instigenie/db";
import {
  verifyQcCertChain,
  type VerifyChainResult,
} from "@instigenie/api/qc/cert-hash";

export type AuditHashchainTrigger = "SCHEDULED" | "MANUAL";

export interface AuditHashchainJob {
  trigger?: AuditHashchainTrigger;
}

export interface AuditHashchainDeps {
  pool: pg.Pool;
  log: Logger;
}

export interface AuditHashchainResult {
  runId: string;
  orgsTotal: number;
  orgsOk: number;
  orgsBroken: number;
}

/**
 * One element of the `breaks` jsonb array. Mirrors
 * VerifyChainResult.firstBroken plus orgId + counts so the ledger is
 * self-describing without a join back to qc_certs.
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

/**
 * Run one sweep synchronously against the given pool. Exported so Gate
 * 41 can drive it directly without standing up a BullMQ Worker.
 */
export async function runAuditHashchain(
  deps: AuditHashchainDeps,
  trigger: AuditHashchainTrigger = "SCHEDULED",
): Promise<AuditHashchainResult> {
  const startedAtTimer = auditChainRunDurationMs.startTimer();
  const startedAt = new Date();

  // 1. Open a RUNNING row. Done via the pool (no org scope, no RLS).
  const {
    rows: [runRow],
  } = await deps.pool.query<{ id: string }>(
    `INSERT INTO qc_cert_chain_audit_runs (trigger, status, started_at)
     VALUES ($1, 'RUNNING', $2)
     RETURNING id`,
    [trigger, startedAt],
  );
  const runId = runRow!.id;

  // 2. Enumerate orgs with at least one non-deleted cert. Orgs with
  //    nothing to verify simply don't contribute to the sweep — this
  //    keeps the count honest instead of inflating orgs_total with
  //    brand-new tenants that haven't issued a cert yet.
  //
  //    Cross-tenant reads are gated by a SECURITY DEFINER function
  //    (ops/sql/init/15-audit-hashchain.sql) because the worker pool
  //    connects as the NOBYPASSRLS app role — a plain `SELECT DISTINCT
  //    org_id FROM qc_certs` from this pool returns zero rows.
  const { rows: orgs } = await deps.pool.query<{ org_id: string }>(
    `SELECT qc_audit_list_orgs_with_certs() AS org_id`,
  );

  const breaks: BreakEntry[] = [];
  let orgsOk = 0;
  let orgsBroken = 0;

  try {
    for (const { org_id: orgId } of orgs) {
      let result: VerifyChainResult;
      try {
        result = await withOrg(deps.pool, orgId, async (client) =>
          verifyQcCertChain(client, orgId),
        );
      } catch (err) {
        // Per-org crash: treat as "broken" with a synthetic entry so
        // ops sees it. Keep sweeping — one poisoned org shouldn't hide
        // the state of every other org.
        const msg = err instanceof Error ? err.message : String(err);
        deps.log.error(
          { err, orgId },
          "audit-hashchain: verify threw for org — recording as broken",
        );
        breaks.push({
          orgId,
          certId: "00000000-0000-0000-0000-000000000000",
          certNumber: `<verify-threw: ${msg.slice(0, 64)}>`,
          expected: "",
          actual: null,
          verifiedCount: 0,
          totalCount: 0,
        });
        orgsBroken += 1;
        auditChainBreakTotal.inc({ org_id: orgId });
        continue;
      }

      if (result.ok) {
        orgsOk += 1;
        continue;
      }
      // ok=false is guaranteed to carry firstBroken — see cert-hash.ts
      const fb = result.firstBroken!;
      breaks.push({
        orgId,
        certId: fb.id,
        certNumber: fb.certNumber,
        expected: fb.expected,
        actual: fb.actual,
        verifiedCount: result.verifiedCount,
        totalCount: result.totalCount,
      });
      orgsBroken += 1;
      auditChainBreakTotal.inc({ org_id: orgId });
      deps.log.error(
        {
          orgId,
          certId: fb.id,
          certNumber: fb.certNumber,
          verifiedCount: result.verifiedCount,
          totalCount: result.totalCount,
        },
        "audit-hashchain: CHAIN BREAK DETECTED — compliance incident",
      );
    }

    const completedAt = new Date();
    await deps.pool.query(
      `UPDATE qc_cert_chain_audit_runs
         SET status       = 'COMPLETED',
             completed_at = $2,
             orgs_total   = $3,
             orgs_ok      = $4,
             orgs_broken  = $5,
             breaks       = $6::jsonb
       WHERE id = $1`,
      [
        runId,
        completedAt,
        orgs.length,
        orgsOk,
        orgsBroken,
        JSON.stringify(breaks),
      ],
    );

    startedAtTimer();
    deps.log.info(
      {
        runId,
        trigger,
        orgsTotal: orgs.length,
        orgsOk,
        orgsBroken,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
      orgsBroken > 0
        ? "audit-hashchain: COMPLETED with breaks"
        : "audit-hashchain: COMPLETED clean",
    );

    return { runId, orgsTotal: orgs.length, orgsOk, orgsBroken };
  } catch (err) {
    // Infrastructure-level crash (pool, network, migration drift etc).
    // Mark the run as FAILED and re-throw so BullMQ retries on the
    // default schedule. The run row is not deleted — auditors want
    // to see the fingerprint of the failure, not have it silently
    // disappear.
    const error = err instanceof Error ? err : new Error(String(err));
    await deps.pool
      .query(
        `UPDATE qc_cert_chain_audit_runs
           SET status = 'FAILED',
               completed_at = now(),
               error = $2
         WHERE id = $1`,
        [runId, error.message],
      )
      .catch(() => undefined);
    startedAtTimer();
    throw error;
  }
}

/**
 * BullMQ processor adapter. Thin shell around {@link runAuditHashchain}
 * so the pure function stays trivially testable.
 */
export function createAuditHashchainProcessor(
  deps: AuditHashchainDeps,
): Processor<AuditHashchainJob, AuditHashchainResult> {
  return async (job) => {
    const trigger: AuditHashchainTrigger = job.data?.trigger ?? "SCHEDULED";
    try {
      const result = await runAuditHashchain(deps, trigger);
      jobsProcessedTotal.inc({ queue: "audit-hashchain", status: "completed" });
      return result;
    } catch (err) {
      jobsProcessedTotal.inc({ queue: "audit-hashchain", status: "failed" });
      throw err;
    }
  };
}
