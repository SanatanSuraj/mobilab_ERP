# Instigenie ERP

Multi-tenant SaaS ERP platform. **Instigenie Diagnostic Instruments Pvt. Ltd.** is the pilot tenant; the platform is built to host many tenants with the same domain shape.

> **`ARCHITECTURE.md` is the source of truth.** This README is the entry point — read it to get oriented, then read `ARCHITECTURE.md` before you write code.

---

## Modules

CRM · Production · Inventory · Procurement · QC · Finance · Auth/RBAC · Notifications · Audit · Customer Portal · Vendor Admin

Compliance posture: **ISO 13485**, **21 CFR Part 11**, **GST / NIC E-Way Bill** — enforced at the database layer, not at application convenience.

## Stack

| Layer       | Tech                                              |
|-------------|---------------------------------------------------|
| Frontend    | Next.js 16 (webpack) · React 19 · TanStack Query · Tailwind v4 · shadcn/ui |
| API         | Fastify 5 · `pg` (raw SQL) · Drizzle (schema only) · Zod · `jose` (JWT) |
| Workers     | BullMQ 5 · `LISTEN/NOTIFY` outbox drain · `@react-pdf/renderer` |
| Data        | PostgreSQL 16 (RLS) · Redis 7 (split: bull + cache) · MinIO / S3 |
| Runtime     | Node 22 LTS · pnpm 9 workspaces · Turborepo       |
| Deploy      | Docker Compose · Caddy (TLS) · target: Hostinger KVM (single-box) |

## Monorepo layout

```
apps/
  api/             Fastify HTTP server (REST, JWT auth, RLS-enforced)
  web/             Next.js 16 dashboard (tenant + vendor admin + portal)
  worker/          BullMQ workers (PDF, email, audit chain, scheduled)
  listen-notify/   Dedicated PG listener — outbox drain → BullMQ
packages/
  contracts/       Shared Zod schemas + types (frontend ↔ backend)
  db/              pg pool, Drizzle schema, withOrg, outbox, type parser
  cache/           Redis read-through cache wrappers
  queue/           BullMQ queue/worker factories
  money/           decimal.js wrappers — all ledger math
  errors/          AppError hierarchy + RFC 7807 problem+json
  observability/   Pino + OpenTelemetry + Prometheus
  config/          shared tsconfig + ESLint configs
  storage/         MinIO/S3 client + key builders
  resilience/      retry + circuit breaker
  qc/              QC certificate hash-chain helpers
  quotas/          plan / feature-flag / quota enforcement
  vendor-admin/    vendor-side service layer
ops/
  compose/         dev + prod Docker Compose files
  docker/          per-app Dockerfiles
  sql/             init/ · triggers/ · rls/ · seed/ · migrations/
  postgres/        custom postgres:16-pgcron Dockerfile
  caddy/           reverse-proxy config
  scripts/         deploy / validate / migrate scripts
  k6/              load tests (gate-17 sustained load)
  dr/              promote-replica + restore drill
docs/
  adr/             architectural decision records
  runbooks/        operational playbooks (backup, alerts, DR drills)
```

## Quickstart

**Prereqs:** Docker, Node 22, pnpm 9.

```bash
# 1. Install dependencies
pnpm install

# 2. Boot infrastructure (Postgres + 2 Redis + MinIO + observability)
pnpm infra:up

# 3. Apply DB schema + seeds (extensions, schemas, RLS, triggers, seeds)
pnpm db:migrate

# 4. Run all four apps in watch mode (api, web, worker, listen-notify)
pnpm dev
```

Web is on `http://localhost:3000`, API on `http://localhost:4001`.

### Common scripts

```bash
pnpm dev              # turbo run dev across all apps
pnpm build            # production build
pnpm lint             # eslint across workspaces
pnpm typecheck        # tsc --noEmit across workspaces
pnpm test             # vitest across workspaces
pnpm test:gates       # invariant / gate tests (run in CI on every PR)

pnpm infra:up         # start docker dev stack
pnpm infra:down       # stop dev stack (volumes retained)
pnpm infra:logs       # tail container logs
pnpm infra:reset      # nuke volumes — fresh DB next boot

pnpm db:migrate       # apply ops/sql/init/*.sql to running DB
pnpm db:seed          # seed only (skip schema)
pnpm migrate:status   # drizzle-kit + custom CLI: migration status
pnpm migrate:dev      # run forward migrations (dev)
pnpm migrate:prod     # run forward migrations (prod, --confirm)
```

