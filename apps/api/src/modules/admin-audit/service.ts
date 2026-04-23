/**
 * Admin audit service — ARCHITECTURE.md §4.2.
 *
 * Thin wrapper around the repository; the repo does all the SQL and
 * shaping. The service exists mainly to let routes register a single
 * dependency and to keep a place for future cross-cutting concerns
 * (cursor pagination, CSV export, redaction policy).
 */

import type { FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type {
  AdminAuditListQuery,
  AdminAuditListResponse,
} from "@instigenie/contracts";
import { withRequest } from "../shared/with-request.js";
import { listAuditEntries } from "./repository.js";

export class AdminAuditService {
  constructor(private readonly pool: Pool) {}

  async list(
    req: FastifyRequest,
    query: AdminAuditListQuery,
  ): Promise<AdminAuditListResponse> {
    return withRequest(req, this.pool, async (client) => {
      const { items, total } = await listAuditEntries(client, query);
      return {
        items,
        total,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }
}
