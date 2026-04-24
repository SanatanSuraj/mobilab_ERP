# HTTP Axis Coverage — Gates 65–70

Gates 1–64 drive the service layer directly with stubbed `FastifyRequest`
objects. That's fast and deterministic, but it skips the preHandler
chain — the layer where tenant isolation, permissions, audience
fencing, quota enforcement, and the Zod body/query parse actually run.
The central error mapper in `apps/api/src/errors/problem.ts` is also
bypassed, so framework-level failures (bad content-type, body too
large, empty JSON) never get exercised by those gates.

Gates 65–70 close that gap for the six highest-value write endpoints.
Each gate drives the real Fastify app in-process via `app.inject()` —
no socket, no port — so every layer of the pipeline runs end-to-end
exactly as it does in production. Boot, pool, plugins, hooks,
preHandlers, handler body, central error mapper: all real.

The shared harness is `_http-harness.ts`. It boots a Fastify app per
test file (`beforeAll`) via `buildApp()`, mints tokens with the same
`JWT_SECRET` that signs production tokens, and provides `.get / .post
/ .patch / .del` wrappers that attach Authorization + JSON headers.

## Coverage matrix

| Gate | Endpoint | Tests | Axes |
|------|----------|------:|------|
| 65 | POST `/auth/login` | 41 | happy · missing · invalid · wrong types · auth · boundary · concurrency · contract · framework errors |
| 66 | POST `/admin/users/invite` | 42 | happy · missing · invalid · wrong types · auth · boundary · concurrency · contract |
| 67 | POST `/approvals/:id/act` | 22 | happy · missing · invalid · auth · business rules · concurrency · contract |
| 68 | POST `/crm/leads` | 39 | happy · missing · invalid · wrong types · auth · boundary · concurrency · contract |
| 69 | POST `/crm/deals/:id/transition` | 32 | happy · missing · invalid · wrong types · auth · business rules · concurrency · contract |
| 70 | POST `/finance/payments` | 48 | happy · missing · invalid · wrong types · auth · boundary · business rules · concurrency · contract |
| | **Total** | **224** | |

Every gate covers 8 axes from TESTING_PLAN §6:
  1. Happy paths (≥1 per role with the permission).
  2. Missing required fields → 400.
  3. Invalid input (bad enums, malformed UUIDs, bad ISO dates) → 400.
  4. Wrong types (strings as numbers, arrays as strings) → 400.
  5. Auth failures (no token → 401; expired → 401; wrong audience →
     401/403; each internal role without the permission → 403).
  6. Boundary values (empty, max-length, max+1, unicode, SQL-shape).
  7. Concurrency (parallel writes → deterministic 1×success +
     N×conflict where applicable).
  8. Response contract (201/200 returns the full typed body; errors
     return `application/problem+json` with a stable `code` and
     correct `status`).

## Bugs found and fixed

Writing gates 65 and 66 surfaced three real production bugs in
preHandler / error-mapping code paths that the service-layer gates
couldn't see:

### 1. Fastify framework errors mapped to 500 instead of 4xx

**Where:** `apps/api/src/errors/problem.ts`

Fastify throws `FST_ERR_CTP_*` errors for empty JSON bodies, invalid
content-types, oversize bodies, etc. These carry a correct
`statusCode` in the 4xx range, but the central error handler's
catch-all "unknown" branch downgraded them to 500. Gate 65
specifically covers:

- `Content-Type: text/plain` → now 415 (was 500).
- Empty body with `Content-Type: application/json` → now 400 (was 500).
- Body > 1 MiB → now 413 (was 500).

**Fix:** Added a dedicated `FST_ERR_*` branch that detects Fastify
framework errors (code starting `FST_ERR_`, statusCode 400–499), maps
them to a stable Problem code (`invalid_body`, `unsupported_media_type`,
`payload_too_large`), and preserves the 4xx status.

### 2. `requirePermission` threw 401 instead of 403

**Where:** `apps/api/src/modules/auth/guard.ts`

