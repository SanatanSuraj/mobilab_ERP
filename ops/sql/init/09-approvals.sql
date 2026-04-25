-- Approval workflow tables. ARCHITECTURE.md §3.3 (Phase 3).
--
-- Four tables power the workflow engine:
--
--   approval_chain_definitions — org-scoped chain library. One row per
--     (entity_type, threshold band). Chains are picked at request creation
--     by amount (or whatever numeric drove the decision — discount %, line
--     total etc.) with a single ORDER BY min_amount DESC LIMIT 1.
--
--   approval_requests — one live row per (entity_type, entity_id) approval
--     cycle. Holds the overall status and a pointer to the step awaiting
--     action. A partial-unique index prevents two PENDING requests racing
--     on the same entity.
--
--   approval_steps — materialised per-step state (role, e-signature flag,
--     current status, who acted, when). Snapshotted from the chain def at
--     request creation so later edits to the chain don't mutate live
--     requests.
--
--   workflow_transitions — append-only audit log. Every act(), createRequest(),
--     cancel() writes one row. Gate test relies on this being the source of
--     truth for "who approved what when".
--
-- Conventions match 08-notifications.sql — plural snake_case, org_id NOT NULL
-- on every tenant-scoped row, updated_at bumped by trigger, audit trigger in
-- 11-approvals.sql. RLS policies in rls/10-approvals-rls.sql.

