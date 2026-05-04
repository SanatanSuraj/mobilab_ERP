# Instigenie ERP — Architecture

**Status:** Code-grounded reference for the system as it exists today.
**Stack:** Next.js 16 · React 19 · Node 22 · Fastify 5 · BullMQ 5 · PostgreSQL 16 · Redis 7
**Architecture:** Modular monolith (4 Node processes), Postgres-centric, multi-tenant via RLS

> This document describes **what is in the code**, not what is planned. Forward-looking work belongs in tickets, not here. If you change the system, update this doc in the same PR.

---

## 1. Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Browser  ⇄  Vercel (Next.js web)                   │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │ HTTPS, JWT in Authorization header
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│   Caddy (TLS, reverse proxy)  ──▶  apps/api (Fastify, port 4000)    │
└──────────────┬──────────────────────────┬───────────────────────────┘
               │                          │
               │ pg pool                  │ ioredis
               ▼                          ▼
        ┌─────────────┐          ┌──────────────────┐
        │  Postgres   │          │   redis-cache    │
        │  16 + RLS   │          │  (LRU, 512 MB)   │
        └──────┬──────┘          └──────────────────┘
               │                          ▲
               │ outbox row               │ cache writes
               │                          │
               │  LISTEN/NOTIFY           │
               ▼                          │
   ┌──────────────────────┐               │
   │  apps/listen-notify  │ ─── enqueue ──┼──▶  ┌────────────────┐
   │  (direct PG conn)    │               │     │   redis-bull   │
   └──────────────────────┘               │     │  (noeviction)  │
                                          │     └───────┬────────┘
                                          │             │ BullMQ
                                          │             ▼
                                          │   ┌──────────────────┐
                                          └───┤   apps/worker    │
                                              │  (PDF, email,    │
                                              │   audit chain,   │
                                              │   scheduled)     │
                                              └──────────────────┘
