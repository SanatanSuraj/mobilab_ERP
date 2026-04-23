# PgBouncer Replica + Leader-Elected Listener

**Owns**: eliminating the two documented SPOFs at target scale
(ARCHITECTURE.md §11.1, §4.3):

1. The single PgBouncer — `api` / `worker` / `next-web` all connect
   through it in `transaction` pool mode. One pod restart kills every
   live connection.
2. The single `listen-notify` process — while K8s restarts it within
   5 seconds and the 30-second poller is the safety net, a stuck-but-
   not-crashed listener can hold the LISTEN connection open while
   failing to drain. A leader-elected second process lets the peer
   take over when the heartbeat lapses.

## Target topology

```
             ┌─ pgbouncer-a (leader)  port 6432
  app pods ──┤
             └─ pgbouncer-b (warm)   port 6432

  postgres-primary :5432  ←  both pgbouncers ; listen-notify (direct)
  postgres-replica :5432  ←  both pgbouncers read-only pool

  listen-notify-a (LEADER, holds Redis lock `erp:listen-notify:leader`)
  listen-notify-b (standby, renews lock on take-over)
```

Both PgBouncer instances run **identical** config and are reached
through an LB with session affinity OFF — PgBouncer-internal state is
per-client-session, so pinning to one pod is incorrect once we have
two.

Only one `listen-notify` process holds the `LISTEN` subscription at a
time. The rule from ARCHITECTURE.md §8 — "this is the ONLY process
that should hold a LISTEN connection in production" — still holds.
The second process exists to take over, not to run concurrently.

## Provisioning the second PgBouncer

### Preconditions

- `pgbouncer-a` already up and draining normally.
- `postgres-primary` and `postgres-replica` reachable from the new
  host.
- Identical `/etc/pgbouncer/pgbouncer.ini` (pool mode = `transaction`,
  auth file mounted from the same secret).

### Install

1. Provision `pgbouncer-b` from the IaC module (same image, same env,
   same version tag as `-a`). Pin to a specific version — a mismatched
   pair is the one config you do NOT want to debug at 3 a.m.
2. Port 6432 open from every app CIDR to `pgbouncer-b`, and from
   both pgbouncers to postgres-primary:5432 + postgres-replica:5432.
3. Run a quick parity probe from an ops box:

   ```bash
   psql "postgres://instigenie_app@pgbouncer-a:6432/instigenie" -c 'show version'
   psql "postgres://instigenie_app@pgbouncer-b:6432/instigenie" -c 'show version'
   # Both must return the same server + pooler version.
   ```

4. Add `pgbouncer-b` as a second target on the internal LB. Use a
   plain round-robin. **Do NOT enable session affinity** — PgBouncer's
   pool state is per-TCP-connection, not per-session cookie; affinity
   only re-creates the SPOF inside the LB.
5. Watch for 60 seconds:

   ```bash
   # On each pgbouncer host.
   psql -h localhost -p 6432 -U instigenie pgbouncer -c 'show pools'
   # Each pool should have non-zero cl_active after a minute of live traffic.
   ```

### Verification

