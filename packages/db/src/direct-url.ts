/**
 * Direct-Postgres URL guard. Phase 1 Gate 5.
 *
 * The LISTEN/NOTIFY bridge MUST connect straight to Postgres on :5432 — it
 * cannot go through PgBouncer in transaction mode because LISTEN needs a
 * stable session. ARCHITECTURE.md §6.3 + Phase 1 Gate 5.
 *
 * This helper is a cheap connection-string check that runs at boot time
 * (and in CI via the gates suite). It refuses strings that look like they
 * point at PgBouncer:
 *
 *   1. Port matches the known PgBouncer port (default 6432, overridable
 *      via PGBOUNCER_PORT env for dev stacks that remap).
 *   2. Hostname contains the substring "pgbouncer".
 *
 * Anything else passes — in dev we don't have a reliable server-side
 * handshake that distinguishes PgBouncer from raw Postgres, and a URL
 * check is what ARCHITECTURE.md prescribes.
 */

export interface AssertDirectPgUrlOptions {
  /** Port that PgBouncer listens on. Defaults to 6432 or PGBOUNCER_PORT env. */
  pgBouncerPort?: number;
  /** Hostname substrings that should be rejected (case-insensitive). */
  bannedHostSubstrings?: readonly string[];
}

export class PgBouncerUrlError extends Error {
  readonly code = "direct_pg_url_required";
  constructor(message: string) {
    super(message);
    this.name = "PgBouncerUrlError";
  }
}

export function assertDirectPgUrl(
  url: string,
  opts: AssertDirectPgUrlOptions = {}
): void {
  const banned = opts.bannedHostSubstrings ?? ["pgbouncer"];
  const pgBouncerPort =
    opts.pgBouncerPort ??
    Number(process.env.PGBOUNCER_PORT ?? 6432);

  let parsed: URL;
  try {
    // node's URL accepts postgres:// / postgresql:// fine.
    parsed = new URL(url);
  } catch {
    throw new PgBouncerUrlError(
      `direct pg url is not a parseable URL: ${redact(url)}`
    );
  }

  const host = parsed.hostname.toLowerCase();
  for (const b of banned) {
    if (host.includes(b.toLowerCase())) {
      throw new PgBouncerUrlError(
        `direct pg url points at '${host}' which looks like PgBouncer; the listener must connect to Postgres directly on :5432`
      );
    }
  }

  // URL.port is "" when the scheme-default is used; postgres has no URL
  // default, so we conservatively treat an empty port as safe (meaning the
  // user is relying on pg's default of 5432).
  if (parsed.port && Number(parsed.port) === pgBouncerPort) {
    throw new PgBouncerUrlError(
      `direct pg url uses port ${parsed.port} which is the PgBouncer port; the listener must use the direct Postgres port`
    );
  }
}

function redact(url: string): string {
  // Strip credentials before including in error messages.
  try {
    const u = new URL(url);
    u.password = "";
    u.username = "";
    return u.toString();
  } catch {
    return "<unparseable>";
  }
}
