# Alertmanager Routing

**Owns**: the one configuration surface that determines whether a
page actually reaches on-call at 3 a.m. Every alert listed in
ARCHITECTURE.md §10.3 has a routing entry in here.

**Routing contract** (ARCHITECTURE.md §10.1):

| Severity | Channel | Expected response |
|----------|---------|-------------------|
| CRITICAL | PagerDuty (primary on-call) | 5 min ack, 15 min start |
| HIGH     | #oncall-alerts (Slack)      | next business day |
| MEDIUM   | oncall-digest@instigenie.io | weekly review |

CRITICAL alerts additionally post to `#oncall-alerts` so the rest of
the team has visibility. They do NOT page secondary on-call unless
the primary un-acks within 15 minutes — that escalation is a
PagerDuty policy, not an Alertmanager config.

## Alertmanager config

Deployed as `alertmanager.yml` in the Prometheus compose profile
alongside `prometheus.yml`. The file lives in
`ops/compose/alertmanager.yml` once created; dev compose currently
skips it (no PagerDuty in dev).

```yaml
global:
  # 30 minutes between repeated pages for the same unresolved alert.
  # Short enough that a missed ack gets re-paged; long enough that a
  # known-but-working-on-it alert doesn't spam.
  resolve_timeout: 5m

route:
  group_by: [alertname, cluster]
  group_wait: 30s        # batch bursts of related alerts before paging
  group_interval: 5m
  repeat_interval: 30m
  receiver: slack-oncall # default if nothing else matches — HIGH-ish

  routes:
    - matchers: [severity="critical"]
      receiver: pagerduty-critical
      continue: true            # also post to Slack
    - matchers: [severity="critical"]
      receiver: slack-oncall    # mirror to Slack

    - matchers: [severity="high"]
      receiver: slack-oncall

    - matchers: [severity="medium"]
      receiver: email-digest
      group_wait: 1h            # medium batches for an hour
      repeat_interval: 24h

inhibit_rules:
  # If postgres-primary is down, suppress the replica-lag alert —
  # it's noise on top of the real incident.
  - source_matchers: [alertname="erp_pg_primary_down"]
    target_matchers: [alertname="erp_pg_replication_lag_seconds"]
    equal: [cluster]

receivers:
  - name: pagerduty-critical
    pagerduty_configs:
      - service_key_file: /etc/alertmanager/secrets/pagerduty_key
        severity: "{{ .CommonLabels.severity }}"
        description: "{{ .CommonAnnotations.summary }}"
        details:
          runbook: "{{ .CommonAnnotations.runbook_url }}"
          trace_id: "{{ .CommonLabels.trace_id }}"

  - name: slack-oncall
    slack_configs:
      - api_url_file: /etc/alertmanager/secrets/slack_webhook
        channel: "#oncall-alerts"
        title: "[{{ .CommonLabels.severity | toUpper }}] {{ .CommonLabels.alertname }}"
        text: |
          *Summary:* {{ .CommonAnnotations.summary }}
          *Runbook:* {{ .CommonAnnotations.runbook_url }}
          *Firing:* {{ len .Alerts.Firing }}  *Resolved:* {{ len .Alerts.Resolved }}

  - name: email-digest
    email_configs:
      - to: oncall-digest@instigenie.io
        from: alertmanager@instigenie.io
        smarthost: smtp.internal:587
        require_tls: true
        auth_username: alertmanager
        auth_password_file: /etc/alertmanager/secrets/smtp_password
```

## Severity labels — authoritative mapping

Every alert rule file in `ops/prometheus/rules/*.yml` must carry a
`severity` label. The mapping below is the authoritative one used
by the config above:

