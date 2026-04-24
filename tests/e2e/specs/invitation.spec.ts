/**
 * J8: User-invitation acceptance journey.
 *
 * SUPER_ADMIN seeds a fresh invitation through the real API, which returns
 * a devAcceptUrl containing the raw token. We drive the browser through
 * /auth/accept-invite?token=… exactly like an email-clicked user would.
 *
 * Covers:
 *   • Happy path: new identity → set name + 12-char password → land on /
 *   • Missing token → "Missing token" terminal screen
 *   • Invalid (made-up) token → "Invitation not found"
 *   • Client password validation → <12 chars blocks submit
 *   • Double-click guard on the accept button
 */

import { test, expect } from "@playwright/test";
import { WEB_URL } from "../helpers/env";
import {
  seedInvitation,
  extractInviteToken,
  revokeInvitation,
} from "../helpers/api";

function freshEmail(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return `e2e-invitee-${stamp}-${rand}@instigenie.local`;
}

test.describe("Invitation – happy path", () => {
  test("new invitee sets name + password, lands on dashboard", async ({
    page,
    context,
  }) => {
    const invite = await seedInvitation({ email: freshEmail() });
    expect(invite.devAcceptUrl).toBeDefined();
    const token = extractInviteToken(invite.devAcceptUrl!);

    await page.goto(`${WEB_URL}/auth/accept-invite?token=${token}`);

    // Preview loads — the invited email should appear on the card.
    await expect(page.getByText(invite.invitation.email)).toBeVisible({
      timeout: 10_000,
    });

    await page.locator("#accept-name").fill("Jamie Invitee");
    await page.locator("#accept-password").fill("a-secure-password-123");
    await page.getByRole("button", { name: /Accept invite/ }).click();

    await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });

    // Cookie + tokens must be in place, same shape as normal login.
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "instigenie-session")?.value).toBe(
      "1",
    );
    const access = await page.evaluate(() =>
      sessionStorage.getItem("instigenie-access"),
    );
    expect(access).toBeTruthy();

    // Cleanup — the invitation is now ACCEPTED, but revoke is idempotent
    // against our safety net if the test retries.
    await revokeInvitation(invite.invitation.id).catch(() => undefined);
  });
});

test.describe("Invitation – bad tokens", () => {
  test("missing ?token= shows 'Missing token' terminal screen", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/auth/accept-invite`);
    await expect(page.getByRole("heading", { name: "Missing token" })).toBeVisible();
    // Escape hatch link should be visible.
    await expect(page.getByRole("button", { name: "Go to sign-in" })).toBeVisible();
  });

  test("invalid token shows 'Invitation not found'", async ({ page }) => {
    const bogusToken = "f".repeat(64);
    await page.goto(`${WEB_URL}/auth/accept-invite?token=${bogusToken}`);
    await expect(
      page.getByRole("heading", { name: "Invitation not found" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("malformed token (too short) is rejected as invalid", async ({
    page,
  }) => {
    await page.goto(`${WEB_URL}/auth/accept-invite?token=abc`);
    // Server returns validation_error / not_found — both map to "Invitation not found".
    await expect(
      page.getByRole("heading", { name: "Invitation not found" }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Invitation – edges", () => {
  test("password shorter than 12 chars is rejected client-side", async ({
    page,
  }) => {
    const invite = await seedInvitation({ email: freshEmail() });
    const token = extractInviteToken(invite.devAcceptUrl!);

    await page.goto(`${WEB_URL}/auth/accept-invite?token=${token}`);
    await expect(page.getByText(invite.invitation.email)).toBeVisible({
      timeout: 10_000,
    });

    await page.locator("#accept-name").fill("Taylor");
    await page.locator("#accept-password").fill("short"); // 5 chars < 12
    await page.getByRole("button", { name: /Accept invite/ }).click();

    // The HTML5 minLength=12 on the password input should block submit.
    // Either a validation message appears, or the form short-circuits and
    // we stay on the same URL with no session cookie set.
    // Wait a beat to give JS a chance to misbehave.
    await page.waitForTimeout(800);
    expect(page.url()).toContain("/auth/accept-invite");

    await revokeInvitation(invite.invitation.id);
  });

  test("double-click Accept does not submit twice", async ({ page }) => {
    const invite = await seedInvitation({ email: freshEmail() });
    const token = extractInviteToken(invite.devAcceptUrl!);

    const acceptPosts: string[] = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/auth/accept-invite") && req.method() === "POST") {
        acceptPosts.push(req.url());
      }
    });

    await page.goto(`${WEB_URL}/auth/accept-invite?token=${token}`);
    await expect(page.getByText(invite.invitation.email)).toBeVisible();

    await page.locator("#accept-name").fill("Alex");
    await page.locator("#accept-password").fill("a-secure-password-123");

    const btn = page.getByRole("button", { name: /Accept invite/ });
    await btn.dblclick();

    await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });
    expect(acceptPosts.length).toBe(1);

    await revokeInvitation(invite.invitation.id).catch(() => undefined);
  });
});
