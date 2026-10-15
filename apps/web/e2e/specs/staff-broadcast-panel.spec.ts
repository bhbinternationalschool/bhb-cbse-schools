/**
 * staff-broadcast-panel — the header WhatsApp panel (15 Oct 2026).
 *
 * 1. Opened BEFORE the staff roster has loaded, the panel used to resolve
 *    "who am I" from a Masters copy read once at open: no staff in it, so
 *    Leave / Requests / Outdoor duty stayed hidden behind "need a staff record
 *    linked to your login" until it was closed and reopened. The roster
 *    response is held back here until the panel is open, so the race is
 *    forced rather than hoped for (on the local stack the roster is usually
 *    in before a click lands, and the old code passed by luck).
 * 2. At 375 px the popover hung off the button's right edge and ran 53 px
 *    past the left of the screen. It must sit inside the viewport, in both
 *    themes.
 */
import { expect, openAs, test } from "../support";

const ROSTER = "**/api/school-data/staff-roster*";

test("opened before the roster loads, the panel offers leave and requests once it lands", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await openAs(browser, "teacher");
  try {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let heldCount = 0;
    await a.page.route(ROSTER, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      heldCount += 1;
      await held;
      await route.continue();
    });

    await a.page.goto("/home");
    await a.page.getByRole("button", { name: "WhatsApp" }).click();
    await a.page.getByRole("button", { name: "Owner / Admin / Principal" }).click();
    // Unknown is not "no record": while the roster is out, the panel says so.
    await expect(a.page.getByText("Loading your staff record…")).toBeVisible();
    await expect(a.page.getByRole("button", { name: "Raise a request" })).toHaveCount(0);
    expect(heldCount).toBeGreaterThan(0);

    release();
    // The same open panel — no close and reopen.
    await expect(a.page.getByRole("button", { name: "Raise a request" })).toBeVisible({ timeout: 30_000 });
    await expect(a.page.getByRole("button", { name: "Apply for leave" })).toBeVisible();
    await expect(a.page.getByText(/need a staff record linked/)).toHaveCount(0);
  } finally {
    await a.context.close();
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`at 375 px the panel stays on screen (${scheme})`, async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const a = await openAs(browser, "teacher");
    try {
      await a.page.setViewportSize({ width: 375, height: 812 });
      await a.page.emulateMedia({ colorScheme: scheme });
      await a.page.goto("/home");
      await a.page.getByRole("button", { name: "WhatsApp" }).click();
      const panel = a.page.getByTestId("staff-broadcast-panel");
      await expect(panel).toBeVisible();
      expect(await a.page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(scheme === "dark");
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
      await testInfo.attach(`panel-375-${scheme}`, { body: await a.page.screenshot(), contentType: "image/png" });
    } finally {
      await a.context.close();
    }
  });
}
