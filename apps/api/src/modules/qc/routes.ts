/**
 * QC routes. Mounted at /qc/*.
 *
 * Scope (Phase 2):
 *   - inspection_templates (+ inspection_parameters)
 *   - qc_inspections (+ qc_findings) with start/complete lifecycle
 *   - qc_certs (issue + recall, append-only)
 *
 * Permission strategy:
 *   - GET  /qc/templates/**             → qc:inspect   (reading templates)
 *   - POST/PATCH/DELETE /qc/templates/**→ qc:approve   (authoring templates)
 *   - GET  /qc/inspections/**           → qc:inspect
 *   - POST/PATCH/DELETE /qc/inspections/**→ qc:inspect (inspectors can edit)
 *   - POST /qc/inspections/:id/start    → qc:inspect
 *   - POST /qc/inspections/:id/complete (verdict=PASS) → qc:approve
 *   - POST /qc/inspections/:id/complete (verdict=FAIL) → qc:reject
 *   - GET  /qc/certs/**                 → qc:inspect
 *   - POST /qc/certs                    → qc:approve   (cert issuance = approval)
 *   - DELETE /qc/certs/:id              → qc:approve   (recall is an approval action)
 *
 * Gated by `module.manufacturing` feature flag (all QC flows require the
 * manufacturing plan bit).
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CompleteQcInspectionSchema,
  CreateInspectionParameterSchema,
  CreateInspectionTemplateSchema,
  CreateQcFindingSchema,
  CreateQcInspectionSchema,
  InspectionTemplateListQuerySchema,
  IssueQcCertSchema,
  QcCapaActionListQuerySchema,
  QcCertListQuerySchema,
  QcEquipmentListQuerySchema,
  QcInspectionListQuerySchema,
  QcReportsQuerySchema,
  StartQcInspectionSchema,
  UpdateInspectionParameterSchema,
  UpdateInspectionTemplateSchema,
  UpdateQcFindingSchema,
  UpdateQcInspectionSchema,
} from "@instigenie/contracts";
import { createAuthGuard, requirePermission } from "../auth/guard.js";
import type { AuthGuardOptions } from "../auth/guard.js";
import type { RequireFeature } from "../quotas/guard.js";
import type { InspectionTemplatesService } from "./templates.service.js";
import type { QcInspectionsService } from "./inspections.service.js";
import type { QcCertsService } from "./certs.service.js";
import type { QcEquipmentService, QcCapaService } from "./aux.service.js";
import type { QcReportsService } from "./reports.service.js";

export interface RegisterQcRoutesOptions {
  templates: InspectionTemplatesService;
  inspections: QcInspectionsService;
  certs: QcCertsService;
  equipment: QcEquipmentService;
  capa: QcCapaService;
  reports: QcReportsService;
  guardInternal: AuthGuardOptions;
  requireFeature: RequireFeature;
}

const IdParamSchema = z.object({ id: z.string().uuid() });
const TemplateParamSchema = z.object({
  templateId: z.string().uuid(),
});
const TemplateParamWithParameterSchema = z.object({
  templateId: z.string().uuid(),
  parameterId: z.string().uuid(),
});
const InspectionParamSchema = z.object({
  inspectionId: z.string().uuid(),
});
const InspectionParamWithFindingSchema = z.object({
  inspectionId: z.string().uuid(),
  findingId: z.string().uuid(),
});

export async function registerQcRoutes(
  app: FastifyInstance,
  opts: RegisterQcRoutesOptions,
): Promise<void> {
  const authGuard = createAuthGuard(opts.guardInternal);
  const requireModule = opts.requireFeature("module.manufacturing");

  const qcInspect = [
    authGuard,
    requireModule,
    requirePermission("qc:inspect"),
  ];
  const qcApprove = [
    authGuard,
    requireModule,
    requirePermission("qc:approve"),
  ];

  // ─── Inspection Templates ─────────────────────────────────────────────────

  app.get(
    "/qc/templates",
    { preHandler: qcInspect },
    async (req, reply) => {
      const query = InspectionTemplateListQuerySchema.parse(req.query);
      return reply.send(await opts.templates.list(req, query));
    },
  );

  app.get(
    "/qc/templates/:id",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.templates.getById(req, id));
    },
  );

  app.post(
    "/qc/templates",
    { preHandler: qcApprove },
    async (req, reply) => {
      const body = CreateInspectionTemplateSchema.parse(req.body);
      return reply.code(201).send(await opts.templates.create(req, body));
    },
  );

  app.patch(
    "/qc/templates/:id",
    { preHandler: qcApprove },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateInspectionTemplateSchema.parse(req.body);
      return reply.send(await opts.templates.update(req, id, body));
    },
  );

  app.delete(
    "/qc/templates/:id",
    { preHandler: qcApprove },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.templates.remove(req, id);
      return reply.code(204).send();
    },
  );

  // ─── Inspection Parameters (sibling of template) ──────────────────────────

  app.get(
    "/qc/templates/:templateId/parameters",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { templateId } = TemplateParamSchema.parse(req.params);
      return reply.send({
        data: await opts.templates.listParameters(req, templateId),
      });
    },
  );

  app.post(
    "/qc/templates/:templateId/parameters",
    { preHandler: qcApprove },
    async (req, reply) => {
      const { templateId } = TemplateParamSchema.parse(req.params);
      const body = CreateInspectionParameterSchema.parse(req.body);
      return reply
        .code(201)
        .send(await opts.templates.addParameter(req, templateId, body));
    },
  );

  app.patch(
    "/qc/templates/:templateId/parameters/:parameterId",
    { preHandler: qcApprove },
    async (req, reply) => {
      const { templateId, parameterId } =
        TemplateParamWithParameterSchema.parse(req.params);
      const body = UpdateInspectionParameterSchema.parse(req.body);
      return reply.send(
        await opts.templates.updateParameter(
          req,
          templateId,
          parameterId,
          body,
        ),
      );
    },
  );

  app.delete(
    "/qc/templates/:templateId/parameters/:parameterId",
    { preHandler: qcApprove },
    async (req, reply) => {
      const { templateId, parameterId } =
        TemplateParamWithParameterSchema.parse(req.params);
      await opts.templates.deleteParameter(req, templateId, parameterId);
      return reply.code(204).send();
    },
  );

  // ─── QC Inspections ───────────────────────────────────────────────────────

  app.get(
    "/qc/inspections",
    { preHandler: qcInspect },
    async (req, reply) => {
      const query = QcInspectionListQuerySchema.parse(req.query);
      return reply.send(await opts.inspections.list(req, query));
    },
  );

  app.get(
    "/qc/inspections/:id",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.inspections.getById(req, id));
    },
  );

  app.post(
    "/qc/inspections",
    { preHandler: qcInspect },
    async (req, reply) => {
      const body = CreateQcInspectionSchema.parse(req.body);
      return reply.code(201).send(await opts.inspections.create(req, body));
    },
  );

  app.patch(
    "/qc/inspections/:id",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = UpdateQcInspectionSchema.parse(req.body);
      return reply.send(await opts.inspections.update(req, id, body));
    },
  );

  app.delete(
    "/qc/inspections/:id",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.inspections.remove(req, id);
      return reply.code(204).send();
    },
  );

  // ─── Inspection Lifecycle ─────────────────────────────────────────────────

  app.post(
    "/qc/inspections/:id/start",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = StartQcInspectionSchema.parse(req.body);
      return reply.send(await opts.inspections.start(req, id, body));
    },
  );

  /**
   * Complete is split at preHandler time: PASS verdict requires qc:approve,
   * FAIL verdict requires qc:reject. We pre-parse the body to switch guard
   * — the body is then re-parsed inside the handler which is idempotent.
   */
  app.post(
    "/qc/inspections/:id/complete",
    {
      preHandler: [
        authGuard,
        requireModule,
        async (req) => {
          // Parse body once here to route to the right permission.
          const parsed = CompleteQcInspectionSchema.safeParse(req.body);
          if (!parsed.success) {
            // Let the main handler produce the canonical 400 on re-parse.
            return;
          }
          const perm =
            parsed.data.verdict === "PASS" ? "qc:approve" : "qc:reject";
          const guard = requirePermission(perm);
          await guard(req);
        },
      ],
    },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      const body = CompleteQcInspectionSchema.parse(req.body);
      return reply.send(await opts.inspections.complete(req, id, body));
    },
  );

  // ─── Findings (sibling of inspection) ─────────────────────────────────────

  app.get(
    "/qc/inspections/:inspectionId/findings",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { inspectionId } = InspectionParamSchema.parse(req.params);
      return reply.send({
        data: await opts.inspections.listFindings(req, inspectionId),
      });
    },
  );

  app.post(
    "/qc/inspections/:inspectionId/findings",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { inspectionId } = InspectionParamSchema.parse(req.params);
      const body = CreateQcFindingSchema.parse(req.body);
      return reply
        .code(201)
        .send(await opts.inspections.addFinding(req, inspectionId, body));
    },
  );

  app.patch(
    "/qc/inspections/:inspectionId/findings/:findingId",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { inspectionId, findingId } =
        InspectionParamWithFindingSchema.parse(req.params);
      const body = UpdateQcFindingSchema.parse(req.body);
      return reply.send(
        await opts.inspections.updateFinding(
          req,
          inspectionId,
          findingId,
          body,
        ),
      );
    },
  );

  app.delete(
    "/qc/inspections/:inspectionId/findings/:findingId",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { inspectionId, findingId } =
        InspectionParamWithFindingSchema.parse(req.params);
      await opts.inspections.deleteFinding(req, inspectionId, findingId);
      return reply.code(204).send();
    },
  );

  // ─── QC Certificates ──────────────────────────────────────────────────────

  app.get(
    "/qc/certs",
    { preHandler: qcInspect },
    async (req, reply) => {
      const query = QcCertListQuerySchema.parse(req.query);
      return reply.send(await opts.certs.list(req, query));
    },
  );

  app.get(
    "/qc/certs/:id",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.certs.getById(req, id));
    },
  );

  app.get(
    "/qc/inspections/:inspectionId/cert",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { inspectionId } = InspectionParamSchema.parse(req.params);
      const cert = await opts.certs.getByInspectionId(req, inspectionId);
      return reply.send({ data: cert });
    },
  );

  app.post(
    "/qc/certs",
    { preHandler: qcApprove },
    async (req, reply) => {
      const body = IssueQcCertSchema.parse(req.body);
      return reply.code(201).send(await opts.certs.issue(req, body));
    },
  );

  app.delete(
    "/qc/certs/:id",
    { preHandler: qcApprove },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      await opts.certs.recall(req, id);
      return reply.code(204).send();
    },
  );

  // ─── QC Equipment (Phase 5, read-only) ────────────────────────────────────

  app.get(
    "/qc/equipment",
    { preHandler: qcInspect },
    async (req, reply) => {
      const query = QcEquipmentListQuerySchema.parse(req.query);
      return reply.send(await opts.equipment.list(req, query));
    },
  );

  app.get(
    "/qc/equipment/:id",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.equipment.getById(req, id));
    },
  );

  // ─── QC CAPA Actions (Phase 5, read-only) ─────────────────────────────────

  app.get(
    "/qc/capa-actions",
    { preHandler: qcInspect },
    async (req, reply) => {
      const query = QcCapaActionListQuerySchema.parse(req.query);
      return reply.send(await opts.capa.list(req, query));
    },
  );

  app.get(
    "/qc/capa-actions/:id",
    { preHandler: qcInspect },
    async (req, reply) => {
      const { id } = IdParamSchema.parse(req.params);
      return reply.send(await opts.capa.getById(req, id));
    },
  );

  // ─── QC reports ─────────────────────────────────────────────────────────
  // Date-window inspection counts + cycle time + cert rollup. `from`/`to`
  // optional — service defaults to last 90 days when absent.

  app.get(
    "/qc/reports",
    { preHandler: qcInspect },
    async (req, reply) => {
      const query = QcReportsQuerySchema.parse(req.query);
      return reply.send(await opts.reports.summary(req, query));
    },
  );
}