```

**Four Node processes** (`apps/`):
- `api` — Fastify HTTP server, handles all sync requests
- `worker` — BullMQ worker pool (PDF rendering, email, audit hash-chain, scheduled jobs)
- `listen-notify` — single PG `LISTEN` consumer that drains the outbox into BullMQ
- `web` — Next.js 16 dashboard (deployed to Vercel today; container exists for self-host)

**Two Redis clusters** — strict separation:
- `redis-bull` — BullMQ jobs only, `maxmemory-policy=noeviction` (asserted at boot)
- `redis-cache` — read-through cache, JWT revocation, rate-limit counters; LRU eviction

---

## 2. Non-Negotiable Rules

Every rule below is enforced in code (boot-time check, gate test, or RLS policy). Reviewers must reject PRs that violate them.

| # | Rule | Enforced in |
|---|------|-------------|
| 1 | All money / quantity / tax / ledger amounts use **`@instigenie/money`** (decimal.js). NUMERIC columns parsed as strings via `installNumericTypeParser()`. Native `Number` for ledger math is forbidden. | `packages/money`, `packages/db/src/types.ts` |
| 2 | **BullMQ runs on `redis-bull` with `maxmemory-policy=noeviction`.** Cache, JWT revocation, rate-limit run on `redis-cache` with LRU. Sharing one Redis is impossible. | `packages/queue/src/noeviction.ts` (`assertBullRedisNoeviction`) |
| 3 | The **`listen-notify` worker uses a direct PG connection** (no PgBouncer / pooler). LISTEN does not survive transaction-mode pooling. | `packages/db/src/direct-url.ts` (`assertDirectPgUrl`) |
| 4 | The **transactional outbox** (`enqueueOutbox(client, event)`) is the only path for cross-module domain events. Direct Redis pub/sub from business code is forbidden. | `packages/db/src/outbox.ts` |
| 5 | Every tenant-scoped query runs inside **`withOrg(pool, orgId, fn)`** or **`withRequest(req, pool, fn)`**. They open a transaction and set `app.current_org` (and `app.current_user` / `app.current_trace_id` for `withRequest`) as `LOCAL` GUCs. Bare `pool.query()` against tenant tables is a review-block. | `packages/db/src/with-org.ts`, `apps/api/src/modules/shared/with-request.ts` |
| 6 | The **API's Postgres role is `instigenie_app`** (`NOSUPERUSER NOBYPASSRLS`). The bootstrap policy refuses to start if the connected role can bypass RLS. A superuser connection silently leaks across tenants. | `apps/api/src/bootstrap-policy.ts` |
| 7 | **Drizzle defines schema only.** Application queries are raw parameterised SQL via `pg.PoolClient.query()`. We do not use Drizzle's query builder. (Prisma is forbidden — drops triggers, can't set per-txn GUCs, loses SQLSTATE codes.) | `packages/db/src/schema/`, every `*.repository.ts` |
| 8 | **Ledger and audit tables are append-only.** `stock_ledger`, `customer_ledger`, `vendor_ledger`, `audit.log`, `outbox.events` have no `deleted_at` column. Soft delete is for operational entities (leads, deals, WOs) only. | `ops/sql/init/`, `ops/sql/triggers/` |
| 9 | **Tenant isolation is two-layered.** RLS in Postgres (defence) AND explicit `org_id` in every query (first line). Never rely on either alone. | `ops/sql/rls/`, `apps/api/src/modules/**/*.repository.ts` |
| 10 | **Boot-time invariants over runtime hope.** If a guarantee can be checked at startup, it must be: numeric parser installed, RLS enabled on all tenant tables, dev-seed org absent in prod, API role non-superuser, listener URL non-pooled, bull-redis on noeviction. | `apps/api/src/bootstrap-policy.ts`, the `assert*` helpers |
| 11 | **Redis key invalidation uses `SCAN`, never `KEYS`.** `KEYS` blocks Redis for seconds at scale. | `packages/cache/src/` |
| 12 | **Vendor admin uses a separate role `instigenie_vendor`** (`BYPASSRLS`) on a separate `vendor` schema, with its own `VENDOR_DATABASE_URL` env var and pool. Vendor and tenant code paths must not share a connection. | `apps/api/src/index.ts` (pool wiring), `ops/sql/seed/00-roles.sql` |
| 13 | **Password hashing uses `bcrypt`** (rounds=12). Constant-time comparison via dummy hash on user-not-found. | `apps/api/src/modules/auth/service.ts`, `apps/api/src/modules/password-reset/service.ts` |
| 14 | **PDF generation runs only on the dedicated worker** (`@react-pdf/renderer` in `apps/worker`). No inline PDF in route handlers. | `apps/worker/src/processors/` |
| 15 | **Gate tests import the same module production uses.** Helpers like `assertDirectPgUrl`, `assertBullRedisNoeviction` are exported and tested against the real implementation, not stubs. | `pnpm test:gates` |

---

## 3. Monorepo Layout

```
apps/
  api/             Fastify HTTP server — 21 modules, RLS-enforced
  web/             Next.js 16 dashboard (3 auth surfaces)
  worker/          BullMQ worker pool — PDF, email, audit chain, scheduled
  listen-notify/   PG LISTEN bridge — outbox → BullMQ
packages/
  cache/           Redis read-through cache, resource-scoped TTLs
  config/          Shared tsconfig + ESLint configs
  contracts/       Zod schemas + shared types (frontend ↔ backend wire format)
  db/              pg pool, Drizzle schema, withOrg, outbox, type parser
  errors/          AppError hierarchy, RFC 7807 problem+json
  money/           decimal.js wrapper for all ledger math
  observability/   Pino + OpenTelemetry + Prometheus
  qc/              QC certificate hash-chain helpers
  queue/           BullMQ factories + noeviction assertion
  quotas/          Plan / feature-flag / quota enforcement
  resilience/      Retry + circuit breaker
  storage/         S3/MinIO client + key builders
  vendor-admin/    Vendor-side service layer (auth, suspension, plan changes)
