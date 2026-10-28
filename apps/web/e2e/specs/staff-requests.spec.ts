/**
 * staff-requests — Staff → Requests reach the office (15 Oct 2026).
 *
 * Until this fix a request lived only in the browser that raised it (staff HR
 * reads from the desk; `staffRequests` was neither a desk slice nor pushed to
 * the old blob), so an approver on any other device never saw it.
 *
 * Two contexts, both open before anything is raised:
 *   A — the class teacher (not a manager) raises a request from the header
 *       WhatsApp panel (Owner / Admin / Principal → Raise a request);
 *   B — the principal, already on Staff → Requests, sees it WITHOUT a reload
 *       within 30 s (the versions poll, erp_versions staff_hr), resolves it;
 *   A — sees it resolved on her own Staff → Requests.
 * Then: the database holds exactly that one request element, with `_rev` 2.
 */
import type { Page } from "@playwright/test";
import { expect, metric, openAs, test } from "../support";

const VIEW = "/api/data/views/staff-requests";

async function openRequests(page: Page): Promise<void> {
  await page.goto("/staff?tab=requests");
  await expect(page.getByText(/Operational requests staff raise|Requests you.ve raised/)).toBeVisible({ timeout: 30_000 });
}

test("a request raised in one browser reaches the approver in another, and the decision comes back", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const a = await openAs(browser, "teacher");
  const b = await openAs(browser, "principal");
  const subject = `Projector bulb, room 7 — ${Date.now().toString(36)}`;
  try {
    await test.step("B (principal) is on Staff → Requests before anything is raised", async () => {
      await openRequests(b.page);
      await expect(b.page.getByText(subject)).toHaveCount(0);
    });

    await test.step("A (class teacher) raises a request from the header WhatsApp panel", async () => {
      // Opened straight after landing: the panel reads Masters through the
      // query, so the self-service modes appear once the roster lands, in
      // the same open panel (the forced version of this race is
      // staff-broadcast-panel.spec.ts).
      await a.page.goto("/home");
      await a.page.getByRole("button", { name: "WhatsApp" }).click();
      await a.page.getByRole("button", { name: "Owner / Admin / Principal" }).click();
      await a.page.getByRole("button", { name: "Raise a request" }).click();
      await a.page.getByPlaceholder("Subject (short)").fill(subject);
      await a.page.getByPlaceholder("Details…").fill("The bulb went this morning.");
      // The old code said "Request filed" too — it had only written this
      // browser's copy. What counts is the next step, in the other browser.
      await a.page.getByRole("button", { name: "Submit request" }).click();
      await expect(a.page.getByText("Request filed")).toBeVisible();
    });

    const raisedAt = Date.now();
    let seenAfterMs = -1;
    await test.step("B sees it without a reload within 30 s", async () => {
      const row = b.page.locator("tr", { hasText: subject });
      await expect(row).toBeVisible({ timeout: 30_000 });
      seenAfterMs = Date.now() - raisedAt;
    });

    await test.step("B resolves it", async () => {
      const row = b.page.locator("tr", { hasText: subject });
      await row.getByLabel("Status").selectOption("resolved");
      await expect(b.page.getByTestId("staff-requests-notice")).toHaveText("Request updated");
      await expect(row.getByLabel("Status")).toHaveValue("resolved");
    });

    await test.step("A sees it resolved on her own Staff → Requests", async () => {
      await openRequests(a.page);
      const row = a.page.locator("tr", { hasText: subject });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row.getByText("Resolved", { exact: true })).toBeVisible({ timeout: 30_000 });
    });

    await test.step("the server holds it once, raised by A, resolved, at revision 2", async () => {
      const r = await b.page.request.get(VIEW);
      expect(r.status()).toBe(200);
      const body = (await r.json()) as { data: { requests: { subject: string; status: string; rev: number; staffId: string }[] } };
      const mine = body.data.requests.filter((x) => x.subject === subject);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.status).toBe("resolved");
      expect(mine[0]!.rev).toBe(2);
      // A, not a manager, sees only her own requests.
      const ra = await a.page.request.get(VIEW);
      const own = (await ra.json()) as { data: { canManage: boolean; requests: { staffId: string }[] } };
      expect(own.data.canManage).toBe(false);
      expect(new Set(own.data.requests.map((x) => x.staffId)).size).toBe(1);
    });
    await metric(testInfo, "staff-requests", { seenAfterMs });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("a triage from an older copy is refused and the screen shows the newer state", async ({ browser }) => {
  const b1 = await openAs(browser, "principal");
  const b2 = await openAs(browser, "principal");
  const subject = `Chalk boxes — ${Date.now().toString(36)}`;
  try {
    // Raised through the route (the UI path is the test above).
    const raised = await b1.page.request.post("/api/staff/requests", {
      data: { op: "raise", type: "supplies", subject, description: "" },
    });
    expect(raised.status()).toBe(200);
    await openRequests(b1.page);
    await openRequests(b2.page);
    const row1 = b1.page.locator("tr", { hasText: subject });
    const row2 = b2.page.locator("tr", { hasText: subject });
    await expect(row1).toBeVisible({ timeout: 30_000 });
    await expect(row2).toBeVisible({ timeout: 30_000 });

    await row1.getByLabel("Status").selectOption("in_progress");
    await expect(b1.page.getByTestId("staff-requests-notice")).toHaveText("Request updated");

    // b2 still holds revision 1.
    await row2.getByLabel("Status").selectOption("closed");
    await expect(b2.page.getByTestId("staff-requests-notice")).toContainText("changed on another device");
    await expect(row2.getByLabel("Status")).toHaveValue("in_progress", { timeout: 15_000 });

    const r = await b1.page.request.get(VIEW);
    const body = (await r.json()) as { data: { requests: { subject: string; status: string }[] } };
    expect(body.data.requests.find((x) => x.subject === subject)?.status).toBe("in_progress");
  } finally {
    await b1.context.close();
    await b2.context.close();
  }
});
