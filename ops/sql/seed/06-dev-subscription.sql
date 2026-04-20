-- Dev subscription for the Mobilab Dev org (Sprint 1B).
--
-- Attaches the dev tenant to the ENTERPRISE plan so every module is
-- unlocked during local development. The period window is set to one
-- year from seed time — long enough that nothing expires mid-sprint.
--
-- Also backfills organizations.owner_identity_id to `admin@mobilab.local`
-- so the dev tenant has a plausible root-admin identity, matching the
-- shape Sprint 4's provisioning flow will produce.
--
-- Tenant-scoped inserts go through set_config('app.current_org', …) so the
-- RLS policies on subscriptions / organizations don't silently drop them.

DO $$
DECLARE
  v_org_id       uuid := '00000000-0000-0000-0000-00000000a001';
  v_admin_ident  uuid := '00000000-0000-0000-0000-00000000f001';
  v_plan_ent     uuid := '00000000-0000-0000-0000-00000000e004';  -- ENTERPRISE
  v_sub_id       uuid := '00000000-0000-0000-0000-00000000d001';  -- stable fixture id
BEGIN
  PERFORM set_config('app.current_org', v_org_id::text, true);

  -- Backfill owner — the dev org was implicitly owned by admin@mobilab.local.
  UPDATE organizations
     SET owner_identity_id = v_admin_ident,
         status            = 'ACTIVE'   -- idempotent reassert on re-seed
   WHERE id = v_org_id
     AND owner_identity_id IS DISTINCT FROM v_admin_ident;

  -- One ENTERPRISE subscription, one-year window. The partial unique index
  -- subscriptions_org_active_unique guarantees there can only be one live
  -- row per org, so this INSERT is naturally idempotent under ON CONFLICT.
  INSERT INTO subscriptions (
    id,
    org_id,
    plan_id,
    status,
    current_period_start,
    current_period_end,
    cancel_at_period_end
  ) VALUES (
    v_sub_id,
    v_org_id,
    v_plan_ent,
    'ACTIVE',
    now(),
    now() + interval '1 year',
    false
  )
  ON CONFLICT (id) DO UPDATE SET
    plan_id              = EXCLUDED.plan_id,
    status               = EXCLUDED.status,
    current_period_end   = EXCLUDED.current_period_end,
    updated_at           = now();
END $$;
