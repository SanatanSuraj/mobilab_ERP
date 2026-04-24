/**
 * Session fixtures — bypass the UI login for tests that only care about a
 * protected page downstream.
 *
 * The web app stashes tokens in sessionStorage + sets a presence-only
 * `instigenie-session=1` cookie that the proxy checks. To pre-authenticate
 * a Playwright page we replicate that exact shape.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { WEB_URL } from "./env";
import { apiLogin } from "./api";

export interface SeedSessionOptions {
  email: string;
  password?: string;
}

/**
 * Mint tokens via the API, install them on `page` so the very next
 * navigation to a protected path passes the proxy gate + tenantFetch.
 *
 * Important: sessionStorage is origin-scoped, so we must visit the web
 * origin first before calling `page.evaluate`. We land on /auth/login
 * (public route) to make that cheap.
 */
export async function seedSession(
  page: Page,
  context: BrowserContext,
  opts: SeedSessionOptions,
): Promise<void> {
  const creds = await apiLogin(opts.email, opts.password);
  await page.goto(`${WEB_URL}/auth/login`);
  await page.evaluate((c) => {
    sessionStorage.setItem("instigenie-access", c.accessToken);
    sessionStorage.setItem("instigenie-refresh", c.refreshToken);
  }, creds);
  const url = new URL(WEB_URL);
  await context.addCookies([
    {
      name: "instigenie-session",
      value: "1",
      domain: url.hostname,
      path: "/",
      sameSite: "Lax",
    },
  ]);
}

/**
 * The inverse of seedSession — wipe tokens + cookie so the next protected
 * navigation should bounce to /auth/login. Used by the stale-session tests.
 */
export async function clearSession(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await page.goto(`${WEB_URL}/auth/login`).catch(() => undefined);
  await page.evaluate(() => {
    sessionStorage.clear();
  }).catch(() => undefined);
  await context.clearCookies();
}
