/**
 * proxy.ts — Route protection (Next.js 16 Proxy, formerly middleware)
 *
 * Runs on every matched request BEFORE the route renders.
 * Only reads the session cookie (optimistic check) — NO database calls here.
 * Real auth validation happens inside each Server Action / Route Handler.
 *
 * Cookie strategy:
 *   instigenie-session   presence flag — set on login, cleared on logout.
 *                     /auth/login writes this AFTER a successful real-API
 *                     login so we can keep this optimistic cookie gate
 *                     and migrate to httpOnly JWT cookies later without
 *                     touching the proxy.
 *
 * When real JWT auth fully lands:
 *   1. Store the JWT in an httpOnly cookie (set by the login Server Action)
 *   2. Replace cookie presence check below with `verifyToken(cookie.value)`
 *   3. Forward claims (userId, orgId) to the app via request headers so
 *      Server Components can read them without touching the DB on every render.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─── Route Classification ─────────────────────────────────────────────────────

/**
 * Completely public — no auth cookie required.
 *
 *   /login           — legacy mock login + dev-panel role switcher.
 *                      Now redirects to /auth/login; left here so its own
 *                      markup can render (its redirect effect triggers on
 *                      mount).
 *   /auth/login      — real-API login. Primary sign-in page.
 *   /vendor-admin    — entire cross-tenant vendor console. It uses its
 *                      OWN token store (sessionStorage, keyed
 *                      `instigenie-vendor-*`) and its own in-app layout
 *                      guard that bounces unauthed users to
 *                      /vendor-admin/login. It has no reason to require
 *                      the tenant-side `instigenie-session` cookie, and
 *                      demanding it here means a pure-vendor user who
 *                      never logged in on the tenant side gets kicked to
 *                      /auth/login the moment they click a tenant row.
 */
const PUBLIC_PATHS = ["/login", "/auth/login", "/vendor-admin"];

/**
 * Where we send unauthenticated users. Must match an entry in PUBLIC_PATHS.
 * Kept as a constant so swapping between mock /login and real /auth/login is
 * a one-line change.
 */
const LOGIN_PATH = "/auth/login";

/** Static asset prefixes — skip proxy entirely. */
const STATIC_PREFIXES = ["/_next", "/favicon.ico", "/robots.txt", "/sitemap.xml"];

function isStaticAsset(pathname: string): boolean {
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isLoginPath(pathname: string): boolean {
  // Both old mock and new real surfaces count as "on a login page" for the
  // authenticated-user-bounces-to-home rule.
  return (
    pathname === "/login" ||
    pathname === "/auth/login" ||
    pathname === "/vendor-admin/login"
  );
}

// ─── Proxy ────────────────────────────────────────────────────────────────────

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets — skip immediately (performance)
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get("instigenie-session");
  const isAuthenticated = Boolean(session?.value);

  // Authenticated user hits any login page → send them home.
  // The vendor-admin console is cross-tenant and has its own auth; we only
  // bounce tenant logins here. Vendor-admin has its own guard.
  if (isAuthenticated && (pathname === "/login" || pathname === "/auth/login")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Unauthenticated user hits protected route → send to the real login page.
  if (!isAuthenticated && !isPublicPath(pathname)) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    // Preserve the intended destination so we can redirect back after login
    if (pathname !== "/") {
      loginUrl.searchParams.set("from", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// ─── Matcher ──────────────────────────────────────────────────────────────────

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     * - _next/static  (static bundle files)
     * - _next/image   (image optimisation)
     * - favicon.ico, robots.txt, sitemap.xml
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
