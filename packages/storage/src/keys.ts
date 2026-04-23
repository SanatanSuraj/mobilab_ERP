/**
 * Centralised key conventions for the object store.
 *
 * Keeping every `pdf/...` path in one file means Phase 4.3 lifecycle
 * policies (e.g. "move pdf/qc-certs/* older than 90d to cold tier")
 * target one prefix that's guaranteed-stable across callers.
 */

/** PDF prefix for QC certificates. One object per (org, cert). */
export function buildQcCertKey(orgId: string, certId: string): string {
  return `pdf/qc-certs/${orgId}/${certId}.pdf`;
}