ops/
  compose/         docker-compose.dev.yml + docker-compose.prod.yml
  docker/          Per-app Dockerfiles (multi-stage, Node 20 alpine)
  sql/             init/ · triggers/ · rls/ · seed/ · migrations/
  postgres/        Custom postgres:16-pgcron Dockerfile
  caddy/           Caddyfile (TLS + reverse proxy)
  scripts/         validate-env.sh, migrate-prod.sh
  k6/              Load-test scenarios (gate-17 sustained load)
  dr/              promote-replica.sh, restore-drill.sh
docs/
  adr/             Architectural decision records
  runbooks/        Operational playbooks
```

---

## 4. Database Layer

### 4.1 Postgres roles

Three roles, created in `ops/sql/seed/00-roles.sql`:

| Role | Powers | Used by |
|------|--------|---------|
| `instigenie` | Bootstrap superuser. Owns objects, runs migrations. | `psql` from ops scripts only |
| `instigenie_app` | `NOSUPERUSER NOBYPASSRLS`. Read/write on `public`, `outbox`, `audit`. | `apps/api`, `apps/worker`, `apps/listen-notify` (via `DATABASE_URL`) |
| `instigenie_vendor` | `NOSUPERUSER BYPASSRLS`. Read/write on `public`, `vendor`. | Vendor-admin code paths only (via `VENDOR_DATABASE_URL`) |

The bootstrap policy in `apps/api/src/bootstrap-policy.ts` refuses to start if `current_user` has `rolsuper` or `rolbypassrls` on the tenant pool. This is the load-bearing fix that closed the cross-tenant leak class permanently.

### 4.2 Schema declarations vs queries

- **Schema** is declared with **Drizzle** (`drizzle-orm/pg-core`) under `packages/db/src/schema/`. Used for: column metadata, type inference, and `drizzle-kit` migration scaffolding.
- **Queries** are written as **raw parameterised SQL** via `pg.PoolClient.query<RowType>("SELECT ...", [...])`. There are 500+ such call sites; zero uses of Drizzle's query builder.

Reasoning: Drizzle's query builder cannot express our patterns cleanly (RLS GUCs per-txn, SQLSTATE-driven retry, `RETURNING` with computed columns, `ON CONFLICT DO UPDATE` with composite keys, recursive CTEs for hierarchies). Raw SQL with Postgres types makes invariants explicit and reviewable.

### 4.3 Tenant scoping — GUCs and helpers

RLS policies on tenant tables consult `current_setting('app.current_org', true)`. Three helpers set this safely:

| Helper | Sets | Use |
|--------|------|-----|
| `withOrg(pool, orgId, fn)` | `app.current_org` | Cross-tenant or system-internal flows where there is no `req` (e.g. login lookups, scheduled jobs) |
| `withRequest(req, pool, fn)` | `app.current_org`, `app.current_user`, `app.current_trace_id` | Standard tenant-scoped HTTP handlers (the 90% case) |
| `withPortalRequest(req, pool, fn)` | `app.current_org`, `app.current_user`, `app.current_portal_customer` | Customer-portal handlers (audience `instigenie-portal`) |

All three open a transaction, set GUCs as `LOCAL` (auto-clears at txn end, even on error), call the callback with the bound `PoolClient`, and `COMMIT` / `ROLLBACK` accordingly. Direct `pool.query()` against tenant tables outside one of these wrappers is a review-block.

GUC inventory in active use (verified by grep across `apps/`, `packages/`, `ops/sql/`):

| GUC | Set by | Read by |
|-----|--------|---------|
| `app.current_org` | `withOrg` | Every RLS policy on tenant tables |
| `app.current_user` | `withRequest` | Audit triggers (`audit.log.actor_id`) |
| `app.current_portal_customer` | `withPortalRequest` | Portal-restrictive RLS overlays |
| `app.current_trace_id` | `withRequest` | Audit triggers (correlation) |
| `app.current_identity` | (admin flows) | Identity-scoped overrides |

### 4.4 NUMERIC handling

`installNumericTypeParser()` registers a `pg` type parser that returns `NUMERIC` columns as **strings** (not JS `number`). Application code must construct `Money` from those strings. Forgetting this loses precision on amounts > 2^53.

### 4.5 Migrations

Two layers:

1. **Bootstrap SQL** in `ops/sql/init/` — applied once per fresh DB by `pnpm db:migrate` (which runs `ops/sql/apply-to-running.sh`). 27+ files, numerically ordered. Includes extensions, schemas, all domain tables, RLS enable, triggers, seeds.
2. **Forward migrations** via `drizzle-kit` + a custom CLI at `packages/db/src/migrate/cli.ts` — `pnpm migrate:status`, `pnpm migrate:up`, `pnpm migrate:prod`. Tracked in `schema_migrations` table.

Destructive migrations on ledger / audit / outbox tables require `# ALLOW_LEDGER_DESTRUCTIVE` in the PR body.