- `up{job="pgbouncer",instance="pgbouncer-b"}` flips to 1 in Prometheus.
- `erp_api_error_rate_5xx` does NOT rise during the roll-in.
- Kill `pgbouncer-a` (stop the systemd unit, don't reboot the host)
  and observe: the LB drops it within the configured health-check
  window; app pods see transient connection errors for ≤ 10 seconds,
  then recover. Bring `-a` back before finishing the verification.

### Rollback

Drop the LB target for `pgbouncer-b`, stop the systemd unit. No data
loss possible — PgBouncer holds zero durable state.

## Deploying the leader-elected listener

### Preconditions

- Redis-BULL cluster running (the leader lock lives in the BullMQ
  Redis, not Redis-CACHE; Redis-BULL has `noeviction` so the lock key
  cannot be evicted under pressure).
- Both `listen-notify-a` and `listen-notify-b` built from the same
  image tag.

### Leader lock contract

Both processes race for `SET erp:listen-notify:leader <hostname> NX
PX 30000`. The winner:

- Opens the PG direct connection, `LISTEN outbox_event`.
- Every 10 seconds, `SET erp:listen-notify:leader <hostname> XX
  PX 30000` (refreshes TTL; XX means only update if key still holds
  *our* hostname — we noticed we lost leadership if it fails).
- On SIGTERM, `DEL erp:listen-notify:leader` **only if the current
  value matches our hostname** (Lua `if GET == ARGV then DEL` — never
  unconditional, or we'd delete the peer's lock on a messy shutdown).

The standby:

- Every 5 seconds, attempts the same `SET … NX PX 30000`. A success
  means the leader's heartbeat lapsed — it promotes itself, opens
  the LISTEN, and the ex-leader (if it's still alive but partitioned)
  will see its `SET … XX` fail and exit.

Expected take-over window: 30–35 seconds (one missed heartbeat +
standby's 5-second poll). That matches the pre-existing 30-second
drain poller's SLO, so no new failure mode.

### Deploy

1. Roll out `listen-notify-b` to `replicas: 1` alongside the existing
   pod. Both pods run identical commands; the lock contract decides
   who does real work.
2. Confirm exactly one pod is enqueueing:

   ```bash
   # The leader logs "listen-notify: started as LEADER"
   # The standby logs "listen-notify: started as STANDBY"
   kubectl logs -l app=listen-notify --tail=20
   ```

3. `erp_listen_notify_leader` gauge metric (1 on leader, 0 on
   standby) must sum to 1 across both pods at steady state.

### Take-over drill (must run against staging to close Gate 21)

1. On the leader, `kubectl exec … -- kill -STOP 1` to simulate a
   stuck process (SIGSTOP cannot be trapped — it's the cleanest way
   to force a missed heartbeat without a crash).
2. Watch the standby's log — it should promote within ~35 seconds.
3. Insert a test outbox row; confirm it's drained by the new leader
   within 3 seconds.
4. `kill -CONT 1` on the frozen pod; it wakes, observes the lock no
   longer belongs to it, exits with code 1 (supervisor restarts
   it as the new standby).

### Verification

- `erp_listen_notify_leader` sum = 1.
- `erp_outbox_pending_age_max_seconds` holds below 30s during the
  drill.
- No duplicate deliveries in `bullmq:outbox-dispatch:*` (BullMQ's
  `jobId` deduplication catches these even if both processes did
  enqueue — but they shouldn't).

### Rollback

Scale `listen-notify-b` to 0. The A pod retains leadership (it's
already holding the lock) and nothing else changes.

## Failure modes

### Both pgbouncers wedged

Rare — the shared failure domains are (a) bad config pushed to both,
(b) postgres-primary itself down.

- (a): the rollback is `git revert` + re-deploy. Until the revert is
  live, apps will fail to connect and 5xx rate alerts fire. Accept
  it — don't hand-patch a single pgbouncer out of band, or you'll
  have mismatched pairs.
- (b): see [backup-dr.md](./backup-dr.md) — this is a DB-level
  incident, not a pooler-level one.

### Split-brain leader

Both listener pods believe they're leader for > 5 seconds.

- Causes: Redis-BULL network partition that isolated the old leader
  long enough for the lock TTL to expire, but the old leader's
  clock made it think < 30s had passed.
- Detection: `sum(erp_listen_notify_leader) > 1` for > 30s fires
  `erp_listen_notify_split_brain`.
- Mitigation: kill the pod with the older `startedAt` timestamp
  (visible in `/healthz` JSON). BullMQ's idempotent `jobId` for
  outbox events means no double-delivery even during the window; the
  split-brain alert is still CRITICAL because it indicates Redis-BULL
  is unhealthy and both listeners will soon fail their `SET … XX`
  refresh.

### Leader holds the lock but stopped draining

The heartbeat keeps refreshing (the Redis loop is alive) but the
PG `LISTEN` connection is wedged. This is why the 30-second poller
exists independently: `drainOutbox()` runs on a timer AND on each
notify. If the leader is refreshing Redis but the poller hasn't
drained, `erp_outbox_pending_age_max_seconds > 120` will fire
(§10.3 — HIGH severity). That alert's runbook (critical-alerts.md)
tells you to kill the leader pod; the standby takes over cleanly.

## Related

- [critical-alerts.md](./critical-alerts.md) §outbox-pending-age,
  §outbox-dead-letter.
- [secret-rotation.md](./secret-rotation.md) — the PgBouncer auth
  file is a rotation target.
- ARCHITECTURE.md §11.3 — startup order (pgbouncer boots after
  postgres, before workers).
- ARCHITECTURE.md §11.4 — failure & resilience matrix: "PgBouncer
  down → 2 replicas eliminate SPOF".
