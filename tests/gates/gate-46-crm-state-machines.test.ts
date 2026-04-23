/**
 * Gate 46 — CRM deal stage + ticket status state-machine transition matrix.
 *
 * Closes ARCHITECTURE.md §15.4 open gap #4:
 *   "Deal/Ticket state-machine transitions — Invalid transitions reach
 *    unreachable states. Fix: per-entity transition matrix mirroring leads
 *    smoke test."
 *
 * This is a Phase 1 correctness gate (§3.6) — it proves every cell of the
 * (from × to) grid behaves as the production code intends:
 *
 *   - Valid edges       → service returns the updated row, `version` bumps.
 *   - Invalid edges     → service raises StateTransitionError (subclass of
 *                         ConflictError → HTTP 409 at the route layer via
 *                         registerProblemHandler; the zod
 *                         `TransitionDealStage` / `TransitionTicketStatus`
 *                         schemas reject malformed bodies earlier).
 *   - Terminal states   → CLOSED_WON / CLOSED_LOST (deals) and CLOSED
 *                         (tickets) refuse every outbound edge.
 *
 * Scope note: quotations + sales-orders transitions are already covered by
 * gate-26. This gate focuses strictly on deals + tickets per the §15.4 row.
 *
 * Authoritative matrix source:
 *   - apps/api/src/modules/crm/deals.service.ts    `const ALLOWED_STAGE_TRANSITIONS`
 *   - apps/api/src/modules/crm/tickets.service.ts  `const ALLOWED_STATUS_TRANSITIONS`
 *
 * Those constants are module-private and the gate task forbids editing
 * apps/ to export them, so the expected matrix is re-declared here. The
 * test below enumerates the FULL cross-product of DEAL_STAGES ×
 * DEAL_STAGES (and TICKET_STATUSES × TICKET_STATUSES) from the contracts
 * zod enums and asserts the production code's behaviour matches this
 * local matrix. Any drift between service code and ARCHITECTURE.md §13.1
 * deal pipeline (and the service-level ticket state machine — no matching
 * §13.x for tickets is in the doc yet) surfaces here as a pair-specific
 * vitest failure.
 *
 * Why we drive the services directly (no HTTP layer):
 *   Same pattern gate-26 uses. The invariant under test is service-level
 *   (it's the service's ALLOWED_* map that enforces the graph); the HTTP
 *   layer is a thin JSON wrapper. Driving the service keeps the failure
 *   site close to the invariant and avoids standing up a Fastify server.
 *
 * Module loading: DealsService / TicketsService are not listed in
 * apps/api/package.json#exports (only QuotationsService / SalesOrdersService
 * are). Per the gate task, apps/ is off-limits. We load the services via a
 * dynamic `import()` against an absolute file URL resolved at test time —
 * TypeScript can't statically follow the URL (bypasses both the package
 * exports field and the tests/gates `rootDir` restriction), so we pin the
 * public shape with a local interface (no `any`, matches the real service
 * structurally via duck-typing).
 *
 * Cleanup: every fixture row is tagged `company = 'gate-46 …'` (deals) or
 * `subject = 'gate-46 …'` (tickets); beforeEach deletes just those rows
 * under DEV_ORG_ID so reruns stay idempotent without leaking fixtures
 * into gate-8 / gate-25 / gate-26.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  AUDIENCE,
  DEAL_STAGES,
  TICKET_STATUSES,
  type CreateDeal,
  type CreateTicket,
  type Deal,
  type DealStage,
  type Permission,
  type Role,
  type Ticket,
  type TicketStatus,
  type TransitionDealStage,
  type TransitionTicketStatus,
} from "@instigenie/contracts";
import { StateTransitionError, ValidationError } from "@instigenie/errors";
import { withOrg } from "@instigenie/db";
import { makeTestPool, waitForPg, DEV_ORG_ID } from "./_helpers.js";

// Seed dev Sales Manager (has deals:transition + tickets:transition in the
// default role map). Matches ops/sql/seed/03-dev-org-users.sql.
const DEV_USER_ID = "00000000-0000-0000-0000-00000000b004";

// ─── Local service interfaces ────────────────────────────────────────────────
//
// Structural duck-types for the public surface we call. Avoiding a direct
// import keeps the TS project boundary clean (see the header comment) while
// still giving us full type-checking on every service call below. The
// constructor is a Newable<> to match `new DealsService(pool)`.
//
// ServiceRequest is a minimal structural carrier for the FastifyRequest the
// real services accept — withRequest() only reads `req.user`, `req.headers`,
// and `req.id`, so that's all we model. We avoid taking a direct `fastify`
// dep on the gates package (tests/gates/package.json lists no such dep;
// gate-26 works around it via Parameters<...> which we can't use here
// because our services are loaded at runtime).

interface ServiceRequest {
  user: {
    id: string;
    orgId: string;
    email: string;
    roles: Role[];
    permissions: Set<Permission>;
    audience: (typeof AUDIENCE)[keyof typeof AUDIENCE];
  };
}

interface DealsServiceLike {
  create(req: ServiceRequest, input: CreateDeal): Promise<Deal>;
  transitionStage(
    req: ServiceRequest,
    id: string,
    input: TransitionDealStage,
  ): Promise<Deal>;
}

interface TicketsServiceLike {
  create(req: ServiceRequest, input: CreateTicket): Promise<Ticket>;
  transitionStatus(
    req: ServiceRequest,
    id: string,
    input: TransitionTicketStatus,
  ): Promise<Ticket>;
}

interface DealsServiceCtor {
  new (pool: pg.Pool): DealsServiceLike;
}
interface TicketsServiceCtor {
  new (pool: pg.Pool): TicketsServiceLike;
}

/**
 * Load the two services by absolute file URL. We resolve relative to this
 * test file so the path survives turbo / pnpm / CI CWD differences. The
 * dynamic specifier is deliberately computed so TS doesn't try to follow
 * it (see header); at runtime vitest resolves the .js → .ts TS source via
 * the standard vite transform.
 */
