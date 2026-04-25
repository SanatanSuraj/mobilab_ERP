/**
 * CLI entry point for the forward-migration runner.
 *
 * Subcommands
 * ───────────
 *   status   — list applied + pending; report drift / orphan rows.
 *              Exits 0 if everything is clean, 1 on drift / orphan.
 *   up       — apply pending migrations.
 *              Exits 0 on success, 1 on any error.
 *
 * Connection
 * ──────────
 *   Reads MIGRATIONS_DATABASE_URL first, falls back to DATABASE_URL.
 *   Migrations need DDL grants — point at the cluster owner / migration
 *   role, not the runtime app user (which is NOBYPASSRLS).
 *
 * Migrations dir
 * ──────────────
 *   Resolved relative to the package root by default. Override with
 *   --dir=<path> when running from CI or a different cwd.
 *
 * Production guard
 * ────────────────
 *   `up` requires --confirm when NODE_ENV=production. The intent is to
 *   force a deliberate gesture in deploy scripts: a missing flag will
 *   abort with a clear message instead of silently rolling the schema
 *   forward on a live cluster.
 */

import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { assertDirectPgUrl, PgBouncerUrlError } from "../direct-url.js";
import { status, up, MigrationError } from "./runner.js";

interface ParsedArgs {
  command: "status" | "up";
  dir?: string;
  confirm: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [, , cmd, ...rest] = argv;
  if (cmd !== "status" && cmd !== "up") {
    throw new Error(
      `unknown subcommand: ${cmd ?? "<none>"}. Usage: migrate {status|up} [--dir=<path>] [--confirm]`,
    );
  }
  let dir: string | undefined;
  let confirm = false;
  for (const arg of rest) {
    if (arg.startsWith("--dir=")) dir = arg.slice("--dir=".length);
    else if (arg === "--confirm") confirm = true;
    else throw new Error(`unknown flag: ${arg}`);
  }
  return { command: cmd, dir, confirm };
}

function resolveDatabaseUrl(): string {
  const url = process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "no database URL — set MIGRATIONS_DATABASE_URL (preferred) or DATABASE_URL",
    );
  }
  return url;
}

function resolveMigrationsDir(override: string | undefined): string {
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(override);
  }
  // Walk upward from this file until we find a directory containing
  // pnpm-workspace.yaml — that's the repo root regardless of whether
  // we're running from src/ (tsx) or dist/ (compiled).
  const here = path.dirname(fileURLToPath(import.meta.url));
  let cursor = here;
  // Bound the walk so we never escape the filesystem on a misplaced file.
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(cursor, "pnpm-workspace.yaml"))) {
      return path.join(cursor, "ops", "sql", "migrations");
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(
    "could not locate pnpm-workspace.yaml above migrate/cli.ts; pass --dir explicitly",
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const databaseUrl = resolveDatabaseUrl();
  const migrationsDir = resolveMigrationsDir(args.dir);

  // Migrations must hold a stable session (advisory lock + multi-statement
  // transactions). PgBouncer in transaction mode would silently swap our
  // backend out from under us.
  assertDirectPgUrl(databaseUrl);

  if (args.command === "up" && process.env.NODE_ENV === "production" && !args.confirm) {
    throw new Error(
      "refusing to apply migrations in production without --confirm. " +
        "Add the flag explicitly in your deploy script.",
    );
  }

  console.log(`[migrate] database = ${redactCreds(databaseUrl)}`);
  console.log(`[migrate] dir      = ${migrationsDir}`);

  if (args.command === "status") {
    const report = await status({ databaseUrl, migrationsDir });
    if (report.drift > 0 || report.orphan > 0) {
      process.exit(1);
    }
    return;
  }

  await up({ databaseUrl, migrationsDir });
}

function redactCreds(url: string): string {
  // postgres://user:pass@host/db → postgres://user:***@host/db
  return url.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/i, "$1***$2");
}

main().catch((err: unknown) => {
  if (err instanceof MigrationError || err instanceof PgBouncerUrlError) {
    console.error(`[migrate] ${err.message}`);
  } else if (err instanceof Error) {
    console.error(`[migrate] ${err.message}`);
  } else {
    console.error(`[migrate] unknown error:`, err);
  }
  process.exit(1);
});