## Multi-tenancy & security

Tenant isolation is enforced at **two layers**:

1. **Postgres RLS** — every tenant table has `org_id` and a policy gated by `current_setting('app.current_org')`. Set per-transaction by the helpers below.
2. **Application `org_id` filters** — every SQL query passes `org_id` explicitly. Defence in depth.

The API connects as **`instigenie_app`** (`NOSUPERUSER NOBYPASSRLS`). The bootstrap policy in `apps/api/src/bootstrap-policy.ts` refuses to start if the connected role can bypass RLS — non-negotiable: a superuser connection silently leaks cross-tenant data.

The **vendor admin** uses a separate role **`instigenie_vendor`** (`BYPASSRLS`) on the `vendor` schema only. Connection is routed via `VENDOR_DATABASE_URL`.

JWT (via **`jose`**, HS256) with four distinct audiences:

- `instigenie-internal` — tenant employees
- `instigenie-portal` — customer portal
- `instigenie-vendor` — Instigenie staff console
- `instigenie-tenant-picker` — short-lived (5 min) for the multi-org login flow

Three transaction wrappers set RLS GUCs:

| Helper | GUCs set |
|--------|----------|
| `withOrg(pool, orgId, fn)` | `app.current_org` |
| `withRequest(req, pool, fn)` | `app.current_org`, `app.current_user`, `app.current_trace_id` |
| `withPortalRequest(req, pool, fn)` | `app.current_org`, `app.current_user`, `app.current_portal_customer` |

Bare `pool.query()` against tenant tables outside one of these is a review-block.

## Conventions

- **Drizzle defines schemas; queries are raw SQL.** `pg.PoolClient.query<RowType>("SELECT ...", [...])` everywhere. Drizzle's query builder is not used (cannot express RLS-aware patterns cleanly). Prisma is forbidden (drops triggers, can't set per-txn GUCs).
- **All money / quantity / tax via `@instigenie/money`** (decimal.js). NUMERIC parsed as strings via `installNumericTypeParser()`. Native `Number` for ledger math is a review-block.
- **Outbox is the only path for cross-module events.** `enqueueOutbox(client, event)` runs in the same transaction as the entity write. `apps/listen-notify` drains via `LISTEN`/`NOTIFY` to BullMQ. No direct Redis pub/sub from business code.
- **Two Redis clusters, strictly separated.** `redis-bull` (BullMQ, `noeviction`) and `redis-cache` (LRU). `assertBullRedisNoeviction()` checked at boot.
- **Listener uses a direct PG URL.** PgBouncer transaction mode breaks `LISTEN`. `assertDirectPgUrl()` enforces.
- **Append-only ledger / audit / outbox tables.** No `deleted_at` on `stock_ledger`, `customer_ledger`, `vendor_ledger`, `audit.log`, `outbox.events`.
- **Boot-time invariants over runtime hope.** Numeric parser, RLS enabled, dev-seed absent in prod, non-superuser API role, non-pooled listener URL, noeviction bull-redis — all asserted at startup.
- **Password hashing: `bcrypt`** (rounds=12), with constant-time compare via dummy hash on user-not-found.

See `ARCHITECTURE.md` §2 for the full non-negotiable rules list.

## Deployment

Two compose files exist:

- **`ops/compose/docker-compose.dev.yml`** — full local stack: Postgres + PgBouncer + 2 Redis + MinIO + OTel collector + Prometheus + Grafana.
- **`ops/compose/docker-compose.prod.yml`** — managed-services edition: api + worker + listen-notify + caddy in containers; Postgres on Neon, Redis on Upstash, web on Vercel.

The active deploy target is **single-box Hostinger KVM 2** (2 vCPU / 8 GB / 100 GB NVMe) — Postgres + 4 Node services + 2 Redis + Caddy on the same host. The compose file for this is in progress; runbook will land in `docs/runbooks/deploy-hostinger-kvm2.md`.

Existing runbooks in `docs/runbooks/`:

- `backup-dr.md` — nightly `pg_dump` + restore drill
- `pre-launch-checklist.md` — gates before going live
- `secret-rotation.md` — JWT, DB, Redis credential rotation
- `critical-alerts.md` · `alertmanager-routing.md` — paging rules
- `load-test.md` — k6 load profile and run instructions
- `pgbouncer-replica.md` — Phase-2 read-replica setup
- `minio-3-node-cluster.md` — Phase-2 object-store cluster

## License

Proprietary. © Instigenie Diagnostic Instruments Pvt. Ltd.