-- ─────────────────────────────────────────────────────────────────────────────
-- approval_chain_definitions — per-org chain library.
--
-- The `steps` jsonb holds an ordered array:
--   [{ "stepNumber": 1, "roleId": "PRODUCTION_MANAGER", "requiresESignature": false },
--    { "stepNumber": 2, "roleId": "FINANCE",            "requiresESignature": false }]
--
-- Kept as jsonb rather than a second table because chain definitions are
-- read-mostly, small, and the shape evolves (requiresESignature is module-1
-- — future fields like "parallelAfter" won't need a migration).
--
-- Chain resolution: given an entity_type + decision value, pick the
-- highest-matching band:
--   WHERE entity_type = X
--     AND is_active = true
--     AND (min_amount IS NULL OR $value >= min_amount)
--     AND (max_amount IS NULL OR $value <  max_amount)
--   ORDER BY min_amount DESC NULLS LAST
--   LIMIT 1.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_chain_definitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  -- Domain key — aligns with the top-level entity being approved.
  -- 'work_order', 'purchase_order', 'deal_discount', 'raw_material_issue',
  -- 'device_qc_final', 'invoice'.
  entity_type       text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
  -- Human-readable label for the admin chain-editor UI.
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description       text,
  -- Threshold band. Matched by ARCHITECTURE.md §3.3 amounts:
  --   work_order   >=500000 adds FINANCE; >=2000000 adds MANAGEMENT
  --   purchase_order default PM+FIN; >=1000000 adds MANAGEMENT
  --   deal_discount >15% (SALES_MANAGER + FINANCE); else no approval
  --   invoice       default FIN; >=2000000 adds MANAGEMENT
  -- NULL min = unbounded low. NULL max = unbounded high.
  -- For amount-less entities (raw_material_issue, device_qc_final) both
  -- are NULL and there is exactly one chain.
  min_amount        numeric(18,2),
  max_amount        numeric(18,2),
  -- Ordered steps, validated at insert via the steps_is_array CHECK below.
  -- Each step has { stepNumber, roleId, requiresESignature }.
  steps             jsonb NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  version           integer NOT NULL DEFAULT 1,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT approval_chain_defs_steps_is_array
    CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) >= 1),
  CONSTRAINT approval_chain_defs_amount_band
    CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount < max_amount)
);
CREATE INDEX IF NOT EXISTS approval_chain_defs_entity_idx
  ON approval_chain_definitions (org_id, entity_type, is_active)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS approval_chain_defs_org_idx
  ON approval_chain_definitions (org_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- approval_requests — one cycle per (entity_type, entity_id).
--
-- `current_step` points into approval_steps.step_number for the row awaiting
-- action. On the terminal states (APPROVED / REJECTED / CANCELLED) it is NULL.
--
-- `amount` is the value that drove chain selection — snapshotted so chain
-- re-banding after a request is created cannot mutate live state.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  chain_def_id     uuid NOT NULL REFERENCES approval_chain_definitions(id) ON DELETE RESTRICT,
  entity_type       text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
  entity_id         uuid NOT NULL,
  -- Snapshot of the decision value at request creation. Nullable because
  -- raw_material_issue / device_qc_final have no numeric threshold.
  amount            numeric(18,2),
  currency          text NOT NULL DEFAULT 'INR',
  status            text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  -- Pointer into approval_steps.step_number for the row awaiting action.
  -- NULL once terminal.
  current_step      integer,
  requested_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at      timestamptz,
  completed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- One OPEN request per entity — prevents duplicate parallel approval flows.
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_entity_pending_unique
  ON approval_requests (org_id, entity_type, entity_id)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS approval_requests_status_idx
  ON approval_requests (org_id, status);
CREATE INDEX IF NOT EXISTS approval_requests_entity_idx
  ON approval_requests (org_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS approval_requests_requested_by_idx
  ON approval_requests (org_id, requested_by, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- approval_steps — materialised per-step state.
--
-- Snapshotted from the chain definition at request creation so later edits to
-- the chain don't mutate live state. One step per (request_id, step_number).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  request_id        uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  step_number       integer NOT NULL CHECK (step_number >= 1),
  role_id           text NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  requires_e_signature boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED','SKIPPED')),
  acted_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  acted_at          timestamptz,
  comment           text,
  -- SHA-256 hex of (e_signature_payload || user_id || acted_at || nonce)
  -- produced by the service layer when requires_e_signature = true.
  e_signature_hash  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, step_number)
);
CREATE INDEX IF NOT EXISTS approval_steps_request_idx
  ON approval_steps (request_id, step_number);
-- Pending-step-by-role lookup — drives "what's in my approval inbox?".
CREATE INDEX IF NOT EXISTS approval_steps_pending_by_role_idx
  ON approval_steps (org_id, role_id, status)
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS approval_steps_acted_by_idx
  ON approval_steps (org_id, acted_by, acted_at DESC)
  WHERE acted_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- workflow_transitions — append-only audit log.
--
-- Every act() / createRequest() / cancel() writes exactly one row. Distinct
-- from the audit.log trigger: this is the business-semantic trail that
-- reconstructs the approval timeline ("who said yes at 14:02?"), not the
-- row-level INSERT/UPDATE history.
--
-- Deliberately no updated_at — rows are immutable by service contract and
-- the RLS policy allows no UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  request_id        uuid NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  step_id           uuid REFERENCES approval_steps(id) ON DELETE SET NULL,
  -- 'CREATE','APPROVE','REJECT','CANCEL','SKIP'
  action            text NOT NULL CHECK (action IN ('CREATE','APPROVE','REJECT','CANCEL','SKIP')),
  from_status       text NOT NULL,
  to_status         text NOT NULL,
  actor_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role        text REFERENCES roles(id) ON DELETE SET NULL,
  comment           text,
  e_signature_hash  text,
  -- Structured per-action context — e.g. { "step_number": 2, "requestor_ip": "..." }.
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_transitions_request_idx
  ON workflow_transitions (request_id, created_at);
CREATE INDEX IF NOT EXISTS workflow_transitions_org_created_idx
  ON workflow_transitions (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_transitions_actor_idx
  ON workflow_transitions (org_id, actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Deferred FK: deals.discount_request_id → approval_requests.id.
--
-- The `deals` table (init/02-crm.sql) carries a discount_request_id column
-- pointing at the open approval_request for a header-level discount > 15%
-- approval. We can't declare the FK inline there because approval_requests
-- does not exist at that point in bootstrap order. ON DELETE SET NULL so a
-- request can be cleaned up without cascading the deal into limbo.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE deals
  DROP CONSTRAINT IF EXISTS deals_discount_request_fk;
ALTER TABLE deals
  ADD CONSTRAINT deals_discount_request_fk
    FOREIGN KEY (discount_request_id) REFERENCES approval_requests(id) ON DELETE SET NULL;
