/**
 * Approval workflow contracts — zod schemas shared by the API + web app.
 *
 * ARCHITECTURE.md §3.3. Matches ops/sql/init/09-approvals.sql.
 *
 * The seven chains (per-org, seeded):
 *   work_order           PM → FIN (>=5L) → MGMT (>=20L)
 *   purchase_order       PM → FIN → MGMT (>=10L)
 *   deal_discount        SALES_MANAGER → FINANCE   (only when pct > 15)
 *   raw_material_issue   PM confirmation           (no threshold)
 *   device_qc_final      QC_INSPECTOR + e-sig      (no threshold)
 *   invoice              FINANCE → MGMT (>=20L)
 *   quotation            SALES_MANAGER → FINANCE (>=20L)   (Track 1)
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";

const uuid = z.string().uuid();

// ─── Enums ───────────────────────────────────────────────────────────────────

export const APPROVAL_ENTITY_TYPES = [
  "work_order",
  "purchase_order",
  "deal_discount",
  "raw_material_issue",
  "device_qc_final",
  "invoice",
  // Track 1 Phase 2 (automate.md) — quotation submit-for-approval flow.
  // Chain seeded in ops/sql/init/20-quotation-approvals.sql.
  "quotation",
] as const;
export const ApprovalEntityTypeSchema = z.enum(APPROVAL_ENTITY_TYPES);
export type ApprovalEntityType = z.infer<typeof ApprovalEntityTypeSchema>;

export const APPROVAL_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export const ApprovalRequestStatusSchema = z.enum(APPROVAL_REQUEST_STATUSES);
export type ApprovalRequestStatus = z.infer<typeof ApprovalRequestStatusSchema>;

export const APPROVAL_STEP_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "SKIPPED",
] as const;
export const ApprovalStepStatusSchema = z.enum(APPROVAL_STEP_STATUSES);
export type ApprovalStepStatus = z.infer<typeof ApprovalStepStatusSchema>;

export const APPROVAL_ACTIONS = [
  "CREATE",
  "APPROVE",
  "REJECT",
  "CANCEL",
  "SKIP",
] as const;
export const ApprovalActionSchema = z.enum(APPROVAL_ACTIONS);
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

// ─── Chain definitions ───────────────────────────────────────────────────────

export const ApprovalChainStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  /** Role id — references roles.id. Not typed tighter here so a tenant can add custom roles later. */
  roleId: z.string().min(1).max(64),
  requiresESignature: z.boolean().default(false),
});
export type ApprovalChainStep = z.infer<typeof ApprovalChainStepSchema>;

