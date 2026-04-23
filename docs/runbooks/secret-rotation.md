# Secret Rotation

**Owns**: the rotation schedule, zero-downtime rollout pattern, and
the authoritative list of every secret the ERP reads at runtime.
"No secrets in committed env files" is a Phase 4 §4.3 hard
requirement; this runbook is the mechanism that keeps the repo
audit-clean.

## Storage

Secrets live in **HashiCorp Vault** (cloud KMS-backed; which KMS
depends on the target environment — AWS KMS for the AWS region,
Google KMS for the GCP region). Vault's KV v2 engine is used so
every rotation creates a new version and the old value remains
recoverable for 48 hours in case a rollout needs to roll back
without re-provisioning.

Path convention: `secret/<env>/<component>/<field>`. Examples:

- `secret/prod/postgres/primary_password`
- `secret/prod/postgres/replica_password`
- `secret/prod/pgbouncer/auth_file`
- `secret/prod/redis-bull/password`
- `secret/prod/redis-cache/password`
- `secret/prod/minio/root`
- `secret/prod/minio/app_access_key` + `app_secret_key`
- `secret/prod/jwt/access_signing_key`  (RS256 private key)
- `secret/prod/jwt/refresh_signing_key`
- `secret/prod/alertmanager/pagerduty_key`
- `secret/prod/alertmanager/slack_webhook`
- `secret/prod/alertmanager/smtp_password`
- `secret/prod/integrations/nic_ewb_api_key`
- `secret/prod/integrations/gstn_api_key`
- `secret/prod/integrations/whatsapp_api_token`

Apps resolve secrets at boot via the `vault-agent` sidecar rendering
a template into `/etc/instigenie/secrets/*.env`. The app processes
read those files exactly once on startup — a secret change requires
a pod restart (that's by design; it's the rollout mechanism).

## Rotation cadence

| Secret | Cadence | Trigger |
|--------|---------|---------|
| PG passwords (primary, replica, pgbouncer auth file) | 90 days | Vault TTL expiry |
| Redis-BULL / Redis-CACHE passwords | 90 days | Vault TTL expiry |
| MinIO root | 180 days | Vault TTL expiry (rotating root needs a maintenance window) |
| MinIO app access/secret | 90 days | Vault TTL expiry |
| JWT signing keys | 180 days | Vault TTL expiry. Keys are RSA; rotate both `access` and `refresh` on the same window |
| PagerDuty / Slack / SMTP | 365 days | Third-party portal rotation |
| Integration API keys (NIC, GSTN, WhatsApp) | 365 days OR at vendor request | Third-party portal rotation |
| **Any secret suspected leaked** | IMMEDIATELY | Incident — follow §emergency below |

## Zero-downtime rotation pattern

The general shape — applicable to every secret except MinIO root
(which needs a maintenance window — see below):

1. **Write the new value at a new version** in Vault. Vault KV v2
   keeps the previous version accessible as `?version=N-1` — we use
   that for rollback.

   ```bash
   vault kv put secret/prod/postgres/primary_password value=<new>
   ```

2. **Grant the app the new credential**. For DB passwords this means
   creating the new password on the Postgres side first, so both old
   and new work during the rollover window.

   ```sql
   -- Primary DB. Grace window = until step 4.
   ALTER ROLE instigenie_app WITH PASSWORD '<new>';
   -- Postgres replaces the password atomically. Open connections keep
   -- working because auth happens at connect time, not per query.
   ```

   For PgBouncer's auth_file (userlist.txt), append a row with the
   new password instead of replacing — PgBouncer reloads the file
   and both old and new are valid until you remove the old entry.

3. **Roll the app deployment**. `kubectl rollout restart
   deployment/api` (and worker, listen-notify, etc.). vault-agent
   picks up the new Vault version; each new pod reads the new
   secret. The old pods keep running on the old secret until they
   drain.

4. **After the rollout completes** (~30 min for a fleet-wide roll,
   depending on surge/maxUnavailable), the old secret is no longer
   in use. Retire it:

   ```sql
   -- Revoke the old password by setting again (Postgres only stores
   -- one password per role; step 2's ALTER already did this, but
   -- make sure by setting to a throwaway value and then the new one
   -- once you're sure).
   -- Actually: ALTER ROLE accepts only one password at a time. The
   -- pattern relies on both *pool* credentials working across the
   -- brief rollout, not two simultaneous DB passwords. For PG this
   -- means: rotate during a window where connections cycle within
   -- ~5 minutes (idle_in_transaction kicks in anyway).
   ```

   For PgBouncer: remove the old userlist entry, `RELOAD` pgbouncer
   on both poolers.

5. **Verify**:

   - `kubectl logs -l app=api --since=5m | grep -i 'auth' | grep -v '200'`
     — no auth failures.
   - The Prometheus gauge `erp_pg_pool_connection_errors_total` is
     flat.
   - Close the change ticket with the Vault version number of the
     new secret (for audit).

