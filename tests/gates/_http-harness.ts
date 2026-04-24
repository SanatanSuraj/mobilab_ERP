/**
 * Shared HTTP test harness for Gates 65+.
 *
 * Drives the Fastify API in-process via `app.inject()` — no socket, no port —
 * so every layer of the pipeline (plugins, onRequest hooks, preHandlers
 * for auth / RBAC / feature-flag / quota, the Zod body/query parse, the
 * handler body, the central error mapper in errors/problem.ts) executes
 * exactly as it does in production.
 *
 * Rationale (ARCHITECTURE / TESTING_PLAN context): gates 1–64 all drive
 * services directly with stubbed FastifyRequest objects. That's fast and
 * deterministic, but it skips the preHandler chain — the layer where
 * tenant-isolation, permissions, audience fencing and quota enforcement
 * all live. Gates 65+ cover the HTTP axis matrix from TESTING_PLAN §6 and
 * therefore must drive the app end-to-end.
 *
 * Usage shape (see gate-65 onward for full example):
 *
 *   let harness: HttpHarness;
 *   beforeAll(async () => { harness = await createHttpHarness(); });
 *   afterAll(async () => { await harness.close(); });
 *
 *   it("happy", async () => {
 *     const tok = await harness.tokenFor("MANAGEMENT");
 *     const res = await harness.post("/admin/users/invite", {
 *       token: tok,
 *       body: { email: "...", roleId: "MANAGEMENT" },
 *     });
 *     expect(res.statusCode).toBe(201);
 *   });
 *
 * The harness boots ONE Fastify app per test file (beforeAll) and reuses
 * it across every test. Fixture cleanup is per-test via beforeEach, exactly
 * as the service-layer gates do.
 */

import pg from "pg";
import { buildApp, type BuiltApp } from "@instigenie/api";
import { TokenFactory } from "@instigenie/api/auth/tokens";
import {
  AUDIENCE,
  ROLE_PERMISSIONS,
  type Audience,
  type Role,
} from "@instigenie/contracts";
import { DEV_ORG_ID } from "./_helpers.js";

// BuiltApp["app"] is Fastify's return type — re-export a local alias so
// callers don't have to depend on `fastify` as a typecheck dependency.
type AppInstance = BuiltApp["app"];

// ── Dev-seed users (ops/sql/seed/03-dev-org-users.sql) ─────────────────────
// All dev users share one password: `instigenie_dev_2026`. Each role has
// a canonical representative — use tokenForRole(ROLE) to mint an access
// token bound to that user.

export const DEV_PASSWORD = "instigenie_dev_2026";

interface DevUser {
  userId: string;
  identityId: string;
  email: string;
  role: Role;
}

/**
 * Keys of DEV_USERS — use this as the role parameter type so
 * DEV_USERS[key] is typed as DevUser (not DevUser | undefined).
 */
export type DevRoleKey =
  | "SUPER_ADMIN"
  | "MANAGEMENT"
  | "SALES_REP"
  | "SALES_MANAGER"
  | "FINANCE"
  | "PRODUCTION_MANAGER"
  | "QC_INSPECTOR";

