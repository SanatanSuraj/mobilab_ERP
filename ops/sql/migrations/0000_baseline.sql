-- 0000_baseline — sentinel migration.
--
-- The baseline schema is whatever ops/sql/init/, ops/sql/triggers/, and
-- ops/sql/rls/ produce on a fresh Postgres cluster. Those directories are
-- still the bootstrap source of truth: docker-entrypoint-initdb.d replays
-- them on volume init, and ops/sql/apply-to-running.sh replays them
-- against an existing dev container.
--
-- This file exists so the migration ledger has a stable "version 0000"
-- row on every database — fresh OR pre-migration — without re-executing
-- the baseline DDL. Treat it as a marker, not an instruction.
--
-- Forward changes: add a new file ops/sql/migrations/NNNN_description.sql
-- where NNNN is the next 4-digit version (0001, 0002, …). The runner
-- (packages/db/src/migrate) applies pending migrations in lex order
-- inside its own transaction, records the sha256 of the file body, and
-- refuses to re-run a file whose contents have changed since apply.

SELECT 'baseline' AS migration;