---

## 5. Outbox & LISTEN/NOTIFY

**Goal:** publish domain events with **at-least-once** delivery, **atomic** with the entity write.

### 5.1 Write side

Inside any tenant transaction, business code calls:

```ts
await enqueueOutbox(client, {
  aggregateType: "lead",
  aggregateId: id,
  eventType: "lead.converted",
  payload: { orgId, leadId: id, accountId, dealId, convertedBy },
  idempotencyKey: `lead.converted:${id}`,
});
```

This inserts into `outbox.events` in the same transaction as the entity write. A trigger fires `pg_notify('outbox.new', '<eventId>')` on insert.

### 5.2 Drain side

`apps/listen-notify` opens a single direct PG connection (no pooler — `assertDirectPgUrl()` enforces), runs `LISTEN outbox.new`, and drains `outbox.events` rows to BullMQ. It also wakes on a 5-second tick to catch any missed notifications. Drained rows are marked `dispatched_at`.

Workers consume from BullMQ queues. Each handler is idempotent (keyed by `idempotencyKey`).

### 5.3 Why a dedicated process?

`LISTEN` does not work over PgBouncer transaction mode (the connection is rotated mid-flight). Putting the listener inside `apps/api` would couple HTTP scaling to LISTEN scaling, and a crash would lose the LISTEN session.

---

## 6. Concurrency — BullMQ

`packages/queue` exports queue/worker/event factories bound to `redis-bull`.

### 6.1 Queues

Defined in `QueueNames`:

- `critical` — audit hash-chain, refresh-token revocation
- `high` — outbox dispatch (default lane)
- `default` — normal workload
- `pdf` — `@react-pdf/renderer` rendering (heap-heavy, isolated)
- `scheduler` — repeatable jobs with deterministic `jobId`s

### 6.2 Worker invariants

- `lockDuration ≥ longest expected job duration` (jobs running longer than the lock get re-issued)
- `maxStalledCount = 1` (one stall = DLQ)
- Ack only via successful return; no manual ack, no catch-and-return-success
- All queues bound to `redis-bull` (`assertBullRedisNoeviction()` checked at boot)

### 6.3 Scheduled jobs

Use BullMQ's repeatable jobs with stable `jobId`s. **No `node-cron`, no `setInterval` schedulers** — multiple workers would each fire.

---

## 7. Caching

`packages/cache` — Redis read-through wrapper bound to `redis-cache`.

- Key shape: `cache:{orgId}:{resource}:{id}`
- Resource-scoped TTLs in `RESOURCE_TTL` (e.g. `auth.me` 60s, `tenant.status` 30s, BOMs / item masters longer)
- Invalidation uses `SCAN` (never `KEYS`)
- Cache misses are populated synchronously; subsequent readers within TTL hit Redis

Wired in `apps/api/src/index.ts` for: `AuthService.me()` (60s TTL), `TenantStatusService.getStatus()` (30s TTL), and selective resource caches.

---

## 8. Auth & Security

### 8.1 Identity model

Three tables:

- `user_identities` — global, one row per human (email + bcrypt hash + MFA fields)
- `users` — per-tenant profile (`org_id`, `identity_id` FK, name, capabilities)
- `memberships` — `(identity_id, org_id, status)` — drives the tenant picker

