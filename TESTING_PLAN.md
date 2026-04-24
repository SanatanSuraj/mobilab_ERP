# Instigenie ERP — Testing Plan

**Document ID:** TESTING-PLAN-INSTIGENIE-2026-001
**Version:** 1.0
**Generated:** 2026-04-23
**Scope:** `apps/api`, `apps/web`, `apps/worker`, `apps/listen-notify`, `packages/*`, `ops/sql/*`

A reviewer-oriented map of the product surface and the invariants that hold it up. Four parts:

1. **[API endpoint inventory](#1-api-endpoint-inventory)** — every HTTP route, grouped by module, with auth, request/response contracts, and side effects.
2. **[User-facing pages & flows](#2-user-facing-pages--flows)** — every route in the web app, which role reaches it, and the multi-page journeys that tie them together.
3. **[Critical paths](#3-critical-paths--must-work)** — the 25 invariants that, if they break, the product is broken / dangerous / non-compliant.
4. **[Riskiest areas](#4-riskiest-areas--where-bugs-are-most-likely)** — where bugs are most likely to come from, ranked by probability × impact.

A final **[test matrix](#5-test-matrix--what-we-have-vs-what-we-need)** ties each feature to its existing gate test and flags coverage gaps.

---

## 0. How to read this

- `users:invite`, `qc:approve` — permission names, from `packages/contracts/src/permissions.ts`.
- `SUPER_ADMIN`, `SALES_REP`, etc. — role names, 12-role catalogue.
- "Gate N" — references `tests/gates/gate-N-*.test.ts`.
- "Outbox event" — side effect: row in `outbox.events` in the same transaction.
- "Audit log" — side effect: row in `audit.audit_log` with hash chain.
- "E-signature required" — endpoint enforces 21 CFR Part 11 re-auth flow.
- "BYPASSRLS" — endpoint runs through the vendor-admin pool; RLS is bypassed at DB layer.

---

## 1. API endpoint inventory

The Fastify API registers routes per module under `apps/api/src/modules/*/routes.ts`. Every request body / query is validated via a Zod schema from `packages/contracts`. Every response is typed.

### 1.1 System & health

| Endpoint | Auth | Description |
|---|---|---|
| `GET /health` | Public | Liveness probe |
| `GET /readyz` | Public | Readiness: PG + Redis reachable |
| `GET /metrics` | Public | Prometheus scrape |

**Tests:** Basic smoke. Gate 7 (bootstrap idempotent).

### 1.2 Auth — internal tenant surface

All routes in `apps/api/src/modules/auth/routes.ts`.

| Method + Path | Auth | Request | Response | Side effects |
|---|---|---|---|---|
| `POST /auth/login` | Public | `LoginRequestSchema` | Token pair + memberships | Audit outbox |
| `POST /auth/select-tenant` | Public (picker JWT) | `SelectTenantRequestSchema` | Token pair | Audit outbox |
| `POST /auth/refresh` | Public (refresh token) | `RefreshRequestSchema` | Rotated token pair | Audit |
| `POST /auth/logout` | Public (refresh token) | `{ refreshToken }` | 204 | Refresh token moves to `auth.revoked_tokens` |
| `GET /auth/me` | Authed (internal or portal) | — | `UserProfile` | — |

**Tests:** Gate 23 (auth rotation + replay rejection). **Missing:** explicit logout-replay gate, multi-org picker flow E2E.

### 1.3 Admin users & invitations

`apps/api/src/modules/admin-users/routes.ts`.

| Method + Path | Permission | Request | Response | Side effects |
|---|---|---|---|---|
| `POST /admin/users/invite` | `users:invite` | `InviteUserRequest` | `InviteUserResponse` | Outbox `user.invite.created` → email dispatch |
| `GET /admin/users/invitations` | `users:invite` | `ListInvitationsQuery` | `ListInvitationsResponse` | — |
| `POST /admin/users/invitations/:id/revoke` | `users:invite` | — | `InvitationSummary` | Audit |
| `GET /auth/accept-invite/preview` | Public (raw token) | `?token=` | `AcceptInvitePreviewResponse` | — |
| `POST /auth/accept-invite` | Public (raw token) | `AcceptInviteRequest` | `AcceptInviteResponse` (access + refresh) | `users` upsert, `memberships` upsert, `user_roles` insert, `user_invitations.accepted_at` set |

**Tests:** Invitation happy-path (needs gate). **Risk:** concurrent accept-invite race (see §4.3).

### 1.4 Admin audit

| Method + Path | Permission | Description |
|---|---|---|
| `GET /admin/audit/entries` | `admin:audit:read` | Tenant-scoped audit feed, RLS-filtered |

### 1.5 CRM (`module.crm` feature-gated)

`apps/api/src/modules/crm/routes.ts`. All routes namespaced `/crm/*`.

**Accounts** — `accounts:{read,create,update,delete}`
- `GET /crm/accounts` • `GET /crm/accounts/:id` • `POST /crm/accounts` • `PATCH /crm/accounts/:id` • `DELETE /crm/accounts/:id`

**Contacts** — `contacts:{read,create,update,delete}`
- Same CRUD shape under `/crm/contacts`.

**Leads** — `leads:{read,create,update,delete,convert}`
- CRUD + `POST /crm/leads/bulk` (max 500, partial-success report) + `GET/POST /crm/leads/:id/activities` + `POST /crm/leads/:id/lose` + `POST /crm/leads/:id/convert` (emits outbox, creates Account+Contact+Deal)

**Deals** — `deals:{read,create,update,delete,transition}`
- CRUD + `POST /crm/deals/:id/transition` — validated against `ALLOWED_DEAL_TRANSITIONS` (Gate 46)

**Tickets** — `tickets:{read,create,update,delete,transition,comment}`
- CRUD + `POST /crm/tickets/:id/transition` + `GET/POST /crm/tickets/:id/comments`

**Quotations** — `quotations:{read,create,update,approve,convert_to_so}`
- CRUD + `POST /crm/quotations/:id/transition` + `POST /crm/quotations/:id/approve` + `POST /crm/quotations/:id/convert` → creates SalesOrder

**Sales Orders** — `sales_orders:{read,create,update,approve_finance}`
- CRUD + `POST /crm/sales-orders/:id/transition` + `POST /crm/sales-orders/:id/finance-approve`

**Tests:** Gate 8 (CRM tenant isolation), Gate 46 (deal + ticket 20×20 transition matrix), Gate 51 (quotation approval), Gate 52 (SO confirmed → stock reserve), Gate 53 (SO dispatched → invoice draft).

### 1.6 Inventory (`module.inventory` feature-gated)

`apps/api/src/modules/inventory/routes.ts`.

**Warehouses / Items / Bindings** — `inventory:{read,adjust}`
- Standard CRUD.

**Stock ledger** — `inventory:{read,adjust,receive,issue,transfer}` (dynamic by `txn_type`)
- `GET /inventory/stock/ledger` • `POST /inventory/stock/ledger` — **E-signature required for `SCRAP` and `CUSTOMER_ISSUE`**

**Stock summary** (read-only projection)
- `GET /inventory/stock/summary` • `GET /inventory/stock/summary/:itemId/:warehouseId`

**Reservations** — `inventory:issue`
- `GET/POST /inventory/reservations` • `POST /inventory/reservations/bulk` (MRP all-or-nothing) • `POST /inventory/reservations/:id/release` • `POST /inventory/reservations/by-ref/:refDocType/:refDocId/release` (idempotent bulk) • `POST /inventory/reservations/:id/consume` (→ WO_ISSUE ledger entry)

**Tests:** Gate 27 (reservations), Gate 52 (auto-reserve from SO). **Missing:** GRN-QC failure → auto-NCR integration, bulk reserve rollback under partial failure.

### 1.7 Procurement (`module.procurement` feature-gated)

**Vendors / Indents / Purchase Orders / GRNs** — under `/procurement/*`, permissions under `purchase_orders:*`.

Critical endpoint: `POST /procurement/grns/:id/post` — requires `inventory:receive`, runs a transaction that writes `stock_ledger` + updates `purchase_order_lines.received_qty`.

**Missing coverage:** three-way match (PO ↔ GRN ↔ Purchase Invoice), over-receipt prevention, partial GRN aggregation.

### 1.8 Production (`module.manufacturing` feature-gated)

**Products / BOMs / Work Orders** — `/production/*`.

- `POST /production/boms/:id/activate` — transaction: atomically supersede prior ACTIVE, promote this to ACTIVE.
- `POST /production/work-orders` — transaction: copies WIP stages from template.
- `POST /production/work-orders/:id/stages/:stageId/advance` — state-machine transition, permission `wip_stages:advance`, may trigger stock/approval side effects.
- `GET /production/wip-stage-templates` — read-only.

**Missing coverage:** 15-state WO lifecycle exhaustive matrix; device lifecycle including `RECALLED` → credit note auto-generation; BMR dual-signature path.

### 1.9 QC (`module.manufacturing` feature-gated)

**Templates / Parameters / Inspections / Findings / Certificates** — under `/qc/*`.

- `POST /qc/inspections/:id/complete` — dual permission: `qc:approve` if verdict=PASS, `qc:reject` if verdict=FAIL. Emits outbox on PASS (cert-issuance trigger).
- `POST /qc/certs` — append-only, `qc:approve`. Outbox event + audit.
- `DELETE /qc/certs/:id` — soft recall (audit preserved).

**Tests:** Gate 40 (QC cert hash chain). **Missing:** NCR auto-open on failed inspection (NCR endpoints are frozen — Phase 5), CAPA linkage.

### 1.10 Finance (core, no feature gate)

**Sales Invoices** — `sales_invoices:*`. Header + lines.
- `POST /finance/sales-invoices` — **E-signature required**. Creates DRAFT.
- `POST /finance/sales-invoices/:id/post` — posts, writes `customer_ledger` entry in transaction.
- `POST /finance/sales-invoices/:id/cancel` — writes reversal ledger entry.

**Purchase Invoices** — `purchase_invoices:*`. Same pattern against `vendor_ledger`.

**Customer / Vendor Ledger** — read-only: list, detail, `/customers/:customerId/balance` and `/vendors/:vendorId/balance`.

**Payments** — `payments:*`. Polymorphic (can settle N invoices in one transaction).
- `POST /finance/payments` — transaction: ledger entries per settled invoice.
- `POST /finance/payments/:id/void` — reversal.

**Overview** — `GET /finance/overview` — dashboard KPIs.

**Tests:** Gate 1 + 2 (Number ban + decimal round-trip), Gate 53 (invoice flow end-to-end). **Missing:** idempotent post under client retry, ledger running-balance consistency property test, GST computation boundary test (IST vs UTC — see §4.14).

### 1.11 Notifications (core)

**Inbox** (per-user) — `notifications:read`
- `GET /notifications` • `GET /notifications/:id` • `GET /notifications/unread-count` • `POST /notifications/mark-read` • `POST /notifications/mark-all-read` • `DELETE /notifications/:id`

**Admin dispatch** — `notifications:{admin_read,dispatch}`
- `GET /notifications/all` • `POST /notifications` (cross-user)

**Templates** — `notifications:templates:manage`
- CRUD on `/notifications/templates`.

**Tests:** Gate 31. **Missing:** SSE stream endpoint (if present); channel fallback (email → WhatsApp).

### 1.12 Approvals (core workflow engine)

- `GET /approvals` — list
- `GET /approvals/inbox` — pending steps addressed to user's role
- `GET /approvals/:id` — full detail with steps + transitions
- `POST /approvals` — `approvals:request`, create request (logs workflow_transitions)
- `POST /approvals/:id/act` — `approvals:act`, approve/reject a step. **E-signature required if `step.requires_e_signature`**
- `POST /approvals/:id/cancel` — cancel pending

Chains:
- `GET /approvals/chains` • `GET /approvals/chains/:id` • `POST /approvals/chains` (`approvals:chains:manage`) • `DELETE /approvals/chains/:id`

**Tests:** Gate 42 (e-signature). **Missing:** concurrent approver race (see §4.2), amount-gated escalation, audit trail hash linkage per approval (see §4.7).

### 1.13 Vendor-admin surface — **BYPASSRLS**

`apps/api/src/modules/vendor/routes.ts`. All requests flow through `vendorPool` (separate DB role `instigenie_vendor`, `BYPASSRLS`).

| Path | Description | Side effects |
|---|---|---|
| `POST /vendor-admin/auth/login` | Vendor staff login | Audit |
| `POST /vendor-admin/auth/refresh` | Rotate vendor token | — |
| `POST /vendor-admin/auth/logout` | Revoke refresh | — |
| `GET /vendor-admin/auth/me` | Vendor profile | — |
| `GET /vendor-admin/tenants` | List all tenants | **BYPASSRLS read** |
| `POST /vendor-admin/tenants/:orgId/suspend` | Suspend tenant | Outbox + `vendor.action_log` |
| `POST /vendor-admin/tenants/:orgId/reinstate` | Reinstate tenant | Outbox + `vendor.action_log` |
| `POST /vendor-admin/tenants/:orgId/change-plan` | Change plan | Invalidates feature-flag cache |
| `GET /vendor-admin/audit` | Cross-org admin action log | — |

**Tests:** Gate 18 (vendor action log), Gate 19 (vendor BYPASSRLS verified). **Risk:** pool mix-up (§4.12).

### 1.14 Customer portal — `instigenie-portal` JWT audience

Rate limit: 60 rpm/user + 300 rpm/IP. Audience-gated: rejects internal tokens.

| Path | Description |
|---|---|
| `GET /portal/me` | Customer profile |
| `GET /portal/orders` / `/portal/orders/:id` | Read-only SO history |
| `GET /portal/invoices` / `/portal/invoices/:id` | Read-only invoice history |
| `GET /portal/tickets` / `/portal/tickets/:id` | Customer tickets |
| `POST /portal/tickets` | Create ticket — audit + customer ownership check |
| `POST /portal/tickets/:id/comments` | Add comment — audit + ownership check |

**Tests:** Gate 32 (portal isolation — internal token cannot call portal routes, vice versa).

---

## 2. User-facing pages & flows

Next.js 16 App Router under `apps/web/src/app/**/page.tsx`. ~155 pages across four surfaces.

### 2.1 Surface map

| Surface | Route root | Auth | Count |
|---|---|---|---|
| Tenant staff | `/(dashboard)/*` | `instigenie-session` cookie → `instigenie-internal` JWT | ~120 |
| Customer portal | `/(dashboard)/portal/*` | `instigenie-portal` JWT | 2 |
| Vendor admin | `/vendor-admin/*` | `instigenie-vendor` JWT (own storage) | 4 |
| Auth / public | `/auth/*`, `/login` | none | 3 |

### 2.2 Tenant staff — by module

Roles in the 12-role catalogue. Access enforced by `useTenantAuthGuard` + `requirePermission` / `requireFeature` gates.

#### CRM — `/crm/*` (real API)
| Route | Roles | Key actions |
|---|---|---|
| `/crm/leads` + `/[id]` | SALES_REP, SALES_MANAGER, MANAGEMENT | Create / bulk-import / assign / convert |
| `/crm/deals` + `/[id]` | same | Create / move stage (20×20 matrix) / link quote |
| `/crm/accounts` + `/[id]` | same | Create / merge / link contacts |
| `/crm/contacts` | same | Directory + bulk import |
| `/crm/quotations` + `/[id]` | + FINANCE | Create / approve / convert to SO / e-sig send |
| `/crm/orders` + `/[id]`, `/crm/sales-orders` (alias) | + FINANCE + PRODUCTION | Confirm / shipment / invoice link |
| `/crm/pipeline` | SALES_* / MANAGEMENT | Kanban drag-to-update |
| `/crm/reports` | SALES_MANAGER / MANAGEMENT | Win-loss analytics |
| `/crm/tickets` + `/[id]` | SALES_* + CUSTOMER | Support queue |

#### Production — `/production/*` (real API)
| Route | Roles | Key actions |
|---|---|---|
| `/production/work-orders` + `/[id]` | PRODUCTION, PRODUCTION_MANAGER, RD, QC_MANAGER | Create / advance stage / QC hold / rework |
| `/production/dashboard` | PRODUCTION, PRODUCTION_MANAGER | KPIs |
| `/production/bom` + `/[id]` | + RD | Version / activate / edit components |
| `/production/shop-floor` | PRODUCTION | Scan-to-advance, line pause/resume |
| `/production/device-ids` | PRODUCTION, RD | Recall, deactivate, link to WO |
| `/production/scrap` | + QC_MANAGER | Log scrap + root cause + CAPA link |
| `/production/wip`, `/mrp`, `/ecn`, `/oee`, `/reports` | PRODUCTION_MANAGER / RD / MANAGEMENT | Analytics + planning |

#### Finance — `/finance/*` (real API)
| Route | Roles | Key actions |
|---|---|---|
| `/finance/overview` | FINANCE, SUPER_ADMIN, MANAGEMENT | AR + AP dashboard |
| `/finance/sales-invoices` + `/[id]` | + CUSTOMER (read-only) | Create / post / cancel / e-sign |
| `/finance/purchase-invoices` | + PROCUREMENT | Match to GRN |
| `/finance/payments` | FINANCE | Record + reconcile |
| `/finance/approvals` | FINANCE, MANAGEMENT | Amount-gated queue |
| `/finance/customer-ledger`, `/vendor-ledger` | FINANCE + SALES_MANAGER / PROCUREMENT | Aging |
| `/finance/eway-bills`, `/gst-reports`, `/reports` | FINANCE, SUPER_ADMIN | Compliance + analytics |

#### Procurement — `/procurement/*` (real API)
| Route | Roles | Key actions |
|---|---|---|
| `/procurement/indents` + `/[id]` + `/new` | PROCUREMENT, PRODUCTION, MANAGEMENT | Create / submit / convert to PO |
| `/procurement/purchase-orders` + `/[id]` + `/new` | + FINANCE, SUPER_ADMIN | Issue / amend / cancel |
| `/procurement/vendors` + `/[id]` | PROCUREMENT, SUPER_ADMIN | Profile + performance |
| `/procurement/grn-qc` | QC_INSPECTOR, QC_MANAGER, PROCUREMENT | Receipt + inspect — auto-NCR on fail |
| `/procurement/inward` | STORES, PROCUREMENT | Put-away + label |
| `/procurement/returns` | + STORES | RMA + debit note |
| `/procurement/approvals`, `/dashboard`, `/reports` | MANAGEMENT, FINANCE | Analytics |

#### QC — `/qc/*` (real API; NCR + CAPA frozen)
| Route | Roles | Key actions |
|---|---|---|
| `/qc/dashboard` | QC_INSPECTOR, QC_MANAGER | KPIs |
| `/qc/inspections` + `/[id]` | same | Start / log defects / complete |
| `/qc/inward`, `/wip`, `/final` | same + PROCUREMENT / PRODUCTION | Source-specific inspection |
| `/qc/ncr`, `/qc/capa` | **FROZEN — Phase 5 mock only** | — |
| `/qc/templates`, `/equipment`, `/certs`, `/reports` | QC_MANAGER + CUSTOMER (certs) | Template CRUD, calibration, CoA/CoC, SPC |

#### Inventory — `/inventory/*` (real API)
| Route | Roles | Key actions |
|---|---|---|
| `/inventory/items`, `/stock`, `/ledger`, `/batches`, `/serials` | STORES + PRODUCTION + PROCUREMENT + SUPER_ADMIN | Master + lifecycle + tracking |
| `/inventory/grn`, `/transfers`, `/adjustments`, `/reorder` | STORES + PROCUREMENT | Movement + variance |
| `/inventory/warehouses`, `/reports` | STORES + SUPER_ADMIN / MANAGEMENT | Setup + analytics |

#### Admin — `/admin/*`
| Route | Roles | Key actions |
|---|---|---|
| `/admin/users` | SUPER_ADMIN, MANAGEMENT | Invite / suspend / revoke role (new invitation flow) |
| `/admin/audit` | SUPER_ADMIN, MANAGEMENT | Mutation feed (hash-chained) |

#### Root + ancillary
- `/` — role-aware dashboard router (lazy loads ManagementDashboard / SalesDashboard / ProductionDashboard / FinanceDashboard / QCDashboard / StoresDashboard).
- `/notifications` — per-user inbox.
- `/spreadsheets` — **FROZEN / stub**.

#### Frozen & deprecated
- **HR** (`/hr/*`) — mock-backed, post-launch.
- **Projects** (`/projects/*`) — mock-backed, post-launch.
- **Manufacturing** (`/manufacturing/*`), **MFG** (`/mfg/*`) — 301 → `/production/*`.
- **Accounting** (`/accounting/*`) — 301 → `/finance/*`.

### 2.3 Customer portal — `/portal/*`
- `/portal` — home (quick links + activity timeline).
- `/portal/orders` + `/portal/orders/[id]` — order + invoice + shipment status.

**Flows to cover:** order tracking, invoice download, ticket creation from order detail.

### 2.4 Vendor admin — `/vendor-admin/*`
- `/vendor-admin/login` — separate credentials.
- `/vendor-admin` → redirect to `/vendor-admin/tenants`.
- `/vendor-admin/tenants` + `/[orgId]` — cross-tenant list + detail.
- `/vendor-admin/audit` — global mutation feed.

### 2.5 Auth — `/auth/*`, `/login`
- `/auth/login` — real API login. Multi-tenant picker on `status: "multi-tenant"` response.
- `/auth/accept-invite?token=…` — invitation landing; preview → submit (password for new identity; name-only for existing).
- `/login` — legacy mock login (redirects to `/auth/login`).

### 2.6 Primary user journeys (multi-page flows)

These are the end-to-end flows that deserve E2E tests (Playwright / Cypress). Each crosses 4–8 pages and multiple roles.

**J1. Lead → Deal → Quotation → Order → Invoice → Payment**
SALES_REP creates lead → converts to deal → advances through pipeline → builds quotation (multi-line) → SALES_MANAGER approves → converts to SO → FINANCE posts invoice (e-sig) → records payment. Customer sees SO in portal.

**J2. Indent → PO → GRN → GRN-QC → Inward**
PRODUCTION raises indent (or MRP auto-suggests) → PROCUREMENT converts to PO → MANAGEMENT approves if >threshold → PO issued → vendor ships → QC_INSPECTOR runs GRN-QC → pass: STORES puts away; fail: NCR auto-opens.

**J3. Work order lifecycle (15 states)**
SO released → MRP reserves stock → WO created from BOM → stages advance (MATERIAL_CHECK → IN_PROGRESS → QC_HOLD → REWORK* → COMPLETED) → final QC → shipment.

**J4. BMR dual signature**
WO complete → BMR generated → PRODUCTION_MANAGER signs (sig #1, e-signature) → QC_MANAGER signs (sig #2, e-signature) → cert auto-issues.

**J5. NCR → Disposition → CAPA** *(Phase 5 — frozen UI)*
Failed inspection → auto-NCR → investigation → disposition (rework/scrap/accept) → CAPA linked for CRITICAL/MAJOR → closure.

**J6. E-Way Bill generation**
Invoice posted → EWB generated (vehicle + transporter) → linked to shipment. 30-day / 1000-km expiry.

**J7. Device recall**
Dispatched device → recall action → status RECALLED → credit note auto-issued → stock reversed → customer notified.

**J8. Invitation flow**
SUPER_ADMIN invites at `/admin/users` → email link (dev: toast) → `/auth/accept-invite` → password (or just name if identity exists) → lands on role-appropriate dashboard.

**J9. Multi-tenant login**
User with memberships in 2+ orgs logs in → tenant picker → selects org → internal JWT minted with `org` claim → dashboard.

**J10. Vendor-admin tenant action**
Vendor staff logs in → picks tenant → suspends / reinstates / changes plan → `vendor.action_log` row → outbox event.

---

## 3. Critical paths — MUST work

Ranked by blast radius if broken. Sourced from ARCHITECTURE.md §2 "Non-Negotiable Rules" + §15 "Correctness Gate Catalogue" + existing `tests/gates/*`.

### 3.1 Tenant isolation via RLS
- **Why**: cross-tenant data leak = regulatory breach, customer loss, legal liability.
- **Where**: `ops/sql/rls/*`, `packages/db/src/with-org.ts`, every query wrapped in `withOrg(pool, orgId, fn)`.
- **Break scenario**: query bypasses `withOrg()` → returns 0 rows silently (because app role is `NOBYPASSRLS`); developer adds a workaround that leaks.
- **Test**: Gate 5, Gate 8 (CRM isolation), Gate 12 (policy coverage), Gate 13 (`WITH CHECK` on INSERT). **Add**: lint + runtime guard against `pool.query()` outside `withOrg()`.

### 3.2 `NOBYPASSRLS` on app role
- **Why**: last line of defence if `withOrg()` is forgotten.
- **Test**: Gate 11.

### 3.3 Vendor escape hatch + action log
- **Why**: cross-tenant operations must leave an immutable trail.
- **Where**: `instigenie_vendor` role (`BYPASSRLS`), `vendor.action_log`.
- **Test**: Gate 18 (every vendor mutation logged), Gate 19 (role has `BYPASSRLS`, app role does not).

### 3.4 JWT audience isolation
- **Why**: customer (portal) token accessing internal APIs = privilege escalation.
- **Where**: `requireAudience('instigenie-internal')` vs `'instigenie-portal'` vs `'instigenie-vendor'`.
- **Test**: Gate 32. **Add**: coverage for token refresh preserving audience.

### 3.5 Auth refresh rotation + replay rejection
- **Where**: `apps/api/src/modules/auth/service.ts`, `auth.sessions`, `auth.revoked_tokens`.
- **Test**: Gate 23 — first refresh ok, second use of old token → 401.

### 3.6 Multi-tenant login (picker flow)
- **Where**: `AuthService.login` returns `multi-tenant` on >1 active membership; picker token exchanges at `/auth/select-tenant`.
- **Test**: currently thin. **Add** E2E: same identity in 2 orgs, each org has distinct role → correct dashboard shows.

### 3.7 Outbox delivery (transactional write + LISTEN/NOTIFY + handler idempotency)
- **Where**: `packages/db/src/enqueue-outbox.ts`, `ops/sql/triggers/outbox-notify.sql`, `apps/listen-notify/src/drain.ts`, `outbox.handler_runs`.
- **Break scenario**: NOTIFY fires pre-commit → listener reads row before committed → no-op. Or handler runs twice → double side-effect.
- **Test**: Gate 4 (trigger fires), Gate 22 (E2E with LISTEN + poller fallback), Gate 38 (handler idempotency), Gate 3 (dedup by key).

### 3.8 LISTEN bypasses PgBouncer
- **Why**: PgBouncer transaction mode drops subscriptions at txn end.
- **Test**: Gate 20 (listener uses `DATABASE_DIRECT_URL`, not PgBouncer URL).

### 3.9 BullMQ on `noeviction` Redis
- **Why**: `volatile-lru` would evict jobs under memory pressure → silent data loss.
- **Test**: Gate 21.

### 3.10 Decimal.js money arithmetic
- **Where**: `packages/money/*`, `packages/db/src/type-parsers.ts` (NUMERIC → string).
- **Test**: Gate 1 (ESLint bans `Number`, `parseFloat` in money paths), Gate 2 (NUMERIC round-trip precision).

### 3.11 Stock ledger append-only + reservation atomicity
- **Where**: `inventory.stock_ledger` (no UPDATE/DELETE policy), `inventory.stock_reservations`, `public.reserve_stock_atomic()`, trigger `tg_stock_summary_from_ledger`.
- **Test**: Gate 27, Gate 52. **Add**: concurrent reservation load test; assert ledger → summary remains consistent under failure injection.

### 3.12 Customer / vendor ledger append-only + balance consistency
- **Where**: `finance.customer_ledger`, `finance.vendor_ledger`, balance-check triggers.
- **Test**: Gate 53 (SO → invoice → ledger). **Add**: property test — balance always equals sum of entries.

### 3.13 Electronic signature (21 CFR Part 11)
- **Where**: `EsignatureService`, `approval_steps.e_signature_hash`, `workflow_transitions.e_signature_hash`.
- **Test**: Gate 42 (6 cases: missing / wrong / correct password, non-e-sig compat, service injection fail-closed).

### 3.14 Audit trail hash chain
- **Where**: `audit.audit_log`, `qc_cert_chain_audit_runs`, worker sweep.
- **Test**: Gate 40 (cert chain), Gate 41 (audit chain nightly sweep).

### 3.15 Approval state machines
- **Entities**: work_order, device_qc_final, bmr_approval, purchase_order, ncr, deal, ticket, quotation, sales_order.
- **Where**: `ALLOWED_*_TRANSITIONS` maps in contracts, `ApprovalsService.act()`.
- **Test**: Gate 46 (deal + ticket 20×20), Gate 51 (quotation). **Add**: exhaustive matrix for WO 15-state, device lifecycle including `RECALLED`.

### 3.16 RBAC catalog sync (code ↔ seed ↔ DB)
- **Where**: `packages/contracts/src/permissions.ts` vs `ops/sql/seed/0{1,2}-*.sql`.
- **Test**: Gate 6.

### 3.17 Feature flags + quotas (plan-gated)
- **Where**: `packages/quotas/*`, `requireFeature(key)` preHandler.
- **Test**: Gate 16 (feature off → 402), Gate 17 (quota exceeded → 402 pre-INSERT).

### 3.18 Bootstrap invariants
- **Where**: `apps/api/src/bootstrap.ts`, `apps/worker/src/bootstrap.ts`, `apps/listen-notify/src/bootstrap.ts`.
- **Test**: Gate 7 (idempotent), Gate 20 (PgBouncer bypass for listener), Gate 21 (Redis noeviction), + assert NUMERIC type parser installed.

### 3.19 Session invalidation on logout
- **Test**: Gate 23 logout-then-use-token case.

### 3.20 Schema drift prevention
- **Where**: `packages/contracts/*` vs DB schema.
- **Test**: Gate 9 (cross-app `tsc --noEmit`).

### 3.21 Notification dispatch does not block business events
- **Test**: Gate 31. **Add**: SSE reconnect preserving unread delivery.

### 3.22 GST monthly computation (deterministic, timezone-aware)
- **Where**: `finance.gst_computation`, pg_cron job, `public.compute_monthly_gst()`.
- **Test**: **Missing.** Add regression on IST/UTC boundary + idempotent recompute.

### 3.23 Work-order + device lifecycle including RECALLED
- **Test**: **Missing.** Add: dispatch a device → recall → assert credit note auto-issued, stock reversed, customer notified.

### 3.24 PDF generation isolated to dedicated worker
- **Where**: `apps/worker/src/processors/pdf-render.ts`.
- **Test**: **Missing.** Add: timeout on malformed HTML → DLQ, no main worker starvation.

### 3.25 Cross-cutting invariants
- Every query wrapped in `withOrg()` — **lint + runtime guard missing**.
- Every NUMERIC returns as string — Gate 2 covers parser install.
- Every outbox handler idempotent on event_id — Gate 38.
- Every JWT check validates audience — Gate 32.
- Every `audit.audit_log` row has valid `prev_hash` — Gate 41.
- Every org-scoped table has an RLS policy — Gate 12.
- Every approval transition validated against `ALLOWED_*_TRANSITIONS` — Gate 46 (partial).
- No UPDATE/DELETE on posted ledger / audit rows — **explicit gate missing**.

---

## 4. Riskiest areas — where bugs are most likely

Ranked by probability × impact. Each has a specific failure scenario and a concrete test strategy.

### 4.1 Stock ledger → summary trigger race **[HIGH / CRITICAL]**
- **Where**: `ops/sql/init/03-inventory.sql` (trigger `tg_stock_summary_from_ledger`), `apps/api/src/modules/inventory/stock.service.ts`.
- **Failure**: Concurrent GRN + WO issue to the same warehouse — trigger is per-row, but if the parent transaction fails after some rows commit, summary and ledger drift. No re-sync mechanism.
- **Test**: load test 50 concurrent GRN posts + WO consumes on same item; kill PG mid-burst; assert `stock_summary = SUM(stock_ledger)` per `(org_id, item_id, warehouse_id)`.

### 4.2 Concurrent approval step transitions **[HIGH / CRITICAL]**
- **Where**: `apps/api/src/modules/approvals/approvals.service.ts`, `approvals.repository.ts`.
- **Failure**: two approvers for the same role+step click simultaneously — `FOR UPDATE` on the request locks, but there's no uniqueness on `(request_id, step_number)` APPROVED transitions. Both can INSERT into `approval_decisions`, one silently loses.
- **Test**: two authed clients → simultaneous `POST /approvals/:id/act` → assert exactly one APPROVED decision, the other returns a clean conflict error, audit trail consistent.

### 4.3 Concurrent accept-invite race **[HIGH / CRITICAL]**
- **Where**: `apps/api/src/modules/admin-users/service.ts` / `repository.ts` — `acceptInvitationTx`.
- **Failure**: same email invited to two orgs accepts both in parallel → identity creation racing; one accept may bind to wrong identity. (The upsert on `(identity_id, org_id)` fixed one bug, but the identity-creation step itself is not serialized.)
- **Test**: seed two invites for same email in two orgs; fire both accepts concurrently; assert two distinct memberships on same identity, both usable.

### 4.4 Next.js 16 `params` / `searchParams` are Promises **[HIGH / HIGH]**
- **Where**: every `apps/web/src/app/**/[id]/page.tsx`.
- **Failure**: Next 16 made these Promises. Code that reads them synchronously will break at prerender or hydration. `useSearchParams()` in client components is still sync, but any server component treating `params` as an object rather than `await params` will fail.
- **Test**: CI — run `next build` with prerender; fail build on any timeout or hydration warning. Spot-check all `[id]` pages.

### 4.5 Outbox idempotency key not universally supplied **[HIGH / HIGH]**
- **Where**: `packages/db/src/outbox.ts`, `apps/worker/src/handlers/index.ts`.
- **Failure**: handlers that retry without the same idempotency key produce duplicate events. `ON CONFLICT DO NOTHING` only fires if the key is present AND the unique index exists on it.
- **Test**: handler-catalogue unit test — assert every handler's `enqueueOutbox` call supplies a deterministic key. Also: assert unique index exists on `outbox.events(idempotency_key)` where not null.

### 4.6 `Number()` / `parseFloat()` leaks outside `packages/money` **[HIGH / HIGH]**
- **Where**: grep reported ~30 files across finance + inventory with direct numeric coercion on money/quantity values. `packages/money` has the rules but no repo-wide ESLint enforcement is visible.
- **Test**: promote the Gate 1 rule from `packages/money` to a root ESLint config that covers `apps/api/src/modules/finance/*`, `.../inventory/*`, `.../procurement/*`. Then: property-test invoice total = Σ line totals at 18 decimal places.

### 4.7 Approval audit gaps (no hash chain across steps) **[MEDIUM-HIGH / HIGH]**
- **Where**: `approval_decisions` vs `audit.audit_log`.
- **Failure**: approval state changes land in `approval_decisions`, but `audit_log` only captures the initial POST. Intermediate transitions are not hash-chained with the rest of the audit trail.
- **Test**: full approval A→B→C→D journey; query `audit_log` and assert every transition appears, with valid `prev_hash` linkage.

### 4.8 `SECURITY DEFINER` auth helpers overly reachable **[MEDIUM / HIGH]**
- **Where**: `ops/sql/rls/03-auth-cross-tenant.sql` — `auth_load_active_memberships`, `auth_load_refresh_token`, `auth_load_invitation`.
- **Failure**: these bypass RLS by design (pre-auth lookups). If called from anywhere other than the intended endpoint, they leak org membership / refresh tokens.
- **Test**: SQL audit: enumerate every `SECURITY DEFINER` function; ensure each is called from exactly one code path; restrict EXECUTE to minimum role set.

### 4.9 Stock reservation deadlock retry without backoff **[MEDIUM / MEDIUM]**
- **Where**: `apps/api/src/modules/inventory/reservations.service.ts`.
- **Failure**: tail-recursive retry on `40P01` / `55P03` with no delay → CPU spin + connection exhaustion under contention.
- **Test**: 50 concurrent reservations on one item; measure p99 latency, timeouts, PG connection count. Patch to use exponential backoff + max retries.

### 4.10 Missing idempotency on PO approval / invoice post **[MEDIUM / MEDIUM]**
- **Where**: `procurement/purchase-orders.service.ts`, `finance/sales-invoices.service.ts`.
- **Failure**: client retry after commit-but-before-response → duplicate transitions. Outbox should dedup downstream, but the POST itself is not guarded by an Idempotency-Key header.
- **Test**: chaos test — inject 30% 504s in these routes; assert client retries produce one posted invoice, not two.

### 4.11 React 19 `setState` in `useEffect` cleanup **[MEDIUM / LOW]**
- **Where**: recent accept-invite work navigated this; other pages with heavy client state (`/production/work-orders`, `/qc/inspections/[id]`, `/procurement/indents/new`) likely have similar patterns.
- **Test**: RTL mount + unmount-before-resolve for the 5 heaviest client-state pages.

### 4.12 Vendor-admin pool mix-up **[MEDIUM / HIGH]**
- **Where**: `apps/api/src/modules/vendor/*`.
- **Failure**: nothing type-checks that vendor routes only use `vendorBypassRlsPool`. A developer pasting `withOrg(deps.pool, ...)` into a vendor handler would invert the semantics.
- **Test**: lint rule banning `withOrg` in `modules/vendor/**`; runtime assertion on handler entry.

### 4.13 Invoice cancel reversal txn coupling **[MEDIUM / HIGH]**
- **Where**: `finance/sales-invoices.service.ts` cancel path.
- **Failure**: invoice flip to CANCELLED + reversal ledger insert in same txn — if a trigger fails later, both roll back but the outbox event for cancellation may already be in flight.
- **Test**: inject failure between ledger insert and txn commit; verify invoice, ledger, outbox are all consistent (either all three happened or none).

### 4.14 GST filing timezone **[MEDIUM / HIGH]**
- **Where**: any `/finance/*` query filtering on `created_at` with UTC literal.
- **Failure**: a sale at 23:59 UTC on Mar 31 is already Apr 1 IST → filtered out of April GSTR. Compliance impact.
- **Test**: create invoice at boundary times; assert report includes/excludes correctly based on `AT TIME ZONE 'Asia/Kolkata'`.

### 4.15 WO state machine — RECALLED transition **[LOW-MEDIUM / HIGH]**
- **Where**: work-order service.
- **Failure**: `RECALLED` state might be reachable from invalid prior states, or transitions out of `RECALLED` might re-open stock reservations.
- **Test**: exhaustive transition matrix against `ALLOWED_WO_TRANSITIONS`.

### 4.16 LISTEN backpressure under high volume **[LOW / HIGH]**
- **Where**: `apps/listen-notify/src/drain.ts`.
- **Failure**: NOTIFY payload > 8KB silently truncates; listener buffer overflows at 1000+ events/sec.
- **Test**: flood outbox with 10k events in 10s; assert 30s poller catches any LISTEN gaps; confirm all `handler_runs` reach COMPLETED.

### 4.17 PDF rendering timeout without fallback **[LOW / MEDIUM]**
- **Where**: `apps/worker/src/processors/pdf-render.ts`.
- **Test**: feed malformed HTML; assert worker kills the job at timeout, DLQ routes it, other workers continue.

### 4.18 Decimal.js → JSON serialization **[LOW / MEDIUM]**
- **Where**: API response layer.
- **Failure**: money fields serialized as strings; a frontend consumer using `Number(amount)` reintroduces IEEE-754 drift.
- **Test**: contract test — assert every money field in every API response is a string matching `/^-?\d+(\.\d+)?$/`; frontend money-display component explicitly uses Decimal, never `Number`.

### 4.19 Audit log retention unbounded **[LOW / MEDIUM]**
- **Where**: `audit.audit_log`.
- **Failure**: 60M rows/year at 10k users; unpartitioned table → query slowdown, autovacuum pressure.
- **Test**: schema audit — is `audit_log` partitioned by `pg_partman` monthly? If not, plan the migration now, before 10k.

### 4.20 `useTransition` double-submit **[LOW / LOW]**
- **Where**: `/auth/accept-invite`, any form using `startTransition`.
- **Test**: disable submit button on pending; E2E test double-click → single POST.

### 4.21 Code smell: large service files **[MEDIUM / LOW]**
- `dispatcher.service.ts` (746), `sales-invoices.service.ts` (663), `approvals.service.ts` (574), `payments.service.ts` (497). High cyclomatic complexity → hidden bugs in paths not covered by gates.
- **Action**: extract pure helpers (template render, line totaling, status check) into sibling modules for unit-testability.

### 4.22 No unit test coverage inside module services
- Tests live at `tests/gates/*` (integration level). Service methods aren't exercised in isolation.
- **Action**: add `vitest` + PG fixture harness; cover every service method with unit tests for edge cases (empty inputs, null foreign keys, malformed dates).

### 4.23 Access token (`jti`) not revocable
- Refresh tokens are revocable (`auth.revoked_tokens`); access tokens aren't. A stolen access token is valid until expiry.
- **Action**: store `jti` on mint; check against revocation list on every request (via `redis-bull` to avoid LRU eviction — see security critique).

---

## 5. Test matrix — what we have vs what we need

Ties the above together. For each testable domain, shows the existing gate, the coverage area, and gaps to close.

| Domain | Existing gate(s) | Covers | Gap |
|---|---|---|---|
| RLS policy presence | 12 | Every org-scoped table has a policy | Enforcement guard in app code |
| RLS cross-tenant isolation | 5, 8 | Org A can't read org B's CRM data | Inventory, production, finance, QC equivalents |
| NOBYPASSRLS app role | 11 | Role config | — |
| Vendor BYPASSRLS + action log | 18, 19 | Vendor reads all orgs; mutations logged | Action log immutability under tamper |
| JWT audience isolation | 32 | Portal vs internal vs vendor | Refresh preserving audience; SSE audience check |
| Auth rotation + replay | 23 | Refresh rotation + reuse rejection | Logout-then-use case explicit; multi-tenant picker E2E |
| Outbox trigger | 4 | NOTIFY fires on insert | — |
| Outbox E2E + idempotency | 22, 38, 3 | LISTEN + poller + dedup | Idempotency key presence on ALL handlers (4.5) |
| Listener bypasses PgBouncer | 20 | `DATABASE_DIRECT_URL` used | — |
| BullMQ noeviction | 21 | Redis policy | — |
| Money — Number ban | 1 | `packages/money` only | Extend to `modules/finance`, `/inventory`, `/procurement` (4.6) |
| Money — NUMERIC round-trip | 2 | Parser installed + precise | Property test for invoice totaling |
| Stock reservations | 27, 52 | Reserve + consume; auto-reserve from SO | Concurrent contention (4.1, 4.9) |
| Invoice lifecycle | 53 | SO dispatch → invoice draft | Post idempotency, cancel reversal consistency (4.10, 4.13) |
| E-signature | 42 | 6 cases | Non-finance e-sig paths (BMR, scrap) |
| Hash chain — QC cert | 40 | Tamper detection | — |
| Hash chain — audit sweep | 41 | Nightly sweep detects breaks | Approval transitions included in chain (4.7) |
| State machines | 46, 51 | Deal 20×20, ticket 20×20, quotation | WO 15-state, device lifecycle incl. RECALLED, NCR |
| RBAC catalog sync | 6 | Code ↔ DB match | — |
| Feature flags / quotas | 16, 17 | 402 behaviour | Plan downgrade mid-month |
| Bootstrap idempotent | 7 | Re-run safe | — |
| Schema drift | 9 | `tsc --noEmit` passes | — |
| Notifications dispatch | 31 | Outbox → notification row | Channel fallback, SSE reconnect |
| GST computation | **none** | — | IST boundary + idempotent recompute (4.14) |
| Device recall flow | **none** | — | Recall → credit note + stock reversal (J7) |
| PDF worker isolation | **none** | — | Timeout + DLQ (4.17) |
| Invitation concurrent accept | **none** | — | (4.3) |
| Approval concurrent act | **none** | — | (4.2) |
| Stock ledger ↔ summary consistency | **none** | — | Under concurrent + failure (4.1) |
| Ledger append-only enforcement | **none** | — | Attempt UPDATE/DELETE on posted row → must fail |
| `withOrg` enforcement | **none** | — | Lint + runtime guard (3.1) |
| Next.js 16 prerender | **none** | — | `next build` in CI with fail-on-warn (4.4) |
| Access token revocation | **none** | — | `jti` revocation list (4.23) |

---

## 6. Suggested test execution order

**Before any deploy**: Gates 1, 2, 5, 6, 9, 11, 12, 13, 19, 20, 21, 23, 32, 42 (all currently existing security / correctness gates).

**Before 10k users**: close the **"none"** rows in §5 above. Priority order:
1. Concurrent accept-invite (4.3) — easy; already found a related bug.
2. Approval concurrent act (4.2) — high severity.
3. Stock ledger ↔ summary consistency under failure (4.1).
4. `withOrg` lint + runtime guard (3.1, 3.25).
5. Outbox idempotency-key-presence audit (4.5).
6. Invoice post + cancel idempotency (4.10, 4.13).
7. GST timezone (4.14).
8. Device recall flow (3.23).
9. Ledger append-only explicit gate (3.25).
10. Next.js 16 prerender CI gate (4.4).

**Ongoing**: nightly audit hash-chain sweep (Gate 41 + 40). Quarterly: chaos tests for Redis failover, LISTEN recovery, worker restart.

**Never ship without**: `tsc --noEmit` + `pnpm test:gates` green on the branch. Period.

---

## 7. Things this plan does NOT cover (out of scope today)

- Load testing with realistic tenant mix (needs dedicated perf env).
- Penetration testing of vendor-admin (should happen before GA).
- 21 CFR Part 11 system validation protocols (IQ/OQ/PQ) — separate regulatory document.
- Customer portal SSO / OIDC flows (not yet implemented).
- Mobile app (separate project).
- Frozen modules (HR, Projects, Spreadsheets, NCR/CAPA, deprecated `/mfg`, `/manufacturing`, `/accounting`) — deliberately excluded per ARCHITECTURE.md Appendix D.

---

## Appendix A — Gate test index (reference)

Counted 59 existing gates in `tests/gates/`. Groupings:

- **Architecture invariants (boot-time)**: 7, 20, 21.
- **RLS & tenancy**: 5, 8, 11, 12, 13, 19, 32.
- **Auth & sessions**: 6, 23, 42.
- **Outbox & events**: 3, 4, 22, 38.
- **Money & ledger**: 1, 2, 27, 52, 53.
- **State machines & workflows**: 46, 51.
- **Feature flags & quotas**: 16, 17.
- **Compliance (hash chain)**: 40, 41.
- **Notifications**: 31.
- **Vendor admin**: 18, 19.

Refer to individual files in `tests/gates/gate-N-*.test.ts` for exact assertions.

---

*End of TESTING_PLAN.md*