/** Canonical dev user per role — matches ops/sql/seed/03-dev-org-users.sql. */
export const DEV_USERS: Readonly<Record<DevRoleKey, DevUser>> = {
  SUPER_ADMIN: {
    userId: "00000000-0000-0000-0000-00000000b001",
    identityId: "00000000-0000-0000-0000-00000000f001",
    email: "admin@instigenie.local",
    role: "SUPER_ADMIN",
  },
  MANAGEMENT: {
    userId: "00000000-0000-0000-0000-00000000b002",
    identityId: "00000000-0000-0000-0000-00000000f002",
    email: "mgmt@instigenie.local",
    role: "MANAGEMENT",
  },
  SALES_REP: {
    userId: "00000000-0000-0000-0000-00000000b003",
    identityId: "00000000-0000-0000-0000-00000000f003",
    email: "sales@instigenie.local",
    role: "SALES_REP",
  },
  SALES_MANAGER: {
    userId: "00000000-0000-0000-0000-00000000b004",
    identityId: "00000000-0000-0000-0000-00000000f004",
    email: "salesmgr@instigenie.local",
    role: "SALES_MANAGER",
  },
  FINANCE: {
    userId: "00000000-0000-0000-0000-00000000b005",
    identityId: "00000000-0000-0000-0000-00000000f005",
    email: "finance@instigenie.local",
    role: "FINANCE",
  },
  PRODUCTION_MANAGER: {
    userId: "00000000-0000-0000-0000-00000000b007",
    identityId: "00000000-0000-0000-0000-00000000f007",
    email: "prodmgr@instigenie.local",
    role: "PRODUCTION_MANAGER",
  },
  QC_INSPECTOR: {
    userId: "00000000-0000-0000-0000-00000000b009",
    identityId: "00000000-0000-0000-0000-00000000f009",
    email: "qc@instigenie.local",
    role: "QC_INSPECTOR",
  },
};

// ── Harness shape ──────────────────────────────────────────────────────────

export interface InjectOptions {
  /** Bearer access token. Omit for unauthenticated calls. */
  token?: string;
  /** Request body. Serialised as JSON with the right content-type. */
  body?: unknown;
  /** Query params, merged into the URL. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Extra headers. Authorization is set automatically from `token`. */
  headers?: Record<string, string>;
}

export interface InjectResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  /** Parsed JSON body — throws on non-JSON responses, use `raw` for those. */
  body: T;
  /** Raw response payload as a string. */
  raw: string;
}

export interface HttpHarness {
  /** The underlying Fastify app. Use for .inject() one-offs if needed. */
  readonly app: AppInstance;
  /** The app's pg pool — share it for DB fixture setup/cleanup so we
   *  aren't fighting our own app for connections. */
  readonly pool: pg.Pool;

  /**
   * Mint an access token for a dev-seed user by role.
   *
   * The token is signed with the same JWT_SECRET the app was built with,
   * so the auth guard's verifyAccess() accepts it. Claims include all
   * permissions for that role — matching what the real login flow emits.
   */
  tokenForRole(role: DevRoleKey): Promise<string>;

  /**
   * Mint an access token with arbitrary claims — for negative-path tests
   * (wrong audience, missing perms, expired, etc.). Only override what
   * you need; sensible defaults fill the rest.
   */
  tokenWith(opts: {
    userId?: string;
    identityId?: string;
    orgId?: string;
    roles?: Role[];
    /** Tenant-scoped audience: "internal" or "portal". */
    audience?: Audience;
    /** If set, the token is issued with `exp = now + ttlSec`; use -1
     *  to produce a token that's already expired. */
    ttlSecOverride?: number;
  }): Promise<string>;

  get<T = unknown>(path: string, opts?: InjectOptions): Promise<InjectResponse<T>>;
  post<T = unknown>(path: string, opts?: InjectOptions): Promise<InjectResponse<T>>;
  patch<T = unknown>(path: string, opts?: InjectOptions): Promise<InjectResponse<T>>;
  del<T = unknown>(path: string, opts?: InjectOptions): Promise<InjectResponse<T>>;

  /** Close Fastify + release pool/vendorPool/cache handles. */
  close(): Promise<void>;
}

// ── Implementation ─────────────────────────────────────────────────────────