export const ApprovalChainDefinitionSchema = z.object({
  id: uuid,
  orgId: uuid,
  entityType: ApprovalEntityTypeSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** Decimal-as-string (money) or numeric (percentage) — service knows which per entityType. */
  minAmount: z.string().nullable(),
  maxAmount: z.string().nullable(),
  steps: z.array(ApprovalChainStepSchema).min(1),
  isActive: z.boolean(),
  version: z.number().int().positive(),
  createdBy: uuid.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type ApprovalChainDefinition = z.infer<
  typeof ApprovalChainDefinitionSchema
>;

export const CreateApprovalChainDefinitionSchema = z.object({
  entityType: ApprovalEntityTypeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  /** Decimal-as-string (INR) or numeric (percentage for deal_discount). */
  minAmount: z.string().regex(/^-?\d+(\.\d+)?$/).optional(),
  maxAmount: z.string().regex(/^-?\d+(\.\d+)?$/).optional(),
  steps: z.array(ApprovalChainStepSchema).min(1).max(10),
  isActive: z.boolean().default(true),
});
export type CreateApprovalChainDefinition = z.infer<
  typeof CreateApprovalChainDefinitionSchema
>;

export const UpdateApprovalChainDefinitionSchema =
  CreateApprovalChainDefinitionSchema.partial().extend({
    expectedVersion: z.number().int().positive().optional(),
  });
export type UpdateApprovalChainDefinition = z.infer<
  typeof UpdateApprovalChainDefinitionSchema
>;

export const ApprovalChainListQuerySchema = PaginationQuerySchema.extend({
  entityType: ApprovalEntityTypeSchema.optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type ApprovalChainListQuery = z.infer<
  typeof ApprovalChainListQuerySchema
>;

// ─── Requests ────────────────────────────────────────────────────────────────

export const ApprovalRequestSchema = z.object({
  id: uuid,
  orgId: uuid,
  chainDefId: uuid,
  entityType: ApprovalEntityTypeSchema,
  entityId: uuid,
  amount: z.string().nullable(),
  currency: z.string(),
  status: ApprovalRequestStatusSchema,
  currentStep: z.number().int().positive().nullable(),
  requestedBy: uuid.nullable(),
  completedAt: z.string().nullable(),
  completedBy: uuid.nullable(),
  cancellationReason: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const CreateApprovalRequestSchema = z.object({
  entityType: ApprovalEntityTypeSchema,
  entityId: uuid,
  /**
   * The numeric that selects the chain band:
   *   - amount in INR for work_order / purchase_order / invoice
   *   - discount percentage (0-100) for deal_discount
   *   - omitted for raw_material_issue / device_qc_final
   */
  amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  currency: z.string().trim().min(3).max(8).default("INR"),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateApprovalRequest = z.infer<typeof CreateApprovalRequestSchema>;

export const ApprovalRequestListQuerySchema = PaginationQuerySchema.extend({
  entityType: ApprovalEntityTypeSchema.optional(),
  entityId: uuid.optional(),
  status: ApprovalRequestStatusSchema.optional(),
  requestedBy: uuid.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ApprovalRequestListQuery = z.infer<
  typeof ApprovalRequestListQuerySchema
>;

// ─── Steps ───────────────────────────────────────────────────────────────────

export const ApprovalStepSchema = z.object({
  id: uuid,
  orgId: uuid,
  requestId: uuid,
  stepNumber: z.number().int().positive(),
  roleId: z.string(),
  requiresESignature: z.boolean(),
  status: ApprovalStepStatusSchema,
  actedBy: uuid.nullable(),
  actedAt: z.string().nullable(),
  comment: z.string().nullable(),
  eSignatureHash: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApprovalStep = z.infer<typeof ApprovalStepSchema>;

/**
 * Hydrated view returned by GET /approvals/:id — request + its steps +
 * its transitions, all in one shot for the approval-timeline UI.
 */
export const ApprovalRequestDetailSchema = z.object({
  request: ApprovalRequestSchema,
  steps: z.array(ApprovalStepSchema),
  transitions: z.array(
    z.object({
      id: uuid,
      orgId: uuid,
      requestId: uuid,
      stepId: uuid.nullable(),
      action: ApprovalActionSchema,
      fromStatus: z.string(),
      toStatus: z.string(),
      actorId: uuid.nullable(),
      actorRole: z.string().nullable(),
      comment: z.string().nullable(),
      eSignatureHash: z.string().nullable(),
      metadata: z.record(z.unknown()).nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type ApprovalRequestDetail = z.infer<
  typeof ApprovalRequestDetailSchema
>;

export const WorkflowTransitionSchema =
  ApprovalRequestDetailSchema.shape.transitions.element;
export type WorkflowTransition = z.infer<typeof WorkflowTransitionSchema>;

// ─── Act payload ─────────────────────────────────────────────────────────────

export const ApprovalActPayloadSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().trim().max(2000).optional(),
  /**
   * The textual statement the user agreed to when signing ("Final QC
   * pass — serial ABC123"). Hashed with user_identity_id + actedAt +
   * server pepper (HMAC-SHA256) and stored on the step — the raw
   * value is not persisted. Required when the step has
   * requires_e_signature = true.
   */
  eSignaturePayload: z.string().trim().min(1).max(4000).optional(),
  /**
   * Phase 4 §4.2 / §9.5 — the user's current password, re-entered at
   * the moment of signing. Server bcrypt.compares against
   * user_identities.password_hash; on mismatch the whole act() call
   * is rejected with 401 before any state change. NEVER logged,
   * NEVER persisted, NEVER returned in any response. The 256-char
   * ceiling just bounds the wire payload — bcrypt truncates beyond
   * 72 chars so anything longer is signal-of-attack regardless.
   *
   * Required when the step has requires_e_signature = true.
   */
  eSignaturePassword: z.string().min(1).max(256).optional(),
});
export type ApprovalActPayload = z.infer<typeof ApprovalActPayloadSchema>;

export const ApprovalCancelPayloadSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type ApprovalCancelPayload = z.infer<typeof ApprovalCancelPayloadSchema>;

// ─── Inbox / pending summary ─────────────────────────────────────────────────

/**
 * "What's in my approval inbox?" — pending step rows whose role_id is a role
 * held by the current user. Joined against the parent request for the
 * entity context the UI needs.
 */
export const ApprovalInboxItemSchema = z.object({
  stepId: uuid,
  stepNumber: z.number().int().positive(),
  roleId: z.string(),
  requiresESignature: z.boolean(),
  request: ApprovalRequestSchema,
});
export type ApprovalInboxItem = z.infer<typeof ApprovalInboxItemSchema>;

export const ApprovalInboxQuerySchema = PaginationQuerySchema.extend({
  entityType: ApprovalEntityTypeSchema.optional(),
});
export type ApprovalInboxQuery = z.infer<typeof ApprovalInboxQuerySchema>;
