# Forward migrations

This directory holds versioned, append-only SQL migrations. The runner lives
in `packages/db/src/migrate/`.

## Layout

```
ops/sql/migrations/
  0000_baseline.sql     — sentinel; marks "the init/triggers/rls layer was applied"
  0001_<description>.sql
  0002_<description>.sql
  ...
```

`NNNN` is a zero-padded 4-digit version. Files are applied in lex order.
Underscores in the description map to spaces in the human-readable `name`
column of `schema_migrations`.

## What goes here vs. `init/`

| Where | When |
|-------|------|
| `ops/sql/init/`, `triggers/`, `rls/` | Bootstrap — runs once on a fresh cluster via docker-entrypoint-initdb.d |
| `ops/sql/migrations/` | Every forward change after the baseline. Rolls every existing DB forward without touching the bootstrap layer |

After cutting a release, treat the union of `init/` + `triggers/` + `rls/` +
all applied migrations as the canonical schema. To re-establish a fresh
prod database the operator runs the bootstrap, then `pnpm migrate:prod`.

## Authoring rules

- **Every migration must be safe to run inside one transaction.** The runner
  wraps each file in `BEGIN`/`COMMIT`. If a statement (e.g.
  `CREATE INDEX CONCURRENTLY`, `ALTER TYPE … ADD VALUE`) cannot run inside
  a transaction, document that explicitly and split it across files.
- **Never edit a previously-applied migration.** The runner recomputes
  the SHA-256 of every applied file on each invocation and fails loud on
  drift. If you need to fix a mistake, write a new migration.
- **Idempotent statements are still preferred** (`CREATE TABLE IF NOT EXISTS`,
  `DROP … IF EXISTS`) — they save a re-bootstrap from a checksum-broken
  state.
- **Schema, not data.** Reference data (roles, permissions, plan catalog)
  lives in `ops/sql/seed/`. Migrations may correct schema-defining seeds
  (e.g. add a missing permission row) but should not bulk-load tenant
  data.
- **One change per migration.** Reviewers should be able to read a single
  file and understand exactly what shifted.

## Commands

```bash
pnpm migrate:status   # list applied + pending; report drift
pnpm migrate:dev      # apply pending against the dev container's DATABASE_URL
pnpm migrate:prod     # apply pending against MIGRATIONS_DATABASE_URL (or DATABASE_URL); requires --confirm
```

The runner takes a `pg_advisory_lock` (`HASH('instigenie_migrations')`) so
two concurrent invocations cannot trample each other.

## Required privileges

Migrations need DDL — `CREATE TABLE`, `ALTER TABLE`, `CREATE FUNCTION`,
`GRANT`, etc. The bootstrap user `instigenie` (cluster owner in dev,
`postgres`-equivalent in prod) is appropriate. The runtime user
`instigenie_app` is `NOBYPASSRLS` and lacks DDL grants — running
migrations as `instigenie_app` will fail loudly on the first DDL.

Set `MIGRATIONS_DATABASE_URL` to a privileged URL when the runtime
`DATABASE_URL` is the app role.