| Rule (alertname) | severity | Runbook section |
|------------------|----------|-----------------|
| `erp_outbox_pending_age_max_seconds` | high | critical-alerts.md §outbox-pending-age |
| `erp_outbox_dead_letter_count` | critical | critical-alerts.md §outbox-dead-letter |
| `erp_stock_drift_detected` | critical | critical-alerts.md §stock-drift |
| `erp_audit_chain_break` | critical | critical-alerts.md §audit-chain-break |
| `erp_pg_replication_lag_seconds` | high | critical-alerts.md §pg-replica-lag |
| `erp_bullmq_queue_depth{queue="critical"}` | critical | critical-alerts.md §bullmq-critical-backlog |
| `erp_bullmq_stalled_count_total` | high | critical-alerts.md §bullmq-stalled |
| `erp_bull_redis_memory_used_pct` | critical | critical-alerts.md §redis-bull-memory |
| `erp_api_p99_latency_ms` | high | critical-alerts.md §api-p99 |
| `erp_api_error_rate_5xx` | high | critical-alerts.md §api-5xx |
| `erp_backup_last_success_hours` | critical | critical-alerts.md §backup-missed |
| `erp_minio_node_down` | critical | minio-3-node-cluster.md §node-failure |
| `erp_listen_notify_leader` sum ≠ 1 | critical | pgbouncer-replica.md §split-brain |
| `erp_audit_chain_break_watchdog` | critical | critical-alerts.md §audit-chain-break (watchdog variant) |

Two tripwires you must NOT relax without compliance sign-off:

- `erp_audit_chain_break` — CRITICAL, no `repeat_interval` override.
  A chain break is a 21 CFR Part 11 incident; spamming the page is
  correct.
- `erp_stock_drift_detected` — CRITICAL. The runbook says **STOP
  TRADING** for a reason.

## Deploy / change procedure

1. Edit `ops/compose/alertmanager.yml` (or whichever repo holds the
   prod copy).
2. `amtool check-config ops/compose/alertmanager.yml` locally. Refuses
   to parse = refuses to deploy; no lint warnings either.
3. `amtool config routes test --config.file=ops/compose/alertmanager.yml severity=critical` — print the matching receiver for each severity label. Verify CRITICAL hits both pagerduty-critical and slack-oncall.
4. Open a change ticket. For CRITICAL routing changes, link to a
   dry-run page: fire a synthetic alert through the Prometheus
   `/-/reload` API and confirm PagerDuty received it.
5. Deploy + reload:

   ```bash
   # IRREVERSIBLE if reload fails mid-parse; always amtool check first.
   kubectl rollout restart deployment/alertmanager
   ```

6. Confirm with `amtool alert add alertname=deploy_canary severity=critical` — expect a page within 2 minutes; resolve it by hand (`amtool alert add alertname=deploy_canary severity=critical --annotation=status=resolved`).

## On-call rotation knobs

- PagerDuty schedules live in PagerDuty, NOT in this repo. The only
  Alertmanager knob is `service_key_file` → which PagerDuty service
  the CRITICAL route targets. Changing on-call members is a
  PagerDuty operation.
- Silencing a known-firing alert during planned maintenance:

  ```bash
  # Silence stock-drift for 30 min during a batch reconciliation run.
  amtool silence add alertname=erp_stock_drift_detected \
    --duration=30m --comment="reconcile-2026-04-22 planned"
  ```

  Silences must always have a comment pointing at an incident or
  change ticket. A silence without a comment is a postmortem finding.

## Rollback

Revert the YAML change + `kubectl rollout restart deployment/alertmanager`.
Alertmanager reloads its state from disk; no data loss. Pending
pages and silences persist across reload.

**Do NOT** `kubectl delete pod alertmanager` during a page storm —
you'll drop the in-memory dedup state and every firing alert will
re-page. Use `rollout restart`, which respects the volume-claim
silence log.

## Related

- [critical-alerts.md](./critical-alerts.md) — one procedure per
  alertname listed above.
- [secret-rotation.md](./secret-rotation.md) — pagerduty_key,
  slack_webhook, smtp_password are all rotation targets.
- ARCHITECTURE.md §10.3 — the source-of-truth alert table.