Pattern follows Slack/Linear: one identity, many tenant memberships, one profile per (identity × tenant).

### 8.2 JWT tokens

Library: **`jose`** (HS256). Issued by `TokenFactory` in `apps/api/src/modules/auth/tokens.ts`.

| Token | Audience | TTL | Subject | Use |
|-------|----------|-----|---------|-----|
| Access (internal) | `instigenie-internal` | 15m | `user_id` | Tenant API requests |
| Access (portal) | `instigenie-portal` | 15m | `user_id` | Customer-portal API requests |
| Tenant picker | `instigenie-tenant-picker` | 5m | `identity_id` | Multi-org login flow |
| Vendor | `instigenie-vendor` | 15m | `vendor_admin_id` | Vendor-admin console |
| Refresh | (opaque, SHA-256 hashed) | configurable | — | Refresh rotation |

Custom claims on access tokens: `org` (orgId), `idn` (identity_id, used for e-signature binding), `roles[]`, `capabilities` (production tier).

### 8.3 Login flow

```
POST /auth/login { email, password, surface }
  → 1 membership : { access, refresh }
  → 2+ memberships : { tenantPicker, memberships[] }
  → 0 memberships on this surface : 403

POST /auth/select-tenant { tenantToken, orgId }
  → verify tenantPicker, confirm ACTIVE membership matches surface
  → { access, refresh }
```

Cross-tenant queries during login deliberately bypass `withOrg` because the tenant has not yet been chosen. All subsequent access goes through `withRequest`.

### 8.4 Password reset

Two parallel modules: `apps/api/src/modules/password-reset/` (tenant) and `apps/api/src/modules/vendor-password-reset/`.

- SHA-256 hashed tokens, 1-hour TTL, single-use
- Anti-enumeration silent-200 on `/forgot`
- 5/hour rate limit per email
- On reset, invalidates all refresh tokens for the identity via the `auth_revoke_refresh_tokens_for_identity(uuid)` SECURITY DEFINER function (RLS would otherwise block the cross-tenant wipe)

### 8.5 Rate limiting

`@fastify/rate-limit` v10. Configured in `apps/api/src/index.ts`:

- Global: 300 req/min per IP, RFC 7807 problem+json on 429
- Per-route credential limits (login, forgot-password): keyed by lowercased email from request body, configured via `config.rateLimit` route option with `hook: "preHandler"` so `req.body` is parsed before the keygen runs

### 8.6 Bootstrap policy

`apps/api/src/bootstrap-policy.ts` refuses to start if any of:

1. NUMERIC type parser not installed
2. RLS not enabled on a known list of tenant tables
3. Dev-seed organisation present in production
4. Tenant pool's `current_user` has `rolsuper` or `rolbypassrls`

---

## 9. Observability

`packages/observability` — Pino + OpenTelemetry + Prometheus.

- **Logging** — Pino structured logs, redacts `password`, `token`, `Authorization`
- **Tracing** — OpenTelemetry SDK, OTLP exporter (collector at `:4317` in dev)
- **Metrics** — `prom-client` registry exposed at `/metrics` on each app

Standard metrics:

- `http_requests_total{method,route,status}`
- `http_request_duration_ms{method,route}` (histogram)
- `outbox_depth` (gauge — undispatched events)
- `jobs_processed_total{queue,status}`
- `job_duration_ms{queue}` (histogram)
- `audit_chain_break_total` (counter — investigate immediately)
- `dlq_depth{queue}` (gauge)
- `dlq_writes_total{queue}` (counter)

Health endpoints on every app: `/healthz` (liveness), `/readyz` (readiness — checks DB + Redis), `/metrics`.

---

## 10. Deployment

### 10.1 Dev — full local stack

`pnpm infra:up` runs `ops/compose/docker-compose.dev.yml`:

