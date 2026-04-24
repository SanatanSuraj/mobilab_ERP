/**
 * Central knobs for the E2E suite.
 *
 * Everything is keyed off the same .env-free defaults as the gates harness
 * (`_env-setup.ts`), so `pnpm test` from tests/e2e Just Works against the
 * local docker-compose dev stack without any extra configuration.
 */

export const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:3000";
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";

/** Dev-seeded org UUID — matches ops/sql/seed/03-dev-org-users.sql. */
export const DEV_ORG_ID = "00000000-0000-0000-0000-00000000a001";

/** Every dev-seeded user shares this password. */
export const DEV_PASSWORD = "instigenie_dev_2026";

export const DEV_USERS = {
  SUPER_ADMIN: {
    email: "admin@instigenie.local",
    role: "SUPER_ADMIN" as const,
  },
  MANAGEMENT: {
    email: "mgmt@instigenie.local",
    role: "MANAGEMENT" as const,
  },
  SALES_REP: {
    email: "sales@instigenie.local",
    role: "SALES_REP" as const,
  },
  SALES_MANAGER: {
    email: "salesmgr@instigenie.local",
    role: "SALES_MANAGER" as const,
  },
  FINANCE: {
    email: "finance@instigenie.local",
    role: "FINANCE" as const,
  },
};

/**
 * Postgres DSN for fixture cleanup (invitations table etc.).
 * Mirrors the fallback the gate harness uses.
 */
export const PG_URL =
  process.env.DATABASE_URL ??
  "postgres://instigenie:instigenie@localhost:5432/instigenie";
