import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Gates are integration tests — one at a time, no parallel txns on the
    // shared dev Postgres.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