| Service | Image | Port | Notes |
|---------|-------|------|-------|
| postgres | custom postgres:16 + pg_cron | 5434 | shared_buffers=256MB, pg_stat_statements + pg_cron preloaded |
| pgbouncer | edoburu/pgbouncer | 6432 | transaction mode, pool=20 |
| redis-bull | redis:7-alpine | 6381 | AOF on, noeviction |
| redis-cache | redis:7-alpine | 6382 | LRU, no persistence, 512 MB cap |
| minio | quay.io/minio | 9000 / 9001 | Object storage |
| otel-collector | otel/opentelemetry-collector | 4317 / 4318 | Trace ingestion |
| prometheus | prom/prometheus | 9090 | Metrics scrape |
| grafana | grafana/grafana | 3001 | Dashboards |

App processes (`api`, `web`, `worker`, `listen-notify`) run on the host via `pnpm dev`.

### 10.2 Prod — managed services compose

`ops/compose/docker-compose.prod.yml` targets a **managed-services deployment** (Postgres on Neon, Redis on Upstash). Containers: `listen-notify`, `worker`, `api`, `caddy`. Web runs on Vercel.

Memory budget for a 1 GB host: ~280 MB OS + Docker, ~250 MB api, ~210 MB worker, ~130 MB listen-notify, ~30 MB caddy ≈ 900 MB total. Provision 2 GB swap.

Hard requirements at boot:

