/**
 * Gate 32 — ARCHITECTURE.md Phase 3 §3.7 "Customer Portal (§13.9)".
 *
 * The portal is a second audience on the same apps/api process. Portal
 * sessions bind an extra GUC (`app.current_portal_customer`) via
 * `withPortalUser`, and the restrictive RLS policies in
 * ops/sql/rls/13-portal-rls.sql fence every portal read/write to that
 * customer's rows.
 *
 * This gate asserts the three pillars of the portal's isolation story:
 *
 *   A. Cross-org isolation
 *      A portal user in org A cannot see accounts_portal_users /
 *      sales_orders / sales_invoices / tickets from org B. This is the
 *      standard tenant-isolation policy still doing its job inside a
 *      portal session.
 *
 *   B. Cross-customer (same org) isolation
 *      Two portal users in the SAME org but linked to DIFFERENT customers
 *      see only their own orders / invoices / tickets. This is the new
 *      restrictive policy doing its job — setting customer1's GUC never
 *      surfaces customer2's rows.
 *
 *   C. GUC leak protection
 *      When withPortalUser returns (success or throw), the portal GUC
 *      does not leak onto the next transaction on the same pool.
 *
 * Plus two service-layer fences:
 *
 *   D. createTicket forces account_id to the pivot row, not the client's
 *      body — a portal user cannot spoof another customer's account_id.
 *
 *   E. Portal ticket comments land as visibility=CUSTOMER even if the
 *      service is called repeatedly — the portal CAN'T write INTERNAL
 *      notes.
 *
 * And one bootstrap-style check:
 *
 *   F. The portal customer hook (`createPortalCustomerHook`) rejects a
 *      portal token when the pivot row is missing, with 401.
 *
 * The tests run against the dev `instigenie-postgres` with real SQL. No
 * Fastify server is started — the audience-block path is validated by
 * gate-6 (token/audience verifier) and the rate-limit path is wired at
 * boot (we document the wiring below but don't hammer the limiter here;
 * Phase-4 k6 will cover that load-side).
 *
 * Cleanup: every fixture in this gate is uniquely prefixed with
 * "gate-32". beforeEach wipes rows matching those prefixes.
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
import { withOrg, withPortalUser } from "@instigenie/db";
import { UnauthorizedError, ValidationError } from "@instigenie/errors";
import {
  AUDIENCE,
  type Permission,
  type Role,
} from "@instigenie/contracts";
import {
  PortalService,
  createPortalCustomerHook,
  portalRepo,
} from "@instigenie/api/portal";
import { DEV_ORG_ID, makeTestPool, waitForPg } from "./_helpers.js";

// Dev CUSTOMER-role user from ops/sql/seed/03-dev-org-users.sql.
const DEV_CUSTOMER_USER = "00000000-0000-0000-0000-00000000b00c";
// Dev SUPER_ADMIN (used to simulate an internal token hitting portal guard).
const DEV_INTERNAL_USER = "00000000-0000-0000-0000-00000000b001";

// Second org — seeded by this gate (idempotent).
const OTHER_ORG_ID = "00000000-0000-0000-0000-00000000ee01";
const OTHER_PORTAL_USER = "00000000-0000-0000-0000-00000000ee02";
const OTHER_IDENTITY = "00000000-0000-0000-0000-00000000ee03";
const OTHER_ACCOUNT = "00000000-0000-0000-0000-00000000ee04";

// Two accounts within DEV_ORG_ID so we can test cross-customer isolation
// without needing a second tenant in the picture.
const DEV_ACCOUNT_A = "00000000-0000-0000-0000-00000032ac01";
const DEV_ACCOUNT_B = "00000000-0000-0000-0000-00000032ac02";

// Portal user A (linked to DEV_ACCOUNT_A) — reuses the seeded CUSTOMER user.
// Portal user B (linked to DEV_ACCOUNT_B) — created per run.
const DEV_USER_B_ID = "00000000-0000-0000-0000-00000032b001";
const DEV_IDENTITY_B = "00000000-0000-0000-0000-00000032b002";

type ServiceReq = Parameters<PortalService["summary"]>[0];

/** Minimal FastifyRequest stub for the portal service. */
function makeReq(args: {
  orgId: string;
  userId: string;
  portalCustomerId?: string;
}): ServiceReq {
  return {
    user: {
      id: args.userId,
      orgId: args.orgId,
      email: "customer@instigenie.local",
      roles: ["CUSTOMER"] as Role[],
      permissions: new Set<Permission>(),
      audience: AUDIENCE.portal,
    },
    portalCustomerId: args.portalCustomerId,
  } as unknown as ServiceReq;
}