export async function createHttpHarness(): Promise<HttpHarness> {
  // _env-setup.ts ran before this module loaded, so loadEnv() has its
  // required vars. buildApp() mounts every route and plugin but does not
  // open a port.
  const built: BuiltApp = await buildApp();
  // Crucial: Fastify won't route to unregistered handlers until
  // `app.ready()` has awaited all `register(...)` promises. buildApp
  // awaits each `app.register(...)` call, but NOT an explicit
  // `app.ready()` — under inject(), Fastify calls ready() internally,
  // but we call it explicitly to surface any boot-time plugin errors
  // at harness setup time instead of mid-test.
  await built.app.ready();

  const tokens = new TokenFactory({
    secret: new TextEncoder().encode(built.env.jwtSecret),
    issuer: built.env.jwtIssuer,
    accessTokenTtlSec: built.env.accessTokenTtlSec,
  });

  async function tokenForRole(role: DevRoleKey): Promise<string> {
    const u = DEV_USERS[role];
    const issued = await tokens.issueAccess({
      userId: u.userId,
      identityId: u.identityId,
      orgId: DEV_ORG_ID,
      audience: AUDIENCE.internal,
      roles: [u.role],
    });
    return issued.token;
  }

  async function tokenWith(opts: {
    userId?: string;
    identityId?: string;
    orgId?: string;
    roles?: Role[];
    audience?: Audience;
    ttlSecOverride?: number;
  }): Promise<string> {
    // ttlSecOverride is threaded by building a one-off TokenFactory with
    // the overridden TTL. -1 produces a token whose exp is already in
    // the past (factory sets exp = now + ttl).
    const t =
      opts.ttlSecOverride !== undefined
        ? new TokenFactory({
            secret: new TextEncoder().encode(built.env.jwtSecret),
            issuer: built.env.jwtIssuer,
            accessTokenTtlSec: opts.ttlSecOverride,
          })
        : tokens;
    const mgmt = DEV_USERS.MANAGEMENT;
    const issued = await t.issueAccess({
      userId: opts.userId ?? mgmt.userId,
      identityId: opts.identityId ?? mgmt.identityId,
      orgId: opts.orgId ?? DEV_ORG_ID,
      audience: opts.audience ?? AUDIENCE.internal,
      roles: opts.roles ?? [mgmt.role],
    });
    return issued.token;
  }

  function buildHeaders(io: InjectOptions): Record<string, string> {
    const h: Record<string, string> = { ...(io.headers ?? {}) };
    if (io.token !== undefined) h["authorization"] = `Bearer ${io.token}`;
    if (io.body !== undefined && h["content-type"] === undefined) {
      h["content-type"] = "application/json";
    }
    return h;
  }

  function buildUrl(
    path: string,
    query: InjectOptions["query"],
  ): string {
    if (!query) return path;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      sp.set(k, String(v));
    }
    const qs = sp.toString();
    return qs ? `${path}?${qs}` : path;
  }

  async function inject<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    opts: InjectOptions = {},
  ): Promise<InjectResponse<T>> {
    const res = await built.app.inject({
      method,
      url: buildUrl(path, opts.query),
      headers: buildHeaders(opts),
      payload: opts.body,
    });
    const raw = res.payload;
    let body: unknown = undefined;
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    return {
      statusCode: res.statusCode,
      headers: res.headers,
      body: body as T,
      raw,
    };
  }

  return {
    app: built.app,
    pool: built.pool,
    tokenForRole,
    tokenWith,
    get: (p, o) => inject("GET", p, o),
    post: (p, o) => inject("POST", p, o),
    patch: (p, o) => inject("PATCH", p, o),
    del: (p, o) => inject("DELETE", p, o),
    async close(): Promise<void> {
      await built.app.close().catch(() => undefined);
      await built.pool.end().catch(() => undefined);
      await built.vendorPool.end().catch(() => undefined);
      await built.cache.quit().catch(() => undefined);
    },
  };
}

/**
 * Expand a Role's permission set — convenience for tests that need to
 * check what permissions a token-minted-by-role carries. Mirrors the
 * union the authGuard does at request time.
 */
export function permissionsFor(role: Role): Set<string> {
  const perms = new Set<string>();
  for (const p of ROLE_PERMISSIONS[role]) perms.add(p);
  return perms;
}