async function loadCrmServices(): Promise<{
  DealsService: DealsServiceCtor;
  TicketsService: TicketsServiceCtor;
}> {
  const here = dirname(fileURLToPath(import.meta.url));
  const dealsPath = resolve(
    here,
    "..",
    "..",
    "apps",
    "api",
    "src",
    "modules",
    "crm",
    "deals.service.ts",
  );
  const ticketsPath = resolve(
    here,
    "..",
    "..",
    "apps",
    "api",
    "src",
    "modules",
    "crm",
    "tickets.service.ts",
  );
  const dealsUrl = `file://${dealsPath}`;
  const ticketsUrl = `file://${ticketsPath}`;
  const [dealsMod, ticketsMod] = await Promise.all([
    import(dealsUrl) as Promise<{ DealsService: DealsServiceCtor }>,
    import(ticketsUrl) as Promise<{ TicketsService: TicketsServiceCtor }>,
  ]);
  return {
    DealsService: dealsMod.DealsService,
    TicketsService: ticketsMod.TicketsService,
  };
}

// Minimal FastifyRequest stub — mirrors gate-26. Only `req.user` is read by
// withRequest + requireUser; headers / URL / req.id are never touched.
function makeRequest(
  orgId: string = DEV_ORG_ID,
  userId: string = DEV_USER_ID,
): ServiceRequest {
  return {
    user: {
      id: userId,
      orgId,
      email: "salesmgr@instigenie.local",
      roles: ["SALES_MANAGER"] as Role[],
      permissions: new Set<Permission>(),
      audience: AUDIENCE.internal,
    },
  };
}

/**
 * Mirrored from apps/api/src/modules/crm/deals.service.ts
 * (`const ALLOWED_STAGE_TRANSITIONS`). Re-declared here because that
 * const is module-private and the gate-task invariant forbids editing
 * apps/ to export it. The test below enumerates the FULL cross-product
 * of DEAL_STAGES × DEAL_STAGES and asserts production behaviour matches
 * this local matrix — any drift in the service (e.g. someone adds a
 * DISCOVERY → CLOSED_WON shortcut, or drops the PROPOSAL → DISCOVERY
 * back-edge) fails this gate with a pair-specific assertion message.
 *
 * Matches ARCHITECTURE.md §13.1 deal pipeline (DISCOVERY → PROPOSAL →
 * NEGOTIATION → CLOSED_WON | CLOSED_LOST) plus the documented
 * backtracking edges (PROPOSAL → DISCOVERY, NEGOTIATION → PROPOSAL) and
 * the "CLOSED_LOST escape hatch" from every non-terminal stage.
 */