### Rollback

If the rollout is halfway and new pods are failing to authenticate:

```bash
# Restore the previous version in Vault.
vault kv rollback -version=<prev> secret/prod/postgres/primary_password
# Re-roll.
kubectl rollout restart deployment/api
```

The old Postgres password needs to still be in place — which is why
step 2 keeps both valid during the window, and step 4 happens LAST.

## Per-secret notes

### PG superuser / primary_password

The `ALTER ROLE` above rotates the `instigenie_app` (NOBYPASSRLS)
login role. The superuser (`instigenie` / `postgres`) is a separate
role and is NOT rotated on the normal cadence — it's only used for
migrations, and its password is rotated on schema release (which
happens less often than 90 days). Document both cadences separately
in the Vault metadata.

### MinIO root credential

Rotating the MinIO root user **requires a rolling restart of every
MinIO node**. The `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` env vars
are read only at process start. Schedule a maintenance window (EC:4+2
tolerates 1 node loss, so roll nodes one at a time — during each
node's restart the cluster is at 2/3 with no read impact, but if a
second node crashed during the window you'd be in trouble).

Never rotate MinIO root during the monthly lifecycle-policy verify
(see [minio-3-node-cluster.md](./minio-3-node-cluster.md)) — that
script runs `mc` with root credentials and will fail.

### JWT signing keys (access + refresh)

These are RSA keys, not passwords — rotation is not a simple
string swap. Procedure:

1. Generate new key pair: `openssl genrsa -out new.pem 2048` and
   derive the public key.
2. Publish the new public key to the JWKS endpoint FIRST (both old
   and new keys exposed side-by-side). The verifier (API) accepts
   tokens signed by either.
3. Wait one refresh cycle (default 15 minutes — the access-token
   TTL) so every live token is cycled.
4. Swap the signing key in Vault. New pods sign with new key;
   verifiers still accept both.
5. After 24 hours (the refresh-token TTL), remove the old public
   key from JWKS. Any surviving old refresh token will now fail —
   the client re-authenticates.

Refresh-token revocation rows in `auth.refresh_tokens` are
unaffected — they're keyed on JTI, not on the signing key.

### PagerDuty service key

Rotate in the PagerDuty portal, write the new value to Vault,
restart Alertmanager:

```bash
kubectl rollout restart deployment/alertmanager
# Verify with a canary.
amtool alert add alertname=deploy_canary severity=critical
# Expect a page within 2 minutes; resolve it.
```

If the canary does NOT page, the old key is still in the rendered
env file — check vault-agent logs for a render failure.

### Integration API keys (NIC EWB, GSTN, WhatsApp)

Rotate coordinated with the vendor — all three have circuit breakers
wrapping them (ARCHITECTURE.md §3.4), so a brief auth failure opens
the circuit and falls back to the manual queue. That's graceful but
still page-worthy; schedule during business hours so Finance can
clear the manual backlog.

## Emergency rotation (suspected leak)

1. **Now** — write a new value to Vault.
2. **Now** — revoke the old credential on the source system. For PG,
   this means `ALTER ROLE … PASSWORD '<new>'` (no grace window).
   Live connections will continue on their existing auth'd session
   until the next reconnect, so 5xx will spike for ~5 minutes as
   pool connections cycle.
3. Roll the deployment. Expect a noisy 5 minutes; accept it — the
   alternative is the leaked credential remaining valid.
4. File a security incident. The leaked value must be invalidated at
   EVERY system it's used by — if `JWT_ACCESS_SIGNING_KEY` leaked,
   also rotate refresh (both are compromised). Audit log searches:

   ```bash
   # Any actor using the suspect credential window.
   psql -c "SELECT user_id, action, changed_at FROM audit.log
            WHERE changed_at > '<suspected-leak-window-start>'
            ORDER BY changed_at DESC LIMIT 200"
   ```

5. Postmortem within 48 hours. How did the secret leave the safe
   perimeter? Is there a committed-file path that needs to be
   rejected in CI?

## Rollback (standard rotation)

See per-step §rollback under "Zero-downtime rotation pattern". The
general invariant: Vault KV v2 retains the previous version for 48
hours, so a standard rotation can be rolled back by version number
without regenerating the secret.

## Related

- [pgbouncer-replica.md](./pgbouncer-replica.md) — pool auth-file is
  managed here.
- [alertmanager-routing.md](./alertmanager-routing.md) — PagerDuty /
  Slack / SMTP secrets consumed by Alertmanager.
- [minio-3-node-cluster.md](./minio-3-node-cluster.md) — MinIO root
  rotation is a maintenance-window operation.
- ARCHITECTURE.md §4.3 "Security: secret rotation via Vault or cloud
  KMS; no secrets in committed env files."
