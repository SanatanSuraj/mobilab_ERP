/**
 * J1-core: SALES_REP creates a new lead via /crm/leads.
 *
 * This is the "main feature" journey — the canonical first-value action
 * for a sales user. Covers the full flow: nav to the leads page, open the
 * "New Lead" sheet, fill the 4 required fields, submit, verify the toast
 * + row in the list. Plus the edge behaviours:
 *   • Double-click Create → single POST, single row.
 *   • Refresh mid-typing → form state resets (no stale persisted draft).
 *   • Cancel button closes the sheet without posting anything.
 */

import { test, expect } from "@playwright/test";
import { DEV_USERS, WEB_URL } from "../helpers/env";
import { seedSession } from "../helpers/session";

function freshLead() {
  const stamp = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1e6).toString(36);
  return {
    name: `E2E Tester ${stamp}`,
    company: `E2E Clinic ${stamp}`,
    email: `e2e-lead-${stamp}-${rand}@hospital.in`,
    phone: "+91 98765 43210",
    value: "425000",
  };
}

test.describe("Lead create – happy path", () => {
  test("SALES_REP opens New Lead, submits, sees toast + row", async ({
    page,
    context,
  }) => {
    await seedSession(page, context, { email: DEV_USERS.SALES_REP.email });
    await page.goto(`${WEB_URL}/crm/leads`);

    // Page must not be the login redirect.
    await page.waitForURL(
      (url) => url.pathname.startsWith("/crm/leads"),
      { timeout: 15_000 },
    );

    await page.getByRole("button", { name: "New Lead" }).click();

    const lead = freshLead();
    await page.locator("#nal-name").fill(lead.name);
    await page.locator("#nal-company").fill(lead.company);
    await page.locator("#nal-email").fill(lead.email);
    await page.locator("#nal-phone").fill(lead.phone);
    await page.locator("#nal-value").fill(lead.value);

    await page.getByRole("button", { name: /Create Lead/ }).click();

    // Sonner toast surfaces the success string.
    await expect(
      page.getByText(`Lead "${lead.name}" created`),
    ).toBeVisible({ timeout: 10_000 });

    // The new lead should surface somewhere on the page. The list may
    // paginate, so we search for the company rather than the name
    // (company is the more prominent column on the default list).
    await expect(page.getByText(lead.company).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Lead create – edges", () => {
  test("double-click Create only POSTs once", async ({ page, context }) => {
    await seedSession(page, context, { email: DEV_USERS.SALES_REP.email });
    await page.goto(`${WEB_URL}/crm/leads`);
    await page.waitForURL((url) => url.pathname.startsWith("/crm/leads"));

    const creates: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/crm/leads")) {
        creates.push(req.url());
      }
    });

    await page.getByRole("button", { name: "New Lead" }).click();

    const lead = freshLead();
    await page.locator("#nal-name").fill(lead.name);
    await page.locator("#nal-company").fill(lead.company);
    await page.locator("#nal-email").fill(lead.email);
    await page.locator("#nal-phone").fill(lead.phone);

    const submitBtn = page.getByRole("button", { name: /Create Lead/ });
    await submitBtn.dblclick();

    // Wait for the mutation to land — then check the POST count. The
    // useMutation.isPending guard has a React-render gap between click 1
    // and click 2, so a real double-click goes through twice and fires
    // two POSTs + two toasts. The login form (useTransition + plain
    // disabled) guards correctly; this one does not.
    await expect(
      page.getByText(`Lead "${lead.name}" created`).first(),
    ).toBeVisible({ timeout: 10_000 });
    // Give any 2nd in-flight request a chance to land before counting.
    await page.waitForTimeout(500);
    expect(creates.length).toBe(1);
  });

  test("refresh mid-typing clears the draft (no stale persisted state)", async ({
    page,
    context,
  }) => {
    await seedSession(page, context, { email: DEV_USERS.SALES_REP.email });
    await page.goto(`${WEB_URL}/crm/leads`);
    await page.waitForURL((url) => url.pathname.startsWith("/crm/leads"));

    await page.getByRole("button", { name: "New Lead" }).click();

    await page.locator("#nal-name").fill("Draft in progress");
    await page.locator("#nal-company").fill("Will be lost");

    await page.reload();
    await page.waitForURL((url) => url.pathname.startsWith("/crm/leads"));

    // Sheet should be closed, button should return "New Lead", no draft
    // typed into a reopened sheet.
    await page.getByRole("button", { name: "New Lead" }).click();
    await expect(page.locator("#nal-name")).toHaveValue("");
    await expect(page.locator("#nal-company")).toHaveValue("");
  });

  test("Cancel button closes the sheet without creating", async ({
    page,
    context,
  }) => {
    await seedSession(page, context, { email: DEV_USERS.SALES_REP.email });
    await page.goto(`${WEB_URL}/crm/leads`);
    await page.waitForURL((url) => url.pathname.startsWith("/crm/leads"));

    const creates: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/crm/leads")) {
        creates.push(req.url());
      }
    });

    await page.getByRole("button", { name: "New Lead" }).click();
    await page.locator("#nal-name").fill("Never submitted");
    await page.getByRole("button", { name: "Cancel" }).click();

    // Sheet should dismiss — the name input shouldn't be in the DOM.
    await expect(page.locator("#nal-name")).toHaveCount(0, { timeout: 5_000 });
    expect(creates.length).toBe(0);
  });

  test("missing required fields blocks submit", async ({
    page,
    context,
  }) => {
    await seedSession(page, context, { email: DEV_USERS.SALES_REP.email });
    await page.goto(`${WEB_URL}/crm/leads`);
    await page.waitForURL((url) => url.pathname.startsWith("/crm/leads"));

    await page.getByRole("button", { name: "New Lead" }).click();

    // The isValid() gate means the Create button is disabled until all
    // four required fields are filled.
    const btn = page.getByRole("button", { name: /Create Lead/ });
    await expect(btn).toBeDisabled();

    // Fill only 3 of 4 required.
    await page.locator("#nal-name").fill("Only");
    await page.locator("#nal-company").fill("Three");
    await page.locator("#nal-email").fill("three@example.com");

    await expect(btn).toBeDisabled();
  });
});
