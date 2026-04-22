-- Customer Portal RLS. ARCHITECTURE.md §3.7 (Phase 3) + §9.2.
--
-- The portal reuses the existing tenant-isolation policies (keyed on
-- app.current_org) but layers an ADDITIONAL restrictive predicate on the
-- few tables a portal session may touch:
--
--   sales_orders           — read-only, filtered by account_id
--   sales_order_line_items — inherited via sales_orders FK
--   sales_invoices         — read-only, filtered by customer_id
--   sales_invoice_lines    — inherited via sales_invoices FK
--   tickets                — read + write (portal users open tickets),
--                            filtered by account_id
--   ticket_comments        — inherited via tickets FK (visibility column
--                            further gates INTERNAL-only notes away from
--                            portal reads at the service layer)
--   account_portal_users   — a portal user can only see their OWN pivot row
--
-- The restrictive predicate uses a GUC `app.current_portal_customer`:
--
--   Internal sessions  → GUC is unset → nullif(…, '') IS NULL → predicate
--                        returns TRUE → the existing permissive tenant
--                        policy is the only gate (unchanged behaviour).
--
--   Portal sessions    → GUC is set → predicate requires the row's
--                        account_id / customer_id to match it exactly.
--                        Any cross-customer read/write is blocked by
--                        Postgres before the service ever sees it.
--
-- Why RESTRICTIVE and not a rewrite of the tenant policy? Two reasons:
--   1. We don't want to touch the existing policies that passed Gate 5 —
--      they're audited, and adding to them one-off per module is the
--      convention used by other Phase-2 surfaces.
--   2. RESTRICTIVE policies are AND'd into the USING/WITH CHECK expression,
--      which is exactly the semantics we want: "tenant isolation AND
--      (internal OR my customer)".
--
-- Drop/recreate is safe on re-apply because the policy name is unique.

-- account_portal_users — always restricted by org (existing convention),
-- plus we add a self-lookup predicate so a portal session can only see its
-- own pivot row. The internal side reads this table during login to
-- populate app.current_portal_customer, which runs WITHOUT the GUC set
-- (login happens before the portal session exists). So we keep the plain
-- org-only policy here and enforce the per-user filter in the service.

ALTER TABLE account_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_portal_users FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_portal_users_tenant_isolation ON account_portal_users;
CREATE POLICY account_portal_users_tenant_isolation ON account_portal_users
  USING      (org_id::text = current_setting('app.current_org', true))
  WITH CHECK (org_id::text = current_setting('app.current_org', true));

-- ─────────────────────────────────────────────────────────────────────────
-- Restrictive "portal customer" policies — applied to the tables a portal
-- session may read or write. Internal sessions pass transparently because
-- nullif(...,'') IS NULL short-circuits the predicate to TRUE.
-- ─────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS sales_orders_portal_customer ON sales_orders;
CREATE POLICY sales_orders_portal_customer ON sales_orders
  AS RESTRICTIVE
  USING (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR account_id::text = current_setting('app.current_portal_customer', true)
  )
  WITH CHECK (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR account_id::text = current_setting('app.current_portal_customer', true)
  );

-- sales_order_line_items has no direct account_id column; we gate by the
-- parent row. "EXISTS (parent row I can see)" is cheap — it exercises the
-- already-filtered permissive policy on sales_orders.
DROP POLICY IF EXISTS sales_order_line_items_portal_customer ON sales_order_line_items;
CREATE POLICY sales_order_line_items_portal_customer ON sales_order_line_items
  AS RESTRICTIVE
  USING (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM sales_orders so
       WHERE so.id = sales_order_line_items.order_id
         AND so.account_id::text = current_setting('app.current_portal_customer', true)
    )
  )
  WITH CHECK (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM sales_orders so
       WHERE so.id = sales_order_line_items.order_id
         AND so.account_id::text = current_setting('app.current_portal_customer', true)
    )
  );

DROP POLICY IF EXISTS sales_invoices_portal_customer ON sales_invoices;
CREATE POLICY sales_invoices_portal_customer ON sales_invoices
  AS RESTRICTIVE
  USING (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR customer_id::text = current_setting('app.current_portal_customer', true)
  )
  WITH CHECK (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR customer_id::text = current_setting('app.current_portal_customer', true)
  );

DROP POLICY IF EXISTS sales_invoice_lines_portal_customer ON sales_invoice_lines;
CREATE POLICY sales_invoice_lines_portal_customer ON sales_invoice_lines
  AS RESTRICTIVE
  USING (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM sales_invoices si
       WHERE si.id = sales_invoice_lines.invoice_id
         AND si.customer_id::text = current_setting('app.current_portal_customer', true)
    )
  )
  WITH CHECK (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM sales_invoices si
       WHERE si.id = sales_invoice_lines.invoice_id
         AND si.customer_id::text = current_setting('app.current_portal_customer', true)
    )
  );

DROP POLICY IF EXISTS tickets_portal_customer ON tickets;
CREATE POLICY tickets_portal_customer ON tickets
  AS RESTRICTIVE
  USING (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR account_id::text = current_setting('app.current_portal_customer', true)
  )
  WITH CHECK (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR account_id::text = current_setting('app.current_portal_customer', true)
  );

-- ticket_comments has no account_id; gate by ticket. The service layer
-- additionally filters visibility = 'CUSTOMER' for portal reads, but the
-- RLS gate here is the hard boundary that prevents cross-customer leaks
-- even if that service filter is ever bypassed.
DROP POLICY IF EXISTS ticket_comments_portal_customer ON ticket_comments;
CREATE POLICY ticket_comments_portal_customer ON ticket_comments
  AS RESTRICTIVE
  USING (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM tickets t
       WHERE t.id = ticket_comments.ticket_id
         AND t.account_id::text = current_setting('app.current_portal_customer', true)
    )
  )
  WITH CHECK (
    nullif(current_setting('app.current_portal_customer', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM tickets t
       WHERE t.id = ticket_comments.ticket_id
         AND t.account_id::text = current_setting('app.current_portal_customer', true)
    )
  );
