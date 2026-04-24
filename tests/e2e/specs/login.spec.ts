/**
 * J9-adjacent: Login journey + edge behaviours.
 *
 * Exercises the real API login path (not the mock /login page). The user
 * visits /auth/login, enters credentials, lands on the dashboard. Also
 * covers the awkward real-world edges: invalid password, typing through
 * a refresh, and double-clicking "Sign in".
 */

import { test, expect } from "@playwright/test";
import { DEV_USERS, DEV_PASSWORD, WEB_URL } from "../helpers/env";

test.describe("Login – happy path", () => {
  test("valid credentials land on dashboard and set session cookie", async ({
    page,
    context,
  }) => {
    await page.goto(`${WEB_URL}/auth/login`);
    await expect(page.getByRole("heading", { name: "Instigenie ERP" })).toBeVisible();

    await page.locator("#email").fill(DEV_USERS.SUPER_ADMIN.email);
    await page.locator("#password").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: /Sign in/ }).click();

    // Success redirects to the dashboard root. The proxy has already
    // validated the cookie by the time we arrive.
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), {
      timeout: 10_000,
    });

    // Proxy gate – cookie must be present for any protected navigation.
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "instigenie-session");
    expect(session?.value).toBe("1");

    // Tokens must be in sessionStorage so tenantFetch can read them.
    const access = await page.evaluate(() =>
      sessionStorage.getItem("instigenie-access"),
    );
    expect(access).toBeTruthy();
  });
});

test.describe("Login – failure", () => {
  test("wrong password shows an error without navigating away", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/auth/login`);
    await page.locator("#email").fill(DEV_USERS.SUPER_ADMIN.email);
    await page.locator("#password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: /Sign in/ }).click();

    // Error paragraph rendered by LoginForm when the API rejects.
    const error = page.locator("p.text-destructive").first();
    await expect(error).toBeVisible({ timeout: 10_000 });
    await expect(error).not.toHaveText("");

    // Must stay on the login page.
    expect(page.url()).toContain("/auth/login");
  });

  test("non-existent user is rejected (no account enumeration UI)", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/auth/login`);
    await page.locator("#email").fill("nobody@instigenie.local");
    await page.locator("#password").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: /Sign in/ }).click();

    const error = page.locator("p.text-destructive").first();
    await expect(error).toBeVisible({ timeout: 10_000 });
    // Copy should be generic — we don't want "user not found" vs "wrong
    // password" to leak which emails are registered.
    const text = (await error.textContent()) ?? "";
    expect(text.toLowerCase()).not.toContain("not found");
    expect(text.toLowerCase()).not.toContain("does not exist");
  });
});

test.describe("Login – edges", () => {
  test("refresh mid-typing clears the form (no stale state)", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/auth/login`);
    await page.locator("#email").fill("partial@instigenie.local");
    await page.locator("#password").fill("in-progress");

    await page.reload();
    await expect(page.locator("#email")).toHaveValue("");
    await expect(page.locator("#password")).toHaveValue("");
  });

  test("back button from dashboard leaves the user signed-in", async ({
    page,
    context,
  }) => {
    // Sign in normally.
    await page.goto(`${WEB_URL}/auth/login`);
    await page.locator("#email").fill(DEV_USERS.SUPER_ADMIN.email);
    await page.locator("#password").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: /Sign in/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"));

    // Browser back — the proxy should notice they have a session cookie
    // and bounce them back to the dashboard root rather than showing the
    // login form again.
    await page.goBack();
    await page.waitForLoadState("networkidle");

    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "instigenie-session")?.value).toBe(
      "1",
    );
    expect(page.url()).not.toContain("/auth/login");
  });

  test("double-click on Sign in does not submit twice", async ({ page }) => {
    // Watchlist: a rogue double-submit could create two sessions or trigger
    // throttling. The React useTransition + disabled button should make
    // this idempotent. We verify by counting POSTs to /auth/login.
    const loginRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/auth/login") && req.method() === "POST") {
        loginRequests.push(req.url());
      }
    });

    await page.goto(`${WEB_URL}/auth/login`);
    await page.locator("#email").fill(DEV_USERS.SUPER_ADMIN.email);
    await page.locator("#password").fill(DEV_PASSWORD);

    const btn = page.getByRole("button", { name: /Sign in/ });
    // dblclick triggers two quick clicks; the 2nd one ought to be ignored
    // because the button is already disabled while the first is pending.
    await btn.dblclick();

    await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), {
      timeout: 10_000,
    });
    expect(loginRequests.length).toBe(1);
  });

  test("already-authenticated user visiting /auth/login bounces to dashboard", async ({
    page,
  }) => {
    // First, sign in.
    await page.goto(`${WEB_URL}/auth/login`);
    await page.locator("#email").fill(DEV_USERS.SUPER_ADMIN.email);
    await page.locator("#password").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: /Sign in/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"));

    // Now try to visit /auth/login again. proxy.ts has a branch that
    // redirects authenticated users away from login.
    await page.goto(`${WEB_URL}/auth/login`);
    await page.waitForLoadState("networkidle");
    // The proxy should push them elsewhere; we shouldn't see the form.
    // Accept either an immediate redirect or landing on a protected page.
    expect(page.url()).not.toMatch(/\/auth\/login(?:\?|$)/);
  });
});