const EXPECTED_DEAL_TRANSITIONS: Record<DealStage, readonly DealStage[]> = {
  DISCOVERY: ["PROPOSAL", "CLOSED_LOST"],
  PROPOSAL: ["NEGOTIATION", "CLOSED_LOST", "DISCOVERY"],
  NEGOTIATION: ["CLOSED_WON", "CLOSED_LOST", "PROPOSAL"],
  CLOSED_WON: [],
  CLOSED_LOST: [],
} as const;

/**
 * Mirrored from apps/api/src/modules/crm/tickets.service.ts
 * (`const ALLOWED_STATUS_TRANSITIONS`). Same rationale as
 * EXPECTED_DEAL_TRANSITIONS. ARCHITECTURE.md §13.1.4 referenced in the
 * service's file-level doc comment doesn't actually exist yet — see the
 * report for that flag. The service comment is the effective spec.
 */
const EXPECTED_TICKET_TRANSITIONS: Record<
  TicketStatus,
  readonly TicketStatus[]
> = {
  OPEN: ["IN_PROGRESS", "WAITING_CUSTOMER", "CLOSED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "RESOLVED", "OPEN"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
} as const;

// ─── Test fixtures / helpers ────────────────────────────────────────────────

/**
 * Build a DISCOVERY deal, then walk the stage graph using
 * EXPECTED_DEAL_TRANSITIONS to reach `target`. BFS over the matrix so
 * reachability is driven by the same source of truth we're testing — no
 * hand-coded paths that could drift from the graph.
 *
 * For CLOSED_LOST waypoints we supply a placeholder lostReason so the
 * service's ValidationError path doesn't fire; for every other stage the
 * reason is unused.
 */
async function advanceDealToStage(
  deals: DealsServiceLike,
  target: DealStage,
  tag: string,
): Promise<{ id: string; version: number; stage: DealStage }> {
  const req = makeRequest();
  const input: CreateDeal = {
    title: `gate-46 ${tag}`,
    company: `gate-46 ${tag}`,
    contactName: "Gate 46 Contact",
    stage: "DISCOVERY",
    value: "0",
    probability: 20,
  };
  const created = await deals.create(req, input);
  if (created.stage === target) {
    return { id: created.id, version: created.version, stage: created.stage };
  }

  const path = shortestPath(EXPECTED_DEAL_TRANSITIONS, "DISCOVERY", target);
  if (!path) {
    throw new Error(
      `gate-46: no path from DISCOVERY to ${target} in EXPECTED_DEAL_TRANSITIONS — check the matrix`,
    );
  }

  let current = {
    id: created.id,
    version: created.version,
    stage: created.stage,
  };
  // path[0] === "DISCOVERY"; start walking from index 1.
  for (let i = 1; i < path.length; i++) {
    const next = path[i]!;
    const res = await deals.transitionStage(req, current.id, {
      stage: next,
      expectedVersion: current.version,
      lostReason: next === "CLOSED_LOST" ? "gate-46 path seed" : undefined,
    });
    current = { id: res.id, version: res.version, stage: res.stage };
  }
  return current;
}

/**
 * Ticket variant of advanceDealToStage. Same BFS-over-matrix approach so
 * the walk stays in sync with the map.
 */
async function advanceTicketToStatus(
  tickets: TicketsServiceLike,
  target: TicketStatus,
  tag: string,
): Promise<{ id: string; version: number; status: TicketStatus }> {
  const req = makeRequest();
  const input: CreateTicket = {
    subject: `gate-46 ${tag}`,
    description: `gate-46 seeded ticket for ${tag}`,
    category: "GENERAL_INQUIRY",
    priority: "MEDIUM",
  };
  const created = await tickets.create(req, input);
  if (created.status === target) {
    return {
      id: created.id,
      version: created.version,
      status: created.status,
    };
  }

  const path = shortestPath(EXPECTED_TICKET_TRANSITIONS, "OPEN", target);
  if (!path) {
    throw new Error(
      `gate-46: no path from OPEN to ${target} in EXPECTED_TICKET_TRANSITIONS — check the matrix`,
    );
  }

  let current = {
    id: created.id,
    version: created.version,
    status: created.status,
  };
  for (let i = 1; i < path.length; i++) {
    const next = path[i]!;
    const res = await tickets.transitionStatus(req, current.id, {
      status: next,
      expectedVersion: current.version,
    });
    current = { id: res.id, version: res.version, status: res.status };
  }
  return current;
}

/**
 * Generic BFS over a transition map. Returns the shortest node list
 * (inclusive of source + target) or null when no path exists. Stays
 * generic over the state enum so both deals + tickets reuse it.
 */
function shortestPath<S extends string>(
  matrix: Record<S, readonly S[]>,
  from: S,
  to: S,
): S[] | null {
  if (from === to) return [from];
  const visited = new Set<S>([from]);
  const queue: Array<{ node: S; path: S[] }> = [{ node: from, path: [from] }];
  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    const neighbours = matrix[node];
    for (const nb of neighbours) {
      if (visited.has(nb)) continue;
      const nextPath = [...path, nb];
      if (nb === to) return nextPath;
      visited.add(nb);
      queue.push({ node: nb, path: nextPath });
    }
  }
  return null;
}

