# MinIO 3-node Cluster

**Owns**: object storage for PDFs (`instigenie-pdfs`), BMR attachments
(`instigenie-bmr`), audit-log cold archive (`instigenie-audit-archive`),
and pg_basebackup dumps (`instigenie-pg-backup`).

**Target topology** (ARCHITECTURE.md §11.5, "target scale" column):

- 3 × `(4 vCPU, 8 GB RAM, 4 TB)` nodes, each in a separate AZ.
- Erasure-coded EC:4+2 — survives 1 node loss with no read impact.
- HTTPS only. TLS termination at MinIO itself (not at the LB) so S3
  signature-v4 headers make it through untouched.
- Lifecycle policy: PDFs → GLACIER tier after 90 days; audit-archive
  objects → GLACIER after 30 days (they've already been in hot Postgres
  for ≥ 90 days by then).

## Provisioning a fresh cluster

### Preconditions

- Three hosts (`minio-a`, `minio-b`, `minio-c`) resolvable from each other.
- TLS cert + key for `*.minio.instigenie.internal` on each node at
  `/etc/minio/certs/public.crt` + `private.key`.
- A shared secret (root password) placed in Vault at
  `secret/minio/root` — see [secret-rotation.md](./secret-rotation.md).
- Firewall: port 9000 open node-to-node and from `api` / `worker` /
  `next-web` CIDRs. Port 9001 (console) open from ops bastion only.

### Install

1. On each node, install the MinIO binary at
   `/usr/local/bin/minio` (pin to a patch version — `minio version`
   output must be logged in the change ticket).
2. Create `/var/lib/minio/data1` through `data4` (4 drives per node).
   Each drive is a separate disk or LVM volume — DO NOT use a single
   filesystem split into 4 directories: erasure coding protection
   depends on physical drive independence.
3. Drop `/etc/systemd/system/minio.service`:

   ```ini
   [Unit]
   Description=MinIO
   After=network-online.target
   Wants=network-online.target

   [Service]
   Type=notify
   EnvironmentFile=/etc/default/minio
   ExecStart=/usr/local/bin/minio server \
     --certs-dir /etc/minio/certs \
     --console-address ":9001" \
     https://minio-a.instigenie.internal:9000/var/lib/minio/data{1...4} \
     https://minio-b.instigenie.internal:9000/var/lib/minio/data{1...4} \
     https://minio-c.instigenie.internal:9000/var/lib/minio/data{1...4}
   Restart=always
   LimitNOFILE=65536
   User=minio
   Group=minio

   [Install]
   WantedBy=multi-user.target
   ```

4. `/etc/default/minio`:

   ```
   MINIO_ROOT_USER=instigenie-ops
   MINIO_ROOT_PASSWORD=<from Vault>
   MINIO_SERVER_URL=https://minio.instigenie.internal:9000
   MINIO_PROMETHEUS_AUTH_TYPE=public
   ```

5. Start on all three hosts within ~2 minutes of each other:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now minio
   ```

6. Verify:

   ```bash
   # Should show 3 healthy nodes, 12 healthy drives.
   mc admin info minio/
   # Healing state — must be "Healing: no" within 60s of start.
   mc admin heal minio/ --recursive --dry-run
   ```

### Create required buckets + lifecycle

```bash
for b in instigenie-pdfs instigenie-bmr instigenie-audit-archive instigenie-pg-backup; do
  mc mb --with-lock minio/$b
  mc version enable minio/$b
done

# PDF lifecycle: move to GLACIER tier after 90 days.
cat > /tmp/pdfs-lifecycle.json <<'EOF'
{
  "Rules": [
    {
      "ID": "pdfs-to-glacier-90d",
      "Status": "Enabled",
      "Filter": { "Prefix": "pdf/" },
      "Transitions": [
        { "Days": 90, "StorageClass": "GLACIER" }
      ]
    }
  ]
}
EOF
mc ilm import minio/instigenie-pdfs < /tmp/pdfs-lifecycle.json

# Audit archive: GLACIER after 30 days (already 90d old in Postgres).
cat > /tmp/audit-lifecycle.json <<'EOF'
{
  "Rules": [
    {
      "ID": "audit-to-glacier-30d",
      "Status": "Enabled",
      "Filter": { "Prefix": "audit/" },
      "Transitions": [
        { "Days": 30, "StorageClass": "GLACIER" }
      ]
    }
  ]
}
EOF
mc ilm import minio/instigenie-audit-archive < /tmp/audit-lifecycle.json
```

Object lock on `instigenie-bmr` (21 CFR Part 11 immutability):

```bash
mc retention set --default compliance 7y minio/instigenie-bmr
```

## Node failure

### Symptoms

- Alert `erp_minio_node_down` fires (`up{job="minio"} == 0` for a node).
- Uploads / downloads from the remaining two nodes continue — EC:4+2
  tolerates 1 drive-pair loss.

### Procedure

1. **Confirm the node is actually down**. `curl -f
   https://minio-b.instigenie.internal:9000/minio/health/live` → 503 or
   timeout is definitive. A single transient 5xx is not.
2. Open a change ticket before touching the machine. If the outage
   exceeds 30 minutes you also need to file an incident report — the DR
   window narrows because a second node loss would take the cluster
   read-only.
3. Reboot attempt first:

   ```bash
   ssh minio-b 'sudo systemctl restart minio'
   # Wait for ready:
   until curl -skf https://minio-b.instigenie.internal:9000/minio/health/live; do sleep 5; done
   ```

4. If restart doesn't resolve it, reimage the host (IaC pipeline) and
   rejoin as the same hostname. MinIO auto-heals onto the fresh drives.
5. Watch `mc admin heal --recursive minio/` — progress should tick
   steadily. A full heal of a 4 TB node takes ~6 hours.

### Verification

- `mc admin info minio/` shows 3/3 nodes, 12/12 drives.
- No `mc admin heal` output remaining.
- `erp_minio_node_down` alert is resolved.

### Rollback

Rebooting / reimaging a single node is always safe — EC preserves the
data. The ONLY footgun is adding a fourth node: MinIO's distributed
deployment is pinned to the hostnames in the ExecStart line; never
expand a running 3-node cluster by editing that line. A cluster
expansion requires a fresh deployment + client-side mirror.

## Lifecycle policy verification

Monthly (pg_cron already monitors staleness, but you should eyeball):

```bash
mc ilm rule list minio/instigenie-pdfs
mc ilm rule list minio/instigenie-audit-archive
```

If a rule has disappeared (happens when someone manually reapplies a
bucket config), re-import from the JSON above.

## Related

- [audit-archive.md](./audit-archive.md) — the worker that writes into
  `instigenie-audit-archive`.
- [backup-dr.md](./backup-dr.md) — pg_basebackup writes into
  `instigenie-pg-backup`.
- [critical-alerts.md](./critical-alerts.md) §minio-node-down.
