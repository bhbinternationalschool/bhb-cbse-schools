/**
 * parent-web-tabs — every tab of the website parent page (/parent) shows the
 * signed-in parent their own family's data, read on the server (15 Oct 2026).
 *
 * THE DEFECT. Homework, PTM, Leave, Complaints, Profile & docs, Subjects,
 * Notices / News / Gallery, the running strip, the bell and the chat read the
 * office's desks in the browser. Those refuse a parent session, so a real
 * parent saw "No household linked" (or the built-in sample notices, or an empty
 * bell) on almost every tab. Each now reads the route the parent app uses
 * (/api/v1/*, scoped to the session's household on the server); Subjects reads
 * /api/parent-portal/subjects.
 *
 * The gallery tab is PR #672's (fix/gallery-end-to-end); its server read
 * (/api/v1/gallery/albums) is still checked for scoping below.
 *
 * Fixture: e2e/parentTabsCase.ts — homework, a diary entry, a PTM event,
 * notices (one for parents, one staff-only), news and two albums (school-wide,
 * and another family's class). Leave, a complaint and a chat message are
 * written here through the parent's own POST routes.
 *
 * For every tab: the family's own data on screen; another family's refused (a
 * 403 for its child) or absent; a failed read shows "Could not load … / Try
 * again" and Try again recovers. Screenshots in e2e/parent-tabs-shots
 * (git-ignored), desktop-light and phone375-dark.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { DemoSession } from "@/lib/auth";
import { demoSessionCookieName } from "@/lib/auth";
import { APP_URL, expect, fx, test } from "../support";
import { mintSessionCookie } from "../session";
import { AY_CURRENT } from "../fixture";
import {
  ALBUM_OTHER_CLASS,
  ALBUM_SCHOOL,
  DIARY_MINE,
  HW_MINE,
  HW_OTHER,
  MINE,
  NEWS,
  NOTICE_PARENTS,
  NOTICE_STAFF,
  OTHER,
  PTM_EVENT,
} from "../parentTabsCase";

const SHOTS =
  process.env.PARENT_TABS_SHOTS ||
  path.join(__dirname, "..", "parent-tabs-shots");
const SIZES = [
  { name: "desktop-light", width: 1440, height: 900, dark: false },
  { name: "phone375-dark", width: 375, height: 812, dark: true },
] as const;

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

async function contextAs(
  browser: Browser,
  session: DemoSession | null,
  opts: { width: number; height: number; dark?: boolean } = {
    width: 1440,
    height: 900,
  },
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: { width: opts.width, height: opts.height },
    colorScheme: opts.dark ? "dark" : "light",
  });
  if (session) {
    await context.addCookies([
      {
        name: demoSessionCookieName(),
        value: mintSessionCookie(session),
        url: APP_URL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  await context.addCookies([
    { name: "bhb_theme", value: opts.dark ? "dark" : "light", url: APP_URL },
  ]);
  await context.route(
    (u) => !u.href.startsWith(APP_URL),
    (r) => r.abort(),
  );
  return context;
}

const LEAVE_REASON = "E2E family wedding";
const OTHER_LEAVE_REASON = "E2E other family's leave";
const COMPLAINT = "E2E bus was late";
const OTHER_COMPLAINT = "E2E other family's complaint";
const CHAT = "E2E hello from the parent";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(
    MINE && OTHER,
    "fixture has two families in different sections",
  ).toBeTruthy();
  execFileSync(
    "npx",
    [
      "--yes",
      "tsx",
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "scripts",
        "e2e-seed-parent-tabs.ts",
      ),
    ],
    {
      cwd: path.join(__dirname, "..", ".."),
      stdio: "inherit",
    },
  );
  fs.mkdirSync(SHOTS, { recursive: true });
});

type Ok<T> = { ok: true; data: T };

test("the server scopes every parent read to the session's family; another family's child is refused", async ({
  browser,
}) => {
  const me = await contextAs(browser, parentSession(MINE.householdId));
  const other = await contextAs(browser, parentSession(OTHER.householdId));
  const get = async <T>(
    c: BrowserContext,
    url: string,
    status = 200,
  ): Promise<T> => {
    const res = await c.request.get(url);
    expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
    return ((await res.json()) as Ok<T>).data;
  };

  // The other family writes a leave request and a complaint of its own.
  const types = (
    await get<{ leaveTypes: { code: string }[] }>(other, "/api/v1/leave/list")
  ).leaveTypes;
  const ol = await other.request.post("/api/v1/leave/request", {
    data: {
      studentId: OTHER.id,
      fromDate: "2026-11-02",
      toDate: "2026-11-02",
      leaveType: types[0]!.code,
      reason: OTHER_LEAVE_REASON,
    },
  });
  expect(ol.status(), await ol.text()).toBe(200);
  const oc = await other.request.post("/api/v1/complaints/create", {
    data: {
      studentId: OTHER.id,
      category: "transport",
      subject: OTHER_COMPLAINT,
      description: "Late again.",
    },
  });
  expect(oc.status(), await oc.text()).toBe(200);

  await expect(async () => {
    // Homework: mine, never the other class's; the other child refused.
    const hw = await get<{ posts: { id: string }[]; diary: { id: string }[] }>(
      me,
      `/api/v1/homework/feed?studentId=${MINE.id}`,
    );
    expect(hw.posts.map((p) => p.id)).toContain(HW_MINE);
    expect(hw.posts.map((p) => p.id)).not.toContain(HW_OTHER);
    expect(hw.diary.map((d) => d.id)).toContain(DIARY_MINE);
  }).toPass({ timeout: 90_000, intervals: [5_000, 10_000, 15_000] });
  await get(me, `/api/v1/homework/feed?studentId=${OTHER.id}`, 403);
  // PTM, chat, subjects request: another family's child is refused.
  const ptm = await get<{ events: { id: string }[] }>(
    me,
    `/api/v1/ptm/overview?studentId=${MINE.id}`,
  );
  expect(ptm.events.map((e) => e.id)).toContain(PTM_EVENT);
  await get(me, `/api/v1/ptm/overview?studentId=${OTHER.id}`, 403);
  await get(me, `/api/v1/chat/thread?studentId=${OTHER.id}`, 403);
  const subj = await me.request.post("/api/parent-portal/subjects", {
    data: {
      studentId: OTHER.id,
      proposedStreamId: null,
      proposedChosenSubjectIds: [],
      note: "",
    },
  });
  expect(subj.status()).toBe(403);
  // Household-scoped lists: the other family's rows are never in mine.
  const leave = await get<{
    requests: { reason: string; studentId: string }[];
  }>(me, "/api/v1/leave/list");
  expect(leave.requests.map((r) => r.reason)).not.toContain(OTHER_LEAVE_REASON);
  const complaints = await get<{ tickets: { subject: string }[] }>(
    me,
    "/api/v1/complaints/list",
  );
  expect(complaints.tickets.map((t) => t.subject)).not.toContain(
    OTHER_COMPLAINT,
  );
  const profile = await get<{
    household: { id: string };
    children: { id: string }[];
  }>(me, "/api/v1/profile");
  expect(profile.household.id).toBe(MINE.householdId);
  expect(profile.children.map((c) => c.id)).toContain(MINE.id);
  expect(profile.children.map((c) => c.id)).not.toContain(OTHER.id);
  const subjects = await get<{ children: { id: string }[] }>(
    me,
    "/api/parent-portal/subjects",
  );
  expect(subjects.children.map((c) => c.id)).toContain(MINE.id);
  expect(subjects.children.map((c) => c.id)).not.toContain(OTHER.id);
  // Notices: parents' and everyone's, never staff-only; albums: never another class's.
  await expect(async () => {
    const feed = await get<{
      notices: { id: string }[];
      news: { id: string }[];
    }>(me, "/api/v1/comms/feed");
    expect(feed.notices.map((n) => n.id)).toContain(NOTICE_PARENTS);
    expect(feed.notices.map((n) => n.id)).not.toContain(NOTICE_STAFF);
    expect(feed.news.map((n) => n.id)).toContain(NEWS);
  }).toPass({ timeout: 90_000, intervals: [5_000, 10_000, 15_000] });
  const albums = await get<{ albums: { id: string }[] }>(
    me,
    "/api/v1/gallery/albums",
  );
  expect(albums.albums.map((a) => a.id)).toContain(ALBUM_SCHOOL);
  expect(albums.albums.map((a) => a.id)).not.toContain(ALBUM_OTHER_CLASS);
  // Staff are not parents here.
  const staff = await contextAs(browser, fx.sessions.principal);
  expect(
    (await staff.request.get("/api/parent-portal/subjects")).status(),
  ).toBe(403);
  await Promise.all([me.close(), other.close(), staff.close()]);
});

async function openTab(page: Page, tab: string): Promise<void> {
  await page.goto(`/parent?tab=${tab}`);
  await expect(page.getByText(/No household linked/)).toHaveCount(0);
}

async function pickMine(page: Page): Promise<void> {
  const chip = page.locator(`button[data-child-id="${MINE.id}"]`).first();
  if (await chip.count()) await chip.click();
}

/** What each tab must show for this family, read from the screen. */
const TABS: {
  tab: string;
  path: string;
  check: (page: Page) => Promise<void>;
}[] = [
  {
    tab: "homework",
    path: "/api/v1/homework/feed",
    check: async (page) => {
      await pickMine(page);
      const hw = page.getByTestId("parent-homework");
      await expect(
        hw.getByText("E2E homework for my class", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        hw.getByText("E2E class diary", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("E2E homework for the other class", { exact: true }),
      ).toHaveCount(0);
    },
  },
  {
    tab: "ptm",
    path: "/api/v1/ptm/overview",
    check: async (page) => {
      await pickMine(page);
      await expect(
        page.getByTestId("parent-ptm").getByRole("combobox"),
      ).toContainText("E2E PTM October", { timeout: 30_000 });
    },
  },
  {
    tab: "leave",
    path: "/api/v1/leave/list",
    check: async (page) => {
      await expect(page.getByTestId("parent-leave")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(OTHER_LEAVE_REASON)).toHaveCount(0);
    },
  },
  {
    tab: "complaints",
    path: "/api/v1/complaints/list",
    check: async (page) => {
      await expect(page.getByTestId("parent-complaints")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(OTHER_COMPLAINT)).toHaveCount(0);
    },
  },
  {
    tab: "profile",
    path: "/api/v1/profile",
    check: async (page) => {
      const card = page.getByTestId("parent-profile");
      await expect(card).toBeVisible({ timeout: 30_000 });
      const hh = fx.sis.households.find((h) => h.id === MINE.householdId)!;
      await expect(card.locator('input[name="guardianName"]')).toHaveValue(
        hh.guardianName,
      );
      await expect(page.getByText(MINE.fullName).first()).toBeVisible();
    },
  },
  {
    tab: "subjects",
    path: "/api/parent-portal/subjects",
    check: async (page) => {
      await expect(page.getByTestId("parent-subjects")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(MINE.fullName).first()).toBeVisible();
      await expect(page.getByText(/could not find your family/i)).toHaveCount(
        0,
      );
    },
  },
  {
    tab: "notices",
    path: "/api/v1/comms/feed",
    check: async (page) => {
      const list = page.getByTestId("parent-notices");
      await expect(
        list.getByText("E2E notice for parents", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        list.getByText("E2E staff-only notice", { exact: true }),
      ).toHaveCount(0);
      // The built-in sample notices (what a refused desk used to leave on screen) are gone.
      await expect(
        page.getByText("Annual Sports Day & Cultural Meet 2026"),
      ).toHaveCount(0);
    },
  },
  {
    tab: "news",
    path: "/api/v1/comms/feed",
    check: async (page) => {
      await expect(
        page
          .getByTestId("parent-news")
          .getByText("E2E school news", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
    },
  },
];

for (const size of SIZES) {
  test(`every tab shows this family's own data (${size.name})`, async ({
    browser,
  }) => {
    const context = await contextAs(
      browser,
      parentSession(MINE.householdId),
      size,
    );
    const page = await context.newPage();
    for (const t of TABS) {
      await openTab(page, t.tab);
      await t.check(page);
      await page.screenshot({
        path: path.join(SHOTS, `${t.tab}-${size.name}.png`),
        fullPage: true,
      });
    }
    await context.close();
  });
}

for (const size of SIZES) {
  test(`a failed read on any tab says so and offers Try again — never 'No household linked' (${size.name})`, async ({
    browser,
  }) => {
    // Each failed read is retried twice (1 s, 2 s) before it is shown.
    test.setTimeout(300_000);
    const context = await contextAs(
      browser,
      parentSession(MINE.householdId),
      size,
    );
    const page = await context.newPage();
    for (const t of TABS) {
      let fail = true;
      const pattern = `**${t.path}*`;
      await page.route(pattern, (r) =>
        fail
          ? r.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                ok: false,
                error: {
                  code: "server_error",
                  message: "Unavailable right now",
                },
              }),
            })
          : r.continue(),
      );
      await openTab(page, t.tab);
      const err = page.getByTestId("parent-read-error").first();
      await expect(err, `${t.tab}: failed state`).toBeVisible({
        timeout: 30_000,
      });
      await expect(err).toContainText("Could not load");
      await expect(page.getByText(/No household linked/)).toHaveCount(0);
      if (t.tab === "homework" || t.tab === "notices") {
        await page.screenshot({
          path: path.join(SHOTS, `failed-${t.tab}-${size.name}.png`),
          fullPage: true,
        });
      }
      fail = false;
      // Another reader of the same answer (the strip, the bell) may already be
      // asking again; Try again is pressed while it is still on screen.
      await err
        .getByRole("button", { name: /Try again|Trying/ })
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      await t.check(page);
      await page.unroute(pattern);
    }
    await context.close();
  });
}

test("writes go through the server: leave, complaint, chat — and survive a reload", async ({
  browser,
}) => {
  const context = await contextAs(browser, parentSession(MINE.householdId));
  const page = await context.newPage();

  await openTab(page, "leave");
  await pickMine(page);
  const leave = page.getByTestId("parent-leave");
  await leave.getByLabel("Reason").fill(LEAVE_REASON);
  await leave.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Leave request submitted")).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  await pickMine(page);
  await expect(
    page.getByTestId("parent-leave").getByText(LEAVE_REASON),
  ).toBeVisible({ timeout: 30_000 });

  await openTab(page, "complaints");
  const c = page.getByTestId("parent-complaints");
  await c.getByLabel("Subject").fill(COMPLAINT);
  await c.getByLabel("Details").fill("Twenty minutes late on Monday.");
  await c.getByRole("button", { name: "Submit complaint" }).click();
  await expect(page.getByText(/Complaint submitted/)).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  await expect(
    page.getByTestId("parent-complaints").getByText(COMPLAINT),
  ).toBeVisible({ timeout: 30_000 });

  // Chat with the class teacher, from the header.
  await page.getByRole("button", { name: "Chat" }).first().click();
  const chat = page.getByTestId("parent-chat");
  await expect(chat).toBeVisible();
  const chip = chat.locator(`button[data-child-id="${MINE.id}"]`);
  if (await chip.count()) await chip.click();
  await chat.getByLabel("Message").fill(CHAT);
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(
    chat.getByTestId("parent-chat-messages").getByText(CHAT),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS, "chat-desktop-light.png") });
  await page.reload();
  await page.getByRole("button", { name: "Chat" }).first().click();
  const chip2 = page
    .getByTestId("parent-chat")
    .locator(`button[data-child-id="${MINE.id}"]`);
  if (await chip2.count()) await chip2.click();
  await expect(
    page.getByTestId("parent-chat-messages").getByText(CHAT),
  ).toBeVisible({ timeout: 30_000 });

  // The bell lists the parents' notice (and not the staff-only one).
  await page.keyboard.press("Escape");
  await page.goto("/parent?tab=fees");
  await page
    .getByRole("button", { name: /notifications/i })
    .first()
    .click();
  const bell = page.getByTestId("parent-bell");
  await expect(
    bell.getByText("E2E notice for parents", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    bell.getByText("E2E staff-only notice", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, "bell-desktop-light.png") });
  await context.close();
});