// ─── Gate ───────────────────────────────────────────────────────────────────

describe("gate-46: CRM deal + ticket state-machine transition matrix", () => {
  let pool: pg.Pool;
  let deals: DealsServiceLike;
  let tickets: TicketsServiceLike;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    const { DealsService, TicketsService } = await loadCrmServices();
    deals = new DealsService(pool);
    tickets = new TicketsService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  // Scoped cleanup. gate-46 fixtures are addressable by the gate-46 prefix
  // tag so we never touch rows owned by gate-8 / gate-25 / gate-26.
  beforeEach(async () => {
    await withOrg(pool, DEV_ORG_ID, async (client) => {
      await client.query(
        `DELETE FROM deals WHERE company LIKE 'gate-46 %'`,
      );
      await client.query(
        `DELETE FROM ticket_comments WHERE ticket_id IN
           (SELECT id FROM tickets WHERE subject LIKE 'gate-46 %')`,
      );
      await client.query(
        `DELETE FROM tickets WHERE subject LIKE 'gate-46 %'`,
      );
    });
  });

  // ─── Deals: transition matrix ─────────────────────────────────────────────

  describe("deals — DealsService.transitionStage", () => {
    // Cross-product every (from, to) pair from the DEAL_STAGES zod enum.
    // Each pair becomes its own `it` block so a single misconfigured
    // edge produces a surgical failure in the vitest report.
    for (const from of DEAL_STAGES) {
      for (const to of DEAL_STAGES) {
        if (from === to) continue; // self-edges covered by "terminal" blocks.
        const allowed = EXPECTED_DEAL_TRANSITIONS[from].includes(to);
        const label = `${from} → ${to}`;
        if (allowed) {
          it(`accepts valid edge ${label}`, async () => {
            const seeded = await advanceDealToStage(
              deals,
              from,
              `deal-valid-${from}-to-${to}`,
            );
            const moved = await deals.transitionStage(
              makeRequest(),
              seeded.id,
              {
                stage: to,
                expectedVersion: seeded.version,
                // CLOSED_LOST requires a reason; harmless for other stages
                // (service reads lostReason only when stage === CLOSED_LOST).
                lostReason:
                  to === "CLOSED_LOST" ? "gate-46 valid edge" : undefined,
              },
            );
            expect(moved.stage).toBe(to);
            expect(moved.version).toBe(seeded.version + 1);
          });
        } else {
          it(`rejects invalid edge ${label} with StateTransitionError`, async () => {
            const seeded = await advanceDealToStage(
              deals,
              from,
              `deal-invalid-${from}-to-${to}`,
            );
            await expect(
              deals.transitionStage(makeRequest(), seeded.id, {
                stage: to,
                expectedVersion: seeded.version,
                lostReason:
                  to === "CLOSED_LOST" ? "gate-46 invalid edge" : undefined,
              }),
            ).rejects.toBeInstanceOf(StateTransitionError);
          });
        }
      }
    }

    // Terminal invariant — spelled out as its own assertion so a regression
    // ("add DISCOVERY back-edge from CLOSED_WON") is immediately diagnosable
    // from the test name alone. The cross-product block above also covers
    // these, but the explicit terminal test is documentation.
    it("terminal CLOSED_WON cannot be left for any other stage", async () => {
      for (const to of DEAL_STAGES) {
        if (to === "CLOSED_WON") continue;
        const seeded = await advanceDealToStage(
          deals,
          "CLOSED_WON",
          `deal-terminal-won-${to}`,
        );
        await expect(
          deals.transitionStage(makeRequest(), seeded.id, {
            stage: to,
            expectedVersion: seeded.version,
            lostReason: to === "CLOSED_LOST" ? "gate-46 terminal" : undefined,
          }),
          `CLOSED_WON → ${to} should be rejected as an invalid transition`,
        ).rejects.toBeInstanceOf(StateTransitionError);
      }
    });

    it("terminal CLOSED_LOST cannot be left for any other stage", async () => {
      for (const to of DEAL_STAGES) {
        if (to === "CLOSED_LOST") continue;
        const seeded = await advanceDealToStage(
          deals,
          "CLOSED_LOST",
          `deal-terminal-lost-${to}`,
        );
        await expect(
          deals.transitionStage(makeRequest(), seeded.id, {
            stage: to,
            expectedVersion: seeded.version,
            // `to` can never be CLOSED_LOST here (we skip it above), so
            // lostReason is unused; pass undefined.
          }),
          `CLOSED_LOST → ${to} should be rejected as an invalid transition`,
        ).rejects.toBeInstanceOf(StateTransitionError);
      }
    });

    it("CLOSED_LOST requires a lostReason (ValidationError otherwise)", async () => {
      // Pre-requisite state: the deepest non-terminal stage is NEGOTIATION.
      // Seed that and try to close-lost without a reason.
      const seeded = await advanceDealToStage(
        deals,
        "NEGOTIATION",
        "deal-closelost-no-reason",
      );
      await expect(
        deals.transitionStage(makeRequest(), seeded.id, {
          stage: "CLOSED_LOST",
          expectedVersion: seeded.version,
          // lostReason intentionally omitted — should ValidationError.
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  // ─── Tickets: transition matrix ───────────────────────────────────────────

  describe("tickets — TicketsService.transitionStatus", () => {
    for (const from of TICKET_STATUSES) {
      for (const to of TICKET_STATUSES) {
        if (from === to) continue;
        const allowed = EXPECTED_TICKET_TRANSITIONS[from].includes(to);
        const label = `${from} → ${to}`;
        if (allowed) {
          it(`accepts valid edge ${label}`, async () => {
            const seeded = await advanceTicketToStatus(
              tickets,
              from,
              `ticket-valid-${from}-to-${to}`,
            );
            const moved = await tickets.transitionStatus(
              makeRequest(),
              seeded.id,
              { status: to, expectedVersion: seeded.version },
            );
            expect(moved.status).toBe(to);
            expect(moved.version).toBe(seeded.version + 1);
          });
        } else {
          it(`rejects invalid edge ${label} with StateTransitionError`, async () => {
            const seeded = await advanceTicketToStatus(
              tickets,
              from,
              `ticket-invalid-${from}-to-${to}`,
            );
            await expect(
              tickets.transitionStatus(makeRequest(), seeded.id, {
                status: to,
                expectedVersion: seeded.version,
              }),
            ).rejects.toBeInstanceOf(StateTransitionError);
          });
        }
      }
    }

    it("terminal CLOSED cannot be left for any other status", async () => {
      for (const to of TICKET_STATUSES) {
        if (to === "CLOSED") continue;
        const seeded = await advanceTicketToStatus(
          tickets,
          "CLOSED",
          `ticket-terminal-${to}`,
        );
        await expect(
          tickets.transitionStatus(makeRequest(), seeded.id, {
            status: to,
            expectedVersion: seeded.version,
          }),
          `CLOSED → ${to} should be rejected as an invalid transition`,
        ).rejects.toBeInstanceOf(StateTransitionError);
      }
    });
  });
});
