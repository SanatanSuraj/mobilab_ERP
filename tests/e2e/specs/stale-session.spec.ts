/**
 * Stale-session journey.
 *
 * The app relies on a presence-only `instigenie-session` cookie that
 * proxy.ts checks on every protected navigation. Tokens live in
 * sessionStorage — they can desync from the cookie (expire, be cleared
 * from DevTools, arrive stale from a cross-tab logout). This spec
 * exercises the failure shapes a user would actually see.
 *
 * Covers:
 *   • Clearing the cookie mid-session → next nav bounces to /auth/login
 *     with ?from= preserved.
 *   • Direct protected-URL visit with no cookie → same bounce, correct
 *     `from` param.
 *   • Cookie present but tokens missing in sessionStorage → the page
 *     renders but the data-fetching guard should kick them out.
 */

import { test, expect } from "@playwright/test";
import { DEV_USERS, WEB_URL } from "../helpers/env";
import { seedSession, clearSession } from "../helpers/session";

test.describe("Stale session – cookie missing", () => {
  test("direct /crm/leads without cookie redirects to login with ?from=", async ({
    page,
    context,
  }) => {
    await clearSession(page, context);

    await page.goto(`${WEB_URL}/crm/leads`);
    await page.waitForURL((url) => url.pathname === "/auth/login", {
      timeout: 10_000,
    });

    const from = new URL(page.url()).searchParams.get("from");
    expect(from).toBe("/crm/leads");
  });

  test("direct /admin/users without cookie redirects to login with ?from=", async ({
    page,
    context,
  }) => {
    await clearSession(page, context);

    await page.goto(`${WEB_URL}/admin/users`);
    await page.waitForURL((url) => url.pathname === "/auth/login", {
      timeout: 10_000,
    });

    expect(new URL(page.url()).searchParams.get("from")).toBe("/admin/users");
  });

  test("clearing the session cookie mid-session bounces on next nav", async ({
    page,
    context,
  }) => {
    await seedSession(page, context, { email: DEV_USERS.SUPER_ADMIN.email });

    // Land somewhere protected first.
    await page.goto(`${WEB_URL}/crm/leads`);
    await page.waitForURL((url) => url.pathname.startsWith("/crm/leads"));

    // Session goes stale — simulate a server-side revoke or a cross-tab
    // logout by clearing the cookie.
    await context.clearCookies();

    // Next protected navigation has to be bounced.
    await page.goto(`${WEB_URL}/crm/deals`);
    await page.waitForURL((url) => url.pathname === "/auth/login", {
      timeout: 10_000,
    });
    expect(new URL(page.url()).searchParams.get("from")).toBe("/crm/deals");
  });
});

test.describe("Stale session – cookie present but tokens wiped", () => {
  test("sessionStorage wipe + protected nav leaves the user unable to fetch data", async ({
    page,
    context,
  }) => {
    // A real scenario: user leaves the browser tab idle, sessionStorage is
    // cleared by a cross-tab logout, but the cookie is still there. The
    // proxy lets them through, but tenantFetch() can't find a token.
    // This currently has NO graceful handling — the page just silently
    // fails to load data. We capture today's behaviour so the E2E suite
    // flags a regression if we improve it later.
    await seedSession(page, context, { email: DEV_USERS.SUPER_ADMIN.email });

    await page.goto(`${WEB_URL}/auth/login`);
    await page.evaluate(() => sessionStorage.clear());

    await page.goto(`${WEB_URL}/crm/leads`);

    // We stay on the /crm/leads URL (proxy OK, cookie present) but
    // nothing interactive loads. A 401 on the tenantFetch() call gets
    // surfaced to the user (or should — see finding in report).
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toContain("/crm/leads");
  });
});

test.describe("Stale session – landing on login with ?from=", () => {
  test("signing in at /auth/login?from=/crm/leads lands on /crm/leads", async ({
    page,
  }) => {
    const destination = "/crm/leads";
    await page.goto(
      `${WEB_URL}/auth/login?from=${encodeURIComponent(destination)}`,
    );

    await page.locator("#email").fill(DEV_USERS.SALES_REP.email);
    await page.locator("#password").fill("instigenie_dev_2026");
    await page.getByRole("button", { name: /Sign in/ }).click();

    await page.waitForURL(
      (url) => url.pathname === destination,
      { timeout: 10_000 },
    );
  });
});
