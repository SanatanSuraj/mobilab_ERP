/**
 * Gate 9 — Schema drift check.
 *
 * ARCHITECTURE.md §2.4:
 *   "CI builds both frontend and backend from `@instigenie/contracts`;
 *    if the zod schemas don't satisfy both, CI fails."
 *
 * Listed as an open gap in §15.4. This gate closes it.
 *
 * Shape: spawn `tsc --noEmit` against each consumer of
 * `@instigenie/contracts` (apps/api, apps/web, apps/worker). If any
 * consumer has drifted — a field renamed in contracts but still
 * referenced in the API, a response envelope narrowed in Zod that the
 * web fetcher still destructures the old way — TypeScript reports an
 * error against the derived `z.infer<typeof X>` type and this gate fails.
 *
 * Why spawn tsc instead of asserting on source text:
 *   - TS is the ground truth for whether FE + BE "agree" on a contract.
 *   - Regex/AST matching would have to re-implement structural typing
 *     to catch deep drift (optional fields, discriminated unions).
 *   - tsc --noEmit is cheap enough (~10–20s per project on CI) and
 *     already part of every developer's local loop.
 *
 * On failure we capture the tsc stderr+stdout and attach it to the
 * vitest assertion message — so CI shows the exact TS2322 / TS2339
 * line without the operator having to re-run anything.
 *
 * This test reuses the per-app typecheck scripts via `pnpm --filter`
 * rather than shelling out to tsc directly so we pick up each
 * workspace's own tsconfig + TypeScript version + next.js plugin
 * (apps/web/tsconfig.json loads the "next" tsc plugin).
 */

import { describe, it, expect } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@instigenie/observability";

const log = createLogger({ service: "gate-9", level: "silent" });

/**
 * Walk upward from this file until we find the monorepo root
 * (identified by `pnpm-workspace.yaml`). Done at runtime because the
 * test may be invoked from any cwd (vitest, turbo, CI) and we need
 * an absolute, stable anchor for `pnpm --filter` to resolve against.
 */
function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(cur, "pnpm-workspace.yaml"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(
    `gate-9: could not locate pnpm-workspace.yaml upward from ${here}`
  );
}

const REPO_ROOT = findRepoRoot();

// Consumers of @instigenie/contracts that must typecheck clean.
// Order is surface → progressively smaller so a broken FE/BE contract
// surfaces first in the vitest output (web + api are what ARCHITECTURE
// §2.4 explicitly names; worker is added because it shares the same
// contracts barrel and drift there is equally fatal in prod).
interface Consumer {
  readonly name: string;
  readonly filter: string;
}
const CONSUMERS: readonly Consumer[] = [
  { name: "apps/api", filter: "@instigenie/api" },
  { name: "apps/web", filter: "@instigenie/web" },
  { name: "apps/worker", filter: "@instigenie/worker" },
];

interface TypecheckResult {
  readonly consumer: Consumer;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runTypecheck(consumer: Consumer): TypecheckResult {
  log.debug({ consumer: consumer.name }, "spawning tsc --noEmit");
  // 3-minute hard cap per consumer — cold tsc on CI runners without
  // a warm .tsbuildinfo should still come in well under this.
  const result: SpawnSyncReturns<string> = spawnSync(
    "pnpm",
    ["--filter", consumer.filter, "typecheck"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    }
  );
  return {
    consumer,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function formatFailure(r: TypecheckResult): string {
  // tsc writes diagnostics to stdout, not stderr. Include both so
  // whatever shape of error (pnpm wrapper vs tsc vs OOM) is visible.
  const tail = (s: string, n = 80): string => {
    const lines = s.split("\n");
    return lines.length > n ? lines.slice(-n).join("\n") : s;
  };
  return [
    `\n=== gate-9 drift in ${r.consumer.name} (exit ${String(r.status)}) ===`,
    "--- stdout (last 80 lines) ---",
    tail(r.stdout) || "(empty)",
    "--- stderr (last 80 lines) ---",
    tail(r.stderr) || "(empty)",
  ].join("\n");
}

describe("gate-9: @instigenie/contracts satisfies FE + BE + worker", () => {
  // Cold tsc for three projects, in series, on a CI runner: budget
  // generously. Tests are series because vitest's fileParallelism is
  // already off (see tests/gates/vitest.config.ts) but inside a single
  // file the `it` blocks run sequentially anyway.
  const HARD_TIMEOUT_MS = 10 * 60 * 1000;

  for (const consumer of CONSUMERS) {
    it(
      `${consumer.name} typechecks against the shared zod contracts`,
      { timeout: HARD_TIMEOUT_MS },
      () => {
        const r = runTypecheck(consumer);
        if (r.status !== 0) {
          // Attach the captured output to the assertion message so CI
          // log shows the exact TS error without another tsc run.
          expect.fail(formatFailure(r));
        }
        expect(r.status).toBe(0);
      }
    );
  }
});