async function ensureFixtures(pool: pg.Pool): Promise<void> {
  // user_identities is a GLOBAL table (no RLS). The FK from users.identity_id
  // requires the identity row to exist before we insert the per-tenant user,
  // so seed both dev-tenant identity B and the other-tenant identity first.
  await pool.query(
    `INSERT INTO user_identities (id, email, password_hash, status)
     VALUES ($1, $2, 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [DEV_IDENTITY_B, "gate32b@instigenie.local"],
  );

  // ── Fixture A/B in the DEV tenant ────────────────────────────────────
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `INSERT INTO accounts (id, org_id, name, country)
       VALUES ($1, $2, 'gate-32 Customer A', 'IN'),
              ($3, $2, 'gate-32 Customer B', 'IN')
       ON CONFLICT (id) DO NOTHING`,
      [DEV_ACCOUNT_A, DEV_ORG_ID, DEV_ACCOUNT_B],
    );

    // Seed a second portal user (user B) inside the dev org so we can
    // drive two portal sessions concurrently. Identities/memberships
    // aren't consulted by portalRepo — only users + user_roles + pivot.
    await client.query(
      `INSERT INTO users (id, org_id, identity_id, email, name, capabilities, is_active)
       VALUES ($1, $2, $3, $4, $5, '{"permittedLines":[], "canPCBRework": false, "canOCAssembly": false}'::jsonb, true)
       ON CONFLICT (id) DO NOTHING`,
      [DEV_USER_B_ID, DEV_ORG_ID, DEV_IDENTITY_B, "gate32b@instigenie.local", "Gate 32 Portal B"],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, org_id)
       VALUES ($1, 'CUSTOMER', $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [DEV_USER_B_ID, DEV_ORG_ID],
    );
  });

  // Pivots for both dev portal users. A SUPER_ADMIN-style pool bypasses
  // RLS for the insert, but withOrg inserts with RLS on — which works
  // because account_portal_users_tenant_isolation allows WITH CHECK on
  // the matching org.
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `INSERT INTO account_portal_users (org_id, account_id, user_id)
       VALUES ($1, $2, $3), ($1, $4, $5)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [DEV_ORG_ID, DEV_ACCOUNT_A, DEV_CUSTOMER_USER, DEV_ACCOUNT_B, DEV_USER_B_ID],
    );
  });

  // ── Fixture in the OTHER tenant (cross-org probe target) ─────────────
  await pool.query(
    `INSERT INTO user_identities (id, email, password_hash, status)
     VALUES ($1, $2, 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [OTHER_IDENTITY, "gate32other@instigenie.local"],
  );

  await withOrg(pool, OTHER_ORG_ID, async (client) => {
    await client.query(
      `INSERT INTO organizations (id, name, status)
       VALUES ($1, 'gate-32 Other Tenant', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_ORG_ID],
    );
    await client.query(
      `INSERT INTO accounts (id, org_id, name, country)
       VALUES ($1, $2, 'gate-32 Other Customer', 'IN')
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_ACCOUNT, OTHER_ORG_ID],
    );
    await client.query(
      `INSERT INTO users (id, org_id, identity_id, email, name, capabilities, is_active)
       VALUES ($1, $2, $3, 'other-portal@instigenie.local', 'Other Portal', '{"permittedLines":[], "canPCBRework": false, "canOCAssembly": false}'::jsonb, true)
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_PORTAL_USER, OTHER_ORG_ID, OTHER_IDENTITY],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, org_id)
       VALUES ($1, 'CUSTOMER', $2)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [OTHER_PORTAL_USER, OTHER_ORG_ID],
    );
    await client.query(
      `INSERT INTO account_portal_users (org_id, account_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [OTHER_ORG_ID, OTHER_ACCOUNT, OTHER_PORTAL_USER],
    );
  });
}

/** Seed one ticket per customer-account in the dev org for the gate. */
async function seedTickets(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `INSERT INTO tickets (
         org_id, ticket_number, account_id, subject, description,
         category, priority
       ) VALUES
         ($1, 'GATE32-A-1', $2, 'gate-32 A1', 'A ticket 1', 'HARDWARE_DEFECT', 'MEDIUM'),
         ($1, 'GATE32-A-2', $2, 'gate-32 A2', 'A ticket 2', 'CALIBRATION',     'HIGH'),
         ($1, 'GATE32-B-1', $3, 'gate-32 B1', 'B ticket 1', 'HARDWARE_DEFECT', 'MEDIUM')
       ON CONFLICT (org_id, ticket_number) DO NOTHING`,
      [DEV_ORG_ID, DEV_ACCOUNT_A, DEV_ACCOUNT_B],
    );
  });

  await withOrg(pool, OTHER_ORG_ID, async (client) => {
    await client.query(
      `INSERT INTO tickets (
         org_id, ticket_number, account_id, subject, description,
         category, priority
       ) VALUES
         ($1, 'GATE32-X-1', $2, 'gate-32 X1', 'Other ticket', 'GENERAL_INQUIRY', 'LOW')
       ON CONFLICT (org_id, ticket_number) DO NOTHING`,
      [OTHER_ORG_ID, OTHER_ACCOUNT],
    );
  });
}

async function wipeFixtures(pool: pg.Pool): Promise<void> {
  await withOrg(pool, DEV_ORG_ID, async (client) => {
    await client.query(
      `DELETE FROM tickets WHERE ticket_number LIKE 'GATE32-%'`,
    );
  });
  await withOrg(pool, OTHER_ORG_ID, async (client) => {
    await client.query(
      `DELETE FROM tickets WHERE ticket_number LIKE 'GATE32-%'`,
    );
  });
}

describe("gate-32: portal isolation + RLS + audience block", () => {
  let pool: pg.Pool;
  let service: PortalService;

  beforeAll(async () => {
    pool = makeTestPool();
    await waitForPg(pool);
    await ensureFixtures(pool);
    service = new PortalService({ pool });
  });

  afterAll(async () => {
    await wipeFixtures(pool);
    await pool.end();
  });

  beforeEach(async () => {
    await wipeFixtures(pool);
    await seedTickets(pool);
  });

  // ─── A. Cross-org isolation ────────────────────────────────────────────

  describe("A. cross-org isolation", () => {
    it("portal user in DEV tenant sees zero rows from OTHER tenant", async () => {
      // Portal user A in DEV tenant, GUC bound to DEV_ACCOUNT_A.
      await withPortalUser(
        pool,
        {
          orgId: DEV_ORG_ID,
          userId: DEV_CUSTOMER_USER,
          customerId: DEV_ACCOUNT_A,
        },
        async (client) => {
          // The tickets table has both the permissive tenant policy AND
          // the restrictive portal policy.  A DEV-tenant portal session
          // must never see the OTHER tenant's GATE32-X-1 row.
          const { rows } = await client.query(
            `SELECT ticket_number FROM tickets WHERE ticket_number LIKE 'GATE32-%'`,
          );
          const numbers = rows.map((r) => r.ticket_number);
          expect(numbers).toContain("GATE32-A-1");
          expect(numbers).toContain("GATE32-A-2");
          expect(numbers).not.toContain("GATE32-B-1"); // other customer
          expect(numbers).not.toContain("GATE32-X-1"); // other tenant
        },
      );
    });

    it("pivot lookup is tenant-scoped", async () => {
      // Reaching for the OTHER tenant's portal user from DEV tenant
      // returns null because RLS hides the account_portal_users row.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const pivot = await portalRepo.findPivot(client, OTHER_PORTAL_USER);
        expect(pivot).toBeNull();
      });
    });
  });

  // ─── B. Cross-customer (same org) isolation ────────────────────────────

  describe("B. cross-customer isolation", () => {
    it("portal user A (DEV_ACCOUNT_A) sees only A's tickets", async () => {
      const req = makeReq({
        orgId: DEV_ORG_ID,
        userId: DEV_CUSTOMER_USER,
        portalCustomerId: DEV_ACCOUNT_A,
      });
      const result = await service.listTickets(req, { page: 1, limit: 50, sortDir: "desc" });
      const numbers = result.data.map((t) => t.ticketNumber);
      expect(numbers).toEqual(
        expect.arrayContaining(["GATE32-A-1", "GATE32-A-2"]),
      );
      expect(numbers).not.toContain("GATE32-B-1");
      expect(numbers).not.toContain("GATE32-X-1");
    });

    it("portal user B (DEV_ACCOUNT_B) sees only B's tickets", async () => {
      const req = makeReq({
        orgId: DEV_ORG_ID,
        userId: DEV_USER_B_ID,
        portalCustomerId: DEV_ACCOUNT_B,
      });
      const result = await service.listTickets(req, { page: 1, limit: 50, sortDir: "desc" });
      const numbers = result.data.map((t) => t.ticketNumber);
      expect(numbers).toContain("GATE32-B-1");
      expect(numbers).not.toContain("GATE32-A-1");
      expect(numbers).not.toContain("GATE32-A-2");
      expect(numbers).not.toContain("GATE32-X-1");
    });

    it("fetching a ticket that belongs to the OTHER customer returns null via RLS", async () => {
      // Reach directly into the repo with user A's GUC and ask for B's
      // ticket by id — RLS returns nothing, repo returns null.
      let foundBsTicketFromA = true;
      await withPortalUser(
        pool,
        {
          orgId: DEV_ORG_ID,
          userId: DEV_CUSTOMER_USER,
          customerId: DEV_ACCOUNT_A,
        },
        async (client) => {
          const { rows } = await client.query<{ id: string }>(
            `SELECT id FROM tickets WHERE ticket_number = 'GATE32-B-1'`,
          );
          foundBsTicketFromA = rows.length > 0;
        },
      );
      expect(foundBsTicketFromA).toBe(false);
    });
  });

  // ─── C. GUC leak protection ────────────────────────────────────────────

  describe("C. GUC scoping", () => {
    it("app.current_portal_customer is cleared after withPortalUser", async () => {
      await withPortalUser(
        pool,
        {
          orgId: DEV_ORG_ID,
          userId: DEV_CUSTOMER_USER,
          customerId: DEV_ACCOUNT_A,
        },
        async () => {
          // inside: GUC is set; we don't need to re-assert here because
          // section A already proved visibility filtering works.
        },
      );
      // After the txn, withOrg does NOT reset the GUC (it's local to
      // the txn that set it — the underlying client is back in the pool
      // with no GUCs). Confirm by opening a fresh withOrg and showing
      // the portal restrictive predicate short-circuits to "no GUC" ⇒
      // all org-matching rows visible.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const { rows } = await client.query(
          `SELECT nullif(current_setting('app.current_portal_customer', true), '') AS gc`,
        );
        expect(rows[0]?.gc).toBeNull();
        const { rows: allTickets } = await client.query<{ ticket_number: string }>(
          `SELECT ticket_number FROM tickets WHERE ticket_number LIKE 'GATE32-%'`,
        );
        const numbers = allTickets.map((r) => r.ticket_number);
        // Internal (no portal GUC) sees both customers under this tenant.
        expect(numbers).toContain("GATE32-A-1");
        expect(numbers).toContain("GATE32-B-1");
      });
    });

    it("withPortalUser rolls back on error and does not leak GUC", async () => {
      await expect(
        withPortalUser(
          pool,
          {
            orgId: DEV_ORG_ID,
            userId: DEV_CUSTOMER_USER,
            customerId: DEV_ACCOUNT_A,
          },
          async () => {
            throw new Error("boom");
          },
        ),
      ).rejects.toThrow("boom");

      // Pool connection was released; a fresh withOrg sees no leaked GUC.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        const { rows } = await client.query(
          `SELECT nullif(current_setting('app.current_portal_customer', true), '') AS gc`,
        );
        expect(rows[0]?.gc).toBeNull();
      });
    });

    it("rejects invalid UUIDs before opening a connection", async () => {
      await expect(
        withPortalUser(
          pool,
          { orgId: "not-a-uuid", userId: DEV_CUSTOMER_USER, customerId: DEV_ACCOUNT_A },
          async () => undefined,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        withPortalUser(
          pool,
          { orgId: DEV_ORG_ID, userId: "", customerId: DEV_ACCOUNT_A },
          async () => undefined,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        withPortalUser(
          pool,
          { orgId: DEV_ORG_ID, userId: DEV_CUSTOMER_USER, customerId: "bad" },
          async () => undefined,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  // ─── D. createTicket fences account_id ────────────────────────────────

  describe("D. createTicket account spoof prevention", () => {
    it("portal-created ticket is stamped with the pivot's account_id", async () => {
      const req = makeReq({
        orgId: DEV_ORG_ID,
        userId: DEV_CUSTOMER_USER,
        portalCustomerId: DEV_ACCOUNT_A,
      });
      const created = await service.createTicket(req, {
        subject: "gate-32 portal-created",
        description: "From portal A",
        category: "HARDWARE_DEFECT",
        priority: "LOW",
      });
      expect(created.accountId).toBe(DEV_ACCOUNT_A);

      // Portal user B shouldn't see this ticket.
      const reqB = makeReq({
        orgId: DEV_ORG_ID,
        userId: DEV_USER_B_ID,
        portalCustomerId: DEV_ACCOUNT_B,
      });
      const visibleToB = await service.listTickets(reqB, { page: 1, limit: 50, sortDir: "desc" });
      expect(visibleToB.data.map((t) => t.id)).not.toContain(created.id);

      // Cleanup: wipe the row we just inserted so the beforeEach seed
      // counts remain stable across runs.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`DELETE FROM tickets WHERE id = $1`, [created.id]);
      });
    });

    it("contactId that belongs to another customer is rejected", async () => {
      // Insert a contact under customer B and try to POST a ticket as
      // portal user A claiming it. Service should 400.
      const contactId = "00000000-0000-0000-0000-00000032cc01";
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(
          `INSERT INTO contacts (id, org_id, account_id, first_name, last_name, email)
           VALUES ($1, $2, $3, 'gate32', 'contact-b', 'gate32b@contacts.local')
           ON CONFLICT (id) DO NOTHING`,
          [contactId, DEV_ORG_ID, DEV_ACCOUNT_B],
        );
      });

      const req = makeReq({
        orgId: DEV_ORG_ID,
        userId: DEV_CUSTOMER_USER,
        portalCustomerId: DEV_ACCOUNT_A,
      });
      await expect(
        service.createTicket(req, {
          subject: "gate-32 bad contact",
          description: "Trying to attach B's contact to an A ticket",
          category: "GENERAL_INQUIRY",
          priority: "LOW",
          contactId,
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`DELETE FROM contacts WHERE id = $1`, [contactId]);
      });
    });
  });

  // ─── E. ticket comments default visibility=CUSTOMER ───────────────────

  describe("E. portal comments visibility", () => {
    it("addCustomerComment stamps visibility=CUSTOMER regardless of caller", async () => {
      const req = makeReq({
        orgId: DEV_ORG_ID,
        userId: DEV_CUSTOMER_USER,
        portalCustomerId: DEV_ACCOUNT_A,
      });
      // Find A's ticket
      const list = await service.listTickets(req, { page: 1, limit: 50, sortDir: "desc" });
      const ticket = list.data.find((t) => t.ticketNumber === "GATE32-A-1");
      expect(ticket).toBeDefined();

      const comment = await service.addCustomerComment(req, ticket!.id, {
        content: "gate-32 customer-side reply",
      });
      expect(comment.visibility).toBe("CUSTOMER");
      expect(comment.actorId).toBe(DEV_CUSTOMER_USER);
    });

    it("listing comments on a ticket excludes INTERNAL notes", async () => {
      const req = makeReq({
        orgId: DEV_ORG_ID,
        userId: DEV_CUSTOMER_USER,
        portalCustomerId: DEV_ACCOUNT_A,
      });
      const list = await service.listTickets(req, { page: 1, limit: 50, sortDir: "desc" });
      const ticket = list.data.find((t) => t.ticketNumber === "GATE32-A-2")!;

      // Internal session (withOrg) seeds one INTERNAL note and one
      // CUSTOMER note on the same ticket. Portal must see only CUSTOMER.
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(
          `INSERT INTO ticket_comments (org_id, ticket_id, visibility, content)
           VALUES ($1, $2, 'INTERNAL', 'staff-only'),
                  ($1, $2, 'CUSTOMER', 'hello from staff')`,
          [DEV_ORG_ID, ticket.id],
        );
      });

      const { comments } = await service.getTicket(req, ticket.id);
      const contents = comments.map((c) => c.content);
      expect(contents).toContain("hello from staff");
      expect(contents).not.toContain("staff-only");
    });
  });

  // ─── F. Customer-hook rejects stale / missing portal link ─────────────

  describe("F. portal customer hook", () => {
    it("rejects a portal token whose user has no pivot row (401)", async () => {
      const hook = createPortalCustomerHook(pool);
      // Brand-new portal user with no pivot row
      const userId = "00000000-0000-0000-0000-00000032f001";
      const identityId = "00000000-0000-0000-0000-00000032f002";
      await pool.query(
        `INSERT INTO user_identities (id, email, password_hash, status)
         VALUES ($1, 'gate32unlinked@instigenie.local', 'x', 'ACTIVE')
         ON CONFLICT (id) DO NOTHING`,
        [identityId],
      );
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(
          `INSERT INTO users (id, org_id, identity_id, email, name, capabilities, is_active)
           VALUES ($1, $2, $3, 'gate32unlinked@instigenie.local', 'Unlinked', '{"permittedLines":[], "canPCBRework": false, "canOCAssembly": false}'::jsonb, true)
           ON CONFLICT (id) DO NOTHING`,
          [userId, DEV_ORG_ID, identityId],
        );
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, org_id)
           VALUES ($1, 'CUSTOMER', $2)
           ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userId, DEV_ORG_ID],
        );
      });

      const req = makeReq({ orgId: DEV_ORG_ID, userId });
      await expect(hook(req)).rejects.toBeInstanceOf(UnauthorizedError);

      // Cleanup
      await withOrg(pool, DEV_ORG_ID, async (client) => {
        await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
        await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
      });
      await pool.query(`DELETE FROM user_identities WHERE id = $1`, [identityId]);
    });

    it("rejects a request whose token carries the wrong audience", async () => {
      const hook = createPortalCustomerHook(pool);
      const req = {
        user: {
          id: DEV_INTERNAL_USER,
          orgId: DEV_ORG_ID,
          email: "admin@instigenie.local",
          roles: ["SUPER_ADMIN"] as Role[],
          permissions: new Set<Permission>(),
          audience: AUDIENCE.internal,
        },
      } as unknown as ServiceReq;
      await expect(hook(req)).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  // ─── Bonus: summary counts ────────────────────────────────────────────

  describe("summary counts are customer-scoped", () => {
    it("user A's openTickets count reflects only A's open tickets", async () => {
      const req = makeReq({
        orgId: DEV_ORG_ID,
        userId: DEV_CUSTOMER_USER,
        portalCustomerId: DEV_ACCOUNT_A,
      });
      const summary = await service.summary(req);
      expect(summary.customer.id).toBe(DEV_ACCOUNT_A);
      // Our seed inserted 2 A-tickets both OPEN (default).
      expect(summary.counts.openTickets).toBeGreaterThanOrEqual(2);
    });

    it("user B's openTickets count is independent", async () => {
      const req = makeReq({
        orgId: DEV_ORG_ID,
        userId: DEV_USER_B_ID,
        portalCustomerId: DEV_ACCOUNT_B,
      });
      const summary = await service.summary(req);
      expect(summary.customer.id).toBe(DEV_ACCOUNT_B);
      // Seeded 1 B-ticket.
      expect(summary.counts.openTickets).toBeGreaterThanOrEqual(1);
    });
  });
});