`requirePermission` threw `UnauthorizedError` (401) when the token was
valid but lacked the requested permission. This violated HTTP semantics
— 401 means *unauthenticated*, 403 means *authenticated but not
permitted*. The original comment said "we pick 401 here to hide which
permissions exist," but that's information-hiding at the wrong layer
— the client has to know whether to re-auth vs show an access-denied
UI, and frontends like the Next.js portal already branch on 401 to
force re-login. The practical effect was silent re-login loops when
MANAGEMENT tried to invite (MANAGEMENT doesn't have `users:invite`,
so every invite attempt returned 401, which the auth guard treated as
"my token must be bad," kicking the user back to the login screen).

**Fix:** Switched to `ForbiddenError` (403). Verified by grep that no
existing gate relied on the 401 behaviour, and every HTTP axis gate
now asserts 403 for the "authenticated-without-permission" case.

### 3. Concurrent invite race returned 500 instead of 409

**Where:** `apps/api/src/modules/admin-users/service.ts`

The invite flow does a pre-check (`SELECT ... FROM user_invitations
WHERE email = ... AND status = 'PENDING'`) before inserting. Under 5
parallel requests for the same email, the pre-check is racy — 4 of
them get past the check and collide at the INSERT on the
`user_invitations_org_email_active_unique` partial unique index.
Postgres returns error code `23505`, which escaped the service layer
unwrapped and hit the central mapper as "unknown" → 500.

**Fix:** Wrapped the `insertInvitation` call in a try/catch that
detects `{ code: '23505', constraint:
'user_invitations_org_email_active_unique' }` and translates to
`ConflictError` (409). Under concurrent load the endpoint now returns
exactly one 201 and four 409s — what the caller should see.

## What's still open

HTTP axis coverage is **not** comprehensive across every endpoint —
gates 65–70 cover the six highest-value write paths (auth, invite,
approval act, lead create, deal transition, payment create). The
following endpoints have service-layer gates but no HTTP axis gate
yet (prioritised by blast radius if broken):

| Endpoint | Priority | Rationale |
|----------|---------:|-----------|
| POST `/crm/deals` + PATCH | M | Deal state machine entry; partially covered via gate-69 seed. |
| POST `/finance/sales-invoices/:id/post` | H | Posts to ledger; idempotency gap flagged in §4.10. |
| POST `/finance/purchase-invoices/:id/post` | H | Symmetric AP posting. |
| POST `/finance/payments/:id/void` | H | Reversal must be symmetrical; tested only at service layer. |
| POST `/crm/tickets/:id/transition` | M | Ticket 20×20 state machine, service-tested only. |
| POST `/production/work-orders/:id/transition` | M | 15-state WO machine; includes `RECALLED`. |
| POST `/procurement/purchase-orders/:id/approve-finance` | M | Dual-approval path. |
| POST `/qc/inspections/:id/approve` (+ reject) | M | GMP-critical; QC gate exists but not HTTP axis. |
| POST `/inventory/reservations` | H | Stock contention — §4.1 flagged as highest risk. |
| POST `/approvals` (request) | M | Partner to gate-67; service-layer-only. |

The pattern from gates 65–70 is well-established — each new gate is
~400–600 lines, takes one test-harness run to surface 0–3 failures,
and either fixes a real production bug or tightens a test
assumption. Suggested next batch: 71 (invoice post), 72 (payment
void), 73 (stock reservation).

## How to run

```sh
# Single gate
cd tests/gates && pnpm vitest run gate-70-finance-payments-create-http-axes.test.ts

# All HTTP axis gates
cd tests/gates && pnpm vitest run 'gate-6[5-9]-*.test.ts' 'gate-70-*.test.ts'

# Full gate suite (takes ~50s)
cd tests/gates && pnpm vitest run
```

The harness requires the dev Postgres + Redis stack running
(`ops/compose/docker-compose.dev.yml`). See `_env-setup.ts` for the
fallback env values the harness seeds if shell env is empty.
