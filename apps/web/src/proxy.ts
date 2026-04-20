/**
 * proxy.ts — Route protection (Next.js 16 Proxy, formerly middleware)
 *
 * Runs on every matched request BEFORE the route renders.
 * Only reads the session cookie (optimistic check) — NO database calls here.
 * Real auth validation happens inside each Server Action / Route Handler.
 *
 * Cookie strategy:
 *   mobilab-session   presence flag — set on login, cleared on logout
 *
 * When real JWT auth lands:
 *   1. Store the JWT in an httpOnly cookie (set by the login Server Action)
 *   2. Replace cookie presence check below with `verifyToken(cookie.value)`
 *   3. Forward claims (userId, orgId) to the app via request headers so
 *      Server Components can read them without touching the DB on every render.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─── Route Classification ─────────────────────────────────────────────────────

/** Completely public — no auth cookie required. */
const PUBLIC_PATHS = ["/login"];

/** Static asset prefixes — skip proxy entirely. */
const STATIC_PREFIXES = ["/_next", "/favicon.ico", "/robots.txt", "/sitemap.xml"];

function isStaticAsset(pathname: string): boolean {
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// ─── Proxy ────────────────────────────────────────────────────────────────────

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets — skip immediately (performance)
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get("mobilab-session");
  const isAuthenticated = Boolean(session?.value);

  // Authenticated user hits /login → send them home
  if (isAuthenticated && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Unauthenticated user hits protected route → send to /login
  if (!isAuthenticated && !isPublicPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
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
