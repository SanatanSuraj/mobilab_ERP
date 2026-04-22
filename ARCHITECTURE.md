# Instigenie ERP — Architecture & Build Plan

**Document ID:** ERP-ARCH-INSTIGENIE-2026-001
**Version:** 1.1
**Status:** Authoritative — this document is the single source of truth we build from.
**Stack:** Next.js 16.2.x · React 19.2.x · Node 22 LTS · Fastify 5 · Drizzle · BullMQ 5 · PostgreSQL 16 · Redis 7 · MinIO
**Load Target:** 1k–10k active users · 200–500 concurrent · 50k–200k DB txn/day
**Compliance:** ISO 13485 · 21 CFR Part 11 · GST / NIC EWB
**Architecture:** Enhanced Modular Monolith with Selective Service Extraction
**Timeline:** 4 phases · ~14–20 weeks (team-dependent)

---

## Table of Contents

1. [Purpose & North Star](#1-purpose--north-star)
2. [Non-Negotiable Rules](#2-non-negotiable-rules)
3. [System Topology](#3-system-topology)
4. [Monorepo Layout](#4-monorepo-layout)
5. [Database Layer](#5-database-layer)
6. [Event System — Outbox + LISTEN/NOTIFY](#6-event-system--outbox--listennotify)
7. [Concurrency Strategy](#7-concurrency-strategy)
8. [Caching & Redis Architecture](#8-caching--redis-architecture)
9. [Security & Compliance](#9-security--compliance)
10. [Observability](#10-observability)
11. [Infrastructure & Deployment](#11-infrastructure--deployment)
12. [Phased Build Plan](#12-phased-build-plan)
13. [Module Roadmap](#13-module-roadmap)
14. [Anti-Patterns](#14-anti-patterns)
15. [Correctness Gate Catalogue (Full)](#15-correctness-gate-catalogue-full)
16. [Appendix A — Decision Log](#appendix-a--decision-log)
17. [Appendix B — Frontend Migration](#appendix-b--frontend-migration-from-prototype)
18. [Appendix C — Python → Node Translation](#appendix-c--python--node-translation)
19. [Appendix D — Prototype Consolidation](#appendix-d--prototype-consolidation)

---

## 1. Purpose & North Star

### 1.1 What We're Building

**Instigenie ERP** — a multi-tenant SaaS ERP platform. **Mobilab Diagnostic Instruments Pvt. Ltd.** is the reference (pilot) tenant that drives the initial feature set, but the platform is built to host many tenants with the same domain shape. Core modules:

- **CRM** — leads, accounts, contacts, companies, deals, pipeline, quotations, orders, tickets, reports
- **Production** — products, BOMs, ECN, work orders (15-state lifecycle), WIP stages, device IDs (incl. `RECALLED`), OEE, BMR (dual-signature), scrap (root-cause), downtime (categorised), assembly lines L1–L5, operator competency, shop-floor live view, MRP
- **Inventory** — items, warehouses, stock ledger, stock summary, reservations, batches, serials, adjustments, transfers, reorder, reports
- **Procurement** — vendors, indents, purchase orders, approvals, GRN, GRN-QC (combined view), inward, returns (RTV), reports
- **QC** — IQC, SUB_QC (per stage), FINAL_QC, NCR (investigation workflow), CAPA, calibration/equipment, dashboard, reports
- **Finance** — sales invoices, purchase invoices (vendor bills), customer ledger, vendor ledger, payments, approvals, E-Way Bills, GST returns, overview, reports
- **Auth / RBAC / Admin UI** — users, 12 prototype roles, permission catalogue, operator capability layer, user provisioning
- **Notifications** — templates, dispatch (in-app SSE, email, WhatsApp)
- **Audit** — immutable compliance log, hash-chained, electronic-signature bound
- **Customer Portal** — separate auth surface (JWT audience `instigenie-portal`), read-only order/ticket views, ticket creation

### 1.1a Prototype Surfaces (Frontend → Backend Scope)

The Next.js prototype has pages that are **in scope for backend implementation** (above) and pages that are **frozen** (mock-backed, no backend work in Phase 1–4):

| Surface | Scope |
|---------|-------|
| `src/app/(dashboard)/{crm,production,inventory,procurement,qc,finance,admin,portal}/*` | **In scope** — backend modules per §13 |
| `src/app/(dashboard)/hr/*` | **Frozen** — UI stays on `*-mock.ts`; revisit post-launch |
| `src/app/(dashboard)/projects/*` | **Frozen** — same |
| `src/app/(dashboard)/spreadsheets/*` | **Frozen** — scope TBD; keep page, no backend work |
| `src/app/(dashboard)/mfg/*` and `src/app/(dashboard)/manufacturing/*` | **Deprecated** — consolidate into `production/` per Appendix D |
| `src/app/(dashboard)/accounting/*` | **Deprecated** — consolidate into `finance/` per Appendix D |

### 1.2 Design Goals (Strict Priority Order)

When two goals conflict, the earlier one wins. No exceptions.

1. **Correctness** — ledgers are accurate; events are not lost; tenants are isolated; audits are immutable.
2. **Compliance** — ISO 13485 and 21 CFR Part 11 enforced at the database layer, never at application convenience.
3. **Operational simplicity** — one repo, one build, few process types, observable.
4. **Scalability** to 10k users without re-architecture; graceful extraction path beyond.
5. **Developer velocity** — shared types across frontend/backend; module-folder pattern for new features.

### 1.3 Non-Goals (Explicit)

- Multi-region deployment (requires distributed PG; revisit post-10k users)
- Real-time collaborative editing (CRDTs — separate project)
- Native mobile apps (web is responsive; native is a separate project)
- ML/predictive analytics (separate pipeline)
- >10k concurrent users in Phase 1–4 (selective extraction triggered beyond)

---

## 2. Non-Negotiable Rules

Violating any of these breaks an architectural guarantee. Reviewers **must** reject PRs that contradict this list.

| # | Rule | Enforced In |
|---|------|-------------|
| 1 | All money, quantity, tax, and ledger amounts use **`decimal.js`**. NUMERIC columns parsed as strings via pg type parser. Native `Number` for financial math is forbidden. | §5.3, CI lint |
| 2 | **BullMQ runs on a DEDICATED Redis cluster** with `maxmemory-policy=noeviction`. Cache, JWT revocation, rate limit, SSE run on a **SEPARATE Redis cluster** with `volatile-lru`. One Redis for both is impossible. | §8 |
| 3 | The **LISTEN/NOTIFY listener** is a DEDICATED process with direct PostgreSQL connection on port 5432, **bypassing PgBouncer**. LISTEN does not work through PgBouncer transaction mode. | §6.3 |
| 4 | The **Transactional Outbox** is the ONLY permitted path for cross-module domain events. Direct Redis pub/sub from business code is forbidden. | §6 |
| 5 | Every business query runs through **`withOrg(orgId, userId, fn)`**. That wrapper starts a transaction and sets `app.current_org_id` / `app.current_user_id` session variables. RLS policies depend on these. Direct `pool.query()` outside this wrapper is a review-block violation. | §5.2 |
| 6 | BullMQ workers use **`lockDuration ≥ longest job duration`**, `maxStalledCount=1`, ack only via successful return. No manual ack; no catch-and-return-success. | §8.2 |
| 7 | BullMQ repeatable jobs use **stable, deterministic `jobId`s** computed from the schedule name. No `node-cron`, no `setInterval` schedulers outside the dedicated scheduler process. | §6.5 |
| 8 | PDF generation runs **ONLY on the dedicated `pdf` BullMQ worker**. Inline PDF in a route handler or other worker is forbidden. | §11 |
| 9 | **Ledger and audit tables** (`stock_ledger`, `customer_ledger`, `vendor_ledger`, `audit_log`, `outbox_events`) are **append-only**. They do NOT have `deletedAt` columns. Soft delete applies to operational entities (leads, deals, WOs) but NEVER to ledger/audit rows. | §5.5 |
| 10 | Destructive migrations on ledger/audit/outbox tables require a `# ALLOW_LEDGER_DESTRUCTIVE` marker in the PR and two reviewer approvals. | §5.6 |
| 11 | **Drizzle is the ORM. Not Prisma.** Prisma drops triggers, cannot set RLS session vars per-txn, loses SQLSTATE codes needed for lock-conflict retries. Final. | §5.2 |
| 12 | **No prepared statements** on node-postgres. PgBouncer transaction mode does not support them. | §5.7 |
| 13 | Password hashing uses **`argon2id`** or **`@node-rs/bcrypt`**. Never `bcryptjs` (pure JS, 3–5× slower). | §9.1 |
| 14 | Tenant isolation is enforced at **BOTH layers**: RLS policies in PG AND `orgId` on every Drizzle query. DB = safety net; application = first line. Never rely on one. | §9.2 |
| 15 | Redis key invalidation uses **`SCAN`**, never `KEYS`. `KEYS` blocks Redis for seconds on large keyspaces. | §8.4 |
| 16 | **Gate tests import the same module production uses.** Pattern: extract testable helpers (`assertDirectPgUrl`, `assertBullRedisNoeviction`, `createOutboxDrain`) into packages/apps with real export maps. Tests that reimplement an invariant in a stub prove nothing. | §15 |
| 17 | **Every invariant that can be checked at boot MUST be checked at boot.** Listener refuses to start if `DATABASE_DIRECT_URL` routes through PgBouncer (§6.3). Worker and listener refuse to start if `redis-bull` `maxmemory-policy ≠ noeviction` (§8.3). No silent misconfiguration in prod. | §11.3 |

---

## 3. System Topology

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       Cloudflare (DDoS, WAF, DNS, Edge Cache)            │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    NGINX (Reverse Proxy · TLS · Rate Limit)              │
└──────────────────────────────────────────────────────────────────────────┘
           │                      │                      │
           ▼                      ▼                      ▼
    ┌─────────────┐        ┌─────────────┐        ┌─────────────────┐
    │ next-web x3 │        │  api x 6-12 │        │  listen-notify  │
    │ (Next.js 16 │        │  (Fastify 5)│        │  1 pod, DIRECT  │
    │  standalone)│        │             │        │  :5432 → PG     │
    │  React 19   │        │             │        │                 │
    └──────┬──────┘        └──────┬──────┘        └────────┬────────┘
           │                      │                        │
           │ SSR/RSC              │ HTTP                   │ bypasses
           ▼                      ▼                        │ PgBouncer
                           ┌──────────────┐                │
                           │  PgBouncer   │◄───────────────┼─── Fastify via :6432
                           │ (txn mode)   │                │
                           │  2 replicas  │                │
                           └──────┬───────┘                │
                                  ▼                        ▼
                    ┌────────────────────────────────────────────┐
                    │         PostgreSQL 16                       │
                    │   Primary + 1–2 read replicas               │
                    │   Schemas: crm, inventory, procurement,     │
                    │   production, qc, finance, auth,            │
                    │   notifications, outbox, audit              │
                    │   Triggers: NOTIFY on outbox INSERT,        │
                    │   stock_ledger → stock_summary, audit       │
                    │   Partitioning: pg_partman (monthly)        │
                    │   Maintenance: pg_cron                      │
                    │   RLS: enforced on every business table     │
                    └──────────────────┬──────────────────────────┘
                                       │
         ┌─────────────────────────────┼──────────────────────────────┐
         ▼                             ▼                              ▼
  ┌──────────────┐             ┌──────────────┐             ┌────────────────┐
  │  Redis-BULL  │             │ BullMQ       │             │  Redis-CACHE   │
  │  noeviction  │◄────────────│ workers      │             │  volatile-lru  │
  │  3-node Sent.│  enqueue    │ critical x2  │             │  3-node Sent.  │
  └──────────────┘             │ high     x3  │             │  cache, JWT    │
                               │ default  x2  │             │  revocation,   │
                               │ pdf      x1  │             │  rate limit,   │
                               │ scheduler x1 │             │  SSE pub/sub   │
                               └──────┬───────┘             └────────────────┘
                                      │
                                      ▼
                               ┌──────────────┐
                               │    MinIO     │
                               │  S3-compat   │
                               │  PDFs, QC    │
                               │  certs, DMRs │
                               └──────────────┘

  Observability: OpenTelemetry → OTLP → Tempo/Jaeger
                 pino JSON logs → Promtail → Loki
                 /metrics → Prometheus → Grafana → Alertmanager
```

### 3.0a Tenancy Model — Multi-Tenant, Shared DB, RLS-Isolated

Instigenie ERP is a **multi-tenant SaaS on a shared Postgres database**, with per-tenant isolation enforced by Row-Level Security. This is a deliberate architectural choice — not the only option on the menu, and not free.

| Model | Description | Why we DIDN'T pick it |
|-------|-------------|----------------------|
| Single-tenant | One deploy per customer | Ops nightmare at > 5 tenants; no cross-tenant vendor admin |
| Multi-tenant, separate DBs | One Postgres instance/database per tenant | Schema drift, heavy ops, expensive replicas-per-tenant |
| **Multi-tenant, shared DB, RLS** ✓ | One DB; every business table has `org_id UUID NOT NULL` + RLS policy | Isolation is a policy, not a physical boundary → the policy has to be bulletproof |

**Consequences (each enforced somewhere in this doc):**
- Every business table has `org_id UUID NOT NULL REFERENCES organizations(id)` and an RLS policy gated on `current_setting('app.current_org_id', true)::UUID` (§9.2).
- The app connects as a **`NOBYPASSRLS`** Postgres role (`instigenie_app`) so even a forgotten `withOrg()` call returns zero rows rather than cross-tenant data (§9.2).
- Cross-tenant access is a single, explicit, audited path: the `instigenie_vendor` `BYPASSRLS` role, used by the vendor-admin app for support operations. See §9.2 Vendor Escape Hatch.
- Users can belong to multiple orgs via `memberships` — login may return a `multi-tenant` status requiring explicit tenant selection (§9.1).

### 3.1 Process Types

| Process | Count | Purpose |
|---------|-------|---------|
| `next-web` | 2–4 | Next.js 16 App Router (SSR/RSC). See `AGENTS.md` — read `node_modules/next/dist/docs/` before writing Next code, breaking changes vs Next 13–15. |
| `api` | 4–12 | Fastify HTTP API (stateless, horizontally scalable). Serves both internal dashboard and customer portal (see §3.1a). |
| `worker-critical` | 2 | BullMQ queue: critical (QC passes, dispatch events) |
| `worker-high` | 3 | BullMQ queue: high (WO created, GRN, deal won) |
| `worker-default` | 2 | BullMQ queue: default (invoices, reorders, alerts) |
| `worker-pdf` | 1 | BullMQ queue: pdf (isolated — `@react-pdf/renderer` memory can't affect business workers) |
| `worker-scheduler` | **1 exactly** | Registers repeatable jobs via `upsertJobScheduler` |
| `listen-notify` | 1 (2 at scale w/ leader election) | LISTEN on direct PG :5432, bypasses PgBouncer |
| `pgbouncer` | 2 | Connection pool (transaction mode) |

### 3.1a Multi-Surface Auth (Internal Dashboard vs Customer Portal)

The same `apps/api` process serves **two distinct auth audiences**. They share infrastructure but have different permission scopes, route protection, and rate limits.

| Aspect | Internal Dashboard | Customer Portal |
|--------|-------------------|-----------------|
| **JWT `aud` claim** | `instigenie-internal` | `instigenie-portal` |
| **Roles** | 11 staff roles (§9.4) | `CUSTOMER` only |
| **Route matcher** (`apps/web/src/middleware.ts`) | Everything except `/portal/**` and `/login` redirects to `/login` if no token | `/portal/**` redirects to `/portal/login` if no token; `/portal/login` is public |
| **Permitted API namespaces** | `/api/crm/*`, `/api/production/*`, `/api/inventory/*`, `/api/procurement/*`, `/api/qc/*`, `/api/finance/*`, `/api/admin/*`, `/api/notifications/*` | `/api/portal/*` **only** — attempts to reach other namespaces return 403 even with a valid portal JWT |
| **Portal-exposed entities** | — | Orders, invoices, dispatch status, ticket create/read (read-only for orders/invoices, R/W for own tickets) |
| **Rate limits** | 200 rpm/user | 60 rpm/user |
| **SSO** | Optional (Phase 4+) | Email+password only |
| **Session TTL** | Access 60 min / refresh 7 days | Access 15 min / refresh 24 hr |

**Enforcement:** `requireAudience('instigenie-internal' | 'instigenie-portal')` preHandler on every route. A JWT with the wrong `aud` for the route namespace is rejected before any handler runs.

---

## 4. Monorepo Layout

Single pnpm workspace. Turborepo for build orchestration and caching. All processes ship from one repo, one version.

```
instigenie-erp/
├── apps/
│   ├── web/                        # Next.js 15 (App Router, standalone output)
│   │   ├── app/                    # route groups + RSC pages
│   │   ├── components/             # UI components
│   │   ├── hooks/                  # React Query hooks
│   │   └── lib/api-client.ts       # typed client — consumes @erp/contracts
│   │
│   ├── api/                        # Fastify 5 HTTP API
│   │   ├── plugins/                # auth, otel, pino, zod-openapi, helmet,
│   │   │                           # cors, rate-limit, rbac, audit, errorHandler
│   │   └── routes/                 # grouped by module (crm, production, ...)
│   │
│   ├── worker/                     # BullMQ workers — one process per queue
│   │   ├── critical.ts
│   │   ├── high.ts
│   │   ├── default.ts
│   │   ├── pdf.ts
│   │   └── scheduler.ts            # idempotent registrar of repeatable jobs
│   │
│   └── listen-notify/              # LISTEN/NOTIFY bridge (direct PG, no PgBouncer)
│
├── packages/
│   ├── core/                       # business logic — imported by api + worker
│   │   ├── crm/                    # leads, deals, quotations, orders, tickets
│   │   ├── inventory/              # stock ledger, reservations, batches
│   │   ├── procurement/            # vendors, POs, GRNs, RTVs
│   │   ├── production/             # products, BOMs, WOs, WIP stages, devices
│   │   ├── qc/                     # inspections, certs, CAPA
│   │   ├── finance/                # invoices, ledgers, EWB, GST
│   │   ├── auth/                   # users, roles, perms, JWT, revocation
│   │   ├── notifications/          # templates, dispatch, channels
│   │   └── outbox/                 # outbox producer + handler registry
│   │
│   ├── db/                         # Drizzle schemas + migrations
│   │   ├── schema/                 # one file per DB schema
│   │   ├── migrations/             # SQL — hand-written for triggers/RLS/partitions
│   │   ├── client.ts               # pg Pool + Drizzle + withOrg() wrapper
│   │   └── types.ts                # pg type parsers (NUMERIC → string)
│   │
│   ├── queue/                      # BullMQ wrappers: connections, factories, typed Job<T>
│   ├── money/                      # decimal.js helpers: m(), moneyToPg(), moneyFromPg()
│   ├── contracts/                  # zod schemas shared api ↔ web
│   ├── observability/              # OTel SDK, pino logger, Prom exporter
│   ├── errors/                     # AppError, NotFoundError, ConflictError, ShortageError...
│   ├── cache/                      # cached<T>() helper, SCAN-based invalidation
│   ├── resilience/                 # CircuitBreaker, retry helpers
│   └── config/                     # shared tsconfig, eslint-config, boundaries rules
│
├── ops/
│   ├── compose/                    # docker-compose.{dev,prod}.yml
│   ├── k8s/                        # Helm charts (for scale-out)
│   ├── nginx/                      # nginx.conf
│   └── sql/                        # raw SQL assets:
│       ├── triggers/               # outbox notify, stock summary, audit
│       ├── rls/                    # policies per table
│       ├── partitions/             # pg_partman setup
│       ├── pg_cron/                # maintenance jobs
│       └── seed/                   # roles, permissions, sample data
│
├── .github/workflows/
│   ├── ci.yml                      # typecheck + lint + unit + integration
│   ├── cd-staging.yml              # auto-deploy on main
│   └── cd-prod.yml                 # manual approval → production
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### 4.1 ESLint Module Boundaries (CI-enforced)

```js
// packages/config/eslint-boundaries.js
module.exports = {
  "boundaries/elements": [
    { type: "module",        pattern: "packages/core/*/src/**" },
    { type: "db",            pattern: "packages/db/src/**" },
    { type: "queue",         pattern: "packages/queue/src/**" },
    { type: "money",         pattern: "packages/money/src/**" },
    { type: "contracts",     pattern: "packages/contracts/src/**" },
    { type: "observability", pattern: "packages/observability/src/**" },
    { type: "errors",        pattern: "packages/errors/src/**" },
    { type: "cache",         pattern: "packages/cache/src/**" },
    { type: "resilience",    pattern: "packages/resilience/src/**" },
    { type: "apps",          pattern: "apps/**" },
  ],
  "boundaries/element-types": ["error", {
    default: "disallow",
    rules: [
      { from: "module", allow: ["db","queue","money","contracts",
                                 "observability","errors","cache","resilience"] },
      { from: "module", disallow: ["module"] },  // modules NEVER import each other
      { from: "apps",   allow: ["module","db","queue","money","contracts",
                                 "observability","errors","cache","resilience"] },
    ]
  }]
};
```

**Modules communicate ONLY via outbox events.** Direct cross-module imports fail CI. This makes future service extraction a transport swap, not a rewrite.

---

## 5. Database Layer

### 5.1 Schema Map

| Schema | Core Tables | Publishes Events | Consumes Events |
|--------|-------------|-----------------|-----------------|
| `crm` | leads, accounts, deals, quotations, orders, tickets, activities | `deal.won`, `ticket.created` | `qc_final.passed`, `invoice.sent` |
| `inventory` | items, warehouses, stock_ledger, stock_summary, batches, serials | `reorder.triggered`, `batch.expiry_alert` | `grn.created`, `challan.confirmed` |
| `procurement` | vendors, indents, purchase_orders, grns, rtvs | `po.approved`, `grn.created` | `deal.won`, `reorder.triggered` |
| `production` | products, bom_versions, work_orders, wip_stages, device_ids, ecns | `work_order.created`, `wip_stage.qc_gate`, `device.dispatched` | `deal.won`, `qc_wip.passed` |
| `qc` | inspection_templates, qc_inspections, defects, qc_certs, capa, calibration | `qc_inward.passed`, `qc_final.passed` | `inward.created`, `wip_stage.qc_gate` |
| `finance` | sales_invoices, customer_ledger, vendor_ledger, eway_bills, payments | `invoice.sent`, `ewb.generated` | `challan.confirmed`, `grn.created` |
| `notifications` | notification_templates, notification_log | (terminal consumer) | (all events trigger notifications) |
| `auth` (public, historical name) | users, user_identities, roles, permissions, role_permissions, user_roles, **memberships** (multi-tenant), refresh_tokens, revoked_tokens | (sync only) | (sync only) |
| `public` (entitlements) | organizations, plans, plan_features, subscriptions, usage_records | (sync only — feature flag / quota reads) | — |
| `vendor` | vendor.admins, vendor.action_log, vendor.refresh_tokens | (audit-only) | (infrastructure — cross-tenant admin ops) |
| `outbox` | outbox.events, workflow_transitions | (infrastructure) | (infrastructure) |
| `audit` | audit.log (partitioned monthly) | (infrastructure) | (infrastructure) |

### 5.2 Drizzle Client with Session Variables (RLS-safe)

**This is the ONLY sanctioned entry point for business queries.**

```typescript
// packages/db/src/client.ts
import { Pool, types } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

// CRITICAL: parse NUMERIC as string; Decimal is constructed in packages/money.
types.setTypeParser(1700, (v) => v); // NUMERIC
types.setTypeParser(20,   (v) => v); // INT8 — counts > 2^53 stay strings

export const poolPrimary = new Pool({
  connectionString: process.env.DATABASE_URL,      // → PgBouncer :6432
  max: 20,
  idleTimeoutMillis: 30_000,
  statement_timeout: 25_000,
  idle_in_transaction_session_timeout: 10_000,
});

export const poolReplica = new Pool({
  connectionString: process.env.DATABASE_READ_URL, // → PgBouncer :6432 → PG replica
  max: 20,
});

export const dbRW = drizzle(poolPrimary, { schema });
export const dbRO = drizzle(poolReplica, { schema });
export type DB = NodePgDatabase<typeof schema>;

/** The ONLY way to run business queries. Sets RLS session vars per transaction. */
export async function withOrg<T>(
  orgId: string, userId: string,
  fn: (tx: DB) => Promise<T>,
  opts: { readonly?: boolean } = {}
): Promise<T> {
  const db = opts.readonly ? dbRO : dbRW;
  return await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT set_config('app.current_org_id', ${orgId}, true),
             set_config('app.current_user_id', ${userId}, true)
    `);
    return await fn(tx as DB);
  });
}
```

### 5.3 Decimal Pipeline (Money Module)

Financial correctness. A single `Number()` cast on a NUMERIC column is a silent bug that corrupts ledgers over time.

```typescript
// packages/money/src/index.ts
import Decimal from 'decimal.js';
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export type Money = Decimal;

export const m = (v: string | Decimal): Money => {
  if (typeof v === 'number') {
    throw new Error('money(): refuse to construct from Number — pass a string');
  }
  return new Decimal(v);
};

export const moneyToPg   = (x: Money): string => x.toFixed();
export const moneyFromPg = (v: string): Money => new Decimal(v);

// CI lint rule: forbid Number() and parseFloat() inside packages/money,
// inside any *.money.ts file, or near any column typed as NUMERIC.
```

### 5.4 Read / Write Routing

| Query Type | Routes To | Reason |
|------------|-----------|--------|
| Stock reservation, MRP | Primary (`dbRW`, `FOR UPDATE`) | Must see latest committed state |
| Invoice/ledger writes | Primary | Transactional |
| Locking operations | Primary | Locks cannot be on replica |
| Reports (ageing, GST, P&L) | Replica (`dbRO`) | Long-running, must not block primary |
| Dashboards (KPIs) | Replica | 10s staleness acceptable |
| Stock ledger traceability | Replica | Immutable — replica always correct |
| Real-time WIP dashboard | Redis-CACHE | Primary updates cache; readers hit Redis |

### 5.5 Soft-Delete Policy

| Table Category | Examples | `deletedAt`? |
|----------------|----------|--------------|
| Operational | leads, deals, work_orders, items, vendors, users | YES — soft delete |
| Ledger | stock_ledger, customer_ledger, vendor_ledger | **NO — append-only** |
| Audit | audit_log | **NO — Part 11 immutable** |
| Infrastructure | outbox_events | **NO — state machine** |

> 21 CFR Part 11 requires audit trails that cannot be altered. Adding `deletedAt` to `audit_log`, even with policy to never set it, is a compliance finding. **Immutability must be structural** (PG rule blocking UPDATE/DELETE), not conventional.

### 5.6 Migrations Policy

- **Operational tables** (leads, deals, items, ...): Drizzle Kit generates + human reviews before merge.
- **Triggers**: hand-written SQL in `ops/sql/triggers/`. Re-applied by migration runner after every Drizzle migration.
- **RLS policies**: hand-written SQL in `ops/sql/rls/`. Re-applied after every Drizzle migration.
- **Partitions**: hand-written `pg_partman` setup in `ops/sql/partitions/`. Monthly partitions created by `pg_cron`; pre-created 3 months ahead.
- **Ledger/audit/outbox DDL changes**: require `# ALLOW_LEDGER_DESTRUCTIVE` marker in PR description + two reviewer approvals. CI blocks without.

### 5.7 PgBouncer Configuration

```ini
[databases]
erp          = host=postgres-primary port=5432 dbname=erp
erp_readonly = host=postgres-replica  port=5432 dbname=erp

[pgbouncer]
pool_mode            = transaction
max_client_conn      = 2000
default_pool_size    = 100
min_pool_size        = 20
reserve_pool_size    = 10
query_timeout        = 30000     ; 30s
client_idle_timeout  = 300
server_reset_query   =           ; empty in txn mode
# node-postgres does not use named prepared statements by default — keep it that way.
# CI rejects any driver config that enables server-side prepares.
```

---

## 6. Event System — Outbox + LISTEN/NOTIFY

### 6.1 The Canonical Pattern

```
Business operation
    │
    ▼
┌──────────────────────────────────────────────────┐
│ BEGIN                                            │
│   INSERT INTO business_table ...                 │
│   INSERT INTO outbox.outbox_events               │
│     (event_type, payload, org_id) VALUES (...)   │
│ COMMIT  ◄─── PG trigger fires NOTIFY on INSERT   │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼ pg_notify('erp_outbox', payload)
           ┌──────────────────────────┐
           │  listen-notify process   │  direct :5432, bypasses PgBouncer
           │  (1 pod, k8s-restarted)  │
           └────────────┬─────────────┘
                        │ enqueue with jobId = `listen-${event_id}`
                        ▼
                ┌───────────────┐
                │ BullMQ queue  │
                │ (routed by    │
                │  event_type)  │
                └───────┬───────┘
                        ▼
                ┌─────────────────────────────────┐
                │  Worker:                         │
                │  1. UPDATE ... RETURNING         │
                │     atomically claims row        │
                │  2. Invoke handler(payload)      │
                │  3. UPDATE status='DELIVERED'    │
                │                                  │
                │  On error: exponential backoff;  │
                │  >5 attempts → DEAD_LETTER       │
                └─────────────────────────────────┘

Fallback: 30-second BullMQ repeatable job scans outbox for PENDING rows
with expired locked_until. Catches events missed if listener is briefly
down. jobId dedup (`listen-X` vs `poll-X`) prevents double processing.
```

### 6.2 PostgreSQL Trigger

```sql
-- ops/sql/triggers/outbox_notify.sql
CREATE OR REPLACE FUNCTION outbox.fn_notify_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('erp_outbox',
    json_build_object(
      'event_id',   NEW.id::text,
      'event_type', NEW.event_type,
      'org_id',     NEW.org_id::text
    )::text);
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_notify_outbox
AFTER INSERT ON outbox.outbox_events
FOR EACH ROW EXECUTE FUNCTION outbox.fn_notify_insert();
```

### 6.3 Listener Process

```typescript
// apps/listen-notify/src/index.ts
import { Client } from 'pg';
import { Queue } from 'bullmq';
import { bullConnection } from '@erp/queue';
import { log } from '@erp/observability';

const queueFor: Record<string, 'critical' | 'high' | 'default'> = {
  'qc_inward.passed': 'critical',
  'qc_final.passed': 'critical',
  'delivery_challan.confirmed': 'critical',
  'deal.won': 'high',
  'grn.created': 'high',
  'inward.created': 'high',
  'work_order.created': 'high',
  'invoice.sent': 'default',
  'reorder.triggered': 'default',
  'batch.expiry_alert': 'default',
};

const queues = {
  critical: new Queue('critical', { connection: bullConnection }),
  high:     new Queue('high',     { connection: bullConnection }),
  default:  new Queue('default',  { connection: bullConnection }),
};

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_DIRECT_URL, // :5432, NOT via PgBouncer
  });
  client.on('error', (err) => {
    log.error({ err }, 'listener PG connection error — exiting for k8s restart');
    process.exit(1);
  });
  await client.connect();
  await client.query('LISTEN erp_outbox');

  client.on('notification', async (msg) => {
    if (msg.channel !== 'erp_outbox' || !msg.payload) return;
    const { event_id, event_type } = JSON.parse(msg.payload);
    const q = queues[queueFor[event_type] ?? 'default'];
    await q.add('outbox.processSingleEvent',
      { eventId: event_id },
      {
        jobId: `listen-${event_id}`,        // dedup with 30s poller
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 3600, count: 10_000 },
        removeOnFail:     { age: 86400 },
      });
  });

  setInterval(() => client.query('SELECT 1').catch(() => {}), 30_000);
}

main().catch((err) => { log.fatal({ err }, 'listener crashed'); process.exit(1); });
```

**Drain factory (shared by LISTEN and the 30s safety poll).** The "pick pending outbox rows → enqueue → mark dispatched" logic is extracted into `apps/listen-notify/src/drain.ts` as `createOutboxDrain({ pool, queue, batchSize })`. Both the LISTEN callback and the 30s poller call the same function. The gate-22 test (§15) imports this factory directly with a stub `QueueLike` so it exercises the real dispatch code instead of a facsimile. `QueueLike` is a local structural interface exposing only `.add()` so `apps/listen-notify` doesn't need `bullmq` as a direct dependency.

### 6.4 Outbox Processor (Atomic Claim)

```typescript
// packages/core/outbox/src/process.ts
export async function processSingleEvent({ eventId }: { eventId: string }) {
  const claimed = await dbRW.execute(sql`
    WITH claimed AS (
      UPDATE outbox.outbox_events
         SET status='PROCESSING', locked_until=NOW()+INTERVAL '60 seconds',
             attempts=attempts+1
       WHERE id=${eventId}
         AND status IN ('PENDING','FAILED')
         AND (locked_until IS NULL OR locked_until < NOW())
       RETURNING *
    ) SELECT * FROM claimed
  `);
  const row = claimed.rows[0];
  if (!row) return { skipped: 'already_claimed' };

  try {
    const handler = eventHandlers[row.event_type];
    if (!handler) throw new Error(`no handler for ${row.event_type}`);
    await handler(row.payload);
    await dbRW.execute(sql`
      UPDATE outbox.outbox_events SET status='DELIVERED', delivered_at=NOW()
      WHERE id=${eventId}
    `);
  } catch (err) {
    const terminal = (row.attempts as number) >= 5;
    const newStatus = terminal ? 'DEAD_LETTER' : 'FAILED';
    await dbRW.execute(sql`
      UPDATE outbox.outbox_events
         SET status=${newStatus}, last_error=${String(err).slice(0, 2000)}
       WHERE id=${eventId}
    `);
    if (terminal) {
      metrics.deadLetterCount.inc({ event_type: row.event_type as string });
      log.error({ err, eventId, eventType: row.event_type }, 'outbox DEAD_LETTER');
    } else {
      throw err; // BullMQ applies exponential backoff
    }
  }
}
```

### 6.5 Repeatable Jobs (No cron, No setInterval)

```typescript
// apps/worker/src/scheduler.ts — runs on worker-scheduler pod (exactly one)
const defaultQ = new Queue('default', { connection: bullConnection });

// upsertJobScheduler with a STABLE id coordinates across pods via Redis atomic ops
await defaultQ.upsertJobScheduler(
  'outbox-safety-poll',
  { every: 30_000 },
  { name: 'outbox.pollPendingBatch', data: {} }
);

await defaultQ.upsertJobScheduler(
  'batch-expiry-alerts',
  { pattern: '0 9 * * *' },  // 09:00 daily
  { name: 'inventory.checkBatchExpiry', data: {} }
);

// No node-cron, no setInterval outside this process.
// pg_cron handles DB maintenance (VACUUM, partition creation, archival).
```

### 6.6 Event Catalogue (v1)

| Event | Producer | Consumers | Queue |
|-------|----------|-----------|-------|
| `deal.won` | crm | production (createWorkOrder), procurement (createMrpIndent) | high |
| `work_order.created` | production | notifications (alert production manager) | high |
| `qc_inward.passed` | qc | inventory (recordStockIn), finance (draftPurchaseInvoice) | critical |
| `qc_final.passed` | qc | inventory (recordFinishedGoods), finance (notifyValuation), crm (notifySales) | critical |
| `grn.created` | procurement | inventory (recordStockIn), finance (draftInvoice) | high |
| `delivery_challan.confirmed` | finance | inventory (recordDispatch), finance (generateEwb), crm (whatsappNotify) | critical |
| `invoice.sent` | finance | crm (attachToDeal), notifications | default |
| `reorder.triggered` | inventory | procurement (createDraftPO), notifications | default |
| `batch.expiry_alert` | inventory | notifications | default |
| `ticket.created` | crm | notifications | default |
| `device.dispatched` | production | finance (generateInvoice), crm (notifyCustomer) | critical |
| `approval.requested` | any | notifications (assignee) | high |
| `approval.decided` | auth | any (updates entity status) | high |

---

## 7. Concurrency Strategy

### 7.1 Stock Reservation — Lock Summary, Append Ledger

```typescript
// packages/core/inventory/src/reserve.ts
export async function reserveStockAtomic(args: {
  orgId: string; userId: string;
  itemId: string; warehouseId: string; qty: Decimal;
  refDocType: string; refDocId: string;
  retries?: number;
}): Promise<
  | { status: 'RESERVED'; qty: Decimal }
  | { status: 'SHORTAGE'; available: Decimal }
> {
  const retries = args.retries ?? 3;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await withOrg(args.orgId, args.userId, async (tx) => {
        const res = await tx.execute(sql`
          SELECT total_qty, reserved_qty
            FROM inventory.stock_summary
           WHERE item_id=${args.itemId} AND warehouse_id=${args.warehouseId}
           FOR UPDATE NOWAIT
        `);
        const row = res.rows[0];
        if (!row) return { status: 'SHORTAGE' as const, available: m('0') };

        const available = m(row.total_qty as string).minus(m(row.reserved_qty as string));
        if (available.lessThan(args.qty)) {
          return { status: 'SHORTAGE' as const, available };
        }

        await tx.execute(sql`
          INSERT INTO inventory.stock_ledger
            (item_id, warehouse_id, txn_type, qty, ref_doc_type, ref_doc_id, created_by)
          VALUES
            (${args.itemId}, ${args.warehouseId}, 'RESERVATION',
             ${moneyToPg(args.qty)}, ${args.refDocType}, ${args.refDocId}, ${args.userId})
        `);
        return { status: 'RESERVED' as const, qty: args.qty };
      });
    } catch (err) {
      // pg returns SQLSTATE '55P03' (lock_not_available) for NOWAIT conflicts.
      const code = (err as { code?: string }).code;
      if (code === '55P03' && attempt < retries - 1) {
        const delay = 50 * (2 ** attempt) + Math.random() * 50;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new LockContentionError(`could not lock stock after ${retries} attempts`);
}

export async function mrpReserveAll(args: {
  orgId: string; userId: string; workOrderId: string;
  components: { itemId: string; warehouseId: string; qty: Decimal }[];
}) {
  // CANONICAL ORDER prevents MRP-vs-MRP deadlocks
  const sorted = [...args.components].sort((a, b) => a.itemId.localeCompare(b.itemId));
  return await withOrg(args.orgId, args.userId, async () => {
    for (const c of sorted) {
      const r = await reserveStockAtomic({
        orgId: args.orgId, userId: args.userId,
        itemId: c.itemId, warehouseId: c.warehouseId, qty: c.qty,
        refDocType: 'WORK_ORDER', refDocId: args.workOrderId,
        retries: 1,
      });
      if (r.status === 'SHORTAGE') throw new ShortageError(c.itemId, r.available);
    }
  });
}
```

### 7.2 Optimistic Locking — Work Order Status Transitions

```typescript
export async function advanceWoStatus(args: {
  orgId: string; userId: string;
  woId: string; expected: string; next: string;
}) {
  return await withOrg(args.orgId, args.userId, async (tx) => {
    const res = await tx.execute(sql`
      UPDATE production.work_orders SET status=${args.next}, updated_at=NOW()
       WHERE id=${args.woId} AND status=${args.expected}
       RETURNING id
    `);
    if (res.rows.length === 0) {
      const r = await tx.execute(
        sql`SELECT status FROM production.work_orders WHERE id=${args.woId}`
      );
      throw new ConflictError(`WO is in ${r.rows[0]?.status}, expected ${args.expected}`);
    }
  });
}
```

### 7.3 Deadlock Prevention Matrix

| Scenario | Risk | Prevention |
|----------|------|------------|
| Two MRPs reserve same components in different order | HIGH | Sort by `itemId` BEFORE acquiring locks — one waits, one succeeds |
| GRN induct vs MRP reservation | LOW | Trigger uses `INSERT ON CONFLICT DO UPDATE` — brief wait, no deadlock |
| Multiple workers claim same outbox event | NONE | Atomic CTE (`UPDATE...RETURNING`) — single PG statement, one winner |
| Dispatch + Order Confirmation on same serial | MEDIUM | Optimistic `UPDATE WHERE status=expected` — caller retries on zero rows |

---

## 8. Caching & Redis Architecture

### 8.1 Why Two Redis Clusters

BullMQ documentation explicitly requires `maxmemory-policy=noeviction` — queue state lives in Redis and cannot be evicted. Cache requires `volatile-lru` so keys with TTL evict under pressure. **These settings are incompatible on one instance.**

| Aspect | Redis-BULL | Redis-CACHE |
|--------|-----------|-------------|
| Purpose | BullMQ queues, jobs, repeatable schedules | Cache, JWT revocation, rate limit, SSE, circuit breaker state |
| `maxmemory-policy` | **`noeviction`** (MANDATORY) | `volatile-lru` |
| Persistence | AOF everysec | AOF everysec |
| Nodes | 3 (1 primary + 2 replicas) | 3 (1 primary + 2 replicas) |
| Impact if memory full | Writes fail → BullMQ enqueue fails → API returns 503 | Oldest keys evicted; hit rate drops; no errors |
| Impact if primary crashes | ~30s failover; stalled jobs re-claimed | ~30s failover; cache miss → PG fallback transparently |
| Memory sizing (10k users) | 12 GB/node | 16 GB/node |

### 8.2 BullMQ Worker Configuration

```typescript
// packages/queue/src/worker.ts
export function makeWorker(queueName: string, handlers: Record<string, Handler>) {
  return new Worker(
    queueName,
    async (job) => {
      const handler = handlers[job.name];
      if (!handler) throw new Error(`no handler: ${job.name}`);
      return await handler(job.data);
    },
    {
      connection: bullConnection,
      concurrency: 4,
      lockDuration: 30_000,           // auto-renewed every 15s
      stalledInterval: 30_000,
      maxStalledCount: 1,             // stall twice → permanent fail; never raise
    }
  );
}
```

### 8.3 Startup Health Check (Enforces noeviction)

```typescript
// apps/worker/src/bootstrap.ts — runs before workers start
const policy = await bullConnection.config('GET', 'maxmemory-policy');
if (policy[1] !== 'noeviction') {
  throw new Error(`Redis-BULL maxmemory-policy is '${policy[1]}', must be 'noeviction'. Refusing to start.`);
}
```

### 8.4 Cache Policy

**The single most important rule:** stock balance for RESERVATION is NEVER cached. It reads live from PG primary with `FOR UPDATE`. Cache is for display only.

| Data | Cache? | TTL | Reason |
|------|--------|-----|--------|
| Active BOM | YES | 1 hour | Read on every WO/MRP; changes only on ECN approval |
| Item master (HSN, UOM, GST) | YES | 2 hours | Referenced on every GRN, invoice, ledger entry |
| User permissions | YES | 5 min | Invalidated on role change |
| Vendor rating scores | YES | 24 hours | Computed quarterly |
| Dashboard KPIs | YES | 60s | Aggregations over millions of rows |
| WIP dashboard counts | YES | 30s | Near-real-time for Production Manager |
| Stock balance — DISPLAY | No | — | O(1) PG lookup faster than Redis round-trip |
| Stock balance — RESERVATION | **NEVER** | — | Must be `FOR UPDATE` on primary. Cache = corruption. |
| Invoice totals, balances | **NEVER** | — | Always compute from immutable ledger |
| Outbox processing state | NO | — | PG is source of truth |

### 8.5 Cache Helpers

```typescript
// packages/cache/src/index.ts
export async function cached<T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
  try {
    const hit = await redisCache.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch { /* fall through to PG */ }
  const fresh = await loader();
  redisCache.setex(key, ttlSec, JSON.stringify(fresh)).catch(() => {});
  return fresh;
}

// SCAN cursor; UNLINK (non-blocking) for batched deletion
export async function invalidateByPattern(pattern: string): Promise<number> {
  const stream = redisCache.scanStream({ match: pattern, count: 500 });
  let deleted = 0;
  for await (const keys of stream as AsyncIterable<string[]>) {
    if (keys.length) deleted += await redisCache.unlink(...keys);
  }
  return deleted;
}
// KEYS blocks Redis for seconds on large keyspaces — banned by linter.
```

---

## 9. Security & Compliance

### 9.1 Authentication Stack

- **`jose`** for JWT (full JOSE spec; better ergonomics than `jsonwebtoken`).
- **Access token**: 60 min, RS256 in prod, HS256 in dev.
- **Refresh token**: 7 days, HttpOnly + Secure + SameSite=Strict cookie, **rotated on every use** (gate 23 proves old refresh rejected after one rotation).
- **Password hashing**: `argon2id` (`memory=64MB`, `time=3`, `parallelism=4`). Never `bcryptjs`.
- **JWT claims are identity-only** (`sub`, `org`, `idn`, `roles`, `jti`, `aud`). Permissions resolved at runtime with Redis-CACHE + PG fallback.
- **Token revocation**: `jti` → `revoked:{jti}` in Redis-CACHE with TTL=token_remaining, AND to `auth.revoked_tokens` table (Redis fallback).

#### 9.1.1 Multi-Tenant Membership

A single user (`user_identities.email`) can be a member of multiple orgs via `memberships(user_id, org_id, created_at)`. `login({ email, password, surface })` returns one of:

- `authenticated` — single active membership → access + refresh issued immediately.
- `multi-tenant` — user has ≥ 2 active memberships → client must call a tenant-select endpoint with the chosen `org_id`.
- `tenant-inactive` — the targeted org is suspended/deleted; see §9.2 Tenant Lifecycle.

The login flow must read `memberships` joined to `organizations` **without being bound to a single tenant's RLS context** (there is no `app.current_org_id` set during login). This is solved with SECURITY DEFINER functions, §9.1.2.

#### 9.1.2 SECURITY DEFINER Auth Helpers

Authentication needs a few DB lookups that must cross tenant boundaries: loading a user's memberships by email, loading a refresh-token row by hash. These live as `SECURITY DEFINER` functions owned by a bootstrap role that has `BYPASSRLS`:

- `auth_load_active_memberships(email TEXT)` — returns `(user_id, org_id, org_status, role)` rows.
- `auth_load_refresh_token(token_hash TEXT)` — returns the `refresh_tokens` row regardless of org, so rotation can match a token across any tenant.

Both functions are the **only** sanctioned cross-tenant auth reads. `apps/api` connects as `instigenie_app` (`NOBYPASSRLS`) — it invokes these functions without being privileged itself. The invocation is narrow (identity-by-email, token-by-hash) and fully logged. SQL lives in `ops/sql/rls/03-auth-cross-tenant.sql`.

**Why not just bypass RLS in the auth service's connection?** Because `instigenie_app` runs both auth and business queries; giving it `BYPASSRLS` would defeat Gate 1 globally. SECURITY DEFINER functions scope the privilege to the exact two queries that need it.

### 9.2 Tenant Isolation — Defense in Depth

**Two layers enforce tenant isolation. Neither is sufficient alone.**

- **Layer 1 (application)**: every Drizzle query runs through `withOrg()`, which sets `app.current_org_id` session variable inside the transaction.
- **Layer 2 (database)**: RLS policy on every business table uses `current_setting('app.current_org_id')::UUID`. If Layer 1 is forgotten, query returns empty (or raises if setting is missing) — never data from another tenant.

```sql
-- ops/sql/rls/crm.sql (example)
ALTER TABLE crm.deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY deals_org_isolation ON crm.deals
  USING (org_id = current_setting('app.current_org_id', true)::UUID);
CREATE POLICY deals_org_isolation_write ON crm.deals
  FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true)::UUID);
-- Repeat for every business table in ops/sql/rls/*.sql
```

#### 9.2.1 Postgres Role Split (NOBYPASSRLS app + BYPASSRLS vendor)

Two application-level Postgres roles, created at bootstrap:

| Role | Attribute | Used By | Purpose |
|------|-----------|---------|---------|
| `instigenie_app` | **NOBYPASSRLS** | `apps/api`, `apps/worker`, `apps/listen-notify` | All tenant-scoped reads/writes. RLS binds. If `withOrg()` is forgotten, queries return 0 rows. |
| `instigenie_vendor` | **BYPASSRLS** | `packages/vendor-admin` only | Cross-tenant support operations (list all tenants, impersonate, audit search). Every use logged to `vendor.action_log`. |

Gate 11 (`gate-11-nobypassrls`) asserts `instigenie_app` has `NOBYPASSRLS` — a Postgres `ALTER ROLE … BYPASSRLS` would be caught in CI, not in prod.
Gate 19 (`gate-19-vendor-bypassrls`) asserts `instigenie_vendor` actually CAN read rows across orgs while `instigenie_app` cannot.
The bootstrap role (`instigenie`, `SUPERUSER`) is used only by migrations and is never exposed to app code.

#### 9.2.2 Vendor Escape Hatch (Cross-Tenant Admin)

`packages/vendor-admin` is the ONLY sanctioned cross-tenant code path. It serves the Instigenie-internal vendor admin UI (`apps/web/src/app/vendor-admin/**`) for support staff who need to see tenants holistically (list all orgs, inspect per-tenant state, suspend a tenant, impersonate a user for support).

- Connects via `VENDOR_DATABASE_URL` as `instigenie_vendor` — a separate pool, not shared with the tenant-scoped app pool.
- Separate auth surface (`vendor.admins` table, `vendor.refresh_tokens`, dedicated JWT audience `instigenie-vendor`).
- Every mutation writes a row to `vendor.action_log` (actor, target org, action, payload, timestamp) — append-only.
- Gate 18 (`gate-18-vendor-audit-log`) asserts every vendor-admin mutation produces exactly one audit row.

#### 9.2.3 Tenant Lifecycle States

An `organizations.status` column with `TenantStatusService.assertActive(orgId)` invoked by the auth middleware on every request. States:

| Status | Meaning | Auth behavior |
|--------|---------|---------------|
| `active` | Normal | Allow |
| `suspended` | Billing failure, policy breach, or ops pause | Reject: login returns `tenant-inactive`; existing access tokens fail next auth check with 403. |
| `deleted` | Soft-deleted; rows retained for audit | Same as `suspended`; data retained but read-only and only via `instigenie_vendor`. |

Gate 15 (`gate-15-tenant-status-guard`) asserts a suspended org's users cannot auth. State transitions are vendor-admin-only.

### 9.3 HTTP Security

```typescript
// apps/api/src/plugins/security.ts
await fastify.register(helmet, {
  contentSecurityPolicy: { directives: { /* per-environment */ } },
});
await fastify.register(cors, {
  origin: process.env.FRONTEND_URLS!.split(','),
  credentials: true,
});
await fastify.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
  // Composite key: prevents DoS against a user via their userId
  keyGenerator: (req) => req.user?.id ? `${req.user.id}:${req.ip}` : req.ip,
  redis: redisCache,
});

// Stricter limits on auth endpoints
fastify.post('/auth/login',
  { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
  loginHandler
);
```

### 9.4 RBAC — Roles, Permission Format, Capability Layer

Authorization has **three orthogonal layers**. A user must pass all three to perform an action: (1) correct JWT audience, (2) role-granted permission, (3) operator capability (for shop-floor actions).

#### 9.4.1 Roles (12 — matches `src/store/auth.store.ts`)

These role names are **locked** — the frontend's `useAuthStore`, `can()` calls, and `<Guard>` components depend on them verbatim. Renaming requires a coordinated FE/BE change.

| Role | JWT `aud` | Scope |
|------|-----------|-------|
| `SUPER_ADMIN` | `instigenie-internal` | Cross-tenant (Instigenie internal), admin UI access, role assignment |
| `MANAGEMENT` | `instigenie-internal` | Senior management approvals (> ₹20L), deal win/loss, WO cancel, QC override, ECN approve |
| `SALES_REP` | `instigenie-internal` | Own leads / deals / quotations, mark deal won/lost |
| `SALES_MANAGER` | `instigenie-internal` | All sales team deals, approve discounts > 15% |
| `FINANCE` | `instigenie-internal` | Invoice create/post, PO finance approval (₹5L–₹20L) |
| `PRODUCTION` | `instigenie-internal` | Stage advance, WO create (no cancel) |
| `PRODUCTION_MANAGER` | `instigenie-internal` | WO create/cancel, stage advance, BOM edit, BMR production-sign |
| `RD` | `instigenie-internal` | BOM edit, ECN initiate |
| `QC_INSPECTOR` | `instigenie-internal` | QC inspection submit, BMR QC-sign, calibration record |
| `QC_MANAGER` | `instigenie-internal` | QC override, batch quarantine, device release electronic signature |
| `STORES` | `instigenie-internal` | Stock adjust, warehouse operations |
| `CUSTOMER` | `instigenie-portal` | Portal-only — view own orders / invoices, create tickets |

#### 9.4.2 Permission String Format (Contract)

All permissions follow `resource:action` — **exactly two colon-delimited parts**, both snake_case.

- `resource` = snake_case plural noun (e.g. `deals`, `work_orders`, `purchase_orders`, `wip_stages`)
- `action` = snake_case verb or qualifier (e.g. `write`, `create`, `cancel`, `approve_finance`, `mark_won`)
- **Never** three parts (`po:approve:finance` ✗). Qualified actions use underscore (`approve_finance` ✓).

The complete catalogue lives in `packages/contracts/src/permissions.ts` as a typed string-literal union. Both `apps/api` (route guards) and `apps/web` (`<Guard permission="...">`) import from this single source.

```ts
// packages/contracts/src/permissions.ts (illustrative excerpt)
export const PERMISSIONS = [
  // CRM
  "deals:write", "deals:mark_won", "deals:mark_lost",
  "quotations:create", "quotations:send",
  "tickets:create", "tickets:close",
  // Production
  "work_orders:create", "work_orders:cancel", "work_orders:approve",
  "wip_stages:advance", "bom:edit", "ecn:initiate", "ecn:approve",
  "bmr:sign_production", "bmr:sign_qc", "scrap:record",
  // QC
  "qc:submit_inspection", "qc:override", "qc:release_device",
  "ncr:initiate", "ncr:close", "batches:quarantine", "capa:create",
  // Procurement
  "purchase_orders:create", "purchase_orders:approve_procurement",
  "purchase_orders:approve_finance", "purchase_orders:approve_management",
  "vendors:write", "grn:create",
  // Finance
  "invoices:create", "invoices:post", "invoices:approve",
  "payments:record", "ewb:generate", "gst:file",
  // Inventory
  "stock:adjust", "stock:transfer", "items:write",
  // Admin
  "users:provision", "roles:assign", "permissions:audit",
] as const;
export type Permission = typeof PERMISSIONS[number];
```

#### 9.4.3 Operator Capability Layer (Shop-Floor Only)

Roles are insufficient for shop-floor actions: two `PRODUCTION` role users can have different **competencies**. Capability is enforced via `production.operator_capability` table, joined at stage-log time.

```ts
// Shape (enforced by DB check constraints + API guard)
type OperatorCapability = {
  userId: string;
  tier: "T1" | "T2" | "T3";
  permittedLines: ("L1" | "L2" | "L3" | "L4" | "L5")[];
  canPCBRework: boolean;
  canOCAssembly: boolean;
  isDeputyHOD: boolean;
  shift: "SHIFT_1" | "SHIFT_2" | null;
  validFrom: Date;
  validTo: Date | null;  // null = active
};
```

Rule enforced in `production.stage.service.ts`:
```
if (!capability.permittedLines.includes(stage.line)) → 403 + audit row
if (stage.requiresPCBRework && !capability.canPCBRework) → 403 + audit row
if (stage.requiresOCAssembly && !capability.canOCAssembly) → 403 + audit row
```

Capability changes produce an `audit.operator_capability_change` row with supervisor signature (electronic signature flow, §9.5). Only `SUPER_ADMIN` and `PRODUCTION_MANAGER` can modify capability.

### 9.5 Audit Layer (21 CFR Part 11 + ISO 13485)

**A simple "log every mutation" hook is not sufficient.** Real compliance requires:

1. **Immutable storage**: `audit_log` is append-only (PG trigger rejects UPDATE/DELETE), partitioned monthly, archived to MinIO as JSONL after 90 days (queryable via DuckDB).
2. **Before/after state**: mutations capture previous and new row values.
3. **Identity binding**: every audit row carries `user_id`, `org_id`, `ip`, `user_agent`, `trace_id`.
4. **Electronic signatures**: critical actions (QC final pass, invoice issue, stock write-off, device release) require password re-entry. Signature hash stored in audit row.
5. **Tamper evidence**: each audit row stores SHA-256 hash of `(prev_row_hash || current_row_data)`. A daily `pg_cron` job verifies the chain; any break triggers a CRITICAL alert.
6. **Cannot be bypassed**: writes to audited tables go through PG triggers that write audit rows. Application code cannot skip it.

```sql
-- ops/sql/triggers/audit.sql
CREATE OR REPLACE FUNCTION audit.fn_audit_row()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  prev_hash BYTEA;
  row_data  JSONB;
BEGIN
  row_data := row_to_json(NEW)::jsonb;
  SELECT hash INTO prev_hash FROM audit.audit_log ORDER BY created_at DESC LIMIT 1;
  INSERT INTO audit.audit_log (
    table_name, record_id, action,
    user_id, org_id,
    before_data, after_data,
    trace_id, created_at, hash
  ) VALUES (
    TG_TABLE_NAME, NEW.id, TG_OP,
    current_setting('app.current_user_id', true)::UUID,
    current_setting('app.current_org_id',  true)::UUID,
    CASE WHEN TG_OP='UPDATE' THEN row_to_json(OLD)::jsonb ELSE NULL END,
    row_data,
    current_setting('app.trace_id', true),
    NOW(),
    digest(coalesce(prev_hash::text,'') || row_data::text, 'sha256')
  );
  RETURN NEW;
END; $$;

-- audit_log is append-only:
CREATE RULE audit_log_no_update AS ON UPDATE TO audit.audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit.audit_log DO INSTEAD NOTHING;
```

### 9.6 Subscription & Entitlements (Feature Flags + Quotas)

Every org has exactly one active subscription. The subscription determines which feature flags are available and which numeric quotas apply. `packages/quotas` is the single read path.

#### 9.6.1 Data Model (public schema)

- `plans` — catalogue rows: `id`, `code` (`starter`, `pro`, `enterprise`), `name`, `price_cents`.
- `plan_features` — flag/quota rows keyed by `(plan_id, feature_code)`. A row is either a boolean flag (e.g. `module.crm = true`) or a numeric quota (e.g. `crm.leads.max_per_month = 500`).
- `subscriptions` — `(org_id, plan_id, status, starts_at, ends_at)`. Exactly one active row per org.
- `usage_records` — rolling counters (`org_id, feature_code, period_start, count`). Written by services at mutation time; read by `QuotaService`.

Dev seeds: `ops/sql/seed/05-plans-catalog.sql` (plans + features), `ops/sql/seed/06-dev-subscription.sql` (dev org on `pro`).

#### 9.6.2 Service Shape (`packages/quotas`)

- `FeatureFlagService.isEnabled(orgId, featureCode) → Promise<boolean>`
- `QuotaService.assertUnder(orgId, featureCode) → Promise<void>` — throws `quota_exceeded` (402) if `usage_records.count >= plan_features.value`.
- `PlanResolverService.plansForOrg(orgId)` — used by vendor-admin to surface current plan in support UI.

All three read via `instigenie_app` with RLS bound. Cache TTL 60s in Redis-CACHE. Cache key `ff:{orgId}:{featureCode}`.

#### 9.6.3 Enforcement Pattern (Fastify)

Every CRM / domain route that is plan-gated has **two** `preHandler` steps in addition to auth:

```ts
{
  preHandler: [
    authGuard,
    requireFeature('module.crm'),            // 402 if off
    requirePermission('leads:write'),         // 403 if role lacks it
  ]
}
```

`requireFeature` short-circuits before the permission check, so a customer on the `starter` plan gets a clear "upgrade required" signal and we don't leak which permissions the route needs. Gate 16 (`gate-16-feature-flags`) asserts the 402 path; Gate 17 (`gate-17-quota-enforcement`) asserts quotas throw before the mutation runs.

---

## 10. Observability

### 10.1 Stack

- **OpenTelemetry SDK** with Node auto-instrumentation (fastify, http, pg, ioredis, bullmq, undici).
- **pino** structured JSON logs → Promtail → Loki. Every log line carries `trace_id`, `span_id`, `user_id`, `org_id`.
- **Prometheus** scrapes `/metrics`; BullMQ metrics, PG pool utilization, HTTP histograms, custom business counters (`deadLetterCount`, `stockDriftCount`).
- **Grafana** dashboards: Business Ops, System Health, Event System, DB Performance.
- **Alertmanager** routes: PagerDuty (CRITICAL), Slack (HIGH), Email (MEDIUM).

#### 10.1.1 `initTracing()` Test-Injection Contract

`packages/observability/src/tracing.ts` exposes two optional hooks on `InitTracingOptions` for tests:

- `traceExporter?: SpanExporter` — swap the OTLP exporter for an `InMemorySpanExporter` so assertions can read spans without Jaeger.
- `spanProcessor?: SpanProcessor` — replaces the default `BatchSpanProcessor(OTLPExporter)` entirely. Tests pass `SimpleSpanProcessor(exporter)` to get synchronous export (Batch's 5s flush window exceeds test budgets).

**Vitest + auto-instrumentation gotcha (gate 24):** Vitest loads modules through vite's transformer, which **bypasses Node's `require-in-the-middle` hook**. That means `import pg from "pg"` inside a test file never triggers the OpenTelemetry PgInstrumentation patch and no pg spans are produced. Workaround: after `initTracing()` runs, load pg and `node:http` via `createRequire(import.meta.url)` so the real CJS require fires through Node's native loader. This is only a test concern — production apps import at module top and auto-instrumentation patches them normally because their entry point calls `initTracing()` before any other `import` is resolved.

A secondary concern: NodeSDK bundles its own `sdk-trace-base` one minor version behind `@instigenie/observability`'s direct dep, so `SpanProcessor` from the two copies have separate private-member identities. We `as unknown as` the cast at the one assignment site (safe — there's one real class at runtime).

### 10.2 Health Check (Must Actually Detect Failure)

```typescript
// apps/api/src/routes/health.ts
fastify.get('/health', async () => {
  const checks = await Promise.allSettled([
    // pg_is_in_recovery fails loudly on the primary if PG is down
    dbRW.execute(sql`SELECT pg_is_in_recovery()`),
    dbRO.execute(sql`SELECT 1`),
    redisCache.ping(),
    bullConnection.ping(),
  ]);
  const [pgRW, pgRO, cache, bull] = checks.map(c => c.status === 'fulfilled' ? 'ok' : 'down');
  const healthy = pgRW === 'ok' && pgRO === 'ok' && cache === 'ok' && bull === 'ok';
  return {
    status: healthy ? 'ok' : 'degraded',
    components: { pgRW, pgRO, cache, bull },
    uptime: process.uptime(),
    version: process.env.RELEASE_VERSION,
    timestamp: new Date().toISOString(),
  };
});
```

### 10.3 Critical Alerts

| Alert | Threshold | Severity | Action |
|-------|-----------|----------|--------|
| `erp_outbox_pending_age_max_seconds` | > 120s | HIGH | Listener or worker stuck |
| `erp_outbox_dead_letter_count` | > 0 | CRITICAL | Permanent event failure |
| `erp_stock_drift_detected` | > 0 | CRITICAL | Summary vs ledger mismatch — **STOP TRADING** |
| `erp_audit_chain_break` | > 0 | CRITICAL | Audit integrity compromised — compliance incident |
| `erp_pg_replication_lag_seconds` | > 10s | HIGH | Route reports to primary |
| `erp_bullmq_queue_depth{queue="critical"}` | > 50 | CRITICAL | Scale worker-critical |
| `erp_bullmq_stalled_count_total` | > 5/10min | HIGH | Blocking code in workers |
| `erp_bull_redis_memory_used_pct` | > 80% | CRITICAL | `noeviction` → OOM imminent |
| `erp_api_p99_latency_ms` | > 2000ms | HIGH | Slow query or pool wait |
| `erp_api_error_rate_5xx` | > 1% | HIGH | Check logs + traces |
| `erp_backup_last_success_hours` | > 25h | CRITICAL | Backup missed |

---

## 11. Infrastructure & Deployment

### 11.1 Docker Compose (Production, Abbreviated)

```yaml
services:
  next-web:
    image: instigenie-erp/next:${VERSION}
    command: node apps/web/server.js
    deploy: { replicas: 3, resources: { limits: { cpus: '2', memory: 1G } } }

  api:
    image: instigenie-erp/api:${VERSION}
    command: node --require @erp/observability/otel apps/api/dist/server.js
    deploy:
      replicas: 8
      update_config: { parallelism: 1, delay: 30s, failure_action: rollback }

  worker-critical:
    command: node apps/worker/dist/critical.js
    deploy: { replicas: 2 }

  worker-high:
    deploy: { replicas: 3 }

  worker-default:
    deploy: { replicas: 2 }

  worker-pdf:
    command: node apps/worker/dist/pdf.js
    deploy: { replicas: 1 }
    # ISOLATED — @react-pdf/renderer memory cannot affect business workers

  worker-scheduler:
    command: node apps/worker/dist/scheduler.js
    deploy: { replicas: 1 }   # EXACTLY ONE

  listen-notify:
    environment:
      DATABASE_DIRECT_URL: postgres://erp:****@postgres-primary:5432/erp
    deploy: { replicas: 1 }

  pgbouncer:
    image: bitnami/pgbouncer:1.21
    deploy: { replicas: 2 }   # eliminate SPOF at mid-scale
```

### 11.2 Hardware Sizing

| Component | 1k Users | 5k Users | 10k Users |
|-----------|----------|----------|-----------|
| `next-web` pods | 2×(2vCPU/1GB) | 3×(2vCPU/1GB) | 4×(2vCPU/1GB) |
| `api` pods (Fastify) | 4×(2vCPU/1.5GB) | 8×(2vCPU/1.5GB) | 12×(2vCPU/1.5GB) |
| `worker` pods (all queues) | 6×(2vCPU/2GB) | 10×(2vCPU/2.5GB) | 16×(2vCPU/3GB) |
| `listener` pods | 1×(0.5vCPU/256MB) | 1 | 1 |
| PG Primary | 8vCPU/32GB/SSD | 16vCPU/64GB/NVMe | 32vCPU/128GB/NVMe |
| PG Replica | 4vCPU/16GB | 8vCPU/32GB | 2×(16vCPU/64GB) |
| Redis-BULL (3 nodes) | 3×(2vCPU/4GB) | 3×(2vCPU/8GB) | 3×(4vCPU/12GB) |
| Redis-CACHE (3 nodes) | 3×(2vCPU/4GB) | 3×(2vCPU/8GB) | 3×(4vCPU/16GB) |
| MinIO | 1×(2vCPU/4GB/500GB) | 1×(4vCPU/8GB/2TB) | 3×(4vCPU/8GB/4TB) |
| Est. monthly cost (cloud) | $400–650 | $900–1,500 | $1,800–3,000 |

### 11.3 Startup Order (Dependency Chain)

1. PostgreSQL primary + replicas (triggers, RLS, `pg_partman`, `pg_cron` applied)
2. PgBouncer (transaction mode confirmed)
3. Redis-BULL Sentinel cluster (noeviction verified by startup check)
4. Redis-CACHE Sentinel cluster (volatile-lru)
5. `worker-scheduler` (idempotent registration of repeatable jobs)
6. `listen-notify` (LISTEN registered on direct PG)
7. Workers: critical, high, default, pdf
8. `api` (Fastify) — readiness probe fails until PG + Redis-BULL reachable
9. `next-web`
10. NGINX routes traffic

#### 11.3.1 Boot-Time Invariant Asserts (Rule §2.17)

Each process refuses to start if a critical invariant is violated. This is **not** a readiness probe — these checks run once, synchronously, before the process announces itself ready. A failure is a fatal exit.

| Process | Assert | Module | Failure Behavior |
|---------|--------|--------|------------------|
| `listen-notify` | `DATABASE_DIRECT_URL` does not route through PgBouncer (port != PGBOUNCER_PORT, hostname doesn't match banned substring list) | `packages/db/src/direct-url.ts` → `assertDirectPgUrl()` → throws `PgBouncerUrlError` | Fatal exit, k8s doesn't restart until env is fixed |
| `listen-notify` (probe) | Redis-BULL `maxmemory-policy == noeviction` | `packages/queue/src/noeviction.ts` → `assertBullRedisNoeviction()` → throws `BullEvictionPolicyError` | Fatal exit |
| `worker-*` | Redis-BULL `maxmemory-policy == noeviction` | Same as above | Fatal exit |
| `worker-scheduler` | Bootstrap policy check (plus noeviction probe) | `packages/queue` → `runBootstrapPolicy()` | Fatal exit |
| `api` | Tenant status bootstrap (status table exists, `TenantStatusService` can read it) | `packages/tenants` | Fatal exit |

Gate tests that enforce these (gate-20 PgBouncer URL guard, gate-21 noeviction, gate-22 outbox e2e) import the real assert functions directly — Rule §2.16 ("gate tests import the same module production uses").

### 11.4 Failure & Resilience Matrix

| Failure | Detection | Auto Response | Manual Step |
|---------|-----------|---------------|-------------|
| PG primary crash | PgBouncer health check | Patroni promotes replica; PgBouncer reconnects; writes fail ~30s | Update DATABASE_URL; rolling restart api |
| Replica lag > 10s | Prometheus alert | Reports route to primary temporarily | Investigate replica I/O |
| Redis-BULL primary crash | Sentinel | Replica promoted ~30s; 503 for event-producing writes during window | Replace failed node ≤24h |
| Redis-BULL out of memory | Prometheus | Writes fail loudly (noeviction) — API surfaces clear error | Scale Redis-BULL memory |
| Redis-CACHE primary crash | Sentinel | Replica promoted; cache miss → PG fallback transparently | Replace failed node |
| Worker pod crash | K8s liveness | K8s restarts; stalled job re-delivered after `lockDuration` | None — automatic |
| Listener process crash | pino fatal + k8s | Pod restarts ≤5s; 30s poller is the safety net | None — automatic |
| NIC EWB API down | Circuit breaker 5 fails | Circuit opens; Finance alerted; dispatch proceeds | Finance generates EWB manually |
| WhatsApp API down | 3 consecutive fails | Email fallback; WhatsApp queued | None |
| MinIO down | PDF write errors | PDF jobs retry 3× @60s | Restore MinIO; jobs auto-retry |
| PgBouncer down | App connection errors | 2 replicas eliminate SPOF | Restart failed pod |

---

## 12. Phased Build Plan

**Four phases. Each has hard deliverables and correctness gates that must pass before the next phase starts.**

> The temptation will be to jump ahead before gates close. **Resist it.** The gates exist because skipping them produces a system that demos well but fails in production.

### 12.1 Timeline Summary

| Phase | Duration | Theme | Gates |
|-------|----------|-------|-------|
| **Phase 1** | Weeks 1–2 | Foundation skeleton | 7 gates (1–7) |
| **Phase 2** | Weeks 3–8 | Core Domain CRUD | 4 gates (8–11) |
| **Phase 3** | Weeks 9–14 | Workflows, Events, Integrations | 5 gates (12–16) |
| **Phase 4** | Weeks 15–20 | Compliance, PDF, Hardening | 5 gates (17–21) |

**Honest estimate:** 14–20 weeks (team size 1–3 devs). The doc's 10-week version assumes 3 devs + ops support.

---

### PHASE 1 — Foundation (Weeks 1–2)

**Goal:** a correctly wired skeleton. **No business features.** Every rule in §2 is enforceable before any business code is written.

#### 1.1 Deliverables

- Monorepo scaffolded (pnpm workspace + Turborepo). Apps: `web`, `api`, `worker`, `listen-notify`. Packages: `db`, `money`, `queue`, `contracts`, `observability`, `errors`, `cache`, `resilience`, `config`.
- `packages/db`: Drizzle wired with `withOrg()`; pg type parsers for NUMERIC and INT8; two pools (primary + replica); startup refuses to run if unable to reach both.
- `packages/money`: decimal.js helpers, linter rule blocking `Number`/`parseFloat` inside money files.
- PostgreSQL local dev: 10 schemas created; `outbox_events` and `audit_log` tables with triggers; one business table (`auth.users`) for end-to-end testing.
- Two local Redis containers (redis-bull with `noeviction`, redis-cache with `volatile-lru`). Bootstrap check refuses to start workers if policy wrong.
- `apps/listen-notify`: connects on :5432, LISTENs on `erp_outbox`, enqueues to BullMQ. Verified end-to-end with manual INSERT.
- `apps/worker/critical`: processes `outbox.processSingleEvent` with atomic CTE claim; unit + integration tested.
- `apps/worker/scheduler`: registers `outbox-safety-poll` (30s) as a stable repeatable job.
- `apps/api`: Fastify 5 bootstrap with helmet, cors, rate-limit (Redis-CACHE backed), pino, zod-openapi, error handler, health check. Auth module: `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`. `argon2id` password hashing. `jose` JWT with RS256.
- OpenTelemetry wired via `--require`; traces HTTP → pg → ioredis → bullmq visible in local Tempo/Jaeger.
- CI: typecheck + lint (inc. `eslint-plugin-boundaries`) + unit + integration tests against ephemeral PG and both Redis.
- `docker-compose.dev.yml` brings up everything with one command.

#### 1.2 Correctness Gates (All Must Pass Before Phase 2)

| Gate | What it proves |
|------|---------------|
| **Gate 1 — RLS works** | Two rows with different `org_ids`; SELECT with session var set to one org returns only one row. Verified in CI. |
| **Gate 2 — Decimal integrity** | Ingest ledger row with `qty='0.100000000000000005'`, read back, assert exact string match. Test fails if NUMERIC was parsed as Number anywhere. |
| **Gate 3 — Outbox end-to-end** | Insert outbox row via business code; within 3s worker claims it, handler runs, status → DELIVERED. Kill listener mid-flight; within 35s the 30s poller catches pending row. Both scenarios automated. |
| **Gate 4 — BullMQ noeviction enforced** | Integration test flips redis-bull to `allkeys-lru`, starts worker, asserts it refuses to start. |
| **Gate 5 — Listener bypasses PgBouncer** | Integration test fails if `DATABASE_DIRECT_URL` points through PgBouncer (connection string check). |
| **Gate 6 — Auth flow** | Login → access+refresh → access expires → refresh rotates → old refresh rejected. JWT revocation sets Redis key and PG row; both checked on next request. |
| **Gate 7 — OTel traces connect** | A single HTTP request appears as one trace with child spans for pg query and Redis get. Verified against Jaeger in CI. |

**Reinforcement gates (20–24).** During Phase 1 hardening, each of gates 3–7 gained a paired "reinforcement" gate that exercises the REAL production code path (Rule §2.16) rather than a facsimile: gate 20 imports `assertDirectPgUrl`, gate 21 imports `assertBullRedisNoeviction`, gate 22 imports `createOutboxDrain`, gate 23 exercises `AuthService.refresh()` directly, gate 24 uses `InMemorySpanExporter` via `initTracing`'s `spanProcessor` hook. The consolidated list is in §15.

#### 1.3 Explicitly Deferred

- Any business entity (leads, deals, WOs). Only `auth.users` exists.
- PDF generation. Worker scaffold exists; handler is a stub.
- Cache layer usage. Package exists; no feature uses it yet.
- Circuit breakers. Package exists; no external API integrated yet.
- Frontend business pages. Placeholder with `/auth/login` calling the API.

---

### PHASE 2 — Core Domain Modules (Weeks 3–8)

**Goal:** the nine domain modules have CRUD, validation, RLS enforcement, and shared zod contracts. **No workflows or cross-module events yet.**

#### 2.1 Module Priority Order

Build in this order; each depends on the previous only for types, not runtime.

1. **auth** (Phase 1 extended) — roles, permissions, user_roles, `invalidatePerms` flow
2. **crm** — leads, accounts, deals, quotations, orders, tickets. *Connects to frontend first.*
3. **inventory** — items, warehouses, stock_summary (no reservation logic yet — Phase 3). `stock_ledger` table exists with triggers already
4. **procurement** — vendors, indents, purchase_orders, grns (CRUD only, no approval workflow yet)
5. **production** — products, bom_versions, work_orders, device_ids, wip_stages (status field exists but transitions unenforced)
6. **qc** — inspection_templates, qc_inspections, qc_certs (certs recorded; PDF is Phase 4)
7. **finance** — sales_invoices, customer_ledger (ledger writes via trigger; EWB is Phase 3)
8. **notifications** — templates, log (record-only; dispatch is Phase 3)

#### 2.2 Module Pattern (Every Module Follows)

```
packages/core/{module}/src/
├── index.ts                    # public API — exports service classes + types
├── schema.ts                   # Drizzle table definitions (re-exported from @erp/db)
├── {entity}.service.ts         # business logic — one service per entity
├── {entity}.repository.ts      # DB access — MUST use withOrg()
└── {entity}.test.ts            # unit + integration

apps/api/src/routes/{module}/
├── index.ts                    # route registration
├── {entity}.routes.ts          # HTTP layer — NO business logic
└── {entity}.schema.ts          # fastify schema wired from @erp/contracts

packages/contracts/src/
└── {module}.ts                 # zod schemas — shared with frontend
```

#### 2.3 Deliverables

- Every module has full CRUD (list, get, create, update, soft-delete) except ledger tables.
- Every list endpoint uses standard pagination helper (`page`/`limit`/`sortBy`/`sortDir`), limit capped at 100, returns `{data, meta}`.
- Every mutation endpoint has a Zod schema in `@erp/contracts`; frontend imports the same schema for form validation.
- RBAC: roles seeded (see §9.4). Every route has a `preHandler` checking required permissions.
- Next.js frontend wires forms to typed API client from shared zod schemas. **Mock services swapped for real calls.**
- Integration tests for every service covering happy path + one RLS cross-tenant test per module.

#### 2.4 Correctness Gates

| Gate | What it proves |
|------|---------------|
| **Gate 8 — Cross-tenant isolation** | For EVERY module, integration test confirms user from org A cannot read/update/delete a row in org B, at both API (404) and RLS layer (0 rows). |
| **Gate 9 — Schema drift check** | CI builds both frontend and backend from `@instigenie/contracts`; if the zod schemas don't satisfy both, CI fails. *(Not yet implemented — see §15 gap list.)* |
| **Gate 10 — Pagination limits** | Fuzz test sends `page=99999, limit=5000`; API returns `limit=100` and does not OOM. |
| **Gate 11 — Audit trail / NOBYPASSRLS** | Historic v1.1 intent was audit-trail hash chain; the implemented gate-11 instead asserts `instigenie_app` has `NOBYPASSRLS`. Audit-trail coverage is tracked as an open gap (§15). |

**Additional Phase 2 gates that shipped (11–19).** Multi-tenancy hardening produced extra gates beyond the original four. §15 has the full catalogue, but in summary:
- Gate 11 — `instigenie_app` is `NOBYPASSRLS`.
- Gate 12 — every org-scoped table has an RLS policy.
- Gate 13 — RLS `WITH CHECK` prevents cross-tenant inserts.
- Gate 14 — tenant lifecycle schema present.
- Gate 15 — suspended tenants' users can't auth.
- Gate 16 — feature flags return 402 when disabled.
- Gate 17 — quota exceeded throws before mutation.
- Gate 18 — every vendor-admin mutation writes an audit row.
- Gate 19 — `instigenie_vendor` actually can read cross-tenant rows while `instigenie_app` cannot.

#### 2.5 Explicitly Deferred

- **Cross-module events.** Any module that "would" publish writes a `TODO` with the event name; no outbox rows created yet.
- **Stock reservation.** Items have `stock_summary` rows but MRP + WO reservation are Phase 3.
- **Approval workflows.** Status transitions unenforced.
- **PDF generation.** Phase 4.
- **External APIs** (WhatsApp, EWB, GST). Phase 3.

---

### PHASE 3 — Workflows, Events, External Integrations (Weeks 9–14)

**Goal:** the modules talk to each other via the outbox. Approval workflows are enforced. Stock reservation works under concurrency. External APIs are wrapped in circuit breakers.

#### 3.1 Event Handlers (§6.6 catalogue, end-to-end)

- `deal.won` → `production.createWorkOrder` + `procurement.createMrpIndent`
- `qc_inward.passed` → `inventory.recordStockIn` + `finance.draftPurchaseInvoice`
- `qc_final.passed` → `inventory.recordFinishedGoods` + `finance.notifyValuation` + `crm.notifySales`
- `delivery_challan.confirmed` → `inventory.recordDispatch` + `finance.generateEwb` + `crm.whatsappNotify`
- `grn.created`, `inward.created`, `work_order.created`, `invoice.sent`, `reorder.triggered`, `batch.expiry_alert`, `device.dispatched`

#### 3.2 Stock Reservation

- `reserveStockAtomic()` with `FOR UPDATE NOWAIT`, SQLSTATE-based retry, jittered exponential backoff.
- `mrpReserveAll()` with canonical `itemId` ordering.
- Stock trigger (`stock_ledger → stock_summary`) with concurrent-load test: 100 concurrent reservations against same item, no drift, no deadlocks.

#### 3.3 Approval Workflows

`workflow_transitions` table + `ApprovalRequest` + `ApprovalStep` entities.

| Entity | Approval Chain |
|--------|---------------|
| Work Order | Production Manager → Finance (if value > ₹5L) → Senior Management (if > ₹20L) |
| Purchase Order | Procurement Lead → Finance → Senior Management (if > ₹10L) |
| Deal discount > 15% | Sales Manager → Finance |
| Raw material issue | Production Manager confirmation |
| Device release (QC final) | QC Inspector + electronic signature |
| Invoice issue | Finance Manager → Senior Mgmt (if > ₹20L) |

#### 3.4 External APIs (Each Wrapped in Circuit Breaker)

- **NIC EWB API (e-Way Bill)** — failure threshold 5, recovery 300s. Fallback: manual entry queue for Finance.
- **GSTN API** — failure threshold 3, recovery 60s.
- **WhatsApp Business API** — failure threshold 5, recovery 120s. Fallback: email.

#### 3.5 Caching Enabled

- BOM cache (1h), item master (2h), permissions (5min), dashboard KPI (60s), WIP dashboard (30s).
- Invalidation via SCAN-based helper; `KEYS` usage banned by linter.

#### 3.6 Correctness Gates

| Gate | What it proves |
|------|---------------|
| **Gate 12 — Stock correctness under load** | k6 drives 100 concurrent reservations over 10s across 20 items. Post: for every item, `stock_summary.reserved_qty = SUM(stock_ledger.qty WHERE txn_type='RESERVATION')`. **Zero drift permitted.** |
| **Gate 13 — Event latency SLO** | k6 simulates 50 `deal.won` events in 60s; p95 delivery latency < 5s; p99 < 10s. CI fails on regression. |
| **Gate 14 — Deadlock-free MRP** | 20 concurrent MRPs on overlapping component sets run to completion with zero deadlock errors in PG logs. |
| **Gate 15 — Circuit breaker** | Kill EWB mock API; circuit opens after 5 failures; fallback queue receives job; Finance alert fires; after 300s + mock restored, circuit half-opens and recovers. |
| **Gate 16 — Approval workflow immutability** | Once an approval step is APPROVED/REJECTED, any attempt to mutate returns 409 and is logged. |

#### 3.7 Explicitly Deferred

- **PDF rendering.** Events that reference PDFs write placeholder path; Phase 4 fills in.
- **MinIO production setup.** Phase 3 uses local FS; Phase 4 swaps to MinIO.
- **Electronic signatures + hash-chain verification.** Foundations exist; Phase 4 fills in.

---

### PHASE 4 — Compliance, PDF, Hardening (Weeks 15–20)

**Goal:** close the compliance loop and harden for production launch.

#### 4.1 PDF Generation

- `@react-pdf/renderer` components: QC Certificate, Sales Invoice, Purchase Order, Delivery Challan, GRN.
- `worker-pdf` process renders → streams to MinIO → stores object URL on entity → status `PDF_GENERATED`.
- Retry policy: 3 attempts @ 60s backoff; dead-letter on permanent failure.

#### 4.2 Compliance (21 CFR Part 11)

- **Electronic signature flow**: QC final pass, invoice issue, write-off, device release require re-entry of password. Signature hash stored in audit row.
- **Hash-chain verification** `pg_cron` job (daily at 02:00). Breaks trigger `erp_audit_chain_break` alert.
- **Archive `pg_cron`**: `audit_log` and `stock_ledger` partitions > 90 days → MinIO JSONL → `pg_partman` detach → DROP. Archived data queryable via DuckDB (recipe documented).
- **Admin audit dashboard**: search by user/entity/date-range, with `trace_id` deep-link to Loki/Tempo.

#### 4.3 Production Hardening

- MinIO 3-node cluster at target scale. Lifecycle policy for old PDFs.
- Second PgBouncer replica. Leader-elected second listener process (Redis lock).
- All Prometheus alerts (§10.3) wired to Alertmanager and routed.
- Runbooks: on-call playbooks for every CRITICAL alert.
- **Backup**: `pg_basebackup` nightly to MinIO; logical replication slot for DR; quarterly restore drill.
- **Security**: DDoS via Cloudflare; WAF rules; secret rotation via Vault or cloud KMS; no secrets in committed env files.
- **Load test** at target scale: 10k users (500 concurrent) for 1 hour. No drift, no dead letters, no alerts.

#### 4.4 Correctness Gates (Go-Live)

| Gate | What it proves |
|------|---------------|
| **Gate 17 — Sustained load** | 1-hour soak at 500 concurrent; p99 API < 2s; 5xx < 0.1%; zero stock drift; zero dead letters. |
| **Gate 18 — DR drill** | Simulate PG primary loss. Replica promoted; reads+writes resume; no lost events (outbox drained after failover). |
| **Gate 19 — Audit integrity** | Daily hash chain verifies; manual attempt to UPDATE audit_log rejected by PG rule; DELETE rejected. |
| **Gate 20 — Compliance walk-through** | ISO 13485 + Part 11 checklist reviewed by compliance lead; signatures, audit, immutability demonstrated. |
| **Gate 21 — Runbooks executable** | On-call engineer executes every CRITICAL alert runbook against staging failure injection. |

---

## 13. Module Roadmap

### 13.1 CRM Module (Phase 2)

**Tables:** `leads`, `accounts`, `contacts`, `companies`, `deals`, `deal_line_items`, `quotations`, `orders`, `activities`, `tickets`.

**Key entities & lifecycle:**

- **Lead**: `NEW → CONTACTED → QUALIFIED → CONVERTED (→ Deal) | LOST`
- **Deal**: `DISCOVERY → PROPOSAL → NEGOTIATION → CLOSED_WON | CLOSED_LOST`
- **Deal number format**: `DEAL-YYYY-NNNN`

**Events published:** `deal.won`, `ticket.created`
**Events consumed:** `qc_final.passed`, `invoice.sent`, `device.dispatched`

**Critical flows:**
- Lead qualify → convert creates Deal + Contact + Company (idempotent on email/name)
- Deal `CLOSED_WON` → outbox event → Production creates WO
- Discount > 15% on any line item → approval request created

### 13.2 Production Module (Phase 2 + 3 + 4)

The production module is the most state-rich surface of the ERP. For the Mobilab tenant (the pilot customer) it models the Mobicase diagnostic suite (MBA analyser, MBM mixer, MBC cube, MCC final case, CFG centrifuge) across five assembly lines (L1–L5), two shifts, and operators with tiered competencies — but the schema is generic and is driven by per-tenant product/BOM/line configuration.

**Tables:**
- Core: `products`, `bom_versions`, `bom_lines`, `ecn_logs`
- Work orders: `work_orders` (15 states), `wo_line_assignments`, `wo_approvals`
- Devices: `device_ids` (13 states incl. `RECALLED`), `device_events` (append-only)
- Shop floor: `assembly_lines` (L1–L5 seeded), `line_stage_templates` (per-line stage sequence), `stage_logs`
- Compliance: `bmr_records` (Batch Manufacturing Record — dual-signature, 21 CFR Part 11)
- Loss tracking: `scrap_entries` (root-cause coded), `downtime_events` (category coded)
- Operations: `oee_records`, `operator_capability`, `shifts`

#### 13.2.1 Work Order Lifecycle (15 states — matches prototype)

```
DRAFT
  └── PENDING_APPROVAL                    (submit — §3.3 approval chain)
         └── APPROVED                     (on final approver sign)
                └── PENDING_RM            (auto — awaits material issue)
                       └── RM_ISSUED      (stores confirms issue — stock reserved)
                              └── RM_QC_IN_PROGRESS   (IQC gate, if required)
                                     └── IN_PROGRESS  (first stage logged)
                                            └── ASSEMBLY_COMPLETE       (L4 complete)
                                                   └── QC_HANDOVER_PENDING
                                                          └── QC_IN_PROGRESS    (L5 FINAL_QC)
                                                                 └── QC_COMPLETED
                                                                        ├── COMPLETED           (all devices pass)
                                                                        └── PARTIAL_COMPLETE    (some scrapped, rest released)

Transversal states (reachable from multiple):
  ── ON_HOLD       (management block — see hold reason + signature)
  ── CANCELLED     (terminal, only pre-RM_ISSUED without supervisor override)
```

Rules:
- Optimistic locking via `version` column on `work_orders`. Stale-update returns 409.
- `ON_HOLD` requires `hold_reason` (FK to `hold_reasons` lookup) and electronic signature.
- `CANCELLED` after `RM_ISSUED` requires `PRODUCTION_MANAGER` + finance sign-off (materials must be returned to stock).
- `PARTIAL_COMPLETE` requires at least one device in `RELEASED` state and explicit closure.
- State transition matrix lives in `packages/core/production/src/wo.state-machine.ts` — single source of truth.

#### 13.2.2 Device Lifecycle (13 states)

```
CREATED → IN_PRODUCTION → SUB_QC_PASS | SUB_QC_FAIL
                             │              └── IN_REWORK → (loop up to rework_limit)
                             │                     └── REWORK_LIMIT_EXCEEDED → SCRAPPED
                             ▼
                       FINAL_ASSEMBLY → FINAL_QC_PASS | FINAL_QC_FAIL
                                            │                  └── IN_REWORK | SCRAPPED
                                            ▼
                                         RELEASED → DISPATCHED
                                            ▼
                                         RECALLED     (post-dispatch, FDA/ISO recall)
```

- `RECALLED` is terminal from DISPATCHED — requires `QC_MANAGER` signature + `recall_notice_id` FK. Triggers `device.recalled` outbox event → CRM notifies customer, Finance flags invoice for credit note.
- **Device ID format**: `{productCode}-{YYYY}-{MM}-{WOSeq}-{DeviceN}` — e.g. `MBA-2026-04-0001-0`, `CFG-2026-04-0003-2`.
- Per-product monotonic sequence enforced via advisory lock on `(product_code, year, month)`.

#### 13.2.3 BMR — Batch Manufacturing Record (21 CFR Part 11)

Every completed work order produces one BMR. BMR lifecycle:

```
DRAFT → PRODUCTION_SIGNED → QC_SIGNED → CLOSED
```

- `DRAFT` — auto-created on `wo.status = COMPLETED`. Captures all stage logs, scrap entries, downtime events, QC findings, operator roster, shift attribution.
- `PRODUCTION_SIGNED` — `PRODUCTION_MANAGER` reviews, attaches electronic signature (password re-entry). Permission `bmr:sign_production`.
- `QC_SIGNED` — `QC_MANAGER` reviews, attaches electronic signature. Permission `bmr:sign_qc`.
- `CLOSED` — terminal. BMR PDF generated (Phase 4), stored in MinIO, hash stored in `audit.bmr_closures`. BMR is immutable once closed.

Tables:
```
bmr_records (id, wo_id, status, drafted_at, production_signed_at,
             production_signed_by, production_signature_hash,
             qc_signed_at, qc_signed_by, qc_signature_hash,
             closed_at, pdf_minio_key, content_hash)
```

#### 13.2.4 Scrap — Root-Cause Coded

Every scrap event carries a root-cause classification (prototype enum `ScrapRootCause`):

```
OC_FITMENT | PCB_ASSEMBLY_ERROR | INCOMING_MATERIAL | DIMENSIONAL
| PROCESS_ERROR | HANDLING_ESD | FIRMWARE_ERROR | OTHER
```

Tables:
```
scrap_entries (id, wo_id, device_id, stage_id, root_cause,
               sub_cause_notes, scrapped_by, scrapped_at,
               approved_by, approval_signature_hash,
               recoverable_components_jsonb)
```

Flow: scrap trigger → `scrap:record` permission check → `scrap_entries` insert → `device_ids.status = SCRAPPED` → outbox `device.scrapped` event (Inventory writes recoverable components back to stock if `recoverable_components_jsonb` non-empty).

#### 13.2.5 Downtime — Category Coded (drives OEE availability)

Every downtime interval carries a category (prototype enum `DowntimeCategory`):

```
RM_DELAY_INVENTORY | RM_DELAY_QUALITY | EQUIPMENT_FAILURE
| OPERATOR_ABSENCE_PLANNED | OPERATOR_ABSENCE_UNPLANNED
| POWER_INFRASTRUCTURE | REWORK_HOLD | MANAGEMENT_HOLD
```

Tables:
```
downtime_events (id, line, shift, category, started_at, ended_at,
                 duration_min, reason_notes, recorded_by, wo_id_nullable)
```

OEE calculation (`oee_records` materialised view refreshed every 15 min):
```
Availability = (planned_time - sum(downtime.duration)) / planned_time
Performance  = (actual_output * std_cycle_time) / run_time
Quality      = (good_output) / total_output
OEE          = Availability × Performance × Quality
```

#### 13.2.6 Assembly Lines L1–L5 (Seeded Reference)

Lines are seeded at migration time and rarely edited. Admin UI permits editing; runtime code treats them as constants.

```
L1 — Mobimix sub-assembly
L2 — Analyser sub-assembly
L3 — Incubator sub-assembly
L4 — Final assembly (merge point)
L5 — Final device QC
```

`line_stage_templates` defines the stage sequence per line (stage name, sequence, standard time, QC-required flag). ECN changes to stage templates require `ecn:approve` permission and version-bumping the template.

#### 13.2.7 Events Published / Consumed

**Published:** `work_order.created`, `work_order.approved`, `wo.rm_issued`, `wip_stage.qc_gate`, `wo.completed`, `device.dispatched`, `device.scrapped`, `device.recalled`, `bmr.closed`

**Consumed:** `deal.won` (→ draft WO), `qc_wip.passed` (→ advance stage), `qc_inward.passed` (→ RM_ISSUED), `grn.created` (→ optional RM_ISSUED if pre-allocated)

#### 13.2.8 Critical Flows

- WO approval chain (§3.3): Production Manager → Finance (> ₹5L) → Management (> ₹20L).
- `wo.status = APPROVED` → auto-generate device IDs (per-product sequence) → atomic stock reservation via `reserveStockAtomic()` (§7.1) using BOM explosion → `PENDING_RM`.
- Stage logging respects `canLogStage(status, line, stage_sequence, operator_capability)` rules:
  - WO must be in `IN_PROGRESS` or sub-states, not `ON_HOLD` / `CANCELLED`.
  - Operator's `permittedLines` must include the stage's line.
  - Operator's `canPCBRework` / `canOCAssembly` must match stage requirements.
  - Stage sequence must be contiguous (sequence `n` logged only after `n-1`).
- Rework count > `product.rework_limit` → device auto-transitions to `REWORK_LIMIT_EXCEEDED → SCRAPPED`.
- L5 FINAL_QC_PASS + QC_MANAGER electronic signature → `RELEASED` → eligible for dispatch.
- BMR auto-drafts on `wo.status = COMPLETED`. WO is not fully closed until `bmr.status = CLOSED`.

#### 13.2.9 Hold / Release / Dispatch

- **Hold**: `work_orders.status = ON_HOLD` requires reason + e-signature. Hold history retained in `wo_hold_history`.
- **Release**: transitions `device_ids.status = FINAL_QC_PASS → RELEASED`, requires `qc:release_device` permission.
- **Dispatch**: triggered by CRM `delivery_challan.confirmed` event. Device → `DISPATCHED`. Outbox emits `device.dispatched` → Finance drafts invoice, CRM WhatsApp-notifies customer.

### 13.3 Inventory Module (Phase 2 + 3)

**Tables:**
- Master: `items`, `warehouses`, `item_warehouse_binding` (reorder_point, max_qty, safety_stock per item-warehouse)
- Ledger: `stock_ledger` (append-only — §5), `stock_summary` (trigger-maintained projection)
- Traceability: `batches` (mfg_date, expiry_date, coa_ref), `serials` (device-scoped S/N catalogue)
- Movements: `stock_adjustments` (reason-coded, requires approval), `stock_transfers` (two-leg)

**Events published:** `reorder.triggered`, `batch.expiry_alert`, `stock.adjusted`, `stock.transferred`
**Events consumed:** `grn.created`, `delivery_challan.confirmed`, `qc_inward.passed`, `device.scrapped` (recoverable components → back to stock)

#### 13.3.1 Stock Adjustments (Page: `/inventory/adjustments`)

Adjustments are reason-coded, audit-trailed, and (for > configured threshold) approval-gated.

```
stock_adjustments (id, item_id, warehouse_id, qty_delta, reason_code,
                   reason_notes, adjusted_by, approved_by_nullable,
                   approval_signature_hash, created_at, ledger_txn_id)
```

Reason codes (seeded):
```
COUNT_CORRECTION | DAMAGE | LOSS | FOUND_EXCESS | WRITE_OFF
| RECLASSIFICATION | MANUFACTURING_CONSUMPTION | SCRAP_RETURN
```

Flow:
1. `stock:adjust` permission check.
2. If `|qty_delta| × item.unit_cost > ₹1L` → approval request created, status = `PENDING_APPROVAL`.
3. On approval (or auto-approve if under threshold) → single `stock_ledger` row written, `stock_summary` trigger updates.
4. Outbox `stock.adjusted` event → audit trail, optional finance notification.

#### 13.3.2 Stock Transfers (Page: `/inventory/transfers`)

Inter-warehouse transfers are modelled as **two ledger rows** (out + in) within one transaction, linked by `transfer_id`. Transit state is explicit.

```
stock_transfers (id, item_id, from_warehouse, to_warehouse, qty,
                 status, initiated_by, initiated_at,
                 in_transit_at, received_by_nullable, received_at_nullable,
                 out_ledger_txn_id, in_ledger_txn_id_nullable)
```

Transfer lifecycle:
```
INITIATED → IN_TRANSIT → RECEIVED | CANCELLED
```

- `INITIATED → IN_TRANSIT`: out-ledger row written, `from_warehouse` stock debited, `in_ledger` not yet written. Quantity visible in stock_summary as `in_transit_qty` (distinct from `on_hand_qty`).
- `IN_TRANSIT → RECEIVED`: in-ledger row written, `to_warehouse` credited. Both ledger rows share `transfer_id` for reconciliation.
- `CANCELLED` (only from `IN_TRANSIT`): compensating ledger entry, audit trail.

#### 13.3.3 GRN View (Page: `/inventory/grn`)

**Read-only projection** of `procurement.grns`. This page does not own data — it queries procurement and joins with inventory for stock posting status. No backend work in Inventory module for this page; FE just hits `GET /api/procurement/grns?include=stock_posting`.

#### 13.3.4 Critical Flows

- Stock reservation (§7.1) with canonical lock ordering.
- GRN → `stock_ledger` entry (txn_type `GRN_RECEIPT`) → trigger updates `stock_summary`.
- `device.scrapped` with `recoverable_components_jsonb` → per-component `stock_ledger` entries (txn_type `SCRAP_RECOVERY`).
- Nightly MRP scheduler job: compare BOM requirements vs `stock_summary.available_qty` → draft POs for shortfalls, emit `reorder.triggered`.
- Batch expiry alerts 30/60/90 days ahead (scheduler job + outbox event + notification dispatch).
- Stock summary drift detection: daily pg_cron job reconciles `stock_summary` vs `SUM(stock_ledger.qty)` per item-warehouse; any drift → CRITICAL alert.

### 13.4 QC Module (Phase 2 + 3 + 4)

**Tables:**
- Templates: `inspection_templates`, `inspection_parameters`
- Inspections: `qc_inspections`, `qc_findings`, `defects`, `failure_modes`
- Formal artifacts: `qc_certs`, `ncrs`, `ncr_investigations`, `ncr_dispositions`, `capa`
- Equipment: `calibration_schedule`, `calibration_log`

**Events published:** `qc_inward.passed`, `qc_inward.failed`, `qc_wip.passed`, `qc_wip.failed`, `qc_final.passed`, `qc_final.failed`, `ncr.raised`, `ncr.closed`, `capa.created`
**Events consumed:** `inward.created`, `wip_stage.qc_gate`, `grn.created`

**QC types:** IQC (incoming goods), SUB_QC (per shop-floor stage), FINAL_QC (L5 only)

#### 13.4.1 Inspection Flow

Every inspection is parameter-driven — findings record `(parameter, expected, actual, pass/fail, inspector_notes)`. Inspection templates are versioned; changes go through ECN.

- SUB_QC PASS on non-L5 → `device.status = SUB_QC_PASS`, stage advances.
- SUB_QC PASS on L5 → `device.status = FINAL_QC_PASS`, eligible for release.
- FAIL → if `rework_count < product.rework_limit` → `IN_REWORK` loop; else → `REWORK_LIMIT_EXCEEDED → SCRAPPED`.
- **FAIL on IQC or any critical defect** → auto-raise NCR (§13.4.2).
- Device release (`FINAL_QC_PASS → RELEASED`) requires `qc:release_device` permission + electronic signature (Phase 4).

#### 13.4.2 NCR — Non-Conformance Report (ISO 13485 §8.3)

NCRs are **distinct from `qc_findings`** — findings are granular per-parameter data points; an NCR is a formal document with investigation, disposition, and closure. One NCR may aggregate many findings.

**NCR lifecycle:**

```
OPEN → INVESTIGATION → RCA_SIGNED → DISPOSITION → CLOSED
  └── (reopen within 90 days allowed; resets to INVESTIGATION)
```

**Tables:**
```
ncrs (id, ncr_number, status, raised_by, raised_at, severity,
      source_type, source_id,  -- e.g. source_type=qc_inspection, id=uuid
      affected_qty, affected_batches_jsonb,
      investigation_signed_at, investigation_signed_by,
      investigation_signature_hash,
      closed_at, closed_by, linked_capa_id_nullable)

ncr_investigations (id, ncr_id, investigator_id, root_cause_category,
                    root_cause_notes, corrective_action_notes,
                    preventive_action_notes, evidence_minio_keys_jsonb)

ncr_dispositions (id, ncr_id, disposition,  -- enum below
                  qty, approved_by, approved_at, signature_hash, notes)
```

**Disposition enum:**
```
USE_AS_IS | REWORK | SCRAP | RETURN_TO_VENDOR | QUARANTINE_PENDING
```

Rules:
- `USE_AS_IS` requires `QC_MANAGER` + `MANAGEMENT` double signature (risk acceptance).
- `RETURN_TO_VENDOR` emits outbox `ncr.return_to_vendor` → Procurement creates RTV.
- `QUARANTINE_PENDING` is non-terminal — batch status flips to `QUARANTINED`, must later transition to one of the other dispositions.
- NCR cannot close while any disposition is `QUARANTINE_PENDING`.
- Closing an NCR without a linked CAPA requires `QC_MANAGER` sign-off explaining why no CAPA was needed.

#### 13.4.3 Calibration (Equipment)

- `calibration_schedule` defines equipment with next-due dates.
- Equipment with `next_due_date < today` is blocked: any QC action attempting to reference expired equipment returns 409 "equipment calibration expired".
- `calibration_log` is append-only — records each calibration event with certificate MinIO key and signature.

#### 13.4.4 Events Published / Consumed

**Published:** `qc_inward.passed`, `qc_inward.failed`, `qc_wip.passed`, `qc_wip.failed`, `qc_final.passed`, `qc_final.failed`, `ncr.raised`, `ncr.closed`, `capa.created`, `capa.closed`

**Consumed:** `grn.created` (→ schedule IQC), `inward.created`, `wip_stage.qc_gate` (→ schedule SUB_QC or FINAL_QC)

### 13.5 Procurement Module (Phase 2 + 3)

**Tables:** `vendors`, `indents`, `purchase_orders`, `po_lines`, `grns`, `grn_lines`, `rtvs`.

**Events published:** `po.approved`, `grn.created`
**Events consumed:** `deal.won`, `reorder.triggered`

**PO lifecycle:** `DRAFT → PENDING_APPROVAL → APPROVED → SENT → PARTIALLY_RECEIVED → RECEIVED | CANCELLED`

**Approval thresholds:** PO > ₹10L → Finance; > ₹25L → Senior Mgmt

### 13.6 Finance Module (Phase 2 + 3 + 4)

**Tables:**
- Sales side: `sales_invoices`, `sales_invoice_lines`, `customer_ledger` (append-only), `credit_notes`
- Purchase side: `purchase_invoices` (vendor bills), `purchase_invoice_lines`, `vendor_ledger` (append-only), `debit_notes`
- Cash: `payments` (polymorphic: can apply to sales_invoices or purchase_invoices), `expense_ledger`
- Compliance: `eway_bills`, `gst_returns`, `tds_entries`
- Approvals: `invoice_approvals`, `payment_approvals`

**Events published:** `invoice.sent`, `purchase_invoice.posted`, `ewb.generated`, `ewb.cancelled`, `payment.recorded`, `gst_return.filed`, `credit_note.issued`
**Events consumed:** `delivery_challan.confirmed`, `grn.created`, `device.dispatched`, `device.recalled` (→ credit note draft)

#### 13.6.1 Sales Side

- `device.dispatched` → auto-draft `sales_invoice`.
- Invoice approval per §3.3 (Finance Manager → Senior Management if > ₹20L).
- On approval → electronic signature → `sales_invoices.status = POSTED` → `customer_ledger` append → outbox `invoice.sent`.
- EWB generation via NIC API circuit-breakered (§3.4). Failure → manual entry queue.
- Credit note flow on `device.recalled` — auto-draft CN, requires Finance Manager approval.

#### 13.6.2 Purchase Side (Page: `/finance/purchase-invoices`)

Vendor bills are first-class, not merged with sales:

- `grn.created` → auto-draft `purchase_invoice` with GRN line items + vendor's tax breakup.
- Three-way match: `purchase_order` ↔ `grn` ↔ `purchase_invoice`. Mismatch beyond tolerance (configurable, default ₹500 or 2%) → `MATCH_FAILED` status, requires manual review.
- On match + approval → `POSTED` → `vendor_ledger` append → payment eligible.
- TDS deducted at posting based on vendor tax profile; `tds_entries` row generated.

#### 13.6.3 Payments (Polymorphic)

One `payments` table covers both incoming (customer) and outgoing (vendor) payments.

```
payments (id, type,  -- CUSTOMER_RECEIPT | VENDOR_PAYMENT
          amount, mode,  -- BANK_TRANSFER | CHEQUE | UPI | CASH
          reference_no, applied_to_invoices_jsonb,
          -- Array of {invoice_id, invoice_type, amount_applied}
          received_from_nullable, paid_to_nullable,
          recorded_by, recorded_at, signature_hash)
```

- Atomic: one payment → N ledger rows (one per applied invoice) within a single transaction.
- `payments:record` permission. Amounts > ₹10L require approval.

#### 13.6.4 Overview Dashboard (Page: `/finance/overview`)

Materialised view `finance.mv_dashboard_kpis` refreshed every 60s by scheduler job (see §13.11 for the common pattern). KPIs:

- AR aging (0-30, 31-60, 61-90, >90 days)
- AP aging
- Cash position (by bank account)
- Top 5 overdue customers, top 5 outstanding vendors
- Month-to-date revenue, expenses, gross margin
- GST liability pending
- EWB failure count (circuit breaker state)

Endpoint: `GET /api/finance/dashboard` — returns flat JSON, cached in Redis-CACHE (TTL 60s), served from materialised view.

#### 13.6.5 Reports (Page: `/finance/reports`)

Pre-built report templates, parameterised by date range + filters:

- Sales register (GST-ready)
- Purchase register (GST-ready)
- Customer ledger statement (per-customer)
- Vendor ledger statement (per-vendor)
- Aged AR / AP
- TDS summary (Form 26Q feed)
- GSTR-1, GSTR-3B drafts
- P&L summary (bridge to accounting, not a replacement for audited books)

Reports render to PDF via `worker-pdf` (Phase 4). Generation is async — FE polls job status.

#### 13.6.6 Critical Flows

- `device.dispatched` → auto-draft invoice → Finance approval chain → post → EWB.
- `grn.created` → auto-draft purchase_invoice → three-way match → post → payment eligible.
- `device.recalled` → auto-draft credit note → Finance Manager approval.
- Payment recording to append-only ledger (never UPDATE/DELETE).
- Monthly GST computation from `customer_ledger` + `vendor_ledger` on 1st of month via pg_cron.
- EWB circuit breaker (§3.4) — on open, Finance gets a work-queue item to retry manually.

### 13.7 Notifications Module (Phase 3)

**Tables:** `notification_templates`, `notification_log`.

**Channels:** in-app (SSE), email, WhatsApp.

**Terminal consumer** — every cross-module event can trigger notifications based on template routing.

### 13.8 Auth Module (Phase 1 + 2)

**Tables:** `users`, `roles`, `permissions`, `user_roles`, `sessions`, `revoked_tokens`, `audit_login`.

**See §9.1–9.4 for auth stack + RBAC (roles, permission format, capability layer).**

### 13.9 Customer Portal (Phase 3)

The portal is served from the **same `apps/api`** process but with strict audience enforcement (§3.1a). It is **not** a second backend.

**Tables (all views or FK projections, no new base tables):**
- Read projections: `portal_vw_orders`, `portal_vw_invoices`, `portal_vw_dispatches`
- Write surface: `portal_tickets` (FK → `crm.tickets`, filtered to own-tenant + own-customer)

**Routes (all under `/api/portal/*`):**

| Method + Path | Permission | Purpose |
|---------------|-----------|---------|
| `POST /portal/auth/login` | public | Customer login (email + password) |
| `POST /portal/auth/refresh` | public | Refresh token rotation |
| `POST /portal/auth/logout` | `CUSTOMER` | Revoke session |
| `GET /portal/orders` | `CUSTOMER` | List own orders (paginated) |
| `GET /portal/orders/:id` | `CUSTOMER` | Order detail + dispatch status |
| `GET /portal/invoices` | `CUSTOMER` | List own invoices |
| `GET /portal/invoices/:id` | `CUSTOMER` | Invoice detail + PDF link |
| `GET /portal/tickets` | `CUSTOMER` | Own tickets |
| `POST /portal/tickets` | `CUSTOMER` | Create ticket |
| `POST /portal/tickets/:id/reply` | `CUSTOMER` | Reply to own ticket |

**Enforcement layers:**
1. **Audience guard**: `requireAudience('instigenie-portal')` preHandler. JWT with `aud=instigenie-internal` → 403.
2. **RLS + owner filter**: portal queries run through `withPortalUser(userId, customerId, fn)` which sets both `app.current_org_id` and `app.current_customer_id`. RLS policies on `portal_vw_*` filter by customer_id.
3. **Rate limit**: 60 rpm/user (§3.1a).
4. **No write access outside `/portal/*`**: the shared API middleware rejects portal tokens on any non-`/portal` route.

**Frontend (`src/app/(dashboard)/portal/*`):**

The prototype's portal pages stay under the dashboard route group but render with a portal-specific layout (no sidebar nav, simplified header). `middleware.ts` detects `role = CUSTOMER` and forces redirect to `/portal` if the user tries to hit internal routes.

**Events:** Portal does not publish domain events. Ticket create → `ticket.created` event is published by the CRM module (portal is just a CRM client).

### 13.10 Admin UI (Phase 2)

Routes: `/admin/users` (prototype), expandable to `/admin/roles`, `/admin/permissions`, `/admin/audit`.

**Tables (all live in `auth` or `audit` schemas — Admin UI doesn't own storage):**

| Table | Owned by | Admin UI surface |
|-------|----------|-----------------|
| `auth.users` | Auth | User provisioning, deactivation |
| `auth.user_roles` | Auth | Role assignment |
| `auth.roles` / `auth.permissions` | Auth | Read-only (edited via migration, not runtime) |
| `production.operator_capability` | Production | Capability editor (PRODUCTION_MANAGER scope) |
| `audit.audit_log` | Audit | Searchable audit trail view |

**Routes (all under `/api/admin/*`):**

| Method + Path | Permission | Purpose |
|---------------|-----------|---------|
| `GET /admin/users` | `users:provision` | List tenant users |
| `POST /admin/users` | `users:provision` | Create user + send invite email |
| `PATCH /admin/users/:id` | `users:provision` | Deactivate, change email |
| `POST /admin/users/:id/roles` | `roles:assign` | Assign role (writes `user_roles`, invalidates Redis-CACHE perm set) |
| `DELETE /admin/users/:id/roles/:roleId` | `roles:assign` | Revoke role |
| `GET /admin/capabilities/operators` | `roles:assign` | List operator competencies |
| `PATCH /admin/capabilities/operators/:userId` | `roles:assign` | Update competency (electronic signature) |
| `GET /admin/audit?user_id=&entity=&from=&to=` | `permissions:audit` | Paginated audit search |
| `GET /admin/audit/:id` | `permissions:audit` | Audit row detail + trace_id deep-link |

**Permission-set invalidation:** Any mutation to `user_roles` or `roles` invalidates the user's permissions cache entry in Redis-CACHE. Next `GET /api/auth/me/permissions` re-fetches from PG.

**Scope guard:** All `/api/admin/*` routes require `SUPER_ADMIN` or specific admin permissions. Audit writes are automatic (§9.5).

### 13.11 Reports & Dashboards (Cross-Cutting Pattern)

Every module has a `/dashboard` and `/reports` page. Rather than bespoke per-module implementation, they all follow one pattern.

#### 13.11.1 Common Pattern

**Dashboards** show ~5–15 KPIs, refresh every 30–60s, must be fast (< 200ms p95).
**Reports** are parameterised, may scan large ranges, can be slow (async PDF for > 1000 rows).

```
┌────────────────┐    refresh every     ┌─────────────────────┐
│  pg_cron /     │◄────30–60s via──────│  {module}.mv_*      │
│  BullMQ        │    REFRESH MV         │  materialised views │
│  scheduler     │    CONCURRENTLY       │                     │
└────────────────┘                        └──────────┬──────────┘
                                                      │
                                           populate on  │  served from
                                           refresh      ▼
                                         ┌─────────────────────┐
                                         │  Redis-CACHE        │
                                         │  key: dash:{mod}:   │
                                         │       {org_id}      │
                                         │  TTL: 60s           │
                                         └──────────┬──────────┘
                                                      │
                                                      ▼
                                         ┌─────────────────────┐
                                         │  GET /api/{mod}/    │
                                         │      dashboard      │
                                         └─────────────────────┘
```

**Live counters (SSE):** For WIP-like views that need sub-second updates (e.g. `/production/shop-floor`), server uses Redis-CACHE pub/sub. Business writes publish to a channel; SSE endpoint subscribes and pushes. Fallback to polling if SSE disconnects.

#### 13.11.2 Endpoint Shapes (Standardised)

```
GET  /api/{module}/dashboard
  → { kpis: {...}, generated_at, ttl_seconds }

GET  /api/{module}/reports
  → { available: [{id, name, params_schema}] }

POST /api/{module}/reports/{report_id}/run
  Body: { params: {...}, format: "json" | "pdf" | "csv" }
  → For json/csv: streams results inline (rate-limited).
  → For pdf:     returns { job_id } — FE polls `GET /reports/jobs/{job_id}`.
```

#### 13.11.3 Pages Covered by This Pattern

Every module's `/dashboard` and `/reports` pages use this shape — **no bespoke endpoints per module**.

| Module | Dashboard page | Reports page |
|--------|---------------|--------------|
| Production | `/production/dashboard` | `/production/reports` |
| QC | `/qc/dashboard` | `/qc/reports` |
| Inventory | — (home) | `/inventory/reports` |
| Procurement | `/procurement/dashboard` | `/procurement/reports` |
| Finance | `/finance/overview` | `/finance/reports` |
| CRM | — (pipeline is the dashboard) | `/crm/reports` |
| Global | `/` (dashboard root) | — |

The global dashboard (`/`) aggregates top-level KPIs from each module's cached dashboard — one API call: `GET /api/dashboard/global`.

---

## 14. Anti-Patterns

Patterns explicitly rejected. Cite this section in PR reviews.

| Anti-Pattern | Why Wrong | Correct Approach |
|--------------|-----------|------------------|
| Prisma as ORM | Drops triggers; cannot set RLS session vars per-txn; loses SQLSTATE | Drizzle; hand-written SQL for triggers/RLS |
| Single Redis for queue + cache | `noeviction` vs `volatile-lru` incompatible | Two Sentinel clusters |
| Worker calls `pg_notify()` to publish | Durability lost — no outbox row = no replay | Business code writes outbox row; trigger NOTIFYs; worker claims |
| LISTEN from Fastify/worker | Through PgBouncer, subscription lost | Dedicated `listen-notify` process, direct PG :5432 |
| `Number` arithmetic on money/stock | IEEE 754 precision loss | `decimal.js`; NUMERIC as string; never `Number` |
| `bcryptjs` for passwords | Pure JS, 3–5× slower; login-burst bottleneck | `argon2id` or `@node-rs/bcrypt` |
| `redis.keys(pattern)` | Blocks Redis for seconds | `redis.scanStream` + `unlink` |
| PM2 inside Docker | Double supervision; signal forwarding issues | Docker/K8s supervises; 1 Node process per container |
| `deletedAt` on audit_log | Violates Part 11 immutability | PG rule blocks UPDATE/DELETE |
| Rate limit keyGen = userId only | Stolen token DoS against user; legit user blocked | Composite `userId:ip` key |
| `SELECT 1` for health check | Succeeds through PgBouncer even if PG is ill | `SELECT pg_is_in_recovery()` |
| `node-cron` / `setInterval` for scheduled work | Duplicates across pods; no coordination | BullMQ repeatable jobs with stable `jobId` |
| Prepared statements on PgBouncer | Prepares lost across transactions | Disable in driver config |
| JWT carries `permissions[]` | Stale up to token TTL after role change | Identity-only JWT; perms resolved at runtime |
| One Fastify monolith + workers in-process | CPU-bound jobs block event loop | Separate worker processes per queue |
| Gate tests that reimplement the invariant | Passing test ≠ passing production; invariant drifts silently | Extract to a module (`assertDirectPgUrl`, `createOutboxDrain`) and import it from both (Rule §2.16) |

---

## 15. Correctness Gate Catalogue (Full)

Every gate test in `tests/gates/`. Run: `pnpm --filter @instigenie/gates test`. Files serial, vitest, against docker-compose dev stack.

### 15.1 Phase 1 — Foundation (1–7)

| # | Proves | Target |
|---|--------|--------|
| 1 | Money files reject `Number`/`parseFloat` (lint) | `packages/money` eslint rule |
| 2 | NUMERIC round-trips as exact string | `packages/db` type parser |
| 3 | Idempotency key dedupes repeat POSTs | api idempotency middleware |
| 4 | Outbox INSERT fires `NOTIFY erp_outbox` | `ops/sql/triggers/01-outbox-notify.sql` |
| 5 | Org A session cannot SELECT org B rows | `ops/sql/rls/*.sql` |
| 6 | Role without permission → 403 | api guard + `@instigenie/contracts` |
| 7 | Dev bootstrap (roles, perms, seed) idempotent | `ops/sql/seed/*` |

### 15.2 Phase 2 — Tenancy + Entitlements (8–19)

| # | Proves | Target |
|---|--------|--------|
| 8 | CRM cross-tenant isolation at DB layer | `ops/sql/rls/02-crm-rls.sql` |
| 9 | *(schema drift CI — not yet implemented, see §15.4)* | — |
| 10 | `page=99999 limit=5000` → capped at 100, no OOM | pagination helper in `@instigenie/contracts` |
| 11 | `instigenie_app` is `NOBYPASSRLS` | `ops/sql/seed/99-app-role.sql` |
| 12 | Every org-scoped table has an RLS policy | `ops/sql/rls/*` + migration convention |
| 13 | RLS `WITH CHECK` prevents cross-tenant INSERT | `ops/sql/rls/*` |
| 14 | `organizations.status` schema present | `ops/sql/init/01-schemas.sql` |
| 15 | Suspended tenant's users cannot auth | `TenantStatusService` |
| 16 | `requireFeature` → 402 when flag off | `packages/quotas` / `FeatureFlagService` |
| 17 | `QuotaService.assertUnder` throws pre-mutation | `packages/quotas` / `QuotaService` |
| 18 | Every vendor-admin mutation → 1 `vendor.action_log` row | `packages/vendor-admin` |
| 19 | `instigenie_vendor` reads cross-org; `instigenie_app` cannot | `ops/sql/seed/98-vendor-role.sql` |

### 15.3 Phase 1 Reinforcement (20–24)

Each imports the exact module production uses — no facsimiles.

| # | Reinforces | Target |
|---|-----------|--------|
| 20 | Gate 5 (URL guard) | `packages/db/src/direct-url.ts` → `assertDirectPgUrl` |
| 21 | Gate 4 (noeviction) | `packages/queue/src/noeviction.ts` → `assertBullRedisNoeviction` |
| 22 | Gate 3 (outbox LISTEN + 30s poll + idempotent drain) | `apps/listen-notify/src/drain.ts` → `createOutboxDrain` |
| 23 | Gate 6 (refresh rotation, reuse rejected, logout idempotent) | `apps/api/src/modules/auth/service.ts` → `AuthService` |
| 24 | Gate 7 (HTTP→pg trace tree, manual parent + pg child) | `packages/observability/src/tracing.ts` → `initTracing` |

### 15.4 Open Gaps

| Gap | Risk | Fix |
|-----|------|-----|
| Schema drift CI (Gate 9) | FE form accepts values BE rejects (or vice versa) | CI step: build FE + BE from `@instigenie/contracts`, fail on TS error |
| Audit-trail per-mutation (historic Gate 11 intent) | Silent gaps in `audit.log` | Integration test counting `audit.log` rows around each CRUD |
| CRM web pages (accounts, contacts, deals, tickets) still mock-backed | Users see stale data in prod | Wire to `useCrmApi` hooks per leads pattern |
| Deal/Ticket state-machine transitions | Invalid transitions reach unreachable states | Per-entity transition matrix mirroring leads smoke test |

---

## Appendix A — Decision Log

Track material architectural decisions here. One row per decision.

| Date | Decision | Alternatives Considered | Rationale |
|------|----------|------------------------|-----------|
| 2026-04 | Drizzle as ORM | Prisma, Kysely, TypeORM | Prisma kills RLS pattern; Kysely lacks migrations; TypeORM has decorator coupling. Drizzle = raw SQL escape hatch + type safety. |
| 2026-04 | Fastify over Express | Express, Hono, Koa | Fastify has best TS story + schema-first validation + ~2× throughput. Hono is newer; Koa stalled. |
| 2026-04 | BullMQ over Agenda/Bee | Agenda (Mongo-backed), Bee (older) | BullMQ is industry standard, Redis-backed, typed, supports all patterns. |
| 2026-04 | Two Redis clusters | Single cluster with careful key TTL | Policies are incompatible; one cluster = constant risk. |
| 2026-04 | Enhanced Modular Monolith | Microservices, pure monolith | Team size 3–8; ACID cross-module needed; future extraction possible via ESLint boundaries. |
| 2026-04 | `jose` over `jsonwebtoken` | jsonwebtoken, node-jose | jose has better TS types + full JOSE spec + async by default. |
| 2026-04 | argon2id over bcrypt | bcrypt, scrypt, bcryptjs | Modern password hashing standard; memory-hard; resistance to GPU attacks. |
| 2026-04 | Identity-only JWT | JWT with permissions | Role changes need fast propagation; stale perms = security issue. |
| 2026-04-21 | **Multi-tenant, shared DB, RLS-isolated** | Single-tenant deploys; multi-tenant w/ DB-per-tenant | Shared DB: one ops surface, one replica set. RLS + `NOBYPASSRLS` app role = correctness. Vendor `BYPASSRLS` covers cross-tenant support. Separate DBs would kill schema-drift control and force per-tenant migrations. |
| 2026-04-21 | **Two Postgres roles** (`instigenie_app` NOBYPASSRLS + `instigenie_vendor` BYPASSRLS) | Single role with conditional privilege; SET ROLE per-request | RLS binds to the *connecting role*, not the transaction. Only way to get hard isolation AND a supported cross-tenant path is two roles → two URLs → two pools. Gate 11 + Gate 19 enforce. |
| 2026-04-21 | **SECURITY DEFINER helpers for auth cross-tenant reads** | Grant `instigenie_app` BYPASSRLS; separate auth microservice | Auth needs two cross-tenant lookups (memberships-by-email, refresh-by-hash) — neither would justify weakening `instigenie_app`. SECURITY DEFINER scopes the privilege to exactly those two functions; app role stays `NOBYPASSRLS`. Defined in `ops/sql/rls/03-auth-cross-tenant.sql`. |
| 2026-04-21 | **Memberships table** (users can hold M:N orgs) | One user row per (email, org); external IdP for cross-org identity | Staff, consultants, and Instigenie support legitimately span tenants. Duplicate-user-per-org creates identity drift (password reset confusion, audit attribution). Login returns `multi-tenant` when count > 1 — explicit tenant pick. |
| 2026-04-21 | **Plans + features + usage_records in app DB (public schema)** | Dedicated billing service; separate entitlements DB | Feature flag / quota read sits on the hot path of every guarded route. Must be one pg query with RLS bound and cacheable. External service adds latency, availability risk, and drift vs org rows. Billing integration remains future work but the read shape stays stable. |
| 2026-04-21 | **`requireFeature` before `requirePermission`** | Permission check first; single combined check | A starter-plan user hitting a pro-only route must see "upgrade required" (402), not "access denied" (403). Ordering also avoids leaking which permissions the route needs before plan gate is cleared. |
| 2026-04-21 | **Gate tests import production code** (Rule §2.16) | Gate tests reimplement the invariant inline | A test that reinvents the invariant only proves the reinvention is correct. Extracting `assertDirectPgUrl`, `assertBullRedisNoeviction`, `createOutboxDrain` into importable modules means production and gate share one implementation. Refactor-driven: every Phase 1 reinforcement gate (20–24) is against a real module. |
| 2026-04-21 | **`createRequire` for pg / http in gate-24** | Reconfigure vitest pool/deps; migrate to `node --test` | Vitest's vite-based loader bypasses Node's require-in-the-middle hook, so OTel auto-instrumentation never patches statically-imported modules. `createRequire` forces native CJS load through the patched path. Workaround is surgical (one gate) instead of global (vitest config change across the suite). |

---

## Appendix B — Frontend Migration from Prototype

Current prototype is at `/Users/sanatansuraj/Desktop/crm _prototype/crm-prototype/` — Next.js 15 App Router with mock services.

### B.1 What We Keep

- All `app/` route structure — the user flows are already validated
- All `components/` — shadcn/ui components already wired
- All React Query hooks — same surface, different data source
- Shared types in `src/types/` — migrate to `packages/types/`
- Mobilab seed data in `src/data/mobilab-mock.ts` — convert to SQL seeds in `ops/sql/seed/`

### B.2 What Changes

| Current | New |
|---------|-----|
| `src/services/*.service.ts` (mock) | `apps/web/src/services/*.service.ts` (real API calls) |
| `src/types/*.ts` | `packages/types/src/*.ts` (shared with backend) |
| Validation in forms (ad-hoc) | Zod schemas imported from `packages/contracts/` |
| Hardcoded user | Real login + JWT in memory (not localStorage) |
| No auth middleware | `middleware.ts` redirects to `/login` if no token |
| Direct imports from `@/data/mobilab-mock` | React Query hooks calling real API |

### B.3 Migration Order (Phase 2, per module)

Each module's FE migration happens **after its backend CRUD lands**.

1. Build module backend (Phase 2 module priority order §12.2)
2. Publish Zod schemas to `packages/contracts/`
3. Update `apps/web/src/services/{module}.service.ts` — swap mock fn body with `apiClient.get/post`
4. Keep React Query hook signatures identical
5. Test prototype still works E2E
6. Move on to next module

This means the frontend stays functional throughout — we never have a broken state.

---

## Appendix C — Python → Node Translation

| Python Reference | Node Equivalent | Notes |
|------------------|----------------|-------|
| `uvicorn --workers 4` | Fastify + node cluster OR 4 pods | Node is single-threaded per process |
| `asyncio.wait_for(coro, timeout=0.1)` | `AbortSignal.timeout(100)` | Same semantics |
| SQLAlchemy Session | Drizzle `db.transaction()` | Session vars inside transaction callback |
| `asyncpg.connect(direct)` | `new pg.Client({ connectionString: DIRECT_URL })` | Both bypass PgBouncer |
| `conn.add_listener` | `client.on('notification', ...)` | pg uses events |
| `celery_app.send_task` | `queue.add(name, data, opts)` | BullMQ uses jobName + data |
| `@celery(acks_late=True, reject_on_worker_lost=True)` | `new Worker(q, fn, { lockDuration: 30_000, maxStalledCount: 1 })` | Stalled detection = `acks_late` |
| Celery Beat | `queue.upsertJobScheduler(id, schedule, opts)` | Stable id coordinates across pods |
| `Decimal('123.45')` | `new Decimal('123.45')` | Strings only |
| `frozenset(perms)` | `new Set(perms)` | O(1) has() |
| `structlog` | `pino + OTel trace context` | JSON stdout |
| WeasyPrint | `@react-pdf/renderer renderToStream` | Pure Node, streaming |
| Redis `volatile-lru` (single) | Redis-BULL (`noeviction`) + Redis-CACHE (`volatile-lru`) | Two clusters |
| `pg_notify()` | Unchanged — server-side | NOTIFY works via PgBouncer; LISTEN does not |
| `psycopg2.extensions.register_type` | `pg.types.setTypeParser` | Parse NUMERIC as string |

---

## Appendix D — Prototype Consolidation

The prototype accrued three parallel production namespaces and two parallel finance namespaces during early exploration. Before Phase 2 starts, we consolidate.

### D.1 Namespace Collisions

| Prototype folder | Pages | Canonical target | Action |
|-----------------|-------|-----------------|--------|
| `src/app/(dashboard)/mfg/*` | dashboard, work-orders, bmr, scrap, oee, device-ids, shop-floor | `src/app/(dashboard)/production/*` | **Retire.** Content already duplicated in `production/`. Redirect routes (below). |
| `src/app/(dashboard)/manufacturing/*` | dashboard, work-orders, bom, mrp, ecn, wip, reports | `src/app/(dashboard)/production/*` | **Retire.** Same as above. |
| `src/app/(dashboard)/accounting/*` | invoices, ledger, payments | `src/app/(dashboard)/finance/*` | **Retire.** Finance is the canonical namespace. |

### D.2 Next.js Redirects (Zero-Broken-Link Migration)

`next.config.ts`:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  async redirects() {
    return [
      // Production namespace consolidation
      { source: "/mfg/:path*",           destination: "/production/:path*",           permanent: true },
      { source: "/manufacturing/:path*", destination: "/production/:path*",           permanent: true },
      // Finance namespace consolidation
      { source: "/accounting/invoices",  destination: "/finance/sales-invoices",      permanent: true },
      { source: "/accounting/ledger",    destination: "/finance/customer-ledger",     permanent: true },
      { source: "/accounting/payments",  destination: "/finance/reports?type=payments", permanent: true },
      { source: "/accounting/:path*",    destination: "/finance",                     permanent: true },
    ];
  },
};

export default config;
```

Bookmarks and external references continue to work; users are silently forwarded.

### D.3 Folder Removal Plan

After redirects are in place and one release cycle has passed (verify no 404s in logs):

1. `rm -r src/app/(dashboard)/mfg`
2. `rm -r src/app/(dashboard)/manufacturing`
3. `rm -r src/app/(dashboard)/accounting`
4. Remove unused imports from `src/data/*-mock.ts` if any are orphaned.
5. Update `src/components/layout/sidebar-nav.tsx` (or equivalent) to remove stale nav entries.

### D.4 Component Duplication

`src/components/mfg/*` and `src/components/production/*` both exist. Consolidate under `src/components/production/*`:

- Move unique components from `mfg/` to `production/`.
- If both trees contain a component with the same name, prefer the version used by the `production/` pages.
- Update all imports via a one-time codemod (`find src/ -name "*.tsx" | xargs sed -i '' 's|components/mfg/|components/production/|g'`).

### D.5 Frozen Pages (No Backend Work)

These pages stay functional on their current `*-mock.ts` data and receive no backend modules in Phase 1–4:

| Page | Mock source | Revisit |
|------|-------------|---------|
| `src/app/(dashboard)/hr/*` | `src/data/mock.ts` or dedicated | Post-launch |
| `src/app/(dashboard)/projects/*` | `src/data/mock.ts` | Post-launch |
| `src/app/(dashboard)/spreadsheets/*` | none visible | Scope review before any work |

These folders may be archived under a `_frozen/` prefix if they create navigation confusion. Leaving them in place is also acceptable — they do no harm.

### D.6 Canonical Module Name in Comments

`src/services/mfg.service.ts` header already declares *"Canonical module name per architecture doc: `production`"*. On swap from mock to real API:

1. Rename file: `src/services/mfg.service.ts` → `src/services/production.service.ts`
2. Update all imports (`@/services/mfg.service` → `@/services/production.service`)
3. Rename hook: `src/hooks/useMfg.ts` → `src/hooks/useProduction.ts`
4. Rename component dir: `src/components/mfg/` → `src/components/production/` (D.4)
5. Delete `src/data/mobilab-mock.ts` when the last page migrates (CRM + Inventory + Production all on real API).

### D.7 Consolidation Acceptance Gate

Before Phase 2 production module work begins:

- [ ] All `/mfg/*` and `/manufacturing/*` routes 301 to `/production/*`
- [ ] All `/accounting/*` routes 301 to `/finance/*`
- [ ] `src/components/production/` is the only production component tree
- [ ] `src/services/production.service.ts` exists (even if still mock-backed)
- [ ] `src/hooks/useProduction.ts` exists
- [ ] CI check: no new file added under `src/app/(dashboard)/mfg/`, `manufacturing/`, or `accounting/`

---

## Document Control

| Field | Value |
|-------|-------|
| Document ID | ERP-ARCH-INSTIGENIE-2026-001 |
| Version | 1.2 |
| Supersedes | v1.1 (2026-04-20) |
| Translates From | `ERP-ARCH-MIDSCALE-2025-005` (Python reference) + `ERP-ARCH-UNIFIED-2026-001` (unified doc) |
| Next Review | End of Phase 2 CRM rollout (all web pages on real API) |
| Change Control | Material changes require the same PR approval process as ledger schema changes |

### Changelog

**v1.2 — Multi-Tenancy, Vendor Admin, Entitlements, Gate Expansion (2026-04-21)**

Patch capturing architectural additions that shipped during Phase 1 completion + Phase 1 hardening. No rule reversed; surface area of enforced invariants widened.

- §2 — Added rules 16 (gate tests import production code — no facsimiles) and 17 (every bootable invariant must be boot-time asserted).
- §3.0a *(new)* — Tenancy Model section: explicitly names the architecture as Multi-Tenant Shared DB with RLS; contrasts against single-tenant and separate-DB alternatives.
- §5.1 — Schema map updated: added `vendor` schema, listed memberships/user_identities under auth, added plans/subscriptions/usage_records (entitlements).
- §6.3 — Noted `createOutboxDrain` factory extraction with `QueueLike` structural type (shared by LISTEN path + 30s poll, imported by gate 22).
- §9.1 — Expanded. Added §9.1.1 Multi-Tenant Membership (login returns `authenticated | multi-tenant | tenant-inactive`) and §9.1.2 SECURITY DEFINER Auth Helpers (`auth_load_active_memberships`, `auth_load_refresh_token`).
- §9.2 — Expanded. Added §9.2.1 Postgres Role Split (`instigenie_app` NOBYPASSRLS vs `instigenie_vendor` BYPASSRLS), §9.2.2 Vendor Escape Hatch (cross-tenant admin path with action log), §9.2.3 Tenant Lifecycle States (active/suspended/deleted + `TenantStatusService`).
- §9.6 *(new)* — Subscription & Entitlements: plans, plan_features, subscriptions, usage_records; `packages/quotas` services; Fastify `requireFeature` + `requirePermission` preHandler pattern.
- §10.1.1 *(new)* — `initTracing()` test-injection contract + Vitest/ESM `createRequire` workaround for auto-instrumentation under vite's transformer.
- §11.3.1 *(new)* — Explicit boot-time invariant asserts table (PgBouncer URL guard, noeviction probe, bootstrap policy).
- §12.1.2 / §12.2.4 — Phase 1 and Phase 2 gate tables annotated with reinforcement gates and additional shipped gates. Gate 9 (schema drift) and historical gate 11 (audit hash chain) called out as open gaps.
- §14 — Added anti-pattern: gate tests that reimplement the invariant.
- §15 *(new)* — Full Correctness Gate Catalogue. All 23 implemented gates enumerated with production-code linkage + open-gap list.

**v1.1 — Frontend Alignment Pass (2026-04-20)**

Patch after auditing `src/app/(dashboard)/**/page.tsx` against v1.0 of this doc. Plan was ~60% aligned with the existing Next.js prototype; v1.1 closes the gaps without changing any architectural rule.

- §1.1 — Expanded module list to match frontend; added `1.1a` Prototype Surfaces (in-scope / frozen / deprecated).
- §3.1 — Next 16 + React 19; clarified `AGENTS.md` rule.
- §3.1a *(new)* — Multi-surface auth (internal dashboard vs customer portal, JWT audiences, route matcher, rate limits).
- §9.4 — Rewritten. 12 prototype roles enumerated verbatim; permission string format locked (`resource:action` snake_case plural) with contract catalogue; operator capability layer added.
- §13.2 Production — Major expansion. 15-state WO lifecycle, 13-state device lifecycle incl. `RECALLED`, BMR (dual-signature), scrap (root-cause), downtime (category), assembly lines L1–L5, line stage templates, operator capability, hold/release/dispatch flows.
- §13.3 Inventory — Added `stock_adjustments`, `stock_transfers` (two-leg), GRN read-only view clarification, stock drift detection.
- §13.4 QC — Added NCR (ISO 13485 §8.3) with lifecycle, investigation, disposition, CAPA linkage.
- §13.6 Finance — Added `purchase_invoices` (vendor bills), polymorphic `payments`, overview dashboard, reports suite.
- §13.9 *(new)* — Customer Portal (distinct auth audience, route namespace, RLS + customer filter).
- §13.10 *(new)* — Admin UI (user provisioning, role assignment, capability editor, audit search).
- §13.11 *(new)* — Reports & Dashboards cross-cutting pattern (materialised view + Redis-CACHE + SSE).
- Appendix D *(new)* — Prototype Consolidation (namespace collision redirects, folder removal plan, component dedup, frozen pages, D.7 consolidation gate).
- HR and Projects modules — explicitly out of scope; UI pages frozen on mock data.

**v1.0 — Initial Architecture (2026-04-19)**

Base document translating Python reference architecture + unified doc into the Next.js + Node.js stack with prototype context.

---

**Start signal:** When you're ready, say *"scaffold Phase 1"* and we begin with:

1. `pnpm-workspace.yaml` + `turbo.json` + root `package.json`
2. Nine `packages/*` with stubbed exports
3. Four `apps/*` with minimal bootstrap
4. `ops/compose/docker-compose.dev.yml` (Postgres + 2 Redis + PgBouncer + MinIO + Tempo + Loki)
5. `ops/sql/triggers/outbox_notify.sql` + `audit.sql` + one RLS policy
6. `packages/db/src/client.ts` with `withOrg()` + type parsers
7. `packages/money/src/index.ts` with the Number ban
8. `apps/listen-notify/src/index.ts` end-to-end
9. `apps/worker/src/critical.ts` + `scheduler.ts` + bootstrap policy check
10. `apps/api/src/server.ts` with auth module (login, refresh, logout, me)
11. `.github/workflows/ci.yml` running all 7 Phase 1 gates

Every gate in this document is testable. We build the test first, then the code that makes it pass.
