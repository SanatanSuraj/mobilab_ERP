import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Gates are integration tests — one at a time, no parallel txns on the
    // shared dev Postgres.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Seed DATABASE_URL / REDIS_BULL_URL before gate modules import, so
    // @instigenie/worker/handlers — which calls loadEnv() eagerly at
    // module load — doesn't crash in environments that rely on gate
    // defaults rather than shell-exported env.
    setupFiles: ["./_env-setup.ts"],
  },
});
