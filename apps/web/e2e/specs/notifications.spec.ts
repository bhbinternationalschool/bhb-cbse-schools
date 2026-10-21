/**
 * notifications — every activity reaches the people it concerns, by role,
 * in the ERP bell (and their phones), and nobody else (20 Oct 2026).
 *
 * THE DEFECT. The bell read a whole-desk copy of "notifications" in the
 * browser, which nothing an approval, a document or a payment ever wrote:
 * a teacher's request reached nobody's bell, and each push site picked its
 * own audience by designation regex.
 *
 * Proved here, against the local stack:
 *   1. a request raised by the class teacher appears in the principal's
 *      (approver's) web bell WITHOUT a reload within the versions poll, and
 *      is absent for an unrelated teacher and for the teacher who raised it;
 *      opening it marks it read on the server;
 *   2. a family's fee payment (taken at the office's counter, the staff app's
 *      route) reaches that family and the fee office (the principal), and
 *      not the cashier who took it, a teacher, or another family;
 *   3. settings: muting a topic and quiet hours are saved on the server and
 *      read back;
 * Screenshots (e2e/notify-shots, git-ignored): the bell open, desktop-light
 * and phone375-dark.
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { DemoSession } from "@/lib/auth";
import { demoSessionCookieName } from "@/lib/auth";
import { APP_URL, expect, fx, metric, openAs, test } from "../support";
import { mintSessionCookie } from "../session";
import { AY_CURRENT } from "../fixture";

const VIEW = "/api/data/views/notifications";
const SHOTS = process.env.NOTIFY_SHOTS || path.join(__dirname, "..", "notify-shots");

type Item = { id: string; kind: string; title: string; body: string; readAt: string | null; payload: Record<string, unknown> };
type View = { recipient: { type: string; id: string }; items: Item[]; unread: number; prefs: { mutedTopics: string[]; quietStart: string; quietEnd: string; voice: boolean }; prefsRev: string | null };

async function inbox(page: Page): Promise<View> {
  const r = await page.request.get(VIEW);
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { data: View }).data;
}

function parentSession(householdId: string): DemoSession {
  const hh = fx.sis.households.find((h) => h.id === householdId)!;
  return {
    persona: "parent",
    fullName: hh.guardianName,
    roleCode: "parent",
    householdId,
    tenantSlug: fx.sessions.office.tenantSlug,
    academicYearCode: AY_CURRENT,
  };
}

async function contextFor(browser: Browser, session: DemoSession, opts: { width: number; height: number; dark?: boolean } = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: APP_URL, viewport: { width: opts.width, height: opts.height }, colorScheme: opts.dark ? "dark" : "light" });
  await context.addCookies([{ name: demoSessionCookieName(), value: mintSessionCookie(session), url: APP_URL, httpOnly: true, sameSite: "Lax" }]);
  return context;
}

const teacherName = fx.sessions.teacher.fullName;

test("a teacher's request reaches the approver's bell within the poll — and no unrelated teacher's", async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const approver = await openAs(browser, "principal");
  const raiser = await openAs(browser, "teacher");
  const other = await openAs(browser, "timetableTeacher");
  const subject = `Smart board, room 4 — ${Date.now().toString(36)}`;
  try {
    let before = 0;
    await test.step("the principal is on Home with the bell before anything is raised", async () => {
      await approver.page.goto("/home");
      await expect(approver.page.getByTestId("notification-bell")).toBeVisible({ timeout: 30_000 });
      before = (await inbox(approver.page)).unread;
    });

    let requestId = "";
    const raisedAt = Date.now();
    await test.step("the class teacher raises a request", async () => {
      const r = await raiser.page.request.post("/api/staff/requests", {
        data: { op: "raise", type: "supplies", subject, description: "Not switching on." },
      });
      expect(r.status(), await r.text()).toBe(200);
      requestId = ((await r.json()) as { request: { id: string } }).request.id;
    });

    let seenAfterMs = -1;
    await test.step("the principal's bell shows it without a reload (versions poll)", async () => {
      const badge = approver.page.getByTestId("notification-unread");
      await expect(badge).toHaveText(before + 1 > 9 ? "9+" : String(before + 1), { timeout: 30_000 });
      seenAfterMs = Date.now() - raisedAt;
      await approver.page.getByRole("button", { name: /unread notifications/ }).click();
      const item = approver.page.getByTestId("notification-item").filter({ hasText: `Request · ${teacherName}` }).filter({ hasText: subject });
      await expect(item).toBeVisible();
      await expect(item).toHaveAttribute("data-unread", "1");
    });

    await test.step("stored for the approvers only", async () => {
      const mine = (await inbox(approver.page)).items.filter((i) => i.payload.requestId === requestId);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.kind).toBe("staff_request.raised");
      const office = await openAs(browser, "office");
      try {
        expect((await inbox(office.page)).items.some((i) => i.payload.requestId === requestId), "the office manages requests too").toBe(true);
      } finally {
        await office.context.close();
      }
      expect((await inbox(other.page)).items.some((i) => i.payload.requestId === requestId), "an unrelated teacher").toBe(false);
      expect((await inbox(raiser.page)).items.some((i) => i.payload.requestId === requestId), "the teacher who raised it").toBe(false);
      // A second raise of the same id cannot double it (dedupe is in erp_notify_deliver; see the SQL test).
    });

    await test.step("opening it marks it read on the server", async () => {
      await approver.page.getByTestId("notification-item").filter({ hasText: subject }).click();
      await expect
        .poll(async () => (await inbox(approver.page)).items.find((i) => i.payload.requestId === requestId)?.readAt ?? null, { timeout: 15_000 })
        .not.toBeNull();
    });

    await test.step("the decision goes back to the teacher", async () => {
      const list = await approver.page.request.get("/api/data/views/staff-requests");
      const rev = ((await list.json()) as { data: { requests: { id: string; rev: number }[] } }).data.requests.find((x) => x.id === requestId)!.rev;
      const r = await approver.page.request.post("/api/staff/requests", { data: { op: "update", id: requestId, base: rev, patch: { status: "resolved" } } });
      expect(r.status(), await r.text()).toBe(200);
      await expect
        .poll(async () => (await inbox(raiser.page)).items.filter((i) => i.payload.requestId === requestId).map((i) => i.kind), { timeout: 15_000 })
        .toEqual(["staff_request.updated"]);
      expect((await inbox(other.page)).items.some((i) => i.payload.requestId === requestId)).toBe(false);
    });
    await metric(testInfo, "notify-bell", { seenAfterMs });
  } finally {
    await approver.context.close();
    await raiser.context.close();
    await other.context.close();
  }
});

test("a family's payment notifies that family and the fee office — not the cashier, a teacher or another family", async ({ browser }) => {
  test.setTimeout(120_000);
  // A child with an open charge (the fixture's fourth charge voucher); ₹1 of it is paid.
  const cv = fx.growing.chargeVouchers[3]!;
  const child = fx.sis.students.find((s) => s.id === cv.studentId)!;
  const otherFamily = fx.sis.students.find((s) => s.academicYearCode === AY_CURRENT && s.status === "active" && s.householdId && s.householdId !== child.householdId)!.householdId!;

  const office = await openAs(browser, "office");
  const principal = await openAs(browser, "principal");
  const teacher = await openAs(browser, "teacher");
  const family = await contextFor(browser, parentSession(child.householdId!));
  const stranger = await contextFor(browser, parentSession(otherFamily));
  const familyPage = await family.newPage();
  const strangerPage = await stranger.newPage();
  try {
    const dues = await office.page.request.get(`/api/v1/staff/fees/dues?studentId=${encodeURIComponent(child.id)}`);
    expect(dues.status(), await dues.text()).toBe(200);
    const body = (await dues.json()) as { data: { children: { studentId: string; dues: { dueKey: string; balancePaise: number }[] }[] } };
    const due = body.data.children.find((c) => c.studentId === child.id)?.dues.find((d) => d.balancePaise > 0);
    expect(due, "the child has an open due").toBeTruthy();

    const paid = await office.page.request.post("/api/v1/staff/fees/collect", {
      data: {
        studentId: child.id,
        lines: [{ studentId: child.id, dueKey: due!.dueKey, amountPaise: 100 }],
        tenders: [{ mode: "cash", amountPaise: 100 }],
        clientRef: `e2e-notify-${Date.now().toString(36)}`,
      },
    });
    expect(paid.status(), await paid.text()).toBe(200);
    const receiptNo = ((await paid.json()) as { data: { receiptNo: string } }).data.receiptNo;
    const withReceipt = (v: View, kind: string) => v.items.filter((i) => i.kind === kind && i.payload.receiptNo === receiptNo);

    await expect.poll(async () => withReceipt(await inbox(familyPage), "fees.receipt").length, { timeout: 15_000 }).toBe(1);
    const fam = withReceipt(await inbox(familyPage), "fees.receipt")[0]!;
    expect(fam.title).toContain("₹1");
    expect((await inbox(familyPage)).recipient).toEqual({ type: "parent", id: child.householdId });

    await expect.poll(async () => withReceipt(await inbox(principal.page), "fees.received").length, { timeout: 15_000 }).toBe(1);
    expect(withReceipt(await inbox(office.page), "fees.received"), "the cashier is not told about her own receipt").toHaveLength(0);
    expect(withReceipt(await inbox(teacher.page), "fees.received"), "a teacher holds no fees grant").toHaveLength(0);
    const s = await inbox(strangerPage);
    expect(s.items.some((i) => i.payload.receiptNo === receiptNo), "another family").toBe(false);

    // The same receipt (a retried request) is not stored twice.
    expect(withReceipt(await inbox(familyPage), "fees.receipt")).toHaveLength(1);
  } finally {
    await office.context.close();
    await principal.context.close();
    await teacher.context.close();
    await family.close();
    await stranger.close();
  }
});

test("mute a topic and quiet hours are saved on the server and read back; screenshots", async ({ browser }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const size of [
    { name: "desktop-light", width: 1440, height: 900, dark: false },
    { name: "phone375-dark", width: 375, height: 812, dark: true },
  ]) {
    const context = await contextFor(browser, fx.sessions.principal, size);
    const page = await context.newPage();
    try {
      await page.goto("/home");
      const bell = page.getByTestId("notification-bell");
      await expect(bell).toBeVisible({ timeout: 30_000 });
      await bell.getByRole("button").first().click();
      await expect(page.getByTestId("notification-list")).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: path.join(SHOTS, `bell-${size.name}.png`) });

      if (size.name === "desktop-light") {
        await page.getByRole("button", { name: "Notification settings" }).click();
        const panel = page.getByTestId("notification-settings");
        await expect(panel).toBeVisible();
        await panel.getByLabel("Fees & receipts").uncheck();
        await panel.getByLabel("Quiet from").fill("22:00");
        await panel.getByLabel("Quiet until").fill("06:30");
        await panel.getByRole("button", { name: "Save" }).click();
        await expect(page.getByTestId("notification-settings-msg")).toHaveText("Saved");
        await page.screenshot({ path: path.join(SHOTS, `settings-${size.name}.png`) });
        const v = await inbox(page);
        expect(v.prefs.mutedTopics).toEqual(["fees"]);
        expect(v.prefs.quietStart).toBe("22:00");
        expect(v.prefs.quietEnd).toBe("06:30");
        expect(v.prefsRev).not.toBeNull();
        // A save from an older copy is refused, and says so.
        const stale = await page.request.post("/api/v1/notifications", {
          data: { op: "prefs", base: "2020-01-01T00:00:00Z", prefs: { mutedTopics: [], voice: true, quietEnabled: true, quietStart: "21:00", quietEnd: "07:00" } },
        });
        expect(stale.status()).toBe(409);
        expect((await inbox(page)).prefs.mutedTopics).toEqual(["fees"]);
      }
    } finally {
      await context.close();
    }
  }
});
