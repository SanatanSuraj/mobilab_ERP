/**
 * @instigenie/db — Postgres access layer for every Instigenie service.
 *
 * Public surface:
 *   - makeDb({ connectionString }): Db           → Pool + Drizzle
 *   - withOrg(pool, orgId, fn)                   → RLS-scoped txn
 *   - enqueueOutbox(client, event)               → same-txn event publish
 *   - installNumericTypeParser()                 → bootstrap guard
 *   - schema (drizzle tables)                    → type-safe queries
 *
 * ARCHITECTURE.md Rules referenced: #1 (NUMERIC via string), #2 (outbox),
 * §4 (Pool + Drizzle), §9.2 (RLS via GUC).
 */

export { makeDb, type Db, type MakePoolOptions } from "./pool.js";
export { withOrg } from "./with-org.js";
export { withPortalUser } from "./with-portal-user.js";
export { enqueueOutbox, type OutboxEvent } from "./outbox.js";
export {
  installNumericTypeParser,
  isNumericParserInstalled,
} from "./types.js";
export {
  assertDirectPgUrl,
  PgBouncerUrlError,
  type AssertDirectPgUrlOptions,
} from "./direct-url.js";
export * as schema from "./schema/index.js";