- `DATABASE_URL` — pooled (PgBouncer-style) for api/worker
- `DATABASE_DIRECT_URL` — direct (no pooler) for listen-notify, asserted by `assertDirectPgUrl()`
- `REDIS_BULL_URL` on a `noeviction` instance (Upstash Pro tier — free won't work)
- `REDIS_CACHE_URL` on a separate cluster
- `JWT_SECRET` ≥ 32 bytes, `ESIGNATURE_PEPPER` ≥ 32 chars

### 10.3 Single-box (Hostinger KVM 2) — planned

The active deploy target is **single-box on Hostinger KVM 2** (2 vCPU / 8 GB / 100 GB NVMe): Postgres + 4 Node services + 2 Redis + Caddy on the same host. The compose file for this does not exist yet and will be added as part of the deploy work. The shape is: take dev compose, drop dev-only bits (otel/prometheus/grafana/minio if not needed, pgbouncer optional), add Caddy with TLS, harden env, set memory limits.

### 10.4 Caddy

`ops/caddy/Caddyfile` — single vhost `${API_HOSTNAME}`, reverse-proxies to `api:4000`, sets HSTS / X-Content-Type-Options / Referrer-Policy, automatic Let's Encrypt.

### 10.5 Backups & DR

- `ops/dr/promote-replica.sh` — promote standby (gated on `CONFIRM_DR=1`)
- `ops/dr/restore-drill.sh` — quarterly restore drill from MinIO/object storage
- Runbooks in `docs/runbooks/`

### 10.6 Load testing

`ops/k6/gate-17-sustained-load.js` — 1 hour @ 500 concurrent. Gates: p99 < 2 s, 5xx < 0.1 %, zero dead letters, zero stock drift, no audit hash-chain breaks.

---

## 11. Web App

`apps/web` — Next.js 16, React 19, Tailwind v4, shadcn/ui.

### 11.1 Auth surfaces

| Route | Audience | Notes |
|-------|----------|-------|
| `/auth/login` | tenant employees (`instigenie-internal`) | Real API; multi-tenant picker on multiple memberships |
| `/vendor-admin/login` | Instigenie staff (`instigenie-vendor`) | Separate audience, separate DB role |
| `/portal/...` | customer portal (`instigenie-portal`) | Separate JWT audience, restrictive RLS overlay |

There is **no Next.js API route layer** — the browser calls the Fastify api directly. Token exchange and tenant selection happen via `apps/api` endpoints.

### 11.2 Module routes (under `(dashboard)/`)

`crm`, `production`, `inventory`, `procurement`, `qc`, `finance`, `admin`, `approvals`, `notifications`, `portal`.

Permanent redirects: `/mfg/*` and `/manufacturing/*` → `/production/*`; `/accounting/*` → `/finance/*`.

### 11.3 Data fetching

TanStack Query (v5) is the standard. Query keys namespaced (`["crm-api", entity, "list", filters]`). Hooks in `apps/web/src/hooks/`, API clients in `apps/web/src/lib/api/`. Migration from prototype useState+useEffect+fetch is ~70% complete; remaining mock-backed pages flagged for excision.

### 11.4 Build

- Next 16 with explicit `--webpack` (Turbopack not used)
- `output: "standalone"` for Docker
- Sentry server-side only (`instrumentation.ts`); client-side Sentry was removed (saved 180 KB on the largest non-framework chunk)
- `xlsx` is the largest single dep; isolated to report routes that need export

---

## 12. Anti-Patterns

Things we have explicitly rejected. Reviewers should flag these.

- **Prisma** — drops triggers, can't set per-txn GUCs, loses SQLSTATE codes
- **Drizzle query builder** for application queries — covered by raw SQL with parameterised values
- **One Redis for both BullMQ and cache** — eviction policies are mutually exclusive
- **`KEYS` on Redis** — use `SCAN`
- **`pool.query()` against tenant tables outside `withOrg` / `withRequest`** — bypasses RLS GUC setup
- **`Number` for money/quantity** — use `@instigenie/money`
- **Inline PDF in route handler** — use the `pdf` BullMQ queue
- **`node-cron` / `setInterval` schedulers** — use BullMQ repeatable jobs with stable `jobId`
- **Soft-deleting ledger or audit rows** — append-only, period
- **Connecting as Postgres superuser from any app** — bootstrap policy will refuse to start
- **Client-side Sentry in `apps/web`** — server-side instrumentation only; the bundle cost is not worth it

---

## Appendix A — Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-04 | `instigenie_app` (NOBYPASSRLS) for tenant pool | Cross-tenant data leak occurred when API connected as superuser; bootstrap policy now enforces |
| 2026-04 | `instigenie_vendor` (BYPASSRLS) on vendor schema only | Vendor admin needs cross-tenant reads; isolated via separate role + separate `VENDOR_DATABASE_URL` |
| 2026-04 | Drizzle for schema, raw SQL for queries | Query builder cannot express RLS-aware patterns; raw SQL is more reviewable |
| 2026-04 | Server-only Sentry in `apps/web` | Client-side Sentry added 180 KB to largest non-framework chunk; server-side instrumentation captures the same errors |
| 2026-04 | Per-route email-keyed rate limit on login/forgot | IP-keyed alone allows credential stuffing across IPs; `hook: "preHandler"` required so `req.body` is parsed before keygen |
| 2026-04 | `auth_revoke_refresh_tokens_for_identity` SECURITY DEFINER | RLS on `users` blocked the cross-tenant inner SELECT during password reset |
| 2026-05 | Single-box Hostinger KVM 2 over Neon/Supabase | Cost; managed Redis at noeviction tier ($$$); operational simplicity for current scale |
| 2026-05 | Drop client-side `instrumentation-client.ts` | Sentry was no-op without DSN; deletion saved another 120 KB |

---

## Appendix B — File Pointers

When in doubt, read the code.

- Postgres roles: `ops/sql/seed/00-roles.sql`
- RLS policies: `ops/sql/rls/`
- Outbox triggers: `ops/sql/triggers/`
- `withOrg`: `packages/db/src/with-org.ts`
- `withRequest`: `apps/api/src/modules/shared/with-request.ts`
- `withPortalRequest`: `apps/api/src/modules/portal/with-portal-request.ts`
- `enqueueOutbox`: `packages/db/src/outbox.ts`
- `assertDirectPgUrl`: `packages/db/src/direct-url.ts`
- `assertBullRedisNoeviction`: `packages/queue/src/noeviction.ts`
- Bootstrap policy: `apps/api/src/bootstrap-policy.ts`
- Token factory: `apps/api/src/modules/auth/tokens.ts`
- Auth service: `apps/api/src/modules/auth/service.ts`
- Rate-limit wiring: `apps/api/src/index.ts`
- Prod compose: `ops/compose/docker-compose.prod.yml`
- Dev compose: `ops/compose/docker-compose.dev.yml`
