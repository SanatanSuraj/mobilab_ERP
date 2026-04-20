/**
 * Drizzle schema barrel. Phase 1 seeds only the tables needed for auth +
 * outbox + audit. Remaining tables get added in Phase 2 as each module
 * lands.
 *
 * ARCHITECTURE.md §4 — Drizzle is the single source of truth for table
 * shapes; migrations are generated from it, not written by hand.
 */

export * from "./core.js";
export * from "./outbox.js";
export * from "./audit.js";
export * from "./crm.js";
export * from "./billing.js";
