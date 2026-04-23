-- Seed the 6 default approval chains for the Instigenie Dev org.
-- ARCHITECTURE.md §3.3. The production onboarding flow should seed
-- equivalent defaults when a new tenant is created; for now this dev-only
-- seed gives the gate test and the UI something real to talk to.
--
-- Chains (all threshold amounts in INR):
--
--   work_order
--     default (<5L)    : Production Manager
--     >=5L  (<20L)     : Production Manager → Finance
--     >=20L            : Production Manager → Finance → Management
--
--   purchase_order
--     default (<10L)   : Production Manager → Finance
--     >=10L            : Production Manager → Finance → Management
--
--   deal_discount
--     >15% only        : Sales Manager → Finance
--     (deals with ≤15% discount skip approval — service refuses to create
--      a request unless amount > 15.)
--
--   raw_material_issue : Production Manager confirmation (no threshold)
--
--   device_qc_final    : QC Inspector (requires e-signature)
--
--   invoice
--     default (<20L)   : Finance
--     >=20L            : Finance → Management

DO $$
DECLARE
  v_org_id uuid := '00000000-0000-0000-0000-00000000a001';
BEGIN
  -- Scope everything to the dev org so RLS is happy.
  PERFORM set_config('app.current_org', v_org_id::text, true);

  INSERT INTO approval_chain_definitions
    (id, org_id, entity_type, name, description, min_amount, max_amount, steps)
  VALUES
    -- ── work_order ────────────────────────────────────────────────────────
    ('00000000-0000-0000-0000-0000000ac001', v_org_id, 'work_order',
     'Work Order — standard (<5L)', 'Production Manager sign-off only.',
     NULL, 500000,
     '[{"stepNumber":1,"roleId":"PRODUCTION_MANAGER","requiresESignature":false}]'::jsonb),
    ('00000000-0000-0000-0000-0000000ac002', v_org_id, 'work_order',
     'Work Order — finance tier (5L-20L)', 'Adds Finance after Production Manager.',
     500000, 2000000,
     '[{"stepNumber":1,"roleId":"PRODUCTION_MANAGER","requiresESignature":false},
       {"stepNumber":2,"roleId":"FINANCE","requiresESignature":false}]'::jsonb),
    ('00000000-0000-0000-0000-0000000ac003', v_org_id, 'work_order',
     'Work Order — senior tier (>=20L)', 'Adds Management as the final gate.',
     2000000, NULL,
     '[{"stepNumber":1,"roleId":"PRODUCTION_MANAGER","requiresESignature":false},
       {"stepNumber":2,"roleId":"FINANCE","requiresESignature":false},
       {"stepNumber":3,"roleId":"MANAGEMENT","requiresESignature":false}]'::jsonb),

    -- ── purchase_order ────────────────────────────────────────────────────
    ('00000000-0000-0000-0000-0000000ac101', v_org_id, 'purchase_order',
     'Purchase Order — standard (<10L)', 'Procurement Lead (Production Manager) + Finance.',
     NULL, 1000000,
     '[{"stepNumber":1,"roleId":"PRODUCTION_MANAGER","requiresESignature":false},
       {"stepNumber":2,"roleId":"FINANCE","requiresESignature":false}]'::jsonb),
    ('00000000-0000-0000-0000-0000000ac102', v_org_id, 'purchase_order',
     'Purchase Order — senior tier (>=10L)', 'Adds Management.',
     1000000, NULL,
     '[{"stepNumber":1,"roleId":"PRODUCTION_MANAGER","requiresESignature":false},
       {"stepNumber":2,"roleId":"FINANCE","requiresESignature":false},
       {"stepNumber":3,"roleId":"MANAGEMENT","requiresESignature":false}]'::jsonb),

    -- ── deal_discount (>15% only) ─────────────────────────────────────────
    -- min_amount is the percentage value. Service refuses to create a
    -- request below this threshold — ≤15% discounts just use the normal
    -- deal update path.
    ('00000000-0000-0000-0000-0000000ac201', v_org_id, 'deal_discount',
     'Deal Discount >15%', 'Sales Manager + Finance for deep-discount deals.',
     15, NULL,
     '[{"stepNumber":1,"roleId":"SALES_MANAGER","requiresESignature":false},
       {"stepNumber":2,"roleId":"FINANCE","requiresESignature":false}]'::jsonb),

    -- ── raw_material_issue (no threshold) ─────────────────────────────────
    ('00000000-0000-0000-0000-0000000ac301', v_org_id, 'raw_material_issue',
     'Raw Material Issue — PM confirmation', 'Production Manager signs off on material issue to the shop floor.',
     NULL, NULL,
     '[{"stepNumber":1,"roleId":"PRODUCTION_MANAGER","requiresESignature":false}]'::jsonb),

    -- ── device_qc_final (e-signature required) ────────────────────────────
    ('00000000-0000-0000-0000-0000000ac401', v_org_id, 'device_qc_final',
     'Device Release / QC Final', 'QC Inspector final disposition with e-signature.',
     NULL, NULL,
     '[{"stepNumber":1,"roleId":"QC_INSPECTOR","requiresESignature":true}]'::jsonb),

    -- ── invoice ───────────────────────────────────────────────────────────
    ('00000000-0000-0000-0000-0000000ac501', v_org_id, 'invoice',
     'Invoice Issue — standard (<20L)', 'Finance Manager sign-off.',
     NULL, 2000000,
     '[{"stepNumber":1,"roleId":"FINANCE","requiresESignature":false}]'::jsonb),
    ('00000000-0000-0000-0000-0000000ac502', v_org_id, 'invoice',
     'Invoice Issue — senior tier (>=20L)', 'Adds Management.',
     2000000, NULL,
     '[{"stepNumber":1,"roleId":"FINANCE","requiresESignature":false},
       {"stepNumber":2,"roleId":"MANAGEMENT","requiresESignature":false}]'::jsonb)
  ON CONFLICT (id) DO UPDATE
    SET name        = EXCLUDED.name,
        description = EXCLUDED.description,
        min_amount  = EXCLUDED.min_amount,
        max_amount  = EXCLUDED.max_amount,
        steps       = EXCLUDED.steps,
        is_active   = true,
        updated_at  = now();
END $$;
